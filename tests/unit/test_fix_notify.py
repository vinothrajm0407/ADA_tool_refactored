"""Daily 'waiting for approval' reminder: which fixes count as stale, and once-a-day sending."""
from datetime import datetime, timezone
from unittest.mock import patch

from backend.services import fix_notify

NOW = datetime(2026, 11, 23, 10, 0, tzinfo=timezone.utc)


def _fix(i, created, **kw):
    return {"id": i, "rule_id": "image-alt", "page_url": "https://x/", "pr_url": f"https://g/pull/{i}",
            "pr_state": "open", "approval_status": "pending", "created_at": created, **kw}


def test_stale_fixes_only_old_pending_open_prs_once_per_pr():
    fixes = [
        _fix(1, "2026-11-15T10:00:00Z"),                                  # 8 days — stale
        _fix(2, "2026-11-22T10:00:00Z"),                                  # 1 day — fresh
        _fix(3, "2026-11-10T10:00:00Z", approval_status="changes_requested"),  # with the developer
        _fix(4, "2026-11-10T10:00:00Z", pr_state="merged"),
        {**_fix(5, "2026-11-19T10:00:00Z"), "pr_url": "https://g/pull/1"},  # same batch PR as #1
    ]
    stale = fix_notify.stale_fixes(fixes, NOW)
    assert [f["id"] for f in stale] == [1] and stale[0]["waiting_days"] == 8


def test_digest_goes_once_a_day_to_each_approver(tmp_path, monkeypatch):
    monkeypatch.setattr(fix_notify, "_DIGEST_STAMP", tmp_path / "stamp")  # survives restarts: a file, not memory
    with patch.object(fix_notify, "db") as db, patch.object(fix_notify, "_send") as send:
        db.is_ready.return_value = True
        db.get_fixes.return_value = [_fix(1, "2026-11-01T10:00:00Z")]
        db.get_approvers.return_value = [{"id": 1, "email": "a@x"}, {"id": 2, "email": "b@x"}]
        early = datetime(2026, 11, 23, 7, 0).astimezone()
        assert fix_notify.maybe_send_digest(early.replace(hour=fix_notify.DIGEST_HOUR - 1)) is False
        assert fix_notify.maybe_send_digest(early.replace(hour=fix_notify.DIGEST_HOUR + 1)) is True
        assert fix_notify.maybe_send_digest(early.replace(hour=fix_notify.DIGEST_HOUR + 3)) is False
    assert send.call_count == 2


def test_decision_skips_when_reviewer_fixed_it_themselves():
    with patch.object(fix_notify, "db") as db, patch.object(fix_notify, "_send") as send:
        fix_notify._decision({"user_id": 5, "rule_id": "r", "page_url": "u"}, "approved", 5, "")
        send.assert_not_called()
        db.get_user_by_id.return_value = {"id": 9, "email": "dev@x", "firstName": "Dev"}
        fix_notify._decision({"user_id": 9, "rule_id": "r", "page_url": "u"}, "changes_requested", 5, "shorter")
        assert "Resubmit" in " ".join(send.call_args[0][4])
