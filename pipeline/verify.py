#!/usr/bin/env python3
"""Gate verification for Nahva. Prints evidence for CLAUDE.md § Definition of done.

    pipeline/.venv/bin/python pipeline/verify.py          # all available gates
    pipeline/.venv/bin/python pipeline/verify.py A B      # specific gates

Exit code is non-zero if any checked gate fails, so this is CI-usable.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import connect, describe_target  # noqa: E402
from intervals_sync import DEDUP_MATCH  # noqa: E402  — single source of truth

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str, str]] = []  # gate, check, status, evidence


def check(gate: str, name: str, ok: bool, evidence: str) -> None:
    results.append((gate, name, PASS if ok else FAIL, evidence))


# ─────────────────────────── Gate A — schema ───────────────────────────
ACTIVITIES_COLS = {
    "id", "source", "date", "sport", "name", "distance_m", "duration_s",
    "elapsed_s", "elevation_m", "load", "strava_load", "avg_hr", "max_hr",
    "avg_power", "avg_pace_s_per_km", "intervals", "raw", "created_at",
    "updated_at",
}
WELLNESS_COLS = {
    "date", "ctl", "atl", "form", "resting_hr", "hrv", "sleep_hours",
    "sleep_stages", "readiness", "body_battery", "weight_kg", "source",
}


def gate_a(c) -> None:
    for table, expected in (("activities", ACTIVITIES_COLS), ("wellness", WELLNESS_COLS)):
        found = {
            r[0] for r in c.run(
                "select column_name from information_schema.columns "
                "where table_schema='public' and table_name=:t", t=table)
        }
        missing = expected - found
        check("A", f"{table} exists with specced columns", not missing,
              f"{len(found)} columns; missing={sorted(missing) or 'none'}")

    rls = dict(c.run("select relname, relrowsecurity from pg_class "
                     "where relname in ('activities','wellness')"))
    check("A", "RLS enabled on both tables", all(rls.values()), str(rls))


# ──────────────────── Gate B — Strava import ────────────────────
def gate_b(c) -> None:
    total = c.run("select count(*) from activities where source='strava'")[0][0]
    check("B", "row count ~= 4690", abs(total - 4690) <= 10, f"{total} rows")

    # The trap: metres, not kilometres. A 7.6 km run must be 7636.6, not 7.63.
    row = c.run("select distance_m, duration_s, sport from activities "
                "where id='strava:19592925058'")
    if row:
        dist, dur, sport = row[0]
        check("B", "distance stored in METRES (spot-check)",
              dist is not None and 7000 < float(dist) < 8000,
              f"strava:19592925058 distance_m={dist} sport={sport} duration_s={dur}")
    else:
        check("B", "distance stored in METRES (spot-check)", False, "sample row absent")

    # Aggregate sanity: if km had been imported, means would be ~1000x too small.
    stats = c.run("""select round(avg(distance_m)) , round(max(distance_m)),
                            round(avg(distance_m) filter (where sport='run'))
                     from activities where source='strava' and distance_m > 0""")[0]
    avg_all, max_all, avg_run = stats
    check("B", "distances are metre-scale, not km-scale",
          avg_all is not None and float(avg_all) > 1000,
          f"avg={avg_all}m max={max_all}m avg_run={avg_run}m")

    sports = dict(c.run("select sport, count(*) from activities "
                        "where source='strava' group by sport order by sport"))
    expected_sports = {"ride": 3604, "run": 797, "gym": 240, "other": 49}
    check("B", "sports mapped per brief", sports == expected_sports,
          f"{sports} (expected {expected_sports})")

    unknown = c.run("select count(*) from activities where source='strava' "
                    "and sport not in ('run','ride','gym','other')")[0][0]
    check("B", "no unmapped sport values", unknown == 0, f"{unknown} unmapped")

    # Strava's Training Load must never land in `load`.
    leaked = c.run("select count(*) from activities "
                   "where source='strava' and load is not null")[0][0]
    check("B", "load is NULL for every Strava row", leaked == 0,
          f"{leaked} strava rows with non-null load")

    sl = c.run("select count(*) from activities "
               "where source='strava' and strava_load is not null")[0][0]
    check("B", "strava_load populated where present", sl > 0,
          f"{sl} rows carry strava_load")

    lo, hi = c.run("select min(date)::date, max(date)::date from activities "
                   "where source='strava'")[0]
    check("B", "full history retained", lo is not None, f"{lo} -> {hi}")


# ──────────────────── Gate C — intervals.icu sync ────────────────────
def gate_c(c) -> None:
    acts = c.run("select count(*) from activities where source='intervals'")[0][0]
    well = c.run("select count(*) from wellness")[0][0]
    check("C", "intervals activities present", acts > 0, f"{acts} rows")
    check("C", "wellness rows present", well > 0, f"{well} rows")

    if well:
        ctl = c.run("select count(*) from wellness where ctl is not null")[0][0]
        check("C", "CTL/ATL pulled from intervals.icu", ctl > 0,
              f"{ctl}/{well} wellness rows carry ctl")

    # Dedup: no strava row left that an intervals row supersedes. Uses the exact
    # predicate the deletion uses (imported, not re-typed) so this gate actually
    # constrains intervals_sync.py rather than approximating it.
    dupes = c.run(f"""
        select count(*)
        from public.activities s
        join public.activities i on {DEDUP_MATCH}
    """)[0][0]
    check("C", "dedup — no strava/intervals double-count", dupes == 0,
          f"{dupes} overlapping strava rows remain")

    # Guard against the inverse failure: dedup deleting far too much.
    strava = c.run("select count(*) from activities where source='strava'")[0][0]
    check("C", "strava seed not over-pruned by dedup", strava >= 4680,
          f"{strava} strava rows remain of 4690 imported")


GATES = {"A": gate_a, "B": gate_b, "C": gate_c}


def main() -> int:
    wanted = [g.upper() for g in sys.argv[1:]] or list(GATES)
    unknown = [g for g in wanted if g not in GATES]
    if unknown:
        print(f"unknown gate(s): {unknown}. Available: {list(GATES)}", file=sys.stderr)
        return 2

    print(f"verifying against {describe_target()}\n")
    c = connect()
    try:
        for gate in wanted:
            GATES[gate](c)
    finally:
        c.close()

    width = max(len(name) for _, name, _, _ in results)
    current = None
    for gate, name, status, evidence in results:
        if gate != current:
            print(f"\n── Gate {gate} " + "─" * 40)
            current = gate
        print(f"  [{status}] {name:<{width}}  {evidence}")

    failed = [r for r in results if r[2] == FAIL]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    if failed:
        print("FAILED: " + "; ".join(f"{g}/{n}" for g, n, _, _ in failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
