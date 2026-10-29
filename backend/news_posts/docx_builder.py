"""Word (.docx) export builder for news posts following FermatTech template."""

from __future__ import annotations

import io
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from django.utils.text import slugify
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

from .models import NewsPost
from .validator import format_hashtags_string, split_contact_info_lines

FONT_PRIMARY = "Aptos"
FONT_FALLBACK = "Calibri"


def _set_run_font(
    run,
    *,
    font_name: str = FONT_PRIMARY,
    size_pt: float = 11,
    bold: bool = False,
    italic: bool = False,
) -> None:
    run.font.name = font_name
    run.font.size = Pt(size_pt)
    run.bold = bold
    run.italic = italic

    # Đảm bảo font hiển thị tiếng Việt và ký tự đặc biệt/emoji đúng
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.get_or_add_rFonts()
    rFonts.set(qn("w:ascii"), font_name)
    rFonts.set(qn("w:hAnsi"), font_name)
    rFonts.set(qn("w:eastAsia"), font_name)
    rFonts.set(qn("w:cs"), font_name)


def _add_paragraph(
    document: Document,
    text: str = "",
    *,
    bold: bool = False,
    italic: bool = False,
    size_pt: float = 11,
    align: WD_ALIGN_PARAGRAPH = WD_ALIGN_PARAGRAPH.LEFT,
    space_before: float = 0,
    space_after: float = 4,
    line_spacing: float = 1.15,
):
    p = document.add_paragraph()
    p.alignment = align
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = line_spacing
    if text:
        run = p.add_run(text)
        _set_run_font(run, size_pt=size_pt, bold=bold, italic=italic)
    return p


def make_safe_docx_filename(news_post: NewsPost) -> str:
    """Tạo tên tệp Word an toàn theo cấu trúc: Tin-bai-<đơn vị hoặc tiêu đề>-<ngày>.docx."""
    unit = ""
    if isinstance(news_post.input_payload, dict):
        unit = str(
            news_post.input_payload.get("unit_name")
            or news_post.input_payload.get("unitName")
            or ""
        ).strip()

    if not unit:
        unit = str(news_post.title or "").strip()

    if not unit and isinstance(news_post.content_payload, dict):
        unit = str(news_post.content_payload.get("headline") or "").strip()

    if not unit:
        unit = "truyen-thong"

    # Làm sạch emoji và ký tự đặc biệt trước khi slugify
    unit_cleaned = re.sub(r"[^\w\s-]", "", unit).strip()
    slug = slugify(unit_cleaned) or "truyen-thong"
    # Giới hạn độ dài slug tối đa 60 ký tự cho tên file gọn gàng
    slug = slug[:60].rstrip("-")

    if news_post.created_at:
        date_str = news_post.created_at.strftime("%Y-%m-%d")
    else:
        date_str = datetime.now().strftime("%Y-%m-%d")

    return f"Tin-bai-{slug}-{date_str}.docx"


def build_news_post_docx(news_post: NewsPost) -> io.BytesIO:
    """Tạo file Word (.docx) từ nội dung bản tin theo chuẩn bài FB Lý Thường Kiệt / Báo chí."""
    document = Document()

    # Cấu hình khổ giấy A4 và lề trang
    section = document.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.0)
    section.bottom_margin = Cm(2.0)
    section.left_margin = Cm(2.5)
    section.right_margin = Cm(2.0)

    # Style mặc định Normal
    normal_style = document.styles["Normal"]
    normal_style.font.name = FONT_PRIMARY
    normal_style.font.size = Pt(11)
    normal_style.element.rPr.rFonts.set(qn("w:eastAsia"), FONT_PRIMARY)

    cp: Dict[str, Any] = news_post.content_payload if isinstance(news_post.content_payload, dict) else {}
    post_type = news_post.post_type

    # 1. Tiêu đề in hoa đậm (Headline)
    headline = str(cp.get("headline") or news_post.title or "BÀI ĐĂNG FERMATTECH").strip()
    _add_paragraph(
        document,
        headline.upper(),
        bold=True,
        size_pt=13.5,
        align=WD_ALIGN_PARAGRAPH.LEFT,
        space_before=0,
        space_after=8,
    )

    # 2. Đoạn mở đầu (Lead in)
    lead_in = str(cp.get("lead_in") or "").strip()
    if lead_in:
        _add_paragraph(
            document,
            lead_in,
            bold=False,
            size_pt=11,
            align=WD_ALIGN_PARAGRAPH.LEFT,
            space_before=0,
            space_after=6,
        )

    # 3. Các mục nội dung (Sections)
    sections = cp.get("sections") or []
    if isinstance(sections, list):
        for s in sections:
            if not isinstance(s, dict):
                continue
            h = str(s.get("heading") or "").strip()
            b = str(s.get("body") or "").strip()
            bullets = s.get("bullets") or []

            if h:
                _add_paragraph(
                    document,
                    h.upper(),
                    bold=True,
                    size_pt=11,
                    space_before=8,
                    space_after=3,
                )
            if b:
                _add_paragraph(
                    document,
                    b,
                    bold=False,
                    size_pt=11,
                    space_before=0,
                    space_after=4,
                )
            if isinstance(bullets, list):
                for blt in bullets:
                    blt_str = str(blt or "").strip()
                    if not blt_str:
                        continue
                    if not blt_str.startswith("✅"):
                        blt_str = f"✅ {blt_str}"
                    _add_paragraph(
                        document,
                        blt_str,
                        bold=False,
                        size_pt=11,
                        space_before=0,
                        space_after=2,
                    )

    # 4. Mục khảo sát (Survey Section)
    survey_section = cp.get("survey_section")
    if isinstance(survey_section, dict) and (survey_section.get("text") or survey_section.get("feedback_summary")):
        is_training = (post_type == NewsPost.TYPE_FB_TRAINING or str(post_type).lower() in ("fb_training", "training"))
        default_heading = "📊 PHẢN HỒI SAU TẬP HUẤN" if is_training else "PHẢN HỒI SAU BUỔI LÀM VIỆC"
        s_head = str(survey_section.get("heading") or default_heading).strip()
        s_text = str(survey_section.get("text") or "").strip()
        s_fb = str(survey_section.get("feedback_summary") or "").strip()

        if s_head:
            _add_paragraph(
                document,
                s_head,
                bold=True,
                size_pt=11,
                space_before=8,
                space_after=3,
            )
        if s_text:
            _add_paragraph(
                document,
                s_text,
                bold=False,
                size_pt=11,
                space_before=0,
                space_after=4,
            )
        if s_fb:
            _add_paragraph(
                document,
                s_fb,
                bold=False,
                size_pt=11,
                space_before=0,
                space_after=6,
            )

    # 5. Lời cảm ơn & Kết (Closing)
    closing = str(cp.get("closing") or "").strip()
    if closing:
        _add_paragraph(
            document,
            closing,
            bold=False,
            size_pt=11,
            space_before=6,
            space_after=8,
        )

    # 6. Phần quảng bá (Chỉ áp dụng cho bài đăng Facebook/mạng xã hội, KHÔNG có trong Bài báo)
    if post_type != NewsPost.TYPE_PRESS_ARTICLE:
        slogan = str(cp.get("slogan") or "").strip()
        if slogan:
            _add_paragraph(
                document,
                slogan,
                bold=True,
                size_pt=11,
                space_before=6,
                space_after=4,
            )

        # Thông tin liên hệ: TÁCH DỌC, mỗi liên hệ 1 dòng riêng biệt
        contact_info = str(cp.get("contact_info") or "").strip()
        contact_lines = split_contact_info_lines(contact_info)
        for cl in contact_lines:
            _add_paragraph(
                document,
                cl,
                bold=False,
                size_pt=11,
                space_before=0,
                space_after=2,
            )

        # Hashtag: MỘT đoạn duy nhất, cách nhau đúng 1 dấu cách, căn TRÁI (không justify)
        hashtags = cp.get("hashtags") or []
        hashtag_str = format_hashtags_string(hashtags)
        if hashtag_str:
            _add_paragraph(
                document,
                hashtag_str,
                bold=False,
                size_pt=11,
                align=WD_ALIGN_PARAGRAPH.LEFT,
                space_before=6,
                space_after=6,
            )

    docx_buffer = io.BytesIO()
    document.save(docx_buffer)
    docx_buffer.seek(0)
    return docx_buffer
