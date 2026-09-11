"""
Executive Summary PDF — renders the same report shown on the "Executive
Summary" page (src/pages/ExecutiveSummaryPage.jsx) as a real PDF file, so it
can be attached to a Slack message automatically on scan/crawl completion
instead of requiring someone to open the page and click "Print / Save PDF".

No PDF library dependency: Playwright (already used for scanning) renders the
HTML via page.pdf(), same launch/close pattern used everywhere else in this
codebase (see crawl_task.py, services/url_processor.py).
"""
import json
import logging
from datetime import datetime, timezone

from services import db

logger = logging.getLogger(__name__)

_SEVERITY_COLORS = {"critical": "#e76f51", "serious": "#f59e0b", "moderate": "#60a5fa", "minor": "#9ca3af"}
_SEVERITY_ORDER = ["critical", "serious", "moderate", "minor"]


def _html_to_pdf(html: str) -> bytes | None:
    """Render an HTML string to PDF bytes via a short-lived headless browser.
    Never raises — returns None and logs on any failure."""
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                page = browser.new_page()
                page.set_content(html, wait_until="load")
                return page.pdf(format="A4", print_background=True,
                                margin={"top": "18mm", "bottom": "18mm", "left": "14mm", "right": "14mm"})
            finally:
                browser.close()
    except Exception:
        logger.exception("Failed to render report HTML to PDF")
        return None


def _score_color(score) -> str:
    try:
        s = float(score)
    except (TypeError, ValueError):
        return "#9ca3af"
    if s >= 80:
        return "#059669"
    if s >= 60:
        return "#f59e0b"
    return "#e76f51"


def _html_shell(title: str, body: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111827; }}
  h1, h2 {{ margin: 0; }}
  .section {{ margin-bottom: 24px; }}
  .section-title {{ font-size: 13px; font-weight: 700; color: #374151; text-transform: uppercase;
                     letter-spacing: 0.05em; margin: 0 0 12px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
  th {{ background: #f9fafb; color: #6b7280; text-align: left; padding: 8px 10px; font-size: 10px;
        text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid #e5e7eb; }}
  td {{ padding: 8px 10px; border-bottom: 1px solid #f3f4f6; }}
  .kpi-grid {{ display: flex; gap: 10px; }}
  .kpi {{ flex: 1; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; text-align: center; }}
  .kpi-label {{ font-size: 9px; font-weight: 700; text-transform: uppercase; color: #9ca3af; margin-bottom: 4px; }}
  .kpi-value {{ font-size: 22px; font-weight: 700; color: #111827; }}
  .bar-track {{ height: 8px; background: #f3f4f6; border-radius: 4px; overflow: hidden; }}
  .bar-fill {{ height: 100%; border-radius: 4px; }}
</style>
</head>
<body>
<div style="max-width: 760px; margin: 0 auto; padding: 32px;">
{body}
</div>
</body>
</html>"""


def _cover_section(title: str, url: str, score, generated_at: str, sub_date: str | None = None) -> str:
    color = _score_color(score)
    sub = f"<p style=\"margin:2px 0 0;font-size:11px;color:#9ca3af;\">{sub_date}</p>" if sub_date else ""
    return f"""
<div style="border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; margin-bottom: 24px;
            display: flex; align-items: flex-start; justify-content: space-between;">
  <div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
      <div style="width:28px;height:28px;border-radius:6px;background:#1a7a6a;
                  display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:13px;">A</div>
      <span style="font-weight:700;font-size:15px;">ADA Accessibility Monitor</span>
    </div>
    <h1 style="font-size:22px;font-weight:700;margin-bottom:4px;">{title}</h1>
    <p style="margin:0;font-size:13px;color:#6b7280;">{url}</p>
    <p style="margin:2px 0 0;font-size:11px;color:#9ca3af;">Report generated: {generated_at}</p>
    {sub}
  </div>
  <div style="text-align:center;">
    <div style="font-size:32px;font-weight:700;color:{color};">{score if score is not None else '—'}</div>
    <p style="margin:0;font-size:10px;color:#9ca3af;">Site Score</p>
  </div>
</div>"""


def _severity_section(severity: dict) -> str:
    max_v = max([severity.get(k, 0) for k in _SEVERITY_ORDER] + [1])
    rows = []
    for key in _SEVERITY_ORDER:
        count = severity.get(key, 0)
        pct = round((count / max_v) * 100) if max_v else 0
        color = _SEVERITY_COLORS[key]
        rows.append(f"""
        <div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
            <span style="font-weight:600;text-transform:capitalize;">{key}</span>
            <span style="font-weight:700;color:{color};">{count}</span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:{pct}%;background:{color};"></div></div>
        </div>""")
    return f"""
<div class="section">
  <p class="section-title">Violation Severity</p>
  {''.join(rows)}
</div>"""


def _top_issues_table(items: list[dict], rule_key="rule_id", count_key="count", pages_key="affected_pages") -> str:
    if not items:
        return ""
    rows = "".join(
        f"""<tr><td style="font-weight:600;text-transform:capitalize;">{(it.get(rule_key) or '').replace('-', ' ')}</td>
             <td style="text-align:center;">{it.get(count_key, 0)}</td>
             <td style="text-align:center;color:#6b7280;">{it.get(pages_key, '—')}</td></tr>"""
        for it in items[:10]
    )
    return f"""
<div class="section">
  <p class="section-title">Top Issue Types</p>
  <table>
    <thead><tr><th>Rule</th><th style="text-align:center;">Occurrences</th><th style="text-align:center;">Pages Affected</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</div>"""


def _build_crawl_summary_html(job: dict, intel: dict, ai_summary: dict | None, regressions: dict, crawl_id: str) -> str:
    generated_at = datetime.now(timezone.utc).strftime("%B %d, %Y")
    body = _cover_section(
        "Executive Accessibility Summary", job.get("root_url", ""), job.get("site_score"), generated_at,
        sub_date=f"Crawl date: {(job.get('created_at') or '')[:10]}",
    )

    body += f"""
<div class="section">
  <p class="section-title">Key Metrics</p>
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-label">Pages Scanned</div><div class="kpi-value">{job.get('total_scanned', '—')}</div></div>
    <div class="kpi"><div class="kpi-label">Avg Pass Rate</div><div class="kpi-value">{job.get('avg_pass_rate', '—')}%</div></div>
    <div class="kpi"><div class="kpi-label">Total Violations</div><div class="kpi-value">{job.get('total_violations', '—')}</div></div>
    <div class="kpi"><div class="kpi-label">Duration</div><div class="kpi-value">{round(job['duration_seconds']) if job.get('duration_seconds') is not None else '—'}s</div></div>
  </div>
</div>"""

    if ai_summary and ai_summary.get("overall_health"):
        body += f"""
<div class="section" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;">
  <p class="section-title" style="border:none;padding:0;">AI Accessibility Assessment</p>
  <p style="font-size:12px;line-height:1.6;">{ai_summary.get('overall_health', '')}</p>
</div>"""

    severity = intel.get("severity_breakdown") or {}
    if any(severity.values()):
        body += _severity_section(severity)

    body += _top_issues_table(intel.get("top_issue_types") or [])

    reg = regressions.get("regressions") or []
    imp = regressions.get("improvements") or []
    if reg or imp:
        reg_rows = "".join(f"<tr><td>{r['url']}</td><td style=\"text-align:right;color:#dc2626;font-weight:700;\">+{r['delta']}</td></tr>" for r in reg[:7])
        imp_rows = "".join(f"<tr><td>{r['url']}</td><td style=\"text-align:right;color:#059669;font-weight:700;\">{r['delta']}</td></tr>" for r in imp[:7])
        body += f"""
<div class="section">
  <p class="section-title">Changes vs Previous Crawl</p>
  <table><tbody>{reg_rows}{imp_rows}</tbody></table>
</div>"""

    body += f"""
<div style="border-top:1px solid #e5e7eb;padding-top:12px;margin-top:12px;font-size:9px;color:#9ca3af;">
  This report was generated by ADA Accessibility Monitor using axe-core (WCAG 2.1 A/AA).
  Automated testing does not cover all accessibility requirements. Crawl ID: {crawl_id}
</div>"""

    return _html_shell("ADA Executive Summary", body)


def render_crawl_executive_summary(crawl_id: str) -> bytes | None:
    """Gather everything the Executive Summary page shows for this crawl and
    render it to PDF bytes. Best-effort — returns None on any failure."""
    try:
        job = db.get_crawl_job(crawl_id)
        if not job:
            return None
        intel = db.get_crawl_violation_intel(crawl_id)
        regressions = db.get_crawl_regressions(crawl_id)
        raw_summary = db.get_crawl_ai_summary(crawl_id)
        ai_summary = None
        if raw_summary:
            try:
                ai_summary = json.loads(raw_summary) if isinstance(raw_summary, str) else raw_summary
            except Exception:
                ai_summary = {"overall_health": raw_summary}
        html = _build_crawl_summary_html(job, intel, ai_summary, regressions, crawl_id)
        return _html_to_pdf(html)
    except Exception:
        logger.exception("Failed to build executive summary for crawl %s", crawl_id)
        return None


def _build_scan_summary_html(url: str, score, pass_rate, violations_count: int,
                              violations_detail: list[dict], reference: str) -> str:
    generated_at = datetime.now(timezone.utc).strftime("%B %d, %Y")
    body = _cover_section("Accessibility Scan Summary", url, score, generated_at)

    body += f"""
<div class="section">
  <p class="section-title">Key Metrics</p>
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-label">Pass Rate</div><div class="kpi-value">{pass_rate if pass_rate is not None else '—'}%</div></div>
    <div class="kpi"><div class="kpi-label">Violations</div><div class="kpi-value">{violations_count}</div></div>
    <div class="kpi"><div class="kpi-label">Reference</div><div class="kpi-value" style="font-size:13px;">{reference or '—'}</div></div>
  </div>
</div>"""

    severity = {k: 0 for k in _SEVERITY_ORDER}
    for v in violations_detail:
        impact = (v.get("impact") or "").lower()
        if impact in severity:
            severity[impact] += 1
    if any(severity.values()):
        body += _severity_section(severity)

    issue_rows = [{"rule_id": v.get("rule_id"), "count": v.get("affected_count", 0),
                   "affected_pages": "—"} for v in violations_detail]
    body += _top_issues_table(issue_rows)

    body += f"""
<div style="border-top:1px solid #e5e7eb;padding-top:12px;margin-top:12px;font-size:9px;color:#9ca3af;">
  This report was generated by ADA Accessibility Monitor using axe-core (WCAG 2.1 A/AA).
  Automated testing does not cover all accessibility requirements. Scan reference: {reference}
</div>"""

    return _html_shell("ADA Scan Summary", body)


def render_scan_summary(url: str, score, pass_rate, violations_count: int,
                         violations_detail: list[dict], reference: str) -> bytes | None:
    """Slimmer, single-scan equivalent of render_crawl_executive_summary — no
    AI summary/WCAG-principle/regressions sections, those are crawl-only
    concepts (see services/db.py::get_crawl_violation_intel / get_crawl_regressions).
    Best-effort — returns None on any failure."""
    try:
        html = _build_scan_summary_html(url, score, pass_rate, violations_count, violations_detail, reference)
        return _html_to_pdf(html)
    except Exception:
        logger.exception("Failed to build scan summary for %s", reference)
        return None
