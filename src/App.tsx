import React, { Component, Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { appDialog } from './components/AppDialog';
import { ArrowLeft, BadgeDollarSign, CalendarCheck, CalendarDays, CalendarRange, ChartColumnBig, ClipboardList, ContactRound, FileCheck2, FileSignature, ReceiptText, GraduationCap, Mail, Megaphone, Moon, QrCode, Presentation, ShieldUser, TriangleAlert } from 'lucide-react';

import { Channel, UserRole } from './types';
import LoginModal from './components/LoginModal';
import AccountProfileModal from './components/AccountProfileModal';
import AccountMenu from './components/AccountMenu';
import WorkspaceNotifications from './components/WorkspaceNotifications';
import ModuleMobileNav from './components/ModuleMobileNav';
import { readWorkspaceAppearance, WorkspaceAppearance } from './components/AppearanceSettings';
import WorkspaceAreaFrame from './components/layout/WorkspaceAreaFrame';
import ModuleShellHeader from './components/layout/ModuleShellHeader';
import { ACCOUNT_MANAGEMENT_NAV, areaForView, COMMUNICATION_TOOLS_NAV, filterModuleNav, SOCIAL_DASHBOARD_NAV, WorkspaceArea } from './config/workspaceNavigation';

const lazyWithRecovery = <T extends React.ComponentType<any>>(loader: () => Promise<{ default: T }>) => lazy(async () => {
  const retryKey = `ft-workspace-lazy-reload:${window.location.pathname}`;
  try {
    const module = await loader();
    sessionStorage.removeItem(retryKey);
    return module;
  } catch (error) {
    if (!sessionStorage.getItem(retryKey)) {
      sessionStorage.setItem(retryKey, '1');
      window.location.reload();
      return new Promise<never>(() => {});
    }
    sessionStorage.removeItem(retryKey);
    throw error;
  }
});

const Dashboard = lazyWithRecovery(() => import('./components/social-dashboard/Dashboard'));
const MediaSummary = lazyWithRecovery(() => import('./components/social-dashboard/MediaSummary'));
const Posts = lazyWithRecovery(() => import('./components/social-dashboard/Posts'));
const Sync = lazyWithRecovery(() => import('./components/social-dashboard/Sync'));
const Config = lazyWithRecovery(() => import('./components/social-dashboard/Config'));
const AccountManagement = lazyWithRecovery(() => import('./components/social-dashboard/AccountManagement'));
const EmailTemplateBuilder = lazyWithRecovery(() => import('./components/email-builder/EmailTemplateBuilder'));
const SignatureBuilder = lazyWithRecovery(() => import('./components/email-builder/SignatureBuilder'));
const FinanceWorkspace = lazyWithRecovery(() => import('./components/digital-training/FinanceWorkspace'));
const ExaminationModule = lazyWithRecovery(() => import('./components/ExaminationModule'));
const DigitalTraining = lazyWithRecovery(() => import('./components/digital-training/DigitalTraining'));
const TrainingAssessmentPublic = lazyWithRecovery(() => import('./components/digital-training/TrainingAssessmentPublic'));
const TrainingAssessmentWorkspace = lazyWithRecovery(() => import('./components/digital-training/TrainingAssessmentWorkspace'));
const QRCodeGenerator = lazyWithRecovery(() => import('./components/QRCodeGenerator'));
const Attendance = lazyWithRecovery(() => import('./components/Attendance'));
const FundingProposalBuilder = lazyWithRecovery(() => import('./components/documents/FundingProposalBuilder'));
const DocumentNumberGenerator = lazyWithRecovery(() => import('./components/documents/DocumentNumberGenerator'));
const WorkSchedule = lazyWithRecovery(() => import('./components/WorkSchedule'));
const CompetitionLandingManager = lazyWithRecovery(() => import('./components/examination/CompetitionLandingManager'));
const CompetitionLandingPublic = lazyWithRecovery(() => import('./components/examination/CompetitionLandingPublic'));

type ViewMode = 'workspace' | 'work-schedule' | 'social-dashboard' | 'communication-tools' | 'email-builder' | 'signature-builder' | 'examination' | 'digital-training' | 'finance-report' | 'training-assessments' | 'training-assessment-public' | 'qr-generator' | 'funding-proposal' | 'document-number' | 'competition-landing' | 'competition-landing-public' | 'attendance' | 'account-management';

const SOCIAL_TABS = ['dashboard', 'media', 'posts', 'sync', 'config'] as const;
type SocialTab = typeof SOCIAL_TABS[number];
const socialTabFromPath = (pathname: string): SocialTab => {
  const segment = pathname.replace(/^\/+|\/+$/g, '').split('/')[1] || 'dashboard';
  return (SOCIAL_TABS as readonly string[]).includes(segment) ? segment as SocialTab : 'dashboard';
};
const socialPathFor = (tab: string) => tab === 'dashboard' ? '/social-dashboard' : `/social-dashboard/${tab}`;

type AppUser = {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string | null;
  accessModules?: string[];
  jobTitle?: { id: number; name: string } | null;
  departments?: { id: number; name: string }[];
};

type StoredSession = {
  token: string;
  user: AppUser;
  role: UserRole;
};

const GUEST_USER: AppUser = {
  uid: 'guest',
  email: 'guest@ftsocial.com',
  displayName: 'Khách',
  photoURL: '',
};

const workspacePalettes: Record<WorkspaceAppearance['theme'], { background: string; card: string; panel: string; text: string; muted: string; surfaceText: string; surfaceMuted: string; accent: string; imageOverlay: string }> = {
  light: { background: 'linear-gradient(150deg,#f6f8fc 0%,#eef3fb 45%,#eaf1ff 72%,#fff 100%)', card: 'rgba(255,255,255,.82)', panel: 'rgba(255,255,255,.9)', text: '#0f172a', muted: '#64748b', surfaceText: '#172033', surfaceMuted: '#64748b', accent: '#0055da', imageOverlay: 'rgba(246,248,252,.72)' },
  dark: { background: 'linear-gradient(155deg,#080d16 0%,#0c1320 48%,#101a2b 100%)', card: '#141d2e', panel: '#0f1727', text: '#e9eff8', muted: '#94a6be', surfaceText: '#e9eff8', surfaceMuted: '#93a5bd', accent: '#5b9dff', imageOverlay: 'rgba(8,13,22,.82)' },
  blue: { background: 'linear-gradient(150deg,#eff6ff 0%,#dbeafe 48%,#e0f2fe 100%)', card: 'rgba(255,255,255,.78)', panel: 'rgba(239,246,255,.92)', text: '#172554', muted: '#475569', surfaceText: '#172554', surfaceMuted: '#475569', accent: '#2563eb', imageOverlay: 'rgba(219,234,254,.7)' },
  teal: { background: 'linear-gradient(150deg,#f0fdfa 0%,#ccfbf1 48%,#dff7f3 100%)', card: 'rgba(255,255,255,.8)', panel: 'rgba(240,253,250,.93)', text: '#134e4a', muted: '#4b6865', surfaceText: '#134e4a', surfaceMuted: '#4b6865', accent: '#0f9f95', imageOverlay: 'rgba(204,251,241,.7)' },
  mint: { background: 'linear-gradient(150deg,#f0fdf8 0%,#d1fae5 48%,#e6fff5 100%)', card: 'rgba(255,255,255,.8)', panel: 'rgba(240,253,248,.93)', text: '#14533f', muted: '#4f6b61', surfaceText: '#14533f', surfaceMuted: '#4f6b61', accent: '#10a875', imageOverlay: 'rgba(209,250,229,.7)' },
  green: { background: 'linear-gradient(150deg,#f0fdf4 0%,#dcfce7 50%,#d1fae5 100%)', card: 'rgba(255,255,255,.78)', panel: 'rgba(240,253,244,.92)', text: '#14532d', muted: '#4b6356', surfaceText: '#14532d', surfaceMuted: '#4b6356', accent: '#16a34a', imageOverlay: 'rgba(220,252,231,.7)' },
  sage: { background: 'linear-gradient(150deg,#f5f7f1 0%,#e8efdf 48%,#dce7cf 100%)', card: 'rgba(255,255,255,.8)', panel: 'rgba(245,247,241,.93)', text: '#364b2c', muted: '#66735e', surfaceText: '#364b2c', surfaceMuted: '#66735e', accent: '#73945a', imageOverlay: 'rgba(232,239,223,.72)' },
  yellow: { background: 'linear-gradient(150deg,#fffbeb 0%,#fef9c3 48%,#fef3c7 100%)', card: 'rgba(255,255,255,.82)', panel: 'rgba(255,251,235,.94)', text: '#713f12', muted: '#766752', surfaceText: '#713f12', surfaceMuted: '#766752', accent: '#ca8a04', imageOverlay: 'rgba(254,249,195,.7)' },
  beige: { background: 'linear-gradient(150deg,#faf6ef 0%,#f5eadb 48%,#efe0ca 100%)', card: 'rgba(255,255,255,.82)', panel: 'rgba(250,246,239,.94)', text: '#5d3d25', muted: '#766456', surfaceText: '#5d3d25', surfaceMuted: '#766456', accent: '#a26f3c', imageOverlay: 'rgba(245,234,219,.72)' },
  peach: { background: 'linear-gradient(150deg,#fff7ed 0%,#ffedd5 52%,#fef3c7 100%)', card: 'rgba(255,255,255,.8)', panel: 'rgba(255,247,237,.93)', text: '#7c2d12', muted: '#705c51', surfaceText: '#7c2d12', surfaceMuted: '#705c51', accent: '#ea580c', imageOverlay: 'rgba(255,237,213,.7)' },
  red: { background: 'linear-gradient(150deg,#fff7f5 0%,#ffdad8 45%,#ffead3 100%)', card: 'rgba(255,255,255,.82)', panel: 'rgba(255,247,245,.94)', text: '#762d2d', muted: '#765c5c', surfaceText: '#762d2d', surfaceMuted: '#765c5c', accent: '#d25353', imageOverlay: 'rgba(255,218,216,.7)' },
  pink: { background: 'linear-gradient(150deg,#fdf2f8 0%,#fce7f3 50%,#ffe4e6 100%)', card: 'rgba(255,255,255,.8)', panel: 'rgba(253,242,248,.93)', text: '#831843', muted: '#6b5560', surfaceText: '#831843', surfaceMuted: '#6b5560', accent: '#db2777', imageOverlay: 'rgba(252,231,243,.7)' },
  lavender: { background: 'linear-gradient(150deg,#faf5ff 0%,#ede9fe 48%,#f3e8ff 100%)', card: 'rgba(255,255,255,.8)', panel: 'rgba(250,245,255,.93)', text: '#4c1d95', muted: '#655a73', surfaceText: '#4c1d95', surfaceMuted: '#655a73', accent: '#7c3aed', imageOverlay: 'rgba(237,233,254,.7)' },
  navy: { background: 'linear-gradient(150deg,#eff4fa 0%,#dbe4f0 48%,#cbd5e1 100%)', card: 'rgba(255,255,255,.82)', panel: 'rgba(239,244,250,.94)', text: '#243554', muted: '#5f6b7d', surfaceText: '#243554', surfaceMuted: '#5f6b7d', accent: '#405b8c', imageOverlay: 'rgba(219,228,240,.72)' },
  gray: { background: 'linear-gradient(150deg,#f8fafc 0%,#f1f5f9 48%,#e2e8f0 100%)', card: 'rgba(255,255,255,.84)', panel: 'rgba(248,250,252,.95)', text: '#334155', muted: '#64748b', surfaceText: '#334155', surfaceMuted: '#64748b', accent: '#64748b', imageOverlay: 'rgba(241,245,249,.72)' },
  custom: { background: 'linear-gradient(150deg,color-mix(in srgb,var(--workspace-accent) 8%,white),color-mix(in srgb,var(--workspace-accent) 18%,white))', card: 'rgba(255,255,255,.8)', panel: 'rgba(255,255,255,.9)', text: '#172033', muted: '#64748b', surfaceText: '#172033', surfaceMuted: '#64748b', accent: '#8b5cf6', imageOverlay: 'rgba(255,255,255,.68)' },
};

function workspaceAppearanceStyle(appearance: WorkspaceAppearance): React.CSSProperties {
  const palette = workspacePalettes[appearance.theme];
  const accent = appearance.theme === 'custom' ? appearance.customColor : palette.accent;
  const canvas = appearance.backgroundImage
    ? `linear-gradient(${palette.imageOverlay},${palette.imageOverlay}),url("${appearance.backgroundImage}")`
    : palette.background;
  return {
    '--workspace-background': palette.background,
    '--workspace-canvas': canvas,
    '--workspace-card': palette.card,
    '--workspace-panel': palette.panel,
    '--workspace-text': palette.text,
    '--workspace-muted': palette.muted,
    '--workspace-surface-text': palette.surfaceText,
    '--workspace-surface-muted': palette.surfaceMuted,
    '--workspace-accent': accent,
  } as React.CSSProperties;
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem('ft_auth_session');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.user?.email) return null;
    return {
      token: String(parsed.token),
      user: parsed.user as AppUser,
      role: (parsed.role || 'EMPLOYEE') as UserRole,
    };
  } catch {
    return null;
  }
}

function userFromApi(value: any): AppUser {
  return {
    uid: String(value?.uid || value?.email || ''),
    email: String(value?.email || ''),
    displayName: String(value?.displayName || value?.name || value?.email || 'Người dùng'),
    photoURL: value?.photoURL || value?.picture || '',
    accessModules: Array.isArray(value?.accessModules) ? value.accessModules : [],
    jobTitle: value?.jobTitle || null,
    departments: Array.isArray(value?.departments) ? value.departments : value?.department ? [value.department] : [],
  };
}

function getInitialViewMode(): ViewMode {
  const path = window.location.pathname;
  if (path.startsWith('/cuoc-thi/')) return 'competition-landing-public';
  if (path.startsWith('/training-assessment/')) return 'training-assessment-public';
  if (path.startsWith('/training-assessments')) return 'training-assessments';
  if (path.startsWith('/digital-training')) return 'digital-training';
  if (path.startsWith('/work-schedule')) return 'work-schedule';
  if (path.startsWith('/social-dashboard')) return 'social-dashboard';
  if (path.startsWith('/communication-tools/email')) return 'email-builder';
  if (path.startsWith('/communication-tools/signature')) return 'signature-builder';
  if (path.startsWith('/communication-tools/qr')) return 'qr-generator';
  if (path.startsWith('/communication-tools/funding-proposal')) return 'funding-proposal';
  if (path.startsWith('/communication-tools/document-number')) return 'document-number';
  if (path.startsWith('/communication-tools/competition-landing')) return 'competition-landing';
  if (path.startsWith('/communication-tools')) return 'communication-tools';
  if (path.startsWith('/finance-report')) return 'finance-report';
  if (path.startsWith('/signature-builder')) return 'signature-builder';
  if (path.startsWith('/email-builder')) return 'email-builder';
  if (path.startsWith('/examination')) return 'examination';
  if (path.startsWith('/qr-generator')) return 'qr-generator';
  if (path.startsWith('/attendance')) return 'attendance';
  if (path.startsWith('/account-management')) return 'account-management';
  return 'workspace';
}

class ExaminationErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-screen place-items-center bg-slate-50 p-6 text-slate-800">
          <div className="w-full max-w-xl rounded-xl border border-rose-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-extrabold text-rose-700">Không thể tải mô-đun Khảo thí</h1>
            <p className="mt-2 text-sm text-slate-600">Hệ thống đã chặn lỗi để không hiển thị màn hình trắng.</p>
            <pre className="mt-4 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-rose-200">
              {this.state.error.message}
            </pre>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white"
            >
              Thử tải lại mô-đun
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const initialSession = useMemo(readStoredSession, []);
  const [user, setUser] = useState<AppUser>(initialSession?.user || GUEST_USER);
  const [idToken, setIdToken] = useState<string | null>(initialSession?.token || null);
  const [userRole, setUserRole] = useState<UserRole>(initialSession?.role || 'EMPLOYEE');
  const [authChecking, setAuthChecking] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [accessNotice, setAccessNotice] = useState('');
  const [appearance, setAppearance] = useState<WorkspaceAppearance>(readWorkspaceAppearance);

  const [viewMode, setViewModeState] = useState<ViewMode>(getInitialViewMode());
  const [activeTab, setActiveTab] = useState<SocialTab>(() => socialTabFromPath(window.location.pathname));
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);

  // Yesterday timesheet warning
  const [yesterdayWarning, setYesterdayWarning] = useState<{ show: boolean; date: string }>({ show: false, date: '' });
  const [dismissPermanent, setDismissPermanent] = useState(false);
  const [attendanceEditDate, setAttendanceEditDate] = useState('');

  const isGuest = !idToken || user.email === GUEST_USER.email;
  const normalisedEmployeeIdentity = [user.jobTitle?.name || '', ...(user.departments || []).map(item => item.name)]
    .join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(new RegExp(String.fromCharCode(273), 'g'), 'd').toLocaleLowerCase('vi-VN');
  const isAccountant = normalisedEmployeeIdentity.includes('ke toan');
  const communicationModules = ['email-builder', 'signature-builder', 'qr-generator'];
  const hasModuleAccess = (module: string) => userRole === 'ADMIN' || (
    communicationModules.includes(module)
      ? communicationModules.some(item => (user.accessModules || []).includes(item))
      : (user.accessModules || []).includes(module)
  );
  const canViewFinance = !isGuest && hasModuleAccess('finance-report') && (userRole === 'ADMIN' || userRole === 'MANAGER' || isAccountant || normalisedEmployeeIdentity.includes('giam doc') || normalisedEmployeeIdentity.includes('quan ly'));
  const canEditFinance = canViewFinance && (userRole === 'ADMIN' || isAccountant);
  const moduleForView: Partial<Record<ViewMode, string>> = { 'social-dashboard': 'social-dashboard', attendance: 'attendance', 'email-builder': 'email-builder', 'signature-builder': 'signature-builder', 'qr-generator': 'qr-generator', 'competition-landing': 'examination', examination: 'examination', 'digital-training': 'digital-training', 'training-assessments': 'digital-training' };
  const canAccessView = (mode: ViewMode) => { if (mode === 'account-management') return userRole === 'ADMIN'; if (mode === 'finance-report') return canViewFinance; if (mode === 'work-schedule') return !isGuest; if (mode === 'communication-tools') return !isGuest && hasModuleAccess('email-builder'); if (mode === 'funding-proposal' || mode === 'document-number') return !isGuest; if (isGuest) return false; const module = moduleForView[mode]; return !!module && hasModuleAccess(module); };
  const googleAccessToken = null;

  const persistSession = (token: string, nextUser: AppUser, role: UserRole) => {
    localStorage.setItem('ft_auth_session', JSON.stringify({ token, user: nextUser, role }));
  };

  const clearSession = () => {
    localStorage.removeItem('ft_auth_session');
    localStorage.removeItem('google_access_token');
  };

  useEffect(() => {
    let active = true;
    const validateSession = async () => {
      if (!idToken) {
        if (active) setAuthChecking(false);
        return;
      }
      try {
        const response = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!response.ok) throw new Error('Phiên đăng nhập không còn hiệu lực.');
        const profile = await response.json();
        if (!active) return;
        const nextUser = userFromApi(profile);
        const nextRole = (profile.role || 'EMPLOYEE') as UserRole;
        setUser(nextUser);
        setUserRole(nextRole);
        persistSession(idToken, nextUser, nextRole);
      } catch {
        if (!active) return;
        clearSession();
        setIdToken(null);
        setUser(GUEST_USER);
        setUserRole('EMPLOYEE');
        setViewModeState('workspace');
      } finally {
        if (active) setAuthChecking(false);
      }
    };
    validateSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleLocationChange = () => {
      const nextMode = getInitialViewMode();
      setViewModeState(nextMode);
      if (nextMode === 'social-dashboard') setActiveTab(socialTabFromPath(window.location.pathname));
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    const paths: Partial<Record<ViewMode, string>> = {
      workspace: '/',
      'communication-tools': '/communication-tools',
      'email-builder': '/communication-tools/email',
      'signature-builder': '/communication-tools/signature',
      'qr-generator': '/communication-tools/qr',
    };
    const path = paths[mode] || `/${mode}`;
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  };

  useEffect(() => {
    const legacyRoutes: Array<[string, string]> = [
      ['/digital-training/bndc', '/digital-training/quanlybndc'],
      ['/email-builder', '/communication-tools/email'],
      ['/signature-builder', '/communication-tools/signature'],
      ['/qr-generator', '/communication-tools/qr'],
    ];
    const match = legacyRoutes.find(([legacy]) => window.location.pathname.startsWith(legacy));
    if (match) window.history.replaceState(null, '', `${match[1]}${window.location.search}${window.location.hash}`);
  }, []);

  useEffect(() => {
    if (authChecking || isGuest) return;
    const preloaders: Array<() => Promise<unknown>> = [
      () => import('./components/WorkSchedule'),
      ...(hasModuleAccess('examination') ? [() => import('./components/ExaminationModule')] : []),
      ...(hasModuleAccess('digital-training') ? [() => import('./components/digital-training/DigitalTraining'), () => import('./components/digital-training/TrainingAssessmentWorkspace')] : []),
      ...(hasModuleAccess('attendance') ? [() => import('./components/Attendance')] : []),
      ...(canViewFinance ? [() => import('./components/digital-training/FinanceWorkspace')] : []),
      ...(hasModuleAccess('social-dashboard') ? [() => import('./components/social-dashboard/Dashboard')] : []),
      ...(hasModuleAccess('email-builder') ? [() => import('./components/email-builder/EmailTemplateBuilder'), () => import('./components/QRCodeGenerator')] : []),
      ...(userRole === 'ADMIN' ? [() => import('./components/social-dashboard/AccountManagement')] : []),
    ];
    let cancelled = false;
    let timer = window.setTimeout(async () => {
      for (const preload of preloaders) {
        if (cancelled) return;
        try { await preload(); } catch { /* The normal lazy loader retains its retry UI. */ }
        await new Promise(resolve => window.setTimeout(resolve, 120));
      }
    }, 500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [authChecking, canViewFinance, isGuest, user.accessModules, userRole]);

  // Check yesterday timesheet warning when workspace loads
  useEffect(() => {
    if (authChecking || isGuest || !idToken) return;
    let active = true;
    const refreshWarning = (ignoreDismissed = false) => {
      if (!ignoreDismissed && sessionStorage.getItem('timesheet_dismiss_yesterday')) return;
      fetch('/api/attendance/timesheet/prefill', { headers: { Authorization: `Bearer ${idToken}` } })
        .then(r => r.json())
        .then((pf: any) => {
          if (!active) return;
          setYesterdayWarning(pf.yesterdayWarning
            ? { show: true, date: pf.yesterdayDate }
            : { show: false, date: pf.yesterdayDate || '' });
        })
        .catch(() => {});
    };
    const onTimesheetSaved = (event: Event) => {
      const savedDate = (event as CustomEvent<{ date?: string }>).detail?.date;
      setYesterdayWarning(previous => savedDate && savedDate === previous.date ? { ...previous, show: false } : previous);
      refreshWarning(true);
    };
    refreshWarning();
    window.addEventListener('ft-timesheet-saved', onTimesheetSaved);
    return () => {
      active = false;
      window.removeEventListener('ft-timesheet-saved', onTimesheetSaved);
    };
  }, [authChecking, isGuest, idToken]);

  const fmtDDMMYYYY = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

  const dismissYesterdayWarning = () => {
    setYesterdayWarning(prev => ({ ...prev, show: false }));
    if (dismissPermanent) sessionStorage.setItem('timesheet_dismiss_yesterday', '1');
  };

  const markYesterdayDayOff = async () => {
    dismissYesterdayWarning();
    try {
      await fetch('/api/attendance/timesheet/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ workDate: yesterdayWarning.date, isDayOff: true }),
      });
    } catch { /* ignore */ }
  };

  const editYesterdayTimesheet = () => {
    const targetDate = yesterdayWarning.date;
    dismissYesterdayWarning();
    setAttendanceEditDate(targetDate);
    setViewMode('attendance');
  };


  useEffect(() => {
    const updateAppearance = (event: Event) => setAppearance((event as CustomEvent<WorkspaceAppearance>).detail || readWorkspaceAppearance());
    const returnHomeFromLogo = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('img[src="/logo.png"], img[src$="/logo.png"]')) setViewMode('workspace');
    };
    window.addEventListener('ft-appearance-change', updateAppearance);
    document.addEventListener('click', returnHomeFromLogo, true);
    return () => {
      window.removeEventListener('ft-appearance-change', updateAppearance);
      document.removeEventListener('click', returnHomeFromLogo, true);
    };
  }, []);

  useEffect(() => {
    const themeClasses = Object.keys(workspacePalettes).map(theme => `workspace-theme-${theme}`);
    const variables = workspaceAppearanceStyle(appearance) as Record<string, string>;
    document.body.classList.remove(...themeClasses);
    document.body.classList.add('workspace-app-theme', `workspace-theme-${appearance.theme}`);
    Object.entries(variables).forEach(([property, value]) => {
      if (property.startsWith('--')) document.body.style.setProperty(property, value);
    });
    return () => {
      document.body.classList.remove('workspace-app-theme', ...themeClasses);
      Object.keys(variables).forEach(property => {
        if (property.startsWith('--')) document.body.style.removeProperty(property);
      });
    };
  }, [appearance]);

  const setSocialTab = (tab: string) => {
    const requestedTab = (SOCIAL_TABS as readonly string[]).includes(tab) ? tab as SocialTab : 'dashboard';
    const nextTab = isGuest && (requestedTab === 'sync' || requestedTab === 'config') ? 'dashboard' : requestedTab;
    setActiveTab(nextTab);
    setViewModeState('social-dashboard');
    const path = socialPathFor(nextTab);
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  };

  useEffect(() => {
    if (authChecking || viewMode === 'workspace' || viewMode === 'training-assessment-public' || viewMode === 'competition-landing-public' || viewMode === 'qr-generator') return;
    if (!canAccessView(viewMode)) {
      setViewModeState('workspace');
      window.history.replaceState(null, '', '/');
      if (isGuest) {
        setAuthError('Vui lòng đăng nhập để truy cập mô-đun.');
        setShowLoginModal(true);
      } else {
        setAccessNotice('Tài khoản của bạn chưa được cấp quyền truy cập mô-đun này.');
      }
      return;
    }
    if (viewMode === 'social-dashboard' && isGuest && (activeTab === 'sync' || activeTab === 'config')) {
      setActiveTab('dashboard');
      window.history.replaceState(null, '', socialPathFor('dashboard'));
    }
  }, [activeTab, authChecking, canViewFinance, isGuest, user.accessModules, userRole, viewMode]);

  // The rail lists business domains; the Workspace launcher is always reachable.
  const canAccessArea = (area: WorkspaceArea) => area.id === 'workspace' || canAccessView(area.id as ViewMode);
  const openArea = (area: WorkspaceArea) => {
    if (area.id === 'workspace') { setViewMode('workspace'); return; }
    openProtectedView(area.id as ViewMode, area.id === 'social-dashboard' ? 'dashboard' : undefined);
  };

  // The tools area shares one horizontal menu across all of its screens.
  const communicationToolsNav = COMMUNICATION_TOOLS_NAV
    .filter(item => item.id === 'communication-tools' || canAccessView(item.id as ViewMode));

  const openProtectedView = (mode: ViewMode, tab?: string) => {
    if (!canAccessView(mode)) {
      if (isGuest) { setAuthError('Vui lòng đăng nhập để truy cập mô-đun.'); setShowLoginModal(true); }
      else setAccessNotice('Tài khoản của bạn chưa được cấp quyền truy cập mô-đun này.');
      return;
    }
    if (mode === 'social-dashboard' && tab) { setSocialTab(tab); return; }
    setViewMode(mode);
  };
  const handleCredentialsAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Đăng nhập thất bại.');

      const token = String(body.token || '');
      const nextUser = userFromApi(body.user);
      const nextRole = (body.user?.role || 'EMPLOYEE') as UserRole;
      if (!token || !nextUser.email) throw new Error('Máy chủ trả về phiên đăng nhập không hợp lệ.');

      setIdToken(token);
      setUser(nextUser);
      setUserRole(nextRole);
      persistSession(token, nextUser, nextRole);
      setLoginPassword('');
      setShowLoginModal(false);
    } catch (error: any) {
      setAuthError(error.message || 'Đăng nhập thất bại.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    const token = idToken;
    clearSession();
    setIdToken(null);
    setUser(GUEST_USER);
    setUserRole('EMPLOYEE');
    setChannels([]);
    setViewMode('workspace');
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
  };

  const handleConnectGoogle = async () => {
    void appDialog.alert('Tính năng kết nối Google Sheets hiện chưa sẵn sàng.', { title: 'Kết nối Google Sheets', tone: 'info' });
    return false;
  };

  const handleRefreshChannels = async () => {
    if (!canAccessView('social-dashboard')) { setChannels([]); return; }
    const headers: HeadersInit = {};
    if (idToken) {
      headers['Authorization'] = `Bearer ${idToken}`;
    }
    const response = await fetch('/api/channels', { headers });
    if (response.status === 401) {
      if (idToken) {
        await handleLogout();
      }
      return;
    }
    if (!response.ok) throw new Error('Không thể tải danh sách kênh.');
    const list = await response.json();
    setChannels(Array.isArray(list) ? list : []);
  };

  useEffect(() => {
    setLoading(true);
    handleRefreshChannels()
      .catch(error => console.error('Lỗi lấy danh sách kênh:', error))
      .finally(() => setLoading(false));
  }, [idToken]);

  const openAccount = () => {
    if (isGuest) { setAuthError(''); setShowLoginModal(true); return; }
    setShowProfile(true);
  };

  const handleProfileSaved = (nextUser: AppUser) => {
    setUser(nextUser);
    if (idToken) persistSession(idToken, nextUser, userRole);
  };

  const handlePasswordChanged = (nextToken: string, nextUser: AppUser) => {
    setIdToken(nextToken);
    setUser(nextUser);
    persistSession(nextToken, nextUser, userRole);
  };
  const loginModal = (
    <LoginModal
      open={showLoginModal}
      onClose={() => setShowLoginModal(false)}
      onSubmit={handleCredentialsAuth}
      email={loginEmail}
      password={loginPassword}
      setEmail={setLoginEmail}
      setPassword={setLoginPassword}
      loading={authLoading}
      error={authError}
    />
  );

  const profileModal = (
    <AccountProfileModal open={showProfile} user={user} idToken={idToken} onClose={() => setShowProfile(false)} onSaved={handleProfileSaved} onTokenChanged={handlePasswordChanged}/>
  );
  const renderContent = (): React.ReactNode => {
  if (authChecking) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-violet-600 shadow-lg animate-pulse" />
          <p className="text-sm font-semibold text-slate-500">Đang kiểm tra phiên đăng nhập...</p>
        </div>
      </div>
    );
  }

  if (viewMode === 'workspace') {
    const apps: Array<{ mode: ViewMode; title: string; description: string; gradient: string; icon: React.ElementType }> = [
      {
        mode: 'work-schedule',
        title: 'Lịch làm việc',
        description: 'Lập lịch cá nhân, quản lý nhiệm vụ và theo dõi công việc của đội nhóm.',
        gradient: 'from-[#0055DA] to-[#00A6E8]',
        icon: CalendarRange,
      },
      {
        mode: 'examination',
        title: 'Khảo thí',
        description: 'Quản lý cuộc thi, kỳ tổ chức, thí sinh và nguồn dữ liệu Google Sheets.',
        gradient: 'from-[#00C68D] to-[#008f68]',
        icon: ClipboardList,
      },
      {
        mode: 'digital-training',
        title: 'Công nghệ & đào tạo số',
        description: 'Quản lý lịch gặp khách hàng, nội dung đào tạo chuyển đổi số và ứng dụng AI.',
        gradient: 'from-[#0055DA] to-[#00C68D]',
        icon: GraduationCap,
      },
      {
        mode: 'social-dashboard',
        title: 'Truyền thông',
        description: 'Theo dõi Facebook, Zalo OA, báo cáo tương tác và đồng bộ dữ liệu.',
        gradient: 'from-[#0055DA] to-[#0042AD]',
        icon: ChartColumnBig,
      },
      {
        mode: 'communication-tools',
        title: 'Bộ công cụ FermatTech',
        description: 'Thiết kế Email, tạo chữ ký và mã QR trong một không gian công cụ chung.',
        gradient: 'from-[#FF0052] via-[#8B5CF6] to-[#0055DA]',
        icon: Megaphone,
      },
      {
        mode: 'training-assessments',
        title: 'Bài kiểm tra cuối khóa tập huấn',
        description: 'Chia mã đề cân bằng, đặt thời gian, chấm điểm và theo dõi kết quả tập huấn.',
        gradient: 'from-[#001E40] to-[#0055DA]',
        icon: FileCheck2,
      },
    ];
    if (userRole === 'ADMIN') {
      apps.push({
        mode: 'account-management',
        title: 'Quản lý nhân viên',
        description: 'Tạo, phân quyền và quản lý thành viên Workspace.',
        gradient: 'from-[#101114] to-[#0055DA]',
        icon: ShieldUser,
      });
    }

    if (canViewFinance) {
      apps.push({
        mode: 'finance-report',
        title: 'Báo cáo thu chi',
        description: 'Theo dõi tổng thu, tổng chi, công nợ, chứng từ và tình trạng xử lý tài chính.',
        gradient: 'from-[#0F766E] to-[#0055DA]',
        icon: BadgeDollarSign,
      });
    }

    apps.push({
      mode: 'attendance',
      title: 'Công ca',
      description: 'Ghi nhận giờ vào, giờ ra và theo dõi dữ liệu công ca theo tháng.',
      gradient: 'from-[#173F30] to-[#4E9B73]',
      icon: CalendarCheck,
    });

    const visibleApps = apps.filter(app => canAccessView(app.mode));
    return (
      <div className={`workspace-theme workspace-theme-${appearance.theme} min-h-dvh liquid-bg flex flex-col font-sans relative overflow-x-hidden`} style={workspaceAppearanceStyle(appearance)}>
        <header className="sticky top-0 z-30 w-full glass-panel border-b border-white/50">
          <div className="workspace-header-inner relative mx-auto max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 shrink-0 items-center">
              <img src="/logo.png" alt="FermatTech Logo" className="workspace-brand-logo" />
            </div>
            <div className="workspace-title-block">
              <p className="workspace-title-eyebrow">Không gian làm việc</p>
              <h1 className="workspace-title text-sm font-extrabold tracking-tight sm:text-lg lg:text-2xl">
                <span className="workspace-title-prefix">Không gian làm việc </span>
                <span className="ft-gradient-text">FermatTech Workspace</span>
              </h1>
            </div>
            <div className="workspace-header-actions">
              {!isGuest && <WorkspaceNotifications token={idToken} />}
              <AccountMenu
                userName={user.displayName}
                userRole={userRole}
                photoURL={user.photoURL}
                isGuest={isGuest}
                onAccountClick={openAccount}
                onLogin={() => { setAuthError(''); setShowLoginModal(true); }}
                onLogout={handleLogout}
                variant="header"
              />
            </div>
          </div>
        </header>

        <main className="z-10 mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {yesterdayWarning.show && (
            <div className="fixed inset-0 z-[11000] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm">
              <div role="alertdialog" aria-modal="true" aria-labelledby="timesheet-warning-title" className="w-full max-w-xl overflow-hidden rounded-3xl border border-amber-200 bg-white shadow-2xl">
                <div className="flex items-start gap-4 border-b border-amber-100 bg-amber-50 px-6 py-5">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-700">
                    <TriangleAlert className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 id="timesheet-warning-title" className="text-lg font-extrabold text-amber-950">Bạn chưa cập nhật công ca cho ngày {fmtDDMMYYYY(yesterdayWarning.date)}</h3>
                    <p className="mt-1 text-sm leading-6 text-amber-800">Vui lòng cập nhật công ca để đảm bảo dữ liệu chấm công chính xác. Bạn cần chọn một thao tác bên dưới để tiếp tục.</p>
                  </div>
                </div>
                <div className="px-6 py-5">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                    <input type="checkbox" checked={dismissPermanent} onChange={e => setDismissPermanent(e.target.checked)} className="h-3.5 w-3.5 rounded border-amber-400" />
                    Không nhắc lại cảnh báo này
                  </label>
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <button type="button" autoFocus onClick={editYesterdayTimesheet} className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow transition hover:bg-blue-700">
                      <CalendarDays className="h-5 w-5" /><span>Cập nhật ngay</span>
                    </button>
                    <button type="button" onClick={() => void markYesterdayDayOff()} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow transition hover:bg-emerald-700">
                      <Moon className="h-5 w-5" /><span>Hôm qua tôi nghỉ</span>
                    </button>
                    <button type="button" onClick={dismissYesterdayWarning} className="flex items-center justify-center gap-2 rounded-xl bg-slate-600 px-4 py-3 text-sm font-bold text-white shadow transition hover:bg-slate-700">
                      <TriangleAlert className="h-5 w-5" /><span>Bỏ qua</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {accessNotice && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:col-span-2 lg:col-span-3">{accessNotice}</div>}
            {visibleApps.map(app => {
              const AppIcon = app.icon;
              return (
                <button
                  key={app.mode}
                  type="button"
                  onClick={() => openProtectedView(app.mode, app.mode === 'social-dashboard' ? 'dashboard' : undefined)}
                  className="glass-card p-7 rounded-3xl text-left group min-h-[210px] flex flex-col justify-between"
                >
                  <div>
                    <div className={`grid w-14 h-14 place-items-center rounded-2xl bg-gradient-to-tr ${app.gradient} shadow-lg mb-5`}><AppIcon className="h-7 w-7 text-white" /></div>
                    <h3 className="ft-heading ft-heading-sm">{app.title}</h3>
                    <p className="workspace-muted ft-body-sm mt-2 leading-relaxed">{app.description}</p>
                  </div>
                  <span className="workspace-accent pt-5 text-sm font-semibold">{'Truy cập ứng dụng →'}</span>
                </button>
              );
            })}
          </div>
        </main>
        {loginModal}{profileModal}
      </div>
    );
  }

  if (viewMode === 'communication-tools' && !canAccessView('communication-tools')) return null;

  if (viewMode === 'communication-tools') {
    const tools = [
      { mode: 'email-builder' as ViewMode, title: 'Thiết kế Email', description: 'Tạo, quản lý mẫu Email và chữ ký dùng chung.', icon: Mail, color: 'from-pink-500 to-violet-600', allowed: canAccessView('email-builder') },
      { mode: 'signature-builder' as ViewMode, title: 'Tạo chữ ký Email', description: 'Tùy biến thông tin, mạng xã hội và sao chép chữ ký dùng cho Gmail hoặc Outlook.', icon: ContactRound, color: 'from-[#104581] to-[#1473D1]', allowed: canAccessView('signature-builder') },
      { mode: 'qr-generator' as ViewMode, title: 'Tạo mã QR', description: 'Tạo mã QR, kiểm tra đường dẫn và xuất poster truyền thông.', icon: QrCode, color: 'from-blue-600 to-cyan-500', allowed: canAccessView('qr-generator') },
      { mode: 'funding-proposal' as ViewMode, title: 'Phiếu đề xuất kinh phí', description: 'Nhập dự toán, xem trước bản in A4 và tải phiếu Word để trình ký.', icon: ReceiptText, color: 'from-emerald-600 to-teal-500', allowed: canAccessView('funding-proposal') },
      { mode: 'document-number' as ViewMode, title: 'Trình tạo số Công văn', description: 'Lấy số văn bản mới nhất theo loại và ghi thẳng vào sổ trên Google Sheets.', icon: FileSignature, color: 'from-[#0055DA] to-[#00C68D]', allowed: canAccessView('document-number') },
      { mode: 'competition-landing' as ViewMode, title: 'Trang giới thiệu cuộc thi', description: 'Dựng trang giới thiệu công khai cho cuộc thi, lịch thi và số liệu lấy từ Khảo thí.', icon: Presentation, color: 'from-[#001E40] to-[#0055DA]', allowed: canAccessView('competition-landing') },
    ].filter(tool => tool.allowed);
    const upcomingTools: Array<{ key: string; title: string; description: string; icon: typeof QrCode; color: string }> = [];
    return (
      <div className="ft-module-shell flex min-h-dvh flex-col bg-slate-50 font-sans">
        <ModuleShellHeader
          title="Bộ công cụ FermatTech"
          items={communicationToolsNav}
          activeId="communication-tools"
          onSelect={id => setViewMode(id as ViewMode)}
          ariaLabel="Điều hướng bộ công cụ FermatTech"
          account={<AccountMenu userName={user.displayName} userRole={userRole} photoURL={user.photoURL} isGuest={isGuest} onAccountClick={openAccount} onLogout={handleLogout} variant="avatar" />}
        />
        <main className="min-w-0 flex-1">
          <div className="ft-module-content mx-auto p-5 md:p-8">
            <div className="mb-7 max-w-2xl">
              <h2 className="text-3xl font-extrabold text-[#001e40]">Bạn muốn tạo gì?</h2>
              <p className="mt-2 text-slate-500">Các công cụ phục vụ thiết kế và phân phối nội dung truyền thông được gom vào một nơi.</p>
            </div>
            <div className="grid max-w-6xl gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {tools.map(tool => { const Icon = tool.icon; return <button key={tool.mode} type="button" onClick={() => setViewMode(tool.mode)} className="group rounded-3xl border border-slate-200 bg-white p-7 text-left shadow-sm transition hover:-translate-y-1 hover:border-blue-300 hover:shadow-xl"><span className={`grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br ${tool.color} text-white shadow-lg`}><Icon className="h-7 w-7" /></span><h3 className="mt-5 text-xl font-extrabold text-slate-900">{tool.title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{tool.description}</p><span className="mt-6 block text-sm font-bold text-blue-600">Mở công cụ →</span></button>; })}
              {upcomingTools.map(tool => { const Icon = tool.icon; return <div key={tool.key} aria-disabled="true" className="relative rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 p-7 text-left"><span className="absolute right-5 top-5 rounded-full bg-amber-100 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide text-amber-700">Sắp ra mắt</span><span className={`grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br ${tool.color} text-white opacity-60 shadow-inner`}><Icon className="h-7 w-7" /></span><h3 className="mt-5 text-xl font-extrabold text-slate-500">{tool.title}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{tool.description}</p><span className="mt-6 block text-sm font-bold text-slate-400">Đang phát triển</span></div>; })}
            </div>
          </div>
        </main>
        {loginModal}{profileModal}
      </div>
    );
  }

  if (viewMode === 'finance-report' && !canAccessView('finance-report')) return null;

  if (viewMode === 'work-schedule' && !canAccessView('work-schedule')) return null;

  if (viewMode === 'work-schedule') {
    return (
      <>
        <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-50">Đang nạp Lịch làm việc...</div>}>
          <WorkSchedule
            idToken={idToken || ''}
            onBackToWorkspace={() => setViewMode('workspace')}
            onAccountClick={openAccount}
            onLogout={handleLogout}
            userName={user.displayName}
            userEmail={user.email}
            userRole={userRole}
            photoURL={user.photoURL}
          />
        </Suspense>
        {loginModal}{profileModal}
      </>
    );
  }

  if (viewMode === 'finance-report') {
    return (
      <>
        <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-50">Đang nạp Báo cáo thu chi...</div>}>
          <FinanceWorkspace
            onBackToWorkspace={() => setViewMode('workspace')}
            onAccountClick={openAccount}
            onLogout={handleLogout}
            userName={user.displayName}
            userRole={userRole}
            photoURL={user.photoURL}
            idToken={idToken || ''}
            canEdit={canEditFinance}
          />
        </Suspense>
        {loginModal}{profileModal}
      </>
    );
  }

  if (viewMode === 'account-management') {
    if (userRole !== 'ADMIN') return null;
    return (
      <>
        <div className="ft-module-shell flex min-h-dvh flex-col font-sans">
          <ModuleShellHeader
            eyebrow="Quản trị Workspace"
            title="Quản lý nhân viên"
            items={ACCOUNT_MANAGEMENT_NAV}
            activeId="employees"
            onSelect={() => undefined}
            ariaLabel="Điều hướng Quản lý nhân viên"
            account={<AccountMenu userName={user.displayName} userRole={userRole} photoURL={user.photoURL} isGuest={isGuest} onAccountClick={openAccount} onLogout={handleLogout} variant="avatar" />}
          />
          <main className="min-w-0 flex-1">
            <div className="ft-module-content mx-auto p-5 md:p-7"><Suspense fallback={<div className="py-16 text-center text-sm text-slate-500">Đang tải quản lý nhân viên...</div>}><AccountManagement idToken={idToken || ''} userRole={userRole} /></Suspense></div>
          </main>
        </div>
        {loginModal}{profileModal}
      </>
    );
  }

  if (viewMode === 'competition-landing-public') {
    const slug = window.location.pathname.replace(/^\/cuoc-thi\//, '').split('/')[0];
    return (
      <Suspense fallback={<div className="grid min-h-dvh place-items-center bg-slate-50 text-sm font-semibold text-slate-500">Đang mở trang giới thiệu...</div>}>
        <CompetitionLandingPublic slug={slug} />
      </Suspense>
    );
  }

  if (viewMode === 'training-assessment-public') {
    const slug = window.location.pathname.replace(/^\/training-assessment\//, '').split('/')[0];
    return (
      <Suspense fallback={<div className="grid min-h-screen place-items-center bg-slate-50">Đang mở bài đánh giá...</div>}>
        <TrainingAssessmentPublic slug={slug} idToken={idToken || ''} />
      </Suspense>
    );
  }

  if (viewMode === 'training-assessments' && !canAccessView('training-assessments')) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 p-6 text-slate-800">
        <div className="w-full max-w-xl rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-extrabold text-[#001e40]">Chưa thể mở Bài kiểm tra cuối khóa tập huấn</h1>
          <p className="mt-2 text-sm text-slate-600">
            {authChecking ? 'Đang kiểm tra quyền truy cập…' : isGuest ? 'Vui lòng đăng nhập để truy cập mô-đun này.' : 'Tài khoản của bạn chưa được cấp quyền Đào tạo số.'}
          </p>
          <button onClick={() => setViewMode('workspace')} className="mt-5 ft-btn ft-btn-secondary">Quay lại Workspace</button>
        </div>
        {loginModal}{profileModal}
      </div>
    );
  }

  if (viewMode === 'training-assessments') {
    return (
      <>
        <Suspense fallback={<div className="grid min-h-screen place-items-center bg-slate-50">Đang mở Bài kiểm tra cuối khóa tập huấn...</div>}>
          <TrainingAssessmentWorkspace
            onBackToWorkspace={() => setViewMode('workspace')}
            onOpenDigitalTraining={() => setViewMode('digital-training')}
            onAccountClick={openAccount}
            onLogout={handleLogout}
            userName={user.displayName}
            userRole={userRole}
            photoURL={user.photoURL}
            idToken={idToken || ''}
          />
        </Suspense>
        {loginModal}{profileModal}
      </>
    );
  }

  if (viewMode === 'competition-landing') {
    return (
      <div className="ft-module-shell flex min-h-dvh flex-col bg-slate-50 font-sans">
        <ModuleShellHeader
          eyebrow="Bộ công cụ FermatTech"
          title="Trang giới thiệu cuộc thi"
          items={communicationToolsNav}
          activeId="competition-landing"
          onSelect={id => setViewMode(id as ViewMode)}
          ariaLabel="Điều hướng bộ công cụ FermatTech"
          account={<AccountMenu userName={user.displayName} userRole={userRole} photoURL={user.photoURL} isGuest={isGuest} onAccountClick={openAccount} onLogout={handleLogout} variant="avatar" />}
        />
        <main className="ft-module-content mx-auto max-w-7xl p-5 md:p-8">
          <Suspense fallback={<div className="py-16 text-center text-sm font-semibold text-slate-500">Đang nạp công cụ...</div>}>
            <CompetitionLandingManager idToken={idToken || ''} />
          </Suspense>
        </main>
        {loginModal}{profileModal}
      </div>
    );
  }

  if (viewMode === 'qr-generator') {
    return (
      <Suspense fallback={<div className="grid h-screen place-items-center bg-[#f7f4ee]">Đang nạp Trình tạo mã QR...</div>}>
        <QRCodeGenerator
          onBackToWorkspace={() => setViewMode('communication-tools')}
          backLabel="Bộ công cụ FermatTech"
          navItems={communicationToolsNav}
          onNavSelect={id => setViewMode(id as ViewMode)}
        />
      </Suspense>
    );
  }

  if (viewMode === 'funding-proposal' && !canAccessView('funding-proposal')) return null;

  if (viewMode === 'funding-proposal') {
    return (
      <>
        <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-50">Đang nạp Phiếu đề xuất kinh phí...</div>}>
          <FundingProposalBuilder
            idToken={idToken || ''}
            userName={user.displayName}
            userRole={userRole}
            photoURL={user.photoURL}
            onAccountClick={openAccount}
            onLogout={handleLogout}
            onNavSelect={id => setViewMode(id as ViewMode)}
          />
        </Suspense>
        {loginModal}{profileModal}
      </>
    );
  }

  if (viewMode === 'document-number' && !canAccessView('document-number')) return null;

  if (viewMode === 'document-number') {
    return (
      <>
        <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-50">Đang nạp Trình tạo số Công văn...</div>}>
          <DocumentNumberGenerator
            idToken={idToken || ''}
            userName={user.displayName}
            userRole={userRole}
            photoURL={user.photoURL}
            onAccountClick={openAccount}
            onLogout={handleLogout}
            onNavSelect={id => setViewMode(id as ViewMode)}
          />
        </Suspense>
        {loginModal}{profileModal}
      </>
    );
  }

  if (viewMode === 'attendance' && isGuest) return null;

  if (viewMode === 'attendance') {
    return (
      <Suspense fallback={<div className="grid h-screen place-items-center bg-[#f3f5f1]">Đang nạp mô-đun Công ca...</div>}>
        <Attendance
          idToken={idToken || ''}
          userName={user.displayName}
          userEmail={user.email}
          userRole={userRole}
          photoURL={user.photoURL}
          onAccountClick={openAccount}
          onLogout={handleLogout}
          initialEditDate={attendanceEditDate}
          onInitialEditOpened={() => setAttendanceEditDate('')}
        />
      </Suspense>
    );
  }

  if (viewMode === 'signature-builder' && !canAccessView('signature-builder')) return null;

  if (viewMode === 'signature-builder') {
    return <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-50">Đang nạp Trình tạo chữ ký...</div>}><SignatureBuilder onBack={() => setViewMode('communication-tools')} userName={user.displayName} userEmail={user.email} jobTitle={user.jobTitle?.name} /></Suspense>;
  }

  if (viewMode === 'email-builder' && !canAccessView('email-builder')) return null;

  if (viewMode === 'email-builder') {
    return (
      <>
        <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-50">Đang nạp Trình tạo Email...</div>}>
          <EmailTemplateBuilder
            onBackToWorkspace={() => setViewMode('communication-tools')}
            backLabel="Bộ công cụ FermatTech"
            onAccountClick={openAccount}
            onLogout={handleLogout}
            isGuest={isGuest}
            userName={user.displayName}
            userRole={userRole}
            photoURL={user.photoURL}
            userEmail={user.email}
            onOpenSignatureBuilder={() => setViewMode('signature-builder')}
            navItems={communicationToolsNav}
            onNavSelect={id => setViewMode(id as ViewMode)}
          />
        </Suspense>
        {loginModal}{profileModal}
      </>
    );
  }

  if (viewMode === 'digital-training' && !canAccessView('digital-training')) return null;

  if (viewMode === 'digital-training') {
    return (
      <>
        <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-50">Đang nạp mô-đun Công nghệ & đào tạo số...</div>}>
          <DigitalTraining
            onBackToWorkspace={() => setViewMode('workspace')}
            onOpenTrainingAssessment={() => setViewMode('training-assessments')}
            onAccountClick={openAccount}
            onLogout={handleLogout}
            isGuest={isGuest}
            userName={user.displayName}
            userRole={userRole}
            photoURL={user.photoURL}
            jobTitle={user.jobTitle?.name}
            departmentNames={(user.departments || []).map((item) => item.name)}
            accessModules={user.accessModules || []}
            idToken={idToken || ''}
          />
        </Suspense>
        {loginModal}{profileModal}
      </>
    );
  }

  if (viewMode === 'examination' && !canAccessView('examination')) return null;

  if (viewMode === 'examination') {
    return (
      <>
        <ExaminationErrorBoundary>
          <Suspense fallback={<div className="grid h-screen place-items-center bg-slate-50">Đang nạp mô-đun Khảo thí...</div>}>
            <ExaminationModule
              onBackToWorkspace={() => setViewMode('workspace')}
              userName={user.displayName}
              userEmail={user.email}
              photoURL={user.photoURL}
              idToken={idToken}
              googleAccessToken={googleAccessToken}
              userRole={userRole}
              isGuest={isGuest}
              onAccountClick={openAccount}
              onLogout={handleLogout}
            />
          </Suspense>
        </ExaminationErrorBoundary>
        {loginModal}{profileModal}
      </>
    );
  }

  if (!canAccessView('social-dashboard')) return null;
  if (isGuest && (activeTab === 'sync' || activeTab === 'config')) return null;

  return (
    <div className="ft-module-shell flex h-screen flex-col overflow-hidden font-sans">
      <ModuleShellHeader
        title="Truyền thông"
        items={filterModuleNav(SOCIAL_DASHBOARD_NAV, { member: !isGuest })}
        activeId={activeTab}
        onSelect={setSocialTab}
        ariaLabel="Điều hướng Truyền thông"
        account={<AccountMenu userName={user.displayName} userRole={userRole} photoURL={user.photoURL} isGuest={isGuest} onAccountClick={openAccount} onLogin={() => { setAuthError(''); setShowLoginModal(true); }} onLogout={handleLogout} variant="avatar" />}
      />
      <main className="flex-1 overflow-y-auto"><div className="ft-module-content px-5 py-6 md:px-7 md:py-7">
        {loading ? (
          <div className="grid h-full place-items-center text-sm font-semibold text-slate-500">Đang tải dữ liệu...</div>
        ) : (
          <div className="max-w-[1600px] mx-auto">
            <Suspense fallback={<div className="grid min-h-[60vh] place-items-center text-sm font-semibold text-slate-500">Đang tải mô-đun...</div>}>
              {activeTab === 'dashboard' && (
                <Dashboard idToken={idToken || ''} googleAccessToken={googleAccessToken} channels={channels} onOpenConfig={() => setActiveTab('config')} />
              )}
              {activeTab === 'media' && <MediaSummary idToken={idToken || ''} channels={channels} />}
              {activeTab === 'posts' && <Posts idToken={idToken || ''} channels={channels} />}
              {activeTab === 'sync' && (
                <Sync
                  idToken={idToken || ''}
                  googleAccessToken={googleAccessToken}
                  channels={channels}
                  userRole={userRole}
                  onRefreshChannels={handleRefreshChannels}
                  onConnectGoogle={handleConnectGoogle}
                />
              )}
              {activeTab === 'config' && (
                <Config
                  idToken={idToken || ''}
                  googleAccessToken={googleAccessToken}
                  userRole={userRole}
                  onConnectGoogle={handleConnectGoogle}
                  showUserManagement={false}
                  onChannelsChanged={handleRefreshChannels}
                />
              )}
            </Suspense>
          </div>
        )}
      </div>
      </main>
      {loginModal}{profileModal}
    </div>
  );
  };

  // The launcher already lists every application, so it carries no rail; public
  // landing pages and the session splash stay chrome-free too. Every other
  // screen gets the shared vertical rail so modules are one click apart.
  const content = renderContent();
  const chromeLessViews: ViewMode[] = ['workspace', 'competition-landing-public', 'training-assessment-public'];
  if (authChecking || chromeLessViews.includes(viewMode)) return content;
  return (
    <WorkspaceAreaFrame
      activeAreaId={areaForView(viewMode)}
      canAccess={canAccessArea}
      onSelect={openArea}
    >
      {content}
    </WorkspaceAreaFrame>
  );
}
