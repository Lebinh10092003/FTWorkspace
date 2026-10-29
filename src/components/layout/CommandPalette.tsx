import React, { useEffect, useState, useMemo } from 'react';
import {
  Search,
  School,
  FileSpreadsheet,
  Calendar,
  Layers,
  GraduationCap,
  Users,
  Briefcase, Sparkles,
  RefreshCw,
  PlusCircle,
  X
} from 'lucide-react';

export type CommandItem = {
  id: string;
  category: 'Phân hệ' | 'Trường học' | 'Thao tác nhanh';
  title: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  action: () => void;
};

export default function CommandPalette({
  isOpen,
  onClose,
  onNavigate,
  onOpenNewSubscription,
  onSyncSheet
}: {
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (path: string) => void;
  onOpenNewSubscription?: () => void;
  onSyncSheet?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Global keyboard listener for Cmd+K / Ctrl+K and Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) {
          onClose();
        } else {
          // Trigger open via custom event
          window.dispatchEvent(new CustomEvent('toggle-command-palette'));
        }
      } else if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Default command items
  const commands: CommandItem[] = useMemo(() => [
    // Phân hệ
    {
      id: 'nav-digital-training',
      category: 'Phân hệ',
      title: 'Công nghệ & đào tạo số (CRM & Hạn dùng)',
      subtitle: 'Quản lý khách hàng, hạn dịch vụ license và đồng bộ Sheet',
      icon: Layers,
      badge: 'Chính',
      action: () => {
        onNavigate ? onNavigate('/digital-training/subscriptions') : (window.location.href = '/digital-training/subscriptions');
        onClose();
      }
    },
    {
      id: 'nav-training-sessions',
      category: 'Phân hệ',
      title: 'Theo dõi & Nhật ký tập huấn',
      subtitle: 'Quản lý các ca đào tạo số, phân nhóm lớp học và tiến độ hoàn thành',
      icon: GraduationCap,
      action: () => {
        onNavigate ? onNavigate('/digital-training/partner-sessions') : (window.location.href = '/digital-training/partner-sessions');
        onClose();
      }
    },
    {
      id: 'nav-examination',
      category: 'Phân hệ',
      title: 'Khảo thí & Kỳ thi',
      subtitle: 'Tổ chức kỳ thi, quản lý thí sinh, phòng thi và kết quả',
      icon: GraduationCap,
      action: () => {
        onNavigate ? onNavigate('/examination') : (window.location.href = '/examination');
        onClose();
      }
    },
    {
      id: 'nav-work-schedule',
      category: 'Phân hệ',
      title: 'Lịch làm việc & Nhiệm vụ',
      subtitle: 'Lập lịch cá nhân, giao việc và theo dõi tiến độ nhóm',
      icon: Calendar,
      action: () => {
        onNavigate ? onNavigate('/work-schedule') : (window.location.href = '/work-schedule');
        onClose();
      }
    },
    {
      id: 'nav-finance',
      category: 'Phân hệ',
      title: 'Báo cáo thu chi',
      subtitle: 'Tổng thu, chi, công nợ và tình trạng xử lý tài chính',
      icon: Briefcase,
      action: () => {
        onNavigate ? onNavigate('/finance-report') : (window.location.href = '/finance-report');
        onClose();
      }
    },
    {
      id: 'nav-staff',
      category: 'Phân hệ',
      title: 'Quản lý nhân viên',
      subtitle: 'Phân quyền, tài khoản và thông tin nhân sự',
      icon: Users,
      action: () => {
        onNavigate ? onNavigate('/account-management') : (window.location.href = '/account-management');
        onClose();
      }
    },

    // Khách hàng tiêu biểu
    {
      id: 'partner-marie-curie',
      category: 'Trường học',
      title: 'THCS & THPT Marie Curie (Hà Nội)',
      subtitle: 'Lớp học số · 50 license · Còn 15 ngày',
      icon: School,
      badge: 'Sắp hết hạn',
      action: () => {
        onNavigate ? onNavigate('/digital-training/subscriptions?search=Marie Curie') : (window.location.href = '/digital-training/subscriptions?search=Marie Curie');
        onClose();
      }
    },
    {
      id: 'partner-chu-van-an',
      category: 'Trường học',
      title: 'THCS Chu Văn An (Hà Nội)',
      subtitle: 'BNDC · 80 license · Còn 7 ngày',
      icon: School,
      badge: 'Khẩn cấp',
      action: () => {
        onNavigate ? onNavigate('/digital-training/subscriptions?search=Chu Văn An') : (window.location.href = '/digital-training/subscriptions?search=Chu Văn An');
        onClose();
      }
    },
    {
      id: 'partner-ams',
      category: 'Trường học',
      title: 'THPT Chuyên Hà Nội - Amsterdam',
      subtitle: 'AI dùng chung · 120 license · Đang dùng',
      icon: School,
      action: () => {
        onNavigate ? onNavigate('/digital-training/subscriptions?search=Amsterdam') : (window.location.href = '/digital-training/subscriptions?search=Amsterdam');
        onClose();
      }
    },
    {
      id: 'partner-lam-son',
      category: 'Trường học',
      title: 'THPT Chuyên Lam Sơn (Thanh Hóa)',
      subtitle: 'Lớp học số · 45 license · Quá hạn 15 ngày',
      icon: School,
      badge: 'Quá hạn',
      action: () => {
        onNavigate ? onNavigate('/digital-training/subscriptions?search=Lam Sơn') : (window.location.href = '/digital-training/subscriptions?search=Lam Sơn');
        onClose();
      }
    },
    {
      id: 'partner-vinschool',
      category: 'Trường học',
      title: 'Vinschool Times City (Hà Nội)',
      subtitle: 'Chromebook · 200 license · Đang dùng',
      icon: School,
      action: () => {
        onNavigate ? onNavigate('/digital-training/subscriptions?search=Vinschool') : (window.location.href = '/digital-training/subscriptions?search=Vinschool');
        onClose();
      }
    },

    // Thao tác nhanh
    {
      id: 'action-new-sub',
      category: 'Thao tác nhanh',
      title: 'Đăng ký dịch vụ mới cho khách hàng',
      subtitle: 'Tạo gói bản quyền hoặc dịch vụ tập huấn mới',
      icon: PlusCircle,
      action: () => {
        if (onOpenNewSubscription) {
          onOpenNewSubscription();
        } else {
          window.location.href = '/digital-training/subscriptions?action=new';
        }
        onClose();
      }
    },
    {
      id: 'action-sync-sheet',
      category: 'Thao tác nhanh',
      title: 'Đồng bộ 2 chiều với Google Sheet',
      subtitle: 'Cập nhật thay đổi tức thì giữa Web và Google Sheet',
      icon: RefreshCw,
      action: () => {
        if (onSyncSheet) {
          onSyncSheet();
        } else {
          window.location.href = '/digital-training/subscriptions?action=sync';
        }
        onClose();
      }
    },
    {
      id: 'action-open-sheet',
      category: 'Thao tác nhanh',
      title: 'Mở Google Sheet theo dõi dịch vụ & bản quyền',
      subtitle: 'Xem trực tiếp Tab 1 Dịch vụ & Bản quyền trên Google Sheet',
      icon: FileSpreadsheet,
      action: () => {
        window.open('https://docs.google.com/spreadsheets/d/1ENU0abZu6hCiVz-u7ypMLmLzudzMewKF_6s-6NJ26qk/edit?usp=sharing', '_blank');
        onClose();
      }
    },
    {
      id: 'action-open-training-sheet',
      category: 'Thao tác nhanh',
      title: 'Mở Google Sheet Nhật ký tập huấn',
      subtitle: 'Xem trực tiếp Tab 2 Nhật ký tập huấn trên Google Sheet',
      icon: FileSpreadsheet,
      action: () => {
        window.open('https://docs.google.com/spreadsheets/d/1ENU0abZu6hCiVz-u7ypMLmLzudzMewKF_6s-6NJ26qk/edit?usp=sharing', '_blank');
        onClose();
      }
    }
  ], [onNavigate, onOpenNewSubscription, onSyncSheet, onClose]);

  // Filter commands
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;
    const lower = query.toLowerCase().trim();
    return commands.filter(c =>
      c.title.toLowerCase().includes(lower) ||
      (c.subtitle && c.subtitle.toLowerCase().includes(lower)) ||
      c.category.toLowerCase().includes(lower)
    );
  }, [commands, query]);

  // Handle arrows and Enter
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % (filteredCommands.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % (filteredCommands.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const current = filteredCommands[selectedIndex];
      if (current) {
        current.action();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-start justify-center pt-16 sm:pt-24 px-4 bg-slate-950/40 backdrop-blur-xs animate-in fade-in-0 duration-150">
      <div
        className="w-full max-w-xl rounded-2xl border border-slate-200/90 bg-white shadow-2xl overflow-hidden flex flex-col font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 border-b border-slate-200/80 px-4 py-3 bg-white">
          <Search className="h-5 w-5 text-slate-400 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Tìm kiếm phân hệ, trường học, thao tác nhanh..."
            className="flex-1 bg-transparent text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-slate-400 hover:text-slate-600 p-0.5 rounded-sm cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-block rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 shadow-2xs">
              ESC
            </kbd>
          )}
        </div>

        {/* Results List */}
        <div className="max-h-[360px] overflow-y-auto p-2 divide-y divide-slate-100/60">
          {filteredCommands.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              Không tìm thấy kết quả nào khớp với "{query}".
            </div>
          ) : (
            filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              const Icon = cmd.icon;

              return (
                <div
                  key={cmd.id}
                  onClick={() => cmd.action()}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${
                    isSelected ? 'bg-blue-50 text-blue-900' : 'hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                        isSelected
                          ? 'bg-blue-600 border-blue-600 text-white shadow-xs'
                          : 'bg-slate-100 border-slate-200/80 text-slate-600'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold truncate">{cmd.title}</span>
                        {cmd.badge && (
                          <span
                            className={`rounded-full px-1.5 py-0.2 text-[9px] font-semibold border ${
                              cmd.badge === 'Khẩn cấp' || cmd.badge === 'Quá hạn'
                                ? 'bg-rose-50 text-rose-700 border-rose-200/60'
                                : cmd.badge === 'Sắp hết hạn'
                                ? 'bg-amber-50 text-amber-700 border-amber-200/60'
                                : 'bg-blue-100 text-blue-700 border-blue-200/60'
                            }`}
                          >
                            {cmd.badge}
                          </span>
                        )}
                      </div>
                      {cmd.subtitle && (
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">
                          {cmd.subtitle}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 pl-2">
                    <span
                      className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-medium border ${
                        isSelected
                          ? 'bg-blue-100 text-blue-700 border-blue-200'
                          : 'bg-slate-100 text-slate-500 border-slate-200/60'
                      }`}
                    >
                      {cmd.category}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Shortcut Hints */}
        <div className="flex items-center justify-between border-t border-slate-200/80 bg-slate-50/80 px-4 py-2 text-[11px] text-slate-500">
          <div className="flex items-center gap-3">
            <span><kbd className="font-semibold text-slate-700">↑ ↓</kbd> Di chuyển</span>
            <span><kbd className="font-semibold text-slate-700">↵</kbd> Chọn</span>
            <span><kbd className="font-semibold text-slate-700">ESC</kbd> Đóng</span>
          </div>
          <div className="flex items-center gap-1.5 text-blue-600 font-semibold text-[11px]">
            <Sparkles className="h-3 w-3" />
            <span>Fermat Workspace OS</span>
          </div>
        </div>
      </div>
    </div>
  );
}
