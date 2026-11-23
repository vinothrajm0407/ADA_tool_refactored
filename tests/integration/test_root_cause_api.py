"""Fix at the source: GET /api/crawl/<id>/root-causes and POST .../<group>/fix."""
from unittest.mock import patch

from backend.services.root_causes import group_id, markup_key, node_signature

BTN = '<button class="icon-btn"></button>'
LINK = {"repo_url": "https://github.com/acme/site", "access_token": "ghp_x", "provider": "github", "default_branch": "main"}
PAGES = [(f"https://s.io/p{i}", {"axeResult": {"violations": [
    {"id": "button-name", "help": "Buttons need text", "impact": "critical", "tags": [],
     "nodes": [{"html": BTN, "target": [".icon-btn"]}]}]}}) for i in range(12)]
GID = group_id("button-name", markup_key(BTN))


def test_lists_shared_root_causes_with_fix_state(client, db_mock, authed_headers):
    db_mock.get_crawl_page_payloads.return_value = PAGES
    db_mock.get_fix_states.return_value = {("button-name", node_signature(BTN)): {"pr_url": "https://github.com/acme/site/pull/9", "pr_state": "open"}}
    db_mock.get_repo_link_for_url.return_value = LINK
    data = client.get("/api/crawl/c1/root-causes", headers=authed_headers).get_json()
    rc = data["root_causes"][0]
    assert (rc["id"], rc["page_count"], rc["sample_page"]) == (GID, 12, "https://s.io/p0")
    assert rc["fix"]["pr_url"].endswith("/pull/9") and data["scanned_pages"] == 12 and data["repo_connected"]


def test_fix_runs_once_verifies_other_pages_and_records_one_row(client, db_mock, authed_headers, no_fix_notifications):
    db_mock.get_crawl_page_payloads.return_value = PAGES
    db_mock.get_fix_states.return_value = {}
    db_mock.get_repo_link_for_url.return_value = LINK
    result = {"status": "verified", "pr_url": "https://github.com/acme/site/pull/10", "branch_url": "b",
              "results": [{"status": "patched", "patch_signature": "ps", "proof": {"help": "Buttons need text"}}],
              "pages_checked": [{"url": "https://s.io/p3", "fixed": True}, {"url": "https://s.io/p7", "fixed": None}]}
    with patch("backend.services.auto_fix_service.run_auto_fix_batch", return_value=result) as run:
        resp = client.post(f"/api/crawl/c1/root-causes/{GID}/fix", headers=authed_headers)
    assert resp.status_code == 200 and resp.get_json()["page_count"] == 12
    args, kwargs = run.call_args
    assert args[1] == "https://s.io/p0" and len(args[3]) == 1                     # one element, located once
    assert kwargs["root_cause"]["page_count"] == 12 and "https://s.io/p0" not in kwargs["root_cause"]["pages"]
    assert len(kwargs["root_cause"]["pages"]) == 8                                 # spread sample of the other 11
    db_mock.save_fix.assert_called_once()
    proof = db_mock.save_fix.call_args[0][10]
    assert proof["root_cause"] == {"page_count": 12, "pages_checked": 1, "pages_clean": 1, "crawl_id": "c1"}
    assert no_fix_notifications[-1][0] == "new_fix"


def test_fix_unknown_group_or_no_repo(client, db_mock, authed_headers):
    db_mock.get_crawl_page_payloads.return_value = PAGES
    assert client.post("/api/crawl/c1/root-causes/nope/fix", headers=authed_headers).status_code == 404
    db_mock.get_repo_link_for_url.return_value = None
    assert client.post(f"/api/crawl/c1/root-causes/{GID}/fix", headers=authed_headers).status_code == 404
    db_mock.save_fix.assert_not_called()


def test_merged_fix_still_found_by_a_later_crawl_is_flagged(client, db_mock, authed_headers):
    db_mock.get_crawl_page_payloads.return_value = PAGES
    db_mock.get_repo_link_for_url.return_value = LINK
    db_mock.get_crawl_job.return_value = {"created_at": "2026-11-23T13:00:00+00:00"}
    sig = node_signature(BTN)
    for merged_at, expected in (("2026-11-23T09:38:36Z", True), ("2026-11-23T14:00:00Z", False)):
        db_mock.get_fix_states.return_value = {("button-name", sig): {"pr_state": "merged", "merged_at": merged_at}}
        fix = client.get("/api/crawl/c1/root-causes", headers=authed_headers).get_json()["root_causes"][0]["fix"]
        assert fix["still_live"] is expected
