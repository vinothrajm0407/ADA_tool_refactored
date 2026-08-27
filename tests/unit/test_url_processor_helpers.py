"""
Unit tests for pure helper functions in services/url_processor.py.

These functions have zero I/O and are tested in full isolation.
Coverage: _extract_fix_text, _extract_ratio_info, _safe_int
"""
import pytest
from services.url_processor import _extract_fix_text, _extract_ratio_info, _safe_int


# ── _safe_int ─────────────────────────────────────────────────────────────────

class TestSafeInt:
    def test_integer_string(self):
        assert _safe_int("42") == 42

    def test_integer_value(self):
        assert _safe_int(7) == 7

    def test_float_string_returns_default(self):
        # int("3.9") raises ValueError, so _safe_int falls back to default
        assert _safe_int("3.9") == 0

    def test_none_returns_default(self):
        assert _safe_int(None) == 0

    def test_empty_string_returns_default(self):
        assert _safe_int("") == 0

    def test_non_numeric_returns_default(self):
        assert _safe_int("abc") == 0

    def test_custom_default(self):
        assert _safe_int("bad", default=99) == 99

    def test_zero_string(self):
        assert _safe_int("0") == 0

    def test_negative(self):
        assert _safe_int("-5") == -5


# ── _extract_fix_text ─────────────────────────────────────────────────────────

class TestExtractFixText:
    def test_strips_fix_all_prefix(self):
        text = "Fix all of the following:\n  Element has insufficient contrast"
        assert _extract_fix_text(text) == "Element has insufficient contrast"

    def test_strips_fix_any_prefix(self):
        text = "Fix any of the following:\n  Add aria-label to the element"
        assert _extract_fix_text(text) == "Add aria-label to the element"

    def test_strips_fix_one_prefix(self):
        text = "Fix one of the following:\n  Ensure role attribute is valid"
        assert _extract_fix_text(text) == "Ensure role attribute is valid"

    def test_plain_text_returned_as_is(self):
        assert _extract_fix_text("Add a label") == "Add a label"

    def test_empty_string_returns_empty(self):
        assert _extract_fix_text("") == ""

    def test_none_returns_empty(self):
        assert _extract_fix_text(None) == ""

    def test_only_whitespace_returns_empty(self):
        assert _extract_fix_text("   \n  ") == ""

    def test_multiline_returns_first_meaningful_line(self):
        text = "Fix all of the following:\n  First fix\n  Second fix"
        assert _extract_fix_text(text) == "First fix"

    def test_preserves_fix_detail_content(self):
        text = "Fix all of the following:\n  Ensure the contrast ratio is at least 4.5:1"
        result = _extract_fix_text(text)
        assert "4.5:1" in result

    def test_blank_lines_skipped(self):
        text = "Fix any of the following:\n\n  \n  Actual fix here"
        assert _extract_fix_text(text) == "Actual fix here"


# ── _extract_ratio_info ───────────────────────────────────────────────────────

class TestExtractRatioInfo:
    def test_parses_current_and_required(self):
        text = "Element has insufficient color contrast of 2.31 (foreground color: #767676, background color: #ffffff, font size: 12.0pt, font weight: normal). Expected contrast ratio of 4.5:1"
        result = _extract_ratio_info(text)
        assert result["current"] == 2.31
        assert result["required"] == 4.5
        assert result["gap"] == pytest.approx(4.5 - 2.31, abs=0.01)

    def test_missing_current_ratio(self):
        text = "Expected contrast ratio of 4.5:1"
        result = _extract_ratio_info(text)
        assert result["current"] is None
        assert result["required"] == 4.5
        assert result["gap"] is None

    def test_missing_required_ratio(self):
        text = "Element has insufficient color contrast of 3.1"
        result = _extract_ratio_info(text)
        assert result["current"] == 3.1
        assert result["required"] is None
        assert result["gap"] is None

    def test_empty_string(self):
        result = _extract_ratio_info("")
        assert result == {"current": None, "required": None, "gap": None}

    def test_none_input(self):
        result = _extract_ratio_info(None)
        assert result == {"current": None, "required": None, "gap": None}

    def test_integer_ratio(self):
        text = "contrast of 3 ... Expected contrast ratio of 4"
        result = _extract_ratio_info(text)
        assert result["current"] == 3.0
        assert result["required"] == 4.0

    def test_large_contrast_ratio(self):
        text = "contrast of 21.0 ... Expected contrast ratio of 4.5"
        result = _extract_ratio_info(text)
        assert result["current"] == 21.0

    def test_gap_calculation_precision(self):
        text = "contrast of 3.50 ... Expected contrast ratio of 4.5"
        result = _extract_ratio_info(text)
        assert result["gap"] == pytest.approx(1.0, abs=0.01)

    def test_case_insensitive_matching(self):
        text = "CONTRAST OF 2.5 ... EXPECTED CONTRAST RATIO OF 4.5"
        result = _extract_ratio_info(text)
        assert result["current"] == 2.5
        assert result["required"] == 4.5
