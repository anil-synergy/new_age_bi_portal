"""N.O.V.A. note builder: a text note with a title and a look (colours, size, font, bold, italic).

Notes are not data, so nothing here reads a semantic model. The function only cleans the request, so the
portal always gets a valid note with safe values.
"""

from __future__ import annotations

import re
from typing import Any

FONTS = ("sans", "serif", "mono", "hand")
DEFAULT_STYLE: dict[str, Any] = {
    "background": "#fef9c3",
    "color": "#1f2937",
    "fontSize": 16,
    "fontFamily": "sans",
    "bold": False,
    "italic": False,
}
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
MAX_TITLE = 80
MAX_TEXT = 4000


def _style(raw: dict[str, Any] | None) -> dict[str, Any]:
    style = dict(DEFAULT_STYLE)
    for key, value in (raw or {}).items():
        if value is None:
            continue
        if key in ("background", "color") and isinstance(value, str) and _HEX.match(value):
            style[key] = value
        elif key == "fontSize" and isinstance(value, int) and 11 <= value <= 28:
            style[key] = value
        elif key == "fontFamily" and value in FONTS:
            style[key] = value
        elif key in ("bold", "italic") and isinstance(value, bool):
            style[key] = value
    return style


def build_note(title: str | None, text: str | None = "", style: dict[str, Any] | None = None) -> dict[str, Any]:
    clean_title = " ".join((title or "").split())[:MAX_TITLE] or "Note"
    body = (text or "").strip()[:MAX_TEXT]
    return {"title": clean_title, "text": body, "style": _style(style)}
