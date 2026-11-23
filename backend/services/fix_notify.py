"""Approval-workflow notifications: email + the person's own Slack/Teams channels.

- a developer opens a fix PR      -> every Approver (except the person who fixed it)
- an Approver decides             -> the developer who made the fix
- a developer resubmits           -> every Approver
- daily: fixes waiting too long   -> every Approver (digest)

Best effort and off the request thread: a broken SMTP server or Slack token
must never fail the fix or the review it reports on.
"""
import html
import logging
import tempfile
import threading
from datetime import date, datetime, timezone
from pathlib import Path

from config import Config
from services import db

logger = logging.getLogger(__name__)

REMINDER_DAYS = 3        # a pending fix older than this is "waiting too long"
DIGEST_HOUR = 9          # local hour after which the daily digest goes out
# Day the digest last went out, kept in a file so a backend restart doesn't resend it.
_DIGEST_STAMP = Path(tempfile.gettempdir()) / "ada_fix_digest_sent_on"


def _digest_sent_on():
    try:
        return date.fromisoformat(_DIGEST_STAMP.read_text().strip())
    except (OSError, ValueError):
        return None


def _mark_digest_sent(day):
    try:
        _DIGEST_STAMP.write_text(day.isoformat())
    except OSError:
        logger.warning("fix_notify: could not record the digest date")

_DECISION = {
    "approved": ("approved and merged", "#1e8e5a"),
    "rejected": ("rejected — the pull request was closed", "#c0392b"),
    "changes_requested": ("sent back — changes requested", "#b7791f"),
}


def _bg(fn, *args):
    threading.Thread(target=_safe, args=(fn, *args), daemon=True).start()


def _safe(fn, *args):
    try:
        fn(*args)
    except Exception:
        logger.exception("fix_notify: %s failed", fn.__name__)


def _name(user: dict | None) -> str:
    if not user:
        return "Someone"
    return " ".join(x for x in (user.get("firstName"), user.get("lastName")) if x) or user.get("name") or user.get("email") or "Someone"


def _page(url: str) -> str:
    return (url or "").split("://", 1)[-1].rstrip("/")


def _email_html(title: str, color: str, lines: list[str], button: str | None = None) -> str:
    body = "".join(f'<p style="margin:0 0 10px;font-size:14px;color:#333">{ln}</p>' for ln in lines)
    btn = (f'<p style="margin:18px 0 0"><a href="{html.escape(Config.APP_BASE_URL)}" style="background:#0f766e;color:#fff;'
           f'padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">{button}</a></p>') if button else ""
    return (f'<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">'
            f'<div style="background:{color};color:#fff;padding:14px 20px;font-size:16px;font-weight:700">{title}</div>'
            f'<div style="padding:18px 20px">{body}{btn}</div>'
            f'<div style="padding:10px 20px;background:#f9fafb;font-size:11px;color:#888">ADA Tool · Fix approvals</div></div>')


def _send(user: dict, subject: str, title: str, color: str, lines: list[str], text: str, button: str = "Open Fix History"):
    """One notification to one person: email (if SMTP is on) + their general Slack/Teams channels."""
    if Config.SMTP_ENABLED and Config.SMTP_HOST and user.get("email"):
        from backend.services.email_service import _send_email
        _send_email(user["email"], subject, _email_html(title, color, lines, button))
    try:
        from app import _slack_api, _teams_webhook_send
        for row in db.get_integrations(user["id"]):
            integ = db.get_integration(row["id"], user["id"])
            if not integ:
                continue
            for ch in db.get_integration_channels(integ["id"]):
                if (ch.get("purpose") or "general") != "general":
                    continue
                if integ["platform"] == "slack":
                    _slack_api(integ["access_token"], "chat.postMessage", {"channel": ch["channel_id"], "text": text})
                else:
                    _teams_webhook_send(ch["webhook_url"], {"text": text})
    except Exception:
        logger.exception("fix_notify: chat delivery failed for user %s", user.get("id"))


# ── events ───────────────────────────────────────────────────────────────

def new_fix(fixer_id: int, page_url: str, rule_id: str, count: int, pr_url: str | None):
    _bg(_new_fix, fixer_id, page_url, rule_id, count, pr_url)


def _new_fix(fixer_id, page_url, rule_id, count, pr_url):
    who = _name(db.get_user_by_id(fixer_id))
    what = f"{count} fixes" if count > 1 else "a fix"
    for a in db.get_approvers():
        if a["id"] == fixer_id:
            continue
        _send(a, f"Fix waiting for your approval: {rule_id}", "A fix is waiting for your approval", "#0f766e",
              [f"<b>{html.escape(who)}</b> opened {what} for <b>{html.escape(rule_id)}</b>.",
               f"Page: {html.escape(_page(page_url))}",
               f'Pull request: <a href="{html.escape(pr_url or "")}">{html.escape(pr_url or "—")}</a>'],
              f"🔔 {who} opened {what} for {rule_id} on {_page(page_url)} — waiting for your approval. {pr_url or ''}",
              "Review in Fix History")


def decision(fix: dict, status: str, reviewer_id: int, comment: str):
    _bg(_decision, fix, status, reviewer_id, comment)


def _decision(fix, status, reviewer_id, comment):
    if fix["user_id"] == reviewer_id:
        return
    dev = db.get_user_by_id(fix["user_id"])
    if not dev:
        return
    reviewer = _name(db.get_user_by_id(reviewer_id))
    verb, color = _DECISION[status]
    lines = [f"Your fix for <b>{html.escape(fix['rule_id'])}</b> was {verb} by <b>{html.escape(reviewer)}</b>.",
             f"Page: {html.escape(_page(fix['page_url']))}"]
    if comment:
        lines.append(f"Comment: “{html.escape(comment)}”")
    if status == "changes_requested":
        lines.append("Update the pull request, then click <b>Resubmit for approval</b> on the fix in Fix History.")
    _send(dev, f"Your fix was {verb.split(' —')[0]}: {fix['rule_id']}", f"Fix {verb.split(' —')[0]}", color, lines,
          f"Your fix for {fix['rule_id']} on {_page(fix['page_url'])} was {verb} by {reviewer}"
          + (f": “{comment}”" if comment else "") + f" {fix.get('pr_url') or ''}")


def resubmitted(fix: dict, by_id: int):
    _bg(_resubmitted, fix, by_id)


def _resubmitted(fix, by_id):
    who = _name(db.get_user_by_id(by_id))
    for a in db.get_approvers():
        if a["id"] == by_id:
            continue
        _send(a, f"Fix resubmitted: {fix['rule_id']}", "A fix was resubmitted", "#0f766e",
              [f"<b>{html.escape(who)}</b> updated the fix for <b>{html.escape(fix['rule_id'])}</b> after your change request.",
               f"Page: {html.escape(_page(fix['page_url']))}"],
              f"🔁 {who} resubmitted the fix for {fix['rule_id']} on {_page(fix['page_url'])} — ready for review again.",
              "Review in Fix History")


# ── daily digest (called from the scheduler loop) ───────────────────────

def waiting_days(fix: dict, now: datetime | None = None) -> int | None:
    try:
        created = datetime.fromisoformat(str(fix["created_at"]).replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        return None
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return ((now or datetime.now(timezone.utc)) - created).days


def stale_fixes(fixes: list[dict], now: datetime | None = None) -> list[dict]:
    """Open PRs still waiting for a decision for REMINDER_DAYS or more, oldest first."""
    out = []
    for f in fixes:
        if f.get("pr_url") and f.get("pr_state") in (None, "", "open") and (f.get("approval_status") or "pending") == "pending":
            d = waiting_days(f, now)
            if d is not None and d >= REMINDER_DAYS:
                out.append({**f, "waiting_days": d})
    # a batch PR has one row per element — remind once per PR
    seen, unique = set(), []
    for f in sorted(out, key=lambda x: -x["waiting_days"]):
        if f["pr_url"] not in seen:
            seen.add(f["pr_url"])
            unique.append(f)
    return unique


def maybe_send_digest(now: datetime | None = None) -> bool:
    local = (now or datetime.now()).astimezone()
    if local.hour < DIGEST_HOUR or _digest_sent_on() == local.date() or not db.is_ready():
        return False
    _mark_digest_sent(local.date())
    stale = stale_fixes(db.get_fixes(None, limit=2000))
    if not stale:
        return False
    rows = "".join(f"<li>{html.escape(f['rule_id'])} — {html.escape(_page(f['page_url']))} · "
                   f"by {html.escape(f.get('fixed_by') or '—')} · <b>waiting {f['waiting_days']} days</b></li>" for f in stale[:25])
    more = f"<li>…and {len(stale) - 25} more</li>" if len(stale) > 25 else ""
    for a in db.get_approvers():
        _send(a, f"{len(stale)} fix{'es' if len(stale) != 1 else ''} waiting {REMINDER_DAYS}+ days for approval",
              "Fixes waiting for your approval", "#b7791f",
              [f"These pull requests have waited {REMINDER_DAYS} days or more:", f"<ul style='padding-left:18px'>{rows}{more}</ul>"],
              f"⏰ {len(stale)} fix PR(s) have waited {REMINDER_DAYS}+ days for approval — open Fix History to review.",
              "Review in Fix History")
    return True
