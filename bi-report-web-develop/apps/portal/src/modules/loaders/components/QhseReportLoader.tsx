"use client";

import { useEffect, useRef } from "react";
import { startQhseReportAnimation } from "../logic/qhse-report-animation";

export function QhseReportLoader({ visible }: { visible: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!visible || !hostRef.current || !canvasRef.current) return;
    return startQhseReportAnimation(canvasRef.current, hostRef.current);
  }, [visible]);

  if (!visible) return null;

  return (
    <div ref={hostRef} className="absolute inset-0 z-30 overflow-hidden bg-[#04060D]" role="status" aria-label="Loading report">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
