"""Question normalization shared by retrieval, the semantic cache and analytics.

- ``content_tokens``: stemmed words without stop words, so "injuries" and "injury" match.
- ``Glossary``: reviewed business synonyms (glossary.json). Questions gain canonical terms and
  indexed documents gain synonyms, so "LTI count" reaches a model named "Injury".
- ``QuerySignature``: the parts of a question that change the numbers (resolved dates, numbers,
  grouping, filter words). Two questions may share a cached result only when signatures are equal.
"""

from __future__ import annotations

import calendar
import json
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any

from smart_common.keywords import stem

_WORD = re.compile(r"[a-z0-9]+")
_REPORT_LABEL = re.compile(r"[^a-z0-9]+")
STOP = frozenset(
    {
        "a", "an", "the", "and", "or", "for", "to", "of", "in", "on", "at", "me", "my", "i", "we", "our", "us",
        "give", "show", "get", "tell", "list", "display", "what", "whats", "how", "please", "is", "are", "was",
        "were", "be", "there", "any", "do", "does", "did", "can", "could", "would", "you", "u", "have", "has",
        "it", "this", "that", "these", "those", "with", "from", "about", "much", "many", "which", "who",
        "kindly", "pls", "plz", "want", "need", "know", "see", "find", "let", "lets", "by", "per", "vs", "versus",
        "wise", "each", "ur", "also", "only", "just", "now", "then", "than", "so", "if", "as", "into", "over",
    }
)
_ANALYTIC = (
    "count", "counts", "total", "totals", "number", "numbers", "sum", "no", "figure", "figures", "value", "values",
    "amount", "overall", "all", "trend", "trends", "compare", "comparison", "top", "bottom", "breakdown",
    "average", "avg", "split", "distribution", "summary", "summarise", "summarize", "chart", "graph", "plot",
    "visual", "table", "highest", "lowest", "most", "least", "max", "min", "maximum", "minimum",
)
AGGREGATE_WORDS = frozenset(stem(w) for w in _ANALYTIC)
# Words that do not change the figure asked for; everything else stays in the cache signature,
# so "highest" and "lowest", or "chart" and "table", never share a cached answer.
SIGNATURE_NEUTRAL = frozenset(stem(w) for w in ("count", "total", "number", "numbers", "no", "figure", "figures", "value", "amount", "overall"))
GENERIC_TITLE_WORDS = frozenset(
    {"report", "reports", "dashboard", "dashboards", "model", "models", "dataset", "datasets", "semantic", "data", "pbi", "powerbi", "bi"}
)
MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4, "may": 5,
    "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}
TIME_WORDS = frozenset(
    set(MONTHS)
    | {
        "today", "yesterday", "tomorrow", "day", "days", "date", "dates", "week", "weeks", "month", "months",
        "year", "years", "quarter", "quarters", "ytd", "mtd", "qtd", "last", "this", "next", "past", "previous",
        "since", "between", "till", "until", "from", "to", "current", "daily", "weekly", "monthly", "quarterly",
        "yearly", "annual", "annually",
    }
)
_ORDINAL = re.compile(r"^\d+(st|nd|rd|th)$")
_GRAIN = {"daily": "day", "weekly": "week", "monthly": "month", "quarterly": "quarter", "yearly": "year", "annual": "year", "annually": "year"}
_GROUP_LEAD = frozenset({"by", "per", "each", "wise", "breakdown", "across"})


def words(text: str | None) -> list[str]:
    return _WORD.findall((text or "").lower())


def normalize_report_label(text: str | None) -> str:
    """Lowercase report/menu label with punctuation removed (Fleet-Count VP -> fleet count vp)."""
    return " ".join(_REPORT_LABEL.sub(" ", (text or "").lower()).split())


def normalized_title_tokens(text: str | None) -> set[str]:
    return {stem(w) for w in normalize_report_label(text).split() if len(w) > 1 and w not in GENERIC_TITLE_WORDS}


def content_tokens(text: str | None, *, drop_time: bool = True, drop_generic: bool = False) -> list[str]:
    out: list[str] = []
    for word in words(text):
        if word in STOP or len(word) < 2:
            continue
        if drop_time and (word in TIME_WORDS or word.isdigit() or _ORDINAL.match(word)):
            continue
        if drop_generic and word in GENERIC_TITLE_WORDS:
            continue
        out.append(stem(word))
    return out


# ------------------------------------------------------------------ glossary
@dataclass(frozen=True)
class GlossaryTerm:
    term: str
    synonyms: tuple[str, ...]
    domain: str = ""


@dataclass
class Glossary:
    terms: list[GlossaryTerm] = field(default_factory=list)
    version: str = "0"

    def __post_init__(self) -> None:
        self._phrases: list[tuple[tuple[str, ...], GlossaryTerm]] = []
        for term in self.terms:
            for phrase in (term.term, *term.synonyms):
                tokens = tuple(content_tokens(phrase, drop_time=False))
                if tokens:
                    self._phrases.append((tokens, term))
        self._phrases.sort(key=lambda pair: -len(pair[0]))
        self._vocab = {token for phrase, _ in self._phrases for token in phrase}

    def _tokens(self, text: str | None) -> list[str]:
        # Plural abbreviations ("PRs", "WOs") are too short for the stemmer.
        return [
            t[:-1] if len(t) <= 4 and t.endswith("s") and t not in self._vocab and t[:-1] in self._vocab else t
            for t in content_tokens(text, drop_time=False)
        ]

    @classmethod
    def load(cls, path: str | Path | None) -> "Glossary":
        if not path:
            return cls()
        file = Path(path)
        if not file.is_file():
            return cls()
        data = json.loads(file.read_text(encoding="utf-8"))
        terms = [
            GlossaryTerm(str(t["term"]), tuple(str(s) for s in t.get("synonyms", [])), str(t.get("domain", "")))
            for t in data.get("terms", [])
            if isinstance(t, dict) and t.get("term")
        ]
        return cls(terms, str(data.get("version", "0")))

    def matches(self, text: str | None) -> list[GlossaryTerm]:
        tokens = self._tokens(text)
        found: list[GlossaryTerm] = []
        for phrase, term in self._phrases:
            size = len(phrase)
            if any(tuple(tokens[i : i + size]) == phrase for i in range(0, len(tokens) - size + 1)) and term not in found:
                found.append(term)
        return found

    def canonical_tokens(self, text: str | None) -> set[str]:
        """Canonical terms named in the text, by the term itself or a synonym."""
        return {t for term in self.matches(text) for t in content_tokens(term.term, drop_time=False)}

    def expansion_text(self, text: str | None) -> str:
        """Canonical terms and synonyms, appended to indexed documents."""
        parts: list[str] = []
        for term in self.matches(text):
            parts.append(term.term)
            parts.extend(term.synonyms)
        return " ".join(parts)


@lru_cache(maxsize=4)
def load_glossary(path: str) -> Glossary:
    return Glossary.load(path)


def default_glossary_path() -> Path:
    return Path(__file__).resolve().parent / "knowledge" / "glossary.json"


def subject_tokens(question: str, glossary: Glossary | None = None) -> set[str]:
    """What the question is about: content words, no dates, no generic report words, plus canonical terms."""
    tokens = {t for t in content_tokens(question, drop_generic=True) if t not in AGGREGATE_WORDS}
    if glossary is not None:
        tokens |= glossary.canonical_tokens(question)
    return tokens


# ------------------------------------------------------------------ dates and signature
_ISO = re.compile(r"\b(20\d{2}|19\d{2})-(\d{1,2})-(\d{1,2})\b")
_DAY_MONTH = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\.?(?:,?\s+(\d{4}))?\b")
_MONTH_DAY = re.compile(r"\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b")
_MONTH_YEAR = re.compile(r"\b([a-z]{3,9})\.?,?\s+(\d{4})\b")
_RELATIVE = re.compile(r"\b(last|past|previous|next)\s+(\d+)?\s*(day|days|week|weeks|month|months|year|years|quarter|quarters)\b")
_THIS = re.compile(r"\b(this|current|last|previous)\s+(week|month|year|quarter)\b")
_YEAR = re.compile(r"\b(19\d{2}|20\d{2})\b")
_NUMBER = re.compile(r"\b\d+(?:\.\d+)?\b")


def _safe_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _month_window(year: int, month: int) -> tuple[date, date]:
    return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])


def _quarter_window(year: int, quarter: int) -> tuple[date, date]:
    start_month = 3 * (quarter - 1) + 1
    return date(year, start_month, 1), _month_window(year, start_month + 2)[1]


def time_parts(text: str, today: date) -> tuple[list[str], set[str]]:
    """Resolved dates and windows ('d:2026-10-12', 'w:2026-10-01..2026-10-31'), plus the matched spans."""
    lowered = (text or "").lower()
    parts: list[str] = []
    used: set[str] = set()
    pending_days: list[tuple[int, int]] = []

    for m in _ISO.finditer(lowered):
        d = _safe_date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if d:
            parts.append(f"d:{d.isoformat()}")
            used.add(m.group(0))
    for pattern, day_group, month_group in ((_DAY_MONTH, 1, 2), (_MONTH_DAY, 2, 1)):
        for m in pattern.finditer(lowered):
            month = MONTHS.get(m.group(month_group))
            if not month or m.group(0) in used:
                continue
            day = int(m.group(day_group))
            year = int(m.group(3)) if m.group(3) else None
            if year is None:
                pending_days.append((month, day))
                used.add(m.group(0))
                continue
            d = _safe_date(year, month, day)
            if d:
                parts.append(f"d:{d.isoformat()}")
                used.add(m.group(0))
                for p_month, p_day in pending_days:
                    pd = _safe_date(year, p_month, p_day)
                    if pd:
                        parts.append(f"d:{pd.isoformat()}")
                pending_days.clear()
    for p_month, p_day in pending_days:
        pd = _safe_date(today.year, p_month, p_day)
        if pd:
            parts.append(f"d:{pd.isoformat()}")
    if not any(p.startswith("d:") for p in parts):
        for m in _MONTH_YEAR.finditer(lowered):
            month = MONTHS.get(m.group(1))
            if month:
                start, end = _month_window(int(m.group(2)), month)
                parts.append(f"w:{start.isoformat()}..{end.isoformat()}")
                used.add(m.group(0))
    if re.search(r"\btoday\b", lowered):
        parts.append(f"d:{today.isoformat()}")
    if re.search(r"\byesterday\b", lowered):
        parts.append(f"d:{(today - timedelta(days=1)).isoformat()}")
    for m in _RELATIVE.finditer(lowered):
        n = int(m.group(2) or 1)
        unit = m.group(3).rstrip("s")
        days = {"day": 1, "week": 7, "month": 30, "quarter": 91, "year": 365}[unit] * n
        if m.group(1) == "next":
            parts.append(f"w:{today.isoformat()}..{(today + timedelta(days=days)).isoformat()}")
        else:
            parts.append(f"w:{(today - timedelta(days=days)).isoformat()}..{today.isoformat()}")
        used.add(m.group(0))
    for m in _THIS.finditer(lowered):
        if m.group(0) in used:
            continue
        previous = m.group(1) in ("last", "previous")
        unit = m.group(2)
        if unit == "month":
            year, month = today.year, today.month
            if previous:
                year, month = (year - 1, 12) if month == 1 else (year, month - 1)
            start, end = _month_window(year, month)
        elif unit == "year":
            year = today.year - (1 if previous else 0)
            start, end = date(year, 1, 1), date(year, 12, 31)
        elif unit == "quarter":
            quarter = (today.month - 1) // 3 + 1
            year = today.year
            if previous:
                year, quarter = (year - 1, 4) if quarter == 1 else (year, quarter - 1)
            start, end = _quarter_window(year, quarter)
        else:
            start = today - timedelta(days=today.weekday() + (7 if previous else 0))
            end = start + timedelta(days=6)
        parts.append(f"w:{start.isoformat()}..{end.isoformat()}")
    if re.search(r"\bytd\b|\byear to date\b", lowered):
        parts.append(f"w:{date(today.year, 1, 1).isoformat()}..{today.isoformat()}")
    if re.search(r"\bmtd\b|\bmonth to date\b", lowered):
        parts.append(f"w:{date(today.year, today.month, 1).isoformat()}..{today.isoformat()}")
    if not parts:
        for m in _YEAR.finditer(lowered):
            parts.append(f"y:{m.group(1)}")
    return sorted(set(parts)), used


_OPERATORS = {
    stem(w): op
    for w, op in (
        ("highest", "max"), ("max", "max"), ("maximum", "max"), ("most", "max"), ("top", "max"), ("largest", "max"), ("biggest", "max"),
        ("lowest", "min"), ("min", "min"), ("minimum", "min"), ("least", "min"), ("bottom", "min"), ("smallest", "min"),
        ("average", "avg"), ("avg", "avg"), ("mean", "avg"), ("median", "median"), ("percent", "pct"), ("percentage", "pct"),
        ("rate", "rate"), ("ratio", "rate"), ("increase", "up"), ("growth", "up"), ("decrease", "down"), ("decline", "down"),
        ("not", "not"), ("without", "not"), ("excluding", "not"), ("except", "not"), ("open", "open"), ("closed", "closed"),
        ("pending", "pending"), ("compare", "compare"), ("vs", "compare"), ("versus", "compare"), ("trend", "trend"),
    )
}


@dataclass(frozen=True)
class QuerySignature:
    """Exact-match part of a question. ``filters`` are compared by embedding similarity instead."""

    time: tuple[str, ...]
    numbers: tuple[str, ...]
    grouping: tuple[str, ...]
    filters: tuple[str, ...]
    visual: str = ""
    operators: tuple[str, ...] = ()

    def key(self) -> str:
        return "|".join(
            [",".join(self.time), ",".join(self.numbers), ",".join(self.grouping), ",".join(self.operators), self.visual]
        )

    def filter_text(self) -> str:
        return " ".join(self.filters)


def signature(question: str, today: date, glossary: Glossary | None = None, *, visual: str | None = None) -> QuerySignature:
    time, used = time_parts(question, today)
    lowered = (question or "").lower()
    stripped = lowered
    for span in used:
        stripped = stripped.replace(span, " ")
    numbers = sorted({m.group(0) for m in _NUMBER.finditer(stripped) if not _YEAR.fullmatch(m.group(0))})
    tokens = words(lowered)
    grouping: set[str] = set()
    for i, token in enumerate(tokens):
        if token in _GRAIN:
            grouping.add(_GRAIN[token])
        if token.endswith("wise") and len(token) > 4:
            grouping.add(stem(token[:-4]))
        if token == "wise" and i > 0 and tokens[i - 1] not in STOP:
            grouping.add(stem(tokens[i - 1]))
        if token in _GROUP_LEAD and i + 1 < len(tokens) and tokens[i + 1] not in STOP:
            nxt = tokens[i + 1]
            grouping.add(_GRAIN.get(nxt, stem(nxt)))
    canonical = glossary.canonical_tokens(question) if glossary else set()
    synonym_words: set[str] = set()
    if glossary:
        for term in glossary.matches(question):
            for phrase in term.synonyms:
                synonym_words.update(content_tokens(phrase, drop_time=False))
    operators = sorted({_OPERATORS[stem(w)] for w in tokens if stem(w) in _OPERATORS})
    filters = {
        t
        for t in content_tokens(stripped)
        if t not in SIGNATURE_NEUTRAL and t not in grouping and t not in _GROUP_LEAD and t not in synonym_words and t not in _OPERATORS
    } | canonical
    return QuerySignature(tuple(time), tuple(numbers), tuple(sorted(grouping)), tuple(sorted(filters)), visual or "", tuple(operators))


def normalized_text(question: str, glossary: Glossary | None = None) -> str:
    """Stable text used for embeddings and exact matching."""
    tokens = content_tokens(question, drop_time=False)
    extra = sorted(glossary.canonical_tokens(question)) if glossary else []
    return " ".join(tokens + [t for t in extra if t not in tokens])


def as_jsonable(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str))
