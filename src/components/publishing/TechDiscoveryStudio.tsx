import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Sparkles,
  RotateCw,
  ExternalLink,
  BookOpen,
  CheckCircle2,
  Filter,
  ArrowRight,
  TrendingUp,
  Cpu,
  Layers,
  GraduationCap,
  FileText,
  Calendar,
  Users,
  AlertCircle,
  Clock,
} from 'lucide-react';
import type { TechTopicSuggestion, PostPlan } from './publishingTypes';
import { publishingService } from './publishingService';
import { appDialog } from '../AppDialog';

interface TechDiscoveryStudioProps {
  idToken: string;
  onPlanCreated: (plan: PostPlan) => void;
  onOpenPlanById: (planId: number) => void;
}

export function TechDiscoveryStudio({
  idToken,
  onPlanCreated,
  onOpenPlanById,
}: TechDiscoveryStudioProps) {
  const [topics, setTopics] = useState<TechTopicSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [crawling, setCrawling] = useState(false);
  const [convertingId, setConvertingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Filters
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unconverted' | 'converted'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const loadTopics = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setError('');
    try {
      const data = await publishingService.getTechDiscoveryTopics(idToken, {
        limit: 50,
      });
      setTopics(data);
    } catch (err: any) {
      setError(err?.message || 'Không thể tải danh sách chủ đề công nghệ.');
    } finally {
      setLoading(false);
    }
  }, [idToken]);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  const handleTriggerDiscovery = async () => {
    setCrawling(true);
    setError('');
    try {
      const res = await publishingService.triggerTechDiscovery(idToken, { limit_per_source: 3 });
      setToast(res.message || 'Đã quét và phân tích thành công các chủ đề mới!');
      await loadTopics(true);
    } catch (err: any) {
      setError(err?.message || 'Lỗi khi kích hoạt thu thập chủ đề.');
    } finally {
      setCrawling(false);
    }
  };

  const handleCreatePlanFromTopic = async (topic: TechTopicSuggestion) => {
    const confirmed = await appDialog.confirm(
      `Bạn muốn tạo kế hoạch bài viết từ chủ đề:\n"${topic.title}"?\n\nHệ thống sẽ tự động tổng hợp nguồn tham khảo, các điểm đột phá và sinh bản nháp cho các kênh quản trị.`,
      {
        title: 'Tạo kế hoạch bài viết',
        confirmText: 'Tạo kế hoạch ngay',
        cancelText: 'Hủy',
      }
    );
    if (!confirmed) return;

    setConvertingId(topic.id);
    try {
      const plan = await publishingService.convertTechTopicToPlan(idToken, topic.id, {
        auto_generate_variants: true,
      });
      setToast(`Đã tạo thành công kế hoạch bài viết #${plan.id}!`);
      // Update local state
      setTopics(prev =>
        prev.map(t => (t.id === topic.id ? { ...t, isConvertedToPlan: true, createdPlanId: plan.id } : t))
      );
      onPlanCreated(plan);
    } catch (err: any) {
      appDialog.alert(err?.message || 'Không thể tạo kế hoạch bài viết từ chủ đề này.', {
        title: 'Lỗi tạo kế hoạch',
      });
    } finally {
      setConvertingId(null);
    }
  };

  const filteredTopics = useMemo(() => {
    return topics.filter(t => {
      if (sourceFilter !== 'all' && t.source !== sourceFilter) return false;
      if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
      if (statusFilter === 'unconverted' && t.isConvertedToPlan) return false;
      if (statusFilter === 'converted' && !t.isConvertedToPlan) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const text = `${t.title} ${t.rawSummary} ${t.suggestedAngle} ${t.author}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [topics, sourceFilter, categoryFilter, statusFilter, searchQuery]);

  const getSourceBadge = (source: string, display: string) => {
    switch (source) {
      case 'arxiv':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-bold bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
            <BookOpen className="w-3 h-3" />
            arXiv AI/ML
          </span>
        );
      case 'hackernews':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-bold bg-orange-50 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
            <TrendingUp className="w-3 h-3" />
            Hacker News
          </span>
        );
      case 'huggingface':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <Cpu className="w-3 h-3" />
            Hugging Face
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            <Layers className="w-3 h-3" />
            {display || 'Tech News'}
          </span>
        );
    }
  };

  const getCategoryBadge = (category: string, display: string) => {
    switch (category) {
      case 'agentic':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
            <Cpu className="w-3 h-3" />
            Agent & Tự động hóa
          </span>
        );
      case 'edtech':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-semibold bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300">
            <GraduationCap className="w-3 h-3" />
            Khảo thí & EdTech
          </span>
        );
      case 'ai_ml':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
            <Sparkles className="w-3 h-3" />
            AI & Machine Learning
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <Layers className="w-3 h-3" />
            {display || 'Xu hướng'}
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Toast */}
      {toast && (
        <div className="flex items-center justify-between p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800 text-xs font-medium">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{toast}</span>
          </div>
          <button
            type="button"
            onClick={() => setToast('')}
            className="text-emerald-600 hover:text-emerald-900 dark:text-emerald-400 font-bold ml-4"
          >
            Đóng
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800 text-xs font-medium">
          <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-linear-to-br from-indigo-900 via-slate-900 to-[#075CA8] p-6 text-white shadow-lg">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="max-w-2xl space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-2xs font-bold bg-white/10 backdrop-blur-md text-indigo-200 border border-white/10">
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>Gợi ý chủ đề AI & Xu hướng công nghệ hàng ngày</span>
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-2xs font-bold bg-emerald-500/20 backdrop-blur-md text-emerald-200 border border-emerald-400/30">
                <Clock className="w-3.5 h-3.5 text-emerald-300" />
                <span>Tự động quét: 06:30 sáng hàng ngày</span>
              </div>
            </div>
            <h2 className="text-xl md:text-2xl font-black tracking-tight text-white">
              Crawl & Phân tích Đột phá Công nghệ Mới
            </h2>
            <p className="text-xs md:text-sm text-slate-200 leading-relaxed">
              Tự động quét các bài báo khoa học và thảo luận công nghệ hàng đầu (arXiv, Hugging Face Papers, Hacker News).
              AI phân tích sâu các bước tiến then chốt và đề xuất kế hoạch xuất bản đa kênh phù hợp với đối tượng độc giả.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              disabled={crawling}
              onClick={handleTriggerDiscovery}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-white hover:bg-slate-100 text-[#075CA8] text-xs font-bold shadow-md transition cursor-pointer disabled:opacity-50"
            >
              <RotateCw className={`w-4 h-4 ${crawling ? 'animate-spin text-[#075CA8]' : ''}`} />
              <span>{crawling ? 'Đang quét & phân tích...' : 'Khám phá chủ đề mới ngay'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <input
            type="text"
            placeholder="Tìm theo tiêu đề, tác giả, nội dung..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#0B72CE] w-64"
          />

          {/* Source filter */}
          <select
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none"
          >
            <option value="all">Mọi nguồn tin</option>
            <option value="arxiv">arXiv AI/ML</option>
            <option value="hackernews">Hacker News</option>
            <option value="huggingface">Hugging Face</option>
          </select>

          {/* Category filter */}
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none"
          >
            <option value="all">Mọi chuyên mục</option>
            <option value="ai_ml">AI & Mô hình ngôn ngữ</option>
            <option value="agentic">Agent & Tự động hóa</option>
            <option value="edtech">Khảo thí & EdTech</option>
            <option value="general_tech">Xu hướng chung</option>
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            className="px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none"
          >
            <option value="all">Mọi trạng thái ({topics.length})</option>
            <option value="unconverted">Chưa tạo kế hoạch</option>
            <option value="converted">Đã tạo kế hoạch</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => loadTopics(true)}
          className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition"
          title="Tải lại danh sách"
        >
          <RotateCw className="w-4 h-4" />
        </button>
      </div>

      {/* Topics List */}
      {loading ? (
        <div className="grid h-64 place-items-center text-xs font-semibold text-slate-500">
          Đang tải danh sách chủ đề công nghệ...
        </div>
      ) : filteredTopics.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 p-8 space-y-3">
          <Sparkles className="w-10 h-10 mx-auto text-slate-400 dark:text-slate-500" />
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
            Chưa có chủ đề nào phù hợp
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Nhấn nút &quot;Khám phá chủ đề mới ngay&quot; để hệ thống tự động quét và phân tích các bài nghiên cứu mới nhất từ arXiv, Hugging Face và Hacker News.
          </p>
          <button
            type="button"
            disabled={crawling}
            onClick={handleTriggerDiscovery}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0B72CE] hover:bg-[#075CA8] text-white text-xs font-bold shadow-xs transition cursor-pointer"
          >
            <RotateCw className={`w-3.5 h-3.5 ${crawling ? 'animate-spin' : ''}`} />
            <span>Khám phá chủ đề mới ngay</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          {filteredTopics.map(topic => {
            const isConverting = convertingId === topic.id;
            return (
              <div
                key={topic.id}
                className="flex flex-col bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 p-5 shadow-xs hover:border-slate-300 dark:hover:border-slate-600 transition space-y-4"
              >
                {/* Top badges & actions */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {getSourceBadge(topic.source, topic.sourceDisplay)}
                    {getCategoryBadge(topic.category, topic.categoryDisplay)}
                    {topic.isConvertedToPlan ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        <CheckCircle2 className="w-3 h-3" />
                        Đã tạo kế hoạch đăng bài
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-bold bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                        Chờ biên tập
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-2xs text-slate-400">
                    {topic.author && <span>Tác giả: {topic.author}</span>}
                    {topic.publishedDate && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(topic.publishedDate).toLocaleDateString('vi-VN')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Title */}
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white leading-snug">
                    <a
                      href={topic.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-[#0B72CE] inline-flex items-baseline gap-1.5 transition"
                    >
                      <span>{topic.title}</span>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0 self-center" />
                    </a>
                  </h3>
                </div>

                {/* Raw Summary */}
                {topic.rawSummary && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-3 leading-relaxed">
                    {topic.rawSummary}
                  </p>
                )}

                {/* AI Deep Analysis: Key Takeaways */}
                {topic.keyTakeaways && topic.keyTakeaways.length > 0 && (
                  <div className="bg-slate-50 dark:bg-slate-900/60 rounded-2xl p-4 border border-slate-100 dark:border-slate-700/60 space-y-2">
                    <div className="flex items-center gap-1.5 text-2xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Các bước tiến & Điểm đột phá then chốt</span>
                    </div>
                    <ul className="space-y-1.5">
                      {topic.keyTakeaways.map((takeaway, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                          <span>{takeaway}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Suggested Angle & Target Audience */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {topic.suggestedAngle && (
                    <div className="p-3 rounded-2xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 text-blue-950 dark:text-blue-100 space-y-1">
                      <span className="font-bold text-2xs uppercase tracking-wider text-blue-700 dark:text-blue-300">
                        Định hướng phân tích đề xuất:
                      </span>
                      <p className="leading-relaxed">{topic.suggestedAngle}</p>
                    </div>
                  )}

                  {topic.targetAudience && (
                    <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-700/40 text-slate-800 dark:text-slate-200 space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-2xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
                        <Users className="w-3 h-3 text-slate-500" />
                        <span>Đối tượng độc giả mục tiêu:</span>
                      </div>
                      <p className="leading-relaxed">{topic.targetAudience}</p>
                    </div>
                  )}
                </div>

                {/* Footer action */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60 flex flex-wrap items-center justify-between gap-3">
                  <a
                    href={topic.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Xem bài báo / nguồn gốc</span>
                  </a>

                  {topic.isConvertedToPlan && topic.createdPlanId ? (
                    <button
                      type="button"
                      onClick={() => onOpenPlanById(topic.createdPlanId!)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 text-xs font-bold transition cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5 text-[#0B72CE]" />
                      <span>Xem kế hoạch #{topic.createdPlanId}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isConverting}
                      onClick={() => handleCreatePlanFromTopic(topic)}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#0B72CE] hover:bg-[#075CA8] text-white text-xs font-bold shadow-xs transition cursor-pointer disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{isConverting ? 'Đang tạo kế hoạch...' : 'Tạo kế hoạch bài viết ngay'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
