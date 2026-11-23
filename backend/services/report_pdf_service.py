"""
Executive Summary PDF — renders the same report shown on the "Executive
Summary" page (src/pages/ExecutiveSummaryPage.jsx) as a real PDF file, so it
can be attached to a Slack message automatically on scan/crawl completion
instead of requiring someone to open the page and click "Print / Save PDF".

No PDF library dependency: Playwright (already used for scanning) renders the
HTML via page.pdf(), same launch/close pattern used everywhere else in this
codebase (see crawl_task.py, services/url_processor.py).
"""
import html as html_lib
import json
import logging
from datetime import datetime, timezone

from backend.services.fix_proof import wcag_criteria
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


# ─── Full technical audit reports ────────────────────────────────────────────
# Unlike the executive summaries above (top-10 issues, no raw markup), these
# dump every violation node's selector/HTML/failure summary — the level of
# detail a technical architect needs to hand a specific element to a dev team.

def _esc(value) -> str:
    return html_lib.escape('' if value is None else str(value))


# Plain-language wording per rule: (what's wrong, how to fix). Rules not listed
# fall back to axe's own one-line "help" text, which is already readable.
_PLAIN_RULES = {
    "image-alt": ("An image has no text description, so screen reader users don't know what it shows.",
                  "Add alt text that says what the image shows, or alt=\"\" if it's only decoration."),
    "button-name": ("A button has no name. A screen reader only says \"button\", so users can't tell what it does.",
                    "Give the button visible text or an aria-label, e.g. aria-label=\"Notifications\"."),
    "link-name": ("A link has no name, so screen reader users can't tell where it goes.",
                  "Give the link visible text or an aria-label that names its destination."),
    "label": ("A form field has no label, so screen reader users don't know what to type in it.",
              "Add a <label> for the field, or an aria-label."),
    "select-name": ("A dropdown has no label, so screen reader users don't know what it's for.",
                    "Add a <label> for the dropdown, or an aria-label."),
    "list": ("A list contains something that isn't a list item, so screen readers announce the list wrongly.",
             "Put only <li> items directly inside <ul>/<ol>."),
    "listitem": ("A list item sits outside a list, so screen readers can't announce it as part of one.",
                 "Wrap the <li> items in a <ul> or <ol>."),
    "definition-list": ("A definition list contains something that isn't a term or description, so it's announced wrongly.",
                        "Put only <dt> terms and <dd> descriptions directly inside <dl>."),
    "dlitem": ("A term or description sits outside a definition list.",
               "Wrap <dt>/<dd> items in a <dl>."),
    "object-alt": ("Embedded content (an <object>) has no text description, so screen reader users don't know what it is.",
                   "Add an aria-label or title describing the content, e.g. aria-label=\"Sales chart\"."),
    "svg-img-alt": ("An SVG image has no text description.", "Add a <title> or aria-label to the SVG."),
    "input-image-alt": ("An image button has no text description.", "Add alt text that says what the button does."),
    "color-contrast": ("Text is too faint against its background for people with low vision to read.",
                       "Darken the text or lighten the background to reach a 4.5:1 contrast ratio (3:1 for large text)."),
    "document-title": ("The page has no title, so screen readers and browser tabs can't name it.",
                       "Add a descriptive <title> in the page's <head>."),
    "html-has-lang": ("The page doesn't say what language it's in, so screen readers may mispronounce it.",
                      "Add lang=\"en\" (or the right language) to the <html> tag."),
    "frame-title": ("An embedded frame has no title, so screen reader users don't know what's inside.",
                    "Add a title attribute to the <iframe> describing its content."),
    "heading-order": ("Heading levels skip (e.g. h2 then h4), which breaks the page outline screen reader users navigate by.",
                      "Use heading levels in order without skipping."),
    "page-has-heading-one": ("The page has no main heading (h1), so users can't find where the content starts.",
                             "Add one <h1> naming the page."),
    "empty-heading": ("A heading has no text, so screen readers announce an empty heading.",
                      "Add text to the heading or remove it."),
    "landmark-one-main": ("The page has no main content area marked, so users can't jump to it.",
                          "Wrap the main content in <main>."),
    "region": ("Some content isn't inside a page region, so screen reader users can miss it when jumping around.",
               "Put all content inside landmarks such as <header>, <main>, <nav> or <footer>."),
    "landmark-unique": ("Two navigation areas have the same name, so users can't tell them apart.",
                        "Give each <nav> a distinct aria-label."),
    "bypass": ("There's no way to skip past repeated menus straight to the content.",
               "Add a \"Skip to main content\" link at the top of the page."),
    "aria-hidden-focus": ("Something hidden from screen readers can still be reached with the Tab key, so keyboard users land on \"nothing\".",
                          "Make the hidden content unfocusable (tabindex=\"-1\") or stop hiding it."),
    "aria-valid-attr-value": ("An ARIA attribute has an invalid value, so screen readers may announce the wrong state.",
                              "Use a valid value for the attribute (e.g. true/false, or an existing id)."),
    "aria-allowed-attr": ("An element uses an ARIA attribute it doesn't support.", "Remove the attribute or use the right role."),
    "aria-required-attr": ("An ARIA role is missing an attribute it needs to work.", "Add the required attribute for that role."),
    "aria-roles": ("An element has a role that doesn't exist.", "Use a valid ARIA role or remove it."),
    "aria-command-name": ("A custom button or link has no name.", "Add an aria-label or visible text."),
    "aria-required-parent": ("An element with an ARIA role isn't inside the parent it needs.", "Place it inside the required parent role."),
    "autocomplete-valid": ("A form field has an invalid autocomplete value, so browsers and assistive tools can't fill it in.",
                           "Use a standard autocomplete value such as \"email\" or \"tel\"."),
    "meta-viewport": ("The page blocks zooming, so people with low vision can't enlarge text.",
                      "Remove user-scalable=no / maximum-scale from the viewport meta tag."),
    "nested-interactive": ("A clickable element is inside another clickable element, which confuses keyboard and screen reader users.",
                           "Keep only one interactive element — e.g. a link or a button, not a link inside a button."),
    "duplicate-id": ("Two elements share the same id.", "Give every element a unique id."),
    "duplicate-id-aria": ("Two elements share an id that assistive technology relies on, so the wrong one may be read.",
                          "Give every element a unique id."),
    "video-caption": ("A video has no captions, so deaf and hard-of-hearing users miss the audio.",
                      "Add a captions track: <track kind=\"captions\" src=\"…\">."),
    "th-has-data-cells": ("A table header has no data under it.", "Remove empty header columns or add their data."),
    "td-headers-attr": ("Table cells point at headers that don't exist.", "Fix the cells' headers attribute."),
    "scrollable-region-focusable": ("A scrolling area can't be reached with the keyboard.",
                                    "Add tabindex=\"0\" to the scrolling area."),
}


def _plain(rule_id: str, help_text: str) -> tuple[str, str]:
    return _PLAIN_RULES.get(rule_id) or (help_text or rule_id, "See the rule guidance linked below.")


def _node_selector(node: dict) -> str:
    from scripts.run_ada_check_python import _selector_from_node_target
    return _selector_from_node_target(node.get("target")) or ""


def _split_fixed(violations: list[dict], proofs: list[dict]) -> tuple[list[dict], list[dict]]:
    """(still-to-fix violations with only their unfixed elements, fixed proofs —
    newest per element). An element counts as fixed when a verified fix with
    proof exists for the same rule + element on this page."""
    fixed, seen = [], set()
    for p in proofs:  # newest first
        key = (p.get("rule_id"), p.get("selector"))
        if key not in seen:
            seen.add(key)
            fixed.append(p)
    open_ = []
    for v in violations:
        nodes = [n for n in (v.get("nodes") or []) if (v.get("id"), _node_selector(n)) not in seen]
        if nodes:
            open_.append({**v, "nodes": nodes})
    return open_, fixed


def _titled_section(title: str, blocks: list[str]) -> str:
    """Title glued to its first card so a page break never strands the heading."""
    head = f'<div style="page-break-inside:avoid;"><p class="section-title">{_esc(title)}</p>{blocks[0]}</div>'
    return f'<div class="section">{head}{"".join(blocks[1:])}</div>'


def _summary_section(open_count: int, fixed_count: int) -> str:
    total = open_count + fixed_count
    def box(label, value, color, note):
        return (f'<div class="kpi" style="border-color:{color};"><div class="kpi-label">{label}</div>'
                f'<div class="kpi-value" style="color:{color};font-size:30px;">{value}</div>'
                f'<div style="font-size:10px;color:#6b7280;">{note}</div></div>')
    verdict = ("All issues found on this page have a verified fix." if total and not open_count else
               "No accessibility issues were found on this page." if not total else
               f"{open_count} issue{'s' if open_count != 1 else ''} still need{'s' if open_count == 1 else ''} fixing.")
    return f"""
<div class="section">
  <p class="section-title">Summary</p>
  <div class="kpi-grid">
    {box("Issues found", total, "#111827", "elements that failed a check")}
    {box("Fixed", fixed_count, "#059669", "fix verified by a re-scan")}
    {box("Still to fix", open_count, "#e76f51" if open_count else "#059669", "need attention")}
  </div>
  <p style="margin:10px 0 0;font-size:12px;font-weight:600;">{_esc(verdict)}</p>
</div>"""


def _dev_table_section(open_issues: list[dict], fixed: list[dict], impact_by_rule: dict | None = None) -> str:
    """Developer task list: one row per element — status, severity, issue,
    where (selector + file:line when known), the fix as code, PR link."""
    order = {k: i for i, k in enumerate(_SEVERITY_ORDER)}
    rows = []
    def code(text, limit=180):
        text = (text or "").strip()
        return (f'<code style="display:block;font-size:8.5px;background:#f3f4f6;padding:3px 4px;border-radius:3px;'
                f'white-space:pre-wrap;word-break:break-all;">{_esc(text[:limit])}{"…" if len(text) > limit else ""}</code>') if text else ""
    def sev(impact):
        impact = (impact or "").lower()
        return (f'<span style="font-weight:700;text-transform:uppercase;font-size:8.5px;color:{_SEVERITY_COLORS.get(impact, "#9ca3af")};">'
                f'{_esc(impact or "—")}</span>')
    for v in sorted(open_issues, key=lambda v: order.get((v.get("impact") or "minor").lower(), 9)):
        _, fix = _plain(v.get("id"), v.get("help"))
        for el in v.get("nodes") or []:
            rows.append(("open", sev(v.get("impact")), v.get("help") or v.get("id"), v.get("id"),
                         f'<span style="font-family:monospace;">{_esc(_node_selector(el))}</span>{code(el.get("html"), 140)}',
                         _esc(fix), "—"))
    for p in fixed:
        where = f'<span style="font-family:monospace;">{_esc(p.get("selector"))}</span>'
        if p.get("file"):
            where += f'<br><span style="font-family:monospace;color:#1d4ed8;">{_esc(p["file"])}</span>'
        change = (f'{code(p.get("code_before"))}<div style="font-size:8.5px;color:#6b7280;margin:1px 0;">→ changed to</div>{code(p.get("code_after"))}'
                  if p.get("code_after") else _esc(_plain(p.get("rule_id"), p.get("help"))[1]))
        pr = f'<a href="{_esc(p.get("pr_url"))}">PR</a>' if p.get("pr_url") else "—"
        impact = p.get("impact") or (impact_by_rule or {}).get(p.get("rule_id"))
        rows.append(("fixed", sev(impact), p.get("help") or p.get("rule_id"), p.get("rule_id"), where, change, pr))
    if not rows:
        return ""
    status = {"open": '<span style="color:#e76f51;font-weight:700;">Open</span>',
              "fixed": '<span style="color:#059669;font-weight:700;">Fixed</span>'}
    body = "".join(
        f'<tr style="page-break-inside:avoid;"><td>{i}</td><td>{status[st]}</td><td>{sv}</td>'
        f'<td><b>{_esc(issue)}</b><br><span style="font-family:monospace;color:#6b7280;font-size:8.5px;">{_esc(rule)}</span></td>'
        f'<td>{where}</td><td>{fix}</td><td>{pr}</td></tr>'
        for i, (st, sv, issue, rule, where, fix, pr) in enumerate(rows, 1))
    return f"""
<div class="section">
  <p class="section-title">Developer task list</p>
  <table style="font-size:9.5px;table-layout:fixed;">
    <colgroup><col style="width:4%"><col style="width:8%"><col style="width:9%"><col style="width:19%">
              <col style="width:24%"><col style="width:30%"><col style="width:6%"></colgroup>
    <thead><tr><th>#</th><th>Status</th><th>Severity</th><th>Issue</th><th>Where</th><th>Fix</th><th>PR</th></tr></thead>
    <tbody>{body}</tbody>
  </table>
  <p style="margin:6px 0 0;font-size:9px;color:#9ca3af;">Open = still on the page at scan time. Fixed = fix verified by a re-scan and opened as a pull request. Details for each row follow below.</p>
</div>"""


def _open_issues_section(violations: list[dict]) -> str:
    if not violations:
        return ""
    order = {k: i for i, k in enumerate(_SEVERITY_ORDER)}
    violations = sorted(violations, key=lambda v: order.get((v.get("impact") or "minor").lower(), 9))
    blocks = []
    for n, v in enumerate(violations, 1):
        impact = (v.get("impact") or "minor").lower()
        color = _SEVERITY_COLORS.get(impact, "#9ca3af")
        problem, fix = _plain(v.get("id"), v.get("help"))
        nodes = v.get("nodes") or []
        where = "".join(
            f'<div style="margin-top:4px;"><span style="font-family:monospace;font-size:10px;color:#6b7280;">{_esc(_node_selector(el))}</span>'
            f'<pre style="margin:2px 0 0;font-size:9.5px;background:#f9fafb;padding:5px 7px;border-radius:4px;white-space:pre-wrap;word-break:break-all;">{_esc((el.get("html") or "")[:300])}</pre></div>'
            for el in nodes[:10])
        more = f'<p style="font-size:10px;color:#9ca3af;margin:4px 0 0;">+ {len(nodes) - 10} more element(s)</p>' if len(nodes) > 10 else ""
        tags = ", ".join(t for t in (v.get("tags") or []) if t.startswith("wcag"))
        blocks.append(f"""
    <div style="margin-bottom:12px;border:1px solid #e5e7eb;border-left:4px solid {color};border-radius:8px;padding:10px 12px;page-break-inside:avoid;">
      <div style="display:flex;justify-content:space-between;gap:10px;">
        <span style="font-weight:700;font-size:12.5px;">{n}. {_esc(problem)}</span>
        <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:{color};white-space:nowrap;">{_esc(impact)}</span>
      </div>
      <p style="margin:6px 0 0;font-size:11.5px;"><b>How to fix:</b> {_esc(fix)}</p>
      <p style="margin:6px 0 0;font-size:11px;"><b>Where</b> ({len(nodes)} element{'s' if len(nodes) != 1 else ''}):</p>
      {where}{more}
      <p style="margin:6px 0 0;font-size:9px;color:#9ca3af;">Technical details: rule <b>{_esc(v.get('id'))}</b>{(' · ' + _esc(tags)) if tags else ''} · {_esc(v.get('helpUrl'))}</p>
    </div>""")
    return _titled_section(f'Still to fix ({sum(len(v.get("nodes") or []) for v in violations)})', blocks)


def _fix_proof_section(proofs: list[dict]) -> str:
    """Fixed issues — each with its re-scan proof: before/after screenshots and
    what a screen reader announces. Empty when the page has no proofs."""
    if not proofs:
        return ""
    def img(p, side):
        b64 = p.get(f"{side}_screenshot")
        return (f'<img src="data:image/jpeg;base64,{b64}" alt="{side} screenshot" style="max-width:100%;border:1px solid #e5e7eb;border-radius:4px;">'
                if b64 else '<p style="font-size:10px;color:#9ca3af;">Screenshot unavailable</p>')
    blocks = []
    for n, p in enumerate(proofs, 1):
        problem, fix = _plain(p.get("rule_id"), p.get("help"))
        pr = f' · <a href="{_esc(p.get("pr_url"))}">View pull request</a>' if p.get("pr_url") else ""
        blocks.append(f"""
    <div style="margin-bottom:14px;border:1px solid #e5e7eb;border-left:4px solid #059669;border-radius:8px;padding:10px 12px;page-break-inside:avoid;">
      <div style="display:flex;justify-content:space-between;gap:10px;">
        <span style="font-weight:700;font-size:12.5px;">{n}. {_esc(problem)}</span>
        <span style="color:#059669;font-size:10px;font-weight:700;text-transform:uppercase;white-space:nowrap;">Fixed &amp; verified</span>
      </div>
      <p style="margin:4px 0 0;font-size:11px;"><b>What was done:</b> {_esc(fix)}</p>
      <p style="margin:2px 0 8px;font-size:10px;color:#6b7280;">Fixed {_esc((p.get('created_at') or '')[:10])} · element <span style="font-family:monospace;">{_esc(p.get('selector'))}</span>{pr}</p>
      <table>
        <thead><tr><th style="width:18%;"></th><th>Before (red = problem)</th><th>After (green = fixed)</th></tr></thead>
        <tbody>
          <tr><td style="font-size:10px;font-weight:600;">Screenshot</td><td>{img(p, 'before')}</td><td>{img(p, 'after')}</td></tr>
          <tr><td style="font-size:10px;font-weight:600;">Screen reader says</td><td style="font-size:11px;">{_esc(p.get('before_announce') or '—')}</td><td style="font-size:11px;">{_esc(p.get('after_announce') or '—')}</td></tr>
        </tbody>
      </table>
      <p style="margin:6px 0 0;font-size:9px;color:#9ca3af;">Technical details: rule <b>{_esc(p.get('rule_id'))}</b> · re-scanned after the fix and no longer reported.</p>
    </div>""")
    return _titled_section(f"Fixed ({len(proofs)})", blocks)


def _build_full_scan_report_html(url: str, pass_rate, violations: list[dict], passes_count: int, reference: str, timestamp: str | None,
                                  fix_proofs: list[dict] | None = None, passes: list[dict] | None = None) -> str:
    generated_at = datetime.now(timezone.utc).strftime("%B %d, %Y")
    open_issues, fixed = _split_fixed(violations, fix_proofs or [])
    open_count = sum(len(v.get("nodes") or []) for v in open_issues)
    body = _cover_section("Accessibility Report — Page Scan", url, pass_rate, generated_at,
                          sub_date=f"Scan date: {(timestamp or '')[:10]}" if timestamp else None)
    body += _summary_section(open_count, len(fixed))
    body += _dev_table_section(open_issues, fixed, {v.get("id"): v.get("impact") for v in violations})
    body += _open_issues_section(open_issues)
    body += _fix_proof_section(fixed)
    body += _conformance_section(violations, passes or [], open_issues)
    body += f"""
<div class="section">
  <p class="section-title">Scan details</p>
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-label">Pass rate (at scan time)</div><div class="kpi-value">{pass_rate if pass_rate is not None else '—'}%</div></div>
    <div class="kpi"><div class="kpi-label">Checks passed</div><div class="kpi-value">{passes_count}</div></div>
    <div class="kpi"><div class="kpi-label">Checks failed</div><div class="kpi-value">{len(violations)}</div></div>
    <div class="kpi"><div class="kpi-label">Reference</div><div class="kpi-value" style="font-size:13px;">{reference or '—'}</div></div>
  </div>
</div>
<div style="border-top:1px solid #e5e7eb;padding-top:12px;margin-top:12px;font-size:9px;color:#9ca3af;">
  Generated by ADA Accessibility Monitor using axe-core (WCAG 2.1 A/AA). "Fixed" means the fix was applied in a pull request and a
  re-scan of the patched page no longer reports the issue; it reaches the live site once the pull request is merged and deployed.
  Automated testing does not cover all accessibility requirements. Scan reference: {reference}
</div>"""
    return _html_shell("Accessibility Report", body)


def render_full_scan_report(scan_id: int, user_id: int | None = None, all_users: bool = False) -> bytes | None:
    """Full technical audit report (every violation node's selector/HTML/
    failure summary) for a single page scan. Best-effort — returns None on
    any failure or if the scan doesn't exist."""
    try:
        result = db.get_scan_result(scan_id)
        if not result:
            return None
        axe = result.get("axeResult") or {}
        violations = axe.get("violations") or []
        passes = axe.get("passes") or []
        total = len(violations) + len(passes)
        pass_rate = round((len(passes) / total) * 100) if total else None
        proofs = db.get_fix_proofs(None if all_users else user_id, page_url=result.get("url")) if user_id else []
        html = _build_full_scan_report_html(result.get("url"), pass_rate, violations, len(passes), f"SCAN-{scan_id}", None, proofs, passes)
        return _html_to_pdf(html)
    except Exception:
        logger.exception("Failed to build full scan report for scan_id=%s", scan_id)
        return None


def _checks_table_html(checks: list[dict]) -> str:
    if not checks:
        return ""
    rows = "".join(f"""
      <tr>
        <td style="font-weight:600;">{_esc(c.get('label') or c.get('id'))}</td>
        <td style="text-align:center;font-weight:700;color:{'#059669' if c.get('passed') else '#dc2626'};">{'PASS' if c.get('passed') else 'FAIL'}</td>
        <td style="font-size:11px;color:#6b7280;">{_esc(c.get('details') or '')}</td>
      </tr>""" for c in checks)
    return f"""
<div class="section">
  <p class="section-title">Automated Checks</p>
  <table>
    <thead><tr><th>Check</th><th style="text-align:center;">Result</th><th>Details</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</div>"""


_ASSISTIVE_MODULE_LABELS = {
    "keyboard": "Keyboard Navigation",
    "contrast": "Color Contrast",
    "page-structure": "Page Structure",
    "forms": "Forms Accessibility",
}


def render_full_assistive_report(scan_id: int, user_id: int | None = None, all_users: bool = False) -> bytes | None:
    """Full technical audit report for a single assistive test run — every
    automated check with its pass/fail result and details. Best-effort —
    returns None on any failure or if the run doesn't exist."""
    try:
        row = db.get_assistive_scan_result(scan_id)
        if not row:
            return None
        payload = row.get("payload") or {}
        label = _ASSISTIVE_MODULE_LABELS.get(row.get("scan_type"), row.get("scan_type") or "Assistive Test")
        checks = payload.get("checks") or []
        failed = [c for c in checks if not c.get("passed")]
        generated_at = datetime.now(timezone.utc).strftime("%B %d, %Y")

        body = _cover_section(f"Full Technical Audit Report — {label} Test", row.get("url", ""), None, generated_at,
                               sub_date=f"Test date: {(row.get('timestamp') or '')[:10]}")
        body += f"""
<div class="section">
  <p class="section-title">Key Metrics</p>
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-label">Result</div><div class="kpi-value" style="color:{'#059669' if row.get('passed') else '#e76f51'};">{'PASS' if row.get('passed') else 'FAIL'}</div></div>
    <div class="kpi"><div class="kpi-label">Checks Run</div><div class="kpi-value">{len(checks)}</div></div>
    <div class="kpi"><div class="kpi-label">Failed</div><div class="kpi-value">{len(failed)}</div></div>
  </div>
</div>"""
        if payload.get("summary"):
            body += f"""
<div class="section" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;">
  <p style="font-size:12px;line-height:1.6;margin:0;">{_esc(payload.get('summary'))}</p>
</div>"""
        body += _checks_table_html(checks)
        body += _fix_proof_section(db.get_fix_proofs(None if all_users else user_id, page_url=row.get("url")) if user_id else [])

        errors = payload.get("errors") or []
        if errors:
            error_items = "".join(f"<li style=\"font-size:11px;color:#dc2626;\">{_esc(e)}</li>" for e in errors)
            body += f'<div class="section"><p class="section-title">Errors</p><ul style="margin:0;padding-left:18px;">{error_items}</ul></div>'

        body += f"""
<div style="border-top:1px solid #e5e7eb;padding-top:12px;margin-top:12px;font-size:9px;color:#9ca3af;">
  This report was generated by ADA Accessibility Monitor. Assistive test reference: ASSISTIVE-{scan_id}
</div>"""
        return _html_to_pdf(_html_shell("Full Audit Report", body))
    except Exception:
        logger.exception("Failed to build full assistive report for scan_id=%s", scan_id)
        return None


def render_full_crawl_report(crawl_id: str) -> bytes | None:
    """Full technical audit report for a crawl: the executive summary plus
    every scanned page's violation/pass-rate breakdown (not just the top 10
    regressions shown on the Executive Summary page). Best-effort — returns
    None on any failure."""
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

        pages = sorted(db.get_crawl_pages(crawl_id), key=lambda p: (p.get("violations") or 0), reverse=True)
        rows = "".join(f"""
          <tr>
            <td style="font-size:11px;word-break:break-all;">{_esc(p.get('url'))}</td>
            <td style="text-align:center;">{p.get('depth') if p.get('depth') is not None else '—'}</td>
            <td style="text-align:center;font-weight:700;color:{'#e76f51' if (p.get('violations') or 0) else '#059669'};">{p.get('violations') or 0}</td>
            <td style="text-align:center;">{p.get('passes') or 0}</td>
            <td style="text-align:center;">{f"{p.get('pass_rate'):.0f}%" if p.get('pass_rate') is not None else '—'}</td>
            <td style="text-align:center;">{_esc(p.get('status'))}</td>
          </tr>""" for p in pages[:200])
        note = f'<p style="font-size:10px;color:#9ca3af;margin:6px 0 0;">Showing 200 of {len(pages)} pages (worst first).</p>' if len(pages) > 200 else ''
        full_pages_section = f"""
<div class="section">
  <p class="section-title">Full Page-by-Page Breakdown ({len(pages)} pages)</p>
  <table>
    <thead><tr><th>URL</th><th style="text-align:center;">Depth</th><th style="text-align:center;">Violations</th>
      <th style="text-align:center;">Passes</th><th style="text-align:center;">Pass Rate</th><th style="text-align:center;">Status</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
  {note}
</div>"""

        html = html.replace("</body>", full_pages_section + "</body>").replace(
            "This report was generated by ADA Accessibility Monitor using axe-core",
            "Full technical audit — generated by ADA Accessibility Monitor using axe-core",
        )
        return _html_to_pdf(html)
    except Exception:
        logger.exception("Failed to build full crawl report for crawl_id=%s", crawl_id)
        return None


# ── Compliance: WCAG 2.1 AA conformance + audit trail ─────────────────────────

# All 50 WCAG 2.1 Level A + AA success criteria (what a VPAT / ACR reports on).
_WCAG21_AA = [
    ("1.1.1", "Non-text Content", "A"), ("1.2.1", "Audio-only and Video-only (Prerecorded)", "A"),
    ("1.2.2", "Captions (Prerecorded)", "A"), ("1.2.3", "Audio Description or Media Alternative (Prerecorded)", "A"),
    ("1.2.4", "Captions (Live)", "AA"), ("1.2.5", "Audio Description (Prerecorded)", "AA"),
    ("1.3.1", "Info and Relationships", "A"), ("1.3.2", "Meaningful Sequence", "A"),
    ("1.3.3", "Sensory Characteristics", "A"), ("1.3.4", "Orientation", "AA"),
    ("1.3.5", "Identify Input Purpose", "AA"), ("1.4.1", "Use of Color", "A"),
    ("1.4.2", "Audio Control", "A"), ("1.4.3", "Contrast (Minimum)", "AA"),
    ("1.4.4", "Resize Text", "AA"), ("1.4.5", "Images of Text", "AA"),
    ("1.4.10", "Reflow", "AA"), ("1.4.11", "Non-text Contrast", "AA"),
    ("1.4.12", "Text Spacing", "AA"), ("1.4.13", "Content on Hover or Focus", "AA"),
    ("2.1.1", "Keyboard", "A"), ("2.1.2", "No Keyboard Trap", "A"),
    ("2.1.4", "Character Key Shortcuts", "A"), ("2.2.1", "Timing Adjustable", "A"),
    ("2.2.2", "Pause, Stop, Hide", "A"), ("2.3.1", "Three Flashes or Below Threshold", "A"),
    ("2.4.1", "Bypass Blocks", "A"), ("2.4.2", "Page Titled", "A"),
    ("2.4.3", "Focus Order", "A"), ("2.4.4", "Link Purpose (In Context)", "A"),
    ("2.4.5", "Multiple Ways", "AA"), ("2.4.6", "Headings and Labels", "AA"),
    ("2.4.7", "Focus Visible", "AA"), ("2.5.1", "Pointer Gestures", "A"),
    ("2.5.2", "Pointer Cancellation", "A"), ("2.5.3", "Label in Name", "A"),
    ("2.5.4", "Motion Actuation", "A"), ("3.1.1", "Language of Page", "A"),
    ("3.1.2", "Language of Parts", "AA"), ("3.2.1", "On Focus", "A"),
    ("3.2.2", "On Input", "A"), ("3.2.3", "Consistent Navigation", "AA"),
    ("3.2.4", "Consistent Identification", "AA"), ("3.3.1", "Error Identification", "A"),
    ("3.3.2", "Labels or Instructions", "A"), ("3.3.3", "Error Suggestion", "AA"),
    ("3.3.4", "Error Prevention (Legal, Financial, Data)", "AA"), ("4.1.1", "Parsing", "A"),
    ("4.1.2", "Name, Role, Value", "A"), ("4.1.3", "Status Messages", "AA"),
]

_CONFORMANCE_STYLE = {
    "Does not support": "#e76f51", "Partially supports": "#f59e0b", "Fixed — PR open": "#1d4ed8",
    "Supports": "#059669", "Not tested": "#9ca3af",
}


def conformance_rows(violations: list[dict], passes: list[dict], open_issues: list[dict]) -> list[tuple]:
    """(criterion, name, level, result, note) for every WCAG 2.1 A/AA criterion.
    Only what axe can test automatically gets a verdict; the rest is
    "Not tested" — a VPAT needs a manual review for those."""
    def by_crit(rules):
        out = {}
        for r in rules:
            for c in wcag_criteria(r.get("tags")):
                out.setdefault(c, []).append(r)
        return out
    failing, found, passing = by_crit(open_issues), by_crit(violations), by_crit(passes)
    rows = []
    for cid, name, level in _WCAG21_AA:
        if cid in failing:
            n = sum(len(v.get("nodes") or []) for v in failing[cid])
            result = "Partially supports" if cid in passing else "Does not support"
            note = f"{n} element{'s' if n != 1 else ''} fail: " + ", ".join(sorted({v.get('id') for v in failing[cid]}))
        elif cid in found:
            result, note = "Fixed — PR open", "All failures fixed and verified by re-scan; live once the PR is merged"
        elif cid in passing:
            k = len(passing[cid])
            result, note = "Supports", f"{k} automated check{'s' if k != 1 else ''} passed"
        else:
            result, note = "Not tested", "Not testable automatically — needs a manual review"
        rows.append((cid, name, level, result, note))
    return rows


def _conformance_section(violations: list[dict], passes: list[dict], open_issues: list[dict],
                         title: str = "Conformance — WCAG 2.1 Level AA", page_url: str = "") -> str:
    rows = conformance_rows(violations, passes, open_issues)
    counts = {k: sum(1 for r in rows if r[3] == k) for k in _CONFORMANCE_STYLE}
    chips = " · ".join(f'<b style="color:{c};">{counts[k]}</b> {k.lower()}' for k, c in _CONFORMANCE_STYLE.items() if counts[k])
    body = "".join(
        f'<tr style="page-break-inside:avoid;"><td style="font-family:monospace;">{cid}</td><td>{_esc(name)}</td><td>{level}</td>'
        f'<td style="color:{_CONFORMANCE_STYLE[res]};font-weight:700;">{res}</td><td style="color:#6b7280;">{_esc(note)}</td></tr>'
        for cid, name, level, res, note in rows)
    return f"""
<div class="section" style="page-break-before:always;">
  <p class="section-title">{_esc(title)}{f' <span style="text-transform:none;">{_esc(page_url)}</span>' if page_url else ''}</p>
  <p style="margin:0 0 8px;font-size:10px;">{chips}</p>
  <table style="font-size:9px;">
    <thead><tr><th>Criterion</th><th>Name</th><th>Level</th><th>Result</th><th>Notes</th></tr></thead>
    <tbody>{body}</tbody>
  </table>
  <p style="margin:6px 0 0;font-size:9px;color:#9ca3af;">Results come from automated testing of this page. "Not tested" criteria
  need a manual review before claiming full conformance in a VPAT / Accessibility Conformance Report.</p>
</div>"""


def _parse_dt(value):
    """ISO string from the DB or a git provider ('...Z' / '+00:00' / naive UTC) -> aware datetime, or None."""
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _days(start, end) -> int | None:
    a, b = _parse_dt(start), _parse_dt(end)
    return max((b - a).days, 0) if a and b else None


def evidence_pack_data(fixes: list[dict], user_id: int, all_users: bool = False) -> dict:
    """Everything the pack needs beyond the fix rows: each page's latest scan
    (for conformance), stored proofs (screenshots), and per-fix timeline fields
    (when the issue was found, who fixed it, WCAG criteria for older fixes)."""
    user = db.get_user_by_id(user_id) or {}
    fixed_by = " ".join(x for x in (user.get("firstName"), user.get("lastName")) if x) or user.get("email") or ""
    scans = db.get_page_scans(f.get("page_url") for f in fixes)
    pack_ids = {f.get("id") for f in fixes}
    pages, proofs, rule_wcag, rule_info = [], [], {}, {}
    for url, info in scans.items():
        result = db.get_scan_result(info["latest_id"]) or {}
        axe = result.get("axeResult") or {}
        violations, passes = axe.get("violations") or [], axe.get("passes") or []
        page_proofs = db.get_fix_proofs(None if all_users else user_id, page_url=url)
        open_issues, _ = _split_fixed(violations, page_proofs)
        pages.append({"url": url, "scan_date": info["dates"][-1], "violations": violations,
                      "passes": passes, "open_issues": open_issues})
        proofs += [p for p in page_proofs if p.get("id") in pack_ids]
        for r in violations + passes:
            rule_wcag.setdefault(r.get("id"), wcag_criteria(r.get("tags")))
        for v in violations:
            rule_info.setdefault(v.get("id"), (v.get("help"), v.get("impact")))
    for f in fixes:
        dates = (scans.get(f.get("page_url")) or {}).get("dates") or []
        # The scan the fix was started from: the latest one at or before the fix.
        fixed_at = _parse_dt(f.get("created_at"))
        before = [d for d in dates if fixed_at and _parse_dt(d) and _parse_dt(d) <= fixed_at]
        f["found_at"] = (before or dates or [None])[-1]
        if not f["found_at"] and f.get("source_crawl_id"):
            f["found_at"] = (db.get_crawl_job(f["source_crawl_id"]) or {}).get("created_at")
        f["fixed_by"] = f.get("fixed_by") or fixed_by  # the developer who ran it
        f["wcag"] = f.get("wcag") or rule_wcag.get(f.get("rule_id")) or []
        help_, impact = rule_info.get(f.get("rule_id"), (None, None))  # older fixes stored neither
        f["help"], f["impact"] = f.get("help") or help_, f.get("impact") or impact
        f["days_to_merge"] = _days(f["found_at"] or f.get("created_at"), f.get("merged_at")) if f.get("merged_at") else None
    return {"pages": pages, "proofs": proofs}


_AUDIT_COLUMNS = ["Fix ID", "Page", "Issue", "Rule", "WCAG", "Severity", "Element", "Source file",
                  "Issue found", "Fixed by", "Fixed on", "Re-scan", "Pull request", "PR state",
                  "Approved by", "Approved on", "Merged by", "Merged on", "Days found to merged",
                  "Fixed at the source (pages)", "Review history"]


_REVIEW_LABELS = {"approved": "Approved", "rejected": "Rejected", "changes_requested": "Changes requested",
                  "resubmitted": "Resubmitted"}


def _review_text(r: dict) -> str:
    return (f"{(r.get('at') or '')[:10]} {_REVIEW_LABELS.get(r.get('kind'), r.get('kind'))} by {r.get('by') or '—'}"
            + (f": {r['comment']}" if r.get("comment") else ""))


def _audit_row(f: dict) -> list:
    return [f.get("id"), f.get("page_url"), f.get("help") or f.get("rule_id"), f.get("rule_id"),
            ", ".join(f.get("wcag") or []), f.get("impact") or "", f.get("selector") or "", f.get("file") or "",
            (f.get("found_at") or "")[:10], f.get("fixed_by") or "", (f.get("created_at") or "")[:10],
            f.get("status"), f.get("pr_url"), f.get("pr_state") or "unknown",
            ", ".join(f.get("approved_by") or []), (f.get("approved_at") or "")[:10],
            f.get("merged_by") or "", (f.get("merged_at") or "")[:10],
            "" if f.get("days_to_merge") is None else f["days_to_merge"],
            f.get("source_pages") or "", " | ".join(_review_text(r) for r in f.get("reviews") or [])]


def audit_trail_csv(fixes: list[dict]) -> str:
    """Issue -> fix -> approver -> date, one row per fix, for auditors' spreadsheets."""
    import csv
    import io
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(_AUDIT_COLUMNS)
    w.writerows(_audit_row(f) for f in fixes)
    return buf.getvalue()


def _timeline(f: dict) -> str:
    """Found -> fixed -> PR -> approved -> merged, one line per step; grey when not reached yet."""
    def step(done, label, detail=""):
        color = "#059669" if done else "#9ca3af"
        return (f'<div style="font-size:8.5px;color:{"#111827" if done else "#9ca3af"};">'
                f'<span style="color:{color};">{"●" if done else "○"}</span> <b>{label}</b>{(" " + detail) if detail else ""}</div>')
    d = lambda v: _esc((v or "")[:10])
    state = f.get("pr_state")
    approvers = ", ".join(f.get("approved_by") or [])
    out = step(bool(f.get("found_at")), "Found", d(f.get("found_at")) or "—")
    source = ""
    if f.get("source_pages"):
        checked = f.get("source_pages_checked")
        source = (f' · fixed at the source: one change for {f["source_pages"]} pages'
                  + (f' ({f.get("source_pages_clean") or 0} of {checked} re-checked pages clean)' if checked else ""))
    out += step(True, "Fixed", f'{d(f.get("created_at"))}{(" by " + _esc(f["fixed_by"])) if f.get("fixed_by") else ""}'
                               f'{" · re-scan verified" if f.get("status") == "verified" else ""}{_esc(source)}')
    pr_no = (f.get("pr_url") or "").rstrip("/").rsplit("/", 1)[-1]
    out += step(True, "PR opened", f'<a href="{_esc(f.get("pr_url"))}">#{_esc(pr_no)}</a>')
    for r in f.get("reviews") or []:  # every decision, in order — not just the last one
        if r.get("kind") == "approved":
            continue  # shown on the Approved step below
        label = _REVIEW_LABELS.get(r.get("kind"), r.get("kind"))
        detail = f"by {_esc(r.get('by') or '—')} on {d(r.get('at'))}" + (f" — “{_esc(r['comment'])}”" if r.get("comment") else "")
        out += step(True, label, detail)
    if f.get("approval_status") == "rejected":
        return out + step(True, "Closed without merging", "the fix was rejected")
    approved_note = next((r.get("comment") for r in reversed(f.get("reviews") or []) if r.get("kind") == "approved"), None)
    out += step(bool(approvers), "Approved", (f"by {_esc(approvers)}" + (f" on {d(f.get('approved_at'))}" if f.get("approved_at") else "")
                                              + (f" — “{_esc(approved_note)}”" if approved_note else "")) if approvers else
                ("none recorded — merged without a review approval" if state == "merged" else "awaiting review"))
    if state == "merged":
        days = f.get("days_to_merge")
        took = f" · {days} day{'s' if days != 1 else ''} found → merged" if days is not None else ""
        by = f" by {_esc(f['merged_by'])}" if f.get("merged_by") else ""
        out += step(True, "Merged", f"{d(f.get('merged_at'))}{by}{took}")
    else:
        out += step(False, "Merged", "not yet")
    return out


def _audit_html_row(f: dict) -> str:
    mono = "font-family:monospace;font-size:8px;"
    wcag = " · WCAG " + ", ".join(f["wcag"]) if f.get("wcag") else ""
    file_ = f'<br><span style="{mono}color:#1d4ed8;">{_esc(f["file"])}</span>' if f.get("file") else ""
    sev = (f.get("impact") or "").lower()
    sev_html = (f'<span style="font-weight:700;text-transform:uppercase;font-size:8px;color:{_SEVERITY_COLORS.get(sev, "#9ca3af")};">'
                f'{_esc(sev)}</span> ') if sev else ""
    return (
        f'<tr style="page-break-inside:avoid;">'
        f'<td>{sev_html}<b>{_esc(f.get("help") or f.get("rule_id"))}</b><br><span style="{mono}color:#6b7280;">{_esc(f.get("rule_id"))}{_esc(wcag)}</span>'
        f'<br><span style="color:#6b7280;font-size:8px;word-break:break-all;">{_esc(f.get("page_url"))}</span></td>'
        f'<td><span style="{mono}word-break:break-all;">{_esc(f.get("selector") or "—")}</span>{file_}</td>'
        f'<td>{_timeline(f)}</td></tr>')


def _wcag_summary_section(fixes: list[dict], pages: list[dict]) -> str:
    """Per WCAG criterion: still open (latest scans), fixed, approved, merged."""
    names = {cid: (name, level) for cid, name, level in _WCAG21_AA}
    counts = {}
    def bump(cid, key, n=1):
        counts.setdefault(cid, {"open": 0, "fixed": 0, "approved": 0, "merged": 0})[key] += n
    for p in pages:
        for v in p["open_issues"]:
            for cid in wcag_criteria(v.get("tags")):
                bump(cid, "open", len(v.get("nodes") or []))
    for f in fixes:
        if f.get("approval_status") == "rejected":
            continue  # rejected by the Approver: not a fix
        for cid in f.get("wcag") or []:
            bump(cid, "fixed")
            if f.get("approved_by"):
                bump(cid, "approved")
            if f.get("pr_state") == "merged":
                bump(cid, "merged")
    if not counts:
        return ""
    order = {cid: i for i, (cid, _, _) in enumerate(_WCAG21_AA)}
    def cell(n, color):
        return f'<td style="text-align:center;font-weight:700;color:{color if n else "#d1d5db"};">{n}</td>'
    rows = "".join(
        f'<tr><td style="font-family:monospace;">{cid}</td><td>{_esc(names.get(cid, ("", ""))[0])}</td><td>{names.get(cid, ("", "—"))[1]}</td>'
        f'{cell(c["open"], "#e76f51")}{cell(c["fixed"], "#1d4ed8")}{cell(c["approved"], "#7c3aed")}{cell(c["merged"], "#059669")}</tr>'
        for cid, c in sorted(counts.items(), key=lambda kv: order.get(kv[0], 99)))
    return f"""
<div class="section">
  <p class="section-title">Summary by WCAG criterion</p>
  <table style="font-size:9.5px;">
    <thead><tr><th>Criterion</th><th>Name</th><th>Level</th><th style="text-align:center;">Still open</th>
      <th style="text-align:center;">Fixed (PR)</th><th style="text-align:center;">Approved</th><th style="text-align:center;">Merged</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
  <p style="margin:6px 0 0;font-size:9px;color:#9ca3af;">Still open = elements failing in each page's latest scan. Fixed / Approved / Merged count fixes in this pack.</p>
</div>"""


def _build_evidence_pack_html(fixes: list[dict], pages: list[dict] | None = None, proofs: list[dict] | None = None) -> str:
    pages, proofs = pages or [], proofs or []
    generated_at = datetime.now(timezone.utc).strftime("%B %d, %Y")
    merged = [f for f in fixes if f.get("pr_state") == "merged"]
    approved = sum(1 for f in fixes if f.get("approved_by"))
    waiting = sum(1 for f in fixes if f.get("pr_state") not in ("merged", "closed"))
    rejected = sum(1 for f in fixes if f.get("approval_status") == "rejected")
    days = [f["days_to_merge"] for f in merged if f.get("days_to_merge") is not None]
    avg = f"{sum(days) / len(days):.1f}" if days else "—"
    def kpi(label, value, color="#111827"):
        return f'<div class="kpi"><div class="kpi-label">{label}</div><div class="kpi-value" style="color:{color};">{value}</div></div>'
    rows = "".join(_audit_html_row(f) for f in fixes) or '<tr><td colspan="3">No fixes with a pull request yet.</td></tr>'
    page_list = "".join(f"<li>{_esc(p['url'])} — latest scan {_esc((p['scan_date'] or '')[:10])}</li>" for p in pages)
    body = f"""
<div style="border-bottom:2px solid #e5e7eb;padding-bottom:16px;margin-bottom:20px;">
  <span style="font-weight:700;font-size:15px;">ADA Accessibility Monitor</span>
  <h1 style="font-size:22px;margin:8px 0 4px;">Compliance Evidence Pack</h1>
  <p style="margin:0;font-size:11px;color:#9ca3af;">Generated: {generated_at} · Standard: WCAG 2.1 Level AA</p>
  {f'<ul style="margin:8px 0 0;padding-left:18px;font-size:10px;color:#6b7280;">{page_list}</ul>' if page_list else ''}
</div>
<div class="section">
  <div class="kpi-grid">{kpi("Fixes with a PR", len(fixes))}{kpi("Approved", approved, "#7c3aed")}{kpi("Merged", len(merged), "#059669")}{kpi("Awaiting review", waiting, "#f59e0b" if waiting else "#059669")}{kpi("Avg days to merge", avg)}{kpi("Rejected", rejected, "#dc2626") if rejected else ""}</div>
  <p style="margin:8px 0 0;font-size:10px;color:#6b7280;">Contents: 1. Summary by WCAG criterion · 2. Audit trail (issue → fix → approver → date) ·
  3. Conformance per page · 4. Before / after proof for each fix</p>
</div>
{_wcag_summary_section(fixes, pages)}
<div class="section">
  <p class="section-title">Audit trail — issue → fix → approver → date</p>
  <table style="font-size:9px;table-layout:fixed;">
    <colgroup><col style="width:38%"><col style="width:24%"><col style="width:38%"></colgroup>
    <thead><tr><th>Issue</th><th>Where (element, source file)</th><th>Timeline</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</div>
{"".join(_conformance_section(p["violations"], p["passes"], p["open_issues"],
                              title=f"Conformance (scan {(p['scan_date'] or '')[:10]}) —", page_url=p["url"]) for p in pages)}
{('<div style="page-break-before:always;"></div>' + _fix_proof_section(proofs)) if proofs else ''}
<div style="border-top:1px solid #e5e7eb;padding-top:12px;font-size:9px;color:#9ca3af;">
  Each fix was generated by ADA Auto-Fix, re-scanned on a patched build to confirm the issue is gone, and opened as a pull request.
  "Found" is the scan the fix was started from. Approver, merger and dates are read from the git provider when this pack is generated
  (GitLab and Azure DevOps don't publish approval times). Pull requests closed without merging are left out. Automated testing does not
  cover every WCAG criterion — "Not tested" criteria need a manual review.
</div>"""
    return _html_shell("Compliance Evidence Pack", body)


def render_evidence_pack(fixes: list[dict], data: dict) -> bytes | None:
    """data = evidence_pack_data(fixes, user_id), already applied to fixes."""
    return _html_to_pdf(_build_evidence_pack_html(fixes, data["pages"], data["proofs"]))


# ── Activity History export ────────────────────────────────────────────────────

ACTIVITY_KINDS = {"scan": "Page scans", "crawl": "Site crawls", "assistive": "Assistive tests", "fix": "Auto-Fixes",
                  "review": "PR approvals / merges", "alert": "Alerts", "report": "Reports sent", "setup": "Setup changes"}
_ACTIVITY_COLUMNS = ["Date (UTC)", "Time (UTC)", "Type", "What", "Target", "Result", "Status", "By", "Reference", "Link"]


def activity_csv(events: list[dict]) -> str:
    import csv
    import io
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(_ACTIVITY_COLUMNS)
    w.writerows([e["at"][:10], e["at"][11:16], ACTIVITY_KINDS.get(e["kind"], e["kind"]), e["action"], e["target"],
                 e["result"], e["status"], e["by"], e.get("ref") or "", e.get("link") or ""] for e in events)
    return buf.getvalue()


def _build_activity_html(events: list[dict], filters: dict | None = None) -> str:
    filters = filters or {}
    generated_at = datetime.now(timezone.utc).strftime("%B %d, %Y %H:%M UTC")
    counts = {k: sum(1 for e in events if e["kind"] == k) for k in ACTIVITY_KINDS}
    fails = sum(1 for e in events if e["status"] == "fail")
    span = f"{events[-1]['at'][:10]} to {events[0]['at'][:10]}" if events else "—"
    applied = [f"type: {', '.join(ACTIVITY_KINDS.get(k, k) for k in filters['kind'])}" if filters.get("kind") else "",
               f"search: “{filters['q']}”" if filters.get("q") else "",
               f"from {filters['from']}" if filters.get("from") else "", f"to {filters['to']}" if filters.get("to") else ""]
    applied = " · ".join(x for x in applied if x) or "none (everything)"
    kpis = "".join(f'<div class="kpi"><div class="kpi-label">{label}</div><div class="kpi-value" style="font-size:18px;">{counts[k]}</div></div>'
                   for k, label in ACTIVITY_KINDS.items() if counts[k])
    dot = {"ok": "#059669", "fail": "#e76f51", "info": "#9ca3af"}
    rows, day = [], None
    for e in events:
        if e["at"][:10] != day:
            day = e["at"][:10]
            n = sum(1 for x in events if x["at"][:10] == day)
            rows.append(f'<tr><td colspan="5" style="background:#f3f4f6;font-weight:700;font-size:10px;">'
                        f'{_esc(day)} <span style="font-weight:400;color:#6b7280;">· {n} event{"s" if n != 1 else ""}</span></td></tr>')
        ref = f' <span style="color:#9ca3af;">{_esc(e.get("ref"))}</span>' if e.get("ref") else ""
        link = f' · <a href="{_esc(e["link"])}">link</a>' if e.get("link") else ""
        rows.append(
            f'<tr style="page-break-inside:avoid;"><td style="white-space:nowrap;color:#6b7280;">{_esc(e["at"][11:16])}</td>'
            f'<td><span style="color:{dot.get(e["status"], "#9ca3af")};">●</span> <b>{_esc(e["action"])}</b>{ref}</td>'
            f'<td style="word-break:break-all;color:#374151;">{_esc(e["target"])}</td>'
            f'<td>{_esc(e["result"])}{link}</td><td>{_esc(e["by"]) or "—"}</td></tr>')
    body = f"""
<div style="border-bottom:2px solid #e5e7eb;padding-bottom:16px;margin-bottom:20px;">
  <span style="font-weight:700;font-size:15px;">ADA Accessibility Monitor</span>
  <h1 style="font-size:22px;margin:8px 0 4px;">Activity History</h1>
  <p style="margin:0;font-size:11px;color:#9ca3af;">Generated: {generated_at} · Period: {_esc(span)} · Filters: {_esc(applied)}</p>
</div>
<div class="section">
  <div class="kpi-grid" style="flex-wrap:wrap;">{kpis or '<p style="font-size:11px;">No activity.</p>'}</div>
  <p style="margin:8px 0 0;font-size:11px;"><b>{len(events)}</b> events · <b style="color:#e76f51;">{fails}</b> failed or need attention</p>
</div>
<div class="section">
  <p class="section-title">Timeline (newest first, times in UTC)</p>
  <table style="font-size:9px;table-layout:fixed;">
    <colgroup><col style="width:7%"><col style="width:27%"><col style="width:26%"><col style="width:28%"><col style="width:12%"></colgroup>
    <thead><tr><th>Time</th><th>What</th><th>Target</th><th>Result</th><th>By</th></tr></thead>
    <tbody>{"".join(rows) or '<tr><td colspan="5">No activity for these filters.</td></tr>'}</tbody>
  </table>
</div>
<div style="border-top:1px solid #e5e7eb;padding-top:12px;font-size:9px;color:#9ca3af;">
  ● green = succeeded, ● red = failed or needs attention, ● grey = information. Scans, crawls, assistive tests, alerts and schedules
  are workspace-wide; Auto-Fixes, repos and sent reports are yours. PR approvals and merges are read from the git provider
  (refresh Fix History to update them).
</div>"""
    return _html_shell("Activity History", body)


def render_activity_report(events: list[dict], filters: dict | None = None) -> bytes | None:
    return _html_to_pdf(_build_activity_html(events, filters))
