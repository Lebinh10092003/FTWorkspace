import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Mail,
  RefreshCw,
  Settings,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  ChevronRight,
  Shield,
  Trash2,
  Search,
  Filter,
  Inbox,
  Send,
  FileText,
  Sun,
  Eye,
  Check,
  X,
  AlertCircle,
  HelpCircle,
  Calendar,
  Layers,
  ArrowRight
} from 'lucide-react';
import ModuleShellHeader from '../layout/ModuleShellHeader';
import { COMMUNICATION_TOOLS_NAV } from '../../config/workspaceNavigation';
import { appDialog } from '../AppDialog';
import { GmailStatusResponse, MailDigestItem, MorningDigestResponse, ActionItem, DigestsCounts } from './gmailTypes';

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

type TabFilter = 'all' | 'needs_reply' | 'cc' | 'today';
type StatusFilter = 'all' | 'unhandled' | 'handled';

export default function GmailAssistantCenter({
  idToken,
  userName,
  userEmail,
  userRole,
  photoURL,
  onAccountClick,
  onLogout,
  onNavSelect,
}: Props) {
  // Trạng thái chung
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [status, setStatus] = useState<GmailStatusResponse | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [oauthErrorMessage, setOauthErrorMessage] = useState<string | null>(null);
  const [completingOAuth, setCompletingOAuth] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const processedCodesRef = useRef<Set<string>>(new Set());

  // Điểm tin sáng
  const [morningDigest, setMorningDigest] = useState<MorningDigestResponse | null>(null);
  const [loadingMorning, setLoadingMorning] = useState(false);
  const [morningExpanded, setMorningExpanded] = useState(true);

  // Danh sách thư & bộ lọc
  const [digests, setDigests] = useState<MailDigestItem[]>([]);
  const [loadingDigests, setLoadingDigests] = useState(false);
  const [currentTab, setCurrentTab] = useState<TabFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [digestsCounts, setDigestsCounts] = useState<DigestsCounts>({
    all: 0,
    needs_reply: 0,
    cc: 0,
    today: 0,
    unhandled: 0,
    handled: 0,
  });

  // Tác vụ trên thư (phân tích, toggle action)
  const [analyzingDigestId, setAnalyzingDigestId] = useState<number | null>(null);
  const [togglingAction, setTogglingAction] = useState<{ digestId: number; actionIndex: number } | null>(null);

  // Xem chi tiết & Soạn phản hồi
  const [selectedDigest, setSelectedDigest] = useState<MailDigestItem | null>(null);
  const [replyModalOpen, setReplyModalOpen] = useState(false);
  const [replyInstructions, setReplyInstructions] = useState('');
  const [replyIsSuperior, setReplyIsSuperior] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSavedSuccess, setDraftSavedSuccess] = useState(false);

  // Thêm vào Lịch công tác modal
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleModalDigest, setScheduleModalDigest] = useState<MailDigestItem | null>(null);
  const [scheduleForm, setScheduleForm] = useState({
    title: '',
    work_date: '',
    start_time: '',
    end_time: '',
    priority: 'medium' as 'low' | 'medium' | 'high',
    description: '',
    action_index: null as number | null,
  });
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [alreadyScheduledWarning, setAlreadyScheduledWarning] = useState<string | null>(null);

  // Cài đặt modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    ai_enabled: false,
    notify_new: true,
    morning_scan_enabled: true,
    morning_time: '08:00',
    superior_contacts_text: '',
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Helper auth headers
  const authHeaders = useMemo(() => ({
    'Content-Type': 'application/json',
    Authorization: idToken ? `Bearer ${idToken}` : '',
  }), [idToken]);

  // Danh sách tên miền được phép kết nối hiển thị trên giao diện
  const allowedDomainsDisplay = useMemo(() => {
    if (status?.allowed_domains && status.allowed_domains.length > 0) {
      return status.allowed_domains.map(d => `@${d}`).join(' hoặc ');
    }
    return '@fermat.vn hoặc @fermat.edu.vn';
  }, [status?.allowed_domains]);

  // Hiển thị toast thông báo ngắn
  const showToast = useCallback((msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => {
      setSuccessToast(prev => (prev === msg ? null : prev));
    }, 4000);
  }, []);

  // 1. Tải trạng thái kết nối
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/gmail/status/', { headers: authHeaders });
      if (res.ok) {
        const data: GmailStatusResponse = await res.json();
        setStatus(data);
        setSettingsForm({
          ai_enabled: !!data.ai_enabled,
          notify_new: data.notify_new !== false,
          morning_scan_enabled: data.morning_scan_enabled !== false,
          morning_time: data.morning_time || '08:00',
          superior_contacts_text: Array.isArray(data.superior_contacts) ? data.superior_contacts.join('\n') : '',
        });
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMessage(err.error || 'Không thể tải trạng thái Gmail.');
      }
    } catch {
      setErrorMessage('Lỗi mạng khi kiểm tra trạng thái Gmail.');
    } finally {
      setLoadingStatus(false);
    }
  }, [authHeaders]);

  // 2. Tải danh sách digests
  const fetchDigests = useCallback(async () => {
    if (!status?.connected) return;
    setLoadingDigests(true);
    try {
      const params = new URLSearchParams();
      if (currentTab !== 'all') params.set('tab', currentTab);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const url = `/api/gmail/digests/?${params.toString()}`;
      const res = await fetch(url, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setDigests(Array.isArray(data.results) ? data.results : []);
        if (data.counts) {
          setDigestsCounts(data.counts);
        }
      }
    } catch {
      // Ignored network hiccups for background lists
    } finally {
      setLoadingDigests(false);
    }
  }, [authHeaders, status?.connected, currentTab, statusFilter, searchQuery]);

  // 3. Tải điểm tin sáng
  const fetchMorningDigest = useCallback(async () => {
    if (!status?.connected) return;
    setLoadingMorning(true);
    try {
      const res = await fetch('/api/gmail/digests/morning/', { headers: authHeaders });
      if (res.ok) {
        const data: MorningDigestResponse = await res.json();
        setMorningDigest(data);
      }
    } catch {
      // Quiet fail
    } finally {
      setLoadingMorning(false);
    }
  }, [authHeaders, status?.connected]);

  // Khởi tạo và kiểm tra query params (OAuth callback từ Google)
  useEffect(() => {
    if (!idToken) return;

    const searchParams = new URLSearchParams(window.location.search);

    // 1. Google trả về lỗi ủy quyền (ví dụ: error=access_denied)
    const googleError = searchParams.get('error');
    if (googleError) {
      window.history.replaceState({}, document.title, window.location.pathname);
      if (googleError === 'access_denied') {
        setOauthErrorMessage('Bạn đã từ chối cấp quyền truy cập Gmail hoặc phiên ủy quyền đã bị hủy.');
      } else {
        setOauthErrorMessage(`Google từ chối ủy quyền: ${decodeURIComponent(googleError)}`);
      }
      void fetchStatus();
      return;
    }

    // 2. Google redirect về kèm mã xác thực code + state
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    if (code && state) {
      if (processedCodesRef.current.has(code)) {
        return;
      }
      processedCodesRef.current.add(code);
      setCompletingOAuth(true);
      setOauthErrorMessage(null);

      const savedRedirectUri =
        sessionStorage.getItem('gmail_oauth_redirect_uri') ||
        `${window.location.origin}${window.location.pathname}`;
      sessionStorage.removeItem('gmail_oauth_redirect_uri');

      // TUYỆT ĐỐI không in code, state hoặc token vào log/console!
      // Xóa ngay các tham số truy vấn khỏi URL để bảo mật và chống gọi lặp lại khi reload
      window.history.replaceState({}, document.title, window.location.pathname);

      void (async () => {
        try {
          const res = await fetch('/api/gmail/oauth/callback/', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              code,
              state,
              redirect_uri: savedRedirectUri,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            showToast(data.email ? `Kết nối Gmail thành công (${data.email})!` : 'Kết nối Gmail thành công!');
            setOauthErrorMessage(null);
          } else {
            const err = await res.json().catch(() => ({}));
            setOauthErrorMessage(err.error || 'Không thể hoàn tất kết nối Gmail. Vui lòng thử lại.');
          }
        } catch {
          setOauthErrorMessage('Lỗi mạng khi hoàn tất kết nối Gmail. Vui lòng thử lại.');
        } finally {
          setCompletingOAuth(false);
          void fetchStatus();
        }
      })();
      return;
    }

    // 3. Fallback tham số query connected
    if (searchParams.get('connected') === '1') {
      showToast('Kết nối Gmail thành công!');
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    void fetchStatus();
  }, [idToken, authHeaders, fetchStatus, showToast]);

  // Khi status đổi thành connected -> load digests & morning
  useEffect(() => {
    if (status?.connected) {
      void fetchDigests();
      void fetchMorningDigest();
    }
  }, [status?.connected, fetchDigests, fetchMorningDigest]);

  // Bắt đầu OAuth flow
  const handleStartOAuth = async () => {
    try {
      setErrorMessage(null);
      setOauthErrorMessage(null);
      const res = await fetch('/api/gmail/oauth/authorize-url/', { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        if (data.authorize_url) {
          if (data.redirect_uri) {
            sessionStorage.setItem('gmail_oauth_redirect_uri', data.redirect_uri);
          }
          window.location.href = data.authorize_url;
        } else {
          setOauthErrorMessage('Không nhận được đường dẫn xác thực từ máy chủ.');
        }
      } else {
        const err = await res.json().catch(() => ({}));
        setOauthErrorMessage(err.error || 'Không thể khởi động kết nối Gmail.');
      }
    } catch {
      setOauthErrorMessage('Lỗi mạng khi kết nối Gmail.');
    }
  };

  // Đồng bộ ngay (Sync now)
  const handleSyncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/gmail/sync/', {
        method: 'POST',
        headers: authHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        showToast(data.message || 'Đồng bộ thư hoàn tất.');
        void fetchStatus();
        void fetchDigests();
        void fetchMorningDigest();
      } else {
        const err = await res.json().catch(() => ({}));
        await appDialog.alert(err.error || 'Đồng bộ thư thất bại.', { tone: 'warning' });
      }
    } catch {
      await appDialog.alert('Lỗi mạng khi đồng bộ thư.', { tone: 'danger' });
    } finally {
      setSyncing(false);
    }
  };

  // Cập nhật trạng thái thư (Đã xử lý / Bỏ qua)
  const handleUpdateDigestStatus = async (digestId: number, nextStatus: 'new' | 'replied' | 'ignored') => {
    try {
      const res = await fetch(`/api/gmail/digests/${digestId}/status/`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        setDigests(prev => prev.map(d => (d.id === digestId ? { ...d, status: nextStatus } : d)));
        if (selectedDigest?.id === digestId) {
          setSelectedDigest(prev => (prev ? { ...prev, status: nextStatus } : null));
        }
        showToast('Đã cập nhật trạng thái thư.');
      }
    } catch {
      await appDialog.alert('Không thể cập nhật trạng thái thư.', { tone: 'danger' });
    }
  };

  // Mở modal Thêm vào lịch công tác
  const handleOpenScheduleModal = (digest: MailDigestItem, actionIdx?: number) => {
    setScheduleModalDigest(digest);

    // Ngày mặc định: hôm nay
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate()
    ).padStart(2, '0')}`;

    let initialTitle = '';
    let initialDesc = `Nguồn: Email "${digest.subject}" từ ${digest.sender}`;
    let initialPrio: 'low' | 'medium' | 'high' = 'medium';
    let initialActionIdx: number | null = null;
    let warningText: string | null = null;

    if (typeof actionIdx === 'number' && digest.actions && digest.actions[actionIdx]) {
      const act = getActionObject(digest.actions[actionIdx]);
      initialActionIdx = actionIdx;

      // Tiêu đề ngắn gọn dạng động từ
      const cleanTitle = act.title.trim();
      if (
        cleanTitle.startsWith('Chuẩn bị') ||
        cleanTitle.startsWith('Phản hồi') ||
        cleanTitle.startsWith('Sửa') ||
        cleanTitle.startsWith('Gửi') ||
        cleanTitle.startsWith('Tham gia') ||
        cleanTitle.startsWith('Soạn') ||
        cleanTitle.startsWith('Liên hệ')
      ) {
        initialTitle = cleanTitle;
      } else {
        const badge = getActionTypeBadge(act.type);
        initialTitle = `${badge.label}: ${cleanTitle}`;
      }

      if (act.deadline) {
        initialDesc += `\nThời hạn: ${act.deadline}`;
      }
      if (act.required_preparations && act.required_preparations.length > 0) {
        initialDesc += `\nTài liệu cần chuẩn bị: ${act.required_preparations.join(', ')}`;
      }

      const prioStr = String(act.priority || '').toLowerCase();
      if (prioStr === 'high') initialPrio = 'high';
      else if (prioStr === 'low') initialPrio = 'low';

      // Kiểm tra xem đầu việc này đã từng được đưa vào lịch chưa
      const existing = (digest.schedule_items || []).find(si => si.action_index === actionIdx);
      if (existing) {
        const parts = existing.work_date.split('-');
        const dateDisplay = parts.length === 3 ? `${parts[2]}/${parts[1]}` : existing.work_date;
        warningText = `Đầu việc này đã từng được thêm vào Lịch công tác ngày ${dateDisplay}. Bạn vẫn có thể tạo thêm nếu muốn.`;
      }
    } else {
      // Mở chung từ email
      initialTitle = `Phản hồi email: ${digest.subject}`;
      if (digest.reply_by) {
        initialDesc += `\nHạn phản hồi: ${digest.reply_by}`;
      }
      if (digest.summary) {
        initialDesc += `\nTóm tắt nội dung: ${digest.summary}`;
      }

      const pUpper = String(digest.priority || '').toUpperCase();
      if (pUpper === 'HIGH' || pUpper === 'URGENT') initialPrio = 'high';
      else if (pUpper === 'LOW') initialPrio = 'low';

      if (digest.schedule_items && digest.schedule_items.length > 0) {
        const dates = digest.schedule_items.map(s => {
          const parts = s.work_date.split('-');
          return parts.length === 3 ? `${parts[2]}/${parts[1]}` : s.work_date;
        });
        warningText = `Thư này đã có ${digest.schedule_items.length} việc được đưa vào Lịch (${dates.join(', ')}).`;
      }
    }

    setAlreadyScheduledWarning(warningText);
    setScheduleForm({
      title: initialTitle,
      work_date: todayStr,
      start_time: '',
      end_time: '',
      priority: initialPrio,
      description: initialDesc,
      action_index: initialActionIdx,
    });
    setScheduleModalOpen(true);
  };

  // Xác nhận tạo việc vào Lịch công tác
  const handleConfirmAddToSchedule = async () => {
    if (!scheduleModalDigest) return;
    if (!scheduleForm.title.trim()) {
      await appDialog.alert('Vui lòng nhập tiêu đề công việc.', { tone: 'warning' });
      return;
    }
    if (!scheduleForm.work_date) {
      await appDialog.alert('Vui lòng chọn ngày thực hiện.', { tone: 'warning' });
      return;
    }

    setSavingSchedule(true);
    try {
      const res = await fetch(`/api/gmail/digests/${scheduleModalDigest.id}/add-to-schedule/`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          title: scheduleForm.title.trim(),
          work_date: scheduleForm.work_date,
          start_time: scheduleForm.start_time || undefined,
          end_time: scheduleForm.end_time || undefined,
          priority: scheduleForm.priority,
          description: scheduleForm.description.trim(),
          action_index: scheduleForm.action_index,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        showToast(data.message || 'Đã thêm công việc vào Lịch công tác thành công!');
        // Cập nhật lại schedule_items và actions của digest trong local state
        setDigests(prev =>
          prev.map(d => {
            if (d.id === scheduleModalDigest.id) {
              const updatedActions = d.actions.map((act, idx) => {
                if (idx === scheduleForm.action_index) {
                  const actObj = getActionObject(act);
                  return { ...actObj, completed: true };
                }
                return act;
              });
              return {
                ...d,
                schedule_items: data.schedule_items,
                actions: updatedActions,
              };
            }
            return d;
          })
        );
        setScheduleModalOpen(false);
      } else {
        const err = await res.json().catch(() => ({}));
        await appDialog.alert(err.error || 'Không thể thêm việc vào lịch công tác.', { tone: 'warning' });
      }
    } catch {
      await appDialog.alert('Lỗi mạng khi tạo việc vào lịch công tác.', { tone: 'danger' });
    } finally {
      setSavingSchedule(false);
    }
  };

  // Mở modal soạn phản hồi AI
  const handleOpenReplyModal = (digest: MailDigestItem) => {
    setSelectedDigest(digest);
    setReplyInstructions('');
    setDraftContent('');
    setDraftSavedSuccess(false);

    // Kiểm tra xem người gửi có trong danh sách cấp trên không
    let isSuperior = false;
    if (status?.superior_contacts && status.superior_contacts.length > 0) {
      const senderLower = (digest.sender || '').toLowerCase();
      const senderEmailLower = (digest.sender_email || '').toLowerCase();
      for (const sc of status.superior_contacts) {
        const clean = sc.trim().toLowerCase();
        if (clean && (senderLower.includes(clean) || senderEmailLower.includes(clean))) {
          isSuperior = true;
          break;
        }
      }
    }
    setReplyIsSuperior(isSuperior);
    setReplyModalOpen(true);
  };

  // Yêu cầu AI soạn phản hồi
  const handleGenerateAiReply = async () => {
    if (!selectedDigest) return;
    setGeneratingDraft(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/gmail/digests/${selectedDigest.id}/draft-reply/`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          guidance: replyInstructions.trim(),
          is_superior: replyIsSuperior,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const jobId = data.job_id;
        if (!jobId) {
          throw new Error('Không nhận được mã tiến trình AI.');
        }

        // Poll job kết quả
        let attempts = 0;
        let finished = false;
        while (attempts < 20 && !finished) {
          await new Promise(r => setTimeout(r, 600));
          attempts++;
          const jobRes = await fetch(`/api/gmail/jobs/${jobId}/`, { headers: authHeaders });
          if (jobRes.ok) {
            const jobData = await jobRes.json();
            if (jobData.status === 'done' || jobData.status === 'COMPLETED') {
              finished = true;
              const result = jobData.result || {};
              const reply = result.reply_body || result.draft || (typeof result === 'string' ? result : '');
              setDraftContent(reply);
              showToast('AI đã soạn thảo xong bản nháp!');
              break;
            } else if (jobData.status === 'failed' || jobData.status === 'FAILED') {
              throw new Error(jobData.error_message || 'AI gặp lỗi khi soạn phản hồi.');
            }
          }
        }
        if (!finished) {
          throw new Error('AI xử lý quá thời gian chờ, vui lòng thử lại.');
        }
      } else {
        const err = await res.json().catch(() => ({}));
        await appDialog.alert(err.error || 'Không thể tạo bản nháp với AI.', { tone: 'warning' });
      }
    } catch (err: any) {
      await appDialog.alert(err.message || 'Lỗi kết nối khi gửi yêu cầu AI.', { tone: 'danger' });
    } finally {
      setGeneratingDraft(false);
    }
  };

  // Toggle hoàn thành 1 đầu việc trong checklist
  const handleToggleAction = async (digestId: number, actionIndex: number, currentCompleted: boolean) => {
    setTogglingAction({ digestId, actionIndex });
    try {
      const res = await fetch(`/api/gmail/digests/${digestId}/toggle-action/`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ action_index: actionIndex, completed: !currentCompleted }),
      });
      if (res.ok) {
        const data = await res.json();
        setDigests(prev => prev.map(d => (d.id === digestId ? { ...d, actions: data.actions } : d)));
        if (selectedDigest?.id === digestId) {
          setSelectedDigest(prev => (prev ? { ...prev, actions: data.actions } : null));
        }
      }
    } catch {
      await appDialog.alert('Không thể cập nhật trạng thái việc cần làm.', { tone: 'danger' });
    } finally {
      setTogglingAction(null);
    }
  };

  // Phân tích thư bằng AI thủ công khi chưa có tóm tắt
  const handleAnalyzeDigest = async (digestId: number) => {
    setAnalyzingDigestId(digestId);
    try {
      const res = await fetch(`/api/gmail/digests/${digestId}/analyze/`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        const jobId = data.job_id;
        if (jobId) {
          let attempts = 0;
          let finished = false;
          while (attempts < 20 && !finished) {
            await new Promise(r => setTimeout(r, 800));
            attempts++;
            const jobRes = await fetch(`/api/gmail/jobs/${jobId}/`, { headers: authHeaders });
            if (jobRes.ok) {
              const jobData = await jobRes.json();
              if (jobData.status === 'done' || jobData.status === 'COMPLETED') {
                finished = true;
                showToast('Đã phân tích xong nội dung thư!');
                void fetchDigests();
                break;
              } else if (jobData.status === 'failed' || jobData.status === 'FAILED') {
                finished = true;
                await appDialog.alert(jobData.error_message || 'Phân tích thư thất bại.', { tone: 'warning' });
                break;
              }
            }
          }
        }
      } else {
        const err = await res.json().catch(() => ({}));
        await appDialog.alert(err.error || 'Không thể yêu cầu phân tích thư.', { tone: 'warning' });
      }
    } catch {
      await appDialog.alert('Lỗi mạng khi phân tích thư.', { tone: 'danger' });
    } finally {
      setAnalyzingDigestId(null);
    }
  };

  // Lưu bản nháp vào Gmail
  const handleSaveDraftToGmail = async () => {
    if (!selectedDigest || !draftContent.trim()) {
      await appDialog.alert('Vui lòng nhập nội dung bản nháp trước khi lưu.', { tone: 'info' });
      return;
    }
    setSavingDraft(true);
    try {
      const res = await fetch('/api/gmail/drafts/create/', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          thread_id: selectedDigest.thread_id,
          to_email: selectedDigest.sender,
          subject: selectedDigest.subject.startsWith('Re:') ? selectedDigest.subject : `Re: ${selectedDigest.subject}`,
          body_text: draftContent.trim(),
          digest_id: selectedDigest.id,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setDraftSavedSuccess(true);
        // Tự động cập nhật trạng thái sang replied
        void handleUpdateDigestStatus(selectedDigest.id, 'replied');
        showToast(data.message || 'Đã lưu bản nháp vào Gmail thành công!');
      } else {
        const err = await res.json().catch(() => ({}));
        await appDialog.alert(err.error || 'Không thể lưu bản nháp vào Gmail.', { tone: 'warning' });
      }
    } catch {
      await appDialog.alert('Lỗi mạng khi lưu bản nháp.', { tone: 'danger' });
    } finally {
      setSavingDraft(false);
    }
  };

  // Lưu cài đặt
  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const superiorList = settingsForm.superior_contacts_text
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);

      const res = await fetch('/api/gmail/settings/', {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          ai_enabled: settingsForm.ai_enabled,
          notify_new: settingsForm.notify_new,
          morning_scan_enabled: settingsForm.morning_scan_enabled,
          morning_time: settingsForm.morning_time,
          superior_contacts: superiorList,
        }),
      });
      if (res.ok) {
        showToast('Đã lưu cấu hình Hộp thư AI!');
        setSettingsOpen(false);
        void fetchStatus();
      } else {
        const err = await res.json().catch(() => ({}));
        await appDialog.alert(err.error || 'Không thể lưu cấu hình.', { tone: 'warning' });
      }
    } catch {
      await appDialog.alert('Lỗi mạng khi lưu cấu hình.', { tone: 'danger' });
    } finally {
      setSavingSettings(false);
    }
  };

  // Helper chuẩn hóa ActionItem
  const getActionObject = (act: ActionItem | string): ActionItem => {
    if (typeof act === 'string') {
      return {
        type: 'khac',
        title: act,
        deadline: '',
        required_preparations: [],
        priority: 'normal',
        completed: false,
      };
    }
    return act;
  };

  // Helper lấy badge theo phân loại việc
  const getActionTypeBadge = (type: string) => {
    const t = (type || 'khac').toLowerCase().replace('/', '_');
    switch (t) {
      case 'gui_file_bao_cao':
        return {
          label: 'Gửi file / Báo cáo',
          bg: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
        };
      case 'phan_hoi_xac_nhan':
        return {
          label: 'Phản hồi xác nhận',
          bg: 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
        };
      case 'tong_hop_thong_tin':
        return {
          label: 'Tổng hợp tin',
          bg: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
        };
      case 'bo_sung_tai_lieu':
        return {
          label: 'Bổ sung tài liệu',
          bg: 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
        };
      case 'sua_tai_lieu':
        return {
          label: 'Sửa tài liệu',
          bg: 'bg-cyan-50 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800',
        };
      case 'tham_du_lich_hop':
        return {
          label: 'Lịch họp/sự kiện',
          bg: 'bg-violet-50 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800',
        };
      case 'phe_duyet':
        return {
          label: 'Phê duyệt',
          bg: 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800',
        };
      default:
        return {
          label: 'Công việc',
          bg: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
        };
    }
  };

  // Ngắt kết nối & Xóa dữ liệu
  const handleDisconnect = async () => {
    const confirmed = await appDialog.confirm(
      'Bạn có chắc chắn muốn ngắt kết nối Gmail và XÓA TOÀN BỘ dữ liệu tóm tắt email trên FT Workspace?\n\nThao tác này sẽ thu hồi quyền truy cập tại Google và không thể khôi phục.',
      {
        title: 'Xác nhận ngắt kết nối',
        tone: 'danger',
        confirmText: 'Đồng ý ngắt & xóa dữ liệu',
        cancelText: 'Hủy bỏ',
      }
    );
    if (!confirmed) return;

    setDisconnecting(true);
    try {
      const res = await fetch('/api/gmail/disconnect/', {
        method: 'POST',
        headers: authHeaders,
      });
      if (res.ok) {
        setSettingsOpen(false);
        showToast('Đã ngắt kết nối và xóa toàn bộ dữ liệu Gmail.');
        void fetchStatus();
        setDigests([]);
        setMorningDigest(null);
      } else {
        const err = await res.json().catch(() => ({}));
        await appDialog.alert(err.error || 'Không thể ngắt kết nối.', { tone: 'warning' });
      }
    } catch {
      await appDialog.alert('Lỗi mạng khi ngắt kết nối.', { tone: 'danger' });
    } finally {
      setDisconnecting(false);
    }
  };

  // Mở thread trong Gmail
  const openGmailThread = (threadId: string) => {
    const url = `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(threadId)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Helper hiển thị độ ưu tiên
  const renderPriorityBadge = (priority: MailDigestItem['priority']) => {
    const p = String(priority || '').toUpperCase();
    switch (p) {
      case 'URGENT':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 dark:bg-rose-950/60 px-2.5 py-0.5 text-xs font-bold text-rose-700 dark:text-rose-300">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
            Khẩn cấp
          </span>
        );
      case 'HIGH':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950/60 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-300">
            Quan trọng
          </span>
        );
      case 'NORMAL':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-950/60 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
            Bình thường
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-400">
            Thấp
          </span>
        );
    }
  };

  return (
    <div className="ft-module-shell flex min-h-dvh flex-col bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100 transition-colors">
      <ModuleShellHeader
        title="Bộ công cụ FermatTech"
        items={COMMUNICATION_TOOLS_NAV}
        activeId="gmail-assistant"
        onSelect={id => onNavSelect(id)}
        ariaLabel="Điều hướng bộ công cụ FermatTech"
        actions={
          <div className="flex items-center gap-2">
            {status?.connected && (
              <>
                <button
                  type="button"
                  onClick={handleSyncNow}
                  disabled={syncing}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-xs cursor-pointer min-h-[44px] transition disabled:opacity-60"
                  title="Đồng bộ thư ngay"
                >
                  <RefreshCw className={`h-4 w-4 text-blue-600 dark:text-blue-400 ${syncing ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">{syncing ? 'Đang đồng bộ...' : 'Đồng bộ thư'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-xs cursor-pointer min-h-[44px] transition"
                  title="Cài đặt Hộp thư AI"
                >
                  <Settings className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                  <span className="hidden sm:inline">Cài đặt</span>
                </button>
              </>
            )}
          </div>
        }
      />

      <main className="min-w-0 flex-1">
        <div className="ft-module-content mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
          {/* Toast thông báo */}
          {successToast && (
            <div className="mb-4 flex items-center justify-between rounded-2xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800 p-4 text-sm text-emerald-800 dark:text-emerald-200 shadow-sm animate-in fade-in duration-200">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="font-medium">{successToast}</span>
              </div>
              <button
                type="button"
                onClick={() => setSuccessToast(null)}
                className="text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-200 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Lỗi thông báo */}
          {errorMessage && (
            <div className="mb-4 flex items-center justify-between rounded-2xl bg-rose-50 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-800 p-4 text-sm text-rose-800 dark:text-rose-200 shadow-sm animate-in fade-in duration-200">
              <div className="flex items-center gap-2.5">
                <AlertCircle className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0" />
                <span className="font-medium">{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-rose-600 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-200 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Lỗi xác thực OAuth từ Google hoặc Callback */}
          {oauthErrorMessage && (
            <div className="mb-6 rounded-2xl bg-rose-50 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-800 p-4 sm:p-5 text-rose-900 dark:text-rose-100 shadow-sm animate-in fade-in duration-200">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-bold text-rose-900 dark:text-rose-100">
                      Không thể hoàn tất kết nối Gmail
                    </h4>
                    <p className="mt-0.5 text-xs text-rose-700 dark:text-rose-300">
                      {oauthErrorMessage}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setOauthErrorMessage(null);
                      void handleStartOAuth();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 px-3.5 py-2 text-xs font-bold text-white shadow-xs cursor-pointer transition min-h-[38px]"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Thử lại kết nối</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setOauthErrorMessage(null)}
                    className="p-1.5 rounded-lg text-rose-600 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-200 cursor-pointer"
                    title="Đóng thông báo"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Trạng thái OAuth: Đang hoàn tất kết nối */}
          {completingOAuth ? (
            <div className="mx-auto max-w-xl rounded-3xl border border-indigo-200 dark:border-indigo-800/80 bg-white dark:bg-slate-900 p-8 sm:p-12 text-center shadow-sm my-8">
              <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                <RefreshCw className="h-8 w-8 animate-spin" />
              </div>
              <h3 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
                Đang hoàn tất kết nối…
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Hệ thống đang trao đổi mã ủy quyền với Google và mã hóa khóa bảo mật cho tài khoản của bạn. Vui lòng chờ trong giây lát.
              </p>
            </div>
          ) : loadingStatus ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <RefreshCw className="h-8 w-8 text-blue-600 animate-spin" />
              <p className="mt-4 text-sm font-medium text-slate-500 dark:text-slate-400">
                Đang kiểm tra kết nối Hộp thư AI...
              </p>
            </div>
          ) : !status?.is_configured ? (
            /* Trạng thái 2: Chưa cấu hình OAuth trên Server */
            <div className="rounded-3xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/40 p-6 sm:p-8 text-amber-900 dark:text-amber-200">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl bg-amber-100 dark:bg-amber-900/60 p-3 text-amber-600 dark:text-amber-400 shrink-0">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-amber-950 dark:text-amber-100">
                    Chưa cấu hình Google OAuth Client
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-amber-800/90 dark:text-amber-300/90">
                    Máy chủ hệ thống chưa được thiết lập các biến môi trường cần thiết để kết nối với Google OAuth (
                    <code className="rounded bg-amber-200/60 dark:bg-amber-900/60 px-1.5 py-0.5 text-xs font-mono">
                      GMAIL_OAUTH_CLIENT_ID
                    </code>
                    ,{' '}
                    <code className="rounded bg-amber-200/60 dark:bg-amber-900/60 px-1.5 py-0.5 text-xs font-mono">
                      GMAIL_OAUTH_CLIENT_SECRET
                    </code>
                    ,{' '}
                    <code className="rounded bg-amber-200/60 dark:bg-amber-900/60 px-1.5 py-0.5 text-xs font-mono">
                      GMAIL_TOKEN_KEY
                    </code>
                    ).
                  </p>
                  <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
                    Vui lòng liên hệ Quản trị viên để cấu hình trước khi sử dụng tính năng này.
                  </p>
                </div>
              </div>
            </div>
          ) : !status.connected ? (
            /* Trạng thái 3: Chưa kết nối Gmail */
            <div className="mx-auto max-w-3xl">
              <div className="overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
                <div className="bg-gradient-to-br from-blue-700 via-indigo-700 to-indigo-800 p-8 text-white sm:p-10">
                  <div className="flex items-center gap-3">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/20 backdrop-blur-xs">
                      <Mail className="h-6 w-6 text-white" />
                    </span>
                    <div>
                      <span className="rounded-full bg-blue-500/30 px-3 py-1 text-xs font-bold uppercase tracking-wider text-blue-100">
                        FermatTech Assistant
                      </span>
                      <h2 className="mt-1 text-2xl font-black sm:text-3xl">Hộp thư AI (Gmail)</h2>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-blue-100 sm:text-base">
                    Trợ lý tự động tóm tắt email quan trọng, nhắc nhở thư tồn đọng chưa phản hồi trong tuần và hỗ trợ soạn
                    thảo phản hồi nhanh chóng dưới dạng bản nháp trên Gmail của bạn.
                  </p>
                </div>

                <div className="p-6 sm:p-10 space-y-6">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      Tính năng nổi bật
                    </h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-4">
                        <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200 text-sm">
                          <Sun className="h-4 w-4 text-amber-500" />
                          <span>Điểm tin sáng mỗi ngày</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                          Tự động rà soát thư trong tuần chưa phản hồi và thư mới trong 24h qua vào khung giờ bạn chọn.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-4">
                        <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200 text-sm">
                          <Sparkles className="h-4 w-4 text-indigo-500" />
                          <span>Tóm tắt & Lập việc cần làm</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                          AI phân tích ngắn gọn 3-5 dòng, gợi ý việc cần làm và hạn phản hồi không để sót việc.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-4">
                        <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200 text-sm">
                          <Send className="h-4 w-4 text-blue-500" />
                          <span>Soạn phản hồi & Lưu Nháp</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                          Soạn thư nháp theo ngữ cảnh lịch sự và lưu thẳng vào thư mục Thư nháp (Drafts) trên Gmail.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-4">
                        <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200 text-sm">
                          <FileText className="h-4 w-4 text-emerald-500" />
                          <span>Ghi chú Báo cáo tuần</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                          Đưa tóm tắt công việc trực tiếp vào phần ghi chú Báo cáo cuối tuần chỉ với 1 cú nhấp chuột.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Hộp cam kết bảo mật */}
                  <div className="rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/40 p-5 text-sm">
                    <div className="flex items-center gap-2 font-bold text-blue-900 dark:text-blue-200">
                      <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      <span>Cam kết Bảo mật & Quyền riêng tư tuyệt đối</span>
                    </div>
                    <ul className="mt-2.5 space-y-1.5 text-xs leading-relaxed text-blue-900/90 dark:text-blue-300/90 list-disc list-inside">
                      <li>
                        <strong>Tuyệt đối không tự ý gửi thư</strong>: Hệ thống chỉ xin quyền tạo bản nháp (
                        <code className="font-mono">gmail.compose</code>). Quyền gửi thư hoàn toàn do bạn quyết định tại
                        Gmail.
                      </li>
                      <li>
                        <strong>Không lưu trữ thân thư gốc</strong>: Thân thư chỉ được đọc trong bộ nhớ để AI tóm tắt,
                        sau đó hủy ngay.
                      </li>
                      <li>
                        <strong>AI mặc định TẮT</strong>: Bạn hoàn toàn chủ động bật hoặc tắt tính năng AI theo nhu cầu.
                      </li>
                      <li>
                        <strong>Ngắt kết nối bất cứ lúc nào</strong>: Nút ngắt kết nối sẽ thu hồi quyền tại Google và
                        xóa toàn bộ tóm tắt.
                      </li>
                      <li>
                        Chỉ hỗ trợ tài khoản email công ty kết thúc bằng <strong>{allowedDomainsDisplay}</strong> hoặc trùng khớp với
                        tài khoản của bạn.
                      </li>
                    </ul>
                  </div>

                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={handleStartOAuth}
                      className="inline-flex w-full sm:w-auto items-center justify-center gap-2.5 rounded-2xl bg-blue-600 px-7 py-3.5 text-sm font-extrabold text-white shadow-md hover:bg-blue-700 active:scale-95 transition cursor-pointer"
                    >
                      <Mail className="h-5 w-5" />
                      <span>Kết nối Gmail của bạn</span>
                    </button>
                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                      Chuyển hướng an toàn đến trang xác thực OAuth 2.0 chính thức của Google
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Trạng thái 4: Đã kết nối Gmail */
            <div className="space-y-6">
              {/* Header card trạng thái */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-xs">
                <div className="flex items-center gap-3.5">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 shrink-0">
                    <Mail className="h-6 w-6" />
                  </span>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                        {status.email}
                      </span>
                      <span className="rounded-full bg-emerald-100 dark:bg-emerald-950/70 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                        Đã kết nối
                      </span>
                      {status.ai_enabled ? (
                        <span className="rounded-full bg-indigo-100 dark:bg-indigo-950/70 px-2.5 py-0.5 text-xs font-bold text-indigo-700 dark:text-indigo-300">
                          AI: BẬT
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-400">
                          AI: TẮT
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Đồng bộ gần nhất:{' '}
                      {status.last_sync_at
                        ? new Date(status.last_sync_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
                        : 'Chưa đồng bộ'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={handleSyncNow}
                    disabled={syncing}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-xs cursor-pointer min-h-[40px] transition disabled:opacity-60"
                  >
                    <RefreshCw className={`h-4 w-4 text-blue-600 dark:text-blue-400 ${syncing ? 'animate-spin' : ''}`} />
                    <span>{syncing ? 'Đang đồng bộ...' : 'Đồng bộ'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-xs cursor-pointer min-h-[40px] transition"
                  >
                    <Settings className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                    <span>Cài đặt</span>
                  </button>
                </div>
              </div>

              {/* Thẻ Buổi Sáng (Morning Digest Card) */}
              {morningDigest && (
                <div className="overflow-hidden rounded-3xl border border-amber-200/80 dark:border-amber-900/60 bg-gradient-to-r from-amber-50/80 via-amber-50/40 to-orange-50/60 dark:from-amber-950/30 dark:via-slate-900 dark:to-orange-950/20 shadow-xs transition">
                  <div className="p-5 sm:p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-400">
                          <Sun className="h-5 w-5" />
                        </span>
                        <div>
                          <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                            Điểm tin buổi sáng
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Tổng hợp thư trong tuần chưa phản hồi & thư mới nhận
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setMorningExpanded(prev => !prev)}
                        className="rounded-xl px-2.5 py-1 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                      >
                        {morningExpanded ? 'Thu gọn' : 'Xem chi tiết'}
                      </button>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 sm:max-w-md">
                      <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-white dark:bg-slate-900 p-3.5 shadow-xs">
                        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                          Chưa phản hồi trong tuần
                        </span>
                        <div className="mt-1 text-2xl font-black text-amber-600 dark:text-amber-400">
                          {morningDigest.unreplied_count}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-white dark:bg-slate-900 p-3.5 shadow-xs">
                        <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                          Mới nhận 24h qua
                        </span>
                        <div className="mt-1 text-2xl font-black text-blue-600 dark:text-blue-400">
                          {morningDigest.recent_count}
                        </div>
                      </div>
                    </div>

                    {morningExpanded && morningDigest.unreplied_threads.length > 0 && (
                      <div className="mt-5 border-t border-amber-200/60 dark:border-amber-900/40 pt-4">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                          Danh sách thư cần phản hồi gấp:
                        </h4>
                        <div className="mt-2.5 divide-y divide-amber-100 dark:divide-slate-800 rounded-2xl border border-amber-200/60 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80">
                          {morningDigest.unreplied_threads.slice(0, 5).map(th => (
                            <div
                              key={th.thread_id}
                              className="flex items-center justify-between p-3 text-xs transition hover:bg-amber-50/50 dark:hover:bg-slate-800/50"
                            >
                              <div className="min-w-0 pr-3">
                                <p className="font-bold text-slate-800 dark:text-slate-200 truncate">{th.subject}</p>
                                <p className="text-slate-500 dark:text-slate-400 truncate">{th.sender}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => openGmailThread(th.thread_id)}
                                className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline shrink-0 font-medium cursor-pointer"
                              >
                                <span>Mở Gmail</span>
                                <ExternalLink className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Danh sách Thư & Bộ lọc */}
              <div className="space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  {/* Tabs */}
                  <div className="flex items-center gap-1 overflow-x-auto rounded-2xl bg-slate-200/60 dark:bg-slate-800 p-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setCurrentTab('all')}
                      className={`rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                        currentTab === 'all'
                          ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      <span>Tất cả</span>
                      {digestsCounts.all > 0 && (
                        <span className="rounded-full bg-slate-200 dark:bg-slate-700 px-1.5 py-0.2 text-[10px] font-bold text-slate-700 dark:text-slate-300">
                          {digestsCounts.all}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentTab('needs_reply')}
                      className={`rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                        currentTab === 'needs_reply'
                          ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      <span>Cần phản hồi</span>
                      {digestsCounts.needs_reply > 0 ? (
                        <span className="rounded-full bg-rose-500 px-1.5 py-0.2 text-[10px] font-extrabold text-white">
                          {digestsCounts.needs_reply}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentTab('cc')}
                      className={`rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                        currentTab === 'cc'
                          ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      <span>Chỉ để biết (CC)</span>
                      {digestsCounts.cc > 0 && (
                        <span className="rounded-full bg-slate-200 dark:bg-slate-700 px-1.5 py-0.2 text-[10px] font-bold text-slate-700 dark:text-slate-300">
                          {digestsCounts.cc}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentTab('today')}
                      className={`rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                        currentTab === 'today'
                          ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      <span>Mới hôm nay</span>
                      {digestsCounts.today > 0 && (
                        <span className="rounded-full bg-slate-200 dark:bg-slate-700 px-1.5 py-0.2 text-[10px] font-bold text-slate-700 dark:text-slate-300">
                          {digestsCounts.today}
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Bộ lọc trạng thái & Search box */}
                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                    {/* Status filter dropdown */}
                    <div className="flex items-center gap-1 rounded-2xl bg-slate-100 dark:bg-slate-800 p-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setStatusFilter('all')}
                        className={`rounded-xl px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                          statusFilter === 'all'
                            ? 'bg-white dark:bg-slate-900 font-bold text-slate-900 dark:text-slate-100 shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                      >
                        Tất cả
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusFilter('unhandled')}
                        className={`rounded-xl px-2.5 py-1 text-xs font-medium transition cursor-pointer flex items-center gap-1 ${
                          statusFilter === 'unhandled'
                            ? 'bg-white dark:bg-slate-900 font-bold text-blue-600 dark:text-blue-400 shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                      >
                        <span>Chưa xử lý</span>
                        {digestsCounts.unhandled > 0 && (
                          <span className="text-[10px] opacity-75">({digestsCounts.unhandled})</span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusFilter('handled')}
                        className={`rounded-xl px-2.5 py-1 text-xs font-medium transition cursor-pointer flex items-center gap-1 ${
                          statusFilter === 'handled'
                            ? 'bg-white dark:bg-slate-900 font-bold text-emerald-600 dark:text-emerald-400 shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                      >
                        <span>Đã xử lý</span>
                        {digestsCounts.handled > 0 && (
                          <span className="text-[10px] opacity-75">({digestsCounts.handled})</span>
                        )}
                      </button>
                    </div>

                    {/* Search box */}
                    <div className="relative w-full sm:w-60">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Tìm theo chủ đề, người gửi..."
                        className="w-full rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-blue-500 focus:outline-hidden"
                      />
                    </div>
                  </div>
                </div>

                {/* Danh sách items */}
                {loadingDigests ? (
                  <div className="py-16 text-center">
                    <RefreshCw className="mx-auto h-6 w-6 text-blue-600 animate-spin" />
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Đang tải danh sách thư...</p>
                  </div>
                ) : digests.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 p-12 text-center">
                    <Inbox className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
                    <h4 className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-300">
                      Chưa có thư nào trong mục này
                    </h4>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Hãy nhấn nút &ldquo;Đồng bộ thư&rdquo; để hệ thống cập nhật các thư mới nhất từ Gmail của bạn.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-3.5">
                    {digests.map(item => (
                      <div
                        key={item.id}
                        className={`rounded-3xl border transition shadow-xs ${
                          item.status === 'replied'
                            ? 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 opacity-75'
                            : item.status === 'ignored'
                            ? 'border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/20 opacity-60'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-800'
                        } p-4 sm:p-5`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            {/* Badges bar */}
                            <div className="flex items-center gap-1.5 flex-wrap mb-2">
                              {renderPriorityBadge(item.priority)}

                              {/* Vai trò người nhận */}
                              {item.recipient_role === 'to' && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                                  <Inbox className="h-3 w-3" />
                                  <span>Gửi trực tiếp (To)</span>
                                </span>
                              )}
                              {item.recipient_role === 'cc' && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-400">
                                  <span>Chỉ để biết (CC)</span>
                                </span>
                              )}

                              {/* Gọi tên người dùng */}
                              {item.addressed_by_name && (
                                <span
                                  className="inline-flex items-center gap-1 rounded-full bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 px-2.5 py-0.5 text-xs font-bold text-purple-700 dark:text-purple-300"
                                  title={item.match_reason || 'Được gọi tên trực tiếp trong thư'}
                                >
                                  <span>Gọi tên trong thư</span>
                                </span>
                              )}

                              {item.needs_reply && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900 px-2.5 py-0.5 text-xs font-bold text-red-600 dark:text-red-400">
                                  Cần phản hồi
                                </span>
                              )}

                              {item.reply_by && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-600 dark:text-slate-400">
                                  <Clock className="h-3 w-3" />
                                  <span>Hạn: {item.reply_by}</span>
                                </span>
                              )}

                              {item.status === 'replied' && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                  <Check className="h-3 w-3" />
                                  Đã phản hồi
                                </span>
                              )}
                              {item.status === 'ignored' && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-500">
                                  Đã bỏ qua
                                </span>
                              )}

                              {/* Đã thêm vào lịch công tác */}
                              {Array.isArray(item.schedule_items) && item.schedule_items.length > 0 && (
                                <span
                                  className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
                                  title={item.schedule_items.map(s => `${s.title} (${s.work_date})`).join('\n')}
                                >
                                  <Calendar className="h-3 w-3" />
                                  <span>
                                    Đã thêm lịch (
                                    {item.schedule_items
                                      .map(s => {
                                        const parts = s.work_date.split('-');
                                        return parts.length === 3 ? `${parts[2]}/${parts[1]}` : s.work_date;
                                      })
                                      .join(', ')}
                                    )
                                  </span>
                                </span>
                              )}
                            </div>

                            {/* Tiêu đề & Người gửi */}
                            <h4 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                              {item.subject || '(Không có tiêu đề)'}
                            </h4>
                            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                              Từ: <span className="font-semibold text-slate-700 dark:text-slate-300">{item.sender}</span>{' '}
                              • {new Date(item.received_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
                            </p>

                            {/* Tóm tắt nội dung */}
                            {item.summary && item.summary.trim() ? (
                              <p className="mt-2.5 text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
                                {item.summary}
                              </p>
                            ) : status?.ai_enabled ? (
                              <div className="mt-2.5 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
                                  <Sparkles className="h-4 w-4 shrink-0 text-amber-600" />
                                  <span>Thư này chưa được AI tóm tắt nội dung.</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleAnalyzeDigest(item.id)}
                                  disabled={analyzingDigestId === item.id}
                                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 px-3 py-1.5 text-xs font-bold text-white shadow-xs cursor-pointer disabled:opacity-60 shrink-0 self-start sm:self-auto"
                                >
                                  <Sparkles className={`h-3.5 w-3.5 ${analyzingDigestId === item.id ? 'animate-spin' : ''}`} />
                                  <span>{analyzingDigestId === item.id ? 'Đang phân tích...' : 'Phân tích thư này'}</span>
                                </button>
                              </div>
                            ) : (
                              <div className="mt-2.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                                  <Settings className="h-4 w-4 shrink-0 text-slate-500" />
                                  <span>Tính năng AI tóm tắt đang tắt. Bật AI trong Cài đặt để có tóm tắt.</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setSettingsOpen(true)}
                                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 shadow-xs cursor-pointer shrink-0 self-start sm:self-auto"
                                >
                                  <Settings className="h-3.5 w-3.5" />
                                  <span>Mở Cài đặt</span>
                                </button>
                              </div>
                            )}

                            {/* Việc cần làm (Checklist) + Cần chuẩn bị */}
                            {Array.isArray(item.actions) && item.actions.length > 0 && (
                              <div className="mt-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 p-3.5 space-y-2.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                                    <Layers className="h-3.5 w-3.5 text-blue-600" />
                                    <span>Việc cần làm ({item.actions.length}):</span>
                                  </span>
                                  <span className="text-[11px] text-slate-400">Đánh dấu khi hoàn thành</span>
                                </div>
                                <div className="space-y-2">
                                  {item.actions.map((rawAct, idx) => {
                                    const act = getActionObject(rawAct);
                                    const badge = getActionTypeBadge(act.type);
                                    const isToggling =
                                      togglingAction?.digestId === item.id && togglingAction.actionIndex === idx;
                                    const isItemScheduled = (item.schedule_items || []).some(
                                      si => si.action_index === idx
                                    );
                                    return (
                                      <div
                                        key={idx}
                                        className={`rounded-xl border p-2.5 transition text-xs ${
                                          act.completed
                                            ? 'border-emerald-200/60 dark:border-emerald-900/40 bg-emerald-50/30 dark:bg-emerald-950/20 opacity-70'
                                            : 'border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-xs'
                                        }`}
                                      >
                                        <div className="flex items-start gap-2.5">
                                          <input
                                            type="checkbox"
                                            checked={!!act.completed}
                                            disabled={isToggling}
                                            onChange={() => handleToggleAction(item.id, idx, !!act.completed)}
                                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
                                          />
                                          <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                              <div className="flex items-center gap-1.5 flex-wrap">
                                                <span
                                                  className={`inline-flex items-center rounded-md border px-1.5 py-0.2 text-[10px] font-bold ${badge.bg}`}
                                                >
                                                  {badge.label}
                                                </span>
                                                {act.deadline && (
                                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                                                    <Clock className="h-3 w-3" />
                                                    <span>Hạn: {act.deadline}</span>
                                                  </span>
                                                )}
                                                {isItemScheduled && (
                                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                                    <Check className="h-3 w-3" />
                                                    <span>Đã có trên lịch</span>
                                                  </span>
                                                )}
                                              </div>

                                              <button
                                                type="button"
                                                onClick={() => handleOpenScheduleModal(item, idx)}
                                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer transition shrink-0"
                                                title="Thêm đầu việc này vào Lịch công tác"
                                              >
                                                <Calendar className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                                                <span>Lịch</span>
                                              </button>
                                            </div>

                                            <p
                                              className={`mt-1 font-medium leading-relaxed ${
                                                act.completed
                                                  ? 'line-through text-slate-400 dark:text-slate-500'
                                                  : 'text-slate-800 dark:text-slate-200'
                                              }`}
                                            >
                                              {act.title}
                                            </p>
                                            {Array.isArray(act.required_preparations) &&
                                              act.required_preparations.length > 0 && (
                                                <div className="mt-1.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 px-2.5 py-1.5 text-[11px] text-slate-600 dark:text-slate-400">
                                                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                                                    Cần chuẩn bị:{' '}
                                                  </span>
                                                  {act.required_preparations.join(', ')}
                                                </div>
                                              )}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Quick action buttons */}
                          <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0 border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-100 dark:border-slate-800">
                            <button
                              type="button"
                              onClick={() => handleOpenReplyModal(item)}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 shadow-xs transition cursor-pointer min-h-[38px]"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              <span>Soạn phản hồi</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleOpenScheduleModal(item)}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-xs transition cursor-pointer min-h-[38px]"
                              title="Thêm công việc vào Lịch công tác"
                            >
                              <Calendar className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                              <span className="hidden sm:inline">Vào lịch</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => openGmailThread(item.thread_id)}
                              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                              title="Mở thư trong Gmail"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              <span>Gmail</span>
                            </button>

                            {/* Status toggles */}
                            <div className="flex items-center gap-1 text-[11px] text-slate-500">
                              {item.status !== 'replied' && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateDigestStatus(item.id, 'replied')}
                                  className="hover:underline cursor-pointer"
                                >
                                  Đã xử lý
                                </button>
                              )}
                              {item.status !== 'ignored' && (
                                <>
                                  {item.status !== 'replied' && <span>•</span>}
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateDigestStatus(item.id, 'ignored')}
                                    className="hover:underline cursor-pointer"
                                  >
                                    Bỏ qua
                                  </button>
                                </>
                              )}
                              {item.status !== 'new' && (
                                <>
                                  <span>•</span>
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateDigestStatus(item.id, 'new')}
                                    className="hover:underline cursor-pointer"
                                  >
                                    Đánh dấu mới
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* MODAL 1: Soạn phản hồi AI & Lưu vào Nháp Gmail */}
      {replyModalOpen && selectedDigest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                    Soạn phản hồi thư với AI
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-md">
                    Trả lời: {selectedDigest.subject}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReplyModalOpen(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Thông tin thư gốc & Tóm tắt */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-4 text-xs space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-2 border-b border-slate-200/60 dark:border-slate-700/60">
                  <span className="text-slate-500">Người gửi:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{selectedDigest.sender}</span>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-slate-500">Tóm tắt nội dung:</span>
                    {(!selectedDigest.summary || !selectedDigest.summary.trim()) && (
                      <button
                        type="button"
                        onClick={() => handleAnalyzeDigest(selectedDigest.id)}
                        disabled={analyzingDigestId === selectedDigest.id}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 hover:underline cursor-pointer"
                      >
                        <Sparkles className="h-3 w-3" />
                        <span>{analyzingDigestId === selectedDigest.id ? 'Đang phân tích...' : 'Phân tích thư này'}</span>
                      </button>
                    )}
                  </div>
                  {selectedDigest.summary && selectedDigest.summary.trim() ? (
                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line bg-white/70 dark:bg-slate-900/60 p-2.5 rounded-xl border border-slate-200/50 dark:border-slate-800">
                      {selectedDigest.summary}
                    </p>
                  ) : status?.ai_enabled ? (
                    <div className="text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 p-2.5 rounded-xl border border-amber-200 dark:border-amber-900/60 flex items-center justify-between gap-2">
                      <span>Thư này chưa được tóm tắt. Nhấn nút &ldquo;Phân tích thư này&rdquo; để AI xử lý.</span>
                    </div>
                  ) : (
                    <div className="text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 p-2.5 rounded-xl flex items-center justify-between gap-2">
                      <span>AI tóm tắt đang tắt. Bật trong Cài đặt để có tóm tắt.</span>
                      <button
                        type="button"
                        onClick={() => {
                          setReplyModalOpen(false);
                          setSettingsOpen(true);
                        }}
                        className="font-bold text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Mở Cài đặt
                      </button>
                    </div>
                  )}
                </div>

                {/* Danh sách việc cần làm & Cần chuẩn bị trong modal */}
                {Array.isArray(selectedDigest.actions) && selectedDigest.actions.length > 0 && (
                  <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 space-y-1.5">
                    <span className="font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1">
                      <Layers className="h-3.5 w-3.5 text-blue-600" />
                      <span>Các đầu việc cần xác nhận & chuẩn bị:</span>
                    </span>
                    <div className="space-y-1.5">
                      {selectedDigest.actions.map((rawAct, idx) => {
                        const act = getActionObject(rawAct);
                        const badge = getActionTypeBadge(act.type);
                        return (
                          <div
                            key={idx}
                            className="rounded-xl bg-white/80 dark:bg-slate-900/70 p-2 border border-slate-200/60 dark:border-slate-800 text-[11px]"
                          >
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`rounded-md border px-1.5 py-0.2 text-[9px] font-bold ${badge.bg}`}>
                                {badge.label}
                              </span>
                              <span className="font-medium text-slate-800 dark:text-slate-200">{act.title}</span>
                              {act.deadline && (
                                <span className="text-rose-600 font-semibold">(Hạn: {act.deadline})</span>
                              )}
                            </div>
                            {Array.isArray(act.required_preparations) && act.required_preparations.length > 0 && (
                              <p className="mt-1 text-slate-500 dark:text-slate-400">
                                <span className="font-semibold text-slate-600 dark:text-slate-300">File/tài liệu: </span>
                                {act.required_preparations.join(', ')}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Tùy chọn xưng hô cấp trên */}
              <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/30 p-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <label htmlFor="chk-superior" className="text-xs font-bold text-indigo-900 dark:text-indigo-200 cursor-pointer block">
                    Xưng hô với cấp trên / lãnh đạo (xưng &ldquo;em&rdquo;, dạ thưa lễ phép)
                  </label>
                  <p className="text-[11px] text-indigo-700/80 dark:text-indigo-300/80 mt-0.5">
                    Tự động áp dụng giọng nhân viên báo cáo sếp, không nhân danh công ty. Ký tên cá nhân của bạn.
                  </p>
                </div>
                <input
                  id="chk-superior"
                  type="checkbox"
                  checked={replyIsSuperior}
                  onChange={e => setReplyIsSuperior(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0"
                />
              </div>

              {/* Ô hướng dẫn cho AI */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Hướng dẫn cho AI (Tùy chọn - giọng điệu, ý chính cần trả lời):
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={replyInstructions}
                    onChange={e => setReplyInstructions(e.target.value)}
                    placeholder="VD: Xác nhận sẽ gửi báo cáo trước 17h thứ Tư..."
                    className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-blue-500 focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={handleGenerateAiReply}
                    disabled={generatingDraft}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 shadow-xs transition cursor-pointer disabled:opacity-60 shrink-0"
                  >
                    <Sparkles className={`h-3.5 w-3.5 ${generatingDraft ? 'animate-spin' : ''}`} />
                    <span>{generatingDraft ? 'Đang viết...' : 'AI Soạn'}</span>
                  </button>
                </div>
              </div>

              {/* Nội dung phản hồi */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Nội dung thư phản hồi (Bạn có thể tự do chỉnh sửa):
                  </label>
                  {draftSavedSuccess && (
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <Check className="h-3.5 w-3.5" />
                      Đã lưu vào Nháp Gmail
                    </span>
                  )}
                </div>
                <textarea
                  rows={8}
                  value={draftContent}
                  onChange={e => setDraftContent(e.target.value)}
                  placeholder="Nhấn nút 'AI Soạn' ở trên hoặc tự gõ nội dung thư phản hồi vào đây..."
                  className="w-full rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-3.5 text-xs sm:text-sm text-slate-900 dark:text-slate-100 font-sans leading-relaxed focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              {/* CẢNH BÁO BẮT BUỘC: Chưa gửi, chỉ lưu nháp */}
              <div className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3.5 text-amber-900 dark:text-amber-200">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs leading-relaxed">
                    <strong>Chưa gửi.</strong> Khi nhấn &ldquo;Lưu vào Nháp Gmail&rdquo;, thư chỉ được lưu vào mục{' '}
                    <strong>Thư nháp (Drafts)</strong> trên hòm thư Gmail của bạn. Bạn hãy mở Gmail, kiểm tra lại lần
                    cuối và nhấn nút Gửi.
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-6 py-4">
              <button
                type="button"
                onClick={() => openGmailThread(selectedDigest.thread_id)}
                className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer"
              >
                <span>Mở trong Gmail</span>
                <ExternalLink className="h-3 w-3" />
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setReplyModalOpen(false)}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={handleSaveDraftToGmail}
                  disabled={savingDraft || !draftContent.trim()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-blue-700 disabled:opacity-50 cursor-pointer transition"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{savingDraft ? 'Đang lưu...' : 'Lưu vào Nháp Gmail'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Cài đặt Hộp thư AI */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  <Settings className="h-4 w-4" />
                </span>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                  Cài đặt Hộp thư AI
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Switch AI Enabled */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    Bật tính năng AI tóm tắt & phân tích
                  </h4>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Mặc định tắt. Khi bật, AI sẽ tự động đọc và tóm tắt nội dung các thư quan trọng gửi đến.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settingsForm.ai_enabled}
                  onChange={e => setSettingsForm(prev => ({ ...prev, ai_enabled: e.target.checked }))}
                  className="h-5 w-5 rounded-md border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
                />
              </div>

              {/* Switch Notify New */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    Thông báo thư mới đến
                  </h4>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Gửi thông báo gộp trong FT Workspace khi có email mới cần phản hồi.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settingsForm.notify_new}
                  onChange={e => setSettingsForm(prev => ({ ...prev, notify_new: e.target.checked }))}
                  className="h-5 w-5 rounded-md border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
                />
              </div>

              {/* Quét sáng & Giờ */}
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      Quét điểm tin buổi sáng
                    </h4>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      Tự động rà soát thư tồn đọng trong tuần chưa phản hồi vào mỗi buổi sáng.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settingsForm.morning_scan_enabled}
                    onChange={e => setSettingsForm(prev => ({ ...prev, morning_scan_enabled: e.target.checked }))}
                    className="h-5 w-5 rounded-md border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
                  />
                </div>

                {settingsForm.morning_scan_enabled && (
                  <div className="flex items-center justify-between pl-2">
                    <span className="text-xs text-slate-600 dark:text-slate-400">Khung giờ quét buổi sáng:</span>
                    <input
                      type="time"
                      value={settingsForm.morning_time}
                      onChange={e => setSettingsForm(prev => ({ ...prev, morning_time: e.target.value }))}
                      className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100"
                    />
                  </div>
                )}
              </div>

              {/* Danh sách cấp trên / người cần xưng em */}
              <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                  Cấp trên / người cần xưng em (Tùy chọn)
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Nhập danh sách tên hoặc email cấp trên (mỗi dòng một người). Khi nhận thư từ các địa chỉ hoặc tên này, AI sẽ tự động xưng &ldquo;em&rdquo;, dạ thưa lễ phép với tư cách nhân viên cấp dưới và không nhân danh công ty.
                </p>
                <textarea
                  rows={3}
                  value={settingsForm.superior_contacts_text}
                  onChange={e => setSettingsForm(prev => ({ ...prev, superior_contacts_text: e.target.value }))}
                  placeholder="Ví dụ:&#10;sep@fermat.vn&#10;Nguyễn Văn A"
                  className="w-full rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              {/* Danger Zone */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                <div className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/30 p-4">
                  <h4 className="text-xs font-bold text-rose-800 dark:text-rose-300">
                    Khu vực nguy hiểm
                  </h4>
                  <p className="mt-1 text-xs text-rose-700/90 dark:text-rose-400/90 leading-relaxed">
                    Ngắt kết nối sẽ thu hồi quyền truy cập tại Google và xóa sạch toàn bộ bản tóm tắt email trên FT
                    Workspace.
                  </p>
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-rose-700 disabled:opacity-60 cursor-pointer transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{disconnecting ? 'Đang ngắt kết nối...' : 'Ngắt kết nối & Xóa dữ liệu'}</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-6 py-4">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="rounded-xl bg-blue-600 px-5 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-blue-700 disabled:opacity-60 cursor-pointer transition"
              >
                {savingSettings ? 'Đang lưu...' : 'Lưu cấu hình'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Thêm việc vào Lịch công tác với Bản xem trước */}
      {scheduleModalOpen && scheduleModalDigest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400">
                  <Calendar className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                    Thêm việc vào Lịch công tác
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-xs sm:max-w-md">
                    Thư: {scheduleModalDigest.subject}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setScheduleModalOpen(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              {/* Cảnh báo nếu việc đã từng được thêm */}
              {alreadyScheduledWarning && (
                <div className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-amber-900 dark:text-amber-200 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{alreadyScheduledWarning}</span>
                </div>
              )}

              {/* 1. Chọn ngày và thời gian */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-1">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Ngày thực hiện <span className="text-rose-500">*</span>:
                  </label>
                  <input
                    type="date"
                    value={scheduleForm.work_date}
                    onChange={e => setScheduleForm(prev => ({ ...prev, work_date: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Bắt đầu (tùy chọn):
                  </label>
                  <input
                    type="time"
                    value={scheduleForm.start_time}
                    onChange={e => setScheduleForm(prev => ({ ...prev, start_time: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Kết thúc (tùy chọn):
                  </label>
                  <input
                    type="time"
                    value={scheduleForm.end_time}
                    onChange={e => setScheduleForm(prev => ({ ...prev, end_time: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* 2. Tiêu đề công việc (dạng động từ) */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Tiêu đề công việc trên Lịch <span className="text-rose-500">*</span>:
                </label>
                <input
                  type="text"
                  value={scheduleForm.title}
                  onChange={e => setScheduleForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Ví dụ: Chuẩn bị file báo cáo tuần, Phản hồi email đối tác..."
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              {/* 3. Mức ưu tiên */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Mức độ ưu tiên:
                </label>
                <select
                  value={scheduleForm.priority}
                  onChange={e =>
                    setScheduleForm(prev => ({ ...prev, priority: e.target.value as 'low' | 'medium' | 'high' }))
                  }
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-hidden"
                >
                  <option value="low">Thấp</option>
                  <option value="medium">Vừa (Bình thường)</option>
                  <option value="high">Cao (Quan trọng / Gấp)</option>
                </select>
              </div>

              {/* 4. Mô tả chi tiết */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Mô tả & Ghi chú thực hiện:
                </label>
                <textarea
                  rows={4}
                  value={scheduleForm.description}
                  onChange={e => setScheduleForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Nêu rõ người gửi, thời hạn, các file/tài liệu cần chuẩn bị..."
                  className="w-full rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-blue-500 focus:outline-hidden leading-relaxed"
                />
              </div>

              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/40 p-3 text-slate-500 text-[11px] leading-relaxed">
                ℹ️ Công việc sẽ được tạo trực tiếp vào <strong>Lịch công tác</strong> cá nhân của bạn với trạng thái &ldquo;Cần làm&rdquo; và nhãn &ldquo;Công việc&rdquo;.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-6 py-4">
              <button
                type="button"
                onClick={() => setScheduleModalOpen(false)}
                className="rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleConfirmAddToSchedule}
                disabled={savingSchedule || !scheduleForm.title.trim() || !scheduleForm.work_date}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-blue-700 disabled:opacity-60 cursor-pointer transition"
              >
                <Calendar className="h-3.5 w-3.5" />
                <span>{savingSchedule ? 'Đang tạo...' : 'Xác nhận tạo việc'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
