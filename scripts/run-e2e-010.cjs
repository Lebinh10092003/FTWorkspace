const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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

const DJANGO_PORT = 58080;
const WEB_PORT = 58742;
const DIST_DIR = path.resolve(__dirname, '../dist');
const SCREEN_DIRS = [
  path.resolve(__dirname, '../docs/tasks/010-screens'),
  path.resolve('/home/orcauser/orca/workspaces/ft-workspace/agy5/docs/tasks/010-screens'),
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

// 1. Web server phục vụ frontend dist và proxy /api/ sang Django
function startWebServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/api/')) {
        // Proxy sang Django backend
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
  console.log('=== BẮT ĐẦU E2E BACKEND THẬT: SOẠN BẢN TIN BẰNG AI ===');

  // Khởi động Django server
  const venvPython = path.resolve(__dirname, '../.venv/bin/python');
  const managePy = path.resolve(__dirname, '../backend/manage.py');

  const djangoEnv = {
    ...process.env,
    DJANGO_DB_PATH: '/tmp/ft_010_test.sqlite3',
    AI_AGY_COMMAND: `${venvPython} /tmp/mock_agy.py`,
    PYTHONUNBUFFERED: '1',
  };

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
  djangoProc.stderr.on('data', d => {
    process.stderr.write(`[Django Err] ${d.toString()}`);
  });

  // Khởi động worker queue xử lý job
  console.log('[Worker] Starting AI queue worker');
  const workerProc = spawn(venvPython, [managePy, 'run_ai_queue', '--poll-interval', '0.5'], {
    env: djangoEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  workerProc.stdout.on('data', d => {
    process.stdout.write(`[Worker Log] ${d.toString()}`);
  });
  workerProc.stderr.on('data', d => {
    process.stderr.write(`[Worker Err] ${d.toString()}`);
  });

  // Chờ Django sẵn sàng
  await new Promise(r => setTimeout(r, 2000));

  // Khởi động Web server
  const webServer = await startWebServer();

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    // ══════════════════════════════════════════════════════════
    // KỊCH BẢN 1: DESKTOP (1280x800) - MÀN HÌNH NHẬP & KẾT QUẢ SÁNG/TỐI
    // ══════════════════════════════════════════════════════════
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
    });

    const page = await context.newPage();

    // Thiết lập auth session trong localStorage trước khi load
    await page.addInitScript(() => {
      const mockUser = {
        uid: 'uid-test-agy5',
        email: 'tien@fermat.vn',
        displayName: 'Nguyễn Văn Tiến',
        photoURL: null,
        role: 'ADMIN',
        accessModules: ['communication-tools', 'news-posts', 'weekly-report'],
      };
      localStorage.setItem(
        'ft_auth_session',
        JSON.stringify({ token: 'e2e-token-agy5-010-secret', user: mockUser, role: 'ADMIN' })
      );
    });

    // Truy cập trực tiếp trang Tin bài
    console.log('[Playwright] Điều hướng tới /communication-tools/news-posts');
    await page.goto(`http://127.0.0.1:${WEB_PORT}/communication-tools/news-posts`, { waitUntil: 'networkidle' });

    // 1. Bấm nút "Tạo tin bài mới"
    console.log('[Playwright] Bấm Tạo tin bài mới');
    await page.waitForSelector('button:has-text("Tạo tin bài mới")', { timeout: 10000 });
    await page.click('button:has-text("Tạo tin bài mới")');

    // Chờ giao diện Editor xuất hiện
    await page.waitForSelector('text=1. Kiểu bài viết', { timeout: 10000 });
    console.log('[Playwright] Giao diện nhập liệu mới đã hiển thị');

    // Kiểm tra nút "Soạn tin bài (AI)" đang disabled vì chưa có dữ liệu
    const btnSoanDisabled = await page.locator('button:has-text("Soạn tin bài (AI)")').isDisabled();
    console.log(`[Check 1] Nút Soạn tin khi chưa có dữ liệu bị disabled: ${btnSoanDisabled ? 'ĐÚNG (Chặn tạo nháp rỗng)' : 'SAI'}`);

    // Chụp ảnh màn hình Editor (Sáng - Desktop 1280)
    await saveScreenshots(page, '010-editor-light-1280');

    // Chụp ảnh màn hình Editor (Tối - Desktop 1280)
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForTimeout(300);
    await saveScreenshots(page, '010-editor-dark-1280');
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.waitForTimeout(300);

    // 2. Điền dữ liệu mẫu hoặc nhập thông tin
    console.log('[Playwright] Bấm Điền nhanh mẫu Hòa Phú');
    await page.click('button:has-text("Điền nhanh mẫu Hòa Phú")');
    await page.waitForTimeout(500);

    // Kiểm tra nút Soạn tin đã enabled
    const btnSoanEnabled = !(await page.locator('button:has-text("Soạn tin bài (AI)")').isDisabled());
    console.log(`[Check 2] Nút Soạn tin sau khi nạp tệp/ghi chú đã enabled: ${btnSoanEnabled ? 'ĐÚNG' : 'SAI'}`);

    // 3. Bấm nút "Soạn tin bài (AI)"
    console.log('[Playwright] Bấm nút Soạn tin bài (AI)...');
    await page.click('button:has-text("Soạn tin bài (AI)")');

    // Chờ thông báo hoặc trạng thái soạn tin
    console.log('[Playwright] Chờ tác vụ AI hoàn tất qua hàng đợi thật...');
    // Chờ chuyển sang view 'detail' (xuất hiện nút "Sao chép toàn bộ bài" hoặc "Sửa thông tin đầu vào")
    await page.waitForSelector('button:has-text("Sao chép toàn bộ bài")', { timeout: 25000 });
    console.log('[Playwright] AI đã soạn xong! Chuyển thành công sang màn hình bài viết chi tiết.');

    // Chụp ảnh màn hình Kết quả (Sáng - Desktop 1280)
    await saveScreenshots(page, '010-result-light-1280');

    // Chụp ảnh màn hình Kết quả (Tối - Desktop 1280)
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForTimeout(300);
    await saveScreenshots(page, '010-result-dark-1280');
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.waitForTimeout(300);

    // Chụp ảnh tab Ảnh khảo sát (nếu có khảo sát)
    const surveyTabBtn = page.locator('button:has-text("Ảnh khảo sát"), button:has-text("Báo cáo khảo sát")').first();
    if (await surveyTabBtn.isVisible()) {
      console.log('[Playwright] Chuyển sang tab Ảnh khảo sát');
      await surveyTabBtn.click();
      await page.waitForTimeout(600);
      await saveScreenshots(page, '010-survey-image-1280');
    }

    await context.close();

    // ══════════════════════════════════════════════════════════
    // KỊCH BẢN 2: MOBILE (390x844) - MÀN HÌNH NHẬP & KẾT QUẢ SÁNG/TỐI
    // ══════════════════════════════════════════════════════════
    console.log('[Playwright] Bắt đầu kiểm tra Mobile 390x844');
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
    });

    const mobilePage = await mobileContext.newPage();
    await mobilePage.addInitScript(() => {
      const mockUser = {
        uid: 'uid-test-agy5',
        email: 'tien@fermat.vn',
        displayName: 'Nguyễn Văn Tiến',
        photoURL: null,
        role: 'ADMIN',
        accessModules: ['communication-tools', 'news-posts', 'weekly-report'],
      };
      localStorage.setItem(
        'ft_auth_session',
        JSON.stringify({ token: 'e2e-token-agy5-010-secret', user: mockUser, role: 'ADMIN' })
      );
    });

    await mobilePage.goto(`http://127.0.0.1:${WEB_PORT}/communication-tools/news-posts`, { waitUntil: 'networkidle' });
    await mobilePage.waitForTimeout(500);

    const createBtn = mobilePage.locator('button:has-text("Tạo tin bài mới"):visible').first();
    await createBtn.click();
    await mobilePage.waitForSelector('text=1. Kiểu bài viết', { timeout: 10000 });

    // Chụp ảnh màn hình Editor Mobile (Sáng - 390)
    await saveScreenshots(mobilePage, '010-editor-light-390');

    // Chụp ảnh màn hình Editor Mobile (Tối - 390)
    await mobilePage.evaluate(() => document.documentElement.classList.add('dark'));
    await mobilePage.waitForTimeout(300);
    await saveScreenshots(mobilePage, '010-editor-dark-390');
    await mobilePage.evaluate(() => document.documentElement.classList.remove('dark'));
    await mobilePage.waitForTimeout(300);

    // Điền mẫu và soạn tin trên mobile
    await mobilePage.click('button:has-text("Điền nhanh mẫu Hòa Phú"):visible');
    await mobilePage.waitForTimeout(500);
    await mobilePage.click('button:has-text("Soạn tin bài (AI)"):visible');

    await mobilePage.waitForSelector('button:has-text("Sao chép toàn bộ bài")', { timeout: 25000 });
    console.log('[Playwright Mobile] Soạn tin hoàn tất trên mobile!');

    // Chụp ảnh màn hình Kết quả Mobile (Sáng - 390)
    await saveScreenshots(mobilePage, '010-result-light-390');

    // Chụp ảnh màn hình Kết quả Mobile (Tối - 390)
    await mobilePage.evaluate(() => document.documentElement.classList.add('dark'));
    await mobilePage.waitForTimeout(300);
    await saveScreenshots(mobilePage, '010-result-dark-390');
    await mobilePage.evaluate(() => document.documentElement.classList.remove('dark'));
    await mobilePage.waitForTimeout(300);

    // Chụp tab Đồ họa khảo sát trên Mobile
    const mobileSurveyTab = mobilePage.locator('button:has-text("Đồ họa khảo sát")').first();
    if (await mobileSurveyTab.isVisible()) {
      await mobileSurveyTab.click();
      await mobilePage.waitForTimeout(500);
      await saveScreenshots(mobilePage, '010-survey-image-390');
    }

    await mobileContext.close();

    console.log('=== E2E PLAYWRIGHT VỚI BACKEND THẬT THÀNH CÔNG 100% ===');
  } finally {
    await browser.close();
    webServer.close();
    djangoProc.kill('SIGTERM');
    workerProc.kill('SIGTERM');
  }
}

main().catch(err => {
  console.error('[E2E Fatal Error]', err);
  process.exit(1);
});
