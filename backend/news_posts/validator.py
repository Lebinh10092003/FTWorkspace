"""Validator and sanitizer for AI generated news post outputs."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional, Union

from .models import NewsPost

logger = logging.getLogger(__name__)


def _clean_text(val: Any, max_len: int = 5000) -> str:
    s = str(val or "").strip()
    # Strip dangerous control characters but keep standard whitespace
    clean = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", s)
    return clean[:max_len].strip()


def validate_and_sanitize_news_output(
    raw_output: str,
    allowed_numbers: Optional[List[Union[int, float]]] = None,
    post_type: str = NewsPost.TYPE_FB_TRAINING,
    has_survey: bool = False,
) -> Dict[str, Any]:
    """Validate JSON schema, clean text, check hallucinated percentages, and assemble raw copyable text."""
    text = (raw_output or "").strip()
    if not text:
        raise ValueError("Đầu ra từ AI rỗng.")

    # Extract JSON object if wrapped in codeblocks
    code_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if code_match:
        text = code_match.group(1).strip()
    else:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            text = text[start : end + 1].strip()

    try:
        data = json.loads(text)
    except Exception as exc:
        logger.warning("Không thể parse JSON từ AI: %s (nội dung: %s)", exc, raw_output[:300])
        raise ValueError(f"Đầu ra từ AI không đúng định dạng JSON: {exc}")

    if not isinstance(data, dict):
        raise ValueError("Đầu ra JSON phải là một đối tượng (object).")

    # 1. Headline
    raw_headline = _clean_text(data.get("headline"), max_len=300)
    if not raw_headline:
        raw_headline = "BÀI ĐĂNG FERMATTECH"
    # Ensure uppercase title
    headline = raw_headline

    # 2. Lead in
    lead_in = _clean_text(data.get("lead_in"), max_len=1500)

    # 3. Sections
    raw_sections = data.get("sections")
    if not isinstance(raw_sections, list):
        raw_sections = []

    sanitized_sections: List[Dict[str, Any]] = []
    for s in raw_sections:
        if not isinstance(s, dict):
            continue
        h = _clean_text(s.get("heading"), max_len=255)
        b = _clean_text(s.get("body"), max_len=3000)
        raw_bullets = s.get("bullets") or []
        bullets = []
        if isinstance(raw_bullets, list):
            for blt in raw_bullets:
                clean_b = _clean_text(blt, max_len=500)
                if clean_b:
                    bullets.append(clean_b)
        if h or b or bullets:
            sanitized_sections.append({
                "heading": h,
                "body": b,
                "bullets": bullets,
            })

    # 4. Survey section
    survey_section = None
    if has_survey:
        raw_survey = data.get("survey_section")
        if isinstance(raw_survey, dict):
            s_head = _clean_text(raw_survey.get("heading") or "📊 PHẢN HỒI SAU TẬP HUẤN", max_len=200)
            s_text = _clean_text(raw_survey.get("text"), max_len=1500)
            s_fb = _clean_text(raw_survey.get("feedback_summary"), max_len=1500)
            if s_text or s_fb:
                survey_section = {
                    "heading": s_head,
                    "text": s_text,
                    "feedback_summary": s_fb,
                }

    # 5. Closing
    closing = _clean_text(data.get("closing"), max_len=1500)

    # 6. Slogan & Contact info
    slogan = _clean_text(data.get("slogan"), max_len=300)
    contact_info = _clean_text(data.get("contact_info"), max_len=300)

    if post_type != NewsPost.TYPE_PRESS_ARTICLE:
        if not slogan:
            slogan = "FERMATTECH – Đồng hành chuyển đổi số từ bài toán thực tế đến hiệu quả thực chất."
        if not contact_info:
            contact_info = "🌐 www.fermat.vn  |  ✉ contact@fermat.vn  |  ☎ 0969 627 162"
    else:
        # Press articles do not have promotional slogans or social contacts
        slogan = ""
        contact_info = ""

    # 7. Hashtags
    raw_tags = data.get("hashtags") or []
    hashtags: List[str] = []
    if isinstance(raw_tags, list) and post_type != NewsPost.TYPE_PRESS_ARTICLE:
        for tag in raw_tags:
            c_tag = _clean_text(tag, max_len=50)
            if c_tag:
                if not c_tag.startswith("#"):
                    c_tag = f"#{c_tag}"
                hashtags.append(c_tag)

    # 8. Check for hallucinated percentages
    # Extract all numbers preceding a '%' in the text
    full_text_to_check = f"{headline} {lead_in} {' '.join([s['body'] for s in sanitized_sections])} {closing}"
    pct_matches = re.findall(r"(\d+(?:[.,]\d+)?)\s*%", full_text_to_check)
    warnings = []

    raw_ai_warnings = data.get("warnings") or []
    if isinstance(raw_ai_warnings, list):
        for w in raw_ai_warnings:
            cw = _clean_text(w, max_len=300)
            if cw and cw not in warnings:
                warnings.append(cw)

    if allowed_numbers is not None:
        allowed_floats = {float(n) for n in allowed_numbers}
        for pct_str in pct_matches:
            val = float(pct_str.replace(",", "."))
            # Allow common rounded numbers or verified survey numbers
            if val not in allowed_floats and round(val, 1) not in allowed_floats and round(val, 0) not in allowed_floats:
                warnings.append(f"Tỷ lệ {pct_str}% không nằm trong danh sách số liệu được phép.")

    # 9. Assemble raw copyable text
    raw_lines: List[str] = []

    # Headline
    raw_lines.append(headline)
    raw_lines.append("")

    # Lead in
    if lead_in:
        raw_lines.append(lead_in)
        raw_lines.append("")

    # Sections
    for s in sanitized_sections:
        if s["heading"]:
            raw_lines.append(s["heading"])
        if s["body"]:
            raw_lines.append(s["body"])
        for blt in s["bullets"]:
            raw_lines.append(blt)
        raw_lines.append("")

    # Survey Section
    if survey_section:
        if survey_section.get("heading"):
            raw_lines.append(survey_section["heading"])
        if survey_section.get("text"):
            raw_lines.append(survey_section["text"])
        if survey_section.get("feedback_summary"):
            raw_lines.append(survey_section["feedback_summary"])
        raw_lines.append("")

    # Closing
    if closing:
        raw_lines.append(closing)
        raw_lines.append("")

    # Slogan & Contact
    if slogan:
        raw_lines.append(slogan)
    if contact_info:
        raw_lines.append(contact_info)

    # Hashtags
    if hashtags:
        raw_lines.append("")
        raw_lines.append(" ".join(hashtags))

    raw_text = "\n".join(raw_lines).strip()

    return {
        "headline": headline,
        "lead_in": lead_in,
        "sections": sanitized_sections,
        "survey_section": survey_section,
        "closing": closing,
        "slogan": slogan,
        "contact_info": contact_info,
        "hashtags": hashtags,
        "raw_text": raw_text,
        "warnings": warnings,
    }
