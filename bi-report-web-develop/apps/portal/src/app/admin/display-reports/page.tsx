"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/modules/layout/components/Header";
import { Button } from "@/modules/shared/components/ui/button";
import { getDisplayReports, getReports } from "@/services/biServices";
import type { DisplayReport, PortalReport } from "@/types";

const DisplayReportBuilder = dynamic(
  () => import("@/modules/admin/components/DisplayReportBuilder").then((m) => m.DisplayReportBuilder),
  { ssr: false }
);

export default function AdminDisplayReportsPage() {
  const [displays, setDisplays] = useState<DisplayReport[]>([]);
  const [reports, setReports] = useState<PortalReport[]>([]);
  const [showBuilder, setShowBuilder] = useState(false);

  const load = () => {
    getDisplayReports().then(setDisplays).catch(() => setDisplays([]));
    getReports().then(setReports).catch(() => setReports([]));
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="relative h-full min-h-0 bg-background">
      <Header title="Display Reports" />
      <div className="absolute inset-0 overflow-auto px-6 pb-6 pt-16">
        <div className="mb-4 flex gap-2">
          <Button onClick={() => setShowBuilder(!showBuilder)}>
            {showBuilder ? "Hide Builder" : "Create Display Report"}
          </Button>
        </div>
        {showBuilder ? (
          <DisplayReportBuilder reports={reports} onSaved={() => { setShowBuilder(false); load(); }} />
        ) : (
          <ul className="space-y-2">
            {displays.map((d) => (
              <li key={d.id} className="flex items-center justify-between rounded border p-3">
                <span>{d.name} ({d.tiles.length} tiles)</span>
                <Link href={`/display/${d.id}`} className="text-sm text-primary underline">View</Link>
              </li>
            ))}
            {displays.length === 0 && (
              <p className="text-sm text-slate-500">No display reports yet. Create one to combine multiple Power BI reports.</p>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
