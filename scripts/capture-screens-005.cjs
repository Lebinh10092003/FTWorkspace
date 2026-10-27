const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = 58732;
const DIST_DIR = path.resolve(__dirname, '../dist');
const OUTPUT_DIRS = [
  path.resolve('/home/orcauser/orca/workspaces/ft-workspace/agy/docs/tasks/005-screens'),
  path.resolve('/home/orcauser/orca/workspaces/ft-workspace/agy5/docs/tasks/005-screens'),
];

OUTPUT_DIRS.forEach(d => fs.mkdirSync(d, { recursive: true }));

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
      console.log(`Preview server listening on http://127.0.0.1:${PORT}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

function getWeekDates(d = new Date()) {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
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

  const realMockItems = [
    {
      id: 101,
      title: '09:30: Qua làm việc với đối tác Gimasys tại cơ sở Trần Hưng Đạo',
      date: todayStr,
      startTime: '09:30',
      endTime: '11:00',
      status: 'IN_PROGRESS',
      displayTitle: 'Qua làm việc với đối tác Gimasys tại cơ sở Trần Hưng Đạo',
      displayStatus: 'in_progress',
      executor: { name: 'Lê Bình', email: 'binhlt@fermat.vn' },
      supporters: [],
      priority: 'high',
      canEdit: true,
      canDelete: true,
    },
    {
      id: 102,
      title: '15:00-16:00 (giờ Việt Nam): Họp trực tuyến với Gimasys về triển khai hạ tầng Workspace … Meet: https://meet.google.com/abc-defg-hij',
      date: todayStr,
      startTime: '15:00',
      endTime: '16:00',
      status: 'TODO',
      displayTitle: 'Họp trực tuyến với Gimasys về triển khai hạ tầng Workspace',
      displayStatus: 'todo',
      executor: { name: 'Lê Bình', email: 'binhlt@fermat.vn' },
      supporters: [],
      priority: 'medium',
      canEdit: true,
      canDelete: true,
    },
    {
      id: 103,
      title: '16:30 - Rà soát dữ liệu chấm công và duyệt danh sách ca coi thi cuối tuần',
      date: todayStr,
      startTime: '16:30',
      endTime: '17:30',
      status: 'TODO',
      displayTitle: 'Rà soát dữ liệu chấm công và duyệt danh sách ca coi thi cuối tuần',
      displayStatus: 'todo',
      executor: { name: 'Lê Bình', email: 'binhlt@fermat.vn' },
      supporters: [],
      priority: 'low',
      canEdit: true,
      canDelete: true,
    },
    {
      id: 105,
      title: '08:30: Giao ban đầu tuần và phân công nhiệm vụ tuần 44',
      date: weekDates[0],
      startTime: '08:30',
      endTime: '09:30',
      status: 'DONE',
      displayTitle: 'Giao ban đầu tuần và phân công nhiệm vụ tuần 44',
      displayStatus: 'completed',
      executor: { name: 'Lê Bình', email: 'binhlt@fermat.vn' },
      supporters: [],
      priority: 'medium',
      canEdit: true,
      canDelete: true,
    },
  ];

  const browser = await chromium.launch({ headless: true });

  const screenConfigs = [
    // Part A
    { name: 'partA-desktop-1440-expanded.png', width: 1440, height: 900, compact: false, path: '/' },
    { name: 'partA-desktop-1440-compact.png', width: 1440, height: 900, compact: true, hoverItem: 'work-schedule', path: '/' },
    { name: 'partA-desktop-1280-compact.png', width: 1280, height: 800, compact: true, path: '/' },
    { name: 'partA-desktop-1024-compact.png', width: 1024, height: 768, compact: true, path: '/' },

    // Part B (Home real data)
    { name: 'partB-desktop-home-realdata.png', width: 1440, height: 900, compact: false, realData: true, path: '/' },
    { name: 'partB-mobile-390-home-realdata.png', width: 390, height: 844, isMobile: true, realData: true, path: '/' },
    { name: 'partB-mobile-360-home-realdata.png', width: 360, height: 800, isMobile: true, realData: true, path: '/' },

    // Part C: (1) Lịch công tác
    { name: 'partC-mobile-390-work-schedule.png', width: 390, height: 844, isMobile: true, path: '/?view=work-schedule' },
    { name: 'partC-mobile-360-work-schedule.png', width: 360, height: 800, isMobile: true, path: '/?view=work-schedule' },

    // Part C: (2) Chấm công
    { name: 'partC-mobile-390-attendance.png', width: 390, height: 844, isMobile: true, path: '/?view=attendance' },
    { name: 'partC-mobile-360-attendance.png', width: 360, height: 800, isMobile: true, path: '/?view=attendance' },

    // Part C: (3) Báo cáo tuần
    { name: 'partC-mobile-390-weekly-report.png', width: 390, height: 844, isMobile: true, path: '/?view=weekly-report' },
    { name: 'partC-mobile-360-weekly-report.png', width: 360, height: 800, isMobile: true, path: '/?view=weekly-report' },

    // Part C: (4) Khảo thí
    { name: 'partC-mobile-390-examination.png', width: 390, height: 844, isMobile: true, path: '/?view=examination' },
    { name: 'partC-mobile-360-examination.png', width: 360, height: 800, isMobile: true, path: '/?view=examination' },

    // Part C: (5) Trợ lý Chatbot Mobile Open
    { name: 'partC-mobile-390-chatbot-open.png', width: 390, height: 844, isMobile: true, path: '/', openChatbot: true },
    { name: 'partC-mobile-360-chatbot-open.png', width: 360, height: 800, isMobile: true, path: '/', openChatbot: true },
  ];

  for (const cfg of screenConfigs) {
    const context = await browser.newContext({
      viewport: { width: cfg.width, height: cfg.height },
      deviceScaleFactor: 1.25,
      isMobile: Boolean(cfg.isMobile),
      hasTouch: Boolean(cfg.isMobile),
    });

    const page = await context.newPage();

    await page.route('**/api/**', async route => {
      const url = route.request().url();
      if (url.includes('/api/work-schedule/items') || url.includes('/api/work-schedule/tasks')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: realMockItems, tasks: realMockItems }),
        });
      }
      if (url.includes('/api/attendance/timesheet/prefill')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            existing: [
              {
                shiftStart: '08:25',
                shiftEnd: '17:35',
                workType: 'Tại văn phòng',
                status: 'Đúng giờ',
              },
            ],
          }),
        });
      }
      if (url.includes('/api/attendance/timesheet/month')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            entries: [
              {
                id: 1,
                workDate: todayStr,
                shiftNumber: 1,
                shiftStart: '08:15',
                shiftEnd: '17:30',
                workedMinutes: 510,
                workMode: 'direct',
                isDayOff: false,
              },
            ],
            summary: {
              totalMinutes: 510,
              onlineMinutes: 0,
              offlineMinutes: 510,
            },
            logs: [],
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
                employeeName: 'Lê Bình',
                employeeEmail: 'binhlt@fermat.vn',
                completedWeek: 43,
                plannedWeek: 44,
                completedItems: [
                  'Rà soát lịch công tác và xây dựng khung giao diện hướng A',
                  'Khảo sát và kiểm thử luồng AI viết lại báo cáo tuần',
                  'Sửa các lỗi thu gọn thanh rail và căn chỉnh mục chạm mobile',
                ],
                plannedItems: [
                  'Triển khai responsive thẻ dữ liệu cho các bảng lớn',
                  'Hoàn thiện kiểm kê giao diện đợt 3',
                ],
                completedGroups: [
                  {
                    name: 'Sản phẩm & Công nghệ',
                    items: [
                      'Rà soát lịch công tác và xây dựng khung giao diện hướng A',
                      'Khảo sát và kiểm thử luồng AI viết lại báo cáo tuần',
                      'Sửa các lỗi thu gọn thanh rail và căn chỉnh mục chạm mobile',
                    ],
                  },
                ],
                plannedGroups: [
                  {
                    name: 'Nhiệm vụ tuần sau',
                    items: [
                      'Triển khai responsive thẻ dữ liệu cho các bảng lớn',
                      'Hoàn thiện kiểm kê giao diện đợt 3',
                    ],
                  },
                ],
                status: 'DRAFT',
                plannedWarning: 'Tuần 44 mới có 2 việc, cần đăng ký thêm',
              },
            ],
            aiHealth: { status: 'ready', message: 'Sẵn sàng' },
          }),
        });
      }
      if (url.includes('/api/chatbot/health')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ready' }),
        });
      }
      if (url.includes('/api/chatbot/messages')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            messages: [
              {
                id: 'm1',
                role: 'assistant',
                content: 'Xin chào! Tôi có thể hỗ trợ bạn tìm kiếm công cụ, tra cứu lịch làm việc hoặc kiểm tra báo cáo tuần.',
                created_at: new Date().toISOString(),
              },
            ],
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.addInitScript(compactVal => {
      localStorage.setItem(
        'ft_auth_session',
        JSON.stringify({
          token: 'mock-token',
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
      localStorage.setItem('ft-workspace-rail-compact', compactVal ? '1' : '0');
    }, cfg.compact);

    await page.goto(`http://127.0.0.1:${PORT}${cfg.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    if (cfg.hoverItem) {
      const targetBtn = page.locator('button[aria-label="Lịch công tác"]');
      if (await targetBtn.count() > 0) {
        await targetBtn.hover();
        await page.waitForTimeout(300);
      }
    }

    if (cfg.openChatbot) {
      const botBtn = page.locator('button[aria-label="Mở Trợ lý AI Workspace"]');
      if (await botBtn.count() > 0) {
        await botBtn.click();
        await page.waitForTimeout(500);
      }
    }

    for (const dir of OUTPUT_DIRS) {
      const outPath = path.join(dir, cfg.name);
      await page.screenshot({ path: outPath, fullPage: false });
    }

    const overflowCheck = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      ok: document.documentElement.scrollWidth <= window.innerWidth,
    }));
    console.log(`[Screen] ${cfg.name}: overflow ok = ${overflowCheck.ok} (${overflowCheck.scrollWidth} / ${overflowCheck.innerWidth})`);

    await context.close();
  }

  // Inventory audit of remaining pages at 390px
  console.log('\n--- BẮT ĐẦU KIỂM KÊ CÁC TRANG CÒN LẠI TẠI 390px (CHO ĐỢT 3) ---');
  const auditPages = [
    { mode: 'digital-training', name: 'Đào tạo số (DigitalTraining.tsx)' },
    { mode: 'social-dashboard', name: 'Truyền thông (SocialDashboard)' },
    { mode: 'finance-report', name: 'Báo cáo thu chi (FinanceReport)' },
    { mode: 'account-management', name: 'Quản lý nhân viên (AccountManagement)' },
    { mode: 'email-builder', name: 'Thiết kế Email (EmailBuilder)' },
    { mode: 'funding-proposal', name: 'Phiếu đề xuất kinh phí' },
    { mode: 'qr-generator', name: 'Tạo mã QR' },
  ];

  const auditResults = [];

  for (const ap of auditPages) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.route('**/api/**', async route => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, items: [], list: [] }),
      });
    });

    await page.addInitScript(() => {
      localStorage.setItem(
        'ft_auth_session',
        JSON.stringify({
          token: 'mock-token',
          user: {
            email: 'binhlt@fermat.vn',
            displayName: 'Lê Bình',
            accessModules: ['all'],
            departments: [{ name: 'Công nghệ' }],
            jobTitle: { name: 'Kỹ sư phần mềm' },
          },
          role: 'ADMIN',
        })
      );
      sessionStorage.setItem('timesheet_dismiss_yesterday', '1');
    });

    await page.goto(`http://127.0.0.1:${PORT}/?view=${ap.mode}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    const audit = await page.evaluate((pageName) => {
      const scrollWidth = document.documentElement.scrollWidth;
      const innerWidth = window.innerWidth;
      const tables = document.querySelectorAll('table').length;
      const wideTables = Array.from(document.querySelectorAll('table')).filter(
        t => t.scrollWidth > innerWidth
      ).length;
      const smallTexts = document.querySelectorAll('[class*="text-[8px]"], [class*="text-[9px]"], [class*="text-[10px]"], [class*="text-[11px]"]').length;
      const smallButtons = Array.from(document.querySelectorAll('button, a')).filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
      }).length;

      return {
        pageName,
        scrollWidth,
        innerWidth,
        hasHorizontalOverflow: scrollWidth > innerWidth,
        tableCount: tables,
        wideTables,
        smallTextsCount: smallTexts,
        smallButtonsCount: smallButtons,
      };
    }, ap.name);

    auditResults.push(audit);
    console.log(`[Audit] ${ap.name}: cuộn ngang = ${audit.hasHorizontalOverflow} (${audit.scrollWidth}px), bảng = ${audit.tableCount} (rộng: ${audit.wideTables}), nút nhỏ: ${audit.smallButtonsCount}`);

    await context.close();
  }

  fs.writeFileSync(
    path.resolve('/home/orcauser/orca/workspaces/ft-workspace/agy/docs/tasks/005-audit-inventory.json'),
    JSON.stringify(auditResults, null, 2)
  );

  await browser.close();
  server.close();
  console.log('Capture and inventory completed successfully!');
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
