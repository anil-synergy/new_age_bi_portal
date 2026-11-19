import { useEffect, useRef, useState } from "react";
import "./bi-transition.css";

/**
 * BITransition  (monochrome edition)
 *
 * Same API as before - drop-in replacement.
 * - loading: true while required data is loading
 * - transitionKey: change this when the active route/page changes
 *
 * While visible, the loader plays a looping sequence of line icons:
 *   Power BI  ->  Fabric  ->  Data  ->  Report
 * White strokes on pure black, nothing else.
 *
 * NOTE: the Power BI and Fabric glyphs below are simplified line drawings
 * made for this animation. If you have licence to use the official Microsoft
 * artwork, replace the <path>/<rect> children inside each <g class="bi-icon">
 * with the official outlines (keep pathLength="1" on each shape so the
 * stroke-draw effect still works).
 */

const STAGES = [
  { id: "powerbi", name: "Power BI" },
  { id: "fabric", name: "Fabric" },
  { id: "data", name: "Data" },
  { id: "report", name: "Report" },
];

export default function BITransition({
  children,
  loading = false,
  transitionKey,
  label = "Loading your dashboard",
  minLoadingMs = 450,
  transitionMs = 850,
}) {
  const [loadingHold, setLoadingHold] = useState(Boolean(loading));
  const [transitionActive, setTransitionActive] = useState(false);
  const [cycle, setCycle] = useState(0);
  const loadingStartedAt = useRef(loading ? Date.now() : 0);
  const transitionTimer = useRef(null);
  const previousKey = useRef(transitionKey);

  // Keep the loader visible for a minimum time to avoid a distracting flash.
  useEffect(() => {
    let timer;
    if (loading) {
      setLoadingHold(true);
      loadingStartedAt.current = Date.now();
    } else {
      const elapsed = loadingStartedAt.current
        ? Date.now() - loadingStartedAt.current
        : minLoadingMs;
      const remaining = Math.max(0, minLoadingMs - elapsed);
      timer = window.setTimeout(() => setLoadingHold(false), remaining);
    }
    return () => window.clearTimeout(timer);
  }, [loading, minLoadingMs]);

  // Brief transition overlay when the route/page key changes.
  useEffect(() => {
    if (previousKey.current === transitionKey) return;
    previousKey.current = transitionKey;

    window.clearTimeout(transitionTimer.current);
    setTransitionActive(true);
    transitionTimer.current = window.setTimeout(
      () => setTransitionActive(false),
      transitionMs
    );
  }, [transitionKey, transitionMs]);

  useEffect(() => () => window.clearTimeout(transitionTimer.current), []);

  const visible = loadingHold || transitionActive;

  // Restart the Power BI -> Fabric -> Data -> Report sequence on every show.
  useEffect(() => {
    if (visible) setCycle((c) => c + 1);
  }, [visible]);

  return (
    <div className="bi-transition-root">
      <div
        className={`bi-transition-content${visible ? " bi-transition-content--covered" : ""}`}
        aria-hidden={visible ? "true" : undefined}
      >
        {children}
      </div>

      <div
        className={`bi-loader${visible ? " bi-loader--visible" : ""}`}
        role={visible ? "status" : undefined}
        aria-live="polite"
        aria-label={visible ? label : undefined}
        aria-hidden={!visible}
      >
        <div className="bi-loader__scene" key={cycle} aria-hidden="true">
          {/* Backdrop: concentric hairlines + a slow dashed ring */}
          <span className="bi-loader__ring bi-loader__ring--outer" />
          <span className="bi-loader__ring bi-loader__ring--mid" />
          <span className="bi-loader__ring bi-loader__ring--spin" />

          {/* The four icons, one per stage */}
          <svg className="bi-loader__icons" viewBox="0 0 120 120">
            {/* 1 - Power BI: three rising columns */}
            <g className="bi-icon" style={{ "--i": 0 }}>
              <rect pathLength="1" x="28" y="62" width="16" height="30" rx="3" />
              <rect pathLength="1" x="52" y="42" width="16" height="50" rx="3" />
              <rect pathLength="1" x="76" y="22" width="16" height="70" rx="3" />
              <path pathLength="1" d="M28 100 H92" />
            </g>

            {/* 2 - Fabric: folded ribbon */}
            <g className="bi-icon" style={{ "--i": 1 }}>
              <path
                pathLength="1"
                d="M38 18 L84 18 L84 36 L58 36 L58 50 L78 50 L78 68 L58 68 L58 102 L38 90 Z"
              />
              <path pathLength="1" d="M58 36 L38 18" />
              <path pathLength="1" d="M58 68 L78 50" />
            </g>

            {/* 3 - Data: stacked store */}
            <g className="bi-icon" style={{ "--i": 2 }}>
              <ellipse pathLength="1" cx="60" cy="30" rx="30" ry="10" />
              <path pathLength="1" d="M30 30 V88 C30 94 43 100 60 100 C77 100 90 94 90 88 V30" />
              <path pathLength="1" d="M30 52 C30 58 43 64 60 64 C77 64 90 58 90 52" />
              <path pathLength="1" d="M30 70 C30 76 43 82 60 82 C77 82 90 76 90 70" />
            </g>

            {/* 4 - Report: page with chart */}
            <g className="bi-icon" style={{ "--i": 3 }}>
              <rect pathLength="1" x="26" y="16" width="68" height="88" rx="7" />
              <path pathLength="1" d="M40 32 H70" />
              <path pathLength="1" d="M42 88 V70" />
              <path pathLength="1" d="M56 88 V58" />
              <path pathLength="1" d="M70 88 V48" />
              <path pathLength="1" d="M82 88 V64" />
              <path pathLength="1" d="M38 56 L52 44 L64 50 L80 36" />
            </g>
          </svg>

          {/* Dust that scatters each time one icon hands over to the next */}
          <i className="bi-loader__dust bi-loader__dust--a" />
          <i className="bi-loader__dust bi-loader__dust--b" />
          <i className="bi-loader__dust bi-loader__dust--c" />
          <i className="bi-loader__dust bi-loader__dust--d" />
          <i className="bi-loader__dust bi-loader__dust--e" />
          <i className="bi-loader__dust bi-loader__dust--f" />
        </div>

        {/* Stage caption, in step with the icon */}
        <div className="bi-loader__captions" key={`c${cycle}`} aria-hidden="true">
          {STAGES.map((s, i) => (
            <span key={s.id} className="bi-loader__caption" style={{ "--i": i }}>
              {s.name}
            </span>
          ))}
        </div>

        {/* Four-step indicator */}
        <div className="bi-loader__steps" key={`s${cycle}`} aria-hidden="true">
          {STAGES.map((s, i) => (
            <span key={s.id} className="bi-loader__step" style={{ "--i": i }} />
          ))}
        </div>
      </div>
    </div>
  );
}