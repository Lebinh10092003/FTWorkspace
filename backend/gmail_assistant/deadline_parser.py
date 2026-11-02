"""
Pure Python deadline parser and normalizer for Gmail Assistant:
- Converts relative deadlines ("hôm nay", "ngày mai", "trước 17h thứ 4", etc.)
  based on email received_at date into absolute dates (dd/mm/yyyy).
- Preserves exact hours/minutes if present.
- Computes standard ISO due_date for sorting, filtering, and schedule creation.
- Timezone-aware using Asia/Ho_Chi_Minh (ICT).
"""

from datetime import date, datetime, time, timedelta
import re
from typing import Optional, Tuple
from zoneinfo import ZoneInfo

ICT_TZ = ZoneInfo("Asia/Ho_Chi_Minh")

WEEKDAY_MAP = {
    "2": 0,
    "hai": 0,
    "3": 1,
    "ba": 1,
    "4": 2,
    "tư": 2,
    "tu": 2,
    "bốn": 2,
    "bon": 2,
    "5": 3,
    "năm": 3,
    "nam": 3,
    "6": 4,
    "sáu": 4,
    "sau": 4,
    "7": 5,
    "bảy": 5,
    "bay": 5,
    "chủ nhật": 6,
    "chu nhat": 6,
    "cn": 6,
}


def to_ict_datetime(dt_or_str: Optional[object]) -> datetime:
    """Normalize a datetime, date, or ISO string to an ICT datetime object."""
    if dt_or_str is None:
        return datetime.now(ICT_TZ)
    if isinstance(dt_or_str, datetime):
        if dt_or_str.tzinfo is None:
            return dt_or_str.replace(tzinfo=ICT_TZ)
        return dt_or_str.astimezone(ICT_TZ)
    if isinstance(dt_or_str, date):
        return datetime.combine(dt_or_str, time(0, 0), tzinfo=ICT_TZ)
    if isinstance(dt_or_str, str):
        try:
            parsed = datetime.fromisoformat(dt_or_str.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=ICT_TZ)
            return parsed.astimezone(ICT_TZ)
        except Exception:
            pass
    return datetime.now(ICT_TZ)


def extract_time_component(text: str) -> Tuple[Optional[time], str]:
    """
    Extract time (hour and minute) from deadline text:
    Matches patterns like '17h', '17h30', '17:00', '17:30', '9h sáng', '2h chiều', etc.
    Returns (time_obj, cleaned_text_without_time).
    """
    if not text:
        return None, ""

    raw = text.strip()

    # Pattern 1: HH:MM or HH:MM:SS
    m = re.search(r"\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b", raw)
    if m:
        hour = int(m.group(1))
        minute = int(m.group(2))
        cleaned = raw[:m.start()] + raw[m.end():]
        return time(hour, minute), cleaned.strip()

    # Pattern 2: HHhMM or HHh (e.g., 17h30, 17h, 9h)
    m = re.search(r"\b([01]?\d|2[0-3])\s*[hH]\s*([0-5]\d)?\b", raw)
    if m:
        hour = int(m.group(1))
        minute = int(m.group(2)) if m.group(2) else 0
        cleaned = raw[:m.start()] + raw[m.end():]

        # Check for "chiều" / "tối" with small hour (1h..11h chiều -> +12)
        if re.search(r"\b(chiều|tối)\b", raw, re.IGNORECASE) and 1 <= hour <= 11:
            hour += 12
        return time(hour, minute), cleaned.strip()

    # Pattern 3: "X giờ [Y phút] [sáng/chiều/tối]"
    m = re.search(r"\b([01]?\d|2[0-3])\s*giờ\s*([0-5]\d)?\b", raw, re.IGNORECASE)
    if m:
        hour = int(m.group(1))
        minute = int(m.group(2)) if m.group(2) else 0
        cleaned = raw[:m.start()] + raw[m.end():]
        if re.search(r"\b(chiều|tối)\b", raw, re.IGNORECASE) and 1 <= hour <= 11:
            hour += 12
        return time(hour, minute), cleaned.strip()

    return None, raw


def parse_deadline_to_absolute(
    raw_text: str,
    reference_date: Optional[object] = None,
    now: Optional[object] = None,
) -> Tuple[str, Optional[datetime]]:
    """
    Parse any raw deadline text into an absolute string and an ICT datetime:
    - If raw_text is empty or not identifiable as a deadline, returns ("", None).
    - If relative words ("hôm nay", "ngày mai", "thứ 4") are present:
      Resolves them relative to reference_date (the email received_at date).
    - Returns:
      - formatted: Absolute text representation (e.g., "17:00 30/10/2026" or "31/10/2026")
      - due_dt: Datetime object with ICT timezone (or None if unparseable).
    """
    if not raw_text or not str(raw_text).strip():
        return "", None

    text = str(raw_text).strip()
    norm = text.lower()

    ref_dt = to_ict_datetime(reference_date or now)
    ref_date = ref_dt.date()

    # 1. Extract time component if any
    time_val, text_rem = extract_time_component(text)
    norm_rem = text_rem.lower()

    target_date: Optional[date] = None

    # 2. Check for explicit absolute date patterns (ISO: yyyy-mm-dd or VN: dd/mm/yyyy or dd/mm)
    # Pattern: yyyy-mm-dd or yyyy/mm/dd
    m_iso = re.search(r"\b(\d{4})[/-](1[0-2]|0?[1-9])[/-](3[01]|[12]\d|0?[1-9])\b", text)
    if m_iso:
        year = int(m_iso.group(1))
        month = int(m_iso.group(2))
        day = int(m_iso.group(3))
        try:
            target_date = date(year, month, day)
        except ValueError:
            target_date = None

    # Pattern: dd/mm/yyyy or dd/mm or dd-mm-yyyy or dd-mm
    if not target_date:
        m_abs = re.search(r"\b(3[01]|[12]\d|0?[1-9])[/-](1[0-2]|0?[1-9])(?:[/-](\d{4}|\d{2}))?\b", text)
        if m_abs:
            day = int(m_abs.group(1))
            month = int(m_abs.group(2))
            raw_year = m_abs.group(3)
            if raw_year:
                year = int(raw_year) if len(raw_year) == 4 else 2000 + int(raw_year)
            else:
                year = ref_date.year
            try:
                target_date = date(year, month, day)
            except ValueError:
                target_date = None

    # Pattern: ngày dd tháng mm [năm yyyy]
    if not target_date:
        m_vndate = re.search(
            r"ngày\s*(3[01]|[12]\d|0?[1-9])\s*tháng\s*(1[0-2]|0?[1-9])(?:\s*năm\s*(\d{4}))?",
            norm,
        )
        if m_vndate:
            day = int(m_vndate.group(1))
            month = int(m_vndate.group(2))
            year = int(m_vndate.group(3)) if m_vndate.group(3) else ref_date.year
            try:
                target_date = date(year, month, day)
            except ValueError:
                target_date = None

    # 3. Check for relative day keywords if absolute date wasn't found
    if not target_date:
        # Check "hôm nay", "trong ngày", "sáng nay", "chiều nay", "hết ngày"
        if re.search(
            r"\b(?:hôm\s*nay|hom\s*nay|sáng\s*nay|sang\s*nay|trưa\s*nay|trua\s*nay|chiều\s*nay|chieu\s*nay|tối\s*nay|toi\s*nay|trong\s*ngày|trong\s*ngay|hết\s*ngày|het\s*ngay)\b",
            norm,
        ):
            target_date = ref_date

        # Check "ngày mai", "sáng mai", "chiều mai", "trưa mai", "tối mai", "mai"
        elif re.search(
            r"\b(?:ngày\s*mai|ngay\s*mai|sáng\s*mai|sang\s*mai|trưa\s*mai|trua\s*mai|chiều\s*mai|chieu\s*mai|tối\s*mai|toi\s*mai|mai)\b",
            norm,
        ):
            target_date = ref_date + timedelta(days=1)

        # Check "ngày kia", "ngày mốt", "ngay kia", "ngay mot", "mốt"
        elif re.search(r"\b(?:ngày\s*kia|ngay\s*kia|ngày\s*mốt|ngay\s*mot|mốt|mot)\b", norm):
            target_date = ref_date + timedelta(days=2)
        elif re.search(r"\b(?:hôm\s*qua|hom\s*qua)\b", norm):
            target_date = ref_date - timedelta(days=1)

        # Check weekday: "thứ 2", "thứ hai", ..., "thứ 7", "chủ nhật", "cn"
        elif re.search(r"\b(?:thứ\s*([2-7]|hai|ba|tư|bốn|năm|sáu|bảy)|chủ\s*nhật|chu\s*nhat|cn)\b", norm):
            m_wd = re.search(
                r"\b(?:thứ\s*([2-7]|hai|ba|tư|tu|bốn|bon|năm|nam|sáu|sau|bảy|bay)|(chủ\s*nhật|chu\s*nhat|cn))\b",
                norm,
            )
            if m_wd:
                key = (m_wd.group(1) or m_wd.group(2) or "").strip().lower()
                target_wd = WEEKDAY_MAP.get(key)
                if target_wd is not None:
                    ref_wd = ref_date.weekday()
                    diff = target_wd - ref_wd
                    if diff < 0:
                        diff += 7
                    if any(w in norm for w in ["tuần sau", "tuan sau", "tuần tới", "tuan toi"]):
                        diff += 7
                    target_date = ref_date + timedelta(days=diff)

    # 4. Construct result
    if target_date:
        t = time_val or time(17, 0) if time_val else time(0, 0)
        due_dt = datetime.combine(target_date, t, tzinfo=ICT_TZ)

        date_formatted = target_date.strftime("%d/%m/%Y")
        if time_val:
            formatted_text = f"{time_val.strftime('%H:%M')} {date_formatted}"
        else:
            formatted_text = date_formatted

        return formatted_text, due_dt

    # Fallback: if no date could be parsed, keep original cleaned text
    return text, None


def normalize_deadline_display(raw_text: str, received_at: Optional[object] = None) -> str:
    """Convenience helper that returns only the absolute text display."""
    formatted, _ = parse_deadline_to_absolute(raw_text, reference_date=received_at)
    return formatted or raw_text
