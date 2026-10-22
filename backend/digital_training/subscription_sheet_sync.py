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

COLUMN_WIDTHS = [
    55,   # A: STT
    75,   # B: Mã ĐT
    280,  # C: Tên trường / Đơn vị
    130,  # D: Tỉnh / Thành phố
    150,  # E: Đầu mối liên hệ
    115,  # F: Số điện thoại
    180,  # G: Dịch vụ / Sản phẩm
    75,   # H: Số lượng
    100,  # I: Ngày bắt đầu
    100,  # J: Ngày hết hạn
    110,  # K: Còn lại (ngày)
    125,  # L: Trạng thái
    140,  # M: Nhân sự phụ trách
    280,  # N: Tiến độ & Ghi chú gia hạn
    75,   # O: Mã ĐK
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


def get_sync_credentials(google_token: Optional[str] = None) -> tuple[Optional[str], dict[str, Any], Optional[str]]:
    """Trả về (token, config_data, service_account_email) ưu tiên theo cấu hình riêng của subscription, sau đó đến main config."""
    sub_config = SystemConfig.objects.filter(key=SYNC_CONFIG_KEY).first()
    sub_data = (sub_config.data if sub_config else {}) or {}

    main_config = SystemConfig.objects.filter(key="main").first()
    main_data = (main_config.data if main_config else {}) or {}

    sa_json = (
        sub_data.get("googleServiceAccountJson")
        or main_data.get("googleServiceAccountJson")
        or os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    )

    sa_email = None
    if sa_json:
        try:
            parsed = json.loads(sa_json) if isinstance(sa_json, str) else sa_json
            sa_email = parsed.get("client_email")
        except Exception:
            pass

    config_data = dict(main_data)
    if sa_json:
        config_data["googleServiceAccountJson"] = sa_json if isinstance(sa_json, str) else json.dumps(sa_json)

    token = (
        google_token
        or sub_data.get("last_google_access_token")
        or (main_config.last_google_access_token if main_config else None)
    )
    return token, config_data, sa_email


def export_subscriptions_to_sheet(*, force: bool = False, google_token: Optional[str] = None) -> Dict[str, Any]:
    """Xuất danh sách đăng ký dịch vụ của khách hàng ra Google Sheet.
    Giữ nguyên các ghi chú và ô chỉ có trên Sheet, bảo toàn công thức STT và Còn lại ngày.
    """
    spreadsheet_id = get_spreadsheet_id()
    if not spreadsheet_id:
        return {"status": "error", "error_code": "NO_SPREADSHEET_ID", "message": "Chưa cấu hình Google Spreadsheet ID."}

    token, cfg, sa_email = get_sync_credentials(google_token)

    try:
        service = build_sheets_service(token, cfg)
    except Exception as exc:
        logger.warning(f"Không thể khởi tạo Sheets service: {exc}")
        return {
            "status": "error",
            "error_code": "NO_CREDENTIALS",
            "service_account_email": sa_email,
            "message": "Chưa cấu hình tài khoản Google Service Account. Bạn có thể dán Service Account JSON trong Cấu hình Sheet hoặc dùng Apps Script webhook để đồng bộ tự động mà không cần tài khoản dịch vụ.",
        }

    # 1. Lấy metadata sheet
    try:
        metadata = service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            fields="sheets(properties(sheetId,title,hidden))",
        ).execute()
    except Exception as exc:
        err_str = str(exc)
        if "403" in err_str or "permission" in err_str.lower():
            msg = f"Tài khoản dịch vụ chưa có quyền truy cập Sheet. Vui lòng nhấn nút Share trên Google Sheet và chia sẻ cho email: {sa_email or 'tài khoản dịch vụ'} (quyền Người chỉnh sửa/Editor)."
        elif "404" in err_str or "not found" in err_str.lower():
            msg = f"Không tìm thấy Google Sheet với ID '{spreadsheet_id}'. Vui lòng kiểm tra lại đường link hoặc Spreadsheet ID."
        else:
            msg = f"Lỗi truy cập Google Sheet: {exc}"
        return {"status": "error", "error_code": "SHEET_ACCESS_DENIED", "service_account_email": sa_email, "message": msg}
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
    payload = build_export_payload(sheet_row_map)
    rows_to_write = payload["rows"]
    subscriptions_count = payload["count"]

    fingerprint = hashlib.sha256(
        json.dumps(rows_to_write, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()

    sync_config, _ = SystemConfig.objects.get_or_create(key=SYNC_CONFIG_KEY)
    if not force and (sync_config.data or {}).get("fingerprint") == fingerprint:
        return {"status": "unchanged", "count": subscriptions_count}

    # 4. Ghi dữ liệu vào Google Sheet
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"{escaped_title}!A1:O{len(rows_to_write)}",
        valueInputOption="USER_ENTERED",
        body={"values": rows_to_write},
    ).execute()

    # 5. Cập nhật định dạng đầy đủ (Tạo bảng, cột, hàng, chiều cao, độ rộng, kẻ viền, đóng băng, màu sắc)
    format_requests: List[Dict[str, Any]] = [
        # 5.1. Đóng băng 2 hàng đầu
        {
            "updateSheetProperties": {
                "properties": {
                    "sheetId": sheet_id,
                    "gridProperties": {"frozenRowCount": 2},
                },
                "fields": "gridProperties.frozenRowCount",
            }
        },
        # 5.2. Gộp ô Banner A1:O1
        {
            "mergeCells": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": len(HEADERS),
                },
                "mergeType": "MERGE_ALL",
            }
        },
        # 5.3. Chiều cao dòng 1 (Banner: 38px)
        {
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": 0,
                    "endIndex": 1,
                },
                "properties": {"pixelSize": 38},
                "fields": "pixelSize",
            }
        },
        # 5.4. Chiều cao dòng 2 (Header: 30px)
        {
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": 1,
                    "endIndex": 2,
                },
                "properties": {"pixelSize": 30},
                "fields": "pixelSize",
            }
        },
        # 5.5. Chiều cao các dòng dữ liệu (25px)
        {
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": 2,
                    "endIndex": max(len(rows_to_write), 10),
                },
                "properties": {"pixelSize": 25},
                "fields": "pixelSize",
            }
        },
        # 5.6. Định dạng Banner Hàng 1: Nền xanh dương đậm #1D4ED8, chữ trắng in đậm 12pt, căn giữa
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
                        "backgroundColor": {"red": 0.114, "green": 0.306, "blue": 0.847},  # #1D4ED8
                        "horizontalAlignment": "CENTER",
                        "verticalAlignment": "MIDDLE",
                    }
                },
                "fields": "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment)",
            }
        },
        # 5.7. Định dạng Header Hàng 2: Nền xanh nhạt #DBEAFE, chữ xanh đậm #1E3A8A in đậm 10pt, căn giữa
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
                        "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": {"red": 0.118, "green": 0.227, "blue": 0.541}},
                        "backgroundColor": {"red": 0.859, "green": 0.918, "blue": 0.996},  # #DBEAFE
                        "horizontalAlignment": "CENTER",
                        "verticalAlignment": "MIDDLE",
                        "wrapStrategy": "WRAP",
                    }
                },
                "fields": "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy)",
            }
        },
        # 5.8. Kẻ viền bảng cho toàn bộ vùng bảng
        {
            "updateBorders": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": len(rows_to_write),
                    "startColumnIndex": 0,
                    "endColumnIndex": len(HEADERS),
                },
                "top": {"style": "SOLID", "color": {"red": 0.796, "green": 0.835, "blue": 0.882}},
                "bottom": {"style": "SOLID", "color": {"red": 0.796, "green": 0.835, "blue": 0.882}},
                "left": {"style": "SOLID", "color": {"red": 0.796, "green": 0.835, "blue": 0.882}},
                "right": {"style": "SOLID", "color": {"red": 0.796, "green": 0.835, "blue": 0.882}},
                "innerHorizontal": {"style": "SOLID", "color": {"red": 0.898, "green": 0.918, "blue": 0.941}},
                "innerVertical": {"style": "SOLID", "color": {"red": 0.898, "green": 0.918, "blue": 0.941}},
            }
        },
    ]

    # 5.9. Thiết lập độ rộng cột cho từng cột
    for col_idx, width in enumerate(COLUMN_WIDTHS):
        format_requests.append({
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": col_idx,
                    "endIndex": col_idx + 1,
                },
                "properties": {"pixelSize": width},
                "fields": "pixelSize",
            }
        })

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
        "totalRecords": subscriptions_count,
    }
    sync_config.save(update_fields=["data"])

    return {
        "status": "synced",
        "spreadsheet_id": spreadsheet_id,
        "tab_title": target_title,
        "count": subscriptions_count,
    }


def build_export_payload(sheet_row_map: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Tạo cấu trúc bảng đầy đủ gồm banner, headers, độ rộng cột và các dòng dữ liệu."""
    sheet_row_map = sheet_row_map or {}
    subscriptions = TrainingProductSubscription.objects.select_related("partner", "product").order_by(
        "partner__name", "product__display_order"
    )

    title_row = ["FT. BẢNG THEO DÕI KHÁCH HÀNG, DỊCH VỤ & THỜI GIAN SỬ DỤNG"] + [""] * (len(HEADERS) - 1)
    rows_to_write = [title_row, HEADERS]

    for idx, sub in enumerate(subscriptions):
        partner = sub.partner
        product = sub.product
        row_num = idx + 3

        saved_info = (
            sheet_row_map.get(f"sub:{sub.id}")
            or sheet_row_map.get(f"pair:{partner.id}:{product.name.strip().lower()}")
            or {}
        )
        staff = saved_info.get("assigned_staff") or getattr(partner, "training_staff", "") or ""
        notes = sub.notes or saved_info.get("custom_notes") or ""

        eff_status = product_subscription_status(sub)
        status_vi = {
            "active": "Đang sử dụng",
            "expiring": "Sắp hết hạn",
            "expired": "Đã quá hạn",
            "paused": "Tạm dừng",
            "cancelled": "Đã hủy",
        }.get(eff_status, "Đang sử dụng")

        # Công thức cho cột A (STT) và cột K (Còn lại)
        days_left_formula = f'=IF(ISBLANK(J{row_num}); ""; INT(J{row_num} - TODAY()))'
        stt_formula = f'=IF(C{row_num}<>""; ROW()-2; "")'

        row_data = [
            stt_formula,             # A: STT
            partner.id,              # B: Mã ĐT
            partner.name,            # C: Tên trường
            partner.province or "",  # D: Tỉnh/TP
            partner.contact_person or "",  # E: Người liên hệ
            partner.phone or "",     # F: SĐT
            product.name,            # G: Dịch vụ
            sub.quantity,            # H: Số lượng
            _format_date(sub.starts_at),  # I: Bắt đầu
            _format_date(sub.expires_at), # J: Hết hạn
            days_left_formula,       # K: Còn lại (ngày)
            status_vi,               # L: Trạng thái
            staff,                   # M: Nhân sự phụ trách
            notes,                   # N: Ghi chú gia hạn
            sub.id,                  # O: Mã ĐK (Sub ID)
        ]
        rows_to_write.append(row_data)

    return {
        "title": "FT. BẢNG THEO DÕI KHÁCH HÀNG, DỊCH VỤ & THỜI GIAN SỬ DỤNG",
        "headers": HEADERS,
        "columnWidths": COLUMN_WIDTHS,
        "rows": rows_to_write,
        "count": len(subscriptions),
    }


def ingest_subscription_row(row_data: List[Any], current_row_num: int = 0) -> Dict[str, Any]:
    """Cập nhật hoặc tạo mới 1 đăng ký dịch vụ từ dòng dữ liệu trên Google Sheet.
    Lỗi 1 dòng chỉ trả về lỗi dòng đó, không chặn các dòng khác.
    """
    if not row_data or not any(str(c).strip() for c in row_data):
        return {"status": "skipped", "message": "Dòng trống."}

    sub_id_str = str(row_data[14]).strip() if len(row_data) > 14 and row_data[14] is not None else ""
    partner_id_str = str(row_data[1]).strip() if len(row_data) > 1 and row_data[1] is not None else ""
    partner_name_str = str(row_data[2]).strip() if len(row_data) > 2 and row_data[2] is not None else ""
    product_name_str = str(row_data[6]).strip() if len(row_data) > 6 and row_data[6] is not None else ""
    quantity_str = str(row_data[7]).strip() if len(row_data) > 7 and row_data[7] is not None else "1"
    starts_at_str = str(row_data[8]).strip() if len(row_data) > 8 and row_data[8] is not None else ""
    expires_at_str = str(row_data[9]).strip() if len(row_data) > 9 and row_data[9] is not None else ""
    status_str = str(row_data[11]).strip().lower() if len(row_data) > 11 and row_data[11] is not None else ""
    notes_str = str(row_data[13]).strip() if len(row_data) > 13 and row_data[13] is not None else ""

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
        # Nếu chưa có trên Web nhưng có trên Sheet: Tạo mới đối tác & gói nếu có tên
        if partner_name_str and product_name_str:
            partner = None
            if partner_id_str.isdigit():
                partner = TrainingPartner.objects.filter(pk=int(partner_id_str)).first()
            if not partner:
                partner = TrainingPartner.objects.filter(name__iexact=partner_name_str).first()
            if not partner:
                province = str(row_data[3]).strip() if len(row_data) > 3 and row_data[3] is not None else ""
                contact_person = str(row_data[4]).strip() if len(row_data) > 4 and row_data[4] is not None else ""
                contact_phone = str(row_data[5]).strip() if len(row_data) > 5 and row_data[5] is not None else ""
                partner = TrainingPartner.objects.create(
                    name=partner_name_str,
                    province=province,
                    contact_person=contact_person,
                    phone=contact_phone,
                )

            product = TrainingProduct.objects.filter(name__iexact=product_name_str).first()
            if not product:
                product = TrainingProduct.objects.create(name=product_name_str)

            starts_at = _parse_date_cell(starts_at_str) or timezone.now().date()
            expires_at = _parse_date_cell(expires_at_str)
            qty = int(quantity_str) if quantity_str.isdigit() and int(quantity_str) > 0 else 1

            sub = TrainingProductSubscription.objects.create(
                partner=partner,
                product=product,
                starts_at=starts_at,
                expires_at=expires_at,
                quantity=qty,
                status="paused" if "tạm dừng" in status_str else ("cancelled" if "hủy" in status_str else "active"),
                notes=notes_str,
            )
            return {"status": "created", "subscription_id": sub.pk}

        return {
            "status": "skipped",
            "message": f"Dòng {current_row_num}: Không tìm thấy dịch vụ khớp (Trường: '{partner_name_str}', Dịch vụ: '{product_name_str}')",
        }

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
        return {"status": "updated", "subscription_id": sub.pk}

    return {"status": "unchanged", "subscription_id": sub.pk}


def import_subscriptions_from_sheet(start_row: int = 3, end_row: Optional[int] = None, google_token: Optional[str] = None) -> Dict[str, Any]:
    """Đọc dữ liệu thay đổi từ Sheet và tự động cập nhật vào Web theo từng dòng.
    Không chờ duyệt, lỗi 1 dòng chỉ bỏ qua dòng đó.
    """
    spreadsheet_id = get_spreadsheet_id()
    if not spreadsheet_id:
        return {"status": "error", "error_code": "NO_SPREADSHEET_ID", "message": "Chưa cấu hình Google Spreadsheet ID."}

    token, cfg, sa_email = get_sync_credentials(google_token)

    try:
        service = build_sheets_service(token, cfg)
    except Exception as exc:
        return {
            "status": "error",
            "error_code": "NO_CREDENTIALS",
            "service_account_email": sa_email,
            "message": "Chưa cấu hình tài khoản Google Service Account. Bạn có thể dán Service Account JSON trong Cấu hình Sheet hoặc dùng Apps Script webhook để đồng bộ tự động mà không cần tài khoản dịch vụ.",
        }

    range_end = end_row or 500
    try:
        read_res = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"'{DEFAULT_TAB_TITLE}'!A{start_row}:O{range_end}",
            valueRenderOption="FORMATTED_VALUE",
        ).execute()
        rows = read_res.get("values", [])
    except Exception as exc:
        err_str = str(exc)
        if "403" in err_str or "permission" in err_str.lower():
            msg = f"Tài khoản dịch vụ chưa có quyền truy cập Sheet. Vui lòng nhấn nút Share trên Google Sheet và chia sẻ cho email: {sa_email or 'tài khoản dịch vụ'} (quyền Người chỉnh sửa/Editor)."
        elif "404" in err_str or "not found" in err_str.lower():
            msg = f"Không tìm thấy Google Sheet với ID '{spreadsheet_id}'. Vui lòng kiểm tra lại đường link hoặc Spreadsheet ID."
        else:
            msg = f"Lỗi đọc Google Sheet: {exc}"
        return {"status": "error", "error_code": "SHEET_ACCESS_DENIED", "service_account_email": sa_email, "message": msg}

    updated_count = 0
    created_count = 0
    skipped_count = 0
    errors = []

    for r_idx, row in enumerate(rows):
        current_row_num = start_row + r_idx
        try:
            res = ingest_subscription_row(row, current_row_num)
            if res.get("status") == "updated":
                updated_count += 1
            elif res.get("status") == "created":
                created_count += 1
            elif res.get("status") == "skipped":
                if "Dòng trống" not in res.get("message", ""):
                    skipped_count += 1
                    errors.append(res.get("message"))
        except Exception as item_err:
            skipped_count += 1
            errors.append(f"Dòng {current_row_num}: {item_err}")
            continue

    return {
        "status": "success",
        "updated": updated_count,
        "created": created_count,
        "skipped": skipped_count,
        "errors": errors[:10],
    }


def sync_subscriptions_safely(*, force: bool = False, google_token: Optional[str] = None) -> Dict[str, Any]:
    """Quy trình đồng bộ an toàn 2 chiều:
    1. Quét nhận các thay đổi từ Sheet vào Web trước
    2. Sau đó xuất cập nhật dữ liệu Web ra Sheet
    """
    with _sync_lock:
        import_res = import_subscriptions_from_sheet(google_token=google_token)
        export_res = export_subscriptions_to_sheet(force=force, google_token=google_token)
        return {
            "imported": import_res,
            "exported": export_res,
        }
