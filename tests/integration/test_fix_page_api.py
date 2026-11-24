"""Fix all on one page: POST /api/auto-fix-page — one run, one PR, one Fix History row per issue."""
from unittest.mock import patch

from backend.services.auto_fix_service import _first_per_rule, _pr_body_page

LINK = {"repo_url": "https://github.com/acme/site", "access_token": "ghp_x", "provider": "github", "default_branch": "main"}
PAGE = "https://acme.io/"
BTN, IMG, IMG2 = '<button class="x"></button>', '<img src="a.png">', '<img src="b.png">'
BODY = {"page_url": PAGE, "violations": [
    {"rule": {"id": "button-name", "help": "Buttons need text"}, "nodes": [{"html": BTN}]},
    {"rule": {"id": "image-alt", "help": "Images need alt"}, "nodes": [{"html": IMG}, {"html": IMG2}]},
    {"rule": {"id": "html-has-lang"}, "nodes": [{"html": ""}]},          # page-wide: nothing to locate, skipped
]}


def _setup(db_mock):
    db_mock.get_repo_link_for_url.return_value = LINK
    db_mock.get_open_fix.return_value = None


def test_one_run_one_pr_and_a_row_per_issue(client, db_mock, authed_headers, no_fix_notifications):
    _setup(db_mock)
    result = {"status": "verified", "pr_url": "https://github.com/acme/site/pull/12", "branch_url": "b", "results": [
        {"rule_id": "button-name", "status": "patched", "patch_signature": "p1", "proof": {"help": "Buttons need text"}},
        {"rule_id": "image-alt", "status": "patched", "patch_signature": "p2"},
        {"rule_id": "image-alt", "status": "failed", "error": "Could not uniquely match"},
    ]}
    with patch("backend.services.auto_fix_service.run_auto_fix_page", return_value=result) as run:
        data = client.post("/api/auto-fix-page", json=BODY, headers=authed_headers).get_json()
    items = run.call_args[0][2]
    assert [(r["id"], len(n)) for r, n in items] == [("button-name", 1), ("image-alt", 2)]
    assert [r["status"] for r in data["by_rule"]["image-alt"]] == ["patched", "failed"]
    assert db_mock.save_fix.call_count == 2 and data["issues_saved"] == 2
    rows = [c[0] for c in db_mock.save_fix.call_args_list]
    assert {r[2] for r in rows} == {"button-name", "image-alt"}
    assert all(r[6] == result["pr_url"] for r in rows)              # every row on the one PR
    assert rows[0][10]["page_fix"]["issues"] == 2
    # image-alt: 2 elements sent, 1 patched -> only the patched one is recorded,
    # so a second Fix all finds it (and retries the failed one)
    image_alt = next(r for r in rows if r[2] == "image-alt")
    assert len(image_alt[10]["page_fix"]["signatures"]) == 1
    assert image_alt[10]["page_fix"]["signatures"][0] == image_alt[8]
    assert [c[0] for c in no_fix_notifications] == ["new_fix"]      # one notification, not one per issue


def test_issues_with_an_open_pr_are_skipped(client, db_mock, authed_headers):
    _setup(db_mock)
    db_mock.get_open_fix.return_value = {"pr_url": "https://github.com/acme/site/pull/3", "branch_url": "b"}
    with patch("app._open_fix", side_effect=lambda lookup, link: lookup([])), \
         patch("backend.services.auto_fix_service.run_auto_fix_page") as run:
        data = client.post("/api/auto-fix-page", json=BODY, headers=authed_headers).get_json()
    run.assert_not_called()
    assert data["duplicate"] and data["already_open"] == ["button-name", "image-alt"]


def test_needs_a_repo_and_a_body(client, db_mock, authed_headers):
    assert client.post("/api/auto-fix-page", json={"page_url": PAGE}, headers=authed_headers).status_code == 400
    db_mock.get_repo_link_for_url.return_value = None
    assert client.post("/api/auto-fix-page", json=BODY, headers=authed_headers).status_code == 404


def test_pr_body_groups_by_issue_and_lists_what_was_left():
    applied = [{"rule": {"id": "image-alt", "help": "Images need alt"}, "file_path": "a.html", "line_no": 3,
                "patch": {"before": "<img>", "after": '<img alt="x">'}},
               {"rule": {"id": "button-name", "help": "Buttons need text"}, "file_path": "a.html", "line_no": 9,
                "patch": {"before": "<button>", "after": '<button aria-label="Menu">'}},
               {"rule": {"id": "image-alt", "help": "Images need alt"}, "file_path": "a.html", "line_no": 5,
                "patch": {"before": "<img>", "after": '<img alt="y">'}}]
    body = _pr_body_page(PAGE, applied, [{"rule_id": "color-contrast", "error": "no built-in fix"}])
    assert "2 issues fixed in one pull request" in body
    assert "Images need alt — `image-alt` (2 elements)" in body and "Not fixed automatically" in body
    assert [e["line_no"] for e in _first_per_rule(applied)] == [3, 9]
