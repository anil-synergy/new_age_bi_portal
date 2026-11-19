"""Static validation of LLM-generated DAX before it reaches the semantic model.

Rejects anything that is not a single read query, any reference to a table, column or
measure that does not exist in the model (the main hallucination failure), and bounds
the result size.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .metadata import SemanticModel

MAX_DAX_CHARS = 8000

_QUOTED_REF = re.compile(r"'((?:[^']|'')+)'\s*\[([^\]]+)\]")
_UNQUOTED_REF = re.compile(r"(?<![\w'\]])([A-Za-z_][\w]*)\[([^\]]+)\]")
_BARE_REF = re.compile(r"(?<![\w'\]])\[([^\]]+)\]")
_QUOTED_TABLE = re.compile(r"'((?:[^']|'')+)'")
_DEFINE_NAME = re.compile(r"\b(?:MEASURE|COLUMN)\s+(?:'((?:[^']|'')+)'|([A-Za-z_]\w*))\s*\[([^\]]+)\]", re.IGNORECASE)
_DEFINE_TABLE = re.compile(r"\b(?:VAR|TABLE)\s+([A-Za-z_]\w*)\s*=", re.IGNORECASE)
_EVALUATE = re.compile(r"\bEVALUATE\b", re.IGNORECASE)
_ORDER_BY = re.compile(r"\bORDER\s+BY\b", re.IGNORECASE)
_START_AT = re.compile(r"\bSTART\s+AT\b", re.IGNORECASE)


@dataclass
class GuardResult:
    ok: bool
    dax: str
    errors: list[str] = field(default_factory=list)
    references: list[str] = field(default_factory=list)
    has_order_by: bool = False
    row_cap: int = 0

    @property
    def schema_match(self) -> float:
        return 1.0 if self.ok else 0.0


def _mask(dax: str) -> tuple[str, list[str], str]:
    """Blank out comments and string literals (keeping length).

    Returns (masked text, string literals, original text with only comments blanked).
    """
    out: list[str] = []
    clean = list(dax)
    strings: list[str] = []
    i, n = 0, len(dax)
    while i < n:
        ch = dax[i]
        two = dax[i : i + 2]
        if two in ("//", "--"):
            end = dax.find("\n", i)
            end = n if end == -1 else end
            out.append(" " * (end - i))
            clean[i:end] = " " * (end - i)
            i = end
        elif two == "/*":
            end = dax.find("*/", i + 2)
            end = n if end == -1 else end + 2
            out.append(" " * (end - i))
            clean[i:end] = " " * (end - i)
            i = end
        elif ch == '"':
            j = i + 1
            buf = []
            while j < n:
                if dax[j] == '"' and dax[j + 1 : j + 2] == '"':
                    buf.append('"')
                    j += 2
                    continue
                if dax[j] == '"':
                    break
                buf.append(dax[j])
                j += 1
            strings.append("".join(buf))
            out.append('"' + " " * (j - i - 1) + ('"' if j < n else ""))
            i = j + 1
        else:
            out.append(ch)
            i += 1
    return "".join(out), strings, "".join(clean)


def validate(dax: str, model: SemanticModel, *, max_rows: int) -> GuardResult:
    dax = (dax or "").strip().rstrip(";").strip()
    errors: list[str] = []
    if not dax:
        return GuardResult(False, dax, ["Empty query"])
    if len(dax) > MAX_DAX_CHARS:
        return GuardResult(False, dax, [f"Query longer than {MAX_DAX_CHARS} characters"])

    masked, strings, clean = _mask(dax)
    head = masked.lstrip().upper()
    if not (head.startswith("EVALUATE") or head.startswith("DEFINE")):
        errors.append("Query must start with DEFINE or EVALUATE")
    evaluates = list(_EVALUATE.finditer(masked))
    if len(evaluates) != 1:
        errors.append(f"Query must contain exactly one EVALUATE (found {len(evaluates)})")

    tables = {t.name.lower(): t for t in model.tables}
    measures = model.measure_names()
    all_columns = model.column_names()

    defined: set[str] = {s.lower() for s in strings}  # aliases like "Total Spend" in SUMMARIZECOLUMNS
    defined_tables: set[str] = set()
    for quoted, plain, name in _DEFINE_NAME.findall(masked):
        defined.add(name.lower())
    for name in _DEFINE_TABLE.findall(masked):
        defined_tables.add(name.lower())
        defined.add(name.lower())

    references: list[str] = []
    consumed = masked

    def check_qualified(table: str, name: str) -> None:
        key = table.replace("''", "'").lower()
        lname = name.lower()
        references.append(f"'{table}'[{name}]")
        if key in defined_tables:
            return
        table_obj = tables.get(key)
        if table_obj is None:
            errors.append(f"Unknown table '{table}'")
            return
        known = {c.name.lower() for c in table_obj.columns} | {m.name.lower() for m in table_obj.measures}
        if lname not in known and lname not in defined:
            errors.append(f"Unknown column or measure '{table}'[{name}]")

    for match in _QUOTED_REF.finditer(masked):
        check_qualified(match.group(1), match.group(2))
        consumed = consumed[: match.start()] + " " * (match.end() - match.start()) + consumed[match.end():]
    for match in _UNQUOTED_REF.finditer(consumed):
        check_qualified(match.group(1), match.group(2))
        consumed = consumed[: match.start()] + " " * (match.end() - match.start()) + consumed[match.end():]
    for match in _QUOTED_TABLE.finditer(consumed):
        name = match.group(1).replace("''", "'")
        references.append(f"'{name}'")
        if name.lower() not in tables and name.lower() not in defined_tables:
            errors.append(f"Unknown table '{name}'")
    for match in _BARE_REF.finditer(consumed):
        name = match.group(1)
        references.append(f"[{name}]")
        lname = name.lower()
        if lname not in measures and lname not in all_columns and lname not in defined:
            errors.append(f"Unknown measure or column [{name}]")

    has_order_by = bool(_ORDER_BY.search(masked))
    rewritten = dax
    if not errors and not has_order_by and not _START_AT.search(masked) and len(evaluates) == 1:
        start = evaluates[0].end()
        body = clean[start:].strip()
        rewritten = f"{clean[: evaluates[0].start()].rstrip()}\nEVALUATE\nTOPN({max_rows + 1}, {body})".strip()

    return GuardResult(
        ok=not errors,
        dax=rewritten,
        errors=sorted(set(errors)),
        references=sorted(set(references)),
        has_order_by=has_order_by,
        row_cap=max_rows,
    )
