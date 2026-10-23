# ADA Backend — API Reference (for the new frontend)

Source of truth: [app.py](../app.py). Response shapes below were captured from the running server (Oct 2026).
Base URL (dev): `http://localhost:5000` · All bodies/replies are JSON unless stated.

## 1. Global rules

| Topic | Rule |
|---|---|
| Auth | `Authorization: Bearer <JWT>` on every route marked 🔒. JWT from `/api/auth/login`, lives 24h (`JWT_EXPIRE_HOURS`). |
| API keys | Tokens starting `ada_` are CI API keys (see §10) and work anywhere a JWT works. |
| Auth errors (401) | `{"ok":false,"error":"missing_token" \| "token_expired" \| "invalid_token"}` → send user to login. |
| Envelope | Almost everything returns `{"ok": true, ...}` or `{"ok": false, "error": "<message>"}`. |
| "DB unavailable" | Many list routes still return 200 with `{"ok":true,"available":false,"items":[],"message":"..."}`. Check `available`. Auth routes return 503 `Database not available`. |
| Request ID | Send optional `X-Request-ID`; every response echoes it. |
| **CORS** | Only `http://localhost:5173`, `http://localhost:5000` and `chrome-extension://*` are allowed. **A new frontend on any other origin/port/domain must be added to `_ALLOWED_ORIGINS` in app.py**, or use a dev proxy. |
| Rate limit | `POST /api/scan`: 1 per 15s per IP (429 + `Retry-After`). Localhost exempt. |
| Timestamps | ISO-8601 UTC strings (api-keys uses RFC-1123, see §10). |
| IDs | Scan history id is `"SCAN-872"` in list rows but **numeric `872`** in URL paths. Crawl ids are `"CRAWL-A397AB25711B"`. |

## 2. Auth (public unless noted)

| Method & path | Body | Success | Errors |
|---|---|---|---|
| POST `/api/auth/register` | `{firstName,lastName,email,password(≥8)}` | 201 `{ok,requiresVerification:true}` (verification email sent) | 400 validation, 409 email exists, 503 |
| POST `/api/auth/login` | `{email,password}` | `{ok,token,user:{id,firstName,lastName,email,emailVerified}}` | 401 `Invalid email or password`, 403 `email_not_verified` / `Account is inactive` |
| GET `/api/auth/verify-email?token=` | — | same as login (auto-logs in) | 400 `token_invalid` |
| POST `/api/auth/resend-verification` | `{email}` | always `{ok,message}` (no enumeration; 60s throttle) | — |
| POST `/api/auth/forgot-password` | `{email}` | always `{ok,message}` | — |
| POST `/api/auth/reset-password` | `{token,newPassword(≥8)}` | `{ok:true}` | 400 `token_invalid` |
| GET `/api/auth/me` 🔒 | — | `{ok,user:{id,firstName,lastName,email}}` | 404 |
| POST `/api/auth/logout` 🔒 | — | `{ok:true}` (stateless — frontend just drops the token) | — |

Email links point at `APP_BASE_URL` — set it to the new frontend's URL, and make it route `?token=` for verify/reset pages.

## 3. Page scan (axe-core)

**POST `/api/scan`** 🔒 — body `{url, includeBestPractices?: bool}` → 202 `{ok,jobId,status:"queued"}`.
400 missing/invalid url · 429 rate limited.

**GET `/api/scan/<jobId>`** 🔒 — poll every ~2–3s until `job.status` is `completed` (or failed). 404 unknown job.
```json
{"ok":true,"job":{"job_id":"…","status":"queued|started|completed|failed","backend":"inmemory",
 "created_at":"…","ended_at":"…","meta":{"scan_url":"…","metadata":{"include_best_practices":false,"user_id":1}},
 "result":{ "url":"…","message":"ADA check completed","includeBestPractices":false,"usedFallback":false,
   "axeResult":{"violations":[],"passes":[],"incomplete":[],"inapplicable":[],
     "screenshot":"<base64 jpeg>","screenshotType":"image/jpeg","timestamp":"…","testEngine":{},"testEnvironment":{}}}}}
```
`axeResult.*` arrays are standard axe-core objects: `{id,impact,help,description,helpUrl,tags[],nodes:[{html,target[],failureSummary,…}]}`. `impact`: critical|serious|moderate|minor|null. The scan is auto-saved to history.

## 4. Scan history & analytics (all 🔒 GET)

| Path | Params | Returns |
|---|---|---|
| `/api/history` | `limit` (500) | `{ok,available,items:[{id:"SCAN-872",url,timestamp,violations,passes,passRate,includeBestPractices,usedFallback}]}` |
| `/api/history/<int:scan_id>` | — | `{ok,result:{…same as scan job result above…}}` · 404 not found · 503 no DB |
| `/api/history/prev-scan` | `url` (required) | `{ok,scan:{…summary}\|null}` — for before/after delta |
| `/api/trends` | `granularity=daily\|weekly\|monthly`, `days` (30, max 365), `from`,`to` (YYYY-MM-DD) | `{ok,available,granularity,period:{from,to},data:[{date,scan_count,total_violations,total_passes,avg_pass_rate,critical,serious,moderate,minor}],summary:{total_scans,total_violations,total_passes,avg_pass_rate}}` |
| `/api/violations/summary` | `limit` (100) | `{ok,available,severity_breakdown:{critical,serious,moderate,minor},top_issue_types:[{rule_id,count}],wcag_breakdown:[{tag,count}],needs_attention:[{url,current_violations,previous_violations,delta}]}` |
| `/api/health-tree` | — | Client Health tree: `{ok,available,websites:[{domain,page_count,open_issues,fixed_issues,pages:[{url,pass_rate,open_issues,fixed_issues,last_scan_id,last_scanned}]}]}` |

## 5. Assistive (manual-assist) tests

All 🔒 POST, body `{url}`, reply `{ok:true,result:{…}}` (500 `{ok:false,error}` on failure). Runs a real browser — can take 10–60s, show a spinner. Auto-saved to assistive history.

| Path | `result.module` |
|---|---|
| `/api/assisted/keyboard` | keyboard |
| `/api/assisted/color-contrast` | contrast |
| `/api/assisted/page-structure` | page-structure — adds `headings[]`, `landmarks[]`, `headingIssues[]`, `landmarkIssues[]` |
| `/api/assisted/forms` | forms |

Common result fields: `ok, module, url, title, passed(bool), summary(string), checks[{id,label,passed,details}], failedChecks[], errors[]`.

**GET `/api/assistive-history`** 🔒 — params `scan_type` (keyboard\|contrast\|page-structure\|forms), `url`, `from`, `to`, `limit`(200) → `{ok,available,items:[{id,scan_type,url,passed,timestamp}]}`. Full detail for one item: use the audit PDF (§8).

## 6. Site crawl

| Method & path | Body / params | Returns |
|---|---|---|
| POST `/api/crawl` 🔒 | `{url, maxDepth?, maxPages?, fullSite?:bool, notifyEmail?}` (depth capped 10, pages 500; fullSite lifts caps) | 202 `{ok,crawl_id,root_url,max_depth,max_pages,status:"pending",total_discovered,total_scanned,total_failed,created_at,…}` |
| GET `/api/crawl/<id>` 🔒 | — | `{ok,job:{crawl_id,root_url,status,max_depth,max_pages,total_discovered,total_scanned,total_failed,total_violations,site_score,avg_pass_rate,created_at,started_at,ended_at,duration_seconds,failure_reason,notify_email}}` — poll for progress; status: pending\|running\|completed\|failed\|cancelled |
| POST `/api/crawl/<id>/stop` 🔒 | — | `{ok,crawl_id,status:"cancelled"}` · 404 |
| GET `/api/crawl/<id>/pages` 🔒 | — | `{ok,crawl_id,count,pages:[{id,url,normalized_url,parent_url,depth,status:"scanned\|failed\|…",violations,passes,pass_rate,scan_history_id,discovered_at,scanned_at,failure_reason}]}` |
| GET `/api/crawls` 🔒 | `limit` (25) | `{ok,available,items:[{crawl_id,root_url,status,site_score,avg_pass_rate,total_scanned,total_failed,total_violations,created_at,ended_at,duration_seconds}]}` |
| GET `/api/crawl/<id>/intelligence` 🔒 | — | `{ok,available,severity_breakdown,top_issue_types:[{rule_id,count,affected_pages}],wcag_breakdown:[{criterion,name,principle,count}],wcag_principles:{Perceivable,Operable,Understandable,Robust}}` |
| GET `/api/crawl/<id>/regressions` 🔒 | — | `{ok,has_comparison,previous_crawl_id,previous_crawl_date,regressions[],improvements[],new_pages[],removed_pages[]}` |
| GET `/api/crawl/<id>/page-trends` 🔒 | — | `{ok,has_comparison,most_improved[],most_regressed[]}` |
| GET `/api/crawl/<id>/summary` 🔒 | — | AI summary: `{ok,available,summary:{overall_health,…}\|null}`. Generated on first call if `ANTHROPIC_API_KEY` is set (can be slow). |
| GET `/api/crawls/compare?a=&b=` 🔒 | both required, different | `{ok,crawl_a,crawl_b,summary:{score_delta,violations_delta,pass_rate_delta,pages_improved,pages_regressed,pages_unchanged,pages_only_in_a,pages_only_in_b},improved[],regressed[],only_in_a[],only_in_b[]}` · 404 |
| GET `/api/crawls/timeline?url=` 🔒 | `url`, `limit`(20) | `{ok,url,count,data:[{crawl_id,created_at,site_score,avg_pass_rate,total_scanned,total_violations,duration_seconds}]}` |

## 7. Scheduled crawls (🔒)

Schedule object: `{id,name,root_url,frequency:"hourly|daily|weekly|monthly",schedule_type:"simple|cron",cron_expression,time_of_day:"HH:MM",enabled,status,next_run_at,last_run_at,last_run_crawl_id,last_run_status,created_at}`

| Method & path | Body | Returns |
|---|---|---|
| GET `/api/crawl-schedules` | — | `{ok,items:[schedule]}` |
| POST `/api/crawl-schedules` | `{url, name?, frequency?, timeOfDay?, scheduleType?:"simple\|cron", cronExpression?}` (cron validated → 400 `Invalid cron expression`) | 201 `{ok,schedule}` |
| PATCH `/api/crawl-schedules/<id>` | any of `enabled,frequency,name,timeOfDay,scheduleType,cronExpression` | `{ok}` · 400 `Nothing to update` |
| DELETE `/api/crawl-schedules/<id>` | — | `{ok}` |
| POST `/api/crawl-schedules/<id>/run-now` | — | 201 `{ok,crawl_id}` · 409 already running · 404 |
| POST `/api/crawl-schedules/<id>/stop` | — | `{ok,crawl_id,status:"cancelled"}` · 404 no active run |
| GET `/api/crawl-schedules/<id>/runs?limit=5` | — | `{ok,items:[crawl rows]}` |

## 8. Reports (PDF)

| Method & path | Notes |
|---|---|
| GET `/api/report/<kind>/<record_id>` 🔒 | `kind` = `scan` (numeric scan id) \| `assistive` (numeric id) \| `crawl` (CRAWL-…). Returns **binary PDF** (`Content-Disposition: attachment`). Fetch with the Bearer header → blob (a plain `<a href>` can't send the token). 404 JSON if not found. |
| POST `/api/report/<kind>/<record_id>/email` 🔒 | `{email}` → `{ok:true}` · 400 · 502 SMTP failure |

## 9. Alerts (🔒)

| Method & path | Returns |
|---|---|
| GET `/api/alerts?status=&limit=50` | `{ok,items:[{id,alert_type:"regression_detected\|…",severity,status:"active\|acknowledged",crawl_id,root_url,details:{…},created_at}],unread_count}` |
| GET `/api/alerts/unread-count` | `{ok,count}` — use for the bell badge |
| PATCH `/api/alerts/<id>/acknowledge` | `{ok}` |

## 10. Auto-Fix, repos, fix history (🔒)

| Method & path | Body | Returns |
|---|---|---|
| GET `/api/repo-links` | — | `{ok,links:[{id,site_url,domain,path_prefix,repo_url,provider:"github\|gitlab\|bitbucket\|azure",default_branch,framework,connected_at,installation_id}]}` (token is never returned) |
| POST `/api/repo-links` | `{site_url,repo_url,access_token,default_branch?="main",link_id?}` — `link_id` = edit mode (token optional then). repo_url must be github.com / gitlab.com / bitbucket.org / dev.azure.com style. Token is validated live against the provider. | 201 `{ok,id}` · 400 · 502 `Could not access that repo…` |
| DELETE `/api/repo-links/<id>` | — | `{ok}` · 404 |
| POST `/api/auto-fix` | `{page_url, rule:{id,…}, node:{html,target,…}}` | `{ok,status:"verified\|patched\|already_fixed\|failed",steps:[{name,ok,detail}],branch_url,pr_url,merged,error?,duplicate?}` · 404 `No repo connected…` · **long-running (minutes) — hold a spinner, no polling endpoint** |
| POST `/api/auto-fix-batch` | `{page_url, rule, nodes:[node,…]}` — one PR for all elements of one rule on a page | same + `results:[{status,error?}]` per node |
| GET `/api/fixes?limit=50` | — | `{ok,fixes:[{id,page_url,rule_id,status,branch_url,pr_url,merged,error_message,created_at}]}` |

The `rule`/`node` objects are the violation/node objects taken straight from the axe result (§3).

## 11. API keys (🔒) — for CI pipelines

| Method & path | Body | Returns |
|---|---|---|
| GET `/api/api-keys` | — | `{ok,keys:[{id,label,key_prefix,created_at,last_used_at}]}` |
| POST `/api/api-keys` | `{label}` | `{ok,key:{…, key:"ada_…"}}` — **the raw key is shown only in this response**; UI must show a copy-once dialog |
| DELETE `/api/api-keys/<id>` | — | `{ok}` · 404 |

Usage in CI: `Authorization: Bearer ada_xxxxxxxx` on `/api/scan`, `/api/auto-fix-batch`, etc.

## 12. Integrations: Slack & Teams (🔒 unless noted)

| Method & path | Body | Returns |
|---|---|---|
| GET `/api/integrations` | — | `{ok,integrations:[{id,platform:"slack\|teams",workspace_id,workspace_name,channel_count,connected_at}]}` |
| DELETE `/api/integrations/<id>` | — | `{ok}` |
| GET `/api/integrations/slack/start` | — | `{ok,auth_url}` → open in a popup. 400 if Slack not configured. |
| GET `/api/integrations/slack/callback` | **public**, called by Slack | Returns an HTML page that `postMessage`s `{type:"ada_slack_connected", workspace_name}` to `window.opener` — frontend must listen for this and refresh the list. Uses `APP_BASE_URL` for the redirect URI. |
| GET `/api/integrations/slack/<id>/channels/available` | — | `{ok,channels:[{id,name,is_private}]}` |
| POST `/api/integrations/slack/<id>/test` | `{channel_id}` | `{ok}` posts a test message |
| POST `/api/integrations/teams/connect` | `{webhook_url(https), channel_name, workspace_name?}` | `{ok,…}` — sends a test card to validate the webhook |
| GET `/api/integrations/<id>/channels` | — | `{ok,channels:[{channel_id,channel_name,purpose,webhook_url?}]}` |
| POST `/api/integrations/<id>/channels` | `{channel_id,channel_name,purpose?,webhook_url?}` | `{ok}` |
| DELETE `/api/integrations/<id>/channels/<channel_id>` | — | `{ok}` |
| GET `/api/integrations/deliveries?limit=20` | — | `{ok,deliveries:[{id,platform,workspace_name,channel_name,report_type,status:"success\|failed",error_message,reference,sent_at}]}` |
| POST `/api/integrations/send` | `{integration_id,channel_id,report_type?="scan_summary",note?,context:{scan_id?\|crawl_id?,reference?,…}}` | `{ok}` · 404 integration/channel · 400 delivery failed |

## 13. Health & misc

| Path | Notes |
|---|---|
| GET `/health/live` | `{status:"ok",request_id}` — public |
| GET `/health/ready` | public; 200 `{status:"ok",queue:{backend,connected,…},database:{available}}` or 503 |
| `/_ada_gitlab_relay*`, `/_ada_bitbucket_relay/` | Internal test-app proxies for Auto-Fix demos. **Not for the frontend.** |
| `/` and `/<path>` | Serves the built React app from `dist/` (SPA fallback to `index.html`). Replace/point at the new build, or host the new frontend separately and add its origin to CORS. |

## 14. Suggested screen → endpoint map

| Screen | Endpoints |
|---|---|
| Login / Register / Reset | §2 |
| Dashboard / Trends | `/api/trends`, `/api/violations/summary`, `/api/alerts/unread-count` |
| New scan + results | `POST /api/scan` → poll `GET /api/scan/<id>` |
| Scan History + detail | `/api/history`, `/api/history/<id>`, `/api/history/prev-scan`, `/api/report/scan/<id>` |
| Assistive Testing | §5 + `/api/assistive-history` |
| Crawls (list, detail tabs, compare, timeline) | §6 |
| Schedules | §7 |
| Client Health tree | `/api/health-tree` |
| Auto-Fix / Connected Repos / Fix History | §10 |
| Settings → API keys / Integrations | §11, §12 |
| Alerts | §9 |

## 15. Environment variables the frontend dev's backend needs

Copy `.env.example` (do **not** share the real `.env`): `MSSQL_CONN_STR`, `JWT_SECRET`, `APP_BASE_URL`, `SMTP_ENABLED/HOST/PORT/USER/PASS/FROM`, `SLACK_CLIENT_ID/SECRET` (optional), `ANTHROPIC_API_KEY` (optional, AI summary), `SCHEDULER_ENABLED`, `REDIS_URL` (optional; in-memory queue otherwise).
