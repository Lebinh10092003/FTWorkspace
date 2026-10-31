import logging
import re
import requests
from django.conf import settings

logger = logging.getLogger(__name__)

# Mock message storage in memory for tests & dev mode
MOCK_SENT_MESSAGES = []


def clean_zalo_text(text: str) -> str:
    """
    Chuẩn hóa văn bản cho Zalo Bot Platform:
    - Zalo không render markdown: gỡ bỏ dấu sao, backticks thừa nhưng giữ bố cục đẹp
    - Giới hạn tối đa 2000 ký tự
    """
    if not text:
        return ""
    # Chuyển đổi một số ký hiệu markdown phổ biến sang plain text đẹp
    cleaned = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
    cleaned = re.sub(r"\*(.*?)\*", r"\1", cleaned)
    cleaned = re.sub(r"`(.*?)`", r"\1", cleaned)
    cleaned = cleaned.strip()
    if len(cleaned) > 2000:
        cleaned = cleaned[:1990] + "... (còn tiếp)"
    return cleaned


class ZaloBotClient:
    """
    Client giao tiếp với Zalo Bot Platform API (tương tự Telegram Bot API).
    URL: {api_base}/bot{token}/{method}
    """

    def __init__(self, token=None, api_base=None, mock_mode=None):
        self.token = token or getattr(settings, "ZALO_BOT_TOKEN", "")
        self.api_base = (
            api_base
            or getattr(settings, "ZALO_BOT_API_BASE", "https://bot-api.zapps.me")
        ).rstrip("/")
        if mock_mode is not None:
            self.mock_mode = mock_mode
        else:
            self.mock_mode = getattr(settings, "ZALO_BOT_MOCK_MODE", False)

    def _url(self, method: str) -> str:
        return f"{self.api_base}/bot{self.token}/{method}"

    def send_message(self, chat_id: str, text: str) -> dict:
        """Gửi tin nhắn văn bản (≤ 2000 ký tự) tới chat_id."""
        clean_text = clean_zalo_text(text)
        chat_id_str = str(chat_id).strip()

        if self.mock_mode:
            entry = {
                "chat_id": chat_id_str,
                "text": clean_text,
                "raw_text": text,
            }
            MOCK_SENT_MESSAGES.append(entry)
            logger.info("ZaloBot [MOCK] Sent to %s: %s", chat_id_str, clean_text[:60])
            return {"ok": True, "result": {"message_id": len(MOCK_SENT_MESSAGES), "chat": {"id": chat_id_str}}}

        if not self.token:
            logger.warning("ZaloBot: Token is empty, message dropped.")
            return {"ok": False, "error": "No bot token configured"}

        url = self._url("sendMessage")
        payload = {
            "chat_id": chat_id_str,
            "text": clean_text,
        }
        try:
            response = requests.post(url, json=payload, timeout=8)
            data = response.json() if response.content else {}
            if not response.ok or not data.get("ok", False):
                logger.error("ZaloBot sendMessage error: HTTP %s, body: %s", response.status_code, response.text[:200])
                return {"ok": False, "status_code": response.status_code, "error": data.get("description", "Unknown error")}
            return data
        except Exception as e:
            logger.error("ZaloBot network error: %s", str(e))
            return {"ok": False, "error": str(e)}

    def set_webhook(self, url: str, secret_token: str = None) -> dict:
        """Đăng ký webhook nhận tin nhắn từ Zalo Bot Platform."""
        if self.mock_mode:
            return {"ok": True, "result": True, "description": "Webhook set (mock)"}

        if not self.token:
            return {"ok": False, "error": "No bot token configured"}

        req_url = self._url("setWebhook")
        payload = {"url": url}
        if secret_token:
            payload["secret_token"] = secret_token
        try:
            response = requests.post(req_url, json=payload, timeout=10)
            return response.json() if response.content else {"ok": response.ok}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_webhook_info(self) -> dict:
        """Kiểm tra trạng thái webhook hiện tại."""
        if self.mock_mode:
            return {"ok": True, "result": {"url": "https://mock.fermat.vn/webhook", "has_custom_certificate": False}}

        if not self.token:
            return {"ok": False, "error": "No bot token configured"}

        url = self._url("getWebhookInfo")
        try:
            response = requests.get(url, timeout=10)
            return response.json() if response.content else {"ok": response.ok}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def delete_webhook(self) -> dict:
        """Xóa cấu hình webhook."""
        if self.mock_mode:
            return {"ok": True, "result": True}

        if not self.token:
            return {"ok": False, "error": "No bot token configured"}

        url = self._url("deleteWebhook")
        try:
            response = requests.post(url, timeout=10)
            return response.json() if response.content else {"ok": response.ok}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_me(self) -> dict:
        """Lấy thông tin bot."""
        if self.mock_mode:
            return {"ok": True, "result": {"id": 123456789, "is_bot": True, "first_name": "Fermat Workspace Bot", "username": "fermat_bot"}}

        if not self.token:
            return {"ok": False, "error": "No bot token configured"}

        url = self._url("getMe")
        try:
            response = requests.get(url, timeout=10)
            return response.json() if response.content else {"ok": response.ok}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_updates(self, offset: int = None, limit: int = 100, timeout: int = 10) -> dict:
        """Lấy danh sách tin nhắn mới qua polling."""
        if self.mock_mode:
            return {"ok": True, "result": []}

        if not self.token:
            return {"ok": False, "error": "No bot token configured"}

        url = self._url("getUpdates")
        params = {"limit": limit, "timeout": timeout}
        if offset is not None:
            params["offset"] = offset
        try:
            response = requests.get(url, params=params, timeout=timeout + 5)
            return response.json() if response.content else {"ok": response.ok}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def send_chat_action(self, chat_id: str, action: str = "typing") -> dict:
        """Gửi trạng thái đang gõ phím."""
        if self.mock_mode or not self.token:
            return {"ok": True}
        url = self._url("sendChatAction")
        try:
            response = requests.post(url, json={"chat_id": str(chat_id), "action": action}, timeout=5)
            return response.json() if response.content else {"ok": response.ok}
        except Exception:
            return {"ok": False}


def get_mock_sent_messages(chat_id: str = None):
    """Lấy danh sách tin nhắn mock đã gửi."""
    if chat_id is None:
        return list(MOCK_SENT_MESSAGES)
    return [msg for msg in MOCK_SENT_MESSAGES if msg["chat_id"] == str(chat_id)]


def clear_mock_messages():
    """Xóa danh sách tin nhắn mock."""
    global MOCK_SENT_MESSAGES
    MOCK_SENT_MESSAGES.clear()
