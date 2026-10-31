import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Calendar,
  List,
  Radio,
  Plus,
  Share2,
  Copy,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Clock,
  Filter,
  RotateCw,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  Megaphone,
} from 'lucide-react';
import type { PostPlan, PublishChannel, PostVariant, PlanStatus } from './publishingTypes';
import { PLAN_STATUS_MAP, VARIANT_STATUS_MAP, CHANNEL_KIND_MAP } from './publishingTypes';
import { publishingService } from './publishingService';
import { WeeklyCalendarView } from './WeeklyCalendarView';
import { ChannelManager } from './ChannelManager';
import { PlanEditorModal } from './PlanEditorModal';
import { appDialog } from '../AppDialog';

interface PublishingCenterProps {
  idToken: string;
  userName?: string;
  userEmail?: string;
  userRole?: string;
  initialNewsPost?: { id: number; title: string; content: string } | null;
  onClearInitialNewsPost?: () => void;
}

export default function PublishingCenter({
  idToken,
  userName,
  userEmail,
  userRole,
  initialNewsPost,
  onClearInitialNewsPost,
}: PublishingCenterProps) {
  // Navigation sub-tabs inside PublishingCenter
  const [activeSubTab, setActiveSubTab] = useState<'calendar' | 'list' | 'channels'>('calendar');

  // Data state
  const [plans, setPlans] = useState<PostPlan[]>([]);
  const [channels, setChannels] = useState<PublishChannel[]>([]);
  const [newsPosts, setNewsPosts] = useState<Array<{ id: number; title: string; post_type: string; excerpt?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [toastNotice, setToastNotice] = useState('');

  // Weekly calendar state
  const [calendarDate, setCalendarDate] = useState<Date>(new Date());

  // Filters for list view
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchFilter, setSearchFilter] = useState<string>('');

  // Modal editor state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PostPlan | null>(null);
  const [initialDateForEditor, setInitialDateForEditor] = useState<string | undefined>(undefined);

  // Manual tasks
  const [markingManualId, setMarkingManualId] = useState<number | null>(null);

  // Load all initial data
  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    setError('');

    try {
      const [fetchedChannels, fetchedPlans, fetchedNewsPosts] = await Promise.all([
        publishingService.getChannels(idToken).catch(() => []),
        publishingService.getPlans(idToken).catch(() => []),
        publishingService.getNewsPosts(idToken).catch(() => []),
      ]);

      setChannels(fetchedChannels);
      setPlans(fetchedPlans);
      setNewsPosts(fetchedNewsPosts);
    } catch (err: any) {
      setError(err?.message || 'Không thể tải dữ liệu xuất bản.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [idToken]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Open modal automatically if initialNewsPost is passed
  useEffect(() => {
    if (initialNewsPost) {
      setEditingPlan(null);
      setInitialDateForEditor(undefined);
      setIsEditorOpen(true);
    }
  }, [initialNewsPost]);

  // Toast notice helper
  const showToast = (msg: string) => {
    setToastNotice(msg);
    setTimeout(() => setToastNotice(''), 3000);
  };

  // Find all variants needing manual action
  const manualAwaitingVariants = useMemo(() => {
    const list: { plan: PostPlan; variant: PostVariant }[] = [];
    for (const p of plans) {
      for (const v of p.variants) {
        if (v.status === 'awaiting_manual') {
          list.push({ plan: p, variant: v });
        }
      }
    }
    return list;
  }, [plans]);

  // Copy variant content to clipboard
  const handleCopyVariant = async (v: PostVariant) => {
    let fullText = v.content;
    if (v.title && !v.content.includes(v.title)) {
      fullText = `${v.title}\n\n${v.content}`;
    }
    if (v.link_url && !v.content.includes(v.link_url)) {
      fullText = `${fullText}\n\n${v.link_url}`;
    }
    try {
      await navigator.clipboard.writeText(fullText);
      showToast('Đã sao chép nội dung bài đăng vào clipboard!');
    } catch {
      showToast('Không thể sao chép tự động. Hãy chọn văn bản và copy bằng tay.');
    }
  };

  // Mark manual post completed
  const handleMarkManualDone = async (variantId: number) => {
    setMarkingManualId(variantId);
    try {
      await publishingService.markVariantManualDone(idToken, variantId);
      showToast('Đã ghi nhận đăng bài thủ công thành công!');
      loadData(true);
    } catch (err: any) {
      await appDialog.alert(err?.message || 'Không thể cập nhật trạng thái.', { tone: 'danger' });
    } finally {
      setMarkingManualId(null);
    }
  };

  // Filtered plans for list view
  const filteredPlans = useMemo(() => {
    return plans.filter(p => {
      const matchStatus = statusFilter === 'all' || p.status === statusFilter;
      const matchSearch =
        !searchFilter.trim() ||
        p.title.toLowerCase().includes(searchFilter.toLowerCase()) ||
        p.variants.some(v => v.channel_name.toLowerCase().includes(searchFilter.toLowerCase()));
      return matchStatus && matchSearch;
    });
  }, [plans, statusFilter, searchFilter]);

  // Open modal to create new plan
  const handleOpenCreatePlan = (dateStr?: string) => {
    setEditingPlan(null);
    setInitialDateForEditor(dateStr);
    setIsEditorOpen(true);
  };

  // Open modal to edit existing plan
  const handleOpenEditPlan = (plan: PostPlan) => {
    setEditingPlan(plan);
    setInitialDateForEditor(undefined);
    setIsEditorOpen(true);
  };

  const handleCloseModal = () => {
    setIsEditorOpen(false);
    setEditingPlan(null);
    setInitialDateForEditor(undefined);
    if (onClearInitialNewsPost) {
      onClearInitialNewsPost();
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto pb-12">
      {/* Toast Notification */}
      {toastNotice && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-xl text-xs font-semibold animate-fade-in border border-slate-700">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastNotice}</span>
        </div>
      )}

      {/* Top Banner & Sub-Nav */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-5 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-[#0B72CE]">
              <Megaphone className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Lịch & Đăng bài truyền thông
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Soạn thảo, biến thể AI đa kênh, phê duyệt an toàn và phát hành tự động qua Facebook API, Webhook, WordPress hoặc nhắc đăng nhóm.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Sub-nav Buttons */}
          <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-700/60 rounded-2xl">
            <button
              type="button"
              onClick={() => setActiveSubTab('calendar')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeSubTab === 'calendar'
                  ? 'bg-white dark:bg-slate-800 text-[#0B72CE] shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Lịch tuần</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeSubTab === 'list'
                  ? 'bg-white dark:bg-slate-800 text-[#0B72CE] shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>Danh sách bài</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('channels')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeSubTab === 'channels'
                  ? 'bg-white dark:bg-slate-800 text-[#0B72CE] shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Kênh xuất bản ({channels.length})</span>
            </button>
          </div>

          {/* Refresh button */}
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition cursor-pointer"
            title="Làm mới"
          >
            <RotateCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-[#0B72CE]' : ''}`} />
          </button>

          {/* Create Button */}
          <button
            type="button"
            onClick={() => handleOpenCreatePlan()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-[#0B72CE] hover:bg-[#075CA8] text-white text-xs font-bold shadow-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Tạo kế hoạch đăng
          </button>
        </div>
      </div>

      {/* Manual Action Tasks Banner */}
      {manualAwaitingVariants.length > 0 && (
        <div className="flex flex-col gap-3 p-5 rounded-3xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 shadow-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200 flex items-center gap-2">
              <Share2 className="w-4 h-4 text-amber-600 animate-pulse" />
              Việc cần đăng thủ công ({manualAwaitingVariants.length} bài)
            </h3>
            <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              Đến giờ phát hành trên nhóm cộng đồng
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1">
            {manualAwaitingVariants.map(({ plan, variant }) => {
              const kind = CHANNEL_KIND_MAP[variant.channel_kind];
              const isMarking = markingManualId === variant.id;

              return (
                <div
                  key={variant.id}
                  className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-900 flex flex-col justify-between gap-3 shadow-xs"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${kind?.color}`}>
                        {variant.channel_name}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 font-mono">
                        <Clock className="w-3 h-3 text-amber-600" />
                        {variant.scheduled_at ? new Date(variant.scheduled_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                      </span>
                    </div>

                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 line-clamp-1">
                      {variant.title || plan.title}
                    </h4>

                    <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 line-clamp-3 bg-slate-50 dark:bg-slate-900/60 p-2 rounded-xl font-mono">
                      {variant.content}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-700/60">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleCopyVariant(variant)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 transition cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5 text-slate-500" />
                        <span>Sao chép</span>
                      </button>

                      {variant.manual_action_url && (
                        <a
                          href={variant.manual_action_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/50 text-[#0B72CE] transition"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Mở nhóm</span>
                        </a>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={isMarking}
                      onClick={() => handleMarkManualDone(variant.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{isMarking ? 'Đang cập nhật...' : 'Đã đăng thủ công'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="grid h-64 place-items-center text-xs font-semibold text-slate-500">
          Đang tải thông tin xuất bản...
        </div>
      ) : activeSubTab === 'calendar' ? (
        <WeeklyCalendarView
          plans={plans}
          currentDate={calendarDate}
          onDateChange={setCalendarDate}
          onSelectPlan={handleOpenEditPlan}
          onNewPlanForDate={handleOpenCreatePlan}
        />
      ) : activeSubTab === 'channels' ? (
        <ChannelManager
          idToken={idToken}
          channels={channels}
          onRefresh={() => loadData(true)}
          userRole={userRole}
        />
      ) : (
        /* List View */
        <div className="flex flex-col gap-4 bg-white dark:bg-slate-800 p-5 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-xs">
          {/* List Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Tìm kế hoạch, tiêu đề..."
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
                className="px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE] w-64"
              />

              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE]"
              >
                <option value="all">Tất cả trạng thái</option>
                <option value="draft">Bản nháp</option>
                <option value="pending_approval">Chờ duyệt</option>
                <option value="approved">Đã duyệt</option>
                <option value="scheduled">Đã lên lịch</option>
                <option value="published">Đã đăng xong</option>
                <option value="failed">Thất bại</option>
              </select>
            </div>

            <div className="text-xs text-slate-500 font-medium">
              Tổng cộng: <b>{filteredPlans.length}</b> kế hoạch
            </div>
          </div>

          {/* List Table */}
          {filteredPlans.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              Không có bài đăng nào khớp bộ lọc.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-3 font-semibold">Tiêu đề kế hoạch</th>
                    <th className="py-3 px-3 font-semibold">Kênh phát hành</th>
                    <th className="py-3 px-3 font-semibold">Thời gian lên lịch</th>
                    <th className="py-3 px-3 font-semibold">Người tạo</th>
                    <th className="py-3 px-3 font-semibold">Trạng thái</th>
                    <th className="py-3 px-3 font-semibold text-right">Chi tiết</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredPlans.map(plan => {
                    const statusInfo = PLAN_STATUS_MAP[plan.status as PlanStatus] || {
                      label: plan.status,
                      color: 'bg-slate-100 text-slate-700',
                    };
                    const schedTime = plan.scheduled_at
                      ? new Date(plan.scheduled_at).toLocaleString('vi-VN', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'Chưa đặt';

                    return (
                      <tr
                        key={plan.id}
                        onClick={() => handleOpenEditPlan(plan)}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-750 transition cursor-pointer"
                      >
                        <td className="py-3 px-3 font-bold text-slate-900 dark:text-slate-100 max-w-xs truncate">
                          {plan.title || '(Chưa có tiêu đề)'}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1 flex-wrap">
                            {plan.variants.map(v => (
                              <span
                                key={v.id}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium"
                              >
                                {v.channel_name}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-600 dark:text-slate-400">
                          {schedTime}
                        </td>
                        <td className="py-3 px-3 text-slate-600 dark:text-slate-400 truncate max-w-[120px]">
                          {plan.created_by_email}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-md font-semibold text-[10px] ${statusInfo.color}`}
                          >
                            {statusInfo.label}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <ChevronRight className="w-4 h-4 text-slate-400 inline" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Plan Editor Modal */}
      {isEditorOpen && (
        <PlanEditorModal
          idToken={idToken}
          plan={editingPlan}
          channels={channels}
          newsPosts={newsPosts}
          initialDate={initialDateForEditor}
          initialNewsPost={initialNewsPost}
          userRole={userRole}
          userEmail={userEmail}
          onClose={handleCloseModal}
          onSaved={() => loadData(true)}
        />
      )}
    </div>
  );
}
