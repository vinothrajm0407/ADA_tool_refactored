"""
Unit tests for the pure-logic pieces of Auto-Fix orchestration
(backend/services/auto_fix_service.py) — no real git/npm/network involved.
"""
import json
import re
from pathlib import Path

import pytest
from unittest.mock import patch as mock_patch

from backend.services.auto_fix_service import (
    locate_source, validate_patch, _fallback_patch, _parse_github_repo, _pr_body,
    _hex_to_rgb, _relative_luminance, _contrast_ratio, _adjust_to_ratio, _parse_contrast_data,
    is_auto_merge_eligible, _parse_target_chain, _ai_disambiguate, _pick_match_by_line,
    _widen_until_unique, _scan_tag_end, _find_tag_occurrences, _locate_patch_target,
    _find_enclosing_tag, _apply_attribute, _infer_accessible_name, RULES_WITH_FALLBACK,
    ALREADY_FIXED,
)


@pytest.fixture(autouse=True)
def _no_live_gemini_by_default():
    """
    locate_source's ambiguous-candidate path can call out to Gemini for
    AI-assisted disambiguation (see _ai_disambiguate) when a key is
    configured. Force it unset for every test in this file by default so a
    real key present in the dev environment's .env never turns a deterministic
    unit test into a live, non-deterministic network call — tests that
    specifically exercise the AI path mock the HTTP call instead of hitting
    the real API, or locally override this with their own mock_patch.
    """
    with mock_patch("backend.services.auto_fix_service.Config.GEMINI_API_KEY", ""):
        yield


class TestLocateSource:
    def test_finds_unique_match(self, tmp_path):
        (tmp_path / "Header.jsx").write_text(
            'export default function Header() {\n'
            '  return <button className="menu-btn"><svg/></button>\n'
            '}\n',
            encoding="utf-8",
        )
        result = locate_source(tmp_path, '<button class="menu-btn"><svg></svg></button>')
        assert result is not None
        file_path, line_no = result
        assert file_path == "Header.jsx"
        assert line_no == 2

    def test_finds_plain_html_class_attribute(self, tmp_path):
        # A static site writes class="..." in its source too, not just the
        # JSX className="..." the violation's rendered outerHTML always uses.
        (tmp_path / "index.html").write_text(
            '<body>\n  <button class="menu-btn"><svg></svg></button>\n</body>\n',
            encoding="utf-8",
        )
        result = locate_source(tmp_path, '<button class="menu-btn"><svg></svg></button>')
        assert result == ("index.html", 2)

    def test_no_class_attribute_falls_back_to_tag_name(self, tmp_path):
        (tmp_path / "ProductCard.jsx").write_text(
            'export default function ProductCard() {\n'
            '  return <img src={image} />\n'
            '}\n',
            encoding="utf-8",
        )
        result = locate_source(tmp_path, '<img src="/jacket.svg">')
        assert result is not None
        file_path, line_no = result
        assert file_path == "ProductCard.jsx"
        assert line_no == 2

    def test_tag_fallback_ambiguous_across_files_returns_none(self, tmp_path):
        (tmp_path / "A.jsx").write_text('<img src={a} />', encoding="utf-8")
        (tmp_path / "B.jsx").write_text('<img src={b} />', encoding="utf-8")
        assert locate_source(tmp_path, '<img src="/x.svg">') is None

    def test_generic_tags_never_used_as_fallback_signal(self, tmp_path):
        (tmp_path / "Header.jsx").write_text('<div>only one</div>', encoding="utf-8")
        assert locate_source(tmp_path, '<div>x</div>') is None

    def test_no_match_returns_none(self, tmp_path):
        (tmp_path / "Header.jsx").write_text('<button className="other">x</button>', encoding="utf-8")
        assert locate_source(tmp_path, '<button class="menu-btn">x</button>') is None

    def test_ambiguous_multiple_files_returns_none(self, tmp_path):
        (tmp_path / "A.jsx").write_text('<button className="menu-btn">a</button>', encoding="utf-8")
        (tmp_path / "B.jsx").write_text('<button className="menu-btn">b</button>', encoding="utf-8")
        assert locate_source(tmp_path, '<button class="menu-btn">x</button>') is None

    def test_falls_back_to_id_attribute(self, tmp_path):
        (tmp_path / "NewsletterSignup.jsx").write_text(
            '<div role="checkbox" id="consent-toggle">I agree</div>', encoding="utf-8",
        )
        result = locate_source(tmp_path, '<div role="checkbox" id="consent-toggle">I agree</div>')
        assert result is not None
        assert result[0] == "NewsletterSignup.jsx"

    def test_falls_back_to_visible_text_when_tag_is_ambiguous_across_files(self, tmp_path):
        # Two different classless <h2> elements in two different files — the
        # bare-tag needle alone would match both files and bail as ambiguous.
        (tmp_path / "ContactForm.jsx").write_text('<h2>Get in touch</h2>', encoding="utf-8")
        (tmp_path / "NewsletterSignup.jsx").write_text('<h2>Stay in the loop</h2>', encoding="utf-8")
        result = locate_source(tmp_path, "<h2>Get in touch</h2>")
        assert result is not None
        assert result[0] == "ContactForm.jsx"

    def test_short_text_not_used_as_fallback_signal(self, tmp_path):
        (tmp_path / "Header.jsx").write_text('<h2>ok</h2>', encoding="utf-8")
        (tmp_path / "Footer.jsx").write_text('<h2>go</h2>', encoding="utf-8")
        # Both texts are under the length floor, and the bare <h2> tag matches
        # both files too — nothing safe to lock onto.
        assert locate_source(tmp_path, "<h2>ok</h2>") is None

    def test_ambiguous_within_same_file_returns_none(self, tmp_path):
        # Only one file matches, but the tag/text appears twice inside it —
        # taking "the first one" would risk patching the wrong element.
        (tmp_path / "Page.jsx").write_text(
            '<h2>Get in touch</h2>\n<p>...</p>\n<h2>Get in touch</h2>', encoding="utf-8",
        )
        assert locate_source(tmp_path, "<h2>Get in touch</h2>") is None

    def test_skips_node_modules(self, tmp_path):
        nm = tmp_path / "node_modules" / "some-lib"
        nm.mkdir(parents=True)
        (nm / "Widget.jsx").write_text('<button className="menu-btn">a</button>', encoding="utf-8")
        (tmp_path / "Header.jsx").write_text('<button className="menu-btn">b</button>', encoding="utf-8")
        result = locate_source(tmp_path, '<button class="menu-btn">x</button>')
        assert result is not None
        assert result[0] == "Header.jsx"


class TestValidatePatch:
    FILE = 'export default function X() {\n  return <button className="menu-btn"><svg/></button>\n}\n'

    def test_valid_unique_replacement(self):
        before = '<button className="menu-btn"><svg/></button>'
        after  = '<button className="menu-btn" aria-label="Open menu"><svg aria-hidden="true"/></button>'
        assert validate_patch(self.FILE, before, after) is True

    def test_before_not_found(self):
        assert validate_patch(self.FILE, "not in file", "replacement") is False

    def test_before_appears_multiple_times(self):
        content = "x = 1\nx = 1\n"
        assert validate_patch(content, "x = 1", "x = 2") is False

    def test_after_equals_before_rejected(self):
        before = '<button className="menu-btn"><svg/></button>'
        assert validate_patch(self.FILE, before, before) is False

    def test_after_far_longer_than_before_rejected(self):
        before = '<button className="menu-btn"><svg/></button>'
        after = before + ("x" * 1000)
        assert validate_patch(self.FILE, before, after) is False

    def test_empty_before_or_after_rejected(self):
        assert validate_patch(self.FILE, "", "something") is False
        assert validate_patch(self.FILE, "<button className=\"menu-btn\"><svg/></button>", "") is False


class TestFallbackPatch:
    RULE = {"id": "button-name"}
    NODE = {"html": '<button class="menu-btn"><svg></svg></button>'}
    FILE = 'export default function Header() {\n  return <button className="menu-btn"><svg/></button>\n}\n'

    def test_adds_aria_label(self):
        patch = _fallback_patch(self.RULE, self.NODE, self.FILE)
        assert patch is not None
        assert patch["before"] == '<button className="menu-btn">'
        assert patch["after"] == '<button className="menu-btn" aria-label="Menu">'
        assert validate_patch(self.FILE, patch["before"], patch["after"]) is True

    def test_unsupported_rule_returns_none(self):
        assert _fallback_patch({"id": "color-contrast"}, self.NODE, self.FILE) is None

    def test_already_has_aria_label_returns_already_fixed(self):
        file_content = 'return <button className="menu-btn" aria-label="Existing"><svg/></button>'
        assert _fallback_patch(self.RULE, self.NODE, file_content) is ALREADY_FIXED

    def test_self_closing_tag(self):
        file_content = '<button className="menu-btn" />'
        patch = _fallback_patch(self.RULE, self.NODE, file_content)
        assert patch["after"] == '<button className="menu-btn" aria-label="Menu" />'

    def test_plain_html_class_attribute(self):
        file_content = '<body>\n  <button class="menu-btn"><svg></svg></button>\n</body>\n'
        patch = _fallback_patch(self.RULE, self.NODE, file_content)
        assert patch is not None
        assert patch["after"] == '<button class="menu-btn" aria-label="Menu">'
        assert validate_patch(file_content, patch["before"], patch["after"]) is True


class TestFallbackPatchImageAlt:
    RULE = {"id": "image-alt"}

    def test_derives_alt_from_filename(self):
        node = {"html": '<img src="/jacket.svg">'}
        file_content = 'return <img src={image} />'
        patch = _fallback_patch(self.RULE, node, file_content)
        assert patch is not None
        assert patch["before"] == '<img src={image} />'
        assert patch["after"] == '<img src={image} alt="Jacket" />'
        assert validate_patch(file_content, patch["before"], patch["after"]) is True

    def test_multi_word_filename_title_cased(self):
        node = {"html": '<img src="/trail-jacket_v2.png">'}
        patch = _fallback_patch(self.RULE, node, 'return <img src={image} />')
        assert patch["after"] == '<img src={image} alt="Trail Jacket V2" />'

    def test_no_src_falls_back_to_generic_alt(self):
        node = {"html": "<img>"}
        patch = _fallback_patch(self.RULE, node, 'return <img src={image} />')
        assert patch["after"] == '<img src={image} alt="Image" />'

    def test_already_has_alt_returns_none(self):
        node = {"html": '<img src="/jacket.svg">'}
        file_content = 'return <img src={image} alt="Existing" />'
        assert _fallback_patch(self.RULE, node, file_content) is None


class TestFallbackPatchLabel:
    RULE = {"id": "label"}
    FILE = (
        'return (\n'
        '  <form>\n'
        '    <input type="email" placeholder="Work email" />\n'
        '    <input type="text" placeholder="Message" />\n'
        '  </form>\n'
        ')'
    )

    def test_targets_the_specific_input_by_placeholder(self):
        node = {"html": '<input type="email" placeholder="Work email">'}
        patch = _fallback_patch(self.RULE, node, self.FILE)
        assert patch is not None
        assert patch["before"] == '<input type="email" placeholder="Work email" />'
        assert patch["after"] == '<input type="email" placeholder="Work email" aria-label="Work email" />'
        assert validate_patch(self.FILE, patch["before"], patch["after"]) is True

    def test_second_input_targeted_independently(self):
        node = {"html": '<input type="text" placeholder="Message">'}
        patch = _fallback_patch(self.RULE, node, self.FILE)
        assert patch["before"] == '<input type="text" placeholder="Message" />'
        assert patch["after"] == '<input type="text" placeholder="Message" aria-label="Message" />'

    def test_no_placeholder_returns_none(self):
        node = {"html": "<input>"}
        assert _fallback_patch(self.RULE, node, self.FILE) is None

    def test_already_has_aria_label_returns_none(self):
        node = {"html": '<input type="email" placeholder="Work email">'}
        file_content = '<input type="email" placeholder="Work email" aria-label="Already set" />'
        assert _fallback_patch(self.RULE, node, file_content) is None


class TestParseGithubRepo:
    def test_parses_https_url(self):
        assert _parse_github_repo("https://github.com/acme/example-site") == ("acme", "example-site")

    def test_parses_url_with_git_suffix(self):
        assert _parse_github_repo("https://github.com/acme/example-site.git") == ("acme", "example-site")

    def test_non_github_url_returns_none(self):
        assert _parse_github_repo("https://gitlab.com/acme/example-site") is None


class TestPrBody:
    def test_includes_before_after_and_file_location(self):
        rule = {"id": "button-name", "help": "Buttons must have discernible text", "description": "..."}
        patch = {"before": '<button className="menu-btn">', "after": '<button className="menu-btn" aria-label="Menu">'}
        body = _pr_body(rule, {}, patch, "src/Header.jsx", 6)
        assert "src/Header.jsx:6" in body
        assert patch["before"] in body
        assert patch["after"] in body
        assert "button-name" in body


class TestLocateSourceHtmlHasLang:
    def test_finds_html_tag_in_html_file(self, tmp_path):
        (tmp_path / "index.html").write_text(
            "<!doctype html>\n<html>\n  <head></head>\n  <body></body>\n</html>\n",
            encoding="utf-8",
        )
        result = locate_source(tmp_path, "<html>", rule_id="html-has-lang")
        assert result == ("index.html", 2)

    def test_ignores_jsx_files_for_this_rule(self, tmp_path):
        # A .jsx file happening to contain the literal text "<html" shouldn't count.
        (tmp_path / "Weird.jsx").write_text("const s = '<html>';", encoding="utf-8")
        assert locate_source(tmp_path, "<html>", rule_id="html-has-lang") is None

    def test_no_html_file_returns_none(self, tmp_path):
        (tmp_path / "Header.jsx").write_text("<button>x</button>", encoding="utf-8")
        assert locate_source(tmp_path, "<html>", rule_id="html-has-lang") is None

    def test_picks_the_one_page_missing_lang_in_a_multi_page_site(self, tmp_path):
        # A bare <html> tag-name needle would match every page and bail as
        # ambiguous, even though only one of them actually lacks lang=.
        (tmp_path / "index.html").write_text('<html lang="en">\n<body></body>\n</html>', encoding="utf-8")
        (tmp_path / "contact.html").write_text('<html lang="en">\n<body></body>\n</html>', encoding="utf-8")
        (tmp_path / "media.html").write_text("<html>\n<body></body>\n</html>", encoding="utf-8")
        result = locate_source(tmp_path, "<html>", rule_id="html-has-lang")
        assert result == ("media.html", 1)


class TestFallbackPatchHtmlHasLang:
    RULE = {"id": "html-has-lang"}

    def test_adds_lang_en(self):
        file_content = "<!doctype html>\n<html>\n<head></head>\n</html>\n"
        patch = _fallback_patch(self.RULE, {}, file_content)
        assert patch is not None
        assert patch["before"] == "<html>"
        assert patch["after"] == '<html lang="en">'
        assert validate_patch(file_content, patch["before"], patch["after"]) is True

    def test_already_has_lang_returns_none(self):
        file_content = '<html lang="fr">\n<head></head>\n</html>\n'
        assert _fallback_patch(self.RULE, {}, file_content) is None


class TestFallbackPatchLinkName:
    RULE = {"id": "link-name"}
    NODE = {"html": '<a class="product-link" href="#">Click here</a>'}
    FILE = 'return <a href="#" className="product-link">Click here</a>'

    def test_adds_label_inferred_from_class(self):
        # Was asserted as the generic "Learn more" before the fallback fixer
        # became context-aware — "product-link" -> "Product" is exactly the
        # kind of real, class-derived label the ticket asked for instead.
        patch = _fallback_patch(self.RULE, self.NODE, self.FILE)
        assert patch is not None
        assert patch["after"] == '<a href="#" className="product-link" aria-label="Product">'
        assert validate_patch(self.FILE, patch["before"], patch["after"]) is True

    def test_classless_link_now_fixed_using_its_own_text(self):
        # Previously returned None purely because the old matcher required a
        # `class` attribute just to re-find the element — locate_source could
        # already find a classless <a>, so the fallback fixer should too.
        node = {"html": '<a href="#">Click here</a>'}
        file_content = 'return <a href="#">Click here</a>'
        patch = _fallback_patch(self.RULE, node, file_content)
        assert patch is not None
        assert patch["before"] == '<a href="#">'
        assert patch["after"] == '<a href="#" aria-label="Click here">'
        assert validate_patch(file_content, patch["before"], patch["after"]) is True

    def test_already_has_aria_label_returns_already_fixed(self):
        file_content = 'return <a href="#" className="product-link" aria-label="Existing">Click here</a>'
        assert _fallback_patch(self.RULE, self.NODE, file_content) is ALREADY_FIXED


class TestFallbackPatchHeadingOrder:
    RULE = {"id": "heading-order"}

    def test_shifts_heading_down_one_level_with_class(self):
        node = {"html": '<h3 class="section-label">Outdoor gear for every trail</h3>'}
        file_content = '<h1>New Arrivals</h1>\n<h3 className="section-label">Outdoor gear for every trail</h3>'
        patch = _fallback_patch(self.RULE, node, file_content)
        assert patch is not None
        assert patch["before"] == '<h3 className="section-label">Outdoor gear for every trail</h3>'
        assert patch["after"] == '<h2 className="section-label">Outdoor gear for every trail</h2>'
        assert validate_patch(file_content, patch["before"], patch["after"]) is True

    def test_shifts_heading_without_class(self):
        node = {"html": "<h4>Section</h4>"}
        file_content = "<h4>Section</h4>"
        patch = _fallback_patch(self.RULE, node, file_content)
        assert patch["before"] == "<h4>Section</h4>"
        assert patch["after"] == "<h3>Section</h3>"

    def test_h1_returns_none(self):
        node = {"html": "<h1>Top</h1>"}
        assert _fallback_patch(self.RULE, node, "<h1>Top</h1>") is None

    def test_no_heading_tag_returns_none(self):
        node = {"html": "<p>Not a heading</p>"}
        assert _fallback_patch(self.RULE, node, "<p>Not a heading</p>") is None


class TestContrastMath:
    def test_black_on_white_is_max_contrast(self):
        ratio = _contrast_ratio(_hex_to_rgb("#000000"), _hex_to_rgb("#ffffff"))
        assert round(ratio, 1) == 21.0

    def test_same_color_is_minimum_contrast(self):
        ratio = _contrast_ratio(_hex_to_rgb("#777777"), _hex_to_rgb("#777777"))
        assert round(ratio, 2) == 1.0

    def test_adjust_to_ratio_meets_target(self):
        new_fg = _adjust_to_ratio("#cfcfcf", "#ffffff", 4.5)
        ratio = _contrast_ratio(_hex_to_rgb(new_fg), _hex_to_rgb("#ffffff"))
        assert ratio >= 4.5

    def test_adjust_moves_toward_black_on_light_background(self):
        new_fg = _adjust_to_ratio("#cfcfcf", "#ffffff", 4.5)
        # every channel should have moved down (darker), never up
        old_rgb, new_rgb = _hex_to_rgb("#cfcfcf"), _hex_to_rgb(new_fg)
        assert all(new_rgb[i] <= old_rgb[i] for i in range(3))

    def test_adjust_moves_toward_white_on_dark_background(self):
        new_fg = _adjust_to_ratio("#333333", "#000000", 4.5)
        old_rgb, new_rgb = _hex_to_rgb("#333333"), _hex_to_rgb(new_fg)
        assert all(new_rgb[i] >= old_rgb[i] for i in range(3))
        ratio = _contrast_ratio(_hex_to_rgb(new_fg), _hex_to_rgb("#000000"))
        assert ratio >= 4.5

    def test_already_compliant_color_barely_moves(self):
        # #767676 on white is already ~4.54:1 — should need no/minimal adjustment.
        new_fg = _adjust_to_ratio("#767676", "#ffffff", 4.5)
        ratio = _contrast_ratio(_hex_to_rgb(new_fg), _hex_to_rgb("#ffffff"))
        assert ratio >= 4.5


class TestParseContrastData:
    def test_reads_structured_axe_data(self):
        node = {
            "any": [{"id": "color-contrast", "data": {
                "fgColor": "#cfcfcf", "bgColor": "#ffffff", "expectedContrastRatio": "4.5:1",
            }}],
        }
        assert _parse_contrast_data(node) == ("#cfcfcf", "#ffffff", 4.5)

    def test_falls_back_to_failure_summary_text(self):
        node = {
            "failureSummary": (
                "Fix any of the following:\n  Element has insufficient color contrast of 1.55 "
                "(foreground color: #cfcfcf, background color: #ffffff, font size: 9.6pt, "
                "font weight: normal). Expected contrast ratio of 4.5:1"
            ),
        }
        assert _parse_contrast_data(node) == ("#cfcfcf", "#ffffff", 4.5)

    def test_no_data_returns_none(self):
        assert _parse_contrast_data({}) is None


class TestLocateSourceColorContrast:
    def test_finds_css_rule_by_class_selector(self, tmp_path):
        (tmp_path / "style.css").write_text(
            ".header {\n  color: black;\n}\n\n.fine-print {\n  color: #cfcfcf;\n}\n",
            encoding="utf-8",
        )
        result = locate_source(tmp_path, '<p class="fine-print">x</p>', rule_id="color-contrast")
        assert result == ("style.css", 5)

    def test_ignores_jsx_files(self, tmp_path):
        (tmp_path / "Widget.jsx").write_text('<p className="fine-print">x</p>', encoding="utf-8")
        assert locate_source(tmp_path, '<p class="fine-print">x</p>', rule_id="color-contrast") is None

    def test_finds_rule_in_inline_style_block_of_html_file(self, tmp_path):
        # Static sites often keep CSS in a <style> tag on the page itself
        # rather than a separate stylesheet.
        (tmp_path / "index.html").write_text(
            "<html>\n<head>\n<style>\n.fine-print {\n  color: #cfcfcf;\n}\n</style>\n</head>\n</html>\n",
            encoding="utf-8",
        )
        result = locate_source(tmp_path, '<p class="fine-print">x</p>', rule_id="color-contrast")
        assert result == ("index.html", 4)


class TestFallbackPatchColorContrast:
    RULE = {"id": "color-contrast"}
    NODE = {"any": [{"data": {"fgColor": "#cfcfcf", "bgColor": "#ffffff", "expectedContrastRatio": "4.5:1"}}]}

    def test_replaces_color_with_compliant_value(self):
        file_content = ".fine-print {\n  color: #cfcfcf;\n  font-size: 0.8rem;\n}\n"
        patch = _fallback_patch(self.RULE, self.NODE, file_content)
        assert patch is not None
        assert patch["before"] == "color: #cfcfcf"
        assert validate_patch(file_content, patch["before"], patch["after"]) is True
        new_hex = patch["after"].split(":")[1].strip()
        ratio = _contrast_ratio(_hex_to_rgb(new_hex), _hex_to_rgb("#ffffff"))
        assert ratio >= 4.5

    def test_no_contrast_data_returns_none(self):
        assert _fallback_patch(self.RULE, {}, ".x { color: #cfcfcf; }") is None

    def test_color_not_found_in_file_returns_none(self):
        assert _fallback_patch(self.RULE, self.NODE, ".x { color: #123456; }") is None


class TestIsAutoMergeEligible:
    def test_fallback_rule_eligible_when_no_api_key(self):
        with mock_patch("backend.services.auto_fix_service.Config.GEMINI_API_KEY", ""):
            assert is_auto_merge_eligible("button-name") is True

    def test_fallback_rule_still_eligible_once_api_key_configured(self):
        # Fallback rules always route to the deterministic fallback, key or not.
        with mock_patch("backend.services.auto_fix_service.Config.GEMINI_API_KEY", "gm-real-key"):
            assert is_auto_merge_eligible("button-name") is True

    def test_non_fallback_rule_never_eligible(self):
        with mock_patch("backend.services.auto_fix_service.Config.GEMINI_API_KEY", ""):
            assert is_auto_merge_eligible("aria-required-children") is False


class TestParseTargetChain:
    """axe's `target` CSS selector path -> an ordered ancestor chain."""

    def test_simple_two_segment_chain(self):
        chain = _parse_target_chain(["button.download-btn > svg"])
        assert chain == [
            {"tag": "button", "id": None, "classes": ["download-btn"], "nth": None},
            {"tag": "svg", "id": None, "classes": [], "nth": None},
        ]

    def test_id_and_nth_child(self):
        chain = _parse_target_chain(["div.card:nth-child(2) > button#buy > svg"])
        assert chain[0] == {"tag": "div", "id": None, "classes": ["card"], "nth": 2}
        assert chain[1] == {"tag": "button", "id": "buy", "classes": [], "nth": None}
        assert chain[2] == {"tag": "svg", "id": None, "classes": [], "nth": None}

    def test_takes_last_selector_of_a_list(self):
        # A list only matters for iframe-nested content — the last entry is
        # the one that describes the actual element, same scope as today.
        chain = _parse_target_chain(["iframe", "button.icon-btn"])
        assert chain[-1]["classes"] == ["icon-btn"]

    def test_none_or_empty_returns_empty_chain(self):
        assert _parse_target_chain(None) == []
        assert _parse_target_chain([]) == []
        assert _parse_target_chain([""]) == []


class TestLocateSourceAncestorScoping:
    """
    The core fix: an element with no id/class of its own (a bare <svg>, the
    ticket's exact reported case) is scoped to its nearest identified ancestor
    from axe's `target` selector, instead of falling straight to a bare tag
    search across the whole repo. Not SVG-specific — the same mechanism is
    exercised with a <path> and a plain <span> child too.
    """

    def test_unique_svg_inside_a_uniquely_classed_button(self, tmp_path):
        (tmp_path / "Header.jsx").write_text(
            'export default function Header() {\n'
            '  return (\n'
            '    <button class="download-btn">\n'
            '      <svg width="16" height="16"><rect/></svg>\n'
            '    </button>\n'
            '  );\n'
            '}\n',
            encoding="utf-8",
        )
        result = locate_source(
            tmp_path, '<svg width="16" height="16"><rect></rect></svg>',
            rule_id="button-name", target=["button.download-btn > svg"],
        )
        # The target <svg> itself is on line 4 — the ancestor <button> (line 3)
        # is only used to scope the search to a unique candidate, the line
        # number returned must point at the actual violating element.
        assert result == ("Header.jsx", 4)

    def test_bare_svg_without_ancestor_context_still_fails_when_repo_has_many(self, tmp_path):
        # Confirms the failure mode is genuinely about missing context, not
        # that svg elements are special-cased to always succeed or always fail.
        (tmp_path / "A.jsx").write_text('<button class="a"><svg/></button>', encoding="utf-8")
        (tmp_path / "B.jsx").write_text('<button class="b"><svg/></button>', encoding="utf-8")
        (tmp_path / "C.jsx").write_text('<button class="c"><svg/></button>', encoding="utf-8")
        # No target selector at all this time — nothing to scope the bare <svg> to.
        assert locate_source(tmp_path, "<svg></svg>", rule_id="button-name") is None

    def test_multiple_svgs_in_the_same_file_disambiguated_by_ancestor(self, tmp_path):
        (tmp_path / "Toolbar.jsx").write_text(
            'export default function Toolbar() {\n'
            '  return (\n'
            '    <div>\n'
            '      <button class="download-btn"><svg>A</svg></button>\n'
            '      <button class="share-btn"><svg>B</svg></button>\n'
            '    </div>\n'
            '  );\n'
            '}\n',
            encoding="utf-8",
        )
        result = locate_source(
            tmp_path, "<svg>A</svg>", rule_id="button-name", target=["button.download-btn > svg"],
        )
        assert result == ("Toolbar.jsx", 4)
        result_b = locate_source(
            tmp_path, "<svg>B</svg>", rule_id="button-name", target=["button.share-btn > svg"],
        )
        assert result_b == ("Toolbar.jsx", 5)

    def test_same_structure_in_multiple_files_stays_ambiguous(self, tmp_path):
        # Genuinely indistinguishable: same ancestor class, same element, in
        # two different files — must fail safe, not guess either one.
        (tmp_path / "A.jsx").write_text('<button class="download-btn"><svg/></button>', encoding="utf-8")
        (tmp_path / "B.jsx").write_text('<button class="download-btn"><svg/></button>', encoding="utf-8")
        result = locate_source(
            tmp_path, "<svg></svg>", rule_id="button-name", target=["button.download-btn > svg"],
        )
        assert result is None

    def test_svg_inside_a_button_identified_by_id_instead_of_class(self, tmp_path):
        (tmp_path / "Header.jsx").write_text('<button id="download"><svg/></button>', encoding="utf-8")
        result = locate_source(
            tmp_path, "<svg></svg>", rule_id="button-name", target=["button#download > svg"],
        )
        assert result == ("Header.jsx", 1)

    def test_svg_inside_a_unique_link(self, tmp_path):
        (tmp_path / "Footer.jsx").write_text('<a class="social-link"><svg/></a>', encoding="utf-8")
        result = locate_source(
            tmp_path, "<svg></svg>", rule_id="link-name", target=["a.social-link > svg"],
        )
        assert result == ("Footer.jsx", 1)

    def test_non_svg_generic_child_also_benefits(self, tmp_path):
        # Not SVG-specific: a bare <path> (no class/id) inside a uniquely
        # classed <svg> ancestor resolves the same way.
        (tmp_path / "Icon.jsx").write_text('<svg class="check-icon"><path d="M0 0"/></svg>', encoding="utf-8")
        result = locate_source(
            tmp_path, '<path d="M0 0"></path>', rule_id="button-name", target=["svg.check-icon > path"],
        )
        assert result == ("Icon.jsx", 1)


class TestLocateSourceIdClassHardGate:
    """
    An element that positively carries an id or class of its own uses ONLY
    that signal — succeed or fail — rather than degrading to a weaker,
    unrelated one. This is the original "class present" behavior, generalized
    to also cover id; regression-tested here because a first draft of this
    rewrite broke it (a class that matched nothing was falling through to an
    unrelated bare-tag match elsewhere in the repo).
    """

    def test_absent_class_does_not_fall_back_to_unrelated_bare_tag(self, tmp_path):
        (tmp_path / "Header.jsx").write_text('<button className="other">x</button>', encoding="utf-8")
        assert locate_source(tmp_path, '<button class="menu-btn">x</button>') is None

    def test_id_is_preferred_over_class_when_both_present(self, tmp_path):
        (tmp_path / "A.jsx").write_text('<button id="unique-btn" class="shared">x</button>', encoding="utf-8")
        # Two other files share the SAME class but not the id — if class were
        # used, this would be ambiguous; id alone must resolve it cleanly.
        (tmp_path / "B.jsx").write_text('<button class="shared">y</button>', encoding="utf-8")
        (tmp_path / "C.jsx").write_text('<button class="shared">z</button>', encoding="utf-8")
        result = locate_source(tmp_path, '<button id="unique-btn" class="shared">x</button>')
        assert result == ("A.jsx", 1)


class TestLocateSourceDuplicateClassNames:
    """A .map()-rendered list of otherwise-identical elements — resolved by
    axe's own nth-child/nth-of-type position, never a blind first match."""

    def test_picks_the_occurrence_matching_target_nth_of_type(self, tmp_path):
        (tmp_path / "ProductGrid.jsx").write_text(
            'export default function ProductGrid() {\n'
            '  return (\n'
            '    <div>\n'
            '      <button class="icon-btn">1</button>\n'
            '      <button class="icon-btn">2</button>\n'
            '      <button class="icon-btn">3</button>\n'
            '    </div>\n'
            '  );\n'
            '}\n',
            encoding="utf-8",
        )
        result = locate_source(
            tmp_path, '<button class="icon-btn">2</button>',
            target=["button.icon-btn:nth-of-type(2)"],
        )
        assert result == ("ProductGrid.jsx", 5)

    def test_no_nth_hint_leaves_it_ambiguous(self, tmp_path):
        (tmp_path / "ProductGrid.jsx").write_text(
            '<button class="icon-btn">1</button>\n<button class="icon-btn">2</button>\n',
            encoding="utf-8",
        )
        assert locate_source(tmp_path, '<button class="icon-btn">1</button>') is None

    def test_fallback_patch_edits_the_occurrence_at_line_no_not_the_first(self):
        file_content = (
            '<button class="icon-btn"></button>\n'
            '<button class="icon-btn"></button>\n'
            '<button class="icon-btn"></button>\n'
        )
        rule = {"id": "button-name"}
        node = {"html": '<button class="icon-btn"></button>'}
        patch = _fallback_patch(rule, node, file_content, line_no=2)
        assert patch is not None
        # The widened window must be anchored on line 2, not line 1 — proven by
        # requiring the SECOND line's worth of surrounding text in "before".
        assert file_content.count(patch["before"]) == 1
        rebuilt = file_content.replace(patch["before"], patch["after"], 1)
        lines = rebuilt.splitlines()
        assert 'aria-label="Menu"' in lines[1]
        assert 'aria-label="Menu"' not in lines[0]
        assert 'aria-label="Menu"' not in lines[2]


class TestLocateSourceFileTypes:
    """The generic locate path now searches .js/.ts/.vue/.svelte too, not just
    .jsx/.tsx/.html, and excludes generated/dependency directories."""

    def test_tsx_source(self, tmp_path):
        (tmp_path / "Header.tsx").write_text('<button class="menu-btn"><svg/></button>', encoding="utf-8")
        assert locate_source(tmp_path, '<button class="menu-btn"><svg></svg></button>') == ("Header.tsx", 1)

    def test_plain_html_source(self, tmp_path):
        (tmp_path / "index.html").write_text('<button class="menu-btn"><svg/></button>', encoding="utf-8")
        assert locate_source(tmp_path, '<button class="menu-btn"><svg></svg></button>') == ("index.html", 1)

    def test_vue_single_file_component(self, tmp_path):
        (tmp_path / "Header.vue").write_text(
            '<template>\n  <button class="menu-btn"><svg/></button>\n</template>\n', encoding="utf-8",
        )
        assert locate_source(tmp_path, '<button class="menu-btn"><svg></svg></button>') == ("Header.vue", 2)

    def test_svelte_component(self, tmp_path):
        (tmp_path / "Header.svelte").write_text('<button class="menu-btn"><svg/></button>', encoding="utf-8")
        assert locate_source(tmp_path, '<button class="menu-btn"><svg></svg></button>') == ("Header.svelte", 1)

    def test_dist_build_copies_are_never_selected(self, tmp_path):
        dist = tmp_path / "dist"
        dist.mkdir()
        (dist / "Header.jsx").write_text('<button class="menu-btn"><svg/></button>', encoding="utf-8")
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "Header.jsx").write_text('<button class="menu-btn"><svg/></button>', encoding="utf-8")
        result = locate_source(tmp_path, '<button class="menu-btn"><svg></svg></button>')
        assert result == ("src/Header.jsx", 1)

    def test_build_and_coverage_dirs_also_excluded(self, tmp_path):
        for d in ("build", "coverage", ".cache"):
            sub = tmp_path / d
            sub.mkdir()
            (sub / "Header.jsx").write_text('<button class="unique-x"><svg/></button>', encoding="utf-8")
        (tmp_path / "Header.jsx").write_text('<button class="unique-x"><svg/></button>', encoding="utf-8")
        result = locate_source(tmp_path, '<button class="unique-x"><svg></svg></button>')
        assert result == ("Header.jsx", 1)


class TestAiDisambiguate:
    """
    Last-resort disambiguation — only reachable when deterministic scoring
    still ends ambiguous AND a Gemini key is configured. Every test here
    mocks the HTTP call; none hit the real API.
    """

    CANDIDATES = [
        ("src/Header.jsx", 4, 'return <button class="download-btn"><svg>A</svg></button>'),
        ("src/Menu.jsx", 9, 'return <button class="download-btn"><svg>A</svg></button>'),
    ]

    def _mock_response(self, payload_text):
        class _Resp:
            def __enter__(self_inner): return self_inner
            def __exit__(self_inner, *a): return False
            def read(self_inner): return json.dumps(
                {"candidates": [{"content": {"parts": [{"text": payload_text}]}}]}
            ).encode()
        return _Resp()

    def test_no_api_key_returns_none_without_any_network_call(self):
        with mock_patch("backend.services.auto_fix_service.Config.GEMINI_API_KEY", ""), \
             mock_patch("urllib.request.urlopen") as mock_open:
            assert _ai_disambiguate("button-name", "<svg></svg>", ["button.x > svg"], self.CANDIDATES) is None
            mock_open.assert_not_called()

    def test_no_candidates_returns_none_without_any_network_call(self):
        with mock_patch("backend.services.auto_fix_service.Config.GEMINI_API_KEY", "gm-key"), \
             mock_patch("urllib.request.urlopen") as mock_open:
            assert _ai_disambiguate("button-name", "<svg></svg>", ["button.x > svg"], []) is None
            mock_open.assert_not_called()

    def test_high_confidence_selects_the_named_candidate(self):
        reply = json.dumps({
            "selected_file": "src/Header.jsx", "reason": "matches DOM hierarchy", "confidence": 0.96,
        })
        with mock_patch("backend.services.auto_fix_service.Config.GEMINI_API_KEY", "gm-key"), \
             mock_patch("urllib.request.urlopen", return_value=self._mock_response(reply)):
            result = _ai_disambiguate("button-name", "<svg>A</svg>", ["button.download-btn > svg"], self.CANDIDATES)
        assert result == ("src/Header.jsx", 4)

    def test_low_confidence_is_treated_as_no_answer(self):
        reply = json.dumps({"selected_file": "src/Header.jsx", "reason": "not sure", "confidence": 0.4})
        with mock_patch("backend.services.auto_fix_service.Config.GEMINI_API_KEY", "gm-key"), \
             mock_patch("urllib.request.urlopen", return_value=self._mock_response(reply)):
            result = _ai_disambiguate("button-name", "<svg>A</svg>", ["button.download-btn > svg"], self.CANDIDATES)
        assert result is None

    def test_unrecognized_file_name_is_ignored(self):
        reply = json.dumps({"selected_file": "src/NotInList.jsx", "reason": "x", "confidence": 0.99})
        with mock_patch("backend.services.auto_fix_service.Config.GEMINI_API_KEY", "gm-key"), \
             mock_patch("urllib.request.urlopen", return_value=self._mock_response(reply)):
            result = _ai_disambiguate("button-name", "<svg>A</svg>", ["button.download-btn > svg"], self.CANDIDATES)
        assert result is None

    def test_malformed_json_response_fails_safe(self):
        with mock_patch("backend.services.auto_fix_service.Config.GEMINI_API_KEY", "gm-key"), \
             mock_patch("urllib.request.urlopen", return_value=self._mock_response("not json at all")):
            result = _ai_disambiguate("button-name", "<svg>A</svg>", ["button.download-btn > svg"], self.CANDIDATES)
        assert result is None

    def test_network_exception_fails_safe(self):
        with mock_patch("backend.services.auto_fix_service.Config.GEMINI_API_KEY", "gm-key"), \
             mock_patch("urllib.request.urlopen", side_effect=OSError("boom")):
            result = _ai_disambiguate("button-name", "<svg>A</svg>", ["button.download-btn > svg"], self.CANDIDATES)
        assert result is None

    def test_ambiguous_svg_resolved_end_to_end_via_ai_when_deterministic_fails(self, tmp_path):
        # Full integration: two files share the exact same ancestor-scoped
        # structure (deterministic scoring alone can't separate them), but
        # their surrounding code differs enough that a real disambiguation
        # step could — this proves locate_source actually wires the AI path
        # in, using a mocked response standing in for that real judgement.
        (tmp_path / "Header.jsx").write_text(
            '// The main site header, always visible\n'
            'export default function Header() {\n'
            '  return <button class="download-btn"><svg>A</svg></button>;\n'
            '}\n',
            encoding="utf-8",
        )
        (tmp_path / "Archived.jsx").write_text(
            '// UNUSED: kept for reference only, not imported anywhere\n'
            'export default function Archived() {\n'
            '  return <button class="download-btn"><svg>A</svg></button>;\n'
            '}\n',
            encoding="utf-8",
        )
        reply = json.dumps({
            "selected_file": "Header.jsx",
            "reason": "Archived.jsx is explicitly marked unused; Header.jsx is the live component.",
            "confidence": 0.9,
        })
        with mock_patch("backend.services.auto_fix_service.Config.GEMINI_API_KEY", "gm-key"), \
             mock_patch("urllib.request.urlopen", return_value=self._mock_response(reply)):
            result = locate_source(
                tmp_path, "<svg>A</svg>", rule_id="button-name", target=["button.download-btn > svg"],
            )
        assert result == ("Header.jsx", 3)


class TestPickMatchByLine:
    def test_no_line_hint_returns_first_match(self):
        text = "aaa\nbbb\naaa\n"
        matches = list(re.finditer("aaa", text))
        assert _pick_match_by_line(matches, text, None) is matches[0]

    def test_picks_match_nearest_given_line(self):
        text = "aaa\naaa\naaa\n"
        matches = list(re.finditer("aaa", text))
        chosen = _pick_match_by_line(matches, text, line_no=2)
        assert text[:chosen.start()].count("\n") + 1 == 2

    def test_empty_matches_returns_none(self):
        assert _pick_match_by_line([], "anything", 1) is None


class TestWidenUntilUnique:
    def test_already_unique_returned_unchanged(self):
        file_content = "one\ntwo\nthree\n"
        result = _widen_until_unique(file_content, file_content.index("two"), "two", "TWO")
        assert result == {"before": "two", "after": "TWO"}

    def test_widens_until_the_window_is_unique(self):
        file_content = (
            "context-a\n"
            "<button class=\"icon-btn\"></button>\n"
            "context-b\n"
            "<button class=\"icon-btn\"></button>\n"
        )
        start = file_content.index('<button class="icon-btn"></button>\ncontext-b')
        result = _widen_until_unique(
            file_content, start, '<button class="icon-btn"></button>',
            '<button class="icon-btn" aria-label="Menu"></button>',
        )
        assert result is not None
        assert file_content.count(result["before"]) == 1
        assert "context-a" in result["before"] or "context-b" in result["before"]

    def test_gives_up_safely_when_never_unique_within_the_cap(self):
        # Ten byte-identical lines in a row — no amount of small widening
        # (max_lines default is 4) makes any window unique.
        file_content = ("<button class=\"icon-btn\"></button>\n" * 10)
        result = _widen_until_unique(
            file_content, file_content.index('<button class="icon-btn"></button>'),
            '<button class="icon-btn"></button>', '<button class="icon-btn" aria-label="Menu"></button>',
        )
        assert result is None


class TestScanTagEnd:
    def test_simple_tag(self):
        end, tag, self_closing = _scan_tag_end("<button>x</button>", 0)
        assert (end, tag, self_closing) == (len("<button>"), "button", False)

    def test_self_closing_tag(self):
        end, tag, self_closing = _scan_tag_end('<img src="x.png" />rest', 0)
        assert (end, tag, self_closing) == (len('<img src="x.png" />'), "img", True)

    def test_jsx_attribute_expression_containing_gt_does_not_end_tag_early(self):
        # The whole point of this scanner over a `[^>]*?` regex: an arrow
        # function or comparison inside a JSX attribute expression contains a
        # '>' that must NOT be mistaken for the tag's own closing '>'.
        html = '<button onClick={() => x > 1 ? doA() : doB()}>Click</button>'
        end, tag, self_closing = _scan_tag_end(html, 0)
        assert html[:end] == '<button onClick={() => x > 1 ? doA() : doB()}>'
        assert tag == "button"
        assert self_closing is False

    def test_quoted_attribute_value_containing_gt(self):
        html = '<a title="a > b">text</a>'
        end, tag, self_closing = _scan_tag_end(html, 0)
        assert html[:end] == '<a title="a > b">'

    def test_custom_component_tag_name(self):
        end, tag, self_closing = _scan_tag_end("<DownloadIcon />", 0)
        assert tag == "DownloadIcon"
        assert self_closing is True

    def test_unclosed_tag_returns_none(self):
        assert _scan_tag_end("<button onClick={doThing", 0) is None


class TestFindTagOccurrences:
    def test_finds_all_matching_tags_with_line_numbers(self):
        file_content = "<button>a</button>\n<div>skip</div>\n<button>b</button>\n"
        occurrences = _find_tag_occurrences(file_content, ("button",))
        assert [o["line"] for o in occurrences] == [1, 3]
        assert [o["full"] for o in occurrences] == ["<button>", "<button>"]

    def test_ignores_tags_not_in_the_requested_set(self):
        occurrences = _find_tag_occurrences("<a>x</a><button>y</button>", ("a",))
        assert len(occurrences) == 1
        assert occurrences[0]["tag"] == "a"


class TestLocatePatchTarget:
    def test_exact_line_match(self):
        file_content = "<div>\n<button class=\"x\"></button>\n</div>\n"
        target = _locate_patch_target(file_content, line_no=2, tag_names=("button",))
        assert target is not None
        assert target["line"] == 2

    def test_falls_back_to_enclosing_tag_when_line_no_points_at_a_different_tag(self):
        # locate_source resolved line_no via the element's OWN class (a classed
        # <svg>), not ancestor-scoping — the svg itself isn't a button-name
        # fix target, but it's nested inside one that is.
        file_content = (
            '<button>\n'
            '  <svg class="icon"></svg>\n'
            '</button>\n'
        )
        target = _locate_patch_target(file_content, line_no=2, tag_names=("button",))
        assert target is not None
        assert target["tag"] == "button"
        assert target["line"] == 1

    def test_no_line_no_and_single_occurrence_resolves(self):
        target = _locate_patch_target("<button>x</button>", line_no=None, tag_names=("button",))
        assert target is not None

    def test_no_line_no_and_multiple_occurrences_is_ambiguous(self):
        file_content = "<button>a</button><button>b</button>"
        assert _locate_patch_target(file_content, line_no=None, tag_names=("button",)) is None

    def test_nothing_matches_returns_none(self):
        assert _locate_patch_target("<div>only a div</div>", line_no=1, tag_names=("button",)) is None


class TestFindEnclosingTag:
    def test_finds_the_immediate_enclosing_tag(self):
        file_content = '<button>\n  <span><svg></svg></span>\n</button>\n'
        pos = file_content.index("<svg>")
        result = _find_enclosing_tag(file_content, pos, ("button",))
        assert result is not None
        assert result["tag"] == "button"

    def test_position_outside_any_candidate_returns_none(self):
        file_content = '<div><svg></svg></div>'
        pos = file_content.index("<svg>")
        assert _find_enclosing_tag(file_content, pos, ("button", "a")) is None

    def test_self_closing_candidate_cannot_enclose_anything(self):
        file_content = '<button />\n<svg></svg>\n'
        pos = file_content.index("<svg>")
        assert _find_enclosing_tag(file_content, pos, ("button",)) is None


class TestInferAccessibleName:
    def test_component_name_takes_priority(self):
        label, source = _infer_accessible_name('<button><DownloadIcon /></button>', "Menu")
        assert (label, source) == ("Download", "component name")

    def test_class_derived_when_no_component(self):
        label, source = _infer_accessible_name('<button class="download-btn"></button>', "Menu")
        assert (label, source) == ("Download", "id/class")

    def test_id_derived_when_no_class_or_component(self):
        label, source = _infer_accessible_name('<button id="download-action"></button>', "Menu")
        assert (label, source) == ("Download Action", "id/class")

    def test_purely_decorative_class_is_rejected_falls_through(self):
        # "icon-btn" strips to just "icon" — itself meaningless, so this must
        # NOT be used; nothing else is available here, so it's the last resort.
        label, source = _infer_accessible_name('<button class="icon-btn"></button>', "Menu")
        assert (label, source) == ("Menu", "last-resort default")

    def test_href_derived_for_links(self):
        label, source = _infer_accessible_name('<a href="/download-report"></a>', "Learn more")
        assert (label, source) == ("Download Report", "href")

    def test_fragment_only_href_has_no_signal(self):
        label, source = _infer_accessible_name('<a href="#"></a>', "Learn more")
        assert source != "href"

    def test_text_content_used_when_nothing_else_available(self):
        label, source = _infer_accessible_name('<a href="#">Contact us</a>', "Learn more")
        assert (label, source) == ("Contact us", "text content")

    def test_last_resort_when_truly_nothing_available(self):
        label, source = _infer_accessible_name('<button></button>', "Menu")
        assert (label, source) == ("Menu", "last-resort default")


class TestApplyAttribute:
    def test_non_self_closing(self):
        tag_info = {"tag": "button", "attrs": ' class="x"', "self_closing": False, "full": '<button class="x">'}
        patch = _apply_attribute(tag_info, "aria-label", "Menu")
        assert patch == {"before": '<button class="x">', "after": '<button class="x" aria-label="Menu">'}

    def test_self_closing(self):
        tag_info = {"tag": "img", "attrs": ' src="x.png" ', "self_closing": True, "full": '<img src="x.png" />'}
        patch = _apply_attribute(tag_info, "alt", "X")
        assert patch == {"before": '<img src="x.png" />', "after": '<img src="x.png" alt="X" />'}

    def test_no_existing_attrs(self):
        tag_info = {"tag": "button", "attrs": "", "self_closing": False, "full": "<button>"}
        patch = _apply_attribute(tag_info, "aria-label", "Menu")
        assert patch["after"] == '<button aria-label="Menu">'


class TestFallbackFixNewMarkupShapes:
    """Covers the ticket's own worked examples end to end through _fallback_patch."""

    def test_bare_button_no_context_uses_last_resort(self):
        # The ticket's own simplest example: <button></button>, nothing else
        # to go on anywhere in the file.
        patch = _fallback_patch({"id": "button-name"}, {"html": "<button></button>"}, "<button></button>")
        assert patch == {"before": "<button>", "after": '<button aria-label="Menu">'}

    def test_button_with_nested_span_and_svg(self):
        file_content = (
            '<button>\n'
            '  <span>\n'
            '    <svg></svg>\n'
            '  </span>\n'
            '</button>\n'
        )
        # line_no=1 simulates locate_source's ancestor-scoped result, which
        # already points at the <button>'s own line, not the nested <svg>.
        patch = _fallback_patch({"id": "button-name"}, {"html": "<svg></svg>"}, file_content, line_no=1)
        assert patch is not None
        assert patch["after"] == '<button aria-label="Menu">'

    def test_button_wrapping_custom_icon_component(self):
        file_content = 'export default function Header() {\n  return <button><DownloadIcon /></button>;\n}\n'
        node = {"html": "<button><DownloadIcon /></button>"}
        patch = _fallback_patch({"id": "button-name"}, node, file_content, line_no=2)
        assert patch is not None
        assert 'aria-label="Download"' in patch["after"]

    def test_tsx_button_with_jsx_expression_attribute(self):
        # Exercises the tag-boundary scanner directly: the '>' inside the
        # arrow function must not be mistaken for the tag's own end.
        file_content = (
            'const Header: React.FC<Props> = () => {\n'
            '  return <button onClick={() => x > 1 && doThing()}><DownloadIcon /></button>;\n'
            '};\n'
        )
        node = {"html": "<button><DownloadIcon /></button>"}
        patch = _fallback_patch({"id": "button-name"}, node, file_content, line_no=2)
        assert patch is not None
        assert 'aria-label="Download"' in patch["after"]
        assert validate_patch(file_content, patch["before"], patch["after"]) is True

    def test_multiple_classless_buttons_disambiguated_by_line_no(self):
        file_content = (
            '<button><svg>A</svg></button>\n'
            '<button><svg>B</svg></button>\n'
            '<button><svg>C</svg></button>\n'
        )
        patch = _fallback_patch({"id": "button-name"}, {"html": "<svg>B</svg>"}, file_content, line_no=2)
        assert patch is not None
        assert file_content.count(patch["before"]) == 1
        rebuilt = file_content.replace(patch["before"], patch["after"], 1)
        lines = rebuilt.splitlines()
        assert 'aria-label' in lines[1]
        assert 'aria-label' not in lines[0]
        assert 'aria-label' not in lines[2]

    def test_no_button_anywhere_returns_none_with_reason_logged(self, caplog):
        with caplog.at_level("INFO"):
            result = _fallback_patch({"id": "button-name"}, {"html": "<button></button>"}, "<div>nothing here</div>")
        assert result is None
        assert any("No supported fix strategy" in r.message for r in caplog.records)

    def test_ambiguous_without_line_no_returns_none(self):
        file_content = "<button></button>\n<button></button>\n"
        assert _fallback_patch({"id": "button-name"}, {"html": "<button></button>"}, file_content) is None

    def test_unsupported_rule_id_returns_none(self):
        assert _fallback_patch({"id": "aria-required-children"}, {"html": "<div></div>"}, "<div></div>") is None

    def test_existing_aria_label_short_circuits(self):
        file_content = '<button aria-label="Existing"><svg/></button>'
        assert _fallback_patch({"id": "button-name"}, {"html": "<svg></svg>"}, file_content, line_no=1) is ALREADY_FIXED


class TestSvgImgAltFallback:
    def test_standalone_svg_gets_its_own_label(self):
        assert "svg-img-alt" in RULES_WITH_FALLBACK
        file_content = '<svg aria-hidden="false" class="chart-icon"><path d="M0 0"/></svg>'
        node = {"html": '<svg aria-hidden="false" class="chart-icon"></svg>'}
        patch = _fallback_patch({"id": "svg-img-alt"}, node, file_content)
        assert patch is not None
        assert 'aria-label="Chart"' in patch["after"]

    def test_no_context_uses_last_resort(self):
        file_content = '<svg aria-hidden="false"></svg>'
        node = {"html": '<svg aria-hidden="false"></svg>'}
        patch = _fallback_patch({"id": "svg-img-alt"}, node, file_content)
        assert patch is not None
        assert 'aria-label="Image"' in patch["after"]

    def test_already_has_aria_label_returns_already_fixed(self):
        file_content = '<svg aria-label="Existing"></svg>'
        node = {"html": '<svg aria-label="Existing"></svg>'}
        assert _fallback_patch({"id": "svg-img-alt"}, node, file_content) is ALREADY_FIXED
