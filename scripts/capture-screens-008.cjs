const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/home/orcauser/.cache/ms-playwright';
}

const { chromium } = require('playwright');

const PORT = 58739;
const DIST_DIR = path.resolve(__dirname, '../dist');
const OUTPUT_DIRS = [
  path.resolve('/home/orcauser/orca/workspaces/ft-workspace/agy/docs/tasks/008-screens'),
  path.resolve('/home/orcauser/orca/workspaces/ft-workspace/agy5/docs/tasks/008-screens'),
  path.resolve(__dirname, '../docs/tasks/008-screens'),
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

async function capture() {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });

  const viewports = [
    { name: 'mobile-360', width: 360, height: 740, isMobile: true },
    { name: 'mobile-390', width: 390, height: 844, isMobile: true },
    { name: 'desktop-1280', width: 1280, height: 800, isMobile: false },
  ];

  const results = [];

  console.log('\n--- BẮT ĐẦU CHỤP VÀ KIỂM THỬ PLAYWRIGHT TÚI ĐỒ (TASK 008) ---');

  for (const vp of viewports) {
    for (const theme of ['light', 'dark']) {
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
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, items: [] }),
        });
      });

      // Inject auth session and appearance theme
      await page.addInitScript(currentTheme => {
        localStorage.setItem(
          'ft_auth_session',
          JSON.stringify({
            token: 'mock-token-secret-free',
            user: { email: 'binhlt@fermat.vn', displayName: 'Lê Bình', role: 'ADMIN' },
            role: 'ADMIN',
          })
        );
        localStorage.setItem(
          'ftworkspace_appearance',
          JSON.stringify({ mode: currentTheme, palette: 'navy', navStyle: 'compact', accent: 'blue' })
        );
      }, theme);

      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);

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

      // 1. Kiểm tra vị trí không chồng đè nút Chatbot và không che nút Xem bản nháp
      const layoutCheck = await page.evaluate(() => {
        const bagBtn = document.querySelector('button[aria-label="Túi đồ"]');
        const chatBtn = document.querySelector('button[aria-label="Mở Trợ lý AI Workspace"]');
        if (!bagBtn || !chatBtn) return { found: false };

        const rBag = bagBtn.getBoundingClientRect();
        const rChat = chatBtn.getBoundingClientRect();

        // Kiểm tra hai hình chữ nhật có giao nhau không
        const overlapChat = !(
          rBag.right <= rChat.left ||
          rBag.left >= rChat.right ||
          rBag.bottom <= rChat.top ||
          rBag.top >= rChat.bottom
        );

        // Kiểm tra với nút Xem bản nháp (nếu có trên màn hình)
        const draftBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Xem bản nháp'));
        let overlapDraft = false;
        let draftPos = null;
        if (draftBtn) {
          const rDraft = draftBtn.getBoundingClientRect();
          draftPos = { x: Math.round(rDraft.x), y: Math.round(rDraft.y), w: Math.round(rDraft.width), h: Math.round(rDraft.height) };
          overlapDraft = !(
            rBag.right <= rDraft.left ||
            rBag.left >= rDraft.right ||
            rBag.bottom <= rDraft.top ||
            rBag.top >= rDraft.bottom
          );
        }

        return {
          found: true,
          overlapChat,
          overlapDraft,
          bagSize: { width: Math.round(rBag.width), height: Math.round(rBag.height) },
          chatSize: { width: Math.round(rChat.width), height: Math.round(rChat.height) },
          bagPos: { x: Math.round(rBag.x), y: Math.round(rBag.y) },
          chatPos: { x: Math.round(rChat.x), y: Math.round(rChat.y) },
          draftPos,
        };
      });

      console.log(`  -> Tìm thấy nút Túi đồ & Chatbot: ${layoutCheck.found ? 'CÓ (ĐẠT)' : 'KHÔNG'}`);
      console.log(`  -> Chồng đè FAB Chatbot: ${layoutCheck.overlapChat ? 'CÓ (LỖI)' : 'KHÔNG CHỒNG ĐÈ (ĐẠT)'}`);
      console.log(`  -> Đè nút Xem bản nháp: ${layoutCheck.overlapDraft ? 'CÓ (LỖI)' : 'KHÔNG ĐÈ (ĐẠT)'}`);

      // 2. Chụp trạng thái Panel Túi đồ mở (Panel Open)
      const bagBtn = page.locator('button[aria-label="Túi đồ"]');
      await bagBtn.waitFor({ state: 'visible', timeout: 5000 });
      await bagBtn.click();
      await page.waitForTimeout(300);

      // Kiểm tra mép Panel cách viền viewport >= 12px
      const panelMarginCheck = await page.evaluate(vpWidth => {
        const panel = document.querySelector('div[role="dialog"][aria-label="Túi đồ vui nhộn"]');
        if (!panel) return { found: false };
        const rect = panel.getBoundingClientRect();
        const leftMargin = rect.left;
        const rightMargin = vpWidth - rect.right;
        return {
          found: true,
          leftMargin: Math.round(leftMargin),
          rightMargin: Math.round(rightMargin),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          pass: leftMargin >= 12 && rightMargin >= 12,
        };
      }, vp.width);
      console.log(`  -> Panel mép trái=${panelMarginCheck.leftMargin}px, phải=${panelMarginCheck.rightMargin}px (>=12px: ${panelMarginCheck.pass ? 'ĐẠT' : 'LỖI'})`);

      const filenamePanel = `008-${vp.name}-${theme}-panel-open.png`;
      const bufPanel = await page.screenshot({ fullPage: false });
      OUTPUT_DIRS.forEach(d => fs.writeFileSync(path.join(d, filenamePanel), bufPanel));
      const hashPanel = crypto.createHash('md5').update(bufPanel).digest('hex').slice(0, 8);
      console.log(`  -> Đã lưu ảnh Panel: ${filenamePanel} (MD5: ${hashPanel})`);

      // 3. Chụp hiệu ứng Bom khói (Smoke) giữa chừng
      const throwSmokeBtn = page.locator('button[aria-label="Ném Bom khói"]');
      await throwSmokeBtn.click();
      await page.waitForTimeout(1000); // 1s: bom đã nổ và khói đang phủ toàn màn hình

      const smokePointerEvents = await page.evaluate(() => {
        const overlay = document.querySelector('.ft-smoke-overlay');
        return overlay ? window.getComputedStyle(overlay).pointerEvents : null;
      });

      const filenameSmoke = `008-${vp.name}-${theme}-effect-smoke.png`;
      const bufSmoke = await page.screenshot({ fullPage: false });
      OUTPUT_DIRS.forEach(d => fs.writeFileSync(path.join(d, filenameSmoke), bufSmoke));
      const hashSmoke = crypto.createHash('md5').update(bufSmoke).digest('hex').slice(0, 8);
      console.log(`  -> Đã lưu ảnh Bom khói: ${filenameSmoke} (MD5: ${hashSmoke}, pointer-events: ${smokePointerEvents})`);

      // Đợi khói tan hoàn toàn (5.2s)
      await page.waitForTimeout(4500);

      // 4. Chụp hiệu ứng Bom choáng CS2 (Flashbang) giữa chừng
      await bagBtn.waitFor({ state: 'visible', timeout: 5000 });
      await bagBtn.click();
      await page.waitForTimeout(300);

      const throwFlashBtn = page.locator('button[aria-label="Ném Bom choáng"]');
      await throwFlashBtn.click();
      await page.waitForTimeout(800); // 800ms: màn hình trắng xóa đặc và afterimage

      const flashPointerEvents = await page.evaluate(() => {
        const overlay = document.querySelector('.ft-flash-overlay');
        return overlay ? window.getComputedStyle(overlay).pointerEvents : null;
      });

      const filenameFlash = `008-${vp.name}-${theme}-effect-flash.png`;
      const bufFlash = await page.screenshot({ fullPage: false });
      OUTPUT_DIRS.forEach(d => fs.writeFileSync(path.join(d, filenameFlash), bufFlash));
      const hashFlash = crypto.createHash('md5').update(bufFlash).digest('hex').slice(0, 8);
      console.log(`  -> Đã lưu ảnh Bom choáng: ${filenameFlash} (MD5: ${hashFlash}, pointer-events: ${flashPointerEvents})`);

      // Đợi hết flashbang hoàn toàn (5.2s)
      await page.waitForTimeout(4500);

      // 5. Chụp hiệu ứng Mèo (Cat) giữa chừng
      await bagBtn.waitFor({ state: 'visible', timeout: 5000 });
      await bagBtn.click();
      await page.waitForTimeout(300);

      const throwCatBtn = page.locator('button[aria-label="Ném Mèo"]');
      await throwCatBtn.click();
      await page.waitForTimeout(1000); // 1s: chú mèo xuất hiện tại toạ độ rơi

      const filenameCat = `008-${vp.name}-${theme}-effect-cat.png`;
      const bufCat = await page.screenshot({ fullPage: false });
      OUTPUT_DIRS.forEach(d => fs.writeFileSync(path.join(d, filenameCat), bufCat));
      const hashCat = crypto.createHash('md5').update(bufCat).digest('hex').slice(0, 8);
      console.log(`  -> Đã lưu ảnh Mèo: ${filenameCat} (MD5: ${hashCat})`);

      await page.waitForTimeout(2500);

      results.push({
        viewport: vp.name,
        theme,
        hashPanel,
        hashSmoke,
        hashFlash,
        hashCat,
        layoutCheck,
        smokePointerEvents,
        flashPointerEvents,
      });

      await context.close();
    }
  }

  // 6. Kiểm tra chế độ Giảm chuyển động (prefers-reduced-motion: reduce)
  console.log('\nKiểm thử: [mobile-390 & desktop-1280] - Chế độ [REDUCED-MOTION]');
  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      isMobile: vp.isMobile,
      reducedMotion: 'reduce', // Kích hoạt prefers-reduced-motion
    });

    const page = await context.newPage();

    await page.route('**/api/**', async route => {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    await page.addInitScript(() => {
      localStorage.setItem('ft_auth_session', JSON.stringify({ token: 'mock-token', user: { email: 'binh@ft.vn', displayName: 'Bình' }, role: 'ADMIN' }));
    });

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    const bagBtn = page.locator('button[aria-label="Túi đồ"]');
    await bagBtn.click();
    await page.waitForTimeout(200);

    // Chụp panel với banner reduced motion
    const filenamePanelRed = `008-${vp.name}-reduced-motion-panel.png`;
    const bufPanelRed = await page.screenshot();
    OUTPUT_DIRS.forEach(d => fs.writeFileSync(path.join(d, filenamePanelRed), bufPanelRed));
    const hashPanelRed = crypto.createHash('md5').update(bufPanelRed).digest('hex').slice(0, 8);

    // Kích hoạt bom choáng ở chế độ reduced motion
    const throwFlashBtn = page.locator('button[aria-label="Ném Bom choáng"]');
    await throwFlashBtn.click();
    await page.waitForTimeout(600);

    const filenameFlashRed = `008-${vp.name}-reduced-motion-flash.png`;
    const bufFlashRed = await page.screenshot();
    OUTPUT_DIRS.forEach(d => fs.writeFileSync(path.join(d, filenameFlashRed), bufFlashRed));
    const hashFlashRed = crypto.createHash('md5').update(bufFlashRed).digest('hex').slice(0, 8);

    console.log(`  -> Đã lưu ảnh [${vp.name}] Reduced-Motion Panel: ${filenamePanelRed} (MD5: ${hashPanelRed})`);
    console.log(`  -> Đã lưu ảnh [${vp.name}] Reduced-Motion Flash: ${filenameFlashRed} (MD5: ${hashFlashRed})`);

    await context.close();
  }

  await browser.close();
  server.close();

  console.log('\n--- HOÀN TẤT KIỂM THỬ PLAYWRIGHT TÚI ĐỒ (TASK 008) ---');
  return results;
}

capture().catch(err => {
  console.error('Lỗi kiểm thử Playwright:', err);
  process.exit(1);
});
