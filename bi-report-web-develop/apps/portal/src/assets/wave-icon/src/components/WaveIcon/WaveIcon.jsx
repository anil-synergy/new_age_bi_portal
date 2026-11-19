import { forwardRef, useId, useImperativeHandle, useRef } from 'react';
import './WaveIcon.css';
import { useInViewport, useReducedMotion, useResolvedTheme } from './hooks';
import WaveLine, { REDUCED_FADE_MS } from './WaveLine';
import { EDGE_BAND, EDGE_FROM, EDGE_TO, PALETTES, VIEW_H, VIEW_W, WAVES } from './waveConfig';

const FADE_STOPS = [
  [0, 0],
  [0.12, 1],
  [0.88, 1],
  [1, 0],
];
const EDGE_STOPS = [
  [0, 1],
  [0.2, 0.92],
  [0.4, 0.68],
  [0.6, 0.34],
  [0.8, 0.09],
  [1, 0],
];

const toCssSize = (size) => (typeof size === 'number' ? `${size}px` : size);
const pick = (value, i) => (Array.isArray(value) ? value[i] : value);

/**
 * Three short ocean-style wave lines, stacked and never overlapping. Each line
 * flows left → right on a seamless loop, and dissolves right-to-left on its own
 * when clicked (luminous core, blurred edges, light wisps fading out).
 *
 * Props
 *  theme             'auto' | 'light' | 'dark'                (default 'auto')
 *  size              width in px (number) or any CSS length   (default 160; height is width / 2)
 *  loopDuration      one seamless wave loop, ms               (default 4000)
 *  dissolveDuration  one line's dissolve / restore, ms        (default 2400)
 *  fps               animation step rate                      (default 30)
 *  dissolved         controlled state: boolean (all) or [bool, bool, bool] (per line)
 *  defaultDissolved  initial state when uncontrolled (same shapes)
 *  interactive       clicking / Enter / Space on a line toggles that line   (default true)
 *  paused            freeze the flow
 *  reducedMotion     'auto' | true | false                    (default 'auto')
 *  label             accessible name of the group             (default 'Animated wave icon')
 *  lineLabels        accessible names of the lines            (default 'Wave line 1' …)
 *  decorative        hide from assistive tech (disables interactivity)
 *  onDissolveStart / onDissolveEnd / onRestoreStart / onRestoreEnd   (lineIndex) => void
 *  onToggle          (lineIndex, nextDissolved) => void
 *
 * Imperative ref (omit the index to address every line):
 *  dissolve(i?), restore(i?), toggle(i?), replay(i?), getPhase(i)
 */
const WaveIcon = forwardRef(function WaveIcon(
  {
    theme = 'auto',
    size = 160,
    loopDuration = 4000,
    dissolveDuration = 2400,
    fps = 30,
    dissolved,
    defaultDissolved = false,
    interactive = true,
    paused = false,
    reducedMotion = 'auto',
    label = 'Animated wave icon',
    lineLabels,
    decorative = false,
    className = '',
    style,
    onDissolveStart,
    onDissolveEnd,
    onRestoreStart,
    onRestoreEnd,
    onToggle,
  },
  ref,
) {
  const uid = `wi${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const resolvedTheme = useResolvedTheme(theme);
  const reduced = useReducedMotion(reducedMotion);
  const rootRef = useRef(null);
  const inView = useInViewport(rootRef);
  const lineRefs = useRef([]);

  const each = (i, fn) => {
    const targets = i === undefined ? lineRefs.current : [lineRefs.current[i]];
    targets.forEach((l) => l && fn(l));
  };
  useImperativeHandle(ref, () => ({
    dissolve: (i) => each(i, (l) => l.dissolve()),
    restore: (i) => each(i, (l) => l.restore()),
    toggle: (i) => each(i, (l) => l.toggle()),
    replay: (i) => each(i, (l) => l.replay()),
    getPhase: (i) => lineRefs.current[i]?.getPhase(),
  }));

  const palette = PALETTES[resolvedTheme];
  const steps = Math.max(1, Math.round((loopDuration / 1000) * fps));
  const isInteractive = interactive && !decorative;

  const rootStyle = {
    '--wi-size': toCssSize(size),
    '--wi-loop': `${loopDuration}ms`,
    '--wi-loop-half': `${loopDuration / 2}ms`,
    '--wi-steps': steps,
    '--wi-half-steps': Math.max(1, Math.round(steps / 4)),
    '--wi-dissolve': `${dissolveDuration}ms`,
    '--wi-fade': `${REDUCED_FADE_MS}ms`,
    '--wi-from': `${EDGE_FROM}px`,
    '--wi-to': `${EDGE_TO}px`,
    ...style,
  };

  const filterBox = { filterUnits: 'userSpaceOnUse', x: -30, y: -30, width: VIEW_W + 60, height: VIEW_H + 60 };

  return (
    <div
      ref={rootRef}
      className={`wave-icon ${className}`.trim()}
      style={rootStyle}
      data-theme={resolvedTheme}
      data-reduced={reduced ? 'true' : 'false'}
      data-paused={paused || !inView ? 'true' : 'false'}
      {...(decorative ? { 'aria-hidden': 'true' } : { role: 'group', 'aria-label': label })}
    >
      <svg className="wi-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} xmlns="http://www.w3.org/2000/svg" focusable="false">
        <defs>
          <filter id={`${uid}-soft`} {...filterBox}>
            <feGaussianBlur stdDeviation="1.7" />
          </filter>
          <filter id={`${uid}-edge`} {...filterBox}>
            <feGaussianBlur stdDeviation="0.5" />
          </filter>
          <filter id={`${uid}-wisp`} {...filterBox}>
            <feGaussianBlur stdDeviation="0.4" />
          </filter>

          {/* static fade at both ends: lines emerge from and vanish into transparency */}
          <linearGradient id={`${uid}-fade`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={VIEW_W} y2="0">
            {FADE_STOPS.map(([o, a]) => (
              <stop key={o} offset={o} stopColor="#fff" stopOpacity={a} />
            ))}
          </linearGradient>
          <mask id={`${uid}-fm`} maskUnits="userSpaceOnUse" x="-30" y="-30" width={VIEW_W + 60} height={VIEW_H + 60}>
            <rect x="0" y="-30" width={VIEW_W} height={VIEW_H + 60} fill={`url(#${uid}-fade)`} />
          </mask>

          {/* directional dissolve edge, shared by every line's mask */}
          <linearGradient id={`${uid}-eg`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={EDGE_BAND} y2="0">
            {EDGE_STOPS.map(([o, a]) => (
              <stop key={o} offset={o} stopColor="#fff" stopOpacity={a} />
            ))}
          </linearGradient>
        </defs>

        <g mask={`url(#${uid}-fm)`}>
          {WAVES.map((_, i) => (
            <WaveLine
              key={i}
              ref={(el) => {
                lineRefs.current[i] = el;
              }}
              index={i}
              uid={uid}
              palette={palette}
              label={lineLabels?.[i] ?? `Wave line ${i + 1}`}
              interactive={isInteractive}
              reduced={reduced}
              dissolveDuration={dissolveDuration}
              dissolved={pick(dissolved, i)}
              defaultDissolved={Boolean(pick(defaultDissolved, i))}
              onDissolveStart={onDissolveStart}
              onDissolveEnd={onDissolveEnd}
              onRestoreStart={onRestoreStart}
              onRestoreEnd={onRestoreEnd}
              onToggle={onToggle}
            />
          ))}
        </g>
      </svg>
    </div>
  );
});

export default WaveIcon;
