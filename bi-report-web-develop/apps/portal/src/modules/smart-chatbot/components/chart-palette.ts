/** SMART / pinned visual charts — base #3b82f6 with lighter/darker blues. */
export const CHART_BLUE_PALETTE = [
  "#3b82f6",
  "#2563eb",
  "#60a5fa",
  "#1d4ed8",
  "#93c5fd",
  "#1e40af",
  "#bfdbfe",
] as const;

export const CHART_BLUE_PRIMARY = CHART_BLUE_PALETTE[0];

export function chartBlueShades(count: number): string[] {
  if (count <= 0) return [CHART_BLUE_PRIMARY];
  return Array.from({ length: count }, (_, i) => CHART_BLUE_PALETTE[i % CHART_BLUE_PALETTE.length]);
}
