import pytest

from scripts.ada_pr_review import MARKER, baseline_urls, build_markdown, split_new, worst_hit


def _result(*impacts):
    return {"axeResult": {"violations": [
        {"id": f"rule-{i}", "impact": impact, "help": "Fix | it", "helpUrl": "https://x.test", "nodes": [{}, {}]}
        for i, impact in enumerate(impacts)]}}


@pytest.mark.unit
class TestWorstHit:
    def test_at_threshold_fails(self):
        assert worst_hit([("u", _result("minor", "serious"), None)], "serious")

    def test_below_threshold_passes(self):
        assert not worst_hit([("u", _result("minor", "moderate"), None)], "serious")

    def test_none_never_fails(self):
        assert not worst_hit([("u", _result("critical"), None)], "none")

    def test_failed_scan_has_no_violations(self):
        assert not worst_hit([("u", None, "timeout")], "minor")


@pytest.mark.unit
class TestBuildMarkdown:
    def test_lists_worst_first_with_marker(self):
        body = build_markdown([("https://a.test", _result("minor", "critical"), None)], "serious", True)
        assert body.startswith(MARKER)
        assert "2 rule violation(s) across 1 page(s)" in body
        assert body.index("| critical |") < body.index("| minor |")
        assert "Fix / it" in body  # a | in the rule text would break the table
        assert "Check fails" in body

    def test_clean_and_failed_pages(self):
        body = build_markdown([("https://a.test", _result(), None), ("https://b.test", None, "timeout")], "serious", False)
        assert "No accessibility violations found." in body
        assert "Could not scan: timeout" in body
        assert "Check fails" not in body


def _page(*violations):
    """violations: (rule_id, impact, [targets])."""
    return {"axeResult": {"violations": [
        {"id": rid, "impact": imp, "help": rid, "helpUrl": "", "nodes": [{"target": [t]} for t in targets]}
        for rid, imp, targets in violations]}}


@pytest.mark.unit
class TestStopNewProblems:
    LIVE = _page(("image-alt", "critical", ["#logo", "#hero"]), ("color-contrast", "serious", [".muted"]))

    def test_only_elements_the_pr_adds_are_new(self):
        pr = _page(("image-alt", "critical", ["#logo", "#hero", "#new-banner"]), ("color-contrast", "serious", [".muted"]))
        new, old = split_new(pr, self.LIVE)
        assert [(v["id"], [n["target"] for n in v["nodes"]]) for v in new["axeResult"]["violations"]] == \
            [("image-alt", [["#new-banner"]])]
        assert sum(len(v["nodes"]) for v in old["axeResult"]["violations"]) == 3

    def test_old_issues_alone_do_not_fail_the_check(self):
        new, old = split_new(self.LIVE, self.LIVE)          # PR changed nothing accessibility-wise
        assert not worst_hit([("u", new, None)], "serious")
        body = build_markdown([("u", self.LIVE, None)], "serious", False, {"u": (new, old)})
        assert "No new accessibility issues" in body and "2 issue(s) already on the live site" in body

    def test_a_new_serious_issue_fails_it(self):
        pr = _page(("button-name", "critical", ["#buy"]), *[(v["id"], v["impact"], [n["target"][0] for n in v["nodes"]])
                                                           for v in self.LIVE["axeResult"]["violations"]])
        new, old = split_new(pr, self.LIVE)
        assert worst_hit([("u", new, None)], "serious")
        body = build_markdown([("u", pr, None)], "serious", True, {"u": (new, old)})
        assert "1 new issue(s)" in body and "New in this PR" in body and "`button-name`" in body
        assert "Check fails: new violations" in body

    def test_baseline_urls_pairing(self):
        urls = ["https://pr-12.vercel.app/", "https://pr-12.vercel.app/login?next=/"]
        assert baseline_urls(urls, []) == [None, None]
        assert baseline_urls(urls, ["https://site.com"]) == ["https://site.com/", "https://site.com/login?next=/"]
        assert baseline_urls(urls, ["https://a/", "https://b/"]) == ["https://a/", "https://b/"]
        with pytest.raises(ValueError):
            baseline_urls(urls + ["https://pr-12.vercel.app/x"], ["https://a/", "https://b/"])
