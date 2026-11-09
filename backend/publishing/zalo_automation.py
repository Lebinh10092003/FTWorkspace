import os
import json
import logging
import threading
import time
import re
import urllib.request
import urllib.parse
import urllib.error
import http.cookiejar
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
        active_file = session_dir / 'active_qr_session.json'
        stop_event: threading.Event = session_info['stop_event']
        qr_event: threading.Event = session_info['qr_event']

        if is_session_storage_authenticated(session_id):
            session_info['is_authenticated'] = True
            qr_event.set()
            return

        cj = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        user_agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
        base_headers = {
            'User-Agent': user_agent,
            'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.6,en;q=0.5',
            'sec-ch-ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'Origin': 'https://id.zalo.me',
            'Referer': 'https://id.zalo.me/account?continue=https%3A%2F%2Fzalo.me%2Fpc',
        }

        try:
            # Bước 1: Trích xuất version JS đăng nhập của Zalo
            req = urllib.request.Request('https://id.zalo.me/account?continue=https%3A%2F%2Fchat.zalo.me%2F', headers={'User-Agent': user_agent})
            with opener.open(req, timeout=15) as resp:
                html = resp.read().decode('utf-8')
            match = re.search(r'https://stc-zlogin\.zdn\.vn/main-([\d.]+)\.js', html)
            version = match.group(1) if match else '2606161423'

            # Bước 2: Gọi logininfo
            logininfo_data = urllib.parse.urlencode({'continue': 'https://zalo.me/pc', 'v': version}).encode('utf-8')
            req_info = urllib.request.Request('https://id.zalo.me/account/logininfo', data=logininfo_data, headers=base_headers)
            with opener.open(req_info, timeout=15) as resp:
                pass

            # Bước 3: Tạo mã QR đăng nhập qua Zalo Web API trực tiếp (không dùng headless browser)
            gen_data = urllib.parse.urlencode({'continue': 'https://zalo.me/pc', 'v': version}).encode('utf-8')
            req_gen = urllib.request.Request('https://id.zalo.me/account/authen/qr/generate', data=gen_data, headers=base_headers)
            with opener.open(req_gen, timeout=15) as resp:
                gen_res = json.loads(resp.read().decode('utf-8'))

            if gen_res.get('error_code') != 0 or not gen_res.get('data'):
                err_msg = gen_res.get('error_message') or 'Không thể khởi tạo mã QR từ Zalo'
                session_info['error'] = err_msg
                qr_event.set()
                return

            qr_info = gen_res['data']
            code = qr_info['code']
            qr_image = qr_info['image']

            session_info['qr_data'] = qr_image
            try:
                active_file.write_text(json.dumps({
                    'session_id': session_id,
                    'qr_data': qr_image,
                    'created_at': time.time(),
                    'is_authenticated': False,
                    'status': 'qr_ready',
                }), encoding='utf-8')
            except Exception:
                pass

            qr_event.set()

            # Bước 4: Vòng lặp polling chờ điện thoại quét và xác nhận (tối đa 120s)
            poll_headers = dict(base_headers)
            poll_headers['Referer'] = 'https://id.zalo.me/account?continue=https%3A%2F%2Fchat.zalo.me%2F'
            poll_deadline = time.time() + 120
            scanned = False

            while time.time() < poll_deadline and not stop_event.is_set():
                if not scanned:
                    try:
                        scan_payload = urllib.parse.urlencode({'code': code, 'continue': 'https://chat.zalo.me/', 'v': version}).encode('utf-8')
                        req_scan = urllib.request.Request('https://id.zalo.me/account/authen/qr/waiting-scan', data=scan_payload, headers=poll_headers)
                        with opener.open(req_scan, timeout=25) as resp:
                            scan_res = json.loads(resp.read().decode('utf-8'))
                            err_code = scan_res.get('error_code', -1)
                            if err_code == 0:
                                scanned = True
                            elif err_code == 8:
                                # Timeout chờ quét, tiếp tục chu kỳ
                                pass
                            else:
                                time.sleep(1)
                    except (urllib.error.URLError, TimeoutError, OSError):
                        time.sleep(1)

                if scanned:
                    try:
                        confirm_payload = urllib.parse.urlencode({
                            'code': code,
                            'gToken': '',
                            'gAction': 'CONFIRM_QR',
                            'continue': 'https://chat.zalo.me/',
                            'v': version,
                        }).encode('utf-8')
                        req_confirm = urllib.request.Request('https://id.zalo.me/account/authen/qr/waiting-confirm', data=confirm_payload, headers=poll_headers)
                        with opener.open(req_confirm, timeout=35) as resp:
                            confirm_res = json.loads(resp.read().decode('utf-8'))
                            if confirm_res.get('error_code') == 0:
                                # Người dùng bấm Đồng ý đăng nhập trên điện thoại thành công
                                check_req = urllib.request.Request('https://id.zalo.me/account/checksession?continue=https%3A%2F%2Fchat.zalo.me%2Findex.html', headers=poll_headers)
                                with opener.open(check_req, timeout=15) as check_resp:
                                    pass

                                # Trích xuất toàn bộ cookies xác thực sang định dạng storage_state của Playwright
                                cookies_list = []
                                for c in cj:
                                    c_domain = c.domain if c.domain.startswith('.') else f".{c.domain}"
                                    cookies_list.append({
                                        'name': c.name,
                                        'value': c.value,
                                        'domain': c_domain,
                                        'path': c.path,
                                        'expires': c.expires if c.expires else int(time.time() + 86400 * 30),
                                        'httpOnly': True if 'HttpOnly' in getattr(c, '_rest', {}) else False,
                                        'secure': bool(c.secure),
                                        'sameSite': 'Lax',
                                    })
                                storage_data = {'cookies': cookies_list, 'origins': []}
                                state_file.write_text(json.dumps(storage_data), encoding='utf-8')
                                session_info['is_authenticated'] = True

                                try:
                                    active_file.write_text(json.dumps({
                                        'session_id': session_id,
                                        'is_authenticated': True,
                                        'status': 'authenticated',
                                        'updated_at': time.time(),
                                    }), encoding='utf-8')
                                except Exception:
                                    pass

                                logger.info("Zalo direct API login successful for session %s", session_id)
                                break
                            elif confirm_res.get('error_code') == -13:
                                # Người dùng từ chối đăng nhập trên điện thoại
                                session_info['error'] = 'Người dùng đã từ chối đăng nhập trên điện thoại.'
                                break
                            else:
                                time.sleep(1)
                    except (urllib.error.URLError, TimeoutError, OSError):
                        time.sleep(1)

                time.sleep(0.5)

        except Exception as exc:
            logger.exception("Lỗi trong worker QR Zalo API: %s", exc)
            session_info['error'] = str(exc)
            qr_event.set()

_login_session_manager = ZaloLoginSessionManager()

def is_session_authenticated(session_id: str = 'default') -> bool:
    return _login_session_manager.is_session_authenticated(session_id)

def get_zalo_session_status(session_id: str = 'default') -> Dict[str, Any]:
    session_dir = get_zalo_session_dir(session_id)
    is_authenticated = is_session_authenticated(session_id)
    has_browser = is_playwright_available()

    if not is_authenticated:
        active_file = session_dir / 'active_qr_session.json'
        if active_file.exists():
            try:
                active_data = json.loads(active_file.read_text(encoding='utf-8'))
                if active_data.get('is_authenticated') and is_session_storage_authenticated(session_id):
                    is_authenticated = True
            except Exception:
                pass

    if is_authenticated:
        status = 'ready'
        msg = 'Phiên Zalo cá nhân đã sẵn sàng tự động hóa.'
    else:
        status = 'unauthenticated'
        msg = 'Chưa đăng nhập tài khoản Zalo cá nhân. Cần quét mã QR.'

    return {
        'is_authenticated': is_authenticated,
        'browser_available': has_browser,
        'session_dir': str(session_dir),
        'session_id': session_id,
        'status': status,
        'message': msg,
    }

def generate_zalo_qr_login(session_id: str = 'default', force_refresh: bool = False) -> Dict[str, Any]:
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
                args=[
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled',
                ],
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
                viewport={'width': 1280, 'height': 800},
                locale='vi-VN',
                timezone_id='Asia/Ho_Chi_Minh',
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
