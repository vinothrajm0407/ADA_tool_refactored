"""
Unit tests for the pure-logic pieces of Auto-Fix orchestration
(backend/services/auto_fix_service.py) — no real git/npm/network involved.
"""
from pathlib import Path

from unittest.mock import patch as mock_patch

from backend.services.auto_fix_service import (
    locate_source, validate_patch, _fallback_patch, _parse_github_repo, _pr_body,
    _hex_to_rgb, _relative_luminance, _contrast_ratio, _adjust_to_ratio, _parse_contrast_data,
    is_auto_merge_eligible,
)


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

    def test_already_has_aria_label_returns_none(self):
        file_content = 'return <button className="menu-btn" aria-label="Existing"><svg/></button>'
        assert _fallback_patch(self.RULE, self.NODE, file_content) is None

    def test_self_closing_tag(self):
        file_content = '<button className="menu-btn" />'
        patch = _fallback_patch(self.RULE, self.NODE, file_content)
        assert patch["after"] == '<button className="menu-btn" aria-label="Menu" />'


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

    def test_adds_generic_aria_label(self):
        patch = _fallback_patch(self.RULE, self.NODE, self.FILE)
        assert patch is not None
        assert patch["after"] == '<a href="#" className="product-link" aria-label="Learn more">'
        assert validate_patch(self.FILE, patch["before"], patch["after"]) is True

    def test_no_class_returns_none(self):
        node = {"html": '<a href="#">Click here</a>'}
        assert _fallback_patch(self.RULE, node, 'return <a href="#">Click here</a>') is None

    def test_already_has_aria_label_returns_none(self):
        file_content = 'return <a href="#" className="product-link" aria-label="Existing">Click here</a>'
        assert _fallback_patch(self.RULE, self.NODE, file_content) is None


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
