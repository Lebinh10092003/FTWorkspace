import React, { useState, useEffect, useRef } from 'react';
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
  Volume2
} from 'lucide-react';

export type VirtualDesktopOSProps = {
  isOpen: boolean;
  onClose: () => void;
  onNavigateModule: (moduleName: string) => void;
  onCallBot: () => void;
  onReleaseBot: () => void;
  onTriggerPatrol: () => void;
  botState: {
    state: string; // 'IDLE' | 'MOVING' | 'ARRIVED'
    botName?: string;
    targetDesk?: number;
    queueLength: number;
  };
  patrolState: {
    active: boolean;
    phase: string;
    message?: string;
  };
  currentUser?: any;
};

type WindowId = 'assistant' | 'exam' | 'reports' | 'docs' | 'terminal' | 'game';

interface OSWindow {
  id: WindowId;
  title: string;
  icon: any;
  isOpen: boolean;
  isMinimized: boolean;
  zIndex: number;
}

export default function VirtualDesktopOS({
  isOpen,
  onClose,
  onNavigateModule,
  onCallBot,
  onReleaseBot,
  onTriggerPatrol,
  botState,
  patrolState,
  currentUser,
}: VirtualDesktopOSProps) {
  const [activeWindow, setActiveWindow] = useState<WindowId>('assistant');
  const [topZ, setTopZ] = useState(10);
  const [timeStr, setTimeStr] = useState('');
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    '[SYSTEM] FermatOS v2.6 Workstation Booted successfully.',
    '[SYSTEM] Connected to 3D Virtual Office engine (Three.js Isometric).',
    '[NETWORK] Presence linked with FermatTech HQ Cloud.',
  ]);
  const [chatMessages, setChatMessages] = useState<{ sender: string; text: string; time: string }[]>([
    {
      sender: 'bot',
      text: 'Xin chào! Tôi là Trợ lý AI FermatTech. Tôi có thể hỗ trợ bạn sinh đề thi, tóm tắt báo cáo hoặc giải đáp kỹ thuật.',
      time: '09:00',
    },
  ]);
  const [inputChat, setInputChat] = useState('');

  // Trạng thái mini game (Memory Tiles Game)
  const [gameTiles, setGameTiles] = useState<number[]>([]);
  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [gameMoves, setGameMoves] = useState(0);

  const [windows, setWindows] = useState<Record<WindowId, OSWindow>>({
    assistant: { id: 'assistant', title: 'Trợ lý AI Workstation', icon: Bot, isOpen: true, isMinimized: false, zIndex: 1 },
    exam: { id: 'exam', title: 'Khảo thí & Ngân hàng đề thi', icon: GraduationCap, isOpen: false, isMinimized: false, zIndex: 2 },
    reports: { id: 'reports', title: 'Báo cáo tuần & Tiến độ', icon: FileText, isOpen: false, isMinimized: false, zIndex: 3 },
    docs: { id: 'docs', title: 'Kho tài liệu & Quy chuẩn', icon: Folder, isOpen: false, isMinimized: false, zIndex: 4 },
    terminal: { id: 'terminal', title: 'Nhật ký Console Văn phòng', icon: Terminal, isOpen: false, isMinimized: false, zIndex: 5 },
    game: { id: 'game', title: 'Fermat Arcade: Xả Stress', icon: Gamepad2, isOpen: false, isMinimized: false, zIndex: 6 },
  });

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

  const focusWindow = (id: WindowId) => {
    const nextZ = topZ + 1;
    setTopZ(nextZ);
    setActiveWindow(id);
    setWindows(prev => ({
      ...prev,
      [id]: { ...prev[id], isOpen: true, isMinimized: false, zIndex: nextZ },
    }));
  };

  const toggleMinimize = (id: WindowId) => {
    setWindows(prev => ({
      ...prev,
      [id]: { ...prev[id], isMinimized: !prev[id].isMinimized },
    }));
  };

  const closeWindow = (id: WindowId) => {
    setWindows(prev => ({
      ...prev,
      [id]: { ...prev[id], isOpen: false },
    }));
  };

  const handleSendChat = () => {
    if (!inputChat.trim()) return;
    const userText = inputChat;
    const t = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    setChatMessages(prev => [...prev, { sender: 'me', text: userText, time: t }]);
    setInputChat('');

    setTimeout(() => {
      let reply = 'Tôi đã ghi nhận yêu cầu của bạn.';
      const low = userText.toLowerCase();
      if (low.includes('đề') || low.includes('thi') || low.includes('khảo thí')) {
        reply = 'Hệ thống Khảo thí AI đang sẵn sàng với 12,000+ câu hỏi chuẩn cấu trúc đề thi. Bạn có thể mở ứng dụng "Khảo thí" trên màn hình để xem ngân hàng đề.';
      } else if (low.includes('báo cáo') || low.includes('kpi') || low.includes('tuần')) {
        reply = 'Bạn có thể nộp nhanh Báo cáo tuần tại mục "Báo cáo tuần". Sếp Minh hiện đang trong phòng Giám đốc, bạn có thể gửi duyệt ngay.';
      } else if (low.includes('chào') || low.includes('hello')) {
        reply = 'Chào bạn! Chúc bạn một ngày làm việc tràn đầy năng lượng tại FermatTech!';
      } else if (low.includes('sếp') || low.includes('giám đốc')) {
        reply = 'Giám đốc định kỳ đi tuần tra các phòng ban. Khi sếp đi kiểm tra, toàn bộ nhân sự sẽ vội vã chạy về bàn làm việc để giữ kỷ luật văn phòng!';
      }
      setChatMessages(prev => [
        ...prev,
        {
          sender: 'bot',
          text: reply,
          time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }, 600);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-8 animate-in fade-in duration-200">
      {/* Vỏ máy tính Monitor Retro Isometric */}
      <div className="relative w-full max-w-5xl h-[85vh] bg-[#EFE7D8] border-4 border-[#1E232B] rounded-3xl shadow-[8px_8px_0px_#1E232B] flex flex-col overflow-hidden select-none font-sans">
        
        {/* Mép vát bezel màn hình retro */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#E5DBC7] border-b-2 border-[#1E232B] text-xs font-mono text-[#1E232B]">
          <div className="flex items-center gap-2 font-bold tracking-wider">
            <Monitor className="w-4 h-4 text-[#D97757]" />
            <span>FERMAT-WORKSTATION // OS 2.6 ISOMETRIC</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              ONLINE
            </span>
            <button
              onClick={onClose}
              className="p-1 hover:bg-[#D97757] hover:text-white rounded border border-[#1E232B] transition-colors"
              title="Đóng máy tính cá nhân"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Màn hình Desktop chính */}
        <div className="relative flex-1 bg-[#FBFBF7] overflow-hidden p-4 flex">
          {/* Lưới isometric background nhẹ nhàng */}
          <div
            className="absolute inset-0 opacity-[0.06] pointer-events-none"
            style={{
              backgroundImage: `radial-gradient(#1E232B 1.5px, transparent 1.5px)`,
              backgroundSize: '24px 24px',
            }}
          />

          {/* Cột Desktop Icons bên trái */}
          <div className="relative z-10 flex flex-col gap-3 w-28">
            <button
              onClick={() => focusWindow('assistant')}
              className={`flex flex-col items-center p-2 rounded-xl border-2 transition-all text-center group ${
                activeWindow === 'assistant' && windows.assistant.isOpen
                  ? 'bg-[#EFE7D8] border-[#D97757] shadow-[2px_2px_0px_#1E232B]'
                  : 'border-transparent hover:bg-[#EFE7D8]/50 hover:border-[#1E232B]/30'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-[#D97757] text-white flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
                <Bot className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-bold text-[#1E232B] mt-1 leading-tight">
                Trợ lý AI
              </span>
            </button>

            <button
              onClick={() => focusWindow('exam')}
              className={`flex flex-col items-center p-2 rounded-xl border-2 transition-all text-center group ${
                activeWindow === 'exam' && windows.exam.isOpen
                  ? 'bg-[#EFE7D8] border-[#D97757] shadow-[2px_2px_0px_#1E232B]'
                  : 'border-transparent hover:bg-[#EFE7D8]/50 hover:border-[#1E232B]/30'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-[#1E232B] text-[#FBFBF7] flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
                <GraduationCap className="w-6 h-6 text-[#38BDF8]" />
              </div>
              <span className="text-[11px] font-bold text-[#1E232B] mt-1 leading-tight">
                Khảo thí
              </span>
            </button>

            <button
              onClick={() => focusWindow('reports')}
              className={`flex flex-col items-center p-2 rounded-xl border-2 transition-all text-center group ${
                activeWindow === 'reports' && windows.reports.isOpen
                  ? 'bg-[#EFE7D8] border-[#D97757] shadow-[2px_2px_0px_#1E232B]'
                  : 'border-transparent hover:bg-[#EFE7D8]/50 hover:border-[#1E232B]/30'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-[#2A9D8F] text-white flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
                <FileText className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-bold text-[#1E232B] mt-1 leading-tight">
                Báo cáo tuần
              </span>
            </button>

            <button
              onClick={() => focusWindow('terminal')}
              className={`flex flex-col items-center p-2 rounded-xl border-2 transition-all text-center group ${
                activeWindow === 'terminal' && windows.terminal.isOpen
                  ? 'bg-[#EFE7D8] border-[#D97757] shadow-[2px_2px_0px_#1E232B]'
                  : 'border-transparent hover:bg-[#EFE7D8]/50 hover:border-[#1E232B]/30'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-[#1E232B] text-emerald-400 flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform font-mono">
                <Terminal className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-bold text-[#1E232B] mt-1 leading-tight">
                HQ Console
              </span>
            </button>

            <button
              onClick={() => focusWindow('game')}
              className={`flex flex-col items-center p-2 rounded-xl border-2 transition-all text-center group ${
                activeWindow === 'game' && windows.game.isOpen
                  ? 'bg-[#EFE7D8] border-[#D97757] shadow-[2px_2px_0px_#1E232B]'
                  : 'border-transparent hover:bg-[#EFE7D8]/50 hover:border-[#1E232B]/30'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-[#E76F51] text-white flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
                <Gamepad2 className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-bold text-[#1E232B] mt-1 leading-tight">
                Mini Game
              </span>
            </button>
          </div>

          {/* Khu vực chứa các cửa sổ (Windows Area) */}
          <div className="relative flex-1 ml-2">
            
            {/* CỬA SỔ 1: TRỢ LÝ AI WORKSTATION */}
            {windows.assistant.isOpen && !windows.assistant.isMinimized && (
              <div
                onClick={() => focusWindow('assistant')}
                style={{ zIndex: windows.assistant.zIndex }}
                className="absolute inset-2 bg-[#FBFBF7] border-2 border-[#1E232B] rounded-2xl shadow-[6px_6px_0px_#1E232B] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
              >
                {/* Header Window */}
                <div className="flex items-center justify-between px-3 py-2 bg-[#1E232B] text-[#FBFBF7] text-xs font-bold">
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-[#D97757]" />
                    <span>TRỢ LÝ AI WORKSTATION // HÀNG CHỜ VẬT LÝ</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={(e) => { e.stopPropagation(); toggleMinimize('assistant'); }} className="p-0.5 hover:bg-white/20 rounded">
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); closeWindow('assistant'); }} className="p-0.5 hover:bg-rose-500 rounded">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Body Window */}
                <div className="flex-1 p-3 grid grid-cols-1 md:grid-cols-3 gap-3 overflow-hidden">
                  {/* Cột trái: Điều khiển Robot vật lý & Hàng chờ */}
                  <div className="bg-[#EFE7D8]/60 p-3 rounded-xl border border-[#1E232B]/20 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2 pb-2 border-b border-[#1E232B]/15">
                        <span className="text-xs font-bold text-[#1E232B] uppercase tracking-wide">
                          Điều phối Robot
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${
                          botState.state === 'ARRIVED'
                            ? 'bg-emerald-600 text-white'
                            : botState.state === 'MOVING'
                            ? 'bg-amber-500 text-white animate-pulse'
                            : 'bg-[#1E232B]/10 text-[#1E232B]'
                        }`}>
                          {botState.state === 'ARRIVED' ? 'TẠI BÀN' : botState.state === 'MOVING' ? 'ĐANG ĐẾN' : 'TRẠM CHỜ'}
                        </span>
                      </div>

                      <div className="text-xs text-[#1E232B]/80 mb-3 space-y-1">
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
                        className="w-full py-2 px-3 bg-[#D97757] hover:bg-[#c46849] active:translate-y-0.5 text-white rounded-xl font-bold text-xs shadow-[2px_2px_0px_#1E232B] border border-[#1E232B] flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                      >
                        <Bot className="w-4 h-4" />
                        Gọi Robot tới bàn làm việc
                      </button>

                      {botState.state === 'ARRIVED' && (
                        <button
                          onClick={onReleaseBot}
                          className="w-full py-1.5 px-3 bg-[#1E232B] hover:bg-[#2b323d] active:translate-y-0.5 text-[#FBFBF7] rounded-xl font-bold text-xs border border-[#1E232B] flex items-center justify-center gap-1.5 transition-all"
                        >
                          Cho Robot về trạm sạc
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Cột phải: Khung Chat tương tác với Bot */}
                  <div className="md:col-span-2 bg-[#FBFBF7] border border-[#1E232B]/20 rounded-xl flex flex-col overflow-hidden">
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
                                ? 'bg-[#D97757] text-white border-[#1E232B]/30 rounded-tr-none'
                                : 'bg-[#EFE7D8] text-[#1E232B] border-[#1E232B]/20 rounded-tl-none'
                            }`}
                          >
                            <div className="text-[10px] opacity-70 mb-0.5 font-mono">
                              {msg.sender === 'me' ? 'Bạn' : 'Robot AI'} • {msg.time}
                            </div>
                            <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Input Chat */}
                    <div className="p-2 border-t border-[#1E232B]/15 bg-[#EFE7D8]/30 flex gap-2">
                      <input
                        type="text"
                        value={inputChat}
                        onChange={(e) => setInputChat(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                        placeholder="Hỏi trợ lý AI về khảo thí, báo cáo, tài liệu..."
                        className="flex-1 px-3 py-1.5 bg-white border border-[#1E232B]/30 rounded-lg text-xs text-[#1E232B] focus:outline-none focus:ring-1 focus:ring-[#D97757]"
                      />
                      <button
                        onClick={handleSendChat}
                        className="px-3 py-1.5 bg-[#D97757] text-white rounded-lg font-bold text-xs flex items-center gap-1 hover:bg-[#c46849]"
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
                onClick={() => focusWindow('exam')}
                style={{ zIndex: windows.exam.zIndex }}
                className="absolute inset-2 bg-[#FBFBF7] border-2 border-[#1E232B] rounded-2xl shadow-[6px_6px_0px_#1E232B] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
              >
                <div className="flex items-center justify-between px-3 py-2 bg-[#1E232B] text-[#FBFBF7] text-xs font-bold">
                  <div className="flex items-center gap-2">
                    <GraduationCap className="w-4 h-4 text-[#38BDF8]" />
                    <span>HỆ THỐNG KHẢO THÍ & ĐÀO TẠO SỐ FERMAT</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={(e) => { e.stopPropagation(); toggleMinimize('exam'); }} className="p-0.5 hover:bg-white/20 rounded">
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); closeWindow('exam'); }} className="p-0.5 hover:bg-rose-500 rounded">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 p-4 overflow-y-auto space-y-4 text-xs text-[#1E232B]">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 bg-[#EFE7D8]/60 border border-[#1E232B]/20 rounded-xl">
                      <span className="text-[10px] uppercase font-bold text-[#1E232B]/60">Đề thi kích hoạt</span>
                      <p className="text-xl font-bold text-[#D97757] mt-1">24 Bộ đề</p>
                    </div>
                    <div className="p-3 bg-[#EFE7D8]/60 border border-[#1E232B]/20 rounded-xl">
                      <span className="text-[10px] uppercase font-bold text-[#1E232B]/60">Thí sinh đang thi</span>
                      <p className="text-xl font-bold text-[#1E232B] mt-1">1,480 Học sinh</p>
                    </div>
                    <div className="p-3 bg-[#EFE7D8]/60 border border-[#1E232B]/20 rounded-xl">
                      <span className="text-[10px] uppercase font-bold text-[#1E232B]/60">Độ chính xác chấm AI</span>
                      <p className="text-xl font-bold text-emerald-600 mt-1">99.94%</p>
                    </div>
                  </div>

                  <div className="p-3 border border-[#1E232B]/20 rounded-xl bg-white space-y-2">
                    <h4 className="font-bold text-xs uppercase tracking-wide text-[#1E232B]">
                      Các kỳ thi trọng điểm trong tuần
                    </h4>
                    <ul className="space-y-1.5 text-xs text-[#1E232B]/80">
                      <li className="flex justify-between items-center py-1 border-b border-[#1E232B]/10">
                        <span>Đánh giá năng lực Toán Quốc tế Fermat (Khối 8 - 9)</span>
                        <span className="font-mono font-bold text-emerald-600">ĐANG DIỄN RA</span>
                      </li>
                      <li className="flex justify-between items-center py-1 border-b border-[#1E232B]/10">
                        <span>Thi thử Tiếng Anh THPT Chuyên đợt 2</span>
                        <span className="font-mono font-bold text-amber-600">CHUẨN BỊ MỞ</span>
                      </li>
                      <li className="flex justify-between items-center py-1">
                        <span>Khảo sát chất lượng số hóa ngành Giáo dục 2026</span>
                        <span className="font-mono font-bold text-[#1E232B]/60">ĐÃ HOÀN THÀNH</span>
                      </li>
                    </ul>
                  </div>

                  <button
                    onClick={() => {
                      onClose();
                      onNavigateModule('examination');
                    }}
                    className="py-2.5 px-4 bg-[#D97757] hover:bg-[#c46849] text-white font-bold rounded-xl shadow-[2px_2px_0px_#1E232B] border border-[#1E232B] flex items-center justify-center gap-2"
                  >
                    <span>Mở toàn màn hình Phân hệ Khảo thí</span>
                  </button>
                </div>
              </div>
            )}

            {/* CỬA SỔ 3: BÁO CÁO TUẦN & GIÁM ĐỐC */}
            {windows.reports.isOpen && !windows.reports.isMinimized && (
              <div
                onClick={() => focusWindow('reports')}
                style={{ zIndex: windows.reports.zIndex }}
                className="absolute inset-2 bg-[#FBFBF7] border-2 border-[#1E232B] rounded-2xl shadow-[6px_6px_0px_#1E232B] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
              >
                <div className="flex items-center justify-between px-3 py-2 bg-[#1E232B] text-[#FBFBF7] text-xs font-bold">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#2A9D8F]" />
                    <span>BÁO CÁO TUẦN & GIÁM SÁT TIẾN ĐỘ</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={(e) => { e.stopPropagation(); toggleMinimize('reports'); }} className="p-0.5 hover:bg-white/20 rounded">
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); closeWindow('reports'); }} className="p-0.5 hover:bg-rose-500 rounded">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 p-4 overflow-y-auto space-y-4 text-xs text-[#1E232B]">
                  <div className="p-3 bg-[#EFE7D8]/60 border border-[#1E232B]/20 rounded-xl flex items-center justify-between">
                    <div>
                      <h4 className="font-bold">Trạng thái Giám đốc tuần tra</h4>
                      <p className="text-[11px] text-[#1E232B]/70 mt-0.5">
                        {patrolState.active
                          ? '🚨 Giám đốc đang đi tuần! Mọi nhân viên đã vội vã chạy về bàn làm việc.'
                          : 'Giám đốc đang ở phòng riêng làm việc và duyệt hồ sơ.'}
                      </p>
                    </div>
                    <button
                      onClick={onTriggerPatrol}
                      disabled={patrolState.active}
                      className="px-3 py-2 bg-[#1E232B] hover:bg-[#2b323d] text-white rounded-xl font-bold text-xs border border-[#1E232B] shadow-[2px_2px_0px_#D97757] disabled:opacity-50"
                    >
                      {patrolState.active ? 'Đang tuần tra...' : 'Sếp đi tuần ngay 📋'}
                    </button>
                  </div>

                  <div className="p-3 border border-[#1E232B]/20 rounded-xl bg-white space-y-2">
                    <h4 className="font-bold text-xs uppercase tracking-wide">Tiến độ Sprint tuần này</h4>
                    <div className="w-full bg-[#EFE7D8] h-3 rounded-full overflow-hidden border border-[#1E232B]/30">
                      <div className="bg-[#D97757] h-full w-[82%]"></div>
                    </div>
                    <div className="flex justify-between text-[11px] font-mono text-[#1E232B]/70">
                      <span>Đã hoàn thành: 82%</span>
                      <span>Hạn chót: Thứ Sáu 17:30</span>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      onClose();
                      onNavigateModule('weekly-report');
                    }}
                    className="py-2.5 px-4 bg-[#2A9D8F] hover:bg-[#248277] text-white font-bold rounded-xl shadow-[2px_2px_0px_#1E232B] border border-[#1E232B] flex items-center justify-center gap-2"
                  >
                    <span>Mở Báo cáo tuần chi tiết</span>
                  </button>
                </div>
              </div>
            )}

            {/* CỬA SỔ 4: HQ CONSOLE TERMINAL */}
            {windows.terminal.isOpen && !windows.terminal.isMinimized && (
              <div
                onClick={() => focusWindow('terminal')}
                style={{ zIndex: windows.terminal.zIndex }}
                className="absolute inset-2 bg-[#111827] border-2 border-[#1E232B] rounded-2xl shadow-[6px_6px_0px_#1E232B] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150 font-mono text-emerald-400"
              >
                <div className="flex items-center justify-between px-3 py-2 bg-[#1F2937] text-gray-200 text-xs font-bold border-b border-gray-700">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    <span>FERMAT-HQ CONSOLE // REALTIME LOGS</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={(e) => { e.stopPropagation(); toggleMinimize('terminal'); }} className="p-0.5 hover:bg-white/20 rounded">
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); closeWindow('terminal'); }} className="p-0.5 hover:bg-rose-500 rounded">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
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
                onClick={() => focusWindow('game')}
                style={{ zIndex: windows.game.zIndex }}
                className="absolute inset-2 bg-[#FBFBF7] border-2 border-[#1E232B] rounded-2xl shadow-[6px_6px_0px_#1E232B] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
              >
                <div className="flex items-center justify-between px-3 py-2 bg-[#1E232B] text-[#FBFBF7] text-xs font-bold">
                  <div className="flex items-center gap-2">
                    <Gamepad2 className="w-4 h-4 text-[#E76F51]" />
                    <span>FERMAT RETRO ARCADE // LẬT Ô TÌM CẶP</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={(e) => { e.stopPropagation(); toggleMinimize('game'); }} className="p-0.5 hover:bg-white/20 rounded">
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); closeWindow('game'); }} className="p-0.5 hover:bg-rose-500 rounded">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 p-4 flex flex-col items-center justify-center">
                  <div className="flex items-center justify-between w-full max-w-xs mb-3 text-xs font-mono font-bold text-[#1E232B]">
                    <span>Lượt mở: {gameMoves}</span>
                    <span>Khớp: {matched.length / 2} / 4 cặp</span>
                    <button
                      onClick={resetGame}
                      className="p-1 hover:bg-[#EFE7D8] rounded border border-[#1E232B]/30"
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
                              ? 'bg-emerald-500 text-white border-[#1E232B] shadow-[2px_2px_0px_#1E232B]'
                              : isFlipped
                              ? 'bg-[#D97757] text-white border-[#1E232B] shadow-[2px_2px_0px_#1E232B]'
                              : 'bg-[#EFE7D8] border-[#1E232B] hover:bg-[#E5DBC7] shadow-[3px_3px_0px_#1E232B] active:translate-y-0.5'
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

          </div>
        </div>

        {/* Thanh Taskbar / Dock dưới đáy */}
        <div className="h-12 bg-[#EFE7D8] border-t-2 border-[#1E232B] px-3 flex items-center justify-between z-40">
          {/* Nút Start */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => focusWindow('assistant')}
              className="px-3 py-1.5 bg-[#D97757] hover:bg-[#c46849] active:translate-y-0.5 text-white font-bold text-xs rounded-lg border border-[#1E232B] shadow-[2px_2px_0px_#1E232B] flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>FermatOS</span>
            </button>

            {/* Các icon tab ứng dụng đang mở */}
            <div className="flex items-center gap-1.5 ml-2">
              {Object.values(windows)
                .filter(w => w.isOpen)
                .map(w => {
                  const Icon = w.icon;
                  const isTop = activeWindow === w.id && !w.isMinimized;
                  return (
                    <button
                      key={w.id}
                      onClick={() => {
                        if (isTop) {
                          toggleMinimize(w.id);
                        } else {
                          focusWindow(w.id);
                        }
                      }}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border flex items-center gap-1.5 transition-colors ${
                        isTop
                          ? 'bg-[#1E232B] text-white border-[#1E232B]'
                          : 'bg-white/70 text-[#1E232B] border-[#1E232B]/30 hover:bg-white'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{w.title.split(' ')[0]}</span>
                    </button>
                  );
                })}
            </div>
          </div>

          {/* System Tray bên phải */}
          <div className="flex items-center gap-3 text-xs font-mono font-bold text-[#1E232B]">
            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/60 border border-[#1E232B]/20">
              <Bot className="w-3.5 h-3.5 text-[#D97757]" />
              <span>{botState.state === 'ARRIVED' ? 'TẠI BÀN' : botState.state === 'MOVING' ? 'DI CHUYỂN' : 'TRẠM BOT'}</span>
            </div>
            <div className="px-2 py-0.5 rounded bg-white/60 border border-[#1E232B]/20">
              {timeStr}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
