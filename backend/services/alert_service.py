"""
Alert Service — evaluates accessibility regressions after crawl completion
and creates AccessibilityAlert records. Optionally sends email notifications.
"""
import logging

from config import Config
from services import db

logger = logging.getLogger(__name__)


def evaluate_and_create_alerts(crawl_id: str) -> list[int]:
    """
    Compare the completed crawl against its predecessor and generate alerts
    for significant regressions. Returns list of created alert IDs.
    """
    if not db.is_ready():
        return []

    job = db.get_crawl_job(crawl_id)
    if not job:
        return []

    root_url = job.get("root_url", "")
    regressions = db.get_crawl_regressions(crawl_id)
    created_ids: list[int] = []

    if not regressions.get("has_comparison"):
        # No prior crawl to compare — nothing to alert on
        return []

    prev_job = db.get_crawl_job(regressions.get("previous_crawl_id", ""))
    if not prev_job:
        return []

    curr_score = job.get("site_score")
    prev_score = prev_job.get("site_score")
    curr_violations = job.get("total_violations")
    prev_violations = prev_job.get("total_violations")

    # Alert: significant score drop
    if curr_score is not None and prev_score is not None:
        drop = prev_score - curr_score
        if drop >= Config.ALERT_SCORE_DROP_THRESHOLD:
            aid = db.create_alert(
                crawl_id=crawl_id,
                root_url=root_url,
                alert_type="score_decrease",
                severity="serious" if drop >= 10 else "moderate",
                details={
                    "previous_score": prev_score,
                    "current_score": curr_score,
                    "drop": drop,
                    "previous_crawl_id": regressions["previous_crawl_id"],
                },
            )
            if aid:
                created_ids.append(aid)

    # Alert: significant total violation increase
    if curr_violations is not None and prev_violations is not None:
        increase = curr_violations - prev_violations
        if increase >= Config.ALERT_VIOLATION_INCREASE_THRESHOLD:
            aid = db.create_alert(
                crawl_id=crawl_id,
                root_url=root_url,
                alert_type="violation_increase",
                severity="serious",
                details={
                    "previous_violations": prev_violations,
                    "current_violations": curr_violations,
                    "increase": increase,
                    "previous_crawl_id": regressions["previous_crawl_id"],
                },
            )
            if aid:
                created_ids.append(aid)

    # Alert: critical/serious violations introduced
    curr_intel = db.get_crawl_violation_intel(crawl_id)
    prev_intel = db.get_crawl_violation_intel(regressions["previous_crawl_id"])
    curr_critical = (curr_intel.get("severity_breakdown") or {}).get("critical", 0)
    prev_critical = (prev_intel.get("severity_breakdown") or {}).get("critical", 0)

    if curr_critical > prev_critical:
        aid = db.create_alert(
            crawl_id=crawl_id,
            root_url=root_url,
            alert_type="critical_introduced",
            severity="critical",
            details={
                "previous_critical": prev_critical,
                "current_critical": curr_critical,
                "new_critical": curr_critical - prev_critical,
                "previous_crawl_id": regressions["previous_crawl_id"],
            },
        )
        if aid:
            created_ids.append(aid)

    # Alert: regression detected (pages with increased violations)
    page_regressions = regressions.get("regressions", [])
    if page_regressions:
        aid = db.create_alert(
            crawl_id=crawl_id,
            root_url=root_url,
            alert_type="regression_detected",
            severity="moderate",
            details={
                "regressed_page_count": len(page_regressions),
                "worst_page": page_regressions[0].get("url") if page_regressions else None,
                "worst_delta": page_regressions[0].get("delta") if page_regressions else None,
                "previous_crawl_id": regressions["previous_crawl_id"],
            },
        )
        if aid:
            created_ids.append(aid)

    if created_ids:
        logger.info(
            "Created %d alert(s) for crawl_id=%s root_url=%s",
            len(created_ids), crawl_id, root_url,
        )
        _send_alert_email(crawl_id, root_url, created_ids, job, regressions)

    return created_ids


def _send_alert_email(crawl_id: str, root_url: str, alert_ids: list[int], job: dict, regressions: dict) -> None:
    if not Config.SMTP_ENABLED or not Config.SMTP_HOST:
        return

    recipient = (
        Config.ALERT_EMAIL.strip()
        or (job.get("notify_email") or "").strip()
        or Config.SMTP_FROM.strip()
    )
    if not recipient:
        return

    try:
        import smtplib
        import ssl
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText

        compare_url = (
            f"{Config.APP_BASE_URL}/crawl-history"
            f"?compare={regressions.get('previous_crawl_id', '')}&with={crawl_id}"
        )
        curr_score = job.get("site_score", "N/A")
        curr_violations = job.get("total_violations", "N/A")
        alert_count = len(alert_ids)

        html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1f2937">
  <div style="background:#fee2e2;border-left:4px solid #E76F51;padding:16px;border-radius:8px;margin-bottom:20px">
    <strong style="color:#E76F51">⚠ Accessibility Alert</strong>
    <p style="margin:6px 0 0;color:#374151">
      {alert_count} accessibility regression(s) detected on <strong>{root_url}</strong>
    </p>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
    <tr><td style="padding:8px;color:#6b7280;font-size:13px">Site Score</td>
        <td style="padding:8px;font-weight:bold">{curr_score}</td></tr>
    <tr style="background:#f9fafb"><td style="padding:8px;color:#6b7280;font-size:13px">Total Violations</td>
        <td style="padding:8px;font-weight:bold">{curr_violations}</td></tr>
    <tr><td style="padding:8px;color:#6b7280;font-size:13px">Crawl ID</td>
        <td style="padding:8px;font-size:12px;font-family:monospace">{crawl_id}</td></tr>
  </table>
  <a href="{compare_url}"
     style="display:inline-block;background:#0F766E;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">
    View Crawl Comparison
  </a>
  <p style="color:#9ca3af;font-size:11px;margin-top:24px">
    ADA Accessibility Monitor &mdash; Automated alert
  </p>
</body></html>"""

        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[ADA Alert] {alert_count} regression(s) detected on {root_url}"
        msg["From"] = Config.SMTP_FROM
        msg["To"] = recipient
        msg.attach(MIMEText(html, "html", "utf-8"))

        ctx = ssl.create_default_context()
        with smtplib.SMTP(Config.SMTP_HOST, Config.SMTP_PORT) as s:
            s.ehlo()
            s.starttls(context=ctx)
            if Config.SMTP_USER and Config.SMTP_PASS:
                s.login(Config.SMTP_USER, Config.SMTP_PASS)
            s.sendmail(Config.SMTP_FROM, [recipient], msg.as_string())

        logger.info("Alert email sent to %s for crawl_id=%s", recipient, crawl_id)
    except Exception:
        logger.exception("Failed to send alert email for crawl_id=%s", crawl_id)
