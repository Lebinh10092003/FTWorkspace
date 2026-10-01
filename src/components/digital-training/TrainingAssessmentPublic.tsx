import React, { useEffect, useMemo, useRef, useState } from "react";
import QuestionEditor from "./AssessmentQuestionEditor";
import { appDialog } from "../AppDialog";
import {
  AlertCircle,
  Bookmark,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileUp,
  GripVertical,
  Link2,
  Loader2,
  ListChecks,
  PlayCircle,
  Save,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";

type PublicQuestion = {
  id: string;
  question_code?: string;
  order: number;
  type: "single_choice" | "multiple_choice" | "short_answer" | "matching" | "ordering" | "practical_submission" | "file_upload";
  knowledge_type?: string;
  text: string;
  options?: Array<{ key: string; text: string; match_text?: string }>;
  points: number;
  required: boolean;
  image_url?: string;
  media_url?: string;
  media_file_id?: string;
  media_type?: string;
  category?: string;
  difficulty?: string;
  correct_answers?: string[];
};

type AnswerValue = string | string[] | Record<string, string>;

const hasQuestionAnswer = (question: PublicQuestion, value?: AnswerValue) => {
  if (question.type === "matching") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const selected = Object.values(value).filter((item) => String(item || "").trim());
    return selected.length === (question.options || []).length;
  }
  if (question.type === "ordering") {
    return typeof value === "string"
      && value.split("-").filter(Boolean).length === (question.options || []).length;
  }
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => String(item || "").trim());
  }
  return Boolean(String(value || "").trim());
};

const apiError = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  return body.error || Object.values(body)[0] || "Không thể xử lý yêu cầu.";
};

const formatCountdown = (seconds: number) => {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return [hours, minutes, rest]
    .filter((_, index) => index > 0 || hours > 0)
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
};

const mediaPreview = (source = "", mediaFileId = "", mediaType = "") => {
  const value = source.trim();
  const iframeSource = value.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, "") || "";
  const playable = iframeSource || value;
  const youtube = playable.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/i);
  if (youtube) return { kind: "video", url: `https://www.youtube.com/embed/${youtube[1]}` };
  if (/^https?:\/\/.+\.(?:mp4|webm|ogg)(?:\?.*)?$/i.test(playable)) return { kind: "video", url: playable };
  // ``media_file_id`` is stored when the source workbook contains a Drive
  // link. It stays usable even when the original link shape changes.
  const driveId = mediaFileId.trim() || value.match(/(?:\/d\/|[?&]id=)([a-zA-Z0-9_-]+)/)?.[1] || "";
  if (driveId && /video|phim|clip/i.test(mediaType || value)) return {
    kind: "drive-video",
    url: `https://drive.google.com/file/d/${driveId}/preview`,
    openUrl: value || `https://drive.google.com/open?id=${driveId}`,
  };
  if (driveId) return {
    kind: "drive",
    url: value || `https://drive.google.com/open?id=${driveId}`,
    imageUrl: `https://drive.google.com/thumbnail?id=${driveId}&sz=w1600`,
    fallbackImageUrl: `https://drive.google.com/uc?export=view&id=${driveId}`,
  };
  if (/^https?:\/\/.+\.(?:png|jpe?g|gif|webp)(?:\?.*)?$/i.test(value)) return { kind: "image", url: value };
  return value.startsWith("http") ? { kind: "link", url: value } : null;
};

const isImageUploadQuestion = (question?: PublicQuestion) => question?.type === "file_upload";

export default function TrainingAssessmentPublic({ slug, idToken = "" }: { slug: string; idToken?: string }) {
  const previewRole = new URLSearchParams(window.location.search).get("preview");
  const isPreview = previewRole === "creator" || previewRole === "respondent";
  const isCreatorPreview = previewRole === "creator";
  const previewVariant = new URLSearchParams(window.location.search).get("variant") || "";
  const [editingQuestion, setEditingQuestion] = useState<PublicQuestion | null>(null);
  const [originalQuestion, setOriginalQuestion] = useState<PublicQuestion | null>(null);
  const [assessment, setAssessment] = useState<any>(null);
  const [attempt, setAttempt] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [identity, setIdentity] = useState({
    respondent_name: "",
    email: "",
    phone: "",
    organization: "",
    position: "",
    participant_code: "",
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saveState, setSaveState] = useState("Đã lưu");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reviewedIds, setReviewedIds] = useState<string[]>([]);
  const [reviewMode, setReviewMode] = useState(false);
  const [previousAttemptToken, setPreviousAttemptToken] = useState("");
  const [unfinishedAttempt, setUnfinishedAttempt] = useState<any>(null);
  const [expandedImageUrl, setExpandedImageUrl] = useState("");
  const [mediaLoadError, setMediaLoadError] = useState(false);
  const [mediaUseFallback, setMediaUseFallback] = useState(false);
  const [matchingPick, setMatchingPick] = useState<{ questionId: string; rightKey: string } | null>(null);
  const submittingRef = useRef(false);
  const hydratingAttemptRef = useRef(false);
  const storageKey = `ft-training-assessment:${slug}`;

  const restoreAttempt = (body: any) => {
    // State populated while opening/resuming an attempt is already persisted.
    hydratingAttemptRef.current = true;
    setAttempt(body);
    setAssessment(body.assessment);
    setAnswers(body.answers || {});
    const reviewed = Array.isArray(body.progress?.reviewed_question_ids) ? body.progress.reviewed_question_ids : [];
    setReviewedIds(reviewed);
    const questionIndex = (body.questions || []).findIndex((item: PublicQuestion) => item.id === body.progress?.current_question_id);
    setCurrentIndex(questionIndex >= 0 ? questionIndex : 0);
  };

  const savePreviewQuestion = async () => {
    if (!isCreatorPreview || !editingQuestion || !originalQuestion || !idToken) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/digital-training/assessment-previews/${slug}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ original: originalQuestion, question: editingQuestion }),
      });
      if (!response.ok) throw new Error(await apiError(response));
      const body = await response.json();
      setAttempt((current: any) => ({ ...current, questions: current.questions.map((q: PublicQuestion) => q.id === body.question.id ? body.question : q) }));
      setEditingQuestion(null); setOriginalQuestion(null); setMessage("Đã lưu câu hỏi.");
    } catch (error: any) { setMessage(String(error.message || error)); } finally { setBusy(false); }
  };

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      if (isPreview) {
        if (!idToken) throw new Error("Hãy đăng nhập bằng tài khoản quản trị để xem trước bài kiểm tra.");
        const response = await fetch(`/api/digital-training/assessment-previews/${slug}?role=${previewRole}&variant=${encodeURIComponent(previewVariant)}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!response.ok) throw new Error(await apiError(response));
        const body = await response.json();
        setAssessment(body.assessment);
        setAttempt({ status: "in_progress", questions: body.questions || [], variant: body.variant, preview_variants: body.variants || [] });
        setSecondsLeft(Number(body.assessment?.duration_minutes || 120) * 60);
        setSaveState("Chế độ demo — không lưu dữ liệu");
        return;
      }
      const savedToken = localStorage.getItem(storageKey);
      if (savedToken) {
        const response = await fetch(`/api/training-assessment-attempts/${savedToken}`);
        if (response.ok) {
          const body = await response.json();
          if (body.status === "in_progress") {
            setAssessment(body.assessment);
            setUnfinishedAttempt(body);
          } else {
            restoreAttempt(body);
          }
          return;
        }
        localStorage.removeItem(storageKey);
      }
      const response = await fetch(`/api/training-assessments/${slug}`);
      if (!response.ok) throw new Error(await apiError(response));
      setAssessment(await response.json());
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [slug, idToken, isPreview, previewRole, previewVariant]);

  const save = async (submit = false) => {
    if (isPreview) {
      setSaveState("Chế độ demo — không lưu hoặc nộp bài");
      return;
    }
    if (!attempt?.access_token || attempt.status !== "in_progress") return;
    if (submit && submittingRef.current) return;
    if (submit) submittingRef.current = true;
    setSaveState(submit ? "Đang nộp bài..." : "Đang lưu...");
    try {
      const response = await fetch(
        `/api/training-assessment-attempts/${attempt.access_token}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answers,
            submit,
            progress: {
              current_question_id: attempt.questions?.[currentIndex]?.id || "",
              reviewed_question_ids: reviewedIds,
            },
          }),
        },
      );
      if (!response.ok) throw new Error(await apiError(response));
      const body = await response.json();
      setAttempt(body);
      if (submit) setAnswers(body.answers || answers);
      setSaveState(submit ? "Đã nộp bài" : "Đã lưu");
      if (body.status !== "in_progress") localStorage.setItem(storageKey, body.access_token);
    } catch (error: any) {
      setMessage(String(error?.message || error));
      setSaveState("Chưa lưu được");
    } finally {
      if (submit) submittingRef.current = false;
    }
  };

  useEffect(() => {
    if (isPreview) return;
    if (!attempt?.expires_at || attempt.status !== "in_progress") return;
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.ceil((new Date(attempt.expires_at).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
      if (remaining === 0 && !submittingRef.current) void save(true);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [attempt?.expires_at, attempt?.status, answers, isPreview]);

  // Re-sync timer when tab regains focus (fix browser background throttling)
  useEffect(() => {
    if (isPreview) return;
    if (!attempt?.expires_at || attempt.status !== "in_progress") return;
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const remaining = Math.max(
        0,
        Math.ceil((new Date(attempt.expires_at).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
      if (remaining === 0 && !submittingRef.current) void save(true);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [attempt?.expires_at, attempt?.status, isPreview]);

  useEffect(() => {
    if (isPreview) return;
    if (!attempt?.access_token || attempt.status !== "in_progress") return;
    if (hydratingAttemptRef.current) {
      hydratingAttemptRef.current = false;
      return;
    }
    setSaveState("Có thay đổi chưa lưu");
    const timer = window.setTimeout(() => void save(false), 900);
    return () => window.clearTimeout(timer);
  }, [answers, currentIndex, reviewedIds, isPreview]);

  useEffect(() => {
    if (isPreview) return;
    if (!attempt?.access_token || attempt.status !== "in_progress") return;
    const persistBeforeLeaving = () => {
      void fetch('/api/training-assessment-attempts/' + attempt.access_token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          answers,
          progress: {
            current_question_id: attempt.questions?.[currentIndex]?.id || "",
            reviewed_question_ids: reviewedIds,
          },
        }),
      });
    };
    window.addEventListener("pagehide", persistBeforeLeaving);
    return () => window.removeEventListener("pagehide", persistBeforeLeaving);
  }, [attempt?.access_token, attempt?.status, answers, currentIndex, reviewedIds, isPreview]);

  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const begin = (replacePrevious = false) => fetch(`/api/training-assessments/${slug}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...identity, previous_attempt_token: previousAttemptToken, replace_previous: replacePrevious }),
      });
      let response = await begin();
      if (response.status === 409) {
        const prior = await response.json();
        if (prior.code === "unfinished_attempt") {
          setUnfinishedAttempt(prior.attempt);
          return;
        }
        if (prior.code === "retake_confirmation_required") {
          const points = prior.manual_grading_required
            ? `điểm phần chấm tự động ${Number(prior.previous_auto_score || 0).toLocaleString("vi-VN")}/${Number(prior.previous_auto_max_score || 0).toLocaleString("vi-VN")}; phần thực hành đang chờ chấm`
            : `điểm ${Number(prior.previous_score || 0).toLocaleString("vi-VN")}/${Number(prior.previous_max_score || 0).toLocaleString("vi-VN")}`;
          const confirmed = await appDialog.confirm(
            `Người này đã có bài thi với ${points}. Nếu làm lại, câu trả lời và điểm cũ sẽ bị xóa. Anh/chị có xác nhận làm lại không?`,
            { title: "Xác nhận làm lại bài", confirmText: "Xóa điểm cũ và làm lại", tone: "danger" },
          );
          if (!confirmed) return;
          response = await begin(true);
        } else {
          throw new Error(prior.error || "Không thể bắt đầu lượt làm mới.");
        }
      }
      if (!response.ok) throw new Error(await apiError(response));
      const body = await response.json();
      localStorage.setItem(storageKey, body.access_token);
      restoreAttempt(body);
      setPreviousAttemptToken("");
      if (body.resumed) {
        void appDialog.alert("Hệ thống đã tìm thấy bài đang làm theo đúng họ tên và thông tin liên hệ. Câu trả lời và thời gian còn lại đã được khôi phục.", { title: "Đã khôi phục bài làm", tone: "success" });
      }
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const startFreshFromUnfinished = async () => {
    if (!unfinishedAttempt) return;
    const confirmed = await appDialog.confirm(
      "Lượt đang làm và mọi câu trả lời đã lưu sẽ bị xóa. Hệ thống sẽ tạo lượt mới với mã và thời gian làm bài mới. Anh/chị có xác nhận không?",
      { title: "Tạo lượt làm mới", confirmText: "Xóa lượt cũ và tạo lượt mới", tone: "danger" },
    );
    if (!confirmed) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/training-assessments/${slug}/start`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          respondent_name: unfinishedAttempt.respondent_name,
          email: unfinishedAttempt.email,
          phone: unfinishedAttempt.phone,
          organization: unfinishedAttempt.organization,
          position: unfinishedAttempt.position,
          participant_code: unfinishedAttempt.participant_code,
          previous_attempt_token: unfinishedAttempt.access_token,
          start_new: true,
        }),
      });
      if (!response.ok) throw new Error(await apiError(response));
      const body = await response.json();
      localStorage.setItem(storageKey, body.access_token);
      setUnfinishedAttempt(null);
      restoreAttempt(body);
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (question: PublicQuestion, file?: File) => {
    if (isPreview) {
      setMessage("Chế độ xem trước không tải tệp hoặc gửi dữ liệu.");
      return;
    }
    if (!isImageUploadQuestion(question)) {
      setMessage("Chỉ câu hỏi có kiểu “Tải tệp ảnh” mới cho phép tải ảnh; câu này nhận link chia sẻ.");
      return;
    }
    if (!file || !attempt?.access_token) return;
    setBusy(true);
    setMessage("");
    const data = new FormData();
    data.append("question_id", question.id);
    data.append("file", file);
    try {
      const response = await fetch(
        `/api/training-assessment-attempts/${attempt.access_token}/upload`,
        { method: "POST", body: data },
      );
      if (!response.ok) throw new Error(await apiError(response));
      const body = await response.json();
      setAttempt((current: any) => ({ ...current, uploads: [...(current?.uploads || []), body] }));
      setAnswers((current) => {
        const existing = current[question.id];
        const practical = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : { link: typeof existing === "string" ? existing : "" };
        const ids = String(practical.upload_ids || practical.upload_id || "").split(",").filter(Boolean);
        const urls = String(practical.upload_urls || practical.upload_url || "").split("\n").filter(Boolean);
        return { ...current, [question.id]: { ...practical, upload_id: String(body.id), upload_file_id: String(body.file_id || ""), upload_url: String(body.url || ""), upload_ids: [...ids, String(body.id)].join(","), upload_urls: [...urls, String(body.url || "")].join("\n") } };
      });
    } catch (error: any) {
      setMessage(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (question: PublicQuestion, files?: FileList | File[]) => {
    for (const file of Array.from(files || [])) await uploadFile(question, file);
  };

  const deleteUpload = async (question: PublicQuestion, uploadId: number) => {
    if (!attempt?.access_token || isPreview) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/training-assessment-attempts/${attempt.access_token}/uploads/${uploadId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await apiError(response));
      const remaining = (attempt.uploads || []).filter((item: any) => Number(item.id) !== Number(uploadId));
      setAttempt((current: any) => ({ ...current, uploads: (current?.uploads || []).filter((item: any) => Number(item.id) !== Number(uploadId)) }));
      setAnswers((current) => {
        const existing = current[question.id];
        const practical = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : { link: typeof existing === "string" ? existing : "" };
        const questionUploads = remaining.filter((item: any) => String(item.question_id) === String(question.id));
        const last = questionUploads.at(-1);
        return { ...current, [question.id]: { ...practical, upload_id: String(last?.id || ""), upload_file_id: String(last?.file_id || ""), upload_url: String(last?.url || ""), upload_ids: questionUploads.map((item: any) => item.id).join(","), upload_urls: questionUploads.map((item: any) => item.url).filter(Boolean).join("\n") } };
      });
    } catch (error: any) { setMessage(String(error?.message || error)); } finally { setBusy(false); }
  };

  const unansweredRequired = useMemo(
    () =>
      (attempt?.questions || []).filter(
        (question: PublicQuestion) =>
          question.required && !hasQuestionAnswer(question, answers[question.id]),
      ).length,
    [attempt?.questions, answers],
  );

  const questions: PublicQuestion[] = attempt?.questions || [];
  const currentQuestion = questions[currentIndex] || questions[0];
  const mediaReference = String(currentQuestion?.media_url || currentQuestion?.image_url || "").trim();
  const currentMedia = mediaPreview(mediaReference, String(currentQuestion?.media_file_id || ""), String(currentQuestion?.media_type || ""));
  const isImageSubmission = isImageUploadQuestion(currentQuestion);
  const currentQuestionUploads = (attempt?.uploads || []).filter((item: any) => String(item.question_id) === String(currentQuestion?.id));
  const setAnswer = (questionId: string, value: AnswerValue) => setAnswers((current) => ({ ...current, [questionId]: value }));
  useEffect(() => { setMediaLoadError(false); setMediaUseFallback(false); }, [currentQuestion?.id, mediaReference]);
  useEffect(() => {
    if (currentQuestion?.type !== "ordering" || answers[currentQuestion.id]) return;
    const initialOrder = (currentQuestion.options || []).map((item) => item.key).join("-");
    if (initialOrder) setAnswer(currentQuestion.id, initialOrder);
  }, [currentQuestion?.id, currentQuestion?.type]);
  const toggleMultiple = (questionId: string, key: string) => {
    const current = Array.isArray(answers[questionId]) ? answers[questionId] as string[] : [];
    setAnswer(questionId, current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };
  const moveOrdering = (question: PublicQuestion, from: number, direction: -1 | 1) => {
    const stored = typeof answers[question.id] === "string" ? String(answers[question.id]).split("-").filter(Boolean) : [];
    const order = stored.length === (question.options || []).length ? stored : (question.options || []).map((item) => item.key);
    const target = from + direction;
    if (target < 0 || target >= order.length) return;
    [order[from], order[target]] = [order[target], order[from]];
    setAnswer(question.id, order.join("-"));
  };
  const reorderOrdering = (question: PublicQuestion, draggedKey: string, targetIndex: number) => {
    const stored = typeof answers[question.id] === "string" ? String(answers[question.id]).split("-").filter(Boolean) : [];
    const order = stored.length === (question.options || []).length ? stored : (question.options || []).map((item) => item.key);
    const from = order.indexOf(draggedKey);
    if (from < 0 || targetIndex < 0 || targetIndex >= order.length) return;
    order.splice(targetIndex, 0, order.splice(from, 1)[0]);
    setAnswer(question.id, order.join("-"));
  };
  const setMatching = (questionId: string, leftKey: string, rightKey: string) => {
    const stored = answers[questionId];
    const current: Record<string, string> = stored && typeof stored === "object" && !Array.isArray(stored)
      ? { ...stored as Record<string, string> }
      : Object.fromEntries(String(stored || "").split(";").map((pair) => pair.split("-").map((item) => item.trim())).filter((pair) => pair.length === 2));
    Object.keys(current).forEach((key) => { if (current[key] === rightKey) delete current[key]; });
    if (rightKey) current[leftKey] = rightKey;
    else delete current[leftKey];
    setMatchingPick(null);
    setAnswer(questionId, current);
  };
  const toggleReview = (questionId: string) => setReviewedIds((current) => current.includes(questionId) ? current.filter((item) => item !== questionId) : [...current, questionId]);
  const isAnswered = (question: PublicQuestion) => hasQuestionAnswer(question, answers[question.id]);
  const answerSummary = (question: PublicQuestion) => {
    const value = answers[question.id];
    if (!isAnswered(question)) return "Chưa trả lời";
    if (question.type === "single_choice" || question.type === "multiple_choice") {
      const keys = Array.isArray(value) ? value : [String(value)];
      return keys.map((key) => question.options?.find((option) => option.key === key)?.text || key).join("; ");
    }
    if (question.type === "ordering") {
      return String(value).split("-").map((key) => question.options?.find((option) => option.key === key)?.text || key).join(" → ");
    }
    if (question.type === "matching" && value && typeof value === "object" && !Array.isArray(value)) {
      return Object.entries(value).map(([left, right]) => {
        const leftOption = question.options?.find((option) => option.key === left);
        const rightIndex = right.length === 1 ? right.toUpperCase().charCodeAt(0) - 65 : -1;
        const rightLabel = question.options?.[rightIndex]?.match_text;
        return (leftOption?.text || left) + " – " + (rightLabel || right);
      }).join("; ");
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return [value.link, value.upload_url ? "Tệp: " + value.upload_url : ""].filter(Boolean).join(" · ");
    }
    return String(value);
  };

  if (!loading && assessment && attempt && isCreatorPreview) {
    const previewQuestions: PublicQuestion[] = attempt.questions || [];
    const previewVariants: string[] = attempt.preview_variants || [];
    return <div lang="vi" translate="no" className="notranslate min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><main className="mx-auto max-w-5xl"><div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4"><div><p className="text-xs font-bold uppercase tracking-wide text-violet-700">Xem trước · Người tạo</p><h1 className="mt-1 text-xl font-extrabold">{assessment.title}</h1></div><a href={`/training-assessment/${slug}?preview=respondent&variant=${encodeURIComponent(attempt.variant || "")}`} className="ft-btn ft-btn-secondary">Xem như người trả lời</a></div><div className="mb-5 rounded-2xl border bg-white p-4"><label className="block text-sm font-bold">Mã đề đang xem<select disabled={busy || !!editingQuestion} value={attempt.variant || ""} onChange={(event) => { window.location.href = `/training-assessment/${slug}?preview=creator&variant=${encodeURIComponent(event.target.value)}`; }} className="ft-input mt-2">{previewVariants.map((variant) => <option key={variant} value={variant}>{variant}</option>)}</select></label></div>{message && <p role="status" className="mb-4 rounded-xl border bg-white p-3 text-sm">{message}</p>}<div className="space-y-4">{previewQuestions.map((question, index) => <article key={question.id} className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-700">{question.question_code || `Câu ${index + 1}`}</p><div className="mt-2 flex flex-wrap gap-2"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{question.type}</span>{question.category && <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">{question.category}</span>}{question.points != null && <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800">{question.points} điểm</span>}</div></div><button disabled={busy || !!editingQuestion} onClick={() => { setOriginalQuestion(question); setEditingQuestion(structuredClone(question)); setMessage(""); }} className="ft-btn ft-btn-secondary">Sửa câu hỏi</button></div><h2 className="mt-4 whitespace-pre-wrap text-lg font-bold leading-7">{question.text}</h2>{question.media_url && (() => { const preview = mediaPreview(question.media_url, String(question.media_file_id || ""), String(question.media_type || "")); if (preview?.kind === "image") return <img src={preview.url} alt="Hình minh họa" className="mt-3 max-h-64 max-w-full rounded-xl border object-contain" />; if (preview?.kind === "drive") return <img src={preview.imageUrl} alt="Hình minh họa" className="mt-3 max-h-64 max-w-full rounded-xl border object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).src = preview.fallbackImageUrl; }} />; return <a href={question.media_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-bold text-blue-700 underline">Mở ảnh/tư liệu minh họa</a>; })()}{question.type === "matching" && (question.options || []).length > 0 ? <div className="mt-4 overflow-hidden rounded-xl border border-slate-200"><div className="grid grid-cols-2 gap-px bg-slate-200 text-xs font-extrabold uppercase tracking-wide"><div className="bg-slate-100 px-3 py-2">Vế trái</div><div className="bg-slate-100 px-3 py-2">Vế phải (đáp án ghép)</div></div>{question.options.map((option) => <div key={option.key} className="grid grid-cols-2 gap-px bg-slate-200 text-sm"><div className="flex gap-2 bg-white px-3 py-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-slate-800 text-[11px] font-black text-white">{option.key}</span><span>{option.text}</span></div><div className="bg-emerald-50 px-3 py-2 text-emerald-900">{option.match_text || "—"}</div></div>)}</div> : (question.options || []).length > 0 && <ol className="mt-4 space-y-2">{question.options.map((option) => <li key={option.key} className="rounded-lg border bg-slate-50 px-3 py-2 text-sm"><b>{option.key}.</b> {option.text || option.match_text || "—"}</li>)}</ol>}<div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><b>Đáp án:</b> {(question.correct_answers || []).join(", ") || "Cần chấm thủ công / không thiết lập đáp án"}</div>{editingQuestion?.id === question.id && <fieldset disabled={busy} className="mt-4"><QuestionEditor question={editingQuestion} onChange={setEditingQuestion} onClose={() => { setEditingQuestion(null); setOriginalQuestion(null); }} /><div className="mt-3 flex justify-end"><button disabled={busy} onClick={() => void savePreviewQuestion()} className="ft-primary">{busy ? "Đang lưu..." : "Lưu câu hỏi"}</button></div></fieldset>}</article>)}</div></main></div>;
  }

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 text-slate-600">
        <Loader2 className="h-9 w-9 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!assessment) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 p-5">
        <div className="max-w-lg rounded-2xl border bg-white p-8 text-center shadow-sm">
          <AlertCircle className="mx-auto h-12 w-12 text-rose-500" />
          <h1 className="mt-4 text-2xl font-extrabold text-slate-900">Không mở được bài đánh giá</h1>
          <p className="mt-2 text-slate-600">{message || "Đường dẫn không hợp lệ."}</p>
        </div>
      </div>
    );
  }

  if (unfinishedAttempt && !attempt) {
    return <div lang="vi" className="grid min-h-screen place-items-center bg-slate-50 p-5 text-slate-900">
      <main className="w-full max-w-xl rounded-2xl border bg-white p-6 shadow-lg sm:p-8">
        <h1 className="text-xl font-extrabold">Bạn có một lượt làm chưa hoàn thành</h1>
        <p className="mt-3 leading-7 text-slate-700">{unfinishedAttempt.respondent_name} đã có bài đang làm. Anh/chị có thể tiếp tục với các câu trả lời và thời gian còn lại, hoặc tạo lượt mới. Nếu tạo lượt mới, lượt đang làm sẽ bị xóa hoàn toàn.</p>
        <p className="mt-2 text-sm text-slate-600">Thời gian còn lại đến {new Date(unfinishedAttempt.expires_at).toLocaleString("vi-VN")}.</p>
        {message && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{message}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          <button disabled={busy} className="ft-primary" onClick={() => { localStorage.setItem(storageKey, unfinishedAttempt.access_token); restoreAttempt(unfinishedAttempt); setUnfinishedAttempt(null); }}>Tiếp tục lượt cũ</button>
          <button disabled={busy} className="ft-btn ft-btn-secondary" onClick={() => void startFreshFromUnfinished()}>Làm lại bằng lượt mới</button>
        </div>
      </main>
    </div>;
  }

  if (!attempt) {
    const isOpen = assessment.availability === "open";
    const practicalQuestionCount = Number(assessment.practical_question_count || 0);
    const theoryQuestionCount = Number(assessment.theory_question_count ?? Math.max(0, Number(assessment.question_count || 0) - practicalQuestionCount));
    return (
      <div lang="vi" translate="no" className="notranslate min-h-screen bg-[radial-gradient(circle_at_top_left,#dbeafe,transparent_35%),linear-gradient(180deg,#f8fafc,#eef2ff)] px-4 py-8 text-slate-900">
        <main className="mx-auto w-full max-w-[72rem]">
          <header className="mb-5 flex flex-wrap items-center gap-3">
            <img src="/logo.png" alt="FermatTech" className="h-9 object-contain" />
            <span className="border-l pl-3 text-sm font-bold text-slate-600">Training Completion Survey</span>
          </header>
          <section className="overflow-hidden rounded-3xl border border-white/80 bg-white shadow-xl shadow-blue-950/10">
            <div className="bg-gradient-to-br from-[#001e40] via-[#0049a8] to-[#00a77a] px-5 py-7 text-white sm:px-10 sm:py-8">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Bài kiểm tra kết thúc tập huấn</p>
              <h1 className="mt-3 text-2xl font-extrabold leading-tight sm:text-3xl">{assessment.title}</h1>
              <p className="mt-3 text-blue-100">
                {[assessment.partner_name, assessment.class_name].filter(Boolean).join(" · ")}
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-white/10 p-3"><b>{assessment.duration_minutes} phút</b><span className="block text-xs text-blue-100">Thời gian làm bài</span></div>
                <div className="rounded-xl bg-white/10 p-3"><b>{assessment.question_count} câu</b><span className="block text-xs text-blue-100">Mỗi mã đề</span></div>
                <div className="rounded-xl bg-white/10 p-3"><b>{assessment.variant_count} mã đề</b><span className="block text-xs text-blue-100">Hệ thống tự chia đều</span></div>
              </div>
            </div>
            <div className="p-5 sm:p-10">
              <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50/70 p-5 text-sm leading-6 text-slate-800">
                <b className="block text-base text-[#001e40]">Hướng dẫn làm bài</b>
                <ul className="mt-3 list-disc space-y-2 pl-5 marker:text-blue-600">
                  <li>Bài kiểm tra gồm <b>{theoryQuestionCount} câu trắc nghiệm</b> và <b>{practicalQuestionCount} câu thực hành</b>.</li>
                  <li>Các câu trắc nghiệm chọn duy nhất một đáp án đúng.</li>
                  <li>Với câu thực hành, học viên dán đường dẫn tới bài làm hoặc gửi ảnh sản phẩm; ảnh hướng dẫn (nếu có) sẽ hiển thị kèm theo câu hỏi.</li>
                  <li>Vui lòng điền đầy đủ thông tin và hoàn thành tất cả câu hỏi bắt buộc trước khi nộp bài.</li>
                </ul>
                {([assessment.description, assessment.instructions].filter((item) => item && !String(item).includes("Không tải lại trang"))).length > 0 && <div className="mt-4 border-t border-blue-200 pt-4"><b className="block text-sm text-[#001e40]">Lưu ý từ ban tổ chức</b><div className="mt-2 whitespace-pre-wrap text-slate-700">{[assessment.description, assessment.instructions].filter((item) => item && !String(item).includes("Không tải lại trang")).join("\n\n")}</div></div>}
              </div>
              {!isOpen ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 font-semibold text-amber-900">
                  {assessment.message}
                </div>
              ) : (
                <form onSubmit={start} className="grid gap-4 sm:grid-cols-2">
                  {assessment.requires_participant && <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">{"Mã người tham gia *"}</span><input required className="ft-input" value={identity.participant_code} onChange={(event) => setIdentity({ ...identity, participant_code: event.target.value })} placeholder="VD: GV-001" /></label>}
                  <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Họ và tên *</span><input required className="ft-input" value={identity.respondent_name} onChange={(event) => setIdentity({ ...identity, respondent_name: event.target.value })} /></label>
                  <label><span className="mb-1 block text-sm font-bold">Email *</span><input required type="email" className="ft-input" value={identity.email} onChange={(event) => setIdentity({ ...identity, email: event.target.value })} /></label>
                  <label><span className="mb-1 block text-sm font-bold">Số điện thoại *</span><input required type="tel" className="ft-input" value={identity.phone} onChange={(event) => setIdentity({ ...identity, phone: event.target.value })} /></label>
                  {assessment.organization_context_value && <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">{assessment.organization_context_label || "Đơn vị"}</span><input readOnly aria-readonly="true" value={assessment.organization_context_value} className="ft-input cursor-default bg-slate-50 text-slate-600" /></label>}
                  <label><span className="mb-1 block text-sm font-bold">{assessment.organization_field_label || "Đơn vị công tác"} *</span><input required className="ft-input" value={identity.organization} onChange={(event) => setIdentity({ ...identity, organization: event.target.value })} /></label>
                  <label><span className="mb-1 block text-sm font-bold">Chức vụ *</span><input required className="ft-input" value={identity.position} onChange={(event) => setIdentity({ ...identity, position: event.target.value })} /></label>
                  <p className="sm:col-span-2 text-xs text-slate-500">Tất cả các trường có dấu * là bắt buộc. Mã đề được hệ thống cấp tự động sau khi bắt đầu.</p>
                  {message && <p className="sm:col-span-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{message}</p>}
                  <button disabled={busy} className="ft-primary sm:col-span-2 sm:justify-center">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Bắt đầu làm bài
                  </button>
                </form>
              )}
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (attempt.status !== "in_progress") {
    const automaticScore = Number(attempt.auto_graded_points || 0);
    const automaticMaximum = Number(attempt.auto_max_score || 0);
    const hasManualQuestions = Number(attempt.max_score || 0) > automaticMaximum;
    const startNextPerson = () => {
      setPreviousAttemptToken(String(attempt.access_token || ""));
      localStorage.removeItem(storageKey);
      setAttempt(null);
      setAnswers({});
      setIdentity({ respondent_name: "", email: "", phone: "", organization: "", position: "", participant_code: "" });
      setCurrentIndex(0);
      setReviewedIds([]);
      setReviewMode(false);
      setMessage("");
      window.scrollTo({ top: 0, behavior: "smooth" });
      void load();
    };
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 p-5">
        <section className="w-full max-w-2xl rounded-3xl border bg-white p-8 text-center shadow-xl">
          <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
          <h1 className="mt-4 text-3xl font-extrabold text-slate-900">Đã ghi nhận bài làm</h1>
          <p className="mt-2 text-slate-600">{attempt.respondent_name} · {assessment.partner_name}</p>
          <div className="mx-auto mt-7 max-w-sm rounded-2xl bg-slate-900 p-6 text-white">
            <p className="text-sm text-slate-300">Điểm phần chấm tự động</p>
            <p className="mt-1 text-4xl font-black">{automaticMaximum > 0 ? `${automaticScore.toLocaleString("vi-VN")} / ${automaticMaximum.toLocaleString("vi-VN")}` : "Không có câu chấm tự động"}</p>
          </div>
          {hasManualQuestions && <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Điểm thực hành và điểm tổng kết sẽ được cập nhật sau khi người chấm hoàn tất chấm bài.</p>}
          <button type="button" onClick={startNextPerson} className="ft-primary mt-6 w-full justify-center">Thêm lượt làm bài mới</button>
        </section>
      </div>
    );
  }

  return (
    <div lang="vi" translate="no" className="notranslate min-h-screen bg-slate-100 pb-28 text-slate-900">
      <header className="sticky top-0 z-20 border-b bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex w-[92vw] max-w-[1800px] items-center justify-between gap-4 px-1 py-3 sm:px-2">
          <div className="min-w-0"><p className="truncate text-sm font-extrabold">{isPreview ? "Xem trước · giao diện người trả lời" : `Kiểm tra cuối khóa tập huấn - ${attempt.respondent_name}`}</p><p className="text-xs text-slate-500">{assessment.title} · {attempt.variant}{isPreview && " · Chế độ demo"}</p></div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1 text-xs text-slate-500 sm:inline-flex"><Save className="h-3.5 w-3.5" />{saveState}</span>
            <div aria-label={`Còn ${formatCountdown(secondsLeft)}`} className={`flex items-center gap-2 rounded-xl px-3 py-2 font-mono text-lg font-black ${secondsLeft < 300 ? "bg-rose-100 text-rose-700" : "bg-blue-50 text-blue-800"}`}><Clock3 className="h-5 w-5" />{formatCountdown(secondsLeft)}</div>
          </div>
        </div>
      </header>
      <main className="mx-auto grid w-[92vw] max-w-[1800px] gap-5 px-0 py-4 sm:py-6 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="h-fit space-y-5 md:sticky md:top-24">
          <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between"><b>Danh sách câu</b><span className="text-xs text-slate-500">{currentIndex + 1}/{questions.length}</span></div>
          <div className="mt-3 grid grid-cols-7 gap-1.5 sm:grid-cols-10 md:grid-cols-4">{questions.map((question, index) => { const answered = isAnswered(question); const reviewed = reviewedIds.includes(question.id); return <button type="button" aria-label={`Câu ${index + 1}: ${answered ? "đã trả lời" : "chưa trả lời"}`} key={question.id} onClick={() => { setCurrentIndex(index); setReviewMode(false); }} className={`relative grid aspect-square place-items-center rounded-xl border text-[11px] font-black transition ${index === currentIndex && !reviewMode ? "border-blue-700 bg-blue-700 text-white ring-2 ring-blue-200" : answered ? "border-emerald-400 bg-emerald-100 text-emerald-900" : "border-blue-300 bg-blue-50 text-blue-800 hover:border-blue-500"}`}>{index + 1}{reviewed && <Bookmark className="absolute -right-1 -top-1 h-3 w-3 fill-amber-400 text-amber-500" />}</button>; })}</div>
          <div className="mt-3 space-y-1.5 border-t pt-3 text-[10px] text-slate-500"><p className="whitespace-nowrap"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-emerald-200" />Đã trả lời</p><p className="whitespace-nowrap"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-blue-100 ring-1 ring-blue-300" />Chưa trả lời</p><p className="whitespace-nowrap"><Bookmark className="mr-1 inline h-3 w-3 fill-amber-400 text-amber-500" />Đánh dấu xem lại</p></div>
          </div>
          {(currentMedia?.kind === "image" || currentMedia?.kind === "drive") && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><p className="px-1 pb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">Hình minh họa</p>{mediaLoadError ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"><b>Tải ảnh lỗi</b><p className="mt-1 text-xs">Kiểm tra quyền xem qua liên kết của tệp ảnh.</p>{currentMedia.kind === "drive" && <a href={currentMedia.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex font-bold text-rose-700 underline">Mở tệp gốc</a>}</div> : <><button type="button" onClick={() => setExpandedImageUrl(currentMedia.kind === "drive" ? (mediaUseFallback ? currentMedia.fallbackImageUrl : currentMedia.imageUrl) : currentMedia.url)} className="group block w-full cursor-zoom-in overflow-hidden rounded-xl bg-slate-50"><img src={currentMedia.kind === "drive" ? (mediaUseFallback ? currentMedia.fallbackImageUrl : currentMedia.imageUrl) : currentMedia.url} alt="Ảnh minh họa cho câu hỏi" onError={() => currentMedia.kind === "drive" && !mediaUseFallback ? setMediaUseFallback(true) : setMediaLoadError(true)} className="max-h-[380px] w-full object-contain transition duration-200 group-hover:scale-[1.01]" /></button><p className="px-1 pt-2 text-center text-xs text-slate-500">Bấm vào ảnh để phóng to</p></>}</section>}
          {(currentMedia?.kind === "video" || currentMedia?.kind === "drive-video") && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><p className="px-1 pb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">Video minh họa</p><div className="aspect-video overflow-hidden rounded-xl bg-slate-950"><iframe src={currentMedia.url} title="Video minh họa cho câu hỏi" className="h-full w-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div>{currentMedia.kind === "drive-video" && <a href={currentMedia.openUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-bold text-blue-700 underline">Mở video trên Drive</a>}</section>}
        </aside>
        <section className="min-w-0">{isPreview && <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><b>Chế độ xem trước của người tạo.</b> Đây là giao diện người trả lời để kiểm tra trải nghiệm; mọi thao tác chỉ là mô phỏng, không tạo lượt làm, không lưu tệp và không thể nộp bài.</div>}{message && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{message}</div>}{reviewMode ? <article className="rounded-2xl border bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-5">
            <div><p className="text-xs font-bold uppercase tracking-wide text-blue-600">Bước cuối</p><h1 className="mt-1 text-2xl font-extrabold">Rà soát toàn bộ câu trả lời</h1><p className="mt-2 text-sm text-slate-500">Bấm vào một câu để quay lại chỉnh sửa. Bài chỉ được khóa sau khi anh/chị xác nhận nộp.</p></div>
            <button type="button" onClick={() => setReviewMode(false)} className="ft-btn ft-btn-secondary"><ChevronLeft className="h-4 w-4" />Quay lại làm bài</button>
          </div>
          <div className="mt-5 grid gap-3">
            {questions.map((question, index) => <button type="button" key={question.id} onClick={() => { setCurrentIndex(index); setReviewMode(false); }} className={`rounded-xl border p-4 text-left transition hover:border-blue-400 hover:bg-blue-50 ${isAnswered(question) ? "border-emerald-200" : "border-blue-200 bg-blue-50/50"}`}>
              <span className="flex items-start justify-between gap-3"><b className="whitespace-pre-wrap text-sm text-slate-900">Câu {index + 1}. {question.text}</b><span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${isAnswered(question) ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"}`}>{isAnswered(question) ? "Đã trả lời" : "Chưa trả lời"}</span></span>
              <span className="mt-2 block break-words text-sm text-slate-600">{answerSummary(question)}</span>
              {reviewedIds.includes(question.id) && <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-amber-700"><Bookmark className="h-3.5 w-3.5 fill-amber-400" />Đã đánh dấu xem lại</span>}
            </button>)}
          </div>
        </article> : currentQuestion && <article className="rounded-2xl border bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-600">{currentQuestion.question_code || `Câu ${currentIndex + 1}`}</p><div className="mt-2 flex flex-wrap gap-2">{currentQuestion.knowledge_type && <span className="rounded-full bg-violet-50 px-2 py-1 text-[11px] font-bold text-violet-700">{currentQuestion.knowledge_type}</span>}{currentQuestion.category && <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700">{currentQuestion.category}</span>}{currentQuestion.difficulty && <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">{currentQuestion.difficulty}</span>}</div></div><div className="flex items-center gap-3"><span className="text-xs font-semibold text-slate-500">{currentQuestion.points} điểm</span><button onClick={() => toggleReview(currentQuestion.id)} className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold ${reviewedIds.includes(currentQuestion.id) ? "border-amber-300 bg-amber-50 text-amber-800" : "text-slate-600"}`}><Bookmark className={`h-4 w-4 ${reviewedIds.includes(currentQuestion.id) ? "fill-amber-400" : ""}`} />Xem lại</button></div></div>
          <h1 className="mt-5 whitespace-pre-wrap break-words text-lg font-bold leading-8">{currentQuestion.text}{currentQuestion.required && <span className="ml-1 text-rose-500">*</span>}</h1>
          {mediaReference && !currentMedia && <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><b>Không thể hiển thị ảnh minh họa</b><p className="mt-1 break-words">Nguồn hiện có: {mediaReference}</p><p className="mt-1 text-xs">Cần dùng URL ảnh hoặc link Google Drive hợp lệ trong cột Ảnh/Video minh họa.</p></div>}{currentMedia?.kind === "link" && <a href={currentMedia.url} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700"><PlayCircle className="h-4 w-4" />Mở tài liệu minh họa</a>}
          {currentQuestion.type === "single_choice" && <div className="mt-6 grid gap-3">{(currentQuestion.options || []).map((option) => <label key={option.key} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${answers[currentQuestion.id] === option.key ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" : "hover:border-slate-400"}`}><input type="radio" name={currentQuestion.id} className="mt-1" checked={answers[currentQuestion.id] === option.key} onChange={() => setAnswer(currentQuestion.id, option.key)} /><b className="text-blue-800">{option.key}.</b><span className="whitespace-pre-wrap">{option.text}</span></label>)}</div>}
          {currentQuestion.type === "multiple_choice" && <div className="mt-6 grid gap-3">{(currentQuestion.options || []).map((option) => { const checked = Array.isArray(answers[currentQuestion.id]) && (answers[currentQuestion.id] as string[]).includes(option.key); return <label key={option.key} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${checked ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : "hover:border-slate-400"}`}><input type="checkbox" className="mt-1" checked={checked} onChange={() => toggleMultiple(currentQuestion.id, option.key)} /><b className="text-emerald-800">{option.key}.</b><span className="whitespace-pre-wrap">{option.text}</span></label>; })}</div>}
          {currentQuestion.type === "short_answer" && <textarea rows={5} className="ft-input mt-6 resize-y" value={typeof answers[currentQuestion.id] === "string" ? answers[currentQuestion.id] as string : ""} onChange={(event) => setAnswer(currentQuestion.id, event.target.value)} placeholder="Nhập câu trả lời..." />}
          {currentQuestion.type === "matching" && (() => { const stored = answers[currentQuestion.id]; const matching: Record<string, string> = stored && typeof stored === "object" && !Array.isArray(stored) ? stored as Record<string, string> : Object.fromEntries(String(stored || "").split(";").map((pair) => pair.split("-").map((item) => item.trim())).filter((pair) => pair.length === 2)); const rightKeys = (currentQuestion.options || []).map((_, index) => String.fromCharCode(65 + index)).reverse(); const rightLabels = Object.fromEntries((currentQuestion.options || []).map((item, index) => [String.fromCharCode(65 + index), item.match_text || ""])); const picked = matchingPick?.questionId === currentQuestion.id ? matchingPick.rightKey : ""; return <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"><div className="border-b border-slate-200 bg-white px-5 py-4"><p className="text-sm font-extrabold text-slate-800">Ghép nối các mệnh đề</p><p className="mt-1 text-xs text-slate-500">Bấm một khối đáp án bên dưới, rồi bấm vào ô cần ghép. Hoặc kéo thả trực tiếp vào ô tương ứng.</p></div><div className="flex flex-col gap-5 p-4 sm:p-5"><div><p className="mb-3 text-xs font-extrabold uppercase tracking-wide text-slate-500">Các mệnh đề</p><div className="space-y-3">{(currentQuestion.options || []).map((option, index) => { const selectedKey = matching[option.key]; return <section key={option.key} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setMatching(currentQuestion.id, option.key, event.dataTransfer.getData("text/plain")); }} onClick={() => picked && setMatching(currentQuestion.id, option.key, picked)} className={`rounded-xl border-2 bg-white p-4 shadow-sm transition ${selectedKey ? "border-emerald-300" : picked ? "cursor-pointer border-dashed border-blue-400 bg-blue-50" : "border-slate-200"}`}><div className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-slate-900 text-xs font-black text-white">{index + 1}</span><p className="pt-0.5 text-sm font-semibold leading-6 text-slate-800">{option.text}</p></div><div className={`mt-3 flex min-h-12 items-center rounded-lg border px-3 py-2 text-sm font-semibold ${selectedKey ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-dashed border-slate-300 text-slate-400"}`}>{selectedKey ? <><span className="mr-2 grid h-6 w-6 place-items-center rounded bg-emerald-600 text-[11px] font-black text-white">{selectedKey}</span><span className="flex-1">{rightLabels[selectedKey]}</span><button type="button" onClick={(event) => { event.stopPropagation(); setMatching(currentQuestion.id, option.key, ""); }} className="ml-2 text-xs font-bold text-rose-600">Bỏ</button></> : picked ? "← Bấm để ghép vào đây" : "Chọn một đáp án bên dưới rồi bấm vào đây"}</div></section>; })}</div></div><div className="border-t border-slate-200 pt-4"><p className="mb-3 text-xs font-extrabold uppercase tracking-wide text-slate-500">Các khối đáp án</p><div className="grid gap-2 sm:grid-cols-2">{rightKeys.map((key) => { const used = Object.values(matching).includes(key); const active = picked === key; return <button type="button" key={key} draggable={!used} onDragStart={(event) => event.dataTransfer.setData("text/plain", key)} onClick={() => !used && setMatchingPick(active ? null : { questionId: currentQuestion.id, rightKey: key })} disabled={used} className={`flex min-h-14 items-center gap-3 rounded-lg border p-3 text-left text-sm font-semibold transition ${used ? "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-400 line-through opacity-50" : active ? "border-blue-600 bg-blue-600 text-white shadow-md" : "cursor-pointer border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50 active:scale-95"}`}><GripVertical className={`h-5 w-5 shrink-0 ${active ? "text-white/70" : "text-slate-300"}`} /><span className={`grid h-6 w-6 shrink-0 place-items-center rounded text-[11px] font-black ${active ? "bg-white/20 text-white" : "bg-blue-100 text-blue-700"}`}>{key}</span><span>{rightLabels[key] || `Đáp án ${key}`}</span></button>; })}</div></div></div></div>; })()}
          {currentQuestion.type === "ordering" && (() => { const stored = typeof answers[currentQuestion.id] === "string" ? String(answers[currentQuestion.id]).split("-").filter(Boolean) : []; const order = stored.length === (currentQuestion.options || []).length ? stored : (currentQuestion.options || []).map((item) => item.key); const optionMap = Object.fromEntries((currentQuestion.options || []).map((item) => [item.key, item.text])); return <div className="mt-6 space-y-2"><p className="mb-3 text-sm font-bold text-slate-700">Kéo thả để sắp xếp, hoặc dùng nút mũi tên.</p>{order.map((key, index) => <div key={key} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", key)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); reorderOrdering(currentQuestion, event.dataTransfer.getData("text/plain"), index); }} className="flex cursor-grab items-center gap-3 rounded-xl border bg-white p-3"><GripVertical className="h-5 w-5 text-slate-400" /><span className="grid h-7 w-7 place-items-center rounded bg-blue-50 text-xs font-black text-blue-700">{index + 1}</span><span className="flex-1 text-sm">{optionMap[key]}</span><div className="flex gap-1"><button onClick={() => moveOrdering(currentQuestion, index, -1)} disabled={index === 0} className="rounded border px-2 py-1 text-xs disabled:opacity-30">↑</button><button onClick={() => moveOrdering(currentQuestion, index, 1)} disabled={index === order.length - 1} className="rounded border px-2 py-1 text-xs disabled:opacity-30">↓</button></div></div>)}</div>; })()}
          {currentQuestionUploads.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{currentQuestionUploads.map((upload: any, index: number) => <figure key={upload.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><a href={upload.url} target="_blank" rel="noreferrer" className="block bg-slate-50"><img src={upload.url} alt={`Ảnh minh chứng ${index + 1}`} className="h-52 w-full object-contain" /></a><figcaption className="flex items-center justify-between gap-3 border-t p-3"><span className="min-w-0 truncate text-xs font-bold text-slate-700">Ảnh {index + 1}: {upload.name}</span><button type="button" disabled={busy} onClick={() => void deleteUpload(currentQuestion, upload.id)} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />Xóa</button></figcaption></figure>)}</div>}
          {(currentQuestion.type === "practical_submission" || currentQuestion.type === "file_upload") && (() => { const stored = answers[currentQuestion.id]; const practical = stored && typeof stored === "object" && !Array.isArray(stored) ? stored as Record<string, string> : { link: typeof stored === "string" ? stored : "" }; return isImageSubmission ? <div className="mt-6 grid gap-4"><p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">Câu hỏi tải tệp ảnh: có thể nộp <b>một hoặc nhiều ảnh minh chứng</b>. Không cần dán link sản phẩm.</p><label onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("border-blue-500", "bg-blue-50"); }} onDragLeave={(event) => event.currentTarget.classList.remove("border-blue-500", "bg-blue-50")} onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("border-blue-500", "bg-blue-50"); void uploadFiles(currentQuestion, event.dataTransfer.files); }} className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-slate-300 p-6 text-center transition hover:border-blue-400 hover:bg-blue-50"><FileUp className="h-8 w-8 text-blue-600" /><b className="mt-2">{currentQuestionUploads.length ? "Thêm ảnh minh chứng khác" : "Thả ảnh vào đây hoặc bấm để chọn"}</b><span className="mt-1 text-xs text-slate-500">Có thể chọn nhiều ảnh · JPG, PNG, WEBP, GIF · tối đa 5 MB/ảnh</span><input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(event) => { void uploadFiles(currentQuestion, event.target.files || undefined); event.currentTarget.value = ""; }} /></label></div> : <div className="mt-6 grid gap-3"><p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">Câu thực hành này chỉ nhận <b>link chia sẻ</b>; không cần tải ảnh hoặc tệp lên.</p><label><span className="mb-1 block text-sm font-bold">Link sản phẩm / thư mục Drive</span><div className="relative"><Link2 className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input type="url" className="ft-input pl-10" value={practical.link || ""} onChange={(event) => setAnswer(currentQuestion.id, { ...practical, link: event.target.value })} placeholder="https://drive.google.com/..." /></div></label></div>; })()}
          <div className="mt-8 flex items-center justify-between border-t pt-5"><button disabled={currentIndex === 0} onClick={() => setCurrentIndex((value) => Math.max(0, value - 1))} className="ft-btn ft-btn-secondary disabled:opacity-40"><ChevronLeft className="h-4 w-4" />Câu trước</button><button disabled={currentIndex === questions.length - 1} onClick={() => setCurrentIndex((value) => Math.min(questions.length - 1, value + 1))} className="ft-btn ft-btn-secondary disabled:opacity-40">Câu sau<ChevronRight className="h-4 w-4" /></button></div>
        </article>}</section>
      </main>
      <footer className="fixed inset-x-0 bottom-0 z-20 border-t bg-white p-3 shadow-[0_-8px_24px_rgba(15,23,42,.08)] sm:p-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <p className="hidden text-sm text-slate-600 sm:block">{isPreview ? "Đây là bản mô phỏng: câu trả lời sẽ không được lưu hoặc nộp." : unansweredRequired ? `Còn ${unansweredRequired} câu bắt buộc chưa trả lời.` : "Đã trả lời đủ các câu bắt buộc"}</p>
          {isPreview ? (
            <button type="button" disabled className="ft-primary ml-auto cursor-not-allowed opacity-50"><Send className="h-4 w-4" />Chế độ demo — không nộp bài</button>
          ) : reviewMode ? (
            <button type="button" disabled={busy} onClick={async () => {
              const detail = unansweredRequired ? `Anh/chị còn ${unansweredRequired} câu bắt buộc chưa trả lời. Các câu này sẽ được nộp ở trạng thái để trống.` : "Anh/chị đã trả lời đủ các câu bắt buộc.";
              const confirmed = await appDialog.confirm(`${detail} Sau khi nộp, anh/chị không thể sửa câu trả lời.`, { title: "Xác nhận nộp bài", confirmText: "Nộp bài", tone: "warning" });
              if (confirmed) void save(true);
            }} className="ft-primary ml-auto disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-4 w-4" />Xác nhận nộp bài</button>
          ) : (
            <button type="button" disabled={busy} onClick={() => setReviewMode(true)} className="ft-primary ml-auto disabled:cursor-not-allowed disabled:opacity-50">Rà soát để nộp bài<ChevronRight className="h-4 w-4" /></button>
          )}
        </div>
      </footer>
      {expandedImageUrl && <div role="dialog" aria-modal="true" aria-label="Ảnh minh họa phóng to" className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/80 p-4" onClick={() => setExpandedImageUrl("")}><div className="relative max-h-full max-w-6xl" onClick={(event) => event.stopPropagation()}><img src={expandedImageUrl} alt="Ảnh minh họa phóng to" className="max-h-[90dvh] max-w-full rounded-2xl bg-white object-contain shadow-2xl" /><button type="button" onClick={() => setExpandedImageUrl("")} className="absolute right-2 top-2 rounded-lg bg-slate-900/80 px-3 py-2 text-sm font-bold text-white">Đóng</button></div></div>}
    </div>
  );
}
