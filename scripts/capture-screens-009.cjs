const http = require('http');
const fs = require('fs');
const path = require('path');

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/home/orcauser/.cache/ms-playwright';
}

const { chromium } = require('playwright');

const PORT = 58742;
const DIST_DIR = path.resolve(__dirname, '../dist');
const OUTPUT_DIRS = [
  path.resolve(__dirname, '../docs/tasks/009-screens'),
  path.resolve('/home/orcauser/orca/workspaces/ft-workspace/agy5/docs/tasks/009-screens'),
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

// Dữ liệu mock bản tin
const MOCK_POSTS = [
  {
    id: 1,
    ownerEmail: 'tien@fermat.vn',
    ownerName: 'Nguyễn Văn Tiến',
    postType: 'fb_training',
    title: 'Tập huấn Chuyển đổi số và AI tại Xã Hòa Phú',
    status: 'completed',
    createdAt: '2026-10-25T08:00:00Z',
    updatedAt: '2026-10-25T11:45:00Z',
    inputPayload: {
      unit_name: 'Xã Hòa Phú',
      notes: 'Tập huấn nâng cao năng lực ứng dụng Gemini AI và Bộ nhớ dùng chung.',
      sessions: [
        {
          sessionId: 'session-1',
          sessionName: 'Buổi 1: Giới thiệu Bộ nhớ dùng chung và Gemini AI',
          sessionDate: '2026-10-24',
          timeFrame: '08:00 - 11:30',
          location: 'Hội trường UBND Xã Hòa Phú',
          fermatParticipants: ['Nguyễn Văn Tiến', 'Đặng Vũ Hiệp'],
          unitParticipants: ['Lãnh đạo Đảng ủy', 'UBND', 'Cán bộ các ban ngành'],
          agendaContent: '1/ Bối cảnh chuyển đổi số\n2/ Nội dung đã thực hiện\n3/ Kết quả',
        },
      ],
    },
    surveySummary: {
      has_survey: true,
      total_responses: 188,
      total_ratings: 1880,
      overall_satisfaction_percent: 91.58,
      overall_good_or_very_good_percent: 100,
      top_rated_criterion: 'Kiến thức chuyên môn & sự nhiệt tình giải đáp của giảng viên',
      notable_criterion: 'Bộ nhớ dùng chung (lưu trữ & khai thác dữ liệu)',
      open_feedback_points: [
        'Mong muốn tiếp tục được hỗ trợ, giải đáp vướng mắc khi thực hành thực tế.',
        'Đề xuất tổ chức thêm các buổi hướng dẫn nâng cao về Gemini AI.',
      ],
      categories: [
        { name: 'Trình độ, kiến thức chuyên môn của giảng viên', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 93.68, detail_counts: { 'Rất tốt': 128, 'Tốt': 60 } },
        { name: 'Khả năng truyền đạt, phong thái sư phạm', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 91.11, detail_counts: { 'Rất tốt': 104, 'Tốt': 84 } },
        { name: 'Tính thực tiễn của ví dụ và hướng dẫn', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 91.58, detail_counts: { 'Rất tốt': 109, 'Tốt': 79 } },
        { name: 'Sự nhiệt tình, sẵn sàng giải đáp thắc mắc', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 93.68, detail_counts: { 'Rất tốt': 128, 'Tốt': 60 } },
        { name: 'Khả năng quản lý, kiểm soát thời gian', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 91.11, detail_counts: { 'Rất tốt': 104, 'Tốt': 84 } },
        { name: 'Bộ nhớ dùng chung – Lưu trữ tài liệu', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 88.42, detail_counts: { 'Rất tốt': 79, 'Tốt': 109 } },
        { name: 'Bộ nhớ dùng chung – Khai thác dữ liệu', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 88.42, detail_counts: { 'Rất tốt': 79, 'Tốt': 109 } },
        { name: 'Gemini AI – Sử dụng trợ lý Gem', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 89.47, detail_counts: { 'Rất tốt': 89, 'Tốt': 99 } },
        { name: 'Gemini AI – Soạn thảo, tóm tắt văn bản', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 89.47, detail_counts: { 'Rất tốt': 89, 'Tốt': 99 } },
        { name: 'Gemini AI – Tạo hình ảnh, slide', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 89.47, detail_counts: { 'Rất tốt': 89, 'Tốt': 99 } },
      ],
    },
    contentPayload: {
      headline: 'TẬP HUẤN ỨNG DỤNG BỘ NHỚ DÙNG CHUNG VÀ GEMINI AI TRONG CÔNG TÁC TẠI XÃ HÒA PHÚ',
      lead_in: 'Nhằm đẩy mạnh chuyển đổi số và nâng cao hiệu quả công việc, FermatTech đã phối hợp cùng UBND Xã Hòa Phú tổ chức chương trình tập huấn ứng dụng Bộ nhớ dùng chung và Trợ lý Gemini AI cho toàn thể cán bộ, công chức trên địa bàn xã.',
      sections: [
        {
          heading: 'NỘI DUNG TẬP HUẤN TRỌNG TÂM',
          body: 'Buổi làm việc diễn ra trong không khí sôi nổi, thực chất với các nội dung bám sát công việc hàng ngày của từng cán bộ:',
          bullets: [
            'Thiết lập, phân quyền và chuẩn hóa cấu trúc lưu trữ trên Bộ nhớ dùng chung giúp dữ liệu an toàn, tìm kiếm tức thì.',
            'Khai thác trợ lý Gemini AI để tóm tắt văn bản chỉ đạo, dự thảo báo cáo tuần và lập biên bản họp nhanh chóng.',
            'Xây dựng các câu lệnh mẫu theo từng vị trí việc làm: văn phòng, địa chính, tài chính - kế toán, tư pháp.',
          ],
        },
      ],
      survey_section: {
        heading: '📊 PHẢN HỒI SAU TẬP HUẤN',
        text: 'Khảo sát sau buổi tập huấn ghi nhận 188 lượt cán bộ tham gia đánh giá với 100% lượt đánh giá đạt loại Tốt và Rất tốt. Mức hài lòng bình quân đạt 91,58%. Giảng viên FermatTech được đánh giá cao nhất về chuyên môn và sự nhiệt tình (93,68%).',
        feedback_summary: 'Học viên mong muốn tiếp tục được đồng hành, hướng dẫn thực hành sâu hơn theo từng chuyên đề công việc cụ thể.',
      },
      closing: 'FermatTech xin trân trọng cảm ơn sự quan tâm, chỉ đạo sát sao của Đảng ủy, HĐND, UBND Xã Hòa Phú và sự tham gia nhiệt tình, trách nhiệm của các đồng chí cán bộ, công chức xã.',
      slogan: 'FERMATTECH – ĐỒNG HÀNH CHUYỂN ĐỔI SỐ THỰC CHẤT VÀ HIỆU QUẢ!',
      contact_info: '🌐 www.fermat.vn | ✉ contact@fermat.vn | ☎ 0969 627 162',
      hashtags: ['#FermatTech', '#ChuyenDoiSo', '#GeminiAI', '#BoNhoDungChung', '#TapHuanAI', '#XaHoaPhu'],
      raw_text: `🌟 TẬP HUẤN ỨNG DỤNG BỘ NHỚ DÙNG CHUNG VÀ GEMINI AI TRONG CÔNG TÁC TẠI XÃ HÒA PHÚ\n\nNhằm đẩy mạnh chuyển đổi số và nâng cao hiệu quả công việc...`,
    },
  },
  {
    id: 2,
    ownerEmail: 'tien@fermat.vn',
    ownerName: 'Nguyễn Văn Tiến',
    postType: 'fb_meeting',
    title: 'Làm việc triển khai khảo thí số tại THCS Giảng Võ',
    status: 'draft',
    createdAt: '2026-10-26T09:00:00Z',
    updatedAt: '2026-10-26T09:30:00Z',
    inputPayload: {
      unit_name: 'THCS Giảng Võ',
      notes: 'Thống nhất kế hoạch kiểm tra khảo thí trực tuyến.',
      sessions: [
        {
          sessionId: 'session-2',
          sessionName: 'Buổi làm việc Ban Giám hiệu',
          sessionDate: '2026-10-26',
          timeFrame: '09:00 - 11:00',
          location: 'Phòng họp 1',
          fermatParticipants: ['Nguyễn Văn Tiến'],
          unitParticipants: ['Ban Giám hiệu'],
          agendaContent: 'Thảo luận phương án triển khai.',
        },
      ],
    },
    surveySummary: { has_survey: false },
    contentPayload: {},
  },
];

async function capture() {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });

  const viewports = [
    { name: 'mobile-360', width: 360, height: 740, isMobile: true },
    { name: 'mobile-390', width: 390, height: 844, isMobile: true },
    { name: 'desktop-1280', width: 1280, height: 800, isMobile: false },
  ];

  console.log('\n--- BẮT ĐẦU CHỤP VÀ KIỂM THỬ PLAYWRIGHT TIN BÀI (TASK 009) ---');

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
        const url = route.request().url();

        if (url.includes('/api/news-posts/')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ posts: MOCK_POSTS, post: MOCK_POSTS[0] }),
          });
        }

        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
      });

      // LocalStorage setup
      await page.addInitScript(currentTheme => {
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
          JSON.stringify({ token: 'mock-token-agy5', user: mockUser, role: 'ADMIN' })
        );
        localStorage.setItem(
          'ftworkspace_appearance',
          JSON.stringify({ mode: currentTheme, palette: 'navy', navStyle: 'compact', accent: 'blue' })
        );
      }, theme);

      // Navigate to news-posts
      await page.goto(`http://127.0.0.1:${PORT}/communication-tools/news-posts`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);

      // Apply DOM classes for dark / light mode
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

      await page.waitForTimeout(300);

      // Chụp màn hình 1: Danh sách tin bài
      const listImgName = `${vp.name}-${theme}-news-list.png`;
      for (const dir of OUTPUT_DIRS) {
        await page.screenshot({ path: path.join(dir, listImgName), fullPage: false });
      }
      console.log(`  -> Đã chụp: ${listImgName}`);

      // Nhấn vào thẻ bài viết đầu tiên để xem chi tiết & đồ họa
      const viewDetailBtn = page.locator('button:has-text("Xem bài & đồ họa")').first();
      if (await viewDetailBtn.count() > 0) {
        await viewDetailBtn.click();
        await page.waitForTimeout(600);

        // Chụp màn hình 2: Trình xem/sửa bài viết (và đồ họa)
        const detailImgName = `${vp.name}-${theme}-news-detail.png`;
        for (const dir of OUTPUT_DIRS) {
          await page.screenshot({ path: path.join(dir, detailImgName), fullPage: false });
        }
        console.log(`  -> Đã chụp: ${detailImgName}`);

        // Nếu là mobile, chuyển tab sang đồ họa khảo sát và chụp riêng
        if (vp.isMobile) {
          const surveyTabBtn = page.locator('button:has-text("Đồ họa khảo sát (PNG)")');
          if (await surveyTabBtn.count() > 0) {
            await surveyTabBtn.click();
            await page.waitForTimeout(600);

            const surveyImgName = `${vp.name}-${theme}-survey-graphic.png`;
            for (const dir of OUTPUT_DIRS) {
              await page.screenshot({ path: path.join(dir, surveyImgName), fullPage: false });
            }
            console.log(`  -> Đã chụp tab đồ họa: ${surveyImgName}`);
          }
        }
      }

      // Nhấn "Sửa thông tin đầu vào" để kiểm tra màn hình Editor
      const editInputBtn = page.locator('button:has-text("Sửa thông tin đầu vào")').first();
      if (await editInputBtn.count() > 0) {
        await editInputBtn.click();
        await page.waitForTimeout(600);

        const editorImgName = `${vp.name}-${theme}-news-editor.png`;
        for (const dir of OUTPUT_DIRS) {
          await page.screenshot({ path: path.join(dir, editorImgName), fullPage: false });
        }
        console.log(`  -> Đã chụp: ${editorImgName}`);
      }

      await context.close();
    }
  }

  await browser.close();
  server.close();
  console.log('\n--- HOÀN THÀNH CHỤP ẢNH TẤT CẢ MÀN HÌNH ---');
}

capture().catch(err => {
  console.error('Lỗi khi chụp Playwright:', err);
  process.exit(1);
});
