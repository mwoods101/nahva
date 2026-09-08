#!/usr/bin/env python3
"""Rotate COACH_DB_PASSWORD in .env without ever printing it.

    pipeline/.venv/bin/python pipeline/rotate_coach_password.py

Generates a fresh 43-character URL-safe token, replaces the COACH_DB_PASSWORD
line in .env in place, and reports only its length. The value is never written
to stdout/stderr, never passed as an argv, and never echoed — so it cannot end
up in a shell history, a process listing, or a terminal transcript.

Run pipeline/setup_coach_role.py afterwards to apply it to the database, then
pipeline/verify.py COACH to confirm the role still reads and still cannot write.

Note: CLAUDE.md § Human-only normally reserves secret generation for the user.
This exists because the user asked for a rotation whose value never appears on
screen, which is the one case a human cannot do by hand.
"""

from __future__ import annotations

import re
import secrets
import sys
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
KEY = "COACH_DB_PASSWORD"
# The setup script dollar-quotes the password with this tag; a token containing
# it would break out of the quoting. token_urlsafe can't produce '$', but the
# check is cheap and the failure mode would be severe.
FORBIDDEN = "$coachpw$"


def main() -> int:
    if not ENV_PATH.exists():
        print(f"{ENV_PATH} not found", file=sys.stderr)
        return 1

    for _ in range(10):
        candidate = secrets.token_urlsafe(32)
        if FORBIDDEN not in candidate and "\n" not in candidate:
            break
    else:
        print("could not generate a usable token", file=sys.stderr)
        return 1

    text = ENV_PATH.read_text()
    line = f"{KEY}={candidate}"

    if re.search(rf"^{KEY}=", text, flags=re.M):
        text = re.sub(rf"^{KEY}=.*$", lambda _m: line, text, count=1, flags=re.M)
        action = "rotated"
    else:
        if not text.endswith("\n"):
            text += "\n"
        text += (
            "\n# Read-only coaching role (workstream COACH).\n"
            f"{line}\n"
        )
        action = "added"

    ENV_PATH.write_text(text)

    # Length only. Never the value.
    print(f"{action} {KEY} in {ENV_PATH.name}: {len(candidate)} chars")
    print("value not printed by design — read it from .env if you need it")
    print("\nnext:")
    print("  pipeline/.venv/bin/python pipeline/setup_coach_role.py")
    print("  pipeline/.venv/bin/python pipeline/verify.py COACH")
    return 0


if __name__ == "__main__":
    sys.exit(main())
