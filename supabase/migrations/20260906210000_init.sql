-- Nahva — initial schema (workstream A)
-- Contract shared by the Strava import (B), the intervals.icu sync (C),
-- the front-end (D/JOIN) and the read-only coaching role (COACH).
-- Columns follow BUILD_BRIEF.md §4 exactly.

-- ─────────────────────────────────────────────────────────────
-- activities
-- ─────────────────────────────────────────────────────────────
create table if not exists public.activities (
  -- source id, prefixed: 'intervals:12345' / 'strava:678'
  id                text primary key,
  source            text not null check (source in ('intervals', 'strava')),
  date              timestamptz not null,
  sport             text not null check (sport in ('run', 'ride', 'gym', 'other')),
  name              text,

  distance_m        numeric,          -- METRES. Never km. (CSV duplicate-column trap)
  duration_s        integer,          -- moving time, seconds
  elapsed_s         integer,
  elevation_m       numeric,

  -- TSS / training load — intervals.icu ONLY. Never Strava's number.
  load              numeric,
  -- Strava's own Training Load. Reference only; never feeds the CTL/ATL model.
  strava_load       numeric,

  avg_hr            integer,
  max_hr            integer,
  avg_power         numeric,
  avg_pace_s_per_km numeric,

  intervals         jsonb,            -- derived interval structure
  raw               jsonb,            -- original payload, for debugging

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on column public.activities.distance_m is
  'Metres. The Strava CSV has two Distance columns (km at idx 6, metres at idx 17) — always the metres one.';
comment on column public.activities.load is
  'intervals.icu training load only. Strava load goes in strava_load and must never be copied here.';

create index if not exists activities_date_idx       on public.activities (date desc);
create index if not exists activities_sport_date_idx on public.activities (sport, date desc);
create index if not exists activities_source_idx     on public.activities (source);
-- The dedup lookup in BUILD_BRIEF §5c (same calendar day + sport) is served by
-- activities_sport_date_idx via a range scan on the day's bounds. An expression
-- index on (date::date) is not possible: casting timestamptz to date is STABLE,
-- not IMMUTABLE, because it depends on the session TimeZone.

-- ─────────────────────────────────────────────────────────────
-- wellness — one row per day
-- ─────────────────────────────────────────────────────────────
create table if not exists public.wellness (
  date          date primary key,

  ctl           numeric,   -- fitness   } pulled from intervals.icu,
  atl           numeric,   -- fatigue   } never recomputed locally
  form          numeric,   -- TSB = ctl - atl

  resting_hr    integer,
  hrv           numeric,   -- ms
  sleep_hours   numeric,
  sleep_stages  jsonb,

  -- Garmin FR265. Nullable BY DESIGN — pull if present, tolerate absent.
  readiness     numeric,
  body_battery  integer,

  weight_kg     numeric,
  source        text not null default 'intervals',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.wellness.ctl is
  'Pulled from intervals.icu. Do not recompute — the brief is explicit about this.';
comment on column public.wellness.readiness is
  'Garmin Training Readiness. Nullable by design.';

create index if not exists wellness_date_idx on public.wellness (date desc);

-- ─────────────────────────────────────────────────────────────
-- updated_at maintenance
-- ─────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists activities_set_updated_at on public.activities;
create trigger activities_set_updated_at
  before update on public.activities
  for each row execute function public.set_updated_at();

drop trigger if exists wellness_set_updated_at on public.wellness;
create trigger wellness_set_updated_at
  before update on public.wellness
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- RLS — single user. Front-end reads with the publishable key.
-- The pipeline writes with the secret key, which bypasses RLS.
-- So: read-only to anon/authenticated, no write policy for anyone.
-- ─────────────────────────────────────────────────────────────
alter table public.activities enable row level security;
alter table public.wellness   enable row level security;

drop policy if exists activities_read on public.activities;
create policy activities_read on public.activities
  for select to anon, authenticated using (true);

drop policy if exists wellness_read on public.wellness;
create policy wellness_read on public.wellness
  for select to anon, authenticated using (true);
