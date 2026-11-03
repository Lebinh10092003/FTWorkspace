/**
 * Playwright E2E Test cho Việc 033:
 * Kiểm tra trạng thái "đang làm" / "rảnh" (idle) của nhân sự trong văn phòng 3D.
 *
 * Kiểm tra:
 * 1. Khi vừa mở app: gửi heartbeat { idle: false } (trạng thái working).
 * 2. Không thao tác > 5 phút (giả lập đồng hồ context.clock.fastForward):
 *    gửi ngay heartbeat { idle: true } (trạng thái idle).
 * 3. Người dùng thao tác lại (chuột/phím):
 *    gửi ngay heartbeat { idle: false } tức thì (trạng thái working).
 * 4. Kiểm tra API GET /api/office/roster/ phản ánh đúng trường status ('working'/'idle').
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { chromium } = require('playwright');

const DIST_DIR = path.resolve(__dirname, '../dist');
const WEB_PORT = 58754;
const DJANGO_PORT = 58094;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function startWebServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // 1. Proxy API sang Django
      if (req.url.startsWith('/api/')) {
        const proxyReq = http.request({
          host: '127.0.0.1',
          port: DJANGO_PORT,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: `127.0.0.1:${DJANGO_PORT}` },
        }, proxyRes => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res, { end: true });
        });
        proxyReq.on('error', err => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Proxy error', detail: err.message }));
        });
        req.pipe(proxyReq, { end: true });
        return;
      }

      // 2. Static files
      let reqPath = req.url.split('?')[0];
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

      // SPA fallback
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

async function main() {
  console.log('=== BẮT ĐẦU E2E KIỂM THỬ: VIỆC 033 TRẠNG THÁI WORKING / IDLE ===');

  const venvPython = path.resolve(__dirname, '../.venv/bin/python');
  const managePy = path.resolve(__dirname, '../backend/manage.py');

  const testDb = '/tmp/ft_033_test.sqlite3';
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

user = User.objects.create_user(username="nv_033@fermat.test", email="nv_033@fermat.test", password="Password@123")
dept = Department.objects.create(name="Phòng Công nghệ", code="TECH")
title = JobTitle.objects.create(name="Lập trình viên")
profile, _ = UserProfile.objects.get_or_create(
    email="nv_033@fermat.test",
    defaults={
        "name": "Nguyễn Văn Idle Test",
        "role": "EMPLOYEE",
        "employment_status": "ACTIVE",
        "department": dept,
        "job_title": title,
    }
)
OfficeSeat.objects.create(user=profile, room="tech", seat_index=2, is_head=False)
OfficePresence.objects.create(user=profile, is_idle=False, show_presence=True)

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

    // Cài đặt đồng hồ ảo Playwright Clock
    await context.clock.install({ time: new Date() });

    // Đặt session đăng nhập vào localStorage
    await context.addInitScript(({ tokenVal }) => {
      const session = {
        token: tokenVal,
        user: {
          uid: 'nv_033@fermat.test',
          email: 'nv_033@fermat.test',
          displayName: 'Nguyễn Văn Idle Test',
          accessModules: ['work-schedule', 'attendance'],
        },
        role: 'EMPLOYEE',
      };
      localStorage.setItem('ft_auth_session', JSON.stringify(session));
    }, { tokenVal: token });

    const heartbeatPayloads = [];

    const page = await context.newPage();

    page.on('request', req => {
      if (req.url().includes('/api/office/heartbeat/')) {
        try {
          const postData = req.postDataJSON();
          heartbeatPayloads.push(postData);
          console.log(`[Network Heartbeat Call #${heartbeatPayloads.length}]:`, postData);
        } catch {
          heartbeatPayloads.push({});
        }
      }
    });

    // Bước 1: Mở trang web -> Gửi nhịp đầu tiên khi mở app
    console.log('[Step 1] Mở ứng dụng, kiểm tra heartbeat ban đầu (working: idle=false)...');
    await page.goto(`http://127.0.0.1:${WEB_PORT}/`);
    await page.waitForTimeout(1000);

    if (heartbeatPayloads.length === 0) {
      throw new Error('Chưa nhận được heartbeat ban đầu khi mở app!');
    }
    const firstPayload = heartbeatPayloads[0];
    if (firstPayload.idle !== false) {
      throw new Error(`Heartbeat ban đầu mong đợi { idle: false }, nhận được: ${JSON.stringify(firstPayload)}`);
    }
    console.log(' -> PASS: Heartbeat ban đầu gửi đúng { idle: false }.');

    // Bước 2: Giả lập không thao tác quá 5 phút
    console.log('[Step 2] Giả lập không thao tác quá 5 phút (fast forward 5m01s)...');
    const beforeCount = heartbeatPayloads.length;
    // Nhảy đồng hồ qua 5 phút 1 giây
    await context.clock.fastForward(5 * 60 * 1000 + 1000);
    await page.waitForTimeout(500);

    if (heartbeatPayloads.length <= beforeCount) {
      throw new Error('Sau 5 phút không thao tác, không có heartbeat idle được gửi đi!');
    }
    const idlePayload = heartbeatPayloads[heartbeatPayloads.length - 1];
    if (idlePayload.idle !== true) {
      throw new Error(`Heartbeat sau 5 phút mong đợi { idle: true }, nhận được: ${JSON.stringify(idlePayload)}`);
    }
    console.log(' -> PASS: Sau 5 phút không thao tác, heartbeat gửi ngay { idle: true }.');

    // Kiểm tra API roster trên backend phản ánh trạng thái idle
    const resRosterIdle = await page.evaluate(async (tok) => {
      const res = await fetch('/api/office/roster/', {
        headers: { Authorization: `Bearer ${tok}` }
      });
      return await res.json();
    }, token);

    const myRosterIdle = resRosterIdle.roster.find(m => m.is_me);
    if (!myRosterIdle || myRosterIdle.status !== 'idle') {
      throw new Error(`API Roster mong đợi status="idle", nhận được: ${myRosterIdle ? myRosterIdle.status : 'null'}`);
    }
    console.log(' -> PASS: Backend roster xác nhận status="idle".');

    // Bước 3: Người dùng thao tác lại (chuột / phím)
    console.log('[Step 3] Người dùng thao tác lại (nhấn phím)...');
    const beforeActionCount = heartbeatPayloads.length;
    await page.keyboard.press('Control');
    await page.waitForTimeout(500);

    if (heartbeatPayloads.length <= beforeActionCount) {
      throw new Error('Khi người dùng thao tác lại, không có heartbeat gửi ngay!');
    }
    const resumePayload = heartbeatPayloads[heartbeatPayloads.length - 1];
    if (resumePayload.idle !== false) {
      throw new Error(`Heartbeat sau khi thao tác lại mong đợi { idle: false }, nhận được: ${JSON.stringify(resumePayload)}`);
    }
    console.log(' -> PASS: Người dùng thao tác lại -> gửi ngay tức thì { idle: false }.');

    // Kiểm tra API roster trên backend chuyển lại working
    const resRosterWorking = await page.evaluate(async (tok) => {
      const res = await fetch('/api/office/roster/', {
        headers: { Authorization: `Bearer ${tok}` }
      });
      return await res.json();
    }, token);

    const myRosterWorking = resRosterWorking.roster.find(m => m.is_me);
    if (!myRosterWorking || myRosterWorking.status !== 'working') {
      throw new Error(`API Roster mong đợi status="working", nhận được: ${myRosterWorking ? myRosterWorking.status : 'null'}`);
    }
    console.log(' -> PASS: Backend roster xác nhận status="working".');

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
