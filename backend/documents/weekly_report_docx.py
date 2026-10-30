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

from documents.filename_utils import sanitize_docx_filename


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


def _paragraph(document, text="", *, bold=False, size=11.5, align=None, before=0, after=1.5):
    paragraph = document.add_paragraph()
    paragraph.paragraph_format.space_before = Pt(before)
    paragraph.paragraph_format.space_after = Pt(after)
    paragraph.paragraph_format.line_spacing = 1.08
    if align is not None:
        paragraph.alignment = align
    _style(paragraph.add_run(text), bold=bold, size=size)
    return paragraph


def _section(document, heading, items):
    _paragraph(document, heading, bold=True, before=4, after=1.5, size=12)
    rows = _items(items) or ["Không có nội dung được ghi nhận."]
    for item in rows:
        _paragraph(document, f"- {item}", after=1, size=11.5)


def _filename(report):
    raw_name = _safe_text(getattr(report, "employee_name", "")) or "Nhân viên"
    # Bỏ số thứ tự đầu (vd: "9. Mr Sơn" -> "Mr Sơn", "15. Nguyễn Văn A" -> "Nguyễn Văn A")
    name = re.sub(r"^\d+\.\s*", "", raw_name).strip() or "Nhân viên"
    completed = getattr(report, "completed_week", "")
    planned = getattr(report, "planned_week", "")
    base_name = f"BC KQ tuần {completed} NV tuần {planned} ({name}).docx"
    return sanitize_docx_filename(base_name, default_stem="BC KQ tuan NV tuan")


def build_weekly_report_docx(report):
    document = Document()
    section = document.sections[0]
    section.page_width, section.page_height = Cm(21), Cm(29.7)
    # Căn lề gọn A4: Trên 1.5cm, Dưới 1.5cm, Trái 2.0cm, Phải 1.5cm (chuẩn gọn 1 trang)
    section.top_margin = Cm(1.5)
    section.right_margin = Cm(1.5)
    section.bottom_margin = Cm(1.5)
    section.left_margin = Cm(2.0)

    normal = document.styles["Normal"]
    normal.font.name = FONT
    normal.font.size = Pt(11.5)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)

    title = _paragraph(document, "", bold=True, size=13, align=WD_ALIGN_PARAGRAPH.CENTER, after=4)
    for index, line in enumerate((
        "BÁO CÁO",
        f"Kết quả tuần {report.completed_week}, nhiệm vụ dự kiến tuần {report.planned_week}",
        f"({report.employee_name})",
    )):
        run = title.add_run(line)
        _style(run, bold=True, size=13)
        if index < 2:
            run.add_break()

    # Section I: I. KẾT QUẢ TUẦN {completed_week}
    _paragraph(document, f"I. KẾT QUẢ TUẦN {report.completed_week}", bold=True, size=12.5, before=4, after=1.5)

    raw_completed_groups = report.get_completed_groups() if hasattr(report, "get_completed_groups") else []
    if not raw_completed_groups:
        if getattr(report, "completed_items", None):
            raw_completed_groups = [{"name": "Công việc", "items": report.completed_items}]
        else:
            raw_completed_groups = [{"name": "Công việc", "items": ["Không có nội dung được ghi nhận."]}]

    # Lọc bỏ nhóm có tên Khó khăn/vướng mắc trong completed_groups để không bị lặp
    diff_pattern = re.compile(r"(?i)\b(?:khó\s*khăn|vướng\s*mắc|tồn\s*tại)\b")
    completed_groups = [g for g in raw_completed_groups if not diff_pattern.search(g.get("name") or "")]
    if not completed_groups:
        completed_groups = [{"name": "Công việc", "items": ["Không có nội dung được ghi nhận."]}]

    group_num = 1
    for group in completed_groups:
        g_name = group.get("name") or "Công việc"
        _paragraph(document, f"{group_num}. {g_name}", bold=True, size=12, before=2.5, after=1)
        group_num += 1
        items = group.get("items") or ["Không có nội dung được ghi nhận."]
        for item in items:
            _paragraph(document, f"- {item}", size=11.5, after=1)

    # Khó khăn, vướng mắc DUY NHẤT là mục cuối cùng của Section I
    _paragraph(document, f"{group_num}. Khó khăn, vướng mắc", bold=True, size=12, before=2.5, after=1)
    diff_items = getattr(report, "difficulties", None) or ["Không có khó khăn, vướng mắc đáng kể."]
    for item in diff_items:
        _paragraph(document, f"- {item}", size=11.5, after=1)

    # Section II: II. NHIỆM VỤ TUẦN {planned_week}
    _paragraph(document, f"II. NHIỆM VỤ TUẦN {report.planned_week}", bold=True, size=12.5, before=5, after=1.5)

    planned_groups = report.get_planned_groups() if hasattr(report, "get_planned_groups") else []
    if not planned_groups:
        if getattr(report, "planned_items", None):
            planned_groups = [{"name": "Công việc", "items": report.planned_items}]
        else:
            planned_groups = [{"name": "Công việc", "items": ["Chưa có nhiệm vụ dự kiến."]}]

    p_num = 1
    for group in planned_groups:
        g_name = group.get("name") or "Công việc"
        _paragraph(document, f"{p_num}. {g_name}", bold=True, size=12, before=2.5, after=1)
        p_num += 1
        items = group.get("items") or ["Chưa có nhiệm vụ dự kiến."]
        for item in items:
            _paragraph(document, f"- {item}", size=11.5, after=1)

    # TUYỆT ĐỐI BỎ các dòng boilerplate tự chèn (chỉ đạo BLĐ, cập nhật phát sinh...)
    stream = BytesIO()
    document.save(stream)
    return _filename(report), stream.getvalue()
