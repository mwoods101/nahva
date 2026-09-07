/** Render-time smoke test for workstream D's gate.
 *
 * The view functions are pure (state -> HTML string), so they can be exercised
 * without a browser. Checks that every view renders, that no placeholder or
 * NaN leaks into the markup, and that the design tokens are the only colours
 * used — a literal hex outside tokens.css means the palette drifted.
 *
 *   node --experimental-strip-types  (or: esbuild bundle + node)
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
  // Every colour must come from a token. Raw hex in a view = palette drift.
  const hexes = [...html.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  check(`${label}: no raw hex colours`, hexes.length === 0, hexes.slice(0, 5).join(" "));
}

console.log("dataset shape");
const withLoad = dataset.activities.filter((a) => a.load !== null);
const withCtl = dataset.wellness.filter((w) => w.ctl !== null);
check("activities span years", dataset.activities.length > 1500, `${dataset.activities.length} activities`);
check("volume range is deep", dataset.volumeRange.from < "2015-01-01", `${dataset.volumeRange.from} -> ${dataset.volumeRange.to}`);
check("load is shallow (mirrors reality)", withLoad.length < 60, `${withLoad.length} activities carry load`);
check("ctl coverage ~5 weeks", withCtl.length > 20 && withCtl.length < 60, `${withCtl.length} days`);
check("readiness null throughout", dataset.wellness.every((w) => w.readiness === null));
check("body_battery null throughout", dataset.wellness.every((w) => w.body_battery === null));
check("no strava row carries load", dataset.activities.every((a) => a.source !== "strava" || a.load === null));
check("no intervals row carries strava_load", dataset.activities.every((a) => a.source !== "intervals" || a.strava_load === null));

console.log("\nHome (card 2a)");
const home = renderHome(dataset);
inspect("home", home);
check("home: hero is MOVING TIME", home.includes("THIS WEEK · MOVING TIME"));
check("home: wordmark is NAHVA, not the design filename", home.includes("NAHVA") && !home.includes("FREISCHWIMMER"));
check("home: readiness shows absence", home.includes("NOT REPORTED"));
check("home: body battery shows absence", home.includes("NOT REPORTED BY DEVICE"));
check("home: exactly one coral hero block", (home.match(/class="hero"/g) ?? []).length === 1);

console.log("\nLog (card 2b)");
for (const metric of ["time", "km"] as Metric[]) {
  for (const filter of ["all", "run", "ride", "gym"] as Filter[]) {
    const html = renderLog(dataset, { ...defaultLogState(), metric, filter });
    inspect(`log[${metric}/${filter}]`, html);
  }
}
const log = renderLog(dataset, defaultLogState());
check("log: 13 week rows", (log.match(/class="cal__week"/g) ?? []).length === 13);
check("log: legend names all three sports", log.includes("RUN") && log.includes("RIDE") && log.includes("GYM"));
check("log: rest day state exists for an empty day",
  renderLog(dataset, { ...defaultLogState(), selected: "2026-08-05", filter: "ride" }).includes("REST DAY"));

console.log("\nProgression (card 1d)");
for (const range of ["6w", "3m", "1y", "all"] as Range[]) {
  const html = renderProgression(dataset, { range });
  inspect(`progression[${range}]`, html);
  check(`progression[${range}]: building notice present`, html.includes("FITNESS CURVE · BUILDING"));
  check(`progression[${range}]: states load coverage in days`, /CTL\/ATL exist for <strong>\d+ days<\/strong>/.test(html));
}
const long = renderProgression(dataset, { range: "1y" });
check("progression[1y]: says the curve is not stretched", long.includes("not stretched to fill the range"));
check("progression[1y]: axis labels actual load days, not the range", long.includes("DAYS OF LOAD"));
const short = renderProgression(dataset, { range: "6w" });
check("progression[6w]: CTL drawn as the hero line (3px coral)",
  short.includes('stroke="var(--coral)" stroke-width="3"'));
check("progression: ATL is petrol", short.includes('stroke="var(--petrol)"'));
check("progression: TSB bars are ochre", short.includes('fill="var(--ochre)"'));

console.log("\nActivity detail (card 1g)");
const withIntervals = dataset.activities.find((a) => a.intervals && a.load !== null);
const stravaOnly = dataset.activities.find((a) => a.source === "strava" && a.strava_load !== null);
if (withIntervals) {
  const html = renderActivity(dataset, withIntervals.id);
  inspect("activity[intervals]", html);
  check("activity: shows load", /class="detail__key-value"[^>]*>\d+</.test(html));
  check("activity: interval rows rendered", html.includes('class="ival"'));
}
if (stravaOnly) {
  const html = renderActivity(dataset, stravaOnly.id);
  inspect("activity[strava]", html);
  check("activity: strava row declares no training load", html.includes("NO TRAINING LOAD · STRAVA-SOURCED"));
  check("activity: names strava's own figure as unused", html.includes("NOT USED"));
}
// The not-found state is deliberately terse, so it gets a lower floor.
const missing = renderActivity(dataset, "nope:0");
inspect("activity[missing]", missing, 120);
check("activity[missing]: states the id it could not find", missing.includes("nope:0"));

console.log(`\nTODAY pinned at ${TODAY.toISOString()}`);
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
