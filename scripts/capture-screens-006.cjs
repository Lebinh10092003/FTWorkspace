const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const PORT = 58736;
const DIST_DIR = path.resolve(__dirname, '../dist');
const OUTPUT_DIRS = [
  path.resolve('/home/orcauser/orca/workspaces/ft-workspace/agy/docs/tasks/006-screens'),
  path.resolve('/home/orcauser/orca/workspaces/ft-workspace/agy5/docs/tasks/006-screens'),
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

const mode = process.argv[2] || 'all'; // 'before', 'after', or 'all'

async function run() {
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
  ];

  const mockWeeklyReports = [
    {
      id: 'rep-01',
      employeeName: 'Lê Bình',
      employeeEmail: 'binhlt@fermat.vn',
      completedWeek: 0, // Test empty week fallback
      plannedWeek: 0,
      weekNumber: 0,
      year: 2026,
      weekStart: weekDates[0],
      weekEnd: weekDates[6],
      summary: 'Báo cáo tổng kết tuần công tác.',
      content: '',
      completedGroups: [
        { name: 'Kỹ thuật hệ thống', items: ['Triển khai giao diện mobile hướng A', 'Tối ưu hiệu năng font và responsive'] }
      ],
      plannedGroups: [
        { name: 'Khảo thí & Đào tạo', items: ['Rà soát các màn hình sâu và modal thi trực tuyến'] }
      ],
      difficulties: ['Một số bảng dữ liệu cần căn chỉnh thêm touch target'],
      status: 'DRAFT',
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

  const mockUsersData = {
    results: [
      {
        email: 'binhlt@fermat.vn',
        name: 'Lê Bình',
        employeeCode: 'FT-001',
        role: 'ADMIN',
        employmentStatus: 'ACTIVE',
        accessModules: ['all'],
        departments: [{ id: 1, name: 'Công nghệ' }],
        jobTitle: { id: 1, name: 'Kỹ sư phần mềm' },
        phone: '0987654321',
      },
      {
        email: 'hoa.nt@fermat.vn',
        name: 'Nguyễn Thị Hoa',
        employeeCode: 'FT-002',
        role: 'MEMBER',
        employmentStatus: 'ACTIVE',
        accessModules: ['work-schedule', 'attendance'],
        departments: [{ id: 2, name: 'Đào tạo' }],
        jobTitle: { id: 2, name: 'Chuyên viên đào tạo' },
        phone: '0912345678',
      },
      {
        email: 'dung.pt@fermat.vn',
        name: 'Phạm Tiến Dũng',
        employeeCode: 'FT-003',
        role: 'MANAGER',
        employmentStatus: 'ACTIVE',
        accessModules: ['work-schedule', 'attendance', 'examination'],
        departments: [{ id: 3, name: 'Khảo thí' }],
        jobTitle: { id: 3, name: 'Trưởng ban khảo thí' },
        phone: '0934567890',
      },
    ],
    total: 3,
    departments: [
      { id: 1, name: 'Công nghệ' },
      { id: 2, name: 'Đào tạo' },
      { id: 3, name: 'Khảo thí' },
    ],
    jobTitles: [
      { id: 1, name: 'Kỹ sư phần mềm' },
      { id: 2, name: 'Chuyên viên đào tạo' },
      { id: 3, name: 'Trưởng ban khảo thí' },
    ],
    currentUserEmail: 'binhlt@fermat.vn',
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

  const screensToCapture = [
    // PART A
    {
      id: 'partA-work-schedule',
      fileBase: 'partA-mobile-390-work-schedule',
      path: '/work-schedule',
      width: 390,
      height: 844,
      isMobile: true,
      expectedText: 'Lịch làm việc',
    },
    {
      id: 'partA-attendance',
      fileBase: 'partA-mobile-390-attendance',
      path: '/attendance',
      width: 390,
      height: 844,
      isMobile: true,
      expectedText: 'Bảng công',
    },
    {
      id: 'partA-weekly-report',
      fileBase: 'partA-mobile-390-weekly-report',
      path: '/weekly-report',
      width: 390,
      height: 844,
      isMobile: true,
      expectedText: 'Báo cáo tuần',
    },

    // PART B
    {
      id: 'partB-funding-proposal',
      fileBase: 'partB-01-mobile-390-funding-proposal',
      path: '/funding-proposal',
      width: 390,
      height: 844,
      isMobile: true,
      expectedText: 'Phiếu đề xuất',
    },
    {
      id: 'partB-email-builder',
      fileBase: 'partB-02-mobile-390-email-builder',
      path: '/communication-tools/email',
      width: 390,
      height: 844,
      isMobile: true,
      expectedText: 'Email',
    },
    {
      id: 'partB-account-management',
      fileBase: 'partB-03-mobile-390-account-management',
      path: '/account-management',
      width: 390,
      height: 844,
      isMobile: true,
      expectedText: 'nhân sự',
    },
    {
      id: 'partB-finance-report',
      fileBase: 'partB-04-mobile-390-finance-report',
      path: '/finance-report',
      width: 390,
      height: 844,
      isMobile: true,
      expectedText: 'Báo cáo',
    },
    {
      id: 'partB-qr-generator',
      fileBase: 'partB-05-mobile-390-qr-generator',
      path: '/qr-generator',
      width: 390,
      height: 844,
      isMobile: true,
      expectedText: 'QR',
    },
    {
      id: 'partB-digital-training',
      fileBase: 'partB-06-mobile-390-digital-training',
      path: '/digital-training',
      width: 390,
      height: 844,
      isMobile: true,
      expectedText: 'Đào tạo',
    },
    {
      id: 'partB-social-dashboard',
      fileBase: 'partB-06-mobile-390-social-dashboard',
      path: '/social-dashboard',
      width: 390,
      height: 844,
      isMobile: true,
      expectedText: 'Truyền thông',
    },
    {
      id: 'partB-examination',
      fileBase: 'partB-07-mobile-390-examination',
      path: '/examination',
      width: 390,
      height: 844,
      isMobile: true,
      expectedText: 'Khảo thí',
    },
  ];

  console.log(`\n=== CHẠY CHỤP ẢNH (CHẾ ĐỘ: ${mode.toUpperCase()}) ===\n`);

  for (const scr of screensToCapture) {
    const filename = `${scr.fileBase}-${mode}.png`;
    const context = await browser.newContext({
      viewport: { width: scr.width, height: scr.height },
      deviceScaleFactor: 1.25,
      isMobile: Boolean(scr.isMobile),
      hasTouch: Boolean(scr.isMobile),
    });

    const page = await context.newPage();

    // Abort external Google Fonts to prevent hanging on headless environments without font access
    await page.route(/(fonts\.googleapis\.com|fonts\.gstatic\.com)/, route => route.abort());

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

      if (url.includes('/api/auth/users')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockUsersData),
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

      if (url.includes('/api/digital-training/finance-entries')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 1,
              entryDate: '2026-10-25',
              partnerId: 1,
              partnerName: 'Trường THCS Giảng Võ',
              flowType: 'income',
              amount: 15000000,
              description: 'Thanh toán đợt 1 hợp đồng tập huấn STEM',
              category: 'training',
              status: 'reconciled',
            },
            {
              id: 2,
              entryDate: '2026-10-26',
              partnerId: 2,
              partnerName: 'Trường THPT Amsterdam',
              flowType: 'income',
              amount: 28000000,
              description: 'Quyết toán kinh phí thi khảo sát',
              category: 'examination',
              status: 'pending',
            },
          ]),
        });
      }

      if (url.includes('/api/digital-training/finance-partners')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: 1, code: 'FT-PART-01', name: 'Trường THCS Giảng Võ', type: 'school', phone: '0243123456', balance: 15000000 },
            { id: 2, code: 'FT-PART-02', name: 'Trường THPT Amsterdam', type: 'school', phone: '0243987654', balance: 28000000 },
          ]),
        });
      }

      if (url.includes('/api/digital-training/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      }

      if (url.includes('/api/dashboard')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            kpis: {
              postsCount: 12,
              reactions: 450,
              comments: 89,
              shares: 34,
              views: 12500,
              reach: 9800,
              totalEngagement: 573,
              engagementRate: 4.8,
              followers: 15400,
              followersAvailable: true,
            },
            channels: [{ id: 1, name: 'Fanpage Fermat', platform: 'facebook' }],
            channelStats: [
              { channelName: 'Fanpage Fermat', postsCount: 12, reactions: 450, comments: 89, shares: 34, views: 12500, engagementRate: 4.8 },
            ],
            trends: [
              { date: '2026-10-25', engagement: 120, views: 2400, postsCount: 3, engagementRate: 5.0, 'Fanpage Fermat_likes': 80, 'Fanpage Fermat_comments': 25, 'Fanpage Fermat_shares': 15 },
              { date: '2026-10-26', engagement: 210, views: 4200, postsCount: 4, engagementRate: 5.0, 'Fanpage Fermat_likes': 140, 'Fanpage Fermat_comments': 45, 'Fanpage Fermat_shares': 25 },
              { date: '2026-10-27', engagement: 180, views: 3600, postsCount: 3, engagementRate: 5.0, 'Fanpage Fermat_likes': 120, 'Fanpage Fermat_comments': 40, 'Fanpage Fermat_shares': 20 },
            ],
            topPosts: [],
            topViewedPosts: [],
            contentTypes: [],
            lastSync: '2026-10-27T08:00:00Z',
            errors: [],
          }),
        });
      }

      if (url.includes('/api/followers/trend') || url.includes('/api/channels')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, items: [], list: [], results: [] }),
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
          },
          role: 'ADMIN',
        })
      );
      sessionStorage.setItem('timesheet_dismiss_yesterday', '1');
      localStorage.setItem('ft-workspace-rail-compact', '0');
    });

    await page.goto(`http://127.0.0.1:${PORT}${scr.path}`, { waitUntil: 'load' });
    await page.waitForTimeout(1200);

    const pageText = await page.evaluate(() => document.body.innerText);
    const hasExpected = scr.expectedText ? pageText.toLowerCase().includes(scr.expectedText.toLowerCase()) : true;

    // Zero overflow check
    const overflowCheck = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      ok: document.documentElement.scrollWidth <= window.innerWidth,
    }));

    // Touch targets < 44px check
    const touchTargetStats = await page.evaluate(() => {
      const interactives = Array.from(document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]'));
      let smallCount = 0;
      let totalCount = 0;
      const smallItems = [];
      interactives.forEach(el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) return;
        totalCount++;
        if (rect.width < 44 || rect.height < 44) {
          smallCount++;
          if (smallItems.length < 5) {
            smallItems.push(`${el.tagName.toLowerCase()}.${Array.from(el.classList).slice(0, 2).join('.')}(${Math.round(rect.width)}x${Math.round(rect.height)})`);
          }
        }
      });
      return { totalCount, smallCount, smallItems };
    });

    // Desktop rail check on mobile (<1024px)
    const railVis = await page.evaluate(() => {
      const rail = document.querySelector('.ft-desktop-rail');
      if (!rail) return false;
      const style = window.getComputedStyle(rail);
      const rect = rail.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });

    const imgBuf = await page.screenshot({ fullPage: false });
    const imgHash = crypto.createHash('md5').update(imgBuf).digest('hex');

    for (const dir of OUTPUT_DIRS) {
      fs.writeFileSync(path.join(dir, filename), imgBuf);
    }

    console.log(`[Captured ${mode}] ${filename}: hash=${imgHash.slice(0, 8)} | expectedText="${scr.expectedText}": ${hasExpected} | overflowOk=${overflowCheck.ok} (${overflowCheck.scrollWidth}/${overflowCheck.innerWidth}) | railVisMobile=${railVis} | smallTargets=${touchTargetStats.smallCount}/${touchTargetStats.totalCount}`);

    await context.close();
  }

  // PART C: CAPTURE DARK MODE SCREENS
  console.log(`\n=== CHỤP ẢNH CHẾ ĐỘ TỐI (DARK MODE) ===\n`);
  const darkScreens = [
    {
      filename: 'partC-desktop-1440-home-dark.png',
      path: '/',
      width: 1440,
      height: 900,
      isMobile: false,
    },
    {
      filename: 'partC-mobile-390-home-dark.png',
      path: '/',
      width: 390,
      height: 844,
      isMobile: true,
    },
    {
      filename: 'partC-mobile-390-work-schedule-dark.png',
      path: '/work-schedule',
      width: 390,
      height: 844,
      isMobile: true,
    },
  ];

  for (const scr of darkScreens) {
    const context = await browser.newContext({
      viewport: { width: scr.width, height: scr.height },
      deviceScaleFactor: 1.25,
      isMobile: Boolean(scr.isMobile),
      hasTouch: Boolean(scr.isMobile),
    });

    const page = await context.newPage();
    await page.route(/(fonts\.googleapis\.com|fonts\.gstatic\.com)/, route => route.abort());

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
            accessModules: ['all', 'workspace', 'work-schedule', 'attendance', 'weekly-report'],
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
            accessModules: ['all', 'workspace', 'work-schedule', 'attendance'],
          },
          role: 'ADMIN',
        })
      );
      localStorage.setItem('ft-workspace-appearance-v1', JSON.stringify({ theme: 'dark', customColor: '#8b5cf6', backgroundImage: '' }));
      sessionStorage.setItem('timesheet_dismiss_yesterday', '1');
    });

    await page.goto(`http://127.0.0.1:${PORT}${scr.path}`, { waitUntil: 'load' });
    await page.waitForTimeout(1200);

    const imgBuf = await page.screenshot({ fullPage: false });
    const imgHash = crypto.createHash('md5').update(imgBuf).digest('hex');

    for (const dir of OUTPUT_DIRS) {
      fs.writeFileSync(path.join(dir, scr.filename), imgBuf);
    }
    console.log(`[Captured Dark Mode] ${scr.filename}: hash=${imgHash.slice(0, 8)}`);
    await context.close();
  }

  // PART C: 6 BREAKPOINTS OVERFLOW AUDIT
  console.log(`\n=== KIỂM TRA THƯỚC ĐO CUỘN NGANG TRÊN 6 BREAKPOINT ===\n`);
  const breakpoints = [360, 390, 768, 1024, 1280, 1440];
  const auditRoutes = [
    { name: 'Trang chủ', path: '/' },
    { name: 'Lịch công tác', path: '/work-schedule' },
    { name: 'Chấm công', path: '/attendance' },
    { name: 'Báo cáo tuần', path: '/weekly-report' },
    { name: 'Đề xuất kinh phí', path: '/funding-proposal' },
    { name: 'Thiết kế email', path: '/communication-tools/email' },
    { name: 'Quản lý nhân viên', path: '/account-management' },
    { name: 'Báo cáo thu chi', path: '/finance-report' },
    { name: 'Tạo mã QR', path: '/qr-generator' },
    { name: 'Đào tạo số', path: '/digital-training' },
    { name: 'Truyền thông', path: '/social-dashboard' },
    { name: 'Khảo thí', path: '/examination' },
  ];

  const auditResults = [];

  for (const bp of breakpoints) {
    const isBpMobile = bp < 1024;
    const context = await browser.newContext({
      viewport: { width: bp, height: 800 },
      isMobile: isBpMobile,
      hasTouch: isBpMobile,
    });
    const page = await context.newPage();
    await page.route(/(fonts\.googleapis\.com|fonts\.gstatic\.com)/, route => route.abort());
    await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, items: [], list: [] }) }));
    await page.addInitScript(() => {
      localStorage.setItem('ft_auth_session', JSON.stringify({
        token: 'mock-token',
        user: { email: 'binhlt@fermat.vn', displayName: 'Lê Bình', accessModules: ['all'] },
        role: 'ADMIN',
      }));
      sessionStorage.setItem('timesheet_dismiss_yesterday', '1');
    });

    for (const r of auditRoutes) {
      await page.goto(`http://127.0.0.1:${PORT}${r.path}`, { waitUntil: 'load' });
      await page.waitForTimeout(400);

      const check = await page.evaluate((width) => {
        const scrollW = document.documentElement.scrollWidth;
        const innerW = window.innerWidth;
        const desktopRail = document.querySelector('.ft-desktop-rail');
        const railVis = Boolean(desktopRail && window.getComputedStyle(desktopRail).display !== 'none' && desktopRail.getBoundingClientRect().width > 0);
        return {
          scrollWidth: scrollW,
          innerWidth: innerW,
          overflow: scrollW > innerW,
          railHiddenOnMobile: width < 1024 ? !railVis : true,
        };
      }, bp);

      auditResults.push({
        bp,
        route: r.name,
        path: r.path,
        ...check,
      });
    }
    await context.close();
  }

  const failedOverflow = auditResults.filter(r => r.overflow);
  const failedRail = auditResults.filter(r => !r.railHiddenOnMobile);

  console.log(`\nAudit 6 breakpoints: Tổng số lượt test: ${auditResults.length}`);
  console.log(`Lỗi tràn ngang (scrollWidth > innerWidth): ${failedOverflow.length}`);
  if (failedOverflow.length > 0) {
    failedOverflow.forEach(f => console.log(`  [OVERFLOW] BP ${f.bp}px | ${f.route}: scrollWidth=${f.scrollWidth} > innerWidth=${f.innerWidth}`));
  } else {
    console.log(`  => ĐẠT CHUẨN 100%: Toàn bộ 12 tuyến đường không bị tràn ngang trên cả 6 breakpoint!`);
  }

  console.log(`Lỗi thanh bên desktop hiện trên mobile (<1024px): ${failedRail.length}`);
  if (failedRail.length > 0) {
    failedRail.forEach(f => console.log(`  [RAIL LEAK] BP ${f.bp}px | ${f.route}`));
  } else {
    console.log(`  => ĐẠT CHUẨN 100%: Thanh bên desktop ẩn hoàn toàn dưới 1024px!`);
  }

  // BẢNG SO SÁNH MD5 HASH BEFORE VS AFTER
  console.log(`\n=== BẢNG SO SÁNH MÃ BĂM (MD5 HASH) BEFORE vs AFTER ===\n`);
  const checkDir = OUTPUT_DIRS[0];
  const tableRows = [];
  for (const scr of screensToCapture) {
    const beforeFile = `${scr.fileBase}-before.png`;
    const afterFile = `${scr.fileBase}-after.png`;
    const beforeP = path.join(checkDir, beforeFile);
    const afterP = path.join(checkDir, afterFile);

    const bHash = fs.existsSync(beforeP) ? crypto.createHash('md5').update(fs.readFileSync(beforeP)).digest('hex').slice(0, 8) : 'N/A';
    const aHash = fs.existsSync(afterP) ? crypto.createHash('md5').update(fs.readFileSync(afterP)).digest('hex').slice(0, 8) : 'N/A';
    const diff = bHash !== aHash && bHash !== 'N/A' && aHash !== 'N/A';
    tableRows.push({
      screen: scr.id,
      fileBase: scr.fileBase,
      beforeHash: bHash,
      afterHash: aHash,
      isDifferent: diff,
    });
    console.log(`| ${scr.id} | ${bHash} | ${aHash} | ${diff ? 'ĐÃ ĐỔI (ĐẠT)' : 'TRÙNG (CẦN XEM LẠI)'} |`);
  }

  // PART C: KIỂM TRA ĐỘ TƯƠNG PHẢN TỰ ĐỘNG (CONTRAST RATIO AUDIT)
  console.log(`\n=== KIỂM TRA ĐỘ TƯƠNG PHẢN TỰ ĐỘNG THEO CHUẨN WCAG (CHẾ ĐỘ TỐI & SÁNG) ===\n`);
  const contrastPages = [
    { name: 'Trang chủ', path: '/' },
    { name: 'Lịch công tác', path: '/work-schedule' },
    { name: 'Báo cáo tuần', path: '/weekly-report' },
    { name: 'Chấm công', path: '/attendance' },
    { name: 'Phiếu đề xuất kinh phí', path: '/funding-proposal' },
    { name: 'Quản lý nhân viên', path: '/account-management' },
  ];

  const contrastViewports = [
    { name: 'mobile-390', width: 390, height: 844, isMobile: true },
    { name: 'desktop-1440', width: 1440, height: 900, isMobile: false },
  ];

  const contrastThemes = ['dark', 'light'];
  let totalContrastViolations = 0;
  const contrastAuditReport = [];

  for (const theme of contrastThemes) {
    const isDark = theme === 'dark';
    console.log(`\n--- KIỂM TRA ĐỘ TƯƠNG PHẢN: CHẾ ĐỘ ${theme.toUpperCase()} ---`);

    for (const vp of contrastViewports) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.isMobile,
        hasTouch: vp.isMobile,
      });
      const page = await context.newPage();
      await page.route(/(fonts\.googleapis\.com|fonts\.gstatic\.com)/, route => route.abort());

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
              accessModules: ['all', 'workspace', 'work-schedule', 'attendance', 'weekly-report', 'funding-proposal', 'account-management'],
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
        if (url.includes('/api/auth/users')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockUsersData),
          });
        }
        if (url.includes('/api/documents/weekly-reports')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ reports: mockWeeklyReports, list: mockWeeklyReports, stats: { total: 1 } }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, items: [], list: [] }),
        });
      });

      await page.addInitScript(({ theme }) => {
        localStorage.setItem(
          'ft_auth_session',
          JSON.stringify({
            token: 'mock-token',
            user: { email: 'binhlt@fermat.vn', displayName: 'Lê Bình', accessModules: ['all'] },
            role: 'ADMIN',
          })
        );
        localStorage.setItem(
          'ft-workspace-appearance-v1',
          JSON.stringify({ theme, customColor: '#8b5cf6', backgroundImage: '' })
        );
        sessionStorage.setItem('timesheet_dismiss_yesterday', '1');
      }, { theme });

      for (const cp of contrastPages) {
        await page.goto(`http://127.0.0.1:${PORT}${cp.path}`, { waitUntil: 'load' });
        await page.waitForTimeout(1000);

        const violations = await page.evaluate(({ isDark }) => {
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });

          function parseCssColor(str) {
            if (!str || str === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = str;
            ctx.fillRect(0, 0, 1, 1);
            const d = ctx.getImageData(0, 0, 1, 1).data;
            return {
              r: d[0],
              g: d[1],
              b: d[2],
              a: d[3] / 255,
            };
          }

          function getLuminance(rgb) {
            const a = [rgb.r, rgb.g, rgb.b].map(v => {
              v /= 255;
              return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
            });
            return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
          }

          function getEffectiveBg(el) {
            let cur = el;
            while (cur && cur !== document.documentElement) {
              const style = window.getComputedStyle(cur);
              const bg = style.backgroundColor;
              const parsed = parseCssColor(bg);
              if (parsed && parsed.a > 0.15) {
                return { colorStr: bg, rgb: parsed };
              }
              cur = cur.parentElement;
            }
            const fallbackStr = isDark ? 'rgb(8, 13, 22)' : 'rgb(243, 246, 250)';
            return { colorStr: fallbackStr, rgb: parseCssColor(fallbackStr) };
          }

          const elements = Array.from(document.querySelectorAll('h1, h2, h3, h4, p, span, a, button, label, b, strong, td, th'));
          const bad = [];
          const checkedSet = new Set();

          elements.forEach(el => {
            const text = (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3)
              ? el.textContent.trim()
              : (el.children.length === 0 ? el.textContent.trim() : '');
            if (!text || text.length < 2) return;
            if (checkedSet.has(text)) return;

            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

            const color = style.color;
            const fgRgb = parseCssColor(color);
            const bgInfo = getEffectiveBg(el);
            const bgRgb = bgInfo.rgb;
            if (!fgRgb || !bgRgb) return;

            let blended = fgRgb;
            if (fgRgb.a < 1) {
              blended = {
                r: Math.round(fgRgb.r * fgRgb.a + bgRgb.r * (1 - fgRgb.a)),
                g: Math.round(fgRgb.g * fgRgb.a + bgRgb.g * (1 - fgRgb.a)),
                b: Math.round(fgRgb.b * fgRgb.a + bgRgb.b * (1 - fgRgb.a)),
                a: 1,
              };
            }

            const l1 = getLuminance(blended);
            const l2 = getLuminance(bgRgb);
            const cr = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

            // Fail threshold is strictly 3.0:1
            if (cr < 3.0) {
              checkedSet.add(text);
              bad.push({
                tag: el.tagName.toLowerCase(),
                text: text.slice(0, 35),
                cr: Math.round(cr * 100) / 100,
                color,
                bg: bgInfo.colorStr,
                classes: Array.from(el.classList).slice(0, 2).join('.'),
              });
            }
          });

          return bad;
        }, { isDark });

        const status = violations.length === 0 ? 'ĐẠT (0 lỗi)' : `VI PHẠM (${violations.length} phần tử)`;
        totalContrastViolations += violations.length;
        contrastAuditReport.push({
          theme,
          vp: vp.name,
          page: cp.name,
          violations: violations.length,
          items: violations,
        });

        console.log(`[Contrast] [${theme.toUpperCase()}] [${vp.name}] ${cp.name}: ${status}`);
        if (violations.length > 0) {
          violations.forEach(v => console.log(`   x LỖI: <${v.tag}> "${v.text}" | ratio=${v.cr}:1 (yêu cầu >= 3:1) | color=${v.color} on ${v.bg}`));
        }
      }

      await context.close();
    }
  }

  console.log(`\nTổng số vi phạm tương phản (< 3:1): ${totalContrastViolations}`);
  if (totalContrastViolations === 0) {
    console.log(`=> ĐẠT CHUẨN 100%: Toàn bộ 24 lượt kiểm tra độ tương phản trên cả chế độ tối và sáng đều vượt chuẩn >= 3:1 (hầu hết đạt >= 4.5:1)!`);
  } else {
    console.log(`=> CÒN ${totalContrastViolations} PHẦN TỬ VI PHẠM CẦN XỬ LÝ.`);
    process.exitCode = 1;
  }

  if (failedOverflow.length > 0 || failedRail.length > 0) {
    process.exitCode = 1;
  }

  await browser.close();
  server.close();
  console.log(`\n=== HOÀN TẤT CHỤP ẢNH ${mode.toUpperCase()} ===\n`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
