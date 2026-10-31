"""Security, encryption, and token masking for the Publishing module.

- Token and sensitive credential encryption via Fernet using PUBLISH_TOKEN_KEY.
- Safe fallback key derivation in dev/test using SECRET_KEY.
- Token masking helper for API responses (only show last 4 chars).
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
from typing import Any, Dict, Optional

from cryptography.fernet import Fernet
from django.conf import settings

logger = logging.getLogger(__name__)


def get_publish_key() -> bytes:
    """Retrieve the Fernet encryption key from PUBLISH_TOKEN_KEY env or fallback."""
    raw_key = os.getenv("PUBLISH_TOKEN_KEY", "").strip()
    if raw_key:
        try:
            key_bytes = raw_key.encode("utf-8")
            Fernet(key_bytes)
            return key_bytes
        except Exception as exc:
            logger.warning("PUBLISH_TOKEN_KEY is not a valid 32-byte url-safe base64 key: %s", exc)

    # Deterministic fallback key derived from SECRET_KEY (e.g. for testing & local dev)
    secret = getattr(settings, "SECRET_KEY", "ft-workspace-fallback-publish-secret")
    derived_32 = hashlib.sha256(secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(derived_32)


def encrypt_config(config: Dict[str, Any]) -> str:
    """Encrypt channel configuration dictionary into Fernet token string."""
    key = get_publish_key()
    f = Fernet(key)
    raw_json = json.dumps(config or {}, ensure_ascii=False)
    return f.encrypt(raw_json.encode("utf-8")).decode("utf-8")


def decrypt_config(encrypted_token: str) -> Dict[str, Any]:
    """Decrypt Fernet token string back into channel configuration dictionary."""
    if not encrypted_token:
        return {}
    key = get_publish_key()
    f = Fernet(key)
    try:
        decrypted = f.decrypt(encrypted_token.encode("utf-8")).decode("utf-8")
        return json.loads(decrypted)
    except Exception as exc:
        logger.error("Failed to decrypt channel config: %s", exc)
        return {}


def mask_secret(value: Optional[str]) -> str:
    """Mask secret token, revealing only the last 4 characters."""
    if not value or not isinstance(value, str):
        return ""
    clean = value.strip()
    if len(clean) <= 4:
        return "••••"
    return f"••••••••{clean[-4:]}"


def mask_config_for_display(config: Dict[str, Any], kind: str) -> Dict[str, Any]:
    """Return a sanitized copy of channel config safe for public/API serialization."""
    masked = dict(config or {})

    # Mask sensitive credentials depending on channel type
    if "access_token" in masked:
        masked["access_token"] = mask_secret(masked["access_token"])
    if "secret" in masked:
        masked["secret"] = mask_secret(masked["secret"])
    if "app_password" in masked:
        masked["app_password"] = mask_secret(masked["app_password"])
    if "password" in masked:
        masked["password"] = mask_secret(masked["password"])

    return masked
