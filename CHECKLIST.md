# Nahva — build checklist

Gates come from `CLAUDE.md` § *Definition of done*. Tick only with evidence.

Reproduce all gate evidence with:
`pipeline/.venv/bin/python pipeline/verify.py A B C`  → **16/16 passing**

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
- [ ] **Action unproven** — needs GitHub Secrets (see *Blocked on human*)

## D · Front-end  *(`/web`, mock data)*
- [x] Design imported via `claude-design` MCP — project `4a37c4d9…`
      ("Mobile app layout exploration"), files `Freischwimmer.dc.html` + `support.js`,
      kept as provenance in `web/.design-src/`
- [x] Views: Home/This week (2a), Training log (2b), Progression (1d),
      Activity detail (1g). **No Recovery tab** — card 2a folds Body into Home
- [x] Nav per card 2c: pattern A, ink tab bar, coral rule, **three** tabs
- [x] **Gate:** builds — `npm run build` (tsc --noEmit + vite) clean
- [x] **Gate:** renders all views on mock data — `npm run smoke`, **130/130**
      assertions, plus headless screenshots of all three tabs
- [x] **Gate:** matches tokens — `src/tokens.css` transcribed from card 2d;
      smoke test **fails on any raw hex** in a view, so drift is caught
- [x] Interactions live: TIME/KM toggle, sport filter, day selection, PMC range tabs
- [x] Hash routes: `#home`, `#log`, `#fitness`, `#activity/<id>`

## JOIN · Wire front-end to live Supabase
- [ ] Mock data replaced with live queries in every view
- [ ] **Gate:** weekly volume total reconciles against a manual CSV sum
- [ ] Deployed to Vercel with env vars set

## COACH · Read-only role
- [ ] Dedicated read-only Postgres role, `SELECT` on `activities` + `wellness` only
- [ ] **Gate:** role can `SELECT`; a write attempt **fails**
- [ ] *(human)* Supabase connected to Claude as a connector

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

**Handled in D.** `web/src/views/progression.ts` clamps the PMC to actual load
coverage — a 1Y range never stretches 5 weeks across a year — labels the axis
"N DAYS OF LOAD", and carries a permanent *FITNESS CURVE · BUILDING* panel
stating the coverage in days against the volume span in years. `web/src/mock.ts`
mirrors the real shape (23 of 4,611 activities carry load; 34 days of CTL;
readiness and body_battery null throughout), so the views are exercised against
production conditions rather than tuned to numbers that never arrive.

## Blocked on human
- [x] Session-pooler `SUPABASE_DB_URL` — set, `aws-1-eu-west-1.pooler.supabase.com:5432`,
      resolves to IPv4 so it will work from Actions
- [ ] **GitHub Secrets** for the Action: `SUPABASE_DB_URL` (pooler string),
      `INTERVALS_API_KEY`, `INTERVALS_ATHLETE_ID`
- [ ] Push the repo to GitHub (nothing pushed yet — commits are local only)
- [ ] Vercel project link + env vars
- [ ] Claude ↔ Supabase connector auth (read-only role)

## Known deviations
- **`form` is computed as `ctl - atl`.** The API returns no `form` and no `tsb`
  field on any row (verified across all 46 wellness keys). CTL and ATL are pulled
  verbatim. Approved 2026-09-07.
- **TLS:** `SUPABASE_DB_SSLMODE=require` — encrypted but unverified. Supabase's
  Root 2021 CA is committed at `pipeline/certs/prod-ca-2021.crt` and `db.py`
  prefers it, but OpenSSL 3 rejects it for lacking a `keyUsage` extension.
  Verification switches on automatically if Supabase reissues.
