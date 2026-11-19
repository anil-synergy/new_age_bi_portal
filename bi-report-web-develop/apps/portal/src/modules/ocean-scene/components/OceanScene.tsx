"use client";

import { useEffect, useRef } from "react";
import { HomeShip } from "@/modules/3d-model/components/HomeShip";
import type { ShipSceneEnvironment } from "@/modules/3d-model/types";
import { useTheme } from "@/modules/shared/providers/ThemeProvider";
import { createOceanEnvironment } from "../logic/createOceanEnvironment";

/**
 * The cinematic night-sea backdrop. It is the existing HomeShip (same model, renderer and
 * cursor-follow) with the ocean environment plugged in, so there is still one WebGL canvas.
 * Mount with next/dynamic and ssr: false.
 */
export function OceanScene() {
  const envRef = useRef<ShipSceneEnvironment | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    envRef.current?.setDayMode?.(theme === "light");
  }, [theme]);

  return (
    <HomeShip
      environment={createOceanEnvironment}
      onEnvironmentReady={(env) => {
        envRef.current = env;
        env.setDayMode?.(theme === "light");
      }}
    />
  );
}
