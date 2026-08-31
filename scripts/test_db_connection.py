#!/usr/bin/env python3
"""
Quick test: can we reach Postgres from this machine?
Run:  python scripts/test_db_connection.py

Uses DATABASE_URL (e.g. a free Neon/Supabase connection string).
"""
import os
import sys
from pathlib import Path


def _load_local_env() -> None:
    """Load KEY=VALUE pairs from the repo root .env (if present)."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.is_file():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


_load_local_env()

conn_str = (os.getenv("DATABASE_URL") or "").strip()
if not conn_str:
    print("DATABASE_URL is not set.")
    print()
    print("Get a free Postgres connection string from Neon (neon.tech) or Supabase, then:")
    print("   export DATABASE_URL='postgresql://user:pass@host/dbname?sslmode=require'")
    print("   python scripts/test_db_connection.py")
    sys.exit(1)

try:
    import psycopg2
except ImportError:
    print("Install psycopg2: pip install psycopg2-binary")
    sys.exit(1)

print("Trying to connect (timeout 10s)...")
try:
    conn = psycopg2.connect(conn_str, connect_timeout=10)
    conn.close()
    print("OK — connection succeeded.")
except Exception as e:
    print(f"Failed: {e}")
    sys.exit(1)
