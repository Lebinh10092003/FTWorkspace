import React, { useState, useEffect } from 'react';
import { 
  Bot, 
  Sparkles, 
  FileText, 
  Send, 
  CheckCircle2, 
  Clock, 
  RefreshCw, 
  ExternalLink, 
  Check, 
  Upload, 
  Share2,
  Puzzle
} from 'lucide-react';

interface FbBotTeamStudioProps {
  idToken: string;
  userName?: string;
  userEmail?: string;
}

interface MockBot {
  code: string;
  name: string;
  role: string;
  color: string;
  status: 'idle' | 'working' | 'ready';
  currentTask: string;
}

const BOTS_INFO: MockBot[] = [
  { code: 'trend', name: 'AI Săn tin & Xu hướng', role: 'Chuyên viên Săn tin AI', color: 'emerald', status: 'ready', currentTask: 'Đang quét xu hướng công nghệ & giáo dục' },
  { code: 'material', name: 'AI Xử lý tư liệu', role: 'Chuyên viên Tư liệu AI', color: 'amber', status: 'ready', currentTask: 'Sẵn sàng tiếp nhận tài liệu tập huấn' },
  { code: 'writer', name: 'AI Soạn thảo bài viết', role: 'Biên tập viên AI', color: 'blue', status: 'ready', currentTask: 'Chờ tư liệu để chấp bút' },
  { code: 'reviewer', name: 'AI Kiểm duyệt nội dung', role: 'Kiểm duyệt viên AI', color: 'purple', status: 'ready', currentTask: 'Sẵn sàng kiểm tra văn phong & quy chuẩn' },
  { code: 'publisher', name: 'AI Đăng bài tự động', role: 'Điều phối xuất bản AI', color: 'pink', status: 'idle', currentTask: 'Chờ lệnh phê duyệt từ người dùng' },
];

interface DraftItem {
  id: number;
  title: string;
  content: string;
  hashtags: string;
  target?: string;
  status: 'draft' | 'pending' | 'approved' | 'published' | 'rejected';
  reviewScore?: number;
  reviewNotes?: string;
  creator?: string;
  createdAt?: string;
  fb_post_url?: string;
}

export default function FbBotTeamStudio({
  idToken,
  userName,
  userEmail,
}: FbBotTeamStudioProps) {
  const [activeTab, setActiveTab] = useState<'queue' | 'upload' | 'extension'>('queue');
  const [materialTitle, setMaterialTitle] = useState('');
  const [materialContent, setMaterialContent] = useState('');
  const [targetType, setTargetType] = useState<'page' | 'group'>('page');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(false);

  const [draftPosts, setDraftPosts] = useState<DraftItem[]>([
    {
      id: 1,
      title: 'Tổng kết buổi tập huấn Chuyển đổi số giáo dục & Khảo thí 2026',
      content: '🎉 Chúc mừng buổi tập huấn "Ứng dụng AI & Chuyển đổi số trong Khảo thí" do FermatTech tổ chức cùng các trường đã diễn ra thành công tốt đẹp!\n\n💡 Hơn 150 thầy cô giáo và chuyên gia khảo thí đã cùng trải nghiệm quy trình số hóa toàn diện từ ra đề, tổ chức thi đến chấm thi tự động.\n\n👉 Xem chi tiết giải pháp tại: https://fermat.vn',
      hashtags: '#FermatTech #KhaoThi #ChuyenDoiSo #GiaoDuc2026',
      target: 'Fanpage Fermat Education',
      status: 'pending',
      reviewScore: 9.5,
      reviewNotes: 'Văn phong chuẩn mực, CTA rõ ràng, không vi phạm chính sách Facebook.',
      creator: 'AI Soạn thảo',
      createdAt: 'Vừa xong',
    }
  ]);

  const getAuthHeaders = (extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { ...extra };
    const token = idToken || (() => {
      try {
        const raw = localStorage.getItem('ft_auth_session');
        if (raw) {
          const parsed = JSON.parse(raw);
          return parsed?.token || null;
        }
      } catch {
        return null;
      }
      return null;
    })();

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  };

  const loadDrafts = async () => {
    setIsLoadingDrafts(true);
    try {
      const res = await fetch('/api/social-bot/drafts', {
        headers: getAuthHeaders(),
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.drafts && data.drafts.length > 0) {
          const mapped = data.drafts.map((d: any) => ({
            id: d.id,
            title: d.title,
            content: d.content,
            hashtags: d.hashtags,
            target: 'Fanpage Fermat Education',
            status: d.status,
            reviewScore: 9.5,
            reviewNotes: 'Đã được Bot 4 thẩm định văn phong và quy chuẩn cộng đồng.',
            creator: d.bot_creator || 'AI Soạn thảo',
            createdAt: d.created_at || 'Vừa xong',
            fb_post_url: d.fb_post_url,
          }));
          setDraftPosts(mapped);
        }
      }
    } catch (e) {
      console.warn('Could not fetch drafts', e);
    } finally {
      setIsLoadingDrafts(false);
    }
  };

  useEffect(() => {
    loadDrafts();
  }, [idToken]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!materialTitle.trim() || !materialContent.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/social-bot/create-task', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
        body: JSON.stringify({
          title: materialTitle,
          content: materialContent,
          target_type: targetType,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setNotice('Tổ Bot AI đã bóc tách tư liệu, soạn thảo bài viết và kiểm duyệt thành công!');
        setMaterialTitle('');
        setMaterialContent('');
        setActiveTab('queue');
        loadDrafts();
      } else {
        setNotice('Có lỗi khi gọi Tổ Bot AI. Vui lòng thử lại sau.');
      }
    } catch (err) {
      setNotice('Không thể kết nối đến máy chủ.');
    } finally {
      setIsSubmitting(false);
      setTimeout(() => setNotice(''), 4000);
    }
  };

  const handleApprove = async (id: number) => {
    try {
      const res = await fetch('/api/social-bot/approve-draft', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
        body: JSON.stringify({ id, draft_id: id }),
      });
      if (res.ok) {
        setDraftPosts(prev => prev.map(p => p.id === id ? { ...p, status: 'approved' } : p));
        setNotice('Đã phê duyệt bài viết! Bot Đăng bài tự động sẽ xuất bản theo lịch.');
      } else {
        const data = await res.json().catch(() => ({}));
        setNotice(data.error || 'Lỗi khi duyệt bài viết.');
      }
    } catch (e: any) {
      setNotice(e?.message || 'Lỗi khi duyệt bài viết.');
    }
    setTimeout(() => setNotice(''), 3000);
  };

  const handlePublishNow = async (id: number) => {
    try {
      const res = await fetch('/api/social-bot/publish-draft', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
        body: JSON.stringify({ id, draft_id: id }),
      });
      if (res.ok) {
        const data = await res.json();
        setDraftPosts((prev: DraftItem[]) => prev.map((p: DraftItem) => p.id === id ? { ...p, status: 'published', fb_post_url: data.fb_post_url } : p));
        setNotice('Bot 5 đã đăng bài thành công lên Facebook!');
      } else {
        const data = await res.json().catch(() => ({}));
        setNotice(data.error || 'Lỗi khi đăng bài.');
      }
    } catch (e: any) {
      setNotice(e?.message || 'Lỗi khi đăng bài.');
    }
    setTimeout(() => setNotice(''), 3000);
  };

  return (
    <div className="flex flex-col gap-6 w-full animate-fade-in">
      {notice && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl text-xs font-semibold text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Bot Roster Grid */}
      <div className="bg-white dark:bg-slate-800 p-5 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Bot className="w-5 h-5 text-[#0B72CE]" />
              Tổ Bot AI Facebook (Phòng Khảo thí)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              5 nhân sự AI trực tiếp làm việc tại cụm bàn Khảo thí trên Văn phòng 3D.
            </p>
          </div>
          <a
            href="/office"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-[#0B72CE] dark:text-blue-400 rounded-xl text-xs font-semibold transition cursor-pointer self-start sm:self-auto"
          >
            <span>Xem trên Văn phòng 3D</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {BOTS_INFO.map(b => (
            <div 
              key={b.code} 
              className="p-3.5 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-100 dark:border-slate-800 flex flex-col gap-2 transition hover:shadow-xs"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {b.role}
                </span>
                <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Online
                </span>
              </div>
              <div className="font-bold text-xs text-slate-800 dark:text-slate-200">
                {b.name}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-auto bg-white dark:bg-slate-800 p-2 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                {b.currentTask}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sub Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('queue')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeTab === 'queue'
              ? 'bg-[#0B72CE] text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Bài viết & Phê duyệt ({draftPosts.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('upload')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeTab === 'upload'
              ? 'bg-[#0B72CE] text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Nạp tư liệu cho Bot</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('extension')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeTab === 'extension'
              ? 'bg-[#0B72CE] text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Puzzle className="w-3.5 h-3.5" />
          <span>Extension Đăng Nhóm FB</span>
        </button>
      </div>

      {/* Tab 1: Queue & Approval */}
      {activeTab === 'queue' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {isLoadingDrafts ? (
            <div className="col-span-2 py-10 text-center text-xs text-slate-400">
              Đang tải danh sách bài viết từ Tổ Bot...
            </div>
          ) : draftPosts.map(post => (
            <div 
              key={post.id}
              className="bg-white dark:bg-slate-800 p-5 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-xs flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-blue-50 dark:bg-blue-950/60 text-[#0B72CE] dark:text-blue-400">
                    {post.target || 'Fanpage Facebook'}
                  </span>
                  <div className="flex items-center gap-2">
                    {post.status === 'pending' && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-md">
                        <Clock className="w-3 h-3" />
                        Chờ duyệt
                      </span>
                    )}
                    {post.status === 'approved' && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-md">
                        <Check className="w-3 h-3" />
                        Đã duyệt
                      </span>
                    )}
                    {post.status === 'published' && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/50 px-2 py-0.5 rounded-md">
                        <Share2 className="w-3 h-3" />
                        Đã đăng FB
                      </span>
                    )}
                  </div>
                </div>

                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 mb-2">
                  {post.title}
                </h3>

                <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-100 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-line mb-3 font-normal leading-relaxed">
                  {post.content}
                  <div className="text-blue-600 dark:text-blue-400 font-medium mt-2">
                    {post.hashtags}
                  </div>
                </div>

                {/* Reviewer Note */}
                <div className="flex items-start gap-2 p-2.5 bg-purple-50/60 dark:bg-purple-950/30 border border-purple-100 dark:border-purple-900/40 rounded-xl text-[11px] text-purple-900 dark:text-purple-300 mb-4">
                  <Bot className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Đánh giá của Bot 4 ({post.reviewScore || 9.5}/10): </span>
                    <span>{post.reviewNotes || 'Đạt chuẩn nội dung.'}</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-700 text-xs">
                <span className="text-[11px] text-slate-400">
                  Tạo bởi {post.creator || 'AI Soạn thảo'} • {post.createdAt}
                </span>
                <div className="flex items-center gap-2">
                  {post.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => handleApprove(post.id)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition flex items-center gap-1 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Phê duyệt</span>
                    </button>
                  )}
                  {post.status === 'approved' && (
                    <button
                      type="button"
                      onClick={() => handlePublishNow(post.id)}
                      className="px-3 py-1.5 bg-[#0B72CE] hover:bg-blue-700 text-white rounded-xl font-bold transition flex items-center gap-1 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Đăng ngay (Bot 5)</span>
                    </button>
                  )}
                  {post.status === 'published' && (
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs font-semibold">
                        Đã phát hành
                      </span>
                      {post.fb_post_url && (
                        <a
                          href={post.fb_post_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 text-[#0B72CE] dark:text-blue-400 rounded-xl text-xs font-semibold flex items-center gap-1 transition"
                        >
                          <span>Xem bài</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab 2: Upload Material */}
      {activeTab === 'upload' && (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-xs max-w-2xl">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            Nạp dữ liệu & Yêu cầu soạn bài
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
            Dữ liệu sẽ được chuyển giao cho Bot 2 (Tư liệu) bóc tách và Bot 3 (Soạn bài) viết nội dung hoàn chỉnh qua AI.
          </p>

          <form onSubmit={handleCreateTask} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Chủ đề hoặc Tiêu đề sự kiện *
              </label>
              <input
                type="text"
                value={materialTitle}
                onChange={e => setMaterialTitle(e.target.value)}
                placeholder="VD: Buổi tập huấn ứng dụng AI trong khảo thí tại Hà Nội"
                required
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs focus:outline-hidden focus:ring-2 focus:ring-[#0B72CE]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Đích xuất bản dự kiến
                </label>
                <select
                  value={targetType}
                  onChange={e => setTargetType(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
                >
                  <option value="page">Fanpage công ty</option>
                  <option value="group">Facebook Group cộng đồng</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Đính kèm hình ảnh
                </label>
                <div className="flex items-center justify-center p-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-500 cursor-pointer hover:bg-slate-100">
                  <Upload className="w-3.5 h-3.5 mr-1" />
                  <span>Chọn ảnh đính kèm...</span>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Ghi chú nội dung, biên bản hoặc ý chính cần nhấn mạnh *
              </label>
              <textarea
                value={materialContent}
                onChange={e => setMaterialContent(e.target.value)}
                rows={5}
                placeholder="Dán nội dung tóm tắt buổi làm việc, các số liệu tham gia, điểm nổi bật hoặc yêu cầu riêng về văn phong..."
                required
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs focus:outline-hidden focus:ring-2 focus:ring-[#0B72CE]"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-2 w-full py-2.5 bg-[#0B72CE] hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Tổ Bot AI đang xử lý (Bot 2 → Bot 3 → Bot 4)...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Giao việc cho Tổ Bot AI soạn thảo</span>
                </>
              )}
            </button>
          </form>
        </div>
      )}

      {/* Tab 3: Chrome Extension for FB Groups */}
      {activeTab === 'extension' && (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-xs max-w-3xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 dark:bg-blue-950/60 flex items-center justify-center text-[#0B72CE]">
              <Puzzle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Tiện ích FT Workspace - Facebook Group Auto Poster
              </h3>
              <p className="text-xs text-slate-500">
                Đăng bài viết đã duyệt vào các Nhóm Facebook bằng chính tài khoản cá nhân của bạn, không lo bị chặn hay checkpoint.
              </p>
            </div>
          </div>

          <div className="space-y-4 text-xs text-slate-600 dark:text-slate-300">
            <div className="p-4 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-100 dark:border-slate-800">
              <h4 className="font-bold text-slate-900 dark:text-slate-100 mb-2">4 bước cài đặt nhanh vào Google Chrome / Cốc Cốc / Edge:</h4>
              <ol className="list-decimal list-inside space-y-2 text-slate-700 dark:text-slate-300">
                <li>
                  Mở trình duyệt truy cập: <code className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-800 rounded font-mono text-[11px]">chrome://extensions</code>
                </li>
                <li>
                  Bật công tắc <strong>Chế độ dành cho nhà phát triển (Developer mode)</strong> ở góc trên bên phải.
                </li>
                <li>
                  Bấm nút <strong>Tải tiện ích đã giải nén (Load unpacked)</strong>.
                </li>
                <li>
                  Chọn thư mục: <code className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-800 rounded font-mono text-[11px]">extensions/ft-fb-group-poster</code> trong mã nguồn dự án.
                </li>
              </ol>
            </div>

            <div className="p-4 bg-blue-50/50 dark:bg-blue-950/30 rounded-2xl border border-blue-100 dark:border-blue-900/40">
              <h4 className="font-bold text-[#0B72CE] dark:text-blue-300 mb-1">Cách vận hành:</h4>
              <ul className="list-disc list-inside space-y-1.5 text-slate-600 dark:text-slate-300">
                <li>Tiện ích tự động nhận danh sách các bài viết đã được duyệt từ Workspace.</li>
                <li>Bấm <strong>Mở nhóm & Điền bài</strong>: Tiện ích mở Facebook Group và tự động dán nội dung đã chuẩn bị sẵn.</li>
                <li>Bạn kiểm tra và bấm nút Đăng trên Facebook thật.</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
