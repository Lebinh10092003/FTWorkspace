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
from typing import Any, Dict, List, Optional

from django.conf import settings
from django.utils import timezone

from authentication.models import SystemConfig, WorkspaceNotification
from examination.models import LogNote
from integrations.google_sheets import build_sheets_service, extract_spreadsheet_id
from .models import TrainingPartner, TrainingProduct, TrainingProductSubscription
from .product_service import _normalise_product_name
from .serializers import product_subscription_status

logger = logging.getLogger(__name__)

DEFAULT_SPREADSHEET_ID = "1ENU0abZu6hCiVz-u7ypMLmLzudzMewKF_6s-6NJ26qk"
DEFAULT_TAB_TITLE = "Dịch vụ khách hàng"
LEGACY_TAB_TITLES = {"Trang tính1", "Dịch vụ khách hàng", "Theo dõi dịch vụ"}
SYNC_CONFIG_KEY = "customer_subscription_sheet_sync"

HEADERS = [
    "STT",                       # A (0)
    "Mã ĐK",                     # B (1)
    "Mã KH",                     # C (2)
    "Tên trường / Đơn vị",       # D (3)
    "Tỉnh / Thành phố",          # E (4)
    "Đầu mối liên hệ",           # F (5)
    "Số điện thoại",             # G (6)
    "Dịch vụ / Sản phẩm",        # H (7)
    "Số lượng",                  # I (8)
    "Thời gian theo HĐ",         # J (9)  "dd/mm/yyyy - dd/mm/yyyy"
    "Thời gian thực tế",         # K (10) "dd/mm/yyyy - dd/mm/yyyy"
    "Còn lại (ngày)",            # L (11)
    "Tình trạng hạn",            # M (12)
    "Trạng thái",                # N (13)
    "Nhân sự phụ trách",         # O (14)
    "Tiến độ & Ghi chú gia hạn", # P (15)
    "Cập nhật web lúc",          # Q (16)
]

COLUMN_WIDTHS = [
    55,   # A: STT
    75,   # B: Mã ĐK
    75,   # C: Mã KH
    280,  # D: Tên trường / Đơn vị
    130,  # E: Tỉnh / Thành phố
    150,  # F: Đầu mối liên hệ
    115,  # G: Số điện thoại
    180,  # H: Dịch vụ / Sản phẩm
    75,   # I: Số lượng
    190,  # J: Thời gian theo HĐ
    190,  # K: Thời gian thực tế
    110,  # L: Còn lại (ngày)
    120,  # M: Tình trạng hạn
    120,  # N: Trạng thái
    140,  # O: Nhân sự phụ trách
    280,  # P: Tiến độ & Ghi chú gia hạn
    130,  # Q: Cập nhật web lúc
]

STT_FORMULA_COMMA = '=ARRAYFORMULA(IF(D3:D="","",COUNTIFS(D3:D,"<>",ROW(D3:D),"<="&ROW(D3:D))))'
STT_FORMULA_SEMICOLON = '=ARRAYFORMULA(IF(D3:D="";"";COUNTIFS(D3:D;"<>";ROW(D3:D);"null<=null"&ROW(D3:D))))'.replace("null<=null", "<=")

_sync_lock = threading.Lock()


def get_spreadsheet_id() -> str:
    sync_config = SystemConfig.objects.filter(key=SYNC_CONFIG_KEY).first()
    configured = (sync_config.data or {}).get("spreadsheetId") if sync_config else None
    if configured:
        return extract_spreadsheet_id(configured) or configured.strip()
    return os.getenv("CUSTOMER_SUBSCRIPTION_SHEET_ID", DEFAULT_SPREADSHEET_ID).strip()


def _parse_date_cell(value: Any) -> Optional[datetime.date]:
    """Parse date từ nhiều định dạng: Google Sheets serial number, ISO YYYY-MM-DD, DD/MM/YYYY."""
    if value is None:
        return None
    if isinstance(value, datetime.date):
        return value
    if isinstance(value, datetime.datetime):
        return value.date()

    # Xử lý Google Sheets serial number (ví dụ 45600)
    if isinstance(value, (int, float)):
        try:
            if 10000 <= value <= 100000:
                base = datetime.date(1899, 12, 30)
                return base + datetime.timedelta(days=int(value))
        except Exception:
            pass

    val_str = str(value).strip()
    if not val_str:
        return None

    # Nếu chuỗi số serial
    if val_str.replace(".", "", 1).isdigit():
        try:
            val_float = float(val_str)
            if 10000 <= val_float <= 100000:
                base = datetime.date(1899, 12, 30)
                return base + datetime.timedelta(days=int(val_float))
        except Exception:
            pass

    # Parse ISO YYYY-MM-DD
    match_iso = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", val_str)
    if match_iso:
        try:
            return datetime.date(int(match_iso.group(1)), int(match_iso.group(2)), int(match_iso.group(3)))
        except ValueError:
            pass

    # Parse DD/MM/YYYY (định dạng phổ biến ở VN)
    match_vi = re.match(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", val_str)
    if match_vi:
        try:
            return datetime.date(int(match_vi.group(3)), int(match_vi.group(2)), int(match_vi.group(1)))
        except ValueError:
            pass

    return None


def _format_date(val: Optional[datetime.date]) -> str:
    return val.strftime("%d/%m/%Y") if val else ""


_RANGE_DATE_RE = re.compile(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})|(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})")


def format_date_range(start: Optional[datetime.date], end: Optional[datetime.date]) -> str:
    """Ô khoảng thời gian trên Sheet: "a - b", chỉ có đầu "Từ a", chỉ có cuối "Đến b"."""
    if start and end:
        return f"{_format_date(start)} - {_format_date(end)}"
    if start:
        return f"Từ {_format_date(start)}"
    if end:
        return f"Đến {_format_date(end)}"
    return ""


def _range_dates(text: str) -> List[datetime.date]:
    dates = []
    for m in _RANGE_DATE_RE.finditer(text):
        try:
            if m.group(1):
                dates.append(datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3))))
            else:
                dates.append(datetime.date(int(m.group(6)), int(m.group(5)), int(m.group(4))))
        except ValueError:
            continue
    return dates


def _is_bare_date(value: Any) -> bool:
    """Ô chỉ có đúng một ngày, không có chữ "Từ/Đến" hay dấu nối khoảng."""
    if value is None or value == "":
        return False
    if isinstance(value, (datetime.date, int, float)):
        return _parse_date_cell(value) is not None
    text = str(value).strip()
    if _RANGE_DATE_RE.fullmatch(text):
        return True
    return text.replace(".", "", 1).isdigit() and _parse_date_cell(text) is not None


def parse_date_range(value: Any) -> tuple[Optional[datetime.date], Optional[datetime.date]]:
    """Đọc ô khoảng thời gian. Trả (bắt đầu, hết hạn); phần không có là None.
    Một ngày đứng riêng được hiểu là ngày hết hạn."""
    if value is None:
        return None, None
    if isinstance(value, (datetime.date, int, float)) and not isinstance(value, bool):
        return None, _parse_date_cell(value)
    text = str(value).strip()
    if not text:
        return None, None
    dates = _range_dates(text)
    if not dates:
        return None, _parse_date_cell(text)
    if len(dates) >= 2:
        return dates[0], dates[-1]
    lowered = text.lower()
    if lowered.startswith("từ") or lowered.startswith("tu ") or re.search(r"[-–~→]\s*$", text):
        return dates[0], None
    return None, dates[0]


def _end_date_expr(cell: str) -> str:
    """Biểu thức Sheet lấy ngày hết hạn ở cuối ô khoảng thời gian (locale VN, dấu ;)."""
    t = f"TRIM(TO_TEXT({cell}))"
    return (
        f'IFERROR(IF(REGEXMATCH(LOWER({t}); "^từ"); ""; '
        rf'DATE(VALUE(REGEXEXTRACT({t}; "(\d{{4}})\s*$")); '
        rf'VALUE(REGEXEXTRACT({t}; "(\d{{1,2}})/\d{{4}}\s*$")); '
        rf'VALUE(REGEXEXTRACT({t}; "(\d{{1,2}})/\d{{1,2}}/\d{{4}}\s*$")))); "")'
    )


def days_left_formula(row_num: int) -> str:
    """Còn lại (ngày): theo ngày hết hạn thực tế (cột K), thiếu thì theo hợp đồng (cột J)."""
    return (
        f'=LET(ek; {_end_date_expr(f"K{row_num}")}; ej; {_end_date_expr(f"J{row_num}")}; '
        f'e; IF(ek<>""; ek; ej); IF(e=""; ""; INT(e - TODAY())))'
    )


def expiry_status_formula(row_num: int) -> str:
    return (
        f'=IF(L{row_num}=""; "Không thời hạn"; IF(L{row_num}<0; "Đã quá hạn"; '
        f'IF(L{row_num}<=30; "Sắp hết hạn"; "Đang sử dụng")))'
    )


def get_sync_credentials(google_token: Optional[str] = None) -> tuple[Optional[str], dict[str, Any], Optional[str]]:
    """Trả về (token, config_data, service_account_email) ưu tiên cấu hình riêng, sau đó đến main."""
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


def ensure_subscription_stt_formula(service, spreadsheet_id: str, tab_title: str) -> bool:
    """Cài đặt công thức ARRAYFORMULA cho cột STT tại A3. Tự động tương thích với locale dấu , hoặc ;."""
    escaped = "'" + tab_title.replace("'", "''") + "'"
    try:
        read_res = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"{escaped}!A3",
            valueRenderOption="FORMULA",
        ).execute(num_retries=3)
        vals = read_res.get("values", [])
        current_formula = str(vals[0][0]) if vals and vals[0] else ""
        norm = lambda t: t.replace(" ", "").replace(";", ",").upper()
        if norm(current_formula) == norm(STT_FORMULA_COMMA):
            return False

        # Thử với dấu phẩy, nếu lỗi cú pháp thử tiếp với dấu chấm phẩy
        for formula in (STT_FORMULA_COMMA, STT_FORMULA_SEMICOLON):
            service.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range=f"{escaped}!A3",
                valueInputOption="USER_ENTERED",
                body={"values": [[formula]]},
            ).execute(num_retries=3)
            check = service.spreadsheets().values().get(
                spreadsheetId=spreadsheet_id,
                range=f"{escaped}!A3",
                valueRenderOption="FORMATTED_VALUE",
            ).execute(num_retries=3)
            res_val = str(check.get("values", [[""]])[0][0])
            if not res_val.startswith("#"):
                break
        return True
    except Exception as exc:
        logger.warning(f"Không thể cài đặt công thức STT: {exc}")
        return False


def remove_subscription_sheet_rows(service, spreadsheet_id: str, tab_title: str, sub_ids: List[Any]) -> int:
    """Xóa các dòng trên Sheet có Mã ĐK nằm trong sub_ids khi đăng ký bị xóa trên web."""
    if not sub_ids:
        return 0
    sub_id_set = {str(sid).strip() for sid in sub_ids if str(sid).strip()}
    if not sub_id_set:
        return 0

    escaped = "'" + tab_title.replace("'", "''") + "'"
    try:
        meta = service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            fields="sheets(properties(sheetId,title))",
        ).execute()
        sheet_id = None
        for s in meta.get("sheets", []):
            if s.get("properties", {}).get("title") == tab_title:
                sheet_id = s.get("properties", {}).get("sheetId")
                break
        if sheet_id is None:
            return 0

        # Đọc cột B (Mã ĐK) từ hàng 3 trở đi
        read_res = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"{escaped}!B3:B1000",
            valueRenderOption="UNFORMATTED_VALUE",
        ).execute()
        rows = read_res.get("values", [])
        
        # Gom các row_index cần xóa (0-indexed cho API batchUpdate)
        # Hàng 3 trên sheet tương ứng rowIndex = 2
        delete_indices = []
        for idx, row in enumerate(rows):
            cell_val = str(row[0]).strip() if row and row[0] is not None else ""
            if cell_val in sub_id_set:
                delete_indices.append(2 + idx)

        if not delete_indices:
            return 0

        # Xóa từ dưới lên trên để không bị lệch chỉ số dòng
        delete_indices.sort(reverse=True)
        requests = []
        for r_idx in delete_indices:
            requests.append({
                "deleteDimension": {
                    "range": {
                        "sheetId": sheet_id,
                        "dimension": "ROWS",
                        "startIndex": r_idx,
                        "endIndex": r_idx + 1,
                    }
                }
            })

        service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": requests},
        ).execute()
        return len(delete_indices)
    except Exception as exc:
        logger.warning(f"Lỗi khi xóa dòng trên Google Sheet: {exc}")
        return 0


def build_export_payload(sheet_row_map: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Tạo cấu trúc bảng 17 cột đầy đủ gồm banner, headers, độ rộng cột và các dòng dữ liệu."""
    sheet_row_map = sheet_row_map or {}
    subscriptions = TrainingProductSubscription.objects.select_related("partner", "product").order_by(
        "partner__name", "product__display_order", "product__name"
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
        staff = sub.account_manager or saved_info.get("assigned_staff") or getattr(partner, "training_staff", "") or ""
        notes = sub.notes or saved_info.get("custom_notes") or ""

        eff_status = product_subscription_status(sub)
        status_vi = {
            "active": "Đang sử dụng",
            "expiring": "Sắp hết hạn",
            "expired": "Đã quá hạn",
            "paused": "Tạm dừng",
            "cancelled": "Đã hủy",
        }.get(eff_status, "Đang sử dụng")


        updated_str = sub.updated_at.strftime("%d/%m/%Y %H:%M") if sub.updated_at else ""

        row_data = [
            "",                                  # A: STT (ARRAYFORMULA điền)
            sub.id,                              # B: Mã ĐK
            partner.id,                          # C: Mã KH
            partner.name,                        # D: Tên trường / Đơn vị
            partner.province or "",              # E: Tỉnh / Thành phố
            partner.contact_person or "",        # F: Đầu mối liên hệ
            f"'{partner.phone}" if partner.phone else "", # G: SĐT (dạng text)
            product.name,                        # H: Dịch vụ / Sản phẩm
            sub.quantity,                        # I: Số lượng
            format_date_range(                   # J: Thời gian theo HĐ
                sub.contract_starts_at,
                sub.contract_expires_at if product.code != "tap-huan" else None,
            ),
            format_date_range(                   # K: Thời gian thực tế
                sub.starts_at,
                sub.expires_at if product.code != "tap-huan" else None,
            ),
            days_left_formula(row_num),          # L: Còn lại (ngày)
            expiry_status_formula(row_num),      # M: Tình trạng hạn
            status_vi,                           # N: Trạng thái
            staff,                               # O: Nhân sự phụ trách
            notes,                               # P: Ghi chú gia hạn
            updated_str,                         # Q: Cập nhật web lúc
        ]
        rows_to_write.append(row_data)

    return {
        "title": "FT. BẢNG THEO DÕI KHÁCH HÀNG, DỊCH VỤ & THỜI GIAN SỬ DỤNG",
        "tabTitle": DEFAULT_TAB_TITLE,
        "headers": HEADERS,
        "columnWidths": COLUMN_WIDTHS,
        "rows": rows_to_write,
        "count": len(subscriptions),
    }


def export_subscriptions_to_sheet(*, force: bool = False, google_token: Optional[str] = None) -> Dict[str, Any]:
    """Xuất danh sách đăng ký dịch vụ của khách hàng ra Google Sheet.
    - Cập nhật đúng dòng tại chỗ, thêm dòng mới ở cuối.
    - Không xóa trắng cả tab.
    - Bảo toàn công thức STT và Còn lại ngày.
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
            msg = f"Tài khoản dịch vụ chưa có quyền truy cập Sheet. Vui lòng nhấn nút Share trên Google Sheet và chia sẻ cho email: {sa_email or 'tài khoản dịch vụ'} (quyền Editor)."
        elif "404" in err_str or "not found" in err_str.lower():
            msg = f"Không tìm thấy Google Sheet với ID '{spreadsheet_id}'. Vui lòng kiểm tra lại đường link hoặc Spreadsheet ID."
        else:
            msg = f"Lỗi truy cập Google Sheet: {exc}"
        return {"status": "error", "error_code": "SHEET_ACCESS_DENIED", "service_account_email": sa_email, "message": msg}

    sheet_props = None
    target_title = DEFAULT_TAB_TITLE
    existing_sheets = metadata.get("sheets", [])

    # Tìm tab đích theo thứ tự ưu tiên
    for s in existing_sheets:
        props = s.get("properties", {})
        title = props.get("title", "")
        if title == DEFAULT_TAB_TITLE:
            sheet_props = props
            target_title = title
            break
        if title in LEGACY_TAB_TITLES and not sheet_props:
            sheet_props = props
            target_title = title

    if not sheet_props and existing_sheets:
        sheet_props = existing_sheets[0].get("properties", {})
        target_title = sheet_props.get("title", DEFAULT_TAB_TITLE)

    if not sheet_props:
        return {"status": "error", "message": "Không tìm thấy sheet nào trong file."}

    sheet_id = sheet_props["sheetId"]

    # Đổi tên tab "Trang tính1" sang "Dịch vụ khách hàng" nếu phù hợp
    if target_title == "Trang tính1":
        try:
            service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={
                    "requests": [{
                        "updateSheetProperties": {
                            "properties": {"sheetId": sheet_id, "title": DEFAULT_TAB_TITLE},
                            "fields": "title",
                        }
                    }]
                },
            ).execute()
            target_title = DEFAULT_TAB_TITLE
        except Exception as exc:
            logger.warning(f"Không thể đổi tên tab sang '{DEFAULT_TAB_TITLE}': {exc}")

    escaped_title = "'" + target_title.replace("'", "''") + "'"

    # 2. Đọc các dòng hiện tại trên Sheet để giữ dữ liệu và vị trí dòng
    try:
        read_res = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"{escaped_title}!A1:Q500",
            valueRenderOption="UNFORMATTED_VALUE",
        ).execute()
        existing_rows = read_res.get("values", [])
    except Exception as exc:
        logger.warning(f"Lỗi đọc sheet hiện có: {exc}")
        existing_rows = []

    sheet_row_map = {}
    for idx, row in enumerate(existing_rows):
        if idx < 2:  # Bỏ qua row 1 và header row 2
            continue
        # Cột B (index 1) là Mã ĐK mới, Cột O (index 14) là Mã ĐK cũ
        sub_id_val = ""
        if len(row) > 1 and str(row[1]).strip().isdigit():
            sub_id_val = str(row[1]).strip()
        elif len(row) > 14 and str(row[14]).strip().isdigit():
            sub_id_val = str(row[14]).strip()

        partner_val = ""
        prod_val = ""
        if len(row) > 2 and str(row[2]).strip().isdigit():  # Mã KH mới ở cột C
            partner_val = str(row[2]).strip()
        elif len(row) > 1 and str(row[1]).strip().isdigit(): # Mã ĐT cũ ở cột B
            partner_val = str(row[1]).strip()

        if len(row) > 7 and row[7]:  # Cột H mới
            prod_val = str(row[7]).strip().lower()
        elif len(row) > 6 and row[6]: # Cột G cũ
            prod_val = str(row[6]).strip().lower()

        assigned_staff = str(row[14]).strip() if len(row) > 14 and row[14] is not None else ""
        if not assigned_staff and len(row) > 12:
            assigned_staff = str(row[12]).strip()

        custom_notes = str(row[15]).strip() if len(row) > 15 and row[15] is not None else ""
        if not custom_notes and len(row) > 13:
            custom_notes = str(row[13]).strip()

        if sub_id_val:
            sheet_row_map[f"sub:{sub_id_val}"] = {
                "row_index": idx + 1,
                "assigned_staff": assigned_staff,
                "custom_notes": custom_notes,
            }
        if partner_val and prod_val:
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

    # 4. Ghi tiêu đề (Row 1-2) và các dòng dữ liệu
    # Dòng 1: Banner, Dòng 2: Headers
    header_data = [rows_to_write[0], rows_to_write[1]]
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"{escaped_title}!A1:Q2",
        valueInputOption="USER_ENTERED",
        body={"values": header_data},
    ).execute()

    # Cài đặt công thức STT tại A3
    ensure_subscription_stt_formula(service, spreadsheet_id, target_title)

    # Ghi dữ liệu từ cột B trở đi (B3:Q{N}), giữ nguyên cột A cho công thức
    if len(rows_to_write) > 2:
        data_rows_from_b = [row[1:] for row in rows_to_write[2:]]
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"{escaped_title}!B3:Q{len(rows_to_write)}",
            valueInputOption="USER_ENTERED",
            body={"values": data_rows_from_b},
        ).execute()

    # 5. Cập nhật định dạng đầy đủ chuẩn Fermat Workspace
    num_cols = len(HEADERS)
    total_rows = max(len(rows_to_write), 10)
    format_requests: List[Dict[str, Any]] = [
        # 5.1. Đóng băng 2 hàng đầu (Banner và Headers)
        {
            "updateSheetProperties": {
                "properties": {
                    "sheetId": sheet_id,
                    "gridProperties": {
                        "frozenRowCount": 2,
                    },
                },
                "fields": "gridProperties.frozenRowCount",
            }
        },
        # 5.2. Gộp ô Banner A1:Q1
        {
            "mergeCells": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": num_cols,
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
        # 5.4. Chiều cao dòng 2 (Header: 32px)
        {
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": 1,
                    "endIndex": 2,
                },
                "properties": {"pixelSize": 32},
                "fields": "pixelSize",
            }
        },
        # 5.5. Chiều cao các dòng dữ liệu (26px)
        {
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": 2,
                    "endIndex": total_rows,
                },
                "properties": {"pixelSize": 26},
                "fields": "pixelSize",
            }
        },
        # 5.6. Định dạng Banner Hàng 1: Nền xanh dương đậm #1D4ED8, chữ trắng 12pt bold
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": num_cols,
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
        # 5.7. Định dạng Header Hàng 2: Nền xanh nhạt #DBEAFE, chữ xanh đậm #1E3A8A 10pt bold
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 1,
                    "endRowIndex": 2,
                    "startColumnIndex": 0,
                    "endColumnIndex": num_cols,
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
        # 5.8. Khóa màu các cột cố định (B đến G - index 1 đến 7): Nền xám nhạt #F8FAFC
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 2,
                    "endRowIndex": total_rows,
                    "startColumnIndex": 1,
                    "endColumnIndex": 7,
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": {"red": 0.973, "green": 0.980, "blue": 0.988},  # #F8FAFC
                        "textFormat": {"foregroundColor": {"red": 0.278, "green": 0.333, "blue": 0.412}},  # #475569
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat.foregroundColor)",
            }
        },
        # 5.9. Kẻ viền bảng cho toàn bộ vùng
        {
            "updateBorders": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": total_rows,
                    "startColumnIndex": 0,
                    "endColumnIndex": num_cols,
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

    # 5.10. Thiết lập độ rộng cột cho từng cột
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

    # 5.11. Data Validation cho Cột N (Trạng thái - index 13)
    format_requests.append({
        "setDataValidation": {
            "range": {
                "sheetId": sheet_id,
                "startRowIndex": 2,
                "endRowIndex": total_rows,
                "startColumnIndex": 13,
                "endColumnIndex": 14,
            },
            "rule": {
                "condition": {
                    "type": "ONE_OF_LIST",
                    "values": [
                        {"userEnteredValue": "Đang sử dụng"},
                        {"userEnteredValue": "Tạm dừng"},
                        {"userEnteredValue": "Đã hủy"},
                    ],
                },
                "inputMessage": "Chọn trạng thái đăng ký dịch vụ.",
                "strict": False,
                "showCustomUi": True,
            },
        }
    })

    # 5.12. Data Validation cho Cột H (Dịch vụ / Sản phẩm - index 7)
    active_products = list(TrainingProduct.objects.filter(active=True).values_list("name", flat=True))
    if active_products:
        format_requests.append({
            "setDataValidation": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 2,
                    "endRowIndex": total_rows,
                    "startColumnIndex": 7,
                    "endColumnIndex": 8,
                },
                "rule": {
                    "condition": {
                        "type": "ONE_OF_LIST",
                        "values": [{"userEnteredValue": p_name} for p_name in active_products],
                    },
                    "strict": False,
                    "showCustomUi": True,
                },
            }
        })

    try:
        service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": format_requests},
        ).execute()
    except Exception as exc:
        logger.warning(f"Batch format warning: {exc}")

    # Gộp vào cấu hình sẵn có: giữ webhookSecret, Service Account JSON do người dùng lưu.
    sync_config.refresh_from_db(fields=["data"])
    sync_config.data = {
        **(sync_config.data or {}),
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


def ingest_subscription_row(row_data: List[Any], current_row_num: int = 0) -> Dict[str, Any]:
    """Cập nhật hoặc tạo mới 1 đăng ký dịch vụ từ dòng dữ liệu trên Google Sheet.
    - Lỗi 1 dòng chỉ trả về lỗi dòng đó, không chặn các dòng khác.
    - Không nhận thông tin khách hàng (Tỉnh, Đầu mối, SĐT) đè lên web.
    - Chỉ tạo mới đăng ký khi CẢ tên trường VÀ sản phẩm ĐÃ TỒN TẠI trên web.
    """
    if not row_data or not any(str(c).strip() for c in row_data):
        return {"status": "skipped", "message": "Dòng trống."}

    # Hỗ trợ cả bố cục 17 cột mới (Mã ĐK ở cột B) và 15 cột cũ (Mã ĐK ở cột O)
    is_legacy = (
        len(row_data) >= 15
        and str(row_data[14]).strip().isdigit()
        and not (len(row_data) > 1 and str(row_data[1]).strip().isdigit())
    )

    if is_legacy:
        sub_id_str = str(row_data[14]).strip()
        partner_id_str = str(row_data[1]).strip()
        partner_name_str = str(row_data[2]).strip()
        product_name_str = str(row_data[6]).strip()
        quantity_str = str(row_data[7]).strip()
        actual_start = _parse_date_cell(str(row_data[8]).strip())
        actual_end = _parse_date_cell(str(row_data[9]).strip())
        contract_start = contract_end = None
        status_str = str(row_data[11]).strip().lower()
        account_manager_str = str(row_data[12]).strip()
        notes_str = str(row_data[13]).strip()
    else:
        sub_id_str = str(row_data[1]).strip() if len(row_data) > 1 and row_data[1] is not None else ""
        partner_id_str = str(row_data[2]).strip() if len(row_data) > 2 and row_data[2] is not None else ""
        partner_name_str = str(row_data[3]).strip() if len(row_data) > 3 and row_data[3] is not None else ""
        product_name_str = str(row_data[7]).strip() if len(row_data) > 7 and row_data[7] is not None else ""
        quantity_str = str(row_data[8]).strip() if len(row_data) > 8 and row_data[8] is not None else "1"
        j_cell = row_data[9] if len(row_data) > 9 else None
        k_cell = row_data[10] if len(row_data) > 10 else None
        if _is_bare_date(j_cell) and _is_bare_date(k_cell):
            # Bố cục cũ trước khi có 2 cột thời gian: J = Ngày bắt đầu, K = Ngày hết hạn (thực tế).
            contract_start = contract_end = None
            actual_start, actual_end = _parse_date_cell(j_cell), _parse_date_cell(k_cell)
        else:
            contract_start, contract_end = parse_date_range(j_cell)
            actual_start, actual_end = parse_date_range(k_cell)
        status_str = str(row_data[13]).strip().lower() if len(row_data) > 13 and row_data[13] is not None else ""
        account_manager_str = str(row_data[14]).strip() if len(row_data) > 14 and row_data[14] is not None else ""
        notes_str = str(row_data[15]).strip() if len(row_data) > 15 and row_data[15] is not None else ""

    # 1. Tìm bản ghi subscription
    sub: Optional[TrainingProductSubscription] = None
    if sub_id_str.isdigit():
        candidate_sub = TrainingProductSubscription.objects.select_related("partner", "product").filter(pk=int(sub_id_str)).first()
        if candidate_sub:
            # Kiểm tra an toàn: Tên trường trên dòng có khớp với sub không?
            if partner_name_str and partner_name_str.strip().lower() != candidate_sub.partner.name.strip().lower():
                msg = (
                    f"Dòng {current_row_num}: Mã ĐK {candidate_sub.id} thuộc trường '{candidate_sub.partner.name}', "
                    f"nhưng dòng trên Sheet ghi trường '{partner_name_str}' (không khớp). Bỏ qua dòng để tránh ghi đè nhầm."
                )
                logger.warning(msg)
                LogNote.objects.create(
                    key=f"subscription-sheet-conflict:{candidate_sub.id}:{timezone.now().timestamp()}",
                    entity_key=f"digital-training-subscription-{candidate_sub.id}",
                    content=msg,
                    updated_by="Google Sheet Webhook",
                    system=True,
                )
                return {"status": "skipped", "message": msg}
            sub = candidate_sub

    # Nếu không tìm thấy qua ID, thử tìm qua cặp partner + product
    if not sub and partner_name_str and product_name_str:
        partner = TrainingPartner.objects.filter(name__iexact=partner_name_str).first()
        if not partner and partner_id_str.isdigit():
            partner = TrainingPartner.objects.filter(pk=int(partner_id_str)).first()

        product = TrainingProduct.objects.filter(name__iexact=product_name_str).first()
        if not product:
            # Thử đối chiếu chuẩn hóa tên
            target_norm = _normalise_product_name(product_name_str)
            for p in TrainingProduct.objects.filter(active=True):
                if _normalise_product_name(p.name) == target_norm or _normalise_product_name(p.code) == target_norm:
                    product = p
                    break

        if partner and product:
            sub = TrainingProductSubscription.objects.filter(partner=partner, product=product).first()

    # 2. Xử lý trường hợp chưa có subscription trên Web
    if not sub:
        # Q3: Chỉ tạo khi CẢ trường VÀ sản phẩm ĐÃ TỒN TẠI trên web
        if not partner_name_str or not product_name_str:
            return {"status": "skipped", "message": f"Dòng {current_row_num}: Thiếu tên trường hoặc tên sản phẩm."}

        partner = TrainingPartner.objects.filter(name__iexact=partner_name_str).first()
        if not partner and partner_id_str.isdigit():
            partner = TrainingPartner.objects.filter(pk=int(partner_id_str)).first()

        product = TrainingProduct.objects.filter(name__iexact=product_name_str).first()
        if not product:
            target_norm = _normalise_product_name(product_name_str)
            for p in TrainingProduct.objects.filter(active=True):
                if _normalise_product_name(p.name) == target_norm or _normalise_product_name(p.code) == target_norm:
                    product = p
                    break

        if not partner:
            msg = f"Dòng {current_row_num}: Trường '{partner_name_str}' chưa có trên web. Hệ thống không tự tạo trường mới từ Sheet."
            LogNote.objects.create(
                key=f"subscription-sheet-unknown-partner:{timezone.now().timestamp()}",
                entity_key="digital-training-subscription-import",
                content=msg,
                updated_by="Google Sheet Webhook",
                system=True,
            )
            return {"status": "skipped", "message": msg}

        if not product:
            msg = f"Dòng {current_row_num}: Sản phẩm '{product_name_str}' không có trong danh mục. Hệ thống không tự tạo sản phẩm rác."
            LogNote.objects.create(
                key=f"subscription-sheet-unknown-product:{timezone.now().timestamp()}",
                entity_key="digital-training-subscription-import",
                content=msg,
                updated_by="Google Sheet Webhook",
                system=True,
            )
            return {"status": "skipped", "message": msg}

        # Cả trường và sản phẩm đều hợp lệ -> tạo mới đăng ký
        is_training = product.code == "tap-huan"
        has_any_date = any([actual_start, actual_end, contract_start, contract_end])
        starts_at = actual_start or (None if has_any_date else timezone.localdate())
        expires_at = None if is_training else actual_end
        qty = int(quantity_str) if quantity_str.isdigit() and int(quantity_str) > 0 else 1

        mapped_status = "active"
        if "tạm dừng" in status_str:
            mapped_status = "paused"
        elif "hủy" in status_str:
            mapped_status = "cancelled"

        sub = TrainingProductSubscription.objects.create(
            partner=partner,
            product=product,
            starts_at=starts_at,
            expires_at=expires_at,
            contract_starts_at=contract_start,
            contract_expires_at=None if is_training else contract_end,
            quantity=qty,
            status=mapped_status,
            account_manager=account_manager_str,
            notes=notes_str,
        )
        LogNote.objects.create(
            key=f"subscription-created-sheet:{sub.id}",
            entity_key=f"digital-training-subscription-{sub.id}",
            content=f"Tự động tạo đăng ký '{product.name}' cho trường '{partner.name}' từ Google Sheet.",
            updated_by="Google Sheet Webhook",
            system=True,
        )
        return {"status": "created", "subscription_id": sub.pk}

    # 3. Cập nhật đăng ký hiện có
    # Ô trống / phần trống của khoảng thời gian không xóa dữ liệu web.
    updates = []
    previous_expiry = sub.effective_expires_at
    is_training = sub.product.code == "tap-huan"
    for field, value in (
        ("starts_at", actual_start),
        ("contract_starts_at", contract_start),
        ("expires_at", None if is_training else actual_end),
        ("contract_expires_at", None if is_training else contract_end),
    ):
        if value and getattr(sub, field) != value:
            setattr(sub, field, value)
            updates.append(field)
    if is_training:
        for field in ("expires_at", "contract_expires_at"):
            if getattr(sub, field) is not None:
                setattr(sub, field, None)
                updates.append(field)
    if sub.effective_expires_at != previous_expiry:
        sub.expiry_notice_stage = 0
        updates.append("expiry_notice_stage")
        WorkspaceNotification.objects.filter(
            event_key__startswith=f"product-subscription:{sub.pk}:"
        ).delete()

    if quantity_str.isdigit() and int(quantity_str) > 0 and sub.quantity != int(quantity_str):
        sub.quantity = int(quantity_str)
        updates.append("quantity")

    # Chỉ đổi trạng thái khi có giá trị rõ ràng (tránh ô trống biến paused/cancelled thành active)
    if "tạm dừng" in status_str and sub.status != "paused":
        sub.status = "paused"
        updates.append("status")
    elif "hủy" in status_str and sub.status != "cancelled":
        sub.status = "cancelled"
        updates.append("status")
    elif ("đang sử dụng" in status_str or "active" in status_str) and sub.status != "active":
        sub.status = "active"
        updates.append("status")

    if account_manager_str and account_manager_str != sub.account_manager:
        sub.account_manager = account_manager_str
        updates.append("account_manager")

    if notes_str and notes_str != sub.notes:
        sub.notes = notes_str
        updates.append("notes")

    # Cập nhật thông tin đối tác từ Sheet nếu giá trị hợp lệ (không ghi đè bằng giá trị trống)
    partner_updates = []
    if not is_legacy:  # Chỉ áp dụng cho layout 17 cột mới
        province_str = str(row_data[4]).strip() if len(row_data) > 4 and row_data[4] is not None else ""
        contact_str = str(row_data[5]).strip() if len(row_data) > 5 and row_data[5] is not None else ""
        phone_str = str(row_data[6]).strip().lstrip("'") if len(row_data) > 6 and row_data[6] is not None else ""

        if province_str and province_str != (sub.partner.province or ""):
            sub.partner.province = province_str
            partner_updates.append("province")
        if contact_str and contact_str != (sub.partner.contact_person or ""):
            sub.partner.contact_person = contact_str
            partner_updates.append("contact_person")
        # Chỉ cập nhật SĐT nếu là số 10 chữ số bắt đầu bằng 0
        if phone_str and re.fullmatch(r'0\d{9}', phone_str) and phone_str != (sub.partner.phone or ""):
            sub.partner.phone = phone_str
            partner_updates.append("phone")

        if partner_updates:
            sub.partner.save(update_fields=partner_updates)

    if updates:
        sub.save(update_fields=[*updates, "updated_at"])
        LogNote.objects.create(
            key=f"subscription-sheet-update:{sub.id}:{timezone.now().timestamp()}",
            entity_key=f"digital-training-subscription-{sub.id}",
            content=f"Google Sheet cập nhật các trường: {', '.join(updates)}.",
            updated_by="Google Sheet Webhook",
            system=True,
        )
        return {"status": "updated", "subscription_id": sub.pk}

    return {"status": "unchanged", "subscription_id": sub.pk}


def import_subscriptions_from_sheet(start_row: int = 3, end_row: Optional[int] = None, google_token: Optional[str] = None) -> Dict[str, Any]:
    """Đọc dữ liệu thay đổi từ Sheet và tự động cập nhật vào Web theo từng dòng."""
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
            "message": "Chưa cấu hình tài khoản Google Service Account.",
        }

    # Lấy tên tab đích
    target_title = DEFAULT_TAB_TITLE
    try:
        meta = service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            fields="sheets(properties.title)",
        ).execute()
        existing_titles = [s.get("properties", {}).get("title") for s in meta.get("sheets", [])]
        for candidate in [DEFAULT_TAB_TITLE, "Trang tính1", "Dịch vụ khách hàng", "Theo dõi dịch vụ"]:
            if candidate in existing_titles:
                target_title = candidate
                break
    except Exception:
        pass

    escaped = "'" + target_title.replace("'", "''") + "'"
    range_end = end_row or 500
    try:
        read_res = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"{escaped}!A{start_row}:Q{range_end}",
            # UNFORMATTED_VALUE: trả về serial number cho ngày, tránh bị đảo ngày/tháng
            # theo locale của người dùng khi dùng FORMATTED_VALUE.
            valueRenderOption="UNFORMATTED_VALUE",
        ).execute()
        rows = read_res.get("values", [])
    except Exception as exc:
        return {"status": "error", "error_code": "READ_ERROR", "message": f"Lỗi đọc Google Sheet: {exc}"}

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
        "tab_title": target_title,
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
