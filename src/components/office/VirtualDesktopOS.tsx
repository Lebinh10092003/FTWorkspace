import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  Terminal,
  FileText,
  GraduationCap,
  Folder,
  X,
  Minus,
  Maximize2,
  Sparkles,
  Play,
  Send,
  Coffee,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Cpu,
  Monitor,
  Gamepad2,
  RotateCcw,
  Volume2,
  Loader2,
  Users,
  Plus,
  Check,
  Calendar,
  Settings,
  LayoutGrid,
  Palette,
  Sun,
  Wifi,
  HardDrive,
  Search,
  ExternalLink,
  Globe,
  Laptop,
  ShieldCheck,
  Share2,
  Layers,
  Wallet,
  Wrench
} from 'lucide-react';
import { FermatOSLaunchpad } from './FermatOSLaunchpad';
import { FermatOSSafari } from './FermatOSSafari';
import {
  FermatOSFinanceWindow,
  FermatOSSocialWindow,
  FermatOSTrainingWindow,
  FermatOSAttendanceWindow,
} from './FermatOSDepartmentApps';

export type VirtualDesktopOSProps = {
  isOpen: boolean;
  onClose: () => void;
  onNavigateModule?: (moduleName: string) => void;
  onCallBot?: () => void;
  onReleaseBot?: () => void;
  onTriggerPatrol?: () => void;
  initialApp?: WindowId;
  initialModule?: { key: string; title: string } | null;
  initialPrompt?: string;
  initialColleague?: { name: string; role?: string; department?: string; email?: string } | null;
  botState?: {
    state: string; // 'IDLE' | 'MOVING' | 'ARRIVED'
    botName?: string;
    targetDesk?: number;
    queueLength: number;
  };
  patrolState?: {
    active: boolean;
    phase: string;
    message?: string;
  };
  currentUser?: any;
  idToken?: string | null;
};

export type WindowId =
  | 'assistant'
  | 'exam'
  | 'reports'
  | 'docs'
  | 'terminal'
  | 'game'
  | 'settings'
  | 'apps'
  | 'browser'
  | 'finance'
  | 'social'
  | 'training'
  | 'attendance';

interface OSWindow {
  id: WindowId;
  title: string;
  icon: any;
  isOpen: boolean;
  isMinimized: boolean;
  zIndex: number;
}

class VirtualDesktopErrorBoundary extends React.Component<
  { children: React.ReactNode; onClose?: () => void },
  { hasError: boolean; errorMsg: string }
> {
  constructor(props: { children: React.ReactNode; onClose?: () => void }) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMsg: error?.message || 'Lỗi giao diện hệ điều hành ảo' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[VirtualDesktopOS ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      if (typeof document === 'undefined') return null;
      return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-slate-900 p-6 text-center shadow-2xl">
            <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto mb-3" />
            <h3 className="text-base font-bold text-white">Máy tính ảo gặp sự cố hiển thị</h3>
            <p className="mt-1.5 text-xs text-slate-400">{this.state.errorMsg}</p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, errorMsg: '' })}
                className="px-4 py-2 rounded-xl bg-[#D97757] hover:bg-[#c46849] text-white text-xs font-bold transition cursor-pointer"
              >
                Khởi động lại OS
              </button>
              {this.props.onClose && (
                <button
                  type="button"
                  onClick={() => {
                    this.setState({ hasError: false, errorMsg: '' });
                    this.props.onClose?.();
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition cursor-pointer"
                >
                  Đóng
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      );
    }
    return this.props.children;
  }
}

const WALLPAPERS = [
  {
    id: 'sequoia-sunrise',
    name: 'FermatOS Rạng đông',
    subtitle: 'Sắc cam hổ phách & tím thạch anh chính thức FermatOS',
    gradientClass: 'from-[#1e0a38] via-[#3b1259] to-[#0c051f]',
    previewBg: 'bg-gradient-to-tr from-amber-500 via-purple-700 to-indigo-950',
  },
  {
    id: 'sequoia-dark',
    name: 'FermatOS Đêm sâu',
    subtitle: 'Xanh chàm tĩnh lặng, tương phản sắc nét',
    gradientClass: 'from-[#0B1120] via-[#121A32] to-[#060B19]',
    previewBg: 'bg-gradient-to-tr from-sky-900 via-indigo-950 to-slate-950',
  },
  {
    id: 'sonoma-sunset',
    name: 'FermatOS Hoàng hôn',
    subtitle: 'Nắng chiều hoàng hôn Fermat rực rỡ',
    gradientClass: 'from-[#2e0c1f] via-[#4a1525] to-[#12050b]',
    previewBg: 'bg-gradient-to-tr from-yellow-500 via-rose-600 to-purple-900',
  },
  {
    id: 'cyber-matrix',
    name: 'Fermat Cyberpunk Neon',
    subtitle: 'Ngọc lục bảo & cyan phát quang công nghệ',
    gradientClass: 'from-[#031d28] via-[#062c3f] to-[#020e14]',
    previewBg: 'bg-gradient-to-tr from-emerald-500 via-cyan-700 to-slate-950',
  },
  {
    id: 'dark-obsidian',
    name: 'Fermat Luxury Obsidian',
    subtitle: 'Đen kim cương tối giản thanh lịch',
    gradientClass: 'from-[#0c0d10] via-[#16181f] to-[#07070a]',
    previewBg: 'bg-gradient-to-tr from-zinc-800 via-slate-900 to-black',
  },
  {
    id: 'high-sierra',
    name: 'Fermat High Sierra',
    subtitle: 'Núi tuyết xanh lam trong trẻo',
    gradientClass: 'from-[#0c2340] via-[#1d3d63] to-[#081321]',
    previewBg: 'bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-950',
  },
];

const ALL_WORKSPACE_MODULES = [
  {
    id: 'examination',
    name: 'Khảo thí & Đề thi số',
    category: 'Đào tạo & Khảo thí',
    desc: 'Ngân hàng câu hỏi, tạo đề thi tự động, xuất PDF/Word và quản lý kỳ thi chuẩn hóa.',
    icon: GraduationCap,
    color: 'from-sky-500 to-blue-600',
    badge: 'Trọng yếu',
    moduleKey: 'examination',
  },
  {
    id: 'digital-training',
    name: 'Công nghệ & Đào tạo số',
    category: 'Đào tạo & Khảo thí',
    desc: 'Lộ trình phát triển năng lực, khóa học số, bài giảng e-learning và tài liệu đào tạo nội bộ.',
    icon: Layers,
    color: 'from-indigo-500 to-purple-600',
    badge: 'AI Powered',
    moduleKey: 'digital-training',
  },
  {
    id: 'attendance',
    name: 'Công ca & Chấm công',
    category: 'Hành chính & Nhân sự',
    desc: 'Theo dõi ca làm việc, bảng chấm công cá nhân/phòng ban, tính công tự động theo thời gian thực.',
    icon: Clock,
    color: 'from-emerald-500 to-teal-600',
    moduleKey: 'attendance',
  },
  {
    id: 'weekly-report',
    name: 'Báo cáo tuần & Tiến độ',
    category: 'Hành chính & Quản trị',
    desc: 'Tổng hợp OKRs, báo cáo tiến độ các ban, đánh giá hiệu suất và kế hoạch công tác tuần.',
    icon: FileText,
    color: 'from-amber-500 to-orange-600',
    moduleKey: 'weekly-report',
  },
  {
    id: 'work-schedule',
    name: 'Lịch công tác & Giao việc',
    category: 'Hành chính & Quản trị',
    desc: 'Lịch tuần ban lãnh đạo, giao việc chéo phòng ban, đồng bộ nhắc việc và kiểm soát tiến độ.',
    icon: Calendar,
    color: 'from-orange-500 to-rose-500',
    moduleKey: 'work-schedule',
  },
  {
    id: 'news-posts',
    name: 'Đăng tin & Truyền thông',
    category: 'Truyền thông & Đa kênh',
    desc: 'Biên soạn bài viết, quản lý lịch đăng tin, đồng bộ nội dung đa kênh tự động và kiểm duyệt bài.',
    icon: Sparkles,
    color: 'from-rose-500 to-pink-600',
    badge: 'Đa kênh',
    moduleKey: 'news-posts',
  },
  {
    id: 'social-dashboard',
    name: 'Quản trị Kênh Xã hội',
    category: 'Truyền thông & Đa kênh',
    desc: 'Kết nối Facebook Fanpage, Zalo OA, đồng bộ dữ liệu tương tác và tự động phản hồi tin nhắn.',
    icon: Share2,
    color: 'from-blue-600 to-indigo-700',
    moduleKey: 'social-dashboard',
  },
  {
    id: 'gmail-assistant',
    name: 'Hộp thư AI (Gmail)',
    category: 'Giao tiếp & Thư từ',
    desc: 'Hộp thư thông minh tích hợp AI soạn thảo, phân loại email quan trọng và trả lời tự động.',
    icon: Bot,
    color: 'from-red-500 to-rose-600',
    moduleKey: 'gmail-assistant',
  },
  {
    id: 'email-builder',
    name: 'Trình tạo Email Template',
    category: 'Giao tiếp & Marketing',
    desc: 'Thiết kế mẫu thư điện tử kéo thả chuẩn thương hiệu FermatTech với bố cục responsive.',
    icon: FileText,
    color: 'from-violet-500 to-purple-700',
    moduleKey: 'email-builder',
  },
  {
    id: 'signature-builder',
    name: 'Trình tạo Chữ ký số',
    category: 'Giao tiếp & Thương hiệu',
    desc: 'Tạo chữ ký email chuẩn nhận diện thương hiệu công ty, sao chép HTML hoặc hình ảnh chỉ bằng 1 chạm.',
    icon: CheckCircle2,
    color: 'from-cyan-500 to-blue-600',
    moduleKey: 'signature-builder',
  },
  {
    id: 'finance-report',
    name: 'Báo cáo Tài chính & Ngân sách',
    category: 'Tài chính & Kế toán',
    desc: 'Theo dõi dòng tiền, dự toán kinh phí dự án, giải ngân đề xuất và báo cáo tài chính nội bộ.',
    icon: Wallet,
    color: 'from-emerald-600 to-green-700',
    moduleKey: 'finance-report',
  },
  {
    id: 'account-management',
    name: 'Quản lý Nhân sự & Tài khoản',
    category: 'Hành chính & Nhân sự',
    desc: 'Hồ sơ nhân viên, phân quyền truy cập, danh bạ nội bộ và quản lý trạng thái tài khoản.',
    icon: Users,
    color: 'from-blue-500 to-cyan-600',
    moduleKey: 'account-management',
  },
  {
    id: 'document-number',
    name: 'Công văn & Quy chuẩn',
    category: 'Hành chính & Quản trị',
    desc: 'Sổ cấp số công văn đi/đến, quản lý mẫu văn bản hành chính và văn bản nội bộ ban hành.',
    icon: FileText,
    color: 'from-slate-500 to-slate-700',
    moduleKey: 'document-number',
  },
  {
    id: 'communication-tools',
    name: 'Bộ công cụ số FermatTech',
    category: 'Tiện ích & Công cụ',
    desc: 'Tạo mã QR thương hiệu, rút gọn liên kết (ShortLink), tra cứu dữ liệu và các tiện ích nội bộ.',
    icon: Wrench,
    color: 'from-violet-500 to-fuchsia-600',
    moduleKey: 'communication-tools',
  },
];

export default function VirtualDesktopOS(props: VirtualDesktopOSProps) {
  return (
    <VirtualDesktopErrorBoundary onClose={props.onClose}>
      <VirtualDesktopOSInner {...props} />
    </VirtualDesktopErrorBoundary>
  );
}

function VirtualDesktopOSInner({
  isOpen,
  onClose,
  onNavigateModule = () => {},
  onCallBot = () => {},
  onReleaseBot = () => {},
  onTriggerPatrol = () => {},
  initialApp,
  initialModule,
  initialPrompt,
  initialColleague,
  botState = { state: 'IDLE', queueLength: 0 },
  patrolState = { active: false, phase: 'IDLE' },
  currentUser,
  idToken = null,
}: VirtualDesktopOSProps) {
  const [activeWindow, setActiveWindow] = useState<WindowId | null>(initialApp || 'assistant');
  const [topZ, setTopZ] = useState(20);
  const topZRef = useRef(20);
  const [timeStr, setTimeStr] = useState('');
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    '[SYSTEM] FermatOS v2.6 Workstation Booted successfully.',
    '[SYSTEM] Connected to 3D Virtual Office engine (Three.js Isometric).',
    '[NETWORK] Presence linked with FermatTech HQ Cloud.',
  ]);
  type ChatAction = {
    label: string;
    action: () => void;
    icon?: any;
  };

  const [chatMessages, setChatMessages] = useState<{
    sender: string;
    text: string;
    time: string;
    actions?: ChatAction[];
  }[]>([
    {
      sender: 'bot',
      text: 'Xin chào! Tôi là Trợ lý AI FermatTech. Tôi có thể hỗ trợ bạn sinh đề thi, mở phân hệ làm việc, gọi robot đến bàn hoặc hỗ trợ công việc văn phòng.',
      time: '09:00',
      actions: [
        { label: 'Mở Khảo thí', action: () => { onClose(); onNavigateModule('examination'); } },
        { label: 'Báo cáo tuần', action: () => { onClose(); onNavigateModule('weekly-report'); } },
        { label: 'Gọi Robot', action: () => onCallBot() },
      ],
    },
  ]);
  const [inputChat, setInputChat] = useState('');
  const [isBotTyping, setIsBotTyping] = useState(false);
  const activePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Dọn dẹp interval polling khi component unmount hoặc đóng OS
  useEffect(() => {
    return () => {
      if (activePollRef.current) {
        clearInterval(activePollRef.current);
        activePollRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen && activePollRef.current) {
      clearInterval(activePollRef.current);
      activePollRef.current = null;
      setIsBotTyping(false);
    }
  }, [isOpen]);

  // Dữ liệu thật kết nối Backend (Mục 1)
  const [examData, setExamData] = useState<{
    loading: boolean;
    totalPapers: number;
    activeCount: number;
    accuracy: string;
    papers: any[];
  }>({
    loading: false,
    totalPapers: 24,
    activeCount: 1480,
    accuracy: '99.94%',
    papers: [],
  });

  const [workData, setWorkData] = useState<{
    loading: boolean;
    items: any[];
    completionRate: number;
    totalTasks: number;
    doneTasks: number;
  }>({
    loading: false,
    items: [],
    completionRate: 82,
    totalTasks: 0,
    doneTasks: 0,
  });

  // State quản lý việc tạo & giao task trực tiếp trên 3D (không redirect 2D)
  const [showTaskForm, setShowTaskForm] = useState<boolean>(false);
  const [taskTitle, setTaskTitle] = useState<string>('');
  const [taskExecutor, setTaskExecutor] = useState<string>('');
  const [taskDate, setTaskDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [taskSubmitting, setTaskSubmitting] = useState<boolean>(false);
  const [taskNotice, setTaskNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Helper kiểm tra task đã hoàn thành (hỗ trợ cả backend lowercase lẫn legacy uppercase)
  const isTaskCompleted = (status?: string) => {
    const s = (status || '').toLowerCase();
    return s === 'completed' || s === 'reviewed' || s === 'done';
  };

  // Hàm tải lại danh sách công việc
  const refreshWorkSchedule = useCallback(async () => {
    const authHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (idToken) {
      authHeaders['Authorization'] = `Bearer ${idToken}`;
    }

    try {
      const res = await fetch('/api/work-schedule/items', {
        headers: authHeaders,
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        const items = Array.isArray(data.items) ? data.items : [];
        const done = items.filter((it: any) => isTaskCompleted(it.status)).length;
        const rate = items.length > 0 ? Math.round((done / items.length) * 100) : 82;
        setWorkData({
          loading: false,
          items: items.slice(0, 12),
          completionRate: rate,
          totalTasks: items.length,
          doneTasks: done,
        });
      }
    } catch {
      // bỏ qua lỗi ngầm
    }
  }, [idToken]);

  // Cập nhật người nhận việc khi mở từ đồng nghiệp 3D
  useEffect(() => {
    if (initialColleague) {
      setTaskExecutor(initialColleague.email || initialColleague.name || '');
      setShowTaskForm(true);
    }
  }, [initialColleague]);

  // Tải dữ liệu thật từ Backend khi mở Desktop OS (Mục 1)
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const authHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (idToken) {
      authHeaders['Authorization'] = `Bearer ${idToken}`;
    }

    // 1. Fetch đề thi từ /api/examination/papers
    setExamData(prev => ({ ...prev, loading: true }));
    fetch('/api/examination/papers', {
      headers: authHeaders,
      credentials: 'include',
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data) return;
        const items = Array.isArray(data.items) ? data.items : [];
        if (items.length > 0) {
          setExamData({
            loading: false,
            totalPapers: items.length,
            activeCount: items.filter((p: any) => p.status === 'PUBLISHED' || p.status === 'READY').length || items.length,
            accuracy: '99.95%',
            papers: items.slice(0, 5),
          });
        } else {
          setExamData(prev => ({ ...prev, loading: false }));
        }
      })
      .catch(() => {
        if (!cancelled) setExamData(prev => ({ ...prev, loading: false }));
      });

    // 2. Fetch danh sách công việc tuần từ /api/work-schedule/items
    setWorkData(prev => ({ ...prev, loading: true }));
    fetch('/api/work-schedule/items', {
      headers: authHeaders,
      credentials: 'include',
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data) return;
        const items = Array.isArray(data.items) ? data.items : [];
        if (items.length > 0) {
          const done = items.filter((it: any) => isTaskCompleted(it.status)).length;
          const rate = items.length > 0 ? Math.round((done / items.length) * 100) : 82;
          setWorkData({
            loading: false,
            items: items.slice(0, 12),
            completionRate: rate,
            totalTasks: items.length,
            doneTasks: done,
          });
        } else {
          setWorkData(prev => ({ ...prev, loading: false }));
        }
      })
      .catch(() => {
        if (!cancelled) setWorkData(prev => ({ ...prev, loading: false }));
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, idToken]);

  // Handler tạo task / giao việc trực tiếp
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) {
      setTaskNotice({ type: 'error', text: 'Vui lòng nhập tên công việc cần giao.' });
      return;
    }
    setTaskSubmitting(true);
    setTaskNotice(null);

    const authHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (idToken) {
      authHeaders['Authorization'] = `Bearer ${idToken}`;
    }

    try {
      const res = await fetch('/api/work-schedule/items', {
        method: 'POST',
        headers: authHeaders,
        credentials: 'include',
        body: JSON.stringify({
          title: taskTitle.trim(),
          date: taskDate || new Date().toISOString().slice(0, 10),
          executorEmail: taskExecutor.includes('@') ? taskExecutor.trim() : undefined,
          priority: taskPriority,
          status: 'todo',
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || 'Lỗi khi lưu công việc');
      }

      setTaskNotice({ type: 'success', text: 'Đã giao việc thành công vào Lịch công tác!' });
      setTaskTitle('');
      await refreshWorkSchedule();
      setTimeout(() => setTaskNotice(null), 4000);
    } catch (err: any) {
      setTaskNotice({ type: 'error', text: err.message || 'Không thể tạo công việc' });
    } finally {
      setTaskSubmitting(false);
    }
  };

  // Handler đổi trạng thái hoàn thành task tại chỗ
  const handleToggleTaskStatus = async (item: any) => {
    const isDone = isTaskCompleted(item.status);
    const nextStatus = isDone ? 'todo' : 'completed';

    const authHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (idToken) {
      authHeaders['Authorization'] = `Bearer ${idToken}`;
    }

    // Cập nhật lạc quan
    setWorkData(prev => ({
      ...prev,
      items: prev.items.map(it => (it.id === item.id ? { ...it, status: nextStatus } : it)),
      doneTasks: isDone ? Math.max(0, prev.doneTasks - 1) : prev.doneTasks + 1,
    }));

    try {
      await fetch(`/api/work-schedule/items/${item.id}`, {
        method: 'PATCH',
        headers: authHeaders,
        credentials: 'include',
        body: JSON.stringify({ status: nextStatus }),
      });
      await refreshWorkSchedule();
    } catch {
      // rollback
      await refreshWorkSchedule();
    }
  };

  // Trạng thái mini game (Memory Tiles Game)
  const [gameTiles, setGameTiles] = useState<number[]>([]);
  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [gameMoves, setGameMoves] = useState(0);

  const [selectedWallpaper, setSelectedWallpaper] = useState<string>(() => {
    try {
      return localStorage.getItem('ft_virtual_desktop_wallpaper') || 'sequoia-sunrise';
    } catch {
      return 'sequoia-sunrise';
    }
  });

  const [screenBrightness, setScreenBrightness] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('ft_virtual_desktop_brightness');
      return saved ? Number(saved) : 100;
    } catch {
      return 100;
    }
  });

  const [settingsTab, setSettingsTab] = useState<'wallpaper' | 'display' | 'about' | 'network'>('wallpaper');
  const [appleMenuOpen, setAppleMenuOpen] = useState(false);
  const [searchModuleQuery, setSearchModuleQuery] = useState('');
  const [browserUrl, setBrowserUrl] = useState<string>('/?view=examination');
  const [browserTitle, setBrowserTitle] = useState<string>('Khảo thí & Đề thi số');
  const [browserHistory, setBrowserHistory] = useState<{ url: string; title: string }[]>([
    { url: '/?view=examination', title: 'Khảo thí & Đề thi số' },
  ]);
  const [browserHistIdx, setBrowserHistIdx] = useState(0);
  const [safariReloadKey, setSafariReloadKey] = useState(0);

  const [windows, setWindows] = useState<Record<WindowId, OSWindow>>({
    assistant: { id: 'assistant', title: 'Trợ lý AI Workstation', icon: Bot, isOpen: true, isMinimized: false, zIndex: 1 },
    exam: { id: 'exam', title: 'Khảo thí & Ngân hàng đề thi', icon: GraduationCap, isOpen: false, isMinimized: false, zIndex: 2 },
    reports: { id: 'reports', title: 'Báo cáo tuần & Tiến độ', icon: FileText, isOpen: false, isMinimized: false, zIndex: 3 },
    docs: { id: 'docs', title: 'Kho tài liệu & Quy chuẩn', icon: Folder, isOpen: false, isMinimized: false, zIndex: 4 },
    terminal: { id: 'terminal', title: 'Nhật ký Console Văn phòng', icon: Terminal, isOpen: false, isMinimized: false, zIndex: 5 },
    game: { id: 'game', title: 'Fermat Arcade: Xả Stress', icon: Gamepad2, isOpen: false, isMinimized: false, zIndex: 6 },
    settings: { id: 'settings', title: 'Cài đặt hệ thống FermatOS', icon: Settings, isOpen: false, isMinimized: false, zIndex: 7 },
    apps: { id: 'apps', title: 'Launchpad · Tất cả ứng dụng', icon: LayoutGrid, isOpen: false, isMinimized: false, zIndex: 8 },
    browser: { id: 'browser', title: 'Fermat Safari · Trình duyệt phân hệ', icon: Globe, isOpen: false, isMinimized: false, zIndex: 9 },
    finance: { id: 'finance', title: 'Sổ Kế Toán & Dòng Tiền', icon: Wallet, isOpen: false, isMinimized: false, zIndex: 10 },
    social: { id: 'social', title: 'War-room Truyền Thông', icon: Share2, isOpen: false, isMinimized: false, zIndex: 11 },
    training: { id: 'training', title: 'Công Nghệ & Đào Tạo Số', icon: Cpu, isOpen: false, isMinimized: false, zIndex: 12 },
    attendance: { id: 'attendance', title: 'Trạm Chấm Công & Công Ca', icon: Clock, isOpen: false, isMinimized: false, zIndex: 13 },
  });

  const handleSelectWallpaper = (wpId: string) => {
    setSelectedWallpaper(wpId);
    try {
      localStorage.setItem('ft_virtual_desktop_wallpaper', wpId);
    } catch {}
  };

  const handleBrightnessChange = (val: number) => {
    setScreenBrightness(val);
    try {
      localStorage.setItem('ft_virtual_desktop_brightness', String(val));
    } catch {}
  };

  const openModuleInBrowser = (moduleKeyOrUrl: string, moduleName: string) => {
    const nextUrl =
      moduleKeyOrUrl.startsWith('/') || moduleKeyOrUrl.startsWith('http')
        ? moduleKeyOrUrl
        : `/?view=${moduleKeyOrUrl}&embed=1&os=1`;
    setBrowserUrl(nextUrl);
    setBrowserTitle(moduleName);
    setBrowserHistory((prev) => {
      const sliced = prev.slice(0, browserHistIdx + 1);
      return [...sliced, { url: nextUrl, title: moduleName }];
    });
    setBrowserHistIdx((prev) => prev + 1);
    focusWindow('browser');
  };

  const handleOpenModule = (moduleKey: string, moduleName: string, nativeWindow?: string) => {
    if (nativeWindow && nativeWindow in windows) {
      focusWindow(nativeWindow as WindowId);
    } else {
      openModuleInBrowser(moduleKey, moduleName);
    }
  };

  const handleSafariBack = () => {
    if (browserHistIdx > 0) {
      const nextIdx = browserHistIdx - 1;
      const entry = browserHistory[nextIdx];
      if (entry) {
        setBrowserHistIdx(nextIdx);
        setBrowserUrl(entry.url);
        setBrowserTitle(entry.title);
      }
    }
  };

  const handleSafariForward = () => {
    if (browserHistIdx < browserHistory.length - 1) {
      const nextIdx = browserHistIdx + 1;
      const entry = browserHistory[nextIdx];
      if (entry) {
        setBrowserHistIdx(nextIdx);
        setBrowserUrl(entry.url);
        setBrowserTitle(entry.title);
      }
    }
  };

  const currentWallpaperObj = WALLPAPERS.find(w => w.id === selectedWallpaper) || WALLPAPERS[0];

  // Đồng hồ hệ thống
  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      setTimeStr(d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Ghi log tuần tra và trạng thái robot
  useEffect(() => {
    if (patrolState.message) {
      setTerminalLogs(prev => [
        ...prev.slice(-30),
        `[GIÁM ĐỐC] ${new Date().toLocaleTimeString()} - ${patrolState.message}`,
      ]);
    }
  }, [patrolState.message]);

  useEffect(() => {
    if (botState.state === 'MOVING') {
      setTerminalLogs(prev => [
        ...prev.slice(-30),
        `[ROBOT AI] ${new Date().toLocaleTimeString()} - Đang di chuyển tới bàn #${botState.targetDesk}...`,
      ]);
    } else if (botState.state === 'ARRIVED') {
      setTerminalLogs(prev => [
        ...prev.slice(-30),
        `[ROBOT AI] ${new Date().toLocaleTimeString()} - Robot đã có mặt tại bàn làm việc!`,
      ]);
    }
  }, [botState.state, botState.targetDesk]);

  // Khởi tạo mini-game
  const resetGame = () => {
    const symbols = [1, 2, 3, 4, 1, 2, 3, 4].sort(() => Math.random() - 0.5);
    setGameTiles(symbols);
    setFlipped([]);
    setMatched([]);
    setGameMoves(0);
  };

  useEffect(() => {
    resetGame();
  }, []);

  const handleTileClick = (index: number) => {
    if (flipped.length === 2 || flipped.includes(index) || matched.includes(index)) return;
    const nextFlipped = [...flipped, index];
    setFlipped(nextFlipped);

    if (nextFlipped.length === 2) {
      setGameMoves(m => m + 1);
      const [i1, i2] = nextFlipped;
      if (gameTiles[i1] === gameTiles[i2]) {
        setMatched(m => [...m, i1, i2]);
        setFlipped([]);
      } else {
        setTimeout(() => setFlipped([]), 800);
      }
    }
  };

  const getNextZ = useCallback((currentWindows: Record<WindowId, OSWindow>) => {
    const maxWinZ = Math.max(topZRef.current, ...Object.values(currentWindows).map(w => w.zIndex || 0), 20);
    const nextZ = maxWinZ + 1;
    topZRef.current = nextZ;
    return nextZ;
  }, []);

  const focusWindow = useCallback((id: WindowId) => {
    setWindows(prev => {
      const nextZ = getNextZ(prev);
      setTopZ(nextZ);
      setActiveWindow(id);
      return {
        ...prev,
        [id]: { ...prev[id], isOpen: true, isMinimized: false, zIndex: nextZ },
      };
    });
  }, [getNextZ]);

  const toggleMinimize = useCallback((id: WindowId) => {
    setWindows(prev => {
      const target = prev[id];
      if (!target) return prev;
      if (target.isMinimized) {
        const nextZ = getNextZ(prev);
        setTopZ(nextZ);
        setActiveWindow(id);
        return {
          ...prev,
          [id]: { ...target, isOpen: true, isMinimized: false, zIndex: nextZ },
        };
      }
      setActiveWindow(curr => (curr === id ? null : curr));
      return {
        ...prev,
        [id]: { ...target, isMinimized: true },
      };
    });
  }, [getNextZ]);

  const closeWindow = useCallback((id: WindowId) => {
    setActiveWindow(curr => (curr === id ? null : curr));
    setWindows(prev => ({
      ...prev,
      [id]: { ...prev[id], isOpen: false },
    }));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (initialModule) {
      openModuleInBrowser(initialModule.key, initialModule.title);
    } else if (initialApp) {
      focusWindow(initialApp);
    }
    if (initialPrompt) {
      setInputChat(initialPrompt);
    }
  }, [isOpen, initialApp, initialModule, initialPrompt, focusWindow]);

  const handleSendChat = async (presetText?: string) => {
    const textToSend = presetText !== undefined ? presetText : inputChat;
    if (!textToSend.trim()) return;
    const userText = textToSend.trim();
    const t = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    setChatMessages(prev => [...prev, { sender: 'me', text: userText, time: t }]);
    if (presetText === undefined) setInputChat('');

    const low = userText.toLowerCase();

    // Các lệnh thao tác nhanh văn phòng 3D (Instant Office Actions)
    if (low.includes('robot') || low.includes('bot') || low.includes('gọi')) {
      onCallBot();
      setChatMessages(prev => [
        ...prev,
        {
          sender: 'bot',
          text: '🤖 Đang điều phối Robot AI di chuyển tới bàn làm việc của bạn!',
          time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
          actions: [
            { label: '🛑 Trả Robot về trạm', action: () => onReleaseBot() }
          ],
        },
      ]);
      return;
    }

    if (low.includes('sếp') || low.includes('giám đốc') || low.includes('tuần tra')) {
      onTriggerPatrol();
      setChatMessages(prev => [
        ...prev,
        {
          sender: 'bot',
          text: '📋 Đã kích hoạt Giám đốc đi tuần tra các phòng ban trong văn phòng 3D!',
          time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      return;
    }

    // Kết nối API Trợ lý AI Backend (/api/chatbot/send/)
    setIsBotTyping(true);
    const authHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (idToken) {
      authHeaders['Authorization'] = `Bearer ${idToken}`;
    }

    try {
      const sendRes = await fetch('/api/chatbot/send/', {
        method: 'POST',
        headers: authHeaders,
        credentials: 'include',
        body: JSON.stringify({ message: userText }),
      });

      if (sendRes.ok) {
        const sendData = await sendRes.json();
        const jobId = sendData.job_id;
        if (jobId) {
          if (activePollRef.current) {
            clearInterval(activePollRef.current);
          }
          let attempts = 0;
          activePollRef.current = setInterval(async () => {
            attempts++;
            if (attempts > 25) {
              if (activePollRef.current) {
                clearInterval(activePollRef.current);
                activePollRef.current = null;
              }
              setIsBotTyping(false);
              setChatMessages(prev => [
                ...prev,
                {
                  sender: 'bot',
                  text: 'Hệ thống đang tiếp tục xử lý yêu cầu của bạn. Bạn có thể kiểm tra kết quả ở thanh Trợ lý AI.',
                  time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                },
              ]);
              return;
            }
            try {
              const statusRes = await fetch(`/api/chatbot/jobs/${jobId}/status/`, {
                headers: authHeaders,
                credentials: 'include',
              });
              if (statusRes.ok) {
                const jobData = await statusRes.json();
                if (jobData.status === 'done' || jobData.status === 'DONE') {
                  if (activePollRef.current) {
                    clearInterval(activePollRef.current);
                    activePollRef.current = null;
                  }
                  setIsBotTyping(false);
                  const botReply = jobData.result?.message || 'Tôi đã xử lý xong yêu cầu của bạn.';
                  setChatMessages(prev => [
                    ...prev,
                    {
                      sender: 'bot',
                      text: botReply,
                      time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                    },
                  ]);
                } else if (jobData.status === 'failed' || jobData.status === 'FAILED') {
                  if (activePollRef.current) {
                    clearInterval(activePollRef.current);
                    activePollRef.current = null;
                  }
                  setIsBotTyping(false);
                  setChatMessages(prev => [
                    ...prev,
                    {
                      sender: 'bot',
                      text: jobData.error || 'Rất tiếc, đã có lỗi xảy ra khi xử lý.',
                      time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                    },
                  ]);
                }
              }
            } catch {
              // Tiếp tục poll
            }
          }, 1200);
          return;
        }
      }
    } catch {
      // Fallback sang local responses nếu offline
    }

    setIsBotTyping(false);
    let reply = 'Tôi đã ghi nhận yêu cầu của bạn.';
    let replyActions: ChatAction[] | undefined = undefined;

    if (low.includes('đề') || low.includes('thi') || low.includes('khảo thí')) {
      reply = `Hệ thống Khảo thí AI đang sẵn sàng (${examData.totalPapers} bộ đề). Bạn có thể mở trực tiếp phân hệ Khảo thí tại đây:`;
      replyActions = [
        { label: '🚀 Mở phân hệ Khảo thí', action: () => { onClose(); onNavigateModule('examination'); } }
      ];
    } else if (low.includes('báo cáo') || low.includes('kpi') || low.includes('tuần')) {
      reply = 'Bạn có thể hoàn thành và nộp nhanh Báo cáo tuần công tác tại phân hệ Báo cáo:';
      replyActions = [
        { label: '📝 Mở Báo cáo tuần', action: () => { onClose(); onNavigateModule('weekly-report'); } }
      ];
    } else if (low.includes('lịch') || low.includes('họp') || low.includes('công ca')) {
      reply = 'Bạn có thể kiểm tra Lịch tuần và Công ca của các phòng ban tại đây:';
      replyActions = [
        { label: '📅 Mở Lịch tuần', action: () => { onClose(); onNavigateModule('calendar'); } },
        { label: '⏱️ Mở Công ca', action: () => { onClose(); onNavigateModule('attendance'); } },
      ];
    } else if (low.includes('chào') || low.includes('hello')) {
      reply = 'Chào bạn! Chúc bạn một ngày làm việc tràn đầy năng lượng tại FermatTech! Bạn cần tôi giúp gì?';
      replyActions = [
        { label: 'Mở Khảo thí', action: () => { onClose(); onNavigateModule('examination'); } },
        { label: 'Gọi Robot AI', action: () => onCallBot() },
      ];
    }

    setChatMessages(prev => [
      ...prev,
      {
        sender: 'bot',
        text: reply,
        time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        actions: replyActions,
      },
    ]);
  };

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] pointer-events-auto flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 sm:p-8 animate-in fade-in duration-200">
      {/* Khung FermatOS Glassmorphism Workstation */}
      <div className="relative w-full max-w-6xl h-[88vh] bg-slate-950/90 border border-white/20 rounded-3xl shadow-[0_25px_60px_rgba(0,0,0,0.85)] backdrop-blur-2xl flex flex-col overflow-hidden select-none font-sans">

        {/* FermatOS Top Menu Bar */}
        <div className="h-8 bg-slate-950/80 backdrop-blur-2xl border-b border-white/10 px-4 flex items-center justify-between text-xs text-slate-200 select-none z-50">
          <div className="flex items-center gap-3">
            <div className="relative">
              <button
                type="button"
                onClick={() => setAppleMenuOpen(prev => !prev)}
                className="text-sm font-bold text-white hover:text-sky-400 cursor-pointer transition px-1.5 py-0.5 rounded hover:bg-white/10 flex items-center justify-center"
                title="Fermat Menu"
              >
                <img src="/logo.png" alt="Fermat" className="w-3.5 h-3.5 object-contain brightness-0 invert inline-block select-none" />
              </button>
              {appleMenuOpen && (
                <div
                  className="absolute top-7 left-0 w-60 bg-slate-900/95 backdrop-blur-2xl border border-white/20 rounded-xl shadow-2xl py-1.5 z-50 text-xs text-slate-200 animate-in fade-in slide-in-from-top-1"
                  onClick={() => setAppleMenuOpen(false)}
                >
                  <button
                    onClick={() => { setSettingsTab('about'); focusWindow('settings'); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-sky-500 hover:text-white transition flex items-center justify-between"
                  >
                    <span>Giới thiệu về FermatOS</span>
                    <span className="text-[10px] text-slate-300 font-semibold">FermatOS</span>
                  </button>
                  <div className="my-1 border-t border-white/10" />
                  <button
                    onClick={() => { setSettingsTab('wallpaper'); focusWindow('settings'); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-sky-500 hover:text-white transition flex items-center gap-2"
                  >
                    <Palette className="w-3.5 h-3.5 text-sky-400" />
                    <span>Đổi hình nền Desktop...</span>
                  </button>
                  <button
                    onClick={() => { setSettingsTab('display'); focusWindow('settings'); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-sky-500 hover:text-white transition flex items-center gap-2"
                  >
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                    <span>Cài đặt độ sáng màn hình...</span>
                  </button>
                  <button
                    onClick={() => focusWindow('apps')}
                    className="w-full text-left px-3 py-1.5 hover:bg-sky-500 hover:text-white transition flex items-center gap-2"
                  >
                    <LayoutGrid className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Tất cả ứng dụng (Launchpad)</span>
                  </button>
                  <div className="my-1 border-t border-white/10" />
                  <button
                    onClick={() => {
                      setWindows({
                        assistant: { id: 'assistant', title: 'Trợ lý AI Workstation', icon: Bot, isOpen: true, isMinimized: false, zIndex: 1 },
                        exam: { id: 'exam', title: 'Khảo thí & Ngân hàng đề thi', icon: GraduationCap, isOpen: false, isMinimized: false, zIndex: 2 },
                        reports: { id: 'reports', title: 'Báo cáo tuần & Tiến độ', icon: FileText, isOpen: false, isMinimized: false, zIndex: 3 },
                        docs: { id: 'docs', title: 'Kho tài liệu & Quy chuẩn', icon: Folder, isOpen: false, isMinimized: false, zIndex: 4 },
                        terminal: { id: 'terminal', title: 'Nhật ký Console Văn phòng', icon: Terminal, isOpen: false, isMinimized: false, zIndex: 5 },
                        game: { id: 'game', title: 'Fermat Arcade: Xả Stress', icon: Gamepad2, isOpen: false, isMinimized: false, zIndex: 6 },
                        settings: { id: 'settings', title: 'Cài đặt hệ thống FermatOS', icon: Settings, isOpen: false, isMinimized: false, zIndex: 7 },
                        apps: { id: 'apps', title: 'Launchpad · Tất cả ứng dụng', icon: LayoutGrid, isOpen: false, isMinimized: false, zIndex: 8 },
                        browser: { id: 'browser', title: 'Fermat Safari · Trình duyệt phân hệ', icon: Globe, isOpen: false, isMinimized: false, zIndex: 9 },
                        finance: { id: 'finance', title: 'Sổ Kế Toán & Dòng Tiền', icon: Wallet, isOpen: false, isMinimized: false, zIndex: 10 },
                        social: { id: 'social', title: 'War-room Truyền Thông', icon: Share2, isOpen: false, isMinimized: false, zIndex: 11 },
                        training: { id: 'training', title: 'Công Nghệ & Đào Tạo Số', icon: Cpu, isOpen: false, isMinimized: false, zIndex: 12 },
                        attendance: { id: 'attendance', title: 'Trạm Chấm Công & Công Ca', icon: Clock, isOpen: false, isMinimized: false, zIndex: 13 },
                      });
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-sky-500 hover:text-white transition flex items-center gap-2"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-slate-300" />
                    <span>Khởi động lại Desktop OS</span>
                  </button>
                  <div className="my-1 border-t border-white/10" />
                  <button
                    onClick={onClose}
                    className="w-full text-left px-3 py-1.5 hover:bg-rose-500 hover:text-white transition flex items-center justify-between text-rose-300"
                  >
                    <span>Đóng Desktop OS</span>
                    <span className="text-[10px] opacity-70">Esc</span>
                  </button>
                </div>
              )}
            </div>
            <span className="font-bold text-white tracking-wide">Workspace OS</span>
            <span
              onClick={() => focusWindow('apps')}
              className="hidden sm:inline text-slate-400 hover:text-white cursor-pointer transition"
            >
              Ứng dụng
            </span>
            <span
              onClick={() => { setSettingsTab('wallpaper'); focusWindow('settings'); }}
              className="hidden sm:inline text-slate-400 hover:text-white cursor-pointer transition"
            >
              Hình nền
            </span>
            <span
              onClick={() => { setSettingsTab('display'); focusWindow('settings'); }}
              className="hidden sm:inline text-slate-400 hover:text-white cursor-pointer transition"
            >
              Độ sáng ({screenBrightness}%)
            </span>
            <span
              onClick={() => focusWindow('terminal')}
              className="hidden sm:inline text-slate-400 hover:text-white cursor-pointer transition"
            >
              Console
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px] font-mono text-slate-300">
            <button
              onClick={() => { setSettingsTab('wallpaper'); focusWindow('settings'); }}
              className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition cursor-pointer"
              title="Đổi hình nền FermatOS"
            >
              <Palette className="w-3 h-3 text-sky-400" />
              <span className="text-[10px] font-sans">{currentWallpaperObj.name}</span>
            </button>
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px]">
              <span className={`w-2 h-2 rounded-full ${botState.state === 'ARRIVED' ? 'bg-emerald-400 animate-pulse' : 'bg-sky-400'}`} />
              <span className="font-sans font-semibold text-slate-300">
                {botState.state === 'ARRIVED' ? 'Robot tại bàn' : botState.state === 'MOVING' ? 'Robot đang tới' : 'Bot Station'}
              </span>
            </div>
            <span>{timeStr}</span>
            <button
              onClick={onClose}
              className="p-1 hover:bg-rose-500/20 hover:text-rose-400 rounded-lg text-slate-400 transition cursor-pointer"
              title="Đóng Desktop OS"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Màn hình Desktop FermatOS */}
        <div
          className={`relative flex-1 bg-gradient-to-br ${currentWallpaperObj.gradientClass} overflow-hidden p-4 pb-20 flex transition-all duration-300`}
          style={{ filter: `brightness(${screenBrightness}%)` }}
        >
          {/* Ánh sáng kính mờ FermatOS */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(56,189,248,0.14),transparent_45%),radial-gradient(circle_at_75%_70%,rgba(217,119,87,0.10),transparent_45%)] pointer-events-none" />

          {/* Cột Desktop Icons bên trái */}
          <div className="relative z-10 flex flex-col gap-2.5 w-28 overflow-y-auto pr-1 no-scrollbar max-h-full">
            <button
              onClick={() => focusWindow('assistant')}
              className={`flex flex-col items-center p-2 rounded-xl border-2 transition-all text-center group ${
                activeWindow === 'assistant' && windows.assistant.isOpen
                  ? 'bg-slate-900/80 border-[#D97757] shadow-sm'
                  : 'border-transparent hover:bg-slate-900/50 hover:border-white/10'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-[#D97757] text-white flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
                <Bot className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-bold text-slate-100 mt-1 leading-tight">
                Trợ lý AI
              </span>
            </button>

            <button
              onClick={() => focusWindow('apps')}
              className={`flex flex-col items-center p-2 rounded-xl border-2 transition-all text-center group ${
                activeWindow === 'apps' && windows.apps.isOpen
                  ? 'bg-slate-900/80 border-[#38BDF8] shadow-sm'
                  : 'border-transparent hover:bg-slate-900/50 hover:border-white/10'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 text-white flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
                <LayoutGrid className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-bold text-slate-100 mt-1 leading-tight">
                Launchpad
              </span>
            </button>

            <button
              onClick={() => focusWindow('exam')}
              className={`flex flex-col items-center p-2 rounded-xl border-2 transition-all text-center group ${
                activeWindow === 'exam' && windows.exam.isOpen
                  ? 'bg-slate-900/80 border-[#D97757] shadow-sm'
                  : 'border-transparent hover:bg-slate-900/80/50 hover:border-white/10/30'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-[#1E232B] text-slate-100 flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
                <GraduationCap className="w-6 h-6 text-[#38BDF8]" />
              </div>
              <span className="text-[11px] font-bold text-slate-100 mt-1 leading-tight">
                Khảo thí
              </span>
            </button>

            <button
              onClick={() => focusWindow('reports')}
              className={`flex flex-col items-center p-2 rounded-xl border-2 transition-all text-center group ${
                activeWindow === 'reports' && windows.reports.isOpen
                  ? 'bg-slate-900/80 border-[#D97757] shadow-sm'
                  : 'border-transparent hover:bg-slate-900/80/50 hover:border-white/10/30'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-[#2A9D8F] text-white flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
                <FileText className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-bold text-slate-100 mt-1 leading-tight">
                Báo cáo tuần
              </span>
            </button>

            <button
              onClick={() => focusWindow('terminal')}
              className={`flex flex-col items-center p-2 rounded-xl border-2 transition-all text-center group ${
                activeWindow === 'terminal' && windows.terminal.isOpen
                  ? 'bg-slate-900/80 border-[#D97757] shadow-sm'
                  : 'border-transparent hover:bg-slate-900/80/50 hover:border-white/10/30'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-[#1E232B] text-emerald-400 flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform font-mono">
                <Terminal className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-bold text-slate-100 mt-1 leading-tight">
                HQ Console
              </span>
            </button>

            <button
              onClick={() => focusWindow('game')}
              className={`flex flex-col items-center p-2 rounded-xl border-2 transition-all text-center group ${
                activeWindow === 'game' && windows.game.isOpen
                  ? 'bg-slate-900/80 border-[#D97757] shadow-sm'
                  : 'border-transparent hover:bg-slate-900/80/50 hover:border-white/10/30'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-[#E76F51] text-white flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
                <Gamepad2 className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-bold text-slate-100 mt-1 leading-tight">
                Mini Game
              </span>
            </button>

            <button
              onClick={() => focusWindow('settings')}
              className={`flex flex-col items-center p-2 rounded-xl border-2 transition-all text-center group ${
                activeWindow === 'settings' && windows.settings.isOpen
                  ? 'bg-slate-900/80 border-[#38BDF8] shadow-sm'
                  : 'border-transparent hover:bg-slate-900/50 hover:border-white/10'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-slate-600 to-zinc-800 text-white flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
                <Settings className="w-6 h-6 text-slate-200" />
              </div>
              <span className="text-[11px] font-bold text-slate-100 mt-1 leading-tight">
                Cài đặt OS
              </span>
            </button>
          </div>

          {/* Khu vực chứa các cửa sổ (Windows Area) */}
          <div className="relative flex-1 ml-2 z-10 isolate">
            
            {/* CỬA SỔ 1: TRỢ LÝ AI WORKSTATION */}
            {windows.assistant.isOpen && !windows.assistant.isMinimized && (
              <div
                onMouseDownCapture={() => focusWindow('assistant')}
                style={{ zIndex: windows.assistant.zIndex }}
                className="absolute inset-2 bg-slate-900/90 border-2 border-white/10 rounded-2xl shadow-2xl backdrop-blur-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
              >
                {/* Header Window */}
                {/* FermatOS Window Titlebar */}
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/75 border-b border-white/10 text-xs select-none">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); closeWindow('assistant'); }}
                      className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Đóng (Close)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">×</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleMinimize('assistant'); }}
                      className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Thu nhỏ (Minimize)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">−</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); focusWindow('assistant'); }}
                      className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Phóng to / Lấy nét (Zoom)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">+</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 font-bold tracking-wide text-slate-200">
                    <Bot className="w-4 h-4 text-sky-400" />
                    <span>TRỢ LÝ AI WORKSTATION // HÀNG CHỜ VẬT LÝ</span>
                  </div>
                  <div className="w-12" />
                </div>

                {/* Body Window */}
                <div className="flex-1 p-3 grid grid-cols-1 md:grid-cols-3 gap-3 overflow-hidden">
                  {/* Cột trái: Điều khiển Robot vật lý & Hàng chờ */}
                  <div className="bg-slate-900/80/60 p-3 rounded-xl border border-white/10/20 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10/15">
                        <span className="text-xs font-bold text-slate-100 uppercase tracking-wide">
                          Điều phối Robot
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${
                          botState.state === 'ARRIVED'
                            ? 'bg-emerald-600 text-white'
                            : botState.state === 'MOVING'
                            ? 'bg-amber-500 text-white animate-pulse'
                            : 'bg-[#1E232B]/10 text-slate-100'
                        }`}>
                          {botState.state === 'ARRIVED' ? 'TẠI BÀN' : botState.state === 'MOVING' ? 'ĐANG ĐẾN' : 'TRẠM CHỜ'}
                        </span>
                      </div>

                      <div className="text-xs text-slate-100/80 mb-3 space-y-1">
                        <p>• Robot: <strong className="text-[#D97757]">{botState.botName || 'AI Voxel Bot'}</strong></p>
                        <p>• Bàn làm việc: <strong>Bàn cá nhân (Desk #{botState.targetDesk ?? 14})</strong></p>
                        <p>• Hàng chờ hiện tại: <strong className="font-mono text-[#D97757]">{botState.queueLength} người</strong></p>
                      </div>

                      {botState.state === 'ARRIVED' ? (
                        <div className="p-2.5 bg-emerald-50 border border-emerald-300 rounded-lg text-emerald-800 text-xs mb-3 flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          <span>Robot đã di chuyển xong từ phòng Khảo thí đến bàn bạn và sẵn sàng hỗ trợ!</span>
                        </div>
                      ) : botState.state === 'MOVING' ? (
                        <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-lg text-amber-800 text-xs mb-3 flex items-start gap-2">
                          <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 animate-spin" />
                          <span>Robot đang di chuyển theo hành lang 3D... Vui lòng đợi trong giây lát!</span>
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <button
                        onClick={onCallBot}
                        disabled={botState.state === 'MOVING'}
                        className="w-full py-2 px-3 bg-[#D97757] hover:bg-[#c46849] active:translate-y-0.5 text-white rounded-xl font-bold text-xs shadow-sm border border-white/10 flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                      >
                        <Bot className="w-4 h-4" />
                        Gọi Robot tới bàn làm việc
                      </button>

                      {botState.state === 'ARRIVED' && (
                        <button
                          onClick={onReleaseBot}
                          className="w-full py-1.5 px-3 bg-[#1E232B] hover:bg-[#2b323d] active:translate-y-0.5 text-slate-100 rounded-xl font-bold text-xs border border-white/10 flex items-center justify-center gap-1.5 transition-all"
                        >
                          Cho Robot về trạm sạc
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Cột phải: Khung Chat tương tác với Bot */}
                  <div className="md:col-span-2 bg-slate-900/90 border border-white/10/20 rounded-xl flex flex-col overflow-hidden">
                    {/* Danh sách tin nhắn */}
                    <div className="flex-1 p-3 overflow-y-auto space-y-2.5 text-xs">
                      {chatMessages.map((msg, idx) => (
                        <div
                          key={idx}
                          className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[80%] p-2.5 rounded-xl border ${
                              msg.sender === 'me'
                                ? 'bg-[#D97757] text-white border-white/10/30 rounded-tr-none'
                                : 'bg-slate-900/80 text-slate-100 border-white/10/20 rounded-tl-none'
                            }`}
                          >
                            <div className="text-[10px] opacity-70 mb-0.5 font-mono">
                              {msg.sender === 'me' ? 'Bạn' : 'Robot AI'} • {msg.time}
                            </div>
                            <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                            {msg.actions && msg.actions.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {msg.actions.map((act, aIdx) => (
                                  <button
                                    key={aIdx}
                                    type="button"
                                    onClick={act.action}
                                    className="rounded-lg border border-white/10/30 bg-slate-800/80/90 px-2.5 py-1 text-[11px] font-bold text-slate-100 shadow-sm hover:bg-[#D97757] hover:text-white transition cursor-pointer"
                                  >
                                    {act.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      {isBotTyping && (
                        <div className="flex justify-start">
                          <div className="p-2.5 rounded-xl border bg-slate-900/80 text-slate-100 border-white/10/20 rounded-tl-none flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D97757]" />
                            <span className="text-[11px] font-medium text-slate-100/80">Trợ lý AI đang suy nghĩ phản hồi...</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Quick Prompts */}
                    <div className="px-2.5 py-1.5 border-t border-white/10/10 bg-slate-900/80/20 flex flex-wrap gap-1.5">
                      {[
                        'Mở Khảo thí',
                        'Báo cáo tuần',
                        'Gọi Robot tới bàn',
                        'Xem lịch tuần',
                      ].map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => handleSendChat(chip)}
                          className="rounded-full border border-white/10/20 bg-slate-800/80/80 hover:bg-[#D97757] hover:text-white hover:border-[#D97757] px-2.5 py-0.5 text-[10px] font-semibold text-slate-100 transition cursor-pointer"
                        >
                          {chip}
                        </button>
                      ))}
                    </div>

                    {/* Input Chat */}
                    <div className="p-2 border-t border-white/10/15 bg-slate-900/80/30 flex gap-2">
                      <input
                        type="text"
                        value={inputChat}
                        onChange={(e) => setInputChat(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                        placeholder="Hỏi trợ lý AI về khảo thí, báo cáo, tài liệu..."
                        className="flex-1 px-3 py-1.5 bg-slate-800/80 border border-white/10/30 rounded-lg text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#D97757]"
                      />
                      <button
                        type="button"
                        onClick={() => handleSendChat()}
                        className="px-3 py-1.5 bg-[#D97757] text-white rounded-lg font-bold text-xs flex items-center gap-1 hover:bg-[#c46849] cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Gửi
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* CỬA SỔ 2: KHẢO THÍ & NGÂN HÀNG ĐỀ THI */}
            {windows.exam.isOpen && !windows.exam.isMinimized && (
              <div
                onMouseDownCapture={() => focusWindow('exam')}
                style={{ zIndex: windows.exam.zIndex }}
                className="absolute inset-2 bg-slate-900/90 border-2 border-white/10 rounded-2xl shadow-2xl backdrop-blur-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
              >
                {/* FermatOS Window Titlebar */}
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/75 border-b border-white/10 text-xs select-none">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); closeWindow('exam'); }}
                      className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Đóng (Close)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">×</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleMinimize('exam'); }}
                      className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Thu nhỏ (Minimize)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">−</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); focusWindow('exam'); }}
                      className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Phóng to / Lấy nét (Zoom)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">+</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 font-bold tracking-wide text-slate-200">
                    <GraduationCap className="w-4 h-4 text-purple-400" />
                    <span>HỆ THỐNG KHẢO THÍ & ĐÀO TẠO SỐ FERMAT</span>
                  </div>
                  <div className="w-12" />
                </div>

                <div className="flex-1 p-4 overflow-y-auto space-y-4 text-xs text-slate-100">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 bg-slate-900/80/60 border border-white/10/20 rounded-xl">
                      <span className="text-[10px] uppercase font-bold text-slate-100/60">Đề thi kích hoạt</span>
                      <p className="text-xl font-bold text-[#D97757] mt-1">{examData.totalPapers} Bộ đề</p>
                    </div>
                    <div className="p-3 bg-slate-900/80/60 border border-white/10/20 rounded-xl">
                      <span className="text-[10px] uppercase font-bold text-slate-100/60">Kỳ thi sẵn sàng</span>
                      <p className="text-xl font-bold text-slate-100 mt-1">{examData.activeCount} Kỳ thi</p>
                    </div>
                    <div className="p-3 bg-slate-900/80/60 border border-white/10/20 rounded-xl">
                      <span className="text-[10px] uppercase font-bold text-slate-100/60">Độ chính xác chấm AI</span>
                      <p className="text-xl font-bold text-emerald-600 mt-1">{examData.accuracy}</p>
                    </div>
                  </div>

                  <div className="p-3 border border-white/10/20 rounded-xl bg-slate-800/80 space-y-2">
                    <h4 className="font-bold text-xs uppercase tracking-wide text-slate-100">
                      {examData.papers.length > 0 ? 'Đề thi thực tế từ hệ thống' : 'Các kỳ thi trọng điểm trong tuần'}
                    </h4>
                    <ul className="space-y-1.5 text-xs text-slate-100/80">
                      {examData.papers.length > 0 ? (
                        examData.papers.map((p, pIdx) => (
                          <li key={p.id || pIdx} className="flex justify-between items-center py-1 border-b border-white/10/10 last:border-b-0">
                            <span className="truncate pr-2">{p.title}</span>
                            <span className="font-mono font-bold text-emerald-600 shrink-0 uppercase text-[10px]">
                              {p.status || 'SẴN SÀNG'}
                            </span>
                          </li>
                        ))
                      ) : (
                        <>
                          <li className="flex justify-between items-center py-1 border-b border-white/10/10">
                            <span>Đánh giá năng lực Toán Quốc tế Fermat (Khối 8 - 9)</span>
                            <span className="font-mono font-bold text-emerald-600">ĐANG DIỄN RA</span>
                          </li>
                          <li className="flex justify-between items-center py-1 border-b border-white/10/10">
                            <span>Thi thử Tiếng Anh THPT Chuyên đợt 2</span>
                            <span className="font-mono font-bold text-amber-600">CHUẨN BỊ MỞ</span>
                          </li>
                          <li className="flex justify-between items-center py-1">
                            <span>Khảo sát chất lượng số hóa ngành Giáo dục 2026</span>
                            <span className="font-mono font-bold text-slate-100/60">ĐÃ HOÀN THÀNH</span>
                          </li>
                        </>
                      )}
                    </ul>
                  </div>

                  <button
                    onClick={() => {
                      onClose();
                      onNavigateModule('examination');
                    }}
                    className="py-2.5 px-4 bg-[#D97757] hover:bg-[#c46849] text-white font-bold rounded-xl shadow-sm border border-white/10 flex items-center justify-center gap-2"
                  >
                    <span>Mở toàn màn hình Phân hệ Khảo thí</span>
                  </button>
                </div>
              </div>
            )}

            {/* CỬA SỔ 3: BÁO CÁO TUẦN & GIÁM ĐỐC */}
            {windows.reports.isOpen && !windows.reports.isMinimized && (
              <div
                onMouseDownCapture={() => focusWindow('reports')}
                style={{ zIndex: windows.reports.zIndex }}
                className="absolute inset-2 bg-slate-900/90 border-2 border-white/10 rounded-2xl shadow-2xl backdrop-blur-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
              >
                {/* FermatOS Window Titlebar */}
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/75 border-b border-white/10 text-xs select-none">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); closeWindow('reports'); }}
                      className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Đóng (Close)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">×</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleMinimize('reports'); }}
                      className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Thu nhỏ (Minimize)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">−</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); focusWindow('reports'); }}
                      className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Phóng to / Lấy nét (Zoom)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">+</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 font-bold tracking-wide text-slate-200">
                    <FileText className="w-4 h-4 text-emerald-400" />
                    <span>BÁO CÁO TIẾN ĐỘ & LỊCH CÔNG TÁC</span>
                  </div>
                  <div className="w-12" />
                </div>

                <div className="flex-1 p-4 overflow-y-auto space-y-4 text-xs text-slate-100">
                  {initialColleague && (
                    <div className="p-3 bg-cyan-500/15 border border-cyan-400/30 rounded-xl flex items-center justify-between text-cyan-100 shadow-sm animate-in fade-in duration-150">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-cyan-300 shrink-0" />
                        <div>
                          <p className="font-bold text-xs">Đang giao việc cho: {initialColleague.name}</p>
                          <p className="text-[11px] text-cyan-200/80">
                            {initialColleague.role || 'Thành viên ban dự án'}
                            {initialColleague.email ? ` • ${initialColleague.email}` : ''}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowTaskForm(prev => !prev)}
                        className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-lg text-[11px] shadow-sm transition shrink-0 flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{showTaskForm ? 'Ẩn form' : 'Giao việc ngay'}</span>
                      </button>
                    </div>
                  )}

                  {/* Form Giao việc / Tạo Task trực tiếp 2 chiều */}
                  <div className="p-3.5 border border-white/15 rounded-xl bg-slate-900/75 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-xs uppercase tracking-wide flex items-center gap-1.5 text-emerald-300">
                        <Plus className="w-3.5 h-3.5" />
                        <span>Tạo công việc & Giao việc ngay trên 3D</span>
                      </h4>
                      <button
                        type="button"
                        onClick={() => setShowTaskForm(prev => !prev)}
                        className="text-[11px] font-semibold text-slate-300 hover:text-white px-2 py-0.5 rounded bg-white/10 transition"
                      >
                        {showTaskForm ? 'Thu gọn' : '+ Mở form'}
                      </button>
                    </div>

                    {(showTaskForm || !initialColleague) && (
                      <form onSubmit={handleCreateTask} className="space-y-2.5 pt-1">
                        <div>
                          <input
                            type="text"
                            value={taskTitle}
                            onChange={(e) => setTaskTitle(e.target.value)}
                            placeholder="Nhập tên công việc / nhiệm vụ cần làm..."
                            className="w-full px-3 py-2 rounded-lg bg-slate-800/90 border border-white/15 text-white placeholder-slate-400 text-xs focus:outline-none focus:border-cyan-400"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-1">Email người nhận (tuỳ chọn)</label>
                            <input
                              type="text"
                              value={taskExecutor}
                              onChange={(e) => setTaskExecutor(e.target.value)}
                              placeholder="Mặc định: Bản thân"
                              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800/90 border border-white/15 text-white placeholder-slate-500 text-[11px] focus:outline-none focus:border-cyan-400"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-1 flex items-center gap-1">
                              <Calendar className="w-3 h-3" /> Ngày thực hiện
                            </label>
                            <input
                              type="date"
                              value={taskDate}
                              onChange={(e) => setTaskDate(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800/90 border border-white/15 text-white text-[11px] focus:outline-none focus:border-cyan-400"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-1">Mức độ ưu tiên</label>
                            <select
                              value={taskPriority}
                              onChange={(e) => setTaskPriority(e.target.value as 'low' | 'medium' | 'high')}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800/90 border border-white/15 text-white text-[11px] focus:outline-none focus:border-cyan-400"
                            >
                              <option value="low">Thường</option>
                              <option value="medium">Quan trọng</option>
                              <option value="high">Khẩn cấp</option>
                            </select>
                          </div>
                        </div>

                        {taskNotice && (
                          <div className={`px-3 py-1.5 rounded-lg text-[11px] font-medium ${
                            taskNotice.type === 'success'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          }`}>
                            {taskNotice.text}
                          </div>
                        )}

                        <div className="flex justify-end">
                          <button
                            type="submit"
                            disabled={taskSubmitting || !taskTitle.trim()}
                            className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-1.5 transition cursor-pointer"
                          >
                            {taskSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            <span>{taskSubmitting ? 'Đang lưu...' : 'Lưu vào Lịch công tác'}</span>
                          </button>
                        </div>
                      </form>
                    )}
                  </div>

                  <div className="p-3 bg-slate-900/60 border border-white/15 rounded-xl flex items-center justify-between gap-3">
                    <div>
                      <h4 className="font-bold">Trạng thái Giám đốc tuần tra</h4>
                      <p className="text-[11px] text-slate-100/70 mt-0.5">
                        {patrolState.active
                          ? '🚨 Giám đốc đang đi tuần! Mọi nhân viên đã vội vã chạy về bàn làm việc.'
                          : 'Giám đốc đang ở phòng riêng làm việc và duyệt hồ sơ.'}
                      </p>
                    </div>
                    <span className="px-3 py-1.5 rounded-xl bg-sky-500/15 border border-sky-400/30 text-sky-300 font-semibold text-[11px] shrink-0 text-center">
                      Giám đốc tuần tra tự động đa phòng ban
                    </span>
                  </div>

                  <div className="p-3 border border-white/15 rounded-xl bg-slate-800/80 space-y-2">
                    <h4 className="font-bold text-xs uppercase tracking-wide">
                      Tiến độ công việc & nhiệm vụ ({workData.doneTasks}/{workData.totalTasks || 0} việc)
                    </h4>
                    <div className="w-full bg-slate-900/80 h-3 rounded-full overflow-hidden border border-white/10">
                      <div
                        className="bg-[#D97757] h-full transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(0, workData.completionRate))}%` }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-[11px] font-mono text-slate-100/70">
                      <span>Đã hoàn thành: {workData.completionRate}%</span>
                      <button
                        type="button"
                        onClick={refreshWorkSchedule}
                        className="text-cyan-300 hover:text-cyan-200 underline cursor-pointer"
                      >
                        Làm mới dữ liệu
                      </button>
                    </div>
                  </div>

                  {workData.items.length > 0 && (
                    <div className="p-3 border border-white/15 rounded-xl bg-slate-800/80 space-y-2">
                      <h4 className="font-bold text-xs uppercase tracking-wide text-slate-100">
                        Nhiệm vụ trực tiếp từ phân hệ Công việc (Bấm tick để cập nhật)
                      </h4>
                      <ul className="space-y-1.5 text-xs text-slate-100/90">
                        {workData.items.map((item, iIdx) => {
                          const done = isTaskCompleted(item.status);
                          const isDoing = (item.status || '').toLowerCase() === 'doing';
                          const assigneeName = item.executor?.name || item.executor?.email || item.assignee || 'Cá nhân';
                          return (
                            <li key={item.id || iIdx} className="flex justify-between items-center py-1.5 px-2 rounded-lg hover:bg-white/5 border-b border-white/10 last:border-b-0 transition">
                              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                <button
                                  type="button"
                                  onClick={() => handleToggleTaskStatus(item)}
                                  title={done ? 'Đánh dấu chưa xong' : 'Đánh dấu hoàn thành'}
                                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition cursor-pointer ${
                                    done
                                      ? 'bg-emerald-500 border-emerald-400 text-slate-950'
                                      : 'border-slate-400 hover:border-cyan-400 bg-slate-900/60'
                                  }`}
                                >
                                  {done && <Check className="w-3 h-3 stroke-[3]" />}
                                </button>
                                <div className="min-w-0">
                                  <p className={`truncate font-medium ${done ? 'line-through text-slate-400' : 'text-white'}`}>
                                    {item.title}
                                  </p>
                                  <p className="text-[10px] text-slate-400 truncate">
                                    {assigneeName} {item.date ? `• ${item.date}` : ''}
                                  </p>
                                </div>
                              </div>
                              <span className={`font-mono font-bold text-[10px] px-2 py-0.5 rounded-full shrink-0 ${
                                done
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : isDoing
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                              }`}>
                                {done ? 'HOÀN THÀNH' : isDoing ? 'ĐANG LÀM' : 'CẦN LÀM'}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* CỬA SỔ 3B: KHO TÀI LIỆU & QUY CHUẨN */}
            {windows.docs.isOpen && !windows.docs.isMinimized && (
              <div
                onMouseDownCapture={() => focusWindow('docs')}
                style={{ zIndex: windows.docs.zIndex }}
                className="absolute inset-2 bg-slate-900/95 border border-white/20 rounded-2xl shadow-2xl backdrop-blur-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150 text-slate-100"
              >
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/75 border-b border-white/10 text-xs select-none">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); closeWindow('docs'); }}
                      className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 font-bold transition cursor-pointer"
                      title="Đóng (Close)"
                    >✕</button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleMinimize('docs'); }}
                      className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 font-bold transition cursor-pointer"
                      title="Thu nhỏ (Minimize)"
                    >–</button>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29] opacity-60 cursor-default"
                      title="Toàn màn hình"
                    />
                  </div>
                  <div className="flex items-center gap-2 font-bold tracking-wide text-slate-200">
                    <Folder className="w-4 h-4 text-amber-400" />
                    <span>KHO TÀI LIỆU & BIỂU MẪU FERMAT</span>
                  </div>
                  <div className="w-12" />
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-slate-950/60">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                    <div>
                      <h3 className="text-base font-bold text-white">Tài nguyên & Văn bản nội bộ</h3>
                      <p className="text-xs text-slate-400 mt-0.5">Truy cập nhanh Kho tài liệu dùng chung, Số công văn và Đề xuất kinh phí ngay trong FermatOS.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openModuleInBrowser('resources', 'Kho tài nguyên dùng chung')}
                      className="px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Mở phân hệ Tài nguyên 2D</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <button
                      type="button"
                      onClick={() => openModuleInBrowser('resources', 'Kho tài nguyên & Biểu mẫu')}
                      className="p-4 rounded-2xl bg-slate-900/80 hover:bg-slate-800/90 border border-white/10 hover:border-amber-400/40 text-left transition space-y-2 cursor-pointer"
                    >
                      <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
                        <Folder className="w-5 h-5" />
                      </div>
                      <div className="text-sm font-semibold text-white">Tài nguyên chung</div>
                      <p className="text-xs text-slate-400">Quy trình, slide đào tạo, template biểu mẫu chuẩn của công ty.</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => openModuleInBrowser('document-number', 'Cấp số công văn')}
                      className="p-4 rounded-2xl bg-slate-900/80 hover:bg-slate-800/90 border border-white/10 hover:border-sky-400/40 text-left transition space-y-2 cursor-pointer"
                    >
                      <div className="w-9 h-9 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center border border-sky-500/30">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="text-sm font-semibold text-white">Cấp số công văn</div>
                      <p className="text-xs text-slate-400">Tra cứu và đăng ký số công văn đi/đến hành chính.</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => openModuleInBrowser('funding-proposal', 'Đề xuất kinh phí')}
                      className="p-4 rounded-2xl bg-slate-900/80 hover:bg-slate-800/90 border border-white/10 hover:border-emerald-400/40 text-left transition space-y-2 cursor-pointer"
                    >
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
                        <Wallet className="w-5 h-5" />
                      </div>
                      <div className="text-sm font-semibold text-white">Đề xuất kinh phí</div>
                      <p className="text-xs text-slate-400">Tạo tờ trình và theo dõi trạng thái duyệt đề xuất kinh phí.</p>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* CỬA SỔ 4: HQ CONSOLE TERMINAL */}
            {windows.terminal.isOpen && !windows.terminal.isMinimized && (
              <div
                onMouseDownCapture={() => focusWindow('terminal')}
                style={{ zIndex: windows.terminal.zIndex }}
                className="absolute inset-2 bg-[#111827] border-2 border-white/10 rounded-2xl shadow-2xl backdrop-blur-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150 font-mono text-emerald-400"
              >
                {/* FermatOS Window Titlebar */}
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/75 border-b border-white/10 text-xs select-none">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); closeWindow('terminal'); }}
                      className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Đóng (Close)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">×</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleMinimize('terminal'); }}
                      className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Thu nhỏ (Minimize)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">−</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); focusWindow('terminal'); }}
                      className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Phóng to / Lấy nét (Zoom)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">+</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 font-bold tracking-wide text-slate-200">
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    <span>NHẬT KÝ LỆNH & ĐIỀU PHỐI VĂN PHÒNG</span>
                  </div>
                  <div className="w-12" />
                </div>

                <div className="flex-1 p-3 overflow-y-auto space-y-1 text-xs">
                  {terminalLogs.map((log, idx) => (
                    <div key={idx} className="leading-relaxed">
                      {log}
                    </div>
                  ))}
                  <div className="text-gray-500 animate-pulse">_</div>
                </div>
              </div>
            )}

            {/* CỬA SỔ 5: MINI GAME XẢ STRESS */}
            {windows.game.isOpen && !windows.game.isMinimized && (
              <div
                onMouseDownCapture={() => focusWindow('game')}
                style={{ zIndex: windows.game.zIndex }}
                className="absolute inset-2 bg-slate-900/90 border-2 border-white/10 rounded-2xl shadow-2xl backdrop-blur-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
              >
                {/* FermatOS Window Titlebar */}
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/75 border-b border-white/10 text-xs select-none">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); closeWindow('game'); }}
                      className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Đóng (Close)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">×</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleMinimize('game'); }}
                      className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Thu nhỏ (Minimize)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">−</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); focusWindow('game'); }}
                      className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Phóng to / Lấy nét (Zoom)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">+</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 font-bold tracking-wide text-slate-200">
                    <Gamepad2 className="w-4 h-4 text-rose-400" />
                    <span>FERMAT ARCADE: XẢ STRESS</span>
                  </div>
                  <div className="w-12" />
                </div>

                <div className="flex-1 p-4 flex flex-col items-center justify-center">
                  <div className="flex items-center justify-between w-full max-w-xs mb-3 text-xs font-mono font-bold text-slate-100">
                    <span>Lượt mở: {gameMoves}</span>
                    <span>Khớp: {matched.length / 2} / 4 cặp</span>
                    <button
                      onClick={resetGame}
                      className="p-1 hover:bg-slate-900/80 rounded border border-white/10/30"
                      title="Chơi lại"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-2.5 w-full max-w-xs">
                    {gameTiles.map((val, idx) => {
                      const isFlipped = flipped.includes(idx) || matched.includes(idx);
                      const isMatched = matched.includes(idx);
                      return (
                        <button
                          key={idx}
                          onClick={() => handleTileClick(idx)}
                          className={`h-16 rounded-xl border-2 font-bold text-lg flex items-center justify-center transition-all ${
                            isMatched
                              ? 'bg-emerald-500 text-white border-white/10 shadow-sm'
                              : isFlipped
                              ? 'bg-[#D97757] text-white border-white/10 shadow-sm'
                              : 'bg-slate-900/80 border-white/10 hover:bg-slate-950/70 shadow-md active:translate-y-0.5'
                          }`}
                        >
                          {isFlipped ? (val === 1 ? '🤖' : val === 2 ? '📝' : val === 3 ? '☕' : '💻') : '?'}
                        </button>
                      );
                    })}
                  </div>

                  {matched.length === 8 && (
                    <div className="mt-4 p-2 bg-emerald-100 border border-emerald-400 rounded-lg text-emerald-800 text-xs font-bold animate-bounce">
                      🎉 Chúc mừng! Bạn đã giải xong câu đố xả stress!
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* CỬA SỔ 6: CÀI ĐẶT HỆ THỐNG (SYSTEM SETTINGS) */}
            {windows.settings.isOpen && !windows.settings.isMinimized && (
              <div
                onMouseDownCapture={() => focusWindow('settings')}
                style={{ zIndex: windows.settings.zIndex }}
                className="absolute inset-2 bg-slate-900/95 border-2 border-white/10 rounded-2xl shadow-2xl backdrop-blur-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
              >
                {/* FermatOS Window Titlebar */}
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/80 border-b border-white/10 text-xs select-none">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); closeWindow('settings'); }}
                      className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Đóng (Close)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">×</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleMinimize('settings'); }}
                      className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Thu nhỏ (Minimize)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">−</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); focusWindow('settings'); }}
                      className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Phóng to / Lấy nét (Zoom)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">+</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 font-bold tracking-wide text-slate-200">
                    <Settings className="w-4 h-4 text-sky-400" />
                    <span>CÀI ĐẶT HỆ THỐNG // FERMATOS WORKSTATION</span>
                  </div>
                  <div className="w-12" />
                </div>

                {/* Content: Sidebar + Main Panel */}
                <div className="flex-1 flex overflow-hidden">
                  {/* Left Sidebar */}
                  <div className="w-48 bg-slate-950/60 border-r border-white/10 p-3 flex flex-col gap-1 text-xs">
                    <button
                      onClick={() => setSettingsTab('wallpaper')}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition font-medium ${
                        settingsTab === 'wallpaper'
                          ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                          : 'text-slate-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Palette className="w-4 h-4" />
                      <span>Hình nền Desktop</span>
                    </button>

                    <button
                      onClick={() => setSettingsTab('display')}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition font-medium ${
                        settingsTab === 'display'
                          ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                          : 'text-slate-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Sun className="w-4 h-4" />
                      <span>Màn hình & Độ sáng</span>
                    </button>

                    <button
                      onClick={() => setSettingsTab('about')}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition font-medium ${
                        settingsTab === 'about'
                          ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                          : 'text-slate-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Laptop className="w-4 h-4" />
                      <span>Giới thiệu về máy</span>
                    </button>
                  </div>

                  {/* Right Panel */}
                  <div className="flex-1 p-5 overflow-y-auto text-slate-200">
                    {/* Tab Hình nền */}
                    {settingsTab === 'wallpaper' && (
                      <div>
                        <div className="mb-4">
                          <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <Palette className="w-4 h-4 text-sky-400" />
                            Bộ sưu tập hình nền FermatOS
                          </h3>
                          <p className="text-xs text-slate-400 mt-1">
                            Chọn giao diện nền hiển thị trên màn hình máy tính ảo. Cài đặt được lưu tự động trên trình duyệt.
                          </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                          {WALLPAPERS.map(wp => {
                            const isSelected = selectedWallpaper === wp.id;
                            return (
                              <div
                                key={wp.id}
                                onClick={() => handleSelectWallpaper(wp.id)}
                                className={`group p-3 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                                  isSelected
                                    ? 'bg-sky-950/40 border-sky-400 shadow-lg shadow-sky-500/10'
                                    : 'bg-slate-900/60 border-white/10 hover:border-white/25 hover:bg-slate-800/60'
                                }`}
                              >
                                <div>
                                  <div className={`h-24 rounded-xl ${wp.previewBg} shadow-inner flex items-center justify-center relative overflow-hidden border border-white/10`}>
                                    {isSelected && (
                                      <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-md text-white text-[10px] font-bold border border-white/30 flex items-center gap-1">
                                        <Check className="w-3 h-3 text-emerald-400" /> Đang dùng
                                      </span>
                                    )}
                                  </div>
                                  <h4 className="font-bold text-xs text-white mt-2.5">{wp.name}</h4>
                                  <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{wp.subtitle}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleSelectWallpaper(wp.id); }}
                                  className={`mt-3 w-full py-1.5 rounded-xl text-xs font-semibold transition ${
                                    isSelected
                                      ? 'bg-sky-500 text-white shadow-sm'
                                      : 'bg-white/5 hover:bg-white/15 text-slate-300'
                                  }`}
                                >
                                  {isSelected ? 'Đang chọn' : 'Áp dụng hình nền'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Tab Độ sáng */}
                    {settingsTab === 'display' && (
                      <div className="max-w-md space-y-5">
                        <div>
                          <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <Sun className="w-4 h-4 text-amber-400" />
                            Độ sáng màn hình ảo
                          </h3>
                          <p className="text-xs text-slate-400 mt-1">
                            Điều chỉnh cường độ ánh sáng của không gian Desktop OS cho phù hợp môi trường làm việc.
                          </p>
                        </div>

                        <div className="p-4 rounded-2xl bg-slate-950/60 border border-white/10 space-y-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-300 font-medium">Mức sáng hiện tại</span>
                            <span className="font-mono font-bold text-sky-400">{screenBrightness}%</span>
                          </div>
                          <input
                            type="range"
                            min="50"
                            max="130"
                            value={screenBrightness}
                            onChange={(e) => handleBrightnessChange(Number(e.target.value))}
                            className="w-full accent-sky-400 cursor-pointer"
                          />
                          <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                            <span>50% (Dịu tối)</span>
                            <span>100% (Chuẩn)</span>
                            <span>130% (Rực rỡ)</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleBrightnessChange(75)}
                            className="flex-1 py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium transition"
                          >
                            🌙 Chế độ ban đêm (75%)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleBrightnessChange(100)}
                            className="flex-1 py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium transition"
                          >
                            ☀️ Tiêu chuẩn (100%)
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Tab Giới thiệu */}
                    {settingsTab === 'about' && (
                      <div className="max-w-md text-center py-4 space-y-4">
                        <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-slate-800 via-slate-900 to-black border border-white/20 mx-auto flex items-center justify-center shadow-xl shadow-sky-500/10">
                          <img src="/logo.png" alt="Fermat" className="w-8 h-8 object-contain brightness-0 invert select-none" />
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-white">FermatOS Workstation</h3>
                          <p className="text-xs text-slate-400 mt-0.5">Phiên bản ảo hoá FermatOS 2.0 (Fermat Tech Edition)</p>
                        </div>

                        <div className="p-4 rounded-2xl bg-slate-950/60 border border-white/10 text-left space-y-2 text-xs">
                          <div className="flex justify-between py-1 border-b border-white/5">
                            <span className="text-slate-400">Bộ vi xử lý:</span>
                            <span className="font-semibold text-white">Fermat M3 Neural Engine (8-core)</span>
                          </div>
                          <div className="flex justify-between py-1 border-b border-white/5">
                            <span className="text-slate-400">Bộ nhớ RAM:</span>
                            <span className="font-semibold text-white">8 GB Unified RAM</span>
                          </div>
                          <div className="flex justify-between py-1 border-b border-white/5">
                            <span className="text-slate-400">Ổ đĩa lưu trữ:</span>
                            <span className="font-semibold text-white">50 GB Cloud NVMe SSD</span>
                          </div>
                          <div className="flex justify-between py-1">
                            <span className="text-slate-400">Tăng tốc 3D:</span>
                            <span className="font-semibold text-emerald-400">WebGL 2.0 / Three.js Kích hoạt</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* CỬA SỔ 7: LAUNCHPAD (TẤT CẢ ỨNG DỤNG & PHÂN HỆ) */}
            {windows.apps.isOpen && !windows.apps.isMinimized && (
              <div
                onMouseDownCapture={() => focusWindow('apps')}
                style={{ zIndex: windows.apps.zIndex }}
                className="absolute inset-2 bg-slate-900/95 border-2 border-white/10 rounded-2xl shadow-2xl backdrop-blur-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
              >
                {/* FermatOS Window Titlebar */}
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/80 border-b border-white/10 text-xs select-none">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); closeWindow('apps'); }}
                      className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Đóng (Close)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">×</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleMinimize('apps'); }}
                      className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Thu nhỏ (Minimize)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">−</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); focusWindow('apps'); }}
                      className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Phóng to / Lấy nét (Zoom)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">+</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 font-bold tracking-wide text-slate-200">
                    <LayoutGrid className="w-4 h-4 text-emerald-400" />
                    <span>LAUNCHPAD // TẤT CẢ ỨNG DỤNG & PHÂN HỆ FERMAT WORKSPACE</span>
                  </div>
                  <div className="w-12" />
                </div>

                {/* Launchpad component 5 khối phòng ban */}
                <FermatOSLaunchpad
                  searchQuery={searchModuleQuery}
                  onSearchChange={setSearchModuleQuery}
                  onOpenModule={handleOpenModule}
                />
              </div>
            )}

            {/* CỬA SỔ 8: FERMAT SAFARI (TRÌNH DUYỆT PHÂN HỆ) */}
            {windows.browser.isOpen && !windows.browser.isMinimized && (
              <div
                onMouseDownCapture={() => focusWindow('browser')}
                style={{ zIndex: windows.browser.zIndex }}
                className="absolute inset-2 bg-slate-900/95 border-2 border-white/10 rounded-2xl shadow-2xl backdrop-blur-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
              >
                {/* FermatOS Window Titlebar */}
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/80 border-b border-white/10 text-xs select-none">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); closeWindow('browser'); }}
                      className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Đóng (Close)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">×</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleMinimize('browser'); }}
                      className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Thu nhỏ (Minimize)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">−</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); focusWindow('browser'); }}
                      className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer"
                      title="Phóng to / Lấy nét (Zoom)"
                    >
                      <span className="opacity-0 group-hover:opacity-100">+</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 font-bold tracking-wide text-slate-200">
                    <Globe className="w-4 h-4 text-sky-400" />
                    <span>FERMAT SAFARI // {browserTitle.toUpperCase()}</span>
                  </div>
                  <div className="w-12" />
                </div>

                {/* FermatOSSafari Browser Viewport */}
                <FermatOSSafari
                  url={browserUrl}
                  title={browserTitle}
                  canGoBack={browserHistIdx > 0}
                  canGoForward={browserHistIdx < browserHistory.length - 1}
                  onBack={handleSafariBack}
                  onForward={handleSafariForward}
                  onReload={() => setSafariReloadKey((k) => k + 1)}
                  onBackToLaunchpad={() => focusWindow('apps')}
                  reloadKey={safariReloadKey}
                />
              </div>
            )}

            {/* CỬA SỔ 9: SỔ KẾ TOÁN & DÒNG TIỀN */}
            {windows.finance.isOpen && !windows.finance.isMinimized && (
              <div
                onMouseDownCapture={() => focusWindow('finance')}
                style={{ zIndex: windows.finance.zIndex }}
                className="absolute inset-2 bg-slate-900/95 border-2 border-white/10 rounded-2xl shadow-2xl backdrop-blur-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
              >
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/80 border-b border-white/10 text-xs select-none">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={(e) => { e.stopPropagation(); closeWindow('finance'); }} className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer" title="Đóng"><span className="opacity-0 group-hover:opacity-100">×</span></button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleMinimize('finance'); }} className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer" title="Thu nhỏ"><span className="opacity-0 group-hover:opacity-100">−</span></button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); focusWindow('finance'); }} className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer" title="Phóng to"><span className="opacity-0 group-hover:opacity-100">+</span></button>
                  </div>
                  <div className="flex items-center gap-2 font-bold tracking-wide text-slate-200">
                    <Wallet className="w-4 h-4 text-emerald-400" />
                    <span>SỔ KẾ TOÁN & DÒNG TIỀN ĐIỆN TỬ</span>
                  </div>
                  <div className="w-12" />
                </div>
                <FermatOSFinanceWindow idToken={idToken || undefined} onOpenBrowser={openModuleInBrowser} />
              </div>
            )}

            {/* CỬA SỔ 10: WAR-ROOM TRUYỀN THÔNG & ĐA KÊNH */}
            {windows.social.isOpen && !windows.social.isMinimized && (
              <div
                onMouseDownCapture={() => focusWindow('social')}
                style={{ zIndex: windows.social.zIndex }}
                className="absolute inset-2 bg-slate-900/95 border-2 border-white/10 rounded-2xl shadow-2xl backdrop-blur-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
              >
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/80 border-b border-white/10 text-xs select-none">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={(e) => { e.stopPropagation(); closeWindow('social'); }} className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer" title="Đóng"><span className="opacity-0 group-hover:opacity-100">×</span></button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleMinimize('social'); }} className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer" title="Thu nhỏ"><span className="opacity-0 group-hover:opacity-100">−</span></button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); focusWindow('social'); }} className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer" title="Phóng to"><span className="opacity-0 group-hover:opacity-100">+</span></button>
                  </div>
                  <div className="flex items-center gap-2 font-bold tracking-wide text-slate-200">
                    <Share2 className="w-4 h-4 text-rose-400" />
                    <span>WAR-ROOM TRUYỀN THÔNG & ĐA KÊNH</span>
                  </div>
                  <div className="w-12" />
                </div>
                <FermatOSSocialWindow idToken={idToken || undefined} onOpenBrowser={openModuleInBrowser} />
              </div>
            )}

            {/* CỬA SỔ 11: CÔNG NGHỆ & ĐÀO TẠO SỐ */}
            {windows.training.isOpen && !windows.training.isMinimized && (
              <div
                onMouseDownCapture={() => focusWindow('training')}
                style={{ zIndex: windows.training.zIndex }}
                className="absolute inset-2 bg-slate-900/95 border-2 border-white/10 rounded-2xl shadow-2xl backdrop-blur-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
              >
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/80 border-b border-white/10 text-xs select-none">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={(e) => { e.stopPropagation(); closeWindow('training'); }} className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer" title="Đóng"><span className="opacity-0 group-hover:opacity-100">×</span></button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleMinimize('training'); }} className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer" title="Thu nhỏ"><span className="opacity-0 group-hover:opacity-100">−</span></button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); focusWindow('training'); }} className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer" title="Phóng to"><span className="opacity-0 group-hover:opacity-100">+</span></button>
                  </div>
                  <div className="flex items-center gap-2 font-bold tracking-wide text-slate-200">
                    <Cpu className="w-4 h-4 text-indigo-400" />
                    <span>CÔNG NGHỆ & ĐÀO TẠO SỐ</span>
                  </div>
                  <div className="w-12" />
                </div>
                <FermatOSTrainingWindow idToken={idToken || undefined} onOpenBrowser={openModuleInBrowser} />
              </div>
            )}

            {/* CỬA SỔ 12: TRẠM CHẤM CÔNG & CÔNG CA */}
            {windows.attendance.isOpen && !windows.attendance.isMinimized && (
              <div
                onMouseDownCapture={() => focusWindow('attendance')}
                style={{ zIndex: windows.attendance.zIndex }}
                className="absolute inset-2 bg-slate-900/95 border-2 border-white/10 rounded-2xl shadow-2xl backdrop-blur-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
              >
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/80 border-b border-white/10 text-xs select-none">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={(e) => { e.stopPropagation(); closeWindow('attendance'); }} className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer" title="Đóng"><span className="opacity-0 group-hover:opacity-100">×</span></button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleMinimize('attendance'); }} className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer" title="Thu nhỏ"><span className="opacity-0 group-hover:opacity-100">−</span></button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); focusWindow('attendance'); }} className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29] hover:opacity-80 flex items-center justify-center text-[7px] text-black/60 group font-bold transition cursor-pointer" title="Phóng to"><span className="opacity-0 group-hover:opacity-100">+</span></button>
                  </div>
                  <div className="flex items-center gap-2 font-bold tracking-wide text-slate-200">
                    <Clock className="w-4 h-4 text-sky-400" />
                    <span>TRẠM CHẤM CÔNG & CÔNG CA</span>
                  </div>
                  <div className="w-12" />
                </div>
                <FermatOSAttendanceWindow
                  idToken={idToken || undefined}
                  currentUserName={currentUser?.name || currentUser?.email}
                  onOpenBrowser={openModuleInBrowser}
                />
              </div>
            )}

          </div>
        </div>

        {/* FermatOS Floating Frosted Glass Dock */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-end gap-2.5 px-4 py-2 rounded-2xl bg-slate-950/70 backdrop-blur-2xl border border-white/20 shadow-2xl">
          {Object.values(windows).map(w => {
            const Icon = w.icon;
            const isOpen = w.isOpen;
            const isTop = activeWindow === w.id && !w.isMinimized;
            return (
              <div key={w.id} className="relative flex flex-col items-center group">
                <button
                  type="button"
                  onClick={() => {
                    if (isTop) {
                      toggleMinimize(w.id);
                    } else {
                      focusWindow(w.id);
                    }
                  }}
                  className={`w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg transition-all hover:scale-120 hover:-translate-y-2 cursor-pointer ${
                    isTop
                      ? 'bg-gradient-to-tr from-sky-600 to-indigo-600 text-white ring-2 ring-white/30'
                      : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-white/10'
                  }`}
                  title={w.title}
                >
                  <Icon className="w-5 h-5" />
                </button>
                {isOpen && (
                  <span className="w-1 h-1 rounded-full bg-white/90 shadow-sm mt-1" />
                )}
                <div className="absolute -top-8 px-2 py-0.5 rounded-md bg-slate-900 border border-white/10 text-[10px] text-white opacity-0 group-hover:opacity-100 transition pointer-events-none whitespace-nowrap shadow-lg">
                  {w.title.split('·')[0].split(':')[0].trim()}
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </div>,
    document.body
  );
}
