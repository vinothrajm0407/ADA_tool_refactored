"""
MSSQL persistence for ADA scan history.
Requires: pyodbc, ODBC Driver 18 for SQL Server, env MSSQL_CONN_STR.

If MSSQL_CONN_STR is set, the app will automatically create the database and
ScanHistory table on startup (when running on Azure, AWS, or locally). No manual setup needed.
"""
import json
import logging
import os
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse as _urlparse

logger = logging.getLogger(__name__)


def _load_local_env() -> None:
    """Load simple KEY=VALUE pairs from a local .env file if present."""
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

_CONNECTION_STRING = (os.getenv("MSSQL_CONN_STR") or "").strip()
_DATABASE = os.getenv("MSSQL_DATABASE", "ADA_DB")
_INIT_DONE = False
_INIT_ERROR = ""


def _validate_database_name(name: str) -> None:
    if not re.match(r"^[a-zA-Z0-9_]+$", name):
        raise ValueError(f"Invalid MSSQL_DATABASE: {name!r}")


def _connection_string_to_master() -> str | None:
    """Build a connection string that targets the master database so we can create ADA_DB."""
    if not _CONNECTION_STRING:
        return None
    s = _CONNECTION_STRING
    # Replace Database=... or Initial Catalog=... with master (case-insensitive)
    s = re.sub(r"Database=[^;]*", "Database=master", s, flags=re.IGNORECASE)
    s = re.sub(r"Initial Catalog=[^;]*", "Initial Catalog=master", s, flags=re.IGNORECASE)
    if "Database=" not in s and "Initial Catalog=" not in s:
        s = s.rstrip(";") + ";Database=master"
    return s


def _app_connection_string() -> str:
    """Connection string for the app database (e.g. ADA_DB). Ensures Database= is set."""
    if not _CONNECTION_STRING:
        raise RuntimeError("MSSQL_CONN_STR environment variable is not set")
    s = _CONNECTION_STRING
    _validate_database_name(_DATABASE)
    if "Database=" in s or "Initial Catalog=" in s:
        s = re.sub(r"Database=[^;]*", f"Database={_DATABASE}", s, flags=re.IGNORECASE)
        s = re.sub(r"Initial Catalog=[^;]*", f"Initial Catalog={_DATABASE}", s, flags=re.IGNORECASE)
    else:
        s = s.rstrip(";") + f";Database={_DATABASE}"
    return s


def _conn():
    import pyodbc
    return pyodbc.connect(_app_connection_string())


def is_enabled() -> bool:
    """Return True when scan history persistence is configured."""
    return bool(_CONNECTION_STRING)


def init_error() -> str:
    """Return the last database initialization error, if any."""
    return _INIT_ERROR


def is_ready() -> bool:
    """Return True when persistence is configured and startup init succeeded."""
    return is_enabled() and not _INIT_ERROR


def _ensure_database() -> None:
    """Create the database if it does not exist (connects to master)."""
    master_cs = _connection_string_to_master()
    if not master_cs:
        return
    import pyodbc
    _validate_database_name(_DATABASE)
    conn = pyodbc.connect(master_cs)
    try:
        conn.autocommit = True  # CREATE DATABASE requires autocommit
        cur = conn.cursor()
        # Database name cannot be parameterized in T-SQL; we validated _DATABASE above
        cur.execute(f"IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = N'{_DATABASE}') CREATE DATABASE [{_DATABASE}]")
    finally:
        conn.close()


def _ensure_table() -> None:
    """Create required persistence tables and add missing columns."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = N'ScanHistory')
            CREATE TABLE dbo.ScanHistory (
                Id             INT IDENTITY(1,1) PRIMARY KEY,
                Url            NVARCHAR(2048) NOT NULL,
                TimestampUtc   DATETIME2(3)   NOT NULL,
                Passes         INT            NOT NULL,
                Violations     INT            NOT NULL,
                PassRate       INT            NOT NULL,
                UsedFallback   BIT            NOT NULL,
                IncludeBestPractices BIT      NOT NULL DEFAULT 0,
                ResultPayload  NVARCHAR(MAX)  NULL
            )
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.tables WHERE name = N'ScanJobs')
            CREATE TABLE dbo.ScanJobs (
                JobId           NVARCHAR(100) PRIMARY KEY,
                Url             NVARCHAR(2048) NOT NULL,
                Status          NVARCHAR(50)  NOT NULL,
                WorkerName      NVARCHAR(128) NULL,
                Attempt         INT            NOT NULL DEFAULT 0,
                CreatedAt       DATETIME2(3)   NOT NULL,
                StartedAt       DATETIME2(3)   NULL,
                EndedAt         DATETIME2(3)   NULL,
                DurationSeconds FLOAT          NULL,
                FailureReason   NVARCHAR(MAX)  NULL,
                ResultPayload   NVARCHAR(MAX)  NULL,
                Metadata        NVARCHAR(MAX)  NULL
            )
        """)
        conn.commit()
        # Ensure schema evolution for ScanHistory
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID(N'dbo.ScanHistory') AND name = N'ResultPayload'
            )
            ALTER TABLE dbo.ScanHistory ADD ResultPayload NVARCHAR(MAX) NULL
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID(N'dbo.ScanHistory') AND name = N'IncludeBestPractices'
            )
            ALTER TABLE dbo.ScanHistory ADD IncludeBestPractices BIT NOT NULL CONSTRAINT DF_ScanHistory_IncludeBestPractices DEFAULT 0
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE object_id = OBJECT_ID(N'dbo.ScanHistory') AND name = N'IX_ScanHistory_TimestampUtc'
            )
            CREATE INDEX IX_ScanHistory_TimestampUtc ON dbo.ScanHistory(TimestampUtc DESC)
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE object_id = OBJECT_ID(N'dbo.ScanJobs') AND name = N'IX_ScanJobs_Status'
            )
            CREATE INDEX IX_ScanJobs_Status ON dbo.ScanJobs(Status)
        """)
        conn.commit()
        # ── Crawler tables ────────────────────────────────────────────────────
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.tables WHERE name = N'CrawlJob')
            CREATE TABLE dbo.CrawlJob (
                CrawlId         NVARCHAR(100)  PRIMARY KEY,
                RQJobId         NVARCHAR(100)  NULL,
                RootUrl         NVARCHAR(2048) NOT NULL,
                Status          NVARCHAR(50)   NOT NULL,
                MaxDepth        INT            NOT NULL DEFAULT 3,
                MaxPages        INT            NOT NULL DEFAULT 50,
                TotalDiscovered INT            NOT NULL DEFAULT 0,
                TotalScanned    INT            NOT NULL DEFAULT 0,
                TotalFailed     INT            NOT NULL DEFAULT 0,
                CreatedAt       DATETIME2(3)   NOT NULL,
                StartedAt       DATETIME2(3)   NULL,
                EndedAt         DATETIME2(3)   NULL,
                DurationSeconds FLOAT          NULL,
                FailureReason   NVARCHAR(MAX)  NULL,
                Metadata        NVARCHAR(MAX)  NULL
            )
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID(N'dbo.CrawlJob') AND name = N'NotifyEmail'
            )
            ALTER TABLE dbo.CrawlJob ADD NotifyEmail NVARCHAR(500) NULL
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.tables WHERE name = N'CrawlPage')
            CREATE TABLE dbo.CrawlPage (
                Id              INT IDENTITY(1,1) PRIMARY KEY,
                CrawlId         NVARCHAR(100)  NOT NULL,
                Url             NVARCHAR(2048) NOT NULL,
                NormalizedUrl   NVARCHAR(2048) NOT NULL,
                ParentUrl       NVARCHAR(2048) NULL,
                Depth           INT            NOT NULL DEFAULT 0,
                Status          NVARCHAR(50)   NOT NULL,
                ScanHistoryId   INT            NULL,
                Passes          INT            NULL,
                Violations      INT            NULL,
                PassRate        INT            NULL,
                DiscoveredAt    DATETIME2(3)   NOT NULL,
                ScannedAt       DATETIME2(3)   NULL,
                FailureReason   NVARCHAR(MAX)  NULL
            )
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE object_id = OBJECT_ID(N'dbo.CrawlJob') AND name = N'IX_CrawlJob_Status'
            )
            CREATE INDEX IX_CrawlJob_Status ON dbo.CrawlJob(Status)
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE object_id = OBJECT_ID(N'dbo.CrawlPage') AND name = N'IX_CrawlPage_CrawlId'
            )
            CREATE INDEX IX_CrawlPage_CrawlId ON dbo.CrawlPage(CrawlId)
        """)
        conn.commit()
        # ── Phase 3 tables ────────────────────────────────────────────────────
        cur.execute("""
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'CrawlSchedule')
            CREATE TABLE dbo.CrawlSchedule (
                Id          INT IDENTITY(1,1) PRIMARY KEY,
                RootUrl     NVARCHAR(2048) NOT NULL,
                Frequency   NVARCHAR(20)   NOT NULL DEFAULT 'weekly',
                Enabled     BIT            NOT NULL DEFAULT 1,
                LastRunAt   DATETIME2(3)   NULL,
                NextRunAt   DATETIME2(3)   NOT NULL,
                CreatedAt   DATETIME2(3)   NOT NULL DEFAULT GETUTCDATE(),
                UpdatedAt   DATETIME2(3)   NOT NULL DEFAULT GETUTCDATE()
            )
        """)
        conn.commit()
        # ── CrawlSchedule schema evolution ─────────────────────────────────────
        _crawl_schedule_columns = [
            ("Name",       "NVARCHAR(120) NULL"),
            ("TimeOfDay",  "TIME NULL"),
        ]
        for col, defn in _crawl_schedule_columns:
            cur.execute(f"""
                IF NOT EXISTS (
                    SELECT 1 FROM sys.columns
                    WHERE object_id = OBJECT_ID(N'dbo.CrawlSchedule') AND name = N'{col}'
                )
                ALTER TABLE dbo.CrawlSchedule ADD {col} {defn}
            """)
            conn.commit()
        cur.execute("""
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'AccessibilityAlert')
            CREATE TABLE dbo.AccessibilityAlert (
                Id          INT IDENTITY(1,1) PRIMARY KEY,
                CrawlId     NVARCHAR(100)  NOT NULL,
                RootUrl     NVARCHAR(2048) NULL,
                AlertType   NVARCHAR(50)   NOT NULL,
                Severity    NVARCHAR(20)   NOT NULL DEFAULT 'moderate',
                Details     NVARCHAR(MAX)  NULL,
                Status      NVARCHAR(20)   NOT NULL DEFAULT 'active',
                CreatedAt   DATETIME2(3)   NOT NULL DEFAULT GETUTCDATE()
            )
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE object_id = OBJECT_ID(N'dbo.AccessibilityAlert') AND name = N'IX_Alert_Status'
            )
            CREATE INDEX IX_Alert_Status ON dbo.AccessibilityAlert(Status, CreatedAt DESC)
        """)
        conn.commit()
        # ── AssistiveScanHistory table ────────────────────────────────────────
        cur.execute("""
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'AssistiveScanHistory')
            CREATE TABLE dbo.AssistiveScanHistory (
                Id            INT IDENTITY(1,1) PRIMARY KEY,
                ScanType      NVARCHAR(50)   NOT NULL,
                Url           NVARCHAR(2048) NOT NULL,
                TimestampUtc  DATETIME2(3)   NOT NULL,
                Passed        BIT            NOT NULL DEFAULT 0,
                ResultPayload NVARCHAR(MAX)  NULL
            )
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE object_id = OBJECT_ID(N'dbo.AssistiveScanHistory')
                  AND name = N'IX_AssistiveScan_TimestampUtc'
            )
            CREATE INDEX IX_AssistiveScan_TimestampUtc
                ON dbo.AssistiveScanHistory(TimestampUtc DESC)
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE object_id = OBJECT_ID(N'dbo.AssistiveScanHistory')
                  AND name = N'IX_AssistiveScan_ScanType'
            )
            CREATE INDEX IX_AssistiveScan_ScanType
                ON dbo.AssistiveScanHistory(ScanType, TimestampUtc DESC)
        """)
        conn.commit()
        # ── CrawlPage.ResultPayload — schema evolution ────────────────────────
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID(N'dbo.CrawlPage') AND name = N'ResultPayload'
            )
            ALTER TABLE dbo.CrawlPage ADD ResultPayload NVARCHAR(MAX) NULL
        """)
        conn.commit()
        # ── Users ─────────────────────────────────────────────────────────────
        cur.execute("""
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'Users')
            CREATE TABLE dbo.Users (
                Id           INT IDENTITY(1,1) PRIMARY KEY,
                FirstName    NVARCHAR(100)  NOT NULL,
                LastName     NVARCHAR(100)  NOT NULL,
                Email        NVARCHAR(320)  NOT NULL,
                PasswordHash NVARCHAR(256)  NOT NULL,
                IsActive     BIT            NOT NULL DEFAULT 1,
                CreatedAtUtc DATETIME2(3)   NOT NULL DEFAULT GETUTCDATE()
            )
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE object_id = OBJECT_ID(N'dbo.Users') AND name = N'UX_Users_Email'
            )
            CREATE UNIQUE INDEX UX_Users_Email ON dbo.Users (Email)
        """)
        conn.commit()
        # ── Users schema evolution ─────────────────────────────────────────────
        _user_columns = [
            ("FirstName",         "NVARCHAR(100) NULL"),
            ("LastName",          "NVARCHAR(100) NULL"),
            ("CreatedAtUtc",      "DATETIME2(3) NULL"),
            ("EmailVerified",     "BIT NOT NULL DEFAULT 0"),
            ("EmailVerifiedAt",   "DATETIME2(3) NULL"),
            ("VerifyToken",       "NVARCHAR(128) NULL"),
            ("VerifyTokenExpiry", "DATETIME2(3) NULL"),
            ("AuthProvider",      "NVARCHAR(50) NULL"),
            ("ProviderUserId",    "NVARCHAR(256) NULL"),
            ("ResetToken",        "NVARCHAR(128) NULL"),
            ("ResetTokenExpiry",  "DATETIME2(3) NULL"),
        ]
        for col, defn in _user_columns:
            cur.execute(f"""
                IF NOT EXISTS (
                    SELECT 1 FROM sys.columns
                    WHERE object_id = OBJECT_ID(N'dbo.Users') AND name = N'{col}'
                )
                ALTER TABLE dbo.Users ADD {col} {defn}
            """)
            conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE object_id = OBJECT_ID(N'dbo.Users') AND name = N'IX_Users_VerifyToken'
            )
            CREATE INDEX IX_Users_VerifyToken ON dbo.Users (VerifyToken)
            WHERE VerifyToken IS NOT NULL
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE object_id = OBJECT_ID(N'dbo.Users') AND name = N'IX_Users_ResetToken'
            )
            CREATE INDEX IX_Users_ResetToken ON dbo.Users (ResetToken)
            WHERE ResetToken IS NOT NULL
        """)
        conn.commit()
        # ── Integrations (Slack / Teams) ──────────────────────────────────────
        cur.execute("""
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'Integration')
            CREATE TABLE dbo.Integration (
                Id            INT IDENTITY(1,1) PRIMARY KEY,
                UserId        INT            NOT NULL,
                Platform      NVARCHAR(20)   NOT NULL,
                WorkspaceId   NVARCHAR(200)  NOT NULL,
                WorkspaceName NVARCHAR(200)  NOT NULL,
                AccessToken   NVARCHAR(2000) NULL,
                ConnectedAt   DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
                Status        NVARCHAR(20)   NOT NULL DEFAULT 'active'
            )
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'IntegrationChannel')
            CREATE TABLE dbo.IntegrationChannel (
                Id              INT IDENTITY(1,1) PRIMARY KEY,
                IntegrationId   INT            NOT NULL,
                ChannelId       NVARCHAR(200)  NOT NULL,
                ChannelName     NVARCHAR(200)  NOT NULL,
                Purpose         NVARCHAR(50)   NULL,
                WebhookUrl      NVARCHAR(2000) NULL,
                AddedAt         DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME()
            )
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'IntegrationDelivery')
            CREATE TABLE dbo.IntegrationDelivery (
                Id              INT IDENTITY(1,1) PRIMARY KEY,
                IntegrationId   INT            NOT NULL,
                ChannelId       NVARCHAR(200)  NULL,
                ChannelName     NVARCHAR(200)  NULL,
                ReportType      NVARCHAR(50)   NOT NULL,
                Status          NVARCHAR(20)   NOT NULL,
                SentAt          DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
                ErrorMessage    NVARCHAR(500)  NULL,
                Reference       NVARCHAR(200)  NULL
            )
        """)
        conn.commit()
        # ── Repo Links (Auto-Fix source repo) ─────────────────────────────────
        # PathPrefix disambiguates multiple sites sharing one domain (e.g. two
        # GitHub Pages project sites both under the same *.github.io host) —
        # Domain alone isn't enough to pick the right repo for a given page_url.
        cur.execute("""
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'RepoLink')
            CREATE TABLE dbo.RepoLink (
                Id            INT IDENTITY(1,1) PRIMARY KEY,
                UserId        INT            NOT NULL,
                Domain        NVARCHAR(255)  NOT NULL,
                PathPrefix    NVARCHAR(200)  NOT NULL DEFAULT '',
                SiteUrl       NVARCHAR(500)  NOT NULL,
                RepoUrl       NVARCHAR(500)  NOT NULL,
                DefaultBranch NVARCHAR(100)  NOT NULL DEFAULT 'main',
                Framework     NVARCHAR(30)   NOT NULL DEFAULT 'react',
                AccessToken   NVARCHAR(2000) NULL,
                ConnectedAt   DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
                Status        NVARCHAR(20)   NOT NULL DEFAULT 'active'
            )
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID(N'dbo.RepoLink') AND name = N'PathPrefix'
            )
            ALTER TABLE dbo.RepoLink ADD PathPrefix NVARCHAR(200) NOT NULL DEFAULT ''
        """)
        conn.commit()
        cur.execute("""
            IF EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE object_id = OBJECT_ID(N'dbo.RepoLink') AND name = N'UX_RepoLink_User_Domain'
            )
            DROP INDEX UX_RepoLink_User_Domain ON dbo.RepoLink
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE object_id = OBJECT_ID(N'dbo.RepoLink') AND name = N'UX_RepoLink_User_Domain_Path'
            )
            CREATE UNIQUE INDEX UX_RepoLink_User_Domain_Path ON dbo.RepoLink (UserId, Domain, PathPrefix)
            WHERE Status = 'active'
        """)
        conn.commit()
        # ── Fix attempts (Auto-Fix history) ───────────────────────────────────
        cur.execute("""
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'Fix')
            CREATE TABLE dbo.Fix (
                Id            INT IDENTITY(1,1) PRIMARY KEY,
                UserId        INT            NOT NULL,
                PageUrl       NVARCHAR(1000) NOT NULL,
                RuleId        NVARCHAR(100)  NOT NULL,
                NodeSignature NVARCHAR(64)   NULL,
                Status        NVARCHAR(20)   NOT NULL,
                BranchUrl     NVARCHAR(500)  NULL,
                ErrorMessage  NVARCHAR(1000) NULL,
                CreatedAt     DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME()
            )
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID(N'dbo.Fix') AND name = N'PrUrl'
            )
            ALTER TABLE dbo.Fix ADD PrUrl NVARCHAR(500) NULL
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID(N'dbo.Fix') AND name = N'Merged'
            )
            ALTER TABLE dbo.Fix ADD Merged BIT NOT NULL DEFAULT 0
        """)
        conn.commit()
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID(N'dbo.Fix') AND name = N'NodeSignature'
            )
            ALTER TABLE dbo.Fix ADD NodeSignature NVARCHAR(64) NULL
        """)
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    """
    Create the database and ScanHistory table if they do not exist.
    Call this at app startup. Safe to call multiple times.
    """
    global _INIT_DONE, _INIT_ERROR
    if not _CONNECTION_STRING:
        _INIT_ERROR = "MSSQL_CONN_STR is not set"
        logger.warning("MSSQL_CONN_STR not set — scan history will not be persisted. Set it to create ADA_DB and table automatically.")
        return
    if _INIT_DONE:
        return
    try:
        logger.info("Creating database and table if needed...")
        try:
            # Preferred path for existing deployments: connect directly to ADA_DB
            # and create only the table if it is missing.
            _ensure_table()
        except Exception:
            # Fallback for fresh environments where the database itself does not exist yet.
            _ensure_database()
            _ensure_table()
        _INIT_DONE = True
        _INIT_ERROR = ""
        logger.info("Database and table ready.")
        reset_orphaned_jobs()
    except Exception as e:
        _INIT_ERROR = str(e)
        logger.exception("Database initialization failed: %s", e)
        _INIT_DONE = True  # Avoid repeated log spam


def create_user(first_name: str, last_name: str, email: str, password_hash: str) -> dict:
    """Insert a new user and return their record. Raises ValueError on duplicate email."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO dbo.Users (FirstName, LastName, Email, PasswordHash)
            OUTPUT INSERTED.Id, INSERTED.FirstName, INSERTED.LastName,
                   INSERTED.Email, INSERTED.CreatedAtUtc
            VALUES (?, ?, ?, ?)
            """,
            first_name, last_name, email, password_hash,
        )
        row = cur.fetchone()
        conn.commit()
        return {
            "id": row[0],
            "firstName": row[1],
            "lastName": row[2],
            "email": row[3],
            "createdAtUtc": row[4].isoformat() if row[4] else None,
        }
    except Exception as e:
        if "UX_Users_Email" in str(e) or "unique" in str(e).lower() or "duplicate" in str(e).lower():
            raise ValueError("email_already_registered")
        raise
    finally:
        conn.close()


def get_user_by_email(email: str) -> dict | None:
    """Return the user row for the given email, or None if not found."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT Id, FirstName, LastName, Email, PasswordHash, IsActive, CreatedAtUtc,
                      ISNULL(EmailVerified, 0) AS EmailVerified
               FROM dbo.Users WHERE Email = ?""",
            email,
        )
        row = cur.fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "firstName": row[1],
            "lastName": row[2],
            "email": row[3],
            "passwordHash": row[4],
            "isActive": bool(row[5]),
            "createdAtUtc": row[6].isoformat() if row[6] else None,
            "emailVerified": bool(row[7]),
        }
    finally:
        conn.close()


def get_user_by_id(user_id: int) -> dict | None:
    """Return the user row for the given id, or None if not found."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT Id, FirstName, LastName, Email, IsActive, CreatedAtUtc FROM dbo.Users WHERE Id = ?",
            user_id,
        )
        row = cur.fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "firstName": row[1],
            "lastName": row[2],
            "email": row[3],
            "isActive": bool(row[4]),
            "createdAtUtc": row[5].isoformat() if row[5] else None,
        }
    finally:
        conn.close()


def set_verify_token(user_id: int, token: str, expiry_utc) -> None:
    """Store an email-verification token and its expiry on the given user."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE dbo.Users SET VerifyToken = ?, VerifyTokenExpiry = ? WHERE Id = ?",
            token, expiry_utc, user_id,
        )
        conn.commit()
    finally:
        conn.close()


def get_user_by_verify_token(token: str) -> dict | None:
    """Return the user whose VerifyToken matches and has not yet expired, or None."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT Id, FirstName, LastName, Email, ISNULL(EmailVerified, 0),
                      VerifyTokenExpiry
               FROM dbo.Users
               WHERE VerifyToken = ? AND VerifyTokenExpiry > GETUTCDATE()""",
            token,
        )
        row = cur.fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "firstName": row[1],
            "lastName": row[2],
            "email": row[3],
            "emailVerified": bool(row[4]),
            "verifyTokenExpiry": row[5].isoformat() if row[5] else None,
        }
    finally:
        conn.close()


def mark_email_verified(user_id: int) -> None:
    """Set EmailVerified = 1, record the timestamp, and clear the token."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE dbo.Users
               SET EmailVerified = 1,
                   EmailVerifiedAt = GETUTCDATE(),
                   VerifyToken = NULL,
                   VerifyTokenExpiry = NULL
               WHERE Id = ?""",
            user_id,
        )
        conn.commit()
    finally:
        conn.close()


def get_verify_token_issued_at(user_id: int):
    """Return VerifyTokenExpiry for rate-limiting resend requests, or None."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT VerifyTokenExpiry FROM dbo.Users WHERE Id = ?",
            user_id,
        )
        row = cur.fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def set_reset_token(user_id: int, token: str, expiry_utc) -> None:
    """Store a password-reset token and its expiry on the given user."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE dbo.Users SET ResetToken = ?, ResetTokenExpiry = ? WHERE Id = ?",
            token, expiry_utc, user_id,
        )
        conn.commit()
    finally:
        conn.close()


def get_user_by_reset_token(token: str) -> dict | None:
    """Return the user whose ResetToken matches and has not yet expired, or None."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT Id, FirstName, LastName, Email, ResetTokenExpiry
               FROM dbo.Users
               WHERE ResetToken = ? AND ResetTokenExpiry > GETUTCDATE()""",
            token,
        )
        row = cur.fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "firstName": row[1],
            "lastName": row[2],
            "email": row[3],
            "resetTokenExpiry": row[4].isoformat() if row[4] else None,
        }
    finally:
        conn.close()


def reset_user_password(user_id: int, password_hash: str) -> None:
    """Update the user's password hash and clear the reset token."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE dbo.Users
               SET PasswordHash = ?,
                   ResetToken = NULL,
                   ResetTokenExpiry = NULL
               WHERE Id = ?""",
            password_hash, user_id,
        )
        conn.commit()
    finally:
        conn.close()


def get_reset_token_issued_at(user_id: int):
    """Return ResetTokenExpiry for rate-limiting forgot-password requests, or None."""
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT ResetTokenExpiry FROM dbo.Users WHERE Id = ?",
            user_id,
        )
        row = cur.fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def reset_orphaned_jobs(stale_seconds: int = 600) -> int:
    """
    Mark ScanJobs rows stuck in 'running' for longer than stale_seconds as 'failed'.
    Protects against jobs that were running when the worker process crashed.
    Safe to call multiple times; only affects rows genuinely past the stale window.
    Returns the number of rows updated.
    """
    if not is_enabled() or _INIT_ERROR:
        return 0
    try:
        conn = _conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE dbo.ScanJobs
                    SET    Status        = 'failed',
                           FailureReason = 'Worker process crashed or restarted before job completed',
                           EndedAt       = GETUTCDATE()
                    WHERE  Status = 'running'
                      AND  StartedAt < DATEADD(SECOND, ?, GETUTCDATE())
                    """,
                    (-stale_seconds,),
                )
                count = cur.rowcount
            conn.commit()
            if count:
                logger.warning("Reset %d orphaned 'running' job(s) to 'failed'", count)
            return count
        finally:
            conn.close()
    except Exception:
        logger.exception("Failed to reset orphaned jobs")
        return 0


def _row_to_dict(row):
    if row is None:
        return None
    return {
        "job_id": row.JobId,
        "url": row.Url,
        "status": row.Status,
        "worker_name": row.WorkerName,
        "attempt": row.Attempt,
        "created_at": row.CreatedAt.isoformat() if row.CreatedAt else None,
        "started_at": row.StartedAt.isoformat() if row.StartedAt else None,
        "ended_at": row.EndedAt.isoformat() if row.EndedAt else None,
        "duration_seconds": row.DurationSeconds,
        "failure_reason": row.FailureReason,
        "result_payload": json.loads(row.ResultPayload) if row.ResultPayload else None,
        "metadata": json.loads(row.Metadata) if row.Metadata else None,
    }


def save_scan_job(
    job_id: str,
    url: str,
    metadata: dict | None = None,
    status: str = "pending",
    created_at: str | None = None,
    attempt: int = 0,
    worker_name: str | None = None,
) -> None:
    if not is_enabled() or _INIT_ERROR:
        return
    metadata_json = json.dumps(metadata or {})
    created_at = created_at or datetime.utcnow().isoformat(timespec="milliseconds") + "Z"
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                IF EXISTS (SELECT 1 FROM dbo.ScanJobs WHERE JobId = ?)
                UPDATE dbo.ScanJobs
                SET Url = ?, Status = ?, WorkerName = ?, Attempt = ?, CreatedAt = ?, Metadata = ?
                WHERE JobId = ?
                ELSE
                INSERT INTO dbo.ScanJobs (JobId, Url, Status, WorkerName, Attempt, CreatedAt, Metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (job_id, url, status, worker_name, attempt, created_at, metadata_json, job_id, job_id, url, status, worker_name, attempt, created_at, metadata_json),
            )
        conn.commit()
    finally:
        conn.close()


def update_scan_job_status(
    job_id: str,
    status: str,
    started_at: str | None = None,
    ended_at: str | None = None,
    duration_seconds: float | None = None,
    failure_reason: str | None = None,
    result_payload: dict | None = None,
    worker_name: str | None = None,
    attempt: int | None = None,
) -> None:
    if not is_enabled() or _INIT_ERROR:
        return
    updates = ["Status = ?"]
    params = [status]
    if started_at is not None:
        updates.append("StartedAt = ?")
        params.append(started_at)
    if ended_at is not None:
        updates.append("EndedAt = ?")
        params.append(ended_at)
    if duration_seconds is not None:
        updates.append("DurationSeconds = ?")
        params.append(duration_seconds)
    if failure_reason is not None:
        updates.append("FailureReason = ?")
        params.append(failure_reason)
    if result_payload is not None:
        updates.append("ResultPayload = ?")
        params.append(json.dumps(result_payload))
    if worker_name is not None:
        updates.append("WorkerName = ?")
        params.append(worker_name)
    if attempt is not None:
        updates.append("Attempt = ?")
        params.append(attempt)

    params.append(job_id)
    sql = f"UPDATE dbo.ScanJobs SET {', '.join(updates)} WHERE JobId = ?"
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def get_scan_job(job_id: str) -> dict | None:
    if not is_enabled() or _INIT_ERROR:
        return None
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM dbo.ScanJobs WHERE JobId = ?",
                (job_id,),
            )
            row = cur.fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


def save_scan_history(result: dict, limit: int = 500) -> int | None:
    """
    Insert one row into dbo.ScanHistory with full result JSON for later retrieval.
    Returns the auto-assigned Id of the inserted row (used by the crawler to link
    CrawlPage.ScanHistoryId). Returns None if persistence is disabled or insert fails.
    result: dict from process_url() with keys axeResult, url, usedFallback.
    """
    axe = (result or {}).get("axeResult") or {}
    passes = len(axe.get("passes") or [])
    violations = len(axe.get("violations") or [])
    total = passes + violations
    pass_rate = round(passes / total * 100) if total else 0
    timestamp = axe.get("timestamp") or datetime.utcnow().isoformat(timespec="milliseconds") + "Z"
    url = (axe.get("url") or result.get("url") or "").strip()
    used_fallback = bool(result.get("usedFallback"))
    include_best_practices = bool(result.get("includeBestPractices"))
    payload_json = json.dumps(result) if result else None

    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO dbo.ScanHistory
                    (Url, TimestampUtc, Passes, Violations, PassRate, UsedFallback, IncludeBestPractices, ResultPayload)
                OUTPUT INSERTED.Id
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (url, timestamp, passes, violations, pass_rate,
                 1 if used_fallback else 0, 1 if include_best_practices else 0, payload_json),
            )
            row = cur.fetchone()
            new_id = int(row[0]) if row and row[0] is not None else None
        conn.commit()
        return new_id
    finally:
        conn.close()


def get_scan_result(scan_id: int) -> dict | None:
    """
    Return the full stored result for a scan (same shape as process_url output).
    Returns None if scan_id not found or ResultPayload is null/empty.
    """
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ResultPayload FROM dbo.ScanHistory WHERE Id = ?",
                (scan_id,),
            )
            row = cur.fetchone()
        if not row or not row.ResultPayload:
            return None
        return json.loads(row.ResultPayload)
    except (json.JSONDecodeError, TypeError):
        return None
    finally:
        conn.close()


def get_scan_history(limit: int = 500):
    """
    Return list of scan summary dicts from dbo.ScanHistory, newest first.
    Each dict: id, url, timestamp, passes, violations, passRate, usedFallback.
    """
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT TOP (?) Id, Url, TimestampUtc, Passes, Violations, PassRate, UsedFallback, IncludeBestPractices
                FROM dbo.ScanHistory
                ORDER BY TimestampUtc DESC
                """,
                (limit,),
            )
            rows = cur.fetchall()
        out = []
        for r in rows:
            ts = r.TimestampUtc
            if hasattr(ts, "isoformat"):
                ts = ts.isoformat()
            out.append({
                "id": f"SCAN-{r.Id}",
                "url": r.Url or "",
                "timestamp": ts,
                "passes": r.Passes,
                "violations": r.Violations,
                "passRate": r.PassRate,
                "usedFallback": bool(r.UsedFallback),
                "includeBestPractices": bool(getattr(r, "IncludeBestPractices", 0)),
            })
        return out
    finally:
        conn.close()


_SCAN_SCORE_WEIGHTS = {'critical': 10, 'serious': 5, 'moderate': 2, 'minor': 1}


def _compute_scan_score(result: dict) -> int:
    violations = ((result or {}).get('axeResult') or {}).get('violations') or []
    penalty = 0
    for v in violations:
        w = _SCAN_SCORE_WEIGHTS.get((v.get('impact') or 'minor').lower(), 1)
        nodes = v.get('nodes') or []
        penalty += (len(nodes) if nodes else 1) * w
    return max(0, min(100, round(100 - penalty)))


def get_prev_scan_summary_for_url(url: str) -> dict | None:
    """
    Return the most recent *previous* scan summary for a URL.
    Fetches the two most recent scans for the URL (across http/https and
    trailing-slash variants); the second row is the previous scan.
    Returns None when fewer than two scans exist for this URL.
    """
    from urllib.parse import urlparse
    url = (url or '').strip()
    try:
        p = urlparse(url)
        host_path = p.netloc.lower() + p.path.lower().rstrip('/')
    except Exception:
        host_path = url.lower().rstrip('/')

    url_http  = 'http://'  + host_path
    url_https = 'https://' + host_path
    variants = (url_http, url_http + '/', url_https, url_https + '/')
    placeholders = ','.join(['?'] * len(variants))

    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT TOP 2 Id, Url, TimestampUtc, Violations, ResultPayload
                FROM dbo.ScanHistory
                WHERE LOWER(Url) IN ({placeholders})
                ORDER BY TimestampUtc DESC
                """,
                variants,
            )
            rows = cur.fetchall()

        if len(rows) < 2:
            return None

        prev = rows[1]
        ts = prev.TimestampUtc
        if hasattr(ts, 'isoformat'):
            ts = ts.isoformat()

        score = 0
        try:
            if prev.ResultPayload:
                score = _compute_scan_score(json.loads(prev.ResultPayload))
        except Exception:
            pass

        return {
            'score': score,
            'totalViolations': prev.Violations or 0,
            'url': prev.Url or '',
            'timestamp': ts,
        }
    finally:
        conn.close()


# ── Trend aggregation ─────────────────────────────────────────────────────────

_TREND_SQL: dict[str, str] = {
    "daily": """
        SELECT
            CAST(TimestampUtc AS DATE)                   AS BucketDate,
            COUNT(*)                                      AS ScanCount,
            AVG(CAST(PassRate AS FLOAT))                  AS AvgPassRate,
            SUM(Violations)                               AS TotalViolations,
            SUM(Passes)                                   AS TotalPasses
        FROM dbo.ScanHistory
        WHERE TimestampUtc >= ? AND TimestampUtc < ?
        GROUP BY CAST(TimestampUtc AS DATE)
        ORDER BY BucketDate ASC
    """,
    "weekly": """
        SELECT
            MIN(CAST(TimestampUtc AS DATE))               AS BucketDate,
            COUNT(*)                                      AS ScanCount,
            AVG(CAST(PassRate AS FLOAT))                  AS AvgPassRate,
            SUM(Violations)                               AS TotalViolations,
            SUM(Passes)                                   AS TotalPasses
        FROM dbo.ScanHistory
        WHERE TimestampUtc >= ? AND TimestampUtc < ?
        GROUP BY YEAR(TimestampUtc), DATEPART(week, TimestampUtc)
        ORDER BY MIN(CAST(TimestampUtc AS DATE)) ASC
    """,
    "monthly": """
        SELECT
            CAST(DATEFROMPARTS(YEAR(TimestampUtc), MONTH(TimestampUtc), 1) AS DATE) AS BucketDate,
            COUNT(*)                                      AS ScanCount,
            AVG(CAST(PassRate AS FLOAT))                  AS AvgPassRate,
            SUM(Violations)                               AS TotalViolations,
            SUM(Passes)                                   AS TotalPasses
        FROM dbo.ScanHistory
        WHERE TimestampUtc >= ? AND TimestampUtc < ?
        GROUP BY YEAR(TimestampUtc), MONTH(TimestampUtc)
        ORDER BY YEAR(TimestampUtc) ASC, MONTH(TimestampUtc) ASC
    """,
}

_SUMMARY_SQL = """
    SELECT
        COUNT(*)                      AS TotalScans,
        AVG(CAST(PassRate AS FLOAT))  AS AvgPassRate,
        SUM(Violations)               AS TotalViolations,
        SUM(Passes)                   AS TotalPasses
    FROM dbo.ScanHistory
    WHERE TimestampUtc >= ? AND TimestampUtc < ?
"""


def get_scan_trends(
    granularity: str = "daily",
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """
    Return time-bucketed scan aggregates for the trends dashboard.

    granularity: 'daily' | 'weekly' | 'monthly'
    start_date:  YYYY-MM-DD, inclusive (default: 30 days ago)
    end_date:    YYYY-MM-DD, inclusive (default: today)

    Returns {"data": [...], "summary": {...} | None}
    Each data item: date, scan_count, avg_pass_rate, total_violations, total_passes
    """
    if not is_enabled() or _INIT_ERROR:
        return {"data": [], "summary": None}
    if granularity not in _TREND_SQL:
        granularity = "daily"

    today = date.today()

    try:
        start = date.fromisoformat(start_date) if start_date else today - timedelta(days=30)
    except ValueError:
        start = today - timedelta(days=30)

    try:
        # end_date is inclusive from the caller's perspective; SQL uses strict <
        end = (date.fromisoformat(end_date) + timedelta(days=1)) if end_date else (today + timedelta(days=1))
    except ValueError:
        end = today + timedelta(days=1)

    start_str = start.isoformat()
    end_str = end.isoformat()

    conn = _conn()
    try:
        data: list[dict] = []
        with conn.cursor() as cur:
            cur.execute(_TREND_SQL[granularity], (start_str, end_str))
            for r in cur.fetchall():
                bucket = r[0]
                data.append({
                    "date": bucket.isoformat() if hasattr(bucket, "isoformat") else str(bucket),
                    "scan_count": int(r[1] or 0),
                    "avg_pass_rate": round(float(r[2] or 0), 1),
                    "total_violations": int(r[3] or 0),
                    "total_passes": int(r[4] or 0),
                })

        summary = None
        with conn.cursor() as cur:
            cur.execute(_SUMMARY_SQL, (start_str, end_str))
            row = cur.fetchone()
        if row and row[0]:
            summary = {
                "total_scans": int(row[0] or 0),
                "avg_pass_rate": round(float(row[1] or 0), 1),
                "total_violations": int(row[2] or 0),
                "total_passes": int(row[3] or 0),
            }

        return {"data": data, "summary": summary}
    finally:
        conn.close()


# ── Crawler persistence ────────────────────────────────────────────────────────

def _ts(value) -> str | None:
    """Convert a datetime to ISO string or return None."""
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def save_crawl_job(
    crawl_id: str,
    root_url: str,
    max_depth: int,
    max_pages: int,
    rq_job_id: str | None = None,
    status: str = "pending",
    created_at: str | None = None,
    notify_email: str | None = None,
    metadata: dict | None = None,
) -> None:
    if not is_enabled() or _INIT_ERROR:
        return
    created_at = created_at or datetime.utcnow().isoformat(timespec="milliseconds") + "Z"
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO dbo.CrawlJob
                    (CrawlId, RQJobId, RootUrl, Status, MaxDepth, MaxPages, CreatedAt, NotifyEmail, Metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (crawl_id, rq_job_id, root_url, status, max_depth, max_pages,
                 created_at, notify_email, json.dumps(metadata or {})),
            )
        conn.commit()
    finally:
        conn.close()


def update_crawl_job_status(
    crawl_id: str,
    status: str,
    started_at: str | None = None,
    ended_at: str | None = None,
    duration_seconds: float | None = None,
    failure_reason: str | None = None,
) -> None:
    if not is_enabled() or _INIT_ERROR:
        return
    updates = ["Status = ?"]
    params: list = [status]
    if started_at is not None:
        updates.append("StartedAt = ?")
        params.append(started_at)
    if ended_at is not None:
        updates.append("EndedAt = ?")
        params.append(ended_at)
    if duration_seconds is not None:
        updates.append("DurationSeconds = ?")
        params.append(duration_seconds)
    if failure_reason is not None:
        updates.append("FailureReason = ?")
        params.append(failure_reason)
    params.append(crawl_id)
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE dbo.CrawlJob SET {', '.join(updates)} WHERE CrawlId = ?",
                params,
            )
        conn.commit()
    finally:
        conn.close()


def get_crawl_job_status(crawl_id: str) -> str | None:
    if not is_enabled() or _INIT_ERROR:
        return None
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT Status FROM dbo.CrawlJob WHERE CrawlId = ?", (crawl_id,))
            row = cur.fetchone()
            return row.Status if row else None
    finally:
        conn.close()


def update_crawl_job_progress(
    crawl_id: str,
    total_discovered: int | None = None,
    total_scanned: int | None = None,
    total_failed: int | None = None,
) -> None:
    if not is_enabled() or _INIT_ERROR:
        return
    updates: list[str] = []
    params: list = []
    if total_discovered is not None:
        updates.append("TotalDiscovered = ?")
        params.append(total_discovered)
    if total_scanned is not None:
        updates.append("TotalScanned = ?")
        params.append(total_scanned)
    if total_failed is not None:
        updates.append("TotalFailed = ?")
        params.append(total_failed)
    if not updates:
        return
    params.append(crawl_id)
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE dbo.CrawlJob SET {', '.join(updates)} WHERE CrawlId = ?",
                params,
            )
        conn.commit()
    finally:
        conn.close()


def get_crawl_job(crawl_id: str) -> dict | None:
    if not is_enabled() or _INIT_ERROR:
        return None
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM dbo.CrawlJob WHERE CrawlId = ?",
                (crawl_id,),
            )
            row = cur.fetchone()
        if not row:
            return None
        meta = {}
        try:
            if row.Metadata:
                meta = json.loads(row.Metadata)
        except Exception:
            pass
        return {
            "crawl_id": row.CrawlId,
            "rq_job_id": row.RQJobId,
            "root_url": row.RootUrl,
            "status": row.Status,
            "max_depth": row.MaxDepth,
            "max_pages": row.MaxPages,
            "total_discovered": row.TotalDiscovered,
            "total_scanned": row.TotalScanned,
            "total_failed": row.TotalFailed,
            "created_at": _ts(row.CreatedAt),
            "started_at": _ts(row.StartedAt),
            "ended_at": _ts(row.EndedAt),
            "duration_seconds": row.DurationSeconds,
            "failure_reason": row.FailureReason,
            "notify_email": row.NotifyEmail,
            "site_score": meta.get("site_score"),
            "avg_pass_rate": meta.get("avg_pass_rate"),
            "total_violations": meta.get("total_violations"),
        }
    finally:
        conn.close()


def save_crawl_page(
    crawl_id: str,
    url: str,
    normalized_url: str,
    parent_url: str | None,
    depth: int,
    status: str = "running",
) -> int:
    """Insert a CrawlPage row and return its auto-increment Id (-1 if disabled)."""
    if not is_enabled() or _INIT_ERROR:
        return -1
    discovered_at = datetime.utcnow().isoformat(timespec="milliseconds") + "Z"
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO dbo.CrawlPage
                    (CrawlId, Url, NormalizedUrl, ParentUrl, Depth, Status, DiscoveredAt)
                OUTPUT INSERTED.Id
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (crawl_id, url[:2048], normalized_url[:2048],
                 parent_url[:2048] if parent_url else None,
                 depth, status, discovered_at),
            )
            row = cur.fetchone()
            page_id = int(row[0]) if row and row[0] is not None else -1
        conn.commit()
        return page_id
    finally:
        conn.close()


def update_crawl_page(
    page_id: int,
    status: str,
    passes: int | None = None,
    violations: int | None = None,
    pass_rate: int | None = None,
    scan_history_id: int | None = None,
    scanned_at: str | None = None,
    failure_reason: str | None = None,
    result_payload: str | None = None,
) -> None:
    if not is_enabled() or _INIT_ERROR or page_id < 0:
        return
    updates = ["Status = ?"]
    params: list = [status]
    if passes is not None:
        updates.append("Passes = ?")
        params.append(passes)
    if violations is not None:
        updates.append("Violations = ?")
        params.append(violations)
    if pass_rate is not None:
        updates.append("PassRate = ?")
        params.append(pass_rate)
    if scan_history_id is not None:
        updates.append("ScanHistoryId = ?")
        params.append(scan_history_id)
    if scanned_at is not None:
        updates.append("ScannedAt = ?")
        params.append(scanned_at)
    if failure_reason is not None:
        updates.append("FailureReason = ?")
        params.append(failure_reason)
    if result_payload is not None:
        updates.append("ResultPayload = ?")
        params.append(result_payload)
    params.append(page_id)
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE dbo.CrawlPage SET {', '.join(updates)} WHERE Id = ?",
                params,
            )
        conn.commit()
    finally:
        conn.close()


def get_crawl_pages(crawl_id: str) -> list[dict]:
    if not is_enabled() or _INIT_ERROR:
        return []
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT Id, CrawlId, Url, NormalizedUrl, ParentUrl, Depth, Status,
                       ScanHistoryId, Passes, Violations, PassRate,
                       DiscoveredAt, ScannedAt, FailureReason
                FROM dbo.CrawlPage
                WHERE CrawlId = ?
                ORDER BY Id ASC
                """,
                (crawl_id,),
            )
            rows = cur.fetchall()
        return [
            {
                "id": r.Id,
                "crawl_id": r.CrawlId,
                "url": r.Url,
                "normalized_url": r.NormalizedUrl,
                "parent_url": r.ParentUrl,
                "depth": r.Depth,
                "status": r.Status,
                "scan_history_id": f"SCAN-{r.ScanHistoryId}" if r.ScanHistoryId else None,
                "passes": r.Passes,
                "violations": r.Violations,
                "pass_rate": r.PassRate,
                "discovered_at": _ts(r.DiscoveredAt),
                "scanned_at": _ts(r.ScannedAt),
                "failure_reason": r.FailureReason,
            }
            for r in rows
        ]
    finally:
        conn.close()


def get_all_crawl_jobs(limit: int = 25) -> list[dict]:
    """
    Return recent crawl jobs ordered by CreatedAt DESC.
    Each dict: crawl_id, root_url, status, total_scanned, total_failed,
               created_at, ended_at, duration_seconds.
    Returns empty list when persistence is disabled or no rows exist.
    """
    if not is_enabled() or _INIT_ERROR:
        return []
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT TOP (?) CrawlId, RootUrl, Status,
                               TotalScanned, TotalFailed,
                               CreatedAt, EndedAt, DurationSeconds, Metadata
                FROM dbo.CrawlJob
                ORDER BY CreatedAt DESC
                """,
                (limit,),
            )
            rows = cur.fetchall()
        result = []
        for r in rows:
            meta = {}
            try:
                if r.Metadata:
                    meta = json.loads(r.Metadata)
            except Exception:
                pass
            result.append({
                "crawl_id": r.CrawlId,
                "root_url": r.RootUrl or "",
                "status": r.Status or "unknown",
                "total_scanned": int(r.TotalScanned or 0),
                "total_failed": int(r.TotalFailed or 0),
                "created_at": _ts(r.CreatedAt),
                "ended_at": _ts(r.EndedAt),
                "duration_seconds": float(r.DurationSeconds) if r.DurationSeconds is not None else None,
                "site_score": meta.get("site_score"),
                "avg_pass_rate": meta.get("avg_pass_rate"),
                "total_violations": meta.get("total_violations"),
            })
        return result
    finally:
        conn.close()


def finalize_crawl_summary(crawl_id: str) -> dict:
    """
    Compute aggregate metrics from CrawlPage rows at crawl completion and
    store them in CrawlJob.Metadata for fast retrieval in the history list.

    Returns {"avg_pass_rate": int|None, "total_violations": int, "site_score": int|None}.
    Safe to call when DB is unavailable — returns empty summary without raising.
    """
    summary: dict = {"avg_pass_rate": None, "total_violations": 0, "site_score": None}
    if not is_enabled() or _INIT_ERROR:
        return summary
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT AVG(CAST(PassRate AS FLOAT)), SUM(Violations)
                FROM dbo.CrawlPage
                WHERE CrawlId = ? AND Status = 'scanned'
                """,
                (crawl_id,),
            )
            row = cur.fetchone()
            avg_pass_rate = round(row[0]) if row and row[0] is not None else None
            total_violations = int(row[1]) if row and row[1] is not None else 0
            summary = {
                "avg_pass_rate": avg_pass_rate,
                "total_violations": total_violations,
                "site_score": avg_pass_rate,
            }
            cur.execute(
                "UPDATE dbo.CrawlJob SET Metadata = ? WHERE CrawlId = ?",
                (json.dumps(summary), crawl_id),
            )
        conn.commit()
    except Exception as exc:
        logger.warning("finalize_crawl_summary failed | crawl_id=%s err=%s", crawl_id, exc)
    finally:
        conn.close()
    return summary


# ── Violation intelligence ─────────────────────────────────────────────────────

def get_violation_intel(limit: int = 100) -> dict:
    """
    Aggregate violation intelligence from the most recent scan payloads.
    Parses ResultPayload.axeResult.violations for each row.
    Bad/null/malformed rows are silently skipped — one bad row never fails the call.

    Counts are per affected DOM node (not per unique rule), which gives a more
    accurate picture of how widespread each violation type is.

    Returns:
        severity_breakdown  – node counts keyed by impact level
        top_issue_types     – [{rule_id, count}] top 10 sorted desc
        wcag_breakdown      – [{tag, count}] sorted desc (wcag* tags only)
    """
    if not is_enabled() or _INIT_ERROR:
        return {
            "severity_breakdown": {"critical": 0, "serious": 0, "moderate": 0, "minor": 0},
            "top_issue_types": [],
            "wcag_breakdown": [],
        }
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT TOP (?) ResultPayload
                FROM dbo.ScanHistory
                WHERE ResultPayload IS NOT NULL
                ORDER BY TimestampUtc DESC
                """,
                (limit,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    severity: dict[str, int] = {"critical": 0, "serious": 0, "moderate": 0, "minor": 0}
    rule_counts: dict[str, int] = {}
    tag_counts: dict[str, int] = {}

    for row in rows:
        try:
            payload = json.loads(row[0]) if row[0] else None
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(payload, dict):
            continue
        axe = payload.get("axeResult") or {}
        if not isinstance(axe, dict):
            continue
        for v in (axe.get("violations") or []):
            if not isinstance(v, dict):
                continue
            impact = (v.get("impact") or "minor").lower()
            if impact not in severity:
                impact = "minor"
            # Count affected nodes; treat a fired rule with no nodes as 1 occurrence
            node_count = max(len(v.get("nodes") or []), 1)
            severity[impact] += node_count

            rule_id = v.get("id") or "unknown"
            rule_counts[rule_id] = rule_counts.get(rule_id, 0) + node_count

            for tag in (v.get("tags") or []):
                if isinstance(tag, str) and tag.lower().startswith("wcag"):
                    tag_counts[tag] = tag_counts.get(tag, 0) + node_count

    top_issue_types = sorted(
        [{"rule_id": k, "count": v} for k, v in rule_counts.items()],
        key=lambda x: x["count"],
        reverse=True,
    )[:10]

    wcag_breakdown = sorted(
        [{"tag": k, "count": v} for k, v in tag_counts.items()],
        key=lambda x: x["count"],
        reverse=True,
    )

    return {
        "severity_breakdown": severity,
        "top_issue_types": top_issue_types,
        "wcag_breakdown": wcag_breakdown,
    }


def get_regression_candidates() -> list[dict]:
    """
    Find URLs where the most recent scan has more violations than the previous scan.
    Uses only Url and Violations columns — no JSON parsing required.

    Returns list of {url, previous_violations, current_violations, delta}
    sorted by delta descending (worst regression first).
    """
    if not is_enabled() or _INIT_ERROR:
        return []
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                WITH ranked AS (
                    SELECT Url, Violations,
                           ROW_NUMBER() OVER (
                               PARTITION BY Url
                               ORDER BY TimestampUtc DESC
                           ) AS rn
                    FROM dbo.ScanHistory
                    WHERE Url IS NOT NULL AND Url != N''
                )
                SELECT
                    curr.Url,
                    prev.Violations AS PreviousViolations,
                    curr.Violations AS CurrentViolations
                FROM ranked curr
                JOIN ranked prev
                    ON curr.Url = prev.Url AND prev.rn = 2
                WHERE curr.rn = 1
                  AND curr.Violations > prev.Violations
                ORDER BY (curr.Violations - prev.Violations) DESC
            """)
            rows = cur.fetchall()
        return [
            {
                "url": row[0],
                "previous_violations": int(row[1]),
                "current_violations": int(row[2]),
                "delta": int(row[2]) - int(row[1]),
            }
            for row in rows
        ]
    finally:
        conn.close()


# ── Crawl analytics ────────────────────────────────────────────────────────────

import re as _re

_WCAG_PRINCIPLE_MAP = {'1': 'Perceivable', '2': 'Operable', '3': 'Understandable', '4': 'Robust'}

_WCAG_CRITERION_NAMES = {
    '1.1.1': 'Non-text Content',    '1.2.1': 'Audio-only & Video-only',
    '1.2.2': 'Captions',            '1.3.1': 'Info and Relationships',
    '1.3.2': 'Meaningful Sequence', '1.3.3': 'Sensory Characteristics',
    '1.4.1': 'Use of Color',        '1.4.2': 'Audio Control',
    '1.4.3': 'Contrast (Minimum)',  '1.4.4': 'Resize Text',
    '1.4.5': 'Images of Text',      '2.1.1': 'Keyboard',
    '2.1.2': 'No Keyboard Trap',    '2.2.1': 'Timing Adjustable',
    '2.2.2': 'Pause, Stop, Hide',   '2.3.1': 'Three Flashes',
    '2.4.1': 'Bypass Blocks',       '2.4.2': 'Page Titled',
    '2.4.3': 'Focus Order',         '2.4.4': 'Link Purpose',
    '2.4.6': 'Headings and Labels', '2.4.7': 'Focus Visible',
    '3.1.1': 'Language of Page',    '3.1.2': 'Language of Parts',
    '3.2.1': 'On Focus',            '3.2.2': 'On Input',
    '3.3.1': 'Error Identification', '3.3.2': 'Labels or Instructions',
    '4.1.1': 'Parsing',             '4.1.2': 'Name, Role, Value',
    '4.1.3': 'Status Messages',
}


def _wcag_tag_to_criterion(tag: str):
    """'wcag111' -> '1.1.1', 'wcag243' -> '2.4.3'. None for non-criterion tags."""
    m = _re.match(r'^wcag(\d)(\d)(\d)$', tag.lower())
    if m:
        return f'{m.group(1)}.{m.group(2)}.{m.group(3)}'
    return None


def get_crawl_violation_intel(crawl_id: str) -> dict:
    """
    Aggregate WCAG + severity + top-issue intelligence for a specific crawl.
    Parses ScanHistory.ResultPayload rows linked via CrawlPage.ScanHistoryId.
    """
    empty: dict = {
        "severity_breakdown": {"critical": 0, "serious": 0, "moderate": 0, "minor": 0},
        "top_issue_types": [],
        "wcag_breakdown": [],
        "wcag_principles": {"Perceivable": 0, "Operable": 0, "Understandable": 0, "Robust": 0},
    }
    if not is_enabled() or _INIT_ERROR:
        return empty

    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT cp.ResultPayload, cp.Url
                FROM dbo.CrawlPage cp
                WHERE cp.CrawlId = ? AND cp.Status = 'scanned'
                  AND cp.ResultPayload IS NOT NULL

                UNION ALL

                SELECT sh.ResultPayload, cp.Url
                FROM dbo.CrawlPage cp
                JOIN dbo.ScanHistory sh ON sh.Id = cp.ScanHistoryId
                WHERE cp.CrawlId = ? AND cp.Status = 'scanned'
                  AND cp.ResultPayload IS NULL
                  AND cp.ScanHistoryId IS NOT NULL
                  AND sh.ResultPayload IS NOT NULL
                """,
                (crawl_id, crawl_id),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    severity: dict[str, int] = {"critical": 0, "serious": 0, "moderate": 0, "minor": 0}
    rule_counts: dict[str, int] = {}
    rule_pages: dict[str, set] = {}
    criterion_counts: dict[str, int] = {}
    principle_counts: dict[str, int] = {p: 0 for p in _WCAG_PRINCIPLE_MAP.values()}

    for row in rows:
        try:
            payload = json.loads(row[0]) if row[0] else None
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(payload, dict):
            continue
        axe = payload.get("axeResult") or {}
        page_url = row[1] or (axe.get("url") or "")
        if not isinstance(axe, dict):
            continue
        for v in (axe.get("violations") or []):
            if not isinstance(v, dict):
                continue
            impact = (v.get("impact") or "minor").lower()
            if impact not in severity:
                impact = "minor"
            node_count = max(len(v.get("nodes") or []), 1)
            severity[impact] += node_count

            rule_id = v.get("id") or "unknown"
            rule_counts[rule_id] = rule_counts.get(rule_id, 0) + node_count
            rule_pages.setdefault(rule_id, set()).add(page_url)

            for tag in (v.get("tags") or []):
                if not isinstance(tag, str):
                    continue
                criterion = _wcag_tag_to_criterion(tag)
                if criterion:
                    criterion_counts[criterion] = criterion_counts.get(criterion, 0) + node_count
                    principle = _WCAG_PRINCIPLE_MAP.get(criterion[0])
                    if principle:
                        principle_counts[principle] = principle_counts.get(principle, 0) + node_count

    top_issue_types = sorted(
        [{"rule_id": k, "count": v, "affected_pages": len(rule_pages.get(k, set()))}
         for k, v in rule_counts.items()],
        key=lambda x: x["count"],
        reverse=True,
    )[:10]

    wcag_breakdown = sorted(
        [{
            "criterion": k,
            "name": _WCAG_CRITERION_NAMES.get(k, k),
            "principle": _WCAG_PRINCIPLE_MAP.get(k[0], "Unknown"),
            "count": v,
        } for k, v in criterion_counts.items()],
        key=lambda x: x["count"],
        reverse=True,
    )[:15]

    return {
        "severity_breakdown": severity,
        "top_issue_types": top_issue_types,
        "wcag_breakdown": wcag_breakdown,
        "wcag_principles": principle_counts,
    }


def get_crawl_regressions(crawl_id: str) -> dict:
    """
    Compare pages in crawl_id against the most recent previous completed crawl for
    the same root URL. Returns regressions, improvements, and new/removed pages.
    """
    empty: dict = {
        "previous_crawl_id": None, "previous_crawl_date": None,
        "has_comparison": False,
        "regressions": [], "improvements": [], "new_pages": [], "removed_pages": [],
    }
    if not is_enabled() or _INIT_ERROR:
        return empty

    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT RootUrl, CreatedAt FROM dbo.CrawlJob WHERE CrawlId = ?",
                (crawl_id,),
            )
            row = cur.fetchone()
            if not row:
                return empty
            root_url, created_at = row[0], row[1]

            cur.execute(
                """
                SELECT TOP 1 CrawlId, CreatedAt FROM dbo.CrawlJob
                WHERE RootUrl = ? AND Status = 'completed' AND CrawlId != ? AND CreatedAt < ?
                ORDER BY CreatedAt DESC
                """,
                (root_url, crawl_id, created_at),
            )
            prev = cur.fetchone()
            if not prev:
                return {**empty, "has_comparison": False}

            prev_crawl_id, prev_created_at = prev[0], prev[1]

            cur.execute(
                """
                SELECT curr.Url, ISNULL(curr.Violations, 0) AS CurrViol, prev.Violations AS PrevViol
                FROM dbo.CrawlPage curr
                LEFT JOIN dbo.CrawlPage prev
                    ON curr.NormalizedUrl = prev.NormalizedUrl AND prev.CrawlId = ?
                WHERE curr.CrawlId = ? AND curr.Status = 'scanned'
                """,
                (prev_crawl_id, crawl_id),
            )
            curr_rows = cur.fetchall()

            cur.execute(
                """
                SELECT prev.Url, ISNULL(prev.Violations, 0)
                FROM dbo.CrawlPage prev
                WHERE prev.CrawlId = ? AND prev.Status = 'scanned'
                  AND NOT EXISTS (
                      SELECT 1 FROM dbo.CrawlPage curr
                      WHERE curr.CrawlId = ? AND curr.NormalizedUrl = prev.NormalizedUrl
                  )
                """,
                (prev_crawl_id, crawl_id),
            )
            removed_rows = cur.fetchall()
    finally:
        conn.close()

    regressions, improvements, new_pages = [], [], []
    for r in curr_rows:
        curr_viol = int(r[1] or 0)
        if r[2] is None:
            new_pages.append({"url": r[0], "violations": curr_viol})
        else:
            prev_viol = int(r[2])
            delta = curr_viol - prev_viol
            entry = {"url": r[0], "previous_violations": prev_viol,
                     "current_violations": curr_viol, "delta": delta}
            if delta > 0:
                regressions.append(entry)
            elif delta < 0:
                improvements.append(entry)

    regressions.sort(key=lambda x: x["delta"], reverse=True)
    improvements.sort(key=lambda x: x["delta"])

    return {
        "previous_crawl_id": prev_crawl_id,
        "previous_crawl_date": _ts(prev_created_at),
        "has_comparison": True,
        "regressions": regressions[:25],
        "improvements": improvements[:25],
        "new_pages": new_pages[:25],
        "removed_pages": [{"url": r[0], "previous_violations": int(r[1] or 0)} for r in removed_rows][:25],
    }


def compare_crawls(crawl_id_a: str, crawl_id_b: str) -> dict | None:
    """
    Side-by-side comparison of two crawl runs: job metadata, page-level diffs, summary.
    Returns None if either crawl_id is not found.
    """
    if not is_enabled() or _INIT_ERROR:
        return None

    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT CrawlId, RootUrl, Status, CreatedAt, TotalScanned, TotalFailed,
                       DurationSeconds, Metadata
                FROM dbo.CrawlJob
                WHERE CrawlId IN (?, ?)
                """,
                (crawl_id_a, crawl_id_b),
            )
            job_map = {r[0]: r for r in cur.fetchall()}

            if crawl_id_a not in job_map or crawl_id_b not in job_map:
                return None

            def _parse_job(cid):
                r = job_map[cid]
                meta = {}
                try:
                    if r[7]:
                        meta = json.loads(r[7])
                except Exception:
                    pass
                return {
                    "crawl_id": r[0], "root_url": r[1], "status": r[2],
                    "created_at": _ts(r[3]),
                    "total_scanned": int(r[4] or 0), "total_failed": int(r[5] or 0),
                    "duration_seconds": float(r[6]) if r[6] is not None else None,
                    "site_score": meta.get("site_score"),
                    "avg_pass_rate": meta.get("avg_pass_rate"),
                    "total_violations": meta.get("total_violations"),
                }

            job_a = _parse_job(crawl_id_a)
            job_b = _parse_job(crawl_id_b)

            cur.execute(
                """
                SELECT CrawlId, NormalizedUrl, Url, ISNULL(Violations, 0), PassRate
                FROM dbo.CrawlPage
                WHERE CrawlId IN (?, ?) AND Status = 'scanned'
                """,
                (crawl_id_a, crawl_id_b),
            )
            page_rows = cur.fetchall()
    finally:
        conn.close()

    pages_a: dict[str, dict] = {}
    pages_b: dict[str, dict] = {}
    for r in page_rows:
        entry = {"url": r[2], "violations": int(r[3] or 0), "pass_rate": r[4]}
        (pages_a if r[0] == crawl_id_a else pages_b)[r[1]] = entry

    improved, regressed, unchanged, only_a, only_b = [], [], [], [], []
    for norm_url in set(pages_a) | set(pages_b):
        pa, pb = pages_a.get(norm_url), pages_b.get(norm_url)
        if pa and pb:
            delta = pb["violations"] - pa["violations"]
            e = {"url": pa["url"] or pb["url"],
                 "violations_a": pa["violations"], "violations_b": pb["violations"], "delta": delta}
            (regressed if delta > 0 else improved if delta < 0 else unchanged).append(e)
        elif pa:
            only_a.append({"url": pa["url"], "violations": pa["violations"]})
        else:
            only_b.append({"url": pb["url"], "violations": pb["violations"]})

    regressed.sort(key=lambda x: x["delta"], reverse=True)
    improved.sort(key=lambda x: x["delta"])

    def _d(a, b):
        return (b - a) if (a is not None and b is not None) else None

    return {
        "crawl_a": job_a, "crawl_b": job_b,
        "summary": {
            "score_delta": _d(job_a["site_score"], job_b["site_score"]),
            "pass_rate_delta": _d(job_a["avg_pass_rate"], job_b["avg_pass_rate"]),
            "violations_delta": _d(job_a["total_violations"], job_b["total_violations"]),
            "pages_improved": len(improved), "pages_regressed": len(regressed),
            "pages_unchanged": len(unchanged),
            "pages_only_in_a": len(only_a), "pages_only_in_b": len(only_b),
        },
        "regressed": regressed[:15],
        "improved": improved[:15],
        "only_in_a": only_a[:10],
        "only_in_b": only_b[:10],
    }


def get_crawl_score_timeline(root_url: str, limit: int = 20) -> list[dict]:
    """Return score history for all completed crawls of root_url, oldest first."""
    if not is_enabled() or _INIT_ERROR:
        return []
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT TOP (?) CrawlId, CreatedAt, TotalScanned, DurationSeconds, Metadata
                FROM dbo.CrawlJob
                WHERE RootUrl = ? AND Status = 'completed'
                ORDER BY CreatedAt ASC
                """,
                (limit, root_url),
            )
            rows = cur.fetchall()
        out = []
        for r in rows:
            meta = {}
            try:
                if r[4]:
                    meta = json.loads(r[4])
            except Exception:
                pass
            out.append({
                "crawl_id": r[0],
                "created_at": _ts(r[1]),
                "total_scanned": int(r[2] or 0),
                "duration_seconds": float(r[3]) if r[3] is not None else None,
                "site_score": meta.get("site_score"),
                "avg_pass_rate": meta.get("avg_pass_rate"),
                "total_violations": meta.get("total_violations"),
            })
        return out
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# Phase 3 — CrawlSchedule
# ═══════════════════════════════════════════════════════════════════════════

def _compute_next_run(frequency: str, from_dt=None, time_of_day=None):
    from datetime import timezone, timedelta
    now = from_dt or datetime.now(timezone.utc)
    if frequency == "daily":
        next_run = now + timedelta(days=1)
    elif frequency == "monthly":
        next_run = now + timedelta(days=30)
    else:
        next_run = now + timedelta(weeks=1)
    if time_of_day is not None:
        next_run = next_run.replace(
            hour=time_of_day.hour, minute=time_of_day.minute, second=0, microsecond=0
        )
    return next_run


def _time_str(value) -> str | None:
    """Format a TIME column value ('HH:MM') or return None."""
    if value is None:
        return None
    if hasattr(value, "hour"):
        return f"{value.hour:02d}:{value.minute:02d}"
    return str(value)[:5]


def parse_time_of_day(value: str):
    """Parse an 'HH:MM' string into a datetime.time, or None if blank/invalid."""
    from datetime import time as _dtime
    if not value:
        return None
    try:
        hh, mm = value.strip().split(":")[:2]
        return _dtime(int(hh), int(mm))
    except (ValueError, TypeError):
        return None


def create_crawl_schedule(root_url: str, frequency: str = "weekly", name: str | None = None,
                           time_of_day=None) -> dict | None:
    if not is_enabled() or _INIT_ERROR:
        return None
    frequency = frequency if frequency in ("daily", "weekly", "monthly") else "weekly"
    next_run = _compute_next_run(frequency, time_of_day=time_of_day)
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO dbo.CrawlSchedule (RootUrl, Frequency, Enabled, NextRunAt, Name, TimeOfDay)
                OUTPUT INSERTED.Id, INSERTED.CreatedAt
                VALUES (?, ?, 1, ?, ?, ?)
                """,
                (root_url, frequency, next_run, name, time_of_day),
            )
            row = cur.fetchone()
            conn.commit()
        return {
            "id": row[0],
            "root_url": root_url,
            "frequency": frequency,
            "enabled": True,
            "name": name,
            "time_of_day": _time_str(time_of_day),
            "last_run_at": None,
            "next_run_at": _ts(next_run),
            "created_at": _ts(row[1]),
        }
    finally:
        conn.close()


def get_crawl_schedules() -> list[dict]:
    if not is_enabled() or _INIT_ERROR:
        return []
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.Id, s.RootUrl, s.Frequency, s.Enabled, s.LastRunAt, s.NextRunAt,
                       s.CreatedAt, s.Name, s.TimeOfDay,
                       (SELECT COUNT(1) FROM dbo.CrawlJob cj
                        WHERE cj.RootUrl = s.RootUrl AND cj.Status IN ('pending', 'running')) AS ActiveCount,
                       (SELECT TOP 1 cj2.Status FROM dbo.CrawlJob cj2
                        WHERE cj2.RootUrl = s.RootUrl ORDER BY cj2.CreatedAt DESC) AS LastRunStatus,
                       (SELECT TOP 1 cj3.CrawlId FROM dbo.CrawlJob cj3
                        WHERE cj3.RootUrl = s.RootUrl ORDER BY cj3.CreatedAt DESC) AS LastRunCrawlId
                FROM dbo.CrawlSchedule s
                ORDER BY s.CreatedAt DESC
                """
            )
            rows = cur.fetchall()
        result = []
        for r in rows:
            is_running = (r[9] or 0) > 0
            result.append({
                "id": r[0],
                "root_url": r[1],
                "frequency": r[2],
                "enabled": bool(r[3]),
                "last_run_at": _ts(r[4]),
                "next_run_at": _ts(r[5]),
                "created_at": _ts(r[6]),
                "name": r[7],
                "time_of_day": _time_str(r[8]),
                "status": "running" if is_running else ("active" if bool(r[3]) else "paused"),
                "last_run_status": r[10],
                "last_run_crawl_id": r[11],
            })
        return result
    finally:
        conn.close()


def get_crawl_schedule(schedule_id: int) -> dict | None:
    if not is_enabled() or _INIT_ERROR:
        return None
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT Id, RootUrl, Frequency, Enabled, Name, TimeOfDay FROM dbo.CrawlSchedule WHERE Id = ?",
                (schedule_id,),
            )
            row = cur.fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "root_url": row[1],
            "frequency": row[2],
            "enabled": bool(row[3]),
            "name": row[4],
            "time_of_day": _time_str(row[5]),
        }
    finally:
        conn.close()


def get_active_crawl_id_for_url(root_url: str) -> str | None:
    """Return the crawl_id of the currently running/pending crawl for root_url, if any."""
    if not is_enabled() or _INIT_ERROR:
        return None
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT TOP 1 CrawlId FROM dbo.CrawlJob
                WHERE RootUrl = ? AND Status IN ('pending', 'running')
                ORDER BY CreatedAt DESC
                """,
                (root_url,),
            )
            row = cur.fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def get_schedule_runs(root_url: str, limit: int = 5) -> list[dict]:
    """Return the most recent crawl runs for a schedule's root URL."""
    if not is_enabled() or _INIT_ERROR:
        return []
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT TOP (?) CrawlId, Status, TotalScanned, TotalFailed, CreatedAt, EndedAt, DurationSeconds
                FROM dbo.CrawlJob
                WHERE RootUrl = ?
                ORDER BY CreatedAt DESC
                """,
                (limit, root_url),
            )
            rows = cur.fetchall()
        return [
            {
                "crawl_id": r[0],
                "status": r[1],
                "total_scanned": r[2],
                "total_failed": r[3],
                "created_at": _ts(r[4]),
                "ended_at": _ts(r[5]),
                "duration_seconds": r[6],
            }
            for r in rows
        ]
    finally:
        conn.close()


def get_due_schedules() -> list[dict]:
    """Return enabled schedules whose NextRunAt is in the past."""
    if not is_enabled() or _INIT_ERROR:
        return []
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT Id, RootUrl, Frequency, TimeOfDay
                FROM dbo.CrawlSchedule
                WHERE Enabled = 1 AND NextRunAt <= GETUTCDATE()
                """
            )
            rows = cur.fetchall()
        return [{"id": r[0], "root_url": r[1], "frequency": r[2], "time_of_day": r[3]} for r in rows]
    finally:
        conn.close()


def mark_schedule_ran(schedule_id: int, frequency: str, time_of_day=None) -> bool:
    if not is_enabled() or _INIT_ERROR:
        return False
    next_run = _compute_next_run(frequency, time_of_day=time_of_day)
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE dbo.CrawlSchedule
                SET LastRunAt = GETUTCDATE(), NextRunAt = ?, UpdatedAt = GETUTCDATE()
                WHERE Id = ?
                """,
                (next_run, schedule_id),
            )
            conn.commit()
        return True
    except Exception:
        logger.exception("mark_schedule_ran failed for id=%s", schedule_id)
        return False
    finally:
        conn.close()


def update_crawl_schedule(schedule_id: int, **kwargs) -> bool:
    """Update Name, Enabled, Frequency, and/or TimeOfDay for a schedule."""
    if not is_enabled() or _INIT_ERROR:
        return False
    allowed = {}
    if "enabled" in kwargs:
        allowed["Enabled"] = 1 if kwargs["enabled"] else 0
    if "name" in kwargs:
        allowed["Name"] = kwargs["name"]

    freq_changed = "frequency" in kwargs and kwargs["frequency"] in ("daily", "weekly", "monthly")
    tod_changed = "time_of_day" in kwargs
    if freq_changed or tod_changed:
        conn = _conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT Frequency, TimeOfDay FROM dbo.CrawlSchedule WHERE Id = ?",
                    (schedule_id,),
                )
                row = cur.fetchone()
        finally:
            conn.close()
        if not row:
            return False
        frequency = kwargs["frequency"] if freq_changed else row[0]
        time_of_day = kwargs["time_of_day"] if tod_changed else row[1]
        if freq_changed:
            allowed["Frequency"] = frequency
        if tod_changed:
            allowed["TimeOfDay"] = time_of_day
        allowed["NextRunAt"] = _compute_next_run(frequency, time_of_day=time_of_day)

    if not allowed:
        return False
    set_parts = ", ".join(f"{k} = ?" for k in allowed)
    values = list(allowed.values()) + [schedule_id]
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE dbo.CrawlSchedule SET {set_parts}, UpdatedAt = GETUTCDATE() WHERE Id = ?",
                values,
            )
            conn.commit()
        return True
    except Exception:
        logger.exception("update_crawl_schedule failed for id=%s", schedule_id)
        return False
    finally:
        conn.close()


def delete_crawl_schedule(schedule_id: int) -> bool:
    if not is_enabled() or _INIT_ERROR:
        return False
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM dbo.CrawlSchedule WHERE Id = ?", (schedule_id,))
            conn.commit()
        return True
    except Exception:
        logger.exception("delete_crawl_schedule failed for id=%s", schedule_id)
        return False
    finally:
        conn.close()


def has_active_crawl_for_url(root_url: str) -> bool:
    """Return True if a crawl is currently running or pending for root_url."""
    if not is_enabled() or _INIT_ERROR:
        return False
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(1) FROM dbo.CrawlJob
                WHERE RootUrl = ? AND Status IN ('pending', 'running')
                """,
                (root_url,),
            )
            row = cur.fetchone()
        return (row[0] if row else 0) > 0
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# Phase 3 — AI Summary (stored in CrawlJob.Metadata)
# ═══════════════════════════════════════════════════════════════════════════

def get_crawl_ai_summary(crawl_id: str) -> str | None:
    """Return the stored AI summary text for a crawl, or None."""
    if not is_enabled() or _INIT_ERROR:
        return None
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT Metadata FROM dbo.CrawlJob WHERE CrawlId = ?", (crawl_id,))
            row = cur.fetchone()
        if not row or not row[0]:
            return None
        meta = json.loads(row[0])
        return meta.get("ai_summary")
    except Exception:
        return None
    finally:
        conn.close()


def set_crawl_ai_summary(crawl_id: str, summary_text: str) -> bool:
    """Merge ai_summary into CrawlJob.Metadata JSON."""
    if not is_enabled() or _INIT_ERROR:
        return False
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT Metadata FROM dbo.CrawlJob WHERE CrawlId = ?", (crawl_id,))
            row = cur.fetchone()
            meta = {}
            if row and row[0]:
                try:
                    meta = json.loads(row[0])
                except Exception:
                    pass
            meta["ai_summary"] = summary_text
            cur.execute(
                "UPDATE dbo.CrawlJob SET Metadata = ? WHERE CrawlId = ?",
                (json.dumps(meta), crawl_id),
            )
            conn.commit()
        return True
    except Exception:
        logger.exception("set_crawl_ai_summary failed for crawl_id=%s", crawl_id)
        return False
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# Phase 3 — AccessibilityAlert
# ═══════════════════════════════════════════════════════════════════════════

def create_alert(crawl_id: str, root_url: str, alert_type: str, severity: str, details: dict) -> int | None:
    if not is_enabled() or _INIT_ERROR:
        return None
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO dbo.AccessibilityAlert (CrawlId, RootUrl, AlertType, Severity, Details)
                OUTPUT INSERTED.Id
                VALUES (?, ?, ?, ?, ?)
                """,
                (crawl_id, root_url, alert_type, severity, json.dumps(details)),
            )
            row = cur.fetchone()
            conn.commit()
        return row[0] if row else None
    except Exception:
        logger.exception("create_alert failed for crawl_id=%s", crawl_id)
        return None
    finally:
        conn.close()


def get_alerts(status: str | None = None, limit: int = 50) -> list[dict]:
    if not is_enabled() or _INIT_ERROR:
        return []
    conn = _conn()
    try:
        with conn.cursor() as cur:
            if status:
                cur.execute(
                    f"""
                    SELECT TOP (?) Id, CrawlId, RootUrl, AlertType, Severity, Details, Status, CreatedAt
                    FROM dbo.AccessibilityAlert WHERE Status = ? ORDER BY CreatedAt DESC
                    """,
                    (limit, status),
                )
            else:
                cur.execute(
                    f"""
                    SELECT TOP (?) Id, CrawlId, RootUrl, AlertType, Severity, Details, Status, CreatedAt
                    FROM dbo.AccessibilityAlert ORDER BY CreatedAt DESC
                    """,
                    (limit,),
                )
            rows = cur.fetchall()
        out = []
        for r in rows:
            details = {}
            try:
                if r[5]:
                    details = json.loads(r[5])
            except Exception:
                pass
            out.append({
                "id": r[0],
                "crawl_id": r[1],
                "root_url": r[2],
                "alert_type": r[3],
                "severity": r[4],
                "details": details,
                "status": r[6],
                "created_at": _ts(r[7]),
            })
        return out
    finally:
        conn.close()


def acknowledge_alert(alert_id: int) -> bool:
    if not is_enabled() or _INIT_ERROR:
        return False
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE dbo.AccessibilityAlert SET Status = 'acknowledged' WHERE Id = ?",
                (alert_id,),
            )
            conn.commit()
        return True
    except Exception:
        return False
    finally:
        conn.close()


def get_unacknowledged_alert_count() -> int:
    if not is_enabled() or _INIT_ERROR:
        return 0
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(1) FROM dbo.AccessibilityAlert WHERE Status = 'active'")
            row = cur.fetchone()
        return int(row[0]) if row else 0
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# Phase 3 — Page Trends (most improved / most regressed)
# ═══════════════════════════════════════════════════════════════════════════

def get_page_trends(crawl_id: str) -> dict:
    """
    Compare pages in crawl_id against the previous completed crawl for the same root URL.
    Returns most_improved and most_regressed ranked lists.
    """
    empty = {"has_comparison": False, "most_improved": [], "most_regressed": []}
    if not is_enabled() or _INIT_ERROR:
        return empty
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT RootUrl, CreatedAt FROM dbo.CrawlJob WHERE CrawlId = ?", (crawl_id,))
            row = cur.fetchone()
        if not row:
            return empty
        root_url, created_at = row[0], row[1]

        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT TOP 1 CrawlId FROM dbo.CrawlJob
                WHERE RootUrl = ? AND Status = 'completed'
                  AND CrawlId != ? AND CreatedAt < ?
                ORDER BY CreatedAt DESC
                """,
                (root_url, crawl_id, created_at),
            )
            prev_row = cur.fetchone()
        if not prev_row:
            return empty
        prev_id = prev_row[0]

        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT cur.Url,
                       ISNULL(prev.Violations, 0) AS PrevViol,
                       ISNULL(cur.Violations, 0)  AS CurViol,
                       ISNULL(prev.PassRate, 0)   AS PrevRate,
                       ISNULL(cur.PassRate, 0)    AS CurRate
                FROM dbo.CrawlPage cur
                JOIN dbo.CrawlPage prev ON prev.NormalizedUrl = cur.NormalizedUrl
                                       AND prev.CrawlId = ?
                WHERE cur.CrawlId = ?
                  AND cur.Status = 'scanned'
                  AND prev.Status = 'scanned'
                """,
                (prev_id, crawl_id),
            )
            rows = cur.fetchall()

        pages = [
            {
                "url": r[0],
                "prev_violations": int(r[1] or 0),
                "curr_violations": int(r[2] or 0),
                "prev_pass_rate": int(r[3] or 0),
                "curr_pass_rate": int(r[4] or 0),
                "violation_delta": int(r[2] or 0) - int(r[1] or 0),
                "pass_rate_delta": int(r[4] or 0) - int(r[3] or 0),
            }
            for r in rows
        ]

        most_regressed = sorted(
            [p for p in pages if p["violation_delta"] > 0],
            key=lambda p: p["violation_delta"],
            reverse=True,
        )[:10]

        most_improved = sorted(
            [p for p in pages if p["violation_delta"] < 0],
            key=lambda p: p["violation_delta"],
        )[:10]

        return {
            "has_comparison": True,
            "previous_crawl_id": prev_id,
            "most_improved": most_improved,
            "most_regressed": most_regressed,
        }
    except Exception:
        logger.exception("get_page_trends failed for crawl_id=%s", crawl_id)
        return empty
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# AssistiveScanHistory
# ═══════════════════════════════════════════════════════════════════════════

def save_assistive_scan(
    scan_type: str,
    url: str,
    passed: bool,
    result_payload: dict,
) -> int | None:
    """
    Persist one assistive test run (keyboard or contrast).
    Returns the auto-assigned Id or None if persistence is disabled.
    """
    if not is_enabled() or _INIT_ERROR:
        return None
    timestamp = datetime.utcnow().isoformat(timespec="milliseconds") + "Z"
    payload_json = json.dumps(result_payload) if result_payload else None
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO dbo.AssistiveScanHistory
                    (ScanType, Url, TimestampUtc, Passed, ResultPayload)
                OUTPUT INSERTED.Id
                VALUES (?, ?, ?, ?, ?)
                """,
                (scan_type[:50], url[:2048], timestamp, 1 if passed else 0, payload_json),
            )
            row = cur.fetchone()
            new_id = int(row[0]) if row and row[0] is not None else None
        conn.commit()
        return new_id
    except Exception:
        logger.exception("save_assistive_scan failed | scan_type=%s url=%s", scan_type, url)
        return None
    finally:
        conn.close()


def get_assistive_scans(
    scan_type: str | None = None,
    url: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    limit: int = 200,
) -> list[dict]:
    """
    Return AssistiveScanHistory rows, newest first.
    Supports optional filtering by scan_type, url substring, and date range.
    """
    if not is_enabled() or _INIT_ERROR:
        return []
    conditions = []
    params: list = []
    if scan_type:
        conditions.append("ScanType = ?")
        params.append(scan_type)
    if url:
        conditions.append("Url LIKE ?")
        params.append(f"%{url}%")
    if from_date:
        conditions.append("TimestampUtc >= ?")
        params.append(from_date)
    if to_date:
        conditions.append("TimestampUtc < ?")
        params.append(to_date)
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT TOP (?) Id, ScanType, Url, TimestampUtc, Passed
                FROM dbo.AssistiveScanHistory
                {where}
                ORDER BY TimestampUtc DESC
                """,
                [limit] + params,
            )
            rows = cur.fetchall()
        out = []
        for r in rows:
            ts = r.TimestampUtc
            if hasattr(ts, "isoformat"):
                ts = ts.isoformat()
            out.append({
                "id": r.Id,
                "scan_type": r.ScanType,
                "url": r.Url or "",
                "timestamp": ts,
                "passed": bool(r.Passed),
            })
        return out
    finally:
        conn.close()


# ── Integration CRUD ──────────────────────────────────────────────────────────

def save_integration(user_id: int, platform: str, workspace_id: str,
                     workspace_name: str, access_token: str | None) -> int:
    """Upsert a workspace connection. Returns the Integration.Id."""
    if not is_enabled() or _INIT_ERROR:
        raise RuntimeError("Database not available")
    conn = _conn()
    try:
        cur = conn.cursor()
        # Update if same workspace already exists for this user
        cur.execute("""
            UPDATE dbo.Integration
            SET WorkspaceName = ?, AccessToken = ?, Status = 'active'
            WHERE UserId = ? AND Platform = ? AND WorkspaceId = ?
        """, workspace_name, access_token, user_id, platform, workspace_id)
        if cur.rowcount == 0:
            cur.execute("""
                INSERT INTO dbo.Integration (UserId, Platform, WorkspaceId, WorkspaceName, AccessToken)
                OUTPUT INSERTED.Id
                VALUES (?, ?, ?, ?, ?)
            """, user_id, platform, workspace_id, workspace_name, access_token)
            row = cur.fetchone()
            conn.commit()
            return int(row[0])
        conn.commit()
        cur.execute("""
            SELECT Id FROM dbo.Integration
            WHERE UserId = ? AND Platform = ? AND WorkspaceId = ?
        """, user_id, platform, workspace_id)
        return int(cur.fetchone()[0])
    finally:
        conn.close()


def get_integrations(user_id: int) -> list[dict]:
    """Return all active integrations for a user."""
    if not is_enabled() or _INIT_ERROR:
        return []
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT i.Id, i.Platform, i.WorkspaceId, i.WorkspaceName, i.ConnectedAt,
                   (SELECT COUNT(*) FROM dbo.IntegrationChannel c WHERE c.IntegrationId = i.Id) AS ChannelCount
            FROM dbo.Integration i
            WHERE i.UserId = ? AND i.Status = 'active'
            ORDER BY i.ConnectedAt DESC
        """, user_id)
        rows = cur.fetchall()
    finally:
        conn.close()
    out = []
    for r in rows:
        ts = r.ConnectedAt
        if hasattr(ts, "isoformat"):
            ts = ts.isoformat()
        out.append({
            "id": r.Id,
            "platform": r.Platform,
            "workspace_id": r.WorkspaceId,
            "workspace_name": r.WorkspaceName,
            "connected_at": ts,
            "channel_count": r.ChannelCount,
        })
    return out


def get_integration(integration_id: int, user_id: int) -> dict | None:
    """Fetch a single integration, verifying ownership."""
    if not is_enabled() or _INIT_ERROR:
        return None
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT Id, Platform, WorkspaceId, WorkspaceName, AccessToken, ConnectedAt
            FROM dbo.Integration
            WHERE Id = ? AND UserId = ? AND Status = 'active'
        """, integration_id, user_id)
        r = cur.fetchone()
    finally:
        conn.close()
    if not r:
        return None
    ts = r.ConnectedAt
    if hasattr(ts, "isoformat"):
        ts = ts.isoformat()
    return {
        "id": r.Id,
        "platform": r.Platform,
        "workspace_id": r.WorkspaceId,
        "workspace_name": r.WorkspaceName,
        "access_token": r.AccessToken,
        "connected_at": ts,
    }


def delete_integration(integration_id: int, user_id: int) -> bool:
    """Soft-delete an integration and its channels."""
    if not is_enabled() or _INIT_ERROR:
        return False
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            UPDATE dbo.Integration SET Status = 'disconnected'
            WHERE Id = ? AND UserId = ?
        """, integration_id, user_id)
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def save_integration_channel(integration_id: int, channel_id: str,
                              channel_name: str, purpose: str | None,
                              webhook_url: str | None = None) -> int:
    """Add or update a channel on an integration. Returns IntegrationChannel.Id."""
    if not is_enabled() or _INIT_ERROR:
        raise RuntimeError("Database not available")
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            UPDATE dbo.IntegrationChannel
            SET ChannelName = ?, Purpose = ?, WebhookUrl = ?
            WHERE IntegrationId = ? AND ChannelId = ?
        """, channel_name, purpose, webhook_url, integration_id, channel_id)
        if cur.rowcount == 0:
            cur.execute("""
                INSERT INTO dbo.IntegrationChannel
                    (IntegrationId, ChannelId, ChannelName, Purpose, WebhookUrl)
                OUTPUT INSERTED.Id
                VALUES (?, ?, ?, ?, ?)
            """, integration_id, channel_id, channel_name, purpose, webhook_url)
            row = cur.fetchone()
            conn.commit()
            return int(row[0])
        conn.commit()
        cur.execute("""
            SELECT Id FROM dbo.IntegrationChannel
            WHERE IntegrationId = ? AND ChannelId = ?
        """, integration_id, channel_id)
        return int(cur.fetchone()[0])
    finally:
        conn.close()


def get_integration_channels(integration_id: int) -> list[dict]:
    """Return configured channels for an integration."""
    if not is_enabled() or _INIT_ERROR:
        return []
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT Id, ChannelId, ChannelName, Purpose, WebhookUrl, AddedAt
            FROM dbo.IntegrationChannel
            WHERE IntegrationId = ?
            ORDER BY AddedAt
        """, integration_id)
        rows = cur.fetchall()
    finally:
        conn.close()
    out = []
    for r in rows:
        ts = r.AddedAt
        if hasattr(ts, "isoformat"):
            ts = ts.isoformat()
        out.append({
            "id": r.Id,
            "channel_id": r.ChannelId,
            "channel_name": r.ChannelName,
            "purpose": r.Purpose,
            "webhook_url": r.WebhookUrl,
            "added_at": ts,
        })
    return out


def delete_integration_channel(integration_id: int, channel_id: str) -> bool:
    if not is_enabled() or _INIT_ERROR:
        return False
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            DELETE FROM dbo.IntegrationChannel
            WHERE IntegrationId = ? AND ChannelId = ?
        """, integration_id, channel_id)
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def log_integration_delivery(integration_id: int, channel_id: str | None,
                              channel_name: str | None, report_type: str,
                              status: str, error_msg: str | None = None,
                              reference: str | None = None) -> None:
    if not is_enabled() or _INIT_ERROR:
        return
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO dbo.IntegrationDelivery
                (IntegrationId, ChannelId, ChannelName, ReportType, Status, ErrorMessage, Reference)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, integration_id, channel_id, channel_name, report_type, status, error_msg, reference)
        conn.commit()
    finally:
        conn.close()


def get_integration_deliveries(user_id: int, limit: int = 20) -> list[dict]:
    """Recent delivery log entries across all integrations for a user."""
    if not is_enabled() or _INIT_ERROR:
        return []
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT TOP (?) d.Id, d.ReportType, d.Status, d.SentAt,
                           d.ChannelName, d.ErrorMessage, d.Reference,
                           i.Platform, i.WorkspaceName
            FROM dbo.IntegrationDelivery d
            JOIN dbo.Integration i ON i.Id = d.IntegrationId
            WHERE i.UserId = ?
            ORDER BY d.SentAt DESC
        """, limit, user_id)
        rows = cur.fetchall()
    finally:
        conn.close()
    out = []
    for r in rows:
        ts = r.SentAt
        if hasattr(ts, "isoformat"):
            ts = ts.isoformat()
        out.append({
            "id": r.Id,
            "report_type": r.ReportType,
            "status": r.Status,
            "sent_at": ts,
            "channel_name": r.ChannelName,
            "error_message": r.ErrorMessage,
            "reference": r.Reference,
            "platform": r.Platform,
            "workspace_name": r.WorkspaceName,
        })
    return out


# ── Repo Link CRUD (Auto-Fix source repo) ──────────────────────────────────────

def _normalize_path_prefix(path: str) -> str:
    """'' for a link that owns its whole domain, otherwise always trailing-slashed
    so prefix matching can't confuse '/ada-test' with '/ada-test-lab/...'."""
    path = (path or "").strip()
    if not path or path == "/":
        return ""
    if not path.endswith("/"):
        path += "/"
    return path


def save_repo_link(user_id: int, domain: str, site_url: str, repo_url: str,
                    default_branch: str, framework: str, access_token: str | None,
                    path_prefix: str = "") -> int:
    """Upsert a site-to-repo link, keyed on domain + path prefix (not domain alone —
    multiple sites can share one domain, e.g. two GitHub Pages project sites under
    the same *.github.io host). Returns RepoLink.Id."""
    if not is_enabled() or _INIT_ERROR:
        raise RuntimeError("Database not available")
    path_prefix = _normalize_path_prefix(path_prefix)
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            UPDATE dbo.RepoLink
            SET SiteUrl = ?, RepoUrl = ?, DefaultBranch = ?, Framework = ?,
                AccessToken = ?, Status = 'active'
            WHERE UserId = ? AND Domain = ? AND PathPrefix = ?
        """, site_url, repo_url, default_branch, framework, access_token, user_id, domain, path_prefix)
        if cur.rowcount == 0:
            cur.execute("""
                INSERT INTO dbo.RepoLink
                    (UserId, Domain, PathPrefix, SiteUrl, RepoUrl, DefaultBranch, Framework, AccessToken)
                OUTPUT INSERTED.Id
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, user_id, domain, path_prefix, site_url, repo_url, default_branch, framework, access_token)
            row = cur.fetchone()
            conn.commit()
            return int(row[0])
        conn.commit()
        cur.execute("""
            SELECT Id FROM dbo.RepoLink WHERE UserId = ? AND Domain = ? AND PathPrefix = ?
        """, user_id, domain, path_prefix)
        return int(cur.fetchone()[0])
    finally:
        conn.close()


def get_repo_links(user_id: int) -> list[dict]:
    """Return all active repo links for a user (no access token)."""
    if not is_enabled() or _INIT_ERROR:
        return []
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT Id, Domain, PathPrefix, SiteUrl, RepoUrl, DefaultBranch, Framework, ConnectedAt
            FROM dbo.RepoLink
            WHERE UserId = ? AND Status = 'active'
            ORDER BY ConnectedAt DESC
        """, user_id)
        rows = cur.fetchall()
    finally:
        conn.close()
    out = []
    for r in rows:
        ts = r.ConnectedAt
        if hasattr(ts, "isoformat"):
            ts = ts.isoformat()
        out.append({
            "id": r.Id,
            "domain": r.Domain,
            "path_prefix": r.PathPrefix,
            "site_url": r.SiteUrl,
            "repo_url": r.RepoUrl,
            "default_branch": r.DefaultBranch,
            "framework": r.Framework,
            "connected_at": ts,
        })
    return out


def get_repo_link(link_id: int, user_id: int) -> dict | None:
    """Fetch a single repo link including its access token, verifying ownership."""
    if not is_enabled() or _INIT_ERROR:
        return None
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT Id, Domain, PathPrefix, SiteUrl, RepoUrl, DefaultBranch, Framework, AccessToken, ConnectedAt
            FROM dbo.RepoLink
            WHERE Id = ? AND UserId = ? AND Status = 'active'
        """, link_id, user_id)
        r = cur.fetchone()
    finally:
        conn.close()
    if not r:
        return None
    ts = r.ConnectedAt
    if hasattr(ts, "isoformat"):
        ts = ts.isoformat()
    return {
        "id": r.Id,
        "domain": r.Domain,
        "path_prefix": r.PathPrefix,
        "site_url": r.SiteUrl,
        "repo_url": r.RepoUrl,
        "default_branch": r.DefaultBranch,
        "framework": r.Framework,
        "access_token": r.AccessToken,
        "connected_at": ts,
    }


def get_repo_link_for_url(page_url: str, user_id: int) -> dict | None:
    """
    Find the repo link that best matches a page URL — same domain, and the
    longest PathPrefix that's actually a prefix of the page's path. Needed
    because Domain alone can't tell apart two sites sharing one host (e.g.
    two GitHub Pages project sites under the same *.github.io domain).
    """
    if not is_enabled() or _INIT_ERROR:
        return None
    parsed = _urlparse(page_url)
    domain = parsed.netloc
    path = parsed.path or "/"
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT Id, Domain, PathPrefix, SiteUrl, RepoUrl, DefaultBranch, Framework, AccessToken, ConnectedAt
            FROM dbo.RepoLink
            WHERE Domain = ? AND UserId = ? AND Status = 'active'
        """, domain, user_id)
        rows = cur.fetchall()
    finally:
        conn.close()
    candidates = [r for r in rows if path.startswith(r.PathPrefix)]
    if not candidates:
        return None
    best = max(candidates, key=lambda r: len(r.PathPrefix))
    ts = best.ConnectedAt
    if hasattr(ts, "isoformat"):
        ts = ts.isoformat()
    return {
        "id": best.Id,
        "domain": best.Domain,
        "path_prefix": best.PathPrefix,
        "site_url": best.SiteUrl,
        "repo_url": best.RepoUrl,
        "default_branch": best.DefaultBranch,
        "framework": best.Framework,
        "access_token": best.AccessToken,
        "connected_at": ts,
    }


def delete_repo_link(link_id: int, user_id: int) -> bool:
    """Soft-delete a repo link."""
    if not is_enabled() or _INIT_ERROR:
        return False
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            UPDATE dbo.RepoLink SET Status = 'disconnected'
            WHERE Id = ? AND UserId = ?
        """, link_id, user_id)
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# ── Fix history (Auto-Fix) ──────────────────────────────────────────────────────

def save_fix(user_id: int, page_url: str, rule_id: str, status: str,
             branch_url: str | None, error_message: str | None, pr_url: str | None = None,
             merged: bool = False, node_signature: str | None = None) -> int:
    """Record one Auto-Fix attempt. Returns Fix.Id."""
    if not is_enabled() or _INIT_ERROR:
        raise RuntimeError("Database not available")
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO dbo.Fix (UserId, PageUrl, RuleId, NodeSignature, Status, BranchUrl, ErrorMessage, PrUrl, Merged)
            OUTPUT INSERTED.Id
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, user_id, page_url, rule_id, node_signature, status, branch_url, error_message, pr_url, 1 if merged else 0)
        row = cur.fetchone()
        conn.commit()
        return int(row[0])
    finally:
        conn.close()


def get_fixes(user_id: int, limit: int = 50) -> list[dict]:
    """Return recent Auto-Fix attempts for a user, newest first."""
    if not is_enabled() or _INIT_ERROR:
        return []
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT TOP (?) Id, PageUrl, RuleId, Status, BranchUrl, PrUrl, Merged, ErrorMessage, CreatedAt
            FROM dbo.Fix
            WHERE UserId = ?
            ORDER BY CreatedAt DESC
        """, limit, user_id)
        rows = cur.fetchall()
    finally:
        conn.close()
    out = []
    for r in rows:
        ts = r.CreatedAt
        if hasattr(ts, "isoformat"):
            ts = ts.isoformat()
        out.append({
            "id": r.Id,
            "page_url": r.PageUrl,
            "rule_id": r.RuleId,
            "status": r.Status,
            "branch_url": r.BranchUrl,
            "pr_url": r.PrUrl,
            "merged": bool(r.Merged),
            "error_message": r.ErrorMessage,
            "created_at": ts,
        })
    return out


def get_open_fix(user_id: int, page_url: str, rule_id: str, node_signature: str | None) -> dict | None:
    """
    Most recent fix for this exact element (same page, rule, and node
    signature) that already has an open, unmerged PR — used to avoid opening
    a duplicate PR when Auto-Fix is clicked again before the existing one is
    reviewed. Keyed on node_signature too, not just page+rule, so fixing
    several different elements flagged by the same rule on the same page
    (e.g. via "Fix All") isn't mistaken for re-fixing the same one.
    """
    if not is_enabled() or _INIT_ERROR:
        return None
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT TOP (1) PrUrl, BranchUrl
            FROM dbo.Fix
            WHERE UserId = ? AND PageUrl = ? AND RuleId = ? AND NodeSignature = ?
                AND Status = 'verified' AND Merged = 0 AND PrUrl IS NOT NULL
            ORDER BY CreatedAt DESC
        """, user_id, page_url, rule_id, node_signature)
        row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        return None
    return {"pr_url": row.PrUrl, "branch_url": row.BranchUrl}
