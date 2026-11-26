"""One-click "Turn on PR checks" for a connected repo: saves an ADA API key as a
repo secret / CI variable and opens a PR adding the accessibility check (with
baseline-urls = the live site, so only new issues block).

GitHub: a workflow using the ADA action. GitLab / Bitbucket: a CI file that
downloads the same scripts/ada_pr_review.py; it also needs ADA_REPO_TOKEN (the
link's token) to comment on the merge / pull request."""
import base64
import json
import time
import urllib.error
import urllib.parse
import urllib.request

from backend.services.auto_fix_service import _parse_github_repo, _parse_repo, create_pull_request

ACTION = "vinothrajm0407/ADA_tool_refactored@main"
SCRIPT_URL = "https://raw.githubusercontent.com/vinothrajm0407/ADA_tool_refactored/main/scripts/ada_pr_review.py"
WORKFLOW_PATH = ".github/workflows/accessibility.yml"
CI_PATHS = {"github": WORKFLOW_PATH, "gitlab": ".gitlab-ci.yml", "bitbucket": "bitbucket-pipelines.yml"}
HEADER = "# Added by ADA Tool"   # a CI file starting with this is ours to replace
BRANCH_PREFIX = "ada/pr-check"
SECRET = "ADA_API_KEY"
REPO_TOKEN = "ADA_REPO_TOKEN"
PROVIDER_NAMES = {"github": "GitHub", "gitlab": "GitLab", "bitbucket": "Bitbucket"}


class SetupError(Exception):
    pass


def workflow_yaml(api_url: str, site_url: str) -> str:
    return f"""# Added by ADA Tool — "Stop new problems": fails only on accessibility issues a PR adds.
name: Accessibility
on: pull_request
permissions:
  pull-requests: write
jobs:
  ada:
    runs-on: ubuntu-latest
    steps:
      - uses: {ACTION}
        with:
          api-url: {api_url}
          api-key: ${{{{ secrets.{SECRET} }}}}
          # Pages to check: change to where this PR's version runs (preview / staging).
          # While it points at the live site the check passes — nothing is "new".
          urls: |
            {site_url}
          fail-on: serious
          # The live site: issues already there are listed but don't block.
          baseline-urls: {site_url}
"""


_FETCH = "python3 -c \"import urllib.request as u; u.urlretrieve('" + SCRIPT_URL + "', 'ada_pr_review.py')\""


def gitlab_ci_yaml(api_url: str, site_url: str) -> str:
    return f"""{HEADER} — "Stop new problems": fails only on accessibility issues a merge request adds.
ada-accessibility:
  image: python:3.12-slim
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  variables:
    ADA_API_URL: "{api_url}"
    # Pages to check (comma separated): change to where this MR's version runs (preview / staging), e.g.
    # https://gl.githack.com/$CI_PROJECT_PATH/raw/$CI_COMMIT_SHA/docs/index.html
    # While it points at the live site the check passes — nothing is "new".
    ADA_URLS: "{site_url}"
    # The live site: issues already there are listed but don't block.
    ADA_BASELINE_URLS: "{site_url}"
    ADA_FAIL_ON: serious
  script:
    - {_FETCH}
    - python3 ada_pr_review.py
"""


def bitbucket_yaml(api_url: str, site_url: str) -> str:
    return f"""{HEADER} — "Stop new problems": fails only on accessibility issues a pull request adds.
image: python:3.12-slim
pipelines:
  pull-requests:
    '**':
      - step:
          name: ADA accessibility check
          script:
            - export ADA_API_URL="{api_url}"
            # Pages to check (comma separated): change to where this PR's version runs (preview / staging), e.g.
            # https://bb.githack.com/$BITBUCKET_REPO_FULL_NAME/raw/$BITBUCKET_COMMIT/docs/index.html
            # While it points at the live site the check passes — nothing is "new".
            - export ADA_URLS="{site_url}"
            # The live site: issues already there are listed but don't block.
            - export ADA_BASELINE_URLS="{site_url}"
            - export ADA_FAIL_ON=serious
            - {_FETCH}
            - python3 ada_pr_review.py
"""


def ci_yaml(link: dict, api_url: str) -> str:
    make = {"gitlab": gitlab_ci_yaml, "bitbucket": bitbucket_yaml}.get(link["provider"], workflow_yaml)
    return make(api_url, link["site_url"])


def _api(method: str, url: str, token: str, body: dict | None = None, form: dict | None = None) -> dict | list:
    """JSON call to any provider's REST API (`form`: urlencoded, for Bitbucket's /src commit)."""
    data, ctype = (urllib.parse.urlencode(form).encode(), "application/x-www-form-urlencoded") if form is not None \
        else (json.dumps(body).encode() if body is not None else None, "application/json")
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json" if "api.github.com" in url else "*/*",
        "User-Agent": "ADA-Accessibility-Intelligence",
        "Content-Type": ctype,
    })
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read()
    try:
        return json.loads(raw) if raw else {}
    except ValueError:   # Bitbucket's raw file endpoint answers with the file itself
        return {"raw": raw.decode(errors="replace")}


def _gh(method: str, path: str, token: str, body: dict | None = None) -> dict | list:
    return _api(method, f"https://api.github.com{path}", token, body)


def _base(link: dict) -> str:
    """The provider's REST root for this repo."""
    path = _parse_repo(link["provider"], link["repo_url"])
    if link["provider"] == "gitlab":
        return f"https://gitlab.com/api/v4/projects/{urllib.parse.quote(path, safe='')}"
    return f"https://api.bitbucket.org/2.0/repositories/{path}"


def _ci_file(link: dict) -> str | None:
    """The CI file on the default branch (GitLab / Bitbucket), None if there is none."""
    branch, path = link["default_branch"] or "main", CI_PATHS[link["provider"]]
    try:
        if link["provider"] == "gitlab":
            f = _api("GET", f"{_base(link)}/repository/files/{urllib.parse.quote(path, safe='')}?ref={branch}",
                     link["access_token"])
            return base64.b64decode(f.get("content", "")).decode()
        return _api("GET", f"{_base(link)}/src/{branch}/{path}", link["access_token"]).get("raw", "")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def _sealed(public_key_b64: str, value: str) -> str:
    """GitHub secrets must be encrypted with the repo's public key (libsodium sealed box)."""
    from nacl.public import PublicKey, SealedBox
    box = SealedBox(PublicKey(base64.b64decode(public_key_b64)))
    return base64.b64encode(box.encrypt(value.encode())).decode()


def missing_workflow_scope(link: dict) -> bool:
    """GitHub refuses (404) any file under .github/workflows from a classic token
    without the 'workflow' scope. Classic tokens list their scopes in a header;
    fine-grained ones don't (False — they find out at the write)."""
    owner, repo = _parse_github_repo(link["repo_url"])
    req = urllib.request.Request(f"https://api.github.com/repos/{owner}/{repo}", headers={
        "Authorization": f"Bearer {link['access_token']}", "User-Agent": "ADA-Accessibility-Intelligence"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        scopes = resp.headers.get("X-OAuth-Scopes")
    return scopes is not None and "workflow" not in [s.strip() for s in scopes.split(",")]


def already_on(link: dict, api_url: str) -> bool:
    """The default branch already has exactly this workflow — nothing to open a PR for."""
    if link["provider"] != "github":
        return _ci_file(link) == ci_yaml(link, api_url)
    owner, repo = _parse_github_repo(link["repo_url"])
    try:
        f = _gh("GET", f"/repos/{owner}/{repo}/contents/{WORKFLOW_PATH}?ref={link['default_branch'] or 'main'}",
                link["access_token"])
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False
        raise
    return base64.b64decode(f.get("content", "")).decode() == workflow_yaml(api_url, link["site_url"])


def open_setup_pr(link: dict) -> dict | None:
    """An earlier setup PR still open → {"url", "number"}, so a second click doesn't open another."""
    if link["provider"] == "gitlab":
        mrs = _api("GET", f"{_base(link)}/merge_requests?state=opened&per_page=100", link["access_token"])
        return next(({"url": m["web_url"], "number": m["iid"]} for m in mrs
                     if m.get("source_branch", "").startswith(BRANCH_PREFIX)), None)
    if link["provider"] == "bitbucket":
        prs = _api("GET", f"{_base(link)}/pullrequests?state=OPEN&pagelen=50", link["access_token"])
        return next(({"url": p["links"]["html"]["href"], "number": p["id"]} for p in prs.get("values", [])
                     if p["source"]["branch"]["name"].startswith(BRANCH_PREFIX)), None)
    owner, repo = _parse_github_repo(link["repo_url"])
    pulls = _gh("GET", f"/repos/{owner}/{repo}/pulls?state=open&per_page=100", link["access_token"])
    for p in pulls:
        if p.get("head", {}).get("ref", "").startswith(BRANCH_PREFIX):
            return {"url": p["html_url"], "number": p["number"]}
    return None


def _set_variable(link: dict, key: str, value: str) -> None:
    """A hidden CI variable (GitLab masked / Bitbucket secured), created or replaced."""
    base, token = _base(link), link["access_token"]
    if link["provider"] == "gitlab":
        body = {"key": key, "value": value, "masked": True, "protected": False}
        try:
            _api("PUT", f"{base}/variables/{key}", token, body)
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            _api("POST", f"{base}/variables", token, body)
        return
    existing = _api("GET", f"{base}/pipelines_config/variables/?pagelen=100", token).get("values", [])
    uuid = next((v["uuid"] for v in existing if v.get("key") == key), None)
    body = {"key": key, "value": value, "secured": True}
    if uuid:
        _api("PUT", f"{base}/pipelines_config/variables/{urllib.parse.quote(uuid)}", token, body)
    else:
        _api("POST", f"{base}/pipelines_config/variables/", token, body)


def save_secret(link: dict, api_key: str) -> None:
    if link["provider"] != "github":
        try:
            if link["provider"] == "bitbucket":   # pipelines are off on a new Bitbucket repo
                _api("PUT", f"{_base(link)}/pipelines_config", link["access_token"], {"enabled": True})
            _set_variable(link, SECRET, api_key)
            _set_variable(link, REPO_TOKEN, link["access_token"])   # lets the check comment on the PR
        except urllib.error.HTTPError as e:
            need = ("Maintainer role and the \"api\" scope" if link["provider"] == "gitlab" else
                    "\"Repositories: Admin\", \"Pipelines: Edit variables\" and \"Pull requests: Write\" permissions")
            raise SetupError(f"{PROVIDER_NAMES[link['provider']]} refused to save the CI variables ({e.code}). "
                             f"The repo's access token needs the {need}.") from e
        return
    owner, repo = _parse_github_repo(link["repo_url"])
    token = link["access_token"]
    try:
        pk = _gh("GET", f"/repos/{owner}/{repo}/actions/secrets/public-key", token)
        _gh("PUT", f"/repos/{owner}/{repo}/actions/secrets/{SECRET}", token,
            {"encrypted_value": _sealed(pk["key"], api_key), "key_id": pk["key_id"]})
    except urllib.error.HTTPError as e:
        raise SetupError(
            f"GitHub refused to save the secret ({e.code}). The repo's access token needs "
            "the \"Secrets: read and write\" permission (classic token: repo scope)."
        ) from e


def _commit_ci_file(link: dict, api_url: str, branch: str) -> None:
    """GitLab / Bitbucket: one commit on a new `branch` adding (or replacing our own) CI file.
    Both providers create the branch in the same call, so a refusal leaves nothing behind."""
    path, token, base = CI_PATHS[link["provider"]], link["access_token"], link["default_branch"] or "main"
    current = _ci_file(link)
    if current is not None and not current.startswith(HEADER):
        # ponytail: refuses instead of merging into the repo's own pipeline; merge the YAML if customers need it
        raise SetupError(f"This repo already has its own {path}. ADA won't overwrite your pipeline — "
                         f"add the ADA job to it by hand (copy it from a repo without a {path}).")
    message = "Add ADA accessibility check for pull requests"
    try:
        if link["provider"] == "gitlab":
            _api("POST", f"{_base(link)}/repository/commits", token, {
                "branch": branch, "start_branch": base, "commit_message": message,
                "actions": [{"action": "update" if current is not None else "create",
                             "file_path": path, "content": ci_yaml(link, api_url)}]})
        else:
            _api("POST", f"{_base(link)}/src", token, form={path: ci_yaml(link, api_url), "message": message,
                                                              "branch": branch})
    except urllib.error.HTTPError as e:
        raise SetupError(f"{PROVIDER_NAMES[link['provider']]} refused to add {path} ({e.code}). "
                         "The repo's access token needs write access to the repository.") from e


def open_workflow_pr(link: dict, api_url: str) -> dict:
    token, base = link["access_token"], link["default_branch"] or "main"
    branch = f"{BRANCH_PREFIX}-{time.strftime('%Y%m%d%H%M%S')}"
    if link["provider"] == "github":
        _commit_workflow(link, api_url, branch)
    else:
        _commit_ci_file(link, api_url, branch)
    where = {"github": "repository secret", "gitlab": "CI/CD variable"}.get(link["provider"], "repository variable")
    body = (
        "Turns on the **ADA accessibility check** for every pull request.\n\n"
        f"- Scans the pages under `urls` and compares them with the live site ({link['site_url']}).\n"
        "- **Only issues a PR adds fail the check** — issues already live are listed but don't block.\n"
        f"- The API key is already saved as the {where} `{SECRET}`.\n\n"
        "**Before merging:** set `urls` to where a PR's version of the site runs (preview or staging). "
        "Until then the check scans the live site and always passes.\n\n---\nOpened by ADA Tool."
    )
    pr = create_pull_request(link["repo_url"], token, branch, base,
                             "Add ADA accessibility check (fails only on new issues)", body, link["provider"])
    if not pr:
        raise SetupError(f"The setup branch was pushed but {PROVIDER_NAMES[link['provider']]} didn't open "
                         "the pull request — try again.")
    return pr


def _commit_workflow(link: dict, api_url: str, branch: str) -> None:
    owner, repo = _parse_github_repo(link["repo_url"])
    token, base = link["access_token"], link["default_branch"] or "main"
    sha = _gh("GET", f"/repos/{owner}/{repo}/git/ref/heads/{base}", token)["object"]["sha"]
    _gh("POST", f"/repos/{owner}/{repo}/git/refs", token, {"ref": f"refs/heads/{branch}", "sha": sha})
    try:
        put = {
            "message": "Add ADA accessibility check for pull requests",
            "content": base64.b64encode(workflow_yaml(api_url, link["site_url"]).encode()).decode(),
            "branch": branch,
        }
        try:   # a workflow already there is replaced, so the PR shows the diff
            put["sha"] = _gh("GET", f"/repos/{owner}/{repo}/contents/{WORKFLOW_PATH}?ref={branch}", token)["sha"]
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
        _gh("PUT", f"/repos/{owner}/{repo}/contents/{WORKFLOW_PATH}", token, put)
    except urllib.error.HTTPError as e:
        try:   # don't leave an empty setup branch behind
            _gh("DELETE", f"/repos/{owner}/{repo}/git/refs/heads/{branch}", token)
        except Exception:
            pass
        raise SetupError(
            f"GitHub refused to add the workflow file ({e.code}). The repo's access token needs "
            "\"Contents\" and \"Workflows\" write permission (classic token: repo + workflow scopes)."
        ) from e
