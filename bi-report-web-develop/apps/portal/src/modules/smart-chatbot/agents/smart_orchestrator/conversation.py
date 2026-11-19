"""Pending workflows across turns.

When SMART asks the user something (which model? monthly or vessel-wise?) it saves a
pending workflow in the conversation checkpoint: the original question, the intent, the
chosen model and context, the options offered and how many times it has asked. The next
reply is matched against it before normal intent detection:

- choose_model: an ordinal ("2", "second"), an option title, or "use <title>";
- clarify_query: an option, or a short reply that answers the question ("Monthly").

A reply that matches nothing is treated as a new question and the pending workflow is
dropped. Workflows expire after ``pending_ttl_s``.
"""

from __future__ import annotations

import re
import time
from typing import Any, Literal, TypedDict

from .environment import name_tokens
from .query_norm import STOP, content_tokens, normalize_report_label

_ORDINALS = {
    "first": 1, "1st": 1, "one": 1, "second": 2, "2nd": 2, "two": 2, "third": 3, "3rd": 3, "three": 3,
    "fourth": 4, "4th": 4, "four": 4, "fifth": 5, "5th": 5, "five": 5, "last": -1,
}
_USE = re.compile(r"^\s*(?:please\s+)?(?:use|pick|choose|select|take|go with|try|query)\s+(?:the\s+)?(.+?)\s*(?:one|model|report)?\s*[.!]?\s*$", re.I)
_QUESTION_START = re.compile(r"^\s*(how|what|which|who|when|where|why|show|list|give|get|tell|compare|top|is|are|can|could|do|does)\b", re.I)
_NEGATIVE = re.compile(r"^\s*(no|nope|cancel|stop|never ?mind|forget it)\b", re.I)


class Pending(TypedDict, total=False):
    kind: Literal["choose_model", "clarify_query"]
    question: str
    intent: dict[str, Any]
    options: list[dict[str, Any]]
    dataset: dict[str, Any] | None
    context: dict[str, Any]
    asked: int
    created: float
    prompt: str
    request_id: str


def new_pending(kind: str, *, question: str, intent: dict[str, Any], options: list[dict[str, Any]], dataset: dict[str, Any] | None, context: dict[str, Any], asked: int, prompt: str) -> Pending:
    return Pending(
        kind=kind,  # type: ignore[typeddict-item]
        question=question,
        intent=intent,
        options=options,
        dataset=dataset,
        context=context,
        asked=asked,
        created=time.time(),
        prompt=prompt,
    )


def expired(pending: Pending | None, ttl_s: float) -> bool:
    return not pending or (time.time() - float(pending.get("created") or 0)) > ttl_s


def cancelled(reply: str) -> bool:
    return bool(_NEGATIVE.match(reply or ""))


def _label(option: dict[str, Any] | str) -> str:
    return str(option.get("title") or option.get("label") or "") if isinstance(option, dict) else str(option)


def match_option(reply: str, options: list[dict[str, Any] | str]) -> int | None:
    """Index of the option the reply picks, or None."""
    if not options:
        return None
    text = (reply or "").strip()
    lowered = text.lower().strip(" .!?")
    used = _USE.match(text)
    target = used.group(1).strip() if used else text
    target_lower = target.lower().strip(" .!?\"'")

    words = [w for w in re.findall(r"[a-z0-9]+", lowered) if w not in STOP and w not in ("option", "number", "the", "one", "model", "report", "please")]
    if len(words) == 1 and (words[0].isdigit() or words[0] in _ORDINALS):
        n = int(words[0]) if words[0].isdigit() else _ORDINALS[words[0]]
        index = len(options) - 1 if n == -1 else n - 1
        return index if 0 <= index < len(options) else None

    for i, option in enumerate(options):
        label = normalize_report_label(_label(option))
        target_norm = normalize_report_label(target_lower)
        if label and target_norm in (label, re.sub(r"\s*\(.*\)$", "", label)):
            return i
        if label and target_norm and (target_norm in label or label in target_norm):
            return i

    reply_tokens = set(name_tokens(target))
    if not reply_tokens:
        return None
    scored: list[tuple[float, int]] = []
    for i, option in enumerate(options):
        tokens = set(name_tokens(_label(option)))
        if not tokens:
            continue
        overlap = len(reply_tokens & tokens)
        if not overlap:
            continue
        precision = overlap / len(reply_tokens)
        recall = overlap / len(tokens)
        scored.append((2 * precision * recall / (precision + recall), i))
    scored.sort(reverse=True)
    if not scored or scored[0][0] < 0.6:
        return None
    if len(scored) > 1 and scored[1][0] == scored[0][0]:
        return None
    return scored[0][1]


def looks_like_answer(reply: str, *, max_words: int = 6) -> bool:
    """A short reply such as "Monthly" or "vessel wise, last year" answers a clarification."""
    text = (reply or "").strip()
    if not text or cancelled(text) or text.endswith("?"):
        return False
    if _QUESTION_START.match(text) and len(content_tokens(text, drop_time=False)) > 2:
        return False
    return len(re.findall(r"[A-Za-z0-9]+", text)) <= max_words


def merge_reply(question: str, reply: str) -> str:
    """Heuristic merge when no LLM is available: the original question plus the answer."""
    reply = reply.strip().rstrip(".!")
    if reply.lower() in question.lower():
        return question
    return f"{question.rstrip('?.! ')} ({reply})"
