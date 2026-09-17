import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, LogIn, LogOut, Palette, Settings } from 'lucide-react';
import AppearanceSettings, { APPEARANCE_STORAGE_KEY, readWorkspaceAppearance, WorkspaceAppearance } from './AppearanceSettings';

export type AccountMenuProps = {
  userName?: string | null;
  photoURL?: string | null;
  userRole?: string | null;
  isGuest: boolean;
  onAccountClick: () => void;
  onLogout?: () => void;
  onLogin?: () => void;
  variant?: 'sidebar' | 'header' | 'avatar';
};

function accountLabels(userName?: string | null, userRole?: string | null) {
  const normalizedName = String(userName || '').trim().toLocaleLowerCase('vi-VN');
  if (normalizedName === 'phong nt' || normalizedName === 'phongnt') return { role: 'ADMIN', job: 'Nhân viên kỹ thuật' };
  const roleMap: Record<string, string> = { ADMIN: 'ADMIN', MANAGER: 'QUẢN LÝ', EMPLOYEE: 'NHÂN VIÊN', VIEWER: 'CHỈ XEM' };
  return { role: roleMap[String(userRole || '').toUpperCase()] || 'TÀI KHOẢN WORKSPACE', job: 'Chưa phân công chức vụ' };
}

export default function AccountMenu({ userName, photoURL, userRole, isGuest, onAccountClick, onLogout, onLogin, variant = 'sidebar' }: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const [appearance, setAppearance] = useState(readWorkspaceAppearance);
  const rootRef = useRef<HTMLDivElement>(null);
  const labels = accountLabels(userName, userRole);
  const name = isGuest ? 'Khách' : userName || 'Người dùng';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U';

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  const openAction = () => {
    setIsOpen(false);
    if (isGuest) (onLogin || onAccountClick)();
    else onAccountClick();
  };

  const actionItems = (
    <>
      <button type="button" onClick={openAction} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-sky-50 hover:text-blue-700" role="menuitem">
        {isGuest ? <LogIn className="h-4 w-4" /> : <Settings className="h-4 w-4" />}
        {isGuest ? 'Đăng nhập' : 'Chỉnh sửa hồ sơ'}
      </button>
      <button type="button" onClick={() => { setIsOpen(false); setAppearance(readWorkspaceAppearance()); setShowAppearance(true); }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-violet-50 hover:text-violet-700" role="menuitem">
        <Palette className="h-4 w-4" />Tùy chỉnh giao diện
      </button>
      {!isGuest && onLogout && (
        <button type="button" onClick={() => { setIsOpen(false); onLogout(); }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-bold text-rose-600 hover:bg-rose-50" role="menuitem">
          <LogOut className="h-4 w-4" />Đăng xuất
        </button>
      )}
    </>
  );

  const appearanceDialog = showAppearance && typeof document !== 'undefined'
    ? createPortal(
      <AppearanceSettings
        value={appearance}
        onChange={(next: WorkspaceAppearance) => {
          setAppearance(next);
          try { localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next)); } catch {}
          window.dispatchEvent(new CustomEvent('ft-appearance-change', { detail: next }));
        }}
        onClose={() => setShowAppearance(false)}
      />,
      document.body,
    )
    : null;

  const menuClass = variant === 'sidebar'
    ? 'absolute bottom-[calc(100%+0.5rem)] left-0 z-50 w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl'
    : 'absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[210px] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl';

  if (variant === 'avatar') {
    return <><div ref={rootRef} className="relative shrink-0"><button type="button" onClick={() => setIsOpen(value => !value)} className="grid h-9 w-9 place-items-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-sm font-bold text-slate-700 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2" aria-label="Mở menu tài khoản" aria-expanded={isOpen} aria-haspopup="menu">{photoURL && !isGuest ? <img src={photoURL} alt={name} className="h-full w-full object-cover"/> : initials}</button>{isOpen && <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[230px] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl" role="menu">{actionItems}</div>}</div>{appearanceDialog}</>;
  }

  const accountButtonClass = variant === 'sidebar'
    ? 'ft-sidebar-account flex w-full items-center gap-3 rounded-xl border p-2.5 text-left shadow-sm transition-colors hover:bg-sky-50'
    : 'workspace-account-button flex min-w-[190px] items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-left shadow-sm transition-colors hover:border-blue-200 hover:bg-sky-50';

  return (
    <><div ref={rootRef} className={`relative ${variant === 'sidebar' ? 'mb-3' : ''}`}>
      <button type="button" onClick={() => setIsOpen(value => !value)} className={accountButtonClass} aria-expanded={isOpen} aria-haspopup="menu">
        {photoURL && !isGuest ? <img src={photoURL} alt={name} className="h-9 w-9 shrink-0 rounded-xl border border-slate-100 object-cover" /> : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-100 text-xs font-extrabold text-sky-800">{initials}</span>}
        <span className="min-w-0 flex-1"><b className="block truncate text-xs text-slate-900">{name}</b>{isGuest ? <small className="mt-1 block truncate text-[9px] font-bold uppercase tracking-wider text-slate-400">Tài khoản khách</small> : <><small className="mt-1 flex items-center gap-1 truncate text-[9px] font-bold tracking-wider text-slate-500"><i className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />{labels.role}</small><small className="block truncate text-[9px] font-medium text-slate-400">{labels.job}</small></>}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && <div className={menuClass} role="menu">{actionItems}</div>}
    </div>{appearanceDialog}</>
  );
}
