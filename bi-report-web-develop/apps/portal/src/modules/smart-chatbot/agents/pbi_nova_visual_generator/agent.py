"""N.O.V.A. visual generation: deterministic recommendation, optional LLM choice among valid kinds."""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from smart_common.llm import LLMClient, LLMUnavailable
from smart_common.logging import log

from .settings import NovaSettings
from .visual_spec import VisualSpec, asks_pie, build_spec, buildable, profile, recommend

logger = logging.getLogger(__name__)


@lru_cache
def _prompt() -> str:
    return (Path(__file__).parent / "prompts" / "nova_system.md").read_text(encoding="utf-8")


class VisualChoice(BaseModel):
    kind: str
    title: str = ""
    rationale: str = ""


class NovaAgent:
    def __init__(self, settings: NovaSettings, llm: LLMClient):
        self.settings = settings
        self.llm = llm

    async def generate(
        self,
        question: str,
        columns: list[str],
        rows: list[dict[str, Any]],
        *,
        preferred: str | None = None,
        title: str | None = None,
        column_meta: list[dict[str, Any]] | None = None,
        result_description: str | None = None,
        intent: str | None = None,
    ) -> VisualSpec:
        """``column_meta`` / ``result_description`` / ``intent`` come from SemantIQ and SMART; all optional.

        Values are still copied from ``rows``; the extra context only improves role detection, labels,
        KPI formatting and the LLM's choice among the already-valid kinds.
        """
        allowed, x, ys = recommend(question, columns, rows, column_meta)
        kind = allowed[0]
        chosen_title = title or _default_title(ys, x)
        rationale = "Selected by data-shape rules."
        allow_pie_on_date = preferred == "pie" or asks_pie(question)

        if preferred and buildable(
            preferred, columns, rows, x, ys, question=question, allow_pie_on_date=allow_pie_on_date
        ):
            kind = preferred
            rationale = "Requested visual type."
        elif len(allowed) > 1 and self.llm.configured:
            try:
                choice = await self.llm.complete_json(
                    _prompt(),
                    self._llm_input(question, columns, rows, allowed, column_meta, result_description, intent),
                    VisualChoice,
                )
                if choice.kind in allowed:
                    kind = choice.kind
                    rationale = choice.rationale or rationale
                if choice.title and not title:
                    chosen_title = choice.title[:60]
            except LLMUnavailable as exc:
                log(logger, logging.WARNING, "nova_llm_fallback", error=str(exc)[:200])

        return build_spec(
            kind,
            columns,
            rows,
            x,
            ys,
            title=chosen_title,
            max_points=self.settings.nova_max_points,
            rationale=rationale,
            meta=column_meta,
        )

    @staticmethod
    def _llm_input(
        question: str,
        columns: list[str],
        rows: list[dict[str, Any]],
        allowed: list[str],
        column_meta: list[dict[str, Any]] | None = None,
        result_description: str | None = None,
        intent: str | None = None,
    ) -> str:
        roles = [p.model_dump() for p in profile(columns, rows, column_meta)]
        parts = [f"QUESTION:\n{question}", f"COLUMNS:\n{json.dumps(roles)}"]
        if column_meta:
            slim = [{k: m[k] for k in ("name", "role", "unit", "folder") if m.get(k)} for m in column_meta]
            parts.append(f"MODEL_COLUMN_MEANING:\n{json.dumps(slim)}")
        if result_description:
            parts.append(f"RESULT_DESCRIPTION:\n{result_description[:300]}")
        if intent:
            parts.append(f"ANALYSIS_INTENT:\n{intent[:200]}")
        parts += [f"SAMPLE_ROWS:\n{json.dumps(rows[:5], default=str)}", f"ALLOWED:\n{json.dumps(allowed)}"]
        return "\n\n".join(parts)


def _default_title(ys: list[str], x: str | None) -> str:
    if not ys:
        return "Result"
    measure = " & ".join(ys[:2])
    return f"{measure} by {x}" if x else measure
