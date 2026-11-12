import React, { useEffect, useState, useMemo } from 'react';
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
  LogOut,
  LogIn,
  GraduationCap,
} from 'lucide-react';

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
// 4. CỬA SỔ TRẠM CHẤM CÔNG & CÔNG CA
// ==========================================
export function FermatOSAttendanceWindow({
  idToken,
  currentUserName,
  onOpenBrowser,
}: {
  idToken?: string;
  currentUserName?: string;
  onOpenBrowser: (url: string, title: string) => void;
}) {
  const [summary, setSummary] = useState<AttendanceSummary>({});
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [currentStatus, setCurrentStatus] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [clocking, setClocking] = useState(false);
  const [clockNotice, setClockNotice] = useState<string | null>(null);

  const fetchAttendance = async () => {
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
      const res = await fetch('/api/attendance/records', { headers });
      if (res.ok) {
        const d = await res.json();
        setSummary(d?.summary || {});
        setRecords(Array.isArray(d?.records) ? d.records : []);
        setCurrentStatus(d?.current || null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttendance();
  }, [idToken]);

  const handleClock = async (action: 'in' | 'out') => {
    setClocking(true);
    setClockNotice(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
      const res = await fetch('/api/attendance/clock', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, shiftCode: 'OFFICE' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setClockNotice(`Chấm công ${action === 'in' ? 'VÀO' : 'RA'} thành công!`);
        await fetchAttendance();
      } else {
        setClockNotice(data?.detail || data?.error || `Lỗi khi chấm công (${res.status})`);
      }
    } catch (err: unknown) {
      setClockNotice((err as Error).message || 'Không thể kết nối máy chấm công');
    } finally {
      setClocking(false);
    }
  };

  return (
    <div className="flex-1 w-full h-full flex flex-col bg-slate-950/80 text-slate-100 p-5 overflow-y-auto space-y-5">
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Trạm Chấm Công & Công Ca</h2>
            <p className="text-xs text-slate-400">
              Nhân viên: <strong className="text-white">{currentUserName || 'Thành viên'}</strong> • Ca hành chính chuẩn
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchAttendance}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition cursor-pointer"
            title="Làm mới"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => onOpenBrowser('/?view=attendance&embed=1&os=1', 'Chấm công & Giờ làm')}
            className="px-3 py-1.5 rounded-lg bg-sky-600/30 hover:bg-sky-600/50 text-sky-300 border border-sky-500/40 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Xem bảng công</span>
          </button>
        </div>
      </div>

      {/* Clock Action Banner */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-950/70 to-slate-900/90 border border-sky-500/30 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <span className="text-xs text-sky-400 font-semibold uppercase tracking-wider">Trạng thái chấm công</span>
          <h3 className="text-sm font-semibold text-white mt-1">
            {currentStatus?.clockIn ? (
              <span className="text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> Đang trong ca (Vào lúc {String(currentStatus.clockIn)})
              </span>
            ) : (
              <span className="text-slate-300 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-amber-400" /> Chưa chấm công ca hôm nay
              </span>
            )}
          </h3>
          {clockNotice && (
            <p className="text-xs font-medium text-emerald-300 mt-1.5 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/30 inline-block">
              {clockNotice}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            disabled={clocking}
            onClick={() => handleClock('in')}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-emerald-950/50 transition cursor-pointer disabled:opacity-50"
          >
            <LogIn className="w-4 h-4" />
            <span>Chấm công Vào</span>
          </button>
          <button
            type="button"
            disabled={clocking}
            onClick={() => handleClock('out')}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-rose-950/50 transition cursor-pointer disabled:opacity-50"
          >
            <LogOut className="w-4 h-4" />
            <span>Chấm công Ra</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/10">
          <span className="text-xs text-slate-400">Số ngày đi làm</span>
          <p className="text-xl font-bold text-white mt-1">{summary.workDays ?? 0} <span className="text-xs text-slate-400 font-normal">ngày</span></p>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/10">
          <span className="text-xs text-slate-400">Tổng giờ công</span>
          <p className="text-xl font-bold text-sky-400 mt-1">
            {summary.totalMinutes ? Math.round((summary.totalMinutes / 60) * 10) / 10 : 0} <span className="text-xs text-slate-400 font-normal">giờ</span>
          </p>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/10">
          <span className="text-xs text-slate-400">Ca hoàn thành</span>
          <p className="text-xl font-bold text-emerald-400 mt-1">{summary.completedShifts ?? 0}</p>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/10">
          <span className="text-xs text-slate-400">Số lần muộn</span>
          <p className="text-xl font-bold text-amber-400 mt-1">{summary.lateShifts ?? 0}</p>
        </div>
      </div>

      {/* Lịch sử gần nhất */}
      <div className="rounded-xl bg-slate-900/50 border border-white/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10">
          <span className="text-xs font-semibold text-white">Lịch sử chấm công gần đây</span>
        </div>
        {records.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">Chưa có bản ghi chấm công nào</div>
        ) : (
          <div className="divide-y divide-white/5">
            {records.slice(0, 7).map((r, idx) => (
              <div key={r.id || idx} className="p-3 hover:bg-white/5 transition flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-slate-200">{r.date || 'Hôm nay'}</span>
                  <span className="text-slate-500 ml-2">Ca: {r.shiftName || 'Hành chính'}</span>
                </div>
                <div className="flex items-center gap-4 text-slate-400">
                  <span>Vào: <strong className="text-emerald-400">{r.clockIn || '--:--'}</strong></span>
                  <span>Ra: <strong className="text-rose-400">{r.clockOut || '--:--'}</strong></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
