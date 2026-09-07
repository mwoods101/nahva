"""Shared Postgres access for the Nahva pipeline.

Coordinator-owned: used by both strava_import.py (B) and intervals_sync.py (C).

Connects using SUPABASE_DB_URL. Locally that can be the direct
db.<ref>.supabase.co host; in GitHub Actions it MUST be the session-pooler
string, because the direct host is IPv6-only and Actions runners are IPv4
(BUILD_BRIEF.md §6).
"""

from __future__ import annotations

import os
import ssl
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

import pg8000.native
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent

load_dotenv(REPO_ROOT / ".env")

# Supabase Postgres does not use a publicly-trusted CA: both the direct host and
# the pooler present certs issued by "Supabase Intermediate 2021 CA". Verifying
# them needs Supabase's own root, committed alongside this file.
#   Source: https://supabase-downloads.s3.amazonaws.com/prod/ssl/prod-ca-2021.crt
#   Subject: C=US, O=Supabase Inc, CN=Supabase Root 2021 CA
SUPABASE_CA = REPO_ROOT / "pipeline" / "certs" / "prod-ca-2021.crt"


class ConfigError(RuntimeError):
    """A required environment variable is missing or malformed."""


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigError(
            f"{name} is not set. Copy .env.example to .env and fill it in "
            f"(or set it in GitHub Secrets for the Action)."
        )
    return value


def ssl_context() -> ssl.SSLContext:
    """TLS context that verifies the server against Supabase's root CA.

    Falls back to encrypted-but-unverified (equivalent to libpq sslmode=require)
    only if the CA file is missing, and says so loudly. Set
    SUPABASE_DB_SSLMODE=require to opt into that deliberately.
    """
    mode = os.environ.get("SUPABASE_DB_SSLMODE", "verify-full").strip()

    if mode == "require":
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx

    if not SUPABASE_CA.exists():
        print(
            f"WARNING: {SUPABASE_CA} missing — falling back to unverified TLS. "
            f"Re-download it from Supabase to restore certificate verification.",
            file=sys.stderr,
        )
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx

    # Note: this machine's Python has an empty default trust store, so the CA
    # must be loaded explicitly rather than relying on system defaults.
    return ssl.create_default_context(cafile=str(SUPABASE_CA))


def connect() -> pg8000.native.Connection:
    """Open an SSL connection to Postgres using SUPABASE_DB_URL."""
    raw = env("SUPABASE_DB_URL")
    parsed = urlparse(raw)

    if parsed.scheme not in ("postgres", "postgresql"):
        raise ConfigError(f"SUPABASE_DB_URL has unexpected scheme {parsed.scheme!r}")
    if not parsed.hostname:
        raise ConfigError(
            "SUPABASE_DB_URL has no hostname — check for a missing '@' before the host. "
            "Expected postgresql://user:password@host:port/database"
        )
    if not parsed.username or parsed.password is None:
        raise ConfigError("SUPABASE_DB_URL is missing a username or password")

    return pg8000.native.Connection(
        user=unquote(parsed.username),
        password=unquote(parsed.password),
        host=parsed.hostname,
        port=parsed.port or 5432,
        database=(parsed.path or "/postgres").lstrip("/") or "postgres",
        ssl_context=ssl_context(),
        timeout=30,
    )


def describe_target() -> str:
    """Host:port of the configured target, for log lines. Never logs the password."""
    parsed = urlparse(os.environ.get("SUPABASE_DB_URL", ""))
    return f"{parsed.hostname}:{parsed.port or 5432}"
