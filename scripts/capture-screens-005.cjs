const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const PORT = 58735;
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
      displayStatus: 'doing',
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

  const mockWeeklyReports = [
    {
      id: 'rep-01',
      employeeName: 'Lê Bình',
      employeeEmail: 'binhlt@fermat.vn',
      weekNumber: 43,
      year: 2026,
      weekStart: weekDates[0],
      weekEnd: weekDates[6],
      summary: 'Hoàn thành tích hợp giao diện và kiểm thử đợt 2.',
      content: '1. Sửa lỗi sidebar thu gọn.\n2. Tối ưu Trang chủ với dữ liệu lịch công tác thật.\n3. Responsive cho các trang trên mobile.',
      status: 'APPROVED',
      aiSuggestedContent: '',
      submittedAt: '2026-10-24T17:00:00Z',
    },
  ];

  const mockAttendanceData = {
    isAdmin: true,
    isPrivileged: true,
    scope: 'all',
    month: todayStr.slice(0, 7),
    summaryCutoff: todayStr,
    employees: [
      { name: 'Lê Bình', email: 'binhlt@fermat.vn' },
    ],
    entries: [
      {
        id: 1,
        workDate: todayStr,
        shift: 1,
        startTime: '08:30',
        endTime: '17:30',
        workedMinutes: 480,
        workMode: 'direct',
        isDayOff: false,
        notes: 'Làm việc tại văn phòng',
        employee: { name: 'Lê Bình', email: 'binhlt@fermat.vn' },
      },
    ],
    summary: { totalMinutes: 480, onlineMinutes: 0, offlineMinutes: 480 },
    editLogs: [],
    trainingSummaryByEmployee: {},
    requiredTimesheetDatesByEmployee: {},
  };

  const mockCompetitions = [
    {
      id: 'comp-01',
      code: 'TIMO',
      name: 'Toán học Quốc tế TIMO',
      organizer: 'Fermat Education',
      roundsCount: 3,
      totalCandidates: 12500,
      status: 'ACTIVE',
      latestRound: 'Chung kết Quốc gia',
    },
    {
      id: 'comp-02',
      code: 'HKIMO',
      name: 'Toán Olympic Quốc tế Hong Kong HKIMO',
      organizer: 'Fermat Education',
      roundsCount: 2,
      totalCandidates: 8400,
      status: 'ACTIVE',
      latestRound: 'Vòng loại Quốc gia',
    },
  ];

  const browser = await chromium.launch({ headless: true });

  const screenConfigs = [
    // Part A (Desktop Rail)
    { name: 'partA-desktop-1440-expanded.png', width: 1440, height: 900, compact: false, path: '/', expectedText: 'FermatTech' },
    { name: 'partA-desktop-1440-compact.png', width: 1440, height: 900, compact: true, hoverItem: 'work-schedule', path: '/', expectedText: 'FermatTech' },
    { name: 'partA-desktop-1280-compact.png', width: 1280, height: 800, compact: true, path: '/', expectedText: 'FermatTech' },
    { name: 'partA-desktop-1024-compact.png', width: 1024, height: 768, compact: true, path: '/', expectedText: 'FermatTech' },

    // Part B (Home Real Data)
    { name: 'partB-desktop-home-realdata.png', width: 1440, height: 900, compact: false, realData: true, path: '/', expectedText: 'Lịch công tác' },
    { name: 'partB-mobile-390-home-realdata.png', width: 390, height: 844, isMobile: true, realData: true, path: '/', expectedText: 'Lịch công tác', isHomeMobile: true },
    { name: 'partB-mobile-360-home-realdata.png', width: 360, height: 800, isMobile: true, realData: true, path: '/', expectedText: 'Lịch công tác', isHomeMobile: true },

    // Part C: (1) Lịch công tác
    { name: 'partC-mobile-390-work-schedule.png', width: 390, height: 844, isMobile: true, path: '/work-schedule', expectedText: 'Lịch làm việc' },
    { name: 'partC-mobile-360-work-schedule.png', width: 360, height: 800, isMobile: true, path: '/work-schedule', expectedText: 'Lịch làm việc' },

    // Part C: (2) Chấm công (Công ca)
    { name: 'partC-mobile-390-attendance.png', width: 390, height: 844, isMobile: true, path: '/attendance', expectedText: 'Công ca' },
    { name: 'partC-mobile-360-attendance.png', width: 360, height: 800, isMobile: true, path: '/attendance', expectedText: 'Công ca' },

    // Part C: (3) Báo cáo tuần
    { name: 'partC-mobile-390-weekly-report.png', width: 390, height: 844, isMobile: true, path: '/weekly-report', expectedText: 'Báo cáo tuần' },
    { name: 'partC-mobile-360-weekly-report.png', width: 360, height: 800, isMobile: true, path: '/weekly-report', expectedText: 'Báo cáo tuần' },

    // Part C: (4) Khảo thí
    { name: 'partC-mobile-390-examination.png', width: 390, height: 844, isMobile: true, path: '/examination', expectedText: 'Khảo thí' },
    { name: 'partC-mobile-360-examination.png', width: 360, height: 800, isMobile: true, path: '/examination', expectedText: 'Khảo thí' },

    // Part C: (5) Trợ lý Chatbot Mobile Open
    { name: 'partC-mobile-390-chatbot-open.png', width: 390, height: 844, isMobile: true, path: '/', openChatbot: true, expectedText: 'Trợ lý' },
    { name: 'partC-mobile-360-chatbot-open.png', width: 360, height: 800, isMobile: true, path: '/', openChatbot: true, expectedText: 'Trợ lý' },
  ];

  const capturedHashes = {};
  let home390Hash = '';
  let home360Hash = '';

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
      if (url.includes('/api/auth/me')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            email: 'binhlt@fermat.vn',
            name: 'Lê Bình',
            displayName: 'Lê Bình',
            role: 'ADMIN',
            accessModules: [
              'all',
              'workspace',
              'work-schedule',
              'attendance',
              'weekly-report',
              'examination',
              'finance-report',
              'digital-training',
              'social-dashboard',
              'email-builder',
              'signature-builder',
              'qr-generator',
              'funding-proposal',
              'document-number',
              'account-management',
            ],
            departments: [{ name: 'Công nghệ' }],
            jobTitle: { name: 'Kỹ sư phần mềm' },
          }),
        });
      }

      if (url.includes('/api/work-schedule/items') || url.includes('/api/work-schedule/tasks')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: realMockItems, tasks: realMockItems }),
        });
      }

      if (url.includes('/api/attendance')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockAttendanceData),
        });
      }

      if (url.includes('/api/documents/weekly-reports')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ reports: mockWeeklyReports, list: mockWeeklyReports, stats: { total: 1 } }),
        });
      }

      if (url.includes('/api/examination') || url.includes('/api/competitions')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, competitions: mockCompetitions, sheets: [] }),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, items: [], list: [] }),
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

    await page.goto(`http://127.0.0.1:${PORT}${cfg.path}`, { waitUntil: 'load' });
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

    // 1. Check characteristic page content
    const pageText = await page.evaluate(() => document.body.innerText);
    if (cfg.expectedText && !pageText.includes(cfg.expectedText)) {
      throw new Error(`[Assertion Failed] Screen ${cfg.name} on path ${cfg.path} missing expected text: "${cfg.expectedText}"!`);
    }

    // 2. Automated assertion on Mobile (<1024px): Desktop rail MUST BE HIDDEN
    if (cfg.isMobile || cfg.width < 1024) {
      const desktopRailStatus = await page.evaluate(() => {
        const rail = document.querySelector('.ft-desktop-rail');
        if (!rail) return { exists: false, isHidden: true };
        const style = window.getComputedStyle(rail);
        const rect = rail.getBoundingClientRect();
        const isHidden = style.display === 'none' || style.visibility === 'hidden' || (rect.width === 0 && rect.height === 0);
        return {
          exists: true,
          isHidden,
          display: style.display,
          width: rect.width,
          height: rect.height,
        };
      });

      if (!desktopRailStatus.isHidden) {
        throw new Error(`[Regression Alert] Screen ${cfg.name} has visible desktop rail on mobile viewport! display=${desktopRailStatus.display}, w=${desktopRailStatus.width}, h=${desktopRailStatus.height}`);
      }
    }

    // 3. Automated assertion: zero horizontal overflow
    const overflowCheck = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      ok: document.documentElement.scrollWidth <= window.innerWidth,
    }));

    if (!overflowCheck.ok) {
      throw new Error(`[Overflow Alert] Screen ${cfg.name} has horizontal scroll! scrollWidth=${overflowCheck.scrollWidth} > innerWidth=${overflowCheck.innerWidth}`);
    }

    // Capture screenshot buffer to verify MD5 hash uniqueness
    const imgBuf = await page.screenshot({ fullPage: false });
    const imgHash = crypto.createHash('md5').update(imgBuf).digest('hex');

    if (cfg.name === 'partB-mobile-390-home-realdata.png') {
      home390Hash = imgHash;
    } else if (cfg.name === 'partB-mobile-360-home-realdata.png') {
      home360Hash = imgHash;
    }

    // 4. Assert non-home Part C screens DO NOT have the same hash as Home
    if (cfg.name.startsWith('partC-mobile-390-')) {
      if (imgHash === home390Hash) {
        throw new Error(`[Hash Collision] ${cfg.name} has identical MD5 hash (${imgHash}) to Home 390! Navigation failed!`);
      }
    }
    if (cfg.name.startsWith('partC-mobile-360-')) {
      if (imgHash === home360Hash) {
        throw new Error(`[Hash Collision] ${cfg.name} has identical MD5 hash (${imgHash}) to Home 360! Navigation failed!`);
      }
    }

    capturedHashes[cfg.name] = imgHash;

    for (const dir of OUTPUT_DIRS) {
      const outPath = path.join(dir, cfg.name);
      fs.writeFileSync(outPath, imgBuf);
    }

    console.log(`[Screen OK] ${cfg.name}: hash=${imgHash.slice(0, 8)} | overflow ok = ${overflowCheck.ok} (${overflowCheck.scrollWidth}/${overflowCheck.innerWidth})`);

    await context.close();
  }

  // Inventory audit of remaining pages at 390px
  console.log('\n--- BẮT ĐẦU KIỂM KÊ CÁC TRANG CÒN LẠI TẠI 390px (CHO ĐỢT 3) ---');
  const auditPages = [
    { path: '/digital-training', name: 'Đào tạo số (DigitalTraining.tsx)' },
    { path: '/social-dashboard', name: 'Truyền thông (SocialDashboard)' },
    { path: '/finance-report', name: 'Báo cáo thu chi (FinanceReport)' },
    { path: '/account-management', name: 'Quản lý nhân viên (AccountManagement)' },
    { path: '/communication-tools/email', name: 'Thiết kế Email (EmailBuilder)' },
    { path: '/funding-proposal', name: 'Phiếu đề xuất kinh phí' },
    { path: '/qr-generator', name: 'Tạo mã QR' },
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
      const url = route.request().url();
      if (url.includes('/api/auth/me')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            email: 'binhlt@fermat.vn',
            name: 'Lê Bình',
            displayName: 'Lê Bình',
            role: 'ADMIN',
            accessModules: ['all'],
            departments: [{ name: 'Công nghệ' }],
            jobTitle: { name: 'Kỹ sư phần mềm' },
          }),
        });
      }
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

    await page.goto(`http://127.0.0.1:${PORT}${ap.path}`, { waitUntil: 'load' });
    await page.waitForTimeout(600);

    const audit = await page.evaluate(pageName => {
      const scrollWidth = document.documentElement.scrollWidth;
      const innerWidth = window.innerWidth;
      const tables = document.querySelectorAll('table').length;
      const wideTables = Array.from(document.querySelectorAll('table')).filter(
        t => t.scrollWidth > innerWidth
      ).length;
      const smallTexts = document.querySelectorAll(
        '[class*="text-[8px]"], [class*="text-[9px]"], [class*="text-[10px]"], [class*="text-[11px]"]'
      ).length;
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
    console.log(
      `[Audit] ${ap.name}: cuộn ngang = ${audit.hasHorizontalOverflow} (${audit.scrollWidth}px), bảng = ${audit.tableCount} (rộng: ${audit.wideTables}), nút nhỏ: ${audit.smallButtonsCount}`
    );

    await context.close();
  }

  const auditPath1 = path.resolve('/home/orcauser/orca/workspaces/ft-workspace/agy/docs/tasks/005-audit-inventory.json');
  const auditPath2 = path.resolve('/home/orcauser/orca/workspaces/ft-workspace/agy5/docs/tasks/005-audit-inventory.json');
  fs.writeFileSync(auditPath1, JSON.stringify(auditResults, null, 2));
  fs.writeFileSync(auditPath2, JSON.stringify(auditResults, null, 2));

  await browser.close();
  server.close();
  console.log('\n--- TẤT CẢ 17 ẢNH VÀ KIỂM KÊ HOÀN THÀNH XUẤT SẮC! ---');
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
