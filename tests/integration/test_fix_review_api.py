"""Approval workflow: POST /api/fixes/<id>/review, and Approver-wide fix visibility."""
from unittest.mock import patch

FIX = {"id": 7, "user_id": 2, "page_url": "https://example.com/", "rule_id": "image-alt", "status": "verified",
       "pr_url": "https://github.com/acme/site/pull/5", "pr_state": "open", "approval_status": "pending"}
LINK = {"repo_url": "https://github.com/acme/site", "access_token": "ghp_x", "provider": "github"}
SVC = "backend.services.auto_fix_service"


def _approver(db_mock):
    db_mock.get_user_role.return_value = "approver"
    db_mock.get_fix.return_value = dict(FIX)
    db_mock.get_repo_link_for_url.return_value = LINK
    db_mock.get_fixes.return_value = [{**FIX, "approval_status": "approved"}]


def test_developer_cannot_review(client, db_mock, authed_headers):
    resp = client.post("/api/fixes/7/review", json={"decision": "approve"}, headers=authed_headers)
    assert resp.status_code == 403
    db_mock.review_fix.assert_not_called()


def test_approve_merges_pr_and_records_approver(client, db_mock, authed_headers):
    _approver(db_mock)
    with patch(f"{SVC}.merge_pull_request", return_value=True) as merge:
        resp = client.post("/api/fixes/7/review", json={"decision": "approve", "comment": "LGTM"}, headers=authed_headers)
    assert resp.status_code == 200 and resp.get_json()["fix"]["approval_status"] == "approved"
    assert merge.call_args[0][:3] == ("https://github.com/acme/site", "ghp_x", 5)
    db_mock.get_repo_link_for_url.assert_called_with("https://example.com/", 2)  # the developer's (shared) repo link
    args, kwargs = db_mock.review_fix.call_args
    assert args[2:4] == ("approved", "LGTM") and kwargs["pr_state"] == "merged"


def test_failed_merge_records_nothing(client, db_mock, authed_headers):
    _approver(db_mock)
    with patch(f"{SVC}.merge_pull_request", return_value=False):
        resp = client.post("/api/fixes/7/review", json={"decision": "approve"}, headers=authed_headers)
    assert resp.status_code == 502
    db_mock.review_fix.assert_not_called()


def test_reject_needs_reason_and_closes_pr(client, db_mock, authed_headers):
    _approver(db_mock)
    assert client.post("/api/fixes/7/review", json={"decision": "reject"}, headers=authed_headers).status_code == 400
    with patch(f"{SVC}.close_pull_request", return_value=True) as close:
        resp = client.post("/api/fixes/7/review", json={"decision": "reject", "comment": "Wrong label"}, headers=authed_headers)
    assert resp.status_code == 200
    assert close.call_args[0][4] == "Wrong label"
    args, kwargs = db_mock.review_fix.call_args
    assert args[2] == "rejected" and kwargs["pr_state"] == "closed"


def test_already_merged_pr_cannot_be_reviewed(client, db_mock, authed_headers):
    _approver(db_mock)
    db_mock.get_fix.return_value = {**FIX, "pr_state": "merged"}
    assert client.post("/api/fixes/7/review", json={"decision": "approve"}, headers=authed_headers).status_code == 409


def test_approver_sees_everyones_fixes_developer_only_own(client, db_mock, authed_headers):
    db_mock.get_fixes.return_value = []
    client.get("/api/fixes", headers=authed_headers)
    assert db_mock.get_fixes.call_args[0][0] is not None   # developer: scoped to self
    db_mock.get_user_role.return_value = "approver"
    client.get("/api/fixes", headers=authed_headers)
    assert db_mock.get_fixes.call_args[0][0] is None       # approver: all users



def test_request_changes_comments_keeps_pr_open_and_tells_developer(client, db_mock, authed_headers, no_fix_notifications):
    _approver(db_mock)
    assert client.post("/api/fixes/7/review", json={"decision": "changes"}, headers=authed_headers).status_code == 400
    with patch(f"{SVC}.comment_on_pull_request", return_value=True) as comment, \
         patch(f"{SVC}.close_pull_request") as close, patch(f"{SVC}.merge_pull_request") as merge:
        resp = client.post("/api/fixes/7/review", json={"decision": "changes", "comment": "Use a shorter alt"}, headers=authed_headers)
    assert resp.status_code == 200
    assert "Use a shorter alt" in comment.call_args[0][4]
    close.assert_not_called(); merge.assert_not_called()
    args, kwargs = db_mock.review_fix.call_args
    assert args[2:4] == ("changes_requested", "Use a shorter alt") and "pr_state" not in kwargs
    assert no_fix_notifications[-1][0] == "decision" and no_fix_notifications[-1][1][1] == "changes_requested"


def test_resubmit_goes_back_to_pending_and_tells_approvers(client, db_mock, authed_headers, no_fix_notifications):
    from tests.conftest import TEST_USER_ID
    db_mock.get_fix.return_value = {**FIX, "user_id": TEST_USER_ID, "approval_status": "changes_requested"}
    db_mock.get_fixes.return_value = [{**FIX, "approval_status": "pending"}]
    resp = client.post("/api/fixes/7/resubmit", headers=authed_headers)
    assert resp.status_code == 200
    db_mock.resubmit_fix.assert_called_once_with(7)
    assert no_fix_notifications[-1][0] == "resubmitted"


def test_resubmit_refuses_someone_elses_or_pending_fix(client, db_mock, authed_headers):
    db_mock.get_fix.return_value = {**FIX, "user_id": 999, "approval_status": "changes_requested"}
    assert client.post("/api/fixes/7/resubmit", headers=authed_headers).status_code == 404
    from tests.conftest import TEST_USER_ID
    db_mock.get_fix.return_value = {**FIX, "user_id": TEST_USER_ID, "approval_status": "pending"}
    assert client.post("/api/fixes/7/resubmit", headers=authed_headers).status_code == 409
    db_mock.resubmit_fix.assert_not_called()


def test_roles_are_approver_only_and_cannot_change_own(client, db_mock, authed_headers):
    from tests.conftest import TEST_USER_ID
    assert client.get("/api/users", headers=authed_headers).status_code == 403
    db_mock.get_user_role.return_value = "approver"
    db_mock.list_users.return_value = [{"id": 19, "email": "dev@test.local", "role": "developer"}]
    db_mock.set_user_role_by_id.return_value = True
    assert client.get("/api/users", headers=authed_headers).get_json()["users"][0]["id"] == 19
    assert client.put(f"/api/users/{TEST_USER_ID}/role", json={"role": "developer"}, headers=authed_headers).status_code == 409
    assert client.put("/api/users/19/role", json={"role": "boss"}, headers=authed_headers).status_code == 400
    assert client.put("/api/users/19/role", json={"role": "approver"}, headers=authed_headers).status_code == 200
    db_mock.set_user_role_by_id.assert_called_once_with(19, "approver")
