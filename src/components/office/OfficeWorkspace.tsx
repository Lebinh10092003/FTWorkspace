import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Box,
  Layers,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Users
} from 'lucide-react';

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
  const [isReady, setIsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [roster, setRoster] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [webglError, setWebglError] = useState<string | null>(null);

  const webglSupported = useMemo(() => checkWebGLSupport(), []);

  // Danh sách các phân hệ mà người dùng hiện tại được phép truy cập
  const accessibleModules = useMemo(() => {
    return OFFICE_MODULE_ITEMS
      .filter(item => canAccessView(item.mode))
      .map(item => ({ id: item.id, label: item.label }));
  }, [canAccessView]);


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
      const list = Array.isArray(data.roster) ? data.roster : [];
      setRoster(list);
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
        sendInitToIframe();
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

  // Trường hợp không hỗ trợ WebGL
  if (!webglSupported || webglError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] p-6 text-center">
        <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50/70 p-6 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/20">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-bold text-slate-900 dark:text-white">
            {webglError || 'Thiết bị chưa hỗ trợ đồ họa 3D (WebGL)'}
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Trình duyệt hoặc phần cứng hiện tại chưa kích hoạt tính năng tăng tốc phần cứng WebGL. Bạn có thể sử dụng giao diện 2D hoàn chỉnh của Workspace.
          </p>
          <button
            type="button"
            onClick={onBackTo2D}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 transition"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Dùng giao diện 2D</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col w-full h-full min-h-[calc(100vh-3.5rem)] lg:min-h-[calc(100vh-4rem)] bg-slate-950 text-white overflow-hidden">
      {/* Top Bar điều khiển */}
      <div className="z-20 flex h-12 items-center justify-between border-b border-slate-800/80 bg-slate-900/90 px-3 sm:px-5 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onBackTo2D}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition cursor-pointer min-h-[36px]"
            title="Quay lại giao diện truyền thống 2D"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Về giao diện 2D</span>
          </button>
          <div className="h-4 w-px bg-slate-700 hidden sm:block" />
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
            <Box className="h-4 w-4 text-blue-400" />
            <span className="hidden sm:inline">Văn phòng 3D FermatTech</span>
            <span className="sm:hidden">Văn phòng 3D</span>
          </div>
        </div>

        {/* Trạng thái online & Làm mới */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 rounded-full bg-slate-800/90 border border-slate-700/60 px-2.5 py-0.5 text-xs font-medium text-slate-300">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>
              <strong className="text-emerald-400 font-bold">{onlineCount}</strong> đang online
            </span>
          </div>

          <button
            type="button"
            onClick={async () => {
              const fresh = await fetchRoster();
              sendInitToIframe(fresh);
            }}
            disabled={refreshing}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition min-h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer"
            title="Làm mới danh sách nhân sự"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950/90 text-white backdrop-blur-xs">
          <LoaderCircle className="h-9 w-9 animate-spin text-blue-500" />
          <p className="mt-3 text-sm font-semibold text-slate-200">Đang khởi tạo Văn phòng 3D...</p>
          <p className="mt-1 text-xs text-slate-400">Tải mô hình văn phòng và định vị chỗ ngồi</p>
        </div>
      )}

      {/* Vị trí khung 3D (iframe giữ sống nằm ngoài cây React, xếp chồng lên đây) */}
      <div ref={slotRef} className="w-full flex-1 h-full min-h-[calc(100vh-6.5rem)]" />
    </div>
  );
}
