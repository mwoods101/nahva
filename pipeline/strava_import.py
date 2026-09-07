#!/usr/bin/env python3
"""Workstream B — one-time Strava CSV import into `activities`.

Seeds historical volume from the Strava bulk export. Run ONCE, locally.
This is deliberately not part of the GitHub Action (BUILD_BRIEF.md §6).

    pipeline/.venv/bin/python pipeline/strava_import.py --dry-run
    pipeline/.venv/bin/python pipeline/strava_import.py

THE DUPLICATE-COLUMN TRAP (BUILD_BRIEF.md §5a)
----------------------------------------------
The export repeats several headers with different units. `csv.DictReader`
would silently keep the LAST occurrence for some and the first for others,
so this module parses strictly BY COLUMN INDEX and asserts the header names
at those indices before importing anything.

    [ 6] Distance        7.63     <- kilometres  (WRONG for distance_m)
    [17] Distance        7636.6   <- metres      (correct)
    [ 5] Elapsed Time    2520     <- rounded
    [15] Elapsed Time    2520.0   <- raw         (correct)
    [ 7] Max Heart Rate  167.0    <- rounded
    [30] Max Heart Rate  167.0    <- raw         (correct)
    [16] Moving Time     2520.0   <- single clean column, seconds
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import connect, describe_target  # noqa: E402

CSV_PATH = Path(__file__).resolve().parent / "data" / "activities.csv"

# ── Column indices. Order matters more than names; see the trap note above. ──
COL = {
    "activity_id": 0,
    "date": 1,
    "name": 2,
    "type": 3,
    "elapsed_s": 15,   # raw occurrence, NOT 5
    "moving_s": 16,
    "distance_m": 17,  # METRES, NOT the km column at 6
    "elevation_m": 20,
    "max_hr": 30,      # raw occurrence, NOT 7
    "avg_hr": 31,
    "avg_power": 33,
    "training_load": 88,
}

# Guard: if Strava changes the export layout, fail loudly rather than
# silently importing kilometres into a metres column.
EXPECTED_HEADERS = {
    0: "Activity ID",
    1: "Activity Date",
    2: "Activity Name",
    3: "Activity Type",
    15: "Elapsed Time",
    16: "Moving Time",
    17: "Distance",
    20: "Elevation Gain",
    30: "Max Heart Rate",
    31: "Average Heart Rate",
    33: "Average Watts",
    88: "Training Load",
}

SPORT_MAP = {
    "Ride": "ride",
    "Virtual Ride": "ride",
    "E-Bike Ride": "ride",
    "Run": "run",
    "Virtual Run": "run",
    "Weight Training": "gym",
    "Walk": "other",
    "Hike": "other",
}

DATE_FORMATS = (
    "%b %d, %Y, %I:%M:%S %p",
    "%b %d, %Y, %H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
)

BATCH = 500


class HeaderMismatch(RuntimeError):
    """The export's column layout is not what this script was written against."""


def verify_header(header: list[str]) -> None:
    problems = [
        f"index {i}: expected {name!r}, found {header[i]!r}"
        for i, name in EXPECTED_HEADERS.items()
        if i >= len(header) or header[i] != name
    ]
    if problems:
        raise HeaderMismatch(
            "Strava export layout changed — refusing to import.\n  "
            + "\n  ".join(problems)
        )
    # The km/metres pair is the whole reason this script is index-based.
    if header[6] != "Distance" or header[17] != "Distance":
        raise HeaderMismatch(
            f"Expected duplicate 'Distance' at 6 (km) and 17 (metres); "
            f"found {header[6]!r} and {header[17]!r}"
        )


def num(value: str) -> float | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def integer(value: str) -> int | None:
    f = num(value)
    return None if f is None else int(round(f))


def parse_date(value: str) -> dt.datetime:
    raw = (value or "").strip()
    for fmt in DATE_FORMATS:
        try:
            # Strava bulk exports are UTC.
            return dt.datetime.strptime(raw, fmt).replace(tzinfo=dt.timezone.utc)
        except ValueError:
            continue
    raise ValueError(f"unparseable Activity Date: {raw!r}")


def map_row(row: list[str]) -> dict:
    sport = SPORT_MAP.get(row[COL["type"]].strip(), "other")
    distance_m = num(row[COL["distance_m"]])
    duration_s = integer(row[COL["moving_s"]])

    # Derived: pace only makes sense on foot. Left NULL for ride/gym/other.
    avg_pace = None
    if sport == "run" and distance_m and distance_m > 0 and duration_s:
        avg_pace = duration_s / (distance_m / 1000.0)

    return {
        "id": f"strava:{row[COL['activity_id']].strip()}",
        "source": "strava",
        "date": parse_date(row[COL["date"]]),
        "sport": sport,
        "name": (row[COL["name"]] or "").strip() or None,
        "distance_m": distance_m,
        "duration_s": duration_s,
        "elapsed_s": integer(row[COL["elapsed_s"]]),
        "elevation_m": num(row[COL["elevation_m"]]),
        # load stays NULL for Strava rows — intervals.icu owns it.
        "load": None,
        "strava_load": num(row[COL["training_load"]]),
        "avg_hr": integer(row[COL["avg_hr"]]),
        "max_hr": integer(row[COL["max_hr"]]),
        "avg_power": num(row[COL["avg_power"]]),
        "avg_pace_s_per_km": avg_pace,
        "intervals": None,
        # Keep the source values behind the trap, so a future mismatch is provable.
        "raw": json.dumps(
            {
                "activity_type": row[COL["type"]].strip(),
                "distance_km_col6": row[6],
                "distance_m_col17": row[COL["distance_m"]],
                "elapsed_col5": row[5],
                "elapsed_col15": row[COL["elapsed_s"]],
                "max_hr_col7": row[7],
                "max_hr_col30": row[COL["max_hr"]],
            }
        ),
    }


FIELDS = [
    "id", "source", "date", "sport", "name", "distance_m", "duration_s",
    "elapsed_s", "elevation_m", "load", "strava_load", "avg_hr", "max_hr",
    "avg_power", "avg_pace_s_per_km", "intervals", "raw",
]


def upsert(conn, batch: list[dict]) -> None:
    """Multi-row INSERT ... ON CONFLICT DO UPDATE.

    Only overwrites Strava-owned columns, and only for rows still marked
    source='strava'. A row that the intervals.icu sync has claimed (C, which
    wins per §5c) is left untouched.
    """
    values, params = [], {}
    for n, rec in enumerate(batch):
        placeholders = []
        for field in FIELDS:
            key = f"{field}_{n}"
            params[key] = rec[field]
            cast = "::jsonb" if field in ("intervals", "raw") else ""
            placeholders.append(f":{key}{cast}")
        values.append("(" + ", ".join(placeholders) + ")")

    sql = f"""
        insert into public.activities ({", ".join(FIELDS)})
        values {", ".join(values)}
        on conflict (id) do update set
            source            = excluded.source,
            date              = excluded.date,
            sport             = excluded.sport,
            name              = excluded.name,
            distance_m        = excluded.distance_m,
            duration_s        = excluded.duration_s,
            elapsed_s         = excluded.elapsed_s,
            elevation_m       = excluded.elevation_m,
            strava_load       = excluded.strava_load,
            avg_hr            = excluded.avg_hr,
            max_hr            = excluded.max_hr,
            avg_power         = excluded.avg_power,
            avg_pace_s_per_km = excluded.avg_pace_s_per_km,
            raw               = excluded.raw
        where public.activities.source = 'strava'
    """
    conn.run(sql, **params)


def main() -> int:
    ap = argparse.ArgumentParser(description="One-time Strava CSV import.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Parse and summarise without writing to the database.")
    ap.add_argument("--limit", type=int, default=None,
                    help="Only process the first N rows (testing).")
    ap.add_argument("--csv", type=Path, default=CSV_PATH)
    args = ap.parse_args()

    if not args.csv.exists():
        print(f"ERROR: {args.csv} not found.", file=sys.stderr)
        return 1

    with args.csv.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        verify_header(header)
        print(f"header OK — {len(header)} columns, index mapping verified")

        records, sports, skipped = [], Counter(), []
        for lineno, row in enumerate(reader, start=2):
            if args.limit and len(records) >= args.limit:
                break
            if len(row) < len(EXPECTED_HEADERS):
                skipped.append((lineno, "short row"))
                continue
            try:
                rec = map_row(row)
            except Exception as exc:  # noqa: BLE001 - report and continue
                skipped.append((lineno, str(exc)))
                continue
            records.append(rec)
            sports[rec["sport"]] += 1

    print(f"parsed {len(records)} rows; skipped {len(skipped)}")
    for reason in skipped[:10]:
        print(f"  skipped line {reason[0]}: {reason[1]}")
    print("sport distribution:", dict(sports))

    dates = [r["date"] for r in records]
    if dates:
        print(f"date range: {min(dates).date()} -> {max(dates).date()}")
    with_load = sum(1 for r in records if r["strava_load"] is not None)
    print(f"strava_load present on {with_load}/{len(records)} rows")
    assert all(r["load"] is None for r in records), "load must be NULL for Strava rows"

    if args.dry_run:
        print("\n--dry-run: nothing written")
        sample = records[0]
        print("sample row:")
        for k in ("id", "date", "sport", "distance_m", "duration_s", "strava_load"):
            print(f"  {k:12} = {sample[k]!r}")
        return 0

    print(f"\nwriting to {describe_target()} ...")
    conn = connect()
    try:
        written = 0
        for start in range(0, len(records), BATCH):
            chunk = records[start:start + BATCH]
            upsert(conn, chunk)
            written += len(chunk)
            print(f"  upserted {written}/{len(records)}", end="\r", flush=True)
        print()
        total = conn.run("select count(*) from activities where source='strava'")[0][0]
        print(f"done — {written} rows sent, {total} strava rows now in activities")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
