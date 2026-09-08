/** Mock dataset for workstream D.
 *
 * Deliberately shaped like the REAL data, so the views are exercised against
 * the conditions they'll actually meet at JOIN:
 *
 *   - Volume history runs deep (years of activities, mostly rides).
 *   - `load` exists only on the last ~5 weeks, because it comes from
 *     intervals.icu, which holds 2026-08-04 -> 2026-09-07 and nothing earlier.
 *   - `readiness` and `body_battery` are NULL throughout — the API returns no
 *     bodyBattery field at all and readiness is null on every row.
 *   - Recent activities are runs and gym sessions; there are no recent rides,
 *     matching intervals.icu having zero rides.
 *
 * Anything that renders convincingly here will render correctly on live data.
 * Deterministic (seeded) so the UI is stable between reloads.
 */

import { addDays, isoDay, weekStart } from "./format";
import type { Activity, Dataset, Interval, Sport, Wellness } from "./types";

/** mulberry32 — small deterministic PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "Today" is pinned so the mock never drifts relative to its own data.
 *  Deliberately a Sunday — the last complete ISO week — so the Home hero shows
 *  a full week rather than a Monday-morning week of one session. The
 *  single-session state still renders correctly; it just makes a poor fixture. */
export const TODAY = new Date("2026-09-06T20:15:00Z");

/** Load/CTL coverage — mirrors the real intervals.icu window exactly. */
const LOAD_FROM = new Date("2026-08-04T00:00:00Z");

/** Volume history start — mirrors the real Strava export. */
const VOLUME_FROM = new Date("2013-07-22T00:00:00Z");

const RUN_NAMES = [
  "Morning Run", "Threshold intervals", "Kingston upon Thames Running",
  "Easy shakeout", "Long run", "Evening Run", "Hill reps", "Riverside tempo",
];
const RIDE_NAMES = [
  "Morning Ride", "Commute", "Box Hill loop", "Zwift · Watopia",
  "Surrey lanes", "Evening Ride", "Turbo session",
];
const GYM_NAMES = ["Strength", "Evening Weight Training", "Lower body", "Upper + core"];

/** Auto-split ~1 km laps, which is what intervals.icu actually returns for an
 *  unstructured run: every segment type="WORK", label null, HR drifting up.
 *  The laps SUM TO the activity's own duration — the previous version emitted a
 *  fixed 3,780s structure for every run regardless of length, so a 36-minute
 *  run carried a 63-minute structure. */
function buildIntervals(
  rand: () => number,
  sport: Sport,
  durationS: number,
  distanceM: number,
): Interval[] | null {
  if (sport !== "run" || distanceM < 2000) return null;

  const fullLaps = Math.floor(distanceM / 1000);
  const remainderM = distanceM - fullLaps * 1000;
  const basePace = durationS / (distanceM / 1000); // s per km
  const out: Interval[] = [];

  for (let i = 1; i <= fullLaps; i++) {
    // Slight negative split, with HR drift across the run.
    const drift = (i - 1) / Math.max(fullLaps - 1, 1);
    const pace = basePace * (1.02 - drift * 0.04) * (0.995 + rand() * 0.01);
    out.push({
      n: i,
      label: String(i),
      type: "WORK",
      duration_s: Math.round(pace),
      distance_m: Math.round((998 + rand() * 5) * 10) / 10,
      pace_s_per_km: pace,
      avg_hr: Math.round(124 + drift * 20 + rand() * 3),
      max_hr: Math.round(136 + drift * 20 + rand() * 4),
      avg_power: null,
      intensity: Math.round((0.7 + drift * 0.13) * 100) / 100,
      zone: 1,
    });
  }

  if (remainderM > 40) {
    const pace = basePace * 1.4;
    out.push({
      n: fullLaps + 1,
      label: String(fullLaps + 1),
      type: "WORK",
      duration_s: Math.round((remainderM / 1000) * pace),
      distance_m: Math.round(remainderM * 10) / 10,
      pace_s_per_km: pace,
      avg_hr: Math.round(138 + rand() * 4),
      max_hr: Math.round(148 + rand() * 4),
      avg_power: null,
      intensity: 0.79,
      zone: 1,
    });
  }

  if (!out.length) return null;

  // Rescale so the laps sum EXACTLY to the activity's moving time. Without this,
  // per-lap rounding plus the drift factor drifts the total by a couple of
  // minutes, and the structure contradicts the activity it belongs to.
  const raw = out.reduce((s, i) => s + (i.duration_s ?? 0), 0);
  if (raw > 0) {
    let running = 0;
    out.forEach((iv, idx) => {
      if (idx === out.length - 1) {
        iv.duration_s = Math.max(durationS - running, 1);
      } else {
        iv.duration_s = Math.round(((iv.duration_s ?? 0) / raw) * durationS);
        running += iv.duration_s;
      }
      // Keep pace consistent with the adjusted duration.
      if (iv.distance_m && iv.duration_s) {
        iv.pace_s_per_km = iv.duration_s / (iv.distance_m / 1000);
      }
    });
  }

  return out;
}

function makeActivity(
  rand: () => number,
  date: Date,
  sport: Sport,
  withLoad: boolean,
  seq: number,
  /** 0 = first session of the day, 1 = second. Drives the start time so a
   *  same-day pair is morning + evening, never two rides two minutes apart —
   *  which the previous random-hour version produced. */
  slot = 0,
): Activity {
  // Gym must vary by slot too, or two gym sessions on one day both land at
  // 17:00 and read as duplicates.
  const hour = (sport === "gym" ? [17, 12] : [7, 18])[slot] ?? 7 + slot;
  const at = new Date(date);
  at.setUTCHours(hour, Math.floor(rand() * 55), 0, 0);

  let distance_m: number | null;
  let duration_s: number;
  let avg_pace: number | null = null;
  let avg_power: number | null = null;
  let name: string;

  if (sport === "run") {
    distance_m = 5200 + rand() * 9000;
    duration_s = Math.round((distance_m / 1000) * (255 + rand() * 60));
    avg_pace = duration_s / (distance_m / 1000);
    name = RUN_NAMES[Math.floor(rand() * RUN_NAMES.length)];
  } else if (sport === "ride") {
    // A second ride on the same day is a commute home, not another big loop.
    distance_m = slot === 0 ? 22000 + rand() * 78000 : 12000 + rand() * 14000;
    duration_s = Math.round((distance_m / 1000) * (110 + rand() * 40));
    avg_power = 165 + Math.round(rand() * 70);
    name = slot === 0 ? RIDE_NAMES[Math.floor(rand() * RIDE_NAMES.length)] : "Commute";
  } else if (sport === "gym") {
    distance_m = 0;
    duration_s = 1800 + Math.round(rand() * 2400);
    name = GYM_NAMES[Math.floor(rand() * GYM_NAMES.length)];
  } else {
    distance_m = 3000 + rand() * 6000;
    duration_s = Math.round((distance_m / 1000) * 700);
    name = "Walk";
  }

  const load = withLoad ? Math.round(20 + (duration_s / 3600) * (28 + rand() * 26)) : null;

  return {
    id: withLoad ? `intervals:i${180000000 + seq}` : `strava:${19000000000 + seq}`,
    source: withLoad ? "intervals" : "strava",
    date: at.toISOString(),
    sport,
    name,
    distance_m: distance_m === null ? null : Math.round(distance_m * 10) / 10,
    duration_s,
    elapsed_s: duration_s + Math.round(rand() * 240),
    elevation_m: sport === "gym" ? 0 : Math.round(rand() * (sport === "ride" ? 900 : 120)),
    load,
    // Strava's own Training Load, present on some Strava rows only.
    strava_load: withLoad ? null : rand() > 0.55 ? Math.round(45 + rand() * 90) : null,
    avg_hr: sport === "gym" ? null : 128 + Math.round(rand() * 26),
    max_hr: sport === "gym" ? null : 158 + Math.round(rand() * 22),
    avg_power,
    avg_pace_s_per_km: avg_pace,
    intervals: buildIntervals(rand, sport, duration_s, distance_m ?? 0),
  };
}

function buildActivities(): Activity[] {
  const rand = rng(20260907);
  const out: Activity[] = [];
  let seq = 0;

  // Deep history back to 2013, ride-dominant. Density matches the real export:
  // 4,690 activities over ~4,770 days is very close to one per day, because a
  // Strava export includes commutes — often an out-and-back pair on one day.
  // Getting this right matters: at a lower density the weekly volume bars look
  // sparse in a way live data never will.
  for (let d = new Date(VOLUME_FROM); d < LOAD_FROM; d = addDays(d, 1)) {
    const roll = rand();
    const count = roll < 0.28 ? 0 : roll < 0.76 ? 1 : 2; // mean ≈ 0.96/day
    for (let n = 0; n < count; n++) {
      const s = rand();
      const sport: Sport = s < 0.62 ? "ride" : s < 0.85 ? "run" : s < 0.96 ? "gym" : "other";
      out.push(makeActivity(rand, d, sport, false, seq++, n));
    }
  }

  // The intervals.icu window: runs and gym only, no rides — as in reality.
  for (let d = new Date(LOAD_FROM); d <= TODAY; d = addDays(d, 1)) {
    const dow = d.getUTCDay();
    const isRunDay = dow === 1 || dow === 2 || dow === 4 || dow === 6;
    const isGymDay = dow === 3 || dow === 5;
    if (isRunDay && rand() < 0.86) out.push(makeActivity(rand, d, "run", true, seq++));
    if (isGymDay && rand() < 0.55) out.push(makeActivity(rand, d, "gym", true, seq++));
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function buildWellness(activities: Activity[]): Wellness[] {
  const rand = rng(6642026);
  const loadByDay = new Map<string, number>();
  for (const a of activities) {
    if (a.load === null) continue;
    const day = a.date.slice(0, 10);
    loadByDay.set(day, (loadByDay.get(day) ?? 0) + a.load);
  }

  const out: Wellness[] = [];
  // CTL/ATL come from intervals.icu in production. Here they're seeded with a
  // plausible EWMA purely so the chart has a shape; the app never computes
  // them from load at runtime.
  let ctl = 9.4;
  let atl = 16.2;

  for (let d = new Date(LOAD_FROM); d <= TODAY; d = addDays(d, 1)) {
    const day = isoDay(d);
    const load = loadByDay.get(day) ?? 0;
    ctl = ctl + (load - ctl) / 42;
    atl = atl + (load - atl) / 7;

    const sleep = 4.6 + rand() * 4.8;

    out.push({
      date: day,
      ctl: Math.round(ctl * 1e4) / 1e4,
      atl: Math.round(atl * 1e4) / 1e4,
      form: Math.round((ctl - atl) * 1e4) / 1e4,
      resting_hr: 43 + Math.round(rand() * 15),
      hrv: 26 + Math.round(rand() * 70),
      sleep_hours: Math.round(sleep * 100) / 100,
      // No stage breakdown exists in the live source, so none is invented here.
      sleep_stages: null,
      // NULL in production: the API returns readiness as null on every row and
      // has no bodyBattery field. Kept null here so the views are forced to
      // handle absence rather than being tuned to numbers that never arrive.
      readiness: null,
      body_battery: null,
      weight_kg: null,
    });
  }
  return out;
}

export function loadMockDataset(): Dataset {
  const activities = buildActivities();
  const wellness = buildWellness(activities);
  const withLoad = activities.filter((a) => a.load !== null);
  return {
    activities,
    wellness,
    volumeRange: {
      from: activities[0]?.date.slice(0, 10) ?? "",
      to: activities[activities.length - 1]?.date.slice(0, 10) ?? "",
    },
    loadRange: withLoad.length
      ? {
          from: withLoad[0].date.slice(0, 10),
          to: withLoad[withLoad.length - 1].date.slice(0, 10),
        }
      : null,
    origin: "mock",
    today: TODAY,
  };
}

/** Activities in the ISO week containing `ref`. */
export function weekOf(activities: Activity[], ref: Date): Activity[] {
  const start = weekStart(ref);
  const end = addDays(start, 7);
  return activities.filter((a) => {
    const t = new Date(a.date).getTime();
    return t >= start.getTime() && t < end.getTime();
  });
}
