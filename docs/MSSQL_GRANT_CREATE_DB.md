# Let your Windows user create the database (auto-init)

When using **Windows Authentication**, your Windows login must be allowed to **create databases**. Otherwise the app will fail with a permission error and you won't see `ADA_DB` in SSMS.

## In SSMS (connected as an admin, e.g. your Windows user if it’s admin)

Run this **once** (replace `YOUR-PC\YourUsername` with your actual Windows login, e.g. the one you use to log into the PC):

```sql
-- Add your Windows user to the dbcreator role so the app can create ADA_DB
USE master;
GO

CREATE LOGIN [YOUR-PC\YourUsername] FROM WINDOWS;
GO

ALTER SERVER ROLE [dbcreator] ADD MEMBER [YOUR-PC\YourUsername];
GO
```

If the login already exists, you’ll get an error on `CREATE LOGIN`; that’s fine. Just run the `ALTER SERVER ROLE` line (and use your real Windows username in both places).

After this, run the app again with `MSSQL_CONN_STR` set; it should create `ADA_DB` and the table.

## How to find your Windows username

- In PowerShell: `whoami`  → e.g. `YOUR-PC\your.name`
- Use that full value in the script above (e.g. `[YOUR-PC\your.name]`).
