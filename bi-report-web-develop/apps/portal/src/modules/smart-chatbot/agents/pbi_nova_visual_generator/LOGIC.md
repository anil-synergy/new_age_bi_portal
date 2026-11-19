# N.O.V.A. logic

The LLM never produces numbers. It may only pick one of the visual kinds that the rules already allow, and suggest a title.

## 1. Profile columns

Each result column gets a role:

- `numeric`: every value is a number. Integer columns named like date, month, year or quarter count as `date`.
- `date`: every value is an ISO date or datetime string.
- `category`: anything else.

## 2. Allowed kinds (best first)

| Result shape | Allowed |
|---|---|
| no rows or no numeric column | `table` |
| 1 row, no dimension | `kpi`, `table` |
| 1 row with a dimension | `kpi`, `bar`, `table` |
| question names pie / donut or share / split / breakdown (one measure) | `pie`, `bar`, `table` |
| date dimension, or the question says trend / monthly / over time (and not explicit pie) | `line`, `bar`, `table` |
| one measure, up to 6 categories, question says share / split / breakdown / mix | `pie`, `bar`, `table` |
| one measure, up to 6 categories | `bar`, `pie`, `table` |
| otherwise | `bar`, `line`, `table` |

The x axis is the first date column, otherwise the first category column. Every numeric column becomes a series (at most 4).

## 3. Choose

1. If SMART passes a `preferred_type` that is **buildable** for the result shape (even when it is not the default first entry in `allowed`), use it.
2. Otherwise, if more than one kind is allowed and the LLM is configured, ask it to pick from `ALLOWED` given column roles and 5 sample rows. An answer outside the list is ignored.
3. Otherwise use the first allowed kind.

SMART sends the **raw user message** as `question` to N.O.V.A. so chart-type words survive intent rewriting.

## 4. Build the spec

- **Line:** sorted by the x value; when there are more points than `NOVA_MAX_POINTS`, the latest are kept.
- **Bar:** when there are more points than `NOVA_MAX_POINTS`, sorted by the first measure descending and the top N kept.
- **Pie:** first measure only; non-positive values are dropped. When there are more categories than `min(NOVA_MAX_POINTS, 12)`, keep the top slices and roll the remainder into an **Other** slice so totals still match the query.
- **KPI:** one card per numeric column. If the second column is named like prior / previous / LY / PY / budget / target, the first card gets `delta` = percentage change against it.
- **Labels:** dates are trimmed to `YYYY-MM-DD`, nulls become `(blank)`.
- **Values:** copied as floats from the rows. `truncated` is true when points were dropped or pie slices were rolled up.