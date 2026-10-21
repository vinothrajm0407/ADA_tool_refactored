from services.db import _scan_breakdown, _wcag_level


def _v(impact, *tags):
    return {"impact": impact, "tags": list(tags), "nodes": [{}]}


def test_scan_breakdown_counts_rules_by_impact_level_and_review():
    result = {"axeResult": {
        "violations": [
            _v("critical", "wcag2a", "wcag111"),
            _v("serious", "wcag2aa", "wcag143"),
            _v("serious", "wcag21aa"),
            _v(None, "best-practice"),          # no impact -> minor, not a WCAG level
        ],
        "incomplete": [{}, {}],
    }}
    b = _scan_breakdown(result)
    assert b["impact"] == {"critical": 1, "serious": 2, "moderate": 0, "minor": 1}
    assert b["level"] == {"a": 1, "aa": 2, "aaa": 0, "best_practice": 1}
    assert b["review"] == 2


def test_wcag_level_prefers_higher_level_when_tags_mix():
    assert _wcag_level(["wcag2a", "wcag2aa"]) == "aa"
    assert _wcag_level(["wcag2aaa"]) == "aaa"
    assert _scan_breakdown({})["review"] == 0
