"""Nghiệp vụ tài khoản công ty, dùng chung cho API web và công cụ MCP."""
from __future__ import annotations

import base64
import datetime
import hashlib
import logging
import os
import re
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Iterable, List, Optional

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db.models import Q, QuerySet
from django.utils import timezone

from .models import CompanyAccount, CompanyAccountLog

logger = logging.getLogger(__name__)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
TEXT_FIELDS = (
    "name", "provider", "login_url", "username", "two_factor", "recovery_email", "recovery_phone",
    "owner_email", "department", "plan", "currency", "payment_method", "notes",
)
CHOICE_FIELDS = {
    "category": dict(CompanyAccount.CATEGORY_CHOICES),
    "status": dict(CompanyAccount.STATUS_CHOICES),
    "billing_cycle": dict(CompanyAccount.BILLING_CHOICES),
}
CYCLE_MONTHS = {"monthly": 1, "quarterly": 3, "yearly": 12}


class AccountValidationError(ValueError):
    def __init__(self, errors: Dict[str, str]):
        super().__init__("; ".join(f"{k}: {v}" for k, v in errors.items()))
        self.errors = errors


# ---------------------------------------------------------------- mã hóa

def _cipher() -> Fernet:
    """Khóa: COMPANY_ACCOUNT_ENCRYPTION_KEY nếu có, mặc định suy ra từ SECRET_KEY (không cần cấu hình).

    Đổi khóa sau khi đã lưu mật khẩu sẽ không giải mã được nữa, nên giữ khóa ổn định trên máy chủ.
    """
    key = os.getenv("COMPANY_ACCOUNT_ENCRYPTION_KEY", "").strip()
    if not key:
        key = base64.urlsafe_b64encode(hashlib.sha256(f"company-accounts:{settings.SECRET_KEY}".encode()).digest()).decode()
    return Fernet(key.encode())


def encrypt_password(raw: str) -> str:
    return _cipher().encrypt(raw.encode()).decode() if raw else ""


def decrypt_password(token: str) -> str:
    if not token:
        return ""
    try:
        return _cipher().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError) as exc:
        raise ValueError("Không giải mã được mật khẩu (khóa mã hóa trên máy chủ đã đổi?).") from exc


# ---------------------------------------------------------------- nhật ký

def log_action(account: Optional[CompanyAccount], action: str, actor_email: str, *, channel: str = "web",
               detail: str = "", ip: str = "", account_name: str = "") -> None:
    try:
        CompanyAccountLog.objects.create(
            account=account,
            account_name=(account.name if account else account_name)[:255],
            action=action,
            actor_email=actor_email or "",
            channel=channel,
            detail=detail[:500],
            ip=ip[:64],
        )
    except Exception:  # Nhật ký không được làm hỏng thao tác chính.
        logger.exception("Không ghi được nhật ký tài khoản công ty")


# ---------------------------------------------------------------- hiển thị

def days_until_renewal(account: CompanyAccount, today: Optional[datetime.date] = None) -> Optional[int]:
    if not account.renewal_date:
        return None
    return (account.renewal_date - (today or timezone.localdate())).days


def monthly_cost(account: CompanyAccount) -> Decimal:
    if account.status != "active" or not account.cost:
        return Decimal(0)
    months = CYCLE_MONTHS.get(account.billing_cycle)
    if not months:
        return Decimal(0)
    return (Decimal(account.cost) / months).quantize(Decimal(1))


def account_payload(account: CompanyAccount, *, include_password: bool = False) -> Dict[str, Any]:
    today = timezone.localdate()
    data = {
        "id": account.id,
        "name": account.name,
        "category": account.category,
        "categoryLabel": account.get_category_display(),
        "provider": account.provider,
        "loginUrl": account.login_url,
        "username": account.username,
        "hasPassword": bool(account.password_encrypted),
        "passwordChangedAt": account.password_changed_at.isoformat() if account.password_changed_at else None,
        "twoFactor": account.two_factor,
        "recoveryEmail": account.recovery_email,
        "recoveryPhone": account.recovery_phone,
        "ownerEmail": account.owner_email,
        "department": account.department,
        "users": list(account.users or []),
        "plan": account.plan,
        "cost": int(account.cost) if account.cost is not None else None,
        "currency": account.currency,
        "billingCycle": account.billing_cycle,
        "billingCycleLabel": account.get_billing_cycle_display(),
        "monthlyCost": int(monthly_cost(account)),
        "renewalDate": account.renewal_date.isoformat() if account.renewal_date else None,
        "daysUntilRenewal": days_until_renewal(account, today),
        "autoRenew": account.auto_renew,
        "paymentMethod": account.payment_method,
        "status": account.status,
        "statusLabel": account.get_status_display(),
        "tags": list(account.tags or []),
        "notes": account.notes,
        "createdBy": account.created_by,
        "updatedBy": account.updated_by,
        "createdAt": account.created_at.isoformat() if account.created_at else None,
        "updatedAt": account.updated_at.isoformat() if account.updated_at else None,
    }
    if include_password:
        # Trang quản lý (chỉ Admin) hiện mật khẩu như văn bản thường; trong DB vẫn lưu dạng mã hóa.
        try:
            data["password"] = decrypt_password(account.password_encrypted)
        except ValueError:
            data["password"] = ""
            data["passwordError"] = "Không giải mã được mật khẩu đã lưu. Hãy nhập lại."
    return data


def log_payload(item: CompanyAccountLog) -> Dict[str, Any]:
    return {
        "id": item.id,
        "accountId": item.account_id,
        "accountName": item.account_name,
        "action": item.action,
        "actionLabel": item.get_action_display(),
        "actorEmail": item.actor_email,
        "channel": item.channel,
        "detail": item.detail,
        "createdAt": item.created_at.isoformat(),
    }


# ---------------------------------------------------------------- truy vấn

def filter_accounts(qs: QuerySet, *, search: str = "", category: str = "", status: str = "",
                    owner: str = "", renewal_within_days: Optional[int] = None) -> QuerySet:
    search = str(search or "").strip()
    if search:
        qs = qs.filter(
            Q(name__icontains=search) | Q(provider__icontains=search) | Q(username__icontains=search)
            | Q(owner_email__icontains=search) | Q(department__icontains=search) | Q(notes__icontains=search)
            | Q(plan__icontains=search)
        )
    if category and category != "all":
        qs = qs.filter(category=category)
    if status and status != "all":
        qs = qs.filter(status=status)
    if owner:
        qs = qs.filter(owner_email__iexact=owner.strip())
    if renewal_within_days is not None:
        horizon = timezone.localdate() + datetime.timedelta(days=int(renewal_within_days))
        qs = qs.filter(status="active", renewal_date__isnull=False, renewal_date__lte=horizon)
    return qs


def summary(accounts: Iterable[CompanyAccount], *, days_ahead: int = 30) -> Dict[str, Any]:
    today = timezone.localdate()
    rows = list(accounts)
    active = [a for a in rows if a.status == "active"]
    by_category: Dict[str, int] = {}
    for a in active:
        by_category[a.category] = by_category.get(a.category, 0) + 1
    due = [a for a in active if a.renewal_date and (a.renewal_date - today).days <= days_ahead]
    due.sort(key=lambda a: a.renewal_date)
    stale_cutoff = timezone.now() - datetime.timedelta(days=180)
    return {
        "total": len(rows),
        "active": len(active),
        "byCategory": by_category,
        "monthlyCost": int(sum((monthly_cost(a) for a in active), Decimal(0))),
        "renewalDueCount": len(due),
        "overdueCount": sum(1 for a in due if a.renewal_date < today),
        "renewalDue": [
            {"id": a.id, "name": a.name, "renewalDate": a.renewal_date.isoformat(),
             "daysUntilRenewal": (a.renewal_date - today).days, "autoRenew": a.auto_renew,
             "cost": int(a.cost) if a.cost is not None else None, "ownerEmail": a.owner_email}
            for a in due[:50]
        ],
        "withoutOwner": sum(1 for a in active if not a.owner_email),
        "stalePasswords": sum(
            1 for a in active if a.password_encrypted and (not a.password_changed_at or a.password_changed_at < stale_cutoff)
        ),
    }


# ---------------------------------------------------------------- ghi

def _clean_list(value: Any) -> List[str]:
    if isinstance(value, str):
        value = re.split(r"[,;\n]", value)
    if not isinstance(value, (list, tuple)):
        return []
    return list(dict.fromkeys(str(v).strip() for v in value if str(v).strip()))


def apply_changes(account: CompanyAccount, data: Dict[str, Any], actor_email: str) -> Dict[str, Any]:
    """Gán dữ liệu (camelCase hoặc snake_case) vào tài khoản và kiểm tra. Chưa lưu.

    Trả về {"password_changed": bool}. Mật khẩu: khóa `password` có giá trị → đặt mới;
    `clearPassword` = true → xóa; không gửi → giữ nguyên.
    """
    aliases = {
        "loginUrl": "login_url", "twoFactor": "two_factor", "recoveryEmail": "recovery_email",
        "recoveryPhone": "recovery_phone", "ownerEmail": "owner_email", "billingCycle": "billing_cycle",
        "renewalDate": "renewal_date", "autoRenew": "auto_renew", "paymentMethod": "payment_method",
        "clearPassword": "clear_password",
    }
    data = {aliases.get(k, k): v for k, v in (data or {}).items()}
    errors: Dict[str, str] = {}

    for field in TEXT_FIELDS:
        if field in data and data[field] is not None:
            max_len = CompanyAccount._meta.get_field(field).max_length
            value = str(data[field]).strip()
            if max_len and len(value) > max_len:
                errors[field] = f"Tối đa {max_len} ký tự."
            setattr(account, field, value)

    for field, choices in CHOICE_FIELDS.items():
        if field in data and data[field] not in (None, ""):
            if data[field] not in choices:
                errors[field] = f"Giá trị không hợp lệ. Chọn một trong: {', '.join(choices)}."
            else:
                setattr(account, field, data[field])

    if "users" in data:
        account.users = _clean_list(data["users"])
    if "tags" in data:
        account.tags = _clean_list(data["tags"])
    if "auto_renew" in data:
        account.auto_renew = bool(data["auto_renew"]) and str(data["auto_renew"]).lower() not in {"false", "0"}

    if "cost" in data:
        raw = data["cost"]
        if raw in (None, ""):
            account.cost = None
        else:
            try:
                cost = Decimal(str(raw).replace(",", "").replace(" ", ""))
                if cost < 0:
                    raise InvalidOperation
                account.cost = cost.quantize(Decimal(1))
            except (InvalidOperation, ValueError):
                errors["cost"] = "Chi phí phải là số không âm."

    if "renewal_date" in data:
        raw = data["renewal_date"]
        if raw in (None, ""):
            account.renewal_date = None
        else:
            try:
                account.renewal_date = datetime.date.fromisoformat(str(raw)[:10])
            except ValueError:
                errors["renewal_date"] = "Ngày gia hạn phải có dạng YYYY-MM-DD."

    if not account.name:
        errors["name"] = "Cần tên tài khoản / dịch vụ."
    for field in ("owner_email", "recovery_email"):
        value = getattr(account, field)
        if value and not EMAIL_RE.match(value):
            errors[field] = "Email không hợp lệ."
    if account.login_url and not re.match(r"^https?://", account.login_url, re.I):
        account.login_url = f"https://{account.login_url}"

    if errors:
        raise AccountValidationError(errors)

    password_changed = False
    if data.get("clear_password") is True:
        password_changed = bool(account.password_encrypted)
        account.password_encrypted = ""
        account.password_changed_at = None
    elif data.get("password") not in (None, ""):
        account.password_encrypted = encrypt_password(str(data["password"]))
        account.password_changed_at = timezone.now()
        password_changed = True

    if not account.pk:
        account.created_by = actor_email or ""
    account.updated_by = actor_email or ""
    return {"password_changed": password_changed}


def save_account(account: CompanyAccount, data: Dict[str, Any], actor_email: str, *,
                 channel: str = "web", ip: str = "") -> CompanyAccount:
    creating = account.pk is None
    result = apply_changes(account, data, actor_email)
    account.save()
    if creating:
        log_action(account, "create", actor_email, channel=channel, ip=ip)
    else:
        changed = sorted(k for k in data.keys() if k not in {"password", "clearPassword", "clear_password"})
        if changed:
            log_action(account, "update", actor_email, channel=channel, ip=ip, detail=", ".join(changed))
    if result["password_changed"] and not creating:
        log_action(account, "password", actor_email, channel=channel, ip=ip)
    return account


def reveal_password(account: CompanyAccount, actor_email: str, *, channel: str = "web", ip: str = "", reason: str = "") -> str:
    password = decrypt_password(account.password_encrypted)
    log_action(account, "reveal", actor_email, channel=channel, ip=ip, detail=reason)
    return password


def delete_account(account: CompanyAccount, actor_email: str, *, channel: str = "web", ip: str = "") -> None:
    name = account.name
    account.delete()
    log_action(None, "delete", actor_email, channel=channel, ip=ip, account_name=name)
