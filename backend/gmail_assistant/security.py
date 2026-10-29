"""
Security, encryption, and OAuth helpers for the Gmail Assistant module.
- Token encryption via Fernet using GMAIL_TOKEN_KEY.
- Domain authorization restrictions (GMAIL_ALLOWED_DOMAINS).
- Anti-CSRF state token generation and verification.
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import time
from typing import Any, Dict, Optional, Tuple

from cryptography.fernet import Fernet
from django.conf import settings

logger = logging.getLogger(__name__)

DEFAULT_ALLOWED_DOMAINS = ["fermat.vn"]
STATE_TTL_SECONDS = 900  # 15 minutes


def get_token_key() -> Optional[bytes]:
    """Retrieve the Fernet encryption key from environment, ensuring valid 32-byte url-safe base64."""
    raw_key = os.getenv("GMAIL_TOKEN_KEY", "").strip()
    if not raw_key:
        return None
    try:
        # Validate that raw_key can be used by Fernet
        key_bytes = raw_key.encode("utf-8")
        Fernet(key_bytes)
        return key_bytes
    except Exception as exc:
        logger.error("GMAIL_TOKEN_KEY is invalid for Fernet: %s", exc)
        return None


def encrypt_token(plain_token: str) -> str:
    """Encrypt a plaintext token using Fernet. Rejects saving if key is missing."""
    key = get_token_key()
    if not key:
        raise RuntimeError(
            "Hệ thống chưa cấu hình biến môi trường GMAIL_TOKEN_KEY hợp lệ để mã hóa token."
        )
    f = Fernet(key)
    return f.encrypt(plain_token.encode("utf-8")).decode("utf-8")


def decrypt_token(encrypted_token: str) -> str:
    """Decrypt an encrypted token using Fernet."""
    key = get_token_key()
    if not key:
        raise RuntimeError(
            "Hệ thống chưa cấu hình biến môi trường GMAIL_TOKEN_KEY hợp lệ để giải mã token."
        )
    f = Fernet(key)
    return f.decrypt(encrypted_token.encode("utf-8")).decode("utf-8")


def get_allowed_domains() -> list[str]:
    """Get list of allowed email domains for connecting Gmail."""
    raw = os.getenv("GMAIL_ALLOWED_DOMAINS", "").strip()
    if not raw:
        return list(DEFAULT_ALLOWED_DOMAINS)
    domains = [d.strip().lower() for d in raw.split(",") if d.strip()]
    return domains or list(DEFAULT_ALLOWED_DOMAINS)


def is_allowed_email(email: str, user_profile_email: Optional[str] = None) -> bool:
    """
    Check if the email is allowed to connect:
    1. Belongs to GMAIL_ALLOWED_DOMAINS (e.g. @fermat.vn), OR
    2. Matches the system UserProfile email.
    """
    if not email or "@" not in email:
        return False
    normalized = email.strip().lower()
    domain = normalized.split("@")[-1]

    allowed_domains = get_allowed_domains()
    if domain in allowed_domains:
        return True

    if user_profile_email:
        if normalized == user_profile_email.strip().lower():
            return True

    return False


def is_oauth_configured() -> bool:
    """Check if all required Google OAuth and encryption keys are configured in environment."""
    client_id = os.getenv("GMAIL_OAUTH_CLIENT_ID", "").strip()
    client_secret = os.getenv("GMAIL_OAUTH_CLIENT_SECRET", "").strip()
    has_key = get_token_key() is not None
    return bool(client_id and client_secret and has_key)


def get_oauth_credentials() -> Dict[str, str]:
    """Return OAuth client credentials and redirect URI."""
    client_id = os.getenv("GMAIL_OAUTH_CLIENT_ID", "").strip()
    client_secret = os.getenv("GMAIL_OAUTH_CLIENT_SECRET", "").strip()
    redirect_uri = os.getenv("GMAIL_OAUTH_REDIRECT_URI", "").strip()
    return {
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
    }


def generate_oauth_state(user_id: Any) -> str:
    """Generate a tamper-proof state token for OAuth anti-CSRF check."""
    timestamp = int(time.time())
    payload = json.dumps({"u": str(user_id), "t": timestamp}, separators=(",", ":"))
    payload_b64 = base64.urlsafe_b64encode(payload.encode("utf-8")).decode("utf-8")

    secret = getattr(settings, "SECRET_KEY", "fallback-secret").encode("utf-8")
    sig = hmac.new(secret, payload_b64.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def verify_oauth_state(state: str, expected_user_id: Any) -> bool:
    """Verify state token signature, timestamp freshness, and user_id match."""
    if not state or "." not in state:
        return False
    parts = state.split(".", 1)
    if len(parts) != 2:
        return False
    payload_b64, sig = parts

    secret = getattr(settings, "SECRET_KEY", "fallback-secret").encode("utf-8")
    expected_sig = hmac.new(secret, payload_b64.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        return False

    try:
        raw_json = base64.urlsafe_b64decode(payload_b64.encode("utf-8")).decode("utf-8")
        data = json.loads(raw_json)
        user_id = data.get("u")
        timestamp = data.get("t", 0)

        if str(user_id) != str(expected_user_id):
            return False

        if time.time() - timestamp > STATE_TTL_SECONDS:
            return False

        return True
    except Exception:
        return False
