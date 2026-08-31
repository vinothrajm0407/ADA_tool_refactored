"""
Auto-Fix orchestration — locates the real source behind an accessibility
violation, asks Claude for a minimal patch, applies it in a throwaway clone,
builds it, re-scans the built page to verify the violation is gone, and
pushes a branch with the verified fix.

Scope (MVP): one rule (button-name), one node, synchronous.
"""
import base64
import json
import logging
import os
import platform
import re
import shutil
import stat
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from contextlib import contextmanager
from pathlib import Path
from queue import Empty, Queue

from config import Config

logger = logging.getLogger(__name__)

_GIT_TIMEOUT = 60
_NPM_INSTALL_TIMEOUT = 180
_NPM_BUILD_TIMEOUT = 120
_PREVIEW_START_TIMEOUT = 20

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")

# On Windows, npm/npx are .cmd shims — subprocess won't resolve them without
# shell=True unless given the resolved path, which shutil.which does correctly
# on every platform.
NPM_CMD = shutil.which("npm") or "npm"
NPX_CMD = shutil.which("npx") or "npx"


def _run(args: list[str], cwd: Path, timeout: int) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True, timeout=timeout)


def _rmtree_force(path: Path) -> None:
    """shutil.rmtree(ignore_errors=True) silently leaves git's read-only object files
    behind on Windows; clear the read-only bit and retry instead of leaking the temp dir."""
    def _on_error(func, target, exc_info):
        try:
            os.chmod(target, stat.S_IWRITE)
            func(target)
        except Exception:
            pass
    shutil.rmtree(path, onerror=_on_error)


def _kill_process_tree(proc: subprocess.Popen) -> None:
    """proc.terminate() only signals the immediate child — npx/vite/esbuild spawn
    grandchildren that survive it and leak. Kill the whole tree instead."""
    if platform.system() == "Windows":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                        capture_output=True, timeout=10)
    else:
        import signal
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:
            proc.kill()
    try:
        proc.wait(timeout=5)
    except Exception:
        pass


def _git_auth_header(token: str) -> str:
    """GitHub's git-over-HTTPS wants Basic auth, not the Bearer scheme its REST API uses."""
    basic = base64.b64encode(f"x-access-token:{token}".encode()).decode()
    return f"http.extraHeader=AUTHORIZATION: basic {basic}"


def _clone_repo(repo_url: str, token: str, branch: str) -> Path:
    tmp_dir = Path(tempfile.mkdtemp(prefix="ada_autofix_"))
    _run(
        ["git", "-c", _git_auth_header(token),
         "clone", "--depth", "1", "--branch", branch, repo_url, str(tmp_dir)],
        cwd=tmp_dir.parent, timeout=_GIT_TIMEOUT,
    )
    return tmp_dir


def locate_source(repo_dir: Path, node_html: str) -> tuple[str, int] | None:
    """Match a violation's outerHTML to a unique .jsx/.tsx file via its class name."""
    match = re.search(r'class="([^"]+)"', node_html or "")
    if not match:
        return None
    class_name = match.group(1).strip().split()[0]
    needle = f'className="{class_name}"'

    hits = []
    for path in repo_dir.rglob("*"):
        if path.suffix not in (".jsx", ".tsx") or "node_modules" in path.parts:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            continue
        if needle in text:
            hits.append(path)

    if len(hits) != 1:
        return None
    path = hits[0]
    text = path.read_text(encoding="utf-8")
    line_no = text[:text.index(needle)].count("\n") + 1
    return (str(path.relative_to(repo_dir)), line_no)


def _fallback_patch(rule: dict, node: dict, file_content: str) -> dict | None:
    """
    Deterministic placeholder fix used only when ANTHROPIC_API_KEY isn't configured —
    same idea as the existing /api/ai-fix mock fallback (app.py). Proves the rest of
    the pipeline works; the label itself is generic, not a real contextual one.
    """
    if rule.get("id") != "button-name":
        return None
    html = (node or {}).get("html", "")
    match = re.search(r'class="([^"]+)"', html)
    if not match:
        return None
    class_name = match.group(1).strip().split()[0]
    pattern = re.compile(r'<button([^>]*\bclassName="' + re.escape(class_name) + r'"[^>]*?)(/?)>')
    m = pattern.search(file_content)
    if not m or "aria-label" in m.group(1):
        return None
    before = m.group(0)
    attrs, self_close = m.group(1).rstrip(), m.group(2)
    after = f'<button{attrs} aria-label="Menu"' + (' ' if self_close else '') + f'{self_close}>'
    return {"before": before, "after": after}


def generate_patch(rule: dict, node: dict, file_content: str) -> dict | None:
    """Ask Claude for a verbatim before/after snippet. Returns None on any failure."""
    if not Config.ANTHROPIC_API_KEY:
        return _fallback_patch(rule, node, file_content)

    rule_id = rule.get("id", "unknown")
    prompt = f"""You are fixing a web accessibility violation in a React (JSX) source file.

Violation: {rule_id} — {rule.get("help", "")}
Details: {rule.get("description", "")}
The offending rendered HTML: {(node or {}).get("html", "")}

Here is the full source file content:
---
{file_content}
---

Find the exact JSX element responsible for this violation and provide a minimal fix (e.g. add an aria-label). Respond with ONLY valid JSON in this exact shape, no other text:
{{
  "before": "the exact original lines from the file above that need to change, copied character-for-character including whitespace",
  "after": "the corrected replacement for those exact lines"
}}

The "before" value MUST be an exact substring of the file content given above — copy it verbatim, do not paraphrase or reformat it."""

    payload = json.dumps({
        "model": Config.AI_SUMMARY_MODEL,
        "max_tokens": 800,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "x-api-key": Config.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
        text = result["content"][0]["text"].strip()
        patch = json.loads(text)
        if not patch.get("before") or not patch.get("after"):
            return None
        return {"before": patch["before"], "after": patch["after"]}
    except Exception:
        logger.exception("Auto-fix patch generation failed")
        return None


def validate_patch(file_content: str, before: str, after: str) -> bool:
    return (
        bool(before) and bool(after)
        and file_content.count(before) == 1
        and after != before
        and len(after) < len(before) + 500
    )


def run_tests(repo_dir: Path) -> dict:
    pkg_path = repo_dir / "package.json"
    try:
        pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
    except Exception:
        return {"ran": False}
    if not pkg.get("scripts", {}).get("test"):
        return {"ran": False}
    try:
        proc = subprocess.run(
            [NPM_CMD, "test", "--silent"], cwd=repo_dir,
            capture_output=True, text=True, timeout=120,
        )
        return {"ran": True, "passed": proc.returncode == 0, "output": (proc.stdout + proc.stderr)[-2000:]}
    except Exception as e:
        return {"ran": True, "passed": False, "output": str(e)}


@contextmanager
def build_and_preview(repo_dir: Path):
    """npm install + build, then serve dist/ via `vite preview` and yield its URL."""
    _run([NPM_CMD, "install", "--silent"], cwd=repo_dir, timeout=_NPM_INSTALL_TIMEOUT)
    _run([NPM_CMD, "run", "build", "--silent"], cwd=repo_dir, timeout=_NPM_BUILD_TIMEOUT)

    proc = subprocess.Popen(
        [NPX_CMD, "vite", "preview", "--port", "0", "--strictPort"],
        cwd=repo_dir, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
        start_new_session=(platform.system() != "Windows"),
    )
    # proc.stdout.readline() blocks with no timeout of its own, so a deadline check
    # between calls can't actually bound the wait — read on a background thread and
    # pull lines through a queue, which DOES support a real timeout.
    line_queue: "Queue[str | None]" = Queue()

    def _pump():
        for line in iter(proc.stdout.readline, ""):
            line_queue.put(line)
        line_queue.put(None)

    reader = threading.Thread(target=_pump, daemon=True)
    reader.start()

    preview_url = None
    try:
        deadline = time.time() + _PREVIEW_START_TIMEOUT
        while time.time() < deadline:
            try:
                line = line_queue.get(timeout=max(0.1, deadline - time.time()))
            except Empty:
                break
            if line is None:
                break
            match = re.search(r"(https?://localhost:\d+\S*)", _ANSI_RE.sub("", line))
            if match:
                preview_url = match.group(1)
                break
        if not preview_url:
            raise RuntimeError("vite preview did not report a URL in time")
        yield preview_url
    finally:
        _kill_process_tree(proc)


def rescan_and_verify(preview_url: str, rule_id: str) -> bool:
    from services.url_processor import process_url
    result = process_url(preview_url, write_output=False)
    violations = result.get("axeResult", {}).get("violations", [])
    return not any(v.get("id") == rule_id for v in violations)


def push_branch(repo_dir: Path, branch_name: str, token: str, commit_message: str, repo_url: str) -> str:
    def git(*args, extra_headers=False):
        base = ["git"]
        if extra_headers:
            base += ["-c", _git_auth_header(token)]
        base += ["-c", "user.email=ada-bot@ada-tool.local", "-c", "user.name=ADA Auto-Fix"]
        _run(base + list(args), cwd=repo_dir, timeout=_GIT_TIMEOUT)

    git("checkout", "-b", branch_name)
    git("add", "-A")
    git("commit", "-m", commit_message)
    git("push", "origin", branch_name, extra_headers=True)

    match = re.match(r"https://github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?/?$", repo_url)
    if match:
        owner, repo = match.groups()
        return f"https://github.com/{owner}/{repo}/tree/{branch_name}"
    return branch_name


def run_auto_fix(link: dict, page_url: str, rule: dict, node: dict) -> dict:
    """Runs the full pipeline. `link` is a RepoLink dict from db.get_repo_link_by_domain."""
    steps: list[dict] = []

    def step(name: str, ok: bool, detail: str = ""):
        steps.append({"name": name, "ok": ok, "detail": detail})

    repo_dir = None
    try:
        repo_dir = _clone_repo(link["repo_url"], link["access_token"], link["default_branch"])
        step("Clone repo", True)

        located = locate_source(repo_dir, (node or {}).get("html", ""))
        if not located:
            step("Locate source", False, "Could not uniquely match this violation to a source file")
            return {"status": "failed", "steps": steps, "error": steps[-1]["detail"]}
        file_path, line_no = located
        step("Locate source", True, f"{file_path}:{line_no}")

        full_path = repo_dir / file_path
        file_content = full_path.read_text(encoding="utf-8")

        patch = generate_patch(rule, node, file_content)
        if not patch:
            if not Config.ANTHROPIC_API_KEY and rule.get("id") != "button-name":
                detail = "No ANTHROPIC_API_KEY configured — only button-name has a built-in fallback fix without one"
            else:
                detail = "Claude did not return a usable patch for this violation"
            step("Generate fix", False, detail)
            return {"status": "failed", "steps": steps, "error": steps[-1]["detail"]}
        step("Generate fix", True)

        if not validate_patch(file_content, patch["before"], patch["after"]):
            step("Validate patch", False, "Patch did not validate against the source file")
            return {"status": "failed", "steps": steps, "error": steps[-1]["detail"]}
        step("Validate patch", True)
        full_path.write_text(file_content.replace(patch["before"], patch["after"], 1), encoding="utf-8")

        test_result = run_tests(repo_dir)
        if test_result.get("ran") and not test_result.get("passed"):
            step("Run tests", False, "Existing tests failed after the patch")
            return {"status": "failed", "steps": steps, "error": steps[-1]["detail"]}
        step("Run tests", True, "no tests defined" if not test_result.get("ran") else "passed")

        try:
            with build_and_preview(repo_dir) as preview_url:
                step("Build", True)
                verified = rescan_and_verify(preview_url, rule.get("id", ""))
        except subprocess.CalledProcessError as e:
            step("Build", False, (e.stderr or str(e))[-500:])
            return {"status": "failed", "steps": steps, "error": "Build failed"}
        except Exception as e:
            step("Build", False, str(e))
            return {"status": "failed", "steps": steps, "error": "Build or re-scan failed"}

        if not verified:
            step("Re-scan", False, "Violation still present after the fix")
            return {"status": "failed", "steps": steps, "error": steps[-1]["detail"]}
        step("Re-scan", True, "violation resolved")

        rule_id = rule.get("id", "fix")
        branch_name = f"ada/fix/{rule_id}-{uuid.uuid4().hex[:8]}"
        branch_url = push_branch(
            repo_dir, branch_name, link["access_token"],
            f"ADA Auto-Fix: {rule.get('help', rule_id)}", link["repo_url"],
        )
        step("Push branch", True, branch_url)
        return {"status": "verified", "steps": steps, "branch_url": branch_url}

    except subprocess.CalledProcessError as e:
        logger.exception("Auto-fix subprocess failed")
        step("Pipeline", False, (e.stderr or str(e))[-500:])
        return {"status": "failed", "steps": steps, "error": "A build/git step failed"}
    except Exception as e:
        logger.exception("Auto-fix failed")
        step("Pipeline", False, str(e))
        return {"status": "failed", "steps": steps, "error": str(e)}
    finally:
        if repo_dir and repo_dir.exists():
            _rmtree_force(repo_dir)
