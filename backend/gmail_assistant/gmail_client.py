"""
Gmail REST API Client wrapper.
SECURITY ENFORCEMENT:
- Only read and draft actions are supported (gmail.readonly, gmail.compose).
- ABSOLUTELY NO METHODS FOR SENDING EMAILS (strictly draft creation only).
- Strips HTML tracking pixels, scripts, and truncates email bodies to prevent abuse.
"""

import base64
import email
from email.mime.text import MIMEText
import html
import logging
import os
import re
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

import requests

from .security import decrypt_token, get_oauth_credentials

logger = logging.getLogger(__name__)

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

MAX_BODY_CHARS = 6000


def clean_html_to_text(raw_html: str) -> str:
    """Strip script tags, style tags, tracking pixels, and HTML markup to safe plain text."""
    if not raw_html:
        return ""
    # Remove script and style blocks
    cleaned = re.sub(r"(?is)<(script|style).*?>.*?</\1>", "", raw_html)
    # Remove tracking 1x1 images
    cleaned = re.sub(r'(?i)<img[^>]+(?:width=["\']?[01]["\']?|height=["\']?[01]["\']?)[^>]*>', "", cleaned)
    # Replace breaks and paragraphs with newlines
    cleaned = re.sub(r"(?i)<(?:br|p|div|tr)[^>]*>", "\n", cleaned)
    # Strip remaining HTML tags
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    # Unescape entities (&amp;, &nbsp;, etc.)
    cleaned = html.unescape(cleaned)
    # Clean excessive whitespace
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in cleaned.splitlines()]
    text = "\n".join(line for line in lines if line)
    return text[:MAX_BODY_CHARS]


class GmailClient:
    """
    Client for interacting with Google Gmail API.
    Designed to be easily mocked in unit tests without touching Google's real servers.
    """

    def __init__(self, refresh_token: Optional[str] = None, access_token: Optional[str] = None):
        self.refresh_token = refresh_token
        self.access_token = access_token

    @classmethod
    def from_connection(cls, connection) -> "GmailClient":
        """Instantiate client from a GmailConnection instance by decrypting refresh token."""
        plain_refresh_token = decrypt_token(connection.encrypted_refresh_token)
        return cls(refresh_token=plain_refresh_token)

    def _get_headers(self) -> Dict[str, str]:
        token = self.get_valid_access_token()
        return {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def get_valid_access_token(self) -> str:
        """Return cached access token or refresh it from Google."""
        if os.environ.get("GMAIL_MOCK_MODE") == "1":
            self.access_token = "mock_access_token"
            return self.access_token

        if self.access_token:
            return self.access_token
        if not self.refresh_token:
            raise ValueError("Không có refresh_token để làm mới access_token.")

        creds = get_oauth_credentials()
        client_id = creds["client_id"]
        client_secret = creds["client_secret"]
        if not client_id or not client_secret:
            raise RuntimeError("Thiếu cấu hình GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET.")

        response = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": self.refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=10,
        )
        if not response.ok:
            raise RuntimeError(f"Lỗi làm mới access token từ Google ({response.status_code}): {response.text}")

        payload = response.json()
        self.access_token = payload.get("access_token")
        return self.access_token

    @staticmethod
    def exchange_code_for_tokens(code: str, redirect_uri: str) -> Dict[str, Any]:
        """Exchange authorization code for access and refresh tokens."""
        if os.environ.get("GMAIL_MOCK_MODE") == "1":
            return {"access_token": "mock_access_token_123", "refresh_token": "mock_refresh_token_123", "expires_in": 3600}

        creds = get_oauth_credentials()
        client_id = creds["client_id"]
        client_secret = creds["client_secret"]
        if not client_id or not client_secret:
            raise RuntimeError("Thiếu cấu hình GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET.")

        response = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
        if not response.ok:
            raise RuntimeError(f"Lỗi đổi mã xác thực Google ({response.status_code}): {response.text}")
        return response.json()

    def revoke_token(self) -> bool:
        """Revoke current refresh or access token at Google."""
        if os.environ.get("GMAIL_MOCK_MODE") == "1":
            return True

        token_to_revoke = self.refresh_token or self.access_token
        if not token_to_revoke:
            return True
        try:
            resp = requests.post(
                GOOGLE_REVOKE_URL,
                params={"token": token_to_revoke},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=10,
            )
            return resp.ok
        except Exception as exc:
            logger.warning("Lỗi thu hồi token Google: %s", exc)
            return False

    def get_profile(self) -> Dict[str, Any]:
        """Fetch user profile to get email address and history ID."""
        if os.environ.get("GMAIL_MOCK_MODE") == "1":
            return {"emailAddress": "tien@fermat.vn", "messagesTotal": 42, "threadsTotal": 18, "historyId": "100001"}
        url = f"{GMAIL_API_BASE}/profile"
        resp = requests.get(url, headers=self._get_headers(), timeout=10)
        if not resp.ok:
            raise RuntimeError(f"Lỗi lấy thông tin Gmail profile: {resp.status_code}")
        return resp.json()

    def list_messages(
        self,
        query: str = "in:inbox",
        max_results: int = 20,
        page_token: Optional[str] = None,
    ) -> Dict[str, Any]:
        """List messages in user's mailbox matching query."""
        url = f"{GMAIL_API_BASE}/messages"
        params: Dict[str, Any] = {
            "q": query,
            "maxResults": min(max_results, 50),
        }
        if page_token:
            params["pageToken"] = page_token

        resp = requests.get(url, headers=self._get_headers(), params=params, timeout=15)
        if not resp.ok:
            raise RuntimeError(f"Lỗi lấy danh sách thư từ Gmail ({resp.status_code}): {resp.text}")
        return resp.json()

    def get_message(self, message_id: str, format_type: str = "full") -> Dict[str, Any]:
        """
        Fetch single message and extract metadata + safely cleaned body text.
        Returns parsed dictionary with sender, subject, date, body, headers.
        """
        url = f"{GMAIL_API_BASE}/messages/{message_id}"
        resp = requests.get(
            url,
            headers=self._get_headers(),
            params={"format": format_type},
            timeout=15,
        )
        if not resp.ok:
            raise RuntimeError(f"Lỗi đọc thư #{message_id} ({resp.status_code}): {resp.text}")

        raw_data = resp.json()
        payload = raw_data.get("payload", {})
        headers_list = payload.get("headers", [])
        headers = {h.get("name", "").casefold(): h.get("value", "") for h in headers_list}

        # Extract body text from payload parts
        extracted_body = self._extract_body_text(payload)
        cleaned_body = clean_html_to_text(extracted_body)

        sender_raw = headers.get("from", "")
        to_raw = headers.get("to", "")
        cc_raw = headers.get("cc", "")
        subject_raw = headers.get("subject", "(Không có tiêu đề)")
        date_raw = headers.get("date", "")

        # Parse sender name and email
        sender_name, sender_email = self._parse_sender(sender_raw)

        return {
            "id": raw_data.get("id", message_id),
            "threadId": raw_data.get("threadId", ""),
            "snippet": raw_data.get("snippet", ""),
            "labelIds": raw_data.get("labelIds", []),
            "internalDate": raw_data.get("internalDate", ""),
            "headers": headers,
            "from_name": sender_name,
            "from_email": sender_email,
            "to": to_raw,
            "cc": cc_raw,
            "subject": subject_raw,
            "date": date_raw,
            "body": cleaned_body,
        }

    def get_thread(self, thread_id: str) -> Dict[str, Any]:
        """Fetch complete thread."""
        url = f"{GMAIL_API_BASE}/threads/{thread_id}"
        resp = requests.get(url, headers=self._get_headers(), timeout=15)
        if not resp.ok:
            raise RuntimeError(f"Lỗi đọc thread #{thread_id} ({resp.status_code})")
        return resp.json()

    def create_draft(
        self,
        thread_id: str,
        to_email: str,
        subject: str,
        body_text: str,
        in_reply_to: Optional[str] = None,
        references: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Create a draft in Gmail thread.
        NOTE: This ONLY creates a draft; it DOES NOT send the email.
        """
        if os.environ.get("GMAIL_MOCK_MODE") == "1":
            return {
                "id": f"r-mock-draft-{thread_id}",
                "message": {
                    "id": f"msg-mock-{thread_id}",
                    "threadId": thread_id,
                },
            }

        msg = MIMEText(body_text, "plain", "utf-8")
        msg["To"] = to_email
        msg["Subject"] = subject if subject.lower().startswith("re:") else f"Re: {subject}"
        if in_reply_to:
            msg["In-Reply-To"] = in_reply_to
        if references:
            msg["References"] = references

        raw_b64 = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")

        url = f"{GMAIL_API_BASE}/drafts"
        post_data = {
            "message": {
                "threadId": thread_id,
                "raw": raw_b64,
            }
        }
        resp = requests.post(url, headers=self._get_headers(), json=post_data, timeout=15)
        if not resp.ok:
            raise RuntimeError(f"Lỗi tạo bản nháp trong Gmail ({resp.status_code}): {resp.text}")
        return resp.json()

    def _extract_body_text(self, payload: Dict[str, Any]) -> str:
        """Recursively extract plain text or HTML body from Gmail message payload."""
        mime_type = payload.get("mimeType", "")
        body_data = payload.get("body", {}).get("data")

        if mime_type == "text/plain" and body_data:
            try:
                return base64.urlsafe_b64decode(body_data).decode("utf-8", errors="replace")
            except Exception:
                pass

        if mime_type == "text/html" and body_data:
            try:
                return base64.urlsafe_b64decode(body_data).decode("utf-8", errors="replace")
            except Exception:
                pass

        parts = payload.get("parts", [])
        html_fallback = ""
        for part in parts:
            part_mime = part.get("mimeType", "")
            part_body = part.get("body", {}).get("data")
            if part_mime == "text/plain" and part_body:
                try:
                    return base64.urlsafe_b64decode(part_body).decode("utf-8", errors="replace")
                except Exception:
                    pass
            elif part_mime == "text/html" and part_body and not html_fallback:
                try:
                    html_fallback = base64.urlsafe_b64decode(part_body).decode("utf-8", errors="replace")
                except Exception:
                    pass
            elif part.get("parts"):
                sub_res = self._extract_body_text(part)
                if sub_res:
                    return sub_res

        return html_fallback

    @staticmethod
    def _parse_sender(raw_sender: str) -> Tuple[str, str]:
        """Parse sender raw string like 'Nguyen Van A <a@fermat.vn>' into (name, email)."""
        if not raw_sender:
            return "", ""
        match = re.search(r"^(.*?)\s*<([^>]+)>$", raw_sender.strip())
        if match:
            name = match.group(1).strip().strip('"\'')
            email_addr = match.group(2).strip().lower()
            return name or email_addr, email_addr
        email_match = re.search(r"[\w\.-]+@[\w\.-]+", raw_sender)
        email_addr = email_match.group(0).lower() if email_match else raw_sender.strip()
        return raw_sender.strip(), email_addr
