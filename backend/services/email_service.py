"""
Email service: sends HTML crawl completion reports via SMTP.
Uses stdlib smtplib only — no third-party email packages.
"""
import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from config import Config
from services import db

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def send_verification_email(user: dict, token: str, expiry_hours: int = 24) -> bool:
    """
    Send an email-verification link to *user['email']*.

    Returns True on success, False on any failure (never raises).
    """
    try:
        if not Config.SMTP_ENABLED:
            logger.debug("send_verification_email: SMTP disabled — skipping.")
            return False
        if not Config.SMTP_HOST:
            logger.warning("send_verification_email: SMTP_HOST not configured — skipping.")
            return False

        verify_url = f"{Config.APP_BASE_URL}/verify-email?token={token}"
        first_name = user.get("firstName", "there")
        subject    = "Verify your ADA account email"
        html_body  = _build_verification_html(first_name, verify_url, expiry_hours)

        return _send_email(
            to=user["email"],
            subject=subject,
            html_body=html_body,
        )
    except Exception:
        logger.exception("send_verification_email: unexpected error for user_id=%s", user.get("id"))
        return False


def send_password_reset_email(user: dict, token: str, expiry_hours: int = 1) -> bool:
    """
    Send a password-reset link to *user['email']*.

    Returns True on success, False on any failure (never raises).
    """
    try:
        if not Config.SMTP_ENABLED:
            logger.debug("send_password_reset_email: SMTP disabled — skipping.")
            return False
        if not Config.SMTP_HOST:
            logger.warning("send_password_reset_email: SMTP_HOST not configured — skipping.")
            return False

        reset_url  = f"{Config.APP_BASE_URL}/reset-password?token={token}"
        first_name = user.get("firstName", "there")
        subject    = "Reset your ADA account password"
        html_body  = _build_reset_password_html(first_name, reset_url, expiry_hours)

        return _send_email(
            to=user["email"],
            subject=subject,
            html_body=html_body,
        )
    except Exception:
        logger.exception("send_password_reset_email: unexpected error for user_id=%s", user.get("id"))
        return False


def _build_reset_password_html(first_name: str, reset_url: str, expiry_hours: int) -> str:
    s_body   = "margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;"
    s_wrap   = "max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);"
    s_header = "background:linear-gradient(135deg,#0d9488 0%,#0f766e 100%);padding:32px 40px;text-align:center;"
    s_title  = "margin:0;font-size:24px;font-weight:700;color:#ffffff;"
    s_body_p = "padding:32px 40px;"
    s_p      = "font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;"
    s_btn    = ("display:inline-block;background:#0d9488;color:#ffffff;text-decoration:none;"
                "padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:0.3px;")
    s_note   = "font-size:12px;color:#9ca3af;margin:24px 0 0;"
    s_footer = "background:#f8f9fa;border-top:1px solid #e5e7eb;padding:16px 40px;text-align:center;"
    s_ft_p   = "margin:4px 0;font-size:11px;color:#aaaaaa;"

    expiry_label = f"{expiry_hours} hour{'s' if expiry_hours != 1 else ''}"

    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Reset your password</title></head>
<body style="{s_body}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;">
  <tr><td align="center" style="padding:32px 16px;">
    <table cellpadding="0" cellspacing="0" style="{s_wrap}">
      <tr><td style="{s_header}">
        <h1 style="{s_title}">ADA Accessibility Tool</h1>
      </td></tr>
      <tr><td style="{s_body_p}">
        <p style="{s_p}">Hi {first_name},</p>
        <p style="{s_p}">We received a request to reset your password. Click the button below to choose a new one.</p>
        <p style="text-align:center;margin:28px 0;">
          <a href="{reset_url}" style="{s_btn}">Reset Password</a>
        </p>
        <p style="{s_p}">If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="font-size:12px;color:#6b7280;word-break:break-all;margin:0 0 16px;">{reset_url}</p>
        <p style="{s_note}">This link expires in {expiry_label}. If you didn't request a password reset, you can safely ignore this email.</p>
      </td></tr>
      <tr><td style="{s_footer}">
        <p style="{s_ft_p}">ADA Accessibility Tool &mdash; automated message</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>"""


def _build_verification_html(first_name: str, verify_url: str, expiry_hours: int) -> str:
    s_body   = "margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;"
    s_wrap   = "max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);"
    s_header = "background:linear-gradient(135deg,#0d9488 0%,#0f766e 100%);padding:32px 40px;text-align:center;"
    s_title  = "margin:0;font-size:24px;font-weight:700;color:#ffffff;"
    s_body_p = "padding:32px 40px;"
    s_p      = "font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;"
    s_btn    = ("display:inline-block;background:#0d9488;color:#ffffff;text-decoration:none;"
                "padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:0.3px;")
    s_note   = "font-size:12px;color:#9ca3af;margin:24px 0 0;"
    s_footer = "background:#f8f9fa;border-top:1px solid #e5e7eb;padding:16px 40px;text-align:center;"
    s_ft_p   = "margin:4px 0;font-size:11px;color:#aaaaaa;"

    expiry_label = f"{expiry_hours} hour{'s' if expiry_hours != 1 else ''}"

    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Verify your email</title></head>
<body style="{s_body}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;">
  <tr><td align="center" style="padding:32px 16px;">
    <table cellpadding="0" cellspacing="0" style="{s_wrap}">
      <tr><td style="{s_header}">
        <h1 style="{s_title}">ADA Accessibility Tool</h1>
      </td></tr>
      <tr><td style="{s_body_p}">
        <p style="{s_p}">Hi {first_name},</p>
        <p style="{s_p}">Thanks for creating an account. Please verify your email address by clicking the button below.</p>
        <p style="text-align:center;margin:28px 0;">
          <a href="{verify_url}" style="{s_btn}">Verify Email Address</a>
        </p>
        <p style="{s_p}">If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="font-size:12px;color:#6b7280;word-break:break-all;margin:0 0 16px;">{verify_url}</p>
        <p style="{s_note}">This link expires in {expiry_label}. If you didn't create an account, you can safely ignore this email.</p>
      </td></tr>
      <tr><td style="{s_footer}">
        <p style="{s_ft_p}">ADA Accessibility Tool &mdash; automated message</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>"""


def send_crawl_report(crawl_id: str, recipient_email: str) -> bool:
    """
    Send an HTML crawl completion report to *recipient_email*.

    Returns True on success, False on any failure (never raises).
    """
    try:
        # Guards
        if not Config.SMTP_ENABLED:
            logger.debug("send_crawl_report: SMTP disabled — skipping.")
            return False
        if not recipient_email or not recipient_email.strip():
            logger.debug("send_crawl_report: blank recipient — skipping.")
            return False
        if not Config.SMTP_HOST:
            logger.warning("send_crawl_report: SMTP_HOST not configured — skipping.")
            return False

        # Fetch data
        job = db.get_crawl_job(crawl_id)
        if not job:
            logger.warning("send_crawl_report: crawl_id=%s not found in DB.", crawl_id)
            return False

        pages = db.get_crawl_pages(crawl_id)

        subject = f"ADA Crawl Report — {job['root_url']}"
        html_body = _build_report_html(job, pages)

        return _send_email(
            to=recipient_email.strip(),
            subject=subject,
            html_body=html_body,
        )

    except Exception:
        logger.exception("send_crawl_report: unexpected error for crawl_id=%s", crawl_id)
        return False


# ---------------------------------------------------------------------------
# HTML builder
# ---------------------------------------------------------------------------

def _build_report_html(job: dict, pages: list) -> str:
    """Build a Gmail-safe, inline-CSS HTML email for the crawl completion report."""

    # ---- helper colour functions ----------------------------------------
    def _viol_color(n):
        if n is None or n == 0:
            return "#27ae60"
        return "#e74c3c"

    def _rate_color(rate):
        if rate is None:
            return "#888888"
        if rate >= 80:
            return "#27ae60"
        if rate >= 50:
            return "#e67e22"
        return "#e74c3c"

    def _fail_color(n):
        if n is None or n == 0:
            return "#27ae60"
        return "#e74c3c"

    # ---- computed values -----------------------------------------------
    root_url      = job.get("root_url", "")
    status        = (job.get("status") or "").upper()
    total_disc    = job.get("total_discovered") or 0
    total_scanned = job.get("total_scanned") or 0
    total_failed  = job.get("total_failed") or 0
    duration_sec  = job.get("duration_seconds")
    ended_at      = job.get("ended_at") or job.get("started_at") or ""

    # duration formatting
    if duration_sec is not None:
        mins, secs = divmod(int(duration_sec), 60)
        duration_str = f"{mins}m {secs}s" if mins else f"{secs}s"
    else:
        duration_str = "—"

    # violations and avg pass rate from pages
    completed_pages = [p for p in pages if (p.get("status") or "") == "scanned"]
    total_violations = sum((p.get("violations") or 0) for p in completed_pages)
    if completed_pages:
        rates = [(p.get("pass_rate") or 0) for p in completed_pages]
        avg_pass_rate = sum(rates) / len(rates)
        avg_pass_rate_str = f"{avg_pass_rate:.1f}%"
    else:
        avg_pass_rate = None
        avg_pass_rate_str = "—"

    # top 10 by violations desc
    top_pages = sorted(
        completed_pages,
        key=lambda p: (p.get("violations") or 0),
        reverse=True,
    )[:10]

    # ---- base styles (inline variables) --------------------------------
    s_body     = "margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;"
    s_wrap     = "max-width:680px;margin:0 auto;background:#ffffff;"
    s_header   = ("background:linear-gradient(135deg,#1a237e 0%,#283593 100%);"
                  "padding:32px 40px;text-align:center;")
    s_title    = "margin:0;font-size:26px;font-weight:700;color:#ffffff;letter-spacing:0.5px;"
    s_subtitle = "margin:8px 0 0;font-size:14px;color:#c5cae9;"
    s_bar      = "background:#f8f9fa;border-bottom:1px solid #e0e0e0;padding:16px 40px;"
    s_bar_tbl  = "width:100%;border-collapse:collapse;"
    s_bar_td   = "font-size:12px;color:#555555;padding:4px 0;width:25%;"
    s_bar_lbl  = "display:block;font-weight:700;color:#1a237e;font-size:11px;text-transform:uppercase;margin-bottom:2px;"
    s_content  = "padding:32px 40px;"
    s_cards    = "width:100%;border-collapse:collapse;margin-bottom:28px;"
    s_card_td  = ("background:#f8f9fa;border:1px solid #e8e8e8;border-radius:6px;"
                  "padding:16px;text-align:center;width:20%;")
    s_card_num = "font-size:28px;font-weight:700;margin:0 0 4px;"
    s_card_lbl = "font-size:11px;color:#777777;text-transform:uppercase;letter-spacing:0.5px;margin:0;"
    s_sect_hd  = ("font-size:16px;font-weight:700;color:#1a237e;"
                  "margin:0 0 12px;padding-bottom:8px;border-bottom:2px solid #e3f2fd;")
    s_tbl      = "width:100%;border-collapse:collapse;font-size:13px;"
    s_th       = ("background:#1a237e;color:#ffffff;padding:10px 12px;"
                  "text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;")
    s_td_e     = "padding:10px 12px;border-bottom:1px solid #f0f0f0;background:#ffffff;"
    s_td_o     = "padding:10px 12px;border-bottom:1px solid #f0f0f0;background:#fafafa;"
    s_cta_wrap = "text-align:center;margin:28px 0;"
    s_cta_btn  = ("display:inline-block;background:#1a237e;color:#ffffff;text-decoration:none;"
                  "padding:14px 32px;border-radius:6px;font-size:15px;font-weight:700;"
                  "letter-spacing:0.3px;")
    s_footer   = ("background:#f8f9fa;border-top:1px solid #e0e0e0;"
                  "padding:20px 40px;text-align:center;")
    s_footer_p = "margin:4px 0;font-size:11px;color:#aaaaaa;"

    # ---- status badge colour -------------------------------------------
    status_color = "#27ae60" if status == "COMPLETED" else "#e67e22"

    # ---- summary card rows ---------------------------------------------
    def _card(num_str, label, color="#1a237e"):
        return (
            f'<td style="{s_card_td}">'
            f'<p style="{s_card_num}color:{color};">{num_str}</p>'
            f'<p style="{s_card_lbl}">{label}</p>'
            f'</td>'
        )

    cards_row = (
        _card(str(total_disc), "Pages Found")
        + _card(str(total_scanned), "Pages Scanned")
        + _card(str(total_failed), "Scan Failures", _fail_color(total_failed))
        + _card(str(total_violations), "Total Violations", _viol_color(total_violations))
        + _card(avg_pass_rate_str, "Avg Pass Rate", _rate_color(avg_pass_rate))
    )

    # ---- top pages table rows ------------------------------------------
    def _page_rows():
        if not top_pages:
            return (
                f'<tr><td colspan="5" style="{s_td_e}text-align:center;color:#999;">'
                f'No completed pages recorded.</td></tr>'
            )
        rows = []
        for i, p in enumerate(top_pages):
            s_td = s_td_o if i % 2 else s_td_e
            url   = p.get("url") or ""
            depth = p.get("depth") if p.get("depth") is not None else "—"
            viols = p.get("violations") or 0
            passes = p.get("passes") or 0
            rate  = p.get("pass_rate")
            rate_str = f"{rate:.1f}%" if rate is not None else "—"
            url_display = url if len(url) <= 70 else url[:67] + "..."
            viol_c = _viol_color(viols)
            rate_c = _rate_color(rate)
            rows.append(
                f'<tr>'
                f'<td style="{s_td}">{depth}</td>'
                f'<td style="{s_td}"><a href="{url}" style="color:#1a237e;text-decoration:none;">{url_display}</a></td>'
                f'<td style="{s_td}font-weight:700;color:{viol_c};">{viols}</td>'
                f'<td style="{s_td}">{passes}</td>'
                f'<td style="{s_td}font-weight:700;color:{rate_c};">{rate_str}</td>'
                f'</tr>'
            )
        return "".join(rows)

    app_url = getattr(Config, "APP_BASE_URL", "#") or "#"

    # ---- assemble HTML -------------------------------------------------
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ADA Crawl Report</title>
</head>
<body style="{s_body}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;">
  <tr>
    <td align="center" style="padding:24px 16px;">

      <!-- wrapper -->
      <table cellpadding="0" cellspacing="0" style="{s_wrap}border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

        <!-- HEADER -->
        <tr>
          <td style="{s_header}">
            <h1 style="{s_title}">ADA Accessibility Tool</h1>
            <p style="{s_subtitle}">Site Crawl Completion Report</p>
          </td>
        </tr>

        <!-- STATUS BAR -->
        <tr>
          <td style="{s_bar}">
            <table style="{s_bar_tbl}">
              <tr>
                <td style="{s_bar_td}">
                  <span style="{s_bar_lbl}">Site URL</span>
                  <a href="{root_url}" style="color:#1a237e;font-size:13px;text-decoration:none;">{root_url}</a>
                </td>
                <td style="{s_bar_td}">
                  <span style="{s_bar_lbl}">Status</span>
                  <span style="color:{status_color};font-weight:700;font-size:13px;">{status}</span>
                </td>
                <td style="{s_bar_td}">
                  <span style="{s_bar_lbl}">Completed</span>
                  <span style="font-size:13px;">{ended_at}</span>
                </td>
                <td style="{s_bar_td}">
                  <span style="{s_bar_lbl}">Duration</span>
                  <span style="font-size:13px;">{duration_str}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CONTENT -->
        <tr>
          <td style="{s_content}">

            <!-- SUMMARY CARDS -->
            <table style="{s_cards}">
              <tr style="border-collapse:separate;border-spacing:8px;">
                {cards_row}
              </tr>
            </table>

            <!-- TOP PAGES TABLE -->
            <h2 style="{s_sect_hd}">Top Pages by Violations</h2>
            <table style="{s_tbl}">
              <thead>
                <tr>
                  <th style="{s_th}width:50px;">Depth</th>
                  <th style="{s_th}">URL</th>
                  <th style="{s_th}width:90px;">Violations</th>
                  <th style="{s_th}width:70px;">Passes</th>
                  <th style="{s_th}width:90px;">Pass Rate</th>
                </tr>
              </thead>
              <tbody>
                {_page_rows()}
              </tbody>
            </table>

            <!-- CTA BUTTON -->
            <div style="{s_cta_wrap}">
              <a href="{app_url}" style="{s_cta_btn}">View Full Report</a>
            </div>

          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="{s_footer}">
            <p style="{s_footer_p}">Crawl ID: {job.get('crawl_id', '')}</p>
            <p style="{s_footer_p}">ADA Accessibility Tool &mdash; automated report</p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>"""

    return html


# ---------------------------------------------------------------------------
# SMTP sender
# ---------------------------------------------------------------------------

def _send_email(to: str, subject: str, html_body: str) -> bool:
    """
    Send *html_body* to *to* via SMTP.

    Returns True on success, False on any error (never raises).
    """
    try:
        msg = MIMEMultipart("alternative")
        msg["From"]    = Config.SMTP_FROM or Config.SMTP_USER
        msg["To"]      = to
        msg["Subject"] = subject
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        host = Config.SMTP_HOST
        port = int(Config.SMTP_PORT or 587)
        user = Config.SMTP_USER or ""
        password = Config.SMTP_PASS or ""

        if port == 465:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=context) as server:
                if user and password:
                    server.login(user, password)
                server.sendmail(msg["From"], [to], msg.as_string())
        else:
            with smtplib.SMTP(host, port) as server:
                server.ehlo()
                if port == 587:
                    server.starttls(context=ssl.create_default_context())
                    server.ehlo()
                if user and password:
                    server.login(user, password)
                server.sendmail(msg["From"], [to], msg.as_string())

        logger.info("Crawl report sent | to=%s subject=%s", to, subject)
        return True

    except Exception:
        logger.exception("_send_email: failed to send to=%s subject=%s", to, subject)
        return False
