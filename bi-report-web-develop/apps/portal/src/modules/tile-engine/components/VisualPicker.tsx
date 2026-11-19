"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { models } from "powerbi-client";
import type { IEmbedConfiguration, Report } from "powerbi-client";
import { fetchEmbedToken } from "@/services/pbiEmbedService";
import type { EffectiveIdentity, TileConfig } from "@/types";
import { AILoadingAnimation } from "@/modules/loaders/components/AILoadingAnimation";
import { Button } from "@/modules/shared/components/ui/button";

const PowerBIEmbed = dynamic(
  () => import("powerbi-client-react").then((m) => m.PowerBIEmbed),
  { ssr: false }
);

interface VisualPickerProps {
  workspaceId: string;
  reportId: string;
  datasetId?: string;
  effectiveIdentity?: EffectiveIdentity;
  onPinVisual: (tile: Partial<TileConfig>) => void;
}

interface VisualInfo {
  pageName: string;
  pageDisplayName: string;
  visualName: string;
  visualTitle: string;
}

export function VisualPicker({
  workspaceId,
  reportId,
  datasetId,
  effectiveIdentity,
  onPinVisual,
}: VisualPickerProps) {
  const [embedConfig, setEmbedConfig] = useState<IEmbedConfiguration | null>(null);
  const [visuals, setVisuals] = useState<VisualInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEmbedToken({
      workspaceId,
      reportId,
      datasetId,
      embedType: "report",
      effectiveIdentity,
    }).then((token) => {
      setEmbedConfig({
        type: "report",
        id: reportId,
        embedUrl: token.embedUrl,
        accessToken: token.accessToken,
        tokenType: models.TokenType.Embed,
        settings: { panes: { filters: { visible: false }, pageNavigation: { visible: true } } },
      });
    }).catch(console.error);
  }, [workspaceId, reportId, datasetId, effectiveIdentity]);

  const loadVisuals = async (report: Report) => {
    const pages = await report.getPages();
    const all: VisualInfo[] = [];
    for (const page of pages) {
      const pageVisuals = await page.getVisuals();
      for (const v of pageVisuals) {
        all.push({
          pageName: page.name,
          pageDisplayName: page.displayName,
          visualName: v.name,
          visualTitle: v.title ?? v.name,
        });
      }
    }
    setVisuals(all);
    setLoading(false);
  };

  if (!embedConfig) {
    return <AILoadingAnimation stage="fetching-token" />;
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="h-64 overflow-hidden rounded border">
        <PowerBIEmbed
          embedConfig={embedConfig}
          cssClassName="h-full w-full"
          eventHandlers={new Map<string, (event?: CustomEvent) => void | Promise<void>>([
            ["loaded", async (e) => {
              const report = (e as CustomEvent<{ report: Report }>)?.detail?.report;
              if (report) await loadVisuals(report);
            }],
          ])}
        />
      </div>
      <div className="flex-1 overflow-auto">
        <h4 className="mb-2 text-sm font-semibold">Pin a visual</h4>
        {loading ? (
          <AILoadingAnimation stage="rendering" className="py-4" />
        ) : (
          <ul className="space-y-1">
            {visuals.map((v) => (
              <li key={`${v.pageName}-${v.visualName}`} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                <span>{v.pageDisplayName} → {v.visualTitle}</span>
                <Button
                  size="sm"
                  onClick={() =>
                    onPinVisual({
                      sourceType: "powerbi-visual",
                      workspaceId,
                      powerBiReportId: reportId,
                      datasetId,
                      pageName: v.pageName,
                      visualName: v.visualName,
                      title: v.visualTitle,
                      width: 480,
                      height: 320,
                    })
                  }
                >
                  Pin
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
