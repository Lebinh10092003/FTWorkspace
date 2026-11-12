import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Smartphone,
  X,
  Compass,
  ArrowRight,
  Monitor,
  Calendar,
  Clock,
  FileText,
  Share2,
  Users,
  Bot,
  ShieldCheck,
  ChevronRight,
  Search,
  Sliders,
  ExternalLink,
  RotateCcw,
  Sparkles,
  Volume2,
  Eye,
  Info,
  Layers,
  ArrowLeft,
  ChevronDown,
  Send,
  MessageSquare,
  Wifi,
  Battery,
  LayoutGrid,
  GraduationCap,
  Wallet,
  Wrench,
  Settings
} from 'lucide-react';

export interface OfficeSmartphoneGuideProps {
  onNavigate2D: () => void;
  onOpenDesktopOS: () => void;
  onOpenDesktopApp?: (appId: string) => void;
  onOpenAppsDrawer?: () => void;
  onCallBot?: () => void;
  onTriggerPatrol?: () => void;
  onFocus3DZone?: (zone: string) => void;
  onlineCount?: number;
  workingCount?: number;
  idleCount?: number;
  onOpenRoster?: () => void;
  canAccessView: (mode: string) => boolean;
  onNavigateModule: (mode: string) => void;
}

interface MappingItem {
  id: string;
  title2D: string;
  desc2D: string;
  icon: any;
  color: string;
  location3D: string;
  guide3D: string;
  targetMode?: string;
  zone3D?: string;
  osAppId?: string;
  specialAction?: 'os' | 'bot' | 'patrol' | 'roster';
}

const MAPPING_ITEMS: MappingItem[] = [
  {
    id: 'desks',
    title2D: 'Bàn làm việc & Công việc',
    desc2D: 'Xem việc cần làm, lịch làm việc cá nhân & xử lý công văn',
    icon: Monitor,
    color: 'from-blue-500 to-indigo-600',
    location3D: 'Bàn làm việc của bạn (Desks Area)',
    guide3D: 'Nhấp trực tiếp vào màn hình máy tính 3D trên bàn làm việc hoặc bấm "FermatOS" để mở hệ điều hành ảo với AI Chat, Khảo thí và Báo cáo.',
    zone3D: 'desks',
    osAppId: 'assistant',
    specialAction: 'os'
  },
  {
    id: 'attendance',
    title2D: 'Điểm danh & Chấm công',
    desc2D: 'Khai báo công ca trực tiếp/online, kiểm tra bảng công tháng',
    icon: Clock,
    color: 'from-emerald-500 to-teal-600',
    location3D: 'Trạm chấm công ở Cửa chính (Entrance Station)',
    guide3D: 'Nằm ngay lối vào chính của văn phòng 3D hoặc mở trực tiếp Trạm Chấm Công & Công Ca trong FermatOS.',
    zone3D: 'home',
    targetMode: 'attendance',
    osAppId: 'attendance',
    specialAction: 'os'
  },
  {
    id: 'exam',
    title2D: 'Khảo thí & Ngân hàng đề',
    desc2D: 'Tổ chức ca thi, nhập điểm, tạo đề thi tự động & coi thi trực tuyến',
    icon: FileText,
    color: 'from-purple-500 to-violet-600',
    location3D: 'Phòng ban Khảo thí & Ứng dụng Khảo thí trong FermatOS',
    guide3D: 'Khu vực cụm bàn Khảo thí góc phía trong, hoặc mở app "Khảo thí" trong FermatOS trên bàn làm việc.',
    zone3D: 'desks',
    targetMode: 'examination',
    osAppId: 'examination',
    specialAction: 'os'
  },
  {
    id: 'weekly-report',
    title2D: 'Báo cáo tuần & Lịch làm việc',
    desc2D: 'Báo cáo tiến độ cuối tuần, lịch họp phòng ban & giao ban',
    icon: Calendar,
    color: 'from-amber-500 to-orange-600',
    location3D: 'Bảng tin treo tường & App Báo cáo trong FermatOS',
    guide3D: 'Bảng thông báo lớn trên tường văn phòng và ứng dụng Báo cáo tuần tích hợp ngay trong máy tính bàn 3D.',
    zone3D: 'meeting',
    targetMode: 'communication-tools/weekly-report',
    osAppId: 'weekly-report',
    specialAction: 'os'
  },
  {
    id: 'publishing',
    title2D: 'Truyền thông & Đăng bài AI',
    desc2D: 'Publishing Center, tổ hợp 5 Bot AI Khảo thí & tin tức tự động',
    icon: Share2,
    color: 'from-rose-500 to-pink-600',
    location3D: 'Phòng Công nghệ & Cụm máy trạm Studio AI',
    guide3D: 'Phòng công nghệ phía sau vách kính, nơi các bot AI xử lý bài đăng và trợ lý ảo làm việc liên tục.',
    zone3D: 'server',
    targetMode: 'social-dashboard',
    osAppId: 'social-dashboard',
    specialAction: 'os'
  },
  {
    id: 'roster',
    title2D: 'Danh sách Đồng nghiệp & Hiện diện',
    desc2D: 'Xem ai đang làm việc, ai đang nghỉ ngơi (Idle) và vị trí ngồi',
    icon: Users,
    color: 'from-sky-500 to-cyan-600',
    location3D: 'Các nhân vật 3D ngồi tại bàn thật',
    guide3D: 'Mỗi đồng nghiệp online hiển thị bằng avatar 3D ngồi tại bàn. Đèn xanh là Đang làm việc, đèn vàng "Zzz" là Tạm vắng/Nghỉ ngơi 5 phút.',
    specialAction: 'roster'
  },
  {
    id: 'bot-patrol',
    title2D: 'Robot AI & Giám đốc tuần tra đa phòng',
    desc2D: 'Hiệu ứng sinh động trong không gian 3D',
    icon: Bot,
    color: 'from-indigo-500 to-cyan-500',
    location3D: 'Hành lang & Toàn bộ các phòng ban',
    guide3D: 'Các nhân vật Bot AI làm việc dưới dạng Robot 3D, và Giám đốc sẽ tự động đi tuần tra định kỳ qua các phòng ban.',
    specialAction: 'bot'
  }
];

export default function OfficeSmartphoneGuide({
  onNavigate2D,
  onOpenDesktopOS,
  onOpenAppsDrawer,
  onCallBot,
  onTriggerPatrol,
  onFocus3DZone,
  onlineCount = 0,
  workingCount = 0,
  idleCount = 0,
  onOpenRoster,
  canAccessView,
  onNavigateModule,
  onOpenDesktopApp,
}: OfficeSmartphoneGuideProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'apps' | 'chat' | 'controls' | 'guide'>('apps');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedHint, setCopiedHint] = useState<string | null>(null);

  // 2-Way Interactive AI Chat State
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; sender: 'user' | 'bot'; text: string; time: string }>>([
    {
      id: 'm1',
      sender: 'bot',
      text: '🤖 Chào bạn! Tôi là Robot AI FermatTech. Tôi có thể hỗ trợ điều phối công việc, xem lịch làm việc hoặc di chuyển tới bàn làm việc của bạn trong văn phòng 3D.',
      time: '09:41'
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isBotTyping, setIsBotTyping] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeTab === 'chat') {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isBotTyping, activeTab]);

  const handleSendChatMessage = (textToSend?: string) => {
    const text = (textToSend || chatInput).trim();
    if (!text) return;
    const timeNow = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const userMsg = { id: `u_${Date.now()}`, sender: 'user' as const, text, time: timeNow };
    setChatMessages(prev => [...prev, userMsg]);
    if (!textToSend) setChatInput('');
    setIsBotTyping(true);

    setTimeout(() => {
      const lower = text.toLowerCase();
      let reply = '🤖 Tôi đã ghi nhận tin nhắn của bạn. Bạn có thể mở FermatOS trên bàn để thao tác chi tiết hoặc gọi tôi đến bàn!';

      if (lower.includes('triệu hồi') || lower.includes('gọi bot') || lower.includes('gọi robot') || lower.includes('đến bàn') || lower.includes('tới bàn')) {
        onCallBot?.();
        reply = '🚀 Nhận lệnh! Tôi đang khởi động động cơ phản lực và di chuyển tới bàn làm việc của bạn trong không gian 3D!';
      } else if (lower.includes('sếp') || lower.includes('giám đốc') || lower.includes('tuần tra')) {
        reply = '👔 Giám đốc tự động đi tuần tra định kỳ qua các phòng ban (Phòng họp, Studio AI, Tài nguyên, Pantry) trong văn phòng 3D!';
      } else if (lower.includes('toàn cảnh') || lower.includes('phòng họp') || lower.includes('máy chủ') || lower.includes('bàn làm việc')) {
        const zone = lower.includes('toàn cảnh') ? 'home' : lower.includes('phòng họp') ? 'meeting' : lower.includes('máy chủ') ? 'server' : 'desks';
        onFocus3DZone?.(zone);
        reply = `🎥 Đã lia camera 3D tới khu vực ${zone === 'home' ? 'Toàn cảnh' : zone === 'meeting' ? 'Phòng họp' : zone === 'server' ? 'Studio AI' : 'Bàn làm việc'}!`;
      } else if (lower.includes('lịch') || lower.includes('nhiệm vụ') || lower.includes('công tác')) {
        reply = '📅 Hôm nay hệ thống ghi nhận các nhiệm vụ chuẩn hóa ngân hàng đề thi và đối soát. Bạn có thể bấm vào Bảng tin 3D để xem!';
      }

      setChatMessages(prev => [
        ...prev,
        { id: `b_${Date.now()}`, sender: 'bot', text: reply, time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) }
      ]);
      setIsBotTyping(false);
    }, 600);
  };

  // Đồng hồ thời gian thực điện thoại
  const [currentTime, setCurrentTime] = useState(() => {
    const d = new Date();
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  });

  React.useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date();
      setCurrentTime(d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return MAPPING_ITEMS;
    return MAPPING_ITEMS.filter(
      item =>
        item.title2D.toLowerCase().includes(q) ||
        item.desc2D.toLowerCase().includes(q) ||
        item.location3D.toLowerCase().includes(q) ||
        item.guide3D.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const handleAction = (item: MappingItem) => {
    if (item.specialAction === 'os') {
      if (onOpenDesktopApp && item.osAppId) {
        onOpenDesktopApp(item.osAppId);
      } else {
        onOpenDesktopOS();
      }
      setIsOpen(false);
      setCopiedHint('Đã mở đúng ứng dụng trên Máy tính ảo Desktop OS!');
      setTimeout(() => setCopiedHint(null), 2500);
      return;
    }
    if (item.specialAction === 'roster') {
      onOpenRoster?.();
      setCopiedHint('Đã mở danh sách nhân sự văn phòng!');
      setTimeout(() => setCopiedHint(null), 2500);
      return;
    }
    if (item.specialAction === 'bot') {
      onCallBot?.();
      setCopiedHint('Đã phát tín hiệu gọi Robot AI tới bàn!');
      setTimeout(() => setCopiedHint(null), 2500);
      return;
    }
    if (item.zone3D && onFocus3DZone) {
      onFocus3DZone(item.zone3D);
      setCopiedHint(`Đã lia góc nhìn 3D tới: ${item.location3D}`);
      setTimeout(() => setCopiedHint(null), 2500);
      return;
    }
    if (item.targetMode) {
      onNavigateModule(item.targetMode);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {/* 1. NÚT DOCK GÓC DƯỚI BÊN PHẢI (ftPhone 16 Pro Pill Gọn Gàng, Đứng Cạnh Boxchat) */}
      {!isOpen && (
        <div
          className="pointer-events-auto fixed right-24 sm:right-24 z-[9000] flex items-center"
          style={{ bottom: 'max(16px, env(safe-area-inset-bottom, 16px))' }}
        >
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="group relative flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-slate-900/95 hover:bg-slate-800 border border-slate-700/80 shadow-[0_12px_36px_rgba(0,0,0,0.6)] backdrop-blur-xl hover:border-cyan-400/70 hover:scale-[1.03] active:scale-95 transition-all duration-200 cursor-pointer"
            title="Mở ftPhone 16 Pro Trợ lý & Ứng dụng Workspace"
          >
            <div className="relative flex items-center justify-center w-8 h-9 rounded-xl bg-gradient-to-b from-slate-800 to-black border border-slate-600/80 shadow-inner shrink-0">
              <div className="absolute top-1 w-3.5 h-1 rounded-full bg-black border border-slate-700" />
              <Smartphone className="w-4 h-4 text-cyan-400 mt-1" />
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500" />
              </span>
            </div>
            <div className="flex flex-col text-left leading-tight">
              <span className="text-xs font-bold text-slate-100 group-hover:text-cyan-300 transition-colors">
                ftPhone Trợ lý
              </span>
              <span className="text-[10px] text-slate-400 font-medium">
                ftOS 18 · {currentTime}
              </span>
            </div>
          </button>
        </div>
      )}

      {/* 2. KHUNG FTPHONE 16 PRO TITANIUM VỚI DYNAMIC ISLAND */}
      {isOpen && (
        <div
          className="pointer-events-auto fixed right-3 sm:right-6 z-[9001] w-[calc(100vw-1.5rem)] max-w-[385px] h-[640px] max-h-[calc(100vh-2rem)] rounded-[46px] border-[6px] border-slate-600/90 bg-[#070C16] shadow-[0_30px_90px_rgba(0,0,0,0.92)] flex flex-col overflow-hidden animate-in slide-in-from-bottom-6 fade-in duration-200 text-slate-100 font-sans"
          style={{ bottom: 'max(14px, env(safe-area-inset-bottom, 14px))' }}
        >
          {/* ftPhone 16 Pro Dynamic Island & Status Bar */}
          <div className="relative h-11 w-full bg-black flex items-center justify-between px-5 pt-1 shrink-0 select-none">
            <span className="text-[12px] font-bold text-slate-200 font-mono tracking-tight">{currentTime}</span>

            {/* Dynamic Island Pill */}
            <div className="h-7 px-3 rounded-full bg-black border border-slate-800/90 shadow-inner flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isBotTyping ? 'bg-amber-400 animate-ping' : 'bg-cyan-400 animate-pulse'}`} />
              <span className="text-[10px] font-semibold text-slate-200">
                {isBotTyping ? 'AI đang gõ...' : 'FT Assistant'}
              </span>
              <span className="w-2.5 h-2.5 rounded-full bg-slate-900 border border-slate-700/60" />
            </div>

            <div className="flex items-center gap-1.5 text-slate-300 text-xs">
              <Wifi className="w-3.5 h-3.5" />
              <span className="text-[10px] font-mono font-bold">5G</span>
              <Battery className="w-3.5 h-3.5 text-emerald-400" />
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="ml-1 rounded-full p-1 text-slate-400 hover:text-white transition cursor-pointer"
                title="Đóng điện thoại"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Header ftOS Navigation */}
          <div className="px-4 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#0B72CE] to-cyan-500 flex items-center justify-center text-white shadow-md">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-white flex items-center gap-1">
                  ftPhone 16 Pro · Fermat ftOS
                </h3>
                <p className="text-[10px] text-cyan-400 font-medium">Toàn bộ phân hệ & Trợ lý AI</p>
              </div>
            </div>
          </div>

          {/* Tabs ftOS Segmented Control */}
          <div className="grid grid-cols-4 bg-slate-950/90 border-b border-slate-800 p-1 text-[10px] font-semibold shrink-0 gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('apps')}
              className={`py-1.5 rounded-lg transition text-center cursor-pointer flex items-center justify-center gap-1 ${
                activeTab === 'apps'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutGrid className="w-3 h-3" />
              <span>Ứng dụng</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`py-1.5 rounded-lg transition text-center cursor-pointer flex items-center justify-center gap-1 ${
                activeTab === 'chat'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MessageSquare className="w-3 h-3" />
              <span>AI Chat</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('controls')}
              className={`py-1.5 rounded-lg transition text-center cursor-pointer flex items-center justify-center gap-1 ${
                activeTab === 'controls'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Compass className="w-3 h-3" />
              <span>Điều khiển</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('guide')}
              className={`py-1.5 rounded-lg transition text-center cursor-pointer flex items-center justify-center gap-1 ${
                activeTab === 'guide'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="w-3 h-3" />
              <span>Cẩm nang</span>
            </button>
          </div>

          {/* Toast thông báo hành động ngắn */}
          {copiedHint && (
            <div className="bg-emerald-600 text-white text-[11px] font-medium px-3 py-1 text-center shrink-0 animate-in fade-in">
              {copiedHint}
            </div>
          )}

          {/* Nội dung theo Tab */}
          <div className="flex-1 overflow-hidden font-sans flex flex-col">
            {/* TAB 0: ftOS HOME SCREEN APP GRID */}
            {activeTab === 'apps' && (
              <div className="flex-1 overflow-y-auto p-4 bg-gradient-to-b from-[#0b132b] via-[#101c3a] to-[#080d1e] flex flex-col justify-between">
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-300/90">
                      Kho ứng dụng Workspace
                    </span>
                    <span className="text-[10px] text-slate-400">ftOS 18.2</span>
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { id: 'assistant', label: 'Trợ lý AI', icon: Bot, bg: 'from-cyan-500 to-blue-600', mode: 'office' },
                      { id: 'examination', label: 'Khảo thí', icon: GraduationCap, bg: 'from-emerald-500 to-teal-600', mode: 'examination' },
                      { id: 'work-schedule', label: 'Lịch & Việc', icon: Calendar, bg: 'from-orange-500 to-rose-500', mode: 'work-schedule' },
                      { id: 'attendance', label: 'Công ca', icon: Clock, bg: 'from-amber-500 to-orange-600', mode: 'attendance' },
                      { id: 'weekly-report', label: 'Báo cáo', icon: FileText, bg: 'from-indigo-500 to-purple-600', mode: 'weekly-report' },
                      { id: 'social-dashboard', label: 'Truyền thông', icon: Share2, bg: 'from-pink-500 to-rose-600', mode: 'social-dashboard' },
                      { id: 'digital-training', label: 'Đào tạo số', icon: Layers, bg: 'from-sky-500 to-indigo-600', mode: 'digital-training' },
                      { id: 'finance-report', label: 'Tài chính', icon: Wallet, bg: 'from-emerald-600 to-green-700', mode: 'finance-report' },
                      { id: 'tools', label: 'Công cụ', icon: Wrench, bg: 'from-violet-500 to-fuchsia-600', mode: 'communication-tools' },
                      { id: 'document-number', label: 'Công văn', icon: FileText, bg: 'from-slate-500 to-slate-700', mode: 'document-number' },
                      { id: 'account-management', label: 'Nhân sự', icon: Users, bg: 'from-blue-500 to-cyan-600', mode: 'account-management' },
                      { id: 'settings', label: 'Cài đặt', icon: Settings, bg: 'from-zinc-500 to-slate-700', mode: 'office' },
                    ]
                      .filter(app => app.mode === 'office' || canAccessView(app.mode))
                      .map(app => {
                        const Icon = app.icon;
                        return (
                          <button
                            key={app.id}
                            type="button"
                            onClick={() => {
                              if (onOpenDesktopApp) {
                                onOpenDesktopApp(app.id);
                              } else {
                                onOpenDesktopOS();
                              }
                              setIsOpen(false);
                            }}
                            className="group flex flex-col items-center gap-1.5 cursor-pointer"
                          >
                            <div
                              className={`w-13 h-13 rounded-[15px] bg-gradient-to-br ${app.bg} flex items-center justify-center text-white shadow-lg border border-white/20 group-hover:scale-105 group-active:scale-95 transition-transform`}
                            >
                              <Icon className="w-6 h-6" />
                            </div>
                            <span className="text-[10px] font-medium text-slate-200 text-center leading-tight line-clamp-1">
                              {app.label}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                </div>

                {/* iOS Dock mini inside Home Screen */}
                <div className="mt-4 p-2.5 rounded-3xl bg-white/10 backdrop-blur-xl border border-white/15 flex items-center justify-around">
                  <button
                    type="button"
                    onClick={() => {
                      onCallBot?.();
                      setCopiedHint('🤖 Đang gọi Robot Trợ lý AI tới bàn của bạn!');
                      setTimeout(() => setCopiedHint(null), 2500);
                    }}
                    className="w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-md hover:scale-105 transition cursor-pointer"
                    title="Gọi Robot Trợ lý"
                  >
                    <Bot className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('chat')}
                    className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center text-white shadow-md hover:scale-105 transition cursor-pointer"
                    title="Mở iMessage AI"
                  >
                    <MessageSquare className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenDesktopOS();
                      setIsOpen(false);
                    }}
                    className="w-11 h-11 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center text-white shadow-md hover:scale-105 transition cursor-pointer"
                    title="Mở MacBook Desktop OS"
                  >
                    <Monitor className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (onOpenDesktopApp) onOpenDesktopApp('settings');
                      else onOpenDesktopOS();
                      setIsOpen(false);
                    }}
                    className="w-11 h-11 rounded-2xl bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center text-white shadow-md hover:scale-105 transition cursor-pointer"
                    title="Cài đặt hệ thống"
                  >
                    <Settings className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}
            {/* TAB 1: 2-WAY INTERACTIVE AI CHAT */}
            {activeTab === 'chat' && (
              <div className="flex-1 flex flex-col h-full overflow-hidden">
                <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
                  {chatMessages.map(msg => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                    >
                      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                        msg.sender === 'user'
                          ? 'bg-[#0B72CE] text-white rounded-br-sm shadow'
                          : 'bg-slate-800/90 text-slate-100 border border-slate-700/80 rounded-bl-sm shadow'
                      }`}>
                        {msg.text}
                      </div>
                      <span className="text-[9px] text-slate-500 mt-0.5 px-1">{msg.time}</span>
                    </div>
                  ))}
                  {isBotTyping && (
                    <div className="flex items-center gap-1.5 p-2 rounded-xl bg-slate-800/60 border border-slate-700/40 w-fit">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" />
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.2s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.4s]" />
                    </div>
                  )}
                  <div ref={chatBottomRef} />
                </div>

                {/* Quick action chips */}
                <div className="p-2 border-t border-slate-800/80 bg-slate-950/70 flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => handleSendChatMessage('Triệu hồi bot tới bàn làm việc')}
                    className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-cyan-950/80 text-cyan-300 border border-cyan-800/50 hover:bg-cyan-900 transition cursor-pointer"
                  >
                    🚀 Triệu hồi bot tới bàn
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendChatMessage('Lia camera tới phòng họp')}
                    className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
                  >
                    👥 Phòng họp
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendChatMessage('Xem lịch tuần tra tự động của Giám đốc')}
                    className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
                  >
                    👔 Giám đốc 3D
                  </button>
                </div>

                {/* Chat Input form */}
                <form
                  onSubmit={(e) => { e.preventDefault(); handleSendChatMessage(); }}
                  className="p-2.5 bg-slate-900 border-t border-slate-800 flex items-center gap-2 shrink-0"
                >
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Nhắn tin với AI..."
                    className="flex-1 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    type="submit"
                    disabled={!chatInput.trim()}
                    className="p-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 transition cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            )}

            {/* TAB 2: CẨM NANG ÁNH XẠ 2D SANG 3D */}
            {activeTab === 'guide' && (
              <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
                {/* Thanh tìm kiếm tính năng 2D */}
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Tìm tính năng 2D (chấm công, thi, lịch...)"
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700/80 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-white"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Danh sách các tính năng đối chiếu */}
                <div className="space-y-2.5">
                  {filteredItems.map(item => {
                    const IconComp = item.icon;
                    return (
                      <div
                        key={item.id}
                        className="rounded-2xl border border-slate-800 bg-slate-900/70 hover:border-slate-700 p-3 transition flex flex-col gap-2"
                      >
                        {/* Tiêu đề mục 2D */}
                        <div className="flex items-start gap-2.5">
                          <div className={`p-2 rounded-xl bg-gradient-to-br ${item.color} text-white shrink-0 shadow-md`}>
                            <IconComp className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between">
                              <h4 className="text-xs font-bold text-slate-100">{item.title2D}</h4>
                              <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800/40">
                                Ở 2D
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 line-clamp-1">{item.desc2D}</p>
                          </div>
                        </div>

                        {/* Vị trí và Hướng dẫn tương ứng ở 3D */}
                        <div className="rounded-xl bg-slate-950/80 border border-slate-800/90 p-2.5 text-[11px]">
                          <div className="flex items-center gap-1.5 text-emerald-400 font-semibold mb-1">
                            <Compass className="w-3 h-3 shrink-0" />
                            <span>Vị trí trong 3D:</span>
                            <span className="text-slate-200 font-medium">{item.location3D}</span>
                          </div>
                          <p className="text-slate-300 text-[10.5px] leading-relaxed">
                            {item.guide3D}
                          </p>
                        </div>

                        {/* Các nút hành động nhanh */}
                        <div className="flex items-center justify-end gap-1.5 pt-1">
                          {item.zone3D && (
                            <button
                              type="button"
                              onClick={() => {
                                onFocus3DZone?.(item.zone3D!);
                                setCopiedHint(`Đã chỉnh góc nhìn tới: ${item.location3D}`);
                                setTimeout(() => setCopiedHint(null), 2500);
                              }}
                              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10.5px] font-medium transition cursor-pointer flex items-center gap-1"
                            >
                              <Eye className="w-3 h-3 text-blue-400" />
                              <span>Soi góc nhìn</span>
                            </button>
                          )}

                          {item.specialAction === 'os' && (
                            <button
                              type="button"
                              onClick={() => {
                                if (onOpenDesktopApp && item.osAppId) {
                                  onOpenDesktopApp(item.osAppId);
                                } else {
                                  onOpenDesktopOS();
                                }
                                setIsOpen(false);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[10.5px] font-bold transition cursor-pointer flex items-center gap-1 shadow-sm"
                            >
                              <Monitor className="w-3 h-3" />
                              <span>Mở FermatOS</span>
                            </button>
                          )}

                          {item.specialAction === 'roster' && (
                            <button
                              type="button"
                              onClick={() => {
                                onOpenRoster?.();
                                setCopiedHint('Đã mở danh sách nhân sự!');
                                setTimeout(() => setCopiedHint(null), 2500);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[10.5px] font-bold transition cursor-pointer flex items-center gap-1"
                            >
                              <Users className="w-3 h-3" />
                              <span>Xem Roster</span>
                            </button>
                          )}

                          {item.specialAction === 'bot' && (
                            <button
                              type="button"
                              onClick={() => {
                                onCallBot?.();
                                setCopiedHint('Đã phát lệnh gọi Robot!');
                                setTimeout(() => setCopiedHint(null), 2500);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10.5px] font-bold transition cursor-pointer flex items-center gap-1"
                            >
                              <Bot className="w-3 h-3" />
                              <span>Gọi Robot</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB 3: CÁCH ĐI LẠI & ĐIỀU KHIỂN 3D */}
            {activeTab === 'controls' && (
              <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 space-y-2">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Compass className="w-4 h-4 text-blue-400" />
                    Thao tác Chuột trong Văn phòng 3D
                  </h4>
                  <ul className="text-[11px] text-slate-300 space-y-1.5 pl-1">
                    <li className="flex items-start gap-2">
                      <span className="font-bold text-blue-400 shrink-0">Chuột trái:</span>
                      <span>Giữ và kéo để xoay góc nhìn 360° quanh văn phòng.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-bold text-emerald-400 shrink-0">Con lăn chuột:</span>
                      <span>Cuộn lên/xuống để Phóng to hoặc Thu nhỏ góc nhìn.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-bold text-amber-400 shrink-0">Chuột phải:</span>
                      <span>Giữ và kéo để trượt góc nhìn (Pan camera) sang trái, phải, trên, dưới.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-bold text-rose-400 shrink-0">Nhấp vào màn hình PC:</span>
                      <span>Bấm chuột trái vào màn hình máy tính 3D trên bàn làm việc để mở Máy tính ảo Desktop OS.</span>
                    </li>
                  </ul>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 space-y-2">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Sliders className="w-4 h-4 text-indigo-400" />
                    Phím tắt Hỗ trợ
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="font-bold text-blue-400">W, A, S, D</span>
                      <p className="text-slate-400 text-[10px] mt-0.5">Đi tới / lùi / trái / phải</p>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="font-bold text-emerald-400">Phím P</span>
                      <p className="text-slate-400 text-[10px] mt-0.5">Chế độ chụp ảnh Full HD/4K</p>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="font-bold text-amber-400">Esc</span>
                      <p className="text-slate-400 text-[10px] mt-0.5">Thoát chế độ hoá thân / chụp ảnh</p>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="font-bold text-purple-400">Shift</span>
                      <p className="text-slate-400 text-[10px] mt-0.5">Giữ Shift để chạy nhanh</p>
                    </div>
                  </div>
                </div>

                {/* Góc nhìn nhanh */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 space-y-2">
                  <h4 className="text-xs font-bold text-white">Chuyển góc nhìn nhanh 3D</h4>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onFocus3DZone?.('home')}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition cursor-pointer text-left"
                    >
                      🏠 Toàn cảnh văn phòng
                    </button>
                    <button
                      type="button"
                      onClick={() => onFocus3DZone?.('desks')}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition cursor-pointer text-left"
                    >
                      🖥️ Cụm bàn làm việc
                    </button>
                    <button
                      type="button"
                      onClick={() => onFocus3DZone?.('meeting')}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition cursor-pointer text-left"
                    >
                      👥 Phòng họp chung
                    </button>
                    <button
                      type="button"
                      onClick={() => onFocus3DZone?.('server')}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition cursor-pointer text-left"
                    >
                      ⚙️ Phòng máy chủ
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* CHÂN ĐIỆN THOẠI: HOME BAR */}
          <div className="p-3 bg-slate-950 border-t border-slate-800 shrink-0 flex flex-col items-center gap-2">
            {/* Thanh Home Indicator vuốt đóng */}
            <div
              onClick={() => setIsOpen(false)}
              className="w-28 h-1 rounded-full bg-slate-600 hover:bg-slate-400 transition-colors cursor-pointer"
              title="Đóng điện thoại"
            />
          </div>
        </div>
      )}
    </>,
    document.body
  );
}
