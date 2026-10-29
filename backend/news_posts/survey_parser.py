"""Survey file parser for Google Form / Excel exports (.xlsx, .csv)."""

from __future__ import annotations

import csv
import io
import re
from typing import Any, Dict, List, Optional, Tuple

import openpyxl


MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_ROWS = 2000

# Thang điểm mức độ hài lòng (thang 100)
# Rất tốt = 100, Tốt = 80 (khớp mẫu: 13 Rất tốt / 19 lượt = 93,68)
# Các mức khác là giả định: Bình thường/Trung bình = 60, Chưa tốt = 40, Kém = 20.
RATING_SCORES = {
    "rất tốt": 100,
    "rat tot": 100,
    "rất hài lòng": 100,
    "rat hai long": 100,
    "5": 100,
    "tốt": 80,
    "tot": 80,
    "hài lòng": 80,
    "hai long": 80,
    "4": 80,
    "bình thường": 60,
    "binh thuong": 60,
    "trung bình": 60,
    "trung binh": 60,
    "3": 60,
    "chưa tốt": 40,
    "chua tot": 40,
    "cần cải thiện": 40,
    "can cai thien": 40,
    "không hài lòng": 40,
    "khong hai long": 40,
    "2": 40,
    "kém": 20,
    "kem": 20,
    "rất kém": 20,
    "rat kem": 20,
    "rất không hài lòng": 20,
    "rat khong hai long": 20,
    "1": 20,
}

# Các từ khóa xác định cột PII cá nhân (cần loại bỏ hoàn toàn)
PII_HEADER_KEYWORDS = [
    "họ và tên", "họ tên", "ho va ten", "ho ten", "full name", "tên của bạn",
    "email", "địa chỉ email", "dia chi email", "e-mail",
    "số điện thoại", "so dien thoai", "sđt", "phone",
    "dấu thời gian", "dau thoi gian", "timestamp", "thời gian gửi",
    "chức vụ", "chuc vu", "đơn vị", "don vi", "trường", "truong",
]

# Các từ khóa xác định câu hỏi mở / ý kiến đóng góp
OPEN_FEEDBACK_KEYWORDS = [
    "ý kiến", "y kien", "đóng góp", "dong gop", "đề xuất", "de xuat",
    "nguyện vọng", "nguyen vong", "mong muốn", "mong muon",
    "góp ý", "gop y", "chia sẻ", "chia se", "khác", "khac", "nhu cầu",
]


def _is_pii_column(header: str) -> bool:
    h_lower = header.strip().casefold()
    return any(kw in h_lower for kw in PII_HEADER_KEYWORDS)


def _is_open_feedback_column(header: str) -> bool:
    h_lower = header.strip().casefold()
    if _is_pii_column(header):
        return False
    return any(kw in h_lower for kw in OPEN_FEEDBACK_KEYWORDS)


def _normalize_rating_val(val: Any) -> Optional[Tuple[str, int]]:
    """Convert raw cell value to normalized rating label and numeric score."""
    if val is None:
        return None
    val_str = str(val).strip()
    if not val_str:
        return None

    val_norm = val_str.casefold()
    # Check exact match or starts with key
    if val_norm in RATING_SCORES:
        score = RATING_SCORES[val_norm]
        label = "Rất tốt" if score == 100 else ("Tốt" if score == 80 else ("Bình thường" if score == 60 else ("Chưa tốt" if score == 40 else "Kém")))
        return label, score

    # Check substring keywords
    for key, score in RATING_SCORES.items():
        if key.isalpha() and key in val_norm:
            label = "Rất tốt" if score == 100 else ("Tốt" if score == 80 else ("Bình thường" if score == 60 else ("Chưa tốt" if score == 40 else "Kém")))
            return label, score

    return None


def _clean_feedback_text(text: Any) -> str:
    """Sanitize open feedback text, remove phone numbers or email patterns, enforce max length."""
    val = str(text or "").strip()
    if not val or val.lower() in {"không", "khong", "không có", "khong co", "ko", "k", "k có", "none", "no"}:
        return ""
    # Mask phone numbers (10 digits)
    val = re.sub(r"\b0\d{9,10}\b", "[SĐT]", val)
    # Mask emails
    val = re.sub(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b", "[EMAIL]", val)
    # Collapse multiple whitespaces
    val = re.sub(r"\s+", " ", val).strip()
    return val[:250]


def _extract_category_and_criterion(header: str) -> Tuple[str, str]:
    """Parse category and specific criterion from headers like 'Nội dung [Thiết thực, dễ hiểu]'."""
    clean_h = header.strip()
    bracket_match = re.search(r"^(.*?)\s*\[(.*?)\]$", clean_h)
    if bracket_match:
        cat = bracket_match.group(1).strip()
        crit = bracket_match.group(2).strip()
        return cat or "Chung", crit or clean_h

    colon_match = re.search(r"^(.*?):\s*(.*)$", clean_h)
    if colon_match:
        cat = colon_match.group(1).strip()
        crit = colon_match.group(2).strip()
        return cat or "Chung", crit or clean_h

    # Default: use clean header as criterion, group into general category
    h_lower = clean_h.casefold()
    if "nội dung" in h_lower or "noi dung" in h_lower:
        return "Nội dung hướng dẫn", clean_h
    elif "giảng viên" in h_lower or "giang vien" in h_lower or "báo cáo viên" in h_lower:
        return "Giảng viên", clean_h
    elif "chuẩn bị" in h_lower or "to chuc" in h_lower or "tổ chức" in h_lower:
        return "Công tác chuẩn bị", clean_h
    return "Tiêu chí đánh giá", clean_h


def parse_survey_file(file_bytes: bytes, filename: str) -> Dict[str, Any]:
    """Parse Excel (.xlsx) or CSV survey export file and compute verified statistics."""
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise ValueError(f"Dung lượng tệp vượt quá giới hạn 5MB ({len(file_bytes)} bytes).")

    fname_lower = filename.lower()
    headers: List[str] = []
    rows: List[List[Any]] = []

    if fname_lower.endswith(".xlsx"):
        # Verify ZIP PK magic byte
        if not file_bytes.startswith(b"PK\x03\x04"):
            raise ValueError("Tệp .xlsx không đúng định dạng chuẩn (thiếu mã nhận diện ZIP).")
        try:
            wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
            sheet = wb.active
            if sheet is None:
                raise ValueError("Tệp Excel không chứa bảng tính (sheet) hợp lệ.")

            row_iter = sheet.iter_rows(values_only=True)
            header_row = next(row_iter, None)
            if not header_row:
                raise ValueError("Tệp Excel rỗng, không có hàng tiêu đề.")
            headers = [str(c or "").strip() for c in header_row]

            row_count = 0
            for r in row_iter:
                row_count += 1
                if row_count > MAX_ROWS:
                    break
                # Only keep rows that have at least one non-empty cell
                if any(c is not None and str(c).strip() for c in r):
                    rows.append(list(r))
            wb.close()
        except Exception as exc:
            if isinstance(exc, ValueError):
                raise
            raise ValueError(f"Không thể đọc tệp Excel: {exc}")

    elif fname_lower.endswith(".csv"):
        # Try UTF-8-sig first (common for Excel CSV exports), then UTF-8, then CP1258
        decoded_text = ""
        for encoding in ["utf-8-sig", "utf-8", "cp1258", "latin-1"]:
            try:
                decoded_text = file_bytes.decode(encoding)
                break
            except UnicodeDecodeError:
                continue

        if not decoded_text:
            raise ValueError("Không thể giải mã nội dung tệp CSV.")

        reader = csv.reader(io.StringIO(decoded_text))
        header_row = next(reader, None)
        if not header_row:
            raise ValueError("Tệp CSV rỗng, không có hàng tiêu đề.")
        headers = [str(c or "").strip() for c in header_row]

        row_count = 0
        for r in reader:
            row_count += 1
            if row_count > MAX_ROWS:
                break
            if any(c and str(c).strip() for c in r):
                rows.append(r)
    else:
        raise ValueError("Chỉ hỗ trợ tệp định dạng .xlsx hoặc .csv.")

    total_responses = len(rows)
    if total_responses == 0:
        raise ValueError("Tệp khảo sát không có dữ liệu phản hồi.")

    # Categorize columns
    col_mapping: List[Dict[str, Any]] = []
    for idx, h in enumerate(headers):
        if not h:
            continue
        if _is_pii_column(h):
            continue  # Strictly omit PII columns

        is_open = _is_open_feedback_column(h)
        category, criterion = _extract_category_and_criterion(h)
        col_mapping.append({
            "col_idx": idx,
            "header": h,
            "is_open": is_open,
            "category": category,
            "criterion": criterion,
        })

    # Tally rating columns and collect open feedback
    categories_dict: Dict[str, Dict[str, Any]] = {}
    criteria_scores: Dict[str, Dict[str, Any]] = {}
    open_feedback_list: List[str] = []

    total_ratings_count = 0
    total_rating_points = 0
    total_good_or_very_good = 0

    for col in col_mapping:
        c_idx = col["col_idx"]
        cat_name = col["category"]
        crit_name = col["criterion"]

        if col["is_open"]:
            # Extract open feedback
            for row in rows:
                if c_idx < len(row):
                    cleaned = _clean_feedback_text(row[c_idx])
                    if cleaned and cleaned not in open_feedback_list:
                        open_feedback_list.append(cleaned)
            continue

        # Check if this column contains ratings
        col_ratings = []
        for row in rows:
            if c_idx < len(row):
                rating_res = _normalize_rating_val(row[c_idx])
                if rating_res is not None:
                    col_ratings.append(rating_res)

        # If column has at least 1 valid rating, consider it a rating column
        if not col_ratings:
            continue

        if cat_name not in categories_dict:
            categories_dict[cat_name] = {
                "name": cat_name,
                "total_ratings": 0,
                "good_or_very_good_count": 0,
                "total_points": 0,
                "detail_counts": {"Rất tốt": 0, "Tốt": 0, "Bình thường": 0, "Chưa tốt": 0, "Kém": 0},
            }

        if crit_name not in criteria_scores:
            criteria_scores[crit_name] = {
                "name": crit_name,
                "category": cat_name,
                "total_ratings": 0,
                "total_points": 0,
                "good_or_very_good_count": 0,
            }

        for label, score in col_ratings:
            categories_dict[cat_name]["total_ratings"] += 1
            categories_dict[cat_name]["total_points"] += score
            if label in categories_dict[cat_name]["detail_counts"]:
                categories_dict[cat_name]["detail_counts"][label] += 1
            if score >= 80:  # Tốt (80) or Rất tốt (100)
                categories_dict[cat_name]["good_or_very_good_count"] += 1
                total_good_or_very_good += 1

            criteria_scores[crit_name]["total_ratings"] += 1
            criteria_scores[crit_name]["total_points"] += score
            if score >= 80:
                criteria_scores[crit_name]["good_or_very_good_count"] += 1

            total_ratings_count += 1
            total_rating_points += score

    # Format category results
    categories_list = []
    allowed_numbers: set[float] = {
        float(total_responses),
        float(total_ratings_count),
    }

    for cat_name, data in categories_dict.items():
        t_cat = data["total_ratings"]
        if t_cat == 0:
            continue
        g_cat = data["good_or_very_good_count"]
        pct_good = round((g_cat / t_cat) * 100, 1)
        score_avg = round(data["total_points"] / t_cat, 2)

        allowed_numbers.add(float(t_cat))
        allowed_numbers.add(float(g_cat))
        allowed_numbers.add(float(pct_good))
        allowed_numbers.add(float(score_avg))
        for cnt in data["detail_counts"].values():
            allowed_numbers.add(float(cnt))

        categories_list.append({
            "name": cat_name,
            "total_ratings": t_cat,
            "good_or_very_good_count": g_cat,
            "good_or_very_good_percent": pct_good,
            "satisfaction_score": score_avg,
            "detail_counts": data["detail_counts"],
        })

    # Overall satisfaction
    overall_satisfaction = round(total_rating_points / total_ratings_count, 2) if total_ratings_count > 0 else 0.0
    overall_good_pct = round((total_good_or_very_good / total_ratings_count) * 100, 1) if total_ratings_count > 0 else 0.0
    allowed_numbers.add(float(overall_satisfaction))
    allowed_numbers.add(float(overall_good_pct))

    # Determine highest and lowest criteria
    top_rated_criterion = ""
    notable_criterion = ""
    sorted_criteria = []
    for crit_name, c_data in criteria_scores.items():
        if c_data["total_ratings"] > 0:
            avg = round(c_data["total_points"] / c_data["total_ratings"], 2)
            c_good_pct = round((c_data["good_or_very_good_count"] / c_data["total_ratings"]) * 100, 1)
            allowed_numbers.add(float(avg))
            allowed_numbers.add(float(c_good_pct))
            sorted_criteria.append((crit_name, avg, c_data["total_ratings"]))

    if sorted_criteria:
        sorted_criteria.sort(key=lambda x: (x[1], x[2]), reverse=True)
        top_rated_criterion = sorted_criteria[0][0]
        notable_criterion = sorted_criteria[-1][0]

    return {
        "has_survey": True,
        "total_responses": total_responses,
        "total_ratings": total_ratings_count,
        "categories": categories_list,
        "overall_satisfaction_percent": overall_satisfaction,
        "overall_good_or_very_good_percent": overall_good_pct,
        "top_rated_criterion": top_rated_criterion,
        "notable_criterion": notable_criterion,
        "open_feedback_points": open_feedback_list[:10],
        "allowed_numbers": sorted(list(allowed_numbers)),
    }
