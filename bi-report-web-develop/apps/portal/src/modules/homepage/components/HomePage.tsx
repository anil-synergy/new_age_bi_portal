"use client";

import dynamic from "next/dynamic";
import { Header } from "@/modules/layout/components/Header";
import { useVisualBox, VisualBoxButton, VisualBoxWindow, PinnedHomeBoard } from "@/modules/visual-box/visual-box";

// WebGL is browser-only: never server-render the scene.
const OceanScene = dynamic(() => import("@/modules/ocean-scene/components/OceanScene").then((mod) => mod.OceanScene), { ssr: false });

export default function DashboardHomePage() {
  const { items } = useVisualBox();
  const showShip = items.every((item) => !item.onHome);

  return (
    <div className="night-home flex h-full min-h-0 flex-col overflow-hidden">
      <Header title="Home" />
      <div className="night-backdrop relative min-h-0 flex-1 overflow-hidden">
        {showShip ? (
          <div className="absolute inset-0">
            <OceanScene />
          </div>
        ) : (
          <PinnedHomeBoard />
        )}
        <div className="night-vignette pointer-events-none absolute inset-0 z-[1]" aria-hidden />
        <VisualBoxButton />
        <VisualBoxWindow />
      </div>
    </div>
  );
}
