"""Production, development and archive classification for report and semantic model names.

Names are split on separators and camelCase boundaries and matched token by token, so
"Contest", "Latest" or "Oldham" never match "test" or "old". Phrases such as "draft survey"
or "drug test" are protected because those words carry a business meaning there.

Retrieval uses the result as a hard filter: DEV and ARCHIVE items are removed before
scoring unless the user asked for them, so a high similarity score cannot bring them back.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Iterable

from smart_common.config import csv_list
from smart_common.keywords import stem

PROD = "PROD"
DEV = "DEV"
ARCHIVE = "ARCHIVE"
ENVIRONMENTS = (PROD, DEV, ARCHIVE)

_CAMEL = re.compile(r"(?<=[a-z])(?=[A-Z])|(?<=[A-Za-z])(?=[0-9])(?<![vV])|(?<=[0-9])(?=[A-Za-z])")
_SPLIT = re.compile(r"[^A-Za-z0-9]+")
_VERSION = re.compile(r"^(?:v|ver|version|rev)\d+$")
_VERSION_WORD = {"v", "ver", "version", "rev"}
_REPORTISH = frozenset(
    {"report", "reports", "model", "models", "dataset", "datasets", "version", "versions", "dashboard", "dashboards", "workspace", "file", "copy", "one"}
)


def name_tokens(text: str | None) -> list[str]:
    """'INJURY_REPORT_DRAFT' -> ['injury', 'report', 'draft']; 'InjuryV2' -> ['injury', 'v2']."""
    spaced = _CAMEL.sub(" ", text or "")
    return [token.lower() for token in _SPLIT.split(spaced) if token]


def _version_positions(tokens: list[str]) -> set[int]:
    found: set[int] = set()
    for i, token in enumerate(tokens):
        if _VERSION.match(token):
            found.add(i)
        elif token in _VERSION_WORD and i + 1 < len(tokens) and tokens[i + 1].isdigit():
            found.update({i, i + 1})
    return found


def _protected_positions(tokens: list[str], phrases: Iterable[tuple[str, ...]]) -> set[int]:
    stems = [stem(t) for t in tokens]
    protected: set[int] = set()
    for phrase in phrases:
        size = len(phrase)
        if not size:
            continue
        for start in range(0, len(stems) - size + 1):
            if tuple(stems[start : start + size]) == phrase:
                protected.update(range(start, start + size))
    return protected


@dataclass(frozen=True)
class Classification:
    environment: str
    markers: tuple[str, ...] = ()
    source: str = "name"


@dataclass(frozen=True)
class EnvironmentRequest:
    """Which environments a question may use. PROD is always allowed."""

    allowed: frozenset[str]
    markers: tuple[str, ...] = ()
    override: bool = False
    # Non-production environments the user's words asked for (the override alone adds none).
    requested_envs: frozenset[str] = frozenset()

    @property
    def explicit(self) -> bool:
        return bool(self.requested_envs)


@dataclass(frozen=True)
class EnvironmentPolicy:
    dev_terms: frozenset[str]
    archive_terms: frozenset[str]
    weak_query_terms: frozenset[str]
    prod_phrases: tuple[tuple[str, ...], ...]
    overrides: dict[str, str] = field(default_factory=dict)
    classify_workspace: bool = True

    @classmethod
    def from_settings(cls, settings: Any) -> "EnvironmentPolicy":
        overrides: dict[str, str] = {}
        try:
            raw = json.loads(getattr(settings, "report_env_overrides", "{}") or "{}")
        except json.JSONDecodeError:
            raw = {}
        if isinstance(raw, dict):
            for key, value in raw.items():
                env = str(value).strip().upper()
                if env in ENVIRONMENTS:
                    overrides[str(key).strip().lower()] = env
        phrases = tuple(
            tuple(stem(t) for t in name_tokens(phrase)) for phrase in csv_list(getattr(settings, "report_env_prod_phrases", ""))
        )
        return cls(
            dev_terms=frozenset(t.lower() for t in csv_list(getattr(settings, "report_env_dev_terms", ""))),
            archive_terms=frozenset(t.lower() for t in csv_list(getattr(settings, "report_env_archive_terms", ""))),
            weak_query_terms=frozenset(t.lower() for t in csv_list(getattr(settings, "report_env_query_weak_terms", ""))),
            prod_phrases=tuple(p for p in phrases if p),
            overrides=overrides,
            classify_workspace=bool(getattr(settings, "report_env_classify_workspace", True)),
        )

    # ------------------------------------------------------------ names
    def _name_markers(self, text: str | None) -> tuple[list[str], list[str]]:
        tokens = name_tokens(text)
        protected = _protected_positions(tokens, self.prod_phrases)
        versions = _version_positions(tokens)
        dev: list[str] = []
        archive: list[str] = []
        for i, token in enumerate(tokens):
            if i in protected:
                continue
            if token in self.archive_terms:
                archive.append(token)
            elif token in self.dev_terms:
                dev.append(token)
            elif i in versions and not token.isdigit():
                dev.append("version")
        return dev, archive

    def classify(self, title: str | None, *, workspace_name: str | None = None, ids: Iterable[str | None] = ()) -> Classification:
        for key in [*ids, title]:
            if key and str(key).strip().lower() in self.overrides:
                return Classification(self.overrides[str(key).strip().lower()], ("override",), "override")
        dev, archive = self._name_markers(title)
        if archive:
            return Classification(ARCHIVE, tuple(archive + dev))
        if dev:
            return Classification(DEV, tuple(dev))
        if self.classify_workspace and workspace_name:
            ws_dev, ws_archive = self._name_markers(workspace_name)
            if ws_archive:
                return Classification(ARCHIVE, tuple(f"workspace:{m}" for m in ws_archive), "workspace")
            if ws_dev:
                return Classification(DEV, tuple(f"workspace:{m}" for m in ws_dev), "workspace")
        return Classification(PROD)

    def classify_item(self, item: dict[str, Any]) -> Classification:
        return self.classify(
            str(item.get("title") or ""),
            workspace_name=item.get("workspace_name") or (item.get("menu_path") if item.get("source") == "workspace" else None),
            ids=(item.get("dataset_id"), item.get("report_id"), item.get("portal_id")),
        )

    # ------------------------------------------------------------ questions
    def requested(
        self,
        question: str,
        candidates: Iterable[tuple[str, str]] = (),
        *,
        override: bool = False,
    ) -> EnvironmentRequest:
        """Environments the user asked for.

        Unambiguous words (uat, sandbox, archive, deprecated, v2 ...) count anywhere. Words with a
        business meaning (draft, test, old ...) count only next to report/model/version words, or when
        a non-production candidate is named by that word together with the question's subject.
        """
        tokens = name_tokens(question)
        protected = _protected_positions(tokens, self.prod_phrases)
        versions = _version_positions(tokens)
        markers: list[str] = []
        allowed = {PROD}
        subject = {stem(t) for i, t in enumerate(tokens) if i not in protected and t not in self.dev_terms and t not in self.archive_terms}
        named = [(set(name_tokens(title)), env) for title, env in candidates if env != PROD]
        for i, token in enumerate(tokens):
            if i in protected:
                continue
            if i in versions and not token.isdigit():
                allowed.add(DEV)
                markers.append("version")
                continue
            if token not in self.dev_terms and token not in self.archive_terms:
                continue
            env = ARCHIVE if token in self.archive_terms else DEV
            near_report = any(t in _REPORTISH for t in tokens[max(0, i - 2) : i + 3])
            names_candidate = any(
                cand_env == env and token in title_tokens and bool(subject & {stem(t) for t in title_tokens})
                for title_tokens, cand_env in named
            )
            if token not in self.weak_query_terms or near_report or names_candidate:
                allowed.add(env)
                markers.append(token)
        requested_envs = frozenset(allowed - {PROD})
        if override:
            return EnvironmentRequest(frozenset(ENVIRONMENTS), tuple(markers), True, requested_envs)
        return EnvironmentRequest(frozenset(allowed), tuple(markers), False, requested_envs)
