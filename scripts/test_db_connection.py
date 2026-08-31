#!/usr/bin/env python3
"""
Quick test: can we reach SQL Server from this machine?
Run from WSL:  python scripts/test_db_connection.py

Uses MSSQL_CONN_STR. If not set, tries a few common Server= values so you can see what to set.
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

conn_str = (os.getenv("MSSQL_CONN_STR") or "").strip()
if not conn_str:
    print("MSSQL_CONN_STR is not set.")
    print()
    print("From WSL, you usually need the Windows host IP and the SQL Server port.")
    print("1) Get Windows IP from WSL:  grep nameserver /etc/resolv.conf | awk '{print $2}'")
    print("2) Find SQL Server port on Windows: SQL Server Configuration Manager")
    print("   -> Protocols for SQLEXPRESS -> TCP/IP -> IP Addresses -> IPAll -> TCP Port (e.g. 1434)")
    print("3) Then run:")
    print("   export MSSQL_CONN_STR='Driver={ODBC Driver 18 for SQL Server};Server=YOUR_WINDOWS_IP,1434;Uid=ada_user;Pwd=AdaTool@123;Encrypt=yes;TrustServerCertificate=yes;Connection Timeout=10;'")
    print("   python scripts/test_db_connection.py")
    sys.exit(1)

try:
    import pyodbc
except ImportError:
    print("Install pyodbc: pip install pyodbc")
    sys.exit(1)

print("Trying to connect (timeout 10s)...")
try:
    conn = pyodbc.connect(conn_str, timeout=10)
    conn.close()
    print("OK — connection succeeded.")
except Exception as e:
    print(f"Failed: {e}")
    sys.exit(1)
