/** Activity detail — card 1g. Sport-coloured header, interval structure as a
 *  real block diagram, recovery context underneath.
 *
 *  The header ground follows the sport, and the type colour follows the 2d rule
 *  (coral/ochre carry ink, petrol carries paper). Load is shown only when it
 *  exists — Strava-sourced activities have none, and must not borrow
 *  strava_load, which never feeds the PMC. */

import { clock, duration, km, pace, round, signed, sportTag, whenStamp } from "../format";
import type { Activity, Dataset, Wellness } from "../types";

export function renderActivity(dataset: Dataset, id: string): string {
  const a = dataset.activities.find((x) => x.id === id);
  if (!a) {
    return `<div class="statusbar"><span>9:41</span><span>5G · 82%</span></div>
      <div class="page-title"><div class="page-title__h">Not found</div></div>
      <div class="cal__empty">NO ACTIVITY WITH ID ${id}</div>`;
  }

  const day = a.date.slice(0, 10);
  const morning = dataset.wellness.find((w) => w.date === day) ?? null;
  const nextDay = dataset.wellness.find(
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
    <div style="display:flex;justify-content:space-between;font:400 11px var(--data);opacity:.6">
      <span>9:41</span><span>5G · 82%</span>
    </div>
    <div class="detail__bar">
      <button class="detail__back" data-back="1">← BACK</button>
      <span>${sportTag(a.sport)}</span>
    </div>
    <div class="detail__title">${a.name ?? "Untitled"}</div>
    <div class="detail__when">${whenStamp(a.date)}</div>
    ${
      a.intervals
        ? `<div class="detail__note">${a.intervals.filter((i) => /^\d+$/.test(i.label)).length} × ${Math.round(
            (a.intervals.find((i) => /^\d+$/.test(i.label))?.duration_s ?? 0) / 60,
          )}min working set.</div>`
        : ""
    }
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
      }">${a.load !== null ? a.load : "–"}</div>
    </div>
  </div>

  ${
    a.load === null
      ? `<div class="mono" style="padding:10px var(--pad-screen);font-size:9.5px;letter-spacing:.08em;opacity:.5;border-bottom:1px solid var(--hairline-soft)">
          NO TRAINING LOAD · STRAVA-SOURCED${a.strava_load !== null ? ` · STRAVA'S OWN FIGURE WAS ${a.strava_load}, NOT USED` : ""}
        </div>`
      : ""
  }

  <div class="detail__metrics">
    ${metrics
      .map(
        ([k, v]) => `<div class="detail__metric"><span>${k}</span><span>${v}</span></div>`,
      )
      .join("")}
  </div>

  ${a.intervals ? structure(a) : ""}

  ${recoveryContext(morning, nextDay)}`;
}

function structure(a: Activity): string {
  const ivals = a.intervals ?? [];
  const reps = ivals.filter((i) => /^\d+$/.test(i.label));
  const repMins = Math.round((reps[0]?.duration_s ?? 0) / 60);

  return `
  <div style="padding:20px var(--pad-screen) 6px" class="eyebrow">STRUCTURE</div>
  <div class="screen-pad">
    <div style="font:700 22px var(--display);letter-spacing:-.01em">${reps.length} × ${repMins}min</div>
    <div class="mono" style="font-size:10.5px;opacity:.55;margin-top:4px">
      ${ivals
        .filter((i) => !/^\d+$/.test(i.label))
        .map((i) => `${Math.round(i.duration_s / 60)}min ${i.label.toLowerCase()}`)
        .join(" · ")}
    </div>
    <div class="blocks">
      ${ivals
        .map((i) => {
          // Working reps take the sport colour; the rest sit back in ink.
          const isRep = /^\d+$/.test(i.label);
          const color = isRep ? "var(--coral)" : "rgba(23,20,15,.18)";
          return `<div class="blocks__b" style="flex:${i.duration_s};height:${(i.intensity * 100).toFixed(0)}%;background:${color}"></div>`;
        })
        .join("")}
    </div>
    <div class="blocks__base"></div>
  </div>

  <div class="ivals">
    ${reps
      .map(
        (i) => `<div class="ival">
        <span class="ival__n">${i.label}</span>
        <span class="ival__dur">${duration(i.duration_s)}</span>
        <span class="ival__pace">${pace(i.pace_s_per_km)}</span>
        <span class="ival__hr">${i.avg_hr ? `${i.avg_hr} bpm` : "–"}</span>
      </div>`,
      )
      .join("")}
  </div>`;
}

function recoveryContext(morning: Wellness | null, next: Wellness | null): string {
  // readiness is null from intervals.icu, so this block leads with what exists
  // (HRV, RHR, sleep, TSB) and marks readiness absent rather than faking it.
  const readinessAbsent = morning?.readiness === null || morning?.readiness === undefined;
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
      Readiness ${readinessAbsent ? "not reported" : `${round(morning!.readiness)}%`}
    </div>
  </div>`;
}
