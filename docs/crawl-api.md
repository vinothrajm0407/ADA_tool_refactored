# Crawl API Reference

All endpoints are served by the Flask backend at `/api/crawl*` and `/api/crawls*`.
Dates are ISO 8601 UTC strings. All responses are JSON with an `ok: true/false` field.

---

## Endpoints

### POST /api/crawl
Start a new crawl job.

**Request body**
```json
{
  "url":       "https://example.com",
  "max_depth": 3,
  "max_pages": 50,
  "notify_email": "user@example.com"
}
```
`max_depth` and `max_pages` are optional (defaults apply).  
`notify_email` is optional — triggers an email report when the crawl completes.

**Response**
```json
{
  "ok": true,
  "crawl_id": "abc123",
  "message": "Crawl started"
}
```

---

### GET /api/crawl/{crawl_id}
Return the current state of a crawl job.

**Path params**
- `crawl_id` — UUID returned by POST /api/crawl

**Response**
```json
{
  "ok": true,
  "crawl_id": "abc123",
  "status": "completed",
  "root_url": "https://example.com",
  "max_depth": 3,
  "max_pages": 50,
  "total_discovered": 42,
  "total_scanned": 38,
  "total_failed": 4,
  "created_at": "2026-06-01T10:00:00Z",
  "started_at": "2026-06-01T10:00:05Z",
  "ended_at": "2026-06-01T10:12:47Z",
  "duration_seconds": 762,
  "failure_reason": null,
  "site_score": 84,
  "avg_pass_rate": 91,
  "total_violations": 17,
  "notify_email": null,
  "pages": [
    {
      "id": 1,
      "url": "https://example.com/",
      "depth": 0,
      "status": "scanned",
      "passes": 45,
      "violations": 2,
      "pass_rate": 96,
      "scanned_at": "2026-06-01T10:00:30Z"
    }
  ]
}
```

`status` values: `pending` | `running` | `completed` | `failed`  
`site_score`, `avg_pass_rate`, `total_violations` are populated only when `status === "completed"`.

---

### GET /api/crawl/{crawl_id}/intelligence
Return WCAG and severity breakdown for a completed crawl. Aggregates axe-core results across all scanned pages by joining `CrawlPage → ScanHistory → ResultPayload`.

**Response**
```json
{
  "ok": true,
  "available": true,
  "severity_breakdown": {
    "critical": 5,
    "serious": 12,
    "moderate": 8,
    "minor": 3
  },
  "wcag_principles": {
    "Perceivable": 11,
    "Operable": 9,
    "Understandable": 4,
    "Robust": 4
  },
  "wcag_breakdown": [
    { "criterion": "1.4.3", "name": "Contrast (Minimum)", "count": 8 },
    { "criterion": "2.4.4", "name": "Link Purpose", "count": 4 }
  ],
  "top_issue_types": [
    { "rule_id": "color-contrast", "count": 8, "affected_pages": 6 },
    { "rule_id": "image-alt",      "count": 5, "affected_pages": 3 }
  ]
}
```

`available: false` is returned if the crawl has not yet completed or has no page results.

---

### GET /api/crawl/{crawl_id}/regressions
Compare this crawl against the most recent previous completed crawl for the same root URL. Returns `has_comparison: false` when no prior crawl exists.

**Response**
```json
{
  "ok": true,
  "has_comparison": true,
  "previous_crawl_id": "xyz789",
  "previous_crawl_date": "2026-05-28T09:00:00Z",
  "regressions": [
    {
      "url": "https://example.com/about",
      "previous_violations": 2,
      "current_violations": 7,
      "delta": 5
    }
  ],
  "improvements": [
    {
      "url": "https://example.com/contact",
      "previous_violations": 4,
      "current_violations": 1,
      "delta": -3
    }
  ],
  "new_pages": [
    { "url": "https://example.com/blog", "violations": 3 }
  ],
  "removed_pages": [
    { "url": "https://example.com/old-page" }
  ]
}
```

`regressions` are sorted by `delta` descending (worst first). Critical/Serious pages surface first.

---

### GET /api/crawls
List all crawl jobs, newest first.

**Query params**
- `limit` — max items to return (default 100)

**Response**
```json
{
  "ok": true,
  "available": true,
  "items": [
    {
      "crawl_id": "abc123",
      "root_url": "https://example.com",
      "status": "completed",
      "total_scanned": 38,
      "total_failed": 4,
      "duration_seconds": 762,
      "created_at": "2026-06-01T10:00:00Z",
      "site_score": 84,
      "avg_pass_rate": 91,
      "total_violations": 17
    }
  ],
  "count": 1
}
```

`available: false` with a `message` string is returned when the crawl feature is unavailable (e.g. Redis is not running).

---

### GET /api/crawls/compare
Side-by-side comparison of two crawl runs for the same root URL.

**Query params**
- `a` — first crawl_id (baseline)
- `b` — second crawl_id (target)

**Response**
```json
{
  "ok": true,
  "crawl_a": {
    "crawl_id": "abc123",
    "root_url": "https://example.com",
    "created_at": "2026-05-28T09:00:00Z",
    "total_scanned": 30,
    "site_score": 78,
    "avg_pass_rate": 85,
    "total_violations": 24
  },
  "crawl_b": {
    "crawl_id": "def456",
    "root_url": "https://example.com",
    "created_at": "2026-06-01T10:00:00Z",
    "total_scanned": 38,
    "site_score": 84,
    "avg_pass_rate": 91,
    "total_violations": 17
  },
  "summary": {
    "score_delta": 6,
    "pass_rate_delta": 6,
    "violations_delta": -7,
    "pages_improved": 8,
    "pages_regressed": 2,
    "pages_unchanged": 20,
    "pages_only_in_a": 0,
    "pages_only_in_b": 8
  },
  "regressed": [
    {
      "url": "https://example.com/about",
      "violations_a": 2,
      "violations_b": 5,
      "delta": 3
    }
  ],
  "improved": [
    {
      "url": "https://example.com/contact",
      "violations_a": 4,
      "violations_b": 1,
      "delta": -3
    }
  ],
  "only_in_a": [],
  "only_in_b": [
    { "url": "https://example.com/blog", "violations": 3 }
  ]
}
```

`regressed` is capped at 15 items; `improved` at 15; `only_in_a`/`only_in_b` at 10 each.  
Returns `ok: false` with an error if either crawl_id is not found or the URLs differ.

---

### GET /api/crawls/timeline
Score history for all completed crawls of a given root URL, ordered oldest → newest. Used to render the accessibility health trend chart.

**Query params**
- `url` — the root URL to query (required)
- `limit` — max runs to return (default 20)

**Response**
```json
{
  "ok": true,
  "url": "https://example.com",
  "count": 5,
  "data": [
    {
      "crawl_id": "abc001",
      "created_at": "2026-05-01T08:00:00Z",
      "total_scanned": 30,
      "duration_seconds": 540,
      "site_score": 72,
      "avg_pass_rate": 80,
      "total_violations": 31
    },
    {
      "crawl_id": "abc002",
      "created_at": "2026-05-10T08:00:00Z",
      "total_scanned": 32,
      "duration_seconds": 580,
      "site_score": 78,
      "avg_pass_rate": 85,
      "total_violations": 24
    }
  ]
}
```

Only `completed` crawls with a non-null `site_score` are included.

---

## Score / Metric Definitions

| Metric | Definition |
|---|---|
| `site_score` | Weighted mean of per-page pass rates, where pages with more axe checks carry more weight. Range 0–100. |
| `avg_pass_rate` | Simple mean of `CrawlPage.PassRate` across all successfully scanned pages. Range 0–100. |
| `total_violations` | Sum of `CrawlPage.Violations` across all scanned pages. |
| `pass_rate` (per page) | `round(passes / (passes + violations) * 100)` — computed by the axe runner. |

## WCAG Tag Mapping

axe-core tags on each violation rule are used to derive WCAG classification:

- Tags matching `wcag\d{3}` (e.g. `wcag143`, `wcag244`) → WCAG success criterion (e.g. `1.4.3`, `2.4.4`)
- First digit of criterion → principle: `1` = Perceivable, `2` = Operable, `3` = Understandable, `4` = Robust
- Tags like `wcag2a`, `wcag2aa` indicate conformance level, not criteria — these are ignored in the breakdown
