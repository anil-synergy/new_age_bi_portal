"use client";

import { RefreshCw, Maximize2, X } from "lucide-react";
import { Button } from "@/modules/shared/components/ui/button";

interface TileToolbarProps {
  title?: string;
  onRefresh?: () => void;
  onExpand?: () => void;
  onRemove?: () => void;
  showRemove?: boolean;
  refreshing?: boolean;
}

export function TileToolbar({
  title,
  onRefresh,
  onExpand,
  onRemove,
  showRemove = false,
  refreshing = false,
}: TileToolbarProps) {
  return (
    <div className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-md bg-white/90 p-1 shadow-sm backdrop-blur">
      {title && <span className="mr-2 max-w-[120px] truncate text-xs text-slate-600">{title}</span>}
      {onRefresh && (
        <Button variant="ghost" size="icon" onClick={onRefresh} disabled={refreshing} title="Refresh visual">
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      )}
      {onExpand && (
        <Button variant="ghost" size="icon" onClick={onExpand} title="Expand">
          <Maximize2 className="h-4 w-4" />
        </Button>
      )}
      {showRemove && onRemove && (
        <Button variant="ghost" size="icon" onClick={onRemove} title="Remove tile">
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
