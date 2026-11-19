import type { ChartPayload } from "@/types";
import { buildHierarchicalDateAxisOption, CHART_INSET_PX, isDateSeriesChart } from "./date-axis";

const GRID_LINE_COLOR = "#d4d4d8";
const GRID_AXIS_COLOR = "#a1a1aa";

function legendFontSize(categoryCount: number, compact: boolean) {
  if (compact) return Math.max(7, Math.min(9, 18 - categoryCount * 0.15));
  return Math.max(8, Math.min(11, 20 - categoryCount * 0.12));
}

function cartesianInsets(fill: boolean, dateAxis: boolean, hierarchicalBottom?: number) {
  const base = CHART_INSET_PX;
  return {
    left: base,
    right: base,
    top: base,
    bottom: dateAxis && hierarchicalBottom != null ? hierarchicalBottom : base,
  };
}

/** ECharts option overrides: legend above plot, data labels, grid inset so nothing overlaps. */
export function buildSmartChartOption(
  data: ChartPayload,
  opts?: { labelColor?: string; fill?: boolean },
): Record<string, unknown> {
  const labelColor = opts?.labelColor;
  const compact = Boolean(opts?.fill);
  const categories = Math.max(1, data.labels.length);
  const seriesCount = Math.max(1, data.datasets.length);
  const legendFont = legendFontSize(categories, compact);
  const legendRows = Math.ceil(categories / (compact ? 3 : 4));
  const legendBlock = 4 + legendRows * (legendFont + 5);
  const showLegend = data.type === "pie" || seriesCount > 1;
  const dateSeries = isDateSeriesChart(data);
  const hierarchical = dateSeries ? buildHierarchicalDateAxisOption(data.labels, { labelColor, compact }) : null;
  const hierBottom = hierarchical ? (hierarchical.grid as { bottom: number }).bottom : undefined;

  const legend = {
    show: showLegend,
    top: compact ? CHART_INSET_PX : 0,
    left: compact ? CHART_INSET_PX : 0,
    orient: "horizontal" as const,
    type: categories > (compact ? 6 : 10) ? ("scroll" as const) : ("plain" as const),
    width: compact ? "96%" : "100%",
    itemWidth: 8,
    itemHeight: 8,
    itemGap: compact ? 4 : 8,
    textStyle: { fontSize: legendFont, color: labelColor },
    pageIconSize: 10,
    pageTextStyle: { fontSize: legendFont, color: labelColor },
  };

  const valueLabel = {
    show: true,
    fontSize: Math.max(7, legendFont - 1),
    color: labelColor ?? "#475569",
  };

  if (data.type === "pie" || data.type === "donut") {
    const pieTop = legendBlock + (compact ? CHART_INSET_PX : 8);
    const centerY = `${Math.min(52, pieTop + (compact ? 20 : 24))}%`;
    const radius =
      data.type === "donut"
        ? [`${Math.max(28, 40 - legendRows * 3)}%`, `${Math.max(42, 58 - legendRows * 3)}%`]
        : `${Math.max(30, 48 - legendRows * 3)}%`;
    return {
      xAxis: { show: false },
      yAxis: { show: false },
      legend,
      series: [
        {
          center: ["50%", centerY],
          radius,
          // Every slice keeps its value label, with leader lines to the slice (no label is dropped).
          avoidLabelOverlap: false,
          labelLayout: { hideOverlap: false, moveOverlap: "shiftY" },
          label: {
            ...valueLabel,
            formatter: "{c}",
          },
          labelLine: { show: true, length: 6, length2: 6, smooth: false, lineStyle: { color: GRID_AXIS_COLOR } },
          emphasis: { label: { show: true, fontSize: valueLabel.fontSize + 1 } },
        },
      ],
    };
  }

  const gridTop = showLegend ? legendBlock + (compact ? CHART_INSET_PX : 12) : compact ? CHART_INSET_PX : 28;
  const insets = cartesianInsets(compact, Boolean(hierarchical), hierBottom);
  const grid = {
    left: insets.left,
    right: insets.right,
    top: gridTop,
    bottom: insets.bottom,
    containLabel: true,
  };

  // Every point is labelled: no label is hidden for overlap, and long category names turn so each one fits.
  const rotateLabels = categories > 8 ? 35 : 0;
  const axisLabel = { color: labelColor ?? "#475569", fontSize: Math.max(8, legendFont), interval: 0, hideOverlap: false, rotate: rotateLabels };

  const base: Record<string, unknown> = {
    legend: showLegend ? legend : { show: false },
    grid,
    // Grey grid and axis lines (never black): they support the bars instead of competing with them.
    xAxis: {
      axisLine: { show: true, lineStyle: { color: GRID_AXIS_COLOR } },
      axisTick: { show: true, lineStyle: { color: GRID_AXIS_COLOR } },
      splitLine: { show: false },
      axisLabel,
    },
    yAxis: {
      axisLine: { show: true, lineStyle: { color: GRID_AXIS_COLOR } },
      axisTick: { show: true, lineStyle: { color: GRID_AXIS_COLOR } },
      splitLine: { show: true, lineStyle: { color: GRID_LINE_COLOR, width: 1 } },
      axisLabel: { color: labelColor ?? "#475569", fontSize: Math.max(8, legendFont) },
    },
    series: data.datasets.map(() => ({
      label: {
        ...valueLabel,
        position: "top",
        distance: 2,
        hideOverlap: false,
      },
    })),
  };

  if (hierarchical) {
    const dateGrid = hierarchical.grid as { bottom: number; containLabel?: boolean };
    return {
      ...base,
      ...hierarchical,
      grid: { ...dateGrid, ...grid, bottom: dateGrid.bottom, top: grid.top, left: grid.left, right: grid.right },
    };
  }

  return base;
}