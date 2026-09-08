/** Nahva front-end shell.
 *
 *  Three tabs (card 2c: nav pattern A — ink bar, coral rule), with Activity
 *  detail as a pushed view. Body is folded into Home per card 2a.
 *
 *  The mockup's fake status bar ("9:41 · 5G · 82%") is not reproduced — that is
 *  design-canvas furniture, and a real app shows the device's own.
 */

import "./app.css";
import { isLiveConfigured, loadDataset } from "./data";
import type { Dataset } from "./types";
import { renderHome } from "./views/home";
import { defaultLogState, renderLog, type Filter, type LogState, type Metric } from "./views/log";
import {
  defaultProgressionState, renderProgression, type ProgressionState, type Range,
} from "./views/progression";
import { renderActivity } from "./views/activity";

type Tab = "home" | "log" | "fitness";

interface AppState {
  tab: Tab;
  activityId: string | null;
  log: LogState;
  progression: ProgressionState;
}

const TABS: { key: Tab; label: string }[] = [
  { key: "home", label: "HOME" },
  { key: "log", label: "LOG" },
  { key: "fitness", label: "FITNESS" },
];

const state: AppState = {
  tab: "home",
  activityId: null,
  log: defaultLogState(),
  progression: defaultProgressionState(),
};

let dataset: Dataset | null = null;
let loadError: string | null = null;

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("#app not found");

/** Hash routing: #home | #log | #fitness | #activity/<id>. */
function readHash(): void {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return;
  if (hash.startsWith("activity/")) {
    state.activityId = decodeURIComponent(hash.slice("activity/".length));
    return;
  }
  if (TABS.some((t) => t.key === hash)) {
    state.tab = hash as Tab;
    state.activityId = null;
  }
}

function writeHash(): void {
  const next = state.activityId
    ? `#activity/${encodeURIComponent(state.activityId)}`
    : `#${state.tab}`;
  if (window.location.hash !== next) history.replaceState(null, "", next);
}

function tabbar(): string {
  return `<nav class="tabbar" role="tablist">
    ${TABS.map(
      (t) => `<button class="tab" role="tab" data-tab="${t.key}"
        aria-selected="${state.tab === t.key && state.activityId === null}">
        <span class="tab__rule"></span>${t.label}
      </button>`,
    ).join("")}
  </nav>`;
}

/** Never leave it ambiguous whether a number on screen is real. */
function originBanner(ds: Dataset): string {
  if (ds.origin === "live") return "";
  return `<div class="banner">
    <span class="banner__tag">MOCK DATA</span>
    <span>Not your training history. Set VITE_SUPABASE_URL and
    VITE_SUPABASE_PUBLISHABLE_KEY in web/.env.local to read Supabase.</span>
  </div>`;
}

function render(): void {
  if (loadError) {
    root!.innerHTML =
      `<div class="page-title"><div class="page-title__h">Can't load data</div></div>
       <div class="banner banner--error"><span class="banner__tag">ERROR</span><span>${loadError}</span></div>
       <div class="cal__empty">${
         isLiveConfigured()
           ? "Supabase is configured but unreachable. Check the URL and publishable key."
           : "No Supabase config found, and the mock fixture failed to build."
       }</div>` + tabbar();
    return;
  }

  if (!dataset) {
    root!.innerHTML = `<div class="page-title">
      <div class="page-title__h">Nahva</div>
      <div class="page-title__sub">LOADING…</div>
    </div>`;
    return;
  }

  let body: string;
  if (state.activityId) {
    body = renderActivity(dataset, state.activityId);
  } else if (state.tab === "home") {
    body = renderHome(dataset);
  } else if (state.tab === "log") {
    body = renderLog(dataset, state.log);
  } else {
    body = renderProgression(dataset, state.progression);
  }

  root!.innerHTML = originBanner(dataset) + body + tabbar();
  writeHash();

  // Keep the calendar scrolled to the most recent week.
  const scroller = document.querySelector<HTMLDivElement>("#cal-scroll");
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

/** One delegated listener for the whole app. closest() resolves the innermost
 *  match, so a dot inside a day cell opens the activity rather than selecting
 *  the day. */
root.addEventListener("click", (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-tab],[data-activity],[data-back],[data-metric],[data-filter],[data-range],[data-day]",
  );
  if (!el || el.getAttribute("aria-disabled") === "true") return;

  if (el.dataset.tab) {
    state.tab = el.dataset.tab as Tab;
    state.activityId = null;
    window.scrollTo({ top: 0 });
  } else if (el.dataset.activity) {
    state.activityId = el.dataset.activity;
    window.scrollTo({ top: 0 });
  } else if (el.dataset.back) {
    state.activityId = null;
  } else if (el.dataset.metric) {
    state.log.metric = el.dataset.metric as Metric;
  } else if (el.dataset.filter) {
    state.log.filter = el.dataset.filter as Filter;
  } else if (el.dataset.range) {
    state.progression.range = el.dataset.range as Range;
  } else if (el.dataset.day) {
    state.log.selected = el.dataset.day;
  }

  render();
});

window.addEventListener("hashchange", () => {
  readHash();
  render();
});

readHash();
render();

loadDataset()
  .then((ds) => {
    dataset = ds;
    render();
  })
  .catch((err: unknown) => {
    loadError = err instanceof Error ? err.message : String(err);
    render();
  });
