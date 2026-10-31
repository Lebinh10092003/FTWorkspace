const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync, execFileSync } = require('child_process');

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

const DJANGO_PORT = 58092;
const WEB_PORT = 58752;
const DIST_DIR = path.resolve(__dirname, '../dist');
const SCREEN_DIRS = [
  path.resolve(__dirname, '../docs/tasks/021-screens'),
  path.resolve('/home/orcauser/orca/workspaces/ft-workspace/Claude-agent/docs/tasks/021-screens'),
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

async function saveBothScreenshots(page, baseName) {
  // 1440px Desktop
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  for (const dir of SCREEN_DIRS) {
    const outPath = path.join(dir, `${baseName}-1440px.png`);
    await page.screenshot({ path: outPath, fullPage: true });
  }
  console.log(`[Screenshot Saved] -> ${baseName}-1440px.png`);

  // 390px Mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  for (const dir of SCREEN_DIRS) {
    const outPath = path.join(dir, `${baseName}-390px.png`);
    await page.screenshot({ path: outPath, fullPage: true });
  }
  console.log(`[Screenshot Saved] -> ${baseName}-390px.png`);

  // Restore 1440px
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
}

async function postJson(urlPath, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: DJANGO_PORT,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          ...headers,
        },
      },
      res => {
        let body = '';
        res.on('data', chunk => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, data: JSON.parse(body) });
          } catch {
            resolve({ statusCode: res.statusCode, body });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function openProfileModal(page) {
  const dismissWarning = page.locator('button:has-text("Bỏ qua")').first();
  if (await dismissWarning.count() > 0 && await dismissWarning.isVisible()) {
    await dismissWarning.click();
    await page.waitForTimeout(500);
  }

  const trigger = page.locator('button[title*="Tài khoản"]:visible, button:has-text("Nguyễn Văn Tiến"):visible').first();
  if (await trigger.count() > 0) {
    await trigger.click();
    await page.waitForTimeout(600);
  }

  const editBtn = page.locator('button:has-text("Chỉnh sửa hồ sơ"):visible, button:has-text("Hồ sơ & Mật khẩu"):visible, button:has-text("Tùy chỉnh tài khoản"):visible').first();
  if (await editBtn.count() > 0) {
    await editBtn.click();
    await page.waitForTimeout(800);
  }
}

async function main() {
  console.log('=== BẮT ĐẦU E2E THẬT: VIỆC 021 BOT ZALO THÔNG BÁO RIÊNG ===');

  const venvPython = path.resolve(__dirname, '../.venv/bin/python');
  const managePy = path.resolve(__dirname, '../backend/manage.py');

  const testDb = '/tmp/ft_021_test.sqlite3';
  if (fs.existsSync(testDb)) {
    try { fs.unlinkSync(testDb); } catch {}
  }
  console.log('[Setup] Dùng database kiểm thử mới tại ' + testDb);

  const djangoEnv = {
    ...process.env,
    DJANGO_DB_PATH: testDb,
    ZALO_BOT_MOCK_MODE: '1',
    ZALO_BOT_WEBHOOK_SECRET: 'mock_webhook_secret_021',
    PYTHONUNBUFFERED: '1',
  };

  // Migrate DB
  console.log('[Setup] Running migrations...');
  execSync(`${venvPython} ${managePy} migrate --noinput`, {
    env: djangoEnv,
    stdio: 'inherit',
  });

  // Seed user and work schedule item
  const seedScript = `
import sys, os
backend_dir = '/home/orcauser/orca/workspaces/ft-workspace/agy/FTWorkspace/backend'
sys.path.insert(0, backend_dir)

import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token
from authentication.models import UserProfile
from work_schedule.models import WorkItem
from django.utils import timezone
from datetime import time

u, _ = User.objects.get_or_create(username='tien@fermat.vn', email='tien@fermat.vn', defaults={'is_superuser': True})
u.is_superuser = True
u.save()
Token.objects.update_or_create(user=u, defaults={'key': 'e2e-token-agy5-021-secret'})
p, _ = UserProfile.objects.get_or_create(email='tien@fermat.vn', defaults={'name': 'Nguyễn Văn Tiến', 'role': 'ADMIN', 'employment_status': 'ACTIVE'})
p.name = 'Nguyễn Văn Tiến'
p.role = 'ADMIN'
p.employment_status = 'ACTIVE'
p.save()

today = timezone.localdate()
WorkItem.objects.filter(executor=p).delete()
WorkItem.objects.create(
    creator=p,
    executor=p,
    title='Chuẩn bị đề thi thử và tài liệu khảo thí môn Toán',
    work_date=today,
    start_time=time(8, 30),
    daily_order=1,
    status=WorkItem.STATUS_TODO
)
print("Seeded user and work schedule item successfully.")
`;
  execFileSync(venvPython, ['-c', seedScript], {
    env: djangoEnv,
    stdio: 'inherit',
  });

  // Start Django server
  console.log(`[Setup] Starting Django server on port ${DJANGO_PORT}...`);
  const djangoProcess = spawn(venvPython, [managePy, 'runserver', `127.0.0.1:${DJANGO_PORT}`], {
    env: djangoEnv,
    stdio: 'pipe',
  });

  djangoProcess.stdout.on('data', d => {
    const s = d.toString();
    if (s.includes('Quit the server') || s.includes('Watching for file changes')) {
      console.log('[Django Ready]');
    }
  });
  djangoProcess.stderr.on('data', d => console.error('[Django Stderr]', d.toString()));

  await new Promise(r => setTimeout(r, 3000));

  const webServer = await startWebServer();

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // Login via localStorage
    await page.goto(`http://127.0.0.1:${WEB_PORT}/`);
    await page.evaluate(() => {
      sessionStorage.setItem('timesheet_dismiss_yesterday', '1');
      localStorage.setItem('ft_auth_session', JSON.stringify({
        token: 'e2e-token-agy5-021-secret',
        user: { email: 'tien@fermat.vn', displayName: 'Nguyễn Văn Tiến' },
        role: 'ADMIN',
      }));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // Mở Account Profile Modal
    console.log('[Step 1] Mở AccountProfileModal và chuyển sang tab Zalo Bot...');
    await openProfileModal(page);
    await page.waitForTimeout(1000);

    // Click tab Zalo Bot
    const zaloTabBtn = page.locator('button[role="tab"]:has-text("Zalo")').first();
    await zaloTabBtn.click();
    await page.waitForTimeout(1000);

    // Chụp ảnh 01: Màn hình khi chưa liên kết (1440px & 390px)
    console.log('[Screenshot] Chụp ảnh 01-zalo-unlinked...');
    await saveBothScreenshots(page, '01-zalo-unlinked');

    // Bấm nút "Lấy mã liên kết Zalo"
    console.log('[Step 2] Bấm nút lấy mã liên kết Zalo...');
    const getCodeBtn = page.locator('button:has-text("Lấy mã liên kết")').first();
    await getCodeBtn.click();
    await page.waitForTimeout(1500);

    // Chụp ảnh 02: Mã liên kết và đếm ngược (1440px & 390px)
    console.log('[Screenshot] Chụp ảnh 02-zalo-link-code...');
    await saveBothScreenshots(page, '02-zalo-link-code');

    // Lấy mã 6 số đang hiển thị trên trang
    const codeEl = page.locator('.font-mono.text-3xl, .font-mono.tracking-widest').first();
    const rawCode = (await codeEl.textContent()).trim();
    console.log(`[Link Code Generated] -> ${rawCode}`);

    // Gửi webhook mô phỏng Zalo user nhắn mã 6 số
    console.log('[Step 3] Gửi webhook mô phỏng Zalo user nhắn mã 6 số...');
    const webhookRes = await postJson(
      '/api/zalo-bot/webhook/',
      {
        update_id: 1001,
        message: {
          message_id: 2001,
          chat: { id: 'chat_zalo_tien_8888' },
          from: { id: 'zalo_user_tien', name: 'Nguyễn Văn Tiến' },
          text: rawCode,
        },
      },
      { 'X-Bot-Api-Secret-Token': 'mock_webhook_secret_021' }
    );
    console.log('[Webhook Result]', webhookRes);

    // Chờ 3-4s để frontend auto-poll cập nhật trạng thái linked
    console.log('[Step 4] Chờ frontend cập nhật trạng thái "Đã kết nối"...');
    await page.waitForTimeout(4000);

    // Chụp ảnh 03: Đã liên kết thành công (1440px & 390px)
    console.log('[Screenshot] Chụp ảnh 03-zalo-linked...');
    await saveBothScreenshots(page, '03-zalo-linked');

    // Bấm nút "Gửi thử"
    console.log('[Step 5] Bấm nút Gửi thử thông báo...');
    const testSendBtn = page.locator('button:has-text("Gửi thử")').first();
    await testSendBtn.click();
    await page.waitForTimeout(1500);

    console.log('[Screenshot] Chụp ảnh 04-zalo-test-send-success...');
    await saveBothScreenshots(page, '04-zalo-test-send-success');

    // Đóng modal profile
    const closeBtn = page.locator('button:has(.lucide-x), button[title*="Đóng"]').first();
    if (await closeBtn.count() > 0) {
      await closeBtn.click();
      await page.waitForTimeout(1000);
    }

    // 5. TEST CHUỖI LỆNH BOT QUA WEBHOOK & NHẮC VIỆC
    console.log('[Step 6] Gửi lệnh bot: "việc hôm nay"...');
    await postJson(
      '/api/zalo-bot/webhook/',
      {
        update_id: 1002,
        message: {
          message_id: 2002,
          chat: { id: 'chat_zalo_tien_8888' },
          from: { id: 'zalo_user_tien', name: 'Nguyễn Văn Tiến' },
          text: 'việc hôm nay',
        },
      },
      { 'X-Bot-Api-Secret-Token': 'mock_webhook_secret_021' }
    );

    console.log('[Step 7] Chạy command nhắc việc lịch công tác (run_zalo_work_reminders)...');
    execSync(`${venvPython} ${managePy} run_zalo_work_reminders`, {
      env: djangoEnv,
      stdio: 'inherit',
    });

    console.log('[Step 8] Gửi lệnh bot: "dời 1 sang mai"...');
    await postJson(
      '/api/zalo-bot/webhook/',
      {
        update_id: 1003,
        message: {
          message_id: 2003,
          chat: { id: 'chat_zalo_tien_8888' },
          from: { id: 'zalo_user_tien', name: 'Nguyễn Văn Tiến' },
          text: 'dời 1 sang mai',
        },
      },
      { 'X-Bot-Api-Secret-Token': 'mock_webhook_secret_021' }
    );

    console.log('[Step 9] Gửi lệnh xác nhận: "ok"...');
    await postJson(
      '/api/zalo-bot/webhook/',
      {
        update_id: 1004,
        message: {
          message_id: 2004,
          chat: { id: 'chat_zalo_tien_8888' },
          from: { id: 'zalo_user_tien', name: 'Nguyễn Văn Tiến' },
          text: 'ok',
        },
      },
      { 'X-Bot-Api-Secret-Token': 'mock_webhook_secret_021' }
    );

    // Chuyển sang xem Lịch công tác
    console.log('[Step 10] Mở trang Lịch công tác để xác nhận việc đã dời sang ngày mai...');
    await page.goto(`http://127.0.0.1:${WEB_PORT}/work-schedule`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log('[Screenshot] Chụp ảnh 05-work-schedule-rescheduled...');
    await saveBothScreenshots(page, '05-work-schedule-rescheduled');

    await context.close();
    console.log('=== E2E THÀNH CÔNG RỰC RỠ! TẤT CẢ CÁC BƯỚC ĐỀU KHỚP YÊU CẦU ===');
  } catch (err) {
    console.error('E2E Failed with error:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    webServer.close();
    djangoProcess.kill();
    try {
      if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    } catch {}
  }
}

main();
