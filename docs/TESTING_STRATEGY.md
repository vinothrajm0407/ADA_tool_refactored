# ADA Accessibility Tool — Complete Testing Strategy & Audit

---

## Phase 1: Architecture Overview

### Frontend Architecture
**Files:** `src/App.jsx`, `src/context/AppContext.jsx`, `src/utils/api.js`, `src/pages/**`, `src/components/**`

- React 18 SPA with client-side routing via `window.history.pushState` (no react-router, custom navigation in AppContext)
- Global state: `AppContext` manages `activePage`, `user`, JWT token (sessionStorage), dark mode, crawl IDs, pending assistive test state, WCAG criterion selection
- API layer: `apiFetch` in `src/utils/api.js` — attaches Bearer token, fires `ada:auth-expired` CustomEvent on 401
- Tailwind CSS with custom design tokens (teal/coral/sage/amber/night/charcoal)
- Recharts for dashboards, Lucide for icons
- No global state manager (Redux/Zustand) — only React Context

### Backend Architecture
**Files:** `app.py`, `config.py`, `services/db.py`, `services/url_processor.py`, `backend/services/**`

- Flask application with 40 REST API endpoints
- JWT authentication via `require_auth` decorator (HS256, 24h expiry)
- In-process rate limiting: 15s window per IP (not shared across Gunicorn workers)
- CORS: allows `localhost:5173`, `localhost:5000`, any `chrome-extension://` origin
- Request ID tracking via `X-Request-ID` header

### Database Architecture
**File:** `services/db.py` (2,576 lines)

MSSQL tables:
| Table | Purpose |
|---|---|
| `Users` | Accounts, password hashes, email verification tokens |
| `ScanHistory` | ADA scan results (full axe JSON payload) |
| `ScanJobs` | RQ job tracking (status, attempts, duration) |
| `CrawlJob` | Site crawl metadata (BFS state, score aggregates) |
| `CrawlPage` | Per-page results for each crawl |
| `AssistiveScans` | Keyboard/contrast/page-structure test results |
| `CrawlSchedules` | Recurring crawl configurations |
| `CrawlAISummary` | Claude-generated crawl summaries |
| `Alerts` | Regression/score-drop alerts |

Auto-creates database and all tables on startup if `MSSQL_CONN_STR` is set.

### Queue / Worker Architecture
**Files:** `backend/services/crawl_service.py`, `backend/services/crawl_task.py`

- Redis + RQ for async scan jobs
- `crawl_site_task()`: BFS crawler — one Playwright browser for entire crawl session
- In-memory fallback (`_inmemory_store`) when Redis/DB unavailable
- Cancellation: worker polls `inmemory_get_status` or DB between each page
- Post-crawl pipeline: email → AI summary → alert evaluation (all non-blocking)

### Authentication Flow
```
POST /api/auth/register → bcrypt hash → create_user → send_verification_email
GET  /api/auth/verify-email?token=X → mark_email_verified → issue JWT
POST /api/auth/login → bcrypt check → email_verified check → issue JWT
     All protected routes: require_auth decorator → jwt.decode → g.current_user_id
```

### Scan Flow
```
POST /api/scan → rate limit check → create_scan_job → RQ enqueue → return jobId
GET  /api/scan/<jobId> → get_scan_status → poll RQ → return status/result
     Worker: run_axe_playwright → axe-core in Playwright → save to ScanHistory
```

### Crawl Flow
```
POST /api/crawl → create_crawl_job → RQ enqueue crawl_site_task → return crawl_id
     Worker: BFS with Playwright → axe per page → update CrawlPage/CrawlJob
     Post-crawl: finalize_crawl_summary → email → AI summary → alert evaluation
```

### AI Fix Flow
```
POST /api/ai-fix → validate violation → build prompt → urllib.request to Anthropic API
     → parse JSON response → return {explanation, wcagCriterion, before, after}
     No API key: return mock/placeholder response
```

---

## Phase 2: Coverage Gap Report

### Existing Tests: ZERO
No test files exist in this project. Coverage: **0%**.

### Critical Gaps (by risk)

| Gap | Risk | Priority |
|---|---|---|
| Auth endpoints (register/login/verify) | High — security boundary | P0 |
| JWT require_auth decorator | High — all 34 protected endpoints | P0 |
| Rate limiter logic | Medium — DoS protection | P1 |
| Scan API (queue + poll) | High — core feature | P0 |
| Crawl API (create/stop/pages) | High — core feature | P0 |
| Assistive test APIs (3 endpoints) | Medium | P1 |
| AI fix endpoint | Medium — external API + security | P1 |
| Security: SSRF, XSS, injection | High | P0 |
| Frontend: apiFetch 401 handling | High — auth expiry UX | P0 |
| Frontend: format utilities | Low — pure functions | P2 |
| DB layer functions | High — data integrity | P1 |
| Worker cancellation logic | Medium | P2 |
| Scheduler service | Low — daemon thread | P3 |

---

## Phase 3–12: Testing Strategy

### Pyramid

```
                    ┌─────────────────┐
                    │   E2E (Slow)    │  Playwright browser tests
                    │  ~20 scenarios  │  Full user journeys
                    ├─────────────────┤
                    │  Integration    │  Flask test client
                    │  ~150 tests     │  API contract + auth + DB mock
                    ├─────────────────┤
                    │  Security       │  Auth bypass, injection, SSRF
                    │  ~60 tests      │
                    ├─────────────────┤
                    │  Unit Tests     │  Pure functions, helpers
                    │  ~80 tests      │
                    └─────────────────┘
```

### Frameworks

| Layer | Framework | Config |
|---|---|---|
| Python unit + integration | pytest + pytest-flask | `pytest.ini` |
| Python mocking | `unittest.mock` | built-in |
| Frontend unit | Vitest + jsdom | `vite.config.js` |
| Frontend component | React Testing Library | `src/test-setup.js` |
| E2E | Playwright Python | `tests/e2e/` (Sprint 3) |

---

## Phase 13: Implemented Tests

### Files Created

```
pytest.ini                                    — pytest configuration
tests/
  conftest.py                                 — App fixture, DB mock, token helpers
  unit/
    test_url_processor_helpers.py             — _extract_fix_text, _extract_ratio_info, _safe_int (27 tests)
    test_auth_helpers.py                      — JWT generation, token factory, rate limiter (18 tests)
    test_config.py                            — Config env var parsing (20 tests)
  integration/
    test_auth_api.py                          — All 6 auth endpoints (42 tests)
    test_scan_api.py                          — Scan + health endpoints (18 tests)
    test_crawl_api.py                         — 10 crawl endpoints (32 tests)
    test_assistive_api.py                     — 4 assistive endpoints (22 tests)
    test_history_api.py                       — History + trends endpoints (24 tests)
    test_alerts_api.py                        — Alerts, schedules, AI summary (23 tests)
    test_ai_fix_api.py                        — AI fix endpoint happy/error paths (12 tests)
  security/
    test_security.py                          — Auth bypass, SSRF, XSS, SQL injection,
                                                command injection, path traversal,
                                                large payloads, CORS, data exposure (50+ tests)
src/
  utils/api.test.js                           — apiFetch: auth header, 401 event, mutations (16 tests)
  utils/format.test.js                        — formatDateTime, formatShortDate, formatUrl,
                                                formatDuration (28 tests)
  test-setup.js                               — Jest DOM matchers
```

### Running Tests

```bash
# Python tests (all)
pip install pytest pytest-flask bcrypt PyJWT
pytest

# Python tests — unit only (fast, no Flask)
pytest -m unit

# Python tests — integration only
pytest -m integration

# Python tests — security only
pytest -m security tests/security/

# Frontend tests
npm install
npm test

# Frontend tests with coverage
npm run test:coverage

# Run a specific test file
pytest tests/integration/test_auth_api.py -v
```

---

## Sprint Plan

### Sprint 1 (Done — this session)
- ✅ Auth API: all 6 endpoints, 42 tests
- ✅ Scan API: queue + poll + health, 18 tests
- ✅ Security: auth bypass, SSRF, XSS, injection, CORS, 50+ tests
- ✅ Unit: helpers, config, JWT, rate limiter, 65 tests
- ✅ Frontend: apiFetch + format utilities, 44 tests

### Sprint 2 (Done — this session)
- ✅ Crawl task helpers: `_utcnow_iso`, `_duration` (13 tests)
- ✅ Alert service: `evaluate_and_create_alerts` threshold + severity logic (17 tests)
- ✅ Digest service: `generate_weekly_digest`, `_score_trend` (20 tests)
- ✅ AI summary service: `generate_and_store_summary`, `_collect_crawl_context`, `_call_claude` (21 tests)
- ✅ Scheduler: `start_scheduler` idempotency, `_tick` dispatch (12 tests)
- ✅ React: ModuleSelector (12 tests), StatusBadge/StatusPill (14 tests), MetricCard (10 tests)

### Sprint 3 (Full regression)
- [ ] E2E Playwright tests: full user journeys (login → scan → history → re-test)
- [ ] Performance tests: dashboard load, large scan history, crawl with 50 pages
- [ ] Load tests: locust scenarios for scan endpoint throughput

---

## Security Test Coverage Matrix

| Attack Vector | Tested | File |
|---|---|---|
| Auth bypass (no token) | ✅ 13 endpoints | test_security.py |
| JWT alg:none attack | ✅ | test_security.py |
| Forged JWT (wrong secret) | ✅ | test_security.py |
| Expired token | ✅ | test_auth_api.py, test_security.py |
| Tampered JWT payload | ✅ | test_security.py |
| SSRF via scan URL | ✅ 6 payloads × 2 endpoints | test_security.py |
| XSS in request body | ✅ 5 payloads | test_security.py |
| SQL injection in login | ✅ 6 payloads | test_security.py |
| SQL injection in query params | ✅ | test_security.py |
| Command injection in URL | ✅ 4 payloads | test_security.py |
| Path traversal | ✅ 4 payloads | test_security.py |
| Large payload | ✅ | test_security.py |
| Malformed JSON | ✅ | test_security.py |
| Password hash in response | ✅ | test_security.py |
| Stack trace in error response | ✅ | test_security.py |
| CORS origin validation | ✅ | test_security.py |
| Rate limit per-IP isolation | ✅ | test_security.py |
| Email enumeration (resend) | ✅ | test_auth_api.py |
