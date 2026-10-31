import React, { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  Calendar,
  Clock,
  Radio,
  Share2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Save,
  Send,
  ShieldCheck,
  XCircle,
  FileText,
  ExternalLink,
  RotateCw,
} from 'lucide-react';
import type { PostPlan, PublishChannel, PostVariant } from './publishingTypes';
import { PLAN_STATUS_MAP, VARIANT_STATUS_MAP, CHANNEL_KIND_MAP } from './publishingTypes';
import { publishingService } from './publishingService';
import { appDialog } from '../AppDialog';

interface PlanEditorModalProps {
  idToken: string;
  plan: PostPlan | null;
  channels: PublishChannel[];
  newsPosts: Array<{ id: number; title: string; post_type: string; excerpt?: string }>;
  initialDate?: string;
  initialNewsPost?: { id: number; title: string; content: string } | null;
  userRole?: string;
  userEmail?: string;
  onClose: () => void;
  onSaved: () => void;
}

export const PlanEditorModal: React.FC<PlanEditorModalProps> = ({
  idToken,
  plan,
  channels,
  newsPosts,
  initialDate,
  initialNewsPost,
  userRole,
  userEmail,
  onClose,
  onSaved,
}) => {
  const isManagerOrAdmin = userRole === 'ADMIN' || userRole === 'MANAGER';

  // Core plan fields
  const [title, setTitle] = useState(plan?.title || initialNewsPost?.title || '');
  const [baseContent, setBaseContent] = useState(plan?.base_content || initialNewsPost?.content || '');
  const [newsPostId, setNewsPostId] = useState<number | null>(plan?.news_post_id || initialNewsPost?.id || null);

  // Scheduled date time (local format YYYY-MM-DDTHH:mm)
  const getInitialSchedule = () => {
    if (plan?.scheduled_at) {
      const d = new Date(plan.scheduled_at);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    if (initialDate) {
      return `${initialDate}T09:00`;
    }
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const [scheduledAt, setScheduledAt] = useState(getInitialSchedule);

  // Selected channel IDs for the plan
  const [selectedChannelIds, setSelectedChannelIds] = useState<number[]>(() => {
    if (plan?.variants && plan.variants.length > 0) {
      return plan.variants.map(v => v.channel_id);
    }
    // Default to active shared channels
    return channels.filter(c => c.is_active && c.is_shared).map(c => c.id);
  });

  // Current active variant tab
  const [activeVariantChannelId, setActiveVariantChannelId] = useState<number | null>(null);

  // Local copy of variants for editing
  const [variants, setVariants] = useState<PostVariant[]>(plan?.variants || []);

  // UI state
  const [saving, setSaving] = useState(false);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [aiJobStatus, setAiJobStatus] = useState<string | null>(plan?.active_job?.status || null);

  // Sync variants when plan changes
  useEffect(() => {
    if (plan?.variants) {
      setVariants(plan.variants);
      if (plan.variants.length > 0 && !activeVariantChannelId) {
        setActiveVariantChannelId(plan.variants[0].channel_id);
      }
    }
  }, [plan]);

  // Set default active variant tab
  useEffect(() => {
    if (selectedChannelIds.length > 0 && (!activeVariantChannelId || !selectedChannelIds.includes(activeVariantChannelId))) {
      setActiveVariantChannelId(selectedChannelIds[0]);
    }
  }, [selectedChannelIds, activeVariantChannelId]);

  // Handle NewsPost picker change
  const handleSelectNewsPost = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (!val) {
      setNewsPostId(null);
      return;
    }
    const id = parseInt(val, 10);
    setNewsPostId(id);
    const np = newsPosts.find(p => p.id === id);
    if (np) {
      if (!title.trim()) setTitle(np.title);
      if (!baseContent.trim() && np.excerpt) setBaseContent(np.excerpt);
    }
  };

  // Toggle channel selection
  const handleToggleChannel = (channelId: number) => {
    setSelectedChannelIds(prev =>
      prev.includes(channelId) ? prev.filter(id => id !== channelId) : [...prev, channelId]
    );
  };

  // Save base plan
  const handleSavePlan = async (submitForApproval = false) => {
    if (!title.trim()) {
      setError('Vui lòng nhập tiêu đề kế hoạch.');
      return null;
    }
    if (selectedChannelIds.length === 0) {
      setError('Vui lòng chọn ít nhất một kênh xuất bản.');
      return null;
    }

    setSaving(true);
    setError('');
    setSuccessMsg('');

    try {
      let savedPlan: PostPlan;
      if (plan) {
        savedPlan = await publishingService.updatePlan(idToken, plan.id, {
          title: title.trim(),
          base_content: baseContent.trim(),
          scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          channel_ids: selectedChannelIds,
          submit_for_approval: submitForApproval,
        });
      } else {
        savedPlan = await publishingService.createPlan(idToken, {
          title: title.trim(),
          base_content: baseContent.trim(),
          news_post_id: newsPostId,
          scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          channel_ids: selectedChannelIds,
        });
        if (submitForApproval) {
          savedPlan = await publishingService.updatePlan(idToken, savedPlan.id, {
            submit_for_approval: true,
          });
        }
      }

      setVariants(savedPlan.variants);
      setSuccessMsg(submitForApproval ? 'Đã gửi kế hoạch chờ duyệt.' : 'Đã lưu kế hoạch thành công.');
      onSaved();
      return savedPlan;
    } catch (err: any) {
      setError(err?.message || 'Không thể lưu kế hoạch.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  // AI variant generation
  const handleGenerateAiVariants = async () => {
    if (!baseContent.trim() && !title.trim()) {
      setError('Vui lòng nhập tiêu đề hoặc nội dung gốc trước khi yêu cầu AI sinh bài.');
      return;
    }

    setGeneratingAi(true);
    setError('');
    setSuccessMsg('');

    try {
      // 1. Ensure plan is saved first
      let currentPlanId = plan?.id;
      if (!currentPlanId) {
        const saved = await handleSavePlan();
        if (!saved) return;
        currentPlanId = saved.id;
      }

      // 2. Dispatch AI generation job
      const res = await publishingService.generateAiVariants(idToken, currentPlanId, selectedChannelIds);
      setAiJobStatus('pending');
      setSuccessMsg(res.message || 'Đã đưa yêu cầu soạn bài vào hàng đợi AI.');

      // 3. Poll for result up to 20 seconds
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        try {
          const updated = await publishingService.getPlanDetail(idToken, currentPlanId!);
          if (updated.active_job) {
            setAiJobStatus(updated.active_job.status);
            if (updated.active_job.status === 'completed') {
              clearInterval(pollInterval);
              setVariants(updated.variants);
              setGeneratingAi(false);
              setSuccessMsg('AI đã soạn thảo xong biến thể cho tất cả các kênh!');
              onSaved();
            } else if (updated.active_job.status === 'failed') {
              clearInterval(pollInterval);
              setGeneratingAi(false);
              setError(updated.active_job.error_message || 'AI tạo biến thể thất bại.');
            }
          }
        } catch {
          // ignore poll error
        }
        if (attempts >= 15) {
          clearInterval(pollInterval);
          setGeneratingAi(false);
          setSuccessMsg('AI đang xử lý ngầm trong hàng đợi. Bạn có thể bấm "Làm mới" sau.');
        }
      }, 1500);
    } catch (err: any) {
      setError(err?.message || 'Không thể tạo biến thể AI.');
      setGeneratingAi(false);
    }
  };

  // Manual refresh of plan and variants
  const handleRefreshPlan = async () => {
    if (!plan?.id) return;
    try {
      const updated = await publishingService.getPlanDetail(idToken, plan.id);
      setVariants(updated.variants);
      if (updated.active_job) {
        setAiJobStatus(updated.active_job.status);
      }
      setSuccessMsg('Đã làm mới dữ liệu.');
    } catch (err: any) {
      setError(err?.message || 'Không thể làm mới.');
    }
  };

  // Update specific variant field locally
  const handleVariantChange = (channelId: number, field: keyof PostVariant, value: string) => {
    setVariants(prev =>
      prev.map(v => (v.channel_id === channelId ? { ...v, [field]: value } : v))
    );
  };

  // Save single variant to backend
  const handleSaveVariant = async (variant: PostVariant) => {
    setError('');
    setSuccessMsg('');
    try {
      const updated = await publishingService.updateVariant(idToken, variant.id, {
        title: variant.title,
        content: variant.content,
        link_url: variant.link_url,
      });
      setVariants(prev => prev.map(v => (v.id === updated.id ? updated : v)));
      setSuccessMsg(`Đã lưu nội dung biến thể cho ${variant.channel_name}.`);
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Không thể lưu biến thể.');
    }
  };

  // Approve / Reject
  const handleApprove = async () => {
    if (!plan?.id) return;
    setApproving(true);
    setError('');
    try {
      await publishingService.approvePlan(idToken, plan.id, 'approve');
      setSuccessMsg('Đã phê duyệt và lên lịch phát hành thành công!');
      onSaved();
      setTimeout(onClose, 800);
    } catch (err: any) {
      setError(err?.message || 'Không thể phê duyệt.');
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!plan?.id) return;
    const reason = await appDialog.prompt('Nhập lý do từ chối phê duyệt (để tác giả chỉnh sửa lại):', {
      placeholder: 'Lý do từ chối...',
    });
    if (reason === null) return;

    setApproving(true);
    setError('');
    try {
      await publishingService.approvePlan(idToken, plan.id, 'reject', reason);
      setSuccessMsg('Đã từ chối kế hoạch đăng bài.');
      onSaved();
      setTimeout(onClose, 800);
    } catch (err: any) {
      setError(err?.message || 'Không thể từ chối.');
    } finally {
      setApproving(false);
    }
  };

  // Delete plan
  const handleDeletePlan = async () => {
    if (!plan?.id) return;
    const confirmed = await appDialog.confirm('Bạn có chắc chắn muốn xoá toàn bộ kế hoạch này?', {
      tone: 'danger',
      confirmText: 'Xoá',
    });
    if (!confirmed) return;
    try {
      await publishingService.deletePlan(idToken, plan.id);
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Không thể xoá kế hoạch.');
    }
  };

  const activeVariant = variants.find(v => v.channel_id === activeVariantChannelId);
  const activeChannel = channels.find(c => c.id === activeVariantChannelId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-slate-900/60 backdrop-blur-xs">
      <div className="w-full max-w-4xl bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-[#0B72CE]">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {plan ? 'Chỉnh sửa kế hoạch đăng bài' : 'Tạo kế hoạch đăng bài mới'}
              </h2>
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {plan && (
                  <span
                    className={`px-2 py-0.5 rounded-md font-semibold text-[11px] ${
                      PLAN_STATUS_MAP[plan.status]?.color || 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {PLAN_STATUS_MAP[plan.status]?.label || plan.status}
                  </span>
                )}
                <span>Múi giờ ICT (Việt Nam UTC+7)</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {plan && (
              <button
                type="button"
                onClick={handleRefreshPlan}
                className="p-2 rounded-xl text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
                title="Làm mới"
              >
                <RotateCw className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">
          {/* Section 1: Thông tin chung */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 flex flex-col gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Tiêu đề kế hoạch <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: Công bố thể lệ cuộc thi FIMO 2026..."
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                />
              </div>

              {/* Chọn từ tin bài có sẵn (nếu có) */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-[#0B72CE]" />
                  Liên kết bài viết nội bộ (NewsPost)
                </label>
                <select
                  value={newsPostId || ''}
                  onChange={handleSelectNewsPost}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-[#0B72CE]"
                >
                  <option value="">-- Tự nhập nội dung độc lập --</option>
                  {newsPosts.map(p => (
                    <option key={p.id} value={p.id}>
                      #{p.id} - {p.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Thời gian đăng */}
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#0B72CE]" />
                  Thời gian xuất bản (ICT)
                </label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={e => setScheduledAt(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-[#0B72CE]"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Đăng ngay hoặc hẹn giờ phát hành tự động qua timer hệ thống.
                </p>
              </div>
            </div>
          </div>

          {/* Section 2: Kênh xuất bản & AI Generation */}
          <div className="flex flex-col gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Radio className="w-4 h-4 text-[#0B72CE]" />
                Chọn kênh phát hành ({selectedChannelIds.length}/{channels.length}):
              </label>

              {/* Nút AI soạn bài */}
              <button
                type="button"
                onClick={handleGenerateAiVariants}
                disabled={generatingAi}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-xs font-bold shadow-xs transition cursor-pointer disabled:opacity-50"
              >
                {generatingAi ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>{generatingAi ? 'AI đang soạn bài...' : 'AI soạn bài theo kênh'}</span>
              </button>
            </div>

            {/* Channel Checkboxes */}
            <div className="flex flex-wrap gap-2 pt-1">
              {channels.map(c => {
                const isSelected = selectedChannelIds.includes(c.id);
                const kind = CHANNEL_KIND_MAP[c.kind];
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleToggleChannel(c.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition flex items-center gap-1.5 cursor-pointer ${
                      isSelected
                        ? 'bg-[#0B72CE] text-white border-[#0B72CE] shadow-xs'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <span>{c.name}</span>
                    <span
                      className={`text-[10px] px-1 py-0.2 rounded font-normal ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
                      }`}
                    >
                      {kind?.label || c.kind}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* AI Progress status */}
            {aiJobStatus && (
              <div className="flex items-center gap-2 text-xs font-medium text-purple-700 dark:text-purple-300 mt-1">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Trạng thái AI: {aiJobStatus}</span>
              </div>
            )}
          </div>

          {/* Section 3: Nội dung gốc */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Nội dung gốc (Dùng làm tư liệu để AI biến thể hoặc xuất sang các kênh)
            </label>
            <textarea
              rows={4}
              placeholder="Nhập thông tin sự kiện, nội dung thông báo, thời hạn nộp bài..."
              value={baseContent}
              onChange={e => setBaseContent(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
            />
          </div>

          {/* Section 4: Biến thể từng kênh (Tabs) */}
          {selectedChannelIds.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-slate-100 dark:border-slate-700 pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Share2 className="w-4 h-4 text-[#0B72CE]" />
                  Biến thể bài đăng theo từng kênh:
                </h3>
              </div>

              {/* Variant Channel Sub-tabs */}
              <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 overflow-x-auto pb-1">
                {selectedChannelIds.map(channelId => {
                  const ch = channels.find(c => c.id === channelId);
                  const v = variants.find(item => item.channel_id === channelId);
                  const isCurrent = activeVariantChannelId === channelId;
                  const vStatus = v ? VARIANT_STATUS_MAP[v.status] : null;

                  return (
                    <button
                      key={channelId}
                      type="button"
                      onClick={() => setActiveVariantChannelId(channelId)}
                      className={`px-3.5 py-2 text-xs font-bold rounded-t-xl border-b-2 transition whitespace-nowrap flex items-center gap-2 cursor-pointer ${
                        isCurrent
                          ? 'border-[#0B72CE] text-[#0B72CE] bg-blue-50/50 dark:bg-blue-950/30'
                          : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      <span>{ch?.name || `Kênh #${channelId}`}</span>
                      {vStatus && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${vStatus.color}`}
                        >
                          {vStatus.label}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Active Variant Editor */}
              {activeChannel && (
                <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex flex-col gap-3 shadow-xs">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      Soạn bài cho: {activeChannel.name} ({CHANNEL_KIND_MAP[activeChannel.kind]?.label})
                    </span>
                    {activeVariant && (
                      <span className="text-[11px] font-mono">
                        Độ dài: {activeVariant.content?.length || 0} ký tự
                      </span>
                    )}
                  </div>

                  {/* Variant Title */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                      Tiêu đề bài đăng trên kênh này
                    </label>
                    <input
                      type="text"
                      placeholder="Tiêu đề biến thể..."
                      value={activeVariant?.title || ''}
                      onChange={e =>
                        handleVariantChange(activeChannel.id, 'title', e.target.value)
                      }
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                    />
                  </div>

                  {/* Variant Content */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                      Nội dung bài đăng (kèm hashtag, emoji phù hợp kênh)
                    </label>
                    <textarea
                      rows={6}
                      placeholder="Nội dung sẽ xuất bản trên kênh này..."
                      value={activeVariant?.content || ''}
                      onChange={e =>
                        handleVariantChange(activeChannel.id, 'content', e.target.value)
                      }
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                    />
                  </div>

                  {/* Variant Link URL */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                      Đường dẫn đính kèm (Link URL)
                    </label>
                    <input
                      type="url"
                      placeholder="https://..."
                      value={activeVariant?.link_url || ''}
                      onChange={e =>
                        handleVariantChange(activeChannel.id, 'link_url', e.target.value)
                      }
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
                    />
                  </div>

                  {/* Save variant button if variant exists in DB */}
                  {activeVariant && activeVariant.id && (
                    <div className="flex justify-end pt-2">
                      <button
                        type="button"
                        onClick={() => handleSaveVariant(activeVariant)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold transition cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Lưu riêng biến thể này</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Safety Notice */}
          <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <div>
              <p className="font-bold">Quy tắc an toàn phê duyệt:</p>
              <p className="text-[11px] mt-0.5 text-amber-700 dark:text-amber-400">
                Mọi bài viết chỉ được xuất bản sau khi Quản lý/Admin bấm Duyệt. Nếu sửa đổi tiêu đề hoặc nội dung sau khi đã duyệt, hệ thống sẽ tự động đặt lại trạng thái về "Chờ duyệt" để kiểm soát an toàn tuyệt đối.
              </p>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30">
          <div>
            {plan && (
              <button
                type="button"
                onClick={handleDeletePlan}
                className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Xoá kế hoạch</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer"
            >
              Đóng
            </button>

            {/* Lưu bản nháp */}
            <button
              type="button"
              onClick={() => handleSavePlan(false)}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 cursor-pointer disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Lưu bản nháp</span>
            </button>

            {/* Gửi phê duyệt (Nhân viên) */}
            {!isManagerOrAdmin && (
              <button
                type="button"
                onClick={() => handleSavePlan(true)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-[#0B72CE] hover:bg-[#075CA8] text-white shadow-xs cursor-pointer disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Gửi phê duyệt</span>
              </button>
            )}

            {/* Quản lý / Admin duyệt & lên lịch */}
            {isManagerOrAdmin && plan && plan.status === 'pending_approval' && (
              <>
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={approving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-700 text-white shadow-xs cursor-pointer disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Từ chối</span>
                </button>

                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={approving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {approving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  )}
                  <span>Duyệt & Lên lịch</span>
                </button>
              </>
            )}

            {/* Quản lý / Admin duyệt nhanh khi tạo mới hoặc nháp */}
            {isManagerOrAdmin && (!plan || plan.status === 'draft') && (
              <button
                type="button"
                onClick={async () => {
                  const saved = await handleSavePlan(false);
                  if (saved) {
                    await publishingService.approvePlan(idToken, saved.id, 'approve');
                    setSuccessMsg('Đã tạo và phê duyệt kế hoạch thành công!');
                    onSaved();
                    setTimeout(onClose, 800);
                  }
                }}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer disabled:opacity-50"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Duyệt & Đặt lịch ngay</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
