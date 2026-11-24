"""Fix everything: POST /api/crawl/<id>/fix-site — every page of a crawl, one run, one PR."""
from unittest.mock import patch

LINK = {"id": 7, "repo_url": "https://github.com/acme/site", "access_token": "ghp_x", "provider": "github",
        "default_branch": "main", "path_prefix": "/site/"}
OTHER = {**LINK, "id": 8}
ROOT, PROFILE, ELSEWHERE = "https://acme.io/site/", "https://acme.io/site/profile.html", "https://acme.io/settings"


def _payload(*violations):
    return {"axeResult": {"violations": list(violations)}}


BTN = {"id": "button-name", "help": "Buttons need text", "nodes": [{"html": "<button></button>"}]}
IMG = {"id": "image-alt", "nodes": [{"html": '<img src="a">'}, {"html": '<img src="b">'}]}


def _setup(db_mock):
    db_mock.get_crawl_job.return_value = {"root_url": ROOT}
    db_mock.get_crawl_page_payloads.return_value = [
        (ROOT, _payload(BTN, IMG)), (PROFILE, _payload(BTN)), (ELSEWHERE, _payload(BTN))]
    db_mock.get_repo_link_for_url.side_effect = lambda url, uid: OTHER if url == ELSEWHERE else LINK
    db_mock.get_open_fix.return_value = None


def test_every_page_of_the_repo_in_one_run_and_one_pr(client, db_mock, authed_headers, no_fix_notifications):
    _setup(db_mock)
    result = {"status": "verified", "pr_url": "https://github.com/acme/site/pull/40", "branch_url": "b", "results": [
        {"rule_id": "button-name", "status": "patched", "patch_signature": "p1"},   # root
        {"rule_id": "image-alt", "status": "patched", "patch_signature": "p2"},
        {"rule_id": "image-alt", "status": "failed", "error": "no match"},
        {"rule_id": "button-name", "status": "patched", "patch_signature": "p3"},   # profile
    ]}
    with patch("backend.services.auto_fix_service.run_auto_fix_site", return_value=result) as run, \
         patch("backend.services.auto_fix_service.RULES_WITH_FALLBACK", {"button-name", "image-alt"}):
        data = client.post("/api/crawl/C1/fix-site", headers=authed_headers).get_json()
    pages = run.call_args[0][1]
    assert [u for u, _ in pages] == [ROOT, PROFILE]                 # the other site's page is left out
    assert data["other_repo"] == [ELSEWHERE] and data["pr_url"] == result["pr_url"]
    rows = [c[0] for c in db_mock.save_fix.call_args_list]
    assert [(r[1], r[2]) for r in rows] == [(ROOT, "button-name"), (ROOT, "image-alt"), (PROFILE, "button-name")]
    assert all(r[6] == result["pr_url"] for r in rows)              # one PR for the whole site
    assert len(no_fix_notifications) == 1


def test_nothing_to_do_when_every_element_has_an_open_pr(client, db_mock, authed_headers):
    _setup(db_mock)
    db_mock.get_open_fix.return_value = {"pr_url": "https://github.com/acme/site/pull/3", "branch_url": "b"}
    with patch("app._open_fix", side_effect=lambda lookup, link: lookup([])), \
         patch("backend.services.auto_fix_service.run_auto_fix_site") as run, \
         patch("backend.services.auto_fix_service.RULES_WITH_FALLBACK", {"button-name", "image-alt"}):
        data = client.post("/api/crawl/C1/fix-site", headers=authed_headers).get_json()
    run.assert_not_called()
    assert data["duplicate"] and data["fixed_pages"] == 0


def test_needs_a_repo(client, db_mock, authed_headers):
    _setup(db_mock)
    db_mock.get_repo_link_for_url.side_effect = None
    db_mock.get_repo_link_for_url.return_value = None
    assert client.post("/api/crawl/C1/fix-site", headers=authed_headers).status_code == 404


def test_pipeline_locates_each_element_on_its_own_page():
    """run_auto_fix_site hands every element its own page to locate and re-scan."""
    from backend.services import auto_fix_service as afs
    seen = []
    with patch.object(afs, "_resolve_provider_and_token", return_value=("github", "t", None)), \
         patch.object(afs, "_clone_repo", side_effect=RuntimeError("stop after locate")), \
         patch.object(afs, "locate_source", side_effect=lambda *a, **k: seen.append(a[4])):
        afs.run_auto_fix_site(LINK, [(ROOT, [(BTN, BTN["nodes"])]), (PROFILE, [(BTN, BTN["nodes"])])])
    assert seen == []  # clone failed first: nothing located, no crash
    with patch.object(afs, "_resolve_provider_and_token", return_value=("github", "t", None)), \
         patch.object(afs, "_clone_repo", return_value=__import__("pathlib").Path(".")), \
         patch.object(afs, "_rmtree_force"), \
         patch.object(afs, "locate_source", side_effect=lambda *a, **k: seen.append(a[4])):
        out = afs.run_auto_fix_site(LINK, [(ROOT, [(BTN, BTN["nodes"])]), (PROFILE, [(BTN, BTN["nodes"])])])
    assert seen == [ROOT, PROFILE]
    assert out["status"] == "failed"  # nothing located -> no PR
