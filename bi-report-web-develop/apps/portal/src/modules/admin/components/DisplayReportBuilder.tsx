"use client";

import { useState } from "react";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import dynamic from "next/dynamic";

const DisplayReportViewer = dynamic(
  () => import("@/modules/tile-engine/components/DisplayReportViewer").then((m) => m.DisplayReportViewer),
  { ssr: false }
);
const VisualPicker = dynamic(
  () => import("@/modules/tile-engine/components/VisualPicker").then((m) => m.VisualPicker),
  { ssr: false }
);
import type { DisplayReport, PortalReport, TileConfig } from "@/types";
import { createDisplayReport, updateDisplayReport } from "@/services/biServices";

interface DisplayReportBuilderProps {
  reports: PortalReport[];
  existing?: DisplayReport;
  onSaved?: () => void;
}

export function DisplayReportBuilder({ reports, existing, onSaved }: DisplayReportBuilderProps) {
  const [name, setName] = useState(existing?.name ?? "");
  const [tiles, setTiles] = useState<TileConfig[]>(existing?.tiles ?? []);
  const [selectedReport, setSelectedReport] = useState<PortalReport | null>(null);
  const [saving, setSaving] = useState(false);

  const displayReport: DisplayReport = {
    id: existing?.id ?? "",
    name,
    canvasWidth: 1920,
    canvasHeight: 1080,
    tiles,
  };

  const addTile = (partial: Partial<TileConfig>) => {
    const newTile: TileConfig = {
      id: crypto.randomUUID(),
      sourceType: partial.sourceType ?? "powerbi-visual",
      x: 50 + tiles.length * 20,
      y: 50 + tiles.length * 20,
      width: partial.width ?? 480,
      height: partial.height ?? 320,
      ...partial,
    } as TileConfig;
    setTiles((prev) => [...prev, newTile]);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...displayReport, name, tiles };
      if (existing?.id) {
        await updateDisplayReport(existing.id, payload);
      } else {
        await createDisplayReport(payload);
      }
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-slate-500">Display Report Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Dashboard" />
        </div>
        <select
          className="h-10 rounded border px-2 text-sm"
          value={selectedReport?.id ?? ""}
          onChange={(e) => setSelectedReport(reports.find((r) => r.id === e.target.value) ?? null)}
        >
          <option value="">Select report to pin visuals…</option>
          {reports.map((r) => (
            <option key={r.id} value={r.id}>{r.title ?? r.name}</option>
          ))}
        </select>
        <Button
          variant="outline"
          onClick={() =>
            addTile({
              sourceType: "url",
              url: "https://",
              width: 640,
              height: 480,
              title: "Web App",
            })
          }
        >
          Add URL Tile
        </Button>
        <Button onClick={save} disabled={saving || !name}>{saving ? "Saving…" : "Save Display Report"}</Button>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
        {selectedReport && (
          <div className="rounded border p-3 lg:col-span-1">
            <VisualPicker
              workspaceId={selectedReport.workspaceId ?? selectedReport.powerWorkSpaceId ?? ""}
              reportId={selectedReport.powerBiReportId ?? ""}
              datasetId={selectedReport.datasetId}
              onPinVisual={addTile}
            />
          </div>
        )}
        <div className={selectedReport ? "lg:col-span-2" : "lg:col-span-3"}>
          <DisplayReportViewer
            displayReport={displayReport}
            editMode
            onTilesChange={setTiles}
          />
        </div>
      </div>
    </div>
  );
}
