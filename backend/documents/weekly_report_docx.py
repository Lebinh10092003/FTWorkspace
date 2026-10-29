"""Word export for the weekly-report preview.

The report follows the supplied Fermat weekly report sample: an A4 page with a
centred three-line title followed by the three narrative sections.  It is built
from structured data rather than copying any employee's historical report.
"""

from io import BytesIO
import re
import unicodedata

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Cm, Pt


FONT = "Times New Roman"


def _safe_text(value):
    return str(value or "").strip()


def _items(value):
    if not isinstance(value, list):
        return []
    return [_safe_text(item) for item in value if _safe_text(item)]


def _style(run, *, bold=False, size=13):
    run.bold = bold
    run.font.name = FONT
    run.font.size = Pt(size)
    run._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)


def _paragraph(document, text="", *, bold=False, size=13, align=None, before=0, after=2):
    paragraph = document.add_paragraph()
    paragraph.paragraph_format.space_before = Pt(before)
    paragraph.paragraph_format.space_after = Pt(after)
    paragraph.paragraph_format.line_spacing = 1.15
    if align is not None:
        paragraph.alignment = align
    _style(paragraph.add_run(text), bold=bold, size=size)
    return paragraph


def _section(document, heading, items):
    _paragraph(document, heading, bold=True, before=5, after=2)
    rows = _items(items) or ["Không có nội dung được ghi nhận."]
    for item in rows:
        _paragraph(document, f"- {item}", after=1)


def _filename(report):
    name = _safe_text(report.employee_name) or "Nhân viên"
    return f"BC KQ tuần {report.completed_week}, NV tuần {report.planned_week} ({name}).docx"


def build_weekly_report_docx(report):
    document = Document()
    section = document.sections[0]
    section.page_width, section.page_height = Cm(21), Cm(29.7)
    section.top_margin = Cm(2)
    section.right_margin = Cm(2)
    section.bottom_margin = Cm(2)
    section.left_margin = Cm(2.5)

    normal = document.styles["Normal"]
    normal.font.name = FONT
    normal.font.size = Pt(13)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)

    title = _paragraph(document, "", bold=True, size=14, align=WD_ALIGN_PARAGRAPH.CENTER, after=7)
    for index, line in enumerate((
        "BÁO CÁO",
        f"Kết quả tuần {report.completed_week}, nhiệm vụ dự kiến tuần {report.planned_week}",
        f"({report.employee_name})",
    )):
        run = title.add_run(line)
        _style(run, bold=True, size=14)
        if index < 2:
            run.add_break()

    # Section I: I. KẾT QUẢ TUẦN {completed_week}
    _paragraph(document, f"I. KẾT QUẢ TUẦN {report.completed_week}", bold=True, size=13, before=6, after=2)

    completed_groups = report.get_completed_groups() if hasattr(report, "get_completed_groups") else []
    if not completed_groups:
        if getattr(report, "completed_items", None):
            completed_groups = [{"name": "Công việc", "items": report.completed_items}]
        else:
            completed_groups = [{"name": "Công việc", "items": ["Không có nội dung được ghi nhận."]}]

    group_num = 1
    for group in completed_groups:
        g_name = group.get("name") or "Công việc"
        _paragraph(document, f"{group_num}. {g_name}", bold=True, size=13, before=4, after=2)
        group_num += 1
        items = group.get("items") or ["Không có nội dung được ghi nhận."]
        for item in items:
            _paragraph(document, f"- {item}", size=13, after=1)

    # Khó khăn, vướng mắc is the last item of Section I
    _paragraph(document, f"{group_num}. Khó khăn, vướng mắc", bold=True, size=13, before=4, after=2)
    diff_items = getattr(report, "difficulties", None) or ["Không có khó khăn, vướng mắc đáng kể."]
    for item in diff_items:
        _paragraph(document, f"- {item}", size=13, after=1)

    # Section II: II. NHIỆM VỤ TUẦN {planned_week}
    _paragraph(document, f"II. NHIỆM VỤ TUẦN {report.planned_week}", bold=True, size=13, before=8, after=2)

    planned_groups = report.get_planned_groups() if hasattr(report, "get_planned_groups") else []
    if not planned_groups:
        if getattr(report, "planned_items", None):
            planned_groups = [{"name": "Công việc", "items": report.planned_items}]
        else:
            planned_groups = [{"name": "Công việc", "items": ["Chưa có nhiệm vụ dự kiến."]}]

    p_num = 1
    for group in planned_groups:
        g_name = group.get("name") or "Công việc"
        _paragraph(document, f"{p_num}. {g_name}", bold=True, size=13, before=4, after=2)
        p_num += 1
        items = group.get("items") or ["Chưa có nhiệm vụ dự kiến."]
        for item in items:
            _paragraph(document, f"- {item}", size=13, after=1)

    if getattr(report, "include_bld_task", True):
        _paragraph(document, "- Thực hiện các nhiệm vụ khác theo chỉ đạo của BLĐ.", size=13, after=1)

    _paragraph(document, "- Tích cực cập nhật các công việc liên quan phát sinh (nếu có).", size=13, after=1)

    stream = BytesIO()
    document.save(stream)
    return _filename(report), stream.getvalue()
