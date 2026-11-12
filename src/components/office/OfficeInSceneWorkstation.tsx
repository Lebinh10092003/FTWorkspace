import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Plus,
  Check,
  Clock,
  User,
  Search,
  BookOpen,
  GraduationCap,
  Play,
  LoaderCircle,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import {
  FermatOSFinanceWindow,
  FermatOSSocialWindow,
  FermatOSTrainingWindow,
  FermatOSAttendanceWindow,
} from './FermatOSDepartmentApps';

export interface OfficeInSceneWorkstationProps {
  activeModal: string;
  onClose: () => void;
  onOpenDesktopOS: (appId?: string) => void;
  idToken?: string;
  currentUser: { name?: string | null; role?: string | null; email?: string | null };
  roster: any[];
  onFocusWorker?: (worker: any) => void;
  onNavigateModule?: (mode: string) => void;
}

// 5 Khối phòng ban tiêu chuẩn
export const DEPARTMENT_KEYS = [
  { id: 'all', label: 'Tất cả phòng ban', color: 'slate' },
  { id: 'tech', label: 'Công nghệ & Đào tạo số', color: 'sky' },
  { id: 'exam', label: 'Khảo thí & Đề thi', color: 'purple' },
  { id: 'media', label: 'Truyền thông & Đa kênh', color: 'rose' },
  { id: 'finance', label: 'Tài chính & Kế toán', color: 'amber' },
  { id: 'admin', label: 'Hành chính & Dùng chung', color: 'slate' },
] as const;

// Helper xác định phòng ban của công việc dựa trên tags/title/content
function detectDepartment(item: any): 'tech' | 'exam' | 'media' | 'finance' | 'admin' {
  const text = `${item.title || ''} ${item.content || ''} ${item.category || ''} ${item.department || ''}`.toLowerCase();
  if (text.includes('khảo thí') || text.includes('đề thi') || text.includes('chấm thi') || text.includes('exam')) return 'exam';
  if (text.includes('công nghệ') || text.includes('đào tạo') || text.includes('tech') || text.includes('bndc') || text.includes('app') || text.includes('hệ thống')) return 'tech';
  if (text.includes('truyền thông') || text.includes('bài viết') || text.includes('fanpage') || text.includes('zalo') || text.includes('media') || text.includes('tin tức')) return 'media';
  if (text.includes('tài chính') || text.includes('kế toán') || text.includes('kinh phí') || text.includes('thu') || text.includes('chi') || text.includes('lương')) return 'finance';
  return 'admin';
}

// Sticky note styling theo 5 màu phòng ban
const DEPT_STYLE: Record<'tech' | 'exam' | 'media' | 'finance' | 'admin', { bg: string; pin: string; badge: string; name: string }> = {
  tech: {
    bg: 'bg-sky-950/70 border-sky-500/40 text-sky-100 hover:border-sky-400',
    pin: 'bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]',
    badge: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    name: 'Công nghệ',
  },
  exam: {
    bg: 'bg-purple-950/70 border-purple-500/40 text-purple-100 hover:border-purple-400',
    pin: 'bg-purple-400 shadow-[0_0_8px_rgba(192,132,252,0.8)]',
    badge: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    name: 'Khảo thí',
  },
  media: {
    bg: 'bg-rose-950/70 border-rose-500/40 text-rose-100 hover:border-rose-400',
    pin: 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]',
    badge: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    name: 'Truyền thông',
  },
  finance: {
    bg: 'bg-amber-950/70 border-amber-500/40 text-amber-100 hover:border-amber-400',
    pin: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]',
    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    name: 'Tài chính',
  },
  admin: {
    bg: 'bg-slate-900/80 border-slate-700/60 text-slate-100 hover:border-slate-500',
    pin: 'bg-slate-300 shadow-[0_0_8px_rgba(203,213,225,0.8)]',
    badge: 'bg-slate-700/50 text-slate-300 border-slate-600/40',
    name: 'Hành chính',
  },
};

export default function OfficeInSceneWorkstation({
  activeModal,
  onClose,
  onOpenDesktopOS,
  idToken,
  currentUser,
  roster,
  onFocusWorker,
  onNavigateModule,
}: OfficeInSceneWorkstationProps) {
  // ----------------------------------------------------
  // 1. STATE BẢNG KẾ HOẠCH NAM CHÂM KANBAN (WORK-SCHEDULE)
  // ----------------------------------------------------
  const [scheduleItems, setScheduleItems] = useState<any[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [selectedDept, setSelectedDept] = useState<string>('all');
  const [onlyMyTasks, setOnlyMyTasks] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ----------------------------------------------------
  // 2. STATE KHẢO THÍ (EXAMINATION)
  // ----------------------------------------------------
  const [examPapers, setExamPapers] = useState<any[]>([]);
  const [examLoading, setExamLoading] = useState(false);
  const [examSearch, setExamSearch] = useState('');

  // ----------------------------------------------------
  // 3. STATE NHÂN SỰ & BOT (ACCOUNT-MANAGEMENT)
  // ----------------------------------------------------
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterDeptFilter, setRosterDeptFilter] = useState('all');

  // Headers auth
  const authHeaders = useMemo(() => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (idToken) h['Authorization'] = `Bearer ${idToken}`;
    return h;
  }, [idToken]);

  // Load Work Schedule
  const loadScheduleItems = async () => {
    setScheduleLoading(true);
    try {
      const res = await fetch('/api/work-schedule/items', { headers: authHeaders, credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setScheduleItems(Array.isArray(data?.items) ? data.items : []);
      }
    } catch {
      // ignore
    } finally {
      setScheduleLoading(false);
    }
  };

  // Load Exam Papers
  const loadExamPapers = async () => {
    setExamLoading(true);
    try {
      const res = await fetch('/api/examination/papers', { headers: authHeaders, credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setExamPapers(Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []);
      }
    } catch {
      // ignore
    } finally {
      setExamLoading(false);
    }
  };

  useEffect(() => {
    if (activeModal === 'work-schedule' || activeModal === 'weekly-report') {
      loadScheduleItems();
    } else if (activeModal === 'examination') {
      loadExamPapers();
    }
  }, [activeModal]);

  // Tạo công việc mới (Sticky note)
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setIsSubmitting(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch('/api/work-schedule/items', {
        method: 'POST',
        headers: authHeaders,
        credentials: 'include',
        body: JSON.stringify({
          title: newTitle.trim(),
          date: today,
          priority: newPriority,
          status: 'todo',
        }),
      });
      if (res.ok) {
        setNewTitle('');
        await loadScheduleItems();
      }
    } catch {
      // ignore
    } finally {
      setIsSubmitting(false);
    }
  };

  // Cập nhật trạng thái item (Kanban chuyển cột)
  const handleUpdateStatus = async (item: any, targetStatus: 'todo' | 'doing' | 'completed') => {
    // Optimistic update
    setScheduleItems(prev => prev.map(it => it.id === item.id ? { ...it, status: targetStatus } : it));
    try {
      await fetch(`/api/work-schedule/items/${item.id}`, {
        method: 'PATCH',
        headers: authHeaders,
        credentials: 'include',
        body: JSON.stringify({ status: targetStatus }),
      });
    } catch {
      loadScheduleItems();
    }
  };

  // Phân loại các cột Kanban cho Bảng Kính Nam Châm
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const kanbanColumns = useMemo(() => {
    const filtered = scheduleItems.filter(item => {
      // Lọc phòng ban
      if (selectedDept !== 'all') {
        const dept = detectDepartment(item);
        if (dept !== selectedDept) return false;
      }
      // Lọc việc của tôi
      if (onlyMyTasks) {
        const executor = item.executor?.name || item.executor?.email || item.assignee || '';
        const myName = currentUser.name || currentUser.email || '';
        if (myName && !executor.toLowerCase().includes(myName.toLowerCase())) {
          return false;
        }
      }
      return true;
    });

    const backlog: any[] = [];
    const todo: any[] = [];
    const doing: any[] = [];
    const completed: any[] = [];

    filtered.forEach(it => {
      const st = (it.status || '').toLowerCase();
      if (st === 'completed' || st === 'reviewed' || st === 'done') {
        completed.push(it);
      } else if (st === 'doing') {
        doing.push(it);
      } else {
        // Status todo: nếu date có và nhỏ hơn hôm nay -> backlog (tồn đọng), ngược lại todo
        if (it.date && it.date < todayStr) {
          backlog.push(it);
        } else {
          todo.push(it);
        }
      }
    });

    return { backlog, todo, doing, completed };
  }, [scheduleItems, selectedDept, onlyMyTasks, todayStr, currentUser]);

  // Title modal mapping
  const modalInfo = useMemo(() => {
    switch (activeModal) {
      case 'work-schedule':
      case 'weekly-report':
        return {
          title: 'Bảng Kế Hoạch Nam Châm 3D (Kanban Whiteboard)',
          sub: 'Theo dõi tiến độ, phân loại 5 khối công việc và điều phối tức thì',
          appId: 'reports',
        };
      case 'examination':
        return {
          title: 'Trạm Điều Hành Khảo Thí & Ngân Hàng Đề Thi',
          sub: 'Hệ thống chuẩn hóa đề thi số, tổ chức thi & chấm thi tự động AI',
          appId: 'exam',
        };
      case 'finance-report':
        return {
          title: 'Sổ Kế Toán & Dòng Tiền Điện Tử 3D',
          sub: 'Thu, chi, quỹ thực tế và hồ sơ tài chính FermatTech',
          appId: 'finance',
        };
      case 'social-dashboard':
      case 'communication-tools':
        return {
          title: 'War-Room Xuất Bản Đa Kênh & Truyền Thông',
          sub: 'Quản trị Fanpage, Zalo OA, Website bài viết và Xuất bản số',
          appId: 'social',
        };
      case 'digital-training':
        return {
          title: 'Phân Hệ Công Nghệ & Đào Tạo Số',
          sub: 'Khóa tập huấn, Quản lý BNDC và Phần mềm giáo dục',
          appId: 'training',
        };
      case 'attendance':
        return {
          title: 'Trạm Chấm Công & Công Ca Điện Tử',
          sub: 'Ghi nhận giờ làm việc, vào ca/ra ca và lịch hiện diện đồng nghiệp',
          appId: 'attendance',
        };
      case 'account-management':
        return {
          title: 'Danh Bạ Nhân Sự & Đội Ngũ Trợ Lý AI',
          sub: 'Quản lý thành viên 5 khối, lia camera và phân công việc trực tiếp',
          appId: 'assistant',
        };
      case 'resources':
        return {
          title: 'Kho Tài Nguyên & Biểu Mẫu Chuẩn Hóa FermatTech',
          sub: 'Quy trình, tài liệu giáo trình và tài nguyên số dùng chung',
          appId: 'docs',
        };
      default:
        return {
          title: 'Phân Hệ Workspace Chuyên Nghiệp',
          sub: 'Tương tác nghiệp vụ trực tiếp trong không gian làm việc 3D',
          appId: undefined,
        };
    }
  }, [activeModal]);

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/75 backdrop-blur-xl animate-in fade-in duration-200">
      <div className="w-[96vw] max-w-6xl h-[90vh] rounded-3xl border border-white/20 bg-slate-950/95 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] backdrop-blur-2xl flex flex-col overflow-hidden text-slate-100">
        
        {/* ================= HEADER WORKSTATION ================= */}
        <div className="px-6 py-4 border-b border-slate-800/80 bg-slate-900/60 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#D97757] via-amber-500 to-indigo-600 p-[1px] shadow-lg shadow-amber-500/20">
              <div className="w-full h-full rounded-2xl bg-slate-950 flex items-center justify-center text-amber-400">
                <Sparkles className="w-5 h-5" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">{modalInfo.title}</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase">
                  Diegetic 3D Workstation
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{modalInfo.sub}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenDesktopOS(modalInfo.appId)}
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-[#D97757] to-amber-600 hover:brightness-110 text-white shadow-md transition cursor-pointer"
            >
              <span>Mở rộng trên FermatOS</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 transition cursor-pointer"
              title="Đóng cửa sổ"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ================= BODY WORKSTATION ================= */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-gradient-to-b from-slate-950 via-slate-900/40 to-slate-950">
          
          {/* 1. BẢNG KẾ HOẠCH NAM CHÂM WHITEBOARD (WORK-SCHEDULE) */}
          {(activeModal === 'work-schedule' || activeModal === 'weekly-report') && (
            <div className="h-full flex flex-col space-y-4">
              {/* Thanh công cụ lọc & thêm nhanh việc */}
              <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 flex flex-wrap items-center justify-between gap-3 shadow-inner">
                {/* Lọc 5 phòng ban */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 text-xs">
                  {DEPARTMENT_KEYS.map(dept => (
                    <button
                      key={dept.id}
                      type="button"
                      onClick={() => setSelectedDept(dept.id)}
                      className={`px-3 py-1.5 rounded-xl font-semibold transition shrink-0 cursor-pointer ${
                        selectedDept === dept.id
                          ? 'bg-[#D97757] text-white shadow-md'
                          : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      {dept.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setOnlyMyTasks(!onlyMyTasks)}
                    className={`px-3 py-1.5 rounded-xl font-semibold transition shrink-0 cursor-pointer border ${
                      onlyMyTasks
                        ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50 shadow-sm'
                        : 'bg-slate-800/80 text-slate-400 border-slate-700/60 hover:text-white'
                    }`}
                  >
                    Việc của tôi
                  </button>
                </div>

                {/* Form thêm Sticky note nam châm mới */}
                <form onSubmit={handleCreateTask} className="flex items-center gap-2 w-full lg:w-auto">
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Ghim nhanh việc mới lên bảng kính..."
                    className="px-3.5 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 w-full sm:w-72"
                  />
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as any)}
                    className="px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-300 focus:outline-none"
                  >
                    <option value="low">Thường</option>
                    <option value="medium">Quan trọng</option>
                    <option value="high">Khẩn cấp</option>
                  </select>
                  <button
                    type="submit"
                    disabled={isSubmitting || !newTitle.trim()}
                    className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Ghim việc</span>
                  </button>
                </form>
              </div>

              {/* Bố cục Kanban 4 cột */}
              {scheduleLoading && scheduleItems.length === 0 ? (
                <div className="flex-1 flex items-center justify-center py-20 text-slate-400 gap-2 text-sm">
                  <LoaderCircle className="w-5 h-5 animate-spin text-amber-400" />
                  <span>Đang tải bảng kế hoạch nam châm...</span>
                </div>
              ) : (
              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 min-h-[460px]">
                {/* CỘT 1: TỒN ĐỌNG (BACKLOG) */}
                <div className="flex flex-col rounded-2xl bg-slate-900/50 border border-rose-900/30 p-3 shadow-lg">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-rose-900/40 text-xs font-bold text-rose-400">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                      Tồn đọng / Quá hạn
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-[10px]">
                      {kanbanColumns.backlog.length}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                    {kanbanColumns.backlog.length === 0 ? (
                      <p className="text-center text-xs text-slate-500 py-8 italic">Không có việc tồn đọng</p>
                    ) : (
                      kanbanColumns.backlog.map(item => renderStickyNote(item, 'backlog'))
                    )}
                  </div>
                </div>

                {/* CỘT 2: CẦN LÀM (TODO) */}
                <div className="flex flex-col rounded-2xl bg-slate-900/50 border border-sky-900/30 p-3 shadow-lg">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-sky-900/40 text-xs font-bold text-sky-400">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-sky-500" />
                      Cần làm hôm nay
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-sky-500/20 text-[10px]">
                      {kanbanColumns.todo.length}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                    {kanbanColumns.todo.length === 0 ? (
                      <p className="text-center text-xs text-slate-500 py-8 italic">Đã giải quyết hết kế hoạch</p>
                    ) : (
                      kanbanColumns.todo.map(item => renderStickyNote(item, 'todo'))
                    )}
                  </div>
                </div>

                {/* CỘT 3: ĐANG LÀM (DOING) */}
                <div className="flex flex-col rounded-2xl bg-slate-900/50 border border-amber-900/30 p-3 shadow-lg">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-amber-900/40 text-xs font-bold text-amber-400">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                      Đang thực hiện
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-[10px]">
                      {kanbanColumns.doing.length}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                    {kanbanColumns.doing.length === 0 ? (
                      <p className="text-center text-xs text-slate-500 py-8 italic">Chưa có việc đang chạy</p>
                    ) : (
                      kanbanColumns.doing.map(item => renderStickyNote(item, 'doing'))
                    )}
                  </div>
                </div>

                {/* CỘT 4: HOÀN THÀNH (COMPLETED) */}
                <div className="flex flex-col rounded-2xl bg-slate-900/50 border border-emerald-900/30 p-3 shadow-lg">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-emerald-900/40 text-xs font-bold text-emerald-400">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      Đã hoàn thành
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-[10px]">
                      {kanbanColumns.completed.length}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                    {kanbanColumns.completed.length === 0 ? (
                      <p className="text-center text-xs text-slate-500 py-8 italic">Chưa có kết quả hoàn tất</p>
                    ) : (
                      kanbanColumns.completed.map(item => renderStickyNote(item, 'completed'))
                    )}
                  </div>
                </div>
              </div>
              )}
            </div>
          )}

          {/* 2. CỤM KHẢO THÍ CHUYÊN BIỆT (EXAMINATION) */}
          {activeModal === 'examination' && (
            <div className="space-y-6">
              {/* Thẻ thống kê nổi bật */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="p-4 rounded-2xl bg-purple-950/40 border border-purple-500/30 shadow-lg">
                  <div className="flex items-center justify-between text-purple-300 text-xs">
                    <span>Tổng số đề thi số</span>
                    <BookOpen className="w-4 h-4" />
                  </div>
                  <p className="text-2xl font-bold text-white mt-1">{examPapers.length || 142}</p>
                  <p className="text-[11px] text-purple-400 mt-1">Chuẩn hóa cấu trúc bộ GD&ĐT</p>
                </div>
                <div className="p-4 rounded-2xl bg-indigo-950/40 border border-indigo-500/30 shadow-lg">
                  <div className="flex items-center justify-between text-indigo-300 text-xs">
                    <span>Kỳ thi đã tổ chức</span>
                    <GraduationCap className="w-4 h-4" />
                  </div>
                  <p className="text-2xl font-bold text-white mt-1">28</p>
                  <p className="text-[11px] text-indigo-400 mt-1">Khảo thí trực tuyến & tập trung</p>
                </div>
                <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 shadow-lg">
                  <div className="flex items-center justify-between text-emerald-300 text-xs">
                    <span>Độ chính xác chấm AI</span>
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <p className="text-2xl font-bold text-emerald-300 mt-1">99.95%</p>
                  <p className="text-[11px] text-emerald-400 mt-1">Hệ thống OCR & Phân tích tự luận</p>
                </div>
                <div className="p-4 rounded-2xl bg-sky-950/40 border border-sky-500/30 shadow-lg">
                  <div className="flex items-center justify-between text-sky-300 text-xs">
                    <span>Học sinh đã khảo sát</span>
                    <User className="w-4 h-4" />
                  </div>
                  <p className="text-2xl font-bold text-white mt-1">3,450+</p>
                  <p className="text-[11px] text-sky-400 mt-1">Đánh giá năng lực toàn diện</p>
                </div>
              </div>

              {/* Danh sách đề thi */}
              <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 shadow-xl space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-200">Ngân Hàng Đề Thi Chuẩn Hóa</h3>
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      {examPapers.length} bộ đề
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                      <input
                        type="text"
                        value={examSearch}
                        onChange={(e) => setExamSearch(e.target.value)}
                        placeholder="Tìm theo tên đề, khối, môn..."
                        className="pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none"
                      />
                    </div>
                    {onNavigateModule && (
                      <button
                        type="button"
                        onClick={() => onNavigateModule('examination')}
                        className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition cursor-pointer flex items-center gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Tạo đề mới</span>
                      </button>
                    )}
                  </div>
                </div>

                {examLoading && examPapers.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-slate-400 gap-2 text-sm">
                    <LoaderCircle className="w-5 h-5 animate-spin text-purple-400" />
                    <span>Đang tải ngân hàng đề thi...</span>
                  </div>
                ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {examPapers
                    .filter(p => !examSearch || (p.title || p.name || '').toLowerCase().includes(examSearch.toLowerCase()))
                    .slice(0, 12)
                    .map((paper, idx) => (
                      <div
                        key={paper.id || idx}
                        className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800 hover:border-purple-500/50 transition flex flex-col justify-between group shadow"
                      >
                        <div>
                          <div className="flex items-center justify-between text-[11px] text-purple-400 mb-1.5">
                            <span className="font-semibold uppercase tracking-wider">{paper.subject || 'Đánh giá năng lực'}</span>
                            <span className="px-2 py-0.5 rounded-full bg-purple-500/15 text-[10px] text-purple-300 border border-purple-500/20">
                              {paper.status || 'SẴN SÀNG'}
                            </span>
                          </div>
                          <h4 className="font-bold text-sm text-slate-100 group-hover:text-purple-300 transition line-clamp-1">
                            {paper.title || paper.name || `Đề khảo sát năng lực số #${idx + 1}`}
                          </h4>
                          <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                            {paper.description || 'Đề thi bao gồm câu hỏi trắc nghiệm khách quan và tự luận định hướng tư duy logic.'}
                          </p>
                        </div>
                        <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                          <span>{paper.question_count || 40} câu hỏi · 45 phút</span>
                          <button
                            type="button"
                            onClick={() => {
                              if (onNavigateModule) onNavigateModule('examination');
                            }}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-purple-400 hover:text-purple-300 hover:underline cursor-pointer"
                          >
                            <span>Làm thử</span>
                            <Play className="w-3 h-3 fill-current" />
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
                )}
              </div>
            </div>
          )}

          {/* 3. CỤM TÀI CHÍNH & KẾ TOÁN (FINANCE-REPORT) */}
          {activeModal === 'finance-report' && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <FermatOSFinanceWindow idToken={idToken} onOpenBrowser={(url) => window.open(url, '_blank')} />
            </div>
          )}

          {/* 4. CỤM TRUYỀN THÔNG ĐA KÊNH (SOCIAL-DASHBOARD / COMMUNICATION-TOOLS) */}
          {(activeModal === 'social-dashboard' || activeModal === 'communication-tools') && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <FermatOSSocialWindow idToken={idToken} onOpenBrowser={(url) => window.open(url, '_blank')} />
            </div>
          )}

          {/* 5. CỤM CÔNG NGHỆ & ĐÀO TẠO SỐ (DIGITAL-TRAINING) */}
          {activeModal === 'digital-training' && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <FermatOSTrainingWindow idToken={idToken} onOpenBrowser={(url) => window.open(url, '_blank')} />
            </div>
          )}

          {/* 6. TRẠM CHẤM CÔNG (ATTENDANCE) */}
          {activeModal === 'attendance' && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <FermatOSAttendanceWindow
                idToken={idToken}
                currentUserName={currentUser.name || undefined}
                onOpenBrowser={(url) => window.open(url, '_blank')}
              />
            </div>
          )}

          {/* 7. NHÂN SỰ & BOT AI (ACCOUNT-MANAGEMENT) */}
          {activeModal === 'account-management' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-900/70 border border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      value={rosterSearch}
                      onChange={(e) => setRosterSearch(e.target.value)}
                      placeholder="Tìm nhân sự hoặc Bot AI..."
                      className="pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none"
                    />
                  </div>
                  <select
                    value={rosterDeptFilter}
                    onChange={(e) => setRosterDeptFilter(e.target.value)}
                    className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-300 focus:outline-none"
                  >
                    <option value="all">Tất cả khối</option>
                    <option value="director">Ban Giám đốc</option>
                    <option value="tech">Công nghệ & Đào tạo số</option>
                    <option value="exam">Khảo thí</option>
                    <option value="media">Truyền thông</option>
                    <option value="accounting">Kế toán & Tài chính</option>
                  </select>
                </div>
                <div className="text-xs text-slate-400">
                  Tổng số: <span className="font-bold text-white">{roster.length}</span> thành viên ·{' '}
                  <span className="text-emerald-400 font-semibold">{roster.filter(u => u.online).length} online</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {roster
                  .filter(u => {
                    if (rosterSearch && !(u.name || '').toLowerCase().includes(rosterSearch.toLowerCase())) return false;
                    if (rosterDeptFilter !== 'all') {
                      const dep = (u.department || u.room || '').toLowerCase();
                      if (!dep.includes(rosterDeptFilter)) return false;
                    }
                    return true;
                  })
                  .map(worker => (
                    <div
                      key={worker.id || worker.user_id}
                      className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 ${
                          worker.is_bot
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                            : 'bg-slate-800 text-slate-200 border border-slate-700'
                        }`}>
                          {worker.is_bot ? '🤖' : (worker.name || '?')[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-xs text-slate-100 truncate">{worker.name}</p>
                          <p className="text-[11px] text-slate-400 truncate mt-0.5">
                            {worker.role || 'Thành viên'} · {worker.department || 'Văn phòng'}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className={`w-2 h-2 rounded-full ${worker.online ? (worker.isIdle ? 'bg-amber-400' : 'bg-emerald-400') : 'bg-slate-600'}`} />
                            <span className="text-[10px] text-slate-400">
                              {worker.is_bot ? 'Trợ lý AI' : worker.online ? (worker.isIdle ? 'Giải lao' : 'Đang làm việc') : 'Ngoại tuyến'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (onFocusWorker) onFocusWorker(worker);
                          onClose();
                        }}
                        className="px-2.5 py-1 rounded-xl bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/30 text-xs font-semibold transition cursor-pointer shrink-0 ml-2"
                      >
                        Lia camera
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* 8. KHO TÀI NGUYÊN (RESOURCES) */}
          {activeModal === 'resources' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800">
                <h3 className="font-bold text-sm text-slate-200">Kho Tài Nguyên & Biểu Mẫu Chuẩn Hóa</h3>
                <p className="text-xs text-slate-400 mt-1">Toàn bộ hồ sơ số, quy chuẩn, tài liệu khảo thí và thiết kế thương hiệu phân loại theo 5 khối</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  { title: 'Quy Chuẩn Khảo Thí & Tổ Chức Thi Số', cat: 'Khảo thí', count: 18, icon: '⚖️' },
                  { title: 'Ngân Hàng Câu Hỏi & Ma Trận Đề Mẫu', cat: 'Khảo thí', count: 42, icon: '📝' },
                  { title: 'Tài Liệu Hướng Dẫn Kỹ Thuật & API', cat: 'Công nghệ', count: 25, icon: '💻' },
                  { title: 'Giáo Trình BNDC & Khóa Học Số', cat: 'Đào tạo', count: 14, icon: '🎓' },
                  { title: 'Bộ Nhận Diện Thương Hiệu FermatTech', cat: 'Truyền thông', count: 31, icon: '🎨' },
                  { title: 'Biểu Mẫu Đề Xuất Kinh Phí & Hóa Đơn', cat: 'Tài chính', count: 12, icon: '💵' },
                ].map((item, idx) => (
                  <div key={idx} className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-amber-500/40 transition flex items-start gap-3">
                    <span className="text-2xl">{item.icon}</span>
                    <div className="flex-1 min-w-0">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300">
                        {item.cat}
                      </span>
                      <h4 className="font-bold text-xs text-slate-100 mt-1 truncate">{item.title}</h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">{item.count} tập tin tài liệu</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* ================= FOOTER WORKSTATION ================= */}
        <div className="px-6 py-3.5 border-t border-slate-800/80 bg-slate-900/60 flex items-center justify-between shrink-0 text-xs">
          <div className="text-slate-400 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Kết nối đồng bộ thời gian thực với hệ thống FTWorkspace</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenDesktopOS(modalInfo.appId)}
              className="px-4 py-2 rounded-xl font-bold bg-[#D97757] hover:bg-[#c46849] text-white transition cursor-pointer shadow-sm"
            >
              Mở rộng trên FermatOS
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
            >
              Đóng (Ở lại 3D)
            </button>
          </div>
        </div>

      </div>
    </div>
  );

  // Helper render Sticky Note trên bảng kính nam châm
  function renderStickyNote(item: any, columnType: 'backlog' | 'todo' | 'doing' | 'completed') {
    const deptKey = detectDepartment(item);
    const style = DEPT_STYLE[deptKey] || DEPT_STYLE.admin;
    const assignee = item.executor?.name || item.executor?.email || item.assignee || 'Tôi';
    const isPriorityHigh = item.priority === 'high';

    return (
      <div
        key={item.id}
        className={`relative p-3 rounded-2xl border backdrop-blur-md transition shadow-md group ${style.bg}`}
      >
        {/* Hạt nam châm đính phía trên thẻ */}
        <div className={`absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border border-white/40 ${style.pin}`} />

        {/* Header note: Phòng ban + Độ ưu tiên */}
        <div className="flex items-center justify-between text-[10px] mb-1.5 pt-1">
          <span className={`px-2 py-0.5 rounded-full font-bold border ${style.badge}`}>
            {style.name}
          </span>
          {isPriorityHigh && (
            <span className="px-1.5 py-0.5 rounded-full font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
              Khẩn cấp
            </span>
          )}
        </div>

        {/* Tiêu đề công việc */}
        <h4 className={`text-xs font-bold leading-snug line-clamp-2 ${columnType === 'completed' ? 'line-through text-slate-400' : 'text-slate-100'}`}>
          {item.title || item.content || 'Nhiệm vụ'}
        </h4>

        {/* Thông tin người làm + ngày */}
        <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center justify-between text-[10px] text-slate-300">
          <div className="flex items-center gap-1.5 truncate">
            <User className="w-3 h-3 text-slate-400 shrink-0" />
            <span className="truncate">{assignee}</span>
          </div>
          {item.date && (
            <div className="flex items-center gap-1 shrink-0 text-slate-400">
              <Clock className="w-2.5 h-2.5" />
              <span>{item.date}</span>
            </div>
          )}
        </div>

        {/* Nút thao tác chuyển trạng thái nhanh */}
        <div className="mt-2.5 flex items-center justify-end gap-1 opacity-90 group-hover:opacity-100 transition">
          {columnType !== 'todo' && columnType !== 'completed' && (
            <button
              type="button"
              onClick={() => handleUpdateStatus(item, 'todo')}
              className="px-2 py-1 rounded-lg bg-sky-600/30 hover:bg-sky-600 text-sky-200 text-[10px] font-semibold transition cursor-pointer"
              title="Chuyển sang Cần làm"
            >
              Cần làm
            </button>
          )}
          {columnType !== 'doing' && columnType !== 'completed' && (
            <button
              type="button"
              onClick={() => handleUpdateStatus(item, 'doing')}
              className="px-2 py-1 rounded-lg bg-amber-600/30 hover:bg-amber-600 text-amber-200 text-[10px] font-semibold transition cursor-pointer"
              title="Chuyển sang Đang làm"
            >
              Làm ngay
            </button>
          )}
          {columnType !== 'completed' && (
            <button
              type="button"
              onClick={() => handleUpdateStatus(item, 'completed')}
              className="px-2 py-1 rounded-lg bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 text-[10px] font-semibold transition cursor-pointer flex items-center gap-1"
              title="Đánh dấu Hoàn thành"
            >
              <Check className="w-3 h-3" />
              <span>Xong</span>
            </button>
          )}
          {columnType === 'completed' && (
            <button
              type="button"
              onClick={() => handleUpdateStatus(item, 'todo')}
              className="px-2 py-1 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-[10px] transition cursor-pointer"
              title="Mở lại công việc"
            >
              Mở lại
            </button>
          )}
        </div>
      </div>
    );
  }
}
