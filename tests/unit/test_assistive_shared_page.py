from contextlib import contextmanager
from unittest.mock import patch

from services import url_processor as up


def test_modules_share_one_page_load_and_keyboard_runs_last():
    loads, seen = [], []

    @contextmanager
    def fake_page_for(url, assisted, viewport, settle_ms=800):
        if getattr(up._shared, "page", None) is not None:   # same logic as the real one
            yield up._shared.page
            return
        loads.append(url)
        yield "PAGE"

    def runner(name):
        def run(url, assisted):
            with fake_page_for(url, assisted, {}) as page:
                seen.append((name, page))
            if name == "forms":
                raise RuntimeError("boom")
            return {"module": name, "passed": True}
        return run

    with patch.object(up, "_page_for", fake_page_for), \
         patch.object(up, "run_keyboard_assisted_test", runner("keyboard")), \
         patch.object(up, "run_color_contrast_assisted_test", runner("color-contrast")), \
         patch.object(up, "run_page_structure_assisted_test", runner("page-structure")), \
         patch.object(up, "run_forms_accessibility_test", runner("forms")):
        out = up.run_assistive_modules("https://s.com/", ["keyboard", "forms", "color-contrast", "page-structure"])

    assert loads == ["https://s.com/"]                                        # one page load for all four
    assert [n for n, _ in seen] == ["page-structure", "forms", "color-contrast", "keyboard"]
    assert all(page == "PAGE" for _, page in seen)
    assert out["forms"]["ok"] is False and out["forms"]["errors"] == ["boom"]  # one failure doesn't stop the rest
    assert out["keyboard"]["passed"] is True
    assert getattr(up._shared, "page", None) is None                          # cleaned up
