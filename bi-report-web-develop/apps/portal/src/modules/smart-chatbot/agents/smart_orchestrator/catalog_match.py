"""Match a user question to a portal menu report (title + category path).

Used by the open-report flow. Data questions use the hybrid pipeline in ranking.py.
"""

from __future__ import annotations

import re
from typing import Any

from smart_common.keywords import stem

from .query_norm import normalize_report_label

_WORD = re.compile(r"[a-z0-9]+", re.I)
_SECONDARY = frozenset(
    {"draft", "test", "secondary", "backup", "copy", "archive", "sample", "sandbox", "temp", "tmp", "old", "uat", "dev"}
)
_TIME_WORDS = frozenset(
    {
        "today",
        "yesterday",
        "tomorrow",
        "day",
        "date",
        "week",
        "month",
        "year",
        "quarter",
        "ytd",
        "mtd",
        "qtd",
        "last",
        "this",
        "next",
        "jan",
        "january",
        "feb",
        "february",
        "mar",
        "march",
        "apr",
        "april",
        "may",
        "jun",
        "june",
        "jul",
        "july",
        "aug",
        "august",
        "sep",
        "sept",
        "september",
        "oct",
        "october",
        "nov",
        "november",
        "dec",
        "december",
    }
)
_ORDINAL = re.compile(r"^\d+(st|nd|rd|th)?$")
_STOP = frozenset(
    {
        "a",
        "an",
        "the",
        "and",
        "or",
        "for",
        "to",
        "of",
        "in",
        "on",
        "me",
        "my",
        "give",
        "show",
        "get",
        "what",
        "how",
        "many",
        "much",
        "count",
        "total",
        "number",
        "please",
        "report",
        "data",
        "is",
        "are",
        "was",
        "were",
        "there",
        "any",
        "do",
        "does",
        "did",
        "can",
        "you",
        "have",
        "has",
    }
)


def _tokens(text: str) -> set[str]:
    words = {w.lower() for w in _WORD.findall(text or "") if w.lower() not in _STOP and len(w) > 1}
    return words | {stem(w) for w in words}


def _topic_tokens(tokens: set[str]) -> set[str]:
    """Drop dates and periods so 'oct 12th 2026' cannot select an unrelated model."""
    kept = {token for token in tokens if token not in _TIME_WORDS and not _ORDINAL.fullmatch(token)}
    return kept or tokens


def is_secondary_title(title: str, question: str = "") -> bool:
    """Draft, test, archive and similar names are fallbacks unless the user asked for one."""
    markers = _tokens(title) & _SECONDARY
    if not markers:
        return False
    return not bool(markers & _tokens(question))


def _rank_key(question: set[str], score: float, item: dict[str, Any]) -> tuple[int, float]:
    secondary = 1 if is_secondary_title(str(item.get("title") or ""), " ".join(question)) else 0
    return (secondary, -score)


def _score_report(question: set[str], report: dict[str, Any]) -> float:
    title = normalize_report_label(str(report.get("title") or ""))
    path = normalize_report_label(str(report.get("menu_path") or report.get("category_name") or ""))
    blob = f"{title} {path}"
    title_tokens = _tokens(title)
    path_tokens = _tokens(path)
    question = _topic_tokens(question)
    overlap = question & title_tokens
    score = len(overlap) * 2.0 + len(question & path_tokens) * 1.5
    for q in question:
        if len(q) > 3 and q in blob:
            score += 1.0
    # Strong hint when the question topic appears in the menu path (e.g. "incidents" under Safety Reporting).
    if question & path_tokens:
        score += 2.0
    # A model named only "Injury" beats a longer name such as "INJURY_REPORT_DRAFT".
    if title_tokens and title_tokens <= question:
        score += 1.5
    return score


def pick_report(
    question: str,
    catalog: list[dict[str, Any]],
    *,
    min_score: float = 2.0,
    prefer_best: bool = False,
) -> dict[str, Any] | None:
    """Return the best catalog entry the user may access.

    prefer_best keeps the highest score even when a second report is close, so a data
    question is answered from the menu instead of asking the user to open a report.
    """
    if not catalog:
        return None
    q = _tokens(question)
    if not q:
        return None
    scored: list[tuple[float, dict[str, Any]]] = []
    for item in catalog:
        ws = item.get("workspace_id")
        if not ws or not (item.get("report_id") or item.get("dataset_id")):
            continue
        s = _score_report(q, item)
        if s >= min_score:
            scored.append((s, item))
    if not scored:
        return None
    scored.sort(key=lambda pair: _rank_key(q, pair[0], pair[1]))
    best, second = scored[0][0], scored[1][0] if len(scored) > 1 else 0.0
    if not prefer_best and len(scored) > 1 and best < second + 1.5:
        return None
    return scored[0][1]


def _retrieval_score(topic: set[str], title_tokens: set[str]) -> float:
    """BM25 + token F1 + cosine. Titles are short, so each term is present once or not at all."""
    if not topic or not title_tokens:
        return 0.0
    overlap = topic & title_tokens
    if not overlap:
        return 0.0
    precision = len(overlap) / len(title_tokens)
    recall = len(overlap) / len(topic)
    f1 = 0.0 if precision + recall == 0 else (2 * precision * recall) / (precision + recall)
    cosine = len(overlap) / ((len(topic) ** 0.5) * (len(title_tokens) ** 0.5))
    avgdl = max(len(title_tokens), 1)
    bm25 = 0.0
    k1, b = 1.2, 0.75
    for term in topic:
        tf = 1.0 if term in title_tokens else 0.0
        bm25 += (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * len(title_tokens) / avgdl))
    bm25 /= len(topic)
    return (0.5 * bm25) + (0.3 * cosine) + (0.2 * f1)


def _partition(question: str, catalog: list[dict[str, Any]], *, min_score: float) -> dict[str, Any]:
    q = _tokens(question)
    topic = _topic_tokens(q)
    empty: dict[str, Any] = {"subject": set(), "asked": set(), "plain": [], "named": [], "rest": [], "secondary": []}
    if not catalog or not q or not topic:
        return empty
    best_by_key: dict[str, tuple[float, dict[str, Any]]] = {}
    for item in catalog:
        ws = item.get("workspace_id")
        if not ws or not (item.get("report_id") or item.get("dataset_id")):
            continue
        if _score_report(q, item) < min_score and not (_tokens(str(item.get("title") or "")) <= topic):
            continue
        title_tokens = _tokens(str(item.get("title") or ""))
        score = _retrieval_score(topic, title_tokens)
        if score <= 0 and not (title_tokens and title_tokens <= topic):
            continue
        key = f"{str(ws).lower()}|{str(item.get('dataset_id') or item.get('report_id')).lower()}"
        previous = best_by_key.get(key)
        if previous is None or score > previous[0]:
            best_by_key[key] = (score, item)
    subject = {token for token in topic if token not in _SECONDARY} or set(topic)
    asked = topic & _SECONDARY
    plain: list[tuple[float, dict[str, Any]]] = []
    named: list[tuple[float, dict[str, Any]]] = []
    rest: list[tuple[float, dict[str, Any]]] = []
    secondary_hits: list[tuple[float, dict[str, Any]]] = []
    for score, item in best_by_key.values():
        title_tokens = _tokens(str(item.get("title") or ""))
        secondary = bool(title_tokens & _SECONDARY)
        if asked and asked <= title_tokens and bool(subject & title_tokens):
            named.append((score, item))
            continue
        if secondary:
            if subject & title_tokens:
                secondary_hits.append((score, item))
            continue
        if title_tokens and title_tokens <= subject:
            plain.append((score, item))
        elif topic & title_tokens:
            rest.append((score, item))
    return {"subject": subject, "asked": asked, "plain": plain, "named": named, "rest": rest, "secondary": secondary_hits}


def _plain_choice(subject: set[str], plain: list[tuple[float, dict[str, Any]]], top_k: int) -> list[dict[str, Any]]:
    def coverage(item: dict[str, Any]) -> int:
        return len(_tokens(str(item.get("title") or "")) & subject)

    plain.sort(key=lambda pair: (-coverage(pair[1]), len(str(pair[1].get("title") or ""))))
    best = coverage(plain[0][1])
    tied = [item for _, item in plain if coverage(item) == best]
    shortest = min(len(str(item.get("title") or "")) for item in tied)
    chosen = [item for item in tied if len(str(item.get("title") or "")) == shortest]
    if len(chosen) == 1:
        return chosen
    return chosen[:top_k]


def rank_reports(question: str, catalog: list[dict[str, Any]], *, min_score: float = 2.0, top_k: int = 3) -> list[dict[str, Any]]:
    """Plain model first. Other models with the same word are used only when the user names them.

    min_score keeps the older overlap gate for weak titles. Ranking among the survivors uses
    BM25, token F1 and cosine similarity.
    """
    groups = _partition(question, catalog, min_score=min_score)
    named: list[tuple[float, dict[str, Any]]] = groups["named"]
    plain: list[tuple[float, dict[str, Any]]] = groups["plain"]
    rest: list[tuple[float, dict[str, Any]]] = groups["rest"]
    if groups["asked"] and named:
        named.sort(key=lambda pair: -pair[0])
        return [item for _, item in named[:top_k]]
    if plain:
        return _plain_choice(groups["subject"], plain, top_k)
    rest.sort(key=lambda pair: -pair[0])
    return [item for _, item in rest[:top_k]]
