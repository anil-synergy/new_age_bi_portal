"""Messages SMART shows when a whole path is unavailable.

Analytical questions keep going on the Power BI branch when only the portal
catalog is down. These two strings are the user-facing contracts.
"""

SMART_DOWN = "SMART is currently down, raise an issue to bisupport@synergyship.com"
REPORT_DATABASE_DOWN = "Try later, facing issues in connecting report databases"


def model_unreadable_message(report_title: str) -> str:
    title = (report_title or "that report").strip()
    return (
        f'I matched "{title}" but Power BI could not read its semantic model '
        "(missing Premium/XMLA access, offline metadata, or permissions). "
        "Try the named report from the BI menu, or contact bisupport@synergyship.com if this persists."
    )
