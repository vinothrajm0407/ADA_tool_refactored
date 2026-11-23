"""Proof for an Auto-Fix: before/after screenshots of the fixed element plus
what a screen reader announces for it, captured after the re-scan.

Before = the live page as scanned; after = the built preview of the patched
repo. The screen-reader text comes from Chromium's accessibility tree (the
same name/role/state NVDA/VoiceOver/JAWS read out), not from running one.
"""
import base64
import logging
import re

logger = logging.getLogger(__name__)

# Page-wide fixes have no axe node target — show the element the fix added.
PAGE_WIDE_SELECTORS = {
    "page-has-heading-one": "h1",
    "landmark-one-main": "main, [role=main]",
    "landmark-unique": "nav, [role=navigation]",
    "bypass": "a[href^='#']",
}
# Marker drawn as an overlay (not by restyling the element) so it shows even
# for 1px / visually-hidden elements, with a label naming the rule.
_MARK_JS = """(el, [color, label]) => {
  const r = el.getBoundingClientRect();
  const st = getComputedStyle(el);
  const invisible = r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.opacity === '0';
  const w = Math.max(r.width, 24), h = Math.max(r.height, 24);
  const x = r.left + scrollX - (w - r.width) / 2 - 5, y = r.top + scrollY - (h - r.height) / 2 - 5;
  const box = document.createElement('div');
  box.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w + 10}px;height:${h + 10}px;` +
    `border:3px solid ${color};border-radius:4px;box-shadow:0 0 0 4px ${color}55;box-sizing:border-box;` +
    `z-index:2147483647;pointer-events:none;`;
  const tag = document.createElement('div');
  tag.textContent = label + (invisible ? ' (element is invisible on screen)' : '');
  tag.style.cssText = `position:absolute;left:${Math.max(x, 0)}px;top:${Math.max(y - 26, 0)}px;background:${color};` +
    `color:#fff;font:600 12px/1.5 system-ui,sans-serif;padding:2px 8px;border-radius:4px;white-space:nowrap;` +
    `z-index:2147483647;pointer-events:none;`;
  document.body.append(box, tag);
}"""
_PAD = 160            # px of page kept around the element
_MIN_CLIP = (800, 450)  # never crop tighter than this, so the surrounding page is recognisable
MAX_BATCH_PROOFS = 5  # ponytail: proof for first 5 elements of a batch, raise if PRs need all


def announce(aria_snapshot: str | None) -> str:
    """Playwright aria_snapshot's first line ('- button "Close" [pressed]: x')
    → what a screen reader says ('"Close", button, pressed')."""
    line = (aria_snapshot or "").strip().splitlines()[0:1]
    if not line:
        return "Nothing — the element is hidden from screen readers"
    m = re.match(r'-\s*([\w-]+)(?:\s+"((?:[^"\\]|\\.)*)")?((?:\s*\[[^\]]+\])*)\s*:?\s*(.*)$', line[0].strip())
    if not m:
        return line[0].lstrip("- ").strip()
    role, name, states, text = m.groups()
    states = [s.replace("=", " ") for s in re.findall(r"\[([^\]]+)\]", states or "")]
    if role in ("paragraph", "text", "generic") and not name:
        return f'"{text.strip()}"' if text.strip() else "Nothing (no text)"
    if role == "img" and not name:
        return "image — no name (screen reader may read the file name or skip it)"
    if not name and text.strip() and not text.strip().startswith("-"):
        return ", ".join([f'"{text.strip()}", {role}', *states])  # text content is what's read, e.g. "Owner", term
    label = f'"{name}", {role}' if name else f"{role} — no accessible name"
    return ", ".join([label, *states])


def _shot(page, loc, color: str, label: str) -> str | None:
    """JPEG of the element marked with a labelled box, with page context around it;
    the whole viewport when the element has no box (display:none)."""
    clip = None
    try:
        loc.scroll_into_view_if_needed(timeout=3000)
        loc.evaluate(_MARK_JS, [color, label])
        box = loc.bounding_box()
        vp = page.viewport_size or {"width": 1280, "height": 800}
        if box:
            w = min(max(box["width"] + 2 * _PAD, _MIN_CLIP[0]), vp["width"])
            h = min(max(box["height"] + 2 * _PAD, _MIN_CLIP[1]), vp["height"])
            cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            clip = {"x": min(max(cx - w / 2, 0), vp["width"] - w),
                    "y": min(max(cy - h / 2, 0), vp["height"] - h), "width": w, "height": h}
    except Exception:
        pass
    try:
        return base64.b64encode(page.screenshot(type="jpeg", quality=80, clip=clip, timeout=5000)).decode("ascii")
    except Exception:
        return None


def _capture(context, url: str, selector: str | None, rule_id: str, color: str, label: str) -> dict:
    page = context.new_page()
    try:
        resp = page.goto(url, wait_until="networkidle", timeout=20000)
        if resp and resp.status >= 400:
            return {"screenshot": None, "announce": f"Page returned HTTP {resp.status}"}
        if rule_id == "document-title":
            title = page.title().strip()
            return {"screenshot": _shot(page, page.locator("body"), color, label),
                    "announce": f'Page title: "{title}"' if title else "No page title — the screen reader announces the URL"}
        loc = page.locator(selector).first if selector else None
        if not loc or loc.count() == 0:
            return {"screenshot": _shot(page, page.locator("body"), color, label),
                    "announce": "Element not on this page" if selector else ""}
        spoken = _announce_element(page, loc)
        return {"screenshot": _shot(page, loc, color, label), "announce": spoken}
    finally:
        page.close()


_ROLE_WORDS = {
    "PluginObject": "embedded object", "DescriptionList": "description list", "textbox": "edit text",
    "listitem": "list item", "generic": "plain text", "StaticText": "text", "img": "image",
}
# Controls/media a screen reader can only identify by name. Containers (lists etc.) don't need one.
_NEEDS_NAME = {"button", "link", "textbox", "image", "img", "checkbox", "radio", "combobox", "listbox",
               "menuitem", "tab", "switch", "slider", "spinbutton", "searchbox", "PluginObject", "Iframe"}


def _role_word(role: str) -> str:
    return _ROLE_WORDS.get(role, role)


def describe_ax(role: str, name: str, ignored: bool, children: list[tuple[str, str]]) -> str:
    """What a screen reader says for one element, from Chromium's accessibility
    tree. `children` = (role, text) of its content, used for containers."""
    if ignored or role in ("none", "presentation"):
        return "Nothing — the element is hidden from screen readers"
    if name:
        return f'"{name}", {_role_word(role)}'
    if role in _NEEDS_NAME:
        return f'{_role_word(role)} — no name (a screen reader just says "{_role_word(role)}")'
    if children:
        items = ", ".join(f'"{t}" ({_role_word(r)})' for r, t in children[:4])
        return f"{_role_word(role)}: {items}" + (" …" if len(children) > 4 else "")
    return _role_word(role)


def _snapshot_children(snapshot: str) -> list[tuple[str, str]]:
    out = []
    for line in snapshot.splitlines():
        m = re.match(r'\s*-\s*([\w-]+)(?:\s+"([^"]*)")?[^:]*:\s*(.+)$', line)
        if m and m.group(1) not in ("list", "/url") and (m.group(2) or m.group(3)).strip():
            out.append((m.group(1), (m.group(2) or m.group(3)).strip()))
    return out


def _announce_element(page, loc) -> str:
    """Role/name/hidden from the browser's real accessibility tree (CDP) — the
    quick aria snapshot skips <object> and reports a <dl> by its first child.
    Falls back to the snapshot when CDP can't reach the element (e.g. iframes)."""
    try:
        snapshot = loc.aria_snapshot(timeout=3000)
    except Exception:
        snapshot = ""
    try:
        loc.evaluate("e => e.setAttribute('data-ada-proof', '1')")
        cdp = page.context.new_cdp_session(page)
        try:
            oid = cdp.send("Runtime.evaluate", {"expression": "document.querySelector('[data-ada-proof]')"})["result"]["objectId"]
            node = cdp.send("Accessibility.getPartialAXTree", {"objectId": oid, "fetchRelatives": False})["nodes"][0]
        finally:
            cdp.detach()
            loc.evaluate("e => e.removeAttribute('data-ada-proof')")
        return describe_ax(node.get("role", {}).get("value", ""), (node.get("name", {}).get("value") or "").strip(),
                           bool(node.get("ignored")), _snapshot_children(snapshot))
    except Exception:
        return announce(snapshot)


def wcag_criteria(tags) -> list[str]:
    """axe tags -> WCAG success criteria: 'wcag111' -> '1.1.1', 'wcag1410' -> '1.4.10'."""
    return [f"{m[1]}.{m[2]}.{m[3]}" for m in (re.match(r"^wcag(\d)(\d)(\d{1,2})$", t) for t in tags or []) if m]


def issue_text(node: dict | None) -> str:
    """axe's failureSummary without its 'Fix any of the following:' headers."""
    lines = [l.strip() for l in ((node or {}).get("failureSummary") or "").splitlines()]
    return "; ".join(l for l in lines if l and not re.match(r"Fix (any|all) of the following", l))


def capture_proof(page_url: str, after_url: str, rule: dict, node: dict | None) -> dict | None:
    """Before (live page_url) and after (the same page on the patched preview)
    for one element. Never raises — a failed capture must not fail a fix that
    already verified."""
    from playwright.sync_api import sync_playwright
    from scripts.run_ada_check_python import BROWSER_ARGS, _selector_from_node_target

    rule_id = rule.get("id") or ""
    selector = _selector_from_node_target((node or {}).get("target")) if (node or {}).get("html")         else PAGE_WIDE_SELECTORS.get(rule_id)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=BROWSER_ARGS)
            try:
                ctx = browser.new_context(viewport={"width": 1280, "height": 800})
                try:
                    before = _capture(ctx, page_url, selector, rule_id, "#dc2626", f"Issue: {rule_id}")
                except Exception as e:
                    logger.warning("Proof: before capture failed for %s: %s", page_url, e)
                    before = {"screenshot": None, "announce": "Live page could not be loaded"}
                after = _capture(ctx, after_url, selector, rule_id, "#16a34a", f"Fixed: {rule_id}")
            finally:
                browser.close()
    except Exception as e:
        logger.warning("Proof capture failed: %s", e)
        return None
    return {
        "rule_id": rule_id,
        "impact": rule.get("impact") or "",
        "wcag": wcag_criteria(rule.get("tags")),
        "help": rule.get("help") or "",
        "issue": issue_text(node),
        "selector": selector or "",
        "element_html": ((node or {}).get("html") or "")[:400],
        "before_url": page_url,
        "after_url": after_url,
        "before_screenshot": before.get("screenshot"),
        "after_screenshot": after.get("screenshot"),
        "before_announce": before.get("announce") or "",
        "after_announce": after.get("announce") or "",
        "rescan": f"Re-scanned the patched build: `{rule_id}` is no longer reported.",
    }


# ── PR attachment ─────────────────────────────────────────────────────────────

def _raw_url(provider: str, repo_path: str, branch: str, file: str) -> str:
    if provider == "gitlab":
        return f"https://gitlab.com/{repo_path}/-/raw/{branch}/{file}"
    if provider == "bitbucket":
        return f"https://bitbucket.org/{repo_path}/raw/{branch}/{file}"
    if provider == "azure":
        org, project, repo = repo_path.split("/")
        return (f"https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/items"
                f"?path=/{file}&versionDescriptor.version={branch}&$format=octetStream&api-version=7.0")
    return f"https://github.com/{repo_path}/blob/{branch}/{file}?raw=true"


def push_proof_branch(repo_dir, git, proofs: list[dict], fix_branch: str, provider: str, repo_path: str | None) -> bool:
    """Screenshots go on a side branch that is never merged, so the PR can embed
    them (GitHub has no image-upload API) without adding PNGs to the codebase.
    `git(*args, extra_headers=)` is push_branch's runner. Sets each proof's
    before_img/after_img url in place; returns False if nothing was pushed."""
    if not repo_path or not any(p.get("before_screenshot") or p.get("after_screenshot") for p in proofs):
        return False
    branch = "ada-proof-" + re.sub(r"[^\w.-]+", "-", fix_branch.removeprefix("ada/fix/"))
    git("checkout", "--orphan", branch)
    git("rm", "-rf", "-q", "--ignore-unmatch", ".")
    files = []
    for i, p in enumerate(proofs, 1):
        for side in ("before", "after"):
            b64 = p.get(f"{side}_screenshot")
            if b64:
                name = f"{side}-{i}.jpg"
                (repo_dir / name).write_bytes(base64.b64decode(b64))
                files.append(name)
                p[f"{side}_img"] = _raw_url(provider, repo_path, branch, name)
    git("add", *files)
    git("commit", "-m", f"ADA Auto-Fix proof screenshots for {fix_branch} (do not merge)")
    git("push", "origin", branch, extra_headers=True)
    return True


def pr_markdown(proofs: list[dict]) -> str:
    """'Proof' section for the PR body. Empty when nothing was captured."""
    proofs = [p for p in proofs if p]
    if not proofs:
        return ""
    out = ["### Proof — re-scanned after the fix", ""]
    for i, p in enumerate(proofs, 1):
        if len(proofs) > 1:
            out.append(f"#### Element {i}")
        out.append(f"**Issue found:** {_md(p.get('help'))}" + (f" — {_md(p.get('issue'))}" if p.get("issue") else ""))
        out += [f"**Exact spot:** `{p.get('selector', '')}` on {p.get('before_url', '')}", ""]
        def img(side):
            url = p.get(f"{side}_img")
            return f"![{side}]({url})" if url else "_screenshot unavailable_"
        out += [
            "| | Before | After |",
            "|---|---|---|",
            f"| Screenshot | {img('before')} | {img('after')} |",
            f"| Screen reader announces | {_md(p.get('before_announce'))} | {_md(p.get('after_announce'))} |",
            "",
            f"{p.get('rescan', '')} Before: live site · After: patched build of the same page. "
            "Red box = the failing element, green box = the same element after the fix.",
            "",
        ]
    out.append("_Screen-reader text is read from the browser's accessibility tree (name, role, state) — "
               "what NVDA, JAWS and VoiceOver announce for this element._")
    return "\n".join(out) + "\n"


def _md(text) -> str:
    return (str(text or "—")).replace("|", "\\|").replace("\n", " ")
