import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LayoutGrid,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';

export type FermatOSSafariProps = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onBackToLaunchpad: () => void;
  reloadKey: number;
};

export function FermatOSSafari({
  url,
  title,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onReload,
  onBackToLaunchpad,
  reloadKey,
}: FermatOSSafariProps) {
  const displayAddress =
    url.startsWith('http://') || url.startsWith('https://')
      ? url
      : `https://workspace.fermat.vn${url.startsWith('/') ? '' : '/'}${url}`;

  return (
    <div className="flex-1 w-full h-full flex flex-col bg-slate-950/90 overflow-hidden">
      {/* Thanh điều hướng Safari Sequoia */}
      <div className="px-3.5 py-2 bg-slate-950/80 border-b border-white/10 backdrop-blur-xl flex items-center justify-between gap-3 text-xs shrink-0 select-none">
        {/* Nút điều hướng bên trái */}
        <div className="flex items-center gap-1 text-slate-300 shrink-0">
          <button
            type="button"
            onClick={onBackToLaunchpad}
            className="p-1.5 hover:bg-white/10 active:bg-white/15 rounded-lg text-slate-300 hover:text-white transition flex items-center gap-1.5 cursor-pointer"
            title="Quay lại Launchpad"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden md:inline text-[11px] font-medium">Launchpad</span>
          </button>

          <div className="h-4 w-px bg-white/10 mx-1" />

          <button
            type="button"
            onClick={onBack}
            disabled={!canGoBack}
            className={`p-1.5 rounded-lg transition ${
              canGoBack
                ? 'hover:bg-white/10 active:bg-white/15 text-slate-200 hover:text-white cursor-pointer'
                : 'text-slate-600 opacity-40 cursor-not-allowed'
            }`}
            title="Quay lại trang trước"
            aria-label="Quay lại"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onForward}
            disabled={!canGoForward}
            className={`p-1.5 rounded-lg transition ${
              canGoForward
                ? 'hover:bg-white/10 active:bg-white/15 text-slate-200 hover:text-white cursor-pointer'
                : 'text-slate-600 opacity-40 cursor-not-allowed'
            }`}
            title="Tiến tới trang sau"
            aria-label="Tiến tới"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onReload}
            className="p-1.5 hover:bg-white/10 active:bg-white/15 rounded-lg text-slate-300 hover:text-white transition cursor-pointer"
            title="Tải lại trang"
            aria-label="Tải lại"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Thanh địa chỉ trung tâm phong cách Safari Sequoia */}
        <div className="flex-1 max-w-xl mx-auto flex items-center gap-2 bg-slate-900/90 border border-white/15 hover:border-white/25 rounded-xl px-3 py-1.5 text-slate-200 transition shadow-inner min-w-0">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="text-[11px] font-mono text-slate-300 select-all flex-1 truncate">
            {displayAddress}
          </span>
          {title && (
            <span className="hidden lg:inline-block px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-medium text-slate-400 truncate max-w-[140px] shrink-0">
              {title}
            </span>
          )}
        </div>

        {/* Nút mở tab mới */}
        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.open(url, '_blank');
            }
          }}
          className="p-1.5 px-2.5 bg-white/5 hover:bg-white/15 active:bg-white/20 rounded-xl text-slate-200 hover:text-white border border-white/10 transition flex items-center gap-1.5 text-[11px] font-medium shrink-0 cursor-pointer"
          title="Mở trong tab trình duyệt mới"
        >
          <ExternalLink className="w-3.5 h-3.5 text-sky-400" />
          <span className="hidden sm:inline">Mở tab mới</span>
        </button>
      </div>

      {/* Khung viewport */}
      <div className="flex-1 w-full h-full relative bg-slate-950/80">
        <iframe
          key={reloadKey}
          src={url}
          title={title}
          className="w-full h-full border-none bg-slate-900"
        />
      </div>
    </div>
  );
}

export default FermatOSSafari;
