"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface LensRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface GlassTrayProps {
  /** data-tray-id of the currently selected item; lens hides when null. */
  activeId: string | null;
  className?: string;
  children: React.ReactNode;
}

/**
 * A liquid-glass navigation tray: a translucent, blurred pill that holds icon buttons and a single
 * shared "lens" indicator which glides beneath whichever item is active, stretching gently along
 * the direction of travel before settling into a rounded pill.
 */
export function GlassTray({ activeId, className, children }: GlassTrayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<LensRect | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const target = activeId
        ? container.querySelector<HTMLElement>(`[data-tray-id="${activeId}"]`)
        : null;
      if (!target) {
        setRect(null);
        return;
      }
      const containerBox = container.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      setRect({
        left: box.left - containerBox.left,
        top: box.top - containerBox.top,
        width: box.width,
        height: box.height,
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    window.addEventListener("resize", measure);
    const raf = requestAnimationFrame(measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(raf);
    };
    // children is not referenced directly but a reflow (e.g. SMART unmounting) should re-measure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, children]);

  const positionTransition = reduceMotion
    ? { duration: 0.15, ease: "easeOut" as const }
    : { type: "spring" as const, stiffness: 380, damping: 32, mass: 0.7 };

  const stretchTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.52, ease: [0.22, 1, 0.36, 1] as const };

  return (
    <div ref={containerRef} className={cn("glass-tray", className)}>
      {rect && (
        <motion.span
          key="glass-lens"
          className="glass-tray__lens"
          initial={false}
          animate={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            scaleX: reduceMotion ? 1 : [1, 1.08, 1],
            scaleY: reduceMotion ? 1 : [1, 0.96, 1],
          }}
          transition={{
            left: positionTransition,
            top: positionTransition,
            width: positionTransition,
            height: positionTransition,
            scaleX: stretchTransition,
            scaleY: stretchTransition,
          }}
        >
          {!reduceMotion && (
            <motion.span
              key={activeId}
              className="glass-tray__lens-sheen"
              initial={{ x: "-120%" }}
              animate={{ x: "120%" }}
              transition={{ duration: 0.52, ease: [0.22, 1, 0.36, 1] }}
            />
          )}
        </motion.span>
      )}
      {children}
    </div>
  );
}
