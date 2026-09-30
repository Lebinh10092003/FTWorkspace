import { CalendarDays, FileSignature, GraduationCap, Handshake, LayoutDashboard, Trophy, UploadCloud, Users } from 'lucide-react';
import type { Candidate, Competition, ExaminationPage, ExaminationSession } from './types';

export const initialSessions: ExaminationSession[] = [
  { id: 'aysbc', code: 'AYSBC', name: 'Huy hiệu các Nhà khoa học trẻ Châu Á', parent: 'AYSBC', organizer: 'SCS và META Knowledge', time: '', candidates: 0, national: '', international: '', phase: 'Chưa cập nhật', note: '' },
  { id: 'imo', code: 'IMO', name: 'International Maths Olympiad', parent: 'SCO - IMO', organizer: 'SCO', time: '', candidates: 0, national: '', international: '', phase: 'Chưa cập nhật', note: '' },
  { id: 'ieo', code: 'IEO', name: 'International English Olympiad', parent: 'SCO - IEO', organizer: 'SCO', time: '', candidates: 0, national: '', international: '', phase: 'Chưa cập nhật', note: '' },
  { id: 'iso', code: 'ISO', name: 'International Science Olympiad', parent: 'SCO - ISO', organizer: 'SCO', time: '', candidates: 0, national: '', international: '', phase: 'Chưa cập nhật', note: '' },
  { id: 'fimo', code: 'FIMO', name: 'FermatTech International Mathematics Olympiad', parent: 'FIMO', organizer: 'FermatTech', time: '', candidates: 0, national: '', international: '', phase: 'Chưa cập nhật', note: '' },
  { id: 'fieo', code: 'FIEO', name: 'FermatTech International English Olympiad', parent: 'FIEO - Tiếng Anh', organizer: 'FermatTech', time: '', candidates: 0, national: '', international: '', phase: 'Chưa cập nhật', note: '' },
];

export const initialCandidates: Candidate[] = [];
export const initialCompetitions = (): Competition[] => initialSessions.map(({ id, code, name, organizer, parent }) => ({ id, code, name, organizer, parent }));
export const navigationItems: { id: Exclude<ExaminationPage, 'competition-detail' | 'candidate-detail'>; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'competitions', label: 'Cuộc thi', icon: Trophy },
  { id: 'sessions', label: 'Kỳ tổ chức', icon: CalendarDays },
  { id: 'candidates', label: 'Thí sinh', icon: Users },
  { id: 'registration-forms', label: 'Form đăng ký', icon: FileSignature },
  { id: 'partners', label: 'Đối tác', icon: Handshake },
  { id: 'classes', label: 'Lớp ôn tập', icon: GraduationCap },
  { id: 'import', label: 'Nhập dữ liệu', icon: UploadCloud },
];
