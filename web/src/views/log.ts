/** Training log — card 2b. A calendar: week per row, one dot per activity,
 *  dot size and its number both read duration (or km). Scrolls back 13 weeks.
 *  TIME/KM toggle, sport filter and day selection are all live, and tapping a
 *  dot opens that activity. */

import {
  addDays, dowLetter, duration, hoursMinutes, isoDay, km, kmLabel, monthYear,
  shortDate, sportColor, sportInk, sportTag, weekStart,
} from "../format";
import type { Activity, Dataset, Sport } from "../types";

export type Metric = "time" | "km";
export type Filter = "all" | Sport;

export interface LogState {
  metric: Metric;
  filter: Filter;
  /** ISO day (YYYY-MM-DD). Null until the user picks one. */
  selected: string | null;
}

const WEEKS_BACK = 13;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "ALL" },
  { key: "run", label: "RUN" },
  { key: "ride", label: "RIDE" },
  { key: "gym", label: "GYM" },
];

export function defaultLogState(): LogState {
  return { metric: "time", filter: "all", selected: null };
}

function visible(activities: Activity[], filter: Filter): Activity[] {
  return filter === "all" ? activities : activities.filter((a) => a.sport === filter);
}

function metricValue(a: Activity, metric: Metric): number {
  return metric === "time" ? (a.duration_s ?? 0) / 3600 : (a.distance_m ?? 0) / 1000;
}

/** Dot size AND its number both read the metric, per card 2b. Tappable. */
function dotFor(a: Activity, metric: Metric, peak: number): string {
  const v = metricValue(a, metric);
  const size = Math.max(14, Math.min(34, 14 + (v / (peak || 1)) * 20));
  const label = metric === "time" ? Math.round(v * 10) / 10 : Math.round(v);
  const fs = size >= 26 ? 9 : size >= 20 ? 8 : 7;
  const detail = `${a.name ?? "Untitled"} · ${duration(a.duration_s)}${
    a.sport === "gym" ? "" : ` · ${kmLabel(a.distance_m)}`
  }`;
  return `<button class="cal__dot" data-activity="${a.id}" title="${detail}"
    style="width:${size.toFixed(0)}px;height:${size.toFixed(0)}px;border:0;padding:0;cursor:pointer;
    background:${sportColor(a.sport)};color:${sportInk(a.sport)};font-size:${fs}px"
    >${label}</button>`;
}

export function renderLog(dataset: Dataset, state: LogState): string {
  const today = dataset.today;
  const list = visible(dataset.activities, state.filter);
  const thisWeekStart = weekStart(today);
  const firstWeek = addDays(thisWeekStart, -7 * (WEEKS_BACK - 1));

  const inRange = list.filter((a) => new Date(a.date).getTime() >= firstWeek.getTime());
  const peak = Math.max(...inRange.map((a) => metricValue(a, state.metric)), 1);

  const spanSeconds = inRange.reduce((acc, a) => acc + (a.duration_s ?? 0), 0);
  const spanMetres = inRange.reduce((acc, a) => acc + (a.distance_m ?? 0), 0);

  const rows: string[] = [];
  for (let wk = WEEKS_BACK - 1; wk >= 0; wk--) {
    const start = addDays(thisWeekStart, -7 * wk);
    const weekActs = list.filter((a) => {
      const t = new Date(a.date).getTime();
      return t >= start.getTime() && t < addDays(start, 7).getTime();
    });

    // Was "290k" for 290 km, which reads as 290,000. Units are explicit now.
    const weekTotal =
      state.metric === "time"
        ? duration(weekActs.reduce((acc, a) => acc + (a.duration_s ?? 0), 0))
        : (() => {
            const metres = weekActs.reduce((acc, a) => acc + (a.distance_m ?? 0), 0);
            return metres > 0 ? `${km(metres, 0)}km` : "–";
          })();

    const days: string[] = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, d);
      const iso = isoDay(day);
      const dayActs = weekActs.filter((a) => a.date.slice(0, 10) === iso);
      const isFuture = day.getTime() > today.getTime();
      // A div, not a button: the dots inside are buttons, and nesting buttons
      // is invalid. Event delegation resolves the innermost match, so a dot tap
      // opens the activity and a tap elsewhere in the cell selects the day.
      days.push(`<div class="cal__day" data-day="${iso}" role="button" tabindex="0"
        aria-selected="${state.selected === iso}" aria-disabled="${isFuture}">
        <span class="cal__daynum" style="opacity:${isFuture ? 0.2 : 0.5}">${day.getUTCDate()}</span>
        <div class="cal__dots">${dayActs.map((a) => dotFor(a, state.metric, peak)).join("")}</div>
      </div>`);
    }

    rows.push(`<div class="cal__week">
      <div class="cal__wk">
        <div class="cal__wk-start">${shortDate(start.toISOString())}</div>
        <div class="cal__wk-total">${weekTotal}</div>
      </div>
      ${days.join("")}
    </div>`);
  }

  const selectedActs = state.selected
    ? dataset.activities
        .filter((a) => a.date.slice(0, 10) === state.selected)
        .filter((a) => state.filter === "all" || a.sport === state.filter)
    : [];

  const span = hoursMinutes(spanSeconds);

  return `
  <section class="body-batt" style="margin-top:16px">
    <div>
      <div class="tile__label" style="opacity:.65">${WEEKS_BACK} WEEKS · ${
        state.metric === "time" ? "MOVING TIME" : "DISTANCE"
      }</div>
      <div style="display:flex;align-items:flex-end;gap:5px;margin-top:4px">
        ${
          state.metric === "time"
            ? `<span style="font:700 46px/1 var(--display);letter-spacing:-.04em;color:var(--coral)">${span.h}</span>
               <span style="font:700 18px var(--display);padding-bottom:4px">h</span>
               <span style="font:700 46px/1 var(--display);letter-spacing:-.04em;color:var(--coral)">${span.m}</span>`
            : `<span style="font:700 46px/1 var(--display);letter-spacing:-.04em;color:var(--coral)">${km(spanMetres, 0)}</span>
               <span style="font:700 18px var(--display);padding-bottom:4px">km</span>`
        }
      </div>
    </div>
    <div class="toggle">
      <button class="toggle__opt" data-metric="time" aria-pressed="${state.metric === "time"}">TIME</button>
      <button class="toggle__opt" data-metric="km" aria-pressed="${state.metric === "km"}">KM</button>
    </div>
  </section>

  <div style="display:flex;justify-content:space-between;align-items:center;padding:14px var(--pad-screen)">
    <div class="chips">
      ${FILTERS.map(
        (f) =>
          `<button class="chip" data-filter="${f.key}" aria-pressed="${state.filter === f.key}">${f.label}</button>`,
      ).join("")}
    </div>
    <span class="mono" style="font-size:10px;opacity:.45">${monthYear(today.toISOString())}</span>
  </div>

  <div class="cal">
    <div class="cal__head">
      <span></span>
      ${Array.from({ length: 7 }, (_, i) => `<span class="cal__dow">${dowLetter(i)}</span>`).join("")}
    </div>
    <div class="cal__scroll" id="cal-scroll">${rows.join("")}</div>
    <div class="cal__legend">
      <span style="color:var(--coral)">● RUN</span>
      <span style="color:var(--petrol)">● RIDE</span>
      <span style="color:var(--ochre)">● GYM</span>
      <span style="opacity:.4">SIZE = ${state.metric === "time" ? "HOURS" : "KM"} · TAP A DOT</span>
    </div>
  </div>

  <div class="section-head" style="padding-top:18px">
    <span class="eyebrow" style="letter-spacing:.2em;opacity:1">${
      state.selected ? shortDate(state.selected) : "—"
    }</span>
    <span class="section-head__meta">SELECTED DAY</span>
  </div>

  ${
    !state.selected
      ? `<div class="cal__empty">TAP A DAY IN THE CALENDAR</div>`
      : selectedActs.length
        ? `<div class="rows">${selectedActs
            .map(
              (a) => `<button class="row" data-activity="${a.id}">
            <div class="row__tag row__tag--dot" style="background:${sportColor(a.sport)}"></div>
            <div class="row__body">
              <div class="row__title">${a.name ?? "Untitled"}</div>
              <div class="row__meta">${sportTag(a.sport)} · ${a.sport === "gym" ? "—" : kmLabel(a.distance_m)}</div>
            </div>
            <span class="row__dur">${duration(a.duration_s)}</span>
          </button>`,
            )
            .join("")}</div>`
        : `<div class="cal__empty">REST DAY</div>`
  }
  <div class="spacer"></div>`;
}
