"""approve_pull_request: a real git-provider approval as the Approver's account."""
import io
import json
import urllib.error
from unittest.mock import patch

from backend.services.auto_fix_service import approve_pull_request

REPO = "https://github.com/acme/site"


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _http_error(code, message):
    return urllib.error.HTTPError(REPO, code, "err", {}, io.BytesIO(json.dumps({"message": message}).encode()))


def test_github_review_is_an_approve_event_with_the_note():
    with patch("urllib.request.urlopen", return_value=_Resp(b"{}")) as op:
        assert approve_pull_request(REPO, "tok", 5, "github", "Approved by Vinoth") == (True, "")
    req = op.call_args[0][0]
    assert req.full_url == "https://api.github.com/repos/acme/site/pulls/5/reviews" and req.get_method() == "POST"
    assert json.loads(req.data) == {"event": "APPROVE", "body": "Approved by Vinoth"}
    assert req.headers["Authorization"] == "Bearer tok"


def test_own_pull_request_is_reported_not_raised():
    err = _http_error(422, "Unprocessable Entity: Can not approve your own pull request")
    with patch("urllib.request.urlopen", side_effect=err):
        assert approve_pull_request(REPO, "tok", 5, "github") == (False, "own_pr")
    with patch("urllib.request.urlopen", side_effect=_http_error(403, "Resource not accessible")):
        assert approve_pull_request(REPO, "tok", 5, "github") == (False, "HTTP 403")
