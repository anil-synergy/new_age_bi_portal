/** SMART / NOVA chart kinds rendered by ChatChart (ECharts). */
export type ChartType =
  | "bar"
  | "line"
  | "pie"
  | "donut"
  | "area"
  | "stacked-bar"
  | "horizontal-bar"
  | "combo"
  | "scatter"
  | "funnel"
  | "treemap"
  | "sunburst"
  | "gauge"
  | "radar"
  | "sankey"
  | "graph"
  | "chord"
  | "parallel"
  | "themeRiver"
  | "tree"
  | "heatmap"
  | "boxplot"
  | "candlestick"
  | "calendar-heatmap"
  | "map"
  | "geo-scatter"
  | "geo-lines";

export const CARTESIAN_CHART_TYPES: ChartType[] = [
  "bar",
  "line",
  "area",
  "stacked-bar",
  "horizontal-bar",
  "combo",
  "scatter",
];

export const POLAR_CHART_TYPES: ChartType[] = ["pie", "donut", "funnel", "treemap", "sunburst", "gauge", "radar"];

export const FLOW_CHART_TYPES: ChartType[] = ["sankey", "graph", "chord", "parallel", "themeRiver", "tree"];

export const MAP_CHART_TYPES: ChartType[] = ["map", "geo-scatter", "geo-lines"];