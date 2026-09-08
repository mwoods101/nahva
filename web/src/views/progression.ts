/** Progression — card 1d. PMC with coral CTL as hero, petrol ATL, TSB as a
 *  centred ochre strip. Range tabs are live.
 *
 *  The PMC is plotted across the WHOLE selected range, with the curve occupying
 *  only the days that actually have load. Earlier this chart was clamped to
 *  load coverage, which meant 6W/3M/1Y/ALL produced a byte-identical path — the
 *  pills looked broken. Plotting on the real timeline fixes that and states the
 *  problem better: on 1Y you see ~5 weeks of curve against 47 weeks of nothing,
 *  which is exactly the situation.
 */

import { areaPath, gridlines, linePath, sparkline, tsbBars } from "../charts";
import {
  addDays, duration, isoDay, km, round, shortDate, signed, sportColor, weekStart,
} from "../format";
import { latest, series } from "../wellness";
import type { Dataset, Sport } from "../types";

export type Range = "6w" | "3m" | "1y" | "all";

export interface ProgressionState {
  range: Range;
}

const RANGES: { key: Range; label: string; days: number | null }[] = [
  { key: "6w", label: "6W", days: 42 },
  { key: "3m", label: "3M", days: 91 },
  { key: "1y", label: "1Y", days: 365 },
  { key: "all", label: "ALL", days: null },
];

export function defaultProgressionState(): ProgressionState {
  return { range: "6w" };
}

const PMC = { w: 330, h: 190, pad: 8 };
const TSB = { w: 330, h: 54 };

export function renderProgression(dataset: Dataset, state: ProgressionState): string {
  const today = dataset.today;
  const range = RANGES.find((r) => r.key === state.range) ?? RANGES[0];
  const from =
    range.days === null ? new Date(dataset.volumeRange.from) : addDays(today, -range.days);

  // Daily series across the entire range, null where no wellness row exists.
  // The x position of every point reflects its true place on the timeline.
  const byDate = new Map(dataset.wellness.map((w) => [w.date, w]));
  const ctl: (number | null)[] = [];
  const atl: (number | null)[] = [];
  const form: (number | null)[] = [];
  const days: string[] = [];
  for (let d = new Date(from); d <= today; d = addDays(d, 1)) {
    const key = isoDay(d);
    const w = byDate.get(key);
    days.push(key);
    ctl.push(w?.ctl ?? null);
    atl.push(w?.atl ?? null);
    form.push(w?.form ?? null);
  }

  const present = ctl.filter((v): v is number => v !== null);
  const all = [...ctl, ...atl].filter((v): v is number => v !== null);
  const lo = Math.min(...all, 0);
  const hi = Math.max(...all, 1);

  const loaded = dataset.wellness.filter((w) => w.ctl !== null);
  const latest = loaded[loaded.length - 1] ?? null;
  const coverageFrom = loaded[0]?.date;
  const coverageTo = loaded[loaded.length - 1]?.date;

  // What fraction of the selected range actually has load behind it?
  const covered = present.length;
  const spanDays = days.length;
  const pct = spanDays ? Math.round((covered / spanDays) * 100) : 0;
  // Where the curve starts, as a fraction across the chart — for the marker.
  const startIdx = ctl.findIndex((v) => v !== null);
  const startPct = startIdx > 0 && spanDays > 1 ? (startIdx / (spanDays - 1)) * 100 : 0;

  return `
  <div class="page-title">
    <div class="page-title__h">Progression</div>
    <div class="page-title__sub">FITNESS · FATIGUE · FORM</div>
  </div>

  <div class="chips" style="padding:0 var(--pad-screen) 14px">
    ${RANGES.map(
      (r) =>
        `<button class="chip chip--pill" data-range="${r.key}" aria-pressed="${state.range === r.key}">${r.label}</button>`,
    ).join("")}
  </div>

  <div class="card">
    <div class="chart__legend">
      <span class="chart__key"><span class="chart__swatch" style="background:var(--coral)"></span>CTL ${round(latest?.ctl ?? null)}</span>
      <span class="chart__key"><span class="chart__swatch" style="background:var(--petrol)"></span>ATL ${round(latest?.atl ?? null)}</span>
      <span class="chart__key"><span class="chart__swatch" style="background:var(--ochre)"></span>TSB ${signed(latest?.form ?? null)}</span>
    </div>

    ${
      covered >= 2
        ? `<div style="position:relative">
            <svg viewBox="0 0 ${PMC.w} ${PMC.h}" width="100%" height="158" preserveAspectRatio="none">
              ${gridlines(PMC)}
              <path d="${areaPath(ctl, PMC, lo, hi)}" fill="var(--coral-wash)"></path>
              <path d="${linePath(atl, PMC, lo, hi)}" fill="none" stroke="var(--petrol)" stroke-width="1.6" stroke-linejoin="round"></path>
              <path d="${linePath(ctl, PMC, lo, hi)}" fill="none" stroke="var(--coral)" stroke-width="3" stroke-linejoin="round"></path>
            </svg>
            ${
              startPct > 4
                ? `<div style="position:absolute;top:0;bottom:0;left:0;width:${startPct.toFixed(1)}%;
                     border-right:1.5px dashed var(--hairline);pointer-events:none"></div>
                   <div class="mono" style="position:absolute;top:4px;left:6px;font-size:8.5px;
                     letter-spacing:.1em;opacity:.4;max-width:${Math.max(startPct - 4, 10).toFixed(1)}%">NO LOAD DATA</div>`
                : ""
            }
          </div>
          <div class="chart__axis">
            <span>${shortDate(days[0])}</span>
            <span>${covered} OF ${spanDays} DAYS · ${pct}%</span>
            <span>TODAY</span>
          </div>`
        : `<div class="cal__empty" style="margin:0">NOT ENOUGH LOAD DATA IN THIS RANGE</div>`
    }

    <div class="chart__sub">
      <div class="chart__sublabel">FORM / TSB</div>
      <svg viewBox="0 0 ${TSB.w} ${TSB.h}" width="100%" height="54" preserveAspectRatio="none">
        <line x1="0" y1="${TSB.h / 2}" x2="${TSB.w}" y2="${TSB.h / 2}" stroke="var(--rule-mid)" stroke-width="1"></line>
        ${tsbBars(form, TSB)
          .map(
            (b) =>
              `<rect x="${b.x.toFixed(2)}" y="${b.y.toFixed(2)}" width="${b.w.toFixed(2)}" height="${b.h.toFixed(2)}" fill="${b.color}" opacity="${b.opacity}"></rect>`,
          )
          .join("")}
      </svg>
    </div>
  </div>

  ${buildingNotice(covered, coverageFrom, coverageTo, dataset, pct, range.label)}

  ${volumeCard(dataset, from)}

  ${wellnessTrio(dataset)}
  <div class="spacer"></div>`;
}

/** The honesty panel. Always present — the PMC is building, not historical. */
function buildingNotice(
  days: number,
  from: string | undefined,
  to: string | undefined,
  dataset: Dataset,
  pct: number,
  rangeLabel: string,
): string {
  const volumeYears = (
    daysBetween(new Date(dataset.volumeRange.from), new Date(dataset.volumeRange.to)) / 365.25
  ).toFixed(1);

  return `<div class="building">
    <div class="building__dot"></div>
    <div>
      <div class="building__title">FITNESS CURVE · BUILDING</div>
      <div class="building__body">
        CTL/ATL exist for <strong>${days} days</strong>${from && to ? ` (${shortDate(from)} – ${shortDate(to)})` : ""},
        because training load only arrives from intervals.icu — it covers
        <strong>${pct}%</strong> of the ${rangeLabel} range. Volume goes back
        <strong>${volumeYears} years</strong>.
        Read this as a curve that fills in over time, not a long-term trend.
      </div>
    </div>
  </div>`;
}

function volumeCard(dataset: Dataset, from: Date): string {
  const buckets: { start: Date; seconds: number; metres: number; dominant: Sport }[] = [];
  const firstWeek = weekStart(from);
  const lastWeek = weekStart(dataset.today);
  const totalWeeks = Math.round(daysBetween(firstWeek, lastWeek) / 7) + 1;
  // Cap the bar count so a multi-year range stays legible.
  const stride = totalWeeks > 26 ? Math.ceil(totalWeeks / 26) : 1;

  for (let i = 0; i < totalWeeks; i += stride) {
    const start = addDays(firstWeek, i * 7);
    const end = addDays(start, 7 * stride);
    const acts = dataset.activities.filter((a) => {
      const t = new Date(a.date).getTime();
      return t >= start.getTime() && t < end.getTime();
    });
    const bySport = new Map<Sport, number>();
    for (const a of acts) bySport.set(a.sport, (bySport.get(a.sport) ?? 0) + (a.duration_s ?? 0));
    const dominant = [...bySport.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "other";
    buckets.push({
      start,
      seconds: acts.reduce((acc, a) => acc + (a.duration_s ?? 0), 0),
      metres: acts.reduce((acc, a) => acc + (a.distance_m ?? 0), 0),
      dominant,
    });
  }

  const peak = Math.max(...buckets.map((b) => b.seconds), 1);
  const mean = buckets.reduce((a, b) => a + b.seconds, 0) / (buckets.length || 1);
  // Say what a bar IS. Previously the heading said "WEEKLY VOLUME" while bars
  // were silently multi-week buckets, and the average was per bucket.
  const unit = stride === 1 ? "WEEK" : `${stride} WEEKS`;

  return `<div class="card" style="margin-top:10px">
    <div class="sleep__head">
      <span class="eyebrow" style="letter-spacing:.16em;opacity:.55">VOLUME · ${buckets.length} BARS</span>
      <span class="mono" style="font-weight:700;font-size:13px">Ø ${duration(mean)}</span>
    </div>
    <div class="volbars">
      ${buckets
        .map((b, i) => {
          const h = (b.seconds / peak) * 100;
          const showLabel = buckets.length <= 14 || i % Math.ceil(buckets.length / 7) === 0;
          return `<div class="volbars__col" title="${isoDay(b.start)} + ${unit.toLowerCase()} · ${duration(b.seconds)} · ${km(b.metres, 0)}km">
            <div class="volbars__bar" style="height:${h}%;background:${sportColor(b.dominant)}"></div>
            <div class="volbars__label">${showLabel ? shortDate(b.start.toISOString()).slice(0, 2) : ""}</div>
          </div>`;
        })
        .join("")}
    </div>
    <div class="mono" style="font-size:9px;opacity:.4;margin-top:8px;letter-spacing:.06em;line-height:1.6">
      ONE BAR = ${unit} OF MOVING TIME · Ø IS PER BAR<br />
      COLOUR = DOMINANT SPORT (<span style="color:var(--coral)">RUN</span>
      <span style="color:var(--petrol)">RIDE</span>
      <span style="color:var(--ochre)">GYM</span>)
    </div>
  </div>`;
}

function wellnessTrio(dataset: Dataset): string {
  // Per-metric resolution: hrv/resting_hr land later than ctl/atl, so reading
  // them all off the newest row shows "–" for whatever hasn't synced yet.
  const hrv = latest(dataset.wellness, "hrv");
  const rhr = latest(dataset.wellness, "resting_hr");
  const sleep = latest(dataset.wellness, "sleep_hours");
  const cards = [
    { label: "HRV", value: round(hrv.value), series: series(dataset.wellness, "hrv", 28), color: "var(--coral)" },
    { label: "RHR", value: round(rhr.value), series: series(dataset.wellness, "resting_hr", 28), color: "var(--petrol)" },
    {
      label: "SLEEP",
      value: sleep.value === null ? "–" : sleep.value.toFixed(1),
      series: series(dataset.wellness, "sleep_hours", 28),
      // A fourth series would break the three-colour rule, so ink at 40%.
      color: "var(--extra-series)",
    },
  ];
  return `<div class="trio">
    ${cards
      .map(
        (c) => `<div class="trio__card">
        <div class="trio__label">${c.label}</div>
        <div class="trio__value">${c.value}</div>
        ${sparkline(c.series, c.color, 90, 30)}
      </div>`,
      )
      .join("")}
  </div>`;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 864e5);
}
