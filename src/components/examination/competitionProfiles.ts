/** Thông tin đối tượng và định hướng đã công bố, dùng chung ở trang tổng và trang riêng. */
export type CompetitionCategory = 'academic' | 'science' | 'life';
export type CompetitionProfile = {
  area: string; grades: string; minGrade: number; maxGrade: number;
  category: CompetitionCategory; focus: string; glyph: string;
};

export const competitionProfiles: Record<string, CompetitionProfile> = {
  FIMO: { area: 'Toán học', grades: 'Lớp 1–9', minGrade: 1, maxGrade: 9, category: 'academic', focus: 'Logic · Lập luận · Giải quyết vấn đề', glyph: '∑' },
  FIEO: { area: 'Tiếng Anh', grades: 'Lớp 1–9', minGrade: 1, maxGrade: 9, category: 'academic', focus: 'Đọc hiểu · Ngôn ngữ · Vận dụng', glyph: 'Aa' },
  SIAIO: { area: 'Trí tuệ nhân tạo', grades: 'Lớp 1–12', minGrade: 1, maxGrade: 12, category: 'science', focus: 'Dữ liệu · Máy học · Ứng dụng AI', glyph: 'AI' },
  SIPHO: { area: 'Vật lý', grades: 'Lớp 8–12', minGrade: 8, maxGrade: 12, category: 'science', focus: 'Định luật · Mô hình hóa · Suy luận', glyph: 'Φ' },
  SICHO: { area: 'Hóa học', grades: 'Lớp 8–12', minGrade: 8, maxGrade: 12, category: 'science', focus: 'Chất · Phản ứng · Phân tích', glyph: 'H₂' },
  SIBO: { area: 'Sinh học', grades: 'Lớp 8–12', minGrade: 8, maxGrade: 12, category: 'science', focus: 'Sự sống · Di truyền · Hệ sinh thái', glyph: 'DNA' },
  SILSO: { area: 'Kỹ năng sống', grades: 'Lớp 1–12', minGrade: 1, maxGrade: 12, category: 'life', focus: 'Giao tiếp · Ra quyết định · Trách nhiệm', glyph: '↗' },
};

export const profileFor = (code: string) => competitionProfiles[code.trim().toUpperCase()];
