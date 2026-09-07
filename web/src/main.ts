/** Nahva front-end shell.
 *
 *  Three tabs (card 2c: nav pattern A — ink bar, coral rule), with Activity
 *  detail as a pushed view. Body is folded into Home per card 2a, so there is
 *  no separate Recovery tab.
 *
 *  State lives here; each view is a pure render(state) -> HTML string. That
 *  keeps the JOIN phase to swapping loadMockDataset() for a Supabase query. */

import "./app.css";
import { loadMockDataset } from "./mock";
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
  /** When set, the activity detail is shown over the current tab. */
  activityId: string | null;
  log: LogState;
  progression: ProgressionState;
}

const TABS: { key: Tab; label: string }[] = [
  { key: "home", label: "HOME" },
  { key: "log", label: "LOG" },
  { key: "fitness", label: "FITNESS" },
];

const dataset: Dataset = loadMockDataset();

const state: AppState = {
  tab: "home",
  activityId: null,
  log: defaultLogState(),
  progression: defaultProgressionState(),
};

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("#app not found");

/** Hash routing: #home | #log | #fitness | #activity/<id>.
 *  Gives the tabs real deep links, and survives a reload. */
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
  const next = state.activityId ? `#activity/${encodeURIComponent(state.activityId)}` : `#${state.tab}`;
  if (window.location.hash !== next) {
    history.replaceState(null, "", next);
  }
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

function render(): void {
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

  root!.innerHTML = body + tabbar();
  writeHash();

  // Keep the calendar scrolled to the most recent week.
  const scroller = document.querySelector<HTMLDivElement>("#cal-scroll");
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

/** One delegated listener for the whole app. */
root.addEventListener("click", (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>("[data-tab],[data-activity],[data-back],[data-metric],[data-filter],[data-range],[data-day]");
  if (!el) return;

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
