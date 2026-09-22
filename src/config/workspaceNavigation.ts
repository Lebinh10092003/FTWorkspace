import type React from 'react';
import {
  BadgeDollarSign,
  BookOpen,
  Bot,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ChartColumnBig,
  ClipboardList,
  ContactRound,
  FileCheck2,
  FileClock,
  FileSignature,
  FileSpreadsheet,
  FileText,
  FolderTree,
  GraduationCap,
  Handshake,
  Layers3,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  Mail,
  Megaphone,
  PackageSearch,
  Presentation,
  QrCode,
  Radio,
  ReceiptText,
  RefreshCw,
  School,
  Settings,
  ShieldUser,
  Trophy,
  UploadCloud,
  UserCheck,
  Users,
} from 'lucide-react';

/**
 * Single source of truth for FT Workspace navigation.
 *
 * The shell uses two levels:
 *  - areas  (vertical rail)   : one entry per business domain / application.
 *  - module nav (horizontal)  : the tasks that live inside the selected area.
 *
 * Screens read this configuration instead of hard-coding their own menus, so a
 * new module only needs an entry here plus its view in App.tsx.
 */

export type WorkspaceAreaId =
  | 'workspace'
  | 'work-schedule'
  | 'examination'
  | 'digital-training'
  | 'social-dashboard'
  | 'communication-tools'
  | 'account-management'
  | 'finance-report'
  | 'attendance';

export type WorkspaceArea = {
  /** Matches the App view mode so the rail can drive routing directly. */
  id: WorkspaceAreaId;
  label: string;
  /** Shown inside the collapsed rail and in the tooltip. */
  shortLabel: string;
  description: string;
  icon: React.ElementType;
  path: string;
  /** Extra view modes that still belong to this area (for rail highlighting). */
  relatedViews?: string[];
};

export const WORKSPACE_AREAS: WorkspaceArea[] = [
  {
    id: 'workspace',
    label: 'Trang chủ',
    shortLabel: 'Trang chủ',
    description: 'Danh sách ứng dụng của FT Workspace.',
    icon: LayoutGrid,
    path: '/',
  },
  {
    id: 'work-schedule',
    label: 'Lịch làm việc',
    shortLabel: 'Lịch việc',
    description: 'Lập lịch cá nhân, quản lý nhiệm vụ và theo dõi công việc đội nhóm.',
    icon: CalendarRange,
    path: '/work-schedule',
  },
  {
    id: 'examination',
    label: 'Khảo thí',
    shortLabel: 'Khảo thí',
    description: 'Quản lý cuộc thi, kỳ tổ chức, thí sinh và nguồn dữ liệu.',
    icon: ClipboardList,
    path: '/examination',
  },
  {
    id: 'digital-training',
    label: 'Công nghệ & Đào tạo số',
    shortLabel: 'Đào tạo số',
    description: 'Khách hàng, lịch tập huấn, BNDC và sản phẩm chuyển đổi số.',
    icon: GraduationCap,
    path: '/digital-training',
    relatedViews: ['training-assessments'],
  },
  {
    id: 'social-dashboard',
    label: 'Truyền thông',
    shortLabel: 'Truyền thông',
    description: 'Theo dõi Facebook, Zalo OA, báo cáo tương tác và đồng bộ dữ liệu.',
    icon: ChartColumnBig,
    path: '/social-dashboard',
  },
  {
    id: 'communication-tools',
    label: 'Bộ công cụ FermatTech',
    shortLabel: 'Bộ công cụ',
    description: 'Thiết kế Email, chữ ký, mã QR và trang giới thiệu cuộc thi.',
    icon: Megaphone,
    path: '/communication-tools',
    relatedViews: ['email-builder', 'signature-builder', 'qr-generator', 'competition-landing', 'weekly-report'],
  },
  {
    id: 'account-management',
    label: 'Quản lý nhân viên',
    shortLabel: 'Nhân viên',
    description: 'Tạo, phân quyền và quản lý thành viên Workspace.',
    icon: ShieldUser,
    path: '/account-management',
  },
  {
    id: 'finance-report',
    label: 'Báo cáo thu chi',
    shortLabel: 'Thu chi',
    description: 'Tổng thu, tổng chi, công nợ, đối soát khảo thí và hạn hợp đồng.',
    icon: BadgeDollarSign,
    path: '/finance-report',
  },
  {
    id: 'attendance',
    label: 'Công ca',
    shortLabel: 'Công ca',
    description: 'Ghi nhận giờ vào, giờ ra và theo dõi dữ liệu công ca theo tháng.',
    icon: CalendarCheck,
    path: '/attendance',
  },
];

/** Resolves which rail entry should be highlighted for a given view mode. */
export function areaForView(view: string): WorkspaceAreaId | null {
  const direct = WORKSPACE_AREAS.find(area => area.id === view);
  if (direct) return direct.id;
  const related = WORKSPACE_AREAS.find(area => (area.relatedViews || []).includes(view));
  return related ? related.id : null;
}

export type ModuleNavItem = {
  id: string;
  label: string;
  icon: React.ElementType;
  /** Optional sub-tasks rendered as a dropdown under the horizontal entry. */
  children?: ModuleNavItem[];
  /** Capability key the module evaluates before showing the entry. */
  requires?: string;
  /** Small counter rendered next to the label (pending work, alerts...). */
  badge?: number | string;
};

/**
 * Removes entries whose `requires` key is not granted, including inside
 * dropdowns, and drops a group that ends up with no reachable child.
 */
export function filterModuleNav(items: ModuleNavItem[], granted: Record<string, boolean>): ModuleNavItem[] {
  const allowed = (item: ModuleNavItem) => !item.requires || granted[item.requires] === true;
  return items.filter(allowed).map(item => {
    if (!item.children) return item;
    return { ...item, children: item.children.filter(allowed) };
  }).filter(item => !item.children || item.children.length > 0);
}

/** Applies badge counts by leaf id, including entries inside dropdowns. */
export function withNavBadges(items: ModuleNavItem[], badges: Record<string, number>): ModuleNavItem[] {
  const badgeFor = (item: ModuleNavItem) => (badges[item.id] ? { ...item, badge: badges[item.id] } : item);
  return items.map(item => {
    const next = badgeFor(item);
    if (!item.children) return next;
    const children = item.children.map(badgeFor);
    const total = children.reduce((sum, child) => sum + (typeof child.badge === 'number' ? child.badge : 0), 0);
    return { ...next, children, badge: next.badge || (total || undefined) };
  });
}

/** Horizontal menu of "Công nghệ & Đào tạo số". Ids match the module tabs. */
export const DIGITAL_TRAINING_NAV: ModuleNavItem[] = [
  { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
  {
    id: 'schedule',
    label: 'Lịch gặp khách hàng',
    icon: CalendarDays,
    children: [
      { id: 'calendar', label: 'Lịch', icon: CalendarDays },
      { id: 'sessions', label: 'Báo cáo lịch công tác', icon: ClipboardList },
    ],
  },
  {
    id: 'customers',
    label: 'Khách hàng',
    icon: Handshake,
    children: [
      { id: 'products-allocation', label: 'Khách hàng hiện tại', icon: Handshake },
      { id: 'leads', label: 'Khách hàng mới', icon: Users },
    ],
  },
  { id: 'quanlybndc', label: 'Quản lý BNDC', icon: FolderTree },
  {
    id: 'training',
    label: 'Đào tạo & tập huấn',
    icon: GraduationCap,
    children: [
      { id: 'partner-sessions', label: 'Theo dõi tập huấn', icon: ClipboardList },
      { id: 'training-assessments', label: 'Bài kiểm tra cuối khóa tập huấn', icon: FileCheck2 },
    ],
  },
  {
    id: 'products',
    label: 'Sản phẩm & dịch vụ',
    icon: PackageSearch,
    children: [
      { id: 'products-catalog', label: 'Danh mục', icon: PackageSearch },
      { id: 'products-statistics', label: 'Thống kê sử dụng', icon: ClipboardList },
    ],
  },
  { id: 'survey', label: 'Khảo sát', icon: Users },
  { id: 'materials', label: 'Tài liệu', icon: BookOpen },
  { id: 'finance', label: 'Báo cáo', icon: BadgeDollarSign, requires: 'finance' },
];

/** Horizontal menu of "Bộ công cụ FermatTech". Ids match App view modes. */
export const COMMUNICATION_TOOLS_NAV: ModuleNavItem[] = [
  { id: 'communication-tools', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'email-builder', label: 'Thiết kế Email', icon: Mail },
  { id: 'signature-builder', label: 'Tạo chữ ký Email', icon: ContactRound },
  { id: 'qr-generator', label: 'Tạo mã QR', icon: QrCode },
  { id: 'funding-proposal', label: 'Phiếu đề xuất kinh phí', icon: ReceiptText },
  { id: 'document-number', label: 'Trình tạo số Công văn', icon: FileSignature },
  { id: 'weekly-report', label: 'Báo cáo cuối tuần', icon: ClipboardList },
  { id: 'competition-landing', label: 'Trang giới thiệu cuộc thi', icon: Presentation },
];

/** Horizontal menu of "Lịch làm việc". Ids match the module views. */
export const WORK_SCHEDULE_NAV: ModuleNavItem[] = [
  { id: 'board', label: 'Công việc theo ngày', icon: LayoutDashboard },
  { id: 'week', label: 'Lịch tuần / tháng', icon: CalendarDays },
  { id: 'team', label: 'Quản lý nhân sự', icon: UserCheck, requires: 'team' },
  { id: 'sheet', label: 'Liên kết Google Sheets', icon: FileSpreadsheet, requires: 'admin' },
];

/** Horizontal menu of "Khảo thí". Ids match the module pages. */
export const EXAMINATION_NAV: ModuleNavItem[] = [
  { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
  {
    id: 'competition-group',
    label: 'Cuộc thi',
    icon: Trophy,
    children: [
      { id: 'sessions', label: 'Các kỳ tổ chức', icon: CalendarDays },
      { id: 'competitions', label: 'Thông tin các cuộc thi', icon: Trophy },
    ],
  },
  { id: 'candidates', label: 'Thí sinh', icon: Users },
  { id: 'partners', label: 'Đối tác', icon: Handshake },
  {
    id: 'class-group',
    label: 'Lớp ôn tập',
    icon: GraduationCap,
    children: [
      { id: 'classes', label: 'Các lớp ôn tập', icon: School },
      { id: 'teachers', label: 'Thông tin giáo viên', icon: Users },
    ],
  },
  {
    id: 'paper-group',
    label: 'Đề thi',
    icon: FileText,
    children: [
      { id: 'papers', label: 'Ngân hàng đề thi', icon: FileText },
      { id: 'blueprints', label: 'Ma trận đề', icon: Layers3 },
      { id: 'ai-config', label: 'Cấu hình AI', icon: Bot, requires: 'edit' },
    ],
  },
  { id: 'import', label: 'Nhập dữ liệu', icon: UploadCloud, requires: 'member' },
];

/** Maps an examination detail page back to the menu entry that owns it. */
export const EXAMINATION_PAGE_TO_NAV: Record<string, string> = {
  'competition-detail': 'competitions',
  'session-detail': 'sessions',
  'candidate-detail': 'candidates',
  'class-detail': 'classes',
  'teacher-detail': 'teachers',
  'paper-detail': 'papers',
  'paper-create': 'papers',
  'blueprint-detail': 'blueprints',
};

/** Horizontal menu of "Truyền thông". Ids match the social dashboard tabs. */
export const SOCIAL_DASHBOARD_NAV: ModuleNavItem[] = [
  { id: 'dashboard', label: 'Biểu đồ tổng quan', icon: LayoutDashboard },
  { id: 'media', label: 'Báo cáo tổng hợp', icon: Radio },
  { id: 'posts', label: 'Bài đăng', icon: FileText },
  { id: 'sync', label: 'Đồng bộ dữ liệu', icon: RefreshCw, requires: 'member' },
  { id: 'config', label: 'Cấu hình hệ thống', icon: Settings, requires: 'member' },
];

/** Horizontal menu of "Công ca". Ids match the module tabs. */
export const ATTENDANCE_NAV: ModuleNavItem[] = [
  { id: 'timesheet', label: 'Bảng công tháng', icon: CalendarCheck },
  { id: 'sheet', label: 'Liên kết Google Sheets', icon: FileSpreadsheet, requires: 'admin' },
];

/** Horizontal menu of "Quản lý nhân viên". Ids match the module tabs. */
export const ACCOUNT_MANAGEMENT_NAV: ModuleNavItem[] = [
  { id: 'employees', label: 'Danh sách nhân viên', icon: Users },
];

/** Horizontal menu of "Báo cáo thu chi". */
export const FINANCE_NAV: ModuleNavItem[] = [
  { id: 'report', label: 'Báo cáo thu chi', icon: BadgeDollarSign },
  { id: 'examination-billing', label: 'Đối soát khảo thí', icon: ReceiptText },
  { id: 'contracts', label: 'Hạn hợp đồng', icon: FileClock },
];

/** Horizontal menu of "Bài kiểm tra cuối khóa tập huấn". */
export const TRAINING_ASSESSMENT_NAV: ModuleNavItem[] = [
  { id: 'assessments', label: 'Bài kiểm tra cuối khóa', icon: FileCheck2 },
  { id: 'bank-settings', label: 'Set up ngân hàng đề thi', icon: Link2, requires: 'questionBank' },
  { id: 'digital-training', label: 'Mở Đào tạo số', icon: GraduationCap },
];

/** Returns the top-level horizontal entry that owns a given leaf id. */
export function parentNavId(items: ModuleNavItem[], leafId: string): string | null {
  for (const item of items) {
    if (item.id === leafId) return item.id;
    if ((item.children || []).some(child => child.id === leafId)) return item.id;
  }
  return null;
}
