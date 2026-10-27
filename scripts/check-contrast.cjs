const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = 58738;
const DIST_DIR = path.resolve(__dirname, '../dist');

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
      console.log(`Contrast audit server listening on http://127.0.0.1:${PORT}`);
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
      completedWeek: 43,
      plannedWeek: 44,
      weekNumber: 43,
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

  const browser = await chromium.launch({ headless: true });

  const pagesToTest = [
    { id: 'home', name: 'Trang chủ', path: '/' },
    { id: 'work-schedule', name: 'Lịch công tác', path: '/work-schedule' },
    { id: 'weekly-report', name: 'Báo cáo tuần', path: '/weekly-report' },
    { id: 'attendance', name: 'Chấm công', path: '/attendance' },
    { id: 'funding-proposal', name: 'Phiếu đề xuất kinh phí', path: '/funding-proposal' },
    { id: 'account-management', name: 'Quản lý nhân viên', path: '/account-management' },
  ];

  const viewports = [
    { name: 'mobile-390', width: 390, height: 844, isMobile: true },
    { name: 'desktop-1440', width: 1440, height: 900, isMobile: false },
  ];

  const themes = ['dark', 'light'];
  const fullResults = [];
  let totalCriticalUnder3 = 0;

  console.log('\n======================================================');
  console.log('       KIỂM TRA ĐỘ TƯƠNG PHẢN THEO CHUẨN WCAG 2.1');
  console.log('======================================================\n');

  for (const theme of themes) {
    const isDark = theme === 'dark';

    for (const vp of viewports) {
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

      for (const p of pagesToTest) {
        await page.goto(`http://127.0.0.1:${PORT}${p.path}`, { waitUntil: 'load' });
        await page.waitForTimeout(1000);

        const audit = await page.evaluate(({ isDark }) => {
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

          function getCssSelector(el) {
            const parts = [];
            let cur = el;
            while (cur && cur !== document.body && parts.length < 3) {
              let part = cur.tagName.toLowerCase();
              if (cur.id) {
                part += `#${cur.id}`;
                parts.unshift(part);
                break;
              }
              const classes = Array.from(cur.classList).filter(c => !c.includes(':') && !c.includes('/') && !c.includes('['));
              if (classes.length > 0) {
                part += `.${classes.slice(0, 2).join('.')}`;
              }
              parts.unshift(part);
              cur = cur.parentElement;
            }
            return parts.join(' > ');
          }

          const elements = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, a, button, label, b, strong, td, th, li, input, select'));
          let totalChecked = 0;
          let countNormalUnder4_5 = 0;
          let countLargeUnder3_0 = 0;
          let countCriticalUnder3 = 0;
          const items = [];
          const seen = new Set();

          elements.forEach(el => {
            const text = (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3)
              ? el.textContent.trim()
              : (el.children.length === 0 ? el.textContent.trim() : '');
            if (!text || text.length < 2) return;

            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

            const key = `${text}|${Math.round(rect.top)}|${Math.round(rect.left)}`;
            if (seen.has(key)) return;
            seen.add(key);

            totalChecked++;

            const fgRgb = parseCssColor(style.color);
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
            const roundedCr = Math.round(cr * 100) / 100;

            const fontSize = parseFloat(style.fontSize) || 14;
            const fontWeight = parseInt(style.fontWeight, 10) || (style.fontWeight === 'bold' ? 700 : 400);
            const isLarge = fontSize >= 24 || (fontSize >= 18.5 && fontWeight >= 700);

            if (isLarge) {
              if (roundedCr < 3.0) {
                countLargeUnder3_0++;
                countCriticalUnder3++;
              }
            } else {
              if (roundedCr < 4.5) {
                countNormalUnder4_5++;
              }
              if (roundedCr < 3.0) {
                countCriticalUnder3++;
              }
            }

            items.push({
              text: text.slice(0, 32),
              tag: el.tagName.toLowerCase(),
              selector: getCssSelector(el),
              cr: roundedCr,
              fontSize: Math.round(fontSize),
              isLarge,
              color: style.color,
              bg: bgInfo.colorStr,
            });
          });

          items.sort((a, b) => a.cr - b.cr);

          return {
            totalChecked,
            countNormalUnder4_5,
            countLargeUnder3_0,
            countCriticalUnder3,
            worst5: items.slice(0, 5),
          };
        }, { isDark });

        totalCriticalUnder3 += audit.countCriticalUnder3;

        const row = {
          page: p.name,
          theme: theme.toUpperCase(),
          viewport: vp.name,
          totalChecked: audit.totalChecked,
          countNormalUnder4_5: audit.countNormalUnder4_5,
          countLargeUnder3_0: audit.countLargeUnder3_0,
          countCriticalUnder3: audit.countCriticalUnder3,
          worst5: audit.worst5,
        };

        fullResults.push(row);

        console.log(`[${row.theme}] [${row.viewport}] ${row.page}: ${row.totalChecked} phần tử | < 4.5:1: ${row.countNormalUnder4_5} | < 3:1: ${row.countCriticalUnder3}`);
        if (row.worst5.length > 0) {
          console.log(`   Top phần tử tỉ lệ thấp nhất:`);
          row.worst5.slice(0, 3).forEach(w => {
            console.log(`     - [${w.cr}:1] <${w.tag}> "${w.text}" (${w.selector})`);
          });
        }
      }

      await context.close();
    }
  }

  await browser.close();
  server.close();

  console.log('\n======================================================');
  console.log('              TỔNG HỢP KẾT QUẢ TƯƠNG PHẢN');
  console.log('======================================================\n');
  console.log(`Tổng số phần tử < 3:1 (vi phạm nghiêm trọng): ${totalCriticalUnder3}`);

  // Write results to JSON file for reporting
  fs.writeFileSync(
    path.resolve(__dirname, 'contrast-results.json'),
    JSON.stringify(fullResults, null, 2),
    'utf-8'
  );

  return { fullResults, totalCriticalUnder3 };
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
