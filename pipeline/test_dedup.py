#!/usr/bin/env python3
"""Proves the §5c dedup rule against synthetic rows, then ROLLS BACK.

The real data has no source overlap (Strava's seed ends 2026-08-04, the first
intervals.icu run is 2026-08-05), so a live run deletes 0 rows and therefore
demonstrates nothing. This injects deliberate near-duplicates and near-misses
inside a transaction, asserts which ones the rule matches, and rolls back so the
database is untouched.

    pipeline/.venv/bin/python pipeline/test_dedup.py
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import connect  # noqa: E402
from intervals_sync import ATHLETE_TZ, dedup_candidates  # noqa: E402

# (label, strava distance, intervals distance, same day?, same sport?, should match)
CASES = [
    ("exact same distance",           7000.0, 7000.0, True,  True,  True),
    ("within 2% (1.4% apart)",        7000.0, 7100.0, True,  True,  True),
    ("just inside 2% (1.98%)",        7000.0, 7141.0, True,  True,  True),
    ("outside 2% (4.3% apart)",       7000.0, 7300.0, True,  True,  False),
    ("both zero distance (gym)",         0.0,    None, True,  True,  True),
    ("strava 0 vs intervals real",        0.0, 7000.0, True,  True,  False),
    ("strava junk 0.8m vs real ride",     0.8, 7000.0, True,  True,  False),
    ("same distance, different sport", 7000.0, 7000.0, True,  False, False),
    ("same distance, different day",   7000.0, 7000.0, False, True,  False),
]

# Each case gets its own well-separated day. Without this, every case's rows
# would be join candidates for every other case's rows and the results would be
# meaningless — the first version of this test failed exactly that way.
BASE_DAY = dt.date(2024, 3, 1)


def case_days(n: int, same_day: bool) -> tuple[str, str]:
    strava_day = BASE_DAY + dt.timedelta(days=n * 10)
    intervals_day = strava_day if same_day else strava_day + dt.timedelta(days=1)
    return strava_day.isoformat(), intervals_day.isoformat()


def main() -> int:
    conn = connect()
    failures = []
    try:
        conn.run("begin")

        for n, (label, sdist, idist, same_day, same_sport, _expect) in enumerate(CASES):
            sid, iid = f"strava:test{n}", f"intervals:test{n}"
            sday, iday = case_days(n, same_day)
            isport = "run" if same_sport else "ride"
            # 07:00 local for the strava row, 18:00 local for the intervals row —
            # different times of day, deliberately, to show the rule keys on the
            # calendar day and not the timestamp.
            conn.run(
                "insert into activities (id, source, date, sport, distance_m, duration_s)"
                " values (:id, 'strava', :ts, 'run', :d, 1800)",
                id=sid, ts=f"{sday}T07:00:00+01", d=sdist)
            conn.run(
                "insert into activities (id, source, date, sport, distance_m, duration_s, load)"
                " values (:id, 'intervals', :ts, :sp, :d, 1800, 42)",
                id=iid, ts=f"{iday}T18:00:00+01", sp=isport, d=idist)

        matched = {row[0] for row in dedup_candidates(conn)}

        print(f"dedup rule evaluated in {ATHLETE_TZ}\n")
        print(f"  {'case':<34} {'strava':>9} {'intervals':>10} {'expect':>7} {'got':>6}  result")
        print("  " + "-" * 82)
        for n, (label, sdist, idist, _sd, _ss, expect) in enumerate(CASES):
            got = f"strava:test{n}" in matched
            ok = got == expect
            if not ok:
                failures.append(label)
            print(f"  {label:<34} {str(sdist):>9} {str(idist):>10} "
                  f"{'MATCH' if expect else 'keep':>7} {'MATCH' if got else 'keep':>6}"
                  f"  {'ok' if ok else 'FAIL'}")
    finally:
        conn.run("rollback")
        conn.close()

    print(f"\nrolled back — no test rows persisted")
    if failures:
        print(f"{len(failures)} case(s) FAILED: {failures}")
        return 1
    print(f"all {len(CASES)} dedup cases behaved as specified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
