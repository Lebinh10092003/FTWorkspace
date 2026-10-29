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
import { COMMUNICATION_TOOLS_NAV } from '../../config/workspaceNavigation';
import {
  NewsPostItem,
  PostType,
  PostStatus,
  SessionItem,
  SurveySummary,
  ContentPayload,
  ArticleSection,
} from './newsPostTypes';
import SurveyReportImage from './SurveyReportImage';

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

// Dữ liệu mẫu khởi tạo nhanh cho người dùng trải nghiệm
const SAMPLE_TRAINING_POST: Partial<NewsPostItem> = {
  title: 'Tập huấn Chuyển đổi số và AI tại Xã Hòa Phú',
  postType: 'fb_training',
  inputPayload: {
    unit_name: 'Xã Hòa Phú',
    notes: 'Tập huấn nâng cao năng lực ứng dụng Gemini AI và Bộ nhớ dùng chung cho cán bộ xã.',
    sessions: [
      {
        sessionId: 'session-1',
        sessionName: 'Buổi 1: Giới thiệu Bộ nhớ dùng chung và Gemini AI',
        sessionDate: '2026-10-24',
        timeFrame: '08:00 - 11:30',
        location: 'Hội trường UBND Xã Hòa Phú',
        fermatParticipants: ['Nguyễn Văn Tiến', 'Đặng Vũ Hiệp'],
        unitParticipants: ['Lãnh đạo Đảng ủy', 'UBND', 'Cán bộ công chức các ban ngành'],
        agendaContent: `1/ Bối cảnh: Đẩy mạnh chuyển đổi số trong công tác quản lý nhà nước tại địa phương.
2/ Nội dung đã thực hiện:
- Hướng dẫn thiết lập và phân quyền thư mục trên Bộ nhớ dùng chung.
- Hướng dẫn đăng nhập và sử dụng Trợ lý Gemini AI hỗ trợ soạn thảo văn bản, tóm tắt báo cáo.
- Thực hành xây dựng kế hoạch công tác tuần và lập biên bản họp bằng AI.
3/ Kết quả: 100% cán bộ tham gia thực hành thành công trên máy tính.`,
      },
    ],
  },
  surveySummary: {
    has_survey: true,
    total_responses: 188,
    total_ratings: 1880,
    overall_satisfaction_percent: 91.58,
    overall_good_or_very_good_percent: 100,
    top_rated_criterion: 'Kiến thức chuyên môn & sự nhiệt tình giải đáp của giảng viên',
    notable_criterion: 'Bộ nhớ dùng chung (lưu trữ & khai thác dữ liệu)',
    open_feedback_points: [
      'Mong muốn tiếp tục được hỗ trợ, giải đáp vướng mắc khi thực hành thực tế.',
      'Đề xuất tổ chức thêm các buổi hướng dẫn nâng cao về Gemini AI cho từng vị trí chuyên môn.',
    ],
    categories: [
      { name: 'Trình độ, kiến thức chuyên môn của giảng viên', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 93.68, detail_counts: { 'Rất tốt': 128, 'Tốt': 60 } },
      { name: 'Khả năng truyền đạt, phong thái sư phạm', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 91.11, detail_counts: { 'Rất tốt': 104, 'Tốt': 84 } },
      { name: 'Tính thực tiễn của ví dụ và hướng dẫn', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 91.58, detail_counts: { 'Rất tốt': 109, 'Tốt': 79 } },
      { name: 'Sự nhiệt tình, sẵn sàng giải đáp thắc mắc', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 93.68, detail_counts: { 'Rất tốt': 128, 'Tốt': 60 } },
      { name: 'Khả năng quản lý, kiểm soát thời gian', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 91.11, detail_counts: { 'Rất tốt': 104, 'Tốt': 84 } },
      { name: 'Bộ nhớ dùng chung – Lưu trữ tài liệu', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 88.42, detail_counts: { 'Rất tốt': 79, 'Tốt': 109 } },
      { name: 'Bộ nhớ dùng chung – Khai thác dữ liệu', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 88.42, detail_counts: { 'Rất tốt': 79, 'Tốt': 109 } },
      { name: 'Gemini AI – Sử dụng trợ lý Gem', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 89.47, detail_counts: { 'Rất tốt': 89, 'Tốt': 99 } },
      { name: 'Gemini AI – Soạn thảo, tóm tắt văn bản', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 89.47, detail_counts: { 'Rất tốt': 89, 'Tốt': 99 } },
      { name: 'Gemini AI – Tạo hình ảnh, slide', total_ratings: 188, good_or_very_good_count: 188, good_or_very_good_percent: 100, satisfaction_score: 89.47, detail_counts: { 'Rất tốt': 89, 'Tốt': 99 } },
    ],
  },
  contentPayload: {
    headline: 'TẬP HUẤN ỨNG DỤNG BỘ NHỚ DÙNG CHUNG VÀ GEMINI AI TRONG CÔNG TÁC TẠI XÃ HÒA PHÚ',
    lead_in: 'Nhằm đẩy mạnh chuyển đổi số và nâng cao hiệu quả công việc, FermatTech đã phối hợp cùng UBND Xã Hòa Phú tổ chức chương trình tập huấn ứng dụng Bộ nhớ dùng chung và Trợ lý Gemini AI cho toàn thể cán bộ, công chức trên địa bàn xã.',
    sections: [
      {
        heading: 'NỘI DUNG TẬP HUẤN TRỌNG TÂM',
        body: 'Buổi làm việc diễn ra trong không khí sôi nổi, thực chất với các nội dung bám sát công việc hàng ngày của từng cán bộ:',
        bullets: [
          'Thiết lập, phân quyền và chuẩn hóa cấu trúc lưu trữ trên Bộ nhớ dùng chung giúp dữ liệu an toàn, tìm kiếm tức thì.',
          'Khai thác trợ lý Gemini AI để tóm tắt văn bản chỉ đạo, dự thảo báo cáo tuần và lập biên bản họp nhanh chóng.',
          'Xây dựng các câu lệnh (prompts) mẫu theo vị trí việc làm: văn phòng, địa chính, tài chính - kế toán, tư pháp.',
        ],
      },
    ],
    survey_section: {
      heading: '📊 PHẢN HỒI SAU TẬP HUẤN',
      text: 'Khảo sát sau buổi tập huấn ghi nhận 188 lượt cán bộ tham gia đánh giá với 100% lượt đánh giá đạt loại Tốt và Rất tốt. Mức hài lòng bình quân đạt 91,58%. Giảng viên FermatTech được đánh giá cao nhất về chuyên môn và sự nhiệt tình (93,68%).',
      feedback_summary: 'Học viên mong muốn tiếp tục được đồng hành, hướng dẫn thực hành sâu hơn theo từng chuyên đề công việc cụ thể.',
    },
    closing: 'FermatTech xin trân trọng cảm ơn sự quan tâm, chỉ đạo sát sao của Đảng ủy, HĐND, UBND Xã Hòa Phú và sự tham gia nhiệt tình, trách nhiệm của các đồng chí cán bộ, công chức xã.',
    slogan: 'FERMATTECH – ĐỒNG HÀNH CHUYỂN ĐỔI SỐ THỰC CHẤT VÀ HIỆU QUẢ!',
    contact_info: '🌐 www.fermat.vn | ✉ contact@fermat.vn | ☎ 0969 627 162',
    hashtags: ['#FermatTech', '#ChuyenDoiSo', '#GeminiAI', '#BoNhoDungChung', '#TapHuanAI', '#XaHoaPhu'],
    raw_text: `🌟 TẬP HUẤN ỨNG DỤNG BỘ NHỚ DÙNG CHUNG VÀ GEMINI AI TRONG CÔNG TÁC TẠI XÃ HÒA PHÚ

Nhằm đẩy mạnh chuyển đổi số và nâng cao hiệu quả công việc, FermatTech đã phối hợp cùng UBND Xã Hòa Phú tổ chức chương trình tập huấn ứng dụng Bộ nhớ dùng chung và Trợ lý Gemini AI cho toàn thể cán bộ, công chức trên địa bàn xã.

NỘI DUNG TẬP HUẤN TRỌNG TÂM
Buổi làm việc diễn ra trong không khí sôi nổi, thực chất với các nội dung bám sát công việc hàng ngày của từng cán bộ:
✅ Thiết lập, phân quyền và chuẩn hóa cấu trúc lưu trữ trên Bộ nhớ dùng chung giúp dữ liệu an toàn, tìm kiếm tức thì.
✅ Khai thác trợ lý Gemini AI để tóm tắt văn bản chỉ đạo, dự thảo báo cáo tuần và lập biên bản họp nhanh chóng.
✅ Xây dựng các câu lệnh (prompts) mẫu theo vị trí việc làm: văn phòng, địa chính, tài chính - kế toán, tư pháp.

📊 PHẢN HỒI SAU TẬP HUẤN
Khảo sát sau buổi tập huấn ghi nhận 188 lượt cán bộ tham gia đánh giá với 100% lượt đánh giá đạt loại Tốt và Rất tốt. Mức hài lòng bình quân đạt 91,58%. Giảng viên FermatTech được đánh giá cao nhất về chuyên môn và sự nhiệt tình (93,68%).
Học viên mong muốn tiếp tục được đồng hành, hướng dẫn thực hành sâu hơn theo từng chuyên đề công việc cụ thể.

FermatTech xin trân trọng cảm ơn sự quan tâm, chỉ đạo sát sao của Đảng ủy, HĐND, UBND Xã Hòa Phú và sự tham gia nhiệt tình, trách nhiệm của các đồng chí cán bộ, công chức xã.

FERMATTECH – ĐỒNG HÀNH CHUYỂN ĐỔI SỐ THỰC CHẤT VÀ HIỆU QUẢ!

🌐 www.fermat.vn | ✉ contact@fermat.vn | ☎ 0969 627 162

#FermatTech #ChuyenDoiSo #GeminiAI #BoNhoDungChung #TapHuanAI #XaHoaPhu`,
  },
  status: 'completed',
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
  const [formSessions, setFormSessions] = useState<SessionItem[]>([]);
  const [formSurveySummary, setFormSurveySummary] = useState<SurveySummary | null>(null);
  const [surveyScope, setSurveyScope] = useState<'combined' | 'by_session'>('combined');
  const [uploadingSurvey, setUploadingSurvey] = useState<boolean>(false);
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
        const postList = data.posts || [];
        setPosts(postList);
      } else {
        // Fallback demo posts if offline or empty
        setPosts([SAMPLE_TRAINING_POST as NewsPostItem]);
      }
    } catch {
      // Local fallback
      setPosts([SAMPLE_TRAINING_POST as NewsPostItem]);
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
    setEditedContactInfo(cp.contact_info || '🌐 www.fermat.vn | ✉ contact@fermat.vn | ☎ 0969 627 162');
    setEditedHashtags((cp.hashtags || []).join(' '));
  }, []);

  // Open editor for a new post or existing post
  const openEditor = (post?: NewsPostItem) => {
    if (post) {
      setActivePostId(post.id);
      setActivePost(post);
      setFormPostType(post.postType);
      setFormTitle(post.title);
      setFormUnitName(post.inputPayload?.unit_name || '');
      setFormNotes(post.inputPayload?.notes || '');
      setFormSessions(post.inputPayload?.sessions ? JSON.parse(JSON.stringify(post.inputPayload.sessions)) : []);
      setFormSurveySummary(post.surveySummary?.has_survey ? post.surveySummary : null);
    } else {
      setActivePostId(null);
      setActivePost(null);
      setFormPostType('fb_training');
      setFormTitle('');
      setFormUnitName('');
      setFormNotes('');
      setFormSessions([
        {
          sessionId: `session-${Date.now()}`,
          sessionName: 'Buổi 1: Tập huấn ứng dụng AI và BNDC',
          sessionDate: new Date().toISOString().split('T')[0],
          timeFrame: '08:00 - 11:30',
          location: '',
          fermatParticipants: [userName || 'FermatTech'],
          unitParticipants: [],
          agendaContent: '',
        },
      ]);
      setFormSurveySummary(null);
    }
    setViewState('editor');
  };

  // Nạp dữ liệu mẫu nhanh để kiểm tra
  const loadQuickSample = () => {
    setFormPostType(SAMPLE_TRAINING_POST.postType || 'fb_training');
    setFormTitle(SAMPLE_TRAINING_POST.title || '');
    setFormUnitName(SAMPLE_TRAINING_POST.inputPayload?.unit_name || '');
    setFormNotes(SAMPLE_TRAINING_POST.inputPayload?.notes || '');
    setFormSessions(SAMPLE_TRAINING_POST.inputPayload?.sessions ? JSON.parse(JSON.stringify(SAMPLE_TRAINING_POST.inputPayload.sessions)) : []);
    setFormSurveySummary(SAMPLE_TRAINING_POST.surveySummary || null);
    setNotice('Đã nạp dữ liệu mẫu thành công.');
  };

  // Add / remove session
  const addSession = () => {
    const nextIdx = formSessions.length + 1;
    setFormSessions([
      ...formSessions,
      {
        sessionId: `session-${Date.now()}`,
        sessionName: `Buổi ${nextIdx}: `,
        sessionDate: new Date().toISOString().split('T')[0],
        timeFrame: '08:00 - 11:30',
        location: '',
        fermatParticipants: [userName || 'FermatTech'],
        unitParticipants: [],
        agendaContent: '',
      },
    ]);
  };

  const removeSession = (index: number) => {
    const next = [...formSessions];
    next.splice(index, 1);
    setFormSessions(next);
  };

  const updateSession = (index: number, field: keyof SessionItem, value: any) => {
    const next = [...formSessions];
    next[index] = { ...next[index], [field]: value };
    setFormSessions(next);
  };

  // Handle survey file upload (.xlsx, .csv)
  const handleSurveyUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.csv') && !file.name.endsWith('.xls')) {
      setError('Vui lòng chọn tệp khảo sát định dạng .xlsx hoặc .csv.');
      return;
    }

    setUploadingSurvey(true);
    setError('');

    const formData = new FormData();
    formData.append('file', file);

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
        if (data.surveySummary) {
          setFormSurveySummary(data.surveySummary);
          setNotice(`Tải khảo sát thành công: ${data.surveySummary.total_responses} phiếu, mức hài lòng ${data.surveySummary.overall_satisfaction_percent}%`);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Không thể đọc tệp khảo sát.');
      }
    } catch {
      setError('Lỗi kết nối khi tải tệp khảo sát.');
    } finally {
      setUploadingSurvey(false);
      e.target.value = '';
    }
  };

  // Save draft
  const handleSaveDraft = async () => {
    if (!formTitle.trim()) {
      setError('Vui lòng nhập tiêu đề bản tin.');
      return;
    }

    setSavingForm(true);
    setError('');

    const payload = {
      title: formTitle,
      post_type: formPostType,
      input_payload: {
        unit_name: formUnitName,
        notes: formNotes,
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
        const savedPost = data.post as NewsPostItem;
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
    if (!formTitle.trim()) {
      setError('Vui lòng nhập tiêu đề bản tin trước khi tạo.');
      return;
    }

    setGenerating(true);
    setError('');
    setNotice('');

    try {
      // 1. Lưu nháp trước nếu chưa có id
      let postId = activePostId;
      if (!postId) {
        const saveRes = await fetch('/api/news-posts/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            title: formTitle,
            post_type: formPostType,
            input_payload: {
              unit_name: formUnitName,
              notes: formNotes,
              sessions: formSessions,
            },
            survey_summary: formSurveySummary || { has_survey: false },
          }),
        });
        if (!saveRes.ok) throw new Error('Không thể tạo bản ghi trước khi chạy AI.');
        const savedData = await saveRes.json();
        postId = savedData.post.id;
        setActivePostId(postId);
        setActivePost(savedData.post);
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
    if (editedSlogan) lines.push('', editedSlogan);
    if (editedContactInfo) lines.push('', editedContactInfo);
    if (editedHashtags) lines.push('', editedHashtags);

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
  const handleSaveArticle = async () => {
    if (!activePostId) return;
    setSavingArticle(true);
    setError('');

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
      slogan: editedSlogan,
      contact_info: editedContactInfo,
      hashtags: editedHashtags.split(/\s+/).filter(Boolean),
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
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Không thể lưu bài viết.');
      }
    } catch {
      setError('Lỗi kết nối khi lưu bài viết.');
    } finally {
      setSavingArticle(false);
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
                <span>Danh sách bài</span>
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

            {viewState === 'list' && (
              <button
                type="button"
                onClick={loadQuickSample}
                className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40 px-3.5 py-2 text-xs font-bold text-[#0B72CE] dark:text-[#60A5FA] hover:bg-blue-100 dark:hover:bg-blue-900/40 transition cursor-pointer min-h-[44px]"
              >
                <Sparkles className="h-4 w-4" />
                <span>Nạp bài mẫu trải nghiệm</span>
              </button>
            )}
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
                    <button
                      type="button"
                      onClick={loadQuickSample}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 cursor-pointer min-h-[44px]"
                    >
                      <Sparkles className="h-4 w-4 text-[#0B72CE]" />
                      <span>Nạp mẫu Xã Hòa Phú</span>
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
              {/* Back to list & title */}
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setViewState('list')}
                  className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer min-h-[44px]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Quay lại danh sách</span>
                </button>
                <button
                  type="button"
                  onClick={loadQuickSample}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 cursor-pointer min-h-[44px]"
                >
                  <Sparkles className="h-3.5 w-3.5 text-[#0B72CE]" />
                  <span>Điền nhanh mẫu Hòa Phú</span>
                </button>
              </div>

              {/* Step 1: Chọn loại tin */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                <h2 className="text-sm font-extrabold text-slate-900 dark:text-white mb-3">
                  1. Chọn loại tin bài cần soạn
                </h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setFormPostType('fb_training')}
                    className={`flex flex-col text-left p-4 rounded-xl border-2 transition cursor-pointer min-h-[44px] ${
                      formPostType === 'fb_training'
                        ? 'border-[#0B72CE] bg-blue-50/50 dark:bg-blue-950/30'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
                    }`}
                  >
                    <span className="text-xs font-extrabold text-[#0B72CE] dark:text-[#60A5FA]">
                      Facebook Tập huấn
                    </span>
                    <span className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                      Bài đăng sau tập huấn BNDC, Gemini AI; tiêu đề in hoa, gạch đầu dòng và mục khảo sát.
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormPostType('fb_meeting')}
                    className={`flex flex-col text-left p-4 rounded-xl border-2 transition cursor-pointer min-h-[44px] ${
                      formPostType === 'fb_meeting'
                        ? 'border-[#0B72CE] bg-blue-50/50 dark:bg-blue-950/30'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
                    }`}
                  >
                    <span className="text-xs font-extrabold text-[#0B72CE] dark:text-[#60A5FA]">
                      Facebook Họp / Đối tác
                    </span>
                    <span className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                      Bài đăng làm việc với đối tác, nhà trường, sở ngành; bối cảnh, thỏa thuận hợp tác và cam kết.
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormPostType('press_article')}
                    className={`flex flex-col text-left p-4 rounded-xl border-2 transition cursor-pointer min-h-[44px] ${
                      formPostType === 'press_article'
                        ? 'border-[#0B72CE] bg-blue-50/50 dark:bg-blue-950/30'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
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

              {/* Step 2: Thông tin chung */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                  2. Thông tin chung
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Tiêu đề bản tin <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formTitle}
                      onChange={e => setFormTitle(e.target.value)}
                      placeholder="Ví dụ: Tập huấn Chuyển đổi số và AI tại Xã Hòa Phú"
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none min-h-[44px]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Tên đơn vị / Trường học / Đối tác
                    </label>
                    <input
                      type="text"
                      value={formUnitName}
                      onChange={e => setFormUnitName(e.target.value)}
                      placeholder="Ví dụ: Xã Hòa Phú, THCS Giảng Võ, ..."
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none min-h-[44px]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Ghi chú / Yêu cầu bổ sung cho bài viết
                  </label>
                  <textarea
                    rows={2}
                    value={formNotes}
                    onChange={e => setFormNotes(e.target.value)}
                    placeholder="Ví dụ: Nhấn mạnh sự nhiệt tình tham gia của các thầy cô, nhắc tới lộ trình tập huấn 3 giai đoạn..."
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-xs sm:text-sm text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Step 3: Danh sách các buổi làm việc */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                      3. Tiến trình các buổi làm việc ({formSessions.length} buổi)
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Dán nội dung tiến trình hoặc ghi các điểm chính đã trao đổi, hướng dẫn.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addSession}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40 px-3 py-2 text-xs font-bold text-[#0B72CE] dark:text-[#60A5FA] hover:bg-blue-100 dark:hover:bg-blue-900/40 transition cursor-pointer min-h-[44px]"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Thêm buổi</span>
                  </button>
                </div>

                <div className="space-y-4">
                  {formSessions.map((session, sIdx) => (
                    <div
                      key={session.sessionId || sIdx}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700 pb-2.5">
                        <span className="text-xs font-bold text-[#0B72CE] dark:text-[#60A5FA]">
                          Buổi #{sIdx + 1}
                        </span>
                        {formSessions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeSession(sIdx)}
                            className="text-xs text-rose-600 hover:text-rose-800 dark:text-rose-400 cursor-pointer p-1 min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
                          >
                            Xóa buổi này
                          </button>
                        )}
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                            Tên / Chủ đề buổi
                          </label>
                          <input
                            type="text"
                            value={session.sessionName}
                            onChange={e => updateSession(sIdx, 'sessionName', e.target.value)}
                            placeholder="Ví dụ: Buổi 1: Giới thiệu hệ thống và BNDC"
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white min-h-[44px]"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                            Ngày diễn ra
                          </label>
                          <input
                            type="date"
                            value={session.sessionDate}
                            onChange={e => updateSession(sIdx, 'sessionDate', e.target.value)}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white min-h-[44px]"
                          />
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                            Người tham gia FermatTech (cách nhau dấu phẩy)
                          </label>
                          <input
                            type="text"
                            value={(session.fermatParticipants || []).join(', ')}
                            onChange={e =>
                              updateSession(
                                sIdx,
                                'fermatParticipants',
                                e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                              )
                            }
                            placeholder="Ví dụ: Nguyễn Văn Tiến, Đặng Vũ Hiệp"
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white min-h-[44px]"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                            Đại diện đơn vị đối tác (cách nhau dấu phẩy)
                          </label>
                          <input
                            type="text"
                            value={(session.unitParticipants || []).join(', ')}
                            onChange={e =>
                              updateSession(
                                sIdx,
                                'unitParticipants',
                                e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                              )
                            }
                            placeholder="Ví dụ: Hiệu trưởng, Phó Hiệu trưởng, Cán bộ tin học"
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white min-h-[44px]"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                          Nội dung tiến trình buổi làm việc (Dán trực tiếp văn bản)
                        </label>
                        <textarea
                          rows={4}
                          value={session.agendaContent}
                          onChange={e => updateSession(sIdx, 'agendaContent', e.target.value)}
                          placeholder="Dán nội dung tiến trình (1/ Bối cảnh 2/ Nội dung đã triển khai 3/ Thảo luận & giải đáp 4/ Kết quả đạt được...)"
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-xs text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none leading-relaxed"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Step 4: Khảo sát đánh giá */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                      4. Khảo sát đánh giá (.xlsx / .csv)
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Tải file kết quả Google Forms xuất Excel. Nếu không có file khảo sát, bài viết sẽ không có mục khảo sát và không tạo ảnh.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                      Xử lý:
                    </label>
                    <select
                      value={surveyScope}
                      onChange={e => setSurveyScope(e.target.value as any)}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white min-h-[44px]"
                    >
                      <option value="combined">Gộp tất cả buổi</option>
                      <option value="by_session">Theo từng buổi riêng</option>
                    </select>
                  </div>
                </div>

                {formSurveySummary && formSurveySummary.has_survey ? (
                  <div className="rounded-xl border border-teal-200 dark:border-teal-900/60 bg-teal-50/50 dark:bg-teal-950/20 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2 border-b border-teal-200 dark:border-teal-900/60 pb-2.5">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                        <span className="text-xs font-bold text-teal-800 dark:text-teal-300">
                          Đã nạp số liệu khảo sát thành công
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFormSurveySummary(null)}
                        className="text-xs font-semibold text-rose-600 hover:text-rose-800 cursor-pointer p-1 min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
                      >
                        Xóa khảo sát
                      </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="rounded-lg bg-white dark:bg-slate-900 p-3 border border-teal-100 dark:border-teal-900/40">
                        <span className="block text-[11px] font-bold text-slate-500">Tổng số đánh giá</span>
                        <span className="text-lg font-black text-slate-900 dark:text-white">
                          {formSurveySummary.total_responses} phiếu
                        </span>
                      </div>
                      <div className="rounded-lg bg-white dark:bg-slate-900 p-3 border border-teal-100 dark:border-teal-900/40">
                        <span className="block text-[11px] font-bold text-slate-500">Mức hài lòng bình quân</span>
                        <span className="text-lg font-black text-[#0B72CE]">
                          {formSurveySummary.overall_satisfaction_percent.toFixed(2).replace('.', ',')}%
                        </span>
                      </div>
                      <div className="rounded-lg bg-white dark:bg-slate-900 p-3 border border-teal-100 dark:border-teal-900/40">
                        <span className="block text-[11px] font-bold text-slate-500">Tỷ lệ Tốt / Rất tốt</span>
                        <span className="text-lg font-black text-emerald-600">
                          {formSurveySummary.overall_good_or_very_good_percent.toFixed(1).replace('.', ',')}%
                        </span>
                      </div>
                      <div className="rounded-lg bg-white dark:bg-slate-900 p-3 border border-teal-100 dark:border-teal-900/40">
                        <span className="block text-[11px] font-bold text-slate-500">Số tiêu chí</span>
                        <span className="text-lg font-black text-slate-900 dark:text-white">
                          {formSurveySummary.categories?.length || 0} mục
                        </span>
                      </div>
                    </div>

                    {formSurveySummary.top_rated_criterion && (
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        <strong>Cao nhất:</strong> {formSurveySummary.top_rated_criterion}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-6 text-center">
                    <UploadCloud className="mx-auto h-8 w-8 text-slate-400" />
                    <p className="mt-2 text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300">
                      Tải lên tệp khảo sát (.xlsx, .csv)
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Tự động tính toán mức hài lòng, lọc bỏ danh tính cá nhân và trích xuất ý kiến mở.
                    </p>
                    <div className="mt-4">
                      <label className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 text-white px-4 py-2 text-xs font-bold cursor-pointer transition min-h-[44px]">
                        {uploadingSurvey ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Đang đọc dữ liệu...</span>
                          </>
                        ) : (
                          <>
                            <FileSpreadsheet className="h-4 w-4" />
                            <span>Chọn tệp từ máy tính</span>
                          </>
                        )}
                        <input
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          onChange={handleSurveyUpload}
                          disabled={uploadingSurvey}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Action bar for generation */}
              <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 p-4 shadow-lg backdrop-blur-md">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    disabled={savingForm || generating}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 shadow-xs cursor-pointer min-h-[44px]"
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
                    <button
                      type="button"
                      onClick={handleGenerate}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#0B72CE] hover:bg-[#075CA8] text-white px-5 py-2.5 text-xs sm:text-sm font-extrabold shadow-md transition active:scale-95 cursor-pointer min-h-[44px]"
                    >
                      <Sparkles className="h-4 w-4" />
                      <span>Soạn tin bài (AI)</span>
                    </button>
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
              {/* Back to list & Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setViewState('list')}
                  className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer min-h-[44px]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Quay lại danh sách</span>
                </button>

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

                    {/* Slogan & Liên hệ */}
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
                          Thông tin liên hệ
                        </label>
                        <input
                          type="text"
                          value={editedContactInfo}
                          onChange={e => setEditedContactInfo(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white min-h-[44px]"
                        />
                      </div>
                    </div>

                    {/* Hashtags */}
                    <div>
                      <label className="block text-[11px] font-extrabold text-slate-500 uppercase mb-1">
                        Hashtags
                      </label>
                      <input
                        type="text"
                        value={editedHashtags}
                        onChange={e => setEditedHashtags(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-mono text-[#0B72CE] dark:text-[#60A5FA] min-h-[44px]"
                      />
                    </div>
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
    </div>
  );
}