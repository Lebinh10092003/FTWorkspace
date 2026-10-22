from __future__ import annotations

import hashlib
import uuid
from typing import Any, Dict, List, Optional
from django.utils import timezone

from authentication.models import SystemConfig


CONFIG_KEY = "mcp_ai_access_keys"


def _get_keys_store() -> Dict[str, Any]:
    config, _ = SystemConfig.objects.get_or_create(key=CONFIG_KEY)
    return config.data if isinstance(config.data, dict) else {}


def _save_keys_store(store: Dict[str, Any]) -> None:
    config, _ = SystemConfig.objects.get_or_create(key=CONFIG_KEY)
    config.data = store
    config.save(update_fields=["data"])


def _hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.strip().encode("utf-8")).hexdigest()


def create_ai_key(user_email: str, name: str = "ChatGPT Web") -> Dict[str, Any]:
    """Tạo một Mã kết nối AI (AI Access Key) riêng biệt cho nhân sự."""
    email_clean = user_email.strip().lower()
    raw_key = f"ft_ai_{uuid.uuid4().hex}"
    key_hash = _hash_key(raw_key)
    key_id = uuid.uuid4().hex[:12]
    now_iso = timezone.now().isoformat()

    store = _get_keys_store()
    user_keys = store.get(email_clean, [])
    if not isinstance(user_keys, list):
        user_keys = []

    key_record = {
        "id": key_id,
        "name": name.strip() or "Trợ lý AI",
        "key_prefix": f"{raw_key[:11]}...",
        "key_hash": key_hash,
        "created_at": now_iso,
        "last_used_at": None,
        "is_active": True,
    }
    user_keys.append(key_record)
    store[email_clean] = user_keys
    _save_keys_store(store)

    return {
        "id": key_id,
        "name": key_record["name"],
        "raw_key": raw_key,  # Chỉ hiển thị một lần duy nhất lúc tạo
        "key_prefix": key_record["key_prefix"],
        "created_at": now_iso,
    }


def verify_ai_key(raw_key: str) -> Optional[str]:
    """Kiểm tra mã kết nối AI và trả về email của người dùng sở hữu nếu hợp lệ."""
    if not raw_key or not raw_key.startswith("ft_ai_"):
        return None

    target_hash = _hash_key(raw_key)
    store = _get_keys_store()
    now_iso = timezone.now().isoformat()
    matched_email = None
    store_changed = False

    for email, keys in store.items():
        if not isinstance(keys, list):
            continue
        for k in keys:
            if isinstance(k, dict) and k.get("key_hash") == target_hash and k.get("is_active"):
                k["last_used_at"] = now_iso
                matched_email = email
                store_changed = True
                break
        if matched_email:
            break

    if store_changed:
        _save_keys_store(store)

    return matched_email


def list_ai_keys(user_email: str) -> List[Dict[str, Any]]:
    """Liệt kê các mã kết nối AI của một người dùng."""
    email_clean = user_email.strip().lower()
    store = _get_keys_store()
    keys = store.get(email_clean, [])
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
    store = _get_keys_store()
    keys = store.get(email_clean, [])
    if not isinstance(keys, list):
        return False

    revoked = False
    for k in keys:
        if isinstance(k, dict) and k.get("id") == key_id:
            k["is_active"] = False
            revoked = True
            break

    if revoked:
        _save_keys_store(store)
    return revoked
