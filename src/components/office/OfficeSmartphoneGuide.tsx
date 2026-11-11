import React, { useState, useMemo } from 'react';
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
  ChevronDown
} from 'lucide-react';

export interface OfficeSmartphoneGuideProps {
  onNavigate2D: () => void;
  onOpenDesktopOS: () => void;
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
    guide3D: 'Nhấp trực tiếp vào màn hình máy tính 3D trên bàn làm việc hoặc bấm "Máy tính OS" để mở hệ điều hành ảo với AI Chat, Khảo thí và Báo cáo.',
    zone3D: 'desks',
    specialAction: 'os'
  },
  {
    id: 'attendance',
    title2D: 'Điểm danh & Chấm công',
    desc2D: 'Chấm công vào/ra ca, kiểm tra hiện diện & vị trí làm việc',
    icon: Clock,
    color: 'from-emerald-500 to-teal-600',
    location3D: 'Trạm chấm công ở Cửa chính (Entrance Station)',
    guide3D: 'Nằm ngay lối vào chính của văn phòng 3D. Nhìn ra cửa ra vào để thấy máy chấm công nhận diện hoặc chuyển góc nhìn toàn cảnh.',
    zone3D: 'home',
    targetMode: 'attendance'
  },
  {
    id: 'exam',
    title2D: 'Khảo thí & Ngân hàng đề',
    desc2D: 'Tổ chức ca thi, nhập điểm, tạo đề thi tự động & coi thi trực tuyến',
    icon: FileText,
    color: 'from-purple-500 to-violet-600',
    location3D: 'Phòng ban Khảo thí & Ứng dụng Khảo thí trong OS',
    guide3D: 'Khu vực cụm bàn Khảo thí góc phía trong, hoặc mở app "Khảo thí" trong Máy tính ảo Virtual Desktop OS trên bàn làm việc.',
    zone3D: 'desks',
    targetMode: 'examination',
    specialAction: 'os'
  },
  {
    id: 'weekly-report',
    title2D: 'Báo cáo tuần & Lịch làm việc',
    desc2D: 'Báo cáo tiến độ cuối tuần, lịch họp phòng ban & giao ban',
    icon: Calendar,
    color: 'from-amber-500 to-orange-600',
    location3D: 'Bảng tin treo tường & App Báo cáo trong Máy tính OS',
    guide3D: 'Bảng thông báo lớn trên tường văn phòng và ứng dụng Báo cáo tuần tích hợp ngay trong máy tính bàn 3D.',
    zone3D: 'meeting',
    targetMode: 'communication-tools/weekly-report',
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
    targetMode: 'social-dashboard'
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
    title2D: 'Robot phục vụ & Sếp đi tuần (Độc quyền 3D)',
    desc2D: 'Tính năng tương tác thực tế chỉ có trong không gian 3D',
    icon: Bot,
    color: 'from-indigo-500 to-cyan-500',
    location3D: 'Hành lang & Tuyến đường giữa các phòng ban',
    guide3D: 'Gọi Robot mang tài liệu tới bàn của bạn, hoặc kích hoạt Sếp tuần tra đi thăm hỏi các phòng ban trong văn phòng.',
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
}: OfficeSmartphoneGuideProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'guide' | 'apps' | 'controls'>('guide');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedHint, setCopiedHint] = useState<string | null>(null);

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
      onOpenDesktopOS();
      setCopiedHint('Đã mở Máy tính ảo Desktop OS trên bàn 3D!');
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

  return (
    <>
      {/* 1. NÚT DOCK GÓC DƯỚI BÊN PHẢI (Widget Hình Chiếc Điện Thoại Sang Trọng) */}
      {!isOpen && (
        <div className="pointer-events-auto fixed bottom-5 right-5 z-40 flex items-center gap-2">
          {/* Tag gợi ý nhẹ khi mới vào */}
          <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/90 border border-slate-700/80 text-slate-200 text-xs shadow-xl backdrop-blur-md animate-pulse">
            <Compass className="w-3.5 h-3.5 text-blue-400" />
            <span className="font-medium">Cẩm nang 2D ➔ 3D</span>
          </div>

          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="group relative flex flex-col items-center justify-center w-14 h-24 sm:w-16 sm:h-28 rounded-2xl bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950 p-1 border-2 border-slate-600/90 shadow-[0_12px_36px_rgba(0,0,0,0.6)] hover:border-blue-400 hover:scale-105 transition-all duration-200 cursor-pointer"
            title="Mở Điện thoại Fermat: Cẩm nang trỏ hướng tính năng 2D sang 3D"
          >
            {/* Viền kim loại & Dynamic Island mô phỏng */}
            <div className="w-6 h-1 rounded-full bg-slate-700 mb-1" />
            
            {/* Màn hình điện thoại nhỏ bên trong */}
            <div className="relative flex-1 w-full rounded-xl bg-gradient-to-b from-blue-950/80 via-slate-900 to-indigo-950/80 flex flex-col items-center justify-center p-1 overflow-hidden border border-slate-700/60">
              <div className="absolute top-1 text-[8px] font-mono text-blue-300/80 font-bold">
                {currentTime}
              </div>
              <Compass className="w-6 h-6 text-blue-400 group-hover:rotate-45 transition-transform duration-300" />
              <span className="text-[9px] font-bold text-slate-200 mt-1">2D➔3D</span>

              {/* Chấm thông báo sáng nhấp nháy */}
              <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            </div>

            {/* Vạch Home Indicator đáy máy */}
            <div className="w-8 h-1 rounded-full bg-slate-500 mt-1" />
          </button>
        </div>
      )}

      {/* 2. KHUNG CHIẾC ĐIỆN THOẠI THÔNG MINH MỞ RA (Smartphone Mockup Frame) */}
      {isOpen && (
        <div className="pointer-events-auto fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 w-[350px] sm:w-[385px] h-[610px] max-h-[calc(100vh-2rem)] rounded-[42px] border-[7px] border-slate-700/95 bg-[#070C16] shadow-[0_25px_80px_rgba(0,0,0,0.85)] flex flex-col overflow-hidden animate-in slide-in-from-bottom-6 fade-in duration-200 text-slate-100">
          
          {/* Dynamic Island & Loa thoại trên cùng */}
          <div className="relative h-7 w-full bg-transparent flex items-center justify-between px-6 pt-2 shrink-0 select-none">
            <span className="text-[11px] font-bold text-slate-300 font-mono tracking-tight">{currentTime}</span>
            <div className="w-20 h-4 rounded-full bg-black border border-slate-800 flex items-center justify-center gap-1.5 px-2">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />
              <span className="text-[8px] font-mono text-emerald-400 font-bold">5G · 100%</span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-full p-1 text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              title="Đóng điện thoại"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Header Applet trong điện thoại */}
          <div className="px-4 py-2.5 bg-gradient-to-r from-blue-900/60 via-indigo-900/40 to-slate-900/60 border-b border-slate-800/80 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-xl bg-blue-600/30 border border-blue-500/40 text-blue-400">
                <Compass className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-white flex items-center gap-1">
                  Trợ lý Cẩm nang 2D ➔ 3D
                </h3>
                <p className="text-[10px] text-slate-400">Tìm tính năng 2D trong phòng 3D</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onNavigate2D}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold shadow transition cursor-pointer"
              title="Quay lại giao diện 2D tiêu chuẩn"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>Về 2D</span>
            </button>
          </div>

          {/* Toast thông báo hành động ngắn */}
          {copiedHint && (
            <div className="bg-emerald-600 text-white text-[11px] font-medium px-3 py-1.5 text-center shrink-0 animate-in fade-in">
              {copiedHint}
            </div>
          )}

          {/* Tabs chuyển đổi trong điện thoại */}
          <div className="grid grid-cols-3 bg-slate-900/90 border-b border-slate-800/80 p-1 text-[11px] font-semibold shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('guide')}
              className={`py-1.5 rounded-lg transition text-center cursor-pointer ${
                activeTab === 'guide'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Cẩm nang 2D→3D
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('controls')}
              className={`py-1.5 rounded-lg transition text-center cursor-pointer ${
                activeTab === 'controls'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Cách đi lại 3D
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('apps')}
              className={`py-1.5 rounded-lg transition text-center cursor-pointer ${
                activeTab === 'apps'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Lối tắt 2D
            </button>
          </div>

          {/* Nội dung theo Tab */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 font-sans">
            {/* TAB 1: CẨM NANG ÁNH XẠ 2D SANG 3D */}
            {activeTab === 'guide' && (
              <>
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
                                onOpenDesktopOS();
                                setCopiedHint('Đã mở Máy tính ảo!');
                                setTimeout(() => setCopiedHint(null), 2500);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[10.5px] font-bold transition cursor-pointer flex items-center gap-1 shadow-sm"
                            >
                              <Monitor className="w-3 h-3" />
                              <span>Mở Máy tính OS</span>
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

                          {item.targetMode && canAccessView(item.targetMode) && (
                            <button
                              type="button"
                              onClick={() => onNavigateModule(item.targetMode!)}
                              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10.5px] font-medium transition cursor-pointer flex items-center gap-1"
                            >
                              <span>Mở 2D</span>
                              <ExternalLink className="w-2.5 h-2.5 text-slate-400" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* TAB 2: CÁCH ĐI LẠI & ĐIỀU KHIỂN 3D */}
            {activeTab === 'controls' && (
              <div className="space-y-3">
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

            {/* TAB 3: MỞ NHANH PHÂN HỆ 2D */}
            {activeTab === 'apps' && (
              <div className="space-y-2.5">
                <p className="text-[11px] text-slate-400">
                  Bấm vào phân hệ bên dưới để chuyển trực tiếp sang giao diện làm việc 2D chuyên biệt:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { mode: 'workspace', label: 'Trang chủ 2D', icon: Layers, color: 'text-blue-400' },
                    { mode: 'attendance', label: 'Điểm danh & Chấm công', icon: Clock, color: 'text-emerald-400' },
                    { mode: 'examination', label: 'Khảo thí & Đề thi', icon: FileText, color: 'text-purple-400' },
                    { mode: 'weekly-report', label: 'Báo cáo tuần', icon: Calendar, color: 'text-amber-400' },
                    { mode: 'social-dashboard', label: 'Truyền thông & AI', icon: Share2, color: 'text-rose-400' },
                    { mode: 'account-management', label: 'Quản lý nhân viên', icon: Users, color: 'text-cyan-400' },
                    { mode: 'finance-report', label: 'Báo cáo thu chi', icon: Sliders, color: 'text-green-400' },
                    { mode: 'resources', label: 'Tài nguyên tài liệu', icon: ExternalLink, color: 'text-yellow-400' },
                  ].filter(m => canAccessView(m.mode)).map(m => {
                    const MIcon = m.icon;
                    return (
                      <button
                        key={m.mode}
                        type="button"
                        onClick={() => {
                          if (m.mode === 'workspace') {
                            onNavigate2D();
                          } else {
                            onNavigateModule(m.mode);
                          }
                        }}
                        className="p-2.5 rounded-xl border border-slate-800 bg-slate-900/80 hover:bg-blue-600/20 hover:border-blue-500/50 transition flex items-center gap-2 text-left cursor-pointer group"
                      >
                        <MIcon className={`w-4 h-4 ${m.color} shrink-0`} />
                        <span className="text-xs font-semibold text-slate-200 group-hover:text-white truncate">
                          {m.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* CHÂN ĐIỆN THOẠI: NÚT QUAY LẠI 2D NỔI BẬT & HOME BAR */}
          <div className="p-3 bg-slate-950 border-t border-slate-800 shrink-0 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={onNavigate2D}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg transition-all cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Quay lại Giao diện 2D Tiêu chuẩn</span>
            </button>

            {/* Thanh Home Indicator vuốt đóng */}
            <div
              onClick={() => setIsOpen(false)}
              className="w-28 h-1 rounded-full bg-slate-600 hover:bg-slate-400 transition-colors cursor-pointer"
              title="Đóng điện thoại"
            />
          </div>
        </div>
      )}
    </>
  );
}
