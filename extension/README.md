# ADA Accessibility — Browser Extension

Browser extension for the ADA Accessibility Intelligence platform.
Scan any page for accessibility issues in one click. Results are saved to your
platform dashboard with history, trends, and AI-powered fix suggestions.

## Architecture

```
Extension Popup  →  Existing Flask Backend  →  Playwright + axe-core  →  MSSQL
(this folder)       (../app.py, /api/*)        (../scripts/)               (../services/db.py)
```

The extension is a thin React UI over the existing REST API.
Zero new backend logic — all endpoints are shared with the web app.

## Project structure

```
extension/
├── manifest.json               MV3 extension manifest
├── popup.html                  React app entry point
├── vite.config.js              Build config (popup + static copy)
├── tailwind.config.js          Same design tokens as web app
│
├── src/
│   ├── config/constants.js     Shared constants (AUTH_KEY, POLL_INTERVAL, etc.)
│   ├── utils/api.js            apiFetch for extension (chrome.storage.local token)
│   ├── utils/format.js         Copied from src/utils/format.js
│   ├── styles/popup.css        Tailwind + component classes (mirrors src/index.css)
│   │
│   ├── popup/
│   │   ├── main.jsx            React root mount
│   │   ├── Popup.jsx           Auth gate (checking → login | scanner)
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx   Sign-in form
│   │   │   └── ScannerPage.jsx Scan trigger, progress, results
│   │   └── components/
│   │       ├── ShieldMark.jsx  Brand SVG icon (mirrors BrandLogo.jsx)
│   │       ├── ScanButton.jsx  Primary CTA
│   │       ├── ScanProgress.jsx Animated scanning indicator
│   │       ├── ImpactSummary.jsx 4 impact pills + score
│   │       ├── ViolationItem.jsx Single violation accordion row
│   │       ├── ViolationList.jsx Sorted, capped violation list
│   │       ├── DeltaBadge.jsx  "+N new / −N fixed since last scan"
│   │       └── FooterActions.jsx "View full report" + "Re-scan"
│   │
│   └── background/
│       └── service-worker.js   Badge count updates
│
├── icons/                      PNG icons (run scripts/generate-icons.mjs)
└── scripts/
    └── generate-icons.mjs      Generates icons from SVG using sharp
```

## Setup

```bash
cd extension

# 1. Install dependencies
npm install

# 2. Configure platform URL
cp .env.example .env
# Edit .env: set VITE_PLATFORM_URL=http://localhost:5000 (dev) or your prod URL

# 3. Generate icons (requires sharp)
npm install -D sharp
node scripts/generate-icons.mjs

# 4. Build
npm run build

# 5. Load in Chrome
#    chrome://extensions → Enable Developer mode → Load unpacked → select dist/
```

## Development workflow

```bash
npm run dev   # vite build --watch — rebuilds on file changes
# After each rebuild: chrome://extensions → click the reload ↺ button
```

## API endpoints used

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Sign in |
| GET | `/api/auth/me` | Validate token on popup open |
| POST | `/api/scan` | Start scan of current tab |
| GET | `/api/scan/<job_id>` | Poll scan status |
| GET | `/api/history/prev-scan` | Fetch previous scan for delta |

All endpoints are existing — no new backend code required.

## Authentication

- Token stored in `chrome.storage.local['ada_auth']` as `{ token, user }` JSON
- Same key and format as web app's `sessionStorage['ada_auth']`
- Token is validated on every popup open via `GET /api/auth/me`
- Users must log in to the extension separately from the web app
  (different storage APIs; sessionStorage is not accessible cross-context)

## CORS

The backend must allow `chrome-extension://` origin.
See the CORS section added to `../app.py`.

## What is NOT in this extension (V1 scope)

- Inspector Mode (element hover details) — planned for V1.5
- AI fix suggestions in popup — planned for V1.5 (after Inspector Mode)
- DOM overlays / highlights — not in scope
- Crawl trigger — wrong UX for a popup
- DevTools panel — not needed for V1
