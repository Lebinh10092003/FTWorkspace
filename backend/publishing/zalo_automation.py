import os
import json
import logging
import threading
import time
from pathlib import Path
from typing import Dict, Any, List, Optional
from django.conf import settings

logger = logging.getLogger(__name__)

class ZaloAutomationError(Exception):
    pass

def get_zalo_session_dir(session_id: str = 'default') -> Path:
    safe_id = ''.join(c for c in str(session_id) if c.isalnum() or c in ('-', '_')).strip() or 'default'
    configured = getattr(settings, 'ZALO_SESSION_DIR', None)
    if configured:
        p = Path(configured) / safe_id
    else:
        p = Path(settings.BASE_DIR) / 'storage' / 'zalo_sessions' / safe_id
    p.mkdir(parents=True, exist_ok=True)
    return p

def is_playwright_available() -> bool:
    try:
        import playwright
        return True
    except ImportError:
        return False

def is_session_storage_authenticated(session_id: str = 'default') -> bool:
    session_dir = get_zalo_session_dir(session_id)
    state_file = session_dir / 'storage_state.json'
    if not state_file.exists():
        return False
    try:
        data = json.loads(state_file.read_text(encoding='utf-8'))
        cookies = data.get('cookies', [])
        for c in cookies:
            name = c.get('name', '')
            if name in ('zpw_sek', 'zpsid'):
                return True
        # File tồn tại nhưng không có cookie xác thực hợp lệ (phiên giả hoặc hết hạn)
        try:
            state_file.unlink(missing_ok=True)
        except Exception:
            pass
        return False
    except Exception:
        return False

def _is_browser_authenticated(page: Any, browser: Any) -> bool:
    """Kiểm tra điều kiện đăng nhập thành công của Zalo Web:
    1. Selector giao diện sau đăng nhập: #main-tab, .nav__tabs, div[data-id="div_Tab_All"], .chat-list
    2. ĐỒNG THỜI selector mã QR (.qrcode-img, canvas.qrcode, .qr-container) không còn hiển thị.
    3. ĐỒNG THỜI trong cookies của browser context hoặc storage_state có cookie xác thực 'zpw_sek' hoặc 'zpsid'.
    """
    try:
        # 1. Selector giao diện sau đăng nhập hiển thị
        logged_in_selectors = ['#main-tab', '.nav__tabs', 'div[data-id="div_Tab_All"]', '.chat-list']
        has_logged_in_ui = False
        for sel in logged_in_selectors:
            try:
                el = page.query_selector(sel)
                if el and el.is_visible():
                    has_logged_in_ui = True
                    break
            except Exception:
                pass
        if not has_logged_in_ui:
            return False

        # 2. Selector mã QR không còn hiển thị
        qr_selectors = ['.qrcode-img', 'canvas.qrcode', '.qr-container']
        for sel in qr_selectors:
            try:
                el = page.query_selector(sel)
                if el and el.is_visible():
                    return False
            except Exception:
                pass

        # 3. Cookie xác thực 'zpw_sek' hoặc 'zpsid' trong browser context hoặc storage_state
        has_auth_cookie = False
        try:
            cookies = browser.cookies() if hasattr(browser, 'cookies') else []
            if any(c.get('name') in ('zpw_sek', 'zpsid') for c in cookies):
                has_auth_cookie = True
        except Exception:
            pass

        if not has_auth_cookie:
            try:
                if hasattr(page, 'context') and hasattr(page.context, 'cookies'):
                    ctx_cookies = page.context.cookies()
                    if any(c.get('name') in ('zpw_sek', 'zpsid') for c in ctx_cookies):
                        has_auth_cookie = True
            except Exception:
                pass

        if not has_auth_cookie:
            try:
                state = browser.storage_state() if hasattr(browser, 'storage_state') else {}
                state_cookies = state.get('cookies', []) if isinstance(state, dict) else []
                if any(c.get('name') in ('zpw_sek', 'zpsid') for c in state_cookies):
                    has_auth_cookie = True
            except Exception:
                pass

        return has_auth_cookie
    except Exception:
        return False

class ZaloLoginSessionManager:
    """Quản lý phiên đăng nhập QR Zalo Web qua Playwright headless.
    Giữ kết nối trình duyệt mở để nhận tín hiệu xác thực từ điện thoại quét QR.
    """
    def __init__(self):
        self._lock = threading.RLock()
        self._sessions: Dict[str, Dict[str, Any]] = {}

    def is_session_authenticated(self, session_id: str) -> bool:
        with self._lock:
            sess = self._sessions.get(session_id)
            if sess and sess.get('is_authenticated'):
                if is_session_storage_authenticated(session_id):
                    return True
                sess['is_authenticated'] = False
        return is_session_storage_authenticated(session_id)

    def get_or_start_qr_session(self, session_id: str, force_refresh: bool = False) -> Dict[str, Any]:
        with self._lock:
            existing = self._sessions.get(session_id)
            if existing and not force_refresh:
                if self.is_session_authenticated(session_id):
                    return {
                        'status': 'already_authenticated',
                        'qr_data': None,
                        'session_id': session_id,
                        'message': 'Tài khoản Zalo đã đăng nhập sẵn trong phiên này.',
                    }
                # Nếu QR còn mới (dưới 90 giây) và thread vẫn đang chạy chờ quét
                if existing.get('qr_data') and (time.time() - existing.get('created_at', 0) < 90) and existing.get('thread') and existing['thread'].is_alive():
                    return {
                        'status': 'qr_ready',
                        'qr_data': existing['qr_data'],
                        'session_id': session_id,
                        'message': 'Quét mã QR bằng app Zalo điện thoại để liên kết phiên đăng nhập.',
                    }
                if existing.get('stop_event'):
                    existing['stop_event'].set()

            if existing and existing.get('stop_event'):
                existing['stop_event'].set()

            if not force_refresh and self.is_session_authenticated(session_id):
                return {
                    'status': 'already_authenticated',
                    'qr_data': None,
                    'session_id': session_id,
                    'message': 'Tài khoản Zalo đã đăng nhập sẵn trong phiên này.',
                }

            session_info = self._start_new_session_locked(session_id)

        # Chờ thread nền lấy mã QR (tối đa 25s)
        qr_ready = session_info['qr_event'].wait(timeout=25)
        if not qr_ready:
            err = session_info.get('error') or 'Quá thời gian chờ tải mã QR từ Zalo Web. Vui lòng bấm Thử lại.'
            return {'status': 'error', 'qr_data': None, 'session_id': session_id, 'message': err}

        if self.is_session_authenticated(session_id):
            return {
                'status': 'already_authenticated',
                'qr_data': None,
                'session_id': session_id,
                'message': 'Tài khoản Zalo đã đăng nhập sẵn trong phiên này.',
            }

        if session_info.get('error'):
            return {
                'status': 'error',
                'qr_data': None,
                'session_id': session_id,
                'message': session_info['error'],
            }

        return {
            'status': 'qr_ready',
            'qr_data': session_info.get('qr_data'),
            'session_id': session_id,
            'message': 'Quét mã QR bằng app Zalo điện thoại để liên kết phiên đăng nhập.',
        }

    def _start_new_session_locked(self, session_id: str) -> Dict[str, Any]:
        stop_event = threading.Event()
        qr_event = threading.Event()
        session_info: Dict[str, Any] = {
            'stop_event': stop_event,
            'qr_event': qr_event,
            'qr_data': None,
            'is_authenticated': False,
            'error': None,
            'created_at': time.time(),
        }
        thread = threading.Thread(
            target=self._run_login_worker,
            args=(session_id, session_info),
            name=f'zalo-qr-{session_id}',
            daemon=True,
        )
        session_info['thread'] = thread
        self._sessions[session_id] = session_info
        thread.start()
        return session_info

    def _run_login_worker(self, session_id: str, session_info: Dict[str, Any]):
        session_dir = get_zalo_session_dir(session_id)
        state_file = session_dir / 'storage_state.json'
        stop_event: threading.Event = session_info['stop_event']
        qr_event: threading.Event = session_info['qr_event']

        browser = None
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

                # Kiểm tra nếu phiên đã có sẵn đăng nhập
                if _is_browser_authenticated(page, browser):
                    browser.storage_state(path=str(state_file))
                    session_info['is_authenticated'] = True
                    qr_event.set()
                    return

                # Tìm phần tử mã QR trên trang Zalo
                qr_elem = None
                selectors = ['.qrcode-img', 'canvas.qrcode', '.qr-container img', '.qr-container', 'div[data-translate-inner="STR_LOGIN_VIA_QR"]']
                for sel in selectors:
                    try:
                        elem = page.query_selector(sel)
                        if elem and elem.is_visible():
                            qr_elem = elem
                            break
                    except Exception:
                        pass

                try:
                    if qr_elem:
                        screenshot_bytes = qr_elem.screenshot()
                    else:
                        screenshot_bytes = page.screenshot()
                    session_info['qr_data'] = 'data:image/png;base64,' + base64.b64encode(screenshot_bytes).decode('utf-8')
                except Exception as exc:
                    session_info['error'] = f'Không thể chụp ảnh mã QR: {exc}'
                    qr_event.set()
                    return

                # Báo hiệu mã QR đã sẵn sàng để frontend hiển thị
                qr_event.set()

                # Duy trì trình duyệt mở tối đa 120 giây để chờ điện thoại quét và phê duyệt
                poll_deadline = time.time() + 120
                last_qr_refresh = time.time()
                while time.time() < poll_deadline and not stop_event.is_set():
                    try:
                        page.wait_for_timeout(2000)
                        if _is_browser_authenticated(page, browser):
                            browser.storage_state(path=str(state_file))
                            session_info['is_authenticated'] = True
                            logger.info("Zalo login successful for session %s", session_id)
                            break
                        # Cập nhật lại ảnh mã QR mỗi 15 giây nếu Zalo tự làm mới mã
                        if qr_elem and time.time() - last_qr_refresh > 15:
                            try:
                                if qr_elem.is_visible():
                                    screenshot_bytes = qr_elem.screenshot()
                                    session_info['qr_data'] = 'data:image/png;base64,' + base64.b64encode(screenshot_bytes).decode('utf-8')
                                    last_qr_refresh = time.time()
                            except Exception:
                                pass
                    except Exception:
                        break
        except Exception as exc:
            logger.exception("Lỗi trong worker quét QR Zalo: %s", exc)
            session_info['error'] = str(exc)
            qr_event.set()
        finally:
            if browser:
                try:
                    browser.close()
                except Exception:
                    pass

_login_session_manager = ZaloLoginSessionManager()

def is_session_authenticated(session_id: str = 'default') -> bool:
    return _login_session_manager.is_session_authenticated(session_id)

def get_zalo_session_status(session_id: str = 'default') -> Dict[str, Any]:
    session_dir = get_zalo_session_dir(session_id)
    is_authenticated = is_session_authenticated(session_id)
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
        'session_id': session_id,
        'status': status,
        'message': msg,
    }

def generate_zalo_qr_login(session_id: str = 'default', force_refresh: bool = False) -> Dict[str, Any]:
    if not is_playwright_available():
        return {
            'status': 'missing_browser',
            'qr_data': None,
            'message': 'Playwright chưa được cài đặt trên VPS. Cần cài đặt để sinh mã QR.',
        }
    return _login_session_manager.get_or_start_qr_session(session_id=session_id, force_refresh=force_refresh)

def send_zalo_personal_group_message(
    group_name: str,
    content: str,
    image_urls: Optional[List[str]] = None,
    session_id: str = 'default',
) -> Dict[str, Any]:
    if not is_playwright_available():
        raise ZaloAutomationError('VPS chưa cài đặt Playwright/Chromium để chạy Zalo tự động.')

    session_dir = get_zalo_session_dir(session_id)
    state_file = session_dir / 'storage_state.json'
    status = get_zalo_session_status(session_id)
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
            try:
                page = browser.new_page()
                page.goto('https://chat.zalo.me/', timeout=45000)
                page.wait_for_timeout(4000)

                search_input = page.query_selector('input#contact-search-input, input[placeholder*="Tìm kiếm"]')
                if not search_input:
                    raise ZaloAutomationError('Không tìm thấy ô tìm kiếm liên hệ trên Zalo Web.')

                safe_group = group_name.replace('"', '').replace("'", '')
                search_input.click()
                search_input.fill(safe_group)
                page.wait_for_timeout(2000)

                conv_item = page.query_selector(f'div[title*="{safe_group}"], .conv-item:has-text("{safe_group}")')
                if not conv_item:
                    raise ZaloAutomationError(f'Không tìm thấy nhóm Zalo với tên "{safe_group}" trong danh bạ.')

                conv_item.click()
                page.wait_for_timeout(2000)

                chat_input = page.query_selector('div#chat-input-content, div[contenteditable="true"]')
                if not chat_input:
                    raise ZaloAutomationError('Không tìm thấy ô nhập nội dung tin nhắn nhóm.')

                chat_input.click()
                lines = content.split('\n')
                for idx, line in enumerate(lines):
                    if line:
                        chat_input.type(line, delay=25)
                    if idx < len(lines) - 1:
                        page.keyboard.press('Shift+Enter')
                    page.wait_for_timeout(50)

                time.sleep(1)
                page.keyboard.press('Enter')
                page.wait_for_timeout(3000)

                browser.storage_state(path=str(state_file))
                return {
                    'status': 'published',
                    'group_name': safe_group,
                    'session_id': session_id,
                    'message': f'Đã tự động gửi bài viết thành công vào nhóm Zalo "{safe_group}".',
                }
            finally:
                try:
                    browser.close()
                except Exception:
                    pass
    except ZaloAutomationError:
        raise
    except Exception as exc:
        logger.exception('Lỗi tự động gửi bài Zalo: %s', exc)
        raise ZaloAutomationError(f'Lỗi khi thao tác trên Zalo Web: {exc}') from exc
