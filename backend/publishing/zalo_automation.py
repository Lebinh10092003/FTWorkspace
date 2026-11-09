import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
from django.conf import settings

logger = logging.getLogger(__name__)

class ZaloAutomationError(Exception):
    pass

def get_zalo_session_dir() -> Path:
    configured = getattr(settings, 'ZALO_SESSION_DIR', None)
    if configured:
        p = Path(configured)
    else:
        p = Path(settings.BASE_DIR) / 'storage' / 'zalo_sessions' / 'default'
    p.mkdir(parents=True, exist_ok=True)
    return p

def is_playwright_available() -> bool:
    try:
        import playwright
        return True
    except ImportError:
        return False

def get_zalo_session_status() -> Dict[str, Any]:
    session_dir = get_zalo_session_dir()
    state_file = session_dir / 'storage_state.json'
    cookies_file = session_dir / 'cookies.json'
    is_authenticated = state_file.exists() or cookies_file.exists()
    has_browser = is_playwright_available()

    if not has_browser:
        status = 'missing_browser'
        msg = 'Trình duyệt Chromium/Playwright chưa được cài đặt trên VPS.'
    elif not is_authenticated:
        status = 'unauthenticated'
        msg = 'Chưa đăng nhập tài khoản Zalo cá nhân. Cần quét mã QR.'
    else:
        status = 'ready'
        msg = 'Phiên Zalo cá nhân đã sẵn sàng tự động hóa.'

    return {
        'is_authenticated': is_authenticated,
        'browser_available': has_browser,
        'session_dir': str(session_dir),
        'status': status,
        'message': msg,
    }

def generate_zalo_qr_login(force_refresh: bool = False) -> Dict[str, Any]:
    if not is_playwright_available():
        return {
            'status': 'missing_browser',
            'qr_data': None,
            'message': 'Playwright chưa được cài đặt trên VPS. Cần cài đặt để sinh mã QR.',
        }

    session_dir = get_zalo_session_dir()
    try:
        from playwright.sync_api import sync_playwright
        import base64

        with sync_playwright() as p:
            browser = p.chromium.launch_persistent_context(
                user_data_dir=str(session_dir),
                headless=True,
                args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            )
            page = browser.new_page()
            page.goto('https://chat.zalo.me/', timeout=30000)
            page.wait_for_timeout(3000)

            # Check if already logged in
            if 'chat.zalo.me' in page.url and ('nav__tabs' in page.content() or 'chat-list' in page.content()):
                browser.close()
                return {
                    'status': 'already_authenticated',
                    'qr_data': None,
                    'message': 'Tài khoản Zalo đã đăng nhập sẵn trong phiên này.',
                }

            qr_elem = page.query_selector('.qrcode-img, .qr-container, div[data-translate-inner="STR_LOGIN_VIA_QR"]')
            if qr_elem:
                screenshot_bytes = qr_elem.screenshot()
            else:
                screenshot_bytes = page.screenshot()

            browser.close()
            b64_img = 'data:image/png;base64,' + base64.b64encode(screenshot_bytes).decode('utf-8')
            return {
                'status': 'qr_ready',
                'qr_data': b64_img,
                'message': 'Quét mã QR bằng app Zalo điện thoại để liên kết phiên đăng nhập.',
            }
    except Exception as exc:
        logger.exception('Lỗi khi sinh QR Zalo Web: %s', exc)
        return {
            'status': 'error',
            'qr_data': None,
            'message': f'Lỗi khởi động trình duyệt Zalo: {exc}',
        }

def send_zalo_personal_group_message(
    group_name: str,
    content: str,
    image_urls: Optional[List[str]] = None,
) -> Dict[str, Any]:
    if not is_playwright_available():
        raise ZaloAutomationError('VPS chưa cài đặt Playwright/Chromium để chạy Zalo tự động.')

    session_dir = get_zalo_session_dir()
    status = get_zalo_session_status()
    if not status['is_authenticated']:
        raise ZaloAutomationError('Chưa đăng nhập tài khoản Zalo trên VPS. Vui lòng quét mã QR trước.')

    try:
        from playwright.sync_api import sync_playwright
        import time

        with sync_playwright() as p:
            browser = p.chromium.launch_persistent_context(
                user_data_dir=str(session_dir),
                headless=True,
                args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            )
            page = browser.new_page()
            page.goto('https://chat.zalo.me/', timeout=45000)
            page.wait_for_timeout(4000)

            # Find search box and search for group
            search_input = page.query_selector('input#contact-search-input, input[placeholder*="Tìm kiếm"]')
            if not search_input:
                browser.close()
                raise ZaloAutomationError('Không tìm thấy ô tìm kiếm liên hệ trên Zalo Web.')

            search_input.click()
            search_input.fill(group_name)
            page.wait_for_timeout(2000)

            # Click matching conv item
            conv_item = page.query_selector(f'div[title*="{group_name}"], .conv-item:has-text("{group_name}")')
            if not conv_item:
                browser.close()
                raise ZaloAutomationError(f'Không tìm thấy nhóm Zalo với tên "{group_name}" trong danh bạ.')

            conv_item.click()
            page.wait_for_timeout(2000)

            # Type message into chat box with human-like delay
            chat_input = page.query_selector('div#chat-input-content, div[contenteditable="true"]')
            if not chat_input:
                browser.close()
                raise ZaloAutomationError('Không tìm thấy ô nhập nội dung tin nhắn nhóm.')

            chat_input.click()
            # Split into chunks or write content
            for line in content.split('\n'):
                chat_input.type(line, delay=30)
                page.keyboard.press('Shift+Enter')
                page.wait_for_timeout(100)

            time.sleep(1)
            page.keyboard.press('Enter')
            page.wait_for_timeout(3000)

            browser.close()
            return {
                'status': 'published',
                'group_name': group_name,
                'message': f'Đã tự động gửi bài viết thành công vào nhóm Zalo "{group_name}".',
            }
    except ZaloAutomationError:
        raise
    except Exception as exc:
        logger.exception('Lỗi tự động gửi bài Zalo: %s', exc)
        raise ZaloAutomationError(f'Lỗi khi thao tác trên Zalo Web: {exc}') from exc
