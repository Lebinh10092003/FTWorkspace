import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  Volume2,
  Loader2,
  Users
} from 'lucide-react';

export type VirtualDesktopOSProps = {
  isOpen: boolean;
  onClose: () => void;
  onNavigateModule?: (moduleName: string) => void;
  onCallBot?: () => void;
  onReleaseBot?: () => void;
  onTriggerPatrol?: () => void;
  initialApp?: WindowId;
  initialPrompt?: string;
  initialColleague?: { name: string; role?: string; department?: string } | null;
  botState?: {
    state: string; // 'IDLE' | 'MOVING' | 'ARRIVED'
    botName?: string;
    targetDesk?: number;
    queueLength: number;
  };
  patrolState?: {
    active: boolean;
    phase: string;
    message?: string;
  };
  currentUser?: any;
  idToken?: string | null;
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

class VirtualDesktopErrorBoundary extends React.Component<
  { children: React.ReactNode; onClose?: () => void },
  { hasError: boolean; errorMsg: string }
> {
  constructor(props: { children: React.ReactNode; onClose?: () => void }) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMsg: error?.message || 'Lỗi giao diện hệ điều hành ảo' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[VirtualDesktopOS ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      if (typeof document === 'undefined') return null;
      return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-slate-900 p-6 text-center shadow-2xl">
            <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto mb-3" />
            <h3 className="text-base font-bold text-white">Máy tính ảo gặp sự cố hiển thị</h3>
            <p className="mt-1.5 text-xs text-slate-400">{this.state.errorMsg}</p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, errorMsg: '' })}
                className="px-4 py-2 rounded-xl bg-[#D97757] hover:bg-[#c46849] text-white text-xs font-bold transition cursor-pointer"
              >
                Khởi động lại OS
              </button>
              {this.props.onClose && (
                <button
                  type="button"
                  onClick={() => {
                    this.setState({ hasError: false, errorMsg: '' });
                    this.props.onClose?.();
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition cursor-pointer"
                >
                  Đóng
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      );
    }
    return this.props.children;
  }
}

export default function VirtualDesktopOS(props: VirtualDesktopOSProps) {
  return (
    <VirtualDesktopErrorBoundary onClose={props.onClose}>
      <VirtualDesktopOSInner {...props} />
    </VirtualDesktopErrorBoundary>
  );
}

function VirtualDesktopOSInner({
  isOpen,
  onClose,
  onNavigateModule = () => {},
  onCallBot = () => {},
  onReleaseBot = () => {},
  onTriggerPatrol = () => {},
  initialApp,
  initialPrompt,
  initialColleague,
  botState = { state: 'IDLE', queueLength: 0 },
  patrolState = { active: false, phase: 'IDLE' },
  currentUser,
  idToken = null,
}: VirtualDesktopOSProps) {
  const [activeWindow, setActiveWindow] = useState<WindowId>(initialApp || 'assistant');
  const [topZ, setTopZ] = useState(10);
  const [timeStr, setTimeStr] = useState('');
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    '[SYSTEM] FermatOS v2.6 Workstation Booted successfully.',
    '[SYSTEM] Connected to 3D Virtual Office engine (Three.js Isometric).',
    '[NETWORK] Presence linked with FermatTech HQ Cloud.',
  ]);
  type ChatAction = {
    label: string;
    action: () => void;
    icon?: any;
  };

  const [chatMessages, setChatMessages] = useState<{
    sender: string;
    text: string;
    time: string;
    actions?: ChatAction[];
  }[]>([
    {
      sender: 'bot',
      text: 'Xin chào! Tôi là Trợ lý AI FermatTech. Tôi có thể hỗ trợ bạn sinh đề thi, mở phân hệ làm việc, gọi robot đến bàn hoặc hỗ trợ công việc văn phòng.',
      time: '09:00',
      actions: [
        { label: 'Mở Khảo thí', action: () => { onClose(); onNavigateModule('examination'); } },
        { label: 'Báo cáo tuần', action: () => { onClose(); onNavigateModule('weekly-report'); } },
        { label: 'Gọi Robot', action: () => onCallBot() },
      ],
    },
  ]);
  const [inputChat, setInputChat] = useState('');
  const [isBotTyping, setIsBotTyping] = useState(false);
  const activePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Dọn dẹp interval polling khi component unmount hoặc đóng OS
  useEffect(() => {
    return () => {
      if (activePollRef.current) {
        clearInterval(activePollRef.current);
        activePollRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen && activePollRef.current) {
      clearInterval(activePollRef.current);
      activePollRef.current = null;
      setIsBotTyping(false);
    }
  }, [isOpen]);

  // Dữ liệu thật kết nối Backend (Mục 1)
  const [examData, setExamData] = useState<{
    loading: boolean;
    totalPapers: number;
    activeCount: number;
    accuracy: string;
    papers: any[];
  }>({
    loading: false,
    totalPapers: 24,
    activeCount: 1480,
    accuracy: '99.94%',
    papers: [],
  });

  const [workData, setWorkData] = useState<{
    loading: boolean;
    items: any[];
    completionRate: number;
    totalTasks: number;
    doneTasks: number;
  }>({
    loading: false,
    items: [],
    completionRate: 82,
    totalTasks: 0,
    doneTasks: 0,
  });

  // Tải dữ liệu thật từ Backend khi mở Desktop OS (Mục 1)
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const authHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (idToken) {
      authHeaders['Authorization'] = `Bearer ${idToken}`;
    }

    // 1. Fetch đề thi từ /api/examination/papers
    setExamData(prev => ({ ...prev, loading: true }));
    fetch('/api/examination/papers', {
      headers: authHeaders,
      credentials: 'include',
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data) return;
        const items = Array.isArray(data.items) ? data.items : [];
        if (items.length > 0) {
          setExamData({
            loading: false,
            totalPapers: items.length,
            activeCount: items.filter((p: any) => p.status === 'PUBLISHED' || p.status === 'READY').length || items.length,
            accuracy: '99.95%',
            papers: items.slice(0, 5),
          });
        } else {
          setExamData(prev => ({ ...prev, loading: false }));
        }
      })
      .catch(() => {
        if (!cancelled) setExamData(prev => ({ ...prev, loading: false }));
      });

    // 2. Fetch danh sách công việc tuần từ /api/work-schedule/items
    setWorkData(prev => ({ ...prev, loading: true }));
    fetch('/api/work-schedule/items', {
      headers: authHeaders,
      credentials: 'include',
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data) return;
        const items = Array.isArray(data.items) ? data.items : [];
        if (items.length > 0) {
          const done = items.filter((it: any) => it.status === 'DONE' || it.status === 'COMPLETED').length;
          const rate = items.length > 0 ? Math.round((done / items.length) * 100) : 82;
          setWorkData({
            loading: false,
            items: items.slice(0, 6),
            completionRate: rate,
            totalTasks: items.length,
            doneTasks: done,
          });
        } else {
          setWorkData(prev => ({ ...prev, loading: false }));
        }
      })
      .catch(() => {
        if (!cancelled) setWorkData(prev => ({ ...prev, loading: false }));
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, idToken]);

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

  useEffect(() => {
    if (!isOpen) return;
    if (initialApp) {
      setActiveWindow(initialApp);
      setTopZ(prevZ => {
        const nextZ = prevZ + 1;
        setWindows(prevW => ({
          ...prevW,
          [initialApp]: { ...prevW[initialApp], isOpen: true, isMinimized: false, zIndex: nextZ },
        }));
        return nextZ;
      });
    }
    if (initialPrompt) {
      setInputChat(initialPrompt);
    }
  }, [isOpen, initialApp, initialPrompt]);

  const handleSendChat = async (presetText?: string) => {
    const textToSend = presetText !== undefined ? presetText : inputChat;
    if (!textToSend.trim()) return;
    const userText = textToSend.trim();
    const t = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    setChatMessages(prev => [...prev, { sender: 'me', text: userText, time: t }]);
    if (presetText === undefined) setInputChat('');

    const low = userText.toLowerCase();

    // Các lệnh thao tác nhanh văn phòng 3D (Instant Office Actions)
    if (low.includes('robot') || low.includes('bot') || low.includes('gọi')) {
      onCallBot();
      setChatMessages(prev => [
        ...prev,
        {
          sender: 'bot',
          text: '🤖 Đang điều phối Robot AI di chuyển tới bàn làm việc của bạn!',
          time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
          actions: [
            { label: '🛑 Trả Robot về trạm', action: () => onReleaseBot() }
          ],
        },
      ]);
      return;
    }

    if (low.includes('sếp') || low.includes('giám đốc') || low.includes('tuần tra')) {
      onTriggerPatrol();
      setChatMessages(prev => [
        ...prev,
        {
          sender: 'bot',
          text: '📋 Đã kích hoạt Giám đốc đi tuần tra các phòng ban trong văn phòng 3D!',
          time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      return;
    }

    // Kết nối API Trợ lý AI Backend (/api/chatbot/send/)
    setIsBotTyping(true);
    const authHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (idToken) {
      authHeaders['Authorization'] = `Bearer ${idToken}`;
    }

    try {
      const sendRes = await fetch('/api/chatbot/send/', {
        method: 'POST',
        headers: authHeaders,
        credentials: 'include',
        body: JSON.stringify({ message: userText }),
      });

      if (sendRes.ok) {
        const sendData = await sendRes.json();
        const jobId = sendData.job_id;
        if (jobId) {
          if (activePollRef.current) {
            clearInterval(activePollRef.current);
          }
          let attempts = 0;
          activePollRef.current = setInterval(async () => {
            attempts++;
            if (attempts > 25) {
              if (activePollRef.current) {
                clearInterval(activePollRef.current);
                activePollRef.current = null;
              }
              setIsBotTyping(false);
              setChatMessages(prev => [
                ...prev,
                {
                  sender: 'bot',
                  text: 'Hệ thống đang tiếp tục xử lý yêu cầu của bạn. Bạn có thể kiểm tra kết quả ở thanh Trợ lý AI.',
                  time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                },
              ]);
              return;
            }
            try {
              const statusRes = await fetch(`/api/chatbot/jobs/${jobId}/status/`, {
                headers: authHeaders,
                credentials: 'include',
              });
              if (statusRes.ok) {
                const jobData = await statusRes.json();
                if (jobData.status === 'done' || jobData.status === 'DONE') {
                  if (activePollRef.current) {
                    clearInterval(activePollRef.current);
                    activePollRef.current = null;
                  }
                  setIsBotTyping(false);
                  const botReply = jobData.result?.message || 'Tôi đã xử lý xong yêu cầu của bạn.';
                  setChatMessages(prev => [
                    ...prev,
                    {
                      sender: 'bot',
                      text: botReply,
                      time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                    },
                  ]);
                } else if (jobData.status === 'failed' || jobData.status === 'FAILED') {
                  if (activePollRef.current) {
                    clearInterval(activePollRef.current);
                    activePollRef.current = null;
                  }
                  setIsBotTyping(false);
                  setChatMessages(prev => [
                    ...prev,
                    {
                      sender: 'bot',
                      text: jobData.error || 'Rất tiếc, đã có lỗi xảy ra khi xử lý.',
                      time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                    },
                  ]);
                }
              }
            } catch {
              // Tiếp tục poll
            }
          }, 1200);
          return;
        }
      }
    } catch {
      // Fallback sang local responses nếu offline
    }

    setIsBotTyping(false);
    let reply = 'Tôi đã ghi nhận yêu cầu của bạn.';
    let replyActions: ChatAction[] | undefined = undefined;

    if (low.includes('đề') || low.includes('thi') || low.includes('khảo thí')) {
      reply = `Hệ thống Khảo thí AI đang sẵn sàng (${examData.totalPapers} bộ đề). Bạn có thể mở trực tiếp phân hệ Khảo thí tại đây:`;
      replyActions = [
        { label: '🚀 Mở phân hệ Khảo thí', action: () => { onClose(); onNavigateModule('examination'); } }
      ];
    } else if (low.includes('báo cáo') || low.includes('kpi') || low.includes('tuần')) {
      reply = 'Bạn có thể hoàn thành và nộp nhanh Báo cáo tuần công tác tại phân hệ Báo cáo:';
      replyActions = [
        { label: '📝 Mở Báo cáo tuần', action: () => { onClose(); onNavigateModule('weekly-report'); } }
      ];
    } else if (low.includes('lịch') || low.includes('họp') || low.includes('công ca')) {
      reply = 'Bạn có thể kiểm tra Lịch tuần và Công ca của các phòng ban tại đây:';
      replyActions = [
        { label: '📅 Mở Lịch tuần', action: () => { onClose(); onNavigateModule('calendar'); } },
        { label: '⏱️ Mở Công ca', action: () => { onClose(); onNavigateModule('attendance'); } },
      ];
    } else if (low.includes('chào') || low.includes('hello')) {
      reply = 'Chào bạn! Chúc bạn một ngày làm việc tràn đầy năng lượng tại FermatTech! Bạn cần tôi giúp gì?';
      replyActions = [
        { label: 'Mở Khảo thí', action: () => { onClose(); onNavigateModule('examination'); } },
        { label: 'Gọi Robot AI', action: () => onCallBot() },
      ];
    }

    setChatMessages(prev => [
      ...prev,
      {
        sender: 'bot',
        text: reply,
        time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        actions: replyActions,
      },
    ]);
  };

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] pointer-events-auto flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 sm:p-8 animate-in fade-in duration-200">
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
                            {msg.actions && msg.actions.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {msg.actions.map((act, aIdx) => (
                                  <button
                                    key={aIdx}
                                    type="button"
                                    onClick={act.action}
                                    className="rounded-lg border border-[#1E232B]/30 bg-white/90 px-2.5 py-1 text-[11px] font-bold text-[#1E232B] shadow-[1px_1px_0px_#1E232B] hover:bg-[#D97757] hover:text-white transition cursor-pointer"
                                  >
                                    {act.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      {isBotTyping && (
                        <div className="flex justify-start">
                          <div className="p-2.5 rounded-xl border bg-[#EFE7D8] text-[#1E232B] border-[#1E232B]/20 rounded-tl-none flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D97757]" />
                            <span className="text-[11px] font-medium text-[#1E232B]/80">Trợ lý AI đang suy nghĩ phản hồi...</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Quick Prompts */}
                    <div className="px-2.5 py-1.5 border-t border-[#1E232B]/10 bg-[#EFE7D8]/20 flex flex-wrap gap-1.5">
                      {[
                        'Mở Khảo thí',
                        'Báo cáo tuần',
                        'Gọi Robot tới bàn',
                        'Sếp đi tuần',
                        'Xem lịch tuần',
                      ].map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => handleSendChat(chip)}
                          className="rounded-full border border-[#1E232B]/20 bg-white/80 hover:bg-[#D97757] hover:text-white hover:border-[#D97757] px-2.5 py-0.5 text-[10px] font-semibold text-[#1E232B] transition cursor-pointer"
                        >
                          {chip}
                        </button>
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
                        type="button"
                        onClick={() => handleSendChat()}
                        className="px-3 py-1.5 bg-[#D97757] text-white rounded-lg font-bold text-xs flex items-center gap-1 hover:bg-[#c46849] cursor-pointer"
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
                      <p className="text-xl font-bold text-[#D97757] mt-1">{examData.totalPapers} Bộ đề</p>
                    </div>
                    <div className="p-3 bg-[#EFE7D8]/60 border border-[#1E232B]/20 rounded-xl">
                      <span className="text-[10px] uppercase font-bold text-[#1E232B]/60">Kỳ thi sẵn sàng</span>
                      <p className="text-xl font-bold text-[#1E232B] mt-1">{examData.activeCount} Kỳ thi</p>
                    </div>
                    <div className="p-3 bg-[#EFE7D8]/60 border border-[#1E232B]/20 rounded-xl">
                      <span className="text-[10px] uppercase font-bold text-[#1E232B]/60">Độ chính xác chấm AI</span>
                      <p className="text-xl font-bold text-emerald-600 mt-1">{examData.accuracy}</p>
                    </div>
                  </div>

                  <div className="p-3 border border-[#1E232B]/20 rounded-xl bg-white space-y-2">
                    <h4 className="font-bold text-xs uppercase tracking-wide text-[#1E232B]">
                      {examData.papers.length > 0 ? 'Đề thi thực tế từ hệ thống' : 'Các kỳ thi trọng điểm trong tuần'}
                    </h4>
                    <ul className="space-y-1.5 text-xs text-[#1E232B]/80">
                      {examData.papers.length > 0 ? (
                        examData.papers.map((p, pIdx) => (
                          <li key={p.id || pIdx} className="flex justify-between items-center py-1 border-b border-[#1E232B]/10 last:border-b-0">
                            <span className="truncate pr-2">{p.title}</span>
                            <span className="font-mono font-bold text-emerald-600 shrink-0 uppercase text-[10px]">
                              {p.status || 'SẴN SÀNG'}
                            </span>
                          </li>
                        ))
                      ) : (
                        <>
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
                        </>
                      )}
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
                  {initialColleague && (
                    <div className="p-3 bg-blue-50/90 border border-blue-200 rounded-xl flex items-center justify-between text-blue-950 shadow-sm animate-in fade-in duration-150">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-blue-600 shrink-0" />
                        <div>
                          <p className="font-bold text-xs">Giao việc cho: {initialColleague.name}</p>
                          <p className="text-[11px] text-blue-700/80">{initialColleague.role || 'Thành viên ban dự án'}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          onClose();
                          onNavigateModule('work-schedule');
                        }}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-[11px] shadow-sm transition shrink-0"
                      >
                        Mở Phân hệ Giao việc
                      </button>
                    </div>
                  )}

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
                    <h4 className="font-bold text-xs uppercase tracking-wide">
                      Tiến độ công việc & nhiệm vụ ({workData.doneTasks}/{workData.totalTasks || 5} việc)
                    </h4>
                    <div className="w-full bg-[#EFE7D8] h-3 rounded-full overflow-hidden border border-[#1E232B]/30">
                      <div
                        className="bg-[#D97757] h-full transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(0, workData.completionRate))}%` }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-[11px] font-mono text-[#1E232B]/70">
                      <span>Đã hoàn thành: {workData.completionRate}%</span>
                      <span>Hạn chót: Thứ Sáu 17:30</span>
                    </div>
                  </div>

                  {workData.items.length > 0 && (
                    <div className="p-3 border border-[#1E232B]/20 rounded-xl bg-white space-y-2">
                      <h4 className="font-bold text-xs uppercase tracking-wide text-[#1E232B]">
                        Nhiệm vụ trực tiếp từ phân hệ Công việc
                      </h4>
                      <ul className="space-y-1.5 text-xs text-[#1E232B]/80">
                        {workData.items.map((item, iIdx) => (
                          <li key={item.id || iIdx} className="flex justify-between items-center py-1 border-b border-[#1E232B]/10 last:border-b-0">
                            <span className="truncate pr-2">{item.title}</span>
                            <span className={`font-mono font-bold text-[10px] shrink-0 ${
                              item.status === 'DONE' ? 'text-emerald-600' : 'text-amber-600'
                            }`}>
                              {item.status === 'DONE' ? 'HOÀN THÀNH' : 'ĐANG LÀM'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

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
    </div>,
    document.body
  );
}
