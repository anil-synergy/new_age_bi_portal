"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { models } from "powerbi-client";
import type { Embed, IEmbedConfiguration, Report } from "powerbi-client";
import { fetchEmbedToken } from "@/services/pbiEmbedService";
import type { EffectiveIdentity, PageACL } from "@/types";
import type { LoadingStage } from "@/modules/loaders/components/AILoadingAnimation";
import { BILoader } from "@/modules/loaders/components/BILoader";
import { QhseReportLoader } from "@/modules/loaders/components/QhseReportLoader";
import { REPORT_REFRESH_DONE_EVENT, REPORT_REFRESH_EVENT } from "@/lib/report-events";
import { extractPowerBiRequestId, formatEmbedUserMessage } from "@/lib/azure-embed/errors";
import { registerSnapshotTarget } from "../../../../snapshot_export/target";

const STAGE_LABELS: Record<Exclude<LoadingStage, "idle">, string> = {
  "fetching-token": "Acquiring secure embed token…",
  embedding: "Embedding report visuals…",
  rendering: "Rendering analytics…",
};

const PowerBIEmbed = dynamic(
  () => import("powerbi-client-react").then((m) => m.PowerBIEmbed),
  { ssr: false }
);

interface PowerBIReportTileProps {
  workspaceId: string;
  reportId: string;
  catalogId?: string;
  datasetId?: string;
  effectiveIdentity?: EffectiveIdentity;
  isSuperAdmin?: boolean;
  enablePagination?: boolean;
  pageACL?: PageACL[];
  userGroupIds?: string[];
  userId?: string;
  title?: string;
  className?: string;
  loaderScene?: "portal" | "classic";
}

export function PowerBIReportTile({
  workspaceId,
  reportId,
  catalogId,
  datasetId,
  effectiveIdentity,
  isSuperAdmin,
  pageACL = [],
  userGroupIds = [],
  userId,
  className,
  loaderScene = "portal",
}: PowerBIReportTileProps) {
  const [embedConfig, setEmbedConfig] = useState<IEmbedConfiguration | null>(null);
  const [stage, setStage] = useState<LoadingStage>("fetching-token");
  const [embedError, setEmbedError] = useState<string | null>(null);
  const reportRef = useRef<Report | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const pageAclRef = useRef(pageACL);
  const userIdRef = useRef(userId);
  const userGroupIdsRef = useRef(userGroupIds);
  pageAclRef.current = pageACL;
  userIdRef.current = userId;
  userGroupIdsRef.current = userGroupIds;

  const loadEmbed = useCallback(async () => {
    setStage("fetching-token");
    setEmbedError(null);
    setEmbedConfig(null);
    try {
      const token = await fetchEmbedToken({
        workspaceId,
        reportId,
        catalogId,
        datasetId,
        embedType: "report",
      });
      if (!token.embedUrl || !token.accessToken) {
        throw new Error("Azure Function returned an incomplete embed payload.");
      }
      setStage("embedding");
      setEmbedConfig({
        type: "report",
        id: token.reportId || reportId,
        embedUrl: token.embedUrl,
        accessToken: token.accessToken,
        tokenType: models.TokenType.Embed,
        permissions: models.Permissions.All,
        settings: {
          filterPaneEnabled: false,
          navContentPaneEnabled: true,
          panes: {
            filters: { visible: false, expanded: false },
            pageNavigation: { visible: true },
          },
          background: models.BackgroundType.Default,
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to embed report";
      setEmbedError(formatEmbedUserMessage(message));
      setStage("idle");
    }
  }, [workspaceId, reportId, catalogId, datasetId]);

  useEffect(() => {
    loadEmbed();
  }, [loadEmbed]);

  const applyPageACL = async (report: Report) => {
    const acl = pageAclRef.current;
    if (!acl.length) return;
    const pages = await report.getPages();
    const uid = userIdRef.current;
    const gids = userGroupIdsRef.current;
    const allowed = pages.filter((p) => {
      const entry = acl.find((a) => a.pageName === p.name);
      if (!entry) return true;
      if (!entry.allowedUserIds?.length && !entry.allowedGroupIds?.length) return true;
      if (uid && entry.allowedUserIds?.includes(uid)) return true;
      if (gids.some((g) => entry.allowedGroupIds?.includes(g))) return true;
      return false;
    });
    if (allowed.length > 0) {
      await report.setPage(allowed[0].name);
    }
  };

  useEffect(() => {
    if (stage !== "idle" || !reportRef.current || !canvasRef.current) return;
    return registerSnapshotTarget({ report: reportRef.current, canvas: canvasRef.current });
  }, [stage]);

  useEffect(() => {
    const handleRefresh = async () => {
      const report = reportRef.current;
      try {
        if (!report) return;
        const bookmark = await report.bookmarksManager.capture({ allPages: true });
        await report.refresh();
        if (bookmark?.state) {
          await report.bookmarksManager.applyState(bookmark.state);
        }
      } catch (e) {
        console.warn("[PowerBIReportTile] refresh failed", e);
      } finally {
        window.dispatchEvent(new Event(REPORT_REFRESH_DONE_EVENT));
      }
    };
    window.addEventListener(REPORT_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(REPORT_REFRESH_EVENT, handleRefresh);
  }, []);

  const eventHandlers = useMemo(
    () =>
      new Map<string, (event?: CustomEvent) => void | Promise<void>>([
        [
          "loaded",
          async (event) => {
            setStage("rendering");
            const report = (event as CustomEvent<{ report: Report }>)?.detail?.report;
            if (report) {
              reportRef.current = report;
              await applyPageACL(report);
            }
            window.setTimeout(() => setStage((s) => (s === "rendering" ? "idle" : s)), 4000);
          },
        ],
        ["rendered", () => setStage("idle")],
        [
          "error",
          (e) => {
            const detail = (e as CustomEvent)?.detail;
            let raw = "Power BI embed error";
            if (typeof detail === "string") raw = detail;
            else if (detail && typeof detail === "object") {
              const d = detail as {
                message?: string;
                detailedMessage?: string;
                errorCode?: string;
                technicalDetails?: unknown;
              };
              raw = [d.errorCode, d.message, d.detailedMessage].filter(Boolean).join(" — ") || raw;
            }
            const requestId = extractPowerBiRequestId(
              detail && typeof detail === "object" ? (detail as { technicalDetails?: unknown }).technicalDetails : undefined,
            );
            const userMsg = formatEmbedUserMessage(raw);
            setEmbedError(requestId ? `${userMsg} Power BI requestId: ${requestId}.` : userMsg);
            setStage("idle");
          },
        ],
      ]),
    [],
  );

  if (embedError) {
    return (
      <div className={className ?? "flex h-full flex-col items-center justify-center gap-3 p-6 text-center"}>
        <p className="text-sm font-medium text-red-600">Could not embed this report</p>
        <p className="max-w-md text-sm text-slate-600">{embedError}</p>
        <p className="max-w-md text-[11px] text-slate-400">
          Technical code is shown above when applicable. Fix is usually in Fabric/Power BI (dataset credentials or workspace access), not in the portal UI.
        </p>
        <button
          type="button"
          className="rounded bg-primary px-4 py-2 text-sm text-white"
          onClick={() => loadEmbed()}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div ref={canvasRef} className={`relative h-full w-full overflow-hidden ${className ?? ""}`}>
      {embedConfig && (
        <PowerBIEmbed
          embedConfig={embedConfig}
          eventHandlers={eventHandlers}
          cssClassName="h-full w-full"
          getEmbeddedComponent={(embed: Embed) => {
            reportRef.current = embed as Report;
          }}
        />
      )}
      {loaderScene === "classic" ? (
        <QhseReportLoader visible={!embedConfig || stage !== "idle"} />
      ) : (
        <BILoader
          variant="contained"
          scene="portal"
          visible={!embedConfig || stage !== "idle"}
          label={STAGE_LABELS[stage === "idle" ? "rendering" : stage]}
        />
      )}
    </div>
  );
}