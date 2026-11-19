"""ModelMetadataIndexer schedules all datasets when max_models is 0."""

from __future__ import annotations

import pytest

from smart_orchestrator.environment import PROD, Classification
from smart_orchestrator.ingestion import ModelMetadataIndexer


class _Agents:
    async def call(self, *_args, **_kwargs):
        return {"status": "ok", "schema": {"tables": []}}


class _Policy:
    def classify_item(self, _item):
        return Classification(environment=PROD)


@pytest.mark.asyncio
async def test_indexer_max_models_zero_schedules_all_unique_datasets():
    items = [
        {"workspace_id": "w1", "dataset_id": f"d{i}", "title": f"M{i}"}
        for i in range(5)
    ]
    indexer = ModelMetadataIndexer(_Agents(), enabled=True, concurrency=2, max_models=0, ttl_s=3600.0)
    scheduled: list[dict] = []

    async def stub_run(todo, on_change):
        scheduled.extend(todo)

    indexer._run = stub_run  # type: ignore[method-assign]
    indexer.schedule(items, policy=_Policy(), on_change=lambda _k: None)
    if indexer._task is not None:
        await indexer._task
    assert len(scheduled) == 5


@pytest.mark.asyncio
async def test_indexer_max_models_positive_caps_batch():
    items = [{"workspace_id": "w1", "dataset_id": f"d{i}", "title": f"M{i}"} for i in range(10)]
    indexer = ModelMetadataIndexer(_Agents(), enabled=True, concurrency=2, max_models=3, ttl_s=3600.0)
    scheduled: list[dict] = []

    async def stub_run(todo, on_change):
        scheduled.extend(todo)

    indexer._run = stub_run  # type: ignore[method-assign]
    indexer.schedule(items, policy=_Policy(), on_change=lambda _k: None)
    if indexer._task is not None:
        await indexer._task
    assert len(scheduled) == 3
