// Official programme categories, checked 10/11/2026.
// AYSBC: https://www.asiaysbc.com/competition
// WAICY: https://www.waicy.org/waicy-2026/
// Category artwork is supplied by those programmes; the video symbol is a local SVG.
export const programmeCategories: Record<string, { name: string; description: string; image?: string }[]> = {
  AYSBC: [
    { name: 'Côn trùng học', description: 'Young Entomologist', image: '/competition-categories/aysbc-entomologist.png' },
    { name: 'Thực vật học', description: 'Young Botanist', image: '/competition-categories/aysbc-botanist.png' },
    { name: 'Khoa học thực phẩm', description: 'Young Food Scientist', image: '/competition-categories/aysbc-food-scientist.png' },
    { name: 'Toán học', description: 'Young Mathematician', image: '/competition-categories/aysbc-mathematician.png' },
    { name: 'Phát triển bền vững', description: 'Young Sustainability Champion', image: '/competition-categories/aysbc-sustainability.png' },
  ],
  WAICY: [
    { name: 'Dự án ứng dụng AI', description: 'AI Showcase', image: '/competition-categories/waicy-showcase.png' },
    { name: 'Nghệ thuật tạo bằng AI', description: 'AI Generated Art', image: '/competition-categories/waicy-art.png' },
    { name: 'Video tạo bằng AI', description: 'AI Generated Video' },
    { name: 'Mô hình ngôn ngữ lớn', description: 'AI Large Language Model', image: '/competition-categories/waicy-llm.png' },
  ],
};
