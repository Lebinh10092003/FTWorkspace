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

const DJANGO_PORT = 58088;
const WEB_PORT = 58748;
const DIST_DIR = path.resolve(__dirname, '../dist');
const SCREEN_DIRS = [
  path.resolve(__dirname, '../docs/tasks/020-screens'),
  path.resolve('/home/orcauser/orca/workspaces/ft-workspace/Claude-agent/docs/tasks/020-screens'),
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
  console.log('=== BẮT ĐẦU E2E BACKEND THẬT: VIỆC 020 TÓM TẮT LUỒNG THƯ BẰNG AI THẬT ===');

  const venvPython = path.resolve(__dirname, '../.venv/bin/python');
  const managePy = path.resolve(__dirname, '../backend/manage.py');

  const testDb = '/tmp/ft_020_test.sqlite3';
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
from gmail_assistant.models import GmailConnection, MailDigest, MailThreadSummary
from gmail_assistant.security import encrypt_token
from datetime import datetime, timezone, timedelta

u, _ = User.objects.get_or_create(username='tien@fermat.vn', email='tien@fermat.vn', defaults={'is_superuser': True})
u.is_superuser = True
u.save()
Token.objects.update_or_create(user=u, defaults={'key': 'e2e-token-agy5-020-secret'})
p, _ = UserProfile.objects.get_or_create(email='tien@fermat.vn', defaults={'name': 'Nguyễn Văn Tiến', 'role': 'ADMIN', 'employment_status': 'ACTIVE'})
p.name = 'Nguyễn Văn Tiến'
p.role = 'ADMIN'
p.employment_status = 'ACTIVE'
p.save()

conn, _ = GmailConnection.objects.update_or_create(
    user=p,
    defaults={
        'email': 'tien@fermat.vn',
        'encrypted_refresh_token': encrypt_token('mock_refresh_token_020'),
        'scopes': 'https://www.googleapis.com/auth/gmail.readonly',
        'ai_enabled': True,
        'notify_new': True,
        'morning_scan_enabled': True,
        'morning_time': '08:00',
        'superior_contacts': ['giamdoc@fermat.vn'],
    }
)

MailDigest.objects.filter(user=p).delete()
MailThreadSummary.objects.filter(user=p).delete()

now = datetime.now(timezone.utc)

# 1. Luồng 3 thư thật (đã được AI tóm tắt theo luồng)
t1 = now - timedelta(days=2)
t2 = now - timedelta(days=1)
t3 = now - timedelta(hours=2)

MailDigest.objects.create(
    user=p,
    message_id='msg-020-stem-1',
    thread_id='thread-020-stem-trung-vuong',
    sender='Thầy Hiệu trưởng <hieutruong@trungvuong.edu.vn>',
    sender_email='hieutruong@trungvuong.edu.vn',
    subject='Kế hoạch phối hợp triển khai tuần lễ STEM và tập huấn giáo viên',
    received_at=t1,
    recipient_role=MailDigest.RECIPIENT_ROLE_TO,
    needs_reply=True,
    snippet='Kính gửi Công ty Fermat Tech, Nhà trường dự kiến tổ chức tuần lễ STEM vào tháng 11...',
    status='new'
)

MailDigest.objects.create(
    user=p,
    message_id='msg-020-stem-2',
    thread_id='thread-020-stem-trung-vuong',
    sender='Nguyễn Văn Tiến <tien@fermat.vn>',
    sender_email='tien@fermat.vn',
    subject='Re: Kế hoạch phối hợp triển khai tuần lễ STEM và tập huấn giáo viên',
    received_at=t2,
    is_from_me=True,
    recipient_role=MailDigest.RECIPIENT_ROLE_OTHER,
    needs_reply=False,
    snippet='Kính gửi Thầy Hiệu trưởng, Công ty đã nhận được đề xuất và xin gửi phương án khung...',
    status='replied'
)

MailDigest.objects.create(
    user=p,
    message_id='msg-020-stem-3',
    thread_id='thread-020-stem-trung-vuong',
    sender='Thầy Hiệu trưởng <hieutruong@trungvuong.edu.vn>',
    sender_email='hieutruong@trungvuong.edu.vn',
    subject='Re: Kế hoạch phối hợp triển khai tuần lễ STEM và tập huấn giáo viên',
    received_at=t3,
    recipient_role=MailDigest.RECIPIENT_ROLE_TO,
    needs_reply=True,
    snippet='Cảm ơn em. Nhà trường chốt tổ chức từ ngày 18/11. Nhờ công ty cử 3 giảng viên chuyên trách và gửi file demo trước 15/11.',
    status='new'
)

MailThreadSummary.objects.create(
    user=p,
    thread_id='thread-020-stem-trung-vuong',
    summary='Trường THCS Trưng Vương và Fermat Tech thống nhất triển khai Tuần lễ STEM từ ngày 18/11. Nhà trường đề nghị công ty cử 3 giảng viên chuyên trách hướng dẫn thực hành và gửi file tài liệu demo trước ngày 15/11.',
    waiting_for='Đang chờ Fermat Tech cử 3 giảng viên chuyên trách và gửi file demo',
    needs_reply=True,
    reply_by='Trước 17h ngày 14/11',
    priority='high',
    actions=[
        {
            'type': 'phan_hoi_xac_nhan',
            'title': 'Xác nhận danh sách 3 giảng viên chuyên trách Tuần lễ STEM',
            'deadline': 'Trước 17h ngày 14/11',
            'required_preparations': ['Danh sách phân công giảng viên', 'Lịch công tác tuần 46'],
            'priority': 'high',
            'completed': False
        },
        {
            'type': 'gui_file_bao_cao',
            'title': 'Gửi tài liệu demo thực hành STEM',
            'deadline': 'Trước 15/11',
            'required_preparations': ['Slide bài giảng thực hành', 'File hướng dẫn kit STEM'],
            'priority': 'high',
            'completed': False
        }
    ],
    last_message_id='msg-020-stem-3'
)

# 2. Luồng thư CHƯA phân tích bằng AI (để test nhãn và nút Phân tích luồng này)
MailDigest.objects.create(
    user=p,
    message_id='msg-020-unanalyzed-1',
    thread_id='thread-020-survey-danang',
    sender='Sở GD&ĐT Đà Nẵng <sogddt@danang.edu.vn>',
    sender_email='sogddt@danang.edu.vn',
    subject='Khảo sát nhu cầu bồi dưỡng giáo viên dạy môn Khoa học tự nhiên',
    received_at=now - timedelta(hours=5),
    recipient_role=MailDigest.RECIPIENT_ROLE_TO,
    needs_reply=True,
    snippet='Kính gửi các đơn vị phối hợp, Sở đề nghị gửi phiếu khảo sát nhu cầu bồi dưỡng chuyên môn trước ngày 05/11...',
    status='new'
)

print('[Seed] Đã khởi tạo dữ liệu mẫu thành công cho test 020!')
`;

  console.log('[Setup] Chạy migrate database...');
  execSync(`${venvPython} ${managePy} migrate --run-syncdb`, {
    env: djangoEnv,
    stdio: 'inherit',
  });

  console.log('[Setup] Nạp dữ liệu seed...');
  fs.writeFileSync('/tmp/seed_ft_020.py', seedScript, 'utf8');
  execSync(`${venvPython} /tmp/seed_ft_020.py`, {
    env: djangoEnv,
    stdio: 'inherit',
  });

  console.log('[Setup] Khởi động Django server trên port ' + DJANGO_PORT);
  const djangoProcess = spawn(venvPython, [managePy, 'runserver', `127.0.0.1:${DJANGO_PORT}`], {
    env: djangoEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  djangoProcess.stdout.on('data', d => {
    const line = d.toString();
    if (line.includes('Quit the server') || line.includes('Starting development server')) {
      console.log('[Django]', line.trim());
    }
  });
  djangoProcess.stderr.on('data', d => console.error('[Django Err]', d.toString().trim()));

  await new Promise(r => setTimeout(r, 2000));

  const webServer = await startWebServer();

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    console.log('[Test] Truy cập trang chủ để lưu token và thông tin user...');
    await page.goto(`http://127.0.0.1:${WEB_PORT}/`, { waitUntil: 'networkidle' });

    await page.evaluate(() => {
      localStorage.setItem('auth_token', 'e2e-token-agy5-020-secret');
      localStorage.setItem('user', JSON.stringify({
        id: 1,
        email: 'tien@fermat.vn',
        name: 'Nguyễn Văn Tiến',
        role: 'ADMIN',
        roles: ['ADMIN'],
        employment_status: 'ACTIVE'
      }));
    });

    console.log('[Test] Chuyển hướng tới Hộp thư AI...');
    await page.goto(`http://127.0.0.1:${WEB_PORT}/communication-tools/gmail`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Chụp toàn cảnh Desktop
    console.log('[Test] Chụp ảnh Desktop 1440px...');
    await saveScreenshots(page, '020-desktop-thread-summary');

    // Mở modal Soạn phản hồi cho thẻ luồng STEM
    console.log('[Test] Mở modal Soạn phản hồi luồng thư...');
    const replyBtn = await page.$('button:has-text("Soạn phản hồi")');
    if (replyBtn) {
      await replyBtn.click();
      await page.waitForTimeout(1500);
      await saveScreenshots(page, '020-desktop-reply-modal');
      
      // Đóng modal
      const closeBtn = await page.$('button:has-text("Đóng")');
      if (closeBtn) await closeBtn.click();
      await page.waitForTimeout(500);
    }

    // Chuyển sang Mobile Viewport 390px (iPhone 12/13/14)
    console.log('[Test] Chuyển sang Mobile 390x844...');
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(`http://127.0.0.1:${WEB_PORT}/`, { waitUntil: 'networkidle' });
    await mobilePage.evaluate(() => {
      localStorage.setItem('auth_token', 'e2e-token-agy5-020-secret');
      localStorage.setItem('user', JSON.stringify({
        id: 1,
        email: 'tien@fermat.vn',
        name: 'Nguyễn Văn Tiến',
        role: 'ADMIN',
        roles: ['ADMIN'],
        employment_status: 'ACTIVE'
      }));
    });
    await mobilePage.goto(`http://127.0.0.1:${WEB_PORT}/communication-tools/gmail`, { waitUntil: 'networkidle' });
    await mobilePage.waitForTimeout(2000);

    await saveScreenshots(mobilePage, '020-mobile-thread-summary');

    const mobileReplyBtn = await mobilePage.$('button:has-text("Soạn phản hồi")');
    if (mobileReplyBtn) {
      await mobileReplyBtn.click();
      await mobilePage.waitForTimeout(1500);
      await saveScreenshots(mobilePage, '020-mobile-reply-modal');
    }

    console.log('=== HOÀN TẤT E2E 020 THÀNH CÔNG ===');
  } finally {
    await browser.close();
    webServer.close();
    djangoProcess.kill('SIGTERM');
  }
}

main().catch(err => {
  console.error('[E2E Error]', err);
  process.exit(1);
});
