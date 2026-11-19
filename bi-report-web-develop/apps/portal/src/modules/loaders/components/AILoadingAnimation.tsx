"use client";

import { BILoader } from "./BILoader";

export type LoadingStage = "fetching-token" | "embedding" | "rendering" | "idle";

const STAGE_LABELS: Record<LoadingStage, string> = {
  "fetching-token": "Acquiring secure embed token…",
  embedding: "Embedding report visuals…",
  rendering: "Rendering analytics…",
  idle: "Loading…",
};

interface AILoadingAnimationProps {
  stage?: LoadingStage;
  className?: string;
  message?: string;
}

export function AILoadingAnimation({ stage = "idle", className, message }: AILoadingAnimationProps) {
  return <BILoader variant="inline" label={message ?? STAGE_LABELS[stage]} className={className} />;
}
