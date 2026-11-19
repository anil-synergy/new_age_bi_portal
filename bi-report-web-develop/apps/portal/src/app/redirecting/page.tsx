"use client";

import { AILoadingAnimation } from "@/modules/loaders/components/AILoadingAnimation";

export default function RedirectingPage() {
  return (
    <div className="flex h-screen items-center justify-center">
      <AILoadingAnimation message="Redirecting…" />
    </div>
  );
}
