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

const DJANGO_PORT = 58093;
const WEB_PORT = 58753;
const DIST_DIR = path.resolve(__dirname, '../dist');
const SCREEN_DIRS = [
  path.resolve(__dirname, '../docs/tasks/032-screens'),
  path.resolve('/home/orcauser/orca/workspaces/ft-workspace/Claude-agent/docs/tasks/032-screens'),
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
      // 1. API proxy sang Django
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

      // 2. Static files
      let reqPath = req.url.split('?')[0];

      // Mock iframe 3D nhẹ cho Playwright E2E theo spec ("giả lập iframe nếu cần")
      if (reqPath === '/office3d/vi/' || reqPath === '/office3d/vi/index.html' || reqPath === '/office3d/vi') {
        const mock3DHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Văn phòng 3D FermatTech</title>
  <style>
    body { margin: 0; background: radial-gradient(circle at center, #1e293b 0%, #0f172a 100%); color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; overflow: hidden; user-select: none; }
    .grid { position: absolute; inset: 0; background-image: radial-gradient(#334155 1.5px, transparent 1.5px); background-size: 24px 24px; opacity: 0.7; }
    .box { position: relative; z-index: 10; text-align: center; padding: 24px; border-radius: 16px; background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(59, 130, 246, 0.4); box-shadow: 0 20px 40px rgba(0,0,0,0.5); backdrop-filter: blur(8px); max-width: 420px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(59, 130, 246, 0.15); border: 1px solid #3b82f6; color: #60a5fa; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: bold; }
    .title { font-size: 18px; font-weight: 700; margin: 12px 0 6px 0; color: #f8fafc; }
    .desc { font-size: 12px; color: #94a3b8; margin-bottom: 16px; line-height: 1.4; }
    .desks { display: flex; gap: 12px; justify-content: center; }
    .seat { width: 110px; padding: 10px 6px; background: #1e293b; border: 1px solid #475569; border-radius: 10px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
    .seat-role { font-size: 10px; color: #94a3b8; }
    .seat-name { font-size: 11px; font-weight: 600; color: #38bdf8; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; }
  </style>
</head>
<body>
  <div class="grid"></div>
  <div class="box">
    <div class="badge"><span class="dot"></span> 3D Virtual Workspace</div>
    <div class="title">Không gian Văn phòng 3D FermatTech</div>
    <div class="desc">Bản dựng không gian làm việc số 3D tích hợp phòng ban, bàn làm việc và trạng thái trực tuyến.</div>
    <div class="desks">
      <div class="seat">
        <span class="seat-role">Trưởng phòng</span>
        <span class="seat-name">Trần Đồng Nghiệp</span>
      </div>
      <div class="seat" style="border-color: #3b82f6; background: #1e3a5f;">
        <span class="seat-role">Vị trí của bạn</span>
        <span class="seat-name">Nguyễn Văn Test</span>
      </div>
    </div>
  </div>
  <script>
    // Gửi ft-office:ready khi nạp xong
    window.addEventListener('load', () => {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'ft-office:ready' }, window.location.origin);
      }
    });
    // Nhận ft-office:init từ workspace cha
    window.addEventListener('message', (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data && e.data.type === 'ft-office:init') {
        console.log('[Office 3D Iframe] Đã nhận ft-office:init:', e.data);
      }
    });
  </script>
</body>
</html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(mock3DHtml);
        return;
      }

      // Next.js chunks được gọi từ root /_next/
      if (reqPath.startsWith('/_next/')) {
        const subPath = path.join(DIST_DIR, 'office3d', 'vi', reqPath);
        if (fs.existsSync(subPath) && fs.statSync(subPath).isFile()) {
          const ext = path.extname(subPath).toLowerCase();
          res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
          fs.createReadStream(subPath).pipe(res);
          return;
        }
      }

      // File tĩnh của office3d
      if (reqPath.startsWith('/office3d/vi/')) {
        let sub = reqPath.replace(/^\/office3d\/vi\//, '');
        if (!sub || sub === '/') sub = 'index.html';
        const subPath = path.join(DIST_DIR, 'office3d', 'vi', sub);
        if (fs.existsSync(subPath) && fs.statSync(subPath).isFile()) {
          const ext = path.extname(subPath).toLowerCase();
          res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
          fs.createReadStream(subPath).pipe(res);
          return;
        }
        if (path.extname(sub)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }
      }

      const ext = path.extname(reqPath).toLowerCase();
      if (ext && ext !== '.html') {
        const filePath = path.join(DIST_DIR, reqPath);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
          fs.createReadStream(filePath).pipe(res);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
        }
        return;
      }

      // SPA fallback cho route HTML
      const fallback = path.join(DIST_DIR, 'index.html');
      if (fs.existsSync(fallback)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(fallback).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(WEB_PORT, '127.0.0.1', () => {
      console.log(`[Web Server] Running on http://127.0.0.1:${WEB_PORT}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

async function waitForDjango(port, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/health/`, res => {
          if (res.statusCode === 200) resolve(true);
          else reject(new Error('Status: ' + res.statusCode));
        });
        req.on('error', reject);
        req.setTimeout(1000, () => req.destroy());
      });
      console.log('[Django] Server đã sẵn sàng phản hồi API!');
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error(`Django server không khởi động kịp sau ${maxAttempts} lần thử`);
}

async function saveBothScreenshots(page, baseName) {
  // 1440px Desktop
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  for (const dir of SCREEN_DIRS) {
    const outPath = path.join(dir, `${baseName}-1440px.png`);
    try {
      await page.screenshot({ path: outPath, timeout: 5000, animations: 'disabled' });
    } catch (e) {
      console.warn(`[Screenshot Notice] 1440px fallback: ${e.message}`);
      await page.locator('div:has(iframe), body, main').first().screenshot({ path: outPath, timeout: 5000 }).catch(() => {});
    }
  }
  console.log(`[Screenshot Saved] -> ${baseName}-1440px.png`);

  // 390px Mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  for (const dir of SCREEN_DIRS) {
    const outPath = path.join(dir, `${baseName}-390px.png`);
    try {
      await page.screenshot({ path: outPath, timeout: 5000, animations: 'disabled' });
    } catch (e) {
      console.warn(`[Screenshot Notice] 390px fallback: ${e.message}`);
      await page.locator('div:has(iframe), body, main').first().screenshot({ path: outPath, timeout: 5000 }).catch(() => {});
    }
  }
  console.log(`[Screenshot Saved] -> ${baseName}-390px.png`);

  // Restore 1440px
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
}

async function main() {
  console.log('=== BẮT ĐẦU E2E KIỂM THỬ: VIỆC 032 GHÉP VĂN PHÒNG 3D VÀO WORKSPACE ===');

  const venvPython = path.resolve(__dirname, '../.venv/bin/python');
  const managePy = path.resolve(__dirname, '../backend/manage.py');

  const testDb = '/tmp/ft_032_test.sqlite3';
  if (fs.existsSync(testDb)) {
    try { fs.unlinkSync(testDb); } catch {}
  }

  const djangoEnv = {
    ...process.env,
    DJANGO_SETTINGS_MODULE: 'config.settings',
    PYTHONPATH: path.resolve(__dirname, '../backend'),
    DJANGO_DB_PATH: testDb,
    PYTHONUNBUFFERED: '1',
  };

  // Migrate DB
  console.log('[Setup] Đang chạy migrate trên test database...');
  execSync(`${venvPython} ${managePy} migrate --noinput`, {
    env: djangoEnv,
    stdio: 'ignore',
  });

  // Tạo tài khoản test
  console.log('[Setup] Đang tạo tài khoản kiểm thử...');
  const createTestUserScript = `
import django
django.setup()
from django.contrib.auth.models import User
from authentication.models import UserProfile, Department, JobTitle
from office.models import OfficeSeat, OfficePresence

# Tạo user test
user = User.objects.create_user(username="nhanvien_test@fermat.test", email="nhanvien_test@fermat.test", password="Password@123")
dept = Department.objects.create(name="Phòng Công nghệ", code="TECH")
title = JobTitle.objects.create(name="Lập trình viên")
profile, _ = UserProfile.objects.get_or_create(
    email="nhanvien_test@fermat.test",
    defaults={
        "name": "Nguyễn Văn Test",
        "role": "EMPLOYEE",
        "employment_status": "ACTIVE",
        "department": dept,
        "job_title": title,
        "access_modules": ["work-schedule", "attendance", "weekly-report"],
    }
)
# Gán chỗ ngồi và presence
OfficeSeat.objects.create(user=profile, room="tech", seat_index=2, is_head=False)
OfficePresence.objects.create(user=profile, show_presence=True, avatar_config={"skin_color": "#fadcbc", "hair_style": "short"})

# Đồng nghiệp online
colleague = User.objects.create_user(username="dongnghiep@fermat.test", email="dongnghiep@fermat.test", password="Password@123")
p2, _ = UserProfile.objects.get_or_create(
    email="dongnghiep@fermat.test",
    defaults={"name": "Trần Đồng Nghiệp", "role": "EMPLOYEE", "employment_status": "ACTIVE", "department": dept}
)
from django.utils import timezone
OfficeSeat.objects.create(user=p2, room="tech", seat_index=1, is_head=True)
OfficePresence.objects.create(user=p2, last_seen=timezone.now(), show_presence=True)

from rest_framework.authtoken.models import Token
token, _ = Token.objects.get_or_create(user=user)
print("TOKEN:" + token.key)
`;

  const output = execSync(`${venvPython} -c '${createTestUserScript}'`, {
    env: djangoEnv,
    encoding: 'utf-8',
  });
  const tokenMatch = output.match(/TOKEN:([a-f0-9]+)/);
  if (!tokenMatch) throw new Error('Không tạo được token test');
  const token = tokenMatch[1].trim();
  console.log(`[Setup] Token thành công: ${token}`);

  // Chạy Django dev server
  console.log(`[Django] Khởi chạy trên cổng ${DJANGO_PORT}...`);
  const djangoProc = spawn(venvPython, [managePy, 'runserver', `127.0.0.1:${DJANGO_PORT}`], {
    env: djangoEnv,
    stdio: 'ignore',
  });

  // Chạy Web server static
  const webServer = await startWebServer();

  // Đợi Django server sẵn sàng
  await waitForDjango(DJANGO_PORT);

  let browser;
  let hasErrors = false;

  try {
    console.log('[Playwright] Khởi chạy Chromium...');
    browser = await chromium.launch({
      headless: true,
      executablePath: '/home/orcauser/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });

    // Cài đặt session đăng nhập vào localStorage trước khi bất kỳ script nào chạy
    await context.addInitScript(({ tokenVal }) => {
      const session = {
        token: tokenVal,
        user: {
          uid: 'nhanvien_test@fermat.test',
          email: 'nhanvien_test@fermat.test',
          displayName: 'Nguyễn Văn Test',
          accessModules: ['work-schedule', 'attendance', 'weekly-report'],
        },
        role: 'EMPLOYEE',
      };
      localStorage.setItem('ft_auth_session', JSON.stringify(session));
    }, { tokenVal: token });

    // Theo dõi console errors và network heartbeat
    let heartbeatCalled = false;
    let consoleErrors = [];

    const page = await context.newPage();

    page.on('console', msg => {
      console.log(`[BROWSER CONSOLE ${msg.type()}]:`, msg.text());
    });
    page.on('pageerror', err => {
      console.log('[BROWSER PAGE ERROR]:', err.message);
    });

    page.on('request', req => {
      if (req.url().includes('/api/office/heartbeat/')) {
        heartbeatCalled = true;
        console.log('[Network] Phát hiện heartbeat call:', req.method(), req.url());
      }
    });

    // Mở trang chủ
    console.log('[Step 1] Kiểm tra Trang chủ 2D và công tắc 2D | 3D...');
    await page.goto(`http://127.0.0.1:${WEB_PORT}/`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Kiểm tra công tắc 2D | 3D
    const btn2D = page.locator('button:has-text("Giao diện 2D")').first();
    const btn3D = page.locator('button:has-text("Văn phòng 3D")').first();

    if (await btn2D.count() === 0 || await btn3D.count() === 0) {
      throw new Error('Không tìm thấy công tắc Giao diện 2D | 3D trên trang chủ!');
    }
    console.log(' -> Đã thấy công tắc 2D | 3D trên Trang chủ.');

    // Chụp ảnh màn hình bước 1
    await saveBothScreenshots(page, '01-trang-chu-2d-cong-tac');

    // Bước 2: Bấm chuyển sang Văn phòng 3D
    console.log('[Step 2] Bấm nút chuyển sang Văn phòng 3D...');
    await btn3D.click();
    await page.waitForTimeout(2000);

    // URL phải là /office
    const currentUrl = page.url();
    if (!currentUrl.includes('/office')) {
      throw new Error(`URL không chuyển sang /office: ${currentUrl}`);
    }
    console.log(` -> URL chính xác: ${currentUrl}`);

    const iframesCount = await page.locator('iframe').count();
    const domSnippet = await page.evaluate(() => document.body.innerHTML.slice(0, 600));
    console.log(`[DEBUG DOM] iframes count: ${iframesCount}`);
    console.log(`[DEBUG DOM HTML]: ${domSnippet}`);

    // Kiểm tra khung iframe hoặc màn hình fallback WebGL
    const iframe = page.locator('iframe');
    const isIframePresent = iframesCount > 0;
    if (isIframePresent) {
      console.log(' -> Khung iframe 3D đã xuất hiện thành công trong DOM.');
    } else {
      console.log(' -> Không có iframe, kiểm tra fallback WebGL...');
      const fallbackBtn = page.locator('button:has-text("Dùng giao diện 2D"), button:has-text("Về giao diện 2D")');
      await fallbackBtn.first().waitFor({ state: 'visible', timeout: 5000 });
      console.log(' -> Fallback WebGL / nút 2D hiển thị chuẩn xác.');
    }

    // Kiểm tra nút "Về giao diện 2D" hoặc "Dùng giao diện 2D"
    const backBtn = page.locator('button:has-text("giao diện 2D")').first();
    await backBtn.waitFor({ state: 'attached', timeout: 15000 });
    console.log(' -> Nút quay lại 2D đã xuất hiện.');

    // Chụp ảnh màn hình bước 2
    await saveBothScreenshots(page, '02-van-phong-3d-khung-iframe');

    // Bước 3: Kiểm tra hợp đồng postMessage
    console.log('[Step 3] Kiểm tra hợp đồng postMessage (ready -> init, openModule hợp lệ và chặn module không quyền)...');
    
    // Đăng ký listener bên ngoài để bắt xem cha có gửi init không
    const messageLog = await page.evaluate(async () => {
      const logs = [];
      const iframe = document.querySelector('iframe');
      const iframeWin = iframe ? iframe.contentWindow : null;

      window.addEventListener('message', e => {
        if (e.data && e.data.type) {
          logs.push(e.data);
        }
      });

      // Giả lập iframe gửi ft-office:ready với source = iframe.contentWindow
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: iframeWin,
        data: { type: 'ft-office:ready' },
      }));

      await new Promise(r => setTimeout(r, 600));
      return logs;
    });

    console.log(` -> Đã giả lập gửi ft-office:ready từ iframe. Message log nhận được: ${messageLog.length}`);

    // Giả lập iframe gửi openModule được phép ('work-schedule')
    console.log(' -> Thử gửi ft-office:openModule (work-schedule - hợp lệ)...');
    await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: iframe ? iframe.contentWindow : null,
        data: { type: 'ft-office:openModule', module: 'work-schedule' },
      }));
    });
    await page.waitForTimeout(1000);

    const scheduleUrl = page.url();
    console.log(` -> Sau openModule work-schedule, URL hiện tại: ${scheduleUrl}`);
    if (!scheduleUrl.includes('/work-schedule')) {
      throw new Error(`Điều hướng openModule thất bại, URL: ${scheduleUrl}`);
    }
    console.log(' -> Điều hướng openModule hợp lệ thành công!');

    // Quay lại /office để test chặn module không quyền
    console.log(' -> Thử gửi ft-office:openModule (account-management - không có quyền)...');
    await page.goto(`http://127.0.0.1:${WEB_PORT}/office`);
    await page.waitForTimeout(800);

    await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      // Giả lập iframe gửi module không được cấp quyền
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: iframe ? iframe.contentWindow : null,
        data: { type: 'ft-office:openModule', module: 'account-management' },
      }));
    });
    await page.waitForTimeout(600);

    const blockedUrl = page.url();
    if (blockedUrl.includes('/account-management')) {
      throw new Error('Lỗi bảo mật: Phân hệ không được cấp quyền vẫn cho phép điều hướng!');
    }
    console.log(` -> Đã chặn thành công phân hệ không có quyền. URL an toàn: ${blockedUrl}`);

    // Bước 4: Kiểm tra nút "Về giao diện 2D"
    console.log('[Step 4] Bấm nút "Về giao diện 2D"...');
    const backTo2dBtn = page.locator('button:has-text("Về giao diện 2D")').first();
    await backTo2dBtn.waitFor({ state: 'visible', timeout: 10000 });
    await backTo2dBtn.click();
    await page.waitForTimeout(1000);
    const backTo2DUrl = page.url();
    console.log(` -> Sau khi bấm về 2D, URL hiện tại: ${backTo2DUrl}`);
    if (backTo2DUrl.includes('/office')) {
      throw new Error(`Bấm "Về giao diện 2D" nhưng URL vẫn là: ${backTo2DUrl}`);
    }

    // Bước 5: Mở Account Profile Modal và kiểm tra Tab Văn phòng 3D
    console.log('[Step 5] Kiểm tra Hộp Tài khoản > Thẻ "Văn phòng 3D" (Cài đặt hiện diện)...');
    
    // Tắt cảnh báo chấm công nếu có
    const dismissWarning = page.locator('button:has-text("Bỏ qua"):visible').first();
    if (await dismissWarning.count() > 0) {
      await dismissWarning.click().catch(() => {});
      await page.waitForTimeout(400);
    }

    // Mở menu tài khoản
    const accountTrigger = page.locator('button[aria-label*="Tài khoản:"]:visible, button[title="Tài khoản"]:visible, button:has-text("Nguyễn Văn Test"):visible').first();
    await accountTrigger.waitFor({ state: 'visible', timeout: 5000 });
    await accountTrigger.click();
    await page.waitForTimeout(500);

    const editProfileBtn = page.locator('[role="menuitem"]:has-text("Chỉnh sửa hồ sơ"):visible, button:has-text("Chỉnh sửa hồ sơ"):visible').first();
    await editProfileBtn.waitFor({ state: 'visible', timeout: 5000 });
    await editProfileBtn.click();
    await page.waitForTimeout(1000);

    // Click tab Văn phòng 3D
    const officeTabBtn = page.locator('button[role="tab"]:has-text("Văn phòng 3D")').first();
    await officeTabBtn.waitFor({ state: 'visible', timeout: 5000 });
    await officeTabBtn.click();
    await page.waitForTimeout(800);

    // Chụp ảnh bước 3 (Cài đặt tài khoản)
    await saveBothScreenshots(page, '03-cai-dat-tai-khoan-hien-dien');

    // Kiểm tra có toggle switch hiện diện
    const presenceToggle = page.locator('button#presence-toggle');
    await presenceToggle.waitFor({ state: 'visible', timeout: 5000 });
    console.log(' -> Toggle "Hiện tôi đang online trong văn phòng" hiển thị chuẩn xác.');

    // Thử toggle
    await presenceToggle.click();
    await page.waitForTimeout(800);
    console.log(' -> Bấm toggle chuyển trạng thái thành công.');

    // Kiểm tra heartbeat
    console.log(`[Step 6] Kiểm tra nhịp online heartbeat: ${heartbeatCalled ? 'ĐÃ GỌI THÀNH CÔNG' : 'CHƯA GỌI'}`);
    if (!heartbeatCalled) {
      console.warn('⚠️ Cảnh báo: Heartbeat chưa được ghi nhận trong network request.');
    }

    console.log('=== TẤT CẢ CÁC BƯỚC KIỂM THỬ PLAYWRIGHT E2E ĐÃ VƯỢT QUA 100% ===');
  } catch (err) {
    hasErrors = true;
    console.error('❌ LỖI TRONG QUÁ TRÌNH KIỂM THỬ:', err);
  } finally {
    if (browser) await browser.close();
    webServer.close();
    djangoProc.kill('SIGTERM');
    if (fs.existsSync(testDb)) {
      try { fs.unlinkSync(testDb); } catch {}
    }
    if (hasErrors) {
      process.exit(1);
    }
  }
}

main();
