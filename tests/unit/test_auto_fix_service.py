"""
Unit tests for the pure-logic pieces of Auto-Fix orchestration
(backend/services/auto_fix_service.py) — no real git/npm/network involved.
"""
from pathlib import Path

from backend.services.auto_fix_service import locate_source, validate_patch, _fallback_patch


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

    def test_no_class_attribute_returns_none(self, tmp_path):
        (tmp_path / "Header.jsx").write_text('<button></button>', encoding="utf-8")
        assert locate_source(tmp_path, "<button></button>") is None

    def test_no_match_returns_none(self, tmp_path):
        (tmp_path / "Header.jsx").write_text('<button className="other">x</button>', encoding="utf-8")
        assert locate_source(tmp_path, '<button class="menu-btn">x</button>') is None

    def test_ambiguous_multiple_files_returns_none(self, tmp_path):
        (tmp_path / "A.jsx").write_text('<button className="menu-btn">a</button>', encoding="utf-8")
        (tmp_path / "B.jsx").write_text('<button className="menu-btn">b</button>', encoding="utf-8")
        assert locate_source(tmp_path, '<button class="menu-btn">x</button>') is None

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
        assert _fallback_patch({"id": "image-alt"}, self.NODE, self.FILE) is None

    def test_already_has_aria_label_returns_none(self):
        file_content = 'return <button className="menu-btn" aria-label="Existing"><svg/></button>'
        assert _fallback_patch(self.RULE, self.NODE, file_content) is None

    def test_self_closing_tag(self):
        file_content = '<button className="menu-btn" />'
        patch = _fallback_patch(self.RULE, self.NODE, file_content)
        assert patch["after"] == '<button className="menu-btn" aria-label="Menu" />'
