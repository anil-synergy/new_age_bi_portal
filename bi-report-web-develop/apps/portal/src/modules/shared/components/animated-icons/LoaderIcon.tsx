"use client";

import { cn } from "@/lib/utils";
import { LazyMotion, domMin, m, useAnimation, useReducedMotion, type Variants } from "framer-motion";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, type HTMLAttributes } from "react";

export interface LoaderIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface LoaderIconProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  | "color"
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration"
> {
  size?: number;
  duration?: number;
  isAnimated?: boolean;
  /** Continuous processing loop (e.g. SMART thinking state). */
  active?: boolean;
  color?: string;
}

const LoaderIcon = forwardRef<LoaderIconHandle, LoaderIconProps>(
  (
    {
      onMouseEnter,
      onMouseLeave,
      className,
      size = 24,
      duration = 1,
      isAnimated = true,
      active = false,
      color,
      ...props
    },
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

    useEffect(() => {
      if (!active || reduced) {
        if (!active) controls.start("normal");
        return;
      }
      void controls.start("animate");
    }, [active, reduced, controls]);

    const handleEnter = useCallback(
      (e?: React.MouseEvent<HTMLDivElement>) => {
        if (active || !isAnimated || reduced) return;
        if (!isControlled.current) void controls.start("animate");
        else onMouseEnter?.(e as React.MouseEvent<HTMLDivElement>);
      },
      [active, controls, reduced, isAnimated, onMouseEnter],
    );

    const handleLeave = useCallback(
      (e?: React.MouseEvent<HTMLDivElement>) => {
        if (active) return;
        if (!isControlled.current) void controls.start("normal");
        else onMouseLeave?.(e as React.MouseEvent<HTMLDivElement>);
      },
      [active, controls, onMouseLeave],
    );

    const spokeVariants = (i: number): Variants => ({
      normal: { opacity: 1, scale: 1 },
      animate: {
        opacity: [1, 0.2, 1],
        scale: [1, 0.8, 1],
        transition: {
          duration: 0.4 * duration,
          ease: "easeInOut",
          delay: i * 0.05 * duration,
          ...(active ? { repeat: Infinity } : {}),
        },
      },
    });

    return (
      <LazyMotion features={domMin} strict>
        <m.div
          className={cn("inline-flex items-center justify-center", className)}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          role={active ? "status" : undefined}
          aria-live={active ? "polite" : undefined}
          {...props}
          style={{ color, ...props.style }}
        >
          <m.svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            animate={controls}
            initial="normal"
          >
            <m.path d="M12 2v4" variants={spokeVariants(0)} />
            <m.path d="m16.2 7.8 2.9-2.9" variants={spokeVariants(1)} />
            <m.path d="M18 12h4" variants={spokeVariants(2)} />
            <m.path d="m16.2 16.2 2.9 2.9" variants={spokeVariants(3)} />
            <m.path d="M12 18v4" variants={spokeVariants(4)} />
            <m.path d="m4.9 19.1 2.9-2.9" variants={spokeVariants(5)} />
            <m.path d="M2 12h4" variants={spokeVariants(6)} />
            <m.path d="m4.9 4.9 2.9 2.9" variants={spokeVariants(7)} />
          </m.svg>
        </m.div>
      </LazyMotion>
    );
  },
);

LoaderIcon.displayName = "LoaderIcon";
export { LoaderIcon };
