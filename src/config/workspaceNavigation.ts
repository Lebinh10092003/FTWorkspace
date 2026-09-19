import type React from 'react';
import {
  BadgeDollarSign,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ChartColumnBig,
  ClipboardList,
  ContactRound,
  FileCheck2,
  FolderTree,
  GraduationCap,
  Handshake,
  LayoutDashboard,
  LayoutGrid,
  Mail,
  Megaphone,
  PackageSearch,
  Presentation,
  QrCode,
  ShieldUser,
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
  /** Shown inside the collapsed rail tooltip and on narrow screens. */
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
    label: 'Trang chủ Workspace',
    shortLabel: 'Trang chủ',
    description: 'Danh sách ứng dụng của FT Workspace.',
    icon: LayoutGrid,
    path: '/',
  },
  {
    id: 'work-schedule',
    label: 'Lịch làm việc',
    shortLabel: 'Lịch làm việc',
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
    relatedViews: ['email-builder', 'signature-builder', 'qr-generator', 'competition-landing'],
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
    description: 'Theo dõi tổng thu, tổng chi, công nợ và chứng từ.',
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
  /** Feature flag key evaluated by the module before rendering. */
  requires?: string;
};

/**
 * Horizontal menu of "Công nghệ & Đào tạo số".
 * Ids match the tab / product-view identifiers already used by the module, so
 * existing routes keep working unchanged.
 */
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
  { id: 'bndc', label: 'Quản lý BNDC', icon: FolderTree },
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
  { id: 'competition-landing', label: 'Trang giới thiệu cuộc thi', icon: Presentation },
];

/** Returns the top-level horizontal entry that owns a given leaf id. */
export function parentNavId(items: ModuleNavItem[], leafId: string): string | null {
  for (const item of items) {
    if (item.id === leafId) return item.id;
    if ((item.children || []).some(child => child.id === leafId)) return item.id;
  }
  return null;
}
