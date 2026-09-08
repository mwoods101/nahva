/** Activity detail — card 1g. Sport-coloured header, segment block diagram,
 *  recovery context underneath.
 *
 *  The header ground follows the sport and the type colour follows the 2d rule
 *  (coral/ochre carry ink, petrol carries paper).
 *
 *  On STRUCTURE: this used to print "N × Mmin @ threshold", which invented a
 *  workout that the data does not describe. intervals.icu auto-splits an
 *  unstructured run into ~1 km laps — every segment type="WORK", label null — so
 *  the heading now reports what the segments actually are and says nothing about
 *  intent. Load is shown only where it exists; Strava rows have none and must
 *  never borrow strava_load, which is barred from the PMC.
 */

import { clock, duration, km, pace, round, signed, sportTag, whenStamp } from "../format";
import type { Dataset, Interval, Wellness } from "../types";

export function renderActivity(dataset: Dataset, id: string): string {
  const a = dataset.activities.find((x) => x.id === id);
  if (!a) {
    return `<div class="page-title"><div class="page-title__h">Not found</div></div>
      <div class="cal__empty">NO ACTIVITY WITH ID ${id}</div>`;
  }

  const day = a.date.slice(0, 10);
  const morning = dataset.wellness.find((w) => w.date === day) ?? null;
  const next = dataset.wellness.find(
    (w) => w.date === new Date(new Date(day).getTime() + 864e5).toISOString().slice(0, 10),
  ) ?? null;

  const metrics: [string, string][] = [
    ["AVG HR", a.avg_hr ? `${a.avg_hr} bpm` : "–"],
    ["MAX HR", a.max_hr ? `${a.max_hr} bpm` : "–"],
    ["AVG PACE", pace(a.avg_pace_s_per_km)],
    ["AVG POWER", a.avg_power ? `${round(a.avg_power)} W` : "–"],
    ["ELEV GAIN", a.elevation_m ? `${round(a.elevation_m)} m` : "–"],
    ["ELAPSED", clock(a.elapsed_s)],
  ];

  return `
  <header class="detail__header detail__header--${a.sport}">
    <div class="detail__bar">
      <button class="detail__back" data-back="1">← BACK</button>
      <span>${sportTag(a.sport)} · ${a.source.toUpperCase()}</span>
    </div>
    <div class="detail__title">${a.name ?? "Untitled"}</div>
    <div class="detail__when">${whenStamp(a.date)}</div>
  </header>

  <div class="detail__keys">
    <div class="detail__key">
      <div class="detail__key-label">DISTANCE</div>
      <div class="detail__key-value">${
        a.sport === "gym" || !a.distance_m ? "–" : `${km(a.distance_m)}<small> km</small>`
      }</div>
    </div>
    <div class="detail__key">
      <div class="detail__key-label">TIME</div>
      <div class="detail__key-value">${clock(a.duration_s)}</div>
    </div>
    <div class="detail__key">
      <div class="detail__key-label">LOAD</div>
      <div class="detail__key-value" style="color:${a.load !== null ? "var(--coral)" : "inherit"};${
        a.load === null ? "opacity:.3" : ""
      }">${a.load !== null ? round(a.load) : "–"}</div>
    </div>
  </div>

  ${
    a.load === null
      ? `<div class="mono" style="padding:10px var(--pad-screen);font-size:9.5px;letter-spacing:.08em;opacity:.5;border-bottom:1px solid var(--hairline-soft)">
          NO TRAINING LOAD · STRAVA-SOURCED${
            a.strava_load !== null ? ` · STRAVA'S OWN FIGURE WAS ${round(a.strava_load)}, NOT USED` : ""
          }
        </div>`
      : ""
  }

  <div class="detail__metrics">
    ${metrics.map(([k, v]) => `<div class="detail__metric"><span>${k}</span><span>${v}</span></div>`).join("")}
  </div>

  ${a.intervals && a.intervals.length ? structure(a.intervals) : ""}

  ${recoveryContext(morning, next)}`;
}

/** Describe the segments without claiming intent. */
function describe(ivals: Interval[]): string {
  const work = ivals.filter((i) => i.type === "WORK");
  const rest = ivals.filter((i) => i.type && i.type !== "WORK");

  if (rest.length) {
    const repMins = work.length
      ? Math.round(work.reduce((s, i) => s + (i.duration_s ?? 0), 0) / work.length / 60)
      : 0;
    return `${work.length} × ~${repMins}min work · ${rest.length} recovery`;
  }

  // All one type: intervals.icu's auto-split. Are they even laps?
  const dists = ivals.map((i) => i.distance_m ?? 0).filter((d) => d > 0);
  if (dists.length >= 2) {
    // Ignore a short final part-lap when judging uniformity.
    const full = dists.length > 2 ? dists.slice(0, -1) : dists;
    const mean = full.reduce((a, b) => a + b, 0) / full.length;
    const uniform = full.every((d) => Math.abs(d - mean) / mean < 0.1);
    if (uniform) {
      return `${ivals.length} auto-split laps · ${(mean / 1000).toFixed(2)} km each`;
    }
  }
  return `${ivals.length} segments`;
}

function structure(ivals: Interval[]): string {
  const totalS = ivals.reduce((s, i) => s + (i.duration_s ?? 0), 0);

  return `
  <div style="padding:20px var(--pad-screen) 6px" class="eyebrow">STRUCTURE</div>
  <div class="screen-pad">
    <div style="font:700 22px var(--display);letter-spacing:-.01em">${describe(ivals)}</div>
    <div class="mono" style="font-size:10.5px;opacity:.55;margin-top:4px">
      ${duration(totalS)} across ${ivals.length} · from intervals.icu, not a planned workout
    </div>
    <div class="blocks">
      ${ivals
        .map((i) => {
          // Height reads intensity (0..1 after normalisation in the sync).
          const pctHeight = Math.min(Math.max((i.intensity ?? 0.5) * 100, 4), 100);
          const isWork = i.type === "WORK";
          return `<div class="blocks__b" title="${i.label}: ${duration(i.duration_s)} · ${pace(i.pace_s_per_km)}"
            style="flex:${Math.max(i.duration_s ?? 1, 1)};height:${pctHeight.toFixed(0)}%;
            background:${isWork ? "var(--coral)" : "rgba(23,20,15,.18)"}"></div>`;
        })
        .join("")}
    </div>
    <div class="blocks__base"></div>
  </div>

  <div class="ivals">
    ${ivals
      .map(
        (i) => `<div class="ival">
        <span class="ival__n">${i.label}</span>
        <span class="ival__dur">${duration(i.duration_s)}${
          i.distance_m ? ` · ${(i.distance_m / 1000).toFixed(2)}km` : ""
        }</span>
        <span class="ival__pace">${pace(i.pace_s_per_km)}</span>
        <span class="ival__hr">${i.avg_hr ? `${i.avg_hr} bpm` : "–"}</span>
      </div>`,
      )
      .join("")}
  </div>`;
}

/** Readiness is not referenced: the source returns null on every row. */
function recoveryContext(morning: Wellness | null, next: Wellness | null): string {
  if (!morning && !next) {
    return `<div class="context">
      <div class="context__label">RECOVERY CONTEXT</div>
      <div class="context__foot" style="margin-top:8px">
        No wellness data for this date — intervals.icu only covers recent weeks.
      </div>
    </div>`;
  }
  return `<div class="context">
    <div class="context__label">RECOVERY CONTEXT</div>
    <div class="context__row">
      <div>
        <div class="context__k">MORNING HRV</div>
        <div class="context__v">${morning?.hrv ? round(morning.hrv) : "–"}</div>
      </div>
      <div>
        <div class="context__k">TSB</div>
        <div class="context__v" style="color:${(morning?.form ?? 0) < 0 ? "var(--ochre)" : "inherit"}">${signed(morning?.form ?? null)}</div>
      </div>
      <div>
        <div class="context__k">NEXT DAY TSB</div>
        <div class="context__v">${signed(next?.form ?? null)}</div>
      </div>
    </div>
    <div class="context__foot">
      Sleep ${morning?.sleep_hours ? `${morning.sleep_hours.toFixed(1)}h` : "–"} ·
      RHR ${morning?.resting_hr ? round(morning.resting_hr) : "–"} ·
      CTL ${round(morning?.ctl ?? null)} / ATL ${round(morning?.atl ?? null)}
    </div>
  </div>`;
}
