import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Wallet,
  ArrowDownRight,
  ArrowUpRight,
  DollarSign,
  Share2,
  Sparkles,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  GraduationCap,
  Plus,
  Trash2,
  Edit3,
  Save,
  Loader2,
  Laptop,
  MapPin,
  AlertTriangle,
} from 'lucide-react';
import { todayVN, shiftDateKey } from '../../lib/vnDate';

interface FinanceEntry {
  id: string | number;
  title: string;
  entry_type: 'income' | 'expense' | string;
  amount: number;
  entry_date?: string;
  category?: string;
  status?: string;
  note?: string;
}

interface SocialChannel {
  id: string | number;
  name: string;
  platform: string;
  status?: string;
  config?: Record<string, unknown>;
  masked_config?: Record<string, unknown>;
}

interface NewsPost {
  id: string | number;
  title: string;
  status?: string;
  channel_names?: string[];
  published_at?: string;
  created_at?: string;
}

interface TrainingSession {
  id: string | number;
  title: string;
  session_date?: string;
  location?: string;
  status?: string;
  partner_name?: string;
  trainer_name?: string;
}

interface AttendanceSummary {
  workDays?: number;
  totalMinutes?: number;
  completedShifts?: number;
  lateShifts?: number;
}

interface AttendanceRecord {
  id?: string | number;
  date?: string;
  clockIn?: string;
  clockOut?: string;
  shiftName?: string;
  durationMinutes?: number;
  status?: string;
}

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);
};

// ==========================================
// 1. CỬA SỔ TÀI CHÍNH & KẾ TOÁN
// ==========================================
export function FermatOSFinanceWindow({
  idToken,
  onOpenBrowser,
}: {
  idToken?: string;
  onOpenBrowser: (url: string, title: string) => void;
}) {
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
      const res = await fetch('/api/digital-training/finance-entries', { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data?.items || data?.entries || []);
      setEntries(list);
    } catch (err: unknown) {
      setError((err as Error).message || 'Không thể tải dữ liệu tài chính');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
  }, [idToken]);

  const stats = useMemo(() => {
    let income = 0;
    let expense = 0;
    let pendingCount = 0;
    entries.forEach((e) => {
      const amt = Number(e.amount) || 0;
      if (e.entry_type === 'income') income += amt;
      else if (e.entry_type === 'expense') expense += amt;
      if (e.status === 'pending' || e.status === 'draft') pendingCount++;
    });
    return {
      income,
      expense,
      balance: income - expense,
      pendingCount,
    };
  }, [entries]);

  return (
    <div className="flex-1 w-full h-full flex flex-col bg-slate-950/80 text-slate-100 p-5 overflow-y-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Sổ Kế Toán & Dòng Tiền Điện Tử</h2>
            <p className="text-xs text-slate-400">Theo dõi bút toán thu chi, tồn quỹ và tiến độ ngân sách</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchEntries}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition cursor-pointer"
            title="Làm mới"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => onOpenBrowser('/?view=finance-report&embed=1&os=1', 'Báo cáo Tài chính')}
            className="px-3 py-1.5 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Mở phân hệ Kế toán</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl bg-slate-900/60 border border-emerald-500/20 flex flex-col justify-between">
          <span className="text-xs text-slate-400">Tổng thu ghi nhận</span>
          <span className="text-lg font-bold text-emerald-400 mt-1">{formatCurrency(stats.income)}</span>
          <div className="flex items-center gap-1 text-[11px] text-emerald-400/80 mt-2">
            <ArrowUpRight className="w-3.5 h-3.5" /> Nguồn thu hợp lệ
          </div>
        </div>
        <div className="p-4 rounded-xl bg-slate-900/60 border border-rose-500/20 flex flex-col justify-between">
          <span className="text-xs text-slate-400">Tổng chi thực tế</span>
          <span className="text-lg font-bold text-rose-400 mt-1">{formatCurrency(stats.expense)}</span>
          <div className="flex items-center gap-1 text-[11px] text-rose-400/80 mt-2">
            <ArrowDownRight className="w-3.5 h-3.5" /> Chi phí vận hành
          </div>
        </div>
        <div className="p-4 rounded-xl bg-slate-900/60 border border-sky-500/20 flex flex-col justify-between">
          <span className="text-xs text-slate-400">Tồn quỹ hiện tại</span>
          <span className={`text-lg font-bold mt-1 ${stats.balance >= 0 ? 'text-sky-300' : 'text-amber-400'}`}>
            {formatCurrency(stats.balance)}
          </span>
          <div className="flex items-center gap-1 text-[11px] text-sky-400/80 mt-2">
            <DollarSign className="w-3.5 h-3.5" /> Chênh lệch thu - chi
          </div>
        </div>
        <div className="p-4 rounded-xl bg-slate-900/60 border border-amber-500/20 flex flex-col justify-between">
          <span className="text-xs text-slate-400">Bút toán chờ duyệt</span>
          <span className="text-lg font-bold text-amber-300 mt-1">{stats.pendingCount}</span>
          <span className="text-[11px] text-amber-400/80 mt-2">Cần kế toán đối soát</span>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-slate-900/50 border border-white/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <span className="text-xs font-semibold text-white">Danh sách bút toán tài chính gần đây</span>
          <span className="text-xs text-slate-400">{entries.length} giao dịch</span>
        </div>
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" /> Đang tải bút toán...
          </div>
        ) : error ? (
          <div className="py-8 text-center text-xs text-rose-400">{error}</div>
        ) : entries.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">Chưa có bút toán nào trong hệ thống</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-white/5 text-slate-400 border-b border-white/10">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Nội dung</th>
                  <th className="py-2.5 px-4 font-medium">Phân loại</th>
                  <th className="py-2.5 px-4 font-medium text-right">Số tiền</th>
                  <th className="py-2.5 px-4 font-medium">Ngày ghi</th>
                  <th className="py-2.5 px-4 font-medium">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {entries.slice(0, 15).map((e) => (
                  <tr key={e.id} className="hover:bg-white/5 transition">
                    <td className="py-2.5 px-4 font-medium text-slate-200">{e.title || 'Không tiêu đề'}</td>
                    <td className="py-2.5 px-4 text-slate-400">{e.category || (e.entry_type === 'income' ? 'Thu' : 'Chi')}</td>
                    <td className={`py-2.5 px-4 font-mono font-semibold text-right ${e.entry_type === 'income' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {e.entry_type === 'income' ? '+' : '-'}{formatCurrency(Number(e.amount) || 0)}
                    </td>
                    <td className="py-2.5 px-4 text-slate-400">{e.entry_date || 'N/A'}</td>
                    <td className="py-2.5 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
                        e.status === 'completed' || e.status === 'approved'
                          ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                          : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                      }`}>
                        {e.status === 'completed' || e.status === 'approved' ? 'Đã duyệt' : 'Chờ duyệt'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// 2. CỬA SỔ WAR-ROOM TRUYỀN THÔNG & ĐA KÊNH
// ==========================================
export function FermatOSSocialWindow({
  idToken,
  onOpenBrowser,
}: {
  idToken?: string;
  onOpenBrowser: (url: string, title: string) => void;
}) {
  const [channels, setChannels] = useState<SocialChannel[]>([]);
  const [posts, setPosts] = useState<NewsPost[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
      const [resCh, resPosts] = await Promise.all([
        fetch('/api/publishing/channels/', { headers }).catch(() => null),
        fetch('/api/news-posts/', { headers }).catch(() => null),
      ]);
      if (resCh && resCh.ok) {
        const d = await resCh.json();
        setChannels(Array.isArray(d) ? d : (d?.items || []));
      }
      if (resPosts && resPosts.ok) {
        const d = await resPosts.json();
        setPosts(Array.isArray(d) ? d : (d?.items || d?.posts || []));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [idToken]);

  return (
    <div className="flex-1 w-full h-full flex flex-col bg-slate-950/80 text-slate-100 p-5 overflow-y-auto space-y-5">
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
            <Share2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">War-room Truyền Thông & Đa Kênh</h2>
            <p className="text-xs text-slate-400">Điều phối kênh xuất bản, lịch bài đăng và tương tác xã hội</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchData}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition cursor-pointer"
            title="Làm mới"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => onOpenBrowser('/?view=news-posts&embed=1&os=1', 'Đăng tin đa kênh')}
            className="px-3 py-1.5 rounded-lg bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 border border-rose-500/40 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Soạn tin mới</span>
          </button>
        </div>
      </div>

      {/* Grid kênh kết nối */}
      <div>
        <h3 className="text-xs font-semibold text-slate-300 mb-2.5">Kênh xuất bản tích hợp</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {channels.length === 0 ? (
            <div className="col-span-full py-4 text-center text-xs text-slate-500">Chưa có kênh xuất bản nào được cấu hình</div>
          ) : (
            channels.map((ch) => {
              const cfg = ch.masked_config || ch.config || {};
              const pageId = (cfg as Record<string, unknown>).page_id as string | undefined;
              return (
                <div key={ch.id} className="p-3.5 rounded-xl bg-slate-900/60 border border-white/10 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">{ch.name}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/30 uppercase">
                      {ch.platform}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                    <span>{pageId ? `ID: ${pageId}` : 'Đã xác thực'}</span>
                    <span className="flex items-center gap-1 text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Sẵn sàng
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Bài đăng gần đây */}
      <div className="rounded-xl bg-slate-900/50 border border-white/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <span className="text-xs font-semibold text-white">Tin bài & Kế hoạch xuất bản</span>
          <button
            type="button"
            onClick={() => onOpenBrowser('/?view=social-dashboard&embed=1&os=1', 'Kênh Xã hội')}
            className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 cursor-pointer"
          >
            Xem toàn bộ <ExternalLink className="w-3 h-3" />
          </button>
        </div>
        {posts.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">Chưa có bài đăng nào</div>
        ) : (
          <div className="divide-y divide-white/5">
            {posts.slice(0, 8).map((p) => (
              <div key={p.id} className="p-3.5 hover:bg-white/5 transition flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h4 className="text-xs font-medium text-white truncate">{p.title}</h4>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                    <span>{p.published_at || p.created_at || 'Mới tạo'}</span>
                    {p.channel_names && p.channel_names.length > 0 && (
                      <span className="text-slate-500">• {p.channel_names.join(', ')}</span>
                    )}
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-medium border shrink-0 ${
                  p.status === 'published'
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                    : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                }`}>
                  {p.status === 'published' ? 'Đã đăng' : 'Đang xử lý'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// 3. CỬA SỔ ĐÀO TẠO SỐ & BNDC
// ==========================================
export function FermatOSTrainingWindow({
  idToken,
  onOpenBrowser,
}: {
  idToken?: string;
  onOpenBrowser: (url: string, title: string) => void;
}) {
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = async () => {
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
      const res = await fetch('/api/digital-training/sessions', { headers });
      if (res.ok) {
        const d = await res.json();
        setSessions(Array.isArray(d) ? d : (d?.items || []));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [idToken]);

  return (
    <div className="flex-1 w-full h-full flex flex-col bg-slate-950/80 text-slate-100 p-5 overflow-y-auto space-y-5">
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Công Nghệ & Đào Tạo Số</h2>
            <p className="text-xs text-slate-400">Khóa học e-learning, lịch tập huấn đối tác & đánh giá năng lực</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchSessions}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition cursor-pointer"
            title="Làm mới"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => onOpenBrowser('/?view=digital-training&embed=1&os=1', 'Công nghệ & Đào tạo số')}
            className="px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Mở phân hệ Đào tạo số</span>
          </button>
        </div>
      </div>

      <div className="rounded-xl bg-slate-900/50 border border-white/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <span className="text-xs font-semibold text-white">Lịch trình các phiên đào tạo & tập huấn</span>
          <span className="text-xs text-slate-400">{sessions.length} phiên</span>
        </div>
        {loading ? (
          <div className="py-10 text-center text-xs text-slate-400">Đang tải lịch tập huấn...</div>
        ) : sessions.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">Chưa có phiên đào tạo nào được lên lịch</div>
        ) : (
          <div className="divide-y divide-white/5">
            {sessions.slice(0, 10).map((s) => (
              <div key={s.id} className="p-3.5 hover:bg-white/5 transition flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h4 className="text-xs font-semibold text-white truncate">{s.title}</h4>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3 text-indigo-400" /> {s.session_date || 'N/A'}</span>
                    {s.trainer_name && <span>• Giảng viên: {s.trainer_name}</span>}
                    {s.partner_name && <span>• Đối tác: {s.partner_name}</span>}
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                  {s.status || 'Kế hoạch'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// 4. CỬA SỔ TRẠM CHẤM CÔNG & CÔNG CA (ĐỒNG BỘ 100% LOGIC 2D)
// ==========================================
interface TimesheetShiftRow {
  start: string;
  end: string;
  workMode: 'direct' | 'online';
}

interface TimesheetEntryRow {
  id: number;
  employeeEmail: string;
  employeeName: string;
  workDate: string;
  isDayOff: boolean;
  shiftStart: string;
  shiftEnd: string;
  workMode: 'direct' | 'online';
  durationMinutes: number;
}

interface TimesheetSummaryData {
  totalMinutes: number;
  directMinutes: number;
  onlineMinutes: number;
  workedDays: number;
  dayOffDays: number;
}

function fmtHoursFromMinutes(mins: number): string {
  const h = Math.round((mins / 60) * 10) / 10;
  return `${h}`;
}

export function FermatOSAttendanceWindow({
  idToken,
  currentUserName,
  onOpenBrowser,
}: {
  idToken?: string;
  currentUserName?: string;
  onOpenBrowser: (url: string, title: string) => void;
}) {
  const [tab, setTab] = useState<'declare' | 'monthly'>('declare');
  const [month, setMonth] = useState<string>(() => todayVN().slice(0, 7));
  const [selectedDate, setSelectedDate] = useState<string>(() => todayVN());

  // Monthly data
  const [entries, setEntries] = useState<TimesheetEntryRow[]>([]);
  const [summary, setSummary] = useState<TimesheetSummaryData | null>(null);
  const [missingDates, setMissingDates] = useState<string[]>([]);
  const [loadingMonth, setLoadingMonth] = useState(true);

  // Prefill & Form data
  const [isDayOff, setIsDayOff] = useState(false);
  const [shifts, setShifts] = useState<TimesheetShiftRow[]>([
    { start: '08:00', end: '12:00', workMode: 'direct' },
  ]);
  const [canEdit, setCanEdit] = useState(true);
  const [loadingPrefill, setLoadingPrefill] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const fetchMonthlyTimesheet = useCallback(async () => {
    setLoadingMonth(true);
    try {
      const headers: Record<string, string> = {};
      if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
      const res = await fetch(`/api/attendance/timesheet?month=${encodeURIComponent(month)}&scope=self`, { headers });
      if (res.ok) {
        const d = await res.json();
        setEntries(Array.isArray(d?.entries) ? d.entries : []);
        setSummary(d?.summaryCutoff || d?.summary || null);
        const uEmail = d?.userEmail || '';
        const reqMap = d?.requiredTimesheetDatesByEmployee || {};
        const reqDates: string[] = Array.isArray(reqMap[uEmail]) ? reqMap[uEmail] : [];
        const declaredSet = new Set((Array.isArray(d?.entries) ? d.entries : []).map((e: TimesheetEntryRow) => e.workDate));
        const yesterday = shiftDateKey(todayVN(), -1);
        setMissingDates(reqDates.filter(dt => dt <= yesterday && !declaredSet.has(dt)));
      }
    } finally {
      setLoadingMonth(false);
    }
  }, [idToken, month]);

  const fetchPrefillForDate = useCallback(async (targetDate: string) => {
    setLoadingPrefill(true);
    setNotice(null);
    try {
      const headers: Record<string, string> = {};
      if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
      const res = await fetch(`/api/attendance/timesheet/prefill?date=${encodeURIComponent(targetDate)}`, { headers });
      if (res.ok) {
        const body = await res.json();
        setCanEdit(body.canEdit !== false);
        const existing = Array.isArray(body.existing) ? body.existing : [];
        if (existing.length > 0) {
          if (existing[0].isDayOff) {
            setIsDayOff(true);
            setShifts([]);
          } else {
            setIsDayOff(false);
            setShifts(existing.map((e: any) => ({
              start: e.shiftStart,
              end: e.shiftEnd,
              workMode: (e.workMode || 'direct') as 'direct' | 'online',
            })));
          }
        } else if (body.defaultDayOff) {
          setIsDayOff(true);
          setShifts([]);
        } else if (Array.isArray(body.shifts) && body.shifts.length > 0) {
          setIsDayOff(false);
          setShifts(body.shifts.map((s: any) => ({
            start: s.start,
            end: s.end,
            workMode: (s.workMode || 'direct') as 'direct' | 'online',
          })));
        } else {
          setIsDayOff(false);
          setShifts([{ start: '08:00', end: '12:00', workMode: (body.defaultWorkMode || 'direct') as 'direct' | 'online' }]);
        }
      }
    } catch {
      // Fallback gracefully
    } finally {
      setLoadingPrefill(false);
    }
  }, [idToken]);

  useEffect(() => {
    void fetchMonthlyTimesheet();
  }, [fetchMonthlyTimesheet]);

  useEffect(() => {
    void fetchPrefillForDate(selectedDate);
  }, [selectedDate, fetchPrefillForDate]);

  const handleSaveTimesheet = async () => {
    if (selectedDate > todayVN()) {
      setNotice({ type: 'err', text: 'Không thể khai báo công ca cho ngày trong tương lai.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
      const payload: Record<string, unknown> = { workDate: selectedDate, isDayOff };
      if (!isDayOff) {
        payload.shifts = shifts.map(s => ({ start: s.start, end: s.end, workMode: s.workMode }));
      }
      const res = await fetch('/api/attendance/timesheet/save', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ type: 'err', text: body.error || body.detail || `Lỗi lưu công ca (${res.status})` });
      } else {
        setNotice({ type: 'ok', text: body.message || `Đã lưu công ca ngày ${selectedDate}.` });
        window.dispatchEvent(new CustomEvent('ft-timesheet-saved', { detail: { date: selectedDate } }));
        await fetchMonthlyTimesheet();
      }
    } catch (err: unknown) {
      setNotice({ type: 'err', text: (err as Error).message || 'Không thể kết nối máy chủ.' });
    } finally {
      setSaving(false);
    }
  };

  const groupedByDate = useMemo(() => {
    const map = new Map<string, TimesheetEntryRow[]>();
    for (const e of entries) {
      const list = map.get(e.workDate) || [];
      list.push(e);
      map.set(e.workDate, list);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [entries]);

  return (
    <div className="flex-1 w-full h-full flex flex-col bg-slate-950/85 text-slate-100 p-5 overflow-y-auto space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Công ca & Chấm công (Đồng bộ 2D)</h2>
            <p className="text-xs text-slate-400">
              Nhân viên: <strong className="text-white">{currentUserName || 'Thành viên'}</strong> • Dữ liệu chuẩn Timesheet
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void fetchMonthlyTimesheet();
              void fetchPrefillForDate(selectedDate);
            }}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition cursor-pointer"
            title="Làm mới"
          >
            <RefreshCw className={`w-4 h-4 ${loadingMonth || loadingPrefill ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => onOpenBrowser('/?view=attendance&embed=1&os=1', 'Công ca & Chấm công')}
            className="px-3 py-1.5 rounded-lg bg-sky-600/30 hover:bg-sky-600/50 text-sky-300 border border-sky-500/40 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Mở toàn trang Công ca 2D</span>
          </button>
        </div>
      </div>

      {/* Warning if missing past dates */}
      {missingDates.length > 0 && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3 text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Bạn có <strong>{missingDates.length} ngày</strong> chưa khai báo công ca: {missingDates.slice(0, 3).join(', ')}
              {missingDates.length > 3 ? '...' : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedDate(missingDates[0]);
              setTab('declare');
            }}
            className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-semibold shrink-0 transition cursor-pointer"
          >
            Bổ sung ngay
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-2">
        <button
          type="button"
          onClick={() => setTab('declare')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
            tab === 'declare'
              ? 'bg-sky-600 text-white shadow'
              : 'bg-white/5 text-slate-400 hover:text-white'
          }`}
        >
          Khai báo công ca
        </button>
        <button
          type="button"
          onClick={() => setTab('monthly')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
            tab === 'monthly'
              ? 'bg-sky-600 text-white shadow'
              : 'bg-white/5 text-slate-400 hover:text-white'
          }`}
        >
          Bảng công tháng ({groupedByDate.length} ngày)
        </button>
      </div>

      {tab === 'declare' ? (
        <div className="space-y-4">
          {/* Date selector + Day off toggle */}
          <div className="p-4 rounded-xl bg-slate-900/70 border border-white/10 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <label className="text-xs text-slate-300 font-medium">Ngày công ca:</label>
              <input
                type="date"
                value={selectedDate}
                max={todayVN()}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-slate-950 border border-white/15 text-xs text-white focus:outline-none focus:border-sky-400"
              />
              {selectedDate === todayVN() && (
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                  Hôm nay
                </span>
              )}
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isDayOff}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setIsDayOff(checked);
                  if (!checked && shifts.length === 0) {
                    setShifts([{ start: '08:00', end: '12:00', workMode: 'direct' }]);
                  }
                }}
                className="rounded border-white/20 bg-slate-950 text-sky-500"
              />
              <span>Đánh dấu Nghỉ làm (Day off)</span>
            </label>
          </div>

          {notice && (
            <div
              className={`p-3 rounded-xl text-xs font-medium border ${
                notice.type === 'ok'
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
              }`}
            >
              {notice.text}
            </div>
          )}

          {loadingPrefill ? (
            <div className="py-10 flex items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
              <span>Đang tải cấu hình ca ngày {selectedDate}...</span>
            </div>
          ) : isDayOff ? (
            <div className="p-6 rounded-xl bg-slate-900/50 border border-white/10 text-center space-y-2">
              <p className="text-sm font-semibold text-amber-300">Ngày {selectedDate} được đánh dấu là Nghỉ làm</p>
              <p className="text-xs text-slate-400">Bấm "Lưu công ca" để xác nhận trạng thái nghỉ làm vào bảng công tháng.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-300">Danh sách các ca làm việc ({shifts.length} ca)</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShifts([
                      { start: '08:00', end: '12:00', workMode: 'direct' },
                      { start: '13:30', end: '17:30', workMode: 'direct' },
                    ])}
                    className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-slate-300 border border-white/10 transition cursor-pointer"
                  >
                    Mẫu: Sáng + Chiều (Trực tiếp)
                  </button>
                  <button
                    type="button"
                    onClick={() => setShifts(prev => [...prev, { start: '13:30', end: '17:30', workMode: 'direct' }])}
                    className="px-2.5 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-[11px] text-sky-300 border border-sky-500/30 flex items-center gap-1 transition cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> Thêm ca
                  </button>
                </div>
              </div>

              {shifts.map((shift, idx) => (
                <div key={idx} className="p-3.5 rounded-xl bg-slate-900/60 border border-white/10 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-semibold text-sky-400 w-10">Ca {idx + 1}</span>
                    <input
                      type="time"
                      value={shift.start}
                      onChange={(e) => setShifts(prev => prev.map((s, i) => (i === idx ? { ...s, start: e.target.value } : s)))}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-white/15 text-xs text-white"
                    />
                    <span className="text-slate-500 text-xs">→</span>
                    <input
                      type="time"
                      value={shift.end}
                      onChange={(e) => setShifts(prev => prev.map((s, i) => (i === idx ? { ...s, end: e.target.value } : s)))}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-white/15 text-xs text-white"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShifts(prev => prev.map((s, i) => (i === idx ? { ...s, workMode: 'direct' } : s)))}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1 border transition cursor-pointer ${
                        shift.workMode === 'direct'
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                      }`}
                    >
                      <MapPin className="w-3 h-3" /> Trực tiếp
                    </button>
                    <button
                      type="button"
                      onClick={() => setShifts(prev => prev.map((s, i) => (i === idx ? { ...s, workMode: 'online' } : s)))}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1 border transition cursor-pointer ${
                        shift.workMode === 'online'
                          ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                      }`}
                    >
                      <Laptop className="w-3 h-3" /> Online
                    </button>
                    {shifts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setShifts(prev => prev.filter((_, i) => i !== idx))}
                        className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 transition cursor-pointer"
                        title="Xóa ca"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="button"
              disabled={saving || loadingPrefill || !canEdit}
              onClick={handleSaveTimesheet}
              className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-sky-950/50 transition cursor-pointer disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>{canEdit ? 'Lưu công ca' : 'Đã khóa chỉnh sửa'}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Month selector & KPI */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Tháng:</span>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-slate-900 border border-white/15 text-xs text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/10">
              <span className="text-xs text-slate-400">Tổng giờ công</span>
              <p className="text-xl font-bold text-sky-400 mt-1">
                {fmtHoursFromMinutes(summary?.totalMinutes || 0)} <span className="text-xs font-normal text-slate-400">giờ</span>
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/10">
              <span className="text-xs text-slate-400">Giờ Trực tiếp</span>
              <p className="text-xl font-bold text-emerald-400 mt-1">
                {fmtHoursFromMinutes(summary?.directMinutes || 0)} <span className="text-xs font-normal text-slate-400">giờ</span>
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/10">
              <span className="text-xs text-slate-400">Giờ Online</span>
              <p className="text-xl font-bold text-indigo-400 mt-1">
                {fmtHoursFromMinutes(summary?.onlineMinutes || 0)} <span className="text-xs font-normal text-slate-400">giờ</span>
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/10">
              <span className="text-xs text-slate-400">Ngày đã khai báo</span>
              <p className="text-xl font-bold text-white mt-1">
                {summary?.workedDays ?? groupedByDate.length} <span className="text-xs font-normal text-slate-400">ngày</span>
              </p>
            </div>
          </div>

          {/* Monthly grouped entries */}
          <div className="rounded-xl bg-slate-900/50 border border-white/10 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Chi tiết bảng công tháng {month}</span>
              <span className="text-[11px] text-slate-400">{entries.length} bản ghi ca</span>
            </div>
            {loadingMonth ? (
              <div className="py-8 text-center text-xs text-slate-400">Đang tải bảng công...</div>
            ) : groupedByDate.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">Chưa có dữ liệu công ca trong tháng này</div>
            ) : (
              <div className="divide-y divide-white/5">
                {groupedByDate.map(([dateStr, dayEntries]) => (
                  <div key={dateStr} className="p-3 hover:bg-white/5 transition flex items-center justify-between gap-3 text-xs">
                    <div className="space-y-1">
                      <div className="font-semibold text-slate-200">{dateStr}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {dayEntries[0]?.isDayOff ? (
                          <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[11px]">
                            Nghỉ làm
                          </span>
                        ) : (
                          dayEntries.map((item) => (
                            <span
                              key={item.id}
                              className={`px-2 py-0.5 rounded border text-[11px] ${
                                item.workMode === 'direct'
                                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                  : 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300'
                              }`}
                            >
                              {item.shiftStart}–{item.shiftEnd} ({item.workMode === 'direct' ? 'Trực tiếp' : 'Online'})
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDate(dateStr);
                        setTab('declare');
                      }}
                      className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/15 text-slate-300 text-[11px] flex items-center gap-1 shrink-0 transition cursor-pointer"
                    >
                      <Edit3 className="w-3 h-3" /> Sửa
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
