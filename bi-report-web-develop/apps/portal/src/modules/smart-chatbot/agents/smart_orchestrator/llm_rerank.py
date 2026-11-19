"""LLM reasoning between rerank and decision.

The deterministic retriever (environment filter -> hybrid search -> rerank) produces ``Decision.ranked``:
candidates that are authorised, environment-eligible and relevant. This step lets the LLM read the
question next to each candidate's title, menu path, description and schema and pick the best one.

Guardrails (the LLM can only *narrow*, never widen):
* it chooses only from ``decision.ranked`` - keys it invents are ignored;
* it is skipped when the deterministic result is already certain (plain model, requested environment,
  open report, or a very confident match);
* any failure, timeout, invalid key or low confidence falls back to the deterministic decision.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import replace
from typing import Any

from pydantic import BaseModel, Field

from smart_common.llm import LLMClient, LLMUnavailable
from smart_common.logging import log

from .ranking import Candidate, Decision
from .settings import OrchestratorSettings

logger = logging.getLogger(__name__)

# Deterministic outcomes that never need a second opinion.
SKIP_REASONS = frozenset({"plain_model", "requested_environment", "open_report", "several_requested_versions", "only_nonprod", "no_match", "vessel_register"})


class RerankChoice(BaseModel):
    chosen_key: str | None = None
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    rationale: str = ""
    runner_up_keys: list[str] = Field(default_factory=list)
    needs_user_choice: bool = False


def should_rerank(decision: Decision, settings: OrchestratorSettings, llm: LLMClient) -> bool:
    if not settings.llm_rerank_enabled or not llm.configured:
        return False
    if decision.reason in SKIP_REASONS or len(decision.ranked) < 1:
        return False
    if decision.action == "select" and len(decision.ranked) == 1 and decision.reason != "weak_match":
        return False  # nothing to choose between
    if decision.action == "select" and decision.reason == "confident_match" and decision.confidence >= settings.llm_rerank_skip_score:
        return False
    return True


def _candidate_block(index: int, c: Candidate, schema_text: str) -> str:
    item = c.item
    desc = str(item.get("description") or "").strip().replace("\n", " ")[:220]
    lines = [
        f"[{index}] key={c.key}",
        f"    title: {c.title}",
        f"    menu: {str(item.get('menu_path') or item.get('category_name') or '-')[:120]}",
        f"    workspace: {str(item.get('workspace_name') or '-')[:60]}  source: {item.get('source') or 'workspace'}",
    ]
    if desc:
        lines.append(f"    description: {desc}")
    if schema_text:
        lines.append(f"    schema: {schema_text[:420]}")
    lines.append(
        f"    scores: overall={c.score:.2f} vector={c.vector:.2f} keyword={c.bm25_norm:.2f} title={c.title_f1:.2f} menu={c.menu:.2f}"
    )
    return "\n".join(lines)


def build_prompt(question: str, history: list[dict[str, str]], decision: Decision, schema_for) -> str:
    turns = "\n".join(f"{t['role']}: {t['content'][:240]}" for t in history[-4:]) or "(none)"
    blocks = "\n".join(_candidate_block(i, c, schema_for(c.key)) for i, c in enumerate(decision.ranked, 1))
    return f"QUESTION: {question}\n\nRECENT CONVERSATION:\n{turns}\n\nCANDIDATES:\n{blocks}"


def apply_choice(decision: Decision, choice: RerankChoice, settings: OrchestratorSettings) -> tuple[Decision, str]:
    """Return ``(decision, outcome)``. The decision is unchanged unless the choice is valid and confident."""
    by_key = {c.key: c for c in decision.ranked}
    chosen = by_key.get(choice.chosen_key or "")
    if choice.chosen_key and chosen is None:
        return decision, "invalid_key"
    if choice.needs_user_choice:
        picks = [chosen] if chosen else []
        picks += [by_key[k] for k in choice.runner_up_keys if k in by_key and by_key[k] is not chosen]
        picks = list({c.key: c for c in picks}.values())
        if len(picks) >= 2 and decision.action != "select":
            return replace(decision, action="ask", reason="llm_ambiguous", options=picks[: max(2, settings.retrieval_max_options)]), "ask"
        return decision, "needs_user_choice_kept"
    if chosen is None or choice.confidence < settings.llm_rerank_min_confidence:
        return decision, "low_confidence"
    ups = [by_key[k] for k in choice.runner_up_keys if k in by_key and by_key[k] is not chosen][:2]
    skip = {chosen.key, *(c.key for c in ups)}
    rest = [c for c in decision.ranked if c.key not in skip]
    changed = decision.selected is None or decision.selected.key != chosen.key
    new = replace(
        decision,
        action="select",
        reason="llm_rerank",
        selected=chosen,
        retry=ups,
        options=[],
        alternatives=(rest + [c for c in decision.alternatives if c.key not in by_key])[: max(2, settings.retrieval_max_options)],
        confidence=max(choice.confidence, decision.confidence if not changed else 0.0),
    )
    return new, "changed" if changed else "confirmed"


async def llm_rerank(
    llm: LLMClient,
    settings: OrchestratorSettings,
    system_prompt: str,
    question: str,
    history: list[dict[str, str]],
    decision: Decision,
    schema_for,
) -> Decision:
    """Run the reasoning step; always returns a usable decision (the input one on any problem)."""
    if not should_rerank(decision, settings, llm):
        return decision
    started = time.perf_counter()
    prompt = build_prompt(question, history, decision, schema_for)
    try:
        choice = await asyncio.wait_for(
            llm.complete_json(system_prompt, prompt, RerankChoice, max_tokens=settings.llm_rerank_max_tokens),
            timeout=settings.llm_rerank_timeout_s,
        )
    except (LLMUnavailable, asyncio.TimeoutError) as exc:
        decision.llm = {"outcome": "unavailable", "error": type(exc).__name__}
        log(logger, logging.WARNING, "llm_rerank_unavailable", error=type(exc).__name__)
        return decision
    new, outcome = apply_choice(decision, choice, settings)
    new.llm = {
        "outcome": outcome,
        "confidence": round(choice.confidence, 2),
        "rationale": choice.rationale[:240],
        "from": decision.selected.title[:60] if decision.selected else None,
        "ms": round((time.perf_counter() - started) * 1000, 1),
    }
    log(logger, logging.INFO, "llm_rerank", outcome=outcome, confidence=round(choice.confidence, 2), deterministic=decision.reason)
    return new
