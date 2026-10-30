const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/home/orcauser/.cache/ms-playwright';
}

let playwright;
try {
  playwright = require('playwright');
} catch {
  try {
    playwright = require('/home/orcauser/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
  } catch {
    playwright = require('/home/orcauser/mq-tools/shot/node_modules/playwright');
  }
}
const { chromium } = playwright;

const DJANGO_PORT = 58085;
const WEB_PORT = 58745;
const DIST_DIR = path.resolve(__dirname, '../dist');
const SCREEN_DIRS = [
  path.resolve(__dirname, '../docs/tasks/019-screens'),
  path.resolve('/home/orcauser/orca/workspaces/ft-workspace/agy5/docs/tasks/019-screens'),
];

SCREEN_DIRS.forEach(d => {
  try {
    fs.mkdirSync(d, { recursive: true });
  } catch {}
});

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function startWebServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/api/')) {
        const proxyReq = http.request(
          {
            hostname: '127.0.0.1',
            port: DJANGO_PORT,
            path: req.url,
            method: req.method,
            headers: req.headers,
          },
          proxyRes => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res, { end: true });
          }
        );
        proxyReq.on('error', err => {
          console.error('[Proxy Error]', err.message);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Proxy to Django failed' }));
        });
        req.pipe(proxyReq, { end: true });
        return;
      }

      let reqPath = req.url.split('?')[0];
      if (reqPath === '/' || !path.extname(reqPath)) {
        reqPath = '/index.html';
      }
      const filePath = path.join(DIST_DIR, reqPath);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      } else {
        const fallback = path.join(DIST_DIR, 'index.html');
        if (fs.existsSync(fallback)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          fs.createReadStream(fallback).pipe(res);
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      }
    });

    server.listen(WEB_PORT, '127.0.0.1', () => {
      console.log(`[Web Server] Running on http://127.0.0.1:${WEB_PORT}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

async function saveScreenshots(page, baseName) {
  for (const dir of SCREEN_DIRS) {
    const outPath = path.join(dir, `${baseName}.png`);
    await page.screenshot({ path: outPath, fullPage: true });
    console.log(`[Screenshot Saved] -> ${outPath}`);
  }
}

async function main() {
  console.log('=== BẮT ĐẦU E2E BACKEND THẬT: VIỆC 019 PHÂN LOẠI GMAIL & LỊCH CÔNG TÁC ===');

  const MOCK_AGY_CODE = `import sys
import json

raw_input = sys.stdin.read()
result = {
    "suggested_subject": "Re: Báo cáo công việc tuần này",
    "reply_body": """Dạ em chào anh/chị,

Em xin phép báo cáo tiến độ công việc tuần này. Danh sách các đầu việc và tài liệu chuẩn bị đã được hoàn thiện đúng hạn.
Nếu anh/chị cần bổ sung thêm thông tin nào, em xin sẵn sàng thực hiện ngay ạ.

Kính thư,
Nguyễn Văn Tiến""",
    "summary": "Nội dung tóm tắt công việc gửi ban giám đốc.",
    "actions": [
      {
        "type": "gui_file_bao_cao",
        "title": "Gửi file báo cáo tuần",
        "deadline": "Trước 17h thứ Tư",
        "required_preparations": ["File tổng hợp số liệu", "Bản scan chữ ký"],
        "priority": "high"
      }
    ],
    "priority": "high",
    "needs_reply": True,
    "reply_by": "17:00 hôm nay"
}
print(json.dumps(result, ensure_ascii=False))
`;

  fs.writeFileSync('/tmp/mock_agy_019.py', MOCK_AGY_CODE, 'utf8');

  const venvPython = path.resolve(__dirname, '../.venv/bin/python');
  const managePy = path.resolve(__dirname, '../backend/manage.py');

  const testDb = '/tmp/ft_019_test.sqlite3';
  if (fs.existsSync(testDb)) {
    try { fs.unlinkSync(testDb); } catch {}
  }
  console.log('[Setup] Dùng database kiểm thử mới tại ' + testDb);

  const FERNET_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

  const djangoEnv = {
    ...process.env,
    DJANGO_DB_PATH: testDb,
    GMAIL_MOCK_MODE: '1',
    GMAIL_OAUTH_CLIENT_ID: 'test-e2e-client-id.apps.googleusercontent.com',
    GMAIL_OAUTH_CLIENT_SECRET: 'test-e2e-client-secret',
    GMAIL_OAUTH_REDIRECT_URI: `http://127.0.0.1:${WEB_PORT}/communication-tools/gmail`,
    GMAIL_TOKEN_KEY: FERNET_KEY,
    AI_AGY_COMMAND: `${venvPython} /tmp/mock_agy_019.py`,
    PYTHONUNBUFFERED: '1',
  };

  const seedScript = `
import sys
import os
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../backend'))
if not os.path.isdir(backend_dir):
    backend_dir = '/home/orcauser/orca/workspaces/ft-workspace/agy/FTWorkspace/backend'
sys.path.insert(0, backend_dir)

import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token
from authentication.models import UserProfile
from gmail_assistant.models import GmailConnection, MailDigest
from gmail_assistant.security import encrypt_token
from datetime import date, datetime, timezone

u, _ = User.objects.get_or_create(username='tien@fermat.vn', email='tien@fermat.vn', defaults={'is_superuser': True})
u.is_superuser = True
u.save()
Token.objects.update_or_create(user=u, defaults={'key': 'e2e-token-agy5-019-secret'})
p, _ = UserProfile.objects.get_or_create(email='tien@fermat.vn', defaults={'name': 'Nguyễn Văn Tiến', 'role': 'ADMIN', 'employment_status': 'ACTIVE'})
p.name = 'Nguyễn Văn Tiến'
p.role = 'ADMIN'
p.employment_status = 'ACTIVE'
p.save()

# Thiết lập sẵn GmailConnection với cấp trên mẫu
conn, _ = GmailConnection.objects.update_or_create(
    user=p,
    defaults={
        'email': 'tien@fermat.vn',
        'encrypted_refresh_token': encrypt_token('mock_refresh_token_019'),
        'scopes': 'https://www.googleapis.com/auth/gmail.readonly',
        'ai_enabled': True,
        'notify_new': True,
        'morning_scan_enabled': True,
        'morning_time': '08:00',
        'superior_contacts': ['giamdoc@fermat.vn', 'sep.tong@fermat.vn'],
    }
)

# Seed 3 digests mẫu: 1 To, 1 CC, 1 CC có gọi tên
MailDigest.objects.filter(user=p).delete()

# 1. Thư gửi trực tiếp (To)
MailDigest.objects.create(
    user=p,
    message_id='msg-019-to-direct',
    thread_id='thread-019-to-direct',
    sender='Đối tác STEM Hà Nội <stem@hanoi.edu.vn>',
    sender_email='stem@hanoi.edu.vn',
    subject='Yêu cầu chốt lịch tập huấn và gửi danh mục thiết bị',
    received_at=datetime.now(timezone.utc),
    recipient_role=MailDigest.RECIPIENT_ROLE_TO,
    addressed_by_name=False,
    match_reason='Gửi trực tiếp (To)',
    priority='high',
    needs_reply=True,
    reply_by='Trước 17h ngày 30/10',
    summary='Nhà trường đề nghị công ty cử 3 giảng viên và gửi kèm danh mục thiết bị thực hành cho 150 học sinh.',
    actions=[
      {
        'type': 'phan_hoi_xac_nhan',
        'title': 'Xác nhận lịch tập huấn STEM tại THCS Cầu Giấy',
        'deadline': 'Trước 17h ngày 30/10',
        'required_preparations': ['Danh sách 3 giảng viên', 'File giáo trình bản mềm'],
        'priority': 'high',
        'completed': False
      },
      {
        'type': 'gui_file_bao_cao',
        'title': 'Gửi danh mục thiết bị thực hành STEM',
        'deadline': 'Sáng mai',
        'required_preparations': ['Bảng kê thiết bị phòng lab'],
        'priority': 'normal',
        'completed': False
      }
    ],
    status='new'
)

# 2. Thư chỉ CC (không ở To, không gọi tên) => chỉ để biết
MailDigest.objects.create(
    user=p,
    message_id='msg-019-cc-only',
    thread_id='thread-019-cc-only',
    sender='Phòng Nhân sự <hr@fermat.vn>',
    sender_email='hr@fermat.vn',
    subject='Thông báo kế hoạch nghỉ lễ và giao lưu nội bộ toàn công ty',
    received_at=datetime.now(timezone.utc),
    recipient_role=MailDigest.RECIPIENT_ROLE_CC,
    addressed_by_name=False,
    match_reason='Chỉ nhận bản sao (CC)',
    priority='normal',
    needs_reply=False,
    summary='Phòng Nhân sự thông báo lịch nghỉ và địa điểm liên hoan nội bộ cuối tuần.',
    actions=[],
    status='new'
)

# 3. Thư CC nhưng có gọi tên người dùng trong thư
MailDigest.objects.create(
    user=p,
    message_id='msg-019-cc-addressed',
    thread_id='thread-019-cc-addressed',
    sender='Giám Đốc Điều Hành <giamdoc@fermat.vn>',
    sender_email='giamdoc@fermat.vn',
    subject='Giao việc điều chỉnh giáo trình STEM Khối 7',
    received_at=datetime.now(timezone.utc),
    recipient_role=MailDigest.RECIPIENT_ROLE_CC,
    addressed_by_name=True,
    match_reason='Gọi tên trong thư (Tiến ơi)',
    priority='high',
    needs_reply=True,
    reply_by='Trước 12h ngày mai',
    summary='Giám đốc giao việc: Nhờ Tiến rà soát lại phần thí nghiệm Vật lý khối 7 trước khi bàn giao.',
    actions=[
      {
        'type': 'sua_tai_lieu',
        'title': 'Rà soát bài thí nghiệm Vật lý khối 7',
        'deadline': 'Trước 12h ngày mai',
        'required_preparations': ['File Word giáo trình bài 4 và 5'],
        'priority': 'high',
        'completed': False
      }
    ],
    status='new'
)

print('[Seed] Đã tạo thành công dữ liệu mẫu 019.')
`;

  fs.writeFileSync('/tmp/seed_019.py', seedScript, 'utf8');

  console.log('[Django] Chạy migrate trên testDb...');
  execSync(`${venvPython} ${managePy} migrate --noinput`, {
    env: djangoEnv,
    stdio: 'inherit',
  });

  console.log('[Django] Chạy seed script...');
  execSync(`${venvPython} /tmp/seed_019.py`, {
    env: djangoEnv,
    stdio: 'inherit',
  });

  console.log('[Django] Khởi động server Django trên cổng ' + DJANGO_PORT + '...');
  const djangoProcess = spawn(venvPython, [managePy, 'runserver', `127.0.0.1:${DJANGO_PORT}`, '--noreload'], {
    env: djangoEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  djangoProcess.stdout.on('data', data => {
    console.log(`[Django] ${data.toString().trim()}`);
  });
  djangoProcess.stderr.on('data', data => {
    console.error(`[Django Error] ${data.toString().trim()}`);
  });

  // Chờ Django sẵn sàng
  for (let i = 0; i < 30; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${DJANGO_PORT}/api/`, res => {
          resolve();
        });
        req.on('error', reject);
      });
      console.log('[Django] Server đã sẵn sàng nhận request!');
      break;
    } catch {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  const webServer = await startWebServer();

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    page.on('console', msg => console.log(`[Browser Console] ${msg.text()}`));
    page.on('pageerror', err => console.error(`[Browser PageError] ${err.message}`));

    // 1. Desktop View (1440px)
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.addInitScript(() => {
      const mockUser = {
        uid: 'uid-test-agy5-019',
        email: 'tien@fermat.vn',
        displayName: 'Nguyễn Văn Tiến',
        photoURL: null,
        role: 'ADMIN',
        accessModules: ['communication-tools', 'gmail-assistant'],
      };
      localStorage.setItem('ft_token', 'e2e-token-agy5-019-secret');
      localStorage.setItem('ft_user_email', 'tien@fermat.vn');
      localStorage.setItem('ft_user_name', 'Nguyễn Văn Tiến');
      localStorage.setItem('ft_user_role', 'ADMIN');
      localStorage.setItem(
        'ft_auth_session',
        JSON.stringify({ token: 'e2e-token-agy5-019-secret', user: mockUser, role: 'ADMIN' })
      );
    });

    await page.goto(`http://127.0.0.1:${WEB_PORT}/communication-tools/gmail`);
    await page.waitForTimeout(2000);

    // Chụp màn hình 1: Danh sách thư hiển thị Tabs, Badges To/CC, việc cần làm + file cần chuẩn bị
    await saveScreenshots(page, '019-desktop-01-mail-list');

    // Chuyển tab "Cần phản hồi"
    const tabNeedsReply = page.locator('button:has-text("Cần phản hồi")');
    if (await tabNeedsReply.isVisible()) {
      await tabNeedsReply.click();
      await page.waitForTimeout(800);
      await saveScreenshots(page, '019-desktop-02-tab-needs-reply');
    }

    // Chuyển tab "Chỉ để biết (CC)"
    const tabCC = page.locator('button:has-text("Chỉ để biết (CC)")');
    if (await tabCC.isVisible()) {
      await tabCC.click();
      await page.waitForTimeout(800);
      await saveScreenshots(page, '019-desktop-03-tab-cc');
    }

    // Quay lại tab Tất cả
    const tabAll = page.locator('button:has-text("Tất cả")').first();
    if (await tabAll.isVisible()) {
      await tabAll.click();
      await page.waitForTimeout(800);
    }

    // Mở Modal Cài đặt Hộp thư AI (Cấp trên / người cần xưng em)
    const btnSettings = page.locator('button[title*="Cài đặt"], button:has-text("Cài đặt")').first();
    if (await btnSettings.isVisible()) {
      await btnSettings.click();
      await page.waitForTimeout(800);
      await saveScreenshots(page, '019-desktop-04-settings-superior-modal');

      // Đóng modal cài đặt
      await page.locator('button:has-text("Hủy"), button:has-text("Đóng")').first().click();
      await page.waitForTimeout(500);
    }

    // Mở Modal Soạn phản hồi với AI (Thư gửi trực tiếp hoặc thư từ sếp)
    const btnReply = page.locator('button:has-text("Soạn phản hồi")').first();
    if (await btnReply.isVisible()) {
      await btnReply.click();
      await page.waitForTimeout(800);
      await saveScreenshots(page, '019-desktop-05-ai-reply-modal');

      // Đóng modal reply
      await page.locator('button:has-text("Đóng")').first().click();
      await page.waitForTimeout(500);
    }

    // Mở Modal "Thêm vào lịch công tác" (Part F)
    const btnAddToSchedule = page.locator('button:has-text("Vào lịch")').first();
    if (await btnAddToSchedule.isVisible()) {
      await btnAddToSchedule.click();
      await page.waitForTimeout(800);
      await saveScreenshots(page, '019-desktop-06-add-to-schedule-modal');

      // Bấm "Xác nhận tạo việc"
      const btnConfirmCreate = page.locator('button:has-text("Xác nhận tạo việc")');
      if (await btnConfirmCreate.isVisible()) {
        await btnConfirmCreate.click();
        await page.waitForTimeout(1500);
        await saveScreenshots(page, '019-desktop-07-after-scheduled-card');
      }
    }

    // 2. Mobile View (390px)
    console.log('[Mobile] Chụp màn hình mobile 390px...');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForTimeout(1500);
    await saveScreenshots(page, '019-mobile-01-mail-list');

    // Mở modal thêm vào lịch trên mobile
    const btnMobileSchedule = page.locator('button:has-text("Vào lịch")').first();
    if (await btnMobileSchedule.isVisible()) {
      await btnMobileSchedule.click();
      await page.waitForTimeout(800);
      await saveScreenshots(page, '019-mobile-02-add-to-schedule-modal');
      const btnCancelMobile = page.locator('button:has-text("Hủy")').first();
      if (await btnCancelMobile.isVisible()) {
        await btnCancelMobile.click();
      }
      await page.waitForTimeout(500);
    }

    console.log('=== HOÀN TẤT E2E TEST VÀ CHỤP ẢNH MÀN HÌNH THÀNH CÔNG ===');
  } catch (err) {
    console.error('[E2E Error]', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    webServer.close();
    djangoProcess.kill('SIGTERM');
  }
}

main();
