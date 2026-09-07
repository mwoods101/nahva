# CLAUDE.md — Nahva

Operating rules for every agent and subagent working in this repo. Auto-loaded on every session — this is the constitution. The full build spec is in `BUILD_BRIEF.md`; read it before starting any workstream.

---

## What this is
Nahva — a personal training dashboard + data pipeline + read-only coaching connection. Two data sources (a one-time Strava CSV export + ongoing intervals.icu sync) feed one Supabase Postgres DB. A mobile-first front-end reads it; Claude reads it read-only for coaching. Single user.

---

## Tools policy (read first)
This project uses only these MCP servers:
- **`claude-design`** — the design import (Step 1).
- **Supabase** — the coaching connection, later (Step 8).

**Ignore every other connected MCP server.** ChartMogul, Stripe, Xero, Datadog, PostHog, Gmail, Slack, Atlassian, Google Calendar, Docusign and any others are unrelated Scoreline work tools. Never call them. If a task appears to need one, stop and ask — it's a sign something's wrong, because nothing in this build touches those systems.

---

## Operating rules (all agents)
1. **Plan first.** Enter plan mode (Shift+Tab) for any task with 3+ steps or an architectural choice. Write the plan, get it checked, then build. If something goes sideways, **stop and re-plan** — don't push through a broken approach.
2. **Prove it's done.** Every task has a verification gate (see *Definition of done*). Report completion **with evidence** — command output, row counts, a passing check — never just "done."
3. **Stay in your lane.** Two workstreams must never edit the same file. The files under *Coordinator-only* below are off-limits unless you are the coordinator; declare the change you need and let the coordinator make it.
4. **Never do human-only steps** (see below). No account creation, no entering secrets, no irreversible cloud actions. Reference secrets by env-var name only.
5. **Match the design exactly.** Palette: paper \`#FAF7F2\`, ink \`#17140F\`, coral \`#FF6B54\`, petrol \`#124E4A\`, ochre \`#E7A82E\`. Type: Space Grotesk (display) + Space Mono (data). No cream backgrounds, no default chart-library colours. Full aesthetic in \`BUILD_BRIEF.md\`.

---

## Repo & file ownership (this is what makes parallel agents safe)
| Path | Owner | Notes |
|---|---|---|
| \`/web\` | Front-end workstream (D) | Independent of data until the JOIN phase. |
| \`/pipeline/strava_import.*\` | Strava import (B) | Reads \`data/activities.csv\`. |
| \`/pipeline/intervals_sync.*\` | Sync (C) | |
| \`/.github/workflows/\` | Sync (C) | The scheduled Action. |
| \`/supabase/\` (migrations, schema) | **Coordinator-only** | Shared contract; only the coordinator writes it. |
| \`package.json\`, lockfiles, \`.env.example\`, \`.mcp.json\`, \`CLAUDE.md\` | **Coordinator-only** | Shared config. Declare deps; don't edit directly. |

Because \`/web\`, \`/pipeline\`, and \`/supabase\` are separate directories, the front-end and pipeline workstreams cannot collide — run them in parallel freely.

---

## Workstreams & dependency graph
- **A · Schema** — foundation. Do first. Coordinator-only.
- **B · Strava import** — needs A. Independent of C and D.
- **C · intervals sync + Action** — needs A. Independent of B and D.
- **D · Front-end (mock data)** — no dependency. Start in parallel immediately.
- **JOIN · Wire front-end to live Supabase** — needs A, B, C, D.
- **COACH · Read-only role + Claude connector** — needs A + data. Human does the connector auth.

**Parallel plan:** A first → then B, C, D fan out in parallel → JOIN → COACH.

---

## Definition of done (verification gates — report evidence for each)
- **A** — migrations apply cleanly; \`activities\` and \`wellness\` tables exist with the columns specced in \`BUILD_BRIEF.md\`.
- **B** — import runs to completion; row count ≈ **4,690**; spot-check that distance is stored in **metres, not km** (the duplicate-column trap); sports mapped (Ride/Virtual Ride/E-Bike→ride, Run/Virtual Run→run, Weight Training→gym, else other); Strava's Training Load lands in \`strava_load\`, **not** \`load\`.
- **C** — sync pulls a date range into \`activities\`/\`wellness\`; **dedup verified** (no double-count against Strava rows on overlapping days; intervals record preferred); CTL/ATL/form **pulled from intervals.icu, not recomputed**; \`readiness\`/\`body_battery\` tolerated as null.
- **D** — builds and renders all views on mock data; matches the design tokens above.
- **JOIN** — each view reads live Supabase; a weekly volume total **reconciles against a manual sum** from the CSV.
- **COACH** — the read-only role can \`SELECT\` and **cannot write** (verify a write attempt fails).

---

## Human-only (never delegate — pause and ask)
Creating the Supabase project; generating or entering any key/secret; GitHub and Vercel account setup + OAuth; connecting the Supabase connector to Claude; submitting the Garmin "request all my data" export. Agents reference these by placeholder and stop for the human to complete them.

---

## Orchestration notes (how to run the agents)
- **Start simple.** One session, plan mode on, spawn subagents for scoped research and verification. A subagent's only briefing is the delegation prompt you write — include every path, decision, and constraint it needs.
- **Practise parallelism on the fan-out.** Run **D** (front-end) in its own worktree/session (\`claude -w web-frontend\`) while **A→B,C** proceed in another. Separate directories mean no collisions.
- **Manager Loop (optional, for D).** A coordinator session holds the checklist and dispatches phases to a separate implementer session; the implementer spawns one subagent per view. Use it where sub-tasks are many — the five front-end views — not everywhere.
- **Keep a \`CHECKLIST.md\`** the agents tick off as gates pass. Mind the token bill: each agent is a separate context window, so reserve parallelism for genuinely independent work, not every task.
