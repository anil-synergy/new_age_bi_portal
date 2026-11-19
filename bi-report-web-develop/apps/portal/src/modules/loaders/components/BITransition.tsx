"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { BILoader } from "./BILoader";

interface BITransitionProps {
  children: React.ReactNode;
  loading?: boolean;
  transitionKey?: string;
  label?: string;
  minLoadingMs?: number;
}

/** Liquid fade on `transitionKey` change; BI loader overlay while `loading`. */
export function BITransition({
  children,
  loading = false,
  transitionKey,
  label,
  minLoadingMs = 120,
}: BITransitionProps) {
  const [loadingHold, setLoadingHold] = useState(loading);
  const loadingStartedAt = useRef(loading ? Date.now() : 0);

  useEffect(() => {
    if (loading) {
      loadingStartedAt.current = Date.now();
      setLoadingHold(true);
      return;
    }
    const elapsed = loadingStartedAt.current ? Date.now() - loadingStartedAt.current : minLoadingMs;
    const timer = window.setTimeout(() => setLoadingHold(false), Math.max(0, minLoadingMs - elapsed));
    return () => window.clearTimeout(timer);
  }, [loading, minLoadingMs]);

  return (
    <div className="bi-transition-root">
      <div
        key={transitionKey}
        className={cn(
          "bi-transition-content bi-transition-content--enter",
          loadingHold && "bi-transition-content--covered"
        )}
        aria-hidden={loadingHold || undefined}
      >
        {children}
      </div>
      <BILoader visible={loadingHold} variant="contained" label={label} />
    </div>
  );
}
