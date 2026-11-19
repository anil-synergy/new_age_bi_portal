"use client";

import { useMemo } from "react";
import type { ChartPayload, ChartType } from "@/types";
import { buildSmartChartOption } from "./smart-chart-options";
import { renderChartByType } from "./chart-visual-registry";

function chartPayloadToRows(data: ChartPayload): Record<string, string | number>[] {
  if (data.type === "pie" || data.type === "donut") {
    const values = data.datasets[0]?.data ?? [];
    return data.labels.map((name, i) => ({ name, value: values[i] ?? 0 }));
  }

  const fields = data.datasets.map((ds, index) => ds.label || `series${index}`);
  return data.labels.map((x, i) => {
    const row: Record<string, string | number> = { x };
    data.datasets.forEach((ds, di) => {
      row[fields[di]] = ds.data[i] ?? 0;
    });
    return row;
  });
}

const NON_CARTESIAN: ChartType[] = [
  "pie",
  "donut",
  "funnel",
  "treemap",
  "sunburst",
  "gauge",
  "radar",
  "sankey",
  "graph",
  "chord",
  "map",
  "geo-scatter",
  "geo-lines",
  "heatmap",
];

function mergeOptionColors(data: ChartPayload, base: Record<string, unknown>, labelColor?: string) {
  if (!labelColor) return base;
  const cartesian = !NON_CARTESIAN.includes(data.type);
  const next: Record<string, unknown> = {
    ...base,
    legend: {
      ...(base.legend as object),
      textStyle: {
        fontSize: (base.legend as { textStyle?: { fontSize?: number } })?.textStyle?.fontSize ?? 10,
        color: labelColor,
      },
    },
  };

  if (!cartesian) {
    const series = (base.series as Record<string, unknown>[])?.map((s) => ({
      ...s,
      label: { ...(s.label as object), color: labelColor },
    }));
    if (series) next.series = series;
    return next;
  }

  // Keep each axis's own settings (every label shown, rotation, grey lines) and only change the text colour.
  const paint = (axis: unknown) => {
    const a = (axis ?? {}) as { axisLabel?: Record<string, unknown> };
    return { ...a, axisLabel: { ...a.axisLabel, color: labelColor } };
  };
  const xAxis = base.xAxis;
  return {
    ...next,
    xAxis: Array.isArray(xAxis) ? xAxis.map(paint) : paint(xAxis),
    yAxis: paint(base.yAxis),
  };
}

export function ChatChart({
  data,
  fill = false,
  labelColor,
}: {
  data: ChartPayload;
  fill?: boolean;
  labelColor?: string;
}) {
  const rows = useMemo(() => chartPayloadToRows(data), [data]);
  const height: number | string = fill ? "100%" : 280;
  const layoutTypes: ChartType[] = [
    "bar",
    "line",
    "pie",
    "donut",
    "area",
    "stacked-bar",
    "horizontal-bar",
    "combo",
    "scatter",
  ];
  const option = useMemo(() => {
    const built = layoutTypes.includes(data.type)
      ? buildSmartChartOption(data, { labelColor, fill })
      : { grid: { left: 5, right: 5, top: 5, bottom: 5, containLabel: true } };
    return mergeOptionColors(data, built, labelColor);
  }, [data, labelColor, fill]);

  const chart = renderChartByType(data, { rows, height, option });

  return fill ? <div className="h-full min-h-0 w-full min-w-0 p-[5px] box-border">{chart}</div> : chart;
}