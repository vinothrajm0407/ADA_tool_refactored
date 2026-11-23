import csv
import io

from backend.services.report_pdf_service import _build_activity_html, activity_csv

EVENTS = [
    {"at": "2026-11-19T11:12:00+00:00", "kind": "review", "action": "PR merged — image-alt", "target": "https://x/",
     "result": "Merged without a review approval", "status": "ok", "by": "lead", "link": "https://g/pull/3", "ref": "FIX-86"},
    {"at": "2026-11-19T09:09:00+00:00", "kind": "scan", "action": "Page scanned", "target": "https://x/",
     "result": "6 failed rules · 70% pass rate", "status": "fail", "by": "", "link": None, "ref": "SCAN-91"},
    {"at": "2026-11-18T08:00:00+00:00", "kind": "crawl", "action": "Site crawl", "target": "https://x/",
     "result": "completed · 5 pages scanned", "status": "ok", "by": "", "link": None, "ref": "c1"},
]


def test_activity_csv_has_one_row_per_event():
    rows = list(csv.reader(io.StringIO(activity_csv(EVENTS))))
    assert rows[0][:4] == ["Date (UTC)", "Time (UTC)", "Type", "What"]
    assert rows[1][:3] == ["2026-11-19", "11:12", "PR approvals / merges"] and rows[1][-1] == "https://g/pull/3"
    assert len(rows) == 4


def test_activity_pdf_groups_by_day_and_counts():
    html = _build_activity_html(EVENTS, {"kind": [], "q": "", "from": "", "to": ""})
    timeline = html[html.index("Timeline (newest"):]
    assert timeline.index("2026-11-19") < timeline.index("2026-11-18")
    assert "· 2 events" in html and "· 1 event<" in html
    assert "<b>3</b> events" in html and ">1</b> failed" in html
    assert "Period: 2026-11-18 to 2026-11-19" in html and "Filters: none (everything)" in html
