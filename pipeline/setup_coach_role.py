#!/usr/bin/env python3
"""Workstream COACH — create the read-only Postgres role for the Claude connector.

    pipeline/.venv/bin/python pipeline/setup_coach_role.py --dry-run
    pipeline/.venv/bin/python pipeline/setup_coach_role.py
    pipeline/.venv/bin/python pipeline/setup_coach_role.py --verify-only

WHY THIS IS A SCRIPT AND NOT A MIGRATION
Roles carry a password. A committed migration containing one would put a live
credential in git forever, so the password is read from COACH_DB_PASSWORD in
.env (gitignored) and only the grants are expressed here.

THE PASSWORD IS YOURS TO GENERATE. CLAUDE.md § Human-only puts "generating or
entering any key/secret" outside what an agent does, so this script refuses to
invent one. Put it in .env yourself:

    COACH_DB_PASSWORD=<a long random string>

Idempotent: safe to re-run. Re-running rotates the password to whatever .env
currently holds.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import ConfigError, connect, describe_target, env  # noqa: E402

ROLE = "nahva_coach"
TABLES = ("activities", "wellness")


def apply_role(conn, password: str) -> None:
    """Create or update the role, then grant SELECT and nothing else."""
    exists = conn.run(
        "select 1 from pg_roles where rolname = :r", r=ROLE
    )

    # pg8000 cannot parameterise DDL identifiers or passwords, and CREATE ROLE
    # does not accept placeholders. The password is quoted with a dollar-quote
    # tag that cannot appear inside it, and rejected below if it could.
    if "$coachpw$" in password:
        raise ConfigError("COACH_DB_PASSWORD may not contain the string $coachpw$")

    if exists:
        print(f"  role {ROLE} exists — updating password")
        conn.run(f"alter role {ROLE} with login password $coachpw${password}$coachpw$")
    else:
        print(f"  creating role {ROLE}")
        conn.run(f"create role {ROLE} with login password $coachpw${password}$coachpw$")

    # Start from nothing, so a re-run can only narrow, never silently widen.
    conn.run(f"alter role {ROLE} with nosuperuser nocreatedb nocreaterole noinherit nobypassrls")
    conn.run(f"revoke all on all tables in schema public from {ROLE}")
    conn.run(f"revoke all on all sequences in schema public from {ROLE}")
    conn.run(f"revoke all on all functions in schema public from {ROLE}")
    conn.run(f"revoke all on schema public from {ROLE}")

    # Exactly what the coaching connection needs: read two tables.
    conn.run(f"grant connect on database postgres to {ROLE}")
    conn.run(f"grant usage on schema public to {ROLE}")
    for table in TABLES:
        conn.run(f"grant select on public.{table} to {ROLE}")

    # RLS is on. A non-superuser role without a policy reads nothing, so the
    # role needs its own SELECT policy — and only SELECT.
    for table in TABLES:
        conn.run(f"drop policy if exists {ROLE}_read on public.{table}")
        conn.run(
            f"create policy {ROLE}_read on public.{table} "
            f"for select to {ROLE} using (true)"
        )

    # Future tables must not be readable by default; this role is deliberately
    # scoped to the two tables above and must be re-granted on purpose.
    conn.run(
        f"alter default privileges in schema public revoke all on tables from {ROLE}"
    )
    print(f"  granted: connect, usage on public, select on {', '.join(TABLES)}")


def report_privileges(conn) -> None:
    print("\ngranted table privileges:")
    rows = conn.run(
        """select table_name, privilege_type
           from information_schema.role_table_grants
           where grantee = :r order by table_name, privilege_type""",
        r=ROLE,
    )
    if not rows:
        print("  (none)")
    for table, priv in rows:
        print(f"  {table:12} {priv}")

    print("\npolicies visible to the role:")
    for table, policy, cmd, roles in conn.run(
        """select tablename, policyname, cmd, roles::text from pg_policies
           where schemaname='public' and roles::text like :like
           order by tablename""",
        like=f"%{ROLE}%",
    ):
        print(f"  {table:12} {policy:24} {cmd:8} {roles}")

    print("\nrole attributes:")
    for row in conn.run(
        """select rolsuper, rolcreatedb, rolcreaterole, rolcanlogin, rolbypassrls
           from pg_roles where rolname = :r""",
        r=ROLE,
    ):
        print(f"  superuser={row[0]} createdb={row[1]} createrole={row[2]} "
              f"login={row[3]} bypassrls={row[4]}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Create the read-only coaching role.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Show what would run without changing anything.")
    ap.add_argument("--verify-only", action="store_true",
                    help="Report current grants without altering the role.")
    args = ap.parse_args()

    print(f"target: {describe_target()}")
    print(f"role:   {ROLE}")

    if args.verify_only:
        conn = connect()
        try:
            report_privileges(conn)
        finally:
            conn.close()
        return 0

    try:
        password = env("COACH_DB_PASSWORD")
    except ConfigError:
        print(
            "\nCOACH_DB_PASSWORD is not set.\n\n"
            "This script will not generate one — CLAUDE.md § Human-only reserves\n"
            "creating secrets for you. Add a long random value to .env:\n\n"
            "    COACH_DB_PASSWORD=<paste your own>\n\n"
            "You will need the same value when connecting Supabase to Claude, so\n"
            "keep it to hand. A generator you might use:\n"
            "    python3 -c \"import secrets; print(secrets.token_urlsafe(32))\"\n",
            file=sys.stderr,
        )
        return 2

    if len(password) < 16:
        print("COACH_DB_PASSWORD is shorter than 16 characters — refusing.",
              file=sys.stderr)
        return 2

    if args.dry_run:
        print("\n--dry-run: would create/update the role and apply:")
        print(f"  grant connect on database postgres to {ROLE}")
        print(f"  grant usage on schema public to {ROLE}")
        for table in TABLES:
            print(f"  grant select on public.{table} to {ROLE}")
            print(f"  create policy {ROLE}_read on public.{table} for select")
        print("  (and revoke everything else)")
        return 0

    conn = connect()
    try:
        conn.run("begin")
        apply_role(conn, password)
        conn.run("commit")
        print("\ncommitted")
        report_privileges(conn)
    except Exception:
        conn.run("rollback")
        print("ROLLED BACK — no changes applied", file=sys.stderr)
        raise
    finally:
        conn.close()

    print(
        f"\nNext: verify the gate with\n"
        f"  pipeline/.venv/bin/python pipeline/verify.py COACH\n"
        f"That connects AS {ROLE} and proves SELECT works and writes fail."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
