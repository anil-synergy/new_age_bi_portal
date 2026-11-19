"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { models } from "powerbi-client";
import type { Embed, IEmbedConfiguration, Page, Report } from "powerbi-client";

interface ReloadableVisual {
  reload: () => Promise<void>;
}
import { fetchEmbedToken } from "@/services/pbiEmbedService";
import type { EffectiveIdentity } from "@/types";
import { AILoadingAnimation, type LoadingStage } from "@/modules/loaders/components/AILoadingAnimation";
import { TileToolbar } from "./TileToolbar";

const PowerBIEmbed = dynamic(
  () => import("powerbi-client-react").then((m) => m.PowerBIEmbed),
  { ssr: false }
);

interface PowerBIVisualTileProps {
  workspaceId: string;
  reportId: string;
  pageName: string;
  visualName: string;
  datasetId?: string;
  effectiveIdentity?: EffectiveIdentity;
  isSuperAdmin?: boolean;
  title?: string;
}

export function PowerBIVisualTile({
  workspaceId,
  reportId,
  pageName,
  visualName,
  datasetId,
  effectiveIdentity,
  isSuperAdmin,
  title,
}: PowerBIVisualTileProps) {
  const [embedConfig, setEmbedConfig] = useState<IEmbedConfiguration | null>(null);
  const [stage, setStage] = useState<LoadingStage>("fetching-token");
  const [refreshing, setRefreshing] = useState(false);
  const visualRef = useRef<ReloadableVisual | null>(null);
  const pageRef = useRef<Page | null>(null);

  const loadEmbed = useCallback(async () => {
    setStage("fetching-token");
    try {
      const token = await fetchEmbedToken({
        workspaceId,
        reportId,
        datasetId,
        pageName,
        visualName,
        embedType: "visual",
        effectiveIdentity,
        isSuperAdmin,
      });
      setStage("embedding");
      setEmbedConfig({
        type: "visual",
        id: visualName,
        pageName,
        embedUrl: token.embedUrl,
        accessToken: token.accessToken,
        tokenType: models.TokenType.Embed,
      });
    } catch (e) {
      console.error(e);
      setStage("idle");
    }
  }, [workspaceId, reportId, datasetId, pageName, visualName, effectiveIdentity, isSuperAdmin]);

  useEffect(() => {
    loadEmbed();
  }, [loadEmbed]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (visualRef.current) {
        await visualRef.current.reload();
      } else if (pageRef.current) {
        const visual = (await pageRef.current.getVisualByName(visualName)) as unknown as ReloadableVisual;
        await visual.reload();
      }
    } finally {
      setRefreshing(false);
    }
  };

  const visualNameRef = useRef(visualName);
  const pageNameRef = useRef(pageName);
  visualNameRef.current = visualName;
  pageNameRef.current = pageName;

  const eventHandlers = useMemo(
    () =>
      new Map<string, (event?: CustomEvent) => void | Promise<void>>([
        [
          "loaded",
          async (event) => {
            setStage("rendering");
            const report = (event as CustomEvent<{ report: Report }>)?.detail?.report;
            if (report) {
              const pages = await report.getPages();
              const page = pages.find((p) => p.name === pageNameRef.current) ?? pages[0];
              pageRef.current = page;
              try {
                visualRef.current = (await page.getVisualByName(visualNameRef.current)) as unknown as ReloadableVisual;
              } catch {
                /* visual handle may not be available for visual embed type */
              }
            }
            setStage("idle");
          },
        ],
        ["rendered", () => setStage("idle")],
      ]),
    [],
  );

  if (!embedConfig) {
    return (
      <div className="flex h-full items-center justify-center">
        <AILoadingAnimation stage={stage} />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded border border-slate-200 bg-white">
      {stage !== "idle" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80">
          <AILoadingAnimation stage={stage} />
        </div>
      )}
      <TileToolbar title={title ?? visualName} onRefresh={handleRefresh} refreshing={refreshing} />
      <PowerBIEmbed
        embedConfig={embedConfig}
        eventHandlers={eventHandlers}
        cssClassName="h-full w-full"
        getEmbeddedComponent={(embed: Embed) => {
          if (embed.embedtype === "visual") {
            visualRef.current = embed as ReloadableVisual;
          }
        }}
      />
    </div>
  );
}
