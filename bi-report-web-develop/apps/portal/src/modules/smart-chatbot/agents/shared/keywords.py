"""Treat singular and plural forms as the same word without changing the question."""

from __future__ import annotations


def stem(word: str) -> str:
    """injury and injuries share a stem. The original word is kept alongside it."""
    w = word.lower()
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def with_stems(words: set[str]) -> set[str]:
    return set(words) | {stem(w) for w in words}
