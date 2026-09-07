/** Mirrors the Supabase schema in supabase/migrations/20260906210000_init.sql.
 *  Keeping these aligned is what makes the JOIN phase a data-source swap
 *  rather than a rewrite: mock.ts and a live Supabase query return the
 *  same shapes. */

export type Sport = "run" | "ride" | "gym" | "other";
export type Source = "strava" | "intervals";

export interface Activity {
  id: string;
  source: Source;
  /** ISO timestamp. `timestamptz` in Postgres. */
  date: string;
  sport: Sport;
  name: string | null;
  /** METRES. Never kilometres — see the CSV duplicate-column trap. */
  distance_m: number | null;
  /** Moving time, seconds. */
  duration_s: number | null;
  elapsed_s: number | null;
  elevation_m: number | null;
  /** TSS / training load — intervals.icu only. NULL on every Strava row. */
  load: number | null;
  /** Strava's own Training Load. Reference only; never feeds the PMC. */
  strava_load: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_power: number | null;
  avg_pace_s_per_km: number | null;
  intervals: Interval[] | null;
}

export interface Interval {
  label: string;
  duration_s: number;
  /** seconds per km */
  pace_s_per_km: number | null;
  avg_hr: number | null;
  /** Relative intensity 0..1, used for the block diagram height. */
  intensity: number;
}

export interface Wellness {
  /** YYYY-MM-DD */
  date: string;
  ctl: number | null;
  atl: number | null;
  /** TSB = ctl - atl. Derived at write time; intervals.icu returns no form. */
  form: number | null;
  resting_hr: number | null;
  hrv: number | null;
  sleep_hours: number | null;
  sleep_stages: SleepStages | null;
  /** Garmin Training Readiness. NULL in practice — nullable by design. */
  readiness: number | null;
  /** Garmin Body Battery. Not returned by the API at all. */
  body_battery: number | null;
  weight_kg: number | null;
}

export interface SleepStages {
  awake_h: number;
  rem_h: number;
  light_h: number;
  deep_h: number;
}

/** What every view reads. A live implementation returns the same thing. */
export interface Dataset {
  activities: Activity[];
  wellness: Wellness[];
  /** Inclusive bounds of activity history, for honest axis labelling. */
  volumeRange: { from: string; to: string };
  /** Inclusive bounds of load/CTL coverage — much shallower than volume. */
  loadRange: { from: string; to: string } | null;
}
