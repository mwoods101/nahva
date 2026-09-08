# Nahva — build checklist

Gates come from `CLAUDE.md` § *Definition of done*. Tick only with evidence.

Reproduce all gate evidence with:
`pipeline/.venv/bin/python pipeline/verify.py`  → **29/29 passing** (A, B, C, JOIN, COACH)
Front-end render checks: `cd web && npm run smoke` → **151/151 passing**

## 0 · Scaffold
- [x] `/web`, `/pipeline`, `/supabase/migrations`, `/.github/workflows` created
- [x] `.gitignore` (`.env`, `pipeline/data/`, `pipeline/.venv/`, `node_modules/`, `.DS_Store`)
- [x] `.env.example` written (var names only, no secrets)
- [x] `CLAUDE.md` + `BUILD_BRIEF.md` moved to repo root (were in gitignored `pipeline/data/`)

## A · Schema  *(coordinator-only, `/supabase`)*
- [x] Migration written: `activities`, `wellness` — `supabase/migrations/20260906210000_init.sql`
- [x] Migration applied cleanly (`supabase db push --linked`)
- [x] **Gate:** both tables exist with specced columns — 19 + 14 columns, none missing
- [x] RLS enabled, `SELECT`-only policies for `anon`/`authenticated`

## B · Strava import  *(`pipeline/strava_import.py`)*
- [x] Script written, parses **by column position** with a header assertion
- [x] Import run to completion
- [x] **Gate:** row count = **4,690**
- [x] **Gate:** distance in **metres** — `strava:19592925058` → `7636.6`, not `7.63`; avg 21,225 m
- [x] **Gate:** sports mapped — ride 3604, run 797, gym 240, other 49
- [x] **Gate:** `strava_load` set on 352 rows; `load` NULL on **all 4,690**

## C · intervals.icu sync  *(`pipeline/intervals_sync.py`, `/.github/workflows`)*
- [x] Endpoints + field names confirmed against the **live API** (docs unusable — no
      reachable OpenAPI spec). Load field is `icu_training_load`; date is
      `start_date`; `pace` is m/s so `avg_pace_s_per_km` is derived
- [x] Sync pulls activities + wellness → 24 activities, 35 wellness rows
- [x] Backfill run (`--backfill`, 2010→today) — returns all available data
- [x] **Gate:** dedup verified — 0 overlapping rows; rule proven by
      `pipeline/test_dedup.py` (**9/9 cases**, transactional, rolls back)
- [x] **Gate:** CTL/ATL **pulled** from intervals.icu — 35/35 rows, never modelled locally
- [x] **Gate:** `readiness`/`body_battery` tolerated as null — 0/35 non-null, no errors
- [x] Interval structure stored for 20/24 activities (gym sessions skipped by design)
- [x] Workflow written — `.github/workflows/sync.yml`, daily 06:30 UTC + manual dispatch
- [x] **Action proven end-to-end** — run
      [34245838521](https://github.com/mwoods101/nahva/actions/runs/34245838521),
      green in 15s: fetched 6 activities + 8 wellness rows, wrote via
      `aws-1-eu-west-1.pooler.supabase.com:5432` (IPv4, as required from a
      runner), dedup 0, committed; gate C **5/5** in CI

## D · Front-end  *(`/web`)*
- [x] Design imported via `claude-design` MCP — project `4a37c4d9…`
      ("Mobile app layout exploration"), files `Freischwimmer.dc.html` + `support.js`,
      kept as provenance in `web/.design-src/`
- [x] Views: Home/This week (2a), Training log (2b), Progression (1d),
      Activity detail (1g). **No Recovery tab** — card 2a folds Body into Home
- [x] Nav per card 2c: pattern A, ink tab bar, coral rule, **three** tabs
- [x] **Gate:** builds — `npm run build` (tsc --noEmit + vite) clean
- [x] **Gate:** renders all views — `npm run smoke`, **151/151** assertions,
      plus headless screenshots of all three tabs on live data
- [x] **Gate:** matches tokens — `src/tokens.css` transcribed from card 2d;
      smoke test **fails on any raw hex** in a view, so drift is caught
- [x] Interactions live: TIME/KM toggle, sport filter, day selection, PMC range tabs
- [x] Hash routes: `#home`, `#log`, `#fitness`, `#activity/<id>`

## JOIN · Wire front-end to live Supabase
- [x] Mock data replaced with live queries — `web/src/data.ts` reads PostgREST
      with the publishable key; `loadMockDataset()` remains only as an offline
      fallback, and the UI shows a MOCK DATA banner when it is in use
- [x] **Gate:** weekly volume reconciles against a manual CSV sum —
      week 2026-07-20..26: count 4=4, moving 10436s=10436s, distance
      31517.5m=31517.5m, **exact on all three**
- [x] **Gate:** publishable key is read-only — anon `SELECT` works, anon
      `INSERT` rejected (`42501`, HTTP 401); no write policy exists
- [x] Numeric coercion on ingest, so `numeric` columns can't concatenate
- [x] Deployed to Vercel — **https://nahva-mw-oods101.vercel.app**
      (stable production alias). `VITE_SUPABASE_URL` +
      `VITE_SUPABASE_PUBLISHABLE_KEY` set for production/preview/development
- [x] Git connected, `rootDirectory` set to `web` so git-triggered builds find
      the app — a CLI deploy from inside `web/` masked this
- [x] Deployment Protection **disabled** by decision (2026-09-08): the URL is
      public. Vercel enables it by default, and the first deploy served
      "Login – Vercel" behind an HTTP 200

## COACH · Read-only role
- [x] Dedicated read-only role `nahva_coach` — `SELECT` on `activities` +
      `wellness` only, `NOINHERIT`, own `SELECT`-only RLS policy, default
      privileges revoked so future tables aren't readable by accident.
      `pipeline/setup_coach_role.py`, idempotent
- [x] **Gate:** **8/8** — connects *as* `nahva_coach` (not inspected from the
      admin session), reads 4,714 activities + 36 wellness rows, and
      `INSERT` / `UPDATE` / `DELETE` / wellness `INSERT` / DDL all refused
      with `42501 permission denied`
- [ ] *(human)* Supabase connected to Claude as a connector — role and password
      are ready; user is `nahva_coach.gyzbfvnnjkgehqgymzwe` on
      `aws-1-eu-west-1.pooler.supabase.com:5432`

---

## ⚠ Data depth — the PMC "fills over time"

**intervals.icu holds only 35 days: 2026-08-04 → 2026-09-07.** 24 activities
(19 Run, 4 WeightTraining, 1 VirtualRun — **zero rides**), 35 wellness rows.

The front-end must treat the Performance Management Chart as **filling over
time**, not as a historical record:

- **Volume / training log** span 13 years (2013-07-22 → 2026-08-04, 4,690 rows).
- **CTL / ATL / form** span ~5 weeks. `load` is non-null on **24 of 4,714** rows.
- Do **not** hardcode the brief's stated range ("Apr 2015 → Sep 2025") — it is
  wrong in both directions.
- Ride load is entirely absent, so any sport-split load view will show only
  run/gym until Garmin syncs a ride. The `ride` dedup path is untested for the
  same reason.
- Design the PMC to render gracefully with a few weeks of data and no ride load:
  short axis, no implied long-term trend, and an empty/partial state that reads
  as "building" rather than broken.

**Handled.** `web/src/views/progression.ts` plots the PMC across the whole
selected range with the curve occupying only the days that have load, marks the
empty stretch *NO LOAD DATA*, labels the axis with actual coverage
("36 OF 43 DAYS · 84%"), and carries a permanent *FITNESS CURVE · BUILDING*
panel stating coverage in days against the volume span in years.

An earlier version instead *clamped* the chart to load coverage. That made
6W/3M/1Y/ALL produce a byte-identical path, so the range pills looked broken —
reported in review 2026-09-08. `web/test/smoke.ts` now asserts four distinct CTL
paths across the four ranges, so the regression can't return.

## Blocked on human
- [x] Session-pooler `SUPABASE_DB_URL` — set, `aws-1-eu-west-1.pooler.supabase.com:5432`,
      resolves to IPv4 so it will work from Actions
- [x] **GitHub Secrets** set: `SUPABASE_DB_URL` (pooler string),
      `INTERVALS_API_KEY`, `INTERVALS_ATHLETE_ID`
- [x] Pushed to GitHub — `mwoods101/nahva` @ `83e33f9`, 5 commits, authorship
      normalised to `m.woods101@gmail.com`
- [x] `COACH_DB_PASSWORD` set (43 chars)
- [x] Vercel project link + env vars
- [ ] Claude ↔ Supabase connector auth (read-only role)

## Fixed in review (2026-09-08)
Reported after first running the app; all had genuine causes.
- **Interval structure contradicted its activity.** Every mock run carried an
  identical 3,780s structure, so a 36-minute run showed a 63-minute workout.
  Laps now sum exactly to the activity's moving time (smoke: worst delta 0s).
- **C and D disagreed on interval shape.** The sync stored intervals.icu's raw
  84-field payload (`moving_time`, `average_heartrate`, `intensity` as a
  percentage); the front-end expected `duration_s`/`avg_hr`/0–1 `intensity`, so
  bars would have rendered 7200% tall. `normalise_intervals()` now writes one
  documented shape and the backfill was re-run.
- **"4 × 8min @ threshold" was invented.** intervals.icu auto-splits an
  unstructured run into ~1 km laps, all `type=WORK` with null labels. The view
  now describes what the segments are and says they aren't a planned workout.
- **Range pills looked dead** — see the PMC note above.
- **`290k` read as 290,000.** Weekly km totals now carry explicit units.
- **Calendar dots weren't tappable.** Day cells are divs, dots are buttons, and
  delegation resolves innermost-first, so a dot opens the activity.
- **Implausible mock pairs** — two 60km+ rides minutes apart. A same-day second
  ride is now a shorter commute at a different hour.
- **HRV/RHR showed "—".** Today's wellness row has ctl/atl before Garmin pushes
  hrv/restingHR, and every field was read off that one row. `web/src/wellness.ts`
  resolves each metric to its most recent non-null value and dates it when stale.
- **Fake status bar removed** — "9:41 · 5G · 82%" is design-canvas furniture.

## Known deviations
- **`form` is computed as `ctl - atl`.** The API returns no `form` and no `tsb`
  field on any row (verified across all 46 wellness keys). CTL and ATL are pulled
  verbatim. Approved 2026-09-07.
- **Readiness, body battery and sleep stages are not shown.** No data source:
  intervals.icu returns no `bodyBattery` field, `readiness` is null on all 36
  rows, and there is no stage breakdown, only `sleepSecs`. Card 2a's readiness
  tile and body-battery block are dropped and the sleep chart shows total hours;
  those slots now carry HRV, RHR and sleep hours. Approved 2026-09-08.
- **TLS:** `SUPABASE_DB_SSLMODE=require` — encrypted but unverified. Supabase's
  Root 2021 CA is committed at `pipeline/certs/prod-ca-2021.crt` and `db.py`
  prefers it, but OpenSSL 3 rejects it for lacking a `keyUsage` extension.
  Verification switches on automatically if Supabase reissues.
