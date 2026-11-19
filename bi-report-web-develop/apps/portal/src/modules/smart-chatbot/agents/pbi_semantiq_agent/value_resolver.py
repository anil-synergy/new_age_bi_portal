"""Match words in the user's question to values that actually exist in the semantic model.

The model, not the user, decides the filter value. Example: "SPPL" or "Synergy Offshore Marine" in the
question is matched against the distinct values of the DOC column (MANAGER_GROUP) read over XMLA, so the DAX
filters on the stored value. Only DISTINCT reads are run, capped and guarded. Results:

* ``resolved``   one value per term  -> used as an exact filter in the DAX prompt
* ``ambiguous``  a term matches several values equally well -> the user is asked to choose
* ``unmatched``  nothing matched -> left to the planner (no guessing)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from . import dax_guard
from .metadata import SemanticModel

# Columns whose stored values are filter literals, in the order they are searched.
# Names seen in the vessel register tables of real models: DOC / manager (incl. the acronym column Doc.Short Name),
# sub type (VESSEL_SUBTYPE, VESSEL_SUB_CATEGORY), vessel type, owner.
VALUE_COLUMNS: tuple[str, ...] = (
    "MANAGER_GROUP",
    "DOC",
    "DOC.SHORT NAME",
    "SHIP_MANAGEMENT_COMPANY_NAME",
    "SUB_TYPE",
    "VESSEL_SUB_TYPE",
    "VESSEL_SUBTYPE",
    "VESSEL_SUB_CATEGORY",
    "VESSEL_TYPE",
    "OWNER",
)
MAX_DISTINCT = 2000
MIN_TERM_LEN = 2

# Words that describe the question rather than naming a value.
_STOP = frozenset(
    """a an and are as at be by count do for from how i in is it list many me my no not number of on or
    show tell the this to total vessel vessels ship ships fleet type types all any each per with what which
    who when where why please give get sum average trend compare month months year years period date
    january february march april may june july august september october november december jan feb mar apr
    jun jul aug sep sept oct nov dec yesterday today last next""".split()
)
_LEGAL = frozenset({"ltd", "inc", "co", "llc", "pte", "sa", "limited", "company", "corp", "plc", "the", "and"})


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


def _words(text: str) -> list[str]:
    return [w for w in re.split(r"[^a-z0-9]+", (text or "").lower()) if w]


def acronym(value: str) -> str:
    """'Synergy Offshore Marine Inc' -> 'SOM' (legal suffixes ignored)."""
    parts = [w for w in _words(value) if w not in _LEGAL]
    return "".join(w[0] for w in parts)


def acronyms(value: str) -> set[str]:
    """Both common forms: legal suffixes dropped ('SOM') and kept ('SOMI' for 'Synergy Offshore Marine Inc')."""
    all_words = _words(value)
    return {acronym(value), "".join(w[0] for w in all_words)} - {""}


def question_terms(question: str) -> list[str]:
    """1-3 word phrases from the question, lowercased, without filler words."""
    tokens = re.findall(r"[A-Za-z0-9][A-Za-z0-9.&\-]*", question or "")
    terms: list[str] = []
    for n in (3, 2, 1):
        for i in range(len(tokens) - n + 1):
            chunk = tokens[i : i + n]
            if any(t.isdigit() for t in chunk):
                continue
            # Skip only chunks made entirely of filler. "synergy ship" stays: "ship" is filler on its own
            # but part of a company name here. A phrase that matches nothing costs nothing.
            if all(t.lower() in _STOP for t in chunk):
                continue
            phrase = " ".join(t.lower().strip(".") for t in chunk)
            if len(_norm(phrase)) >= MIN_TERM_LEN and phrase not in terms:
                terms.append(phrase)
    return terms


@dataclass
class Match:
    term: str
    table: str
    column: str
    value: str
    kind: str  # exact | acronym | plural | word
    score: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {"term": self.term, "table": self.table, "column": self.column, "value": self.value, "kind": self.kind}


@dataclass
class Resolution:
    resolved: list[Match] = field(default_factory=list)
    ambiguous: dict[str, list[Match]] = field(default_factory=dict)
    unmatched_terms: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "resolved": [m.as_dict() for m in self.resolved],
            "ambiguous": {t: [m.as_dict() for m in ms] for t, ms in self.ambiguous.items()},
        }

    def prompt(self) -> str:
        if not self.resolved:
            return ""
        lines = ["RESOLVED FILTER VALUES (exact values stored in the model; filter on these literals):"]
        for m in self.resolved:
            lines.append(f"- '{m.table}'[{m.column}] = \"{m.value}\"   (from the words \"{m.term}\", match: {m.kind})")
        return "\n".join(lines)


def _kind_for(term: str, value: str) -> tuple[str, int]:
    """How a question phrase relates to a stored value, and how strong that is (0 = no match)."""
    tn = _norm(term)
    vn = _norm(value)
    tw = _words(term)
    if not vn or not tn:
        return "", 0
    if tn == vn:
        return "exact", 4
    if len(tn) >= 2 and tn in acronyms(value):
        return "acronym", 3
    if tn.endswith("s") and tn[:-1] == vn:
        return "plural", 2
    vw = _words(value)
    # contiguous word sequence: "synergy ship" inside "Synergy Ship Management"
    if len(tw) > 1 and any(vw[i : i + len(tw)] == tw for i in range(len(vw) - len(tw) + 1)):
        return "phrase", 2
    if len(tn) >= 4 and tn in vw:
        return "word", 1
    return "", 0


def match_terms(terms: list[str], values: dict[tuple[str, str], list[str]]) -> Resolution:
    """Pure matching. ``values`` maps (table, column) -> distinct stored values.

    Longer phrases are matched first and consume their words, so "synergy" is not asked about again when
    "synergy ship" already explains it.
    """
    out = Resolution()
    consumed: set[str] = set()
    for term in sorted(terms, key=lambda t: (-len(_words(t)), -len(_norm(t)))):
        words = _words(term)
        if words and all(w in consumed for w in words):
            continue
        candidates: list[Match] = []
        for (table, column), vals in values.items():
            for v in vals:
                kind, score = _kind_for(term, v)
                if kind:
                    candidates.append(Match(term, table, column, v, kind, score))
        if not candidates:
            out.unmatched_terms.append(term)
            continue
        best = max(c.score for c in candidates)
        top = [c for c in candidates if c.score == best]
        if len({(c.table, c.column, c.value) for c in top}) == 1:
            out.resolved.append(top[0])
        else:
            out.ambiguous[term] = sorted(top, key=lambda c: (c.column, c.value))[:8]
        consumed.update(words)
    out.resolved = sorted(out.resolved, key=lambda x: x.term)
    return out


VALUE_CACHE_TTL_S = 900.0
_value_cache: dict[tuple[str, str], tuple[float, dict[tuple[str, str], list[str]]]] = {}


async def _read_column(client, workspace_id: str, dataset_id: str, model: SemanticModel, table: str, column: str) -> tuple[tuple[str, str], list[str]] | None:
    t = table.replace("'", "''")
    dax = f"EVALUATE TOPN({MAX_DISTINCT}, DISTINCT(SELECTCOLUMNS('{t}', \"V\", '{t}'[{column}])))"
    guard = dax_guard.validate(dax, model, max_rows=MAX_DISTINCT)
    if not guard.ok:
        return None
    try:
        data = await client.execute_dax(workspace_id, dataset_id, guard.dax)
    except Exception:  # noqa: BLE001 - a column that cannot be read is simply not searched
        return None
    vals = [str(next(iter(r.values()))) for r in data.get("rows") or [] if r and next(iter(r.values())) is not None]
    return ((table, column), sorted(set(vals))) if vals else None


async def distinct_values(client, workspace_id: str, dataset_id: str, model: SemanticModel) -> dict[tuple[str, str], list[str]]:
    """Distinct stored values of the value columns in this model (XMLA, read-only).

    Cached per dataset for ``VALUE_CACHE_TTL_S`` and read concurrently, so the lookup adds little time per
    question. Values change only on data refresh, so a short staleness window is acceptable.
    """
    import asyncio
    import time

    key = (workspace_id.lower(), dataset_id.lower())
    hit = _value_cache.get(key)
    if hit and time.monotonic() - hit[0] < VALUE_CACHE_TTL_S:
        return hit[1]
    wanted = {c.upper() for c in VALUE_COLUMNS}
    jobs = [
        _read_column(client, workspace_id, dataset_id, model, table.name, col.name)
        for table in model.tables
        if not table.hidden
        for col in table.columns
        if not col.hidden and col.name.upper() in wanted
    ]
    results = await asyncio.gather(*jobs) if jobs else []
    found = {k: v for r in results if r for k, v in [r]}
    if found:  # never cache a failed read as "no values"
        _value_cache[key] = (time.monotonic(), found)
    return found


def clear_value_cache() -> None:
    _value_cache.clear()


async def resolve_question_values(client, workspace_id: str, dataset_id: str, model: SemanticModel, question: str) -> Resolution:
    values = await distinct_values(client, workspace_id, dataset_id, model)
    if not values:
        return Resolution()
    return match_terms(question_terms(question), values)
