# Nahva front-end (workstream D)

Mobile-first SPA implementing the Claude Design project
["Mobile app layout exploration"](https://claude.ai/design/p/4a37c4d9-9d35-4e5d-b9cf-bcdff272cd90).
Reads **live Supabase** via PostgREST. The mock fixture remains only as an
offline fallback; when it is in use the UI shows a MOCK DATA banner, so it is
never ambiguous whether a number is real.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc --noEmit && vite build
npm run smoke      # render-time checks over every view (151 assertions)
```

Live data needs `web/.env.local` (gitignored):

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Both are client-safe. RLS is on and the only policies are `SELECT` for
anon/authenticated, verified: an anon `INSERT` returns `42501` / HTTP 401.
Without these vars the app falls back to the fixture.

## Which design cards this implements

The design has two turns. **t2 supersedes t1** where they overlap:

| View | Card | Notes |
|---|---|---|
| Home / This week | **2a** | Hero is *moving time*; the Body screen folds in under the week. Readiness tile and body-battery block dropped — see *Metrics with no data source* |
| Training log | **2b** | Calendar — week per row, one dot per activity; dot size *and* its number read the metric |
| Progression | **1d** | PMC — coral CTL hero, petrol ATL, ochre TSB strip |
| Activity detail | **1g** | Sport-coloured header, segment block diagram, recovery context |
| Colour system | **2d** | Transcribed verbatim into `src/tokens.css` |
| Nav | **2c** | Pattern A — ink tab bar, coral rule. **Three** tabs |

There is no separate Recovery tab: card 2a folds the Body screen into Home, which
is why `1h` isn't implemented as its own view.

The design file is named `Freischwimmer.dc.html` — that's just its name in Claude
Design. The product is **Nahva**, and the wordmark says so.

## Colour discipline

`src/tokens.css` is the only place colours are defined. Card 2d's rules are
enforced, not merely documented:

- one job per colour; **type colour is fixed by ground** — coral/ochre carry ink,
  petrol/ink carry paper
- sport colour appears only where a sport is named (`sportColor()` in
  `src/format.ts` is the single lookup)
- charts use exactly three series — coral CTL, petrol ATL, ochre TSB. A fourth
  (the sleep sparkline) is ink at 40% via `--extra-series`
- TSB bars fade to 42% when negative

`npm run smoke` fails if any view emits a raw hex colour, which is how palette
drift gets caught.

## The mock data is shaped like the real data

`src/mock.ts` is deterministic and deliberately mirrors production conditions
rather than flattering the design:

| | Mock | Live (verified) |
|---|---|---|
| Activities | 4,611 | 4,690 |
| Volume history | 2013-07-22 → 2026-09-06 | 2013-07-22 → 2026-08-04 |
| Activities carrying `load` | 23 | 24 |
| Days of CTL/ATL | 34 | 35 |
| `readiness` | null throughout | null on every row |
| `body_battery` | null throughout | field not returned at all |
| Recent rides | none | none (intervals.icu has zero rides) |

Consequences the views must handle, and do:

- **The PMC reads as "building."** ~5 weeks of CTL/ATL against 13 years of
  volume. The chart spans the whole selected range with the curve occupying only
  the days that have load, marks the empty stretch NO LOAD DATA, and labels the
  axis with real coverage ("36 OF 43 DAYS · 84%"). A persistent notice states the
  coverage and says it is not a long-term trend. See `views/progression.ts`.
  (An earlier version *clamped* the chart to coverage, which made all four range
  pills produce an identical path and look broken; the smoke test now asserts
  four distinct CTL paths.)
- **Metrics that arrive late are not reported as missing.** See *Reading wellness
  metrics* below.
- **Strava rows show no load.** Activity detail states
  `NO TRAINING LOAD · STRAVA-SOURCED` and, where Strava had its own figure, says
  it is not used — `strava_load` must never reach the PMC.

`TODAY` is pinned to Sunday 2026-09-06 (the last complete ISO week) so the Home
hero shows a full week. A Monday-morning week of one session renders correctly
too; it just makes a poor fixture.

## Structure

```
src/tokens.css      design tokens — the only colour definitions
src/app.css         component styles, transcribed from the design cards
src/types.ts        mirrors the Postgres schema in supabase/migrations/
src/data.ts         live Supabase reads (PostgREST, publishable key)
src/mock.ts         deterministic fixture — offline fallback only
src/wellness.ts     per-metric resolution of wellness values
src/format.ts       duration/distance/pace formatting, sport→colour
src/charts.ts       hand-rolled SVG paths — no chart library
src/views/*.ts      one module per view, pure state → HTML string
src/main.ts         state, delegated events, hash routing
test/smoke.ts       render assertions
.design-src/        the imported design + per-card extracts, kept as provenance
```

Views are pure `render(state) → string` over a `Dataset`, which both `data.ts`
and `mock.ts` produce. Swapping source required no view changes.

Routes are hash-based: `#home`, `#log`, `#fitness`, `#activity/<id>`.

## Known gaps

- **Not deployed.** `vercel link` plus `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_PUBLISHABLE_KEY` as Vercel env vars are outstanding.
- All 4.7k activities are fetched on load (paginated at 1,000/request, `raw`
  excluded) and rolled up client-side. Fine at this size; if it grows, move the
  weekly rollups into a SQL view.
- No caching or loading skeleton beyond a LOADING… title.
- `ride` load is entirely absent, so a sport-split load view has nothing to show
  until Garmin syncs a ride.


## Metrics with no data source

Three elements of card 2a have nothing to populate them, verified against all 36
live wellness rows:

| Metric | Why |
|---|---|
| `readiness` | key exists in the API, null on every row |
| `body_battery` | field is not returned by intervals.icu at all |
| `sleep_stages` | no stage breakdown, only `sleepSecs` |

Rather than render three permanently-empty blocks, the readiness tile and
body-battery block are dropped and the sleep chart shows total hours. Those
slots now carry HRV, RHR and sleep hours. Agreed 2026-09-08. The columns remain
in the schema and in `types.ts` so the gap stays named if a source ever appears.

## Reading wellness metrics

`src/wellness.ts` resolves each metric to its most recent non-null value rather
than reading them all off the newest row. A wellness row's fields don't populate
together — intervals.icu computes ctl/atl immediately, Garmin pushes hrv and
restingHR later — so today's row routinely has ctl/atl and a null hrv. Reading
one row made HRV and RHR display "—" when they were merely not in yet. Values
older than the newest row are shown with their date.

## Interval structure is not a workout

For an unstructured run, intervals.icu auto-splits into ~1 km laps: every segment
`type: "WORK"`, `label: null`, `intensity` as a percentage. There is normally no
rep/recovery structure to recover, so Activity detail describes what the segments
are and states they aren't a planned workout. `pipeline/intervals_sync.py`
normalises the 84-field payload into the documented `Interval` shape before it
reaches the database.
