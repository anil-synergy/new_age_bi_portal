import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  BODY_SPAN,
  EDGE_BAND,
  EDGE_REACH,
  STOP_OFFSETS,
  VIEW_H,
  VIEW_W,
  WAVES,
  WISP_LAG,
} from './waveConfig';

export const REDUCED_FADE_MS = 400; // must match --wi-fade in WaveIcon.jsx
const SETTLE_PAD_MS = 60; // lets the CSS animation finish before the phase flips

// Body leads on dissolve, wisps lead on restore.
const edgeTiming = (kind) => ({
  '--wi-dur': BODY_SPAN,
  '--wi-dly-out': kind === 'body' ? 0 : WISP_LAG,
  '--wi-dly-in': kind === 'body' ? WISP_LAG : 0,
});

/**
 * One wave line with its own dissolve state machine:
 * playing → dissolving → dissolved → restoring → playing.
 * A request made mid-transition is queued, never applied abruptly.
 */
const WaveLine = forwardRef(function WaveLine(
  {
    index,
    uid,
    palette,
    label,
    interactive,
    reduced,
    dissolveDuration,
    dissolved: dissolvedProp,
    defaultDissolved,
    onDissolveStart,
    onDissolveEnd,
    onRestoreStart,
    onRestoreEnd,
    onToggle,
  },
  ref,
) {
  const w = WAVES[index];
  const colors = palette.waves[index];
  const id = (name) => `${uid}-${name}${index}`;
  const url = (name) => `url(#${id(name)})`;

  const controlled = dissolvedProp !== undefined;
  const initial = (controlled ? dissolvedProp : defaultDissolved) ? 'dissolved' : 'playing';
  const [phase, setPhase] = useState(initial);
  const phaseRef = useRef(initial);
  const wantRef = useRef(initial === 'dissolved' ? 'dissolved' : 'visible');
  const replayRef = useRef(false);
  const timerRef = useRef(0);

  const live = useRef({});
  useEffect(() => {
    live.current = { index, reduced, dissolveDuration, onDissolveStart, onDissolveEnd, onRestoreStart, onRestoreEnd, onToggle };
  });

  const advance = useCallback(function advance() {
    const p = phaseRef.current;
    const want = wantRef.current;
    const l = live.current;
    let during;
    let after;
    let onStart;
    let onEnd;
    if (p === 'playing' && want === 'dissolved') {
      [during, after, onStart, onEnd] = ['dissolving', 'dissolved', l.onDissolveStart, l.onDissolveEnd];
    } else if (p === 'dissolved' && want === 'visible') {
      [during, after, onStart, onEnd] = ['restoring', 'playing', l.onRestoreStart, l.onRestoreEnd];
    } else {
      return; // settled, or a transition is running (it re-checks when it ends)
    }
    phaseRef.current = during;
    setPhase(during);
    onStart?.(l.index);
    const ms = (l.reduced ? REDUCED_FADE_MS : l.dissolveDuration) + SETTLE_PAD_MS;
    timerRef.current = setTimeout(() => {
      timerRef.current = 0;
      phaseRef.current = after;
      setPhase(after);
      onEnd?.(l.index);
      if (after === 'dissolved' && replayRef.current) {
        replayRef.current = false;
        wantRef.current = 'visible';
      }
      advance();
    }, ms);
  }, []);

  const request = useCallback(
    (want) => {
      wantRef.current = want;
      advance();
    },
    [advance],
  );

  useImperativeHandle(
    ref,
    () => ({
      dissolve: () => request('dissolved'),
      restore: () => request('visible'),
      toggle: () => request(wantRef.current === 'dissolved' ? 'visible' : 'dissolved'),
      replay: () => {
        if (phaseRef.current === 'dissolved' || wantRef.current === 'dissolved') {
          request('visible');
        } else {
          replayRef.current = true;
          request('dissolved');
        }
      },
      getPhase: () => phaseRef.current,
    }),
    [request],
  );

  // Controlled mode follows the prop (queued if a transition is in flight).
  useEffect(() => {
    if (dissolvedProp === undefined) return;
    request(dissolvedProp ? 'dissolved' : 'visible');
  }, [dissolvedProp, request]);

  // On unmount (or StrictMode's simulated one) drop the timer and snap to a settled phase.
  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      timerRef.current = 0;
      if (phaseRef.current === 'dissolving') phaseRef.current = 'dissolved';
      else if (phaseRef.current === 'restoring') phaseRef.current = 'playing';
      setPhase(phaseRef.current);
    },
    [],
  );

  const activate = () => {
    const next = wantRef.current !== 'dissolved';
    live.current.onToggle?.(index, next);
    if (!controlled) request(next ? 'dissolved' : 'visible');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate();
    }
  };

  const interactiveProps = interactive
    ? {
        role: 'button',
        tabIndex: 0,
        'aria-label': label,
        'aria-pressed': phase === 'dissolved' || phase === 'dissolving',
        onClick: activate,
        onKeyDown,
      }
    : {};

  return (
    <g
      className="wi-line"
      data-phase={phase}
      data-paused={phase === 'dissolved' ? 'true' : 'false'}
      style={{ '--wi-p': `${w.period}px`, '--wi-bobphase': w.bob }}
      {...interactiveProps}
    >
      <defs>
        <path id={id('p')} d={w.path} />
        {w.wisps.map((s, j) => (
          <path key={j} id={`${id('s')}${j}`} d={s.path} />
        ))}

        <linearGradient id={id('g')} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={w.period} y2="0" spreadMethod="repeat">
          {STOP_OFFSETS.map((o, k) => (
            <stop key={o} offset={o} stopColor={colors[k]} />
          ))}
        </linearGradient>
        <linearGradient id={id('h')} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={w.period} y2="0" spreadMethod="repeat">
          <stop offset="0" stopColor={palette.ivory} stopOpacity="0" />
          <stop offset="0.3" stopColor={palette.ivory} stopOpacity="0.85" />
          <stop offset="0.5" stopColor={palette.white} stopOpacity="1" />
          <stop offset="0.7" stopColor={palette.ivory} stopOpacity="0.35" />
          <stop offset="1" stopColor={palette.ivory} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id('w')} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={w.period} y2="0" spreadMethod="repeat">
          <stop offset="0" stopColor={colors[1]} stopOpacity="0" />
          <stop offset="0.25" stopColor={palette.ivory} stopOpacity="0.9" />
          <stop offset="0.55" stopColor={colors[2]} stopOpacity="0.7" />
          <stop offset="0.8" stopColor={palette.white} stopOpacity="0.85" />
          <stop offset="1" stopColor={colors[1]} stopOpacity="0" />
        </linearGradient>

        {['b', 'w'].map((kind) => (
          <mask key={kind} id={id(`m${kind}`)} maskUnits="userSpaceOnUse" x="-60" y="-40" width={VIEW_W + 120} height={VIEW_H + 80}>
            <g className="wi-edge" style={edgeTiming(kind === 'b' ? 'body' : 'wisp')}>
              <rect x={-EDGE_REACH} y="-40" width={EDGE_REACH} height={VIEW_H + 80} fill="#fff" />
              <rect x="0" y="-40" width={EDGE_BAND} height={VIEW_H + 80} fill={`url(#${uid}-eg)`} />
            </g>
          </mask>
        ))}
      </defs>

      <g className="wi-body">
        <g mask={url('mb')}>
          <g className="wi-bob" filter={`url(#${uid}-soft)`}>
            <g className="wi-flow">
              <use href={`#${id('p')}`} className="wi-halo" stroke={url('g')} />
              <use href={`#${id('p')}`} className="wi-glow" stroke={url('g')} />
            </g>
          </g>
          <g className="wi-bob" filter={`url(#${uid}-edge)`}>
            <g className="wi-flow">
              <use href={`#${id('p')}`} className="wi-core" stroke={url('g')} strokeWidth={w.coreWidth} />
              <use href={`#${id('p')}`} className="wi-highlight" stroke={url('h')} strokeWidth={w.coreWidth * 0.36} />
            </g>
          </g>
        </g>
        <g mask={url('mw')}>
          <g className="wi-wisps" filter={`url(#${uid}-wisp)`} style={edgeTiming('wisp')}>
            <g className="wi-flow wi-twinkle">
              {w.wisps.map((s, j) => (
                <use
                  key={j}
                  href={`#${id('s')}${j}`}
                  className="wi-wisp"
                  stroke={url('w')}
                  strokeWidth={s.width}
                  strokeDasharray={s.dash}
                />
              ))}
            </g>
          </g>
        </g>
      </g>

      {/* invisible, full-width hit target so only this line reacts, even once dissolved */}
      {interactive && <path className="wi-hit" d={`M0 ${w.cy}H${VIEW_W}`} />}
    </g>
  );
});

export default WaveLine;
