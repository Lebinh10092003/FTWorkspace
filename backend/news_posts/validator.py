"""Validator and sanitizer for AI generated news post outputs."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional, Union

from .models import NewsPost

logger = logging.getLogger(__name__)

EMAIL_REGEX = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
PHONE_REGEX = re.compile(r"\b0\d{9,10}\b")
PII_LABEL_REGEX = re.compile(
    r"(?:họ\s*(?:và)?\s*tên|người\s*phản\s*hồi|người\s*gửi|email|sđt|số\s*điện\s*thoại)\s*:\s*[^\n,;.]+",
    re.IGNORECASE,
)


def _contains_pii(text: str) -> bool:
    if not text:
        return False
    return bool(EMAIL_REGEX.search(text) or PHONE_REGEX.search(text) or PII_LABEL_REGEX.search(text))


def _strip_pii(text: str) -> str:
    if not text:
        return ""
    val = EMAIL_REGEX.sub("", text)
    val = PHONE_REGEX.sub("", val)
    val = PII_LABEL_REGEX.sub("", val)
    val = re.sub(r"\s+", " ", val).strip()
    return val


def _format_pct_vn(val: Any) -> str:
    """Format percentage number using Vietnamese decimal comma (e.g. 100 or 99,7 or 66,7)."""
    if val is None or val == "":
        return ""
    try:
        f = float(val)
        if f.is_integer():
            return str(int(f))
        s = f"{f:.2f}".rstrip("0").rstrip(".")
        return s.replace(".", ",")
    except (ValueError, TypeError):
        return str(val).replace(".", ",")


def build_survey_section_from_summary(
    survey_summary: Dict[str, Any],
    post_type: str = NewsPost.TYPE_FB_TRAINING,
) -> Optional[Dict[str, str]]:
    """Build standardized survey section from survey_summary according to Ly Thuong Kiet FB post template."""
    if not isinstance(survey_summary, dict):
        return None

    total_responses = int(survey_summary.get("total_responses") or 0)
    if total_responses <= 0:
        return None

    # Heading: '📊 PHẢN HỒI SAU TẬP HUẤN' if training, else 'PHẢN HỒI SAU BUỔI LÀM VIỆC'
    is_training = (post_type == NewsPost.TYPE_FB_TRAINING or str(post_type).lower() in ("fb_training", "training"))
    heading = "📊 PHẢN HỒI SAU TẬP HUẤN" if is_training else "PHẢN HỒI SAU BUỔI LÀM VIỆC"

    # Text: 'N phiếu khảo sát ghi nhận: X% lượt đánh giá <nhóm> đạt Tốt/Rất tốt; ...'
    categories = survey_summary.get("categories") or []
    cat_lines = []
    for cat in categories:
        c_name = str(cat.get("name") or "").strip()
        if not c_name:
            continue
        c_pct = _format_pct_vn(cat.get("good_or_very_good_percent", 0))
        cat_lines.append(f"{c_pct}% lượt đánh giá {c_name.lower()} đạt Tốt/Rất tốt")

    if cat_lines:
        cat_summary_str = "; ".join(cat_lines)
    else:
        overall_pct = _format_pct_vn(survey_summary.get("overall_good_or_very_good_percent", 0))
        cat_summary_str = f"{overall_pct}% lượt đạt Tốt/Rất tốt"

    text = f"{total_responses} phiếu khảo sát ghi nhận: {cat_summary_str}."

    # Feedback summary from open_feedback_points (anonymized, no PII)
    feedback_points = survey_summary.get("open_feedback_points") or []
    clean_fbs = []
    for fb in feedback_points[:3]:
        s = _strip_pii(str(fb or "").strip())
        if s:
            clean_fbs.append(s)
    feedback_summary = " ".join(clean_fbs)

    return {
        "heading": heading,
        "text": text,
        "feedback_summary": feedback_summary,
    }


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
    survey_summary: Optional[Dict[str, Any]] = None,
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
    warnings: List[str] = []
    raw_ai_warnings = data.get("warnings") or []
    if isinstance(raw_ai_warnings, list):
        for w in raw_ai_warnings:
            cw = _clean_text(w, max_len=300)
            if cw and cw not in warnings:
                warnings.append(cw)

    total_survey_responses = 0
    if isinstance(survey_summary, dict):
        total_survey_responses = int(survey_summary.get("total_responses") or 0)
        has_survey_data = bool(survey_summary.get("has_survey")) and total_survey_responses > 0
    else:
        has_survey_data = bool(has_survey)

    survey_section = None
    if has_survey_data:
        fallback_section = None
        if isinstance(survey_summary, dict) and total_survey_responses > 0:
            fallback_section = build_survey_section_from_summary(survey_summary, post_type)

        all_allowed_floats = set()
        if allowed_numbers:
            for n in allowed_numbers:
                try:
                    all_allowed_floats.add(float(n))
                except (ValueError, TypeError):
                    pass
        if isinstance(survey_summary, dict):
            for n in survey_summary.get("allowed_numbers") or []:
                try:
                    all_allowed_floats.add(float(n))
                except (ValueError, TypeError):
                    pass
            for cat in survey_summary.get("categories") or []:
                c_pct = cat.get("good_or_very_good_percent")
                if c_pct is not None:
                    try:
                        all_allowed_floats.add(float(c_pct))
                    except (ValueError, TypeError):
                        pass
            if survey_summary.get("overall_good_or_very_good_percent") is not None:
                try:
                    all_allowed_floats.add(float(survey_summary["overall_good_or_very_good_percent"]))
                except (ValueError, TypeError):
                    pass

        raw_survey = data.get("survey_section")
        ai_section_valid = False

        if isinstance(raw_survey, dict):
            s_head = _clean_text(raw_survey.get("heading"), max_len=200)
            s_text = _clean_text(raw_survey.get("text"), max_len=1500)
            s_fb = _clean_text(raw_survey.get("feedback_summary"), max_len=1500)

            if s_text:
                has_pii = _contains_pii(f"{s_head} {s_text} {s_fb}")
                if has_pii:
                    warnings.append(
                        "Mục khảo sát do AI sinh ra chứa thông tin định danh cá nhân, đã được thay thế bằng dữ liệu an toàn."
                    )
                else:
                    pct_matches = re.findall(r"(\d+(?:[.,]\d+)?)\s*%", s_text)
                    numbers_valid = True
                    if all_allowed_floats and pct_matches:
                        for pct_str in pct_matches:
                            val = float(pct_str.replace(",", "."))
                            if (
                                val not in all_allowed_floats
                                and round(val, 1) not in all_allowed_floats
                                and round(val, 0) not in all_allowed_floats
                            ):
                                numbers_valid = False
                                warnings.append(
                                    f"Tỷ lệ {pct_str}% trong mục khảo sát không nằm trong danh sách số liệu được phép."
                                )
                                break
                    elif not pct_matches and fallback_section:
                        numbers_valid = False

                    if numbers_valid:
                        ai_section_valid = True
                        is_training = (
                            post_type == NewsPost.TYPE_FB_TRAINING
                            or str(post_type).lower() in ("fb_training", "training")
                        )
                        default_heading = (
                            "📊 PHẢN HỒI SAU TẬP HUẤN" if is_training else "PHẢN HỒI SAU BUỔI LÀM VIỆC"
                        )
                        survey_section = {
                            "heading": s_head or default_heading,
                            "text": s_text,
                            "feedback_summary": _strip_pii(s_fb)
                            or (fallback_section.get("feedback_summary", "") if fallback_section else ""),
                        }

        if not ai_section_valid:
            if fallback_section:
                survey_section = fallback_section
            elif isinstance(raw_survey, dict):
                s_head = _clean_text(raw_survey.get("heading"), max_len=200)
                s_text = _clean_text(raw_survey.get("text"), max_len=1500)
                s_fb = _clean_text(raw_survey.get("feedback_summary"), max_len=1500)
                if s_text and not _contains_pii(f"{s_head} {s_text} {s_fb}"):
                    is_training = (
                        post_type == NewsPost.TYPE_FB_TRAINING
                        or str(post_type).lower() in ("fb_training", "training")
                    )
                    default_heading = (
                        "📊 PHẢN HỒI SAU TẬP HUẤN" if is_training else "PHẢN HỒI SAU BUỔI LÀM VIỆC"
                    )
                    survey_section = {
                        "heading": s_head or default_heading,
                        "text": s_text,
                        "feedback_summary": _strip_pii(s_fb),
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

    if allowed_numbers is not None:
        allowed_floats = {float(n) for n in allowed_numbers}
        for pct_str in pct_matches:
            val = float(pct_str.replace(",", "."))
            # Allow common rounded numbers or verified survey numbers
            if val not in allowed_floats and round(val, 1) not in allowed_floats and round(val, 0) not in allowed_floats:
                msg = f"Tỷ lệ {pct_str}% không nằm trong danh sách số liệu được phép."
                if msg not in warnings:
                    warnings.append(msg)

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
