/** Live data from Supabase (workstream JOIN).
 *
 * Reads via PostgREST with the PUBLISHABLE key. That key is client-safe: RLS is
 * on for both tables and the only policies are SELECT for anon/authenticated
 * (see supabase/migrations/20260906210000_init.sql), so a browser holding it
 * can read and nothing else.
 *
 * Deliberately no @supabase/supabase-js — two GETs don't justify the
 * dependency, and fetch keeps the bundle small.
 *
 * Falls back to the mock fixture when env vars are absent, so `npm run dev`
 * works offline. The UI states which one it's showing; it must never be
 * ambiguous whether a number is real.
 */

import { loadMockDataset } from "./mock";
import type { Activity, Dataset, Wellness } from "./types";

const URL_BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** PostgREST caps a response at 1000 rows, so paginate. ~4.7k activities. */
const PAGE = 1000;

/** `raw` is the original source payload and is large — never select it. */
const ACTIVITY_COLUMNS = [
  "id", "source", "date", "sport", "name", "distance_m", "duration_s",
  "elapsed_s", "elevation_m", "load", "strava_load", "avg_hr", "max_hr",
  "avg_power", "avg_pace_s_per_km", "intervals",
].join(",");

const WELLNESS_COLUMNS = [
  "date", "ctl", "atl", "form", "resting_hr", "hrv", "sleep_hours",
  "weight_kg", "readiness", "body_battery",
].join(",");

export class DataError extends Error {}

async function page<T>(table: string, columns: string, order: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const url =
      `${URL_BASE}/rest/v1/${table}` +
      `?select=${encodeURIComponent(columns)}` +
      `&order=${encodeURIComponent(order)}` +
      `&limit=${PAGE}&offset=${offset}`;

    const res = await fetch(url, {
      headers: { apikey: KEY!, Authorization: `Bearer ${KEY}` },
    });
    if (!res.ok) {
      throw new DataError(`${table}: ${res.status} ${res.statusText} — ${await res.text()}`);
    }
    const batch = (await res.json()) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

export function isLiveConfigured(): boolean {
  return Boolean(URL_BASE && KEY);
}

export async function loadDataset(): Promise<Dataset> {
  if (!isLiveConfigured()) {
    return loadMockDataset();
  }

  const [activities, wellness] = await Promise.all([
    page<Activity>("activities", ACTIVITY_COLUMNS, "date.asc"),
    page<Wellness>("wellness", WELLNESS_COLUMNS, "date.asc"),
  ]);

  // Defensive numeric coercion. PostgREST currently returns `numeric` as a JSON
  // number, but it is permitted to send a string to preserve precision, and a
  // string here would make every downstream sum concatenate instead of add.
  for (const a of activities) {
    a.distance_m = num(a.distance_m);
    a.elevation_m = num(a.elevation_m);
    a.load = num(a.load);
    a.strava_load = num(a.strava_load);
    a.avg_power = num(a.avg_power);
    a.avg_pace_s_per_km = num(a.avg_pace_s_per_km);
  }
  for (const w of wellness) {
    w.ctl = num(w.ctl);
    w.atl = num(w.atl);
    w.form = num(w.form);
    w.hrv = num(w.hrv);
    w.sleep_hours = num(w.sleep_hours);
    w.weight_kg = num(w.weight_kg);
    w.readiness = num(w.readiness);
  }

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
    origin: "live",
    today: new Date(),
  };
}

function num(v: number | string | null): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
