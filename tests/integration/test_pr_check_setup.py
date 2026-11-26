"""Turn on PR checks: key → encrypted repo secret, workflow PR with baseline-urls,
no second PR while one is open, and no live key left behind when GitHub refuses."""
import base64
import io
import urllib.error
from unittest.mock import patch

from nacl.public import PrivateKey, SealedBox

from backend.services import pr_check_setup as setup

LINK = {"id": 3, "provider": "github", "repo_url": "https://github.com/acme/site", "site_url": "https://acme.github.io/site/",
        "default_branch": "main", "access_token": "ghp_x"}


def fake_github(open_pulls=(), secret_status=None):
    sk = PrivateKey.generate()
    calls = []

    def gh(method, path, token, body=None):
        calls.append((method, path, body))
        if path.startswith("/repos/acme/site/pulls"):
            return list(open_pulls)
        if path.endswith("/secrets/public-key"):
            return {"key": base64.b64encode(bytes(sk.public_key)).decode(), "key_id": "k1"}
        if "/secrets/" in path and secret_status:
            raise urllib.error.HTTPError(path, secret_status, "no", {}, io.BytesIO())
        if "/git/ref/heads/" in path:
            return {"object": {"sha": "abc"}}
        if method == "GET" and "/contents/" in path:
            raise urllib.error.HTTPError(path, 404, "missing", {}, io.BytesIO())
        return {}
    return gh, calls, sk


def test_token_without_workflow_scope_stops_before_anything(client, db_mock, authed_headers):
    db_mock.get_repo_link.return_value = LINK
    gh, calls, _ = fake_github()
    with patch.object(setup, "_gh", gh), patch.object(setup, "missing_workflow_scope", return_value=True):
        res = client.post("/api/repo-links/3/pr-check", headers=authed_headers)
    assert res.status_code == 400 and "workflow" in res.get_json()["error"]
    db_mock.create_api_key.assert_not_called()


def test_refused_workflow_file_deletes_branch_and_revokes_key(client, db_mock, authed_headers):
    gh, calls, _ = fake_github()
    def gh_refusing_workflow(method, path, token, body=None):
        if method == "PUT" and path.endswith(setup.WORKFLOW_PATH):
            raise urllib.error.HTTPError(path, 404, "no", {}, io.BytesIO())
        return gh(method, path, token, body)
    db_mock.get_repo_link.return_value = LINK
    db_mock.create_api_key.return_value = {"id": 9, "key": "ada_secret"}
    with patch.object(setup, "_gh", gh_refusing_workflow), patch.object(setup, "missing_workflow_scope", return_value=False):
        res = client.post("/api/repo-links/3/pr-check", headers=authed_headers)
    assert res.status_code == 502
    assert any(m == "DELETE" and "/git/refs/heads/ada/pr-check-" in p for m, p, _ in calls)
    db_mock.revoke_api_key.assert_called_once()


def test_turn_on_saves_secret_and_opens_workflow_pr(client, db_mock, authed_headers):
    gh, calls, sk = fake_github()
    db_mock.get_repo_link.return_value = LINK
    db_mock.create_api_key.return_value = {"id": 9, "key": "ada_secret"}
    with patch.object(setup, "missing_workflow_scope", return_value=False), patch.object(setup, "_gh", gh), \
         patch.object(setup, "create_pull_request", return_value={"url": "https://github.com/acme/site/pull/5", "number": 5}) as pr:
        res = client.post("/api/repo-links/3/pr-check", headers=authed_headers)
    data = res.get_json()
    assert data["ok"] and data["pr_number"] == 5
    secret = next(b for m, p, b in calls if m == "PUT" and p.endswith("/secrets/ADA_API_KEY"))
    assert SealedBox(sk).decrypt(base64.b64decode(secret["encrypted_value"])) == b"ada_secret"
    put = next(b for m, p, b in calls if m == "PUT" and p.endswith(setup.WORKFLOW_PATH))
    yaml = base64.b64decode(put["content"]).decode()
    assert "baseline-urls: https://acme.github.io/site/" in yaml and "secrets.ADA_API_KEY" in yaml
    assert pr.call_args.args[2] == put["branch"]
    db_mock.revoke_api_key.assert_not_called()


def test_open_setup_pr_is_reused(client, db_mock, authed_headers):
    gh, calls, _ = fake_github(open_pulls=[{"head": {"ref": "ada/pr-check-1"}, "html_url": "u", "number": 4}])
    db_mock.get_repo_link.return_value = LINK
    with patch.object(setup, "_gh", gh):
        data = client.post("/api/repo-links/3/pr-check", headers=authed_headers).get_json()
    assert data["already_open"] and data["pr_number"] == 4
    db_mock.create_api_key.assert_not_called()


def test_refused_secret_revokes_key(client, db_mock, authed_headers):
    gh, calls, _ = fake_github(secret_status=403)
    db_mock.get_repo_link.return_value = LINK
    db_mock.create_api_key.return_value = {"id": 9, "key": "ada_secret"}
    with patch.object(setup, "_gh", gh), patch.object(setup, "missing_workflow_scope", return_value=False):
        res = client.post("/api/repo-links/3/pr-check", headers=authed_headers)
    assert res.status_code == 502 and "Secrets" in res.get_json()["error"]
    db_mock.revoke_api_key.assert_called_once()
    assert not any(p.endswith("/git/refs") for _, p, _ in calls)   # no branch / PR made


def test_azure_not_supported_yet(client, db_mock, authed_headers):
    db_mock.get_repo_link.return_value = {**LINK, "provider": "azure"}
    assert client.post("/api/repo-links/3/pr-check", headers=authed_headers).status_code == 400


def test_workflow_already_on_main_opens_no_pr(client, db_mock, authed_headers):
    from config import Config
    yaml = setup.workflow_yaml(Config.APP_BASE_URL.rstrip("/"), LINK["site_url"])
    def gh(method, path, token, body=None):
        if path.startswith("/repos/acme/site/pulls"):
            return []
        if method == "GET" and path.endswith(f"{setup.WORKFLOW_PATH}?ref=main"):
            return {"content": base64.b64encode(yaml.encode()).decode()}
        raise AssertionError(f"unexpected {method} {path}")
    db_mock.get_repo_link.return_value = LINK
    with patch.object(setup, "_gh", gh), patch.object(setup, "missing_workflow_scope", return_value=False):
        data = client.post("/api/repo-links/3/pr-check", headers=authed_headers).get_json()
    assert data["ok"] and data["already_on"]
    db_mock.create_api_key.assert_not_called()


# ── GitLab / Bitbucket ────────────────────────────────────────────────────────

def fake_api(ci_file=None):
    """_api for GitLab/Bitbucket: no open PRs, `ci_file` on main (None: no CI file)."""
    calls = []

    def api(method, url, token, body=None, form=None):
        calls.append((method, url, body, form))
        if "merge_requests?" in url or "pullrequests?" in url:
            return [] if "gitlab" in url else {"values": []}
        if "/variables" in url and method == "GET":
            return {"values": []}
        if method == "PUT" and "gitlab.com" in url and "/variables/" in url:
            raise urllib.error.HTTPError(url, 404, "new", {}, io.BytesIO())
        if method == "GET" and ("/repository/files/" in url or "/src/main/" in url):
            if ci_file is None:
                raise urllib.error.HTTPError(url, 404, "missing", {}, io.BytesIO())
            return {"content": base64.b64encode(ci_file.encode()).decode(), "raw": ci_file}
        return {}
    return api, calls


GITLAB = {**LINK, "provider": "gitlab", "repo_url": "https://gitlab.com/acme/site"}
BITBUCKET = {**LINK, "provider": "bitbucket", "repo_url": "https://bitbucket.org/acme/site"}


def test_gitlab_saves_masked_variables_and_opens_merge_request(client, db_mock, authed_headers):
    api, calls = fake_api()
    db_mock.get_repo_link.return_value = dict(GITLAB)
    db_mock.create_api_key.return_value = {"id": 9, "key": "ada_secret"}
    with patch.object(setup, "_api", api), patch.object(setup, "create_pull_request",
                                                        return_value={"url": "u", "number": 7}) as pr:
        data = client.post("/api/repo-links/3/pr-check", headers=authed_headers).get_json()
    assert data["ok"] and data["pr_number"] == 7
    saved = {b["key"]: b for m, u, b, _ in calls if m == "POST" and u.endswith("/variables")}
    assert saved["ADA_API_KEY"]["value"] == "ada_secret" and saved["ADA_API_KEY"]["masked"]
    assert saved["ADA_REPO_TOKEN"]["value"] == "ghp_x"
    commit = next(b for m, u, b, _ in calls if u.endswith("/repository/commits"))
    action = commit["actions"][0]
    assert action["file_path"] == ".gitlab-ci.yml" and action["action"] == "create"
    assert 'ADA_BASELINE_URLS: "https://acme.github.io/site/"' in action["content"]
    assert commit["branch"] == pr.call_args.args[2] and pr.call_args.args[6] == "gitlab"


def test_bitbucket_enables_pipelines_and_commits_pipeline_file(client, db_mock, authed_headers):
    api, calls = fake_api()
    db_mock.get_repo_link.return_value = dict(BITBUCKET)
    db_mock.create_api_key.return_value = {"id": 9, "key": "ada_secret"}
    with patch.object(setup, "_api", api), patch.object(setup, "create_pull_request", return_value={"url": "u", "number": 2}):
        data = client.post("/api/repo-links/3/pr-check", headers=authed_headers).get_json()
    assert data["ok"]
    assert ("PUT", "https://api.bitbucket.org/2.0/repositories/acme/site/pipelines_config", {"enabled": True}, None) in calls
    saved = {b["key"]: b for m, u, b, _ in calls if m == "POST" and "/variables/" in u}
    assert saved["ADA_API_KEY"]["secured"] and saved["ADA_REPO_TOKEN"]["value"] == "ghp_x"
    form = next(f for m, u, _, f in calls if u.endswith("/src"))
    assert form["branch"].startswith("ada/pr-check-") and "pull-requests:" in form["bitbucket-pipelines.yml"]


def test_their_own_pipeline_file_is_not_overwritten(client, db_mock, authed_headers):
    api, calls = fake_api(ci_file="stages: [build]\n")
    db_mock.get_repo_link.return_value = dict(GITLAB)
    db_mock.create_api_key.return_value = {"id": 9, "key": "ada_secret"}
    with patch.object(setup, "_api", api):
        res = client.post("/api/repo-links/3/pr-check", headers=authed_headers)
    assert res.status_code == 502 and "won't overwrite" in res.get_json()["error"]
    assert not any(u.endswith("/repository/commits") for _, u, _, _ in calls)
    db_mock.revoke_api_key.assert_called_once()


def test_gitlab_already_on(client, db_mock, authed_headers):
    from config import Config
    api, _ = fake_api(ci_file=setup.gitlab_ci_yaml(Config.APP_BASE_URL.rstrip("/"), LINK["site_url"]))
    db_mock.get_repo_link.return_value = dict(GITLAB)
    with patch.object(setup, "_api", api):
        data = client.post("/api/repo-links/3/pr-check", headers=authed_headers).get_json()
    assert data["already_on"]
    db_mock.create_api_key.assert_not_called()
