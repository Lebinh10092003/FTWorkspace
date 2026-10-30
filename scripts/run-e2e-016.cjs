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
  path.resolve('/home/orcauser/orca/workspaces/ft-workspace/agy5/docs/tasks/016-screens'),
  path.resolve(__dirname, '../docs/tasks/016-screens'),
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
  console.log('=== BẮT ĐẦU E2E BACKEND THẬT: HỘP THƯ GMAIL AI (VIỆC 016) ===');

const MOCK_AGY_CODE = `import sys
import json

raw_input = sys.stdin.read()
result = {
    "suggested_subject": "Re: Khẩn: Xác nhận lịch tập huấn STEM tại Trường THCS Cầu Giấy",
    "reply_body": """Kính gửi Cô Nguyễn Thu Hà,

Fermat Tech trân trọng xác nhận danh sách 03 giảng viên phụ trách buổi tập huấn STEM tại Trường THCS Cầu Giấy vào sáng thứ Hai tới.
Chúng tôi đã hoàn thiện và gửi kèm tài liệu giáo trình bản chuẩn để nhà trường tiện in ấn, chuẩn bị cho các thầy cô tham dự.

Nếu nhà trường cần hỗ trợ thêm thông tin gì trước buổi tập huấn, xin vui lòng phản hồi lại email này.

Trân trọng,
Nguyễn Văn Tiến
Fermat Tech""",
    "summary": "Nhà trường đề nghị Fermat Tech chốt danh sách giảng viên và giáo trình.",
    "actions": ["Chốt danh sách giảng viên", "Gửi giáo trình bản mềm"],
    "priority": "HIGH",
    "needs_reply": True,
    "reply_by": "17:00 hôm nay"
}
print(json.dumps(result, ensure_ascii=False))
`;

  fs.writeFileSync('/tmp/mock_agy_016.py', MOCK_AGY_CODE, 'utf8');

  const venvPython = path.resolve(__dirname, '../.venv/bin/python');
  const managePy = path.resolve(__dirname, '../backend/manage.py');

  const testDb = '/tmp/ft_016_test.sqlite3';
  if (fs.existsSync(testDb)) {
    try { fs.unlinkSync(testDb); } catch {}
  }
  console.log('[Setup] Dùng database kiểm thử mới tại ' + testDb);

  // Khóa Fernet mẫu hợp lệ (32 bytes urlsafe base64)
  const FERNET_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

  const djangoEnv = {
    ...process.env,
    DJANGO_DB_PATH: testDb,
    GMAIL_MOCK_MODE: '1',
    GMAIL_OAUTH_CLIENT_ID: 'test-e2e-client-id.apps.googleusercontent.com',
    GMAIL_OAUTH_CLIENT_SECRET: 'test-e2e-client-secret',
    GMAIL_OAUTH_REDIRECT_URI: `http://127.0.0.1:${DJANGO_PORT}/api/gmail/oauth/callback/`,
    GMAIL_TOKEN_KEY: FERNET_KEY,
    AI_AGY_COMMAND: `${venvPython} /tmp/mock_agy_016.py`,
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
from documents.models import WeeklyReportSupplement
from documents.weekly_reports import week_start
from datetime import date, datetime, timezone

u, _ = User.objects.get_or_create(username='tien@fermat.vn', email='tien@fermat.vn', defaults={'is_superuser': True})
u.is_superuser = True
u.save()
Token.objects.update_or_create(user=u, defaults={'key': 'e2e-token-agy5-016-secret'})
p, _ = UserProfile.objects.get_or_create(email='tien@fermat.vn', defaults={'name': 'Nguyễn Văn Tiến', 'role': 'ADMIN', 'employment_status': 'ACTIVE'})
p.role = 'ADMIN'
p.employment_status = 'ACTIVE'
p.save()

# Seed Gmail Connection
conn, _ = GmailConnection.objects.update_or_create(
    user=p,
    defaults={
        'email': 'tien@fermat.vn',
        'encrypted_refresh_token': encrypt_token('mock_refresh_token_for_e2e'),
        'scopes': 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose',
        'ai_enabled': True,
        'notify_new': True,
        'morning_scan_enabled': True,
        'morning_time': '08:00',
        'last_sync_at': datetime.now(timezone.utc),
    }
)

# Xóa digests cũ của user
MailDigest.objects.filter(user=p).delete()

# Seed 3 MailDigest items
MailDigest.objects.create(
    user=p,
    message_id='msg-016-urgent-1',
    thread_id='thread-016-stem-caugiay',
    sender='Nguyễn Thu Hà <nguyenthuha@caugiay.edu.vn>',
    subject='Khẩn: Xác nhận lịch tập huấn STEM tại Trường THCS Cầu Giấy',
    received_at=datetime.now(timezone.utc),
    priority='URGENT',
    needs_reply=True,
    reply_by='17:00 hôm nay',
    summary='Nhà trường đề nghị Fermat Tech chốt danh sách 03 giảng viên phụ trách và gửi file giáo trình bản mềm trước 17h để kịp in tài liệu.',
    actions=['Chốt danh sách 03 giảng viên phụ trách', 'Gửi file giáo trình bản mềm qua email'],
    status='new'
)

MailDigest.objects.create(
    user=p,
    message_id='msg-016-high-2',
    thread_id='thread-016-khao-thi-socson',
    sender='Trần Minh Đức <ductm@socson.edu.vn>',
    subject='Báo giá phần mềm Khảo thí trực tuyến đợt 2',
    received_at=datetime.now(timezone.utc),
    priority='HIGH',
    needs_reply=True,
    reply_by='11:00 ngày mai',
    summary='Trường đề xuất xin chính sách giảm 10% chi phí bản quyền cho 500 học sinh đợt thi học kỳ 1.',
    actions=['Soạn báo giá điều chỉnh', 'Trình duyệt phòng Kinh doanh'],
    status='new'
)

MailDigest.objects.create(
    user=p,
    message_id='msg-016-normal-3',
    thread_id='thread-016-congdoan-le',
    sender='Ban Công đoàn Fermat <congdoan@fermat.vn>',
    subject='Thông báo kế hoạch giao lưu nội bộ và giải chạy cuối tuần',
    received_at=datetime.now(timezone.utc),
    priority='NORMAL',
    needs_reply=False,
    summary='Công đoàn thông báo thời gian tập trung tham gia giải chạy phong trào vào 6h30 sáng Chủ Nhật.',
    actions=[],
    status='new'
)

# Seed WeeklyReportSupplement rỗng cho tuần này
today = date.today()
monday = week_start(today)
WeeklyReportSupplement.objects.get_or_create(
    user=p,
    week_start=monday,
    defaults={'note': ''}
)

print('Seed data Gmail Assistant successfully injected')
`;
  fs.writeFileSync('/tmp/seed_e2e_016.py', seedScript, 'utf8');

  try {
    execSync(`${venvPython} ${managePy} migrate`, { env: djangoEnv, stdio: 'pipe' });
    console.log('[Setup] Đã migrate database kiểm thử.');

    execSync(`${venvPython} /tmp/seed_e2e_016.py`, { env: djangoEnv, stdio: 'pipe', cwd: path.resolve(__dirname, '../backend') });
    console.log('[Setup] Đã nạp seed data Gmail Connection & Digests.');
  } catch (err) {
    console.error('[Setup] Lỗi thiết lập:', err.message);
  }

  console.log('[Django] Starting backend on 127.0.0.1:' + DJANGO_PORT);
  const djangoProc = spawn(venvPython, [managePy, 'runserver', `127.0.0.1:${DJANGO_PORT}`, '--noreload'], {
    env: djangoEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  djangoProc.stdout.on('data', d => {
    const s = d.toString();
    if (s.includes('HTTP') || s.includes('POST') || s.includes('GET')) {
      process.stdout.write(`[Django Log] ${s}`);
    }
  });

  console.log('[Worker] Starting AI queue worker');
  const workerProc = spawn(venvPython, [managePy, 'run_ai_queue', '--poll-interval', '0.5'], {
    env: djangoEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  workerProc.stdout.on('data', d => {
    process.stdout.write(`[Worker Log] ${d.toString()}`);
  });

  await new Promise(r => setTimeout(r, 2000));

  const webServer = await startWebServer();

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    // ══════════════════════════════════════════════════════════
    // KỊCH BẢN 1: DESKTOP SÁNG (1440x900)
    // ══════════════════════════════════════════════════════════
    console.log('\n--- KỊCH BẢN 1: DESKTOP SÁNG (1440x900) ---');
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const desktopPage = await desktopContext.newPage();

    await desktopPage.addInitScript(() => {
      const mockUser = {
        uid: 'uid-test-agy5-016',
        email: 'tien@fermat.vn',
        displayName: 'Nguyễn Văn Tiến',
        photoURL: null,
        role: 'ADMIN',
        accessModules: ['communication-tools', 'gmail-assistant'],
      };
      localStorage.setItem('ft_token', 'e2e-token-agy5-016-secret');
      localStorage.setItem('ft_user_email', 'tien@fermat.vn');
      localStorage.setItem('ft_user_name', 'Nguyễn Văn Tiến');
      localStorage.setItem('ft_user_role', 'ADMIN');
      localStorage.setItem(
        'ft_auth_session',
        JSON.stringify({ token: 'e2e-token-agy5-016-secret', user: mockUser, role: 'ADMIN' })
      );
    });

    await desktopPage.goto(`http://127.0.0.1:${WEB_PORT}/communication-tools/gmail`, {
      waitUntil: 'networkidle',
    });
    console.log('[E2E Desktop] Đã mở trang Hộp thư AI.');

    // Chờ xuất hiện tiêu đề hoặc email kết nối
    await desktopPage.waitForSelector('text=tien@fermat.vn', { timeout: 10000 });
    await desktopPage.waitForSelector('text=Khẩn: Xác nhận lịch tập huấn STEM tại Trường THCS Cầu Giấy');
    await saveScreenshots(desktopPage, '01-desktop-overview-light');

    // Mở modal Soạn phản hồi AI
    console.log('[E2E Desktop] Bấm nút Soạn phản hồi...');
    const replyButtons = await desktopPage.locator('button:has-text("Soạn phản hồi")').all();
    if (replyButtons.length > 0) {
      await replyButtons[0].click();
    }
    await desktopPage.waitForSelector('text=Soạn phản hồi thư với AI');
    await desktopPage.waitForSelector('text=Chưa gửi.');

    // Nhập hướng dẫn cho AI và bấm AI Soạn
    console.log('[E2E Desktop] Nhập chỉ dẫn và yêu cầu AI Soạn...');
    const instructionInput = desktopPage.locator('input[placeholder*="Đồng ý tham gia cuộc họp"]');
    await instructionInput.fill('Đồng ý xác nhận 3 giảng viên, gửi kèm tài liệu giáo trình chuẩn');
    await desktopPage.locator('button:has-text("AI Soạn")').click();

    // Chờ textarea nhận nội dung do AI soạn
    const draftTextarea = desktopPage.locator('textarea[placeholder*="Nhấn nút \'AI Soạn\'"]');
    await desktopPage.waitForFunction(
      () => {
        const ta = document.querySelector('textarea');
        return ta && ta.value.length > 30;
      },
      { timeout: 10000 }
    );
    console.log('[E2E Desktop] AI đã soạn xong bản nháp.');
    await saveScreenshots(desktopPage, '02-desktop-ai-reply-draft-light');

    // Lưu vào Nháp Gmail (mock)
    console.log('[E2E Desktop] Bấm Lưu vào Nháp Gmail...');
    await desktopPage.locator('button:has-text("Lưu vào Nháp Gmail")').click();
    await desktopPage.waitForSelector('text=Đã lưu vào Nháp Gmail', { timeout: 8000 });
    await saveScreenshots(desktopPage, '03-desktop-draft-saved-light');

    // Đóng modal soạn thư
    await desktopPage.locator('button:has-text("Đóng")').click();
    await desktopPage.waitForTimeout(500);

    // Đưa vào ghi chú báo cáo tuần
    console.log('[E2E Desktop] Bấm Đưa vào Báo cáo tuần...');
    const addToReportBtns = await desktopPage.locator('button:has-text("Vào báo cáo")').all();
    if (addToReportBtns.length > 0) {
      await addToReportBtns[0].click();
      await desktopPage.waitForSelector('text=báo cáo tuần', { timeout: 8000 });
      console.log('[E2E Desktop] Đã đưa vào báo cáo tuần thành công.');
    }
    await saveScreenshots(desktopPage, '04-desktop-added-to-report-light');

    // ══════════════════════════════════════════════════════════
    // KỊCH BẢN 2: DESKTOP TỐI (1440x900)
    // ══════════════════════════════════════════════════════════
    console.log('\n--- KỊCH BẢN 2: DESKTOP TỐI (1440x900) ---');
    await desktopPage.evaluate(() => {
      document.documentElement.classList.add('dark');
      localStorage.setItem('ft-workspace-theme', 'dark');
    });
    await desktopPage.waitForTimeout(400);
    await saveScreenshots(desktopPage, '05-desktop-overview-dark');

    await desktopContext.close();

    // ══════════════════════════════════════════════════════════
    // KỊCH BẢN 3: MOBILE SÁNG & CÀI ĐẶT (390x844)
    // ══════════════════════════════════════════════════════════
    console.log('\n--- KỊCH BẢN 3: MOBILE SÁNG & CÀI ĐẶT (390x844) ---');
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobileContext.newPage();

    await mobilePage.addInitScript(() => {
      const mockUser = {
        uid: 'uid-test-agy5-016',
        email: 'tien@fermat.vn',
        displayName: 'Nguyễn Văn Tiến',
        photoURL: null,
        role: 'ADMIN',
        accessModules: ['communication-tools', 'gmail-assistant'],
      };
      localStorage.setItem('ft_token', 'e2e-token-agy5-016-secret');
      localStorage.setItem('ft_user_email', 'tien@fermat.vn');
      localStorage.setItem('ft_user_name', 'Nguyễn Văn Tiến');
      localStorage.setItem('ft_user_role', 'ADMIN');
      localStorage.setItem(
        'ft_auth_session',
        JSON.stringify({ token: 'e2e-token-agy5-016-secret', user: mockUser, role: 'ADMIN' })
      );
    });

    await mobilePage.goto(`http://127.0.0.1:${WEB_PORT}/communication-tools/gmail`, {
      waitUntil: 'networkidle',
    });
    await mobilePage.waitForSelector('text=tien@fermat.vn', { timeout: 10000 });

    // Bấm nút Cài đặt trên mobile
    console.log('[E2E Mobile] Mở modal Cài đặt...');
    await mobilePage.locator('button:has-text("Cài đặt"):visible').first().click();
    await mobilePage.waitForSelector('text=Cài đặt Hộp thư AI');
    await mobilePage.waitForSelector('text=Khu vực nguy hiểm');
    await saveScreenshots(mobilePage, '06-mobile-settings-light');

    // Đóng cài đặt
    await mobilePage.locator('button:has-text("Hủy")').click();
    await mobilePage.waitForTimeout(300);

    // ══════════════════════════════════════════════════════════
    // KỊCH BẢN 4: MOBILE TỐI (390x844)
    // ══════════════════════════════════════════════════════════
    console.log('\n--- KỊCH BẢN 4: MOBILE TỐI (390x844) ---');
    await mobilePage.evaluate(() => {
      document.documentElement.classList.add('dark');
      localStorage.setItem('ft-workspace-theme', 'dark');
    });
    await mobilePage.waitForTimeout(400);
    await saveScreenshots(mobilePage, '07-mobile-overview-dark');

    await mobileContext.close();

    console.log('\n=== TẤT CẢ KỊCH BẢN E2E HOÀN TẤT THÀNH CÔNG! ===');
  } finally {
    await browser.close();
    webServer.close();
    djangoProc.kill('SIGTERM');
    workerProc.kill('SIGTERM');
    try { fs.unlinkSync('/tmp/mock_agy_016.py'); } catch {}
    try { fs.unlinkSync('/tmp/seed_e2e_016.py'); } catch {}
    try { fs.unlinkSync(testDb); } catch {}
  }
}

main().catch(err => {
  console.error('[E2E Error]', err);
  process.exit(1);
});
