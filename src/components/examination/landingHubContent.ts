export const defaultHubContent = {
  eyebrow: 'FermatTech · Cuộc thi quốc tế',
  title: 'Từ niềm yêu thích',
  emphasis: 'đến sân chơi quốc tế.',
  intro: 'FermatTech (FT) tổ chức và phối hợp triển khai các cuộc thi quốc tế tại Việt Nam, từ Olympic học thuật đến dự án AI và khoa học thực hành.',
  discoveryTitle: 'Khám phá các cuộc thi quốc tế',
  fermatTitle: 'Các cuộc thi do FermatTech sáng lập',
  scoTitle: 'Các kỳ Olympic của School Connect',
  scoIntro: 'School Connect Olympiad (SCO) là hệ thống các kỳ thi Olympic quốc tế dành cho học sinh, trải rộng từ Toán, Tiếng Anh và khoa học tự nhiên đến công nghệ, tài chính và kỹ năng sống. Mỗi cuộc thi mở ra một hướng khám phá kiến thức, khuyến khích vận dụng tư duy và kết nối bài học với thế giới xung quanh.',
  aysbcTitle: 'Cuộc thi Huy hiệu Nhà khoa học trẻ Châu Á',
  aysbcIntro: 'Khơi dậy sự tò mò khoa học qua những nhiệm vụ khám phá và thực hành theo huy hiệu.',
  waicyTitle: 'Cuộc thi Trí tuệ nhân tạo Thế giới dành cho Thanh thiếu niên',
  waicyIntro: 'Sáng tạo sản phẩm và ứng dụng AI để giải quyết những vấn đề trong cuộc sống.',
  joinTitle: 'Bắt đầu hành trình dự thi',
  personalIntro: 'Xem các cuộc thi đang nhận đăng ký và gửi thông tin thí sinh qua biểu mẫu trực tuyến.',
  schoolIntro: 'Nhận mẫu danh sách và hướng dẫn đăng ký theo đoàn từ Ban Khảo thí FermatTech.',
  individualUrl: '/dang-ky-du-thi',
  email: 'khaothi@fermat.vn',
  phone: '',
  address: '',
};

export type HubContent = typeof defaultHubContent;

export function resolveHubContent(value?: Partial<HubContent>): HubContent {
  const result = { ...defaultHubContent };
  for (const key of Object.keys(result) as Array<keyof HubContent>) {
    if (typeof value?.[key] === 'string') result[key] = value[key];
  }
  return result;
}
