"""
Bộ lọc và chuẩn hóa nội dung báo cáo tuần Fermat Tech:
1. Bỏ các dòng boilerplate tự chèn (tự đánh giá, chấm công, nộp báo cáo, chỉ đạo BLĐ, cập nhật phát sinh...).
2. Lọc bỏ thông tin nhạy cảm, bí mật, PII (mật khẩu, token, khóa API, CCCD, SĐT, STK ngân hàng, email cá nhân).
3. Lọc bỏ chuyện phiếm, lời lẽ nhạy cảm, lệnh gửi AI, các dòng quá ngắn vô nghĩa.
4. Giới hạn độ dài tối đa 1 trang A4 (tổng <= 28 dòng nội dung, mỗi ý <= 200 ký tự).
5. Đảm bảo chỉ có DUY NHẤT một mục 'Khó khăn, vướng mắc' luôn nằm ở cuối Phần I.
"""

import re
from typing import Any, Dict, List, Optional, Tuple

# Các câu boilerplate / thủ tục chung không đưa vào báo cáo
BOILERPLATE_PATTERNS = [
    r"(?i)\btự\s*đánh\s*giá\b",
    r"(?i)\bchấm\s*công\b",
    r"(?i)\bnộp\s*báo\s*cáo\s*(?:tuần|tháng|kết\s*quả)?\b",
    r"(?i)\bđăng\s*ký\s*lịch\s*(?:công\s*tác|tuần|mới)?\b",
    r"(?i)\bchỉ\s*đạo\s*của\s*(?:blđ|ban\s*lãnh\s*đạo)\b",
    r"(?i)\btheo\s*chỉ\s*đạo\s*của\s*(?:blđ|ban\s*lãnh\s*đạo)\b",
    r"(?i)\bcập\s*nhật\s*các\s*công\s*việc\s*liên\s*quan\s*phát\s*sinh\b",
    r"(?i)\btích\s*cực\s*cập\s*nhật\b",
    r"(?i)\bcác\s*nhiệm\s*vụ\s*khác\s*theo\s*chỉ\s*đạo\b",
    r"(?i)\bnhiệm\s*vụ\s*khác\s*theo\s*yêu\s*cầu\b",
]

# Regex phát hiện thông tin nhạy cảm, PII, bí mật và lệnh AI
SENSITIVE_PATTERNS = [
    # Mật khẩu / password
    r"(?i)\b(?:mật\s*khẩu|password|passwd|pwd)\b.*?(?:[:=]|\blà\b)\s*\S+",
    # Token / API Key / Secret / Bearer
    r"(?i)\b(?:bearer\s+[a-z0-9_\-\.]{12,}|ghp_[a-z0-9]{20,}|sk-[a-z0-9]{15,}|(?:api[_-]?key|secret|token)\s*[:=]\s*\S+)",
    # CCCD / CMND (9 hoặc 12 số)
    r"(?i)\b(?:cccd|cmnd|căn\s*cước|chứng\s*minh)\b.*?\d{9,12}\b",
    r"\b\d{12}\b",  # 12 chữ số liên tiếp độc lập
    # Số điện thoại cá nhân Việt Nam (10 chữ số bắt đầu bằng 03, 05, 07, 08, 09 hoặc +84)
    r"(?:\b0|\+84)(?:3|5|7|8|9)\d{8}\b",
    # Số tài khoản ngân hàng
    r"(?i)\b(?:stk|số\s*tài\s*khoản|tk\s*ngân\s*hàng)\b.*?\d{6,}\b",
    # Email cá nhân không thuộc domain công ty (@fermat.vn)
    r"\b[A-Za-z0-9._%+-]+@(?!(?:fermat|fermattech)\.vn)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
    # Lệnh / Prompt injection
    r"(?i)\b(?:hãy\s*đóng\s*vai|bỏ\s*qua\s*(?:mọi\s*)?chỉ\s*dẫn|ignore\s+(?:previous|all)\s+instructions|system\s*prompt)\b",
    # Chuyện phiếm / việc cá nhân không phù hợp báo cáo công ty
    r"(?i)\b(?:chuyện\s*riêng|việc\s*cá\s*nhân|đi\s*chơi|ăn\s*uống|tán\s*gẫu|chém\s*gió)\b",
]

# Tên nhóm liên quan đến khó khăn vướng mắc
DIFFICULTY_GROUP_REGEX = re.compile(r"(?i)\b(?:khó\s*khăn|vướng\s*mắc|tồn\s*tại|chưa\s*hoàn\s*thành|đề\s*xuất)\b")

MAX_CHARS_PER_ITEM = 200
MAX_ITEMS_TOTAL = 28
MAX_ITEMS_PER_GROUP = 5
MAX_GROUPS = 5
MAX_DIFFICULTIES = 2
MAX_PLANNED_ITEMS = 10


CONTROL_CHARS_REGEX = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")

def clean_report_name(name: Any) -> str:
    """Làm sạch tên nhóm: loại bỏ control characters và khoảng trắng thừa."""
    if not name:
        return "Công việc"
    val = CONTROL_CHARS_REGEX.sub("", str(name)).strip()
    return val or "Công việc"


def is_inappropriate_or_boilerplate(text: str) -> bool:
    """Trả về True nếu dòng chứa nội dung không phù hợp, nhạy cảm hoặc câu boilerplate thủ tục."""
    raw = str(text or "").strip()
    if not raw:
        return True

    # 1. Dòng quá ngắn hoặc vô nghĩa (ít hơn 4 ký tự chữ cái/chữ số)
    clean_alpha = re.sub(r"[^A-Za-z0-9À-ỹ]", "", raw)
    if len(clean_alpha) < 4:
        return True

    # 2. Boilerplate thủ tục
    for pat in BOILERPLATE_PATTERNS:
        if re.search(pat, raw):
            return True

    # 3. Thông tin nhạy cảm / PII / Secrets / Lệnh AI
    for pat in SENSITIVE_PATTERNS:
        if re.search(pat, raw):
            return True

    return False


def clean_report_item(text: str) -> Optional[str]:
    """Làm sạch một dòng công việc: loại bỏ ký tự lạ, lọc nội dung xấu, giới hạn 200 ký tự."""
    if not text:
        return None
    val = str(text).strip()
    val = re.sub(r"^[\s*•–-]+", "", val).strip()
    val = CONTROL_CHARS_REGEX.sub("", val).strip()

    if is_inappropriate_or_boilerplate(val):
        return None

    # Giới hạn 200 ký tự
    if len(val) > MAX_CHARS_PER_ITEM:
        val = val[:MAX_CHARS_PER_ITEM].rstrip() + "..."

    return val if val else None


DATE_OR_RESULT_REGEX = re.compile(
    r"(?i)(?:\b\d{1,2}/\d{1,2}\b|\bthứ\s*(?:hai|ba|tư|năm|sáu|bảy|[2-7])\b|xong|hoàn\s*thành|bàn\s*giao|đạt|nghiệm\s*thu)"
)


def _has_date_or_result(item: str) -> bool:
    return bool(DATE_OR_RESULT_REGEX.search(item))


def sanitize_and_limit_report_content(
    completed_groups: List[Dict[str, Any]],
    difficulties: List[str],
    planned_groups: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[str], List[Dict[str, Any]]]:
    """
    Chuẩn hóa và giới hạn toàn diện nội dung báo cáo:
    1. Tách bất kỳ nhóm 'Khó khăn, vướng mắc' nào trong completed_groups đưa vào difficulties.
    2. Lọc bỏ các dòng không phù hợp, boilerplate, nhạy cảm.
    3. Giới hạn số lượng mục và tổng số dòng <= 28 để vừa vặn 1 trang A4.
    """
    merged_diffs: List[str] = []
    for it in difficulties or []:
        cleaned = clean_report_item(str(it))
        if cleaned:
            merged_diffs.append(cleaned)

    # 1. Xử lý completed_groups
    clean_c_groups: List[Dict[str, Any]] = []
    for g in completed_groups or []:
        if not isinstance(g, dict):
            continue
        g_name = clean_report_name(g.get("name"))
        items = g.get("items") or []

        # Nếu tên nhóm là Khó khăn vướng mắc thì chuyển các items sang difficulties
        if DIFFICULTY_GROUP_REGEX.search(g_name):
            for it in items:
                cleaned = clean_report_item(str(it))
                if cleaned:
                    merged_diffs.append(cleaned)
            continue

        clean_items: List[str] = []
        for it in items:
            cleaned = clean_report_item(str(it))
            if cleaned and cleaned not in clean_items:
                clean_items.append(cleaned)

        if clean_items:
            clean_c_groups.append({
                "name": g_name,
                "items": clean_items[:MAX_ITEMS_PER_GROUP],
            })

    # Giới hạn số nhóm completed_groups tối đa 5
    clean_c_groups = clean_c_groups[:MAX_GROUPS]
    if not clean_c_groups:
        clean_c_groups = [{"name": "Công việc", "items": []}]

    # 2. Xử lý difficulties: tối đa 2 ý
    dedup_diffs = []
    seen_diffs = set()
    for d in merged_diffs:
        k = d.casefold()
        if k not in seen_diffs:
            seen_diffs.add(k)
            dedup_diffs.append(d)
    final_diffs = dedup_diffs[:MAX_DIFFICULTIES]

    # 3. Xử lý planned_groups
    clean_p_groups: List[Dict[str, Any]] = []
    total_planned = 0
    for g in planned_groups or []:
        if not isinstance(g, dict):
            continue
        g_name = clean_report_name(g.get("name"))
        items = g.get("items") or []

        clean_items = []
        for it in items:
            if total_planned >= MAX_PLANNED_ITEMS:
                break
            cleaned = clean_report_item(str(it))
            if cleaned and cleaned not in clean_items:
                clean_items.append(cleaned)
                total_planned += 1

        if clean_items:
            clean_p_groups.append({
                "name": g_name,
                "items": clean_items[:MAX_ITEMS_PER_GROUP],
            })

    clean_p_groups = clean_p_groups[:MAX_GROUPS]
    if not clean_p_groups:
        clean_p_groups = [{"name": "Công việc", "items": []}]

    # 4. Giới hạn tổng số dòng <= MAX_ITEMS_TOTAL (28 dòng)
    total_lines = (
        sum(len(g["items"]) for g in clean_c_groups)
        + len(final_diffs)
        + sum(len(g["items"]) for g in clean_p_groups)
    )

    def _trim_item_from_groups(groups: List[Dict[str, Any]]) -> bool:
        # Ưu tiên 1: Cắt bỏ mục KHÔNG có ngày/kết quả trước
        for g in reversed(groups):
            items = g.get("items", [])
            if len(items) > 1:
                for idx in reversed(range(len(items))):
                    if not _has_date_or_result(items[idx]):
                        items.pop(idx)
                        return True
        # Ưu tiên 2: Cắt từ cuối các nhóm có nhiều hơn 1 mục
        for g in reversed(groups):
            items = g.get("items", [])
            if len(items) > 1:
                items.pop()
                return True
        return False

    while total_lines > MAX_ITEMS_TOTAL:
        if _trim_item_from_groups(clean_p_groups):
            total_lines -= 1
            continue
        if _trim_item_from_groups(clean_c_groups):
            total_lines -= 1
            continue
        break

    return clean_c_groups, final_diffs, clean_p_groups
