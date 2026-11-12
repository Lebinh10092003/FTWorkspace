import React, { useMemo, useState } from 'react';
import {
  Building2,
  Calendar,
  CalendarDays,
  ClipboardCheck,
  Clock,
  Cpu,
  FileCheck,
  FileText,
  Folder,
  Globe,
  GraduationCap,
  LayoutGrid,
  Link2,
  Mail,
  Megaphone,
  PenTool,
  QrCode,
  Receipt,
  Search,
  Share2,
  Sparkles,
  Trophy,
  Users,
  Wallet,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';

export type WorkspaceDeptKey = 'common' | 'exam' | 'tech' | 'media' | 'finance';

export interface DepartmentGroup {
  deptKey: WorkspaceDeptKey;
  name: string;
  shortName: string;
  desc: string;
  icon: LucideIcon;
  badgeColor: {
    bg: string;
    text: string;
    border: string;
    badge: string;
    pillActive: string;
    dot: string;
  };
}

export interface WorkspaceModuleItem {
  id: string;
  moduleKey: string;
  name: string;
  deptKey: WorkspaceDeptKey;
  deptName: string;
  desc: string;
  icon: LucideIcon;
  color: string;
  badge?: string;
  nativeWindow?: string;
}

export const DEPARTMENT_GROUPS: DepartmentGroup[] = [
  {
    deptKey: 'common',
    name: 'Khối Dùng Chung & Hành Chính',
    shortName: 'Dùng Chung',
    desc: 'Lịch công tác, chấm công, báo cáo tuần, nhân sự, tài nguyên & văn bản',
    icon: Building2,
    badgeColor: {
      bg: 'bg-amber-500/15',
      text: 'text-amber-300',
      border: 'border-amber-500/30',
      badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      pillActive: 'bg-amber-500/20 text-amber-200 border-amber-400/50 shadow-sm',
      dot: 'bg-amber-400',
    },
  },
  {
    deptKey: 'exam',
    name: 'Mảng Khảo Thí',
    shortName: 'Khảo Thí',
    desc: 'Hệ thống đề thi số, đề xuất kinh phí kỳ thi & cổng thi đấu trực tuyến',
    icon: GraduationCap,
    badgeColor: {
      bg: 'bg-sky-500/15',
      text: 'text-sky-300',
      border: 'border-sky-500/30',
      badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
      pillActive: 'bg-sky-500/20 text-sky-200 border-sky-400/50 shadow-sm',
      dot: 'bg-sky-400',
    },
  },
  {
    deptKey: 'tech',
    name: 'Công Nghệ & Đào Tạo Số',
    shortName: 'Công Nghệ & ĐTS',
    desc: 'Lộ trình học tập trực tuyến, chuyển đổi số & đánh giá BNDC',
    icon: Cpu,
    badgeColor: {
      bg: 'bg-indigo-500/15',
      text: 'text-indigo-300',
      border: 'border-indigo-500/30',
      badge: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
      pillActive: 'bg-indigo-500/20 text-indigo-200 border-indigo-400/50 shadow-sm',
      dot: 'bg-indigo-400',
    },
  },
  {
    deptKey: 'media',
    name: 'Truyền Thông & Đa Kênh',
    shortName: 'Truyền Thông',
    desc: 'Quản trị kênh xã hội, đăng tin, kế hoạch xuất bản & bộ công cụ sáng tạo',
    icon: Megaphone,
    badgeColor: {
      bg: 'bg-rose-500/15',
      text: 'text-rose-300',
      border: 'border-rose-500/30',
      badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
      pillActive: 'bg-rose-500/20 text-rose-200 border-rose-400/50 shadow-sm',
      dot: 'bg-rose-400',
    },
  },
  {
    deptKey: 'finance',
    name: 'Tài Chính & Kế Toán',
    shortName: 'Tài Chính',
    desc: 'Sổ kế toán điện tử, theo dõi dòng tiền, ngân sách & giải ngân',
    icon: Wallet,
    badgeColor: {
      bg: 'bg-emerald-500/15',
      text: 'text-emerald-300',
      border: 'border-emerald-500/30',
      badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      pillActive: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50 shadow-sm',
      dot: 'bg-emerald-400',
    },
  },
];

export const ALL_WORKSPACE_MODULES_BY_DEPT: WorkspaceModuleItem[] = [
  // 1. Khối Dùng Chung & Hành Chính ('common')
  {
    id: 'work-schedule',
    moduleKey: 'work-schedule',
    name: 'Lịch công tác & Giao việc',
    deptKey: 'common',
    deptName: 'Khối Dùng Chung & Hành Chính',
    desc: 'Lịch tuần ban lãnh đạo, giao việc chéo phòng ban, đồng bộ nhắc việc và kiểm soát tiến độ.',
    icon: Calendar,
    color: 'from-amber-500 to-orange-600',
    nativeWindow: 'reports',
  },
  {
    id: 'attendance',
    moduleKey: 'attendance',
    name: 'Công ca & Chấm công',
    deptKey: 'common',
    deptName: 'Khối Dùng Chung & Hành Chính',
    desc: 'Theo dõi ca làm việc, bảng chấm công cá nhân/phòng ban, tính công tự động theo thời gian thực.',
    icon: Clock,
    color: 'from-slate-500 to-slate-700',
    nativeWindow: 'attendance',
  },
  {
    id: 'weekly-report',
    moduleKey: 'weekly-report',
    name: 'Báo cáo tuần & Tiến độ',
    deptKey: 'common',
    deptName: 'Khối Dùng Chung & Hành Chính',
    desc: 'Tổng hợp OKRs, báo cáo tiến độ các ban, đánh giá hiệu suất và kế hoạch công tác tuần.',
    icon: FileText,
    color: 'from-amber-600 to-amber-700',
    nativeWindow: 'reports',
  },
  {
    id: 'account-management',
    moduleKey: 'account-management',
    name: 'Quản lý Nhân sự & Tài khoản',
    deptKey: 'common',
    deptName: 'Khối Dùng Chung & Hành Chính',
    desc: 'Hồ sơ nhân viên, phân quyền truy cập, danh bạ nội bộ và quản lý trạng thái tài khoản.',
    icon: Users,
    color: 'from-slate-600 to-zinc-700',
  },
  {
    id: 'resources',
    moduleKey: 'resources',
    name: 'Kho tài nguyên & Biểu mẫu',
    deptKey: 'common',
    deptName: 'Khối Dùng Chung & Hành Chính',
    desc: 'Kho biểu mẫu, tài liệu hướng dẫn quy chuẩn, biểu mẫu hành chính và tài sản công ty.',
    icon: Folder,
    color: 'from-amber-700 to-stone-800',
    nativeWindow: 'docs',
  },
  {
    id: 'document-number',
    moduleKey: 'document-number',
    name: 'Sổ cấp số công văn',
    deptKey: 'common',
    deptName: 'Khối Dùng Chung & Hành Chính',
    desc: 'Sổ cấp số công văn đi/đến, quản lý mẫu văn bản hành chính và văn bản nội bộ ban hành.',
    icon: FileCheck,
    color: 'from-zinc-600 to-slate-800',
  },

  // 2. Mảng Khảo Thí ('exam')
  {
    id: 'examination',
    moduleKey: 'examination',
    name: 'Khảo thí & Đề thi số',
    deptKey: 'exam',
    deptName: 'Mảng Khảo Thí',
    desc: 'Ngân hàng câu hỏi, tạo đề thi tự động, xuất PDF/Word và quản lý kỳ thi chuẩn hóa.',
    icon: GraduationCap,
    color: 'from-sky-500 to-blue-600',
    badge: 'Trọng yếu',
    nativeWindow: 'exam',
  },
  {
    id: 'funding-proposal',
    moduleKey: 'funding-proposal',
    name: 'Đề xuất kinh phí thi',
    deptKey: 'exam',
    deptName: 'Mảng Khảo Thí',
    desc: 'Lập dự trù, đề xuất kinh phí tổ chức kỳ thi, phê duyệt ngân sách và quyết toán khảo thí.',
    icon: Receipt,
    color: 'from-cyan-500 to-sky-600',
  },
  {
    id: 'competition-landing',
    moduleKey: 'competition-landing',
    name: 'Cổng thi đấu trực tuyến',
    deptKey: 'exam',
    deptName: 'Mảng Khảo Thí',
    desc: 'Cổng thông tin đăng ký thi, tra cứu số báo danh, phòng thi và kết quả thi trực tuyến.',
    icon: Trophy,
    color: 'from-sky-600 to-indigo-600',
  },

  // 3. Công Nghệ & Đào Tạo Số ('tech')
  {
    id: 'digital-training',
    moduleKey: 'digital-training',
    name: 'Công nghệ & Đào tạo số',
    deptKey: 'tech',
    deptName: 'Công Nghệ & Đào Tạo Số',
    desc: 'Lộ trình phát triển năng lực, khóa học số, bài giảng e-learning và tài liệu đào tạo nội bộ.',
    icon: Cpu,
    color: 'from-indigo-500 to-purple-600',
    badge: 'AI Powered',
    nativeWindow: 'training',
  },
  {
    id: 'training-assessments',
    moduleKey: 'training-assessments',
    name: 'Đánh giá học viên & BNDC',
    deptKey: 'tech',
    deptName: 'Công Nghệ & Đào Tạo Số',
    desc: 'Hệ thống đánh giá bài nộp học viên, cấp chứng chỉ BNDC và theo dõi năng lực số.',
    icon: ClipboardCheck,
    color: 'from-purple-500 to-violet-600',
    nativeWindow: 'training',
  },

  // 4. Truyền Thông & Đa Kênh ('media')
  {
    id: 'social-dashboard',
    moduleKey: 'social-dashboard',
    name: 'War-room Kênh Xã hội',
    deptKey: 'media',
    deptName: 'Truyền Thông & Đa Kênh',
    desc: 'Kết nối Facebook Fanpage, Zalo OA, đồng bộ dữ liệu tương tác và tự động phản hồi tin nhắn.',
    icon: Share2,
    color: 'from-rose-500 to-pink-600',
    nativeWindow: 'social',
  },
  {
    id: 'news-posts',
    moduleKey: 'news-posts',
    name: 'Đăng tin đa kênh',
    deptKey: 'media',
    deptName: 'Truyền Thông & Đa Kênh',
    desc: 'Biên soạn bài viết, quản lý lịch đăng tin, đồng bộ nội dung đa kênh tự động và kiểm duyệt bài.',
    icon: Sparkles,
    color: 'from-rose-500 to-pink-600',
    badge: 'Đa kênh',
    nativeWindow: 'social',
  },
  {
    id: 'publishing',
    moduleKey: 'publishing',
    name: 'Kế hoạch Xuất bản',
    deptKey: 'media',
    deptName: 'Truyền Thông & Đa Kênh',
    desc: 'Lên lịch phát hành nội dung đa nền tảng, điều phối chiến dịch truyền thông và lịch bài viết.',
    icon: CalendarDays,
    color: 'from-pink-600 to-rose-700',
    nativeWindow: 'social',
  },
  {
    id: 'communication-tools',
    moduleKey: 'communication-tools',
    name: 'Bộ công cụ Truyền thông',
    deptKey: 'media',
    deptName: 'Truyền Thông & Đa Kênh',
    desc: 'Bộ công cụ truyền thông đa phương tiện, kho asset marketing và tiện ích sáng tạo.',
    icon: Wrench,
    color: 'from-violet-500 to-fuchsia-600',
  },
  {
    id: 'email-builder',
    moduleKey: 'email-builder',
    name: 'Trình tạo Email Template',
    deptKey: 'media',
    deptName: 'Truyền Thông & Đa Kênh',
    desc: 'Thiết kế mẫu thư điện tử kéo thả chuẩn thương hiệu FermatTech với bố cục responsive.',
    icon: Mail,
    color: 'from-fuchsia-600 to-pink-600',
  },
  {
    id: 'signature-builder',
    moduleKey: 'signature-builder',
    name: 'Trình tạo Chữ ký số',
    deptKey: 'media',
    deptName: 'Truyền Thông & Đa Kênh',
    desc: 'Tạo chữ ký email chuẩn nhận diện thương hiệu công ty, sao chép HTML hoặc hình ảnh chỉ bằng 1 chạm.',
    icon: PenTool,
    color: 'from-pink-500 to-rose-500',
  },
  {
    id: 'qr-generator',
    moduleKey: 'qr-generator',
    name: 'Tạo mã QR thương hiệu',
    deptKey: 'media',
    deptName: 'Truyền Thông & Đa Kênh',
    desc: 'Tạo mã QR động gắn logo doanh nghiệp, tùy biến màu sắc chuẩn nhận diện thương hiệu.',
    icon: QrCode,
    color: 'from-rose-500 to-red-500',
  },
  {
    id: 'short-link',
    moduleKey: 'short-link',
    name: 'Rút gọn liên kết ShortLink',
    deptKey: 'media',
    deptName: 'Truyền Thông & Đa Kênh',
    desc: 'Rút gọn liên kết chia sẻ chiến dịch truyền thông, thống kê số lượt click và lượt chuyển đổi.',
    icon: Link2,
    color: 'from-rose-600 to-orange-500',
  },

  // 5. Tài Chính & Kế Toán ('finance')
  {
    id: 'finance-report',
    moduleKey: 'finance-report',
    name: 'Sổ Kế Toán & Ngân sách',
    deptKey: 'finance',
    deptName: 'Tài Chính & Kế Toán',
    desc: 'Sổ kế toán điện tử, theo dõi dòng tiền doanh nghiệp, dự toán ngân sách và giải ngân đề xuất.',
    icon: Wallet,
    color: 'from-emerald-500 to-teal-600',
    nativeWindow: 'finance',
  },
];

export type FermatOSLaunchpadProps = {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenModule: (moduleKey: string, moduleName: string, nativeWindow?: string) => void;
};

export function FermatOSLaunchpad({
  searchQuery,
  onSearchChange,
  onOpenModule,
}: FermatOSLaunchpadProps) {
  const [selectedDept, setSelectedDept] = useState<'all' | WorkspaceDeptKey>('all');

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const deptCounts = useMemo(() => {
    const counts: Record<WorkspaceDeptKey, number> = {
      common: 0,
      exam: 0,
      tech: 0,
      media: 0,
      finance: 0,
    };
    for (const mod of ALL_WORKSPACE_MODULES_BY_DEPT) {
      counts[mod.deptKey] += 1;
    }
    return counts;
  }, []);

  const visibleSections = useMemo(() => {
    const targetGroups =
      selectedDept === 'all'
        ? DEPARTMENT_GROUPS
        : DEPARTMENT_GROUPS.filter((g) => g.deptKey === selectedDept);

    return targetGroups
      .map((group) => {
        const modules = ALL_WORKSPACE_MODULES_BY_DEPT.filter((mod) => {
          if (mod.deptKey !== group.deptKey) return false;
          if (!normalizedQuery) return true;
          return (
            mod.name.toLowerCase().includes(normalizedQuery) ||
            mod.desc.toLowerCase().includes(normalizedQuery) ||
            mod.deptName.toLowerCase().includes(normalizedQuery) ||
            mod.moduleKey.toLowerCase().includes(normalizedQuery)
          );
        });
        return { group, modules };
      })
      .filter((section) => section.modules.length > 0);
  }, [selectedDept, normalizedQuery]);

  const totalMatching = useMemo(
    () => visibleSections.reduce((acc, s) => acc + s.modules.length, 0),
    [visibleSections]
  );

  const renderModuleCard = (mod: WorkspaceModuleItem, group: DepartmentGroup) => {
    const ModIcon = mod.icon;
    return (
      <div
        key={mod.id}
        className="p-3.5 rounded-2xl bg-slate-900/75 border border-white/10 hover:border-white/25 transition-all hover:bg-slate-900/95 flex flex-col justify-between group shadow-sm hover:shadow-xl"
      >
        <div>
          <div className="flex items-start justify-between gap-2">
            <div
              className={`w-10 h-10 rounded-xl bg-gradient-to-tr ${mod.color} flex items-center justify-center text-white shadow-md group-hover:scale-105 transition-transform shrink-0`}
            >
              <ModIcon className="w-5 h-5" />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              {mod.badge && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/10 text-sky-300 border border-white/15">
                  {mod.badge}
                </span>
              )}
              {mod.nativeWindow && (
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1"
                  title="Hỗ trợ cửa sổ Native trên FermatOS"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Native
                </span>
              )}
            </div>
          </div>

          <h4 className="font-bold text-xs text-white mt-2.5 leading-snug">{mod.name}</h4>
          <span
            className={`inline-block mt-1 px-2 py-0.5 rounded-md text-[10px] font-medium border ${group.badgeColor.badge}`}
          >
            {group.shortName}
          </span>
          <p className="text-[11px] text-slate-400 mt-1.5 line-clamp-2 leading-relaxed">
            {mod.desc}
          </p>
        </div>

        <div className="mt-3.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenModule(mod.moduleKey, mod.name, mod.nativeWindow)}
            className="flex-1 py-1.5 px-3 rounded-xl bg-sky-500/15 hover:bg-sky-500 text-sky-300 hover:text-white border border-sky-500/30 hover:border-sky-400 text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Mở ứng dụng</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-slate-950/40">
      {/* Thanh Search & Bộ lọc 5 khối phòng ban */}
      <div className="px-4 pt-3 pb-3 bg-slate-950/60 border-b border-white/10 space-y-2.5 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm kiếm ứng dụng, phân hệ làm việc..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full bg-slate-900 border border-white/15 rounded-xl pl-9 pr-8 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-sky-400 transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition cursor-pointer"
                title="Xóa tìm kiếm"
                aria-label="Xóa tìm kiếm"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <span className="text-xs text-slate-400 shrink-0">
            Hiển thị <strong className="text-slate-200">{totalMatching}</strong> phân hệ
          </span>
        </div>

        {/* Thanh filter pills ngang: Tất cả + 5 khối phòng ban */}
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => setSelectedDept('all')}
            className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold border transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
              selectedDept === 'all'
                ? 'bg-white/15 text-white border-white/30 shadow-sm'
                : 'bg-slate-900/70 text-slate-400 border-white/10 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5 text-sky-400" />
            <span>Tất cả</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/10 text-slate-300">
              {ALL_WORKSPACE_MODULES_BY_DEPT.length}
            </span>
          </button>

          {DEPARTMENT_GROUPS.map((group) => {
            const GroupIcon = group.icon;
            const isActive = selectedDept === group.deptKey;
            return (
              <button
                key={group.deptKey}
                type="button"
                onClick={() => setSelectedDept(group.deptKey)}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold border transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
                  isActive
                    ? group.badgeColor.pillActive
                    : 'bg-slate-900/70 text-slate-400 border-white/10 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <GroupIcon className={`w-3.5 h-3.5 ${isActive ? '' : group.badgeColor.text}`} />
                <span>{group.name}</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/25 text-current opacity-85">
                  {deptCounts[group.deptKey]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Nội dung danh sách phân hệ */}
      <div className="flex-1 p-5 overflow-y-auto space-y-6">
        {visibleSections.length === 0 ? (
          <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center p-6 rounded-2xl border border-dashed border-white/15 bg-slate-900/40">
            <Search className="w-9 h-9 text-slate-500 mb-3" />
            <h4 className="text-sm font-bold text-slate-200">
              Không tìm thấy phân hệ phù hợp
            </h4>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">
              Không có ứng dụng nào khớp với từ khóa &ldquo;{searchQuery}&rdquo; trong mục đang chọn.
            </p>
            <button
              type="button"
              onClick={() => {
                onSearchChange('');
                setSelectedDept('all');
              }}
              className="mt-4 px-3.5 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 text-xs font-semibold transition cursor-pointer"
            >
              Xem tất cả phân hệ
            </button>
          </div>
        ) : (
          visibleSections.map(({ group, modules }) => {
            const GroupIcon = group.icon;
            return (
              <section key={group.deptKey} className="space-y-3">
                {/* Group header: icon + tên khối + số lượng phân hệ */}
                <div className="flex items-center justify-between gap-3 pb-2 border-b border-white/10">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg ${group.badgeColor.bg} ${group.badgeColor.text} border ${group.badgeColor.border} flex items-center justify-center shrink-0`}
                    >
                      <GroupIcon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-xs sm:text-sm font-bold text-white tracking-wide truncate">
                        {group.name}
                      </h3>
                      <p className="text-[11px] text-slate-400 truncate hidden sm:block">
                        {group.desc}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border shrink-0 ${group.badgeColor.badge}`}
                  >
                    {modules.length} phân hệ
                  </span>
                </div>

                {/* Lưới 3 cột */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {modules.map((mod) => renderModuleCard(mod, group))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

export default FermatOSLaunchpad;
