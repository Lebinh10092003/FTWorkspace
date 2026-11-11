import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Box,
  Layers,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Users,
  Monitor,
  Bot,
  ShieldAlert,
  LayoutGrid,
  EyeOff,
  Eye,
  ExternalLink,
  X,
  ChevronRight,
  Search,
  Volume2,
  VolumeX,
  Compass,
  Calendar,
  MessageSquare,
  Cpu,
  Plus,
  Check
} from 'lucide-react';
import VirtualDesktopOS from './VirtualDesktopOS';
import OfficeSmartphoneGuide from './OfficeSmartphoneGuide';
import WorkspaceNotifications from '../WorkspaceNotifications';
import AccountMenu from '../AccountMenu';
import CommandPalette from '../layout/CommandPalette';
import { useOfficeHeartbeat } from './useOfficeHeartbeat';
import { useOfficeAmbience } from './useOfficeAmbience';

export function checkWebGLSupport(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

export type OfficeWorkspaceProps = {
  idToken: string | null;
  isDark?: boolean;
  canAccessView: (mode: any) => boolean;
  onNavigate: (mode: any, tab?: string) => void;
  onBackTo2D: () => void;
  userName?: string | null;
  userRole?: string | null;
  photoURL?: string | null;
  isGuest?: boolean;
  onAccountClick?: () => void;
  onLogout?: () => void;
  onLogin?: () => void;
  onOpenCommandPalette?: () => void;
};

const OFFICE_MODULE_ITEMS: { id: string; label: string; mode: string }[] = [
  { id: 'workspace', label: 'Trang chủ', mode: 'workspace' },
  { id: 'work-schedule', label: 'Hành chính · Lịch làm việc', mode: 'work-schedule' },
  { id: 'attendance', label: 'Công ca', mode: 'attendance' },
  { id: 'weekly-report', label: 'Báo cáo tuần', mode: 'weekly-report' },
  { id: 'examination', label: 'Khảo thí', mode: 'examination' },
  { id: 'digital-training', label: 'Công nghệ & Đào tạo số', mode: 'digital-training' },
  { id: 'finance-report', label: 'Tài chính, kế toán', mode: 'finance-report' },
  { id: 'social-dashboard', label: 'Truyền thông', mode: 'social-dashboard' },
  { id: 'communication-tools', label: 'Bộ công cụ', mode: 'communication-tools' },
  { id: 'account-management', label: 'Quản lý nhân viên', mode: 'account-management' },
  { id: 'resources', label: 'Tài nguyên', mode: 'resources' },
];


// Khung 3D giữ sống giữa các lần mở: iframe nằm trong một khối cố định gắn vào body, khi rời trang chỉ ẩn đi
// (không hủy) nên quay lại không phải khởi tạo lại cảnh 3D.
const ROOM_LABELS: Record<string, string> = { director: 'Phòng giám đốc', tech: 'Phòng công nghệ', exam: 'Phòng khảo thí', accounting: 'Phòng kế toán', common: 'Phòng chung' };

let frameHost: HTMLDivElement | null = null;
let frameEl: HTMLIFrameElement | null = null;
let frameReady = false;

function ensureOfficeFrame(): HTMLIFrameElement {
  if (frameEl && frameHost && document.body.contains(frameHost)) return frameEl;
  frameHost = document.createElement('div');
  frameHost.style.cssText = 'position:fixed;display:none;z-index:0;left:0;top:0;width:0;height:0;overflow:hidden;background:#020617';
  frameEl = document.createElement('iframe');
  frameEl.src = '/office3d/vi/?embed=1&debug=1';
  frameEl.title = 'Văn phòng 3D FermatTech';
  frameEl.allow = 'fullscreen';
  frameEl.style.cssText = 'width:100%;height:100%;border:0;display:block';
  frameReady = false;
  frameHost.appendChild(frameEl);
  document.body.appendChild(frameHost);
  return frameEl;
}

function placeOfficeFrame(slot: HTMLElement | null) {
  if (!frameHost) return;
  if (!slot) { frameHost.style.display = 'none'; return; }
  const r = slot.getBoundingClientRect();
  frameHost.style.display = 'block';
  frameHost.style.left = `${r.left}px`;
  frameHost.style.top = `${r.top}px`;
  frameHost.style.width = `${r.width}px`;
  frameHost.style.height = `${r.height}px`;
}

export default function OfficeWorkspace({
  idToken,
  isDark = false,
  canAccessView,
  onNavigate,
  onBackTo2D,
  userName = 'Thành viên',
  userRole = 'EMPLOYEE',
  photoURL = null,
  isGuest = false,
  onAccountClick,
  onLogout,
  onLogin,
  onOpenCommandPalette,
}: OfficeWorkspaceProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [boxH, setBoxH] = useState<number | undefined>(undefined);
  const [showList, setShowList] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [roster, setRoster] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [isDesktopOSOpen, setIsDesktopOSOpen] = useState(false);
  const [activeInSceneModal, setActiveInSceneModal] = useState<string | null>(null);
  const [inSceneLoading, setInSceneLoading] = useState(false);
  const [inSceneScheduleItems, setInSceneScheduleItems] = useState<any[]>([]);
  const [inSceneExamPapers, setInSceneExamPapers] = useState<any[]>([]);
  const [inSceneFilter, setInSceneFilter] = useState<'all' | 'doing' | 'done'>('all');
  const [showAppsDrawer, setShowAppsDrawer] = useState(false);
  const [hudCollapsed, setHudCollapsed] = useState(false);
  const [showTips, setShowTips] = useState(true);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [selectedColleague, setSelectedColleague] = useState<any>(null);
  const [botState, setBotState] = useState<{
    state: string;
    botName?: string;
    targetDesk?: number;
    queueLength: number;
  }>({ state: 'IDLE', queueLength: 0 });
  const [patrolState, setPatrolState] = useState<{
    active: boolean;
    phase: string;
    message?: string;
  }>({ active: false, phase: 'IDLE' });
  const [activeCameraView, setActiveCameraView] = useState<'home' | 'desks' | 'meeting' | 'server'>('home');
  const [isWalkModeActive, setIsWalkModeActive] = useState<boolean>(false);
  const [inSceneNewTaskTitle, setInSceneNewTaskTitle] = useState<string>('');
  const [inSceneCreatingTask, setInSceneCreatingTask] = useState<boolean>(false);
  const [osInitialApp, setOsInitialApp] = useState<'assistant' | 'exam' | 'reports' | 'docs' | 'terminal' | 'game' | undefined>(undefined);
  const [osInitialPrompt, setOsInitialPrompt] = useState<string | undefined>(undefined);
  const [osInitialColleague, setOsInitialColleague] = useState<{ name: string; role?: string; department?: string; email?: string } | null>(null);

  const { isPlaying: isAmbiencePlaying, toggleAmbience } = useOfficeAmbience();

  const webglSupported = useMemo(() => checkWebGLSupport(), []);

  // Kích hoạt theo dõi nhịp hiện diện và tự động chuyển trạng thái làm việc / rảnh (Việc 033)
  useOfficeHeartbeat(idToken, Boolean(idToken));

  // Danh sách các phân hệ mà người dùng hiện tại được phép truy cập
  const accessibleModules = useMemo(() => {
    return OFFICE_MODULE_ITEMS
      .filter(item => canAccessView(item.mode))
      .map(item => ({ id: item.id, label: item.label }));
  }, [canAccessView]);



  // Khung 3D lấp đầy đúng phần còn lại của màn hình (không để dải trắng thừa ở dưới)
  useLayoutEffect(() => {
    const fit = () => {
      const el = boxRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const bottomGap = window.innerWidth < 1024 ? 64 : 0; // thanh điều hướng dưới trên điện thoại
      setBoxH(Math.max(420, Math.floor(window.innerHeight - top - bottomGap)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [webglSupported]);

  // Gắn khung 3D giữ sống vào vị trí của trang này; rời trang chỉ ẩn đi
  useLayoutEffect(() => {
    if (!webglSupported) return;
    iframeRef.current = ensureOfficeFrame();
    const slot = slotRef.current;
    let raf = 0;
    const update = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => placeOfficeFrame(slotRef.current)); };
    placeOfficeFrame(slot);
    const ro = typeof ResizeObserver !== 'undefined' && slot ? new ResizeObserver(update) : null;
    if (ro && slot) ro.observe(slot);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    if (frameReady) {
      setIsReady(true);
      setLoading(false);
      fetchRoster().then(list => sendInitToIframe(list));
    }
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      placeOfficeFrame(null);
    };
  }, [webglSupported]);

  // Tải danh sách nhân sự an toàn từ máy chủ
  const fetchRoster = async () => {
    if (!idToken) return [];
    try {
      setRefreshing(true);
      const res = await fetch('/api/office/roster/', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) return [];
      const data = await res.json().catch(() => ({}));
      const raw = Array.isArray(data.roster) ? data.roster : [];
      // Người đang mở trang này chắc chắn đang online (tránh nhân vật rời văn phòng trong lúc chờ nhịp đầu tiên)
      const list = raw.map((u: any) => (u?.is_me ? { ...u, online: true, status: u.status === 'idle' ? 'idle' : 'working' } : u));
      setRoster(list);
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          { type: "ft-office:roster", roster: list },
          window.location.origin
        );
      }
      return list;
    } catch {
      return [];
    } finally {
      setRefreshing(false);
    }
  };

  // Tải ban đầu
  useEffect(() => {
    fetchRoster();
  }, [idToken]);

  // Định kỳ cập nhật roster mỗi 30s khi tab đang hiển thị
  useEffect(() => {
    if (!idToken) return;

    const interval = setInterval(async () => {
      if (document.hidden) return;
      const freshList = await fetchRoster();
      if (iframeRef.current?.contentWindow && isReady) {
        iframeRef.current.contentWindow.postMessage(
          { type: 'ft-office:roster', roster: freshList },
          window.location.origin
        );
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [idToken, isReady]);

  // Gửi init ngay khi nhận thông điệp ready
  const sendInitToIframe = (freshRoster?: any[]) => {
    if (!iframeRef.current?.contentWindow) return;
    const currentTheme = isDark ? 'dark' : 'light';
    const rosterData = freshRoster || roster;

    iframeRef.current.contentWindow.postMessage(
      {
        type: 'ft-office:init',
        theme: currentTheme,
        modules: accessibleModules,
        roster: rosterData,
      },
      window.location.origin
    );
  };

  // Điều khiển các sự kiện nâng cao trong 3D
  const handleCallBot = () => {
    if (!iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { type: 'ft-office:callBot' },
      window.location.origin
    );
  };

  const handleReleaseBot = () => {
    if (!iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { type: 'ft-office:releaseBot' },
      window.location.origin
    );
  };

  const handleTriggerPatrol = () => {
    if (!iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { type: 'ft-office:triggerPatrol' },
      window.location.origin
    );
  };

  const handleFocus3DZone = (zone: string) => {
    setActiveCameraView(zone as any);
    if (!iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { type: 'ft-office:switchView', view: zone },
      window.location.origin
    );
  };

  const handleToggleWalkMode = () => {
    if (!iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { type: 'ft-office:toggleWalk' },
      window.location.origin
    );
  };

  const isInSceneTaskDone = (status?: string) => {
    const s = (status || '').toLowerCase();
    return s === 'completed' || s === 'reviewed' || s === 'done';
  };

  const handleInSceneCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inSceneNewTaskTitle.trim()) return;
    setInSceneCreatingTask(true);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    try {
      const res = await fetch('/api/work-schedule/items', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          title: inSceneNewTaskTitle.trim(),
          date: new Date().toISOString().slice(0, 10),
          priority: 'medium',
          status: 'todo',
        }),
      });
      if (res.ok) {
        setInSceneNewTaskTitle('');
        const listRes = await fetch('/api/work-schedule/items', { headers, credentials: 'include' });
        if (listRes.ok) {
          const data = await listRes.json();
          setInSceneScheduleItems(Array.isArray(data?.items) ? data.items : []);
        }
      }
    } catch {
      // bỏ qua lỗi
    } finally {
      setInSceneCreatingTask(false);
    }
  };

  const handleInSceneToggleTask = async (item: any) => {
    const done = isInSceneTaskDone(item.status);
    const nextStatus = done ? 'todo' : 'completed';
    setInSceneScheduleItems(prev => prev.map(it => (it.id === item.id ? { ...it, status: nextStatus } : it)));
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    try {
      await fetch(`/api/work-schedule/items/${item.id}`, {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify({ status: nextStatus }),
      });
    } catch {
      // rollback
    }
  };

  const handleOpenSearch = () => {
    if (onOpenCommandPalette) {
      onOpenCommandPalette();
    } else {
      setIsCommandPaletteOpen(true);
    }
  };

  // Cầu nối postMessage
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // 1. Kiểm tra Origin
      if (event.origin !== window.location.origin) return;

      // 2. Kiểm tra Source
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;

      const data = event.data;
      if (!data || typeof data !== 'object') return;

      // Nhận ready
      if (data.type === 'ft-office:ready') {
        frameReady = true;
        setIsReady(true);
        setLoading(false);
        // Gửi thông điệp init
        fetchRoster().then(list => sendInitToIframe(list));
      }

      // Nhận openDesktopOS (khi click vào Máy tính của tôi trên bàn 3D)
      if (data.type === 'ft-office:openDesktopOS') {
        setIsDesktopOSOpen(true);
      }

      // Nhận selectWorker khi click vào nhân sự trong không gian 3D
      if (data.type === 'ft-office:selectWorker' && data.worker) {
        setSelectedColleague(data.worker);
      }

      // Nhận botState
      if (data.type === 'ft-office:botState') {
        setBotState(prev => ({
          ...prev,
          state: data.state || prev.state,
          botName: data.botName || prev.botName,
          targetDesk: data.targetDesk ?? prev.targetDesk,
          queueLength: data.queueLength ?? prev.queueLength,
        }));
      }

      // Nhận queueUpdate
      if (data.type === 'ft-office:queueUpdate') {
        setBotState(prev => ({
          ...prev,
          queueLength: data.queueLength ?? prev.queueLength,
        }));
      }

      // Nhận patrolState
      if (data.type === 'ft-office:patrolState') {
        setPatrolState({
          active: Boolean(data.active),
          phase: data.phase || 'IDLE',
          message: data.message,
        });
      }

      // Nhận walkState (First-Person Walk Mode)
      if (data.type === 'ft-office:walkState') {
        setIsWalkModeActive(Boolean(data.active));
      }

      // Nhận openModule
      if (data.type === 'ft-office:openModule') {
        const moduleId = String(data.module || '');
        if (moduleId === 'desktop' || moduleId === 'computer') {
          setIsDesktopOSOpen(true);
        } else {
          setActiveInSceneModal(moduleId);
        }
      }

      // Nhận error
      if (data.type === 'ft-office:error') {
        setWebglError(data.message || 'Lỗi dựng hình không gian 3D.');
        setLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [accessibleModules, roster, isDark, canAccessView, onNavigate]);

  // Fetch dữ liệu thực tế cho In-Scene Modal khi mở trong 3D
  useEffect(() => {
    if (!activeInSceneModal) return;
    let cancelled = false;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

    if (activeInSceneModal === 'work-schedule' || activeInSceneModal === 'weekly-report') {
      setInSceneLoading(true);
      fetch('/api/work-schedule/items', { headers, credentials: 'include' })
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (cancelled) return;
          setInSceneScheduleItems(Array.isArray(data?.items) ? data.items : []);
          setInSceneLoading(false);
        })
        .catch(() => {
          if (!cancelled) setInSceneLoading(false);
        });
    } else if (activeInSceneModal === 'examination') {
      setInSceneLoading(true);
      fetch('/api/examination/papers', { headers, credentials: 'include' })
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (cancelled) return;
          setInSceneExamPapers(Array.isArray(data?.items) ? data.items : []);
          setInSceneLoading(false);
        })
        .catch(() => {
          if (!cancelled) setInSceneLoading(false);
        });
    }
    return () => { cancelled = true; };
  }, [activeInSceneModal, idToken]);

  // Nếu iframe load xong nhưng không gửi ready trong 12s, tắt spinner
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (loading) setLoading(false);
    }, 12000);
    return () => clearTimeout(timeout);
  }, [loading]);

  const onlineCount = useMemo(() => {
    return roster.filter(u => u.online).length;
  }, [roster]);

  const workingCount = useMemo(() => {
    return roster.filter(u => u.online && u.status !== 'idle').length;
  }, [roster]);

  const idleCount = useMemo(() => {
    return roster.filter(u => u.online && u.status === 'idle').length;
  }, [roster]);

  // Trường hợp không hỗ trợ WebGL
  if (!webglSupported || webglError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[100vh] p-6 text-center bg-slate-950 text-white">
        <div className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-slate-900 p-6 shadow-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-900/50 text-amber-300">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-bold text-slate-100">
            Không thể khởi tạo Văn phòng 3D
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            {webglError || 'Trình duyệt hoặc thiết bị hiện tại không hỗ trợ tăng tốc đồ họa 3D (WebGL). Bạn có thể chuyển sang giao diện truyền thống 2D.'}
          </p>
          <button
            type="button"
            onClick={onBackTo2D}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#D97757] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#c46849] transition cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Dùng giao diện 2D</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="office-3d-shell fixed inset-0 w-screen h-screen bg-transparent text-white overflow-hidden pointer-events-none z-20">
      {/* 1. THANH ĐIỀU HƯỚNG TRÊN CAO (TOP NAVIGATION BAR - GIỮ ĐẦY ĐỦ CHỨC NĂNG CẦN THIẾT) */}
      <header className="pointer-events-auto fixed top-0 inset-x-0 h-14 z-30 bg-[#0B192C]/95 backdrop-blur-md border-b border-slate-800 px-3 sm:px-5 flex items-center justify-between select-none shadow-lg">
        
        {/* Cụm Trái: Brand + Bộ chuyển đổi 2D / 3D nổi bật + Phân hệ */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Logo FermatTech */}
          <div className="flex items-center gap-2 font-bold text-white text-sm">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#0B72CE] to-indigo-500 flex items-center justify-center shadow-md shadow-blue-500/20">
              <Box className="w-4 h-4 text-white" />
            </div>
            <div className="hidden xl:block leading-tight">
              <span className="text-[10px] text-blue-400 font-extrabold uppercase tracking-wider block">FermatTech</span>
              <span className="text-xs font-bold text-slate-100">Văn phòng 3D</span>
            </div>
          </div>

          <div className="h-5 w-[1px] bg-slate-800 hidden sm:block" />

          {/* BỘ CHUYỂN ĐỔI 2D / 3D RÕ RÀNG */}
          <div className="flex items-center p-0.5 rounded-xl bg-slate-900 border border-slate-700/80 shadow-inner">
            <button
              type="button"
              onClick={onBackTo2D}
              className="flex items-center gap-1.5 rounded-lg bg-[#0B72CE] hover:bg-[#095ca7] px-2.5 sm:px-3 py-1.5 text-xs font-bold text-white shadow transition cursor-pointer"
              title="Quay lại giao diện phẳng 2D tiêu chuẩn"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Giao diện 2D</span>
            </button>
            <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-500/30">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="hidden sm:inline">Văn phòng 3D</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowAppsDrawer(v => !v);
              setShowList(false);
            }}
            className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-bold transition cursor-pointer border ${
              showAppsDrawer
                ? 'bg-[#D97757] text-white border-[#D97757]'
                : 'bg-slate-900/90 hover:bg-slate-800 text-slate-100 border-slate-700/80'
            }`}
            title="Mở nhanh tất cả các phân hệ Workspace"
          >
            <LayoutGrid className="h-3.5 w-3.5 text-[#D97757]" style={showAppsDrawer ? { color: '#fff' } : undefined} />
            <span className="hidden sm:inline">Phân hệ</span>
          </button>
        </div>

        {/* Cụm Giữa: Các công cụ tương tác 3D (Máy tính OS, Robot, Sếp, Nhân sự) */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {!hudCollapsed && (
            <>
              <button
                type="button"
                onClick={() => setIsDesktopOSOpen(true)}
                className="flex items-center gap-1.5 rounded-xl bg-[#D97757] hover:bg-[#c46849] px-2.5 sm:px-3 py-1.5 text-xs font-bold text-white shadow-sm transition cursor-pointer"
                title="Mở hệ điều hành FermatOS trên bàn làm việc 3D"
              >
                <Monitor className="h-3.5 w-3.5" />
                <span className="hidden md:inline">FermatOS</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (botState.state === 'ARRIVED') {
                    handleReleaseBot();
                  } else {
                    handleCallBot();
                  }
                }}
                disabled={botState.state === 'MOVING'}
                className={`hidden sm:flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  botState.state === 'ARRIVED'
                    ? 'border-emerald-500/60 bg-emerald-950/70 text-emerald-300 hover:bg-emerald-900/70'
                    : botState.state === 'MOVING'
                    ? 'border-amber-500/60 bg-amber-950/70 text-amber-300 animate-pulse'
                    : 'border-cyan-500/40 bg-slate-900/90 text-cyan-300 hover:bg-slate-800'
                }`}
                title={
                  botState.state === 'ARRIVED'
                    ? 'Robot đang tại bàn (Bấm để cho robot về trạm)'
                    : 'Gọi Robot AI di chuyển đến bàn làm việc của bạn'
                }
              >
                <Bot className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">
                  {botState.state === 'ARRIVED'
                    ? 'Robot tại bàn'
                    : botState.state === 'MOVING'
                    ? 'Đang tới...'
                    : 'Gọi Robot'}
                </span>
              </button>

              <button
                type="button"
                onClick={toggleAmbience}
                className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  isAmbiencePlaying
                    ? 'border-emerald-500/60 bg-emerald-950/70 text-emerald-300 shadow-sm'
                    : 'border-slate-700/80 bg-slate-900/90 text-slate-300 hover:bg-slate-800'
                }`}
                title={isAmbiencePlaying ? 'Đang phát âm thanh văn phòng (Click để tắt)' : 'Bật âm thanh môi trường văn phòng'}
              >
                {isAmbiencePlaying ? (
                  <>
                    <Volume2 className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
                    <span className="hidden sm:inline">Âm thanh</span>
                  </>
                ) : (
                  <>
                    <VolumeX className="h-3.5 w-3.5 text-slate-400" />
                    <span className="hidden sm:inline">Âm thanh</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowList(v => !v);
                  setShowAppsDrawer(false);
                }}
                className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition cursor-pointer ${
                  showList
                    ? 'bg-blue-600 text-white border-blue-500'
                    : 'bg-slate-900/90 border-slate-700/80 text-slate-200 hover:bg-slate-800'
                }`}
                title="Xem danh sách nhân sự đang làm / rảnh"
                aria-expanded={showList}
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>
                  <strong className="text-emerald-400 font-bold">{workingCount}</strong>
                  {idleCount > 0 && (
                    <span className="text-amber-400 font-semibold ml-1">· {idleCount} rảnh</span>
                  )}
                  <span className="hidden lg:inline text-slate-400 ml-1">· Nhân sự</span>
                </span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              setHudCollapsed(v => !v);
              setShowList(false);
              setShowAppsDrawer(false);
            }}
            className="hidden sm:flex rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition items-center justify-center cursor-pointer"
            title={hudCollapsed ? 'Hiện công cụ 3D' : 'Thu gọn nút 3D'}
          >
            {hudCollapsed ? <Eye className="h-3.5 w-3.5 text-[#D97757]" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Cụm Phải: Tìm kiếm (Ctrl+K), Chuông thông báo & Tài khoản cá nhân */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={handleOpenSearch}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white text-xs font-medium transition cursor-pointer"
            title="Tìm kiếm nhanh phân hệ hoặc công việc (Ctrl + K)"
          >
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <span className="hidden lg:inline text-slate-400">Tìm kiếm</span>
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono bg-slate-800 rounded text-slate-400 border border-slate-700">
              Ctrl K
            </kbd>
          </button>

          {/* Chuông thông báo Workspace */}
          <div className="relative">
            <WorkspaceNotifications />
          </div>

          <div className="h-5 w-[1px] bg-slate-800" />

          {/* Menu Tài khoản cá nhân */}
          <AccountMenu
            userName={userName}
            userRole={userRole}
            photoURL={photoURL}
            isGuest={isGuest}
            onAccountClick={onAccountClick || (() => {})}
            onLogout={onLogout}
            onLogin={onLogin}
            variant="avatar"
          />
        </div>
      </header>

      {/* 2. KHUNG CHỨA 3D CANVAS (NẰM NGAY DƯỚI THANH ĐIỀU HƯỚNG TRÊN CAO) */}
      <div
        ref={slotRef}
        className="absolute top-14 bottom-0 inset-x-0 w-full h-[calc(100vh-3.5rem)] pointer-events-none"
      />

      {/* Loading Overlay */}
      {loading && (
        <div className="pointer-events-auto fixed inset-0 top-14 z-50 flex flex-col items-center justify-center bg-slate-950 text-white select-none">
          <div className="relative flex items-center justify-center mb-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#D97757] to-amber-500/80 animate-pulse opacity-30 absolute" />
            <LoaderCircle className="h-10 w-10 animate-spin text-[#D97757] relative z-10" />
          </div>
          <p className="text-base font-bold text-slate-100 tracking-wide">Đang khởi tạo Văn phòng 3D FermatTech...</p>
          <p className="mt-1.5 text-xs text-slate-400 font-mono">Đồng bộ chỗ ngồi & vị trí nhân sự thực tế</p>
        </div>
      )}

      {/* Quick App Launcher Drawer */}
      {showAppsDrawer && (
        <div className="pointer-events-auto absolute left-3 sm:left-5 top-16 z-30 w-80 sm:w-96 max-h-[75vh] overflow-y-auto rounded-2xl border border-slate-700/80 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-[#D97757]" />
              <span className="text-sm font-bold text-slate-100">Phân hệ Workspace</span>
            </div>
            <button
              type="button"
              onClick={() => setShowAppsDrawer(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {OFFICE_MODULE_ITEMS.filter(item => canAccessView(item.mode)).map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setShowAppsDrawer(false);
                  onNavigate(item.mode);
                }}
                className="group flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-800/60 hover:bg-[#D97757]/15 hover:border-[#D97757]/50 px-3 py-2.5 text-left transition cursor-pointer"
              >
                <span className="text-xs font-semibold text-slate-200 group-hover:text-white truncate">
                  {item.label}
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500 group-hover:text-[#D97757]" />
              </button>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
            <span>Hoặc dùng Máy tính bàn 3D</span>
            <button
              type="button"
              onClick={() => {
                setShowAppsDrawer(false);
                setIsDesktopOSOpen(true);
              }}
              className="inline-flex items-center gap-1 font-semibold text-[#D97757] hover:underline cursor-pointer"
            >
              <Monitor className="h-3 w-3" />
              Mở FermatOS
            </button>
          </div>
        </div>
      )}

      {/* Danh sách mọi người trong văn phòng (hỗ trợ Đang làm / Rảnh / Ngoại tuyến) */}
      {showList && (
        <div className="pointer-events-auto absolute right-3 sm:right-24 top-16 z-30 w-80 max-h-[70vh] overflow-y-auto rounded-2xl border border-slate-700/80 bg-slate-900/95 p-3.5 shadow-2xl backdrop-blur-xl">
          <div className="mb-2.5 flex items-center justify-between text-xs font-bold text-slate-200">
            <div>
              <span>Nhân sự văn phòng</span>
              <span className="ml-1.5 text-[11px] font-normal text-slate-400">
                ({onlineCount}/{roster.length} online)
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={async () => {
                  const fresh = await fetchRoster();
                  sendInitToIframe(fresh);
                }}
                disabled={refreshing}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                title="Làm mới danh sách nhân sự"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-[#D97757]' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => setShowList(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                aria-label="Đóng danh sách"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="mb-2 flex items-center gap-3 text-[11px] text-slate-400 pb-2 border-b border-slate-800">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Đang làm ({workingCount})</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> Rảnh ({idleCount})</span>
          </div>
          {[...roster]
            .sort((a, b) => Number(!!b.online) - Number(!!a.online) || String(a.name || '').localeCompare(String(b.name || ''), 'vi'))
            .map((u: any) => (
              <div key={u.id ?? u.name} className="flex items-center gap-2 border-t border-slate-800/80 py-2 text-xs first:border-t-0">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  u.online
                    ? (u.status === 'idle' ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]' : 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]')
                    : 'bg-slate-600'
                }`} />
                <div className="min-w-0 flex-1">
                  <div className={`truncate font-semibold ${u.online ? 'text-slate-100' : 'text-slate-400'}`}>
                    {u.name}
                    {u.is_me ? ' (bạn)' : ''}
                    {u.is_bot ? ' 🤖' : ''}
                  </div>
                  <div className="truncate text-[11px] text-slate-500">
                    {[ROOM_LABELS[u.room] || u.department, u.role].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <span className={`shrink-0 text-[11px] font-medium px-1.5 py-0.5 rounded-md ${
                  u.online
                    ? (u.status === 'idle' ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300')
                    : 'text-slate-500'
                }`}>
                  {u.online ? (u.status === 'idle' ? 'Rảnh' : 'Đang làm') : 'Ngoại tuyến'}
                </span>
              </div>
            ))}
        </div>
      )}

      {/* Tips nổi góc dưới bên trái nhẹ nhàng */}
      {showTips && !loading && (
        <div className="pointer-events-auto absolute bottom-4 left-4 sm:left-5 z-20 hidden sm:flex items-center gap-2 rounded-xl border border-slate-700/60 bg-slate-900/75 px-3 py-1.5 text-[11px] text-slate-300 backdrop-blur-md shadow-lg">
          <Sparkles className="h-3.5 w-3.5 text-[#D97757] shrink-0" />
          <span>Nhấp màn hình máy tính bàn 3D để mở Desktop OS · Kéo chuột xoay góc nhìn</span>
          <button
            type="button"
            onClick={() => setShowTips(false)}
            className="ml-1 rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
            aria-label="Ẩn gợi ý"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* 5. CHIẾC ĐIỆN THOẠI THÔNG MINH GÓC PHẢI DƯỚI (CẨM NANG TRỎ HƯỚNG 2D ➔ 3D) */}
      <OfficeSmartphoneGuide
        onNavigate2D={onBackTo2D}
        onOpenDesktopOS={() => setIsDesktopOSOpen(true)}
        onOpenAppsDrawer={() => setShowAppsDrawer(true)}
        onCallBot={handleCallBot}
        onTriggerPatrol={handleTriggerPatrol}
        onFocus3DZone={handleFocus3DZone}
        onlineCount={onlineCount}
        workingCount={workingCount}
        idleCount={idleCount}
        onOpenRoster={() => setShowList(true)}
        canAccessView={canAccessView}
        onNavigateModule={(mode) => onNavigate(mode)}
      />

      {/* Thẻ thông tin đồng nghiệp khi click trực tiếp trong Văn phòng 3D (Mục 1) */}
      {selectedColleague && (
        <div className="pointer-events-auto fixed top-20 right-4 z-[9500] w-80 rounded-2xl border border-slate-700/90 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-right-4 duration-150">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-[#D97757] to-amber-500 flex items-center justify-center text-white font-bold text-base shadow-md">
                {(selectedColleague.name || '?').slice(0, 1).toUpperCase()}
              </div>
              <div>
                <h4 className="text-sm font-bold text-white leading-tight">
                  {selectedColleague.name || 'Nhân sự FermatTech'}
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedColleague.role || 'Thành viên'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedColleague(null)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-3 pt-3 border-t border-slate-800 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Trạng thái:</span>
              {(selectedColleague.isIdle || selectedColleague.status === 'idle') ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 font-semibold text-amber-400 border border-amber-500/30">
                  💤 Đang nghỉ ngơi (Idle)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-semibold text-emerald-400 border border-emerald-500/30">
                  🟢 Đang làm việc
                </span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Khu vực:</span>
              <span className="font-medium text-slate-200">{selectedColleague.room || selectedColleague.department || 'Văn phòng trung tâm'}</span>
            </div>
          </div>

          <div className="mt-3.5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                if (iframeRef.current?.contentWindow) {
                  iframeRef.current.contentWindow.postMessage(
                    {
                      type: 'ft-office:focusWorker',
                      name: selectedColleague.name,
                      userId: selectedColleague.user_id,
                    },
                    window.location.origin
                  );
                }
                setActiveCameraView('desks');
                setSelectedColleague(null);
              }}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 py-2 px-2.5 text-xs font-semibold text-slate-200 transition cursor-pointer"
            >
              <Compass className="w-3.5 h-3.5 text-blue-400" />
              <span>Lia camera</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const colleague = selectedColleague;
                setSelectedColleague(null);
                setOsInitialApp('reports');
                setOsInitialColleague({
                  name: colleague.name,
                  role: colleague.role || colleague.title,
                  department: colleague.department,
                  email: colleague.email || (colleague.user_id?.includes('@') ? colleague.user_id : undefined),
                });
                setOsInitialPrompt(undefined);
                setIsDesktopOSOpen(true);
              }}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 py-2 px-2.5 text-xs font-bold text-white transition shadow-sm cursor-pointer"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Giao việc</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const colleague = selectedColleague;
                setSelectedColleague(null);
                setOsInitialApp('assistant');
                setOsInitialColleague(null);
                setOsInitialPrompt(
                  `Tôi muốn trao đổi và phối hợp công việc với đồng nghiệp ${colleague.name} (${colleague.role || colleague.title || 'thành viên'}). Nhờ AI gợi ý phương án làm việc chung hiệu quả!`
                );
                setIsDesktopOSOpen(true);
              }}
              className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl bg-[#D97757] hover:bg-[#c46849] py-2 px-3 text-xs font-bold text-white transition shadow-md cursor-pointer"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Hỏi Trợ lý AI về {selectedColleague.name}</span>
            </button>
          </div>
        </div>
      )}

      {/* Dock chuyển nhanh góc nhìn Camera 3D (Bottom Center) */}
      {!hudCollapsed && !isDesktopOSOpen && !webglError && (
        <div className="pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 z-20 hidden md:flex items-center gap-1 p-1.5 rounded-2xl bg-slate-900/90 border border-slate-700/80 shadow-2xl backdrop-blur-xl">
          <button
            type="button"
            onClick={() => handleFocus3DZone('home')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              activeCameraView === 'home'
                ? 'bg-[#D97757] text-white shadow'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Toàn cảnh</span>
          </button>

          <button
            type="button"
            onClick={() => handleFocus3DZone('desks')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              activeCameraView === 'desks'
                ? 'bg-[#D97757] text-white shadow'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>Khu làm việc</span>
          </button>

          <button
            type="button"
            onClick={() => handleFocus3DZone('meeting')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              activeCameraView === 'meeting'
                ? 'bg-[#D97757] text-white shadow'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Phòng họp</span>
          </button>

          <button
            type="button"
            onClick={() => handleFocus3DZone('server')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              activeCameraView === 'server'
                ? 'bg-[#D97757] text-white shadow'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Studio AI</span>
          </button>

          <button
            type="button"
            onClick={handleToggleWalkMode}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              isWalkModeActive
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-[0_0_12px_rgba(6,182,212,0.6)]'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
            title="Đi dạo tự do bằng phím W, A, S, D hoặc phím mũi tên"
          >
            <Compass className={`w-3.5 h-3.5 ${isWalkModeActive ? 'animate-spin' : ''}`} />
            <span>{isWalkModeActive ? 'Đang đi dạo (ESC)' : 'Đi dạo (WASD)'}</span>
          </button>
        </div>
      )}

      {/* HUD hướng dẫn phím tắt Chế độ Đi dạo 3D (WASD Walk Mode) */}
      {isWalkModeActive && (
        <div className="pointer-events-auto absolute top-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2 rounded-2xl bg-slate-900/90 border border-cyan-400/40 text-cyan-200 text-xs shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-2">
          <span className="flex items-center gap-1.5 font-bold text-white">
            <Compass className="w-4 h-4 text-cyan-400 animate-spin" />
            Chế độ Đi bộ 3D
          </span>
          <span className="text-slate-300 text-[11px]">
            Phím <b className="text-cyan-300">W A S D</b> / <b className="text-cyan-300">Mũi tên</b>: Di chuyển • Chuột: Xoay nhìn • <b className="text-cyan-300">Shift</b>: Chạy • <b className="text-cyan-300">E</b>: Tương tác
          </span>
          <button
            type="button"
            onClick={handleToggleWalkMode}
            className="px-2 py-0.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-[11px] transition cursor-pointer"
          >
            Thoát (ESC)
          </button>
        </div>
      )}

      {/* Virtual Desktop OS Modal dạng game */}
      <div className={isDesktopOSOpen ? 'pointer-events-auto' : 'pointer-events-none'}>
        <VirtualDesktopOS
          isOpen={isDesktopOSOpen}
          onClose={() => {
            setIsDesktopOSOpen(false);
            setOsInitialApp(undefined);
            setOsInitialPrompt(undefined);
            setOsInitialColleague(null);
          }}
          idToken={idToken}
          currentUser={{ name: userName, role: userRole }}
          initialApp={osInitialApp}
          initialPrompt={osInitialPrompt}
          initialColleague={osInitialColleague}
          onNavigateModule={(mode) => {
            if (canAccessView(mode)) {
              onNavigate(mode);
            }
          }}
          onCallBot={handleCallBot}
          onReleaseBot={handleReleaseBot}
          onTriggerPatrol={handleTriggerPatrol}
          botState={botState}
          patrolState={patrolState}
        />
      </div>

      {activeInSceneModal && (
        <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-150">
          <div className="w-full max-w-2xl rounded-3xl border border-white/20 bg-slate-900/95 shadow-2xl backdrop-blur-2xl p-6 text-white">
            {/* Header Modal */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#D97757] to-amber-500 flex items-center justify-center text-white shadow-lg">
                  <Box className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {OFFICE_MODULE_ITEMS.find(m => m.id === activeInSceneModal)?.label || 'Phân hệ Workspace'}
                  </h3>
                  <p className="text-xs text-slate-400">Tương tác trực tiếp trong không gian 3D</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveInSceneModal(null)}
                  className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Body Modal */}
            <div className="py-4 space-y-3">
              {inSceneLoading ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <LoaderCircle className="w-7 h-7 animate-spin text-[#D97757]" />
                  <span className="text-xs">Đang tải dữ liệu thực tế từ hệ thống...</span>
                </div>
              ) : activeInSceneModal === 'work-schedule' || activeInSceneModal === 'weekly-report' ? (
                <div className="space-y-3">
                  {/* Form tạo nhanh nhiệm vụ in-scene */}
                  <form onSubmit={handleInSceneCreateTask} className="flex gap-2">
                    <input
                      type="text"
                      value={inSceneNewTaskTitle}
                      onChange={(e) => setInSceneNewTaskTitle(e.target.value)}
                      placeholder="Thêm nhanh nhiệm vụ mới cho hôm nay..."
                      className="flex-1 px-3 py-1.5 rounded-xl bg-slate-800/90 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400"
                    />
                    <button
                      type="submit"
                      disabled={inSceneCreatingTask || !inSceneNewTaskTitle.trim()}
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center gap-1 transition cursor-pointer shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{inSceneCreatingTask ? 'Đang thêm...' : 'Thêm việc'}</span>
                    </button>
                  </form>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-800/80 border border-slate-700/60 text-xs">
                      <button
                        type="button"
                        onClick={() => setInSceneFilter('all')}
                        className={`px-3 py-1 rounded-lg font-semibold transition ${inSceneFilter === 'all' ? 'bg-[#D97757] text-white shadow' : 'text-slate-400 hover:text-white'}`}
                      >
                        Tất cả ({inSceneScheduleItems.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setInSceneFilter('doing')}
                        className={`px-3 py-1 rounded-lg font-semibold transition ${inSceneFilter === 'doing' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                      >
                        Đang làm ({inSceneScheduleItems.filter(i => !isInSceneTaskDone(i.status)).length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setInSceneFilter('done')}
                        className={`px-3 py-1 rounded-lg font-semibold transition ${inSceneFilter === 'done' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                      >
                        Đã xong ({inSceneScheduleItems.filter(i => isInSceneTaskDone(i.status)).length})
                      </button>
                    </div>
                  </div>

                  <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                    {inSceneScheduleItems.length === 0 ? (
                      <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/40 text-center text-xs text-slate-400">
                        Chưa có lịch công tác hoặc nhiệm vụ phát sinh hôm nay. Hãy nhập nhanh ở ô trên!
                      </div>
                    ) : (
                      inSceneScheduleItems
                        .filter(it => {
                          const done = isInSceneTaskDone(it.status);
                          if (inSceneFilter === 'doing') return !done;
                          if (inSceneFilter === 'done') return done;
                          return true;
                        })
                        .slice(0, 12)
                        .map((it, idx) => {
                          const done = isInSceneTaskDone(it.status);
                          const assigneeName = it.executor?.name || it.executor?.email || it.assignee || 'Tôi';
                          return (
                            <div key={it.id || idx} className="p-2.5 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between text-xs hover:border-slate-600 transition">
                              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                <button
                                  type="button"
                                  onClick={() => handleInSceneToggleTask(it)}
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
                                  <p className={`font-semibold truncate ${done ? 'line-through text-slate-400' : 'text-slate-100'}`}>
                                    {it.title || it.content || it.task || 'Nhiệm vụ công tác'}
                                  </p>
                                  <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                                    {assigneeName} {it.date ? `· ${it.date}` : it.time ? `· ${it.time}` : ''}
                                  </p>
                                </div>
                              </div>
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                                done
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                              }`}>
                                {done ? 'Hoàn thành' : 'Đang thực hiện'}
                              </span>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
              ) : activeInSceneModal === 'examination' ? (
                <div className="space-y-3">
                  <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-200">Hệ thống Khảo thí & Ngân hàng đề</p>
                      <p className="text-xs text-slate-400 mt-0.5">Quản lý kỳ thi, đề thi chuẩn hóa và chấm thi tự động AI</p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">
                      {inSceneExamPapers.length} đề thi
                    </span>
                  </div>

                  <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                    {inSceneExamPapers.length === 0 ? (
                      <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/40 text-center text-xs text-slate-400">
                        Ngân hàng đề thi đang sẵn sàng. Mở phân hệ để tạo hoặc chấm thi.
                      </div>
                    ) : (
                      inSceneExamPapers.slice(0, 6).map((paper, idx) => (
                        <div key={paper.id || idx} className="p-3 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between text-xs">
                          <div className="min-w-0 pr-3">
                            <p className="font-semibold text-slate-100 truncate">{paper.title || paper.name || `Đề thi #${idx + 1}`}</p>
                            <p className="text-[11px] text-slate-400 mt-0.5">{paper.subject || 'Đánh giá năng lực'} · {paper.question_count || 40} câu hỏi</p>
                          </div>
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 bg-blue-500/15 text-blue-400 border border-blue-500/30">
                            {paper.status || 'READY'}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : activeInSceneModal === 'account-management' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 font-semibold">Danh sách nhân sự & Bot AI ({roster.length} thành viên)</span>
                    <span className="text-emerald-400 font-mono text-[11px]">{workingCount} đang làm · {idleCount} giải lao</span>
                  </div>
                  <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                    {roster.map((worker) => (
                      <div key={worker.id} className="p-2.5 rounded-xl bg-slate-800/70 border border-slate-700/60 flex items-center justify-between text-xs hover:bg-slate-750 transition">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${worker.is_bot ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'bg-slate-700 text-slate-200'}`}>
                            {worker.is_bot ? '🤖' : (worker.name || '?')[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-100 truncate">{worker.name}</p>
                            <p className="text-[10px] text-slate-400 truncate">{worker.role || worker.title || 'Thành viên'} · {worker.department || 'Văn phòng'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${worker.is_bot ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30' : worker.isIdle ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'}`}>
                            {worker.is_bot ? 'AI Bot' : worker.isIdle ? 'Nghỉ ngơi' : 'Làm việc'}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (iframeRef.current?.contentWindow) {
                                iframeRef.current.contentWindow.postMessage(
                                  { type: 'ft-office:focusWorker', name: worker.name, userId: worker.user_id },
                                  window.location.origin
                                );
                              }
                              setActiveInSceneModal(null);
                            }}
                            className="px-2 py-1 rounded-lg bg-blue-600/30 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/40 text-[10px] font-semibold transition cursor-pointer"
                          >
                            Lia camera
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : activeInSceneModal === 'resources' ? (
                <div className="space-y-3">
                  <div className="p-3 rounded-2xl bg-slate-800/70 border border-slate-700/60 text-xs">
                    <p className="font-semibold text-slate-200">Kho tài liệu & Quy chuẩn FermatTech</p>
                    <p className="text-slate-400 mt-1">Hệ thống biểu mẫu, giáo trình và tài nguyên dùng chung đã tích hợp trong không gian làm việc.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[
                      { title: 'Tài liệu & Biểu mẫu', desc: 'Quy trình, biểu mẫu hành chính', icon: '📁' },
                      { title: 'Ngân hàng đề số', desc: 'Tài nguyên trắc nghiệm & tự luận', icon: '📝' },
                      { title: 'Quy chuẩn khảo thí', desc: 'Quy chế coi thi & chấm điểm', icon: '⚖️' },
                      { title: 'Slide & Media', desc: 'Thư viện hình ảnh thương hiệu', icon: '🎨' },
                    ].map((item, idx) => (
                      <div key={idx} className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/40 hover:border-cyan-500/40 transition flex items-start gap-2.5">
                        <span className="text-lg">{item.icon}</span>
                        <div>
                          <p className="font-semibold text-slate-100">{item.title}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-96 w-full rounded-2xl overflow-hidden border border-slate-800 bg-slate-950">
                  <iframe
                    src={`/?view=${OFFICE_MODULE_ITEMS.find(m => m.id === activeInSceneModal)?.mode || activeInSceneModal}&embed=1&os=1`}
                    title={OFFICE_MODULE_ITEMS.find(m => m.id === activeInSceneModal)?.label || 'Phân hệ'}
                    className="w-full h-full border-none"
                  />
                </div>
              )}
            </div>

            {/* Footer Modal */}
            <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveInSceneModal(null);
                  setIsDesktopOSOpen(true);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-[#D97757] hover:bg-[#c46849] text-white transition cursor-pointer"
              >
                Mở rộng trên FermatOS
              </button>
              <button
                type="button"
                onClick={() => setActiveInSceneModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
              >
                Đóng (Ở lại 3D)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Command Palette khi bấm nút Tìm kiếm (Ctrl+K) trong Văn phòng 3D */}
      {isCommandPaletteOpen && (
        <div className="pointer-events-auto">
          <CommandPalette
            isOpen={isCommandPaletteOpen}
            onClose={() => setIsCommandPaletteOpen(false)}
            onNavigate={(path) => {
              setIsCommandPaletteOpen(false);
              const target = path.replace(/^\/+/, '');
              if (target && canAccessView(target)) {
                onNavigate(target);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
