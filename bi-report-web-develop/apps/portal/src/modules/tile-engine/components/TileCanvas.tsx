"use client";

import { cn } from "@/lib/utils";

interface TileCanvasProps {
  width?: number;
  height?: number;
  scale?: number;
  editMode?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function TileCanvas({
  width = 1920,
  height = 1080,
  scale = 1,
  className,
  children,
}: TileCanvasProps) {
  return (
    <div className={cn("tile-canvas w-full overflow-auto bg-slate-100", className)} style={{ height: "calc(100vh - 40px)" }}>
      <div
        className="tile-surface relative origin-top-left bg-white shadow-inner"
        style={{
          minWidth: width,
          minHeight: height,
          width,
          height,
          transform: scale !== 1 ? `scale(${scale})` : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
