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

/** Normalised by pipeline/intervals_sync.py:normalise_intervals().
 *
 *  Note what this data usually IS: for an unstructured run, intervals.icu
 *  auto-splits into ~1 km laps, every one `type: "WORK"` with a null label.
 *  There is generally no rep/recovery structure to recover, so the UI must
 *  render segments generically rather than assume a workout shape. */
export interface Interval {
  n: number;
  label: string;
  /** intervals.icu's only structural marker: "WORK" | "RECOVERY" | null. */
  type: string | null;
  duration_s: number | null;
  distance_m: number | null;
  /** seconds per km, derived from average_speed (m/s) */
  pace_s_per_km: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_power: number | null;
  /** 0..1 fraction. The API sends a percentage; the sync divides by 100. */
  intensity: number | null;
  zone: number | null;
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
  weight_kg: number | null;

  /* The columns below exist in Postgres but are EMPTY in practice, verified
   * against all 36 live rows. They are not rendered anywhere — see
   * web/README.md § "Metrics with no data source".
   *   sleep_stages  intervals.icu returns no stage breakdown, only sleepSecs
   *   readiness     key exists, null on every row
   *   body_battery  field is not returned by the API at all
   * They stay in the type as a record of the schema, so that if a source ever
   * appears the gap is already named. */
  sleep_stages: null;
  readiness: number | null;
  body_battery: number | null;
}

/** What every view reads. Mock and live both produce this. */
export interface Dataset {
  activities: Activity[];
  wellness: Wellness[];
  /** Inclusive bounds of activity history, for honest axis labelling. */
  volumeRange: { from: string; to: string };
  /** Inclusive bounds of load/CTL coverage — much shallower than volume. */
  loadRange: { from: string; to: string } | null;
  /** Where this came from, so the UI can say so. */
  origin: "live" | "mock";
  /** The "now" the views should reckon from. Live = real clock. */
  today: Date;
}
