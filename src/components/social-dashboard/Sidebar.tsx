import React from 'react';
import {
  LayoutDashboard,
  Radio,
  FileText,
  RefreshCw,
  Settings,
  ArrowLeft
} from 'lucide-react';
import { UserRole } from '../../types';
import AccountMenu from '../AccountMenu';
import ModuleMobileNav from '../ModuleMobileNav';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  user: any;
  userRole: UserRole;
  idToken: string;
  onLogout: () => void;
  onLogin: () => void;
  onAccountClick: () => void;
  onBackToWorkspace: () => void;
}

export default function Sidebar({ activeTab, setActiveTab, user, userRole, idToken, onLogout, onLogin, onAccountClick, onBackToWorkspace }: SidebarProps) {
  const isGuest = user?.email === 'guest@ftsocial.com';
  const menuItems = [
    { id: 'dashboard', label: 'Biểu đồ tổng quan', icon: LayoutDashboard },
    { id: 'media', label: 'Báo cáo tổng hợp', icon: Radio },
    { id: 'posts', label: 'Bài đăng', icon: FileText },
    ...(isGuest ? [] : [{ id: 'sync', label: 'Đồng bộ dữ liệu', icon: RefreshCw }]),
    ...(isGuest ? [] : [{ id: 'config', label: 'Cấu hình hệ thống', icon: Settings }]),
  ];

  return (
    <>
    <div className="ft-module-sidebar hidden w-64 h-screen flex-col sticky top-0 border-r md:flex">
      {/* Brand logo & title */}
      <div className="ft-sidebar-brand p-5 border-b flex items-center gap-3">
        <img src="/logo.png" alt="FermatTech Logo" className="h-8 object-contain" />
        <div className="border-l border-slate-200 pl-3">
          <h1 className="font-extrabold text-slate-900 text-sm leading-none tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Fermat</h1>
          <p className="text-[9px] uppercase font-bold text-indigo-650 tracking-wider mt-1">Truyền thông</p>
        </div>
      </div>
      {/* Navigation menu items */}
      <nav className="flex-1 px-4 py-5 space-y-1 overflow-y-auto">
        {menuItems.map((item) => {
          const IconComponent = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                isActive
                  ? 'ft-nav-item ft-nav-item-active'
                  : 'ft-nav-item'
              }`}
            >
              <IconComponent className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* User profile section */}
      <div className="ft-sidebar-footer p-4 border-t border-slate-100 bg-slate-50/40">
        <button
          onClick={onBackToWorkspace}
          className="ft-sidebar-back mb-3 w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer active:scale-[0.98]"
        >
          <ArrowLeft className="w-4 h-4 text-slate-500" />
          <span>Quay lại Workspace</span>
        </button>
        <AccountMenu
          userName={user?.displayName}
          photoURL={user?.photoURL}
          userRole={userRole}
          isGuest={isGuest}
          onAccountClick={onAccountClick}
          onLogin={onLogin}
          onLogout={onLogout}
          variant="sidebar"
        />
      </div>
    </div>
    <ModuleMobileNav
      className="lg:hidden social-mobile-nav"
      onBack={onBackToWorkspace}
      activeId={activeTab}
      onSelect={setActiveTab}
      items={menuItems}
      ariaLabel="Điều hướng Truyền thông"
    />
    </>
  );
}
