/** Formatting helpers. All readouts use Space Mono + tabular numerals, so
 *  widths stay stable as values change. */

import type { Sport } from "./types";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** "11h 46" — the Home hero's format. */
export function hoursMinutes(seconds: number | null): { h: string; m: string } {
  if (seconds === null) return { h: "–", m: "–" };
  const total = Math.round(seconds / 60);
  return { h: String(Math.floor(total / 60)), m: String(total % 60).padStart(2, "0") };
}

/** "8h 21" for totals, "1:02" for a single session. */
export function duration(seconds: number | null): string {
  if (seconds === null || seconds === 0) return "–";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}` : `${m}min`;
}

/** "1:02" — clock style, for the activity-detail TIME key. */
export function clock(seconds: number | null): string {
  if (seconds === null) return "–";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `0:${String(m).padStart(2, "0")}`;
}

export function km(metres: number | null, digits = 1): string {
  if (metres === null || metres === 0) return "–";
  return (metres / 1000).toFixed(digits);
}

export function kmLabel(metres: number | null): string {
  if (metres === null || metres === 0) return "–";
  return `${km(metres, metres >= 100_000 ? 0 : 1)} km`;
}

/** "3:42/km" from seconds per km. */
export function pace(secPerKm: number | null): string {
  if (secPerKm === null || !isFinite(secPerKm) || secPerKm <= 0) return "–";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

/** Signed, for TSB: "+4", "−6". Uses a real minus sign, as the design does. */
export function signed(value: number | null, digits = 0): string {
  if (value === null) return "–";
  const rounded = Number(value.toFixed(digits));
  if (rounded > 0) return `+${rounded}`;
  if (rounded < 0) return `−${Math.abs(rounded)}`;
  return "0";
}

export function round(value: number | null): string {
  return value === null ? "–" : String(Math.round(value));
}

/** "TUE 04 AUG" */
export function dayStamp(iso: string): string {
  const d = new Date(iso);
  return `${DOW[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]}`;
}

/** "MON 03 AUG · 18:40" */
export function whenStamp(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dayStamp(iso)} · ${hh}:${mm}`;
}

/** "04 AUG" */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]}`;
}

/** "AUG 26" — month + year, for the calendar's corner stamp. */
export function monthYear(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}

export function dowLetter(index: number): string {
  return ["M", "T", "W", "T", "F", "S", "S"][index];
}

/** Sport -> CSS custom property. The only sport-colour lookup in the app. */
export function sportColor(sport: Sport): string {
  return `var(--sport-${sport})`;
}

/** Type colour on a sport ground, per the 2d rule: coral/ochre carry ink,
 *  petrol carries paper. */
export function sportInk(sport: Sport): string {
  return sport === "ride" ? "var(--paper)" : "var(--ink)";
}

export function sportTag(sport: Sport): string {
  return { run: "RUN", ride: "RIDE", gym: "GYM", other: "OTH" }[sport];
}

/** ISO date (YYYY-MM-DD) for a Date, in UTC. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday-based start of the ISO week containing `d`. */
export function weekStart(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const shift = (out.getUTCDay() + 6) % 7; // Mon = 0
  out.setUTCDate(out.getUTCDate() - shift);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}
