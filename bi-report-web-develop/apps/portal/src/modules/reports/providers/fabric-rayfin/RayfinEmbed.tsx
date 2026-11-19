"use client";

import { useEffect, useRef, useState } from "react";
import { createEmbedHost } from "@microsoft/rayfin-embed-host";
import { AILoadingAnimation } from "@/modules/loaders/components/AILoadingAnimation";

interface RayfinEmbedProps {
  appUrl: string;
  appOrigin: string;
  getAccessToken: () => Promise<string>;
  /** Used by parent remount via `key`; no in-embed reload control. */
  onReload?: () => void;
}

/**
 * Hosts the Rayfin app in an iframe and brokers its external-Entra handshake.
 * The embed host must be registered before the iframe mounts.
 */
export function RayfinEmbed({ appUrl, appOrigin, getAccessToken }: RayfinEmbedProps) {
  const [hostReady, setHostReady] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const getTokenRef = useRef(getAccessToken);
  getTokenRef.current = getAccessToken;

  useEffect(() => {
    const host = createEmbedHost({
      allowedOrigins: [appOrigin],
      getAccessToken: () => getTokenRef.current(),
    });
    setHostReady(true);

    return () => {
      host.dispose();
      setHostReady(false);
    };
  }, [appOrigin]);

  return (
    <div className="relative h-full min-h-0 bg-white">
      {!frameLoaded && (
        <div className="absolute inset-0 z-10 bg-white">
          <AILoadingAnimation stage="embedding" message="Loading Rayfin app…" />
        </div>
      )}
      {hostReady && (
        <iframe
          title="Rayfin Fabric Application"
          src={appUrl}
          allow="clipboard-read; clipboard-write"
          className="h-full w-full border-0"
          onLoad={() => setFrameLoaded(true)}
        />
      )}
    </div>
  );
}