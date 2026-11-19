"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChartPayload } from "@/types";
import { GenericOptionChart } from "@/modules/shared/components/ui/charts/generic-chart/GenericOptionChart";
import { ensureMapsLoaded } from "@/modules/shared/components/ui/charts/maps/registerMaps";
import { CHART_INSET_PX } from "./date-axis";

export function MapChartVisual({
  data,
  height,
  option,
}: {
  data: ChartPayload;
  height: number | string;
  option?: Record<string, unknown>;
}) {
  const [mapsReady, setMapsReady] = useState(false);
  useEffect(() => {
    void ensureMapsLoaded().then(() => setMapsReady(true));
  }, []);

  const mapName = data.mapRegion === "india" ? "india" : "world";
  const built = useMemo(() => {
    if (data.echartsOption) return { ...data.echartsOption, ...option };
    const values = data.datasets[0]?.data ?? [];
    const seriesData = data.labels.map((name, i) => ({ name, value: values[i] ?? 0 }));
    return {
      grid: { left: CHART_INSET_PX, right: CHART_INSET_PX, top: CHART_INSET_PX, bottom: CHART_INSET_PX },
      visualMap: { min: 0, max: Math.max(...values, 1), text: ["High", "Low"], calculable: true },
      series: [{ type: "map", map: mapName, data: seriesData, label: { show: true, formatter: "{b}: {c}" } }],
      ...option,
    };
  }, [data.datasets, data.echartsOption, data.labels, mapName, option]);

  if (!mapsReady) {
    return <div className="flex h-full min-h-[80px] items-center justify-center text-[11px] text-slate-500">Loading map…</div>;
  }
  return <GenericOptionChart option={built} height={height} ariaLabel="Map chart" />;
}