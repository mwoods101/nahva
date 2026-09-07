/** SVG path builders. Charts use exactly three series — coral CTL, petrol ATL,
 *  ochre TSB — per the colour rules in card 2d. Any extra series is ink at 40%
 *  (--extra-series). No chart library, and no library default palette. */

export interface Box {
  w: number;
  h: number;
  pad?: number;
}

/** Map values to an SVG polyline path. Returns "" for an empty series. */
export function linePath(values: (number | null)[], box: Box, min?: number, max?: number): string {
  const pts = points(values, box, min, max);
  if (!pts.length) return "";
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

/** Same geometry as linePath, closed to the baseline — for the CTL area wash. */
export function areaPath(values: (number | null)[], box: Box, min?: number, max?: number): string {
  const pts = points(values, box, min, max);
  if (!pts.length) return "";
  const first = pts[0];
  const last = pts[pts.length - 1];
  const line = pts.map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  return `M${first.x.toFixed(2)},${box.h} ${line} L${last.x.toFixed(2)},${box.h} Z`;
}

function points(
  values: (number | null)[],
  box: Box,
  min?: number,
  max?: number,
): { x: number; y: number }[] {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return [];
  const lo = min ?? Math.min(...nums);
  const hi = max ?? Math.max(...nums);
  const span = hi - lo || 1;
  const pad = box.pad ?? 0;
  const usable = box.h - pad * 2;
  const step = values.length > 1 ? box.w / (values.length - 1) : 0;

  const out: { x: number; y: number }[] = [];
  values.forEach((v, i) => {
    if (v === null) return;
    out.push({ x: i * step, y: pad + usable - ((v - lo) / span) * usable });
  });
  return out;
}

export interface TsbBar {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  opacity: number;
}

/** TSB bars: ochre, faded when negative (card 2d). Centred on a zero line. */
export function tsbBars(values: (number | null)[], box: Box): TsbBar[] {
  const nums = values.filter((v): v is number => v !== null);
  if (!nums.length) return [];
  const peak = Math.max(...nums.map(Math.abs), 1);
  const mid = box.h / 2;
  const slot = box.w / values.length;
  const barW = Math.max(slot - 1, 1);

  const out: TsbBar[] = [];
  values.forEach((v, i) => {
    if (v === null) return;
    const h = Math.max((Math.abs(v) / peak) * (mid - 2), 1);
    out.push({
      x: i * slot,
      y: v >= 0 ? mid - h : mid,
      w: barW,
      h,
      color: "var(--ochre)",
      // "TSB bars (faded when negative)" — 2d.
      opacity: v >= 0 ? 1 : 0.42,
    });
  });
  return out;
}

/** Horizontal gridlines at quarter heights, matching card 1d. */
export function gridlines(box: Box, count = 3): string {
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const y = (box.h / (count + 1)) * i;
    out.push(
      `<line x1="0" y1="${y}" x2="${box.w}" y2="${y}" stroke="var(--grid)" stroke-width="1"></line>`,
    );
  }
  return out.join("");
}

/** Inline sparkline for the mini tiles. */
export function sparkline(values: (number | null)[], stroke: string, w = 140, h = 40): string {
  const d = linePath(values, { w, h, pad: 3 });
  if (!d) return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="36"></svg>`;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="36" preserveAspectRatio="none">
    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="2.4"></path>
  </svg>`;
}
