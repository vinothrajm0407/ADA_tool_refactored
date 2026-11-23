from scripts.run_ada_check_python import count_needs_review_as_violations


def test_needs_review_items_are_counted_as_violations():
    data = {
        "violations": [{"id": "meta-viewport", "impact": "moderate", "nodes": [{"target": ["meta"]}]},
                       {"id": "color-contrast", "impact": "serious", "nodes": [{"target": ["p"]}]}],
        "incomplete": [{"id": "color-contrast", "impact": "serious", "nodes": [{"target": ["h1"]}]},
                       {"id": "aria-prohibited-attr", "impact": "serious", "nodes": [{"target": ["div"]}]}],
    }
    out = count_needs_review_as_violations(data)
    ids = [r["id"] for r in out["violations"]]
    assert ids == ["meta-viewport", "color-contrast", "aria-prohibited-attr"]  # no duplicate rule
    assert [n["target"] for n in out["violations"][1]["nodes"]] == [["p"], ["h1"]]
    assert out["incomplete"] == []


def test_empty_result_is_left_alone():
    assert count_needs_review_as_violations({}) == {"violations": [], "incomplete": []}
