/** Home / This week — card 2a.
 *  Hero is MOVING TIME (not distance), readiness tile is petrol, and the whole
 *  Body screen is folded in under the week. */

import { sparkline } from "../charts";
import {
  addDays, dayStamp, duration, hoursMinutes, kmLabel, round, shortDate,
  signed, sportColor, sportInk, sportTag, weekStart,
} from "../format";
import { TODAY, weekOf } from "../mock";
import type { Activity, Dataset, Sport } from "../types";

const SPORT_ORDER: Sport[] = ["ride", "run", "gym", "other"];

function sumBy(list: Activity[], pick: (a: Activity) => number | null): number {
  return list.reduce((acc, a) => acc + (pick(a) ?? 0), 0);
}

function heroBars(dataset: Dataset): string {
  // Last 5 ISO weeks of moving time, most recent on the right.
  const cols: { seconds: number; label: string }[] = [];
  for (let i = 4; i >= 0; i--) {
    const ref = addDays(weekStart(TODAY), -7 * i);
    const week = weekOf(dataset.activities, ref);
    cols.push({ seconds: sumBy(week, (a) => a.duration_s), label: shortDate(ref.toISOString()).slice(0, 2) });
  }
  const peak = Math.max(...cols.map((c) => c.seconds), 1);
  return cols
    .map((c, i) => {
      const h = Math.max((c.seconds / peak) * 100, 3);
      // The current week is ink; earlier weeks sit back at 45%.
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

function sleepBlock(dataset: Dataset): string {
  const nights = dataset.wellness.slice(-7);
  if (!nights.length) return "";
  const peak = Math.max(...nights.map((n) => n.sleep_hours ?? 0), 1);
  const mean = nights.reduce((a, n) => a + (n.sleep_hours ?? 0), 0) / nights.length;

  const cols = nights
    .map((n) => {
      const s = n.sleep_stages;
      const total = n.sleep_hours ?? 0;
      const h = Math.max((total / peak) * 100, 3);
      const seg = (hours: number, color: string) =>
        `<div style="height:${total ? (hours / total) * 100 : 0}%;background:${color}"></div>`;
      const stack = s
        ? seg(s.awake_h, "var(--awake)") +
          seg(s.rem_h, "var(--ochre)") + // REM is ochre, per 2d
          seg(s.light_h, "var(--petrol)") +
          seg(s.deep_h, "var(--ink)")
        : `<div style="height:100%;background:var(--awake)"></div>`;
      return `<div class="sleep__col">
        <div class="sleep__stack" style="height:${h}%">${stack}</div>
        <div class="sleep__label">${shortDate(n.date).slice(0, 2)}</div>
      </div>`;
    })
    .join("");

  const { h, m } = hoursMinutes(mean * 3600);
  return `<div class="sleep">
    <div class="sleep__head">
      <span class="eyebrow" style="letter-spacing:.18em;opacity:.55">SLEEP · 7 NIGHTS</span>
      <span class="mono" style="font-weight:700;font-size:13px">Ø ${h}h${m}</span>
    </div>
    <div class="sleep__bars">${cols}</div>
  </div>`;
}

export function renderHome(dataset: Dataset): string {
  const week = weekOf(dataset.activities, TODAY);
  const weekSeconds = sumBy(week, (a) => a.duration_s);
  const weekMetres = sumBy(week, (a) => a.distance_m);
  const { h, m } = hoursMinutes(weekSeconds);

  // 4-week average for the delta line, excluding the current partial week.
  let prior = 0;
  for (let i = 1; i <= 4; i++) {
    prior += sumBy(weekOf(dataset.activities, addDays(weekStart(TODAY), -7 * i)), (a) => a.duration_s);
  }
  const avg = prior / 4;
  const delta = weekSeconds - avg;
  const deltaParts = hoursMinutes(Math.abs(delta));
  const avgParts = hoursMinutes(avg);

  const today = dataset.wellness[dataset.wellness.length - 1];
  const latest = [...dataset.wellness].reverse();
  const hrvSeries = latest.slice(0, 28).reverse().map((w) => w.hrv);
  const rhrSeries = latest.slice(0, 28).reverse().map((w) => w.resting_hr);

  // 7-day TSS from load, which only exists inside the intervals.icu window.
  const cutoff = addDays(TODAY, -7).getTime();
  const load7 = dataset.activities
    .filter((a) => a.load !== null && new Date(a.date).getTime() >= cutoff)
    .reduce((acc, a) => acc + (a.load ?? 0), 0);

  const readinessAbsent = today?.readiness === null || today?.readiness === undefined;
  const batteryAbsent = today?.body_battery === null || today?.body_battery === undefined;

  return `
  <div class="statusbar"><span>9:41</span><span>5G · 82%</span></div>
  <div class="wordmark">
    <span class="wordmark__name">NAHVA</span>
    <span class="wordmark__date">${dayStamp(TODAY.toISOString())}</span>
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
      <span>${kmLabel(weekMetres)}</span><span class="sep">·</span><span>${week.length} sessions</span>
    </div>
  </section>

  ${splitBar(week)}

  <div class="tiles">
    <div class="tile tile--petrol">
      <div class="tile__label">READINESS</div>
      <div class="tile__value${readinessAbsent ? " tile__value--absent" : ""}">${
        readinessAbsent ? "—" : `${round(today.readiness)}<small>%</small>`
      }</div>
      <div class="tile__foot${readinessAbsent ? " tile__foot--absent" : ""}">${
        readinessAbsent ? "NOT REPORTED" : `HRV ${round(today.hrv)}ms`
      }</div>
    </div>
    <div class="tile tile--outline">
      <div class="tile__label">FORM · TSB</div>
      <div class="tile__value" style="color:${(today?.form ?? 0) >= 0 ? "var(--petrol)" : "var(--coral)"}">${signed(today?.form ?? null)}</div>
      <div class="tile__foot">${formWord(today?.form ?? null)}</div>
    </div>
  </div>

  <div class="strip" style="grid-template-columns:1fr 1fr 1fr">
    <div class="strip__cell">
      <div class="strip__label">CTL</div>
      <div class="strip__value">${round(today?.ctl ?? null)}</div>
    </div>
    <div class="strip__cell">
      <div class="strip__label">ATL</div>
      <div class="strip__value">${round(today?.atl ?? null)}</div>
    </div>
    <div class="strip__cell">
      <div class="strip__label">7D TSS</div>
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
    <span class="section-head__meta">${today ? shortDate(today.date) : ""}</span>
  </div>

  <div class="body-batt">
    <div>
      <div class="tile__label" style="opacity:.65">BODY BATTERY</div>
      <div class="body-batt__value${batteryAbsent ? " tile__value--absent" : ""}">${
        batteryAbsent ? "—" : round(today.body_battery)
      }</div>
      ${batteryAbsent ? `<div class="tile__foot--absent mono" style="font-size:10px;opacity:.6;margin-top:4px">NOT REPORTED BY DEVICE</div>` : ""}
    </div>
    <div class="body-batt__side">
      <div>RHR ${round(today?.resting_hr ?? null)}</div>
      <div>HRV ${round(today?.hrv ?? null)}ms</div>
      <div>${today?.weight_kg === null || today?.weight_kg === undefined ? "— kg" : `${today.weight_kg} kg`}</div>
    </div>
  </div>

  ${sleepBlock(dataset)}

  <div class="minis">
    <div class="mini">
      <div class="mini__label">HRV 28D</div>
      <div class="mini__value">${round(today?.hrv ?? null)}<small>ms</small></div>
      ${sparkline(hrvSeries, "var(--coral)")}
    </div>
    <div class="mini">
      <div class="mini__label">RESTING HR</div>
      <div class="mini__value">${round(today?.resting_hr ?? null)}<small>bpm</small></div>
      ${sparkline(rhrSeries, "var(--petrol)")}
    </div>
  </div>
  <div class="spacer"></div>`;
}

function formWord(form: number | null): string {
  if (form === null) return "—";
  if (form > 5) return "FRESH";
  if (form >= -5) return "FRESH-ISH";
  if (form >= -15) return "LOADED";
  return "DEEP";
}
