/** Render-time smoke test.
 *
 * View functions are pure (state -> HTML string), so they run without a
 * browser. Checks every view renders, that no placeholder or NaN leaks, that
 * the design tokens are the only colours used, and that the specific bugs found
 * in review on 2026-09-08 stay fixed.
 */

import { loadMockDataset, TODAY } from "../src/mock";
import { renderHome } from "../src/views/home";
import { defaultLogState, renderLog } from "../src/views/log";
import { renderProgression } from "../src/views/progression";
import { renderActivity } from "../src/views/activity";
import type { Range } from "../src/views/progression";
import type { Filter, Metric } from "../src/views/log";

const dataset = loadMockDataset();
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? `  ${detail}` : ""}`);
}

function inspect(label: string, html: string, minChars = 800): void {
  check(`${label}: renders non-trivially`, html.length > minChars, `${html.length} chars`);
  check(`${label}: no "undefined"`, !html.includes("undefined"));
  check(`${label}: no "NaN"`, !html.includes("NaN"));
  check(`${label}: no "[object"`, !html.includes("[object"));
  check(`${label}: no unresolved {{ }}`, !html.includes("{{"));
  const hexes = [...html.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  check(`${label}: no raw hex colours`, hexes.length === 0, hexes.slice(0, 5).join(" "));
}

console.log("dataset shape (mirrors live conditions)");
const withLoad = dataset.activities.filter((a) => a.load !== null);
const withCtl = dataset.wellness.filter((w) => w.ctl !== null);
check("activities ~ real volume", dataset.activities.length > 4000, `${dataset.activities.length}`);
check("volume range is deep", dataset.volumeRange.from < "2015-01-01", `${dataset.volumeRange.from} -> ${dataset.volumeRange.to}`);
check("load is shallow", withLoad.length < 60, `${withLoad.length} carry load`);
check("ctl coverage ~5 weeks", withCtl.length > 20 && withCtl.length < 60, `${withCtl.length} days`);
check("readiness null throughout", dataset.wellness.every((w) => w.readiness === null));
check("body_battery null throughout", dataset.wellness.every((w) => w.body_battery === null));
check("sleep_stages null throughout (no source)", dataset.wellness.every((w) => w.sleep_stages === null));
check("no strava row carries load", dataset.activities.every((a) => a.source !== "strava" || a.load === null));
check("no intervals row carries strava_load", dataset.activities.every((a) => a.source !== "intervals" || a.strava_load === null));
check("origin is declared", dataset.origin === "mock", dataset.origin);

console.log("\nREGRESSION: interval structure must match its own activity");
const withIvals = dataset.activities.filter((a) => a.intervals?.length);
let worstDelta = 0;
for (const a of withIvals) {
  const sum = a.intervals!.reduce((s, i) => s + (i.duration_s ?? 0), 0);
  worstDelta = Math.max(worstDelta, Math.abs(sum - (a.duration_s ?? 0)));
}
check("interval durations sum to activity duration (±120s)", worstDelta <= 120, `worst delta ${worstDelta}s over ${withIvals.length} activities`);
check("intensity is a 0..1 fraction, not a percentage",
  withIvals.every((a) => a.intervals!.every((i) => i.intensity === null || (i.intensity >= 0 && i.intensity <= 1.5))));
check("intervals carry the normalised shape",
  withIvals.every((a) => a.intervals!.every((i) => "n" in i && "type" in i && "duration_s" in i)));

console.log("\nREGRESSION: no implausible same-day distance pairs");
const byDay = new Map<string, typeof dataset.activities>();
for (const a of dataset.activities) {
  const k = a.date.slice(0, 10);
  if (!byDay.has(k)) byDay.set(k, []);
  byDay.get(k)!.push(a);
}
let bothBig = 0;
let sameHour = 0;
for (const list of byDay.values()) {
  if (list.length < 2) continue;
  if (list.filter((a) => (a.distance_m ?? 0) > 40000).length > 1) bothBig++;
  const hours = list.map((a) => a.date.slice(11, 13));
  if (new Set(hours).size < hours.length) sameHour++;
}
check("no day has two 40km+ rides", bothBig === 0, `${bothBig} such days`);
check("same-day sessions are at different hours", sameHour === 0, `${sameHour} such days`);

console.log("\nHome (card 2a)");
const home = renderHome(dataset);
inspect("home", home);
check("home: hero is MOVING TIME", home.includes("THIS WEEK · MOVING TIME"));
check("home: names the week it is reporting", /WEEK OF \d{2} [A-Z]{3}/.test(home));
check("home: wordmark is NAHVA", home.includes("NAHVA") && !home.includes("FREISCHWIMMER"));
check("home: exactly one coral hero block", (home.match(/class="hero"/g) ?? []).length === 1);
check("home: no readiness block (no data source)", !home.includes("READINESS"));
check("home: no body-battery block (no data source)", !home.includes("BODY BATTERY"));
check("home: no fake status bar", !home.includes("5G · 82%"));
check("home: sleep shown as hours, not stages", home.includes("SLEEP · LAST"));

console.log("\nLog (card 2b)");
for (const metric of ["time", "km"] as Metric[]) {
  for (const filter of ["all", "run", "ride", "gym"] as Filter[]) {
    inspect(`log[${metric}/${filter}]`, renderLog(dataset, { ...defaultLogState(), metric, filter }));
  }
}
const log = renderLog(dataset, defaultLogState());
check("log: 13 week rows", (log.match(/class="cal__week"/g) ?? []).length === 13);
const kmLog = renderLog(dataset, { ...defaultLogState(), metric: "km" });
const totals = [...kmLog.matchAll(/class="cal__wk-total">([^<]*)</g)].map((m) => m[1]);
check("log: km week totals carry explicit units, never a bare 'k' suffix",
  totals.every((t) => t === "–" || /^\d+km$/.test(t)), totals.slice(0, 5).join(" "));
check("log: dots are tappable and open an activity",
  /class="cal__dot" data-activity="/.test(log));
check("log: day cells are not nested buttons",
  !/<button[^>]*class="cal__day"/.test(log));
check("log: prompts for a selection before one is made", log.includes("TAP A DAY IN THE CALENDAR"));
check("log: rest day state renders",
  renderLog(dataset, { ...defaultLogState(), selected: "2026-08-05", filter: "ride" }).includes("REST DAY"));

console.log("\nProgression (card 1d)");
const paths: Record<string, string> = {};
for (const range of ["6w", "3m", "1y", "all"] as Range[]) {
  const html = renderProgression(dataset, { range });
  inspect(`progression[${range}]`, html);
  check(`progression[${range}]: building notice present`, html.includes("FITNESS CURVE · BUILDING"));
  check(`progression[${range}]: states load coverage`, /CTL\/ATL exist for <strong>\d+ days<\/strong>/.test(html));
  check(`progression[${range}]: states coverage as a % of the range`, /covers\s*<strong>\d+%<\/strong>/.test(html));
  paths[range] = html.match(/stroke="var\(--coral\)" stroke-width="3"[^>]*/)?.[0] ?? "";
  paths[range] = html.match(/<path d="(M[^"]+)" fill="none" stroke="var\(--coral\)"/)?.[1] ?? "";
}
// THE bug from review: every range produced an identical PMC, so the pills
// looked dead. Each range must now plot on its own timeline.
const distinct = new Set(Object.values(paths).filter(Boolean));
check("range pills change the PMC path (not clamped to coverage)",
  distinct.size === 4, `${distinct.size} distinct CTL paths across 4 ranges`);
const short = renderProgression(dataset, { range: "6w" });
check("progression: CTL is the 3px coral hero line", short.includes('stroke="var(--coral)" stroke-width="3"'));
check("progression: ATL is petrol", short.includes('stroke="var(--petrol)"'));
check("progression: TSB bars are ochre", short.includes('fill="var(--ochre)"'));
const long = renderProgression(dataset, { range: "1y" });
check("progression[1y]: marks the empty stretch", long.includes("NO LOAD DATA"));
check("progression: volume says what one bar is", long.includes("ONE BAR ="));
check("progression: volume says the average is per bar", long.includes("Ø IS PER BAR"));

console.log("\nActivity detail (card 1g)");
const lapped = dataset.activities.find((a) => a.intervals?.length && a.load !== null);
const stravaOnly = dataset.activities.find((a) => a.source === "strava" && a.strava_load !== null);
if (lapped) {
  const html = renderActivity(dataset, lapped.id);
  inspect("activity[laps]", html);
  check("activity: describes segments without inventing a workout",
    /auto-split laps|segments|work ·/.test(html));
  check("activity: does not claim a threshold workout", !html.includes("@ threshold"));
  check("activity: says where the structure came from", html.includes("not a planned workout"));
  check("activity: segment rows rendered", html.includes('class="ival"'));
}
if (stravaOnly) {
  const html = renderActivity(dataset, stravaOnly.id);
  inspect("activity[strava]", html);
  check("activity: strava row declares no training load", html.includes("NO TRAINING LOAD · STRAVA-SOURCED"));
  check("activity: names strava's own figure as unused", html.includes("NOT USED"));
}
const missing = renderActivity(dataset, "nope:0");
inspect("activity[missing]", missing, 120);
check("activity[missing]: states the id", missing.includes("nope:0"));

console.log(`\nfixture TODAY = ${TODAY.toISOString()}`);
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
