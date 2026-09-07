# Build brief — Nahva (personal training dashboard)

Paste this whole file into Claude Code as the build spec, alongside `CLAUDE.md`. It covers the full app: the front-end (imported from Claude Design), the database, the data pipeline, and the coaching connection. Work through it in the **Build sequence** at the bottom.

---

## 0. Pre-flight — human setup done before this handoff

Done by the user before the build (accounts, OAuth, secret generation — the agent can't create accounts or enter credentials). Keys/IDs are captured and ready to paste. Rule of thumb: **the user owns accounts, billing, logins and secrets; the agent owns code and authenticated commands.**

- **Supabase** — account + one project (EU/London region). Captured: Project URL, publishable key, secret key, session-pooler DB connection string, DB password.
- **intervals.icu** — account, Garmin connected and syncing (activities + wellness verified live), API key, athlete ID.
- **GitHub** — account + empty private repo `nahva`.
- **Vercel** — account (GitHub linked). Netlify or Cloudflare Pages are equivalent substitutes if preferred.
- **Local + CLIs** — Node, Python, git installed; `gh`, `supabase`, `vercel` logged in; `claude-design` MCP added (project scope).

---

## 1. What we're building

A personal training analytics dashboard for a single user (an experienced cyclist who also runs and lifts), replacing a cancelled Strava Premium subscription. It:

1. Warehouses workout + wellness data in Supabase Postgres.
2. Presents it in a bold, mobile-first dashboard (the design already built in Claude Design).
3. Exposes the same database read-only to Claude so it can act as a coach in chat.

**Decisions already made — don't relitigate:**
- Store **summary + derived** per activity. Do **not** warehouse raw per-second streams; fetch on demand from intervals.icu only if a detail view needs them.
- Single user. No auth/multi-tenant beyond Supabase defaults.
- Backfill: **keep all available history.** The Strava export holds ~4,690 activities, Apr 2015 → Sep 2025.
- **Load runs shallower than volume.** Strava gives 10 years of *volume* but no comparable load metric; the CTL/ATL/form curve can only be as deep as intervals.icu's load data. Volume/log views span a decade; the fitness chart starts later — correct, not a bug.
- Sports: **run, ride, gym** (else `other`).

---

## 2. Architecture

```
Strava export (activities.csv)  --one-time-->  Supabase Postgres  -->  Front-end (publishable key, read)
intervals.icu API (activities + wellness) --daily via GitHub Action-->        \--> Claude connector (read-only role, coaching)
        ^ Garmin FR265 syncs into intervals.icu (load + wellness)
```

- **GitHub Actions** runs the intervals.icu sync daily (incremental).
- **Supabase** is the single source of truth. Front-end reads it; Claude reads it read-only.
- **Front-end** is a static/SPA app on Vercel, reading Supabase via the publishable key.

Repo layout (monorepo):
```
/web                    front-end (from Claude Design import)
/pipeline               sync scripts (Strava import + intervals.icu sync)
/pipeline/data          activities.csv lives here (gitignored)
/supabase               SQL migrations / schema
/.github/workflows      scheduled sync
```

---

## 3. Front-end — import the design first

The UI is already designed in Claude Design. Import and implement it as Step 1, on mock data, before any data work.

> Use the claude_design MCP (https://api.anthropic.com/v1/design/mcp, auth via /design-login) to import this project:
> https://claude.ai/design/p/4a37c4d9-9d35-4e5d-b9cf-bcdff272cd90?file=Freischwimmer.dc.html
> Focus on these files (the whole project is readable):
> - `Freischwimmer.dc.html`
> Also read these files the selection imports:
> - `support.js`
> Implement: `Freischwimmer.dc.html`

Note: the design source file keeps its original name (`Freischwimmer.dc.html`) — that's just the file in Claude Design. The project itself is **Nahva**. Build on **mock data** first (realistic values), matching the schema below. Mobile-first; must hold up on desktop.

Views (see the design for layout):
- **Home / This week** — headline weekly volume, readiness, form; CTL/ATL/form grid; recent activities.
- **Training log** — week/month toggle, sessions grouped by period, volume totals, colour-coded by sport (run=coral, ride=petrol, gym=ochre).
- **Progression** — Performance Management Chart (CTL/ATL/form over time), volume trend, HRV/RHR/sleep trends.
- **Activity detail** — single-session summary + interval structure + recovery context.
- **(Optional) Recovery** — sleep, HRV, readiness, body battery, weight trends.

---

## 4. Database schema (Supabase Postgres)

SQL migrations under `/supabase`.

### `activities`
| column | type | notes |
|---|---|---|
| \`id\` | text PK | source id, prefixed (\`intervals:12345\`, \`strava:678\`) |
| \`source\` | text | \`'intervals'\` \| \`'strava'\` |
| \`date\` | timestamptz | activity start |
| \`sport\` | text | \`'run'\` \| \`'ride'\` \| \`'gym'\` \| \`'other'\` |
| \`name\` | text | |
| \`distance_m\` | numeric | metres |
| \`duration_s\` | integer | moving time, seconds |
| \`elapsed_s\` | integer | |
| \`elevation_m\` | numeric | |
| \`load\` | numeric NULL | TSS / training load — **intervals.icu only**. Never put Strava's load here. |
| \`strava_load\` | numeric NULL | Strava's own Training Load, reference only. Never into the CTL/ATL model. |
| \`avg_hr\` / \`max_hr\` | integer NULL | |
| \`avg_power\` | numeric NULL | |
| \`avg_pace_s_per_km\` | numeric NULL | |
| \`intervals\` | jsonb NULL | derived interval structure |
| \`raw\` | jsonb NULL | original payload, for debugging |
| \`created_at\` / \`updated_at\` | timestamptz | |

### `wellness`
| column | type | notes |
|---|---|---|
| \`date\` | date PK | one row per day |
| \`ctl\` | numeric NULL | fitness |
| \`atl\` | numeric NULL | fatigue |
| \`form\` | numeric NULL | TSB = ctl − atl |
| \`resting_hr\` | integer NULL | |
| \`hrv\` | numeric NULL | ms |
| \`sleep_hours\` | numeric NULL | |
| \`sleep_stages\` | jsonb NULL | |
| \`readiness\` | numeric NULL | Garmin Training Readiness (FR265; may be null) |
| \`body_battery\` | integer NULL | Garmin (FR265; may be null) |
| \`weight_kg\` | numeric NULL | |
| \`source\` | text | usually \`'intervals'\` |

\`readiness\` and \`body_battery\` are **nullable by design** — pull if present, tolerate null.

---

## 5. Data sources & import

### 5a. Strava export — one-time seed
\`activities.csv\` is in \`/pipeline/data/\` (gitignored). Verified against the real file: **103 columns, 4,690 rows, Apr 2015 → Sep 2025.**

**Duplicate-column trap (critical).** Repeated headers with different units — parse **by column position**, use the RAW occurrence:
- **Distance** appears twice: first is **km** (\`7.63\`), second is **metres** (\`7636.6\`). Use metres for \`distance_m\`.
- **Elapsed Time** and **Max Heart Rate** also appear twice — use the later/raw occurrence.
- **Moving Time** is a single clean column, in **seconds**.

One-time import script → upsert into \`activities\` with \`source='strava'\`:
- \`Activity ID\` → \`id\` (as \`strava:<id>\`)
- \`Activity Date\` → \`date\`; \`Activity Name\` → \`name\`
- \`Activity Type\` → \`sport\`: **Ride / Virtual Ride / E-Bike Ride → ride**; **Run / Virtual Run → run**; **Weight Training → gym**; **Walk / Hike → other**
- Distance (**metres column**) → \`distance_m\`
- \`Moving Time\` → \`duration_s\`; Elapsed Time → \`elapsed_s\`
- \`Elevation Gain\` → \`elevation_m\`
- \`Average/Max Heart Rate\` → \`avg_hr\`/\`max_hr\`; \`Average Watts\` → \`avg_power\`
- \`Training Load\` → \`strava_load\` **only**. Never \`load\`.

Leave \`load\`, \`ctl\`, \`atl\`, \`form\` null for Strava rows.

### 5b. intervals.icu — ongoing sync + backfill
Connected directly to Garmin (FR265). Auth: API key as HTTP Basic (username \`API_KEY\`, password = the key).

Confirm exact endpoint paths/field names against the intervals.icu API docs before hardcoding:
- **Activities:** \`GET /api/v1/athlete/{id}/activities\` over a date range → \`activities\`, \`source='intervals'\`; use the training-load field for \`load\`; per-activity intervals endpoint for structure.
- **Wellness:** \`GET /api/v1/athlete/{id}/wellness\` → \`ctl\`, \`atl\`, \`form\`, \`restingHR\`, \`hrv\`, sleep, plus Garmin \`readiness\`/\`body_battery\`.

**Pull CTL/ATL/form from intervals.icu — do not recompute.** Backfill 3+ years on first run.

### 5c. Dedup between sources
Same activity may appear in both. On upsert:
- Same if **same calendar day + sport + distance within ~2%**.
- **Prefer the intervals.icu record** (richer). Keep the Strava row only when no intervals match exists.
- Keep \`source\` accurate.

---

## 6. The sync job (GitHub Actions)
- Scheduled workflow (cron), intervals.icu sync **once daily**, incremental upsert.
- Connects to Postgres via the **session-pooler** connection string (IPv4 — the direct \`db.*.supabase.co\` host is IPv6-only and unreachable from Actions).
- Writes using the **secret key** / DB URL, stored in **GitHub Secrets** — never in code.
- The Strava import is **not** in the Action — it's a one-off run locally once.

---

## 7. Wire the front-end to Supabase
- Front-end reads Supabase via the **publishable key** (client-safe) using the Supabase JS client / REST.
- Replace mock data in each view with live queries; weekly/monthly rollups via SQL views or client-side.
- Charts use the palette (coral hero line, petrol/ochre/ink supporting) — no default chart-library colours.
- Deploy to **Vercel**; Supabase URL + publishable key as Vercel env vars.

---

## 8. Coaching connection (read-only)
- Create a **dedicated read-only Postgres role** in Supabase — \`SELECT\` on \`activities\` and \`wellness\` only. A chat must never write or drop.
- The Action uses the secret/service credentials; the coaching connection uses only the read-only role.
- The user connects Supabase as a Claude connector (claude.ai → connectors, or the Connect dialog's **MCP** tab) using the read-only credentials.

---

## 9. Secrets & config (never commit)
Local \`.env\` and **GitHub Secrets** for the Action:
- \`INTERVALS_API_KEY\`, \`INTERVALS_ATHLETE_ID\`
- \`SUPABASE_URL\`
- \`SUPABASE_SECRET_KEY\` (Action writes)
- \`SUPABASE_PUBLISHABLE_KEY\` (front-end reads — Vercel env, client-safe)
- \`SUPABASE_DB_URL\` (session-pooler string, for migrations + read-only role setup)
- Read-only role credentials (coaching connector)

The Strava export CSV is a **local gitignored file**, not a committed secret.

---

## 10. Build sequence
1. **Scaffold** the repo (\`/web\`, \`/pipeline\`, \`/supabase\`, \`/.github/workflows\`), \`.gitignore\`, \`.env.example\`.
2. **Import the design** (§3) → front-end shell on mock data.
3. **Supabase schema** (§4) as SQL migrations.
4. **Strava one-time import** (5a) → seed \`activities\`.
5. **intervals.icu sync script** (5b) → test, backfill, verify dedup (5c).
6. **GitHub Action** (§6) → schedule the daily sync.
7. **Wire front-end to Supabase** (§7) → replace mock data, deploy.
8. **Read-only role** (§8) → connect Supabase to Claude for coaching.

Confirm the schema and both import mappings with the user before writing sync logic — the Strava CSV units and the intervals.icu field names are the two places this goes subtly wrong.
