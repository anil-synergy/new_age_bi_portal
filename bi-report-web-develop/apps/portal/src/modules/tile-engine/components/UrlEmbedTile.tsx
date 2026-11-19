"use client";

import { useState } from "react";
import { TileToolbar } from "./TileToolbar";
import { AILoadingAnimation } from "@/modules/loaders/components/AILoadingAnimation";
import { Button } from "@/modules/shared/components/ui/button";

interface UrlEmbedTileProps {
  url: string;
  title?: string;
}

export function UrlEmbedTile({ url, title }: UrlEmbedTileProps) {
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);

  return (
    <div className="relative h-full w-full overflow-hidden rounded border border-slate-200 bg-white">
      <TileToolbar title={title} onRefresh={() => { setLoading(true); setBlocked(false); }} />
      {loading && !blocked && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80">
          <AILoadingAnimation stage="embedding" />
        </div>
      )}
      {blocked ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
          <p className="text-sm text-slate-600">This URL cannot be embedded (X-Frame-Options may block it).</p>
          <Button asChild variant="outline" size="sm">
            <a href={url} target="_blank" rel="noopener noreferrer">Open in new tab</a>
          </Button>
        </div>
      ) : (
        <iframe
          src={url}
          title={title ?? "Embedded content"}
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          onLoad={() => setLoading(false)}
          onError={() => { setLoading(false); setBlocked(true); }}
        />
      )}
    </div>
  );
}
