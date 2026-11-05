# Internal Project UI

This project is a React accessibility-scanner UI with a Flask backend.

The current production path is:

1. React/Vite frontend in `src/`
2. Flask API in `app.py`
3. Python Playwright + axe scan runner in `services/` and `scripts/`

The `backend/` Spring Boot project is still checked in, but it is not the primary runtime for this app. Treat it as legacy/reference code unless you are intentionally reviving the Java path.

---

## Runtime Story

- `npm run dev` starts the Vite frontend on `http://localhost:5173`
- `python app.py` starts the Flask API and serves the built app on `http://localhost:5000`
- Vite proxies `/api/*` requests to Flask during local frontend development
- URL processing and accessibility scans run through the Python backend only

If the live Playwright scan fails, the backend returns a fallback sample result so the UI remains testable. The results page now labels fallback output clearly so it is not confused with a real scan.

Scan history is optional. It is enabled only when `MSSQL_CONN_STR` is configured. Without MSSQL, the app still runs normally, but the history screen shows that persistence is unavailable instead of failing.

---

## Quick Start

### UI only

```bash
cd UI_Design
npm run build
npm install
npm run dev
```

Open `http://localhost:5173`.

You can use the interface and upload JSON results in the ADA Results screen. To make the `Process` button work in dev mode, run Flask in another terminal with `python app.py`.

### Full local app

```bash
cd UI_Design
npm install
npm run build
# Activate the existing WSL-compatible Python environment
source env/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
python app.py
```

Open `http://localhost:5000`.

---

## How Processing Works

When a user submits a URL from the Home screen:

1. The frontend sends `POST /api/process`
2. Flask calls `services/url_processor.py`
3. The Python ADA runner executes Playwright + axe
4. The result is returned to the UI and written to `output/ada_result.json`
5. If MSSQL is configured, a scan summary is also saved for the Scan History page

Relevant files:

- `app.py`: Flask app and API routes
- `services/url_processor.py`: orchestrates the accessibility scan
- `scripts/run_ada_check_python.py`: Playwright + axe runner
- `services/db.py`: optional MSSQL-backed scan history

---

## Optional Scan History

Scan history requires:

- `MSSQL_CONN_STR`
- optionally `MSSQL_DATABASE` (defaults to `ADA_DB`)
- `pyodbc` and an installed SQL Server ODBC driver

If those are not configured, the app still starts and scanning still works. Only the history feature is disabled.

---

## GitHub Action (pull request check)

`action.yml` scans pages on every pull request, posts one "ADA Accessibility Review" comment
(updated on each run), and fails the check on violations at `fail-on` or above.

```yaml
# .github/workflows/accessibility.yml in the repo to check
on: pull_request
permissions:
  pull-requests: write
jobs:
  ada:
    runs-on: ubuntu-latest
    steps:
      - uses: vinothrajm0407/ADA_tool_refactored@main
        with:
          api-url: https://your-ada-server
          api-key: ${{ secrets.ADA_API_KEY }}
          urls: |
            https://staging.example.com/
            https://staging.example.com/login
          fail-on: serious   # critical | serious | moderate | minor | none
```

The ADA server must be reachable from GitHub, and the pages from the ADA server. Create the
API key in **Settings → API keys** (shown once) and save it as the repository secret `ADA_API_KEY`.

---

## Local Development Notes

### Frontend dev server

```bash
npm run dev
```

`vite.config.js` proxies `/api` to `http://localhost:5000`, so Flask should be running if you want to test scans from the dev server.

### Flask app

```bash
python app.py
```

Flask serves the built `dist/` output and exposes:

- `POST /api/process`
- `GET /api/history`
- `GET /api/history/<scan_id>`

---

## Project Structure

| Path | Purpose |
|------|---------|
| `src/` | React UI |
| `app.py` | Flask entry point |
| `services/url_processor.py` | Python scan orchestration |
| `services/db.py` | Optional MSSQL scan history |
| `scripts/run_ada_check_python.py` | Playwright + axe implementation |
| `dist/` | Production build output |
| `backend/` | Legacy/reference Spring Boot backend |

---

## Deploying

For Azure deployment details, see `DEPLOY_AZURE.md`.

The Docker-based Flask deployment path is the recommended one for this repository because it keeps the Python runtime and Playwright dependencies aligned with the code that the app actually uses.
