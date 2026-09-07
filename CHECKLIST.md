# Nahva — build checklist

Gates come from `CLAUDE.md` § *Definition of done*. Tick only with evidence.

## 0 · Scaffold
- [x] `/web`, `/pipeline`, `/supabase/migrations`, `/.github/workflows` created
- [x] `.gitignore` (`.env`, `pipeline/data/`, `node_modules/`, `.DS_Store`)
- [x] `.env.example` written (var names only, no secrets)
- [x] `CLAUDE.md` + `BUILD_BRIEF.md` moved to repo root (were in gitignored `pipeline/data/`)

## A · Schema  *(coordinator-only, `/supabase`)*
- [ ] Migration written: `activities`, `wellness`
- [ ] Migration applied cleanly
- [ ] **Gate:** both tables exist with specced columns — evidence: `information_schema` dump

## B · Strava import  *(`/pipeline/strava_import.py`)*
- [ ] Script written, parses **by column position** (duplicate-header trap)
- [ ] Import run to completion
- [ ] **Gate:** row count ≈ 4,690
- [ ] **Gate:** distance in **metres** not km (spot-check)
- [ ] **Gate:** sports mapped (ride/run/gym/other)
- [ ] **Gate:** Strava Training Load in `strava_load`, `load` NULL for all Strava rows

## C · intervals.icu sync  *(`/pipeline/intervals_sync.py`, `/.github/workflows`)*
- [ ] Endpoints + field names confirmed against live API (not guessed)
- [ ] Sync pulls a date range into `activities` + `wellness`
- [ ] Backfill 3+ years
- [ ] **Gate:** dedup verified — no double-count on overlapping days, intervals record preferred
- [ ] **Gate:** CTL/ATL/form **pulled from intervals.icu**, not recomputed
- [ ] **Gate:** `readiness`/`body_battery` tolerated as null
- [ ] GitHub Action scheduled daily, uses **session-pooler** URL from GitHub Secrets

## D · Front-end  *(`/web`, mock data)*
- [ ] Design imported via `claude-design` MCP
- [ ] Views: Home/This week, Training log, Progression, Activity detail, (opt) Recovery
- [ ] **Gate:** builds + renders all views on mock data
- [ ] **Gate:** matches tokens — paper `#FAF7F2`, ink `#17140F`, coral `#FF6B54`, petrol `#124E4A`, ochre `#E7A82E`; Space Grotesk + Space Mono

## JOIN · Wire front-end to live Supabase
- [ ] Mock data replaced with live queries in every view
- [ ] **Gate:** weekly volume total reconciles against a manual CSV sum
- [ ] Deployed to Vercel with env vars set

## COACH · Read-only role
- [ ] Dedicated read-only Postgres role, `SELECT` on `activities` + `wellness` only
- [ ] **Gate:** role can `SELECT`; a write attempt **fails**
- [ ] *(human)* Supabase connected to Claude as a connector

---

## Blocked on human
- [ ] Session-pooler `SUPABASE_DB_URL` — needed for the Action (direct host is IPv6-only)
- [ ] GitHub Secrets for the Action (`SUPABASE_DB_URL`, `SUPABASE_SECRET_KEY`, `INTERVALS_*`)
- [ ] Vercel project link + env vars
- [ ] Claude ↔ Supabase connector auth
