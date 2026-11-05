import pytest

from scripts.ada_pr_review import MARKER, build_markdown, worst_hit


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
