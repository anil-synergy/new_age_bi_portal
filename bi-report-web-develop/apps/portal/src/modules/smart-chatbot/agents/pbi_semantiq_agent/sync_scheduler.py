"""Background metadata refresh, started from an ASGI lifespan (the old loop never started).

Use ``async with background_sync():`` inside the app's lifespan. The first run is delayed by
``METADATA_SYNC_STARTUP_DELAY_S`` so the server is ready first; later runs repeat every
``METADATA_SYNC_INTERVAL_S`` (0 disables). ``run_sync`` is serialised by its own lock, so a manual
admin sync and the timer can never overlap.
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from smart_common.logging import log

from .settings import get_settings
from .sync_runner import run_sync

logger = logging.getLogger(__name__)


async def _loop(interval_s: int, first_delay_s: float) -> None:
    await asyncio.sleep(first_delay_s)
    while True:
        try:
            result = await run_sync("incremental")
            log(
                logger,
                logging.INFO,
                "metadata_sync_background_done",
                reports=result.get("reports_extracted"),
                models=result.get("models_extracted"),
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - never let the timer die
            log(logger, logging.WARNING, "metadata_sync_background_failed", error=type(exc).__name__, message=str(exc)[:200])
        await asyncio.sleep(interval_s)


@asynccontextmanager
async def background_sync():
    settings = get_settings()
    interval = settings.metadata_sync_interval_s
    # Only sync when there is something to sync with; avoids noisy failures in unconfigured dev setups.
    if interval <= 0 or not settings.pbi_configured:
        yield
        return
    delay = float(os.environ.get("METADATA_SYNC_STARTUP_DELAY_S", "60") or 60)
    task = asyncio.create_task(_loop(interval, delay), name="semantiq-metadata-sync")
    log(logger, logging.INFO, "metadata_sync_scheduled", interval_s=interval, first_run_in_s=delay)
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
