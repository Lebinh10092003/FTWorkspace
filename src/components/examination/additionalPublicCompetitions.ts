import type { LandingSite } from './LandingSiteView';
import { additionalScoSites } from './scoCatalogue';

// Public programme information supplements the catalogue until a CMS page
// exists for the same slug. CMS content always takes precedence.
// Sources: waicy.org, asiaysbc.com, sscglobal.com.sg. Reviewed 10/11/2026.
const contact = { email: 'khaothi@fermat.vn', phone: '0969 627 162', zaloUrl: 'https://zalo.me/fermattech' };
export const additionalPublicCompetitions: LandingSite[] = [
  ...additionalScoSites,
  {
    id: -101, slug: 'waicy', title: 'WAICY · World Artificial Intelligence Competition for Youth', template: 'waicy', layout: 'information', published: true, updatedAt: '2026-11-10', updatedBy: '',
    content: {
      subject: 'WAICY', season: '2026',
      headline: 'Cuộc thi Trí tuệ nhân tạo Thế giới dành cho Thanh thiếu niên',
      intro: 'WAICY dành cho học sinh từ 6–18 tuổi, sử dụng trí tuệ nhân tạo để phát triển dự án và giải quyết vấn đề thực tế. Thí sinh có thể tham gia cá nhân hoặc theo đội.',
      logoUrl: '/competition-logos/waicy.webp',
      timeline: [{ title: 'WAICY Global 2026', date: '2026-12-04', endDate: '2026-12-06', mode: 'Theo thông tin của WAICY quốc tế' }],
      resources: [
        { category: 'Quốc tế', title: 'Thông tin và hướng dẫn WAICY 2026', body: '', url: 'https://www.waicy.org/' },
      ],
      contact,
      customSections: [{ title: 'Nội dung dự thi', body: 'Bốn hạng mục gồm dự án ứng dụng AI (AI Showcase), nghệ thuật tạo bằng AI (AI Generated Art), video tạo bằng AI (AI Generated Video) và mô hình ngôn ngữ lớn (AI Large Language Model). Yêu cầu hồ sơ và tiêu chí đánh giá của từng hạng mục được công bố trong hướng dẫn của WAICY.', buttonLabel: 'Xem hướng dẫn của WAICY', buttonUrl: 'https://www.waicy.org/' }],
    },
  },
  {
    id: -102, slug: 'aysbc', title: 'AYSBC · Asia Young Scientist Badge Competition', template: 'aysbc', layout: 'information', published: true, updatedAt: '2026-11-10', updatedBy: '',
    content: {
      subject: 'AYSBC', season: '2026',
      headline: 'Cuộc thi Huy hiệu Nhà khoa học trẻ Châu Á',
      intro: 'AYSBC là chương trình khoa học thực hành do Singapore Science Centre Global và META Knowledge phát triển, dành cho học sinh lớp 1–12. Học sinh hoàn thành nhiệm vụ theo huy hiệu khoa học và tham dự các vòng đánh giá.',
      logoUrl: '/competition-logos/aysbc.png',
      timeline: [
        { title: 'Vòng Quốc gia 2026', date: '2026-07-25', endDate: '2026-07-26', mode: 'Trực tuyến' },
        { title: 'Vòng Khu vực 2026', date: '2026-10-30', endDate: '2026-11-01', mode: 'Singapore' },
      ],
      resources: [
        { category: 'Giới thiệu', title: 'AYSBC — Science Centre Singapore Global', body: '', url: 'https://sscglobal.com.sg/asia-young-scientist-badge-competition-aysbc/' },
        { category: 'Nội dung thi', title: 'Khung chương trình và đề mẫu AYSBC', body: '', url: 'https://www.asiaysbc.com/competition' },
        { category: 'Vòng Khu vực', title: 'Thông tin Vòng Khu vực AYSBC 2026', body: '', url: 'https://www.asiaysbc.com/competition/aysbc-regional-round' },
      ],
      contact,
      customSections: [{ title: 'Các nhóm dự thi', body: 'Bảng A: lớp 1–2. Bảng B: lớp 3–4. Bảng C: lớp 5–6. Bảng D: lớp 7–9. Bảng E: lớp 10–12.\n\nCác chủ đề gắn với côn trùng học, thực vật học, khoa học thực phẩm, toán học và phát triển bền vững. Học sinh thực hiện nhiệm vụ theo huy hiệu để tích lũy kinh nghiệm trước phần thi đánh giá.', buttonLabel: '', buttonUrl: '' }],
    },
  },
];

export function additionalPublicCompetition(slug: string) {
  return additionalPublicCompetitions.find(site => site.slug === slug);
}

export function withAdditionalCompetitions<T extends { slug: string; content?: { subject?: string } }>(items: T[]) {
  return [...items, ...additionalPublicCompetitions.filter(site => !items.some(item =>
    item.slug === site.slug || (!!item.content?.subject && item.content.subject.toUpperCase() === site.content.subject?.toUpperCase())
  ))];
}
