/** Progression — card 1d. PMC with coral CTL as hero, petrol ATL, TSB as a
 *  centred ochre strip. Range tabs are live.
 *
 *  IMPORTANT (CHECKLIST.md § Data depth): CTL/ATL cover only the intervals.icu
 *  window — about 5 weeks — while volume runs 13 years. This view must read as
 *  BUILDING and must not imply a long-term fitness trend:
 *
 *    - the PMC x-axis is clamped to actual load coverage and labelled with it,
 *      so a "1Y" range never stretches 5 weeks of data across a year;
 *    - a persistent notice states the coverage in plain terms;
 *    - the volume chart, which genuinely has depth, honours the range fully.
 */

import { areaPath, gridlines, linePath, sparkline, tsbBars } from "../charts";
import {
  addDays, duration, isoDay, km, round, shortDate, signed, sportColor, weekStart,
} from "../format";
import { TODAY } from "../mock";
import type { Dataset, Sport, Wellness } from "../types";

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
  const range = RANGES.find((r) => r.key === state.range) ?? RANGES[0];
  const from = range.days === null
    ? new Date(dataset.volumeRange.from)
    : addDays(TODAY, -range.days);

  // ── PMC: only rows that actually carry CTL. Never padded to fill the range.
  const loaded: Wellness[] = dataset.wellness.filter((w) => w.ctl !== null);
  const pmcRows = loaded.filter((w) => new Date(w.date).getTime() >= from.getTime());
  const ctl = pmcRows.map((w) => w.ctl);
  const atl = pmcRows.map((w) => w.atl);
  const form = pmcRows.map((w) => w.form);

  // Shared scale so CTL and ATL are visually comparable.
  const all = [...ctl, ...atl].filter((v): v is number => v !== null);
  const lo = Math.min(...all, 0);
  const hi = Math.max(...all, 1);

  const latest = pmcRows[pmcRows.length - 1];
  const coverageDays = loaded.length;
  const coverageFrom = loaded[0]?.date;
  const coverageTo = loaded[loaded.length - 1]?.date;

  // Does the selected range extend beyond what load data can fill?
  const rangeDays = range.days ?? daysBetween(new Date(dataset.volumeRange.from), TODAY);
  const partial = coverageDays < rangeDays * 0.9;

  return `
  <div class="statusbar"><span>9:41</span><span>5G · 82%</span></div>
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
      pmcRows.length >= 2
        ? `<svg viewBox="0 0 ${PMC.w} ${PMC.h}" width="100%" height="158" preserveAspectRatio="none">
            ${gridlines(PMC)}
            <path d="${areaPath(ctl, PMC, lo, hi)}" fill="var(--coral-wash)"></path>
            <path d="${linePath(atl, PMC, lo, hi)}" fill="none" stroke="var(--petrol)" stroke-width="1.6" stroke-linejoin="round"></path>
            <path d="${linePath(ctl, PMC, lo, hi)}" fill="none" stroke="var(--coral)" stroke-width="3" stroke-linejoin="round"></path>
          </svg>
          <div class="chart__axis">
            <span>${coverageFrom ? shortDate(coverageFrom) : ""}</span>
            <span>${pmcRows.length} DAYS OF LOAD</span>
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

  ${buildingNotice(coverageDays, coverageFrom, coverageTo, dataset, partial, range.label)}

  ${volumeCard(dataset, from, range.key)}

  ${wellnessTrio(dataset)}
  <div class="spacer"></div>`;
}

/** The honesty panel. Always present — the PMC is building, not historical. */
function buildingNotice(
  days: number,
  from: string | undefined,
  to: string | undefined,
  dataset: Dataset,
  partial: boolean,
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
        because training load only arrives from intervals.icu. Volume goes back
        <strong>${volumeYears} years</strong>.
        ${partial ? `The ${rangeLabel} range is longer than the load history, so the curve above covers only the days that have data — it is not stretched to fill the range.` : ""}
        Read this as a curve that fills in over time, not a long-term trend.
      </div>
    </div>
  </div>`;
}

function volumeCard(dataset: Dataset, from: Date, rangeKey: Range): string {
  // Weekly volume buckets. Volume has real depth, so the full range applies.
  const weeks: { start: Date; seconds: number; metres: number; dominant: Sport }[] = [];
  const firstWeek = weekStart(from);
  const lastWeek = weekStart(TODAY);
  const totalWeeks = Math.round(daysBetween(firstWeek, lastWeek) / 7) + 1;
  // Cap the bar count so a multi-year range stays legible; bucket by month past 26 weeks.
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
    const dominant =
      [...bySport.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "other";
    weeks.push({
      start,
      seconds: acts.reduce((acc, a) => acc + (a.duration_s ?? 0), 0),
      metres: acts.reduce((acc, a) => acc + (a.distance_m ?? 0), 0),
      dominant,
    });
  }

  const peak = Math.max(...weeks.map((w) => w.seconds), 1);
  const mean = weeks.reduce((a, w) => a + w.seconds, 0) / (weeks.length || 1);
  const unitNote = stride > 1 ? `${stride}-WEEK BUCKETS` : "WEEKLY VOLUME";

  return `<div class="card" style="margin-top:10px">
    <div class="sleep__head">
      <span class="eyebrow" style="letter-spacing:.16em;opacity:.55">${unitNote}</span>
      <span class="mono" style="font-weight:700;font-size:13px">Ø ${duration(mean)}</span>
    </div>
    <div class="volbars">
      ${weeks
        .map((w, i) => {
          const h = (w.seconds / peak) * 100;
          const showLabel = weeks.length <= 14 || i % Math.ceil(weeks.length / 7) === 0;
          return `<div class="volbars__col" title="${isoDay(w.start)} · ${duration(w.seconds)} · ${km(w.metres, 0)}km">
            <div class="volbars__bar" style="height:${h}%;background:${sportColor(w.dominant)}"></div>
            <div class="volbars__label">${showLabel ? shortDate(w.start.toISOString()).slice(0, 2) : ""}</div>
          </div>`;
        })
        .join("")}
    </div>
    <div class="mono" style="font-size:9px;opacity:.4;margin-top:8px;letter-spacing:.06em">
      BAR COLOUR = DOMINANT SPORT${rangeKey === "all" ? " · FULL HISTORY" : ""}
    </div>
  </div>`;
}

function wellnessTrio(dataset: Dataset): string {
  const recent = dataset.wellness.slice(-28);
  const last = recent[recent.length - 1];
  const cards = [
    { label: "HRV", value: round(last?.hrv ?? null), series: recent.map((w) => w.hrv), color: "var(--coral)" },
    { label: "RHR", value: round(last?.resting_hr ?? null), series: recent.map((w) => w.resting_hr), color: "var(--petrol)" },
    {
      label: "SLEEP",
      value: last?.sleep_hours ? last.sleep_hours.toFixed(1) : "–",
      series: recent.map((w) => w.sleep_hours),
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
