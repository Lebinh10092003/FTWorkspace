"""Google Sheet two-way synchronization for Digital Training Sessions (Nhật ký tập huấn)."""
from __future__ import annotations

import datetime
import hashlib
import json
import logging
import os
import re
import threading
from typing import Any, Dict, List, Optional

from django.conf import settings
from django.db import models
from django.utils import timezone

from authentication.models import SystemConfig
from integrations.google_sheets import build_sheets_service, extract_spreadsheet_id
from .models import TrainingClass, TrainingPartner, TrainingSession

logger = logging.getLogger(__name__)

DEFAULT_SPREADSHEET_ID = "1ENU0abZu6hCiVz-u7ypMLmLzudzMewKF_6s-6NJ26qk"
TRAINING_TAB_TITLE = "Nhật ký tập huấn"
SYNC_CONFIG_KEY = "training_sessions_sheet_sync"

HEADERS = [
    "STT",                  # A: STT
    "Mã Buổi",              # B: session.id (Khóa neo)
    "Ngày tập huấn",        # C: DD/MM/YYYY
    "Khung giờ",            # D: HH:MM - HH:MM
    "Đơn vị / Trường",      # E: Tên trường
    "Lớp / Phân nhóm",      # F: Tên lớp học
    "Nội dung chủ đề",      # G: Nội dung giảng dạy
    "Buổi số",              # H: Buổi 1, 2, 3...
    "Tổng số buổi",         # I: Tổng số buổi của lớp/gói
    "Tiến độ",              # J: Công thức =IF(OR(ISBLANK(H3); ISBLANK(I3)); ""; H3 & "/" & I3)
    "Giảng viên chính",     # K: Giảng viên / Báo cáo viên
    "Trợ giảng / Hỗ trợ",   # L: Hỗ trợ kỹ thuật
    "Hình thức & Địa điểm", # M: Trực tiếp / Google Meet / Zoom
    "Số học viên",          # N: Số người tham dự
    "Trạng thái",           # O: Đã hoàn thành / Đã lên lịch / Đã hủy
    "Ghi chú & Đánh giá",   # P: Đánh giá chất lượng / lưu ý
]

_sync_lock = threading.Lock()


def get_spreadsheet_id() -> str:
    sync_config = SystemConfig.objects.filter(key=SYNC_CONFIG_KEY).first()
    configured = (sync_config.data or {}).get("spreadsheetId") if sync_config else None
    if configured:
        return extract_spreadsheet_id(configured) or configured.strip()
    return os.getenv("CUSTOMER_SUBSCRIPTION_SHEET_ID", DEFAULT_SPREADSHEET_ID).strip()


def _parse_date_cell(value: Any) -> Optional[datetime.date]:
    if not value:
        return None
    val_str = str(value).strip()
    if not val_str:
        return None
    # ISO YYYY-MM-DD
    match = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", val_str)
    if match:
        try:
            return datetime.date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        except ValueError:
            pass
    # DD/MM/YYYY
    match_vi = re.match(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", val_str)
    if match_vi:
        try:
            return datetime.date(int(match_vi.group(3)), int(match_vi.group(2)), int(match_vi.group(1)))
        except ValueError:
            pass
    return None


def _parse_time_range(value: Any) -> tuple[Optional[datetime.time], Optional[datetime.time]]:
    if not value:
        return None, None
    val_str = str(value).strip()
    match = re.search(r"(\d{1,2})[:h](\d{2})?\s*[-–~]\s*(\d{1,2})[:h](\d{2})?", val_str)
    if match:
        sh = int(match.group(1))
        sm = int(match.group(2) or 0)
        eh = int(match.group(3))
        em = int(match.group(4) or 0)
        try:
            return datetime.time(sh, sm), datetime.time(eh, em)
        except ValueError:
            pass
    # Chỉ có giờ bắt đầu
    match_start = re.search(r"(\d{1,2})[:h](\d{2})", val_str)
    if match_start:
        sh = int(match_start.group(1))
        sm = int(match_start.group(2) or 0)
        try:
            return datetime.time(sh, sm), None
        except ValueError:
            pass
    return None, None


def _format_date(val: Optional[datetime.date]) -> str:
    return val.strftime("%d/%m/%Y") if val else ""


def _format_time_range(start: Optional[datetime.time], end: Optional[datetime.time]) -> str:
    if not start:
        return ""
    start_str = start.strftime("%H:%M")
    if not end:
        return start_str
    return f"{start_str} - {end.strftime('%H:%M')}"


def export_training_sessions_to_sheet(*, force: bool = False) -> Dict[str, Any]:
    """Xuất toàn bộ danh sách các buổi tập huấn ra Tab 'Nhật ký tập huấn' của Google Sheet."""
    spreadsheet_id = get_spreadsheet_id()
    if not spreadsheet_id:
        return {"status": "error", "message": "Chưa cấu hình Google Spreadsheet ID."}

    main_config = SystemConfig.objects.filter(key="main").first()
    cfg = (main_config.data if main_config else {}) or {}
    token = main_config.last_google_access_token if main_config else None

    try:
        service = build_sheets_service(token, cfg)
    except Exception as exc:
        logger.warning(f"Không thể khởi tạo Sheets service: {exc}")
        return {"status": "error", "message": f"Lỗi xác thực Google Service Account: {exc}"}

    # 1. Tìm hoặc tự động tạo Tab 'Nhật ký tập huấn'
    metadata = service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields="sheets(properties(sheetId,title,hidden))",
    ).execute()

    sheet_props = None
    target_title = TRAINING_TAB_TITLE
    for s in metadata.get("sheets", []):
        props = s.get("properties", {})
        title = props.get("title", "")
        if title in {TRAINING_TAB_TITLE, "Theo dõi tập huấn", "Lịch tập huấn"}:
            sheet_props = props
            target_title = title
            break

    # Nếu tab chưa có thì tạo mới
    if not sheet_props:
        try:
            add_req = {
                "addSheet": {
                    "properties": {
                        "title": target_title,
                        "gridProperties": {"rowCount": 500, "columnCount": len(HEADERS) + 2},
                    }
                }
            }
            create_res = service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": [add_req]},
            ).execute()
            sheet_props = create_res.get("replies", [{}])[0].get("addSheet", {}).get("properties")
        except Exception as add_err:
            return {"status": "error", "message": f"Không thể tạo tab '{target_title}': {add_err}"}

    sheet_id = sheet_props["sheetId"]
    escaped_title = "'" + target_title.replace("'", "''") + "'"

    # 2. Đọc các dòng hiện tại trên Sheet để giữ ghi chú hoặc ô sửa tay
    read_res = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{escaped_title}!A1:P500",
        valueRenderOption="UNFORMATTED_VALUE",
    ).execute()
    existing_rows = read_res.get("values", [])

    sheet_row_map = {}
    for idx, row in enumerate(existing_rows):
        if idx < 2:
            continue
        session_id_val = str(row[1]).strip() if len(row) > 1 and row[1] is not None else ""
        custom_notes = str(row[15]).strip() if len(row) > 15 and row[15] is not None else ""
        if session_id_val.isdigit():
            sheet_row_map[int(session_id_val)] = {
                "row_index": idx + 1,
                "custom_notes": custom_notes,
            }

    # 3. Chuẩn bị danh mục buổi tập huấn từ Web
    sessions = TrainingSession.objects.select_related("partner_ref", "training_class").order_by(
        "session_date", "start_time", "partner_ref__name", "session_number", "id"
    )

    rows_to_write = []
    # Dòng 1: Banner Tiêu đề
    title_row = ["FT. NHẬT KÝ & TIẾN ĐỘ TẬP HUẤN ĐÀO TẠO SỐ"] + [""] * (len(HEADERS) - 1)
    rows_to_write.append(title_row)
    # Dòng 2: Headers
    rows_to_write.append(HEADERS)

    for idx, session in enumerate(sessions):
        row_num = idx + 3
        stt_val = idx + 1
        partner_name = session.partner_ref.name if session.partner_ref else (session.partner or "")
        class_name = session.training_class.name if session.training_class else ""
        content_summary = " · ".join(session.contents) if session.contents else session.title

        # Tổng số buổi dự kiến
        total_sessions = ""
        if session.training_class and session.training_class.planned_sessions:
            total_sessions = session.training_class.planned_sessions
        elif session.partner_ref and session.partner_ref.planned_sessions:
            total_sessions = session.partner_ref.planned_sessions

        session_num = session.session_number or ""

        # Công thức tiến độ
        progress_formula = f'=IF(OR(ISBLANK(H{row_num}); ISBLANK(I{row_num})); ""; H{row_num} & "/" & I{row_num})'

        # Trạng thái hiển thị tiếng Việt
        status_map = {
            "completed": "Đã hoàn thành",
            "planned": "Đã lên lịch",
            "unscheduled": "Chưa có lịch",
            "cancelled": "Đã hủy",
        }
        status_vi = status_map.get(session.status, "Đã lên lịch")

        saved_info = sheet_row_map.get(session.id, {})
        notes = session.notes or saved_info.get("custom_notes") or ""

        row_data = [
            stt_val,                                            # A: STT
            session.id,                                         # B: Mã Buổi
            _format_date(session.session_date),                 # C: Ngày tập huấn
            _format_time_range(session.start_time, session.end_time),  # D: Khung giờ
            partner_name,                                       # E: Đơn vị / Trường
            class_name,                                         # F: Lớp / Phân nhóm
            content_summary,                                    # G: Nội dung chủ đề
            session_num,                                        # H: Buổi số
            total_sessions,                                     # I: Tổng số buổi
            progress_formula,                                   # J: Tiến độ
            session.instructor_name or session.staff_name or "", # K: Giảng viên chính
            session.support_staff_name or "",                   # L: Trợ giảng / Hỗ trợ
            session.location or "",                             # M: Hình thức & Địa điểm
            session.attendees or "",                            # N: Số học viên
            status_vi,                                          # O: Trạng thái
            notes,                                              # P: Ghi chú & Đánh giá
        ]
        rows_to_write.append(row_data)

    fingerprint = hashlib.sha256(
        json.dumps(rows_to_write, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()

    sync_config, _ = SystemConfig.objects.get_or_create(key=SYNC_CONFIG_KEY)
    if not force and (sync_config.data or {}).get("fingerprint") == fingerprint:
        return {"status": "unchanged", "count": len(sessions)}

    # 4. Ghi toàn bộ dữ liệu ra Google Sheet
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"{escaped_title}!A1:P{len(rows_to_write)}",
        valueInputOption="USER_ENTERED",
        body={"values": rows_to_write},
    ).execute()

    # 5. Định dạng chuyên nghiệp (Màu Teal nhận diện cho mảng Đào tạo số)
    format_requests = [
        # Đóng băng 2 hàng đầu
        {
            "updateSheetProperties": {
                "properties": {
                    "sheetId": sheet_id,
                    "gridProperties": {"frozenRowCount": 2},
                },
                "fields": "gridProperties.frozenRowCount",
            }
        },
        # Banner Hàng 1: Nền Teal đậm #0F766E, chữ trắng in đậm lớn
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": len(HEADERS),
                },
                "cell": {
                    "userEnteredFormat": {
                        "textFormat": {"bold": True, "fontSize": 12, "foregroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0}},
                        "backgroundColor": {"red": 0.06, "green": 0.46, "blue": 0.43},  # #0F766E
                        "horizontalAlignment": "CENTER",
                    }
                },
                "fields": "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)",
            }
        },
        # Header Hàng 2: Nền Teal nhạt #CCFBF1, chữ xanh đậm #115E59
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 1,
                    "endRowIndex": 2,
                    "startColumnIndex": 0,
                    "endColumnIndex": len(HEADERS),
                },
                "cell": {
                    "userEnteredFormat": {
                        "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": {"red": 0.07, "green": 0.37, "blue": 0.35}},
                        "backgroundColor": {"red": 0.8, "green": 0.98, "blue": 0.95},  # #CCFBF1
                        "horizontalAlignment": "CENTER",
                    }
                },
                "fields": "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)",
            }
        },
    ]

    try:
        service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": format_requests},
        ).execute()
    except Exception as exc:
        logger.warning(f"Batch format warning: {exc}")

    sync_config.data = {
        "spreadsheetId": spreadsheet_id,
        "tabTitle": target_title,
        "fingerprint": fingerprint,
        "syncedAt": timezone.now().isoformat(),
        "totalRecords": len(sessions),
    }
    sync_config.save(update_fields=["data"])

    return {
        "status": "synced",
        "spreadsheet_id": spreadsheet_id,
        "tab_title": target_title,
        "count": len(sessions),
    }


def import_training_sessions_from_sheet(start_row: int = 3, end_row: Optional[int] = None) -> Dict[str, Any]:
    """Đọc dữ liệu thay đổi từ Sheet và tự động cập nhật vào Web theo từng dòng."""
    spreadsheet_id = get_spreadsheet_id()
    if not spreadsheet_id:
        return {"status": "error", "message": "Chưa cấu hình Google Spreadsheet ID."}

    main_config = SystemConfig.objects.filter(key="main").first()
    cfg = (main_config.data if main_config else {}) or {}
    token = main_config.last_google_access_token if main_config else None

    try:
        service = build_sheets_service(token, cfg)
    except Exception as exc:
        return {"status": "error", "message": f"Lỗi xác thực Sheets service: {exc}"}

    range_end = end_row or 500
    read_res = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"'{TRAINING_TAB_TITLE}'!A{start_row}:P{range_end}",
        valueRenderOption="FORMATTED_VALUE",
    ).execute()
    rows = read_res.get("values", [])

    updated_count = 0
    skipped_count = 0
    errors = []

    for r_idx, row in enumerate(rows):
        current_row_num = start_row + r_idx
        if not row or not any(str(c).strip() for c in row):
            continue

        try:
            session_id_str = str(row[1]).strip() if len(row) > 1 else ""
            session_date_str = str(row[2]).strip() if len(row) > 2 else ""
            time_range_str = str(row[3]).strip() if len(row) > 3 else ""
            partner_name_str = str(row[4]).strip() if len(row) > 4 else ""
            session_num_str = str(row[7]).strip() if len(row) > 7 else ""
            instructor_str = str(row[10]).strip() if len(row) > 10 else ""
            support_str = str(row[11]).strip() if len(row) > 11 else ""
            location_str = str(row[12]).strip() if len(row) > 12 else ""
            attendees_str = str(row[13]).strip() if len(row) > 13 else ""
            status_str = str(row[14]).strip().lower() if len(row) > 14 else ""
            notes_str = str(row[15]).strip() if len(row) > 15 else ""

            session = None
            if session_id_str.isdigit():
                session = TrainingSession.objects.filter(pk=int(session_id_str)).first()

            if not session and partner_name_str and session_date_str:
                parsed_d = _parse_date_cell(session_date_str)
                if parsed_d:
                    qs = TrainingSession.objects.filter(
                        session_date=parsed_d,
                    ).filter(
                        models.Q(partner_ref__name__iexact=partner_name_str) | models.Q(partner__iexact=partner_name_str)
                    )
                    if session_num_str.isdigit():
                        qs = qs.filter(session_number=int(session_num_str))
                    session = qs.first()

            if not session:
                skipped_count += 1
                errors.append(f"Dòng {current_row_num}: Không tìm thấy buổi tập huấn (Trường: '{partner_name_str}', Ngày: '{session_date_str}')")
                continue

            updates = []
            parsed_date = _parse_date_cell(session_date_str)
            if parsed_date and session.session_date != parsed_date:
                session.session_date = parsed_date
                updates.append("session_date")

            st, et = _parse_time_range(time_range_str)
            if st and session.start_time != st:
                session.start_time = st
                updates.append("start_time")
            if et and session.end_time != et:
                session.end_time = et
                updates.append("end_time")

            if instructor_str and instructor_str != session.instructor_name:
                session.instructor_name = instructor_str
                updates.append("instructor_name")

            if support_str and support_str != session.support_staff_name:
                session.support_staff_name = support_str
                updates.append("support_staff_name")

            if location_str and location_str != session.location:
                session.location = location_str
                updates.append("location")

            if attendees_str.isdigit() and int(attendees_str) != session.attendees:
                session.attendees = int(attendees_str)
                updates.append("attendees")

            # Trạng thái
            if "hoàn thành" in status_str:
                mapped_status = "completed"
            elif "hủy" in status_str:
                mapped_status = "cancelled"
            elif "chưa có" in status_str:
                mapped_status = "unscheduled"
            else:
                mapped_status = "planned"

            if session.status != mapped_status:
                session.status = mapped_status
                updates.append("status")

            if notes_str and notes_str != session.notes:
                session.notes = notes_str
                updates.append("notes")

            if updates:
                session.save(update_fields=[*updates, "updated_at"])
                updated_count += 1

        except Exception as item_err:
            skipped_count += 1
            errors.append(f"Dòng {current_row_num}: {item_err}")
            continue

    return {
        "status": "success",
        "updated": updated_count,
        "skipped": skipped_count,
        "errors": errors[:10],
    }


def sync_training_sessions_safely(*, force: bool = False) -> Dict[str, Any]:
    """Quy trình đồng bộ an toàn 2 chiều cho Nhật ký tập huấn:
    1. Nhận các thay đổi từ Sheet vào Web trước
    2. Xuất dữ liệu cập nhật từ Web ra Sheet
    """
    with _sync_lock:
        import_res = import_training_sessions_from_sheet()
        export_res = export_training_sessions_to_sheet(force=force)
        return {
            "imported": import_res,
            "exported": export_res,
        }
