const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = 58731;
const DIST_DIR = path.resolve(__dirname, '../dist');
const OUTPUT_DIR = '/home/orcauser/orca/workspaces/ft-workspace/agy/docs/tasks/004-screens';

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

// Simple static server for dist
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
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

    server.listen(PORT, '127.0.0.1', () => {
      console.log(`Static preview server listening on http://127.0.0.1:${PORT}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

function getWeekDates(d = new Date()) {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d);
  monday.setDate(diff);

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const curr = new Date(monday);
    curr.setDate(monday.getDate() + i);
    const y = curr.getFullYear();
    const m = String(curr.getMonth() + 1).padStart(2, '0');
    const dayNum = String(curr.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${dayNum}`);
  }
  return dates;
}

async function capture() {
  const server = await startServer();
  const weekDates = getWeekDates(new Date());
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  console.log(`Today: ${todayStr}, Week: ${weekDates[0]} -> ${weekDates[6]}`);

  // Mock schedule items
  const mockItems = [
    {
      id: 'task-1',
      title: 'Họp giao ban đầu tuần phòng Công nghệ & rà soát tiến độ Hướng A',
      date: weekDates[0],
      status: 'DONE',
      startTime: '08:30',
      endTime: '09:30',
    },
    {
      id: 'task-2',
      title: 'Cập nhật giao diện Hướng A Navy FT và thanh điều hướng đa nền tảng',
      date: todayStr,
      status: 'IN_PROGRESS',
      startTime: '09:45',
      endTime: '11:45',
    },
    {
      id: 'task-3',
      title: 'Đánh giá chỉ tiêu chấm công tự động và kiểm tra tính năng đếm ngược báo cáo tuần',
      date: todayStr,
      status: 'TODO',
      startTime: '14:00',
      endTime: '15:30',
    },
    {
      id: 'task-4',
      title: 'Kiểm thử Playwright và chuẩn bị báo cáo tiến độ chi tiết cho Claude',
      date: todayStr,
      status: 'DUE_SOON',
      startTime: '16:00',
      endTime: '17:15',
    },
    {
      id: 'task-5',
      title: 'Rà soát dữ liệu thí sinh Khảo thí chuẩn bị kỳ thi quốc tế tuần tới',
      date: weekDates[3] || todayStr,
      status: 'TODO',
      startTime: '09:00',
      endTime: '11:00',
    },
    {
      id: 'task-6',
      title: 'Tổng hợp báo cáo tuần 43 và lập kế hoạch mục tiêu tuần 44',
      date: weekDates[4] || todayStr,
      status: 'DUE_SOON',
      startTime: '15:30',
      endTime: '16:45',
    },
  ];

  const browser = await chromium.launch({
    headless: true,
  });

  const targets = [
    {
      name: 'desktop-home-1440.png',
      width: 1440,
      height: 900,
      isMobile: false,
    },
    {
      name: 'mobile-home-390.png',
      width: 390,
      height: 844,
      isMobile: true,
    },
    {
      name: 'mobile-home-360.png',
      width: 360,
      height: 780,
      isMobile: true,
    },
  ];

  for (const t of targets) {
    const context = await browser.newContext({
      viewport: { width: t.width, height: t.height },
      deviceScaleFactor: 2,
      isMobile: t.isMobile,
      hasTouch: t.isMobile,
    });

    const page = await context.newPage();

    // Intercept APIs
    await page.route('**/api/**', async route => {
      const url = route.request().url();
      if (url.includes('/api/work-schedule/items')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: mockItems }),
        });
      }
      if (url.includes('/api/attendance/timesheet/prefill')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            existing: [
              {
                shiftStart: '08:15',
                shiftEnd: '17:30',
                workType: 'Tại văn phòng',
                status: 'Đúng giờ',
              },
            ],
          }),
        });
      }
      if (url.includes('/api/documents/weekly-reports')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            reports: [
              {
                id: 1,
                completedWeek: 43,
                plannedWeek: 44,
                completedItems: [1, 2, 3, 4, 5, 6],
                plannedItems: [1, 2, 3, 4, 5],
                status: 'DRAFT',
                plannedWarning: '',
              },
            ],
          }),
        });
      }
      // Default empty/success for other apis
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    // Seed localStorage auth session before navigation
    await page.addInitScript(() => {
      localStorage.setItem(
        'ft_auth_session',
        JSON.stringify({
          token: 'mock-token-secret-free',
          user: {
            email: 'binhlt@fermat.vn',
            displayName: 'Lê Bình',
            photoURL: null,
            accessModules: ['all'],
            departments: [{ name: 'Công nghệ' }],
            jobTitle: { name: 'Kỹ sư phần mềm' },
          },
          role: 'ADMIN',
        })
      );
      sessionStorage.setItem('timesheet_dismiss_yesterday', '1');
    });

    console.log(`Navigating to http://127.0.0.1:${PORT} (${t.width}x${t.height})...`);
    await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' });

    // Wait for Trang chủ elements
    await page.waitForSelector('h1', { timeout: 10000 });
    await page.waitForTimeout(1000); // Wait for fonts and transitions to settle

    const outPath = path.join(OUTPUT_DIR, t.name);
    await page.screenshot({ path: outPath, fullPage: false });
    console.log(`Saved screenshot: ${outPath} (${fs.statSync(outPath).size} bytes)`);

    // Verify horizontal overflow
    const overflowCheck = await page.evaluate(() => {
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      };
    });
    console.log(`Overflow check for ${t.name}:`, overflowCheck);

    await context.close();
  }

  await browser.close();
  server.close();
  console.log('Capture completed successfully!');
}

capture().catch(err => {
  console.error('Error during capture:', err);
  process.exit(1);
});
