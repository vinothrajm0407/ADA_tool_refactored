-- ============================================================
-- ADA Tool: create the database and the app's SQL login
-- Run ONCE in SSMS / DBeaver / Azure Data Studio, connected to your local
-- SQL Server (localhost or .\SQLEXPRESS) as an admin (Windows Authentication).
--
-- The tables are NOT created here: the backend creates and upgrades all of
-- them itself the first time it starts (services/db.py, init_db).
--
-- Afterwards put the login in .env:
--   MSSQL_CONN_STR=Driver={ODBC Driver 18 for SQL Server};Server=localhost,1433;Database=ADA_DB;Uid=ada_user;Pwd=<password below>;Encrypt=no;TrustServerCertificate=yes;Connection Timeout=10;
-- then start the backend and create app logins with:
--   python scripts/create_user.py EMAIL PASSWORD [FIRST_NAME] [LAST_NAME]
--
-- SQL Server must allow SQL logins (Server Properties > Security >
-- "SQL Server and Windows Authentication mode") and listen on TCP 1433
-- (SQL Server Configuration Manager > TCP/IP > Enabled), then restart it.
-- ============================================================

-- 1. Database
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = N'ADA_DB')
    CREATE DATABASE ADA_DB;
GO

-- 2. SQL login for the app — replace CHANGE_ME_Str0ng! with your own password
IF NOT EXISTS (SELECT * FROM sys.server_principals WHERE name = N'ada_user')
    CREATE LOGIN ada_user WITH PASSWORD = 'CHANGE_ME_Str0ng!', CHECK_POLICY = OFF;  -- set your own; same value goes in .env
GO

-- 3. Database user + roles. db_ddladmin is required: the backend creates and
--    alters its own tables on startup and fails without it.
USE ADA_DB;
GO
IF NOT EXISTS (SELECT * FROM sys.database_principals WHERE name = N'ada_user')
    CREATE USER ada_user FOR LOGIN ada_user;
ALTER ROLE db_datareader ADD MEMBER ada_user;
ALTER ROLE db_datawriter ADD MEMBER ada_user;
ALTER ROLE db_ddladmin  ADD MEMBER ada_user;
GO
PRINT 'ADA_DB and login ada_user are ready. Start the backend to create the tables.';
