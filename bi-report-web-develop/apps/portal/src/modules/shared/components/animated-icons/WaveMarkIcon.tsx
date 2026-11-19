"use client";

import { cn } from "@/lib/utils";
import { LazyMotion, domMin, m, useAnimation, useReducedMotion, type Variants } from "framer-motion";
import { forwardRef, useCallback, useImperativeHandle, useRef, type HTMLAttributes } from "react";

export interface WaveMarkIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

const WAVES = [
  {
    d: "M1 5c4 0 4-3 8-3s4 3 8 3 4-3 8-3 4 3 8 3 4-3 6-3",
    stroke: "#333869",
    opacity: 1,
    originY: 5,
    delay: 0.05,
  },
  {
    d: "M1 12c4 0 4-3 8-3s4 3 8 3 4-3 8-3 4 3 8 3 4-3 6-3",
    stroke: "#333869",
    opacity: 0.62,
    originY: 12,
    delay: 0.17,
  },
  {
    d: "M1 19c4 0 4-3 8-3s4 3 8 3 4-3 8-3 4 3 8 3 4-3 6-3",
    stroke: "#1aa6a0",
    opacity: 1,
    originY: 19,
    delay: 0.29,
  },
] as const;

interface WaveMarkIconProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  | "color"
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration"
> {
  width?: number;
  height?: number;
  duration?: number;
  isAnimated?: boolean;
}

const WaveMarkIcon = forwardRef<WaveMarkIconHandle, WaveMarkIconProps>(
  (
    { onMouseEnter, onMouseLeave, className, width = 32, height = 18, duration = 1, isAnimated = true, ...props },
    ref,
  ) => {
    const controls = useAnimation();
    const reduced = useReducedMotion();
    const isControlled = useRef(false);

    useImperativeHandle(ref, () => {
      isControlled.current = true;
      return {
        startAnimation: () => (reduced ? controls.start("normal") : controls.start("animate")),
        stopAnimation: () => controls.start("normal"),
      };
    });

    const handleEnter = useCallback(
      (e?: React.MouseEvent<HTMLDivElement>) => {
        if (!isAnimated || reduced) return;
        if (!isControlled.current) controls.start("animate");
        else onMouseEnter?.(e as React.MouseEvent<HTMLDivElement>);
      },
      [controls, reduced, isAnimated, onMouseEnter],
    );

    const handleLeave = useCallback(
      (e?: React.MouseEvent<HTMLDivElement>) => {
        if (!isControlled.current) controls.start("normal");
        else onMouseLeave?.(e as React.MouseEvent<HTMLDivElement>);
      },
      [controls, onMouseLeave],
    );

    const rowVariants = (delay: number): Variants => ({
      normal: { scaleX: 1 },
      animate: {
        scaleX: [1, 0.55, 1],
        transition: {
          duration: 0.5 * duration,
          ease: "easeInOut",
          delay: delay * duration,
        },
      },
    });

    return (
      <LazyMotion features={domMin} strict>
        <m.div
          className={cn("inline-flex items-center justify-center bg-transparent", className)}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          {...props}
        >
          <m.svg
            viewBox="0 0 40 24"
            width={width}
            height={height}
            fill="none"
            aria-hidden
            animate={controls}
            initial="normal"
          >
            {WAVES.map((wave) => (
              <m.path
                key={wave.originY}
                d={wave.d}
                stroke={wave.stroke}
                strokeWidth="1.35"
                strokeLinecap="round"
                opacity={wave.opacity}
                variants={rowVariants(wave.delay)}
                style={{ transformBox: "view-box", originX: "1px", originY: `${wave.originY}px` }}
              />
            ))}
          </m.svg>
        </m.div>
      </LazyMotion>
    );
  },
);

WaveMarkIcon.displayName = "WaveMarkIcon";
export { WaveMarkIcon };