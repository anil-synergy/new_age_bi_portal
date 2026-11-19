"use client";

import { Rnd } from "react-rnd";
import type { TileConfig, EffectiveIdentity, PageACL } from "@/types";
import { PowerBIReportTile } from "./PowerBIReportTile";
import { PowerBIVisualTile } from "./PowerBIVisualTile";
import { UrlEmbedTile } from "./UrlEmbedTile";

interface TileProps {
  tile: TileConfig;
  editMode?: boolean;
  effectiveIdentity?: EffectiveIdentity;
  isSuperAdmin?: boolean;
  pageACL?: PageACL[];
  userGroupIds?: string[];
  userId?: string;
  onChange?: (tile: TileConfig) => void;
  onRemove?: (id: string) => void;
}

export function Tile({
  tile,
  editMode = false,
  effectiveIdentity,
  isSuperAdmin,
  pageACL,
  userGroupIds,
  userId,
  onChange,
  onRemove,
}: TileProps) {
  const content = () => {
    switch (tile.sourceType) {
      case "powerbi-report":
        return tile.workspaceId && tile.powerBiReportId ? (
          <PowerBIReportTile
            workspaceId={tile.workspaceId}
            reportId={tile.powerBiReportId}
            datasetId={tile.datasetId}
            effectiveIdentity={effectiveIdentity}
            isSuperAdmin={isSuperAdmin}
            pageACL={pageACL}
            userGroupIds={userGroupIds}
            userId={userId}
            title={tile.title}
          />
        ) : null;
      case "powerbi-visual":
        return tile.workspaceId && tile.powerBiReportId && tile.pageName && tile.visualName ? (
          <PowerBIVisualTile
            workspaceId={tile.workspaceId}
            reportId={tile.powerBiReportId}
            pageName={tile.pageName}
            visualName={tile.visualName}
            datasetId={tile.datasetId}
            effectiveIdentity={effectiveIdentity}
            isSuperAdmin={isSuperAdmin}
            title={tile.title}
          />
        ) : null;
      case "url":
        return tile.url ? <UrlEmbedTile url={tile.url} title={tile.title} /> : null;
      default:
        return null;
    }
  };

  if (editMode) {
    return (
      <Rnd
        size={{ width: tile.width, height: tile.height }}
        position={{ x: tile.x, y: tile.y }}
        onDragStop={(_e, d) => onChange?.({ ...tile, x: d.x, y: d.y })}
        onResizeStop={(_e, _dir, ref, _delta, position) =>
          onChange?.({
            ...tile,
            width: parseInt(ref.style.width, 10),
            height: parseInt(ref.style.height, 10),
            x: position.x,
            y: position.y,
          })
        }
        bounds="parent"
        className="rounded border-2 border-dashed border-primary/40 bg-white shadow-md"
        style={{ zIndex: tile.zIndex ?? 1 }}
      >
        <div className="relative h-full w-full overflow-hidden">
          {content()}
          {onRemove && (
            <button
              type="button"
              className="absolute left-2 top-2 z-30 rounded bg-red-500 px-2 py-0.5 text-xs text-white"
              onClick={() => onRemove(tile.id)}
            >
              Remove
            </button>
          )}
        </div>
      </Rnd>
    );
  }

  return (
    <div
      className="absolute overflow-hidden rounded border border-slate-200 bg-white shadow-sm"
      style={{
        left: tile.x,
        top: tile.y,
        width: tile.width,
        height: tile.height,
        zIndex: tile.zIndex ?? 1,
      }}
    >
      {content()}
    </div>
  );
}
