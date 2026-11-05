"""
RQ task: BFS site crawl with per-page axe accessibility scan.
One Playwright browser is opened for the entire crawl session.
"""
import json
import logging
import os
import tempfile
import re
import threading
import time
from urllib.parse import urlsplit
from collections import deque
from datetime import datetime, timezone

from config import Config
from services import db
from services.crawler import get_root_domain, normalize_url, extract_internal_links
from scripts.run_ada_check_python import (
    BROWSER_ARGS, bot_challenge_reason, can_ask_person, page_title_and_html, scanner_user_agent,
    wait_for_person_to_verify,
)

# Import in-memory helpers — no circular import because crawl_service only
# imports crawl_task inside a function body (not at module level).
from backend.services.crawl_service import (
    inmemory_update_crawl,
    inmemory_append_page,
    inmemory_update_page,
    inmemory_get_status,
)

logger = logging.getLogger(__name__)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _aggregate_crawl_violations(crawl_id: str, max_pages: int = 60) -> list[dict]:
    """
    Tally violations by rule id across every scanned page in the crawl, for the
    full-detail Slack/Teams report. Reads each page's stored axe result (already
    persisted by save_scan_history during the crawl) rather than re-scanning.
    Best-effort: any DB error here must not break crawl completion.
    """
    tally: dict[str, dict] = {}
    try:
        pages = db.get_crawl_pages(crawl_id)[:max_pages]
        for page in pages:
            try:
                result = db.get_crawl_page_result(crawl_id, page["id"])
            except Exception:
                continue
            for v in ((result or {}).get("axeResult") or {}).get("violations") or []:
                rule_id = v.get("id", "")
                if not rule_id:
                    continue
                entry = tally.setdefault(rule_id, {
                    "rule_id": rule_id,
                    "impact": v.get("impact"),
                    "description": v.get("description") or v.get("help"),
                    "wcag_tags": [t for t in (v.get("tags") or []) if t.startswith("wcag")],
                    "help_url": v.get("helpUrl"),
                    "affected_count": 0,
                    "pages_affected": 0,
                    "example_selector": None,
                })
                entry["affected_count"] += len(v.get("nodes") or [])
                entry["pages_affected"] += 1
                if not entry["example_selector"]:
                    entry["example_selector"] = (((v.get("nodes") or [{}])[0]).get("target") or [None])[0]
    except Exception:
        logger.exception("Failed to aggregate crawl violations for %s", crawl_id)
    return sorted(tally.values(), key=lambda e: e["affected_count"], reverse=True)


def _duration(started: str, ended: str) -> float | None:
    try:
        return (
            datetime.fromisoformat(ended.replace("Z", "+00:00"))
            - datetime.fromisoformat(started.replace("Z", "+00:00"))
        ).total_seconds()
    except Exception:
        return None


# Following one of these would end the logged-in session mid-crawl.
_LOGOUT_LINK = re.compile(r"log[-_]?out|sign[-_]?out|log[-_]?off|sign[-_]?off", re.I)
# Paths that usually sit behind a login. On a login crawl they are scanned
# first. ponytail: a name heuristic; pages are still classified by actually
# opening them signed out (_needs_login), this only changes the order.
_MEMBERS_LINK = re.compile(
    r"account|profile|dashboard|settings|preferences|orders?\b|wishlist|subscriptions?|billing|"
    r"addresses|membership|/my[-_]?|/your[-_]?|buyagain|mycd|/user/|/me\b", re.I)
_PASSWORD_BOX = "input[type=password]"
# Strongest hint first; a plain text box is the last resort.
_USERNAME_BOXES = [
    "input[autocomplete=username]", "input[type=email]", "input[name*=user i]", "input[id*=user i]",
    "input[name*=email i]", "input[id*=email i]", "input[name*=login i]", "input[id*=login i]",
    "input[placeholder*=email i]", "input[placeholder*=user i]", "input[type=tel]", "input[name*=phone i]",
    "input[name*=mobile i]", "input[placeholder*=phone i]", "input[placeholder*=mobile i]", "input[type=text]",
]
# The nearest text-like box before the password box: its username box.
_BOX_BEFORE = "xpath=preceding::input[not(@type) or @type='text' or @type='email' or @type='tel'][1]"
_SUBMIT = "button[type=submit], input[type=submit]"
# Patterns given to get_by_role reach the browser as /…/i: write "/" as "\/".
_SIGN_IN = re.compile(r"^\s*((sign\s*-?\s*up|register)\s*(\/|or|&|\|)\s*)?((sign|log)\s*-?\s*in|login)(\s*(\/|or|&|\|)\s*(sign\s*-?\s*up|register|create account))?\s*$"
                      r"|^\s*my account\s*$", re.I)
# A step before the form: "Continue with email", "Use password instead"...
_EMAIL_STEP = re.compile(r"(continue|sign in|log in|login) with (email|password|username)|use (email|password)"
                         r"|(email|password) instead", re.I)
# Popups in front of the page: "Download our app", newsletter, offers.
_POPUP_CLOSE = re.compile(r"^\s*(×|✕|✖|x|close|no,? thanks|not now|maybe later|skip|dismiss|continue shopping)\s*$", re.I)
_SUBMIT_TEXT = re.compile(r"^\s*((sign|log)\s*-?\s*in|submit|continue|next)\s*$", re.I)
_COOKIE_OK = re.compile(r"^\s*(accept( all)?( cookies)?|allow all( cookies)?|i agree|agree|got it)\s*$", re.I)
_SSO = re.compile(r"(continue|sign in|log in) with (google|microsoft|apple|facebook|github|sso)", re.I)
# A box a person could actually type in. Some login pages put an off-screen,
# aria-hidden decoy password box ahead of the real one (oattravel.com does);
# a search box is never the username. (Some real boxes are read-only until
# clicked, to stop autofill — so _type clicks first.)
_ON_SCREEN = """e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e);
  return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && s.visibility !== 'hidden' && +s.opacity > 0 }"""
_USABLE = """e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e);
  return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && s.visibility !== 'hidden'
    && +s.opacity > 0 && e.tabIndex >= 0 && !e.disabled && !e.closest('[aria-hidden=true]')
    && !/search/i.test([e.type, e.name, e.id, e.placeholder, e.getAttribute('aria-label')].join(' ')) }"""


# The input boxes on screen, as "type|name|id|placeholder" — the login form's
# are recorded at sign-in to recognise that form if it shows up again.
_FORM_BOXES = """() => [...document.querySelectorAll('input:not([type=hidden])')]
  .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
  .map(e => [e.type, e.name, e.id, e.placeholder].join('|'))"""


def _usable(loc, check=_USABLE):
    for i in range(min(loc.count(), 20)):
        try:
            if loc.nth(i).evaluate(check):
                return loc.nth(i)
        except Exception:
            pass  # detached / navigating
    return None


def _find(page, selector, check=_USABLE):
    """First usable match in the page or any frame on it (embedded login forms)."""
    for frame in page.frames:
        try:
            if found := _usable(frame.locator(selector), check):
                return found
        except Exception:
            continue
    return None


def _click_role(page, name, roles=("button", "link"), tried=None) -> bool:
    """Click the first usable button/link with this name. `tried`: the texts
    of ones already clicked, skipped here and added to."""
    for role in roles:
        loc = page.get_by_role(role, name=name)
        for i in range(min(loc.count(), 20)):
            try:
                text = loc.nth(i).inner_text(timeout=2000).strip()
                if (tried and text in tried) or not loc.nth(i).evaluate(_USABLE):
                    continue
                loc.nth(i).click(timeout=5000)
                if tried is not None:
                    tried.append(text)
                return True
            except Exception:
                pass
    return False


def _type(box, text):
    box.click(timeout=5000)
    try:
        box.fill(text, timeout=5000)
    except Exception:  # still read-only after the click (slow page): unlock it, as the site's own focus handler would
        box.evaluate("e => e.removeAttribute('readonly')")
        box.fill(text, timeout=10000)


def _dismiss_popups(page):
    """Close what sits in front of the login page: cookie banners and popups
    ("Download our app", offers). Only while no login form shows, so the
    login popup itself is never closed."""
    if _find(page, _PASSWORD_BOX) or _first_username_box(page):
        return
    for _ in range(3):
        if not (_click_role(page, _COOKIE_OK, roles=("button",)) or _click_role(page, _POPUP_CLOSE, roles=("button",))
                or _click_role(page, re.compile(r"^\s*close\b", re.I), roles=("button",))):
            return
        page.wait_for_timeout(500)


def _first_username_box(page):
    for sel in _USERNAME_BOXES:
        if found := _find(page, sel):
            return found
    return None


def _wait_for_person_to_log_in(page, login_url, root_domain):
    """Done once the person is back on the site, off the login page, with no
    password box showing. 5 minutes to finish."""
    for _ in range(300):
        page.wait_for_timeout(1000)
        try:
            if (get_root_domain(page.url) == root_domain
                    and normalize_url(page.url) != normalize_url(login_url)
                    and not _find(page, _PASSWORD_BOX)):
                return
        except Exception:
            pass  # mid-navigation
    raise RuntimeError("Login not finished in the browser window within 5 minutes")


def _fill_login_form(page, login):
    """Headless sign-in: closes a cookie banner, opens the form when it sits
    behind a "Sign in" button, handles two-step forms (username, Next, then
    password) and forms inside frames."""
    user_sel, pass_sel = login.get("username_selector"), login.get("password_selector")
    find_pass = lambda: _find(page, pass_sel or _PASSWORD_BOX)
    _dismiss_popups(page)
    for _ in range(10):  # a slow site's script draws the form late (OrangeHRM)
        if find_pass() or user_sel or _first_username_box(page):
            break
        page.wait_for_timeout(1000)
    pass_box = find_pass()
    tried = []  # "Login" may only open a menu that holds the real "Sign Up / Login"
    while (len(tried) < 2 and not pass_box and not user_sel and not _first_username_box(page)
           and _click_role(page, _SIGN_IN, tried=tried)):
        _settle(page)  # the form opens in a popup or on a new page
        _click_role(page, _COOKIE_OK, roles=("button",))
        pass_box = find_pass()
    if not pass_box and not user_sel and not _first_username_box(page) and _click_role(page, _EMAIL_STEP):
        _settle(page)  # e.g. "Continue with email" reveals the form
        pass_box = find_pass()
    if not pass_box and not user_sel and (_usable(page.get_by_role("button", name=_SSO))
                                          or _usable(page.get_by_role("link", name=_SSO))):
        raise RuntimeError("Login failed: this site signs in with Google/Microsoft/SSO, which can't be done "
                           "automatically — turn on 'Use a visible browser', leave the password empty and sign in yourself")
    if user_sel:
        user_box = _find(page, user_sel)
    else:
        user_box = (pass_box and _usable(pass_box.locator(_BOX_BEFORE))) or _first_username_box(page)
    if not user_box and not pass_box:
        raise RuntimeError("Login failed: no login form found on the login page — check the login page URL, "
                           "or set the username and password field selectors")
    if user_box:
        _type(user_box, login.get("username") or "")
    if not pass_box:  # two-step: the password box shows after "Next"
        user_box.press("Enter")
        _settle(page)
        pass_box = find_pass()
        if not pass_box:
            raise RuntimeError("Login failed: no password box found — set the password field selector")
    form = page.evaluate(_FORM_BOXES)  # see _shows_login_page
    _type(pass_box, login.get("password") or "")
    pass_box.press("Enter")
    if not _login_form_gone(page, 6) and not _page_message(page):  # Enter didn't submit: click its button
        button = _usable(pass_box.locator("xpath=ancestor::form[1]").locator(_SUBMIT)) \
            or _usable(page.get_by_role("button", name=_SUBMIT_TEXT))
        if button:
            try:
                button.click(timeout=5000)
            except Exception:
                pass  # the form went away meanwhile
    if not _login_form_gone(page, 15):
        said = _page_message(page)
        raise RuntimeError("Login failed: still on the login page — "
                           + (f'the site says: "{said}"' if said else "check the username and password"))
    # Only a form whose password box was in the page itself (not a frame) can be recognised later.
    return form if any(b.startswith("password|") for b in form) else None


def _login_form_gone(page, seconds) -> bool:
    """Sign-in can take several seconds (oattravel.com does): wait for it. The
    form must stay gone for 3 checks in a row — while submitting, some sites
    hide it briefly and then show it again with "incorrect password"."""
    gone = 0
    for _ in range(seconds + 2):
        page.wait_for_timeout(1000)
        try:
            # On screen is enough: an error popup can mark the form aria-hidden.
            gone = 0 if _find(page, _PASSWORD_BOX, _ON_SCREEN) else gone + 1
        except Exception:
            gone = 0  # navigating
        if gone >= 3:
            return True
    return False


def _page_message(page) -> str:
    """The site's own error text after a failed sign-in, if it shows one."""
    try:
        return page.evaluate("""() => [...document.querySelectorAll('[role=alert], [aria-live], [class*=error i], [class*=invalid i]')]
            .filter(e => e.offsetParent).map(e => e.innerText.trim()).find(t => t && t.length < 200) || ''""")
    except Exception:
        return ""


def _log_in(login: dict, root_domain: str, assisted: bool, crawl_id: str = "login") -> dict:
    """Sign in once and return the session (cookies + local storage) for every
    crawl worker to reuse. With a username and password it runs headless.
    With the visible browser and no password, a person signs in by hand
    instead — for OTP, CAPTCHA or Microsoft/Google SSO. The password is only
    used here; it is never stored or logged."""
    from playwright.sync_api import sync_playwright
    login_url = login["url"]
    form = None
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not assisted, args=BROWSER_ARGS)
        context = browser.new_context(viewport={"width": 1920, "height": 1080}, ignore_https_errors=True,
                                      user_agent=scanner_user_agent(browser, headless=not assisted))
        page = context.new_page()
        try:
            try:
                response = page.goto(login_url, wait_until="domcontentloaded", timeout=45000)
            except Exception:  # slow site: carry on with what has loaded rather than give up
                response = None
            _settle(page)
            blocked = bot_challenge_reason(response.status if response else None, *page_title_and_html(page))
            if blocked and not (assisted and wait_for_person_to_verify(page)):
                raise RuntimeError(f"Login page: {blocked}")
            if assisted and not login.get("password"):
                _wait_for_person_to_log_in(page, login_url, root_domain)
            else:
                try:
                    form = _fill_login_form(page, login)
                except RuntimeError as exc:
                    if not assisted:
                        raise
                    # Visible window: a robot check, OTP or popup after submit is
                    # for the person at the screen. Wait for them to finish.
                    logger.info("Login needs the person | crawl_id=%s reason=%s", crawl_id, exc)
                    page.bring_to_front()
                    _wait_for_person_to_log_in(page, login_url, root_domain)
            logger.info("Login done | crawl_id=%s landed=%s", crawl_id, page.url)
            state = context.storage_state()
            state["loginForm"] = form
            # storage_state holds cookies and localStorage only. Apps that keep
            # the login token in sessionStorage (this tool's own frontend does)
            # showed every worker the login form instead of the page.
            try:
                state["sessionStorage"] = {"origin": page.evaluate("location.origin"),
                                           "items": page.evaluate("() => ({...sessionStorage})")}
            except Exception:
                pass
            return state, page.url
        finally:
            # What the page looked like when the login step ended — to see a
            # popup or error that stopped it. Password boxes show as dots.
            shot = os.path.join(tempfile.gettempdir(), f"ada-login-{crawl_id}.png")
            try:
                page.screenshot(path=shot)
                logger.info("Login screenshot | crawl_id=%s path=%s", crawl_id, shot)
            except Exception:
                pass
            browser.close()


def sign_in(login: dict, root_domain: str, assisted: bool, crawl_id: str = "login"):
    """_log_in, and if the hidden sign-in hits something only a person can do
    (robot check, OTP, SSO, popup), again in a visible window on this PC.
    Returns (session, landed_url, assisted)."""
    try:
        return (*_log_in(login, root_domain, assisted, crawl_id), assisted)
    except RuntimeError as exc:
        if assisted or not can_ask_person():
            raise
        logger.info("Login needs a person, using a visible browser | crawl_id=%s reason=%s", crawl_id, exc)
        return (*_log_in(login, root_domain, True, crawl_id), True)


def add_session_storage(context, session) -> None:
    """storage_state brings back cookies and localStorage; this adds the
    sessionStorage copied at sign-in. Runs before the site's own scripts on
    every page load, and only fills missing keys, so a token the site
    refreshes is kept."""
    if ss := (session or {}).get("sessionStorage"):
        context.add_init_script(
            "(([origin, items]) => { if (location.origin !== origin) return;"
            " for (const [k, v] of Object.entries(items))"
            " if (sessionStorage.getItem(k) === null) sessionStorage.setItem(k, v); })"
            f"({json.dumps([ss['origin'], ss['items']])})")


class _CrawlState:
    """Shared by the crawl's worker threads: the BFS queue, what's been seen,
    and the counters. Every read-modify-write goes through `lock`."""

    def __init__(self, crawl_id, root_url, root_domain, max_depth, max_pages, assisted, session=None):
        self.crawl_id, self.root_url, self.root_domain = crawl_id, root_url, root_domain
        self.max_depth, self.max_pages, self.assisted = max_depth, max_pages, assisted
        self.session = session  # logged-in storage state, or None
        self.login_url = None
        self.signed_out_urls: set[str] = set()  # scanned without the session (the login page)
        self.clicked: set[str] = set()  # button labels already tried (see _discover_by_clicking)
        self.via: dict[str, str] = {}   # page -> label of the button that led to it
        # Throttle, set once the site answers "too many requests" (HTTP 429).
        self.pause_until = self.next_request_at = self.gap = 0.0
        self.queue: deque[tuple[str, str | None, int]] = deque([(root_url, None, 0)])
        self.visited: set[str] = {normalize_url(root_url)}
        self.claimed = self.scanned = self.failed = self.active = 0
        self.cancelled = False
        self.error: Exception | None = None
        self.lock = threading.Lock()
        self.more_work = threading.Condition(self.lock)

    def next_page(self):
        """The next (url, parent_url, depth) to scan, or None when the crawl is
        done: page budget used, cancelled, or nothing queued and no worker
        still scanning (a busy worker may yet add links)."""
        while True:
            status = inmemory_get_status(self.crawl_id) or db.get_crawl_job_status(self.crawl_id)
            with self.lock:
                if status == "cancelled":
                    self.cancelled = True
                if self.cancelled or self.error or self.claimed >= self.max_pages:
                    return None
                if self.queue:
                    self.claimed += 1
                    self.active += 1
                    return self.queue.popleft()
                if self.active == 0:
                    return None
                self.more_work.wait(timeout=1.0)

    def wait_turn(self):
        """Before each page load. No wait until the site has said "too many
        requests"; after that every worker waits out the pause, and loads go
        at most one per `gap` seconds across the whole crawl."""
        with self.lock:
            now = time.time()
            start = max(now, self.pause_until, self.next_request_at)
            self.next_request_at = start + self.gap
        if start > now:
            time.sleep(start - now)

    def slow_down(self, attempt: int):
        """The site rate-limited us (Cloudflare on oattravel.com did, at 3 pages
        at a time): pause everyone, and space out loads from now on."""
        with self.lock:
            self.gap = min(max(self.gap * 2, 2.0), 10.0)
            self.pause_until = max(self.pause_until, time.time() + 15 * attempt)
        logger.info("Crawl rate-limited (HTTP 429) | crawl_id=%s pausing %ss, then 1 page per %.0fs",
                    self.crawl_id, 15 * attempt, self.gap)

    def add_links(self, links, parent_url, depth, first=False, via=None):
        with self.lock:
            for link in links:
                if self.session and _LOGOUT_LINK.search(link):
                    continue
                n = normalize_url(link)
                if n not in self.visited and len(self.visited) < self.max_pages * 3:
                    self.visited.add(n)
                    if via:
                        self.via[n] = via
                    if first or (self.session and _MEMBERS_LINK.search(urlsplit(link).path)):
                        self.queue.appendleft((link, parent_url, depth))
                    else:
                        self.queue.append((link, parent_url, depth))
            self.more_work.notify_all()

    def finish_page(self, ok: bool):
        with self.lock:
            self.active -= 1
            if ok:
                self.scanned += 1
            else:
                self.failed += 1
            progress = dict(total_discovered=len(self.visited), total_scanned=self.scanned, total_failed=self.failed)
            self.more_work.notify_all()
        db.update_crawl_job_progress(self.crawl_id, **progress)
        inmemory_update_crawl(self.crawl_id, **progress)


def _crawl_worker(c: _CrawlState) -> None:
    """One browser; scans pages from the shared queue until the crawl is done."""
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    from axe_playwright_python.sync_playwright import Axe
    try:
        with sync_playwright() as p:
            # assisted: a visible window on this computer, so a person can pass a
            # site's bot check (usually once — the clearance cookie then covers
            # the rest of the crawl). Same idea as the assisted page scan.
            browser = p.chromium.launch(headless=not c.assisted, args=BROWSER_ARGS)
            context = browser.new_context(
                # Matches the single-page scan path's viewport (see
                # scripts/run_ada_check_python.py) — a narrower viewport
                # shows fewer items per row on responsive grid layouts,
                # under-catching repeated-component bugs vs. a normal
                # desktop-width browser window.
                viewport={"width": 1920, "height": 1080},
                ignore_https_errors=True,
                user_agent=scanner_user_agent(browser, headless=not c.assisted),
                storage_state=c.session,
            )
            add_session_storage(context, c.session)
            pw_page = context.new_page()
            # Login crawl: a second, signed-out tab tells pages that need the
            # login apart from public ones ("before login" / "after login").
            anon_page = browser.new_context(
                viewport={"width": 1920, "height": 1080}, ignore_https_errors=True,
                user_agent=scanner_user_agent(browser, headless=not c.assisted),
            ).new_page() if c.session else None
            axe = Axe()
            while (item := c.next_page()) is not None:
                url, parent_url, depth = item
                c.finish_page(_scan_one_page(c, pw_page, axe, PWTimeout, url, parent_url, depth, anon_page))
            context.close()
            browser.close()
    except Exception as exc:  # e.g. the browser failed to start: stops the whole crawl
        with c.lock:
            c.error = c.error or exc
            c.more_work.notify_all()


_NODE_COUNT = "() => document.getElementsByTagName('*').length"


def _settle(pw_page) -> None:
    """Let JavaScript-rendered content appear before axe runs: wait for the
    load event (max 5s), then keep waiting in 1s steps (max 4) while the page
    is still growing. Replaced a fixed 3s wait — tested 2026-10-26 on 17 pages
    of heavy sites: 1.9x faster (94s vs 174s); every result difference was
    within the old method's own run-to-run variation (booking.com found 5,
    then 0, then 0 issues with the fixed 3s wait)."""
    try:
        pw_page.wait_for_load_state("load", timeout=5000)
    except Exception:
        pass
    prev = None
    for _ in range(5):
        try:
            now = pw_page.evaluate(_NODE_COUNT)
        except Exception:  # navigating (e.g. a redirect): give it a moment, then re-measure
            now = None
        if prev is not None and now is not None and now <= prev * 1.01 + 5:
            return  # stopped growing
        prev = now if now is not None else prev
        pw_page.wait_for_timeout(1000)


# Pages reached by buttons instead of links (shopkart11.in's whole menu and its
# product cards are <button>s). Buttons that could change something are never
# clicked: the crawl must not add to a cart, order, delete or log out.
_RISKY_CLICK = re.compile(
    r"\b(add\s+to|buy|check\s*out|place\s+order|order\s+now|book\s+now|pay|pay\s+now|purchase|delete|remove|cancel"
    r"|log\s*-?\s*(out|off)|sign\s*-?\s*out|subscribe|unsubscribe|submit|save|confirm|send|apply|clear|empty|reset"
    r"|report|block|follow|unfollow|like|share|download|print|upload|rate|review|accept|decline|reject|deactivate"
    r"|install|call|chat|whatsapp|copy|edit|update|change|transfer|redeem|claim|join|register|sign\s*-?\s*up|enrol"
    r"|trash|bin|minus|plus|increase|decrease|quantity|qty)\b",
    re.I)
_FEW_LINKS = 15          # click buttons only on pages with fewer links than this
_CLICKS_PER_PAGE = 25
# Marks what can be clicked: buttons, and "cards" — boxes with a pointer cursor
# but no button role (product cards built from divs). A card is opened through
# its image when it holds buttons of its own (its "Add to Cart"), never by its
# middle. Label: the first line of its text (a card's product name).
_MARK_CLICKABLES = """() => {
  document.querySelectorAll('[data-ada-click]').forEach(e => e.removeAttribute('data-ada-click'));
  const out = [];
  const seen = new Set();
  const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  // A card's name: its image's alt text (the product), else its longest line
  // of text: the first line is often a badge like "Bestseller".
  const labelOf = e => {
    const alt = ((e.matches('img') ? e : e.querySelector('img')) || {}).alt || '';
    const lines = (e.innerText || '').split('\\n').map(t => t.trim()).filter(t => /[a-z]{3}/i.test(t)).slice(0, 5);
    const longest = lines.sort((a, b) => b.length - a.length)[0];
    // Icon-only buttons (a ♡ wishlist): named after the icon, e.g. "heart icon".
    const svg = e.querySelector('svg');
    const iconName = svg && ((svg.querySelector('title') || {}).textContent
      || ([...svg.classList].find(k => k.startsWith('lucide-')) || '').slice(7).replace(/-/g, ' '));
    // Only in the header/navigation: inside a card, an icon button is an
    // action (the ♡ on a product card adds it to the wishlist).
    const inNav = e.closest('header, nav, [role=banner], [role=navigation]');
    const icon = iconName && inNav ? iconName.trim() + ' icon' : '';
    return (e.getAttribute('aria-label') || alt || longest || e.title || icon || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
  };
  const mark = (target, label) => {
    if (!label || label.length > 80 || seen.has(target)) return;
    seen.add(target);
    target.setAttribute('data-ada-click', out.length);
    out.push(label);
  };
  const skip = e => e.closest('a[href]') || e.closest('form') || e.disabled || !visible(e);
  for (const e of document.querySelectorAll('button:not([type=submit]), [role=button], [role=link], [role=menuitem], [role=tab], [onclick]')) {
    if (!skip(e)) mark(e, labelOf(e));
    if (out.length >= 200) return out;
  }
  for (const e of document.querySelectorAll('div, li, article, section, span, img')) {
    if (skip(e) || e.matches('button, [role], [onclick]') || e.closest('button, [role=button]')) continue;
    if (getComputedStyle(e).cursor !== 'pointer') continue;
    if (e.parentElement && getComputedStyle(e.parentElement).cursor === 'pointer') continue;  // outermost only
    const target = e.querySelector('button') ? e.querySelector('img') : e;
    if (target && visible(target)) mark(target, labelOf(e));
    if (out.length >= 200) break;
  }
  return out;
}"""


# An open menu, listbox, popover or dialog: [item labels, link addresses] in it.
# Items are also buttons the click revealed next to the clicked one (`before`:
# labels before it), for dropdowns that are plain divs (shopkart11.in's
# "vinoth ▾"). "Next to": within 3 levels up, so a banner sliding or products
# loading late elsewhere on the page don't count as its menu.
_OPEN_MENU = """([before, trigger]) => {
  const labels = (""" + _MARK_CLICKABLES + """)();
  const at = i => document.querySelector('[data-ada-click="' + i + '"]');
  const open = [...document.querySelectorAll('[role=menu], [role=listbox], [data-radix-popper-content-wrapper], [role=dialog]')]
    .filter(m => { const r = m.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const t = labels.includes(trigger) && at(labels.indexOf(trigger));
  const near = t && t.parentElement && t.parentElement.parentElement && t.parentElement.parentElement.parentElement;
  const inside = e => !!e && open.some(m => m.contains(e));
  const items = labels.filter((l, i) => (!before.includes(l) && near && near.contains(at(i))) || inside(at(i)));
  const links = [...document.querySelectorAll('a[href]')].filter(inside).map(a => a.href);
  return [[...new Set(items)], [...new Set(links)]];
}"""


def _discover_by_clicking(c: "_CrawlState", page, url: str, depth: int) -> None:
    """Click each safe-looking button once (per crawl, by label: a header
    menu repeats on every page) and keep any page on this site it opens.
    ponytail: dedup by label, so two different "View All" buttons count once."""
    if depth >= c.max_depth:
        return
    labels = page.evaluate(_MARK_CLICKABLES)
    clicks = reloads = 0
    for label in dict.fromkeys(labels):  # each label once, in page order
        if clicks >= _CLICKS_PER_PAGE or c.cancelled:
            break
        if not _claim(c, label):
            continue
        clicks += 1
        before = _click_label(page, label, wait=3)  # a slow page is still redrawing after "back"
        if before is None and reloads < 3:  # an earlier click left the page changed
            reloads += 1
            _back_to(page, url, reload=True)
            before = _click_label(page, label, wait=5)
        if before is None:
            _unclaim(c, label)  # not on the page right now: another page may still offer it
            continue
        if _went_elsewhere(c, page, url, depth, label):
            continue
        # Same page: did a real menu open (the "vinoth ▾" account menu on
        # shopkart11.in: My Account, My Orders...)? Its links and items are pages too.
        items, menu_links = page.evaluate(_OPEN_MENU, [before, label])
        c.add_links([u for u in menu_links if get_root_domain(u) == c.root_domain], url, depth + 1, via=label)
        for item in items[:10]:
            if c.cancelled or not _claim(c, item):
                continue
            _back_to(page, url, reload=True)  # menu closed: a toggle click on an open one shuts it
            shown = _click_label(page, label, wait=5)  # reopen the menu
            if shown is None:
                _unclaim(c, item)
                break
            if item in shown:  # there before the menu opened: the page drew it late, not the menu
                _unclaim(c, item)
                continue
            page.wait_for_timeout(400)
            if _click_label(page, item) is None or not _went_elsewhere(c, page, url, depth, f"{label} › {item}"):
                _unclaim(c, item)  # led nowhere here: may still be tried as a button of its own
        page.keyboard.press("Escape")
        if items or menu_links:
            _back_to(page, url, reload=True)  # start the next button with the menu closed


def _back_to(page, url: str, reload: bool = False) -> None:
    if reload or normalize_url(page.url) != normalize_url(url):
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            _settle(page)
        except Exception:
            pass


def _claim(c: "_CrawlState", label: str) -> bool:
    """True if this button is safe and nobody in the crawl has tried it yet."""
    if _RISKY_CLICK.search(label):
        return False
    with c.lock:
        if label in c.clicked:
            return False
        c.clicked.add(label)
        return True


def _unclaim(c: "_CrawlState", label: str) -> None:
    with c.lock:
        c.clicked.discard(label)


def _click_label(page, label: str, wait: int = 0):
    """Click the element marked with this label, waiting up to `wait` seconds
    for it (a slow page after a reload). Returns the labels that were on the
    page just before (to spot what the click revealed), or None."""
    try:
        current = page.evaluate(_MARK_CLICKABLES)
        for _ in range(wait):
            if label in current:
                break
            page.wait_for_timeout(1000)
            current = page.evaluate(_MARK_CLICKABLES)
        if label not in current:
            return None
        page.locator(f'[data-ada-click="{current.index(label)}"]').first.click(timeout=3000)
        return current
    except Exception:
        return None


def _went_elsewhere(c: "_CrawlState", page, url: str, depth: int, via: str) -> bool:
    """After a click: if it opened another page, queue it (on this site) and
    come back to `url`. False if the page stayed put."""
    for _ in range(12):  # wait up to 3s for the page to change
        page.wait_for_timeout(250)
        if normalize_url(page.url) != normalize_url(url):
            break
    now = page.url
    if normalize_url(now) == normalize_url(url):
        return False
    if get_root_domain(now) == c.root_domain and not _LOGOUT_LINK.search(now):
        c.add_links([now], url, depth + 1, via=via)
    try:
        page.go_back(wait_until="domcontentloaded", timeout=15000)
    except Exception:
        pass
    if normalize_url(page.url) != normalize_url(url):
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
    _settle(page)
    return True


def _shows_bot_check(url: str) -> bool:
    """Quick hidden look at the start page: does the site put up a bot check?"""
    from playwright.sync_api import sync_playwright
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=BROWSER_ARGS)
            page = browser.new_context(viewport={"width": 1920, "height": 1080}, ignore_https_errors=True,
                                       user_agent=scanner_user_agent(browser)).new_page()
            response = page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(1500)
            blocked = bot_challenge_reason(response.status if response else None, *page_title_and_html(page))
            browser.close()
            return bool(blocked)
    except Exception:
        return False


# "Please login" in place of the content: a members page that does not redirect
# (shopkart11.in/account shows "Please Login - Login to view your account details").
_LOGIN_PROMPT = re.compile(
    r"please\s+(log\s*-?\s*in|sign\s*-?\s*in)|(log\s*-?\s*in|sign\s*-?\s*in)\s+to\s+(view|see|continue|access|your)"
    r"|(login|log\s*in|sign\s*-?\s*in)\s+required|you\s+(must|need\s+to)\s+(be\s+)?(log|sign)(ged)?\s*-?\s*in"
    r"|members\s+only|not\s+authori[sz]ed|(log|sign)\s*-?\s*in\s+or\s+(sign\s*-?\s*up|register)\s+to", re.I)


def _body_text(page) -> str:
    try:
        return page.evaluate("() => document.body ? document.body.innerText.slice(0, 20000) : ''")
    except Exception:
        return ""


def _needs_login(anon_page, url: str, has_password_box: bool, prompted: bool = False) -> bool:
    """Open the page signed out: True if the site sends us to sign in instead
    (redirect elsewhere, a login form the signed-in page didn't have, or a
    "please login" message the signed-in page didn't have)."""
    try:
        anon_page.goto(url, wait_until="domcontentloaded", timeout=20000)
        anon_page.wait_for_load_state("load", timeout=5000)
    except Exception:
        pass
    anon_page.wait_for_timeout(1000)  # client-side login guards redirect after their JS runs
    try:
        return (normalize_url(anon_page.url) != normalize_url(url)
                or (not has_password_box and bool(_find(anon_page, _PASSWORD_BOX, _ON_SCREEN)))
                or (not prompted and bool(_LOGIN_PROMPT.search(_body_text(anon_page)))))
    except Exception:
        return False


def _shows_login_page(page, login_url: str | None, login_form: list | None) -> bool:
    """The logged-in tab got the sign-in page instead of this page: sent to the
    login URL, or the login form's own boxes (recorded when signing in) are on
    screen. Matching that exact form, not "any password box", keeps a sign-up
    or change-password page from counting as it."""
    try:
        now, login = urlsplit(page.url), urlsplit(login_url or "")
        if login.path.strip("/") and (now.netloc, now.path.rstrip("/")) == (login.netloc, login.path.rstrip("/")):
            return True
        return bool(login_form) and set(login_form) <= set(page.evaluate(_FORM_BOXES))
    except Exception:
        return False


def _scan_one_page(c: _CrawlState, pw_page, axe, PWTimeout, url, parent_url, depth, anon_page=None) -> bool:
    """Load, check and axe-scan one page, and persist it. True if scanned."""
    crawl_id = c.crawl_id
    norm_url = normalize_url(url)
    signed_out = anon_page is not None and norm_url in c.signed_out_urls
    if signed_out:
        pw_page = anon_page  # the login page itself, as a signed-out visitor sees it

    page_base = {
        "crawl_id": crawl_id,
        "url": url,
        "normalized_url": norm_url,
        "parent_url": parent_url,
        "via": c.via.get(norm_url),
        "depth": depth,
        "status": "running",
        "passes": None,
        "violations": None,
        "pass_rate": None,
        "failure_reason": None,
    }
    with c.lock:
        page_id = db.save_crawl_page(
            crawl_id, url, norm_url, parent_url, depth, status="running", via=c.via.get(norm_url)
        )
        page_idx = inmemory_append_page(crawl_id, page_base)
    scanned_at = _utcnow_iso()

    try:
        try:
            # domcontentloaded + a short settle, not networkidle —
            # networkidle waits for 500ms of zero network activity,
            # which real sites with analytics beacons, ad trackers,
            # or polling never actually reach, so it was routinely
            # burning most of the 60s timeout on every single page.
            # Matches the single-page scan path's own approach.
            # A "poll until the DOM stops growing" variant was
            # tried and reverted here too (see that file's comment)
            # — unreliable on pages with continuous third-party
            # script churn that never actually goes quiet.
            for attempt in range(1, 4):
                c.wait_turn()
                try:
                    response = pw_page.goto(url, wait_until="domcontentloaded", timeout=30000)
                    _settle(pw_page)
                except PWTimeout:
                    response = None  # proceed with what loaded
                if not (response and response.status == 429):
                    break
                c.slow_down(attempt)  # "too many requests": wait, then retry this page
        except PWTimeout:
            response = None
        # A bot-protection challenge page is not the site — fail this
        # page with the reason instead of scoring the challenge page.
        blocked = bot_challenge_reason(response.status if response else None,
                                       *page_title_and_html(pw_page))
        if blocked and c.assisted and wait_for_person_to_verify(pw_page):
            blocked = None
        if blocked:
            raise RuntimeError(blocked)
        # Scoring the login form under this page's address would be a wrong
        # result that looks right; fail it with the reason instead.
        if anon_page is not None and not signed_out and _shows_login_page(
                pw_page, c.login_url, c.session.get("loginForm")):
            raise RuntimeError("Not logged in here: the site showed its login page instead of this page, "
                               "so it was not scored (the session may have expired — re-crawl to sign in again)")

        # Discover child links on the already-loaded page
        link_count = None
        if depth < c.max_depth:
            links = extract_internal_links(pw_page, c.root_url, c.root_domain)
            link_count = len(links)
            c.add_links(links, url, depth + 1)

        # Run axe accessibility scan — same tag set as the single-page
        # scan path (scripts/run_ada_check_python.py): WCAG 2.0 A/AA,
        # 2.1 A/AA, and 2.2 AA. Missing the 2.1 tags here once made a
        # crawled page under-report violations compared to scanning
        # that exact same URL from Run Audit (confirmed live
        # 2026-10-05: root page showed 4 violations via crawl, 7 via
        # single-page scan) — keep this list in sync with that path.
        try:
            results = axe.run(
                pw_page,
                options={"runOnly": {"type": "tag", "values": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]}},
            )
        except TypeError:
            results = axe.run(pw_page)

        axe_data = (
            results.response
            if hasattr(results, "response") and results.response
            else {}
        )
        vcount = len(axe_data.get("violations") or [])
        pcount = len(axe_data.get("passes") or [])
        total_items = vcount + pcount
        pass_rate = int(pcount / total_items * 100) if total_items else 100

        scan_result = {
            "url": url,
            "message": "ADA check completed",
            "axeResult": axe_data,
            "includeBestPractices": False,
            "usedFallback": False,
        }

        section = None
        if anon_page is not None:
            if signed_out:
                section = "before_login"
            else:
                seen_at, has_pw = pw_page.url, bool(_find(pw_page, _PASSWORD_BOX, _ON_SCREEN))
                prompted = bool(_LOGIN_PROMPT.search(_body_text(pw_page)))
                c.wait_turn()
                section = "after_login" if _needs_login(anon_page, seen_at, has_pw, prompted) else "before_login"

        db.update_crawl_page(
            page_id,
            status="scanned",
            section=section,
            passes=pcount,
            violations=vcount,
            pass_rate=pass_rate,
            result_payload=json.dumps(scan_result),
            scanned_at=scanned_at,
        )
        inmemory_update_page(
            crawl_id, page_idx,
            status="scanned",
            section=section,
            passes=pcount,
            violations=vcount,
            pass_rate=pass_rate,
            scanned_at=scanned_at,
        )
        # Few links: the site's menus/cards are probably buttons. Click the
        # safe ones to find the pages behind them (after the scan, as clicking
        # changes the page). Never on the login page.
        if link_count is not None and link_count < _FEW_LINKS and not signed_out:
            try:
                _discover_by_clicking(c, pw_page, url, depth)
            except Exception as exc:
                logger.info("Button discovery stopped | crawl_id=%s url=%s reason=%s", crawl_id, url, exc)
        return True

    except Exception as exc:
        logger.warning(
            "Page scan failed | crawl_id=%s url=%s reason=%s",
            crawl_id, url, exc,
        )
        db.update_crawl_page(
            page_id,
            status="failed",
            failure_reason=str(exc)[:500],
        )
        inmemory_update_page(
            crawl_id, page_idx,
            status="failed",
            failure_reason=str(exc)[:500],
        )
        return False


def crawl_site_task(
    crawl_id: str,
    root_url: str,
    max_depth: int,
    max_pages: int,
    notify_email: str = None,
    user_id: int = None,
    assisted: bool = False,
    login: dict | None = None,
    paired: bool = False,
    extra_urls: list | None = None,
) -> dict:
    """
    BFS site crawl: CRAWL_CONCURRENCY worker threads, each with its own
    Playwright browser, take pages from a shared queue, run axe on each and
    persist results to DB and the in-memory fallback.
    """
    started_at = _utcnow_iso()
    db.update_crawl_job_status(crawl_id, "running", started_at=started_at)
    inmemory_update_crawl(crawl_id, status="running", started_at=started_at)
    logger.info(
        "Crawl started | crawl_id=%s url=%s depth=%d pages=%d",
        crawl_id, root_url, max_depth, max_pages,
    )

    root_domain = get_root_domain(root_url)
    # No "visible browser" setting: if the site shows a bot check, the crawl
    # switches to a visible window on this PC by itself, for the person to pass it.
    if not assisted and can_ask_person() and _shows_bot_check(root_url):
        logger.info("Crawl needs a person (bot check), using a visible browser | crawl_id=%s", crawl_id)
        assisted = True
    c = _CrawlState(crawl_id, root_url, root_domain, max_depth, max_pages, assisted)

    try:
        if login:
            c.session, landed, assisted = sign_in(login, root_domain, assisted, crawl_id)
            c.assisted = assisted
            # Members area first: where the login landed is scanned next, and
            # account-like links jump the queue (see add_links), instead of
            # waiting behind every public page found from the start page.
            if get_root_domain(landed) == root_domain:
                c.add_links([landed], None, 1, first=True)
            c.login_url = login["url"]
            login_norm = normalize_url(login["url"])
            if login_norm not in c.visited:  # also scan the login page, signed out
                c.visited.add(login_norm)
                c.queue.append((login["url"], None, 0))
            c.signed_out_urls.add(login_norm)
        # "Pages to include": pages the crawler can't reach by links (menus made
        # of buttons, e.g. shopkart11.in), scanned first.
        if extra_urls:
            c.add_links(extra_urls, None, 1, first=True)
        # Several pages at once, each worker with its own browser: about half of a
        # page's time is the fixed settle wait (measured 2026-10-22), so scanning
        # one page at a time left the machine idle. A visible crawl keeps a single
        # window, since a person may be verifying in it.
        workers = 1 if assisted else max(1, Config.CRAWL_CONCURRENCY)
        if paired:  # ponytail: signed-out + logged-in crawls run at once; one browser fewer each to fit memory
            workers = max(1, workers - 1)
        threads = [threading.Thread(target=_crawl_worker, args=(c,), daemon=True,
                                    name=f"crawl-{crawl_id}-{n}") for n in range(workers)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        if c.error:
            raise c.error
        visited, total_scanned, total_failed, was_cancelled = c.visited, c.scanned, c.failed, c.cancelled

    except Exception as exc:
        failed_at = _utcnow_iso()
        db.update_crawl_job_status(
            crawl_id, "failed",
            ended_at=failed_at,
            failure_reason=str(exc)[:1000],
        )
        inmemory_update_crawl(
            crawl_id,
            status="failed",
            ended_at=failed_at,
            failure_reason=str(exc)[:1000],
        )
        logger.error(
            "Crawl failed | crawl_id=%s reason=%s", crawl_id, exc, exc_info=True
        )
        raise

    if was_cancelled:
        logger.info("Crawl cancelled | crawl_id=%s scanned=%d", crawl_id, total_scanned)
        return {"crawl_id": crawl_id, "status": "cancelled", "total_scanned": total_scanned}

    completed_at = _utcnow_iso()
    duration = _duration(started_at, completed_at)
    db.update_crawl_job_status(
        crawl_id, "completed",
        ended_at=completed_at,
        duration_seconds=duration,
    )
    inmemory_update_crawl(
        crawl_id,
        status="completed",
        ended_at=completed_at,
        duration_seconds=duration,
    )

    # Compute aggregate metrics and persist to CrawlJob.Metadata
    summary = db.finalize_crawl_summary(crawl_id)
    inmemory_update_crawl(crawl_id, **summary)

    logger.info(
        "Crawl completed | crawl_id=%s scanned=%d failed=%d duration=%.1fs",
        crawl_id, total_scanned, total_failed, duration or 0,
    )

    if notify_email:
        try:
            from backend.services.email_service import send_crawl_report
            sent = send_crawl_report(crawl_id, notify_email)
            logger.info("Email send result | sent=%s to=%s", sent, notify_email)
        except Exception as _email_exc:
            logger.error(
                "Crawl report email failed | crawl_id=%s error=%s",
                crawl_id, _email_exc, exc_info=True,
            )
    else:
        logger.info("Email skipped — notify_email is empty/None")

    # Phase 3 — AI summary (non-blocking, best-effort)
    try:
        from backend.services.ai_summary_service import generate_and_store_summary
        generate_and_store_summary(crawl_id)
    except Exception as _ai_exc:
        logger.warning("AI summary failed | crawl_id=%s error=%s", crawl_id, _ai_exc)

    # Phase 3 — report delivery (non-blocking, best-effort). Runs after the AI
    # summary step above so the Executive Summary PDF can include it when
    # available. The PDF is sent to Slack as a single file+comment message;
    # Teams always gets its rich-text card (no file-attachment capability),
    # and Slack only falls back to that card if the PDF wasn't delivered.
    if user_id:
        try:
            violations_detail = _aggregate_crawl_violations(crawl_id)
            score = summary.get("site_score") if summary.get("site_score") is not None else "—"
            pass_rate = summary.get("avg_pass_rate") if summary.get("avg_pass_rate") is not None else "—"
            violations = summary.get("total_violations", 0)

            from backend.services.notify_service import auto_share_report, has_slack_integration, send_report_pdf
            pdf_sent = False
            if has_slack_integration(user_id):
                from backend.services.report_pdf_service import render_crawl_executive_summary
                pdf_bytes = render_crawl_executive_summary(crawl_id)
                if pdf_bytes:
                    comment = f"*ADA Crawl Report — {root_url}*\nScore: {score}/100 · Pass rate: {pass_rate}% · Violations: {violations}"
                    pdf_sent = send_report_pdf(user_id, f"executive-summary-{crawl_id}.pdf", pdf_bytes,
                                                reference=crawl_id, initial_comment=comment)

            auto_share_report(user_id, "crawl_summary", {
                "url": root_url,
                "score": score,
                "violations": violations,
                "pass_rate": pass_rate,
                "pages": total_scanned,
                "violations_detail": violations_detail,
                "crawl_id": crawl_id,
                "reference": crawl_id,
                "skip_slack_card": pdf_sent,
            })
        except Exception as _notify_exc:
            logger.warning("Report delivery failed | crawl_id=%s error=%s", crawl_id, _notify_exc)

    # Phase 3 — Alert evaluation (non-blocking, best-effort)
    try:
        from backend.services.alert_service import evaluate_and_create_alerts
        alert_ids = evaluate_and_create_alerts(crawl_id)
        if alert_ids:
            logger.info("Alerts created | crawl_id=%s alert_ids=%s", crawl_id, alert_ids)
    except Exception as _alert_exc:
        logger.warning("Alert evaluation failed | crawl_id=%s error=%s", crawl_id, _alert_exc)

    return {
        "crawl_id": crawl_id,
        "root_url": root_url,
        "total_discovered": len(visited),
        "total_scanned": total_scanned,
        "total_failed": total_failed,
        "completed_at": completed_at,
    }
