from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import timedelta
from typing import Any, Callable, Dict, List, Optional

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from authentication.models import SystemConfig

logger = logging.getLogger(__name__)

CONFIG_KEY = "mcp_ai_access_keys"

# Chỉ ghi lại "lần dùng cuối" khi đã cũ hơn khoảng này, để mỗi lệnh MCP không ghi DB.
LAST_USED_WRITE_INTERVAL = timedelta(minutes=10)


def _get_keys_store() -> Dict[str, Any]:
    config = SystemConfig.objects.filter(key=CONFIG_KEY).first()
    return config.data if config and isinstance(config.data, dict) else {}


def _mutate_store(change: Callable[[Dict[str, Any]], Any]) -> Any:
    """Đọc và ghi kho mã trong cùng một giao dịch có khóa dòng.

    Toàn bộ mã nằm trong một ô JSON. Đọc ngoài giao dịch rồi ghi đè cả ô sẽ làm mất
    mã vừa tạo ở worker khác (ví dụ tạo mã mới đúng lúc Claude đang gọi công cụ).
    """
    with transaction.atomic():
        SystemConfig.objects.get_or_create(key=CONFIG_KEY)
        config = SystemConfig.objects.select_for_update().get(key=CONFIG_KEY)
        store = config.data if isinstance(config.data, dict) else {}
        result = change(store)
        config.data = store
        config.save(update_fields=["data"])
        return result


def _hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.strip().encode("utf-8")).hexdigest()


def create_ai_key(user_email: str, name: str = "ChatGPT Web") -> Dict[str, Any]:
    """Tạo một Mã kết nối AI (AI Access Key) riêng biệt cho nhân sự."""
    email_clean = user_email.strip().lower()
    raw_key = f"ft_ai_{uuid.uuid4().hex}"
    key_id = uuid.uuid4().hex[:12]
    now_iso = timezone.now().isoformat()
    key_record = {
        "id": key_id,
        "name": name.strip() or "Trợ lý AI",
        "key_prefix": f"{raw_key[:11]}...",
        "key_hash": _hash_key(raw_key),
        "created_at": now_iso,
        "last_used_at": None,
        "is_active": True,
    }

    def add(store: Dict[str, Any]) -> None:
        user_keys = store.get(email_clean)
        if not isinstance(user_keys, list):
            user_keys = []
        user_keys.append(key_record)
        store[email_clean] = user_keys

    _mutate_store(add)

    return {
        "id": key_id,
        "name": key_record["name"],
        "raw_key": raw_key,  # Chỉ hiển thị một lần duy nhất lúc tạo
        "key_prefix": key_record["key_prefix"],
        "created_at": now_iso,
    }


def _find_active_key(store: Dict[str, Any], target_hash: str):
    for email, keys in store.items():
        if not isinstance(keys, list):
            continue
        for record in keys:
            if isinstance(record, dict) and record.get("key_hash") == target_hash and record.get("is_active"):
                return email, record
    return None, None


def _touch_last_used(target_hash: str) -> None:
    now = timezone.now()

    def touch(store: Dict[str, Any]) -> None:
        _email, record = _find_active_key(store, target_hash)
        if record is not None:
            record["last_used_at"] = now.isoformat()

    try:
        _mutate_store(touch)
    except Exception as exc:  # Ghi "lần dùng cuối" thất bại không được chặn việc xác thực.
        logger.warning("Không cập nhật được lần dùng cuối của mã kết nối AI: %s", exc)


def verify_ai_key(raw_key: str) -> Optional[str]:
    """Kiểm tra mã kết nối AI và trả về email của người dùng sở hữu nếu hợp lệ."""
    if not raw_key or not raw_key.strip().startswith("ft_ai_"):
        return None

    target_hash = _hash_key(raw_key)
    email, record = _find_active_key(_get_keys_store(), target_hash)
    if not email:
        return None

    last_used = parse_datetime(str(record.get("last_used_at") or ""))
    if last_used is None or timezone.now() - last_used >= LAST_USED_WRITE_INTERVAL:
        _touch_last_used(target_hash)
    return email


def list_ai_keys(user_email: str) -> List[Dict[str, Any]]:
    """Liệt kê các mã kết nối AI của một người dùng."""
    email_clean = user_email.strip().lower()
    keys = _get_keys_store().get(email_clean, [])
    if not isinstance(keys, list):
        return []
    # Trả về thông tin an toàn (không lộ hash hay raw key)
    return [
        {
            "id": k.get("id"),
            "name": k.get("name"),
            "key_prefix": k.get("key_prefix"),
            "created_at": k.get("created_at"),
            "last_used_at": k.get("last_used_at"),
            "is_active": k.get("is_active", True),
        }
        for k in keys
        if isinstance(k, dict)
    ]


def revoke_ai_key(user_email: str, key_id: str) -> bool:
    """Thu hồi một mã kết nối AI."""
    email_clean = user_email.strip().lower()

    def revoke(store: Dict[str, Any]) -> bool:
        keys = store.get(email_clean)
        if not isinstance(keys, list):
            return False
        for record in keys:
            if isinstance(record, dict) and record.get("id") == key_id:
                record["is_active"] = False
                return True
        return False

    return _mutate_store(revoke)
