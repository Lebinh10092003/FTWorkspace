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

const DJANGO_PORT = 58082;
const WEB_PORT = 58744;
const DIST_DIR = path.resolve(__dirname, '../dist');
const SCREEN_DIRS = [
  path.resolve('/home/orcauser/orca/workspaces/ft-workspace/agy5/docs/tasks/014-screens'),
  path.resolve(__dirname, '../docs/tasks/014-screens'),
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
  console.log('=== BẮT ĐẦU E2E BACKEND THẬT: BÁO CÁO TUẦN BỔ SUNG TRÊN TRANG (VIỆC 014) ===');

  const MOCK_AGY_CODE = `import sys
import json

result = {
    "completedGroups": [
        {
            "name": "Công nghệ và đào tạo",
            "items": [
                "Nghiên cứu sử dụng tính năng lên lịch tự động làm báo cáo tuần trực tiếp trên trang.",
                "Hoàn thiện thẻ chuẩn bị công việc ở đầu trang và tối ưu giao diện di động (29/10).",
                "Hỗ trợ kỹ thuật cho giáo viên các trường đối tác."
            ]
        },
        {
            "name": "Khó khăn, vướng mắc",
            "items": [
                "Không có khó khăn, vướng mắc đáng kể."
            ]
        }
    ],
    "difficulties": [],
    "plannedGroups": [
        {
            "name": "Công nghệ",
            "items": [
                "Hoàn thiện tính năng tự động theo lịch, xong trong thứ 4.",
                "Triển khai tính năng đính kèm tệp cho báo cáo tuần.",
                "Tích cực cập nhật các công việc liên quan phát sinh (nếu có)."
            ]
        }
    ]
}

print(json.dumps(result, ensure_ascii=False))
`;

  fs.writeFileSync('/tmp/mock_agy_014.py', MOCK_AGY_CODE, 'utf8');

  const venvPython = path.resolve(__dirname, '../.venv/bin/python');
  const managePy = path.resolve(__dirname, '../backend/manage.py');

  const makeDocxCode = `from docx import Document
doc = Document()
doc.add_paragraph('Noi dung tai lieu cong viec bo sung tuan 43:')
doc.add_paragraph('- Hoan thien dua the bo sung truc tiep ra dau trang khong qua popup.')
doc.add_paragraph('- Dang ky ke hoach tuan 44 day du cac ngay.')
doc.save('/tmp/e2e_supplement_014.docx')
`;
  execSync(`${venvPython} -c "${makeDocxCode}"`);
  console.log('[Setup] Đã tạo tệp docx kiểm thử tại /tmp/e2e_supplement_014.docx');

  const srcDb = path.resolve(__dirname, '../backend/db.sqlite3');
  const testDb = '/tmp/ft_014_test.sqlite3';
  if (fs.existsSync(srcDb)) {
    fs.copyFileSync(srcDb, testDb);
    console.log('[Setup] Đã sao chép database mẫu sang ' + testDb);
  }

  const djangoEnv = {
    ...process.env,
    DJANGO_DB_PATH: testDb,
    AI_AGY_COMMAND: `${venvPython} /tmp/mock_agy_014.py`,
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
from work_schedule.models import WorkItem
from datetime import date, timedelta
from documents.weekly_reports import week_start

u, _ = User.objects.get_or_create(username='tien@fermat.vn', email='tien@fermat.vn', defaults={'is_superuser': True})
u.is_superuser = True
u.save()
Token.objects.update_or_create(user=u, defaults={'key': 'e2e-token-agy5-014-secret'})
p, _ = UserProfile.objects.get_or_create(email='tien@fermat.vn', defaults={'name': 'Nguyễn Văn Tiến', 'role': 'ADMIN', 'employment_status': 'ACTIVE'})
p.role = 'ADMIN'
p.employment_status = 'ACTIVE'
p.save()

today = date.today()
monday = week_start(today)
next_monday = monday + timedelta(days=7)

WorkItem.objects.filter(executor=p).delete()
WorkItem.objects.create(creator=p, executor=p, work_date=monday, title="Nghiên cứu đưa thẻ bổ sung ra đầu trang", status="COMPLETED")
WorkItem.objects.create(creator=p, executor=p, work_date=monday + timedelta(days=2), title="Họp kỹ thuật dự án và rà soát giao diện", status="COMPLETED")
WorkItem.objects.create(creator=p, executor=p, work_date=next_monday, title="Hoàn thiện tính năng tự động theo lịch", status="ASSIGNED")
WorkItem.objects.create(creator=p, executor=p, work_date=next_monday + timedelta(days=1), title="Hỗ trợ kỹ thuật các đơn vị", status="ASSIGNED")
WorkItem.objects.create(creator=p, executor=p, work_date=next_monday + timedelta(days=2), title="Kiểm thử hệ thống toàn diện", status="ASSIGNED")
print("Seed data successfully injected")
`;
  fs.writeFileSync('/tmp/seed_e2e_014.py', seedScript, 'utf8');

  try {
    execSync(`${venvPython} ${managePy} migrate`, { env: djangoEnv, stdio: 'pipe' });
    console.log('[Setup] Đã migrate database kiểm thử.');

    execSync(`${venvPython} /tmp/seed_e2e_014.py`, { env: djangoEnv, stdio: 'pipe', cwd: path.resolve(__dirname, '../backend') });
    console.log('[Setup] Đã nạp seed data người dùng và công việc Lịch công tác.');
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
    // KỊCH BẢN 1: DESKTOP (1440x900)
    // ══════════════════════════════════════════════════════════
    console.log('\n--- KỊCH BẢN 1: DESKTOP (1440x900) ---');
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const desktopPage = await desktopContext.newPage();

    await desktopPage.addInitScript(() => {
      const mockUser = {
        uid: 'uid-test-agy5-014',
        email: 'tien@fermat.vn',
        displayName: 'Nguyễn Văn Tiến',
        photoURL: null,
        role: 'ADMIN',
        accessModules: ['communication-tools', 'weekly-report'],
      };
      localStorage.setItem('ft_token', 'e2e-token-agy5-014-secret');
      localStorage.setItem('ft_user_email', 'tien@fermat.vn');
      localStorage.setItem('ft_user_name', 'Nguyễn Văn Tiến');
      localStorage.setItem('ft_user_role', 'ADMIN');
      localStorage.setItem(
        'ft_auth_session',
        JSON.stringify({ token: 'e2e-token-agy5-014-secret', user: mockUser, role: 'ADMIN' })
      );
    });

    await desktopPage.goto(`http://127.0.0.1:${WEB_PORT}/communication-tools/weekly-report`, {
      waitUntil: 'networkidle',
    });
    console.log('[E2E Desktop] Đã mở trang Báo cáo tuần.');

    // Chờ thẻ cố định ở đầu trang xuất hiện
    await desktopPage.waitForSelector('#weekly-report-supplement-card-title');
    await saveScreenshots(desktopPage, '01-desktop-initial-light');

    // 1. Nhập ghi chú bổ sung
    console.log('[E2E Desktop] Nhập ghi chú bổ sung...');
    await desktopPage.fill(
      '#weekly-report-supplement-note',
      'Ghi chú bổ sung: Hoàn thành kiểm thử và đào tạo hệ thống tuần 43 trực tiếp trên trang.'
    );
    await desktopPage.click('button:has-text("Lưu ghi chú")');
    await desktopPage.waitForTimeout(500);

    // 2. Tải lên tệp đính kèm docx
    console.log('[E2E Desktop] Tải lên tệp đính kèm docx...');
    const fileInput = await desktopPage.$('input[type="file"]');
    if (fileInput) {
      await fileInput.setInputFiles('/tmp/e2e_supplement_014.docx');
      await desktopPage.waitForTimeout(1500);
    }

    // 3. Bật công tắc lịch tự động trong thẻ
    console.log('[E2E Desktop] Bật công tắc Lịch tự động trong thẻ...');
    const autoCheckbox = await desktopPage.$('input[type="checkbox"]');
    if (autoCheckbox) {
      const isChecked = await autoCheckbox.isChecked();
      if (!isChecked) {
        await autoCheckbox.check();
        await desktopPage.waitForTimeout(1000);
      }
    }
    await saveScreenshots(desktopPage, '02-desktop-card-configured-light');

    // 4. Bấm nút "Tạo báo cáo tuần" ngay trên thẻ
    console.log('[E2E Desktop] Bấm nút Tạo báo cáo tuần trên thẻ...');
    await desktopPage.click('button:has-text("Tạo báo cáo tuần"):visible');

    // Chờ AI worker xử lý xong và nạp vào editor
    console.log('[E2E Desktop] Đang đợi AI xử lý qua hàng chờ...');
    await desktopPage.waitForSelector('button:has-text("Lưu bản sửa"), button:has-text("Chỉnh sửa")', { timeout: 30000 });
    await desktopPage.waitForTimeout(1000);
    console.log('[E2E Desktop] AI đã xử lý xong và nạp kết quả vào Editor!');

    await saveScreenshots(desktopPage, '03-desktop-editor-populated-light');

    // Chuyển sang dark mode trên desktop
    await desktopPage.evaluate(() => document.documentElement.classList.add('dark'));
    await desktopPage.waitForTimeout(500);
    await saveScreenshots(desktopPage, '04-desktop-editor-populated-dark');
    await desktopPage.evaluate(() => document.documentElement.classList.remove('dark'));

    await desktopContext.close();

    // ══════════════════════════════════════════════════════════
    // KỊCH BẢN 2: MOBILE (390x844)
    // ══════════════════════════════════════════════════════════
    console.log('\n--- KỊCH BẢN 2: MOBILE (390x844) ---');
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobileContext.newPage();

    await mobilePage.addInitScript(() => {
      const mockUser = {
        uid: 'uid-test-agy5-014',
        email: 'tien@fermat.vn',
        displayName: 'Nguyễn Văn Tiến',
        photoURL: null,
        role: 'ADMIN',
        accessModules: ['communication-tools', 'weekly-report'],
      };
      localStorage.setItem('ft_token', 'e2e-token-agy5-014-secret');
      localStorage.setItem('ft_user_email', 'tien@fermat.vn');
      localStorage.setItem('ft_user_name', 'Nguyễn Văn Tiến');
      localStorage.setItem('ft_user_role', 'ADMIN');
      localStorage.setItem(
        'ft_auth_session',
        JSON.stringify({ token: 'e2e-token-agy5-014-secret', user: mockUser, role: 'ADMIN' })
      );
    });

    await mobilePage.goto(`http://127.0.0.1:${WEB_PORT}/communication-tools/weekly-report`, {
      waitUntil: 'networkidle',
    });
    console.log('[E2E Mobile] Đã mở trang Báo cáo tuần trên Mobile 390px.');

    // Chờ thẻ cố định ở đầu trang xuất hiện trên Mobile
    await mobilePage.waitForSelector('#weekly-report-supplement-card-title');
    await saveScreenshots(mobilePage, '05-mobile-initial-light');

    // Chụp dark mode trên mobile
    await mobilePage.evaluate(() => document.documentElement.classList.add('dark'));
    await mobilePage.waitForTimeout(500);
    await saveScreenshots(mobilePage, '06-mobile-initial-dark');
    await mobilePage.evaluate(() => document.documentElement.classList.remove('dark'));

    // Thử truy cập qua link thông báo nhắc nhở kèm query param ?week_start=
    const currentWeekStart = await mobilePage.$eval('#weekly-report-week-select', el => el.value);
    console.log(`[E2E Mobile] Kiểm tra deeplink thông báo nhắc với week_start=${currentWeekStart}...`);
    await mobilePage.goto(`http://127.0.0.1:${WEB_PORT}/communication-tools/weekly-report?week_start=${encodeURIComponent(currentWeekStart)}`, {
      waitUntil: 'networkidle',
    });
    await mobilePage.waitForSelector('#weekly-report-supplement-card-title');
    await saveScreenshots(mobilePage, '07-mobile-reminder-deeplink-light');

    await mobileContext.close();

    console.log('\n=== E2E VIỆC 014 BACKEND THẬT HOÀN TẤT THÀNH CÔNG 100%! ===');
  } catch (err) {
    console.error('\n[E2E Lỗi]', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    webServer.close();
    djangoProc.kill('SIGKILL');
    workerProc.kill('SIGKILL');
    console.log('[Cleanup] Đã dọn dẹp các tiến trình backend và server.');
  }
}

main().catch(err => {
  console.error('[Main Error]', err);
  process.exit(1);
});
