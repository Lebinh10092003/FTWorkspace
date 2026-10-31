import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  Calendar,
  Check,
  Clock,
  Copy,
  Edit3,
  ExternalLink,
  Eye,
  FileCheck2,
  FileDown,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Loader2,
  MapPin,
  Newspaper,
  Plus,
  RefreshCw,
  Save,
  Share2,
  Sparkles,
  Trash2,
  TriangleAlert,
  UploadCloud,
  Users,
  X,
  Building2,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';

import ModuleShellHeader from '../layout/ModuleShellHeader';
import { appDialog } from '../AppDialog';
import { splitContactInfo, normalizeHashtags } from './newsPostUtils';
import { COMMUNICATION_TOOLS_NAV } from '../../config/workspaceNavigation';
import {
  NewsPostItem,
  PostType,
  PostStatus,
  SessionItem,
  SurveySummary,
  ContentPayload,
  ArticleSection,
  UploadedDocFile,
} from './newsPostTypes';
import SurveyReportImage from './SurveyReportImage';
import { PlanEditorModal } from '../publishing/PlanEditorModal';
import { publishingService } from '../publishing/publishingService';
import type { PublishChannel } from '../publishing/publishingTypes';

type Props = {
  idToken: string;
  userName: string;
  userEmail?: string;
  userRole?: string;
  photoURL?: string | null;
  onAccountClick: () => void;
  onLogout: () => void;
  onNavSelect: (id: string) => void;
};

export default function NewsPostCenter({
  idToken,
  userName,
  userEmail,
  userRole,
  photoURL,
  onAccountClick,
  onLogout,
  onNavSelect,
}: Props) {
  // Navigation / views
  const [viewState, setViewState] = useState<'list' | 'editor' | 'detail'>('list');
  const [posts, setPosts] = useState<NewsPostItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filterType, setFilterType] = useState<'all' | PostType>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Selected or active post
  const [activePostId, setActivePostId] = useState<number | null>(null);
  const [activePost, setActivePost] = useState<NewsPostItem | null>(null);

  // Editor form state
  const [formPostType, setFormPostType] = useState<PostType>('fb_training');
  const [formTitle, setFormTitle] = useState<string>('');
  const [formUnitName, setFormUnitName] = useState<string>('');
  const [formNotes, setFormNotes] = useState<string>('');
  const [formAgendaFiles, setFormAgendaFiles] = useState<UploadedDocFile[]>([]);
  const [formMaterialFiles, setFormMaterialFiles] = useState<UploadedDocFile[]>([]);
  const [formSessions, setFormSessions] = useState<SessionItem[]>([]);
  const [formSurveySummary, setFormSurveySummary] = useState<SurveySummary | null>(null);
  const [uploadingSurvey, setUploadingSurvey] = useState<boolean>(false);
  const [uploadingAgenda, setUploadingAgenda] = useState<boolean>(false);
  const [uploadingMaterial, setUploadingMaterial] = useState<boolean>(false);
  const [savingForm, setSavingForm] = useState<boolean>(false);

  // AI Generation & Queue polling
  const [generating, setGenerating] = useState<boolean>(false);
  const [aiJobId, setAiJobId] = useState<number | null>(null);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [aiQueuePos, setAiQueuePos] = useState<number | null>(null);

  // Detail / Article Editor state
  const [detailTab, setDetailTab] = useState<'article' | 'survey_image'>('article');
  const [copied, setCopied] = useState<boolean>(false);
  const [savingArticle, setSavingArticle] = useState<boolean>(false);
  const [editedHeadline, setEditedHeadline] = useState<string>('');
  const [editedLeadIn, setEditedLeadIn] = useState<string>('');
  const [editedSections, setEditedSections] = useState<ArticleSection[]>([]);
  const [editedSurveyHeading, setEditedSurveyHeading] = useState<string>('');
  const [editedSurveyText, setEditedSurveyText] = useState<string>('');
  const [editedSurveyFeedback, setEditedSurveyFeedback] = useState<string>('');
  const [editedClosing, setEditedClosing] = useState<string>('');
  const [editedSlogan, setEditedSlogan] = useState<string>('');
  const [editedContactInfo, setEditedContactInfo] = useState<string>('');
  const [editedHashtags, setEditedHashtags] = useState<string>('');
  const [downloadingDocx, setDownloadingDocx] = useState<boolean>(false);

  // Publishing / Schedule Modal
  const [showPublishModal, setShowPublishModal] = useState<boolean>(false);
  const [publishChannels, setPublishChannels] = useState<PublishChannel[]>([]);

  const handleOpenSchedulePublish = async () => {
    if (!activePost) return;
    try {
      const chs = await publishingService.getChannels(idToken);
      setPublishChannels(chs);
    } catch {
      // ignore
    }
    setShowPublishModal(true);
  };

  // Fetch list of posts
  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/news-posts/', {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        const postList = data.posts || data.items || [];
        setPosts(postList);
      } else {
        setPosts([]);
      }
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [idToken]);

  useEffect(() => {
    void fetchPosts();
  }, [fetchPosts]);

  // Synchronize article editor form when opening a post detail
  const loadPostDetail = useCallback((post: NewsPostItem) => {
    setActivePost(post);
    setActivePostId(post.id);
    const cp = post.contentPayload || {};
    setEditedHeadline(cp.headline || '');
    setEditedLeadIn(cp.lead_in || '');
    setEditedSections(cp.sections ? JSON.parse(JSON.stringify(cp.sections)) : []);
    setEditedSurveyHeading(cp.survey_section?.heading || '📊 PHẢN HỒI SAU TẬP HUẤN');
    setEditedSurveyText(cp.survey_section?.text || '');
    setEditedSurveyFeedback(cp.survey_section?.feedback_summary || '');
    setEditedClosing(cp.closing || '');
    setEditedSlogan(cp.slogan || 'FERMATTECH – ĐỒNG HÀNH CHUYỂN ĐỔI SỐ THỰC CHẤT VÀ HIỆU QUẢ!');
    const rawContact = cp.contact_info || '🌐 www.fermat.vn | ✉ contact@fermat.vn | ☎ 0969 627 162';
    setEditedContactInfo(splitContactInfo(rawContact).join('\n'));
    setEditedHashtags(normalizeHashtags(cp.hashtags || []));
  }, []);

  // Open editor for a new post or existing post
  const openEditor = (post?: NewsPostItem) => {
    if (post) {
      setActivePostId(post.id);
      setActivePost(post);
      setFormPostType(post.postType);
      setFormTitle(post.title);
      setFormUnitName(post.inputPayload?.unit_name || post.inputPayload?.unitName || '');
      setFormNotes(post.inputPayload?.notes || '');
      setFormAgendaFiles(post.inputPayload?.agenda_files || post.inputPayload?.agendaFiles || []);
      setFormMaterialFiles(post.inputPayload?.material_files || post.inputPayload?.materialFiles || []);
      setFormSessions(post.inputPayload?.sessions ? JSON.parse(JSON.stringify(post.inputPayload.sessions)) : []);
      setFormSurveySummary(post.surveySummary?.has_survey ? post.surveySummary : null);
    } else {
      setActivePostId(null);
      setActivePost(null);
      setFormPostType('fb_training');
      setFormTitle('');
      setFormUnitName('');
      setFormNotes('');
      setFormAgendaFiles([]);
      setFormMaterialFiles([]);
      setFormSessions([]);
      setFormSurveySummary(null);
    }
    setViewState('editor');
  };

  // Upload document files (.docx, .txt, .md)
  const handleDocumentUpload = async (
    filesToUpload: File[],
    fileType: 'agenda' | 'material'
  ) => {
    if (filesToUpload.length === 0) return;

    const validExtensions = ['.docx', '.txt', '.md'];
    const invalidFiles = filesToUpload.filter(
      f => !validExtensions.some(ext => f.name.toLowerCase().endsWith(ext))
    );

    if (invalidFiles.length > 0) {
      setError(`Chỉ chấp nhận tệp văn bản .docx, .txt, .md. Tệp không hợp lệ: ${invalidFiles.map(f => f.name).join(', ')}`);
      return;
    }

    if (fileType === 'agenda') {
      setUploadingAgenda(true);
    } else {
      setUploadingMaterial(true);
    }
    setError('');

    const formData = new FormData();
    filesToUpload.forEach(f => formData.append('files', f));
    formData.append('file_type', fileType);

    try {
      const res = await fetch('/api/news-posts/parse-document/', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        const parsedList: UploadedDocFile[] = data.files || (data.file ? [data.file] : []);
        if (fileType === 'agenda') {
          setFormAgendaFiles(prev => [...prev, ...parsedList]);
        } else {
          setFormMaterialFiles(prev => [...prev, ...parsedList]);
        }
        setNotice(`Đã nạp ${parsedList.length} tệp tài liệu thành công.`);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Không thể trích xuất nội dung từ tệp tài liệu.');
      }
    } catch {
      setError('Lỗi kết nối khi tải tệp tài liệu.');
    } finally {
      if (fileType === 'agenda') {
        setUploadingAgenda(false);
      } else {
        setUploadingMaterial(false);
      }
    }
  };

  // Upload survey files (.xlsx, .csv)
  const handleSurveyUpload = async (filesToUpload: File[]) => {
    if (filesToUpload.length === 0) return;

    const validExtensions = ['.xlsx', '.xls', '.csv'];
    const invalidFiles = filesToUpload.filter(
      f => !validExtensions.some(ext => f.name.toLowerCase().endsWith(ext))
    );

    if (invalidFiles.length > 0) {
      setError(`Chỉ chấp nhận tệp khảo sát .xlsx, .csv. Tệp không hợp lệ: ${invalidFiles.map(f => f.name).join(', ')}`);
      return;
    }

    setUploadingSurvey(true);
    setError('');

    const formData = new FormData();
    filesToUpload.forEach(f => formData.append('files', f));

    try {
      const res = await fetch('/api/news-posts/parse-survey/', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        const summary = data.summary || data.surveySummary;
        if (summary) {
          setFormSurveySummary(summary);
          setNotice(`Tải khảo sát thành công: ${summary.total_responses} phiếu, mức hài lòng ${summary.overall_satisfaction_percent}%`);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Không thể đọc tệp khảo sát.');
      }
    } catch {
      setError('Lỗi kết nối khi tải tệp khảo sát.');
    } finally {
      setUploadingSurvey(false);
    }
  };

  const removeAgendaFile = (index: number) => {
    setFormAgendaFiles(prev => prev.filter((_, idx) => idx !== index));
  };

  const removeMaterialFile = (index: number) => {
    setFormMaterialFiles(prev => prev.filter((_, idx) => idx !== index));
  };

  // Nút Soạn tin chỉ bật khi có ít nhất 1 tệp tiến trình/nội dung HOẶC ghi chú có chữ
  const canGenerate = Boolean(
    formAgendaFiles.length > 0 ||
    formMaterialFiles.length > 0 ||
    formNotes.trim().length > 0 ||
    formSessions.length > 0
  );

  // Save draft
  const handleSaveDraft = async () => {
    if (!canGenerate && !formTitle.trim()) {
      setError('Vui lòng tải lên tài liệu, nhập ghi chú hoặc nhập tiêu đề trước khi lưu bản nháp.');
      return;
    }

    setSavingForm(true);
    setError('');

    const titleToSend = formTitle.trim() || (formUnitName.trim() ? `Tin bài truyền thông tại ${formUnitName.trim()}` : `Bản tin truyền thông ${new Date().toLocaleDateString('vi-VN')}`);

    const payload = {
      title: titleToSend,
      post_type: formPostType,
      input_payload: {
        unit_name: formUnitName,
        notes: formNotes,
        agenda_files: formAgendaFiles,
        material_files: formMaterialFiles,
        sessions: formSessions,
      },
      survey_summary: formSurveySummary || { has_survey: false },
    };

    try {
      const url = activePostId ? `/api/news-posts/${activePostId}/` : '/api/news-posts/';
      const method = activePostId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        const savedPost = (data.post || data) as NewsPostItem;
        setActivePostId(savedPost.id);
        setActivePost(savedPost);
        setNotice('Đã lưu bản tin thành công.');
        void fetchPosts();
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Lỗi lưu bản tin.');
      }
    } catch {
      setError('Lỗi mạng khi lưu bản tin.');
    } finally {
      setSavingForm(false);
    }
  };

  // Trigger AI generation
  const handleGenerate = async () => {
    if (!canGenerate) {
      setError('Vui lòng tải lên ít nhất một tệp tiến trình/nội dung hoặc nhập ghi chú trước khi soạn tin.');
      return;
    }

    setGenerating(true);
    setError('');
    setNotice('');

    try {
      // 1. Lưu nháp trước nếu chưa có id
      let postId = activePostId;
      const titleToSend = formTitle.trim() || (formUnitName.trim() ? `Tin bài truyền thông tại ${formUnitName.trim()}` : `Bản tin truyền thông ${new Date().toLocaleDateString('vi-VN')}`);

      if (!postId) {
        const saveRes = await fetch('/api/news-posts/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            title: titleToSend,
            post_type: formPostType,
            input_payload: {
              unit_name: formUnitName,
              notes: formNotes,
              agenda_files: formAgendaFiles,
              material_files: formMaterialFiles,
              sessions: formSessions,
            },
            survey_summary: formSurveySummary || { has_survey: false },
          }),
        });

        if (!saveRes.ok) {
          const errData = await saveRes.json().catch(() => ({}));
          throw new Error(errData.error || 'Không thể tạo bản ghi trước khi chạy AI.');
        }

        const savedData = await saveRes.json();
        const createdPost = (savedData.post || savedData) as NewsPostItem;
        postId = createdPost.id;
        setActivePostId(postId);
        setActivePost(createdPost);
      }

      // 2. Gọi API tạo hàng đợi AI
      const genRes = await fetch(`/api/news-posts/${postId}/generate/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (!genRes.ok) {
        const err = await genRes.json().catch(() => ({}));
        throw new Error(err.error || 'Không thể bắt đầu soạn tin bằng AI.');
      }

      const genData = await genRes.json();
      setAiJobId(genData.jobId);
      setAiStatus(genData.status || 'queued');
      setAiQueuePos(genData.position || 1);

      // 3. Bắt đầu polling hỏi trạng thái
      pollJobStatus(postId!);
    } catch (err: any) {
      setError(err.message || 'Lỗi khi bắt đầu soạn tin.');
      setGenerating(false);
    }
  };

  // Polling helper
  const pollJobStatus = (postId: number) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/news-posts/${postId}/status/`, {
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        });

        if (res.ok) {
          const data = await res.json();
          setAiStatus(data.status);
          setAiQueuePos(data.position || null);

          if (data.status === 'completed') {
            clearInterval(interval);
            setGenerating(false);
            setNotice('AI đã soạn thảo xong tin bài!');
            if (data.post) {
              loadPostDetail(data.post);
              setViewState('detail');
            }
            void fetchPosts();
          } else if (data.status === 'failed' || data.status === 'cancelled') {
            clearInterval(interval);
            setGenerating(false);
            setError(data.error || 'Tác vụ soạn tin bị gián đoạn hoặc thất bại.');
          }
        }
      } catch {
        // Tiếp tục thử lần sau
      }
    }, 2000);
  };

  // Cancel AI Job
  const handleCancelAiJob = async () => {
    if (!activePostId) return;
    try {
      await fetch(`/api/news-posts/${activePostId}/generate/`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });
      setGenerating(false);
      setAiStatus('cancelled');
      setNotice('Đã hủy tác vụ AI.');
    } catch {
      setError('Không thể hủy tác vụ AI.');
    }
  };

  // Delete post
  const handleDeletePost = async (id: number) => {
    const confirmed = await appDialog.confirm('Bạn có chắc chắn muốn xóa bản tin này?', {
      title: 'Xác nhận xóa',
      confirmText: 'Xóa bản tin',
      cancelText: 'Hủy',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/news-posts/${id}/`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });
      if (res.ok) {
        setNotice('Đã xóa bản tin thành công.');
        void fetchPosts();
        if (activePostId === id) {
          setViewState('list');
          setActivePostId(null);
          setActivePost(null);
        }
      } else {
        setError('Không thể xóa bản tin.');
      }
    } catch {
      setError('Lỗi kết nối khi xóa bản tin.');
    }
  };

  // Build raw text from editable fields
  const buildCurrentRawText = useCallback(() => {
    const lines: string[] = [];
    if (editedHeadline) lines.push(editedHeadline);
    if (editedLeadIn) lines.push('', editedLeadIn);

    editedSections.forEach(sec => {
      if (sec.heading) lines.push('', sec.heading);
      if (sec.body) lines.push(sec.body);
      if (sec.bullets && sec.bullets.length > 0) {
        sec.bullets.forEach(b => lines.push(`✅ ${b.replace(/^✅\s*/, '')}`));
      }
    });

    if (activePost?.surveySummary?.has_survey && editedSurveyHeading) {
      lines.push('', editedSurveyHeading);
      if (editedSurveyText) lines.push(editedSurveyText);
      if (editedSurveyFeedback) lines.push(editedSurveyFeedback);
    }

    if (editedClosing) lines.push('', editedClosing);

    // Bài báo (press_article) không chứa slogan, liên hệ hay hashtag
    if (activePost?.postType !== 'press_article') {
      if (editedSlogan) lines.push('', editedSlogan);
      if (editedContactInfo) {
        const contactLines = splitContactInfo(editedContactInfo);
        contactLines.forEach(cl => lines.push(cl));
      }
      if (editedHashtags) {
        const tagStr = normalizeHashtags(editedHashtags);
        if (tagStr) lines.push('', tagStr);
      }
    }

    return lines.join('\n');
  }, [
    editedHeadline,
    editedLeadIn,
    editedSections,
    editedSurveyHeading,
    editedSurveyText,
    editedSurveyFeedback,
    editedClosing,
    editedSlogan,
    editedContactInfo,
    editedHashtags,
    activePost,
  ]);

  // Copy raw text to clipboard
  const handleCopyRawText = async () => {
    const textToCopy = buildCurrentRawText();
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      setNotice('Đã sao chép nội dung bài viết vào bộ nhớ tạm.');
    } catch {
      setError('Không thể sao chép vào bộ nhớ tạm.');
    }
  };

  // Save edited article
  const handleSaveArticle = async (): Promise<boolean> => {
    if (!activePostId) return false;
    setSavingArticle(true);
    setError('');

    const isPress = activePost?.postType === 'press_article';
    const newContentPayload: ContentPayload = {
      headline: editedHeadline,
      lead_in: editedLeadIn,
      sections: editedSections,
      survey_section: activePost?.surveySummary?.has_survey
        ? {
            heading: editedSurveyHeading,
            text: editedSurveyText,
            feedback_summary: editedSurveyFeedback,
          }
        : null,
      closing: editedClosing,
      slogan: isPress ? '' : editedSlogan,
      contact_info: isPress ? '' : editedContactInfo,
      hashtags: isPress ? [] : normalizeHashtags(editedHashtags).split(/\s+/).filter(Boolean),
      raw_text: buildCurrentRawText(),
    };

    try {
      const res = await fetch(`/api/news-posts/${activePostId}/`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          content_payload: newContentPayload,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setActivePost(data.post);
        setNotice('Đã lưu bài viết thành công.');
        return true;
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Không thể lưu bài viết.');
        return false;
      }
    } catch {
      setError('Lỗi kết nối khi lưu bài viết.');
      return false;
    } finally {
      setSavingArticle(false);
    }
  };

  // Download article as Word (.docx) file
  const handleDownloadDocx = async () => {
    if (!activePostId) return;
    setDownloadingDocx(true);
    setError('');

    try {
      // 1. Tự động lưu bản chỉnh sửa trên trang trước khi tải
      const saved = await handleSaveArticle();
      if (!saved) {
        throw new Error('Vui lòng kiểm tra và lưu thay đổi trước khi tải file Word.');
      }

      // 2. Tải file Word qua API endpoint
      const res = await fetch(`/api/news-posts/${activePostId}/download-docx/`, {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Không thể tải file Word (.docx).');
      }

      // Đọc tên file từ header Content-Disposition
      let filename = `Tin-bai-${activePostId}.docx`;
      const disposition = res.headers.get('Content-Disposition');
      if (disposition) {
        const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (utf8Match && utf8Match[1]) {
          filename = decodeURIComponent(utf8Match[1]);
        } else {
          const match = disposition.match(/filename="?([^";]+)"?/i);
          if (match && match[1]) {
            filename = match[1];
          }
        }
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setNotice('Đã tải thành công file Word (.docx).');
    } catch (err: any) {
      setError(err?.message || 'Lỗi khi tải file Word (.docx).');
    } finally {
      setDownloadingDocx(false);
    }
  };

  // Filtered posts
  const filteredPosts = useMemo(() => {
    return posts.filter(post => {
      const matchType = filterType === 'all' || post.postType === filterType;
      const matchSearch =
        !searchQuery.trim() ||
        post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (post.inputPayload?.unit_name || '').toLowerCase().includes(searchQuery.toLowerCase());
      return matchType && matchSearch;
    });
  }, [posts, filterType, searchQuery]);

  // Labels helper
  const getPostTypeBadge = (type: PostType) => {
    switch (type) {
      case 'fb_training':
        return { label: 'FB Tập huấn', color: 'bg-blue-100 text-[#0B72CE] dark:bg-blue-950/60 dark:text-[#60A5FA]' };
      case 'fb_meeting':
        return { label: 'FB Họp / Đối tác', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' };
      case 'press_article':
        return { label: 'Bài báo gửi báo', color: 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300' };
      default:
        return { label: 'Tin bài', color: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300' };
    }
  };

  const getStatusBadge = (status: PostStatus) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            Đã hoàn thành
          </span>
        );
      case 'generating':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700 border border-blue-200 animate-pulse dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-300">
            <Loader2 className="h-3 w-3 animate-spin" />
            Đang soạn AI
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-bold text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300">
            <TriangleAlert className="h-3 w-3" />
            Thất bại
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300">
            <Edit3 className="h-3 w-3" />
            Bản nháp
          </span>
        );
    }
  };

  return (
    <div className="ft-module-shell flex min-h-dvh flex-col bg-slate-50 dark:bg-slate-950 font-sans text-[var(--ft-text-main,#0f172a)] transition-colors">
      <ModuleShellHeader
        title="Bộ công cụ FermatTech"
        items={COMMUNICATION_TOOLS_NAV}
        activeId="news-posts"
        onSelect={id => onNavSelect(id)}
        ariaLabel="Điều hướng bộ công cụ FermatTech"
        actions={
          <div className="flex items-center gap-2">
            {viewState !== 'list' ? (
              <button
                type="button"
                onClick={() => setViewState('list')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-xs cursor-pointer min-h-[44px]"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Quay lại danh sách</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openEditor()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#0B72CE] hover:bg-[#075CA8] text-white px-3.5 py-2 text-xs sm:text-sm font-bold shadow-xs transition active:scale-95 cursor-pointer min-h-[44px]"
              >
                <Plus className="h-4 w-4" />
                <span>Tạo tin bài mới</span>
              </button>
            )}
          </div>
        }
      />

      <main className="min-w-0 flex-1">
        <div className="ft-module-content mx-auto p-4 sm:p-6 md:p-8 max-w-7xl">
          {/* Subheader Banner */}
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <Newspaper className="h-5 w-5 text-[#0B72CE]" />
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                  Đăng tin bài truyền thông
                </h1>
              </div>
              <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                Tự động hóa soạn thảo tin bài Facebook và bài báo từ biên bản làm việc, tích hợp xuất ảnh đồ họa báo cáo khảo sát.
              </p>
            </div>
          </div>

          {/* Alerts: Error & Notice */}
          {error && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-900/60 px-4 py-3 text-sm font-semibold text-rose-800 dark:text-rose-200"
            >
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
              <div className="flex-1">{error}</div>
              <button
                type="button"
                onClick={() => setError('')}
                className="text-rose-600 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-200 p-0.5 cursor-pointer min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
                aria-label="Đóng lỗi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {notice && (
            <div
              role="status"
              className="mb-4 flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-900/60 px-4 py-3 text-sm font-semibold text-blue-800 dark:text-blue-200"
            >
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-[#0B72CE]" />
                <span>{notice}</span>
              </div>
              <button
                type="button"
                onClick={() => setNotice('')}
                className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 p-0.5 cursor-pointer min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
                aria-label="Đóng thông báo"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              VIEW 1: DANH SÁCH BẢN TIN (LIST VIEW)
              ══════════════════════════════════════════════════════════ */}
          {viewState === 'list' && (
            <div className="space-y-6">
              {/* Filter bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-200/70 dark:bg-slate-900 border border-slate-300 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setFilterType('all')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer min-h-[36px] ${
                      filterType === 'all'
                        ? 'bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    Tất cả ({posts.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterType('fb_training')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer min-h-[36px] ${
                      filterType === 'fb_training'
                        ? 'bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    FB Tập huấn
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterType('fb_meeting')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer min-h-[36px] ${
                      filterType === 'fb_meeting'
                        ? 'bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    FB Họp / Đối tác
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterType('press_article')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer min-h-[36px] ${
                      filterType === 'press_article'
                        ? 'bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    Bài báo
                  </button>
                </div>

                <div className="relative min-w-[240px]">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Tìm theo tiêu đề, đơn vị..."
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs sm:text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:border-blue-500 focus:outline-none min-h-[44px]"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Cards Grid */}
              {loading ? (
                <div className="grid place-items-center py-16 text-slate-500">
                  <Loader2 className="h-8 w-8 animate-spin text-[#0B72CE]" />
                  <p className="mt-2 text-sm font-semibold">Đang tải danh sách bài viết...</p>
                </div>
              ) : filteredPosts.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-12 text-center">
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-[#0B72CE] dark:text-[#60A5FA]">
                    <Newspaper className="h-7 w-7" />
                  </div>
                  <h3 className="mt-4 text-base font-extrabold text-slate-900 dark:text-white">
                    Chưa có bản tin nào
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                    Tạo bản tin mới để AI hỗ trợ bạn soạn thảo bài viết và xuất đồ họa báo cáo khảo sát chuyên nghiệp.
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => openEditor()}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#0B72CE] px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-xs hover:bg-[#075CA8] cursor-pointer min-h-[44px]"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Tạo tin bài mới</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredPosts.map(post => {
                    const typeBadge = getPostTypeBadge(post.postType);
                    const hasSurvey = post.surveySummary?.has_survey;
                    const sessionsCount = post.inputPayload?.sessions?.length || 0;

                    return (
                      <div
                        key={post.id || `demo-${post.title}`}
                        className="group relative flex flex-col justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs transition hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-3">
                            <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${typeBadge.color}`}>
                              {typeBadge.label}
                            </span>
                            {getStatusBadge(post.status)}
                          </div>

                          <h3 className="text-base font-bold text-slate-900 dark:text-white line-clamp-2 leading-snug">
                            {post.title}
                          </h3>

                          {post.inputPayload?.unit_name && (
                            <div className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
                              <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                              <span className="truncate">{post.inputPayload.unit_name}</span>
                            </div>
                          )}

                          <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {sessionsCount} buổi làm việc
                            </span>

                            {hasSurvey && (
                              <span className="inline-flex items-center gap-1 rounded bg-teal-50 dark:bg-teal-950/60 px-1.5 py-0.5 font-bold text-teal-700 dark:text-teal-300">
                                <FileSpreadsheet className="h-3 w-3" />
                                Có khảo sát ({post.surveySummary.total_responses} phiếu)
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-5 flex items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                          {post.contentPayload?.headline ? (
                            <button
                              type="button"
                              onClick={() => {
                                loadPostDetail(post);
                                setViewState('detail');
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 px-3 py-1.5 text-xs font-bold text-[#0B72CE] dark:text-[#60A5FA] hover:bg-blue-100 dark:hover:bg-blue-900/60 transition cursor-pointer min-h-[44px]"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>Xem bài & đồ họa</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openEditor(post)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 transition cursor-pointer min-h-[44px]"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              <span>Soạn tiếp</span>
                            </button>
                          )}

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditor(post)}
                              title="Sửa thông tin đầu vào"
                              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                              aria-label="Sửa thông tin"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                            {post.id && (
                              <button
                                type="button"
                                onClick={() => handleDeletePost(post.id)}
                                title="Xóa bài viết"
                                className="p-2 text-slate-400 hover:text-rose-600 cursor-pointer min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                aria-label="Xóa bài"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              VIEW 2: TRÌNH SOẠN THẢO ĐẦU VÀO (EDITOR VIEW)
              ══════════════════════════════════════════════════════════ */}
          {viewState === 'editor' && (
            <div className="space-y-6">
              {/* 1. Chọn kiểu bài viết */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                <h2 className="text-sm font-extrabold text-slate-900 dark:text-white mb-1">
                  1. Kiểu bài viết
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  Chọn định dạng bài viết. Loại sự kiện (tập huấn, làm việc, giới thiệu) AI sẽ tự nhận diện từ tài liệu.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setFormPostType('fb_training')}
                    className={`flex flex-col text-left p-4 rounded-xl border-2 transition cursor-pointer min-h-[44px] ${
                      formPostType === 'fb_training'
                        ? 'border-[#0B72CE] bg-blue-50/50 dark:bg-blue-950/30'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <span className="text-xs font-extrabold text-[#0B72CE] dark:text-[#60A5FA]">
                      Facebook Tập huấn
                    </span>
                    <span className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                      Bài đăng mạng xã hội sau tập huấn; tiêu đề in hoa, gạch đầu dòng các nội dung và mục khảo sát.
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormPostType('fb_meeting')}
                    className={`flex flex-col text-left p-4 rounded-xl border-2 transition cursor-pointer min-h-[44px] ${
                      formPostType === 'fb_meeting'
                        ? 'border-[#0B72CE] bg-blue-50/50 dark:bg-blue-950/30'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <span className="text-xs font-extrabold text-[#0B72CE] dark:text-[#60A5FA]">
                      Facebook Họp / Đối tác
                    </span>
                    <span className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                      Bài đăng làm việc với đối tác, nhà trường, cơ quan; bối cảnh, thỏa thuận hợp tác và lộ trình phối hợp.
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormPostType('press_article')}
                    className={`flex flex-col text-left p-4 rounded-xl border-2 transition cursor-pointer min-h-[44px] ${
                      formPostType === 'press_article'
                        ? 'border-[#0B72CE] bg-blue-50/50 dark:bg-blue-950/30'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <span className="text-xs font-extrabold text-[#0B72CE] dark:text-[#60A5FA]">
                      Bài báo gửi báo chí
                    </span>
                    <span className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                      Văn phong báo chí trang trọng, có sapo, trích dẫn phát biểu của lãnh đạo đơn vị và FermatTech.
                    </span>
                  </button>
                </div>
              </div>

              {/* 2. Tiêu đề & Đơn vị (Tùy chọn) */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Tên đơn vị / Cơ quan / Đối tác <span className="font-normal text-slate-500">(Tùy chọn - AI tự nhận diện nếu để trống)</span>
                    </label>
                    <input
                      type="text"
                      value={formUnitName}
                      onChange={e => setFormUnitName(e.target.value)}
                      placeholder="Ví dụ: Trường THCS Ban Mai, UBND Phường... (hoặc để trống)"
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none min-h-[44px]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Tiêu đề bản tin <span className="font-normal text-slate-500">(Tùy chọn - AI tự sinh nếu để trống)</span>
                    </label>
                    <input
                      type="text"
                      value={formTitle}
                      onChange={e => setFormTitle(e.target.value)}
                      placeholder="Để trống AI sẽ tự tạo tiêu đề phù hợp"
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none min-h-[44px]"
                    />
                  </div>
                </div>
              </div>

              {/* 3. Ba khu vực tải tệp */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                <div>
                  <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                    2. Tải tệp tài liệu
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Hỗ trợ kéo-thả hoặc bấm chọn tệp. Cho phép tải nhiều tệp để gộp thành một bài viết hoàn chỉnh.
                  </p>
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  {/* Zone 1: Tiến trình buổi */}
                  <div className="flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-[#0B72CE]" />
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        Tiến trình buổi (.docx, .txt, .md)
                      </span>
                    </div>

                    <div
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => {
                        e.preventDefault();
                        if (e.dataTransfer.files) {
                          void handleDocumentUpload(Array.from(e.dataTransfer.files), 'agenda');
                        }
                      }}
                      className="flex-1 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-4 text-center transition hover:border-[#0B72CE]"
                    >
                      {uploadingAgenda ? (
                        <div className="flex flex-col items-center gap-2 py-3">
                          <Loader2 className="h-6 w-6 animate-spin text-[#0B72CE]" />
                          <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Đang đọc tiến trình...</span>
                        </div>
                      ) : (
                        <>
                          <UploadCloud className="h-7 w-7 text-slate-400 mb-1" />
                          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                            Kéo thả hoặc bấm chọn tệp
                          </p>
                          <label className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#0B72CE] text-white px-3 py-1.5 text-xs font-bold cursor-pointer hover:bg-[#075CA8] transition min-h-[44px]">
                            <span>Chọn tệp tiến trình</span>
                            <input
                              type="file"
                              multiple
                              accept=".docx,.txt,.md"
                              onChange={e => {
                                if (e.target.files) {
                                  void handleDocumentUpload(Array.from(e.target.files), 'agenda');
                                  e.target.value = '';
                                }
                              }}
                              className="hidden"
                            />
                          </label>
                        </>
                      )}
                    </div>

                    {/* Danh sách tệp tiến trình */}
                    {formAgendaFiles.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                          Tệp đã nạp ({formAgendaFiles.length}):
                        </span>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {formAgendaFiles.map((f, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium text-slate-800 dark:text-slate-200" title={f.name}>
                                  {f.name}
                                </p>
                                <p className="text-[10px] text-slate-400">
                                  {(f.size / 1024).toFixed(1)} KB{f.charCount ? ` · ${f.charCount.toLocaleString()} ký tự` : ''}
                                  {f.truncated && <span className="ml-1 text-amber-500 font-bold">(Đã cắt bớt)</span>}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeAgendaFile(idx)}
                                title="Xóa tệp"
                                className="inline-flex items-center justify-center text-slate-400 hover:text-rose-500 p-1 min-h-[44px] min-w-[44px] cursor-pointer"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Zone 2: Nội dung tập huấn / tài liệu */}
                  <div className="flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-indigo-500" />
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        Nội dung tập huấn / tài liệu (.docx, .txt, .md)
                      </span>
                    </div>

                    <div
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => {
                        e.preventDefault();
                        if (e.dataTransfer.files) {
                          void handleDocumentUpload(Array.from(e.dataTransfer.files), 'material');
                        }
                      }}
                      className="flex-1 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-4 text-center transition hover:border-indigo-500"
                    >
                      {uploadingMaterial ? (
                        <div className="flex flex-col items-center gap-2 py-3">
                          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                          <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Đang đọc tài liệu...</span>
                        </div>
                      ) : (
                        <>
                          <UploadCloud className="h-7 w-7 text-slate-400 mb-1" />
                          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                            Kéo thả hoặc bấm chọn tệp
                          </p>
                          <label className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-xs font-bold cursor-pointer hover:bg-indigo-700 transition min-h-[44px]">
                            <span>Chọn tệp tài liệu</span>
                            <input
                              type="file"
                              multiple
                              accept=".docx,.txt,.md"
                              onChange={e => {
                                if (e.target.files) {
                                  void handleDocumentUpload(Array.from(e.target.files), 'material');
                                  e.target.value = '';
                                }
                              }}
                              className="hidden"
                            />
                          </label>
                        </>
                      )}
                    </div>

                    {/* Danh sách tệp tài liệu */}
                    {formMaterialFiles.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                          Tệp đã nạp ({formMaterialFiles.length}):
                        </span>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {formMaterialFiles.map((f, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium text-slate-800 dark:text-slate-200" title={f.name}>
                                  {f.name}
                                </p>
                                <p className="text-[10px] text-slate-400">
                                  {(f.size / 1024).toFixed(1)} KB{f.charCount ? ` · ${f.charCount.toLocaleString()} ký tự` : ''}
                                  {f.truncated && <span className="ml-1 text-amber-500 font-bold">(Đã cắt bớt)</span>}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeMaterialFile(idx)}
                                title="Xóa tệp"
                                className="inline-flex items-center justify-center text-slate-400 hover:text-rose-500 p-1 min-h-[44px] min-w-[44px] cursor-pointer"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Zone 3: Kết quả khảo sát (Tùy chọn) */}
                  <div className="flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        Kết quả khảo sát (.xlsx, .csv)
                      </span>
                    </div>

                    {formSurveySummary && formSurveySummary.has_survey ? (
                      <div className="flex-1 flex flex-col justify-between rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 text-xs space-y-2">
                        <div className="flex items-center justify-between gap-1 border-b border-emerald-200 dark:border-emerald-900/60 pb-1.5">
                          <span className="font-bold text-emerald-800 dark:text-emerald-300">
                            Đã nạp số liệu khảo sát
                          </span>
                          <button
                            type="button"
                            onClick={() => setFormSurveySummary(null)}
                            className="text-xs font-semibold text-rose-600 hover:text-rose-800 cursor-pointer min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
                          >
                            Xóa
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div>
                            <span className="text-slate-500 block">Tổng số phiếu</span>
                            <span className="font-extrabold text-slate-800 dark:text-slate-200 text-sm">
                              {formSurveySummary.total_responses}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">Mức hài lòng</span>
                            <span className="font-extrabold text-emerald-600 text-sm">
                              {formSurveySummary.overall_satisfaction_percent.toFixed(2).replace('.', ',')}%
                            </span>
                          </div>
                        </div>
                        {formSurveySummary.source_files && formSurveySummary.source_files.length > 1 && (
                          <div className="text-[10px] text-slate-500 pt-1">
                            Gộp từ {formSurveySummary.source_files.length} tệp: {formSurveySummary.source_files.map(sf => `${sf.name} (${sf.responses} phiếu)`).join(', ')}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          e.preventDefault();
                          if (e.dataTransfer.files) {
                            void handleSurveyUpload(Array.from(e.dataTransfer.files));
                          }
                        }}
                        className="flex-1 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-4 text-center transition hover:border-emerald-500"
                      >
                        {uploadingSurvey ? (
                          <div className="flex flex-col items-center gap-2 py-3">
                            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
                            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Đang đọc khảo sát...</span>
                          </div>
                        ) : (
                          <>
                            <UploadCloud className="h-7 w-7 text-slate-400 mb-1" />
                            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                              Kéo thả hoặc bấm chọn tệp
                            </p>
                            <label className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-bold cursor-pointer hover:bg-emerald-700 transition min-h-[44px]">
                              <span>Chọn tệp khảo sát</span>
                              <input
                                type="file"
                                multiple
                                accept=".xlsx,.xls,.csv"
                                onChange={e => {
                                  if (e.target.files) {
                                    void handleSurveyUpload(Array.from(e.target.files));
                                    e.target.value = '';
                                  }
                                }}
                                className="hidden"
                              />
                            </label>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 4. Ô LỚN Ghi chú thêm */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                    3. Ghi chú thêm
                  </h2>
                  <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                    Ưu tiên cao nhất khi mâu thuẫn với tệp
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Nói thêm bất cứ thông tin gì: tên đơn vị, ngày giờ, ai tham dự, giọng văn cần thể hiện, lưu ý đặc biệt, v.v.
                </p>
                <textarea
                  rows={5}
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  placeholder="Ví dụ: Buổi tập huấn diễn ra sáng ngày 25/10/2026 tại Hội trường lớn. Có sự tham dự của Ban Giám hiệu cùng hơn 40 giáo viên. Giọng văn cần trang trọng, tích cực, nhấn mạnh tinh thần thực hành nhiệt tình của các thầy cô..."
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-3.5 text-xs sm:text-sm text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none leading-relaxed"
                />
              </div>

              {/* Action bar for generation (sticky bottom) */}
              <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 p-4 shadow-lg backdrop-blur-md">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    disabled={savingForm || generating}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-xs cursor-pointer min-h-[44px]"
                  >
                    {savingForm ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    <span>Lưu bản nháp</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {generating ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-[#0B72CE]">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {aiQueuePos && aiQueuePos > 1
                          ? `Đang xếp hàng (vị trí #${aiQueuePos})...`
                          : 'AI đang soạn thảo tin bài...'}
                      </span>
                      <button
                        type="button"
                        onClick={handleCancelAiJob}
                        className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 cursor-pointer min-h-[44px]"
                      >
                        Hủy tác vụ
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
                      {!canGenerate && (
                        <span className="text-[11px] text-slate-500 italic">
                          Cần tải tệp hoặc nhập ghi chú để soạn tin
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={handleGenerate}
                        disabled={!canGenerate}
                        className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs sm:text-sm font-extrabold shadow-md transition active:scale-95 min-h-[44px] ${
                          canGenerate
                            ? 'bg-[#0B72CE] hover:bg-[#075CA8] text-white cursor-pointer'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed shadow-none'
                        }`}
                      >
                        <Sparkles className="h-4 w-4" />
                        <span>Soạn tin bài (AI)</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              VIEW 3: TRÌNH XEM & SỬA BÀI VIẾT (DETAIL VIEW)
              ══════════════════════════════════════════════════════════ */}
          {viewState === 'detail' && activePost && (
            <div className="space-y-6">
              {/* Actions Header */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded-md px-2.5 py-1 text-xs font-bold ${getPostTypeBadge(activePost.postType).color}`}>
                    {getPostTypeBadge(activePost.postType).label}
                  </span>
                  {activePost.id ? (
                    <span className="text-xs font-semibold text-slate-400">
                      #{activePost.id}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openEditor(activePost)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 shadow-xs cursor-pointer min-h-[44px]"
                  >
                    <Edit3 className="h-4 w-4" />
                    <span>Sửa thông tin đầu vào</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyRawText}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-black text-white px-4 py-2 text-xs font-bold shadow-xs transition cursor-pointer min-h-[44px]"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    <span>{copied ? 'Đã sao chép bài!' : 'Sao chép toàn bộ bài'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadDocx}
                    disabled={downloadingDocx}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-[#0B72CE] dark:text-[#60A5FA] hover:bg-blue-100 dark:hover:bg-blue-900/50 px-4 py-2 text-xs font-bold shadow-xs transition cursor-pointer min-h-[44px] disabled:opacity-50"
                  >
                    {downloadingDocx ? (
                      <Loader2 className="h-4 w-4 animate-spin text-[#0B72CE]" />
                    ) : (
                      <FileDown className="h-4 w-4 text-[#0B72CE] dark:text-[#60A5FA]" />
                    )}
                    <span>{downloadingDocx ? 'Đang xuất Word...' : 'Tải Word (.docx)'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenSchedulePublish}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 px-4 py-2 text-xs font-bold shadow-xs transition cursor-pointer min-h-[44px]"
                  >
                    <Calendar className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Lên lịch đăng bài</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveArticle}
                    disabled={savingArticle}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#0B72CE] hover:bg-[#075CA8] text-white px-4 py-2 text-xs font-bold shadow-xs transition cursor-pointer min-h-[44px]"
                  >
                    {savingArticle ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    <span>Lưu thay đổi</span>
                  </button>
                </div>
              </div>

              {/* Warnings if any */}
              {activePost.contentPayload?.warnings && activePost.contentPayload.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/40 p-4 text-xs font-semibold text-amber-800 dark:text-amber-200">
                  <div className="flex items-center gap-2 mb-1 text-sm font-bold">
                    <TriangleAlert className="h-4 w-4 text-amber-600" />
                    <span>Cảnh báo số liệu:</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-1">
                    {activePost.contentPayload.warnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Mobile Tab switcher if survey exists */}
              {activePost.surveySummary?.has_survey && (
                <div className="flex lg:hidden rounded-xl bg-slate-200/70 dark:bg-slate-900 p-1 border border-slate-300 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setDetailTab('article')}
                    className={`flex-1 rounded-lg py-2 text-xs font-bold text-center cursor-pointer min-h-[40px] ${
                      detailTab === 'article'
                        ? 'bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Bài viết Facebook
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailTab('survey_image')}
                    className={`flex-1 rounded-lg py-2 text-xs font-bold text-center cursor-pointer min-h-[40px] ${
                      detailTab === 'survey_image'
                        ? 'bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Đồ họa khảo sát (PNG)
                  </button>
                </div>
              )}

              {/* Two Column Layout on Desktop */}
              <div className="grid gap-6 lg:grid-cols-12 items-start">
                {/* Column 1: Editable Article Sections */}
                <div
                  className={`space-y-4 ${
                    activePost.surveySummary?.has_survey
                      ? detailTab === 'article'
                        ? 'block lg:col-span-7'
                        : 'hidden lg:block lg:col-span-7'
                      : 'col-span-12'
                  }`}
                >
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                    <div className="border-b border-slate-100 dark:border-slate-800 pb-3 flex items-center justify-between">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                        Trình soạn thảo bài viết
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Chỉnh sửa trực tiếp từng mục bên dưới
                      </span>
                    </div>

                    {/* Tiêu đề */}
                    <div>
                      <label className="block text-[11px] font-extrabold text-slate-500 uppercase mb-1">
                        Tiêu đề bài viết
                      </label>
                      <input
                        type="text"
                        value={editedHeadline}
                        onChange={e => setEditedHeadline(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none min-h-[44px]"
                      />
                    </div>

                    {/* Đoạn mở đầu */}
                    <div>
                      <label className="block text-[11px] font-extrabold text-slate-500 uppercase mb-1">
                        Đoạn mở đầu (Lead-in)
                      </label>
                      <textarea
                        rows={3}
                        value={editedLeadIn}
                        onChange={e => setEditedLeadIn(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-xs sm:text-sm text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none leading-relaxed"
                      />
                    </div>

                    {/* Các mục nội dung chính */}
                    {editedSections.map((sec, secIdx) => (
                      <div
                        key={secIdx}
                        className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3.5 space-y-3"
                      >
                        <div>
                          <label className="block text-[11px] font-extrabold text-slate-500 uppercase mb-1">
                            Tiêu đề phần {secIdx + 1}
                          </label>
                          <input
                            type="text"
                            value={sec.heading}
                            onChange={e => {
                              const next = [...editedSections];
                              next[secIdx].heading = e.target.value;
                              setEditedSections(next);
                            }}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-bold text-slate-900 dark:text-white min-h-[44px]"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-extrabold text-slate-500 uppercase mb-1">
                            Đoạn dẫn
                          </label>
                          <textarea
                            rows={2}
                            value={sec.body}
                            onChange={e => {
                              const next = [...editedSections];
                              next[secIdx].body = e.target.value;
                              setEditedSections(next);
                            }}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-xs text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none leading-relaxed"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-extrabold text-slate-500 uppercase mb-1">
                            Các điểm chính (Mỗi dòng một gạch đầu dòng)
                          </label>
                          <textarea
                            rows={4}
                            value={(sec.bullets || []).join('\n')}
                            onChange={e => {
                              const next = [...editedSections];
                              next[secIdx].bullets = e.target.value.split('\n');
                              setEditedSections(next);
                            }}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-xs text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none leading-relaxed font-mono"
                          />
                        </div>
                      </div>
                    ))}

                    {/* Mục khảo sát (Chỉ hiện khi bản tin có khảo sát) */}
                    {activePost.surveySummary?.has_survey && (
                      <div className="rounded-xl border border-teal-200 dark:border-teal-900/60 bg-teal-50/50 dark:bg-teal-950/20 p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-extrabold uppercase tracking-wider text-teal-800 dark:text-teal-300">
                            Mục khảo sát ý kiến
                          </span>
                        </div>

                        <div>
                          <label className="block text-[11px] font-extrabold text-slate-500 uppercase mb-1">
                            Tiêu đề mục khảo sát
                          </label>
                          <input
                            type="text"
                            value={editedSurveyHeading}
                            onChange={e => setEditedSurveyHeading(e.target.value)}
                            className="w-full rounded-lg border border-teal-300 dark:border-teal-800 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-bold text-slate-900 dark:text-white min-h-[44px]"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-extrabold text-slate-500 uppercase mb-1">
                            Nội dung đánh giá & số liệu
                          </label>
                          <textarea
                            rows={3}
                            value={editedSurveyText}
                            onChange={e => setEditedSurveyText(e.target.value)}
                            className="w-full rounded-lg border border-teal-300 dark:border-teal-800 bg-white dark:bg-slate-800 p-2.5 text-xs text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none leading-relaxed"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-extrabold text-slate-500 uppercase mb-1">
                            Tóm tắt ý kiến đóng góp của học viên
                          </label>
                          <textarea
                            rows={2}
                            value={editedSurveyFeedback}
                            onChange={e => setEditedSurveyFeedback(e.target.value)}
                            className="w-full rounded-lg border border-teal-300 dark:border-teal-800 bg-white dark:bg-slate-800 p-2.5 text-xs text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none leading-relaxed"
                          />
                        </div>
                      </div>
                    )}

                    {/* Lời cảm ơn & Kết */}
                    <div>
                      <label className="block text-[11px] font-extrabold text-slate-500 uppercase mb-1">
                        Lời cảm ơn & Lời kết
                      </label>
                      <textarea
                        rows={2}
                        value={editedClosing}
                        onChange={e => setEditedClosing(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-xs sm:text-sm text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none leading-relaxed"
                      />
                    </div>

                    {/* Slogan & Liên hệ & Hashtags (Ẩn đối với bài báo) */}
                    {activePost.postType !== 'press_article' && (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="block text-[11px] font-extrabold text-slate-500 uppercase mb-1">
                              Khẩu hiệu (Slogan)
                            </label>
                            <input
                              type="text"
                              value={editedSlogan}
                              onChange={e => setEditedSlogan(e.target.value)}
                              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-bold text-slate-900 dark:text-white min-h-[44px]"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-extrabold text-slate-500 uppercase mb-1">
                              Thông tin liên hệ (mỗi liên hệ 1 dòng)
                            </label>
                            <textarea
                              rows={3}
                              value={editedContactInfo}
                              onChange={e => setEditedContactInfo(e.target.value)}
                              placeholder={"🌐 www.fermat.vn\n✉ contact@fermat.vn\n☎ 0969 627 162"}
                              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-xs text-slate-900 dark:text-white min-h-[44px] leading-relaxed"
                            />
                            {splitContactInfo(editedContactInfo).length > 0 && (
                              <div className="mt-1 space-y-0.5 text-[11px] text-slate-600 dark:text-slate-300 font-medium pl-2 border-l-2 border-blue-500">
                                {splitContactInfo(editedContactInfo).map((line, idx) => (
                                  <div key={idx}>{line}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Hashtags */}
                        <div>
                          <label className="block text-[11px] font-extrabold text-slate-500 uppercase mb-1">
                            Hashtags (1 đoạn, căn trái, cách nhau 1 dấu cách)
                          </label>
                          <input
                            type="text"
                            value={editedHashtags}
                            onChange={e => setEditedHashtags(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-mono text-[#0B72CE] dark:text-[#60A5FA] min-h-[44px] text-left"
                          />
                          {normalizeHashtags(editedHashtags) && (
                            <p className="mt-1 text-xs text-left text-[#0B72CE] dark:text-[#60A5FA] font-mono break-words">
                              {normalizeHashtags(editedHashtags)}
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Column 2: Survey Report Graphic (PNG Image) */}
                {activePost.surveySummary?.has_survey && (
                  <div
                    className={`space-y-4 ${
                      detailTab === 'survey_image'
                        ? 'block lg:col-span-5'
                        : 'hidden lg:block lg:col-span-5'
                    }`}
                  >
                    <div className="sticky top-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                      <SurveyReportImage
                        unitName={activePost.inputPayload?.unit_name || ''}
                        sessionTitle={activePost.title}
                        sessionDate={activePost.inputPayload?.sessions?.[0]?.sessionDate || 'Gần đây'}
                        surveySummary={activePost.surveySummary}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {showPublishModal && activePost && (
        <PlanEditorModal
          idToken={idToken}
          plan={null}
          channels={publishChannels}
          newsPosts={posts.map(p => ({ id: p.id, title: p.title, post_type: p.postType }))}
          initialNewsPost={{
            id: activePost.id,
            title: activePost.title,
            content: buildCurrentRawText(),
          }}
          userRole={userRole}
          userEmail={userEmail}
          onClose={() => setShowPublishModal(false)}
          onSaved={() => {
            setShowPublishModal(false);
            setNotice('Đã lên lịch phát hành bài viết thành công!');
          }}
        />
      )}
    </div>
  );
}