"""Runtime keyword router: question -> {dataset, measures, dimensions, filters} -> one targeted DAX query.

No schema read at chat time. The keyword index (built offline by keyword_index.py) already knows the
dataset, the measure names and the table/column of each stored value. The router:

  1. embeds the question and searches the keyword index (optionally inside the dataset the caller chose);
  2. picks the best dataset, its measures (synonym hits), dimension columns and value filters
     ("handymax" -> SUB_TYPE = "Handymax", "SPPL" -> MANAGER_GROUP = "SPPL");
  3. builds one EVALUATE query and validates it against a stub model made only from those names.

Returns None when the match is not confident, so the full SemantIQ pipeline answers instead.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any

from . import dax_guard
from .keyword_index import GatewayEmbedder
from .keyword_store import KeywordStore
from .metadata import Column, Measure, SemanticModel, Table
from .settings import SemantiqSettings

SEARCH_FLOOR = 0.35  # candidates below this are ignored; the decision threshold is keyword_router_min_score
RERANK_MARGIN = 0.05  # measures within this score of the best are candidates for the LLM re-rank
VALUE_CACHE_S = 900.0  # stored values of a dataset are re-read at most every 15 minutes
_VALUE_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
MAX_MEASURES = 3
MAX_DIMS = 3
MAX_FILTERS = 4


@dataclass
class Route:
    dataset_id: str
    workspace_id: str
    report_ids: list[str]
    measures: list[dict[str, str]]  # {name, table}
    dimensions: list[dict[str, str]]  # {table, column}
    filters: list[dict[str, str]]  # {table, column, value}
    confidence: float
    matched: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "dataset_id": self.dataset_id,
            "workspace_id": self.workspace_id,
            "measures": [m["name"] for m in self.measures],
            "dimensions": [f"{d['table']}[{d['column']}]" for d in self.dimensions],
            "filters": [f"{f['table']}[{f['column']}] = {f['value']}" for f in self.filters],
            "confidence": round(self.confidence, 3),
            "matched_keywords": self.matched[:10],
        }


_VESSEL_SYNONYMS = re.compile(r"\b(tankers?|carriers?|ships?)\b", re.IGNORECASE)


def normalize_question(question: str) -> str:
    """Tankers, carriers and ships are vessels in this business: 'SPPL tankers' -> 'SPPL vessels'."""
    return _VESSEL_SYNONYMS.sub(lambda m: "vessels" if m.group(0)[-1].lower() == "s" else "vessel", question or "")


# Words that mean "vessel" in this business (tankers and carriers are vessels, not a type filter).
_GENERIC = frozenset(
    {"vessel", "vessels", "ship", "ships", "tanker", "tankers", "carrier", "carriers", "date", "of", "the", "in", "for", "and", "by", "number", "count"}
)


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", (text or "").lower()))


def _lexical(keyword: str, question_tokens: set[str], *, generic_ok: bool = False) -> bool:
    """True when the keyword's words are in the question (acronyms: the whole word, e.g. SOMI).

    Embedding similarity alone is not enough to filter or to add a dimension: 'handymax tankers' must not pull
    in an owner named 'SHANDONG SHIPPING TANKER' just because the words look alike.
    """
    words = [w for w in re.findall(r"[a-z0-9]+", (keyword or "").lower()) if generic_ok or w not in _GENERIC]
    if not words:
        return False
    if len(words) == 1 and len(words[0]) <= 6 and words[0].isalpha():
        return words[0] in question_tokens or words[0] + "s" in question_tokens
    return all(w in question_tokens or w + "s" in question_tokens for w in words)


_HELPER_MEASURE = re.compile(r"^(HTML_|Last Refresh)", re.IGNORECASE)


def _preferred_measures() -> tuple[str, ...]:
    from .ontology import _ontology_paths, _read_json

    return tuple(_read_json(_ontology_paths()[2]).get("vessel_count_measures") or ())


def _pick_route(
    hits: list[dict[str, Any]],
    dataset_id: str | None,
    min_score: float,
    question: str = "",
    preferred_measures: tuple[str, ...] = (),
) -> Route | None:
    """Decision rules, separated from I/O so they can be tested."""
    if not hits or hits[0]["score"] < min_score:
        return None
    q_tokens = _tokens(question)
    best_ds = (dataset_id or str(hits[0].get("dataset_id") or "")).lower()
    if not best_ds:
        return None
    in_ds = [h for h in hits if str(h.get("dataset_id") or "").lower() == best_ds and h["score"] >= min_score]
    # Best score first; among equal scores prefer DOC / sub-category columns over others.
    # Ties: the main vessel register table first (filters on another table need a relationship we cannot assume).
    in_ds.sort(key=lambda h: (-h["score"], _column_rank(h), str(h.get("table_name") or "") != MAIN_VESSEL_TABLE))
    measures: list[dict[str, str]] = []
    seen: set[str] = set()
    for h in in_ds:
        name = h.get("measure_name")
        if name and re.search(r"[!?]", name):
            continue  # known-broken measure: never used until a refresh fixes it
        if name and _HELPER_MEASURE.match(name):
            continue  # report plumbing (HTML_Table, Last Refresh), not a business figure
        if h.get("object_kind") == "measure" and name and name not in seen:
            seen.add(name)
            measures.append({"name": name, "table": h.get("table_name") or ""})
    if not measures:
        return None  # nothing to compute: let the full pipeline answer
    # The business definition of a vessel count (ontology: vessel_count_measures) wins and is used alone.
    for preferred in preferred_measures:
        match = next((m for m in measures if m["name"].lower() == preferred.lower()), None)
        if match:
            measures = [match]
            break
    dims: list[dict[str, str]] = []
    dim_seen: set[tuple[str, str]] = set()
    filters: list[dict[str, str]] = []
    filter_cols: set[tuple[str, str]] = set()
    filter_terms: set[str] = set()
    for h in in_ds:
        kind = h.get("object_kind")
        table, column = str(h.get("table_name") or ""), str(h.get("column_name") or "")
        keyword = str(h.get("keyword") or "")
        if question and kind in ("column", "value") and not _lexical(keyword, q_tokens):
            continue  # no words in the question for this column or value: do not filter or group by it
        if kind == "column" and column and column.upper() not in dim_seen:
            dim_seen.add(column.upper())  # one grouping per column name, even if several tables carry it
            dims.append({"table": table, "column": column})
        elif kind == "value" and column and str(h.get("keyword") or "") not in filter_terms:
            # One filter per question term: 'sppl' is DOC = SPPL, not also a second column ANDed onto it.
            filter_terms.add(str(h.get("keyword") or ""))
            filter_cols.add((table, column))
            filters.append({"table": table, "column": column, "value": str(h.get("value") or "")})
    matched = [str(h.get("keyword")) for h in in_ds if h.get("keyword")]
    return Route(
        dataset_id=best_ds,
        workspace_id=str(in_ds[0].get("workspace_id") or ""),
        report_ids=list(in_ds[0].get("report_ids") or []),
        measures=measures[:MAX_MEASURES],
        dimensions=dims[:MAX_DIMS],
        filters=filters[:MAX_FILTERS],
        confidence=float(hits[0]["score"]),
        matched=matched,
    )


def _q(table: str) -> str:
    return "'" + table.replace("'", "''") + "'"


def _col(table: str, column: str) -> str:
    return f"{_q(table)}[{column.replace(']', ']]')}]"


def _measure(name: str) -> str:
    return "[" + name.replace("]", "]]") + "]"


def _text(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def build_dax(route: Route) -> str:
    """One targeted EVALUATE: SUMMARIZECOLUMNS over the dimensions, measures, filtered by the matched values."""
    # COALESCE: DAX returns BLANK for an empty filter set; the user should see 0 vessels, not a blank.
    measures = ", ".join(f"{_text(m['name'])}, COALESCE({_measure(m['name'])}, 0)" for m in route.measures)
    if route.dimensions:
        dims = ", ".join(_col(d["table"], d["column"]) for d in route.dimensions)
        core = f"SUMMARIZECOLUMNS({dims}, {measures})"
    else:
        core = f"ROW({measures})"
    if route.filters:
        conds = ", ".join(f"{_col(f['table'], f['column'])} = {_text(f['value'])}" for f in route.filters)
        core = f"CALCULATETABLE({core}, {conds})"
    return f"EVALUATE {core}"


def stub_model(route: Route) -> SemanticModel:
    """Model made only from the names in the route. The DAX guard checks references against it."""
    tables: dict[str, Table] = {}

    def table(name: str) -> Table:
        return tables.setdefault(name, Table(name=name, columns=[], measures=[]))

    for m in route.measures:
        t = table(m["table"])
        t.measures.append(Measure(name=m["name"], table=m["table"]))
    for d in [*route.dimensions, *route.filters]:
        t = table(d["table"])
        if not any(c.name == d["column"] for c in t.columns):
            t.columns.append(Column(name=d["column"]))
    return SemanticModel(route.workspace_id, route.dataset_id, None, list(tables.values()), [])


class KeywordRouter:
    def __init__(self, settings: SemantiqSettings, store: KeywordStore, embedder: GatewayEmbedder):
        self.settings = settings
        self.store = store
        self.embedder = embedder

    async def search(self, question: str, dataset_id: str | None = None) -> tuple[str, list[dict[str, Any]]]:
        """Step 1 of the graph: vector search plus exact value words. Returns (normalised question, hits)."""
        question = normalize_question(question)
        vector = (await self.embedder.embed([question]))[0]
        hits: list[dict[str, Any]] = await self.store.search(
            vector,
            top_k=self.settings.keyword_router_top_k,
            dataset_id=dataset_id,
            threshold=SEARCH_FLOOR,
        )
        if dataset_id:
            # Exact words of stored values ('handymax', 'SPPL', 'SOMI') are matched directly. Similarity alone let
            # 'handysize tanker' outrank 'handymax' inside a longer question.
            hits = exact_value_hits(question, await self._values(dataset_id)) + hits
        return question, hits

    async def _values(self, dataset_id: str) -> list[dict[str, Any]]:
        """Stored values of a dataset, cached: they change only when the index is refreshed."""
        key = dataset_id.lower()
        hit = _VALUE_CACHE.get(key)
        if hit and time.monotonic() - hit[0] < VALUE_CACHE_S:
            return hit[1]
        values = await self.store.value_points(key)
        _VALUE_CACHE[key] = (time.monotonic(), values)
        return values

    def pick(self, question: str, hits: list[dict[str, Any]], dataset_id: str | None = None) -> Route | None:
        """Step 2: choose the dataset, measure, dimensions and value filters from the hits."""
        return _pick_route(hits, dataset_id, self.settings.keyword_router_min_score, question, _preferred_measures())

    async def route(self, question: str, dataset_id: str | None = None) -> Route | None:
        question, hits = await self.search(question, dataset_id)
        return self.pick(question, hits, dataset_id)


def measure_options(route: Route | None, hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Measures that look equally right for the question (candidates for the re-rank step).

    Empty when there is nothing to choose: one clear winner, or a preferred vessel-count measure was used.
    """
    if route is None or not route.measures:
        return []
    if any(m["name"] in set(_preferred_measures()) for m in route.measures):
        return []  # the business definition of a vessel count is used alone
    dataset = route.dataset_id
    usable = [
        h
        for h in hits
        if h.get("object_kind") == "measure"
        and h.get("measure_name")
        and str(h.get("dataset_id") or "").lower() == dataset
        and not re.search(r"[!?]", h["measure_name"])
        and not _HELPER_MEASURE.match(h["measure_name"])
    ]
    if not usable:
        return []
    best = max(h["score"] for h in usable)
    seen: dict[str, dict[str, Any]] = {}
    for h in sorted(usable, key=lambda x: -x["score"]):
        name = h["measure_name"]
        if name not in seen and h["score"] >= best - RERANK_MARGIN:
            seen[name] = {"name": name, "table": h.get("table_name") or "", "score": round(float(h["score"]), 3), "description": h.get("description") or ""}
    options = list(seen.values())
    return options if len(options) > 1 else []


MAIN_VESSEL_TABLE = "VESSEL_PARTICULARS_ACTIVE"
_COLUMN_PREFERENCE = {"DOC": 0, "DOC.SHORT NAME": 1, "SHIP_MANAGEMENT_COMPANY_NAME": 2, "VESSEL_SUB_CATEGORY": 3, "VESSEL_SUBTYPE": 4, "VESSEL_TYPE": 5, "OWNER": 6}


def _column_rank(hit: dict[str, Any]) -> int:
    return _COLUMN_PREFERENCE.get(str(hit.get("column_name") or "").upper(), 9)


def exact_value_hits(question: str, values: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Stored values whose words appear in the question, in order, scored 1.0 (exact, not similarity)."""
    q = re.findall(r"[a-z0-9]+", (question or "").lower())
    found: list[dict[str, Any]] = []
    for v in values:
        words = re.findall(r"[a-z0-9]+", str(v.get("keyword") or "").lower())
        if not words or len(words) > len(q):
            continue
        n = len(words)
        if any(q[i : i + n] == words for i in range(len(q) - n + 1)):
            found.append({**v, "score": 1.0})
    return found


def result_from_route(route: Route, rows: list[dict[str, Any]], columns: list[str], dax: str, guard_dax: str, meta: list[dict[str, Any]]) -> dict[str, Any]:
    """Result shaped like SemantIQ's answer_question result, so the orchestrator handles it unchanged."""
    measure_names = [m["name"] for m in route.measures]
    filter_text = ", ".join(f"{f['column']} = {f['value']}" for f in route.filters)
    assumptions = [f"Matched the keyword index: {', '.join(measure_names)}" + (f" filtered by {filter_text}" if filter_text else "")]
    return {
        "status": "ok",
        "dax": dax,
        "executed_dax": guard_dax,
        "columns": columns,
        "rows": rows,
        "row_count": len(rows),
        "truncated": False,
        "references": sorted({f"{m['table']}[{m['name']}]" for m in route.measures} | {f"{d['table']}[{d['column']}]" for d in route.dimensions}),
        "column_meta": meta,
        "assumptions": assumptions,
        "result_description": ", ".join(measure_names),
        "model": {"workspaceId": route.workspace_id, "datasetId": route.dataset_id, "name": None},
        "route": route.as_dict(),
        "confidence_components": {
            "schema_match": 1.0,
            "query_success": 1.0,
            "intent_clarity": 1.0 if route.filters or route.dimensions else 0.99,
        },
        "attempts": 1,
        "timings": {},
        "query_plan": None,
    }
