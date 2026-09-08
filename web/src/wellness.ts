/** Reading wellness metrics that arrive at different times.
 *
 * A wellness row exists per day, but its fields do not all populate together:
 * intervals.icu computes ctl/atl immediately, while Garmin pushes hrv and
 * restingHR later. So today's row routinely has ctl/atl and a null hrv.
 *
 * Taking `wellness[last]` and reading every field off it therefore showed "—"
 * for HRV and RHR whenever the day's sleep data hadn't landed — the metric
 * looked missing when it was merely not in yet. Each metric is resolved
 * independently, and the UI can say how stale the value is.
 */

import type { Wellness } from "./types";

export interface Reading<T> {
  value: T | null;
  /** The date the value came from, or null if no row has it. */
  date: string | null;
  /** Rows between that date and the newest row. 0 = current. */
  ageDays: number;
}

type NumericKey = {
  [K in keyof Wellness]: Wellness[K] extends number | null ? K : never;
}[keyof Wellness];

/** Most recent non-null value for one metric. */
export function latest(rows: Wellness[], key: NumericKey): Reading<number> {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i][key];
    if (v !== null && v !== undefined) {
      return { value: v, date: rows[i].date, ageDays: rows.length - 1 - i };
    }
  }
  return { value: null, date: null, ageDays: 0 };
}

/** Series for a metric over the last `days` rows, nulls preserved so gaps in
 *  the source stay visible rather than being smoothed over. */
export function series(rows: Wellness[], key: NumericKey, days: number): (number | null)[] {
  return rows.slice(-days).map((r) => r[key] ?? null);
}
