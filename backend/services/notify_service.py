"""Best-effort auto-push of scan/crawl reports to configured Slack/Teams channels."""
import logging

from services import db

logger = logging.getLogger(__name__)


def auto_share_report(user_id: int | None, report_type: str, context: dict) -> None:
    """Push a report to every 'general'-purpose channel configured for this user.
    Never raises — a broken integration must not fail the scan/crawl it reports on."""
    if not user_id or not db.is_ready():
        return
    try:
        from app import _slack_api, _teams_webhook_send, _build_slack_blocks, _build_teams_card, _slack_upload_file
    except Exception:
        logger.exception("auto_share_report: could not import send helpers")
        return

    try:
        integrations = db.get_integrations(user_id)
    except Exception:
        logger.exception("auto_share_report: failed to load integrations for user %s", user_id)
        return

    for summary_row in integrations:
        integration = db.get_integration(summary_row["id"], user_id)
        if not integration:
            continue
        try:
            channels = [c for c in db.get_integration_channels(integration["id"])
                        if (c.get("purpose") or "general") == "general"]
        except Exception:
            continue
        for channel in channels:
            try:
                if integration["platform"] == "slack":
                    if context.get("skip_slack_card"):
                        # Executive Summary PDF already delivered this report as a
                        # single file+comment message (see send_report_pdf) — skip
                        # the separate blocks card so Slack doesn't get two messages.
                        continue
                    blocks, fallback, overflow = _build_slack_blocks(report_type, context)
                    result = _slack_api(integration["access_token"], "chat.postMessage", {
                        "channel": channel["channel_id"],
                        "text": fallback,
                        "blocks": blocks,
                    })
                    success = result.get("ok", False)
                    err_msg = None if success else result.get("error", "Unknown error")
                    if success and overflow:
                        _slack_upload_file(integration["access_token"], channel["channel_id"],
                                            overflow["filename"], overflow["content"])
                else:
                    payload = _build_teams_card(report_type, context)
                    success = _teams_webhook_send(channel["webhook_url"], payload)
                    err_msg = None if success else "Webhook delivery failed"
                db.log_integration_delivery(
                    integration_id=integration["id"],
                    channel_id=channel["channel_id"],
                    channel_name=channel["channel_name"],
                    report_type=report_type,
                    status="success" if success else "failed",
                    error_msg=err_msg,
                    reference=context.get("reference"),
                )
            except Exception:
                logger.exception(
                    "auto_share_report: delivery failed integration=%s channel=%s",
                    integration.get("id"), channel.get("channel_id"),
                )


def has_slack_integration(user_id: int | None) -> bool:
    """Cheap check used to skip rendering an Executive Summary PDF entirely
    when the user has nowhere to send it — avoids paying for a headless
    browser launch for the common case of no Slack connected."""
    if not user_id or not db.is_ready():
        return False
    try:
        return any(i.get("platform") == "slack" for i in db.get_integrations(user_id))
    except Exception:
        return False


def send_report_pdf(user_id: int | None, filename: str, pdf_bytes: bytes,
                     reference=None, initial_comment: str | None = None) -> bool:
    """Upload an Executive Summary PDF to every 'general'-purpose Slack channel
    configured for this user, as a single file+comment message. Slack-only —
    Teams incoming webhooks can't carry file attachments, so Teams keeps
    getting the existing rich-text card from auto_share_report unchanged.
    Returns True if at least one channel received it; never raises."""
    if not user_id or not pdf_bytes or not db.is_ready():
        return False
    try:
        from app import _slack_upload_file
    except Exception:
        logger.exception("send_report_pdf: could not import _slack_upload_file")
        return False
    try:
        integrations = [i for i in db.get_integrations(user_id) if i.get("platform") == "slack"]
    except Exception:
        logger.exception("send_report_pdf: failed to load integrations for user %s", user_id)
        return False
    any_success = False
    for summary_row in integrations:
        integration = db.get_integration(summary_row["id"], user_id)
        if not integration:
            continue
        try:
            channels = [c for c in db.get_integration_channels(integration["id"])
                        if (c.get("purpose") or "general") == "general"]
        except Exception:
            continue
        for channel in channels:
            try:
                if _slack_upload_file(integration["access_token"], channel["channel_id"], filename,
                                       pdf_bytes, initial_comment=initial_comment):
                    any_success = True
            except Exception:
                logger.exception(
                    "send_report_pdf: upload failed integration=%s channel=%s",
                    integration.get("id"), channel.get("channel_id"),
                )
    return any_success
