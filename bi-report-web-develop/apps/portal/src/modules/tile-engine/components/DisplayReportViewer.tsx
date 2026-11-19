"use client";

import { useMemo } from "react";
import type { DisplayReport, EffectiveIdentity, PageACL } from "@/types";
import { TileCanvas } from "./TileCanvas";
import { Tile } from "./Tile";

interface DisplayReportViewerProps {
  displayReport: DisplayReport;
  editMode?: boolean;
  effectiveIdentity?: EffectiveIdentity;
  isSuperAdmin?: boolean;
  pageACL?: PageACL[];
  userGroupIds?: string[];
  userId?: string;
  onTilesChange?: (tiles: DisplayReport["tiles"]) => void;
}

export function DisplayReportViewer({
  displayReport,
  editMode = false,
  effectiveIdentity,
  isSuperAdmin,
  pageACL,
  userGroupIds,
  userId,
  onTilesChange,
}: DisplayReportViewerProps) {
  const sortedTiles = useMemo(
    () => [...displayReport.tiles].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)),
    [displayReport.tiles]
  );

  const handleTileChange = (updated: DisplayReport["tiles"][0]) => {
    onTilesChange?.(displayReport.tiles.map((t) => (t.id === updated.id ? updated : t)));
  };

  const handleRemove = (id: string) => {
    onTilesChange?.(displayReport.tiles.filter((t) => t.id !== id));
  };

  return (
    <TileCanvas width={displayReport.canvasWidth} height={displayReport.canvasHeight}>
      {sortedTiles.map((tile) => (
        <Tile
          key={tile.id}
          tile={tile}
          editMode={editMode}
          effectiveIdentity={effectiveIdentity}
          isSuperAdmin={isSuperAdmin}
          pageACL={pageACL}
          userGroupIds={userGroupIds}
          userId={userId}
          onChange={handleTileChange}
          onRemove={handleRemove}
        />
      ))}
    </TileCanvas>
  );
}
