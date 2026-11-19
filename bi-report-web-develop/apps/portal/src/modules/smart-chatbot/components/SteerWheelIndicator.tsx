"use client";

import { LoaderIcon } from "@/modules/shared/components/animated-icons/LoaderIcon";
import { cn } from "@/lib/utils";

type SteerWheelIndicatorProps = {
  /** Looped loader animation while processing. */
  animated?: boolean;
  size?: number;
  label?: string;
  className?: string;
  labelClassName?: string;
};

export function SteerWheelIndicator({
  animated = true,
  size = 28,
  label,
  className,
  labelClassName,
}: SteerWheelIndicatorProps) {
  return (
    <div className={cn("flex items-center gap-2", className)} role="status" aria-live="polite">
      <LoaderIcon
        active={animated}
        size={size}
        isAnimated={!animated}
        className={cn("portal-animated-icon shrink-0 text-[var(--smart-accent)]", !animated && "text-current")}
        aria-hidden={!label}
      />
      {label ? <span className={cn("text-xs text-slate-500", labelClassName)}>{label}</span> : null}
    </div>
  );
}
