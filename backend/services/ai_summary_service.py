"""
AI Summary Service — generates a human-readable accessibility summary for a
completed crawl using the Claude API. Result is stored in CrawlJob.Metadata.

Gracefully no-ops when ANTHROPIC_API_KEY is not configured.
"""
import json
import logging
import urllib.error
import urllib.request

from config import Config
from services import db

logger = logging.getLogger(__name__)

_SUMMARY_PROMPT = """\
You are an expert web accessibility consultant. A site crawl has just completed.
Analyse the data below and write a concise accessibility summary in the JSON format specified.

CRAWL DATA:
{crawl_data}

Return ONLY valid JSON in this exact structure (no markdown, no extra text):
{{
  "overall_health": "One sentence: overall accessibility health of the site.",
  "major_risks": ["Risk 1", "Risk 2", "Risk 3"],
  "most_affected_areas": ["Area 1", "Area 2"],
  "positive_findings": ["Finding 1", "Finding 2"],
  "recommended_priorities": ["Priority 1", "Priority 2", "Priority 3"]
}}

Be specific: mention rule names, WCAG criteria, and page counts where available.
Keep each list item under 120 characters. Maximum 4 items per list."""


def generate_and_store_summary(crawl_id: str) -> bool:
    """
    Generate an AI summary for crawl_id and persist it to the DB.
    Returns True on success, False on any failure (never raises).
    """
    if not Config.AI_SUMMARY_ENABLED:
        logger.debug("AI summary disabled — ANTHROPIC_API_KEY not configured.")
        return False

    # Check cache — don't call AI twice
    existing = db.get_crawl_ai_summary(crawl_id)
    if existing:
        logger.debug("AI summary already cached for crawl_id=%s", crawl_id)
        return True

    try:
        crawl_data = _collect_crawl_context(crawl_id)
        if crawl_data is None:
            logger.warning("AI summary: crawl_id=%s not found in DB", crawl_id)
            return False

        summary_json = _call_claude(crawl_data)
        if summary_json is None:
            return False

        db.set_crawl_ai_summary(crawl_id, json.dumps(summary_json))
        logger.info("AI summary stored for crawl_id=%s", crawl_id)
        return True

    except Exception:
        logger.exception("generate_and_store_summary failed for crawl_id=%s", crawl_id)
        return False


def _collect_crawl_context(crawl_id: str) -> dict | None:
    job = db.get_crawl_job(crawl_id)
    if not job:
        return None

    intel = db.get_crawl_violation_intel(crawl_id)
    regressions = db.get_crawl_regressions(crawl_id)

    ctx = {
        "root_url": job.get("root_url"),
        "total_scanned": job.get("total_scanned", 0),
        "total_violations": job.get("total_violations"),
        "avg_pass_rate": job.get("avg_pass_rate"),
        "site_score": job.get("site_score"),
        "severity_breakdown": intel.get("severity_breakdown", {}),
        "top_issue_types": intel.get("top_issue_types", [])[:5],
        "wcag_principles": intel.get("wcag_principles", {}),
        "regression_count": len(regressions.get("regressions", [])) if regressions.get("has_comparison") else None,
    }
    return ctx


def _call_claude(crawl_data: dict) -> dict | None:
    prompt = _SUMMARY_PROMPT.format(crawl_data=json.dumps(crawl_data, indent=2))
    payload = json.dumps({
        "model": Config.AI_SUMMARY_MODEL,
        "max_tokens": 600,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "x-api-key": Config.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
        text = result["content"][0]["text"].strip()
        return json.loads(text)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        logger.error("Claude API error: %s %s", e.code, body)
        return None
    except json.JSONDecodeError as e:
        logger.error("Failed to parse Claude JSON response: %s", e)
        return None
    except Exception as e:
        logger.error("Claude API call failed: %s", e)
        return None
