// Static geometry, palettes and timing for <WaveIcon />.
// Everything here is computed once at module load and shared by all instances.

export const VIEW_W = 200;
export const VIEW_H = 100;

// Dissolve mask: a soft vertical edge sweeping right-to-left.
export const EDGE_BAND = 80;
export const EDGE_REACH = 360;
export const EDGE_FROM = VIEW_W + 40; // edge parked right of the viewBox: fully visible
export const EDGE_TO = -(EDGE_BAND + 40); // edge parked left of the viewBox: fully hidden

// Phase timing as fractions of the dissolve duration.
export const BODY_SPAN = 0.62;
export const WISP_LAG = 0.18; // wisps trail the body on dissolve, lead it on restore

/**
 * Sine-based wave with a second harmonic for an organic silhouette, emitted as
 * cubic Béziers using exact derivatives. y(x + period) === y(x), so translating
 * the path by exactly one period is a seamless loop.
 */
function buildPath({ period, amp, cy, phase, harmonic, h2 }, from, to) {
  const step = period / 8;
  const k = (2 * Math.PI) / period;
  const sample = (x) => {
    const t = k * x + phase;
    return {
      y: cy + amp * (Math.sin(t) + harmonic * Math.sin(2 * t + h2)),
      m: amp * k * (Math.cos(t) + 2 * harmonic * Math.cos(2 * t + h2)),
    };
  };
  const f = (n) => n.toFixed(2);
  let x0 = from;
  let p0 = sample(x0);
  let d = `M${f(x0)} ${f(p0.y)}`;
  while (x0 < to - 1e-6) {
    const x1 = x0 + step;
    const p1 = sample(x1);
    d += `C${f(x0 + step / 3)} ${f(p0.y + (p0.m * step) / 3)} ${f(x1 - step / 3)} ${f(
      p1.y - (p1.m * step) / 3,
    )} ${f(x1)} ${f(p1.y)}`;
    x0 = x1;
    p0 = p1;
  }
  return d;
}

// The path spans [-period, VIEW_W]; sliding it right by one period always
// covers [0, VIEW_W].
const makePath = (shape) => buildPath(shape, -shape.period, VIEW_W);

// Three short, calm lines stacked top to bottom (no overlap: 26 units apart, amp 7).
const RAW_WAVES = [
  {
    period: 50,
    body: { period: 50, amp: 7, cy: 24, phase: 0, harmonic: 0.08, h2: 0.9 },
    wisps: [
      { shape: { amp: 9, cy: 23, phase: 0.6, harmonic: 0.3, h2: 2.1 }, dash: '14 7 3 20 8 4 24 10', width: 0.6 },
      { shape: { amp: 5, cy: 25, phase: 1.5, harmonic: 0.3, h2: 0.4 }, dash: '4 12 18 6 8 16 3 13', width: 0.45 },
    ],
    coreWidth: 2.6,
    bob: 0,
  },
  {
    period: 40,
    body: { period: 40, amp: 7, cy: 50, phase: 1.3, harmonic: 0.08, h2: 2.4 },
    wisps: [
      { shape: { amp: 9, cy: 50, phase: 2.2, harmonic: 0.3, h2: 1.2 }, dash: '11 8 4 18 3 14 22 7', width: 0.6 },
      { shape: { amp: 5, cy: 51, phase: 0.3, harmonic: 0.3, h2: 3.0 }, dash: '3 10 15 5 7 19 4 12', width: 0.45 },
    ],
    coreWidth: 2.6,
    bob: 0.31,
  },
  {
    period: 50,
    body: { period: 50, amp: 7, cy: 76, phase: 2.6, harmonic: 0.08, h2: 4.1 },
    wisps: [
      { shape: { amp: 9, cy: 77, phase: 3.2, harmonic: 0.3, h2: 0.7 }, dash: '17 6 4 15 10 5 23 8', width: 0.6 },
      { shape: { amp: 5, cy: 75, phase: 4.6, harmonic: 0.3, h2: 2.6 }, dash: '5 13 16 4 6 18 3 11', width: 0.45 },
    ],
    coreWidth: 2.6,
    bob: 0.62,
  },
];

export const WAVES = RAW_WAVES.map((w) => ({
  period: w.period,
  coreWidth: w.coreWidth,
  bob: w.bob,
  cy: w.body.cy,
  path: makePath(w.body),
  wisps: w.wisps.map((s) => ({
    path: makePath({ period: w.period, ...s.shape }),
    dash: s.dash,
    width: s.width,
  })),
}));

/**
 * Palettes. Each wave's gradient is periodic (first stop === last stop), so it
 * can repeat along x with the wave's own period and loop without a seam.
 * Light mode is dominated by #333869 with #1F9CD8 as the secondary colour;
 * dark mode deliberately never uses #333869.
 */
export const PALETTES = {
  light: {
    waves: [
      ['#1F9CD8', '#1F9CD8', '#0F52BA', '#1F9CD8', '#1F9CD8'], // secondary blue with sapphire
      ['#333869', '#333869', '#0047AB', '#333869', '#333869'], // dominant indigo with cobalt
      ['#7B5EA7', '#8A6FCB', '#0F52BA', '#7B5EA7', '#7B5EA7'], // deep lilac with sapphire
    ],
    ivory: '#FFFFF0',
    white: '#FFFFFF',
  },
  dark: {
    waves: [
      ['#4DB8EC', '#4DB8EC', '#6C9BFF', '#4DB8EC', '#4DB8EC'],
      ['#8E9CFF', '#8E9CFF', '#5C8DF0', '#8E9CFF', '#8E9CFF'],
      ['#B79CF2', '#C2A8F5', '#7FA6FF', '#B79CF2', '#B79CF2'],
    ],
    ivory: '#FFFFF0',
    white: '#FFFFFF',
  },
};

export const STOP_OFFSETS = [0, 0.3, 0.55, 0.8, 1];
