"""Nhập tài khoản (kèm mật khẩu) từ Google Sheet ngay trên máy chủ.

ChatGPT chặn các lệnh gọi công cụ có chứa mật khẩu trong tham số. Với các công cụ này, AI chỉ gửi
link Sheet và tên cột; máy chủ tự đọc Sheet nên mật khẩu không đi qua cuộc trò chuyện.
Kết quả trả về không bao giờ chứa mật khẩu.
"""
from __future__ import annotations

import datetime
import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

from django.utils import timezone

from authentication.models import SystemConfig
from company_accounts import services as company_services
from company_accounts.models import CompanyAccount
from digital_training.models import TrainingPartnerAiAccount, TrainingProductSubscription
from integrations.google_sheets import build_sheets_service, extract_spreadsheet_id

from .lookups import find_partner
from .registry import register_tool
from .tools_crm import _generate_secure_password, _sync_partner_ai_count

MAX_ROWS = 2000
PREVIEW_ROWS = 10

# Tên cột thường gặp (đã bỏ dấu, viết thường) cho từng trường.
AI_ACCOUNT_COLUMNS: Dict[str, List[str]] = {
    "username": ["tai khoan", "email", "username", "ten dang nhap", "account", "tai khoan ai", "gmail"],
    "password": ["mat khau", "password", "pass", "mk"],
    "assigned_to": ["nguoi nhan", "nguoi dung", "giao vien", "nguoi duoc cap", "ho ten", "ho va ten", "assigned to"],
    "platform": ["nen tang", "platform", "loai tai khoan"],
    "partner": ["truong", "ten truong", "don vi", "khach hang", "truong hoc"],
}
COMPANY_ACCOUNT_COLUMNS: Dict[str, List[str]] = {
    "name": ["ten dich vu", "dich vu", "ten tai khoan", "ten", "name", "service"],
    "provider": ["nha cung cap", "provider", "hang"],
    "category": ["nhom", "loai", "category"],
    "login_url": ["link dang nhap", "url dang nhap", "login url", "link", "url", "website"],
    "username": ["tai khoan", "email", "username", "ten dang nhap", "account", "email dang nhap"],
    "password": ["mat khau", "password", "pass", "mk"],
    "two_factor": ["2fa", "xac thuc 2 buoc", "ma 2fa", "nhan ma 2fa"],
    "owner_email": ["nguoi phu trach", "phu trach", "owner", "email phu trach"],
    "plan": ["goi", "goi dich vu", "plan"],
    "cost": ["chi phi", "gia", "cost"],
    "renewal_date": ["ngay gia han", "gia han", "renewal date", "han"],
    "notes": ["ghi chu", "notes", "note"],
}


def _norm(text: Any) -> str:
    value = unicodedata.normalize("NFD", str(text or "")).replace("đ", "d").replace("Đ", "D")
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def _match_columns(header: List[Any], aliases: Dict[str, List[str]], overrides: Dict[str, str]) -> Dict[str, int]:
    """Trường -> chỉ số cột. Ưu tiên tên cột người dùng chỉ định, rồi khớp đúng tên, rồi khớp một phần."""
    names = [_norm(cell) for cell in header]
    found: Dict[str, int] = {}
    used: set[int] = set()

    for field, wanted in (overrides or {}).items():
        target = _norm(wanted)
        if field in aliases and target in names:
            found[field] = names.index(target)
            used.add(found[field])
    for exact in (True, False):
        for field, options in aliases.items():
            if field in found:
                continue
            for idx, name in enumerate(names):
                if idx in used or not name:
                    continue
                if any(name == opt if exact else (opt in name.split() or f" {opt} " in f" {name} ") for opt in options):
                    found[field] = idx
                    used.add(idx)
                    break
    return found


def _sheet_credentials() -> Tuple[Optional[str], Dict[str, Any]]:
    main = SystemConfig.objects.filter(key="main").first()
    return (main.last_google_access_token if main else None), dict((main.data if main else {}) or {})


def service_account_email() -> str:
    try:
        from integrations.google_sheets import _service_account_info
        info = _service_account_info(_sheet_credentials()[1]) or {}
        return str(info.get("client_email") or "")
    except Exception:
        return ""


def _read_sheet_values(spreadsheet_id: str, tab: str) -> Tuple[str, List[List[Any]]]:
    """Đọc giá trị hiển thị của tab (giữ số 0 đầu, mật khẩu dạng số). Tab trống = tab đầu tiên."""
    token, cfg = _sheet_credentials()
    service = build_sheets_service(token, cfg)
    if not tab:
        meta = service.spreadsheets().get(spreadsheetId=spreadsheet_id, fields="sheets(properties(title))").execute()
        sheets = meta.get("sheets", [])
        if not sheets:
            raise ValueError("File Sheet không có tab nào.")
        tab = sheets[0]["properties"]["title"]
    escaped = "'" + tab.replace("'", "''") + "'"
    res = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id, range=f"{escaped}!A1:Z{MAX_ROWS}", valueRenderOption="FORMATTED_VALUE",
    ).execute()
    return tab, res.get("values", [])


def _load_rows(spreadsheet_url: str, tab: str, aliases: Dict[str, List[str]], overrides: Dict[str, str],
               key_field: str, header_row: Optional[int]) -> Dict[str, Any]:
    spreadsheet_id = extract_spreadsheet_id(spreadsheet_url)
    if not spreadsheet_id:
        return {"error": "Link Google Sheet không hợp lệ. Dán link dạng https://docs.google.com/spreadsheets/d/..."}
    try:
        tab, values = _read_sheet_values(spreadsheet_id, str(tab or "").strip())
    except Exception as exc:
        text = str(exc)
        hint = ""
        if "403" in text or "permission" in text.lower() or "PERMISSION_DENIED" in text:
            email = service_account_email()
            hint = f" Hãy chia sẻ file Sheet (quyền Xem) cho {email or 'email Service Account của FTWorkspace'}."
        elif "Unable to parse range" in text:
            hint = " Tên tab không đúng."
        return {"error": f"Không đọc được Google Sheet: {text[:300]}.{hint}"}

    if header_row:
        start = max(int(header_row) - 1, 0)
        candidates = [start]
    else:
        candidates = list(range(min(10, len(values))))
    # Dòng tiêu đề phải khớp ít nhất 2 cột, để dòng tựa đề như "DANH SÁCH TÀI KHOẢN" không bị nhận nhầm.
    matched = [(idx, _match_columns(values[idx], aliases, overrides)) for idx in candidates if idx < len(values)]
    matched = [(idx, cols) for idx, cols in matched if key_field in cols]
    best = next(((idx, cols) for idx, cols in matched if len(cols) >= 2), matched[0] if matched else None)
    if best:
        idx, columns = best
        header = [str(cell) for cell in values[idx]]
        rows = []
        for offset, row in enumerate(values[idx + 1:], start=idx + 2):
            record = {f: (str(row[c]).strip() if c < len(row) and row[c] is not None else "") for f, c in columns.items()}
            if any(record.values()):
                rows.append((offset, record))
        return {"tab": tab, "header_row": idx + 1, "header": header,
                "columns": {f: header[c] for f, c in columns.items()}, "rows": rows}
    first = [str(c) for c in values[0]] if values else []
    return {"error": (
        f"Không tìm thấy cột '{key_field}' trong tab '{tab}'. Các cột đang có: {first}. "
        "Truyền tham số columns để chỉ rõ tên cột, ví dụ {\"username\": \"Email\", \"password\": \"Mật khẩu\"}."
    )}


def _parse_date(value: Any) -> Optional[datetime.date]:
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y"):
        try:
            return datetime.datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


COMMON_PARAMS = {
    "spreadsheet_url": {"type": "string", "description": "Link Google Sheet chứa danh sách (FTWorkspace tự đọc file)"},
    "tab": {"type": "string", "description": "Tên tab. Bỏ trống = tab đầu tiên"},
    "header_row": {"type": "integer", "description": "Dòng tiêu đề (bắt đầu từ 1). Bỏ trống để tự tìm"},
    "dry_run": {"type": "boolean", "description": "true = chỉ xem trước cột và số dòng, không ghi gì. Nên chạy trước."},
}


@register_tool(
    name="crm_import_ai_accounts_from_sheet",
    title="Nhập tài khoản AI khách hàng từ Google Sheet",
    description=(
        "Nhập hàng loạt tài khoản AI (email, mật khẩu, người nhận) cho khách hàng từ một Google Sheet. "
        "FTWorkspace tự đọc file nên mật khẩu không cần gửi qua cuộc trò chuyện; KHÔNG chép mật khẩu vào tham số. "
        "Chạy dry_run=true trước để kiểm tra cột. Kết quả không chứa mật khẩu. "
        "Sheet cần chia sẻ quyền Xem cho Service Account của FTWorkspace."
    ),
    module="digital-training",
    min_role="EMPLOYEE",
    audit_action="Nhập tài khoản AI từ Google Sheet",
    parameters={
        "type": "object",
        "properties": {
            **COMMON_PARAMS,
            "partner_id": {"type": "integer", "description": "ID khách hàng nhận tài khoản (nếu Sheet không có cột Trường)"},
            "partner_name": {"type": "string", "description": "Tên khách hàng nhận tài khoản (nếu Sheet không có cột Trường)"},
            "columns": {
                "type": "object",
                "description": "Tên cột trên Sheet nếu không tự nhận ra: username, password, assigned_to, platform, partner",
                "additionalProperties": {"type": "string"},
            },
            "default_platform": {"type": "string", "description": "Nền tảng khi Sheet không ghi (mặc định chatgpt_plus)"},
            "starts_at": {"type": "string", "description": "Ngày cấp chung YYYY-MM-DD (mặc định hôm nay)"},
            "expires_at": {"type": "string", "description": "Ngày hết hạn chung YYYY-MM-DD (mặc định 1 năm sau)"},
        },
        "required": ["spreadsheet_url"],
        "additionalProperties": False,
    },
)
def crm_import_ai_accounts_from_sheet(
    ctx: Dict[str, Any], spreadsheet_url: str, tab: str = "", header_row: Optional[int] = None, dry_run: bool = False,
    partner_id: Optional[int] = None, partner_name: str = "", columns: Optional[Dict[str, str]] = None,
    default_platform: str = "chatgpt_plus", starts_at: str = "", expires_at: str = "", **_kwargs: Any,
) -> Dict[str, Any]:
    loaded = _load_rows(spreadsheet_url, tab, AI_ACCOUNT_COLUMNS, columns or {}, "username", header_row)
    if "error" in loaded:
        return {"success": False, "error": loaded["error"]}

    default_partner = None
    if partner_id or partner_name:
        default_partner, error = find_partner(partner_id, partner_name)
        if not default_partner:
            return {"success": False, "error": error}
    elif "partner" not in loaded["columns"]:
        return {"success": False, "error": "Cần partner_id/partner_name, hoặc Sheet phải có cột Trường / Khách hàng."}

    s_date = _parse_date(starts_at) or timezone.localdate()
    e_date = _parse_date(expires_at) or s_date.replace(year=s_date.year + 1)

    planned, skipped = [], []
    partner_cache: Dict[str, Any] = {}
    for row_num, record in loaded["rows"]:
        username = record.get("username", "")
        if not username:
            skipped.append({"row": row_num, "reason": "Thiếu email / tài khoản."})
            continue
        partner = default_partner
        row_partner = record.get("partner", "")
        if row_partner:
            if row_partner not in partner_cache:
                partner_cache[row_partner] = find_partner(None, row_partner)
            partner, error = partner_cache[row_partner]
            if not partner:
                skipped.append({"row": row_num, "username": username, "reason": error})
                continue
        planned.append((row_num, partner, record))

    summary = {
        "tab": loaded["tab"], "header_row": loaded["header_row"], "columns": loaded["columns"],
        "rows_ready": len(planned), "rows_skipped": skipped[:50],
        "missing_password_rows": sum(1 for _r, _p, rec in planned if not rec.get("password")),
    }
    if dry_run:
        summary["preview"] = [
            {"row": r, "username": rec["username"], "partner": p.name, "assigned_to": rec.get("assigned_to", ""),
             "has_password": bool(rec.get("password"))}
            for r, p, rec in planned[:PREVIEW_ROWS]
        ]
        return {"success": True, "dry_run": True, **summary,
                "message": "Chỉ xem trước, chưa ghi. Gọi lại với dry_run=false để nhập."}

    created = updated = 0
    touched_partners = {}
    subs: Dict[int, Any] = {}
    for _row, partner, record in planned:
        if partner.id not in subs:
            subs[partner.id] = TrainingProductSubscription.objects.filter(partner=partner, product__code="ai-dung-chung").first()
        defaults = {
            "subscription": subs[partner.id],
            "platform": record.get("platform") or default_platform,
            "assigned_to": record.get("assigned_to", ""),
            "starts_at": s_date,
            "expires_at": e_date,
            "status": "active",
        }
        existing = TrainingPartnerAiAccount.objects.filter(partner=partner, account_username=record["username"]).first()
        if record.get("password"):
            defaults["account_password"] = record["password"]
        elif not existing:
            defaults["account_password"] = _generate_secure_password(12)
        _acc, was_created = TrainingPartnerAiAccount.objects.update_or_create(
            partner=partner, account_username=record["username"], defaults=defaults,
        )
        created += int(was_created)
        updated += int(not was_created)
        touched_partners[partner.id] = partner

    totals = {p.name: _sync_partner_ai_count(p) for p in touched_partners.values()}
    return {
        "success": True, **summary, "created": created, "updated": updated, "partner_ai_account_count": totals,
        "message": f"Đã nhập {created} tài khoản mới, cập nhật {updated} tài khoản. Mật khẩu xem trên web khi cần.",
    }


@register_tool(
    name="company_import_accounts_from_sheet",
    title="Nhập tài khoản nội bộ từ Google Sheet",
    description=(
        "Nhập hàng loạt vào bảng Tài khoản nội bộ (mục Tài nguyên): tài khoản phần mềm, công cụ của công ty (tên dịch vụ, email đăng nhập, mật khẩu, 2FA, người phụ trách, "
        "gói, chi phí, ngày gia hạn) từ một Google Sheet. FTWorkspace tự đọc file nên mật khẩu không đi qua cuộc "
        "trò chuyện; KHÔNG chép mật khẩu vào tham số. Trùng tên dịch vụ + tài khoản thì cập nhật. "
        "Chạy dry_run=true trước. Sheet cần chia sẻ quyền Xem cho Service Account của FTWorkspace."
    ),
    module="resources",
    min_role="EMPLOYEE",
    audit_action="Nhập tài khoản nội bộ từ Google Sheet",
    parameters={
        "type": "object",
        "properties": {
            **COMMON_PARAMS,
            "columns": {
                "type": "object",
                "description": (
                    "Tên cột trên Sheet nếu không tự nhận ra: name, provider, category, login_url, username, password, "
                    "two_factor, owner_email, plan, cost, renewal_date, notes"
                ),
                "additionalProperties": {"type": "string"},
            },
            "default_category": {
                "type": "string", "enum": [code for code, _ in CompanyAccount.CATEGORY_CHOICES],
                "description": "Nhóm khi Sheet không có cột Nhóm hợp lệ",
            },
        },
        "required": ["spreadsheet_url"],
        "additionalProperties": False,
    },
)
def company_import_accounts_from_sheet(
    ctx: Dict[str, Any], spreadsheet_url: str, tab: str = "", header_row: Optional[int] = None, dry_run: bool = False,
    columns: Optional[Dict[str, str]] = None, default_category: str = "", **_kwargs: Any,
) -> Dict[str, Any]:
    loaded = _load_rows(spreadsheet_url, tab, COMPANY_ACCOUNT_COLUMNS, columns or {}, "name", header_row)
    if "error" in loaded:
        return {"success": False, "error": loaded["error"]}

    categories = {code for code, _ in CompanyAccount.CATEGORY_CHOICES}
    category_labels = {_norm(label): code for code, label in CompanyAccount.CATEGORY_CHOICES}
    planned, skipped = [], []
    for row_num, record in loaded["rows"]:
        if not record.get("name"):
            skipped.append({"row": row_num, "reason": "Thiếu tên dịch vụ."})
            continue
        data = {k: v for k, v in record.items() if v != ""}
        raw_category = data.pop("category", "")
        category = raw_category if raw_category in categories else category_labels.get(_norm(raw_category), "")
        if category or default_category:
            data["category"] = category or default_category
        if "cost" in data:
            digits = re.sub(r"[^\d]", "", data["cost"])
            data["cost"] = int(digits) if digits else None
        if "renewal_date" in data:
            parsed = _parse_date(data["renewal_date"])
            if parsed:
                data["renewal_date"] = parsed.isoformat()
            else:
                data.pop("renewal_date")
        planned.append((row_num, data))

    summary = {
        "tab": loaded["tab"], "header_row": loaded["header_row"], "columns": loaded["columns"],
        "rows_ready": len(planned), "rows_skipped": skipped[:50],
    }
    if dry_run:
        summary["preview"] = [
            {"row": r, "name": d["name"], "username": d.get("username", ""), "has_password": bool(d.get("password"))}
            for r, d in planned[:PREVIEW_ROWS]
        ]
        return {"success": True, "dry_run": True, **summary,
                "message": "Chỉ xem trước, chưa ghi. Gọi lại với dry_run=false để nhập."}

    created = updated = 0
    errors = list(skipped)
    for row_num, data in planned:
        account = CompanyAccount.objects.filter(name__iexact=data["name"], username__iexact=data.get("username", "")).first()
        try:
            company_services.save_account(account or CompanyAccount(), data, ctx.get("email", ""), channel="mcp")
        except company_services.AccountValidationError as exc:
            errors.append({"row": row_num, "name": data["name"], "reason": exc.errors})
            continue
        created += int(account is None)
        updated += int(account is not None)
    summary["rows_skipped"] = errors[:50]
    return {
        "success": True, **summary, "created": created, "updated": updated,
        "message": f"Đã thêm {created} tài khoản, cập nhật {updated} tài khoản nội bộ.",
    }
