import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Compass,
  ExternalLink,
  Layers,
  Loader2,
  MessageSquare,
  Minus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  ACCOUNT_MANAGEMENT_NAV,
  ATTENDANCE_NAV,
  COMMUNICATION_TOOLS_NAV,
  DIGITAL_TRAINING_NAV,
  EXAMINATION_NAV,
  FINANCE_NAV,
  SOCIAL_DASHBOARD_NAV,
  WORKSPACE_AREAS,
  WORK_SCHEDULE_NAV,
} from '../../config/workspaceNavigation';

export interface ChatbotAssistantProps {
  token: string;
  userName: string;
  userEmail: string;
  userRole: string;
  onNavigate: (path: string) => void;
}

interface ActionDiff {
  before?: Record<string, any>;
  after?: Record<string, any>;
  params?: Record<string, any>;
}

interface ChatActionItem {
  id: string;
  tool_name: string;
  preview_description: string;
  diff_summary?: ActionDiff;
  status: 'pending' | 'executed' | 'cancelled' | 'expired' | 'failed';
  expires_at?: string;
  error_message?: string;
}

interface ChatMessageItem {
  id: number | string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  links?: Array<{ title: string; path: string }>;
  actions?: ChatActionItem[];
  created_at?: string;
}

interface ToolSearchItem {
  id: string;
  title: string;
  area: string;
  path: string;
  description: string;
  icon?: React.ElementType;
}

const STORAGE_KEY_OPEN = 'ft_workspace_chatbot_open';

function removeVietnameseTones(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export default function ChatbotAssistant({
  token,
  userName,
  userEmail,
  userRole,
  onNavigate,
}: ChatbotAssistantProps) {
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_OPEN) === '1';
    } catch {
      return false;
    }
  });
  const [activeTab, setActiveTab] = useState<'chat' | 'search'>('chat');
  const [searchQuery, setSearchQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [jobStatus, setJobStatus] = useState<'queued' | 'running' | null>(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [healthStatus, setHealthStatus] = useState<'ready' | 'auth_error' | 'error' | null>(null);
  const [healthError, setHealthError] = useState<string>('');
  const [actionProcessing, setActionProcessing] = useState<Record<string, boolean>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<any>(null);

  // Flattened tools and pages index from workspaceNavigation
  const searchableTools = useMemo<ToolSearchItem[]>(() => {
    const list: ToolSearchItem[] = [];

    WORKSPACE_AREAS.forEach(area => {
      list.push({
        id: area.id,
        title: area.label,
        area: 'Phân hệ chính',
        path: area.path,
        description: area.description,
        icon: area.icon,
      });
    });

    const addNavItems = (items: any[], areaName: string, basePathPrefix: string) => {
      items.forEach(item => {
        const itemPath = item.id.startsWith('/') ? item.id : `${basePathPrefix}/${item.id}`;
        list.push({
          id: `${areaName}-${item.id}`,
          title: item.label,
          area: areaName,
          path: itemPath,
          description: `Công cụ thuộc phân hệ ${areaName}`,
          icon: item.icon,
        });
        if (item.children) {
          item.children.forEach((sub: any) => {
            list.push({
              id: `${areaName}-${item.id}-${sub.id}`,
              title: `${item.label} > ${sub.label}`,
              area: areaName,
              path: itemPath,
              description: `Mục chi tiết trong ${item.label}`,
              icon: sub.icon,
            });
          });
        }
      });
    };

    addNavItems(COMMUNICATION_TOOLS_NAV, 'Bộ công cụ', '/communication-tools');
    addNavItems(WORK_SCHEDULE_NAV, 'Lịch làm việc', '/work-schedule');
    addNavItems(EXAMINATION_NAV, 'Khảo thí', '/examination');
    addNavItems(DIGITAL_TRAINING_NAV, 'Công nghệ & Đào tạo số', '/digital-training');
    addNavItems(ATTENDANCE_NAV, 'Công ca', '/attendance');
    addNavItems(FINANCE_NAV, 'Báo cáo thu chi', '/finance-report');
    addNavItems(ACCOUNT_MANAGEMENT_NAV, 'Quản lý nhân viên', '/account-management');
    addNavItems(SOCIAL_DASHBOARD_NAV, 'Truyền thông', '/social-dashboard');

    return list;
  }, []);

  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) return searchableTools.slice(0, 15);
    const q = removeVietnameseTones(searchQuery.trim());
    return searchableTools.filter(item => {
      const titleMatch = removeVietnameseTones(item.title).includes(q);
      const descMatch = removeVietnameseTones(item.description).includes(q);
      const areaMatch = removeVietnameseTones(item.area).includes(q);
      return titleMatch || descMatch || areaMatch;
    });
  }, [searchableTools, searchQuery]);

  // Persist open/close state
  const handleToggleOpen = () => {
    setIsOpen(prev => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_OPEN, next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  // Scroll to bottom on new message
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, jobStatus, isOpen]);

  // Load health check and initial chat history
  useEffect(() => {
    if (!token) return;

    // Check health
    fetch('/api/chatbot/health/', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        if (data.status) {
          setHealthStatus(data.status);
          setHealthError(data.error_message || '');
        }
      })
      .catch(() => {});

    // Load history
    setLoadingHistory(true);
    fetch('/api/chatbot/history/', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data.messages)) {
          setMessages(data.messages);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [token]);

  // Polling active chat job
  useEffect(() => {
    if (!activeJobId || !token) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    const pollStatus = async () => {
      try {
        const res = await fetch(`/api/chatbot/jobs/${activeJobId}/status/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();

        setJobStatus(data.status);
        setQueuePosition(data.queue_position);

        if (data.status === 'done') {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          setActiveJobId(null);
          setJobStatus(null);
          setQueuePosition(null);

          if (data.result) {
            setMessages(prev => [
              ...prev,
              {
                id: `msg-${Date.now()}`,
                role: 'assistant',
                content: data.result.message || '',
                links: data.result.links || [],
                actions: data.result.actions || [],
                created_at: new Date().toISOString(),
              },
            ]);
          }
        } else if (data.status === 'failed' || data.status === 'cancelled') {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          setActiveJobId(null);
          setJobStatus(null);
          setQueuePosition(null);

          setMessages(prev => [
            ...prev,
            {
              id: `msg-${Date.now()}`,
              role: 'system',
              content: data.error || (data.status === 'cancelled' ? 'Yêu cầu đã bị hủy.' : 'Không thể xử lý yêu cầu lúc này.'),
              created_at: new Date().toISOString(),
            },
          ]);
        }
      } catch (err) {
        // Continue polling unless too many failures
      }
    };

    pollIntervalRef.current = setInterval(pollStatus, 800);
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [activeJobId, token]);

  const handleSendMessage = async (customText?: string) => {
    const textToSend = (customText !== undefined ? customText : inputText).trim();
    if (!textToSend || activeJobId || !token) return;

    setInputText('');

    // Optimistic user message
    const tempUserMsg: ChatMessageItem = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: textToSend,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);
    setJobStatus('queued');

    try {
      const res = await fetch('/api/chatbot/send/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: textToSend }),
      });

      const data = await res.json();
      if (!res.ok) {
        setJobStatus(null);
        setMessages(prev => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'system',
            content: data.error || 'Có lỗi xảy ra khi gửi tin nhắn.',
            created_at: new Date().toISOString(),
          },
        ]);
        return;
      }

      setActiveJobId(data.job_id);
      setJobStatus(data.status);
      setQueuePosition(data.queue_position);
    } catch (err) {
      setJobStatus(null);
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'system',
          content: 'Không thể kết nối đến máy chủ. Vui lòng thử lại.',
          created_at: new Date().toISOString(),
        },
      ]);
    }
  };

  const handleCancelJob = async () => {
    if (!activeJobId || !token) return;
    try {
      await fetch(`/api/chatbot/jobs/${activeJobId}/cancel/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      setActiveJobId(null);
      setJobStatus(null);
      setQueuePosition(null);
      setMessages(prev => [
        ...prev,
        {
          id: `cancelled-${Date.now()}`,
          role: 'system',
          content: 'Bạn đã dừng câu hỏi này.',
          created_at: new Date().toISOString(),
        },
      ]);
    } catch {}
  };

  const handleClearHistory = async () => {
    if (!token) return;
    try {
      await fetch('/api/chatbot/history/clear/', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setMessages([]);
    } catch {}
  };

  const handleConfirmAction = async (actionId: string) => {
    if (!token) return;
    setActionProcessing(prev => ({ ...prev, [actionId]: true }));
    try {
      const res = await fetch(`/api/chatbot/actions/${actionId}/confirm/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      setMessages(prevMsgs =>
        prevMsgs.map(msg => {
          if (!msg.actions) return msg;
          return {
            ...msg,
            actions: msg.actions.map(act => {
              if (act.id === actionId) {
                return {
                  ...act,
                  status: res.ok ? 'executed' : 'failed',
                  error_message: !res.ok ? data.error : undefined,
                };
              }
              return act;
            }),
          };
        })
      );
    } catch {
      // Failed network
    } finally {
      setActionProcessing(prev => ({ ...prev, [actionId]: false }));
    }
  };

  const handleCancelAction = async (actionId: string) => {
    if (!token) return;
    setActionProcessing(prev => ({ ...prev, [actionId]: true }));
    try {
      await fetch(`/api/chatbot/actions/${actionId}/cancel/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      setMessages(prevMsgs =>
        prevMsgs.map(msg => {
          if (!msg.actions) return msg;
          return {
            ...msg,
            actions: msg.actions.map(act => {
              if (act.id === actionId) {
                return { ...act, status: 'cancelled' };
              }
              return act;
            }),
          };
        })
      );
    } catch {
    } finally {
      setActionProcessing(prev => ({ ...prev, [actionId]: false }));
    }
  };

  const quickPrompts = [
    'Xem lịch công việc hôm nay của tôi',
    'Xem báo cáo tuần này của tôi',
    'Xem bảng chấm công tháng này',
  ];

  return (
    <>
      {/* Floating launcher trigger button */}
      <button
        type="button"
        onClick={handleToggleOpen}
        aria-label="Mở Trợ lý AI Workspace"
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] right-4 lg:bottom-6 lg:right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#0B72CE] text-white shadow-xl shadow-[#0B72CE]/30 transition-all duration-200 hover:scale-105 hover:bg-[#075CA8] active:scale-95 focus:outline-none focus:ring-4 focus:ring-[#0B72CE]/30"
      >
        {isOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <div className="relative">
            <Bot className="h-7 w-7" />
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-400 ring-2 ring-white dark:ring-slate-900">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
            </span>
          </div>
        )}
      </button>

      {/* Mobile Backdrop Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-45 bg-slate-950/40 md:hidden backdrop-blur-xs transition-opacity"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Chat window modal / sheet */}
      {isOpen && (
        <div
          className="fixed inset-x-0 bottom-0 z-50 flex h-[86vh] flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-200 md:bottom-20 md:right-5 md:left-auto md:h-[600px] md:w-[420px] md:rounded-2xl dark:border-slate-800 dark:bg-slate-900"
          style={{ maxHeight: 'calc(100vh - 80px)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-4 py-3 backdrop-blur-md dark:border-slate-800 dark:bg-slate-800/80">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Trợ lý Workspace</h3>
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    FT AI
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {healthStatus === 'auth_error' ? (
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <AlertCircle className="h-3 w-3" /> Cần đăng nhập lại
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Sẵn sàng hỗ trợ
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Header actions */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveTab(prev => (prev === 'chat' ? 'search' : 'chat'))}
                title={activeTab === 'chat' ? 'Tìm công cụ / trang' : 'Quay lại Chat'}
                className={`flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold transition-colors ${
                  activeTab === 'search'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-200/70 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200'
                }`}
              >
                <Search className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Tìm tool</span>
              </button>

              {activeTab === 'chat' && messages.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearHistory}
                  title="Xóa cuộc trò chuyện"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-rose-600 dark:hover:bg-slate-800"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}

              <button
                type="button"
                onClick={handleToggleOpen}
                title="Đóng cửa sổ"
                aria-label="Đóng cửa sổ Trợ lý"
                className="flex h-10 w-10 sm:h-8 sm:w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                <ChevronDown className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Body: Search Panel or Chat Feed */}
          {activeTab === 'search' ? (
            <div className="flex flex-1 flex-col overflow-hidden bg-slate-50/50 p-3 dark:bg-slate-900/50">
              <div className="relative mb-3">
                <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Tìm nhanh công cụ, phân hệ..."
                  autoFocus
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pr-3 pl-9 text-xs text-slate-800 placeholder-slate-400 shadow-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                {filteredTools.length === 0 ? (
                  <div className="grid h-40 place-items-center text-center text-xs text-slate-400">
                    Không tìm thấy công cụ nào phù hợp.
                  </div>
                ) : (
                  filteredTools.map(item => {
                    const Icon = item.icon || Layers;
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-white p-2.5 shadow-xs transition-colors hover:border-blue-400 dark:border-slate-800 dark:bg-slate-800/80"
                      >
                        <div className="flex items-center gap-2.5 pr-2">
                          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                              {item.title}
                            </div>
                            <div className="text-[10px] text-slate-400">{item.area}</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onNavigate(item.path);
                          }}
                          className="shrink-0 flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-blue-600 hover:text-white transition-colors dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-blue-600"
                        >
                          Đi tới <ArrowRight className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Message scroll container */}
              <div className="flex-1 space-y-3.5 overflow-y-auto p-4">
                {/* Auth error notification banner if applicable */}
                {healthStatus === 'auth_error' && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
                    <div className="flex items-center gap-1.5 font-bold">
                      <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      Trợ lý AI đang tạm ngừng phiên đăng nhập
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed">
                      Quản trị viên cần đăng nhập lại tài khoản AI trên máy chủ. Bạn vẫn có thể dùng nút{' '}
                      <strong>"Tìm tool"</strong> ở trên để truy cập nhanh các tính năng Workspace.
                    </div>
                  </div>
                )}

                {loadingHistory ? (
                  <div className="grid h-40 place-items-center text-xs text-slate-400">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/80 dark:text-blue-400">
                      <Sparkles className="h-6 w-6" />
                    </div>
                    <h4 className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-100">
                      Xin chào {userName || 'bạn'}!
                    </h4>
                    <p className="mt-1 max-w-[280px] text-xs text-slate-500 dark:text-slate-400">
                      Tôi có thể tra cứu lịch công tác, xem báo cáo tuần, kiểm tra chấm công hoặc hướng dẫn vị trí công cụ.
                    </p>

                    <div className="mt-5 flex flex-col gap-2 w-full max-w-xs">
                      {quickPrompts.map((p, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleSendMessage(p)}
                          className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-700 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-blue-950/40"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <MessageSquare className="h-3 w-3 shrink-0 opacity-70" />
                            <span>{p}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messages.map(msg => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                    >
                      {msg.role === 'user' ? (
                        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-blue-600 px-3.5 py-2.5 text-xs text-white shadow-xs">
                          {msg.content}
                        </div>
                      ) : msg.role === 'system' ? (
                        <div className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                          {msg.content}
                        </div>
                      ) : (
                        <div className="max-w-[90%] space-y-2">
                          <div className="rounded-2xl rounded-tl-sm border border-slate-200/80 bg-slate-50/90 px-3.5 py-2.5 text-xs text-slate-800 leading-relaxed shadow-xs dark:border-slate-800 dark:bg-slate-800 dark:text-slate-100">
                            <div className="whitespace-pre-wrap">{msg.content}</div>

                            {/* Internal Links */}
                            {msg.links && msg.links.length > 0 && (
                              <div className="mt-2.5 pt-2 border-t border-slate-200/60 dark:border-slate-700 flex flex-wrap gap-1.5">
                                {msg.links.map((link, lIdx) => (
                                  <button
                                    key={lIdx}
                                    type="button"
                                    onClick={() => onNavigate(link.path)}
                                    className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 transition-colors"
                                  >
                                    <Compass className="h-3 w-3" />
                                    {link.title}
                                    <ArrowRight className="h-2.5 w-2.5" />
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Action Cards (Pending confirmation) */}
                          {msg.actions && msg.actions.length > 0 && (
                            <div className="space-y-2">
                              {msg.actions.map(act => (
                                <div
                                  key={act.id}
                                  className="rounded-xl border border-amber-300 bg-amber-50/80 p-3 text-xs dark:border-amber-900/60 dark:bg-amber-950/30"
                                >
                                  <div className="font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                                    <Clock className="h-3.5 w-3.5 text-amber-600" />
                                    Yêu cầu xác nhận thao tác
                                  </div>
                                  <div className="mt-1 text-slate-700 dark:text-slate-300">
                                    {act.preview_description}
                                  </div>

                                  {act.status === 'pending' ? (
                                    <div className="mt-3 flex items-center gap-2">
                                      <button
                                        type="button"
                                        disabled={actionProcessing[act.id]}
                                        onClick={() => handleConfirmAction(act.id)}
                                        className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-blue-700 disabled:opacity-50"
                                      >
                                        {actionProcessing[act.id] ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <Check className="h-3.5 w-3.5" />
                                        )}
                                        Xác nhận
                                      </button>
                                      <button
                                        type="button"
                                        disabled={actionProcessing[act.id]}
                                        onClick={() => handleCancelAction(act.id)}
                                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                      >
                                        Hủy
                                      </button>
                                    </div>
                                  ) : act.status === 'executed' ? (
                                    <div className="mt-2 flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                                      <CheckCircle2 className="h-3.5 w-3.5" /> Đã thực thi thành công
                                    </div>
                                  ) : act.status === 'cancelled' ? (
                                    <div className="mt-2 text-slate-500 italic">Đã hủy bỏ</div>
                                  ) : act.status === 'expired' ? (
                                    <div className="mt-2 text-slate-500 italic">Đã hết hạn</div>
                                  ) : (
                                    <div className="mt-2 text-rose-600 font-medium">
                                      Thất bại: {act.error_message || 'Có lỗi xảy ra'}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}

                {/* Queue / Processing Indicator */}
                {jobStatus && (
                  <div className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50/70 p-2.5 text-xs text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                      <span>
                        {jobStatus === 'queued'
                          ? `Đang xếp hàng chờ (vị trí: ${queuePosition || 1})...`
                          : 'Trợ lý đang suy nghĩ và kiểm tra dữ liệu...'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleCancelJob}
                      className="rounded bg-blue-200/60 px-2 py-0.5 text-[11px] font-semibold text-blue-800 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-200"
                    >
                      Dừng
                    </button>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input Area with safe-area and touch-friendly controls */}
              <div
                className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
              >
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    handleSendMessage();
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    disabled={!!activeJobId || healthStatus === 'auth_error'}
                    placeholder={
                      healthStatus === 'auth_error'
                        ? 'AI tạm ngừng, vui lòng dùng nút Tìm tool...'
                        : 'Hỏi về lịch công tác, báo cáo tuần...'
                    }
                    className="flex-1 min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    disabled={!inputText.trim() || !!activeJobId || healthStatus === 'auth_error'}
                    aria-label="Gửi tin nhắn"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0B72CE] text-white shadow-xs transition hover:bg-[#075CA8] disabled:opacity-40 cursor-pointer"
                  >
                    <Send className="h-5 w-5" />
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
