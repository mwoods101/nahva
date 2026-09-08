/** Home / This week — card 2a.
 *  Hero is MOVING TIME (not distance), and the Body screen is folded in below.
 *
 *  DEVIATION FROM CARD 2a, agreed 2026-09-08: the readiness tile and the
 *  body-battery block are gone, and the sleep chart shows total hours instead
 *  of a stage stack. None of those three has a data source — intervals.icu
 *  returns no bodyBattery field, readiness is null on every row, and there is no
 *  stage breakdown, only sleepSecs. Rather than three permanently-empty
 *  elements, the slots now carry HRV, RHR and sleep hours, which are populated.
 */

import { sparkline } from "../charts";
import {
  addDays, dayStamp, duration, hoursMinutes, kmLabel, round, shortDate,
  signed, sportColor, sportInk, sportTag, weekStart,
} from "../format";
import { weekOf } from "../mock";
import { latest, series } from "../wellness";
import type { Activity, Dataset, Sport } from "../types";

const SPORT_ORDER: Sport[] = ["ride", "run", "gym", "other"];

function sumBy(list: Activity[], pick: (a: Activity) => number | null): number {
  return list.reduce((acc, a) => acc + (pick(a) ?? 0), 0);
}

function heroBars(dataset: Dataset): string {
  const cols: { seconds: number; label: string }[] = [];
  for (let i = 4; i >= 0; i--) {
    const ref = addDays(weekStart(dataset.today), -7 * i);
    const week = weekOf(dataset.activities, ref);
    cols.push({
      seconds: sumBy(week, (a) => a.duration_s),
      label: shortDate(ref.toISOString()).slice(0, 2),
    });
  }
  const peak = Math.max(...cols.map((c) => c.seconds), 1);
  return cols
    .map((c, i) => {
      const h = Math.max((c.seconds / peak) * 100, 3);
      const color = i === cols.length - 1 ? "var(--ink)" : "rgba(23,20,15,.45)";
      return `<div class="sparkbars__col">
        <div class="sparkbars__bar" style="height:${h}%;background:${color}"></div>
        <div class="sparkbars__label">${c.label}</div>
      </div>`;
    })
    .join("");
}

function splitBar(week: Activity[]): string {
  const totals = SPORT_ORDER.map((sport) => {
    const list = week.filter((a) => a.sport === sport);
    return { sport, seconds: sumBy(list, (a) => a.duration_s), count: list.length };
  }).filter((t) => t.count > 0);

  if (!totals.length) return "";

  return `<div class="split">${totals
    .map(
      (t) => `<div class="split__seg" style="flex:${Math.max(t.seconds, 1)}">
        <div class="split__rule" style="background:${sportColor(t.sport)}"></div>
        <span class="split__label">${t.count} ${sportTag(t.sport)} · ${duration(t.seconds)}</span>
      </div>`,
    )
    .join("")}</div>`;
}

function recentRows(dataset: Dataset): string {
  const recent = [...dataset.activities].reverse().slice(0, 3);
  if (!recent.length) return `<div class="cal__empty">NO ACTIVITIES</div>`;
  return recent
    .map(
      (a) => `<button class="row" data-activity="${a.id}">
      <div class="row__tag" style="background:${sportColor(a.sport)};color:${sportInk(a.sport)}">${sportTag(a.sport)}</div>
      <div class="row__body">
        <div class="row__title">${a.name ?? "Untitled"}</div>
        <div class="row__meta">${dayStamp(a.date)}</div>
      </div>
      <div class="row__right">
        <div class="row__dur">${duration(a.duration_s)}</div>
        <div class="row__dist">${a.sport === "gym" ? "—" : kmLabel(a.distance_m)}</div>
      </div>
    </button>`,
    )
    .join("");
}

/** Sleep as total hours. No stage stack — the source has no stages. */
function sleepBlock(dataset: Dataset): string {
  const nights = dataset.wellness.slice(-7).filter((n) => n.sleep_hours !== null);
  if (!nights.length) return "";
  const peak = Math.max(...nights.map((n) => n.sleep_hours ?? 0), 1);
  const mean = nights.reduce((a, n) => a + (n.sleep_hours ?? 0), 0) / nights.length;
  const { h, m } = hoursMinutes(mean * 3600);

  const cols = nights
    .map((n) => {
      const hrs = n.sleep_hours ?? 0;
      return `<div class="sleep__col" title="${n.date} · ${hrs.toFixed(1)}h">
        <div class="sleep__stack" style="height:${Math.max((hrs / peak) * 100, 3)}%;background:var(--petrol)"></div>
        <div class="sleep__label">${hrs.toFixed(1)}</div>
      </div>`;
    })
    .join("");

  return `<div class="sleep">
    <div class="sleep__head">
      <span class="eyebrow" style="letter-spacing:.18em;opacity:.55">SLEEP · LAST ${nights.length}</span>
      <span class="mono" style="font-weight:700;font-size:13px">Ø ${h}h${m}</span>
    </div>
    <div class="sleep__bars">${cols}</div>
  </div>`;
}

export function renderHome(dataset: Dataset): string {
  const today = dataset.today;
  const week = weekOf(dataset.activities, today);
  const weekSeconds = sumBy(week, (a) => a.duration_s);
  const weekMetres = sumBy(week, (a) => a.distance_m);
  const { h, m } = hoursMinutes(weekSeconds);
  const ws = weekStart(today);

  let prior = 0;
  for (let i = 1; i <= 4; i++) {
    prior += sumBy(weekOf(dataset.activities, addDays(ws, -7 * i)), (a) => a.duration_s);
  }
  const avg = prior / 4;
  const delta = weekSeconds - avg;
  const deltaParts = hoursMinutes(Math.abs(delta));
  const avgParts = hoursMinutes(avg);

  // Each metric resolved independently: today's row has ctl/atl before Garmin
  // has pushed hrv/restingHR, so a single-row read shows "—" for the latter.
  const ctl = latest(dataset.wellness, "ctl");
  const atl = latest(dataset.wellness, "atl");
  const form = latest(dataset.wellness, "form");
  const hrv = latest(dataset.wellness, "hrv");
  const rhr = latest(dataset.wellness, "resting_hr");
  const hrvSeries = series(dataset.wellness, "hrv", 28);
  const rhrSeries = series(dataset.wellness, "resting_hr", 28);
  const newest = dataset.wellness[dataset.wellness.length - 1] ?? null;

  const cutoff = addDays(today, -7).getTime();
  const load7 = dataset.activities
    .filter((a) => a.load !== null && new Date(a.date).getTime() >= cutoff)
    .reduce((acc, a) => acc + (a.load ?? 0), 0);

  return `
  <div class="wordmark">
    <span class="wordmark__name">NAHVA</span>
    <span class="wordmark__date">${dayStamp(today.toISOString())}</span>
  </div>

  <section class="hero">
    <div class="hero__label">THIS WEEK · MOVING TIME</div>
    <div class="hero__row">
      <div class="hero__figure">
        <span class="hero__num">${h}</span><span class="hero__unit">h</span><span class="hero__num">${m}</span>
      </div>
      <div class="sparkbars">${heroBars(dataset)}</div>
    </div>
    <div class="hero__delta">
      <span>${delta >= 0 ? "▲" : "▼"} ${delta >= 0 ? "+" : "−"}${deltaParts.h}h ${deltaParts.m}</span>
      <span>VS 4-WK AVG ${avgParts.h}h ${avgParts.m}</span>
    </div>
    <div class="hero__sub">
      <span>${kmLabel(weekMetres)}</span><span class="sep">·</span>
      <span>${week.length} session${week.length === 1 ? "" : "s"}</span><span class="sep">·</span>
      <span>WEEK OF ${shortDate(ws.toISOString())}</span>
    </div>
  </section>

  ${splitBar(week)}

  <div class="tiles">
    <div class="tile tile--outline">
      <div class="tile__label">FORM · TSB</div>
      <div class="tile__value" style="color:${(form.value ?? 0) >= 0 ? "var(--petrol)" : "var(--coral)"}">${signed(form.value)}</div>
      <div class="tile__foot">${formWord(form.value)}${staleNote(form.ageDays, form.date)}</div>
    </div>
    <div class="tile tile--petrol">
      <div class="tile__label">HRV</div>
      <div class="tile__value${hrv.value === null ? " tile__value--absent" : ""}">${round(hrv.value)}${
        hrv.value === null ? "" : "<small>ms</small>"
      }</div>
      <div class="tile__foot">RHR ${round(rhr.value)}${staleNote(hrv.ageDays, hrv.date)}</div>
    </div>
  </div>

  <div class="strip" style="grid-template-columns:1fr 1fr 1fr">
    <div class="strip__cell">
      <div class="strip__label">CTL</div>
      <div class="strip__value">${round(ctl.value)}</div>
    </div>
    <div class="strip__cell">
      <div class="strip__label">ATL</div>
      <div class="strip__value">${round(atl.value)}</div>
    </div>
    <div class="strip__cell">
      <div class="strip__label">7D LOAD</div>
      <div class="strip__value${load7 ? "" : " strip__value--absent"}">${load7 || "—"}</div>
    </div>
  </div>

  <div class="section-head">
    <span class="section-head__title">Recent</span>
    <span class="section-head__meta">ALL ${dataset.activities.length}</span>
  </div>
  <div class="rows">${recentRows(dataset)}</div>

  <div class="section-head" style="margin-top:6px;border-top:1.5px solid var(--hairline);padding-top:26px">
    <span class="section-head__title">Body</span>
    <span class="section-head__meta">${newest ? shortDate(newest.date) : "NO DATA"}</span>
  </div>

  ${sleepBlock(dataset)}

  <div class="minis">
    <div class="mini">
      <div class="mini__label">HRV 28D</div>
      <div class="mini__value">${round(hrv.value)}${hrv.value === null ? "" : "<small>ms</small>"}</div>
      ${sparkline(hrvSeries, "var(--coral)")}
    </div>
    <div class="mini">
      <div class="mini__label">RESTING HR</div>
      <div class="mini__value">${round(rhr.value)}${rhr.value === null ? "" : "<small>bpm</small>"}</div>
      ${sparkline(rhrSeries, "var(--petrol)")}
    </div>
  </div>
  <div class="spacer"></div>`;
}

/** "· 05 SEP" when a value isn't from the newest row, so a stale number is
 *  never read as today's. */
function staleNote(ageDays: number, date: string | null): string {
  if (ageDays === 0 || !date) return "";
  return ` · ${shortDate(date)}`;
}

function formWord(form: number | null): string {
  if (form === null) return "NO LOAD DATA";
  if (form > 5) return "FRESH";
  if (form >= -5) return "FRESH-ISH";
  if (form >= -15) return "LOADED";
  return "DEEP";
}
