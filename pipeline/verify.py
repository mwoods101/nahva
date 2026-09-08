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


# ──────────────── Gate JOIN — front-end reads live data ────────────────
def gate_join(c) -> None:
    """Reconciles a weekly volume total against a manual sum from the CSV.

    The manual sum is computed here from raw column positions, with no pipeline
    code involved, so this is an independent check rather than a restatement of
    the import.
    """
    import csv
    import datetime as dt

    csv_path = Path(__file__).resolve().parent / "data" / "activities.csv"
    if not csv_path.exists():
        check("JOIN", "weekly volume reconciles against the CSV", False,
              f"{csv_path} not present (gitignored) — run this locally")
        return

    week_start, week_end = dt.date(2026, 7, 20), dt.date(2026, 7, 26)
    COL_DATE, COL_MOVING, COL_DIST_M = 1, 16, 17

    n = 0
    seconds = 0.0
    metres = 0.0
    with csv_path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.reader(fh)
        next(reader)
        for row in reader:
            day = dt.datetime.strptime(row[COL_DATE], "%b %d, %Y, %I:%M:%S %p").date()
            if week_start <= day <= week_end:
                n += 1
                seconds += float(row[COL_MOVING] or 0)
                metres += float(row[COL_DIST_M] or 0)

    db = c.run("""select count(*), sum(duration_s), sum(distance_m)
                  from public.activities
                  where (date at time zone 'Europe/London')::date between :a and :b""",
               a=week_start.isoformat(), b=week_end.isoformat())[0]

    check("JOIN", "week activity count reconciles", n == db[0], f"csv={n} db={db[0]}")
    check("JOIN", "week moving time reconciles", abs(seconds - float(db[1])) < 0.5,
          f"csv={seconds:.0f}s db={db[1]}s")
    check("JOIN", "week distance reconciles", abs(metres - float(db[2])) < 0.5,
          f"csv={metres:.1f}m db={float(db[2]):.1f}m")

    # The front-end reads with the publishable key, so anon must be able to
    # SELECT and must not be able to write.
    policies = c.run("""select tablename, cmd, roles::text from pg_policies
                        where schemaname='public' order by tablename""")
    reads = [p for p in policies if p[1] == "SELECT" and "anon" in p[2]]
    writes = [p for p in policies if p[1] != "SELECT"]
    check("JOIN", "anon can SELECT both tables", len(reads) == 2, str(reads))
    check("JOIN", "no write policy exists for anon", not writes, str(writes))


# ──────────────── Gate COACH — read-only role ────────────────
def gate_coach(_c) -> None:
    """Connects AS nahva_coach and proves it can read but not write.

    Deliberately opens its own connection rather than reusing the admin one —
    checking grants from a superuser session proves nothing about what the role
    can actually do.
    """
    import os
    import ssl
    from urllib.parse import unquote, urlparse

    import pg8000.native

    from db import ssl_context  # noqa: PLC0415

    password = os.environ.get("COACH_DB_PASSWORD", "").strip()
    if not password:
        check("COACH", "read-only role can SELECT", False,
              "COACH_DB_PASSWORD not set — run pipeline/setup_coach_role.py first")
        return

    admin = urlparse(os.environ["SUPABASE_DB_URL"])
    # Pooler usernames are <role>.<project-ref>; reuse the ref from the admin URL.
    ref = (unquote(admin.username or "").split(".", 1) + [""])[1]
    coach_user = f"nahva_coach.{ref}" if ref else "nahva_coach"

    try:
        conn = pg8000.native.Connection(
            user=coach_user,
            password=password,
            host=admin.hostname or "",
            port=admin.port or 5432,
            database=(admin.path or "/postgres").lstrip("/") or "postgres",
            ssl_context=ssl_context(),
            timeout=30,
        )
    except Exception as exc:  # noqa: BLE001
        check("COACH", "read-only role can connect", False,
              f"{type(exc).__name__}: {str(exc)[:120]}")
        return

    try:
        who = conn.run("select current_user")[0][0]
        check("COACH", "connects as the coaching role", "nahva_coach" in str(who), str(who))

        for table in ("activities", "wellness"):
            try:
                n = conn.run(f"select count(*) from public.{table}")[0][0]
                check("COACH", f"can SELECT {table}", n is not None and n > 0, f"{n} rows")
            except Exception as exc:  # noqa: BLE001
                check("COACH", f"can SELECT {table}", False, f"{type(exc).__name__}")

        # Every write must be refused. A pass here means the attempt FAILED.
        writes = [
            ("INSERT", "insert into public.activities (id, source, date, sport) "
                       "values ('coachprobe:1','strava','2020-01-01T00:00:00Z','run')"),
            ("UPDATE", "update public.activities set name = 'probe' where true"),
            ("DELETE", "delete from public.activities where true"),
            ("INSERT wellness", "insert into public.wellness (date) values ('2020-01-01')"),
            ("DDL", "create table public.coach_probe (x int)"),
        ]
        for label, sql in writes:
            try:
                conn.run("begin")
                conn.run(sql)
                conn.run("rollback")
                check("COACH", f"{label} is refused", False, "IT SUCCEEDED — role can write")
            except Exception as exc:  # noqa: BLE001
                try:
                    conn.run("rollback")
                except Exception:  # noqa: BLE001, S110
                    pass
                msg = str(exc)
                denied = "permission denied" in msg or "row-level security" in msg
                check("COACH", f"{label} is refused", denied, msg.split("\n")[0][:80])
    finally:
        conn.close()


GATES = {"A": gate_a, "B": gate_b, "C": gate_c, "JOIN": gate_join, "COACH": gate_coach}


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
