# N.O.V.A. output

`generate_visual` returns `{"status": "ok", "visual": VisualSpec}` or `{"status": "rejected", "message": ...}`.

## VisualSpec

| Field | Type | Notes |
|---|---|---|
| `kind` | `chart` \| `kpi` \| `table` \| `matrix` \| `none` | `table` / `matrix` are grid visuals for the portal |
| `title` | string | Up to 60 characters |
| `chart` | `ChartPayload` (`type`: full ECharts catalog, `labels`, `datasets`, optional `echarts_option`, `map_region`, `encoding`) | Rendered by `ChatChart` registry |
| `kpi` | `{label, value, delta?}` | First KPI card; `value` is a formatted string |
| `kpis` | KPI[] | All KPI cards |
| `table` | `{columns, rows, truncated?}` | Rendered by `ChatTableVisual`; pinnable on Home |
| `matrix` | `{row_field, column_field, value_field, row_labels, column_labels, cells, truncated?}` | Pivoted grid; rendered by `ChatMatrixVisual` |
| `rationale` | string | Why this kind was chosen |
| `x_column`, `y_columns` | string, string[] | Columns used |
| `points` | number | Data points plotted |
| `truncated` | boolean | Points were dropped to respect `NOVA_MAX_POINTS` |

`delta` is a percentage number (for example `12.5`). The portal formats it as `+12.5% vs prior` for `KpiPayload.delta`.

## Chart example

```json
{
  "kind": "chart",
  "title": "Spend by Month",
  "chart": {
    "type": "line",
    "labels": ["2026-01-01", "2026-02-01", "2026-03-01"],
    "datasets": [{"label": "Spend", "data": [120000.0, 98000.0, 143500.0]}]
  },
  "rationale": "Selected by data-shape rules.",
  "x_column": "Month",
  "y_columns": ["Spend"],
  "points": 3,
  "truncated": false
}
```

Rendered by `ChatChart` (uipkge ECharts wrappers) as a line chart with one series.

## KPI example

```json
{
  "kind": "kpi",
  "title": "Spend",
  "kpi": {"label": "Spend", "value": "1,245,300", "delta": 8.43},
  "kpis": [
    {"label": "Spend", "value": "1,245,300", "delta": 8.43},
    {"label": "Spend PY", "value": "1,148,500"}
  ],
  "y_columns": ["Spend", "Spend PY"],
  "points": 1
}
```

Rendered by `ChatKpi` as two cards: "1,245,300" with "+8.43% vs prior", and "1,148,500".
