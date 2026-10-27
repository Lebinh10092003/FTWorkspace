"""Chặn dò mật khẩu: sai nhiều lần thì khóa tạm theo email và theo IP.

- Một email sai 10 lần trong 15 phút: khóa email đó 15 phút.
- Một IP sai 50 lần trong 15 phút: khóa IP đó 15 phút.
Đăng nhập đúng xóa bộ đếm của email. Bộ đếm lưu trong DB nên đúng với nhiều worker gunicorn.
"""
from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .models import LoginThrottle

WINDOW = timedelta(minutes=15)
LOCK = timedelta(minutes=15)
EMAIL_LIMIT = 10
IP_LIMIT = 50


def client_ip(request) -> str:
    """IP thật do nginx đặt (X-Real-IP). Không tin phần đầu X-Forwarded-For vì người gọi tự điền được."""
    meta = getattr(request, "META", {}) or {}
    real = str(meta.get("HTTP_X_REAL_IP") or "").strip()
    if real:
        return real[:64]
    forwarded = [part.strip() for part in str(meta.get("HTTP_X_FORWARDED_FOR") or "").split(",") if part.strip()]
    if forwarded:
        return forwarded[-1][:64]
    return str(meta.get("REMOTE_ADDR") or "")[:64]


def _keys(email: str, ip: str) -> list[tuple[str, int]]:
    keys = []
    if email:
        keys.append((f"email:{email.strip().lower()}", EMAIL_LIMIT))
    if ip:
        keys.append((f"ip:{ip}", IP_LIMIT))
    return keys


def locked_seconds(email: str, ip: str) -> int:
    """Số giây còn bị khóa (0 nếu được phép thử)."""
    now = timezone.now()
    remaining = 0
    for key, _limit in _keys(email, ip):
        row = LoginThrottle.objects.filter(key=key).only("locked_until").first()
        if row and row.locked_until and row.locked_until > now:
            remaining = max(remaining, int((row.locked_until - now).total_seconds()) + 1)
    return remaining


def register_failure(email: str, ip: str) -> None:
    now = timezone.now()
    for key, limit in _keys(email, ip):
        with transaction.atomic():
            row, _ = LoginThrottle.objects.select_for_update().get_or_create(
                key=key, defaults={"window_started_at": now},
            )
            if now - row.window_started_at > WINDOW:
                row.failures = 0
                row.window_started_at = now
            row.failures += 1
            if row.failures >= limit:
                row.locked_until = now + LOCK
                row.failures = 0
                row.window_started_at = now
            row.save()


def register_success(email: str) -> None:
    if email:
        LoginThrottle.objects.filter(key=f"email:{email.strip().lower()}").delete()


def locked_message(seconds: int) -> str:
    minutes = max(1, (seconds + 59) // 60)
    return f"Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau khoảng {minutes} phút."
