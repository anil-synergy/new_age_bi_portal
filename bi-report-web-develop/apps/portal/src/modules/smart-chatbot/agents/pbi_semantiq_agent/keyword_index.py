"""Keyword indexer: measure and column synonyms -> Qdrant. Scheduled job, never run at chat time.

Modes
  full (first run, or --full)  enrich every object, embed, store.
  incremental (default, nightly) read every model's schema over XMLA, then only:
      * objects that are new or whose name / description / format / expression changed get LLM synonyms;
        everything else reuses its cached keywords (no LLM call);
      * a dataset is re-embedded and rewritten only when one of its objects or its vessel-column values changed;
      * datasets that no longer exist in the workspace are removed from Qdrant.

State (``keyword_state_dir``/state.json) keeps the per-object signature and keywords, so a rerun costs only the
XMLA schema reads. A lock file stops two runs overlapping. State is saved after each dataset, so an interrupted
run resumes where it stopped.

Commands
    python -m pbi_semantiq_agent.keyword_index                 # incremental (nightly task)
    python -m pbi_semantiq_agent.keyword_index --full          # rebuild everything
    python -m pbi_semantiq_agent.keyword_index --dataset <id>  # one model
    python -m pbi_semantiq_agent.keyword_index --dry-run       # read and enrich, store nothing
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from smart_common.llm import LLMClient, LLMUnavailable
from smart_common.logging import configure_logging, log

from .keyword_store import KeywordStore, build_keyword_store, stable_key
from .metadata import SemanticModel, load_model_extended
from .metadata_paths import atomic_write_json
from .powerbi_client import PowerBIClient, PowerBIError
from .settings import SemantiqSettings, get_settings
from .value_resolver import VALUE_COLUMNS, acronyms, distinct_values

logger = logging.getLogger(__name__)

STATE_VERSION = 1
LOCK_STALE_S = 6 * 3600
MODEL_CONCURRENCY = 4  # XMLA schema reads in flight at once

# Dimension columns worth a keyword (vessel register and common slicers). Measures are always indexed.
DIMENSION_COLUMNS = frozenset(
    {c.upper() for c in VALUE_COLUMNS}
    | {"IMO", "IMO_NUMBER", "IMO_NO", "VESSEL_NAME", "DWT", "DEADWEIGHT", "DEAD_WEIGHT", "HANDOVER_DATE", "TAKEOVER_DATE", "DATE_OF_HANDOVER", "DATE_OF_TAKEOVER"}
)
# Measures / columns with '!' or '?' in the name are known to be broken in the model. Left out of the index until a
# refresh fixes them (then the next incremental run adds them back, because their name no longer matches).
BROKEN_NAME = re.compile(r"[!?]")
MAX_KEYWORDS = 10
MAX_KEYWORD_LEN = 60
EMBED_BATCH = 64

ENRICH_SYSTEM = (
    "You write search keywords for a maritime BI semantic model. For each object (a measure or a column) return "
    "5 to 10 short business phrases a user might type to ask for it. Use plain words, no company names, no numbers, "
    "no table names. Include the object's own name first in normal wording. Return JSON only."
)


class KeywordItem(BaseModel):
    id: int
    keywords: list[str] = Field(default_factory=list)


class KeywordBatch(BaseModel):
    items: list[KeywordItem] = Field(default_factory=list)


class KeywordIndexError(RuntimeError):
    pass


# ---------------------------------------------------------------- extraction and signatures
def _words(name: str) -> list[str]:
    spaced = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name or "").replace("_", " ")
    return [w.lower() for w in spaced.split() if w]


def clean_keywords(name: str, raw: list[str]) -> list[str]:
    """Lower-case, de-duplicated, length-capped. The object's own words are always included."""
    out: list[str] = []
    for kw in [" ".join(_words(name)), *raw]:
        kw = re.sub(r"\s+", " ", str(kw or "")).strip().lower()
        if kw and len(kw) <= MAX_KEYWORD_LEN and kw not in out:
            out.append(kw)
    return out[:MAX_KEYWORDS]


def extract_items(model: SemanticModel) -> list[dict[str, Any]]:
    """Measures and dimension columns with their descriptions and (short) DAX expression."""
    items: list[dict[str, Any]] = []
    for table in model.tables:
        if table.hidden:
            continue
        for m in table.measures:
            if m.hidden or BROKEN_NAME.search(m.name or ""):
                continue
            items.append(
                {
                    "kind": "measure",
                    "table": table.name,
                    "name": m.name,
                    "description": (m.description or "")[:200],
                    "format": m.format_string,
                    "expression": " ".join((m.expression or "").split())[:240],
                }
            )
        for c in table.columns:
            if c.hidden or c.name.upper() not in DIMENSION_COLUMNS or BROKEN_NAME.search(c.name or ""):
                continue
            items.append({"kind": "column", "table": table.name, "name": c.name, "description": (c.description or "")[:200], "format": None, "expression": ""})
    return items


def object_key(item: dict[str, Any]) -> str:
    return f"{item['kind']}|{item['table']}|{item['name']}".lower()


def object_sig(item: dict[str, Any]) -> str:
    """Changes when anything the synonyms are based on changes."""
    blob = "|".join([item["kind"], item["table"], item["name"], item.get("description") or "", str(item.get("format") or ""), item.get("expression") or ""])
    return hashlib.blake2b(blob.encode("utf-8"), digest_size=12).hexdigest()


def values_sig(values: dict[tuple[str, str], list[str]]) -> str:
    blob = "\n".join(f"{t}.{c}={v}" for (t, c), vals in sorted(values.items()) for v in sorted(vals))
    return hashlib.blake2b(blob.encode("utf-8"), digest_size=12).hexdigest()


# ---------------------------------------------------------------- LLM synonyms
async def enrich(llm: LLMClient, items: list[dict[str, Any]], batch: int) -> list[list[str]]:
    """Synonyms per item, same order. Falls back to the object's own words when the LLM is unavailable."""
    result: list[list[str]] = [clean_keywords(i["name"], []) for i in items]
    if not llm.configured or not items:
        return result
    for start in range(0, len(items), max(1, batch)):
        chunk = items[start : start + batch]
        payload = [
            {"id": start + i, "kind": it["kind"], "table": it["table"], "name": it["name"], "description": it["description"], "expression": it["expression"]}
            for i, it in enumerate(chunk)
        ]
        try:
            out = await llm.complete_json(ENRICH_SYSTEM, json.dumps(payload, ensure_ascii=False), KeywordBatch, max_tokens=2000)
        except LLMUnavailable as exc:
            log(logger, logging.WARNING, "keyword_enrich_failed", error=str(exc)[:160])
            continue
        for row in out.items:
            if 0 <= row.id < len(items):
                result[row.id] = clean_keywords(items[row.id]["name"], row.keywords)
    return result


# ---------------------------------------------------------------- embeddings
class GatewayEmbedder:
    """Embeddings through the AI gateway (embedding deployment from EMBEDDING_MODEL)."""

    def __init__(self, settings: SemantiqSettings):
        if not settings.embedding_model:
            raise KeywordIndexError("EMBEDDING_MODEL is not set; the keyword index needs an embedding deployment")
        if not settings.llm_configured:
            raise KeywordIndexError("the AI gateway key (LLM_API_KEY) is not set")
        self.model = settings.embedding_model
        self.name = f"gateway:{self.model}"
        self._client = AsyncOpenAI(
            api_key=settings.llm_api_key.get_secret_value() if settings.llm_api_key else None,
            base_url=settings.llm_base_url,
            timeout=settings.llm_timeout_s,
            max_retries=2,
        )

    async def embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(texts), EMBED_BATCH):
            resp = await self._client.embeddings.create(model=self.model, input=texts[start : start + EMBED_BATCH])
            vectors.extend(list(item.embedding) for item in resp.data)
        return vectors


class LocalEmbedder:
    """Free embedding model on this machine (fastembed = ONNX, no PyTorch, no API key).

    Default BAAI/bge-small-en-v1.5 (384 dims). If it cannot be loaded, sentence-transformers/all-MiniLM-L6-v2
    (also 384 dims) is used.
    """

    def __init__(self, model_name: str, fallback: str, cache_dir: str):
        try:
            from fastembed import TextEmbedding
        except ImportError as exc:
            raise KeywordIndexError("fastembed is not installed (pip install fastembed)") from exc
        try:
            self._model = TextEmbedding(model_name=model_name, cache_dir=cache_dir)
            self.name = f"local:{model_name}"
        except Exception:  # noqa: BLE001 - primary model unavailable: use the fallback
            self._model = TextEmbedding(model_name=fallback, cache_dir=cache_dir)
            self.name = f"local:{fallback}"
            log(logger, logging.WARNING, "local_embedding_fallback", model=fallback)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        def run() -> list[list[float]]:
            return [[float(x) for x in vec] for vec in self._model.embed(texts)]

        return await asyncio.to_thread(run)


def build_keyword_embedder(settings: SemantiqSettings) -> GatewayEmbedder | LocalEmbedder:
    """Local free model by default; the gateway deployment when EMBEDDING_PROVIDER=gateway."""
    if settings.embedding_provider == "gateway":
        return GatewayEmbedder(settings)
    return LocalEmbedder(settings.local_embedding_model, settings.local_embedding_fallback_model, settings.local_embedding_cache_dir)


# ---------------------------------------------------------------- points
def build_points(
    workspace_id: str,
    dataset_id: str,
    report_ids: list[str],
    items: list[dict[str, Any]],
    keywords: list[list[str]],
) -> list[tuple[str, str, dict[str, Any]]]:
    """(key, keyword_text, payload) per keyword. The vector is added after embedding."""
    rows: list[tuple[str, str, dict[str, Any]]] = []
    for item, kws in zip(items, keywords):
        for kw in kws:
            key = stable_key(workspace_id, dataset_id, item["kind"], item["table"], item["name"], kw)
            payload = {
                "keyword": kw,
                "measure_name": item["name"] if item["kind"] == "measure" else None,
                "column_name": item["name"] if item["kind"] == "column" else None,
                "table_name": item["table"],
                "object_kind": item["kind"],
                "dataset_id": dataset_id.lower(),
                "workspace_id": workspace_id.lower(),
                "report_ids": [r.lower() for r in report_ids],
                "description": item["description"],
                "format": item.get("format"),
            }
            rows.append((key, kw, payload))
    return rows


def build_value_points(
    workspace_id: str,
    dataset_id: str,
    report_ids: list[str],
    values: dict[tuple[str, str], list[str]],
) -> list[tuple[str, str, dict[str, Any]]]:
    """Stored values of the vessel columns as keywords: 'Handymax' -> SUB_TYPE, 'Synergy Offshore Marine Inc' -> SOMI."""
    rows: list[tuple[str, str, dict[str, Any]]] = []
    for (table, column), vals in values.items():
        for value in vals:
            kws = [value.strip().lower(), *sorted(acronyms(value))]
            for kw in dict.fromkeys(k for k in kws if k):
                key = stable_key(workspace_id, dataset_id, "value", table, column, value, kw)
                payload = {
                    "keyword": kw,
                    "value": value,
                    "measure_name": None,
                    "column_name": column,
                    "table_name": table,
                    "object_kind": "value",
                    "dataset_id": dataset_id.lower(),
                    "workspace_id": workspace_id.lower(),
                    "report_ids": [r.lower() for r in report_ids],
                    "description": "",
                    "format": None,
                }
                rows.append((key, kw, payload))
    return rows


# ---------------------------------------------------------------- state and lock
def state_dir(settings: SemantiqSettings) -> Path:
    return Path(settings.keyword_state_dir)


def load_state(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("version") == STATE_VERSION:
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return {"version": STATE_VERSION, "datasets": {}, "last_success_at": None, "last_run": None}


def save_state(path: Path, state: dict[str, Any]) -> None:
    atomic_write_json(path, state)


class RunLock:
    """Lock file so two runs (nightly task and catch-up) never overlap. Stale locks expire."""

    def __init__(self, path: Path):
        self.path = path

    def __enter__(self) -> "RunLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists() and time.time() - self.path.stat().st_mtime < LOCK_STALE_S:
            raise KeywordIndexError("a keyword index run is already in progress")
        self.path.write_text(json.dumps({"pid": os.getpid(), "started": datetime.now(timezone.utc).isoformat()}), encoding="utf-8")
        return self

    def __exit__(self, *_exc: object) -> None:
        self.path.unlink(missing_ok=True)


# ---------------------------------------------------------------- one model
async def index_model(
    *,
    settings: SemantiqSettings,
    client: PowerBIClient,
    llm: LLMClient,
    embedder: Any,
    store: KeywordStore | None,
    state: dict[str, Any],
    workspace_id: str,
    dataset_id: str,
    report_ids: list[str],
    name: str | None,
    full: bool,
    dry_run: bool,
) -> dict[str, Any]:
    ds = dataset_id.lower()
    try:
        model, _hier, _raw = await load_model_extended(client, workspace_id, dataset_id, user=None, name=name)
    except PowerBIError as exc:
        return {"dataset_id": ds, "status": "unreadable", "error": str(exc)[:160]}
    items = extract_items(model)[: settings.keyword_enrich_max_measures]
    values = await distinct_values(client, workspace_id, dataset_id, model)
    vsig = values_sig(values)

    previous = state["datasets"].get(ds) or {}
    cached = previous.get("objects") or {}
    keywords: list[list[str] | None] = [None] * len(items)
    changed_idx: list[int] = []
    for i, it in enumerate(items):
        hit = cached.get(object_key(it))
        if not full and hit and hit.get("sig") == object_sig(it):
            keywords[i] = list(hit.get("keywords") or [])
        else:
            changed_idx.append(i)
    if changed_idx:
        fresh = await enrich(llm, [items[i] for i in changed_idx], settings.keyword_enrich_batch)
        for i, kws in zip(changed_idx, fresh):
            keywords[i] = kws
    objects = {object_key(it): {"sig": object_sig(it), "keywords": keywords[i] or []} for i, it in enumerate(items)}

    rebuild = full or not previous or changed_idx or vsig != previous.get("values_sig") or set(objects) != set(cached)
    if not rebuild:
        return {"dataset_id": ds, "status": "unchanged", "objects": len(items)}
    value_count = sum(len(v) for v in values.values())
    if dry_run:
        return {"dataset_id": ds, "status": "dry_run", "objects": len(items), "changed": len(changed_idx), "values": value_count}

    rows = build_points(workspace_id, ds, report_ids, items, [keywords[i] or [] for i in range(len(items))])
    rows += build_value_points(workspace_id, ds, report_ids, values)
    if rows and store is not None:
        vectors = await embedder.embed([kw for _, kw, _ in rows])
        await store.delete_dataset(ds)  # replaced only after a successful read and embed
        await store.upsert([(key, vec, payload) for (key, _kw, payload), vec in zip(rows, vectors)])
    state["datasets"][ds] = {
        "workspace_id": workspace_id.lower(),
        "name": name,
        "objects": objects,
        "values_sig": vsig,
        "points": len(rows),
        "indexed_at": datetime.now(timezone.utc).isoformat(),
    }
    objects_changed = bool(changed_idx) or full or not previous or set(objects) != set(cached)
    return {
        "dataset_id": ds,
        "status": "indexed" if objects_changed else "values_updated",
        "objects": len(items),
        "changed": len(changed_idx),
        "values": value_count,
        "points": len(rows),
    }


# ---------------------------------------------------------------- enumeration
async def enumerate_models(client: PowerBIClient) -> list[tuple[str, str, dict[str, Any]]]:
    """Every dataset the service principal can see, with the reports that use it (Power BI REST)."""
    out: list[tuple[str, str, dict[str, Any]]] = []
    for ws in await client.list_workspaces():
        ws_id = str(ws["id"])
        try:
            datasets = await client.list_datasets(ws_id)
            reports = await client.list_reports(ws_id)
        except PowerBIError as exc:
            log(logger, logging.WARNING, "keyword_enumerate_workspace_failed", workspace_id=ws_id, error=str(exc)[:120])
            continue
        by_dataset: dict[str, list[str]] = {}
        for rep in reports:
            if rep.get("datasetId"):
                by_dataset.setdefault(str(rep["datasetId"]).lower(), []).append(str(rep["id"]))
        for ds in datasets:
            ds_id = str(ds["id"])
            out.append((ws_id, ds_id, {"name": ds.get("name"), "report_ids": by_dataset.get(ds_id.lower(), [])}))
    return out


# ---------------------------------------------------------------- run
async def run(*, dataset: str | None = None, dry_run: bool = False, full: bool = False) -> dict[str, Any]:
    settings = get_settings()
    if not dry_run and build_keyword_store(settings) is None:
        raise KeywordIndexError("No keyword store configured: set BI_REPORT_DB_* (pgvector) or QDRANT_URL")
    sdir = state_dir(settings)
    state_path = sdir / "state.json"
    with RunLock(sdir / "run.lock"):
        client = PowerBIClient(settings)
        llm = LLMClient(settings)
        embedder = build_keyword_embedder(settings) if not dry_run else None
        store = build_keyword_store(settings) if not dry_run else None
        state = load_state(state_path)
        results: list[dict[str, Any]] = []
        removed: list[str] = []
        try:
            if store is not None and embedder is not None:
                probe = await embedder.embed(["probe"])
                await store.ensure(len(probe[0]))
            enumerated = await enumerate_models(client)
            if not dataset:
                seen = {ds.lower() for _, ds, _ in enumerated}
                for gone in [d for d in state["datasets"] if d not in seen]:
                    if store is not None:
                        await store.delete_dataset(gone)
                    state["datasets"].pop(gone, None)
                    removed.append(gone)
            targets = [(ws, ds, meta) for ws, ds, meta in enumerated if not dataset or ds.lower() == dataset.lower()]
            sem = asyncio.Semaphore(MODEL_CONCURRENCY)

            async def refresh_marker(ws: str, ds: str) -> str:
                """Power BI refresh id of the dataset: changes whenever the data is refreshed. '' when unknown."""
                try:
                    fresh = await client.get_dataset_freshness(ws, ds)
                except PowerBIError:
                    return ""
                return str((fresh or {}).get("refreshId") or (fresh or {}).get("refreshedAt") or "")

            async def one(ws: str, ds: str, meta: dict[str, Any]) -> None:
                async with sem:
                    if (sdir / "STOP").exists():
                        # Drain: models already in progress finish; no new model starts.
                        results.append({"dataset_id": ds.lower(), "status": "not_started", "changed": 0, "points": 0})
                        return
                    marker = await refresh_marker(ws, ds)
                    known = state["datasets"].get(ds.lower()) or {}
                    # Incremental: a model that has not been refreshed since it was indexed is skipped
                    # (one REST call instead of a full XMLA schema read). --full and --dataset always read it.
                    if not full and not dataset and marker and known and known.get("refresh") == marker:
                        results.append({"dataset_id": ds.lower(), "status": "fresh", "changed": 0, "points": 0})
                        return
                    try:
                        res = await index_model(
                            settings=settings,
                            client=client,
                            llm=llm,
                            embedder=embedder,
                            store=store,
                            state=state,
                            workspace_id=ws,
                            dataset_id=ds,
                            report_ids=meta["report_ids"],
                            name=meta["name"],
                            full=full,
                            dry_run=dry_run,
                        )
                    except Exception as exc:  # noqa: BLE001 - one model must not stop the run
                        res = {"dataset_id": ds.lower(), "status": "error", "error": type(exc).__name__}
                        log(logger, logging.WARNING, "keyword_index_model_failed", dataset_id=ds, error=type(exc).__name__)
                    if res["status"] in ("indexed", "values_updated", "unchanged") and ds.lower() in state["datasets"]:
                        state["datasets"][ds.lower()]["refresh"] = marker
                    results.append(res)
                    if not dry_run:
                        save_state(state_path, state)  # resume point after every model

            await asyncio.gather(*(one(ws, ds, meta) for ws, ds, meta in targets))
        finally:
            await client.aclose()
            if store is not None:
                await store.aclose()
        if not dry_run:
            state["last_success_at"] = datetime.now(timezone.utc).isoformat()
            state["last_run"] = {"mode": "full" if full else "incremental", "models": len(results)}
            save_state(state_path, state)
    counts: dict[str, int] = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    summary = {
        "status": "ok",
        "mode": "full" if full else "incremental",
        "models": len(results),
        "by_status": counts,
        "objects_changed": sum(r.get("changed", 0) for r in results),
        "points_written": sum(r.get("points", 0) for r in results),
        "removed_datasets": len(removed),
        "failed": [r["dataset_id"] for r in results if r["status"] in ("error", "unreadable")],
    }
    log(logger, logging.INFO, "keyword_index_done", **{k: v for k, v in summary.items() if k not in ("failed", "by_status")})
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build or refresh the keyword index (measure synonyms -> Qdrant).")
    parser.add_argument("--full", action="store_true", help="rebuild every object (default: incremental)")
    parser.add_argument("--dataset", help="index one dataset id")
    parser.add_argument("--dry-run", action="store_true", help="read and enrich, store nothing")
    args = parser.parse_args(argv)
    configure_logging("pbi_keyword_index", get_settings().log_level)
    try:
        summary = asyncio.run(run(dataset=args.dataset, dry_run=args.dry_run, full=args.full))
    except KeywordIndexError as exc:
        print(json.dumps({"status": "error", "message": str(exc)}), file=sys.stderr)
        return 1
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
