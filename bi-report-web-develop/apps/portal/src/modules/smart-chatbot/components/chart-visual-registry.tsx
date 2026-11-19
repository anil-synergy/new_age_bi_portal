import type { ReactNode } from "react";
import type { ChartPayload } from "@/types";
import { MAP_CHART_TYPES, POLAR_CHART_TYPES, type ChartType } from "@/types/chart-types";
import { BarChart } from "@/modules/shared/components/ui/charts/bar-chart";
import { LineChart } from "@/modules/shared/components/ui/charts/line-chart";
import { PieChart } from "@/modules/shared/components/ui/charts/pie-chart";
import { GenericOptionChart } from "@/modules/shared/components/ui/charts/generic-chart/GenericOptionChart";
import { MapChartVisual } from "./map-chart-visual";

type RenderCtx = {
  rows: Record<string, string | number>[];
  height: number | string;
  option: Record<string, unknown>;
};

function yFields(data: ChartPayload): string[] {
  return data.datasets.map((ds, index) => ds.label || `series${index}`);
}

function mergeAreaOption(option: Record<string, unknown>): Record<string, unknown> {
  const series = (option.series as Record<string, unknown>[])?.map((s) => ({
    ...s,
    type: "line",
    areaStyle: {},
    stack: "area",
  }));
  return { ...option, series };
}

function mergeHorizontalBarOption(option: Record<string, unknown>): Record<string, unknown> {
  return {
    ...option,
    xAxis: { type: "value" },
    yAxis: { type: "category" },
  };
}

function mergeStackedBarOption(option: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const series = (option.series as Record<string, unknown>[])?.map((s, i) => ({
    ...s,
    stack: "total",
    type: "bar",
    name: fields[i],
  }));
  return { ...option, series };
}

function mergeScatterOption(data: ChartPayload, option: Record<string, unknown>): Record<string, unknown> {
  const x = data.datasets[0]?.data ?? [];
  const y = data.datasets[1]?.data ?? data.datasets[0]?.data ?? [];
  const points = data.labels.map((_, i) => [x[i] ?? 0, y[i] ?? 0]);
  return {
    ...option,
    xAxis: { type: "value" },
    yAxis: { type: "value" },
    series: [{ type: "scatter", data: points, label: { show: true } }],
  };
}

const REGISTRY: Partial<Record<ChartType, (data: ChartPayload, ctx: RenderCtx) => ReactNode>> = {
  pie: (data, ctx) => (
    <PieChart data={ctx.rows} nameField="name" valueField="value" height={ctx.height} option={ctx.option} />
  ),
  donut: (data, ctx) => (
    <PieChart data={ctx.rows} nameField="name" valueField="value" height={ctx.height} donut option={ctx.option} />
  ),
  line: (data, ctx) => (
    <LineChart
      data={ctx.rows}
      xField="x"
      yField={yFields(data).length === 1 ? yFields(data)[0] : yFields(data)}
      height={ctx.height}
      markers
      option={ctx.option}
    />
  ),
  area: (data, ctx) => (
    <LineChart
      data={ctx.rows}
      xField="x"
      yField={yFields(data).length === 1 ? yFields(data)[0] : yFields(data)}
      height={ctx.height}
      markers
      stacked
      option={mergeAreaOption(ctx.option)}
    />
  ),
  bar: (data, ctx) => (
    <BarChart
      data={ctx.rows}
      xField="x"
      yField={yFields(data).length === 1 ? yFields(data)[0] : yFields(data)}
      height={ctx.height}
      valueLabels
      option={ctx.option}
    />
  ),
  "stacked-bar": (data, ctx) => (
    <BarChart
      data={ctx.rows}
      xField="x"
      yField={yFields(data)}
      height={ctx.height}
      stacked
      valueLabels
      option={mergeStackedBarOption(ctx.option, yFields(data))}
    />
  ),
  "horizontal-bar": (data, ctx) => (
    <BarChart
      data={ctx.rows}
      xField="x"
      yField={yFields(data).length === 1 ? yFields(data)[0] : yFields(data)}
      height={ctx.height}
      valueLabels
      option={mergeHorizontalBarOption(ctx.option)}
    />
  ),
  combo: (data, ctx) => (
    <BarChart
      data={ctx.rows}
      xField="x"
      yField={yFields(data)}
      height={ctx.height}
      valueLabels
      option={{
        ...ctx.option,
        series: yFields(data).map((field, i) => ({
          ...(ctx.option.series as Record<string, unknown>[])?.[i],
          name: field,
          type: i === 0 ? "bar" : "line",
          data: ctx.rows.map((r) => r[field]),
          label: { show: true },
        })),
      }}
    />
  ),
  scatter: (data, ctx) => (
    <GenericOptionChart option={mergeScatterOption(data, ctx.option)} height={ctx.height} ariaLabel="Scatter chart" />
  ),
  map: (data, ctx) => <MapChartVisual data={data} height={ctx.height} option={ctx.option} />,
  "geo-scatter": (data, ctx) => <MapChartVisual data={data} height={ctx.height} option={ctx.option} />,
  "geo-lines": (data, ctx) => <MapChartVisual data={data} height={ctx.height} option={ctx.option} />,
};

export function renderChartByType(data: ChartPayload, ctx: RenderCtx): ReactNode {
  if (data.echartsOption) {
    return <GenericOptionChart option={{ ...data.echartsOption, ...ctx.option }} height={ctx.height} />;
  }
  if (MAP_CHART_TYPES.includes(data.type)) {
    return <MapChartVisual data={data} height={ctx.height} option={ctx.option} />;
  }
  const render = REGISTRY[data.type];
  if (render) return render(data, ctx);
  if (POLAR_CHART_TYPES.includes(data.type)) {
    return <GenericOptionChart option={ctx.option} height={ctx.height} />;
  }
  return (
    <BarChart
      data={ctx.rows}
      xField="x"
      yField={yFields(data).length === 1 ? yFields(data)[0] : yFields(data)}
      height={ctx.height}
      valueLabels
      option={ctx.option}
    />
  );
}