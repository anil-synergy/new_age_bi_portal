"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

const step = (i: number) => ({ "--i": i }) as CSSProperties;

interface BILoaderProps {
  visible?: boolean;
  variant?: "fullscreen" | "contained" | "inline";
  scene?: "portal" | "classic";
  label?: string;
  className?: string;
}

const STAGES = ["Power BI", "Fabric", "Data", "Report"];

export function BILoader({ visible = true, variant = "inline", scene = "portal", label, className }: BILoaderProps) {
  const classic = scene === "classic";
  return (
    <div
      className={cn("bi-loader", `bi-loader--${variant}`, classic && "bi-loader--classic", visible && "bi-loader--visible", className)}
      role={visible ? "status" : undefined}
      aria-live="polite"
      aria-label={visible ? label ?? "Loading" : undefined}
      aria-hidden={!visible}
    >
      <div className="bi-loader__scene" aria-hidden="true">
        {classic && (
          <>
            <span className="bi-loader__ring bi-loader__ring--outer" />
            <span className="bi-loader__ring bi-loader__ring--mid" />
            <span className="bi-loader__ring bi-loader__ring--spin" />
          </>
        )}
        <svg className="bi-loader__icons" viewBox="0 0 120 120">
          <g className="bi-icon" style={step(0)}>
            <rect pathLength={1} x="28" y="62" width="16" height="30" rx="3" />
            <rect pathLength={1} x="52" y="42" width="16" height="50" rx="3" />
            <rect pathLength={1} x="76" y="22" width="16" height="70" rx="3" />
            <path pathLength={1} d="M28 100 H92" />
          </g>
          <g className="bi-icon" style={step(1)}>
            <path pathLength={1} d="M38 18 L84 18 L84 36 L58 36 L58 50 L78 50 L78 68 L58 68 L58 102 L38 90 Z" />
            <path pathLength={1} d="M58 36 L38 18" />
            <path pathLength={1} d="M58 68 L78 50" />
          </g>
          <g className="bi-icon" style={step(2)}>
            <ellipse pathLength={1} cx="60" cy="30" rx="30" ry="10" />
            <path pathLength={1} d="M30 30 V88 C30 94 43 100 60 100 C77 100 90 94 90 88 V30" />
            <path pathLength={1} d="M30 52 C30 58 43 64 60 64 C77 64 90 58 90 52" />
            <path pathLength={1} d="M30 70 C30 76 43 82 60 82 C77 82 90 76 90 70" />
          </g>
          <g className="bi-icon" style={step(3)}>
            <rect pathLength={1} x="26" y="16" width="68" height="88" rx="7" />
            <path pathLength={1} d="M40 32 H70" />
            <path pathLength={1} d="M42 88 V70" />
            <path pathLength={1} d="M56 88 V58" />
            <path pathLength={1} d="M70 88 V48" />
            <path pathLength={1} d="M82 88 V64" />
            <path pathLength={1} d="M38 56 L52 44 L64 50 L80 36" />
          </g>
        </svg>
        {classic && (
          <>
            <i className="bi-loader__dust bi-loader__dust--a" />
            <i className="bi-loader__dust bi-loader__dust--b" />
            <i className="bi-loader__dust bi-loader__dust--c" />
            <i className="bi-loader__dust bi-loader__dust--d" />
            <i className="bi-loader__dust bi-loader__dust--e" />
            <i className="bi-loader__dust bi-loader__dust--f" />
          </>
        )}
      </div>
      {classic && (
        <>
          <div className="bi-loader__captions" aria-hidden="true">
            {STAGES.map((name, index) => (
              <span key={name} className="bi-loader__caption" style={step(index)}>
                {name}
              </span>
            ))}
          </div>
          <div className="bi-loader__steps" aria-hidden="true">
            {STAGES.map((name, index) => (
              <span key={name} className="bi-loader__step" style={step(index)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
