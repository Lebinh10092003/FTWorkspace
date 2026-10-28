const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/home/orcauser/.cache/ms-playwright';
}

const { chromium } = require('playwright');

const PORT = 58737;
const DIST_DIR = path.resolve(__dirname, '../dist');
const OUTPUT_DIRS = [
  path.resolve('/home/orcauser/orca/workspaces/ft-workspace/agy/docs/tasks/007-screens'),
  path.resolve('/home/orcauser/orca/workspaces/ft-workspace/agy5/docs/tasks/007-screens'),
  path.resolve(__dirname, '../docs/tasks/007-screens'),
];

OUTPUT_DIRS.forEach(d => {
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
      console.log(`Server preview listening on http://127.0.0.1:${PORT}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

const mockKeys = [
  {
    id: 'key-1',
    name: 'ChatGPT Web Actions',
    key_prefix: 'ft_ai_7x9a...',
    created_at: '2026-10-25T08:30:00.000Z',
    last_used_at: '2026-10-28T07:15:00.000Z',
    is_active: true,
  },
  {
    id: 'key-2',
    name: 'Claude Desktop Local',
    key_prefix: 'ft_ai_4m2b...',
    created_at: '2026-10-20T14:20:00.000Z',
    last_used_at: null,
    is_active: true,
  },
];

const mockConnections = [
  {
    id: 1,
    client: 'ChatGPT Web',
    created_at: '2026-10-26T10:00:00.000Z',
    last_used_at: '2026-10-28T06:45:00.000Z',
  },
];

async function capture() {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });

  const viewports = [
    { name: 'mobile-360', width: 360, height: 780, isMobile: true },
    { name: 'mobile-390', width: 390, height: 844, isMobile: true },
    { name: 'tablet-768', width: 768, height: 1024, isMobile: false },
    { name: 'desktop-1280', width: 1280, height: 800, isMobile: false },
  ];

  const themes = ['light', 'dark'];
  const results = [];

  console.log('\n--- BẮT ĐẦU CHỤP VÀ KIỂM THỬ PLAYWRIGHT MODAL TÀI KHOẢN (TASK 007) ---');

  for (const vp of viewports) {
    for (const theme of themes) {
      console.log(`\nKiểm thử: [${vp.name}] - Chế độ [${theme.toUpperCase()}]`);

      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
        isMobile: vp.isMobile,
        hasTouch: vp.isMobile,
      });

      const page = await context.newPage();

      // Intercept APIs
      await page.route('**/api/**', async route => {
        const url = route.request().url();
        if (url.includes('/api/mcp/keys')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, keys: mockKeys }),
          });
        }
        if (url.includes('/api/mcp/oauth-connections')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, connections: mockConnections }),
          });
        }
        if (url.includes('/api/work-schedule/items')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: [] }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      });

      // Inject auth session and appearance theme before page loads
      await page.addInitScript(currentTheme => {
        localStorage.setItem(
          'ft_auth_session',
          JSON.stringify({
            token: 'mock-token-secret-free',
            user: {
              email: 'binhlt@fermat.vn',
              displayName: 'Lê Bình',
              photoURL: null,
            },
            role: 'ADMIN',
          })
        );
        localStorage.setItem(
          'ftworkspace_appearance',
          JSON.stringify({
            mode: currentTheme,
            palette: 'navy',
            navStyle: 'compact',
            accent: 'blue',
            contrast: 'normal',
          })
        );
      }, theme);

      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);

      // Apply dark theme class if needed
      if (theme === 'dark') {
        await page.evaluate(() => {
          document.documentElement.classList.add('dark');
          document.body.classList.add('workspace-theme-dark');
          document.body.setAttribute('data-theme', 'dark');
        });
      } else {
        await page.evaluate(() => {
          document.documentElement.classList.remove('dark');
          document.body.classList.remove('workspace-theme-dark');
          document.body.removeAttribute('data-theme');
        });
      }

      await page.waitForTimeout(200);

      // Open Account Profile Modal
      await page.waitForTimeout(300);
      const mobileBtn = page.locator('button[title="Tài khoản cá nhân"]');
      if (await mobileBtn.isVisible()) {
        await mobileBtn.click();
      } else {
        const avatarBtn = page.locator('button[aria-label="Mở menu tài khoản"]');
        if (await avatarBtn.isVisible()) {
          await avatarBtn.click();
          await page.waitForTimeout(200);
          const editBtn = page.locator('button:has-text("Chỉnh sửa hồ sơ")');
          await editBtn.first().click();
        } else {
          // Fallback trigger via app state / button click
          await page.evaluate(() => {
            const btn = document.querySelector('button[title="Tài khoản cá nhân"], button[aria-label="Mở menu tài khoản"]');
            if (btn) btn.click();
          });
        }
      }

      // Wait for modal to be visible
      const modal = page.locator('.ft-dialog-panel');
      await modal.waitFor({ state: 'visible', timeout: 6000 });
      await page.waitForTimeout(300);

      // 1. Chụp Tab 1: Hồ sơ & Mật khẩu
      const filenameProfile = `modal-profile-${vp.name}-${theme}.png`;
      const bufferProfile = await page.screenshot({ fullPage: false });
      OUTPUT_DIRS.forEach(d => {
        fs.writeFileSync(path.join(d, filenameProfile), bufferProfile);
      });
      const hashProfile = crypto.createHash('md5').update(bufferProfile).digest('hex').slice(0, 8);

      // 2. Chuyển sang Tab 2: Trợ lý AI & MCP (ChatGPT)
      const aiTab = page.locator('button[role="tab"]:has-text("Trợ lý AI")');
      await aiTab.click();
      await page.waitForTimeout(400);

      // 3. Kiểm tra các tiêu chuẩn trên Tab AI
      const metrics = await page.evaluate(() => {
        const modalEl = document.querySelector('.ft-dialog-panel');
        if (!modalEl) return null;

        // Check horizontal overflow
        const hasHorizontalScroll = modalEl.scrollWidth > modalEl.clientWidth + 2;

        // Check tabs height
        const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
        const tabHeights = tabs.map(t => t.getBoundingClientRect().height);
        const tabsMin44 = tabHeights.every(h => h >= 43.5);

        // Check badge
        const badge = document.querySelector('button[role="tab"] span.rounded-full');
        const badgeWidth = badge ? badge.getBoundingClientRect().width : 0;

        // Check OpenAPI URL textarea / input
        const openApiEl = document.querySelector('textarea, input[readonly]');
        const openApiRect = openApiEl ? openApiEl.getBoundingClientRect() : null;

        // Check Copy button
        const buttons = Array.from(document.querySelectorAll('button'));
        const copyBtn = buttons.find(b => (b.textContent || '').includes('Sao chép URL'));
        const copyBtnRect = copyBtn ? copyBtn.getBoundingClientRect() : null;

        // Check text sizes < 12px
        const textElements = Array.from(modalEl.querySelectorAll('*')).filter(el => {
          return el.children.length === 0 && (el.textContent || '').trim().length > 0;
        });
        const smallTexts = [];
        for (const el of textElements) {
          const fs = parseFloat(window.getComputedStyle(el).fontSize);
          if (fs < 11.5) { // Threshold for 12px
            smallTexts.push({ text: (el.textContent || '').slice(0, 30), fs });
          }
        }

        return {
          hasHorizontalScroll,
          tabHeights,
          tabsMin44,
          badgeWidth,
          openApiRect,
          copyBtnRect,
          smallTextsCount: smallTexts.length,
          smallTexts,
        };
      });

      // 4. Chụp Tab 2: Trợ lý AI & MCP
      const filenameAi = `modal-ai-${vp.name}-${theme}.png`;
      const bufferAi = await page.screenshot({ fullPage: false });
      OUTPUT_DIRS.forEach(d => {
        fs.writeFileSync(path.join(d, filenameAi), bufferAi);
      });
      const hashAi = crypto.createHash('md5').update(bufferAi).digest('hex').slice(0, 8);

      console.log(`  -> Đã lưu ảnh Profile: ${filenameProfile} (MD5: ${hashProfile})`);
      console.log(`  -> Đã lưu ảnh AI & MCP: ${filenameAi} (MD5: ${hashAi})`);
      console.log(`  -> Tràn ngang: ${metrics?.hasHorizontalScroll ? 'CÓ (LỖI)' : 'KHÔNG (ĐẠT)'}`);
      console.log(`  -> Tab min-height >= 44px: ${metrics?.tabsMin44 ? 'ĐẠT' : 'CHƯA ĐẠT'} (Heights: ${metrics?.tabHeights.join(', ')})`);
      console.log(`  -> Cỡ chữ < 12px: ${metrics?.smallTextsCount === 0 ? '0 vi phạm (ĐẠT)' : `${metrics?.smallTextsCount} vi phạm`}`);
      if (metrics?.smallTextsCount > 0) {
        console.log('     Các text < 12px:', JSON.stringify(metrics.smallTexts.slice(0, 10)));
      }

      results.push({
        viewport: vp.name,
        theme,
        filenameProfile,
        hashProfile,
        filenameAi,
        hashAi,
        metrics,
      });

      await context.close();
    }
  }

  await browser.close();
  server.close();

  console.log('\n--- TỔNG KẾT KẾT QUẢ KIỂM THỬ PLAYWRIGHT MODAL TÀI KHOẢN ---');
  console.table(
    results.map(r => ({
      Viewport: r.viewport,
      Theme: r.theme,
      'Profile Hash': r.hashProfile,
      'AI Hash': r.hashAi,
      'Tràn ngang': r.metrics?.hasHorizontalScroll ? 'FAIL' : 'OK (0)',
      'Tabs >=44px': r.metrics?.tabsMin44 ? 'OK' : 'FAIL',
      'Text <12px': r.metrics?.smallTextsCount === 0 ? 'OK (0)' : `${r.metrics?.smallTextsCount} FAIL`,
    }))
  );

  return results;
}

capture().catch(err => {
  console.error('Lỗi kiểm thử Playwright:', err);
  process.exit(1);
});
