# Nahva front-end (workstream D)

Mobile-first SPA implementing the Claude Design project
["Mobile app layout exploration"](https://claude.ai/design/p/4a37c4d9-9d35-4e5d-b9cf-bcdff272cd90).
Currently on **mock data** — wiring to Supabase is the JOIN phase.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc --noEmit && vite build
npm run smoke      # render-time checks over every view (130 assertions)
```

## Which design cards this implements

The design has two turns. **t2 supersedes t1** where they overlap:

| View | Card | Notes |
|---|---|---|
| Home / This week | **2a** | Hero is *moving time*, readiness tile is petrol, the whole Body screen folds in under the week |
| Training log | **2b** | Calendar — week per row, one dot per activity; dot size *and* its number read the metric |
| Progression | **1d** | PMC — coral CTL hero, petrol ATL, ochre TSB strip |
| Activity detail | **1g** | Sport-coloured header, interval block diagram, recovery context |
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
  volume. The chart is clamped to actual load coverage and never stretched to
  fill a longer range; a persistent notice states the coverage in days and
  explicitly says it is not a long-term trend. See `views/progression.ts`.
- **Absent metrics render as absent.** Readiness and body battery show `—` with
  NOT REPORTED, not a plausible-looking number.
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
src/mock.ts         deterministic fixture (swap this out at JOIN)
src/format.ts       duration/distance/pace formatting, sport→colour
src/charts.ts       hand-rolled SVG paths — no chart library
src/views/*.ts      one module per view, pure state → HTML string
src/main.ts         state, delegated events, hash routing
test/smoke.ts       render assertions
.design-src/        the imported design + per-card extracts, kept as provenance
```

Views are pure `render(state) → string`, so JOIN means replacing
`loadMockDataset()` with a Supabase query returning the same `Dataset` shape —
not rewriting views.

Routes are hash-based: `#home`, `#log`, `#fitness`, `#activity/<id>`.

## Known gaps (JOIN phase)

- No Supabase client yet; `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` become
  Vercel env vars.
- Weekly rollups are computed client-side over the full activity list. Fine for
  4.7k rows; if it grows, move to a SQL view.
- Not yet deployed. `vercel link` and env vars are outstanding.
