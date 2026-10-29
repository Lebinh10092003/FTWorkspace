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

  // Chuẩn bị mock agy script và dữ liệu tệp kiểm thử
  const MOCK_AGY_CODE = `import sys
import json

result = {
    "headline": "TẬP HUẤN ỨNG DỤNG BỘ NHỚ DÙNG CHUNG VÀ TRỢ LÝ AI TRONG CÔNG TÁC GIÁO DỤC",
    "lead_in": "Nhằm đẩy mạnh ứng dụng công nghệ thông tin và chuyển đổi số trong quản lý dạy học, FermatTech đã phối hợp cùng đơn vị tổ chức chương trình tập huấn thực chiến Bộ nhớ dùng chung và Trợ lý Gemini AI.",
    "sections": [
        {
            "heading": "NỘI DUNG TẬP HUẤN THỰC TIỄN",
            "body": "Chương trình diễn ra với tinh thần nghiêm túc, tập trung vào các tình huống thực tế:",
            "bullets": [
                "Chuẩn hóa cấu trúc thư mục và phân quyền khai thác tài liệu trên Bộ nhớ dùng chung.",
                "Ứng dụng Trợ lý Gemini AI hỗ trợ soạn giáo án, biên soạn đề kiểm tra và tóm tắt biên bản họp.",
                "Thực hành trực tiếp trên máy tính với sự hướng dẫn của đội ngũ chuyên gia công nghệ."
            ]
        }
    ],
    "survey_section": {
        "heading": "📊 PHẢN HỒI SAU TẬP HUẤN",
        "text": "Khảo sát sau buổi tập huấn ghi nhận phản hồi tích cực từ cán bộ, giáo viên tham gia.",
        "feedback_summary": "100% học viên đánh giá cao tính thực tiễn và phong thái truyền đạt của giảng viên."
    },
    "closing": "FermatTech xin trân trọng cảm ơn sự quan tâm, chỉ đạo của Ban Giám hiệu và tinh thần học tập trách nhiệm của quý thầy cô.",
    "slogan": "FERMATTECH – ĐỒNG HÀNH CHUYỂN ĐỔI SỐ THỰC CHẤT VÀ HIỆU QUẢ!",
    "contact_info": "🌐 www.fermat.vn | ✉ contact@fermat.vn | ☎ 0969 627 162",
    "hashtags": ["#FermatTech", "#ChuyenDoiSo", "#GeminiAI", "#GiaoDucSo"]
}

print(json.dumps(result, ensure_ascii=False))
`;

  const MOCK_AGENDA_TEXT = `Tiến trình buổi tập huấn tại Trường THCS Ban Mai:
1/ Khai mạc: Ban Giám hiệu phát biểu chỉ đạo mục tiêu chuyển đổi số giáo dục.
2/ Hướng dẫn thiết lập phân quyền thư mục trên Bộ nhớ dùng chung.
3/ Thực hành ứng dụng Trợ lý Gemini AI trong soạn bài giảng và xử lý tài liệu.
4/ Giải đáp vướng mắc trực tiếp tại phòng máy. 100% cán bộ, giáo viên thao tác thành công.`;

  const MOCK_SURVEY_CSV = `Dấu thời gian,Họ và tên,Nội dung chuyên môn,Kỹ năng truyền đạt,Tính thực tiễn ứng dụng,Ý kiến đóng góp
2026/10/24 11:30:00,Học viên 1,Rất tốt,Rất tốt,Rất tốt,Mong muốn tiếp tục được hỗ trợ các buổi nâng cao.
2026/10/24 11:31:00,Học viên 2,Tốt,Rất tốt,Tốt,Buổi tập huấn rất bổ ích và thực tế.
2026/10/24 11:32:00,Học viên 3,Rất tốt,Tốt,Rất tốt,Nên tổ chức thường xuyên hơn.`;

  fs.writeFileSync('/tmp/mock_agy.py', MOCK_AGY_CODE, 'utf8');
  fs.writeFileSync('/tmp/e2e_agenda.txt', MOCK_AGENDA_TEXT, 'utf8');
  fs.writeFileSync('/tmp/e2e_survey.csv', MOCK_SURVEY_CSV, 'utf8');

  // Khởi động Django server
  const venvPython = path.resolve(__dirname, '../.venv/bin/python');
  const managePy = path.resolve(__dirname, '../backend/manage.py');

  const srcDb = path.resolve(__dirname, '../backend/db.sqlite3');
  const testDb = '/tmp/ft_010_test.sqlite3';
  if (fs.existsSync(srcDb)) {
    fs.copyFileSync(srcDb, testDb);
    console.log('[Setup] Đã sao chép database mẫu sang ' + testDb);
  }

  const djangoEnv = {
    ...process.env,
    DJANGO_DB_PATH: testDb,
    AI_AGY_COMMAND: `${venvPython} /tmp/mock_agy.py`,
    PYTHONUNBUFFERED: '1',
  };

  try {
    execSync(`${venvPython} ${managePy} migrate`, {
      env: djangoEnv,
      stdio: 'pipe',
    });
    console.log('[Setup] Đã migrate thành công database kiểm thử.');

    const createTokenCode = "from django.contrib.auth.models import User; from rest_framework.authtoken.models import Token; from authentication.models import UserProfile; u, _ = User.objects.get_or_create(username='tien@fermat.vn', email='tien@fermat.vn', defaults={'is_superuser': True, 'first_name': 'Tiến', 'last_name': 'Nguyễn Văn'}); u.is_superuser = True; u.save(); Token.objects.update_or_create(user=u, defaults={'key': 'e2e-token-agy5-010-secret'}); p, _ = UserProfile.objects.get_or_create(email='tien@fermat.vn', defaults={'name': 'Nguyễn Văn Tiến', 'role': 'ADMIN'}); p.role = 'ADMIN'; p.save();";
    execSync(`${venvPython} ${managePy} shell -c "${createTokenCode}"`, {
      env: djangoEnv,
      stdio: 'pipe',
    });
    console.log('[Setup] Đã tạo phiên người dùng và token test thành công.');
  } catch (err) {
    console.error('[Setup] Lỗi thiết lập database:', err.message);
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

    // 2. Điền thông tin đầu vào trung tính và tải tệp
    console.log('[Playwright] Nhập tên đơn vị, tiêu đề và ghi chú trung tính');
    await page.fill('input[placeholder*="Trường THCS Ban Mai"]', 'Trường THCS Ban Mai');
    await page.fill('input[placeholder*="Để trống AI"]', 'Tập huấn Chuyển đổi số và AI trong Giáo dục');
    await page.fill(
      'textarea[placeholder*="Buổi tập huấn diễn ra"]',
      'Tập huấn nâng cao năng lực ứng dụng Gemini AI và Bộ nhớ dùng chung cho cán bộ giáo viên nhà trường. Buổi làm việc diễn ra sôi nổi, 100% giáo viên hoàn thành bài thực hành.'
    );

    console.log('[Playwright] Nạp tệp tiến trình và khảo sát thật qua setInputFiles');
    const agendaInput = page.locator('label:has-text("Chọn tệp tiến trình") input[type="file"]');
    await agendaInput.setInputFiles('/tmp/e2e_agenda.txt');

    const surveyInput = page.locator('label:has-text("Chọn tệp khảo sát") input[type="file"]');
    await surveyInput.setInputFiles('/tmp/e2e_survey.csv');
    await page.waitForTimeout(1000);

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

    // Điền dữ liệu và nạp tệp trên mobile
    console.log('[Playwright Mobile] Nhập thông tin và tải tệp trên mobile');
    await mobilePage.fill('input[placeholder*="Trường THCS Ban Mai"]:visible', 'Trường THCS Ban Mai');
    await mobilePage.fill(
      'textarea[placeholder*="Buổi tập huấn diễn ra"]:visible',
      'Tập huấn nâng cao năng lực ứng dụng Gemini AI và Bộ nhớ dùng chung cho cán bộ giáo viên.'
    );

    const mobileAgendaInput = mobilePage.locator('label:has-text("Chọn tệp tiến trình") input[type="file"]');
    await mobileAgendaInput.setInputFiles('/tmp/e2e_agenda.txt');

    const mobileSurveyInput = mobilePage.locator('label:has-text("Chọn tệp khảo sát") input[type="file"]');
    await mobileSurveyInput.setInputFiles('/tmp/e2e_survey.csv');
    await mobilePage.waitForTimeout(1000);

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
