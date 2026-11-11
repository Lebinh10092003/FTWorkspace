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
  ChevronRight
} from 'lucide-react';
import VirtualDesktopOS from './VirtualDesktopOS';
import { useOfficeHeartbeat } from './useOfficeHeartbeat';

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
};

const OFFICE_MODULE_ITEMS: { id: string; label: string; mode: string }[] = [
  { id: 'workspace', label: 'Trang chủ', mode: 'workspace' },
  { id: 'work-schedule', label: 'Lịch làm việc', mode: 'work-schedule' },
  { id: 'attendance', label: 'Công ca', mode: 'attendance' },
  { id: 'weekly-report', label: 'Báo cáo tuần', mode: 'weekly-report' },
  { id: 'examination', label: 'Khảo thí', mode: 'examination' },
  { id: 'digital-training', label: 'Công nghệ & Đào tạo số', mode: 'digital-training' },
  { id: 'finance-report', label: 'Báo cáo thu chi', mode: 'finance-report' },
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
  frameHost.style.cssText = 'position:fixed;display:none;z-index:5;left:0;top:0;width:0;height:0;overflow:hidden;background:#020617';
  frameEl = document.createElement('iframe');
  frameEl.src = '/office3d/vi/?embed=1';
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
  const [showAppsDrawer, setShowAppsDrawer] = useState(false);
  const [hudCollapsed, setHudCollapsed] = useState(false);
  const [showTips, setShowTips] = useState(true);
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

      // Nhận openModule
      if (data.type === 'ft-office:openModule') {
        const moduleId = String(data.module || '');
        const matched = OFFICE_MODULE_ITEMS.find(item => item.id === moduleId);
        if (matched) {
          // Kiểm tra quyền nghiêm ngặt trước khi điều hướng
          if (canAccessView(matched.mode)) {
            onNavigate(matched.mode);
          }
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
    <div ref={boxRef} className="fixed inset-0 w-screen h-screen bg-slate-950 text-white overflow-hidden">
      {/* Khung 3D Full-bleed lấp đầy 100% viewport (không còn sidebar hay thanh đen ép 2D) */}
      <div ref={slotRef} className="absolute inset-0 w-full h-full" />

      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/90 text-white backdrop-blur-sm">
          <LoaderCircle className="h-9 w-9 animate-spin text-[#D97757]" />
          <p className="mt-3 text-sm font-semibold text-slate-200">Đang khởi tạo Văn phòng 3D...</p>
          <p className="mt-1 text-xs text-slate-400">Tải mô hình văn phòng và định vị chỗ ngồi</p>
        </div>
      )}

      {/* Floating Top HUD Overlay */}
      <div className="pointer-events-none absolute top-3 inset-x-3 sm:inset-x-5 z-20 flex flex-wrap items-center justify-between gap-2">
        {/* HUD Trái: Nhận diện + Quick App Drawer + Về 2D */}
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-slate-700/70 bg-slate-900/80 px-2.5 py-1.5 shadow-xl backdrop-blur-md">
          <button
            type="button"
            onClick={onBackTo2D}
            className="flex items-center gap-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-700/80 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:text-white transition cursor-pointer"
            title="Quay lại giao diện phẳng 2D"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Giao diện 2D</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setShowAppsDrawer(v => !v);
              setShowList(false);
            }}
            className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-bold transition cursor-pointer border ${
              showAppsDrawer
                ? 'bg-[#D97757] text-white border-[#D97757]'
                : 'bg-slate-800/90 hover:bg-slate-700 text-slate-100 border-slate-700/80'
            }`}
            title="Mở nhanh các phân hệ & ứng dụng"
          >
            <LayoutGrid className="h-3.5 w-3.5 text-[#D97757] group-hover:text-white" style={showAppsDrawer ? { color: '#fff' } : undefined} />
            <span>Phân hệ</span>
          </button>

          <div className="hidden md:flex items-center gap-1.5 pl-1 pr-2 text-xs font-bold text-slate-200">
            <Box className="h-3.5 w-3.5 text-[#D97757]" />
            <span>FermatTech 3D</span>
          </div>
        </div>

        {/* HUD Phải: Máy tính OS, Robot AI, Sếp đi tuần, Roster, Thu gọn HUD */}
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-slate-700/70 bg-slate-900/80 px-2.5 py-1.5 shadow-xl backdrop-blur-md">
          {!hudCollapsed && (
            <>
              <button
                type="button"
                onClick={() => setIsDesktopOSOpen(true)}
                className="flex items-center gap-1.5 rounded-xl bg-[#D97757] hover:bg-[#c46849] px-3 py-1.5 text-xs font-bold text-white shadow-sm transition cursor-pointer"
                title="Mở máy tính cá nhân dạng Game OS"
              >
                <Monitor className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Máy tính OS</span>
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
                className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  botState.state === 'ARRIVED'
                    ? 'border-emerald-500/60 bg-emerald-950/70 text-emerald-300 hover:bg-emerald-900/70'
                    : botState.state === 'MOVING'
                    ? 'border-amber-500/60 bg-amber-950/70 text-amber-300 animate-pulse'
                    : 'border-cyan-500/40 bg-slate-800/90 text-cyan-300 hover:bg-slate-700'
                }`}
                title={
                  botState.state === 'ARRIVED'
                    ? 'Robot đang tại bàn (Bấm để cho robot về trạm)'
                    : 'Gọi Robot AI di chuyển đến bàn làm việc của bạn'
                }
              >
                <Bot className="h-3.5 w-3.5" />
                <span className="hidden md:inline">
                  {botState.state === 'ARRIVED'
                    ? 'Robot tại bàn'
                    : botState.state === 'MOVING'
                    ? 'Đang tới...'
                    : 'Gọi Robot'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleTriggerPatrol}
                disabled={patrolState.active}
                className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  patrolState.active
                    ? 'border-rose-500/60 bg-rose-950/70 text-rose-300 animate-pulse'
                    : 'border-slate-700/80 bg-slate-800/90 text-slate-200 hover:bg-slate-700'
                }`}
                title="Kích hoạt Giám đốc đi tuần tra các phòng ban"
              >
                <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
                <span className="hidden lg:inline">
                  {patrolState.active ? 'Đang tuần tra!' : 'Sếp đi tuần'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowList(v => !v);
                  setShowAppsDrawer(false);
                }}
                className="flex items-center gap-1.5 rounded-xl bg-slate-800/90 border border-slate-700/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
                title="Xem danh sách nhân sự đang làm / rảnh"
                aria-expanded={showList}
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>
                  <strong className="text-emerald-400 font-bold">{workingCount}</strong>
                  {idleCount > 0 && (
                    <span className="text-amber-400 font-semibold ml-1">· {idleCount} rảnh</span>
                  )}
                  <span className="hidden sm:inline text-slate-400 ml-1">· Nhân sự</span>
                </span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  const fresh = await fetchRoster();
                  sendInitToIframe(fresh);
                }}
                disabled={refreshing}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition flex items-center justify-center cursor-pointer"
                title="Làm mới danh sách nhân sự"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-[#D97757]' : ''}`} />
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
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition flex items-center justify-center cursor-pointer"
            title={hudCollapsed ? 'Mở rộng thanh công cụ' : 'Thu gọn thanh công cụ để ngắm 3D'}
          >
            {hudCollapsed ? <Eye className="h-3.5 w-3.5 text-[#D97757]" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Quick App Launcher Drawer (Thay thế hoàn toàn Sidebar 2D cồng kềnh) */}
      {showAppsDrawer && (
        <div className="absolute left-3 sm:left-5 top-16 z-30 w-80 sm:w-96 max-h-[75vh] overflow-y-auto rounded-2xl border border-slate-700/80 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-150">
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
              Mở Desktop OS
            </button>
          </div>
        </div>
      )}

      {/* Danh sách mọi người trong văn phòng (hỗ trợ Đang làm / Rảnh / Ngoại tuyến) */}
      {showList && (
        <div className="absolute right-3 sm:right-5 top-16 z-30 w-80 max-h-[70vh] overflow-y-auto rounded-2xl border border-slate-700/80 bg-slate-900/95 p-3.5 shadow-2xl backdrop-blur-xl">
          <div className="mb-2.5 flex items-center justify-between text-xs font-bold text-slate-200">
            <div>
              <span>Nhân sự văn phòng</span>
              <span className="ml-1.5 text-[11px] font-normal text-slate-400">
                ({onlineCount}/{roster.length} online)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowList(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              aria-label="Đóng danh sách"
            >
              <X className="h-3.5 w-3.5" />
            </button>
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

      {/* Tips nổi góc dưới nhẹ nhàng */}
      {showTips && !loading && (
        <div className="pointer-events-auto absolute bottom-3 left-3 sm:left-5 z-20 hidden sm:flex items-center gap-2 rounded-xl border border-slate-700/60 bg-slate-900/75 px-3 py-1.5 text-[11px] text-slate-300 backdrop-blur-md shadow-lg">
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

      {/* Virtual Desktop OS Modal dạng game */}
      <VirtualDesktopOS
        isOpen={isDesktopOSOpen}
        onClose={() => setIsDesktopOSOpen(false)}
        idToken={idToken}
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
  );
}
