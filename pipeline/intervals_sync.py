#!/usr/bin/env python3
"""Workstream C — intervals.icu sync into `activities` + `wellness`.

    pipeline/.venv/bin/python pipeline/intervals_sync.py --days 30 --dry-run
    pipeline/.venv/bin/python pipeline/intervals_sync.py --days 30
    pipeline/.venv/bin/python pipeline/intervals_sync.py --backfill

FIELD NAMES ARE CONFIRMED AGAINST THE LIVE API, NOT THE DOCS.
intervals.icu publishes no reachable OpenAPI spec (api-docs.html is a Swagger
shell; /v3/api-docs and /swagger.json return the SPA), so these were verified by
inspecting real payloads for athlete i664415:

  load       <- icu_training_load    ('training_load' / 'trainingLoad' / 'load'
                                      are ABSENT from the payload entirely;
                                      'hr_load' exists but is HR-derived, HRSS)
  date       <- start_date           ('...Z', UTC). NOT start_date_local, which
                                      carries no offset.
  distance   <- distance             already metres
  pace       <- DERIVED              their 'pace'/'average_speed' are m/s, not s/km
  avg_power  <- icu_average_watts    ('average_watts' is absent)
  form       <- DERIVED as ctl-atl   the API returns no 'form' and no 'tsb' on
                                      any row; the brief defines form = ctl-atl

CTL and ATL are always pulled verbatim and never modelled locally.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import connect, describe_target, env  # noqa: E402

BASE = "https://intervals.icu/api/v1"

# intervals.icu type values differ from Strava's: no spaces, different casing.
# Confirmed present on this account: Run, VirtualRun, WeightTraining.
# The ride/walk entries are mapped ahead of Garmin syncing any.
SPORT_MAP = {
    "Ride": "ride",
    "VirtualRide": "ride",
    "EBikeRide": "ride",
    "GravelRide": "ride",
    "MountainBikeRide": "ride",
    "Run": "run",
    "VirtualRun": "run",
    "TrailRun": "run",
    "WeightTraining": "gym",
    "Workout": "gym",
    "Walk": "other",
    "Hike": "other",
}

# The athlete's timezone, from GET /athlete/{id}. Calendar-day comparisons for
# dedup use this rather than UTC, so a 23:30 local session isn't pushed a day.
ATHLETE_TZ = "Europe/London"

BATCH = 200

# Safety rail: dedup should only ever remove a handful of rows on this dataset
# (Strava ends 2026-08-04, intervals starts 2026-08-04 — a one-day overlap).
# Anything larger means the match rule is wrong; abort rather than delete.
MAX_DELETIONS = 10


def api_get(path: str, params: dict | None = None) -> object:
    key, athlete = env("INTERVALS_API_KEY"), env("INTERVALS_ATHLETE_ID")
    resp = requests.get(
        f"{BASE}{path.format(athlete=athlete)}",
        params=params or {},
        auth=("API_KEY", key),  # username is the literal string API_KEY
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


# ───────────────────────────── activities ─────────────────────────────

ACT_FIELDS = [
    "id", "source", "date", "sport", "name", "distance_m", "duration_s",
    "elapsed_s", "elevation_m", "load", "avg_hr", "max_hr", "avg_power",
    "avg_pace_s_per_km", "intervals", "raw",
]


def map_activity(a: dict, structure: list | None) -> dict:
    sport = SPORT_MAP.get(a.get("type"), "other")
    distance = a.get("distance")
    duration = a.get("moving_time")

    pace = None
    if sport == "run" and distance and duration:
        pace = duration / (distance / 1000.0)

    return {
        "id": f"intervals:{a['id']}",
        "source": "intervals",
        "date": a.get("start_date"),
        "sport": sport,
        "name": a.get("name"),
        "distance_m": distance,
        "duration_s": duration,
        "elapsed_s": a.get("elapsed_time"),
        "elevation_m": a.get("total_elevation_gain"),
        # The whole point of workstream C: real training load.
        "load": a.get("icu_training_load"),
        "avg_hr": a.get("average_heartrate"),
        "max_hr": a.get("max_heartrate"),
        "avg_power": a.get("icu_average_watts"),
        "avg_pace_s_per_km": pace,
        "intervals": json.dumps(structure) if structure else None,
        "raw": json.dumps(a),
    }


def upsert_activities(conn, rows: list[dict]) -> None:
    values, params = [], {}
    for n, rec in enumerate(rows):
        ph = []
        for f in ACT_FIELDS:
            k = f"{f}_{n}"
            params[k] = rec[f]
            cast = "::jsonb" if f in ("intervals", "raw") else ""
            ph.append(f":{k}{cast}")
        values.append("(" + ", ".join(ph) + ")")

    conn.run(f"""
        insert into public.activities ({", ".join(ACT_FIELDS)})
        values {", ".join(values)}
        on conflict (id) do update set
            date              = excluded.date,
            sport             = excluded.sport,
            name              = excluded.name,
            distance_m        = excluded.distance_m,
            duration_s        = excluded.duration_s,
            elapsed_s         = excluded.elapsed_s,
            elevation_m       = excluded.elevation_m,
            load              = excluded.load,
            avg_hr            = excluded.avg_hr,
            max_hr            = excluded.max_hr,
            avg_power         = excluded.avg_power,
            avg_pace_s_per_km = excluded.avg_pace_s_per_km,
            intervals         = coalesce(excluded.intervals, public.activities.intervals),
            raw               = excluded.raw
        where public.activities.source = 'intervals'
    """, **params)


# ───────────────────────────── wellness ─────────────────────────────

WELL_FIELDS = [
    "date", "ctl", "atl", "form", "resting_hr", "hrv", "sleep_hours",
    "sleep_stages", "readiness", "body_battery", "weight_kg", "source",
]


def map_wellness(w: dict) -> dict:
    ctl, atl = w.get("ctl"), w.get("atl")
    # form/TSB is not returned by the API on any row. It is ctl-atl by
    # definition (BUILD_BRIEF §4). CTL and ATL themselves are pulled verbatim.
    form = (ctl - atl) if (ctl is not None and atl is not None) else None

    sleep_secs = w.get("sleepSecs")
    return {
        "date": w["id"],  # the wellness row's id IS the date, e.g. '2026-09-06'
        "ctl": ctl,
        "atl": atl,
        "form": form,
        "resting_hr": w.get("restingHR"),
        "hrv": w.get("hrv"),
        "sleep_hours": (sleep_secs / 3600.0) if sleep_secs else None,
        # Not returned by this account's payload; nullable by design (§4).
        "sleep_stages": None,
        "readiness": w.get("readiness"),
        "body_battery": w.get("bodyBattery"),
        "weight_kg": w.get("weight"),
        "source": "intervals",
    }


def upsert_wellness(conn, rows: list[dict]) -> None:
    values, params = [], {}
    for n, rec in enumerate(rows):
        ph = []
        for f in WELL_FIELDS:
            k = f"{f}_{n}"
            params[k] = rec[f]
            cast = "::jsonb" if f == "sleep_stages" else ""
            ph.append(f":{k}{cast}")
        values.append("(" + ", ".join(ph) + ")")

    conn.run(f"""
        insert into public.wellness ({", ".join(WELL_FIELDS)})
        values {", ".join(values)}
        on conflict (date) do update set
            ctl          = excluded.ctl,
            atl          = excluded.atl,
            form         = excluded.form,
            resting_hr   = excluded.resting_hr,
            hrv          = excluded.hrv,
            sleep_hours  = excluded.sleep_hours,
            sleep_stages = coalesce(excluded.sleep_stages, public.wellness.sleep_stages),
            readiness    = coalesce(excluded.readiness, public.wellness.readiness),
            body_battery = coalesce(excluded.body_battery, public.wellness.body_battery),
            weight_kg    = coalesce(excluded.weight_kg, public.wellness.weight_kg),
            source       = excluded.source
    """, **params)


# ───────────────────────────── dedup (§5c) ─────────────────────────────
#
# Same calendar day (athlete's timezone) + same sport + distance within ~2%
# => same activity. Prefer the intervals.icu record; delete the Strava row.
#
# Distance branches deliberately:
#   both > 0     -> require within 2%
#   both 0/NULL  -> match on day+sport alone (correct for gym)
#   one 0, one >0-> NOT a match (stops a 0.8m junk row pairing with a real ride)

DEDUP_MATCH = f"""
    s.source = 'strava'
    and i.source = 'intervals'
    and (i.date at time zone '{ATHLETE_TZ}')::date
      = (s.date at time zone '{ATHLETE_TZ}')::date
    and i.sport = s.sport
    and (
        (coalesce(s.distance_m, 0) > 0 and coalesce(i.distance_m, 0) > 0
         and abs(i.distance_m - s.distance_m)
             <= 0.02 * greatest(i.distance_m, s.distance_m))
        or
        (coalesce(s.distance_m, 0) = 0 and coalesce(i.distance_m, 0) = 0)
    )
"""


def dedup_candidates(conn) -> list[tuple]:
    return conn.run(f"""
        select s.id, (s.date at time zone '{ATHLETE_TZ}')::date::text, s.sport,
               s.distance_m, s.duration_s,
               i.id, i.distance_m, i.duration_s, i.load
        from public.activities s
        join public.activities i on {DEDUP_MATCH}
        order by s.date
    """)


def run_dedup(conn, max_deletions: int, apply: bool) -> int:
    cands = dedup_candidates(conn)
    print(f"\ndedup: {len(cands)} strava row(s) matched by an intervals row")
    for sid, day, sport, sdist, sdur, iid, idist, idur, iload in cands:
        pct = ""
        if sdist and idist and float(sdist) > 0:
            pct = f"  Δ{abs(float(idist) - float(sdist)) / max(float(idist), float(sdist)) * 100:.2f}%"
        print(f"  {day} {sport:<5} DELETE {sid:<22} ({sdist}m/{sdur}s)")
        print(f"    {'':>27}KEEP   {iid:<22} ({idist}m/{idur}s load={iload}){pct}")

    if not cands:
        return 0
    if len(cands) > max_deletions:
        raise RuntimeError(
            f"dedup would delete {len(cands)} rows, over the safety limit of "
            f"{max_deletions}. Refusing — the match rule is probably wrong. "
            f"Re-run with --max-deletions to override deliberately."
        )
    if not apply:
        print("  (dry-run: nothing deleted)")
        return 0

    # Delete by explicit id list rather than re-running the match predicate, so
    # exactly the rows printed above are the rows removed.
    ids = [c[0] for c in cands]
    params = {f"id_{n}": v for n, v in enumerate(ids)}
    placeholders = ", ".join(f":id_{n}" for n in range(len(ids)))
    conn.run(f"delete from public.activities where id in ({placeholders})", **params)
    print(f"  deleted {len(ids)} strava row(s)")
    return len(ids)


# ───────────────────────────── main ─────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description="intervals.icu -> Supabase sync")
    ap.add_argument("--days", type=int, default=30,
                    help="Sync the last N days (default 30; the Action's mode).")
    ap.add_argument("--oldest", type=str, help="ISO date, overrides --days")
    ap.add_argument("--newest", type=str, help="ISO date, defaults to today")
    ap.add_argument("--backfill", action="store_true",
                    help="Fetch everything from 2010 onward.")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-intervals", action="store_true",
                    help="Skip per-activity interval structure (1 request each).")
    ap.add_argument("--no-dedup", action="store_true")
    ap.add_argument("--max-deletions", type=int, default=MAX_DELETIONS)
    args = ap.parse_args()

    newest = dt.date.fromisoformat(args.newest) if args.newest else dt.date.today()
    if args.backfill:
        oldest = dt.date(2010, 1, 1)
    elif args.oldest:
        oldest = dt.date.fromisoformat(args.oldest)
    else:
        oldest = newest - dt.timedelta(days=args.days)

    window = {"oldest": oldest.isoformat(), "newest": newest.isoformat()}
    print(f"window: {oldest} -> {newest}")

    acts = api_get("/athlete/{athlete}/activities", window)
    well = api_get("/athlete/{athlete}/wellness", window)
    print(f"fetched {len(acts)} activities, {len(well)} wellness rows")

    structures: dict[str, list] = {}
    if not args.no_intervals:
        for a in acts:
            if SPORT_MAP.get(a.get("type")) == "gym":
                continue  # no interval structure worth storing for weights
            try:
                d = api_get(f"/activity/{a['id']}/intervals")
                if isinstance(d, dict) and d.get("icu_intervals"):
                    structures[a["id"]] = d["icu_intervals"]
            except Exception as exc:  # noqa: BLE001
                print(f"  warn: intervals for {a['id']}: {exc}")
        print(f"fetched interval structure for {len(structures)} activities")

    act_rows = [map_activity(a, structures.get(a["id"])) for a in acts]
    well_rows = [map_wellness(w) for w in well]

    unmapped = {a.get("type") for a in acts if a.get("type") not in SPORT_MAP}
    if unmapped:
        print(f"  NOTE: unmapped activity types -> 'other': {unmapped}")

    with_load = sum(1 for r in act_rows if r["load"] is not None)
    with_ctl = sum(1 for r in well_rows if r["ctl"] is not None)
    with_form = sum(1 for r in well_rows if r["form"] is not None)
    print(f"activities carrying load: {with_load}/{len(act_rows)}")
    print(f"wellness carrying ctl: {with_ctl}/{len(well_rows)}  form: {with_form}")
    print(f"readiness non-null: {sum(1 for r in well_rows if r['readiness'] is not None)}"
          f"  body_battery non-null: {sum(1 for r in well_rows if r['body_battery'] is not None)}"
          f"  (nullable by design)")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        if act_rows:
            s = act_rows[0]
            print("sample activity:", {k: s[k] for k in
                  ("id", "date", "sport", "distance_m", "duration_s", "load")})
        if well_rows:
            s = well_rows[-1]
            print("sample wellness:", {k: s[k] for k in
                  ("date", "ctl", "atl", "form", "resting_hr", "hrv", "sleep_hours")})
        return 0

    print(f"\nwriting to {describe_target()} ...")
    conn = connect()
    try:
        conn.run("begin")
        for start in range(0, len(act_rows), BATCH):
            upsert_activities(conn, act_rows[start:start + BATCH])
        for start in range(0, len(well_rows), BATCH):
            upsert_wellness(conn, well_rows[start:start + BATCH])
        print(f"upserted {len(act_rows)} activities, {len(well_rows)} wellness rows")

        if not args.no_dedup:
            run_dedup(conn, args.max_deletions, apply=True)

        conn.run("commit")
        print("committed")
    except Exception:
        conn.run("rollback")
        print("ROLLED BACK — nothing written", file=sys.stderr)
        raise
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
