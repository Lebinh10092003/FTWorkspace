"""Google Sheet two-way synchronization for Customer Product Subscriptions."""
from __future__ import annotations

import datetime
import hashlib
import json
import logging
import os
import re
import sys
import threading
from contextlib import contextmanager
from typing import Any, Dict, List, Optional

from django.conf import settings
from django.utils import timezone

from authentication.models import SystemConfig
from integrations.google_sheets import build_sheets_service, extract_spreadsheet_id
from .models import TrainingPartner, TrainingProduct, TrainingProductSubscription
from .serializers import product_subscription_status

logger = logging.getLogger(__name__)

DEFAULT_SPREADSHEET_ID = "1ENU0abZu6hCiVz-u7ypMLmLzudzMewKF_6s-6NJ26qk"
DEFAULT_TAB_TITLE = "Trang tính1"
SYNC_CONFIG_KEY = "customer_subscription_sheet_sync"

HEADERS = [
    "STT",
    "Mã ĐT",
    "Tên trường / Đơn vị",
    "Tỉnh / Thành phố",
    "Đầu mối liên hệ",
    "Số điện thoại",
    "Dịch vụ / Sản phẩm",
    "Số lượng",
    "Ngày bắt đầu",
    "Ngày hết hạn",
    "Còn lại (ngày)",
    "Trạng thái",
    "Nhân sự phụ trách",
    "Tiến độ & Ghi chú gia hạn",
    "Mã ĐK",
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
    # Thử parse ISO YYYY-MM-DD
    match = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", val_str)
    if match:
        try:
            return datetime.date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        except ValueError:
            pass
    # Thử parse DD/MM/YYYY
    match_vi = re.match(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", val_str)
    if match_vi:
        try:
            return datetime.date(int(match_vi.group(3)), int(match_vi.group(2)), int(match_vi.group(1)))
        except ValueError:
            pass
    return None


def _format_date(val: Optional[datetime.date]) -> str:
    return val.strftime("%d/%m/%Y") if val else ""


def export_subscriptions_to_sheet(*, force: bool = False) -> Dict[str, Any]:
    """Xuất danh sách đăng ký dịch vụ của khách hàng ra Google Sheet.
    Giữ nguyên các ghi chú và ô chỉ có trên Sheet, bảo toàn công thức STT và Còn lại ngày.
    """
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

    # 1. Lấy metadata sheet
    metadata = service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields="sheets(properties(sheetId,title,hidden))",
    ).execute()
    sheet_props = None
    target_title = DEFAULT_TAB_TITLE
    for s in metadata.get("sheets", []):
        props = s.get("properties", {})
        title = props.get("title", "")
        if title in {DEFAULT_TAB_TITLE, "Dịch vụ khách hàng", "Theo dõi dịch vụ"} or not sheet_props:
            sheet_props = props
            target_title = title
            if title != "Trang tính1":
                break

    if not sheet_props:
        return {"status": "error", "message": "Không tìm thấy sheet nào trong file."}

    sheet_id = sheet_props["sheetId"]
    escaped_title = "'" + target_title.replace("'", "''") + "'"

    # 2. Đọc các dòng hiện tại trên Sheet để giữ dữ liệu thủ công của người dùng
    read_res = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{escaped_title}!A1:O500",
        valueRenderOption="UNFORMATTED_VALUE",
    ).execute()
    existing_rows = read_res.get("values", [])

    # Map các dòng hiện có: key là sub_id (Col O - index 14) hoặc partner_id:product_name
    sheet_row_map = {}
    for idx, row in enumerate(existing_rows):
        if idx < 2:  # Bỏ qua row 1 và header row 2
            continue
        sub_id_val = str(row[14]).strip() if len(row) > 14 and row[14] is not None else ""
        partner_val = str(row[1]).strip() if len(row) > 1 and row[1] is not None else ""
        prod_val = str(row[6]).strip().lower() if len(row) > 6 and row[6] is not None else ""

        assigned_staff = str(row[12]).strip() if len(row) > 12 and row[12] is not None else ""
        custom_notes = str(row[13]).strip() if len(row) > 13 and row[13] is not None else ""

        if sub_id_val.isdigit():
            sheet_row_map[f"sub:{sub_id_val}"] = {
                "row_index": idx + 1,
                "assigned_staff": assigned_staff,
                "custom_notes": custom_notes,
            }
        if partner_val.isdigit() and prod_val:
            sheet_row_map[f"pair:{partner_val}:{prod_val}"] = {
                "row_index": idx + 1,
                "assigned_staff": assigned_staff,
                "custom_notes": custom_notes,
            }

    # 3. Chuẩn bị danh sách dữ liệu từ Web
    subscriptions = TrainingProductSubscription.objects.select_related("partner", "product").order_by(
        "partner__name", "product__display_order"
    )

    today = timezone.localdate()
    rows_to_write = []

    # Dòng 1: Banner tiêu đề
    title_row = ["FT. BẢNG THEO DÕI KHÁCH HÀNG, DỊCH VỤ & THỜI GIAN SỬ DỤNG"] + [""] * (len(HEADERS) - 1)
    rows_to_write.append(title_row)
    # Dòng 2: Header cột
    rows_to_write.append(HEADERS)

    for idx, sub in enumerate(subscriptions):
        partner = sub.partner
        product = sub.product
        row_num = idx + 3

        # Tra cứu xem trên Sheet đã có ghi chú hay nhân sự phụ trách chưa
        saved_info = (
            sheet_row_map.get(f"sub:{sub.id}")
            or sheet_row_map.get(f"pair:{partner.id}:{product.name.strip().lower()}")
            or {}
        )
        staff = saved_info.get("assigned_staff") or getattr(partner, "training_staff", "") or ""
        notes = sub.notes or saved_info.get("custom_notes") or ""

        # Tính trạng thái hiển thị
        eff_status = product_subscription_status(sub)
        status_vi = {
            "active": "Đang sử dụng",
            "expiring": "Sắp hết hạn",
            "expired": "Đã quá hạn",
            "paused": "Tạm dừng",
            "cancelled": "Đã hủy",
        }.get(eff_status, "Đang sử dụng")

        # Công thức cho cột A (STT), K (Còn lại), L (Trạng thái tự động nếu muốn)
        # Cột A: Tự động đánh số theo STT
        # Cột K: Số ngày còn lại: =IF(ISBLANK(J{row_num}), "", INT(J{row_num} - TODAY()))
        # Cột L: Ghi nhãn trực tiếp hoặc công thức
        days_left_formula = f'=IF(ISBLANK(J{row_num}); ""; INT(J{row_num} - TODAY()))'
        stt_val = idx + 1

        row_data = [
            stt_val,  # A: STT
            partner.id,  # B: Mã ĐT
            partner.name,  # C: Tên trường
            partner.province or "",  # D: Tỉnh/TP
            partner.contact_person or "",  # E: Người liên hệ
            partner.phone or "",  # F: SĐT
            product.name,  # G: Dịch vụ
            sub.quantity,  # H: Số lượng
            _format_date(sub.starts_at),  # I: Bắt đầu
            _format_date(sub.expires_at),  # J: Hết hạn
            days_left_formula,  # K: Còn lại (ngày)
            status_vi,  # L: Trạng thái
            staff,  # M: Nhân sự phụ trách
            notes,  # N: Ghi chú gia hạn
            sub.id,  # O: Mã ĐK (Sub ID)
        ]
        rows_to_write.append(row_data)

    fingerprint = hashlib.sha256(
        json.dumps(rows_to_write, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()

    sync_config, _ = SystemConfig.objects.get_or_create(key=SYNC_CONFIG_KEY)
    if not force and (sync_config.data or {}).get("fingerprint") == fingerprint:
        return {"status": "unchanged", "count": len(subscriptions)}

    # 4. Ghi dữ liệu vào Google Sheet
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"{escaped_title}!A1:O{len(rows_to_write)}",
        valueInputOption="USER_ENTERED",
        body={"values": rows_to_write},
    ).execute()

    # 5. Cập nhật định dạng (Màu xanh chủ đạo, in đậm header, đóng băng 2 hàng đầu, border)
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
        # Định dạng Banner Hàng 1: Nền xanh dương #1D4ED8, chữ trắng in đậm lớn
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
                        "backgroundColor": {"red": 0.11, "green": 0.31, "blue": 0.85},  # #1D4ED8
                        "horizontalAlignment": "CENTER",
                    }
                },
                "fields": "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)",
            }
        },
        # Định dạng Header Hàng 2: Nền xanh nhạt #DBEAFE, chữ xanh đậm #1E3A8A in đậm
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
                        "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": {"red": 0.12, "green": 0.23, "blue": 0.54}},
                        "backgroundColor": {"red": 0.86, "green": 0.92, "blue": 0.99},  # #DBEAFE
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
        "totalRecords": len(subscriptions),
    }
    sync_config.save(update_fields=["data"])

    return {
        "status": "synced",
        "spreadsheet_id": spreadsheet_id,
        "tab_title": target_title,
        "count": len(subscriptions),
    }


def import_subscriptions_from_sheet(start_row: int = 3, end_row: Optional[int] = None) -> Dict[str, Any]:
    """Đọc dữ liệu thay đổi từ Sheet và tự động cập nhật vào Web theo từng dòng.
    Không chờ duyệt, lỗi 1 dòng chỉ bỏ qua dòng đó.
    """
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
        range=f"'{DEFAULT_TAB_TITLE}'!A{start_row}:O{range_end}",
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
            sub_id_str = str(row[14]).strip() if len(row) > 14 else ""
            partner_id_str = str(row[1]).strip() if len(row) > 1 else ""
            partner_name_str = str(row[2]).strip() if len(row) > 2 else ""
            product_name_str = str(row[6]).strip() if len(row) > 6 else ""
            quantity_str = str(row[7]).strip() if len(row) > 7 else "1"
            starts_at_str = str(row[8]).strip() if len(row) > 8 else ""
            expires_at_str = str(row[9]).strip() if len(row) > 9 else ""
            status_str = str(row[11]).strip().lower() if len(row) > 11 else ""
            notes_str = str(row[13]).strip() if len(row) > 13 else ""

            # 1. Tìm bản ghi subscription
            sub = None
            if sub_id_str.isdigit():
                sub = TrainingProductSubscription.objects.filter(pk=int(sub_id_str)).first()

            if not sub and partner_id_str.isdigit() and product_name_str:
                sub = TrainingProductSubscription.objects.filter(
                    partner_id=int(partner_id_str),
                    product__name__iexact=product_name_str,
                ).first()

            if not sub and partner_name_str and product_name_str:
                sub = TrainingProductSubscription.objects.filter(
                    partner__name__iexact=partner_name_str,
                    product__name__iexact=product_name_str,
                ).first()

            if not sub:
                skipped_count += 1
                errors.append(f"Dòng {current_row_num}: Không tìm thấy dịch vụ khớp (Trường: '{partner_name_str}', Dịch vụ: '{product_name_str}')")
                continue

            # 2. Cập nhật các trường
            updates = []
            starts_at = _parse_date_cell(starts_at_str)
            if starts_at and sub.starts_at != starts_at:
                sub.starts_at = starts_at
                updates.append("starts_at")

            expires_at = _parse_date_cell(expires_at_str)
            if expires_at and sub.expires_at != expires_at:
                sub.expires_at = expires_at
                updates.append("expires_at")
                sub.expiry_notice_stage = 0  # reset cờ cảnh báo khi có hạn mới
                updates.append("expiry_notice_stage")

            if quantity_str.isdigit() and int(quantity_str) > 0 and sub.quantity != int(quantity_str):
                sub.quantity = int(quantity_str)
                updates.append("quantity")

            # Map status tiếng Việt sang status code
            if "tạm dừng" in status_str:
                mapped_status = "paused"
            elif "hủy" in status_str:
                mapped_status = "cancelled"
            else:
                mapped_status = "active"

            if sub.status != mapped_status:
                sub.status = mapped_status
                updates.append("status")

            if notes_str and notes_str != sub.notes:
                sub.notes = notes_str
                updates.append("notes")

            if updates:
                sub.save(update_fields=[*updates, "updated_at"])
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


def sync_subscriptions_safely(*, force: bool = False) -> Dict[str, Any]:
    """Quy trình đồng bộ an toàn 2 chiều:
    1. Quét nhận các thay đổi từ Sheet vào Web trước
    2. Sau đó xuất cập nhật dữ liệu Web ra Sheet
    """
    with _sync_lock:
        import_res = import_subscriptions_from_sheet()
        export_res = export_subscriptions_to_sheet(force=force)
        return {
            "imported": import_res,
            "exported": export_res,
        }
