"""Incremental Okapi BM25 over stemmed tokens. Documents can be added, replaced and removed."""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from typing import Iterable


class BM25Index:
    def __init__(self, k1: float = 1.2, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self._docs: dict[str, Counter[str]] = {}
        self._lengths: dict[str, int] = {}
        self._postings: dict[str, set[str]] = defaultdict(set)
        self._total_length = 0

    def __len__(self) -> int:
        return len(self._docs)

    def __contains__(self, doc_id: str) -> bool:
        return doc_id in self._docs

    def upsert(self, doc_id: str, tokens: Iterable[str]) -> None:
        self.remove(doc_id)
        counts = Counter(tokens)
        self._docs[doc_id] = counts
        length = sum(counts.values())
        self._lengths[doc_id] = length
        self._total_length += length
        for term in counts:
            self._postings[term].add(doc_id)

    def remove(self, doc_id: str) -> None:
        counts = self._docs.pop(doc_id, None)
        if counts is None:
            return
        self._total_length -= self._lengths.pop(doc_id, 0)
        for term in counts:
            ids = self._postings.get(term)
            if ids is not None:
                ids.discard(doc_id)
                if not ids:
                    del self._postings[term]

    def search(self, terms: Iterable[str], *, allowed: set[str] | None = None) -> dict[str, float]:
        """Raw BM25 scores for documents containing at least one query term.

        ``allowed`` restricts scoring to those document ids before any score exists, so filtered
        documents never compete. IDF uses the whole index so scores are stable across filters.
        """
        n = len(self._docs)
        if not n:
            return {}
        avgdl = self._total_length / n if n else 1.0
        scores: dict[str, float] = defaultdict(float)
        for term in set(terms):
            ids = self._postings.get(term)
            if not ids:
                continue
            idf = math.log(1 + (n - len(ids) + 0.5) / (len(ids) + 0.5))
            for doc_id in ids:
                if allowed is not None and doc_id not in allowed:
                    continue
                tf = self._docs[doc_id][term]
                norm = tf + self.k1 * (1 - self.b + self.b * self._lengths[doc_id] / (avgdl or 1.0))
                scores[doc_id] += idf * (tf * (self.k1 + 1)) / norm
        return dict(scores)
