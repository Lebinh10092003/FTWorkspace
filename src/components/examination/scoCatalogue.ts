import type { LandingSite } from './LandingSiteView';

// SCO's complete subject catalogue, checked against its official exam directory
// on 10/11/2026: https://www.schoolconnectonline.com/
// Display codes follow this project's S-prefix convention (rename_sco_competitions).
// No international schedule is presented as a Vietnamese registration window.
export const scoCatalogue = [
  { code: 'SIMO', area: 'Toán học', focus: 'Số học · Hình học · Suy luận', name: 'Olympic Toán học Quốc tế SCO', intro: 'Khám phá các bài toán về số học, hình học và quy luật, phát triển tư duy toán học và khả năng giải quyết vấn đề.', url: 'https://www.schoolconnectonline.com/exam/imo', accent: '#356ac4', tint: '#edf3fe' },
  { code: 'SIEO', area: 'Tiếng Anh', focus: 'Từ vựng · Ngữ pháp · Đọc hiểu', name: 'Olympic Tiếng Anh Quốc tế SCO', intro: 'Vận dụng từ vựng, ngữ pháp và kỹ năng đọc hiểu qua các câu hỏi tiếng Anh theo trình độ học sinh.', url: 'https://www.schoolconnectonline.com/exam/ieo', accent: '#137f89', tint: '#e6f4f3' },
  { code: 'SISO', area: 'Khoa học', focus: 'Tự nhiên · Hiện tượng · Khám phá', name: 'Olympic Khoa học Quốc tế SCO', intro: 'Tìm hiểu thế giới tự nhiên và các hiện tượng khoa học, kết nối kiến thức với những tình huống trong đời sống.', url: 'https://www.schoolconnectonline.com/exam/iso', accent: '#338353', tint: '#eaf5ed' },
  { code: 'SICO', area: 'Lập trình', focus: 'Thuật toán · Logic · Lập trình', name: 'Olympic Lập trình Quốc tế SCO', intro: 'Làm quen với tư duy máy tính, logic và các khái niệm lập trình qua nội dung được xây dựng theo từng khối lớp.', url: 'https://www.schoolconnectonline.com/exam/coding', accent: '#526bc5', tint: '#eef0fb' },
  { code: 'SIGKO', area: 'Kiến thức tổng hợp', focus: 'Thế giới · Văn hóa · Đời sống', name: 'Olympic Kiến thức tổng hợp Quốc tế SCO', intro: 'Mở rộng hiểu biết về thế giới, văn hóa, khoa học và đời sống qua các câu hỏi kiến thức tổng hợp.', url: 'https://www.schoolconnectonline.com/exam/igko', accent: '#93621f', tint: '#fbf3e3' },
  { code: 'SIMAO', area: 'Tư duy', focus: 'Logic · Quy luật · Suy luận', name: 'Olympic Tư duy Quốc tế SCO', intro: 'Rèn khả năng nhận diện quy luật, phân tích thông tin và suy luận qua các thử thách tư duy.', url: 'https://www.schoolconnectonline.com/exam/mental-ability', accent: '#8460ba', tint: '#f3edfa' },
  { code: 'SIFKO', area: 'Kiến thức tài chính', focus: 'Tiền tệ · Tiết kiệm · Kế hoạch', name: 'Olympic Kiến thức tài chính Quốc tế SCO', intro: 'Tìm hiểu các khái niệm tài chính, quản lý tiền và những quyết định tài chính trong đời sống.', url: 'https://www.schoolconnectonline.com/exam/sco-ifko', accent: '#587939', tint: '#f0f5e7' },
  { code: 'SIEIO', area: 'Khởi nghiệp & đổi mới', focus: 'Ý tưởng · Sáng tạo · Giải pháp', name: 'Olympic Khởi nghiệp và Đổi mới sáng tạo Quốc tế SCO', intro: 'Khám phá tư duy khởi nghiệp, phát triển ý tưởng và cách tìm giải pháp sáng tạo cho những vấn đề thực tế.', url: 'https://www.schoolconnectonline.com/exam/ieio', accent: '#b56936', tint: '#fbf0e7' },
  { code: 'SISSO', area: 'Khoa học xã hội', focus: 'Lịch sử · Địa lý · Xã hội', name: 'Olympic Khoa học xã hội Quốc tế SCO', intro: 'Khám phá lịch sử, địa lý và đời sống xã hội, kết nối kiến thức về con người với thế giới xung quanh.', url: 'https://www.schoolconnectonline.com/exam/isso', accent: '#548487', tint: '#edf5f3' },
];

export const additionalScoSites: LandingSite[] = scoCatalogue.map((item, index) => ({
  id: -201 - index, slug: item.code.toLowerCase(), title: `${item.code} · ${item.name}`,
  template: 'sco', layout: 'information', published: true, updatedAt: '2026-11-10', updatedBy: '',
  content: {
    subject: item.code, headline: item.name, intro: item.intro,
    resources: [{ category: 'SCO quốc tế', title: `Nội dung và tài liệu ${item.area}`, body: '', url: item.url }],
    contact: { email: 'khaothi@fermat.vn', phone: '0969 627 162' },
  },
}));
