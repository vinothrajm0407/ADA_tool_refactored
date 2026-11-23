import csv
import io
from unittest.mock import patch

from backend.services import auto_fix_service, report_pdf_service
from backend.services.fix_proof import wcag_criteria
from backend.services.report_pdf_service import (_WCAG21_AA, _build_evidence_pack_html, audit_trail_csv,
                                                 conformance_rows)


def test_wcag_criteria_handles_two_digit_criteria():
    assert wcag_criteria(["cat.text-alternatives", "wcag2a", "wcag111", "wcag1410", "wcag21aa"]) == ["1.1.1", "1.4.10"]


def test_conformance_covers_all_50_criteria_with_honest_verdicts():
    assert len(_WCAG21_AA) == 50
    img = {"id": "image-alt", "tags": ["wcag111"], "nodes": [{}, {}]}
    label = {"id": "label", "tags": ["wcag412"], "nodes": [{}]}
    passes = [{"id": "button-name", "tags": ["wcag412"]}, {"id": "document-title", "tags": ["wcag242"]}]
    rows = {r[0]: r[3] for r in conformance_rows([img, label], passes, open_issues=[label])}
    assert rows["4.1.2"] == "Partially supports"   # still failing, but other checks pass
    assert rows["1.1.1"] == "Fixed — PR open"      # every failure fixed
    assert rows["2.4.2"] == "Supports"
    assert rows["1.4.10"] == "Not tested"          # never claim what automation can't check
    only_fail = {r[0]: r[3] for r in conformance_rows([img], [], open_issues=[img])}
    assert only_fail["1.1.1"] == "Does not support"


def test_github_review_reports_approver_and_merger():
    pr = {"state": "closed", "merged_at": "2026-11-19T10:00:00Z", "merged_by": {"login": "lead"}}
    reviews = [{"state": "APPROVED", "user": {"login": "alice"}, "submitted_at": "2026-11-18T08:00:00Z"},
               {"state": "COMMENTED", "user": {"login": "bob"}, "submitted_at": "2026-11-19T09:00:00Z"},
               {"state": "APPROVED", "user": {"login": "alice"}, "submitted_at": "2026-11-19T07:00:00Z"}]
    with patch.object(auto_fix_service, "_pr_api", side_effect=lambda *a: reviews if a[-1] == "/reviews" else pr):
        r = auto_fix_service.get_pull_request_review("https://github.com/o/r", "t", 5)
    assert r == {"state": "merged", "merged_by": "lead", "merged_at": "2026-11-19T10:00:00Z", "approved_by": ["alice"],
                 "approved_at": "2026-11-19T07:00:00Z"}  # latest approval, comments ignored


def test_review_lookup_failure_is_none_not_an_error():
    with patch.object(auto_fix_service, "_pr_api", side_effect=OSError("401")):
        assert auto_fix_service.get_pull_request_review("https://github.com/o/r", "t", 5) is None


def _pack(fix_overrides=None):
    """Fixes + pack data built through evidence_pack_data with the DB faked."""
    fixes = [{"id": 7, "created_at": "2026-11-18T09:00:00+00:00", "page_url": "https://x/", "rule_id": "image-alt",
              "help": "Images must have alternative text", "wcag": [], "impact": "critical", "selector": "img",
              "file": "docs/index.html:25", "status": "verified", "pr_url": "https://github.com/o/r/pull/5",
              "pr_state": "merged", "approved_by": ["alice"], "approved_at": "2026-11-19T07:00:00Z",
              "merged_by": "lead", "merged_at": "2026-11-20T10:00:00Z", **(fix_overrides or {})}]
    scan = {"axeResult": {
        "violations": [{"id": "image-alt", "tags": ["wcag111"], "nodes": [{"target": ["img"]}]},
                       {"id": "label", "tags": ["wcag412"], "nodes": [{"target": ["#q"]}]}],
        "passes": [{"id": "document-title", "tags": ["wcag242"]}]}}
    proof = {"id": 7, "rule_id": "image-alt", "selector": "img", "before_screenshot": "QUJD", "after_screenshot": "REVG"}
    with patch.object(report_pdf_service.db, "get_user_by_id", return_value={"firstName": "Vinoth", "lastName": "Raj"}), \
         patch.object(report_pdf_service.db, "get_page_scans", return_value={"https://x/": {
             "latest_id": 91, "dates": ["2026-11-10T00:00:00+00:00", "2026-11-17T00:00:00+00:00", "2026-11-19T00:00:00+00:00"]}}), \
         patch.object(report_pdf_service.db, "get_scan_result", return_value=scan), \
         patch.object(report_pdf_service.db, "get_fix_proofs", return_value=[proof]):
        data = report_pdf_service.evidence_pack_data(fixes, user_id=1)
    return fixes, data


def test_pack_data_fills_timeline_fields():
    fixes, data = _pack()
    f = fixes[0]
    assert f["found_at"].startswith("2026-11-17")   # the scan the fix was started from, not a later one
    assert f["fixed_by"] == "Vinoth Raj"
    assert f["wcag"] == ["1.1.1"]                   # older fix without stored WCAG gets it from the scan
    assert f["days_to_merge"] == 3
    assert [p["url"] for p in data["pages"]] == ["https://x/"] and len(data["proofs"]) == 1
    assert [v["id"] for v in data["pages"][0]["open_issues"]] == ["label"]  # fixed img no longer open


def test_audit_trail_csv_and_pdf_show_issue_fix_approver_date():
    fixes, data = _pack()
    rows = list(csv.reader(io.StringIO(audit_trail_csv(fixes))))
    row = dict(zip(rows[0], rows[1]))
    assert row["Approved by"] == "alice" and row["Approved on"] == "2026-11-19" and row["Merged on"] == "2026-11-20"
    assert row["Issue found"] == "2026-11-17" and row["Fixed by"] == "Vinoth Raj" and row["Days found to merged"] == "3"
    html = _build_evidence_pack_html(fixes, data["pages"], data["proofs"])
    assert "by alice on 2026-11-19" in html and "by lead" in html and "3 days found → merged" in html
    assert "docs/index.html:25" in html and "re-scan verified" in html and "Avg days to merge" in html
    summary = html[html.index('section-title">Summary by WCAG'):html.index('section-title">Audit trail')]
    assert "1.1.1" in summary and "4.1.2" in summary   # fixed criterion and still-open criterion
    assert "Conformance (scan 2026-11-19) —" in html and "none recorded" not in html
    assert "data:image/jpeg;base64,QUJD" in html        # before/after screenshots inside the pack


def test_unmerged_fix_timeline_shows_pending_steps():
    fixes, data = _pack({"pr_state": "open", "approved_by": [], "approved_at": None, "merged_by": None, "merged_at": None})
    assert fixes[0]["days_to_merge"] is None
    html = _build_evidence_pack_html(fixes, data["pages"], data["proofs"])
    assert "awaiting review" in html and "not yet" in html
