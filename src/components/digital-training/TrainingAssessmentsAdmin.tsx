import { createPortal } from "react-dom";
import React, { useEffect, useMemo, useRef, useState } from "react";
import QuestionEditor, { questionTypeLabels, questionTypes } from "./AssessmentQuestionEditor";
import AssessmentZoomableImage from "./AssessmentZoomableImage";
import { appDialog } from "../AppDialog";
import {
  ArrowLeft,
  AlertTriangle,
  BarChart3,
  Check,
  ClipboardCopy,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileCheck2,
  Layers3,
  Link2,
  Loader2,
  MessageSquareText,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Shuffle,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import QRCode from "qrcode";
import * as XLSX from "xlsx";

type Assessment = {
  id: number;
  title: string;
  session?: number | null;
  session_name?: string;
  partner_name?: string;
  training_class?: number | null;
  class_name?: string;
  description: string;
  instructions: string;
  duration_minutes: number;
  opens_at?: string | null;
  closes_at?: string | null;
  closed_at?: string | null;
  retention_started_at?: string | null;
  attempt_limit: number;
  status: "draft" | "published" | "closed" | "graded" | "backup_complete";
  public_slug: string;
  questions: any[];
  variants: Array<{ name: string; question_count: number }>;
  source_type: string;
  source_name: string;
  attempts_count: number;
  submitted_count: number;
  average_score?: number | null;
  variant_distribution: Record<string, number>;
  generation_mode: "prepared" | "auto_generate";
  generation_config: Record<string, any>;
  question_bank_url?: string;
  output_sheet_url?: string;
  drive_folder_id?: string;
  storage_config?: {
    create_customer_folder?: boolean;
    create_participant_folder?: boolean;
    customer_folder_name?: string;
    participant_folder_template?: string;
  };
  audience_group?: string;
  participants?: any[];
  participant_count: number;
  max_people_per_variant: number;
  sync_status: string;
  sync_error?: string;
  sync_counts: { pending: number; synced: number; error: number };
  purge_at?: string | null;
  retention_warning?: { level: "warning" | "strong" | "urgent"; label: string; days: number; remaining: number } | null;
  created_at: string;
  updated_at: string;
};

type Preview = {
  source_name: string;
  source_type: string;
  questions: any[];
  variants: Array<{ name: string; question_count: number }>;
  question_count: number;
  errors: string[];
  question_errors?: Array<{ source?: string; question_id?: string; question_code?: string; variant?: string; message: string }>;
  warnings: string[];
  import_mode: "prepared" | "auto_generate";
  source_question_count?: number;
  bank_questions?: any[];
  available_groups?: string[];
  source_url?: string;
  generation_config?: {
    variant_count: number;
    questions_per_variant: number;
    source_question_count: number;
    seed: number;
  };
};
type BankIndex = {
  source_name?: string;
  source_type?: string;
  source_url?: string;
  synced_at?: string;
  question_count?: number;
  available_groups?: string[];
  inventory?: { sheets?: Array<{ name: string; topics?: Array<{ name: string; total: number; theory: number; practice: number; easy: number; medium: number; hard: number }> }> };
};

function AssessmentEvidenceImage({ source, auth, alt }: { source: string; auth: Record<string, string>; alt: string }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl = "";
    let alive = true;
    setPreviewUrl("");
    setFailed(false);
    if (!source) return () => undefined;
    void fetch(source, { headers: auth })
      .then(async (response) => {
        if (!response.ok) throw new Error("Không tải được ảnh minh chứng.");
        return response.blob();
      })
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, auth.Authorization]);

  if (failed) return <p className="mt-3 text-sm text-rose-700">Không tải được ảnh minh chứng. Bạn vẫn có thể mở tệp gốc bên dưới.</p>;
  if (!previewUrl) return <p className="mt-3 text-sm text-slate-500">Đang tải ảnh minh chứng…</p>;
  return <AssessmentZoomableImage key={source} src={previewUrl} alt={alt} className="mt-3 max-h-[38rem] w-full rounded-lg border bg-white object-contain" />;
}

function AssessmentEvidenceCarousel({ uploads, assessmentId, attemptId, auth, questionOrder }: { uploads: any[]; assessmentId: number; attemptId: number; auth: Record<string, string>; questionOrder: number }) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [attemptId, questionOrder, uploads.map((item) => item.id).join(",")]);
  if (!uploads.length) return null;
  const active = uploads[Math.min(index, uploads.length - 1)];
  const source = `/api/digital-training/assessments/${assessmentId}/results/${attemptId}/uploads/${active.id}/content`;
  return <div className="mt-3 overflow-hidden rounded-xl border border-blue-200 bg-white"><div className="relative overflow-hidden"><AssessmentEvidenceImage source={source} auth={auth} alt={`Bài nộp câu ${questionOrder}, ảnh ${index + 1}`} />{uploads.length > 1 && <><button type="button" onClick={() => setIndex((current) => (current - 1 + uploads.length) % uploads.length)} className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-slate-950/70 text-white shadow hover:bg-slate-950" aria-label="Ảnh trước"><ChevronLeft className="h-5 w-5" /></button><button type="button" onClick={() => setIndex((current) => (current + 1) % uploads.length)} className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-slate-950/70 text-white shadow hover:bg-slate-950" aria-label="Ảnh tiếp theo"><ChevronRight className="h-5 w-5" /></button></>}</div><div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-xs"><b>Ảnh {index + 1}/{uploads.length}</b><a href={active.url} target="_blank" rel="noreferrer" className="font-bold text-blue-700 underline">Mở tệp gốc</a></div></div>;
}

const emptyDraft = () => ({
  title: "",
  target: "",
  duration_minutes: "120",
  attempt_limit: "1",
  opens_at: "",
  closes_at: "",
  description: "",
  instructions: "",
  status: "draft",
  audience_group: "",
  output_sheet_url: "",
  drive_folder_id: "",
  create_customer_folder: true,
  create_participant_folder: true,
});


const errorText = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  if (body.error) return body.error;
  const first = Object.values(body)[0];
  return Array.isArray(first) ? first.join(" ") : String(first || "Không thể xử lý yêu cầu.");
};

const statusLabel: Record<string, string> = {
  draft: "Bản nháp",
  published: "Đang mở",
  closed: "Đã đóng",
  graded: "Đã chấm bài",
  backup_complete: "Đã hoàn thành sao lưu",
};

const toDateTimeLocal = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
};

const formatScheduleTime = (value?: string | null) => value
  ? new Date(value).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })
  : "Chưa thiết lập";
const formatWorkDate = (value?: string | null) => value
  ? new Date(value).toLocaleDateString("vi-VN")
  : "Chưa thiết lập";
const completionLabel = (result: any) => {
  const maximum = Number(result.max_score || 0);
  const percent = maximum > 0 ? Number(result.score || 0) / maximum * 100 : 0;
  if (percent >= 90) return "Hoàn thành xuất sắc";
  if (percent >= 80) return "Hoàn thành tốt";
  if (percent >= 60) return "Hoàn thành";
  return "Chưa hoàn thành";
};
const assessmentDetailPath = (id: number) => `/training-assessments/${id}`;

const practicalEvidence = (questions: any[], result: any) => questions
  .filter((question) => question.variant === result.variant && ["practical_submission", "file_upload"].includes(question.type))
  .map((question) => {
    const value = result.answers?.[question.id];
    const link = typeof value === "object" && value ? String(value.link || value.upload_url || "") : String(value || "");
    return link ? { label: question.question_code || `Câu ${question.order}`, link } : null;
  })
  .filter((item): item is { label: string; link: string } => Boolean(item));

const DEFAULT_QUESTION_BANK_URL = "https://docs.google.com/spreadsheets/d/1zdlpFOO7p93DuQbXpRhvG4xi89u6L7O-2O1UqBaAV3c/edit?usp=sharing";
type QuestionBankSettings = { default_url: string };
type CachedQuestionBank = Preview & { synced_at?: string; inventory?: { sheets?: Array<{ name: string; topics?: Array<{ name: string; total: number; theory: number; practice: number; easy: number; medium: number; hard: number }> }> } };
export default function TrainingAssessmentsAdmin({
  idToken,
  userRole,
  sessions,
  classes,
  partners,
  isGuest,
}: {
  idToken: string;
  userRole: string;
  sessions: any[];
  classes: any[];
  partners: any[];
  isGuest: boolean;
}) {
  const [items, setItems] = useState<Assessment[]>([]);
  const [trashItems, setTrashItems] = useState<Assessment[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [selected, setSelected] = useState<Assessment | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [editingAnswerAttempt, setEditingAnswerAttempt] = useState<any | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, any>>({});
  const [resultSearch, setResultSearch] = useState("");
  const [resultStatus, setResultStatus] = useState("");
  const [resultVariant, setResultVariant] = useState("");
  const [resultPage, setResultPage] = useState(1);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; warning: boolean }>>([]);
  const toastId = useRef(0);
  const toastTimers = useRef(new Map<number, number>());
  const [manualScores, setManualScores] = useState<Record<number, string>>({});
  const [scheduleDraft, setScheduleDraft] = useState({ opens_at: "", closes_at: "" });
  const [detailTab, setDetailTab] = useState<"overview" | "settings">("overview");
  const [detailDraft, setDetailDraft] = useState({ duration_minutes: "", attempt_limit: "", description: "", instructions: "" });
  const [screen, setScreen] = useState<"list" | "create" | "detail" | "bank" | "grading">("list");
  const [gradingAttempt, setGradingAttempt] = useState<any | null>(null);
  const [questionScores, setQuestionScores] = useState<Record<string, string>>({});
  const [gradingNoteDrafts, setGradingNoteDrafts] = useState<Record<string, string>>({});
  const [singleGrading, setSingleGrading] = useState(false);
  const gradingDetailRef = useRef<HTMLDivElement>(null);
  const gradingQuestionListRef = useRef<HTMLElement>(null);
  const [showGradingRoster, setShowGradingRoster] = useState(false);
  const [activeGradingQuestionId, setActiveGradingQuestionId] = useState("");
  useEffect(() => {
    if (screen !== "grading") return;
    gradingDetailRef.current?.scrollTo({ top: 0 });
    gradingQuestionListRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [screen, gradingAttempt?.id, activeGradingQuestionId]);
  const [draft, setDraft] = useState(emptyDraft);
  const [importMode, setImportMode] = useState<"prepared" | "auto_generate">("prepared");
  const [questionsPerVariant, setQuestionsPerVariant] = useState("20");
  const [variantCount, setVariantCount] = useState("1");
  const [sourceMode, setSourceMode] = useState<"xlsx" | "google_sheet">("xlsx");
  const [file, setFile] = useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [bankSource, setBankSource] = useState<"default" | "other">("default");
  const [bankSettings, setBankSettings] = useState<QuestionBankSettings>({ default_url: DEFAULT_QUESTION_BANK_URL });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewEdited, setPreviewEdited] = useState(false);
  const [editingPreviewQuestionId, setEditingPreviewQuestionId] = useState("");
  const [variantAddCount, setVariantAddCount] = useState("1");
  const [bankIndex, setBankIndex] = useState<BankIndex | null>(null);
  const [qrUrl, setQrUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [bankFilters, setBankFilters] = useState({ category: "", knowledge_type: "", type: "", difficulty: "" });
  const [topicConfigs, setTopicConfigs] = useState<Record<string, { total: string; theory: string; practice: string }>>({});
  const appliedPracticeCount = useRef("");
  const [knowledgeCounts, setKnowledgeCounts] = useState({ theory: "10", practice: "10" });
  const [scoreConfig, setScoreConfig] = useState({ theory: "1", practice: "3" });
  const [difficultyCounts, setDifficultyCounts] = useState({ easy: "0", medium: "0", hard: "0" });
  const [structureDirty, setStructureDirty] = useState(false);
  // List filters
  const [filterText, setFilterText] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPartner, setFilterPartner] = useState("");
  const [workDateSort, setWorkDateSort] = useState<"desc" | "asc">("desc");
  const auth = { Authorization: `Bearer ${idToken}` };
  const resultVariants = useMemo(() => Array.from(new Set(results.map((item) => String(item.variant || "")).filter(Boolean))).sort(), [results]);
  const filteredResults = useMemo(() => results.filter((item) => {
    const normalized = (value: unknown) => String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
    const needle = normalized(resultSearch.trim());
    if (needle && ![item.respondent_name, item.email, item.phone].some((value) => normalized(value).includes(needle))) return false;
    if (resultStatus && item.status !== resultStatus) return false;
    if (resultVariant && item.variant !== resultVariant) return false;
    return true;
  }), [results, resultSearch, resultStatus, resultVariant]);
  const resultsPerPage = 50;
  const resultPageCount = Math.max(1, Math.ceil(filteredResults.length / resultsPerPage));
  const currentResultPage = Math.min(resultPage, resultPageCount);
  const pageResults = filteredResults.slice((currentResultPage - 1) * resultsPerPage, currentResultPage * resultsPerPage);
  const dismissToast = (id: number) => {
    window.clearTimeout(toastTimers.current.get(id));
    toastTimers.current.delete(id);
    setToasts((current) => current.filter((item) => item.id !== id));
  };
  const showToast = (message: string, warning = false) => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, message, warning }]);
    toastTimers.current.set(id, window.setTimeout(() => dismissToast(id), 30000));
  };
  useEffect(() => {
    return () => { toastTimers.current.forEach((timer) => window.clearTimeout(timer)); };
  }, []);
  const bankUrl = bankSource === "default" ? bankSettings.default_url.trim() : sheetUrl.trim();

  const loadBankSettings = async () => {
    const response = await fetch("/api/digital-training/question-bank-settings", { headers: auth });
    if (!response.ok) throw new Error(await errorText(response));
    const settings = await response.json() as QuestionBankSettings;
    setBankSettings(settings);
    return settings;
  };

  const loadCachedQuestionBank = async (url = bankUrl) => {
    const response = await fetch(`/api/digital-training/question-bank-snapshot?google_sheet_url=${encodeURIComponent(url)}`, { headers: auth });
    if (!response.ok) throw new Error(await errorText(response));
    const cached = await response.json() as CachedQuestionBank;
    setBankIndex(cached);
    return cached;
  };

  const load = async () => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/digital-training/assessments", { headers: auth });
      if (!response.ok) throw new Error(await errorText(response));
      setItems(await response.json());
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const loadTrash = async () => {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/digital-training/assessments-trash", { headers: auth });
      if (!response.ok) throw new Error(await errorText(response));
      setTrashItems(await response.json()); setShowTrash(true);
    } catch (error: any) { setNotice(String(error?.message || error)); }
    finally { setBusy(false); }
  };

  const restoreDraft = async (item: Assessment) => {
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/digital-training/assessments-trash/${item.id}/restore`, { method: "POST", headers: auth });
      if (!response.ok) throw new Error(await errorText(response));
      setTrashItems((current) => current.filter((row) => row.id !== item.id));
      await load(); setNotice("Đã khôi phục bản nháp.");
    } catch (error: any) { setNotice(String(error?.message || error)); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (idToken) {
      void load();
      void loadBankSettings()
        .then((settings) => loadCachedQuestionBank(settings.default_url))
        .catch(() => undefined);
    }
  }, [idToken]);

  useEffect(() => {
    if (screen !== "detail" || !selected?.id) return;
    let active = true;
    const refreshAssessment = async () => {
      try {
        const response = await fetch(`/api/digital-training/assessments/${selected.id}`, { headers: { Authorization: `Bearer ${idToken}` } });
        if (!response.ok) return;
        const updated = await response.json() as Assessment;
        if (active) {
          setSelected((current) => current?.id === updated.id ? updated : current);
          setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
          if (updated.status !== "published") {
            const resultsResponse = await fetch(`/api/digital-training/assessments/${updated.id}/results`, { headers: { Authorization: `Bearer ${idToken}` } });
            if (active && resultsResponse.ok) setResults(await resultsResponse.json());
          }
        }
      } catch { /* Keep the current detail if the connection is unavailable. */ }
    };
    window.addEventListener("focus", refreshAssessment);
    const closingTime = selected.status === "published" && selected.closes_at ? new Date(selected.closes_at).getTime() : 0;
    const timeUntilClose = closingTime - Date.now();
    let closingTimer: number | undefined;
    let closingPoll: number | undefined;
    if (closingTime && timeUntilClose < 2147483647) {
      closingTimer = window.setTimeout(() => {
        void refreshAssessment();
        closingPoll = window.setInterval(() => void refreshAssessment(), 15000);
      }, Math.max(0, timeUntilClose + 2000));
    }
    return () => {
      active = false;
      window.removeEventListener("focus", refreshAssessment);
      window.clearTimeout(closingTimer);
      window.clearInterval(closingPoll);
    };
  }, [screen, selected?.id, selected?.status, selected?.closes_at, idToken]);

  const publicLink = selected
    ? `${window.location.origin}/training-assessment/${selected.public_slug}`
    : "";
  const driveFolderLink = selected?.drive_folder_id
    ? /^https?:\/\//i.test(selected.drive_folder_id)
      ? selected.drive_folder_id
      : `https://drive.google.com/drive/folders/${selected.drive_folder_id}`
    : "";

  useEffect(() => {
    if (!publicLink) return setQrUrl("");
    void QRCode.toDataURL(publicLink, { width: 720, margin: 2, errorCorrectionLevel: "M" }).then(setQrUrl);
  }, [publicLink]);

  const targets = useMemo(() => {
    const classTargets = classes.map((item) => ({
      value: `class:${item.id}`,
      label: `${item.partner_name || "Đơn vị"} · ${item.name}`,
    }));
    const coveredPartners = new Set(classes.map((item) => item.partner));
    const sessionTargets = sessions
      .filter((item) => item.partner_id && !coveredPartners.has(item.partner_id))
      .filter((item, index, all) => all.findIndex((candidate) => candidate.partner_id === item.partner_id) === index)
      .map((item) => ({
        value: `session:${item.id}`,
        label: item.partner_name || item.partner || item.title,
      }));
    return [...classTargets, ...sessionTargets];
  }, [classes, sessions]);

  const selectedTargetPartner = useMemo(() => {
    const [targetType, targetId] = draft.target.split(":");
    const targetItem = targetType === "class"
      ? classes.find((item) => String(item.id) === targetId)
      : sessions.find((item) => String(item.id) === targetId);
    const partnerId = targetType === "class" ? targetItem?.partner : targetItem?.partner_id;
    const partnerName = targetType === "class" ? targetItem?.partner_name : (targetItem?.partner_name || targetItem?.partner);
    return partners.find((item) => String(item.id) === String(partnerId))
      || partners.find((item) => String(item.name || "").trim().toLocaleLowerCase() === String(partnerName || "").trim().toLocaleLowerCase())
      || null;
  }, [classes, draft.target, partners, sessions]);
  const audienceGroupOptions = useMemo(() => Array.from(new Set([
    ...partners.map((partner) => String(partner.partner_subtype || "").trim()),
    ...(bankIndex?.available_groups || []).map((group) => String(group || "").trim()),
  ].filter(Boolean))).sort((left, right) => left.localeCompare(right, "vi")), [partners, bankIndex?.available_groups]);
  const audienceGroupForTarget = (target: string) => {
    const [targetType, targetId] = target.split(":");
    const targetItem = targetType === "class"
      ? classes.find((item) => String(item.id) === targetId)
      : sessions.find((item) => String(item.id) === targetId);
    const partnerId = targetType === "class" ? targetItem?.partner : targetItem?.partner_id;
    const partnerName = targetType === "class" ? targetItem?.partner_name : (targetItem?.partner_name || targetItem?.partner);
    const partner = partners.find((item) => String(item.id) === String(partnerId))
      || partners.find((item) => String(item.name || "").trim().toLocaleLowerCase() === String(partnerName || "").trim().toLocaleLowerCase());
    const subtype = String(partner?.partner_subtype || "").trim();
    if (subtype) return subtype;
    const targetText = [targetItem?.partner_name, targetItem?.partner, targetItem?.title, targetItem?.name]
      .map((value) => String(value || "").trim().toLocaleLowerCase())
      .join(" ");
    return (bankIndex?.available_groups || []).find((group) => targetText.includes(String(group).trim().toLocaleLowerCase())) || "";
  };

  const normalizedVariantCount = Math.max(1, Math.min(200, Number.parseInt(variantCount, 10) || 1));
  const bankQuestions = preview?.bank_questions || [];
  const selectedBankQuestions = bankQuestions.filter((item) => !draft.audience_group || String(item.audience_group || "").trim().toLocaleLowerCase() === draft.audience_group.trim().toLocaleLowerCase());
  const parsedTopicRows = useMemo(() => {
    const cachedSheet = bankIndex?.inventory?.sheets?.find((sheet) => String(sheet.name || "").trim().toLocaleLowerCase() === draft.audience_group.trim().toLocaleLowerCase());
    if (cachedSheet?.topics?.length) return cachedSheet.topics.map((topic) => ({
      category: topic.name,
      available: Number(topic.total || 0),
      theory: Number(topic.theory || 0),
      practice: Number(topic.practice || 0),
      easy: Number(topic.easy || 0),
      medium: Number(topic.medium || 0),
      hard: Number(topic.hard || 0),
    })).sort((a, b) => a.category.localeCompare(b.category, "vi"));
    const rows = new Map<string, { category: string; available: number; theory: number; practice: number; easy: number; medium: number; hard: number }>();
    selectedBankQuestions.forEach((item) => {
      const category = String(item.category || "").trim() || "Không chủ đề";
      const row = rows.get(category) || { category, available: 0, theory: 0, practice: 0, easy: 0, medium: 0, hard: 0 };
      const knowledgeType = String(item.knowledge_type || "").trim().toLocaleLowerCase();
      const difficulty = String(item.difficulty || "").trim().toLocaleLowerCase();
      row.available += 1;
      if (knowledgeType === "lý thuyết" || knowledgeType === "ly thuyet" || knowledgeType === "theory") row.theory += 1;
      if (knowledgeType === "thực hành" || knowledgeType === "thuc hanh" || knowledgeType === "practice") row.practice += 1;
      if (difficulty === "dễ" || difficulty === "de" || difficulty === "easy") row.easy += 1;
      if (difficulty === "trung bình" || difficulty === "trung binh" || difficulty === "medium") row.medium += 1;
      if (difficulty === "khó" || difficulty === "kho" || difficulty === "hard") row.hard += 1;
      rows.set(category, row);
    });
    return Array.from(rows.values()).sort((a, b) => a.category.localeCompare(b.category, "vi"));
  }, [bankIndex, selectedBankQuestions]);
  const topicRows = parsedTopicRows;
  const questionsPerVariantCount = Math.max(1, Math.min(200, Number.parseInt(questionsPerVariant, 10) || 1));
  const distributePracticeAcrossTopics = (practiceValue: string, current: Record<string, { total: string; theory: string; practice: string }>) => {
    let remaining = Math.max(0, Number.parseInt(practiceValue, 10) || 0);
    const next = { ...current };
    const eligible = topicRows.filter((row) => Number(current[row.category]?.total || 0) > 0 && row.practice > 0);
    for (const row of eligible) {
      const config = current[row.category] || { total: "0", theory: "0", practice: "0" };
      next[row.category] = { ...config, practice: "0", theory: config.total };
    }
    while (remaining > 0) {
      let assigned = false;
      for (const row of eligible) {
        const config = next[row.category];
        const total = Number(config.total || 0);
        const practice = Number(config.practice || 0);
        if (practice >= total || practice >= row.practice) continue;
        const nextPractice = practice + 1;
        next[row.category] = { ...config, practice: String(nextPractice), theory: String(total - nextPractice) };
        remaining -= 1;
        assigned = true;
        if (!remaining) break;
      }
      if (!assigned) break;
    }
    return next;
  };
  useEffect(() => {
    // Changing the total practical count can use a helpful default. Manual
    // per-topic values are explicit decisions and must remain untouched.
    if (knowledgeCounts.practice === appliedPracticeCount.current) return;
    appliedPracticeCount.current = knowledgeCounts.practice;
    setTopicConfigs((current) => distributePracticeAcrossTopics(knowledgeCounts.practice, current));
  }, [knowledgeCounts.practice, topicRows]);
  const topicConfigPayload = topicRows.map((row) => ({
    category: row.category === "Không chủ đề" ? "" : row.category,
    total: Number(topicConfigs[row.category]?.total || 0),
    theory: Number(topicConfigs[row.category]?.theory || 0),
    practice: Number(topicConfigs[row.category]?.practice || 0),
  })).filter((row) => row.category && row.total > 0);
  const topicConfigTotal = topicConfigPayload.reduce((sum, row) => sum + row.total, 0);
  const topicConfigInvalid = topicConfigTotal !== questionsPerVariantCount;
  const topicKnowledgeConfigInvalid = topicConfigPayload.some((row) => row.theory < 0 || row.practice < 0 || row.theory + row.practice !== row.total);
  const knowledgeConfigPayload = {
    theory: Number(knowledgeCounts.theory || 0),
    practice: Number(knowledgeCounts.practice || 0),
  };
  const knowledgeConfigInvalid = knowledgeConfigPayload.theory < 0 || knowledgeConfigPayload.practice < 0 || knowledgeConfigPayload.theory + knowledgeConfigPayload.practice !== questionsPerVariantCount;
  const difficultyConfigPayload = { easy: Number(difficultyCounts.easy || 0), medium: Number(difficultyCounts.medium || 0), hard: Number(difficultyCounts.hard || 0) };
  const difficultyConfigInvalid = difficultyConfigPayload.easy < 0 || difficultyConfigPayload.medium < 0 || difficultyConfigPayload.hard < 0 || difficultyConfigPayload.easy + difficultyConfigPayload.medium + difficultyConfigPayload.hard !== questionsPerVariantCount;
  const scoreConfigPayload = {
    theory: Number(scoreConfig.theory),
    practice: Number(scoreConfig.practice),
  };
  const scoreConfigInvalid = !Number.isFinite(scoreConfigPayload.theory) || !Number.isFinite(scoreConfigPayload.practice) || scoreConfigPayload.theory < 0 || scoreConfigPayload.practice < 0;
  const bankFilterOptions = (field: keyof typeof bankFilters) => Array.from(new Set(bankQuestions.map((item) => String(item[field] || "")).filter(Boolean))).sort();
  const filteredBankQuestions = bankQuestions.filter((item) => Object.entries(bankFilters).every(([field, value]) => !value || String(item[field] || "") === value));
  const partnerOptions = useMemo(() => Array.from(new Set(items.map((item) => item.partner_name).filter(Boolean))).sort(), [items]);
  const filteredItems = useMemo(() => items.filter((item) => {
    if (filterStatus && item.status !== filterStatus) return false;
    if (filterPartner && item.partner_name !== filterPartner) return false;
    if (filterText) {
      const needle = filterText.toLowerCase();
      return item.title.toLowerCase().includes(needle) || (item.partner_name || "").toLowerCase().includes(needle) || (item.class_name || "").toLowerCase().includes(needle);
    }
    return true;
  }), [items, filterStatus, filterPartner, filterText]);
  const sortedItems = useMemo(() => [...filteredItems].sort((left, right) => {
    const leftTime = new Date(left.opens_at || left.created_at || left.updated_at).getTime();
    const rightTime = new Date(right.opens_at || right.created_at || right.updated_at).getTime();
    return workDateSort === "desc" ? rightTime - leftTime : leftTime - rightTime;
  }), [filteredItems, workDateSort]);

  const loadQuestionBank = async (url: string) => {
    if (!url) {
      setNotice("Vui lòng nhập liên kết ngân hàng đề thi.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/digital-training/question-bank-snapshot", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ google_sheet_url: url }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      setBankIndex(await response.json());
      setDraft((current) => ({ ...current, audience_group: "" }));
      setTopicConfigs({});
      setStructureDirty(true);
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => {
    setDraft(emptyDraft());
    setFile(null);
    setSheetUrl("");
    setBankSource("default");
    setImportMode("auto_generate");
    setQuestionsPerVariant("20");
    setVariantCount("1");
    void loadCachedQuestionBank(bankSettings.default_url).catch(() => setBankIndex(null));
    setTopicConfigs({});
    setKnowledgeCounts({ theory: "10", practice: "10" });
    setScoreConfig({ theory: "1", practice: "3" });
    setDifficultyCounts({ easy: "0", medium: "0", hard: "0" });
    setStructureDirty(false);
    setPreview(null);
    setPreviewEdited(false);
    setEditingPreviewQuestionId("");
    setNotice("");
    setScreen("create");
  };

  const importQuestions = async () => {
    if (importMode === "auto_generate") {
      if (!draft.audience_group) {
        setNotice("Vui lòng chọn nhóm đối tượng của khách hàng.");
        return;
      }
      if (!topicConfigPayload.length || topicConfigInvalid || topicKnowledgeConfigInvalid || knowledgeConfigInvalid || difficultyConfigInvalid) {
        setNotice("Chọn chủ đề; tổng số câu theo chủ đề và tổng Lý thuyết + Thực hành phải bằng số câu mỗi đề.");
        return;
      }
      if (scoreConfigInvalid) {
        setNotice("Điểm mỗi câu Lý thuyết/Thực hành phải là số không âm.");
        return;
      }
    }
    setBusy(true);
    setNotice("");
    try {
      let response: Response;
      if (importMode === "auto_generate") {
        response = await fetch("/api/digital-training/assessments/import-preview", {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({
            google_sheet_url: bankUrl,
            import_mode: "auto_generate",
            variant_count: normalizedVariantCount,
            questions_per_variant: questionsPerVariantCount,
            audience_group: draft.audience_group,
            topic_config: topicConfigPayload,
            knowledge_config: knowledgeConfigPayload,
            score_config: scoreConfigPayload,
            difficulty_config: difficultyConfigPayload,
          }),
        });
      } else if (sourceMode === "xlsx") {
        if (!file) throw new Error("Vui lòng chọn file XLSX hoặc XLSM.");
        const data = new FormData();
        data.append("file", file);
        data.append("import_mode", "prepared");
        data.append("variant_count", String(normalizedVariantCount));
        response = await fetch("/api/digital-training/assessments/import-preview", { method: "POST", headers: auth, body: data });
      } else {
        if (!sheetUrl.trim()) throw new Error("Vui lòng nhập đường dẫn Google Sheet hoặc Google Drive.");
        response = await fetch("/api/digital-training/assessments/import-preview", {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ google_sheet_url: sheetUrl.trim(), import_mode: "prepared", variant_count: normalizedVariantCount }),
        });
      }
      if (!response.ok) throw new Error(await errorText(response));
      setPreview(await response.json());
      setPreviewEdited(false);
      setEditingPreviewQuestionId("");
      setStructureDirty(false);
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };
  const refreshQuestionBank = () => void loadQuestionBank(bankUrl);
  const createAssessment = async () => {
    if (!draft.title.trim() || !draft.target) {
      setNotice("Vui lòng nhập tên bài và chọn đơn vị/phân lớp.");
      return;
    }
    if (importMode === "prepared") {
      if (!preview || (preview.errors.length && !previewEdited)) {
        setNotice("Có lỗi dữ liệu. Bấm Sửa câu ở dòng lỗi, lưu nội dung đã sửa rồi mới tạo bộ đề.");
        return;
      }
      if (structureDirty) {
        setNotice("Cơ cấu đề đã thay đổi. Vui lòng đọc lại dữ liệu trước khi tạo đợt thi.");
        return;
      }
    } else {
      if (!draft.audience_group) {
        setNotice("Vui lòng chọn nhóm đối tượng của khách hàng.");
        return;
      }
      if (!topicConfigPayload.length || topicConfigInvalid || topicKnowledgeConfigInvalid || knowledgeConfigInvalid || difficultyConfigInvalid) {
        setNotice("Chọn chủ đề; tổng số câu theo chủ đề và tổng Lý thuyết + Thực hành phải bằng số câu mỗi đề.");
        return;
      }
      if (scoreConfigInvalid) {
        setNotice("Điểm mỗi câu Lý thuyết/Thực hành phải là số không âm.");
        return;
      }
    }
    setBusy(true);
    setNotice("");
    try {
      let activePreview: Preview | null = preview;
      if (importMode === "auto_generate") {
        const response = await fetch("/api/digital-training/assessments/import-preview", {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({
            google_sheet_url: bankUrl,
            import_mode: "auto_generate",
            variant_count: normalizedVariantCount,
            questions_per_variant: questionsPerVariantCount,
            audience_group: draft.audience_group,
            topic_config: topicConfigPayload,
            knowledge_config: knowledgeConfigPayload,
            score_config: scoreConfigPayload,
            difficulty_config: difficultyConfigPayload,
          }),
        });
        if (!response.ok) throw new Error(await errorText(response));
        activePreview = await response.json();
        if (activePreview.errors.length) throw new Error(activePreview.errors[0]);
        setPreview(activePreview);
        setStructureDirty(false);
      }
      if (!activePreview) throw new Error("Không có dữ liệu đề để tạo khảo sát.");
      if ((activePreview.available_groups || []).length > 1 && !draft.audience_group) {
        throw new Error("Vui lòng chọn nhóm đối tượng của ngân hàng câu hỏi.");
      }
      const [targetType, targetId] = draft.target.split(":");
      const selectedClass = targetType === "class" ? classes.find((item) => String(item.id) === targetId) : null;
      const relatedSession = selectedClass
        ? sessions.find((item) => item.class_group_id === selectedClass.id)
        : sessions.find((item) => String(item.id) === targetId);
      const payload = {
        title: draft.title.trim(),
        training_class: selectedClass?.id || null,
        session: relatedSession?.id || null,
        duration_minutes: Number(draft.duration_minutes),
        attempt_limit: Number(draft.attempt_limit),
        opens_at: draft.opens_at || null,
        closes_at: draft.closes_at || null,
        description: draft.description,
        instructions: draft.instructions,
        status: draft.status,
        questions: activePreview.questions,
        generation_mode: activePreview.import_mode,
        generation_config: activePreview.generation_config || {},
        source_type: activePreview.source_type,
        source_name: activePreview.source_name,
        question_bank_url: activePreview.source_url || (sourceMode === "google_sheet" ? sheetUrl.trim() : ""),
        output_sheet_url: draft.output_sheet_url.trim(),
        drive_folder_id: draft.drive_folder_id.trim(),
        storage_config: {
          create_customer_folder: true,
          create_participant_folder: true,
        },
        audience_group: draft.audience_group,
        participants: [],
      };
      const response = await fetch("/api/digital-training/assessments", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const created = await response.json();
      await load();
      await openDetail(created);
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };
  const updatePreviewQuestion = (next: any) => {
    setPreview((current) => current ? { ...current, questions: current.questions.map((item) => item.id === next.id ? next : item) } : current);
    setPreviewEdited(true);
  };
  const addVariants = async () => {
    if (!selected) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}/variants`, {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ count: Number(variantAddCount) || 1 }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const updated = await response.json();
      setSelected(updated);
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      setVariantAddCount("1");
      setNotice("Đã bổ sung mã đề mới. Các lượt làm đang có vẫn giữ nguyên mã đề cũ.");
    } catch (error: any) { setNotice(String(error?.message || error)); } finally { setBusy(false); }
  };
  const openDetail = async (item: Assessment, updateUrl = true) => {
    setResultSearch("");
    setResultStatus("");
    setResultVariant("");
    setResultPage(1);
    if (updateUrl && window.location.pathname !== assessmentDetailPath(item.id)) {
      window.history.pushState({ trainingAssessmentId: item.id }, "", assessmentDetailPath(item.id));
    }
    setSelected(item);
    setScheduleDraft({ opens_at: toDateTimeLocal(item.opens_at), closes_at: toDateTimeLocal(item.closes_at) });
    setDetailDraft({ duration_minutes: String(item.duration_minutes || 120), attempt_limit: String(item.attempt_limit || 1), description: item.description || "", instructions: item.instructions || "" });
    setDetailTab("overview");
    setScreen("detail");
    setNotice("");
    try {
      const response = await fetch(`/api/digital-training/assessments/${item.id}/results`, { headers: auth });
      if (response.ok) {
        const body = await response.json();
        const grouped = [...body].sort((a, b) => new Date(b.started_at || 0).getTime() - new Date(a.started_at || 0).getTime());
        setResults(grouped);
        setManualScores(Object.fromEntries(body.map((result: any) => [result.id, String(result.score ?? "")])));
      }
    } catch {
      setResults([]);
    }
  };

  const gradeResult = async (result: any) => {
    if (!selected) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/digital-training/assessments/${selected.id}/results/${result.id}`,
        {
          method: "PATCH",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ score: Number(manualScores[result.id]) }),
        },
      );
      if (!response.ok) throw new Error(await errorText(response));
      const updated = await response.json();
      setResults((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const prepareOutput = async () => {
    if (!selected) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}/prepare-output`, { method: "POST", headers: auth });
      if (!response.ok) throw new Error(await errorText(response));
      const updated = await response.json();
      setSelected(updated);
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      if (updated.sync_status === "error") setNotice(updated.sync_error || "Không thể khởi tạo Google Sheet đầu ra.");
      else setNotice("Đã cập nhật dữ liệu từ hệ thống lên Google Sheet.");
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const verifyBackup = async () => {
    if (!selected) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}/verify-backup`, { method: "POST", headers: auth });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.manifest?.errors?.[0] || payload.error || "Bản sao chưa đầy đủ.");
      setSelected(payload.assessment);
      setItems((current) => current.map((item) => item.id === payload.assessment.id ? payload.assessment : item));
      setNotice(`Đã kiểm chứng bản sao: ${payload.manifest.questionCount} câu hỏi, ${payload.manifest.attemptCount} bài làm.`);
    } catch (error: any) { setNotice(String(error?.message || error)); }
    finally { setBusy(false); }
  };

  const updateResultStorage = async (result: any, removeStored = false) => {
    if (!selected) return;
    let confirmationPassword = "";
    if (removeStored) {
      const password = await confirmWithPassword(
        `Xóa lượt làm của ${result.respondent_name} để người này có thể bắt đầu lượt mới? Câu trả lời và điểm cũ sẽ bị xóa; nếu đã đồng bộ, hệ thống cũng sẽ xóa dòng điểm trên Google Sheets.`,
        "Xóa lượt làm",
        "Xóa lượt làm",
      );
      if (!password) return;
      confirmationPassword = password;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}/results/${result.id}/storage`, {
        method: removeStored ? "DELETE" : "POST",
        headers: removeStored ? { ...auth, "Content-Type": "application/json" } : auth,
        body: removeStored ? JSON.stringify({ confirmation_password: confirmationPassword }) : undefined,
      });
      if (!response.ok) throw new Error(await errorText(response));
      if (removeStored) {
        const payload = await response.json();
        setResults((current) => current.filter((item) => item.id !== result.id));
        showToast(payload.sheet_log_warning || `Đã xóa lượt làm của ${result.respondent_name}. Người học có thể bắt đầu lại bằng thông tin đã đăng ký.`, Boolean(payload.sheet_log_warning));
        try {
          const detailResponse = await fetch(`/api/digital-training/assessments/${selected.id}`, { headers: auth });
          if (detailResponse.ok) {
            const updated = await detailResponse.json();
            setSelected(updated);
            setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
          }
        } catch {
          // Deletion succeeded; stale summary counts will refresh when the page reloads.
        }
      }
      else {
        const updated = await response.json();
        setResults((current) => current.map((item) => item.id === updated.id ? updated : item));
      }
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const reopenAttempt = async (result: any) => {
    if (!selected) return;
    const extraMinutesText = await appDialog.prompt(
      `Nhập số phút làm thêm cho ${result.respondent_name}. Câu trả lời đã có sẽ được giữ nguyên để tiếp tục.`,
      { title: "Mở tiếp lượt cũ", confirmText: "Tiếp tục", placeholder: "Ví dụ: 30", inputType: "number" },
    );
    if (extraMinutesText === null) return;
    const extraMinutes = Number(extraMinutesText);
    if (!Number.isInteger(extraMinutes) || extraMinutes < 1 || extraMinutes > 10080) {
      setNotice("Vui lòng nhập số phút làm thêm từ 1 đến 10.080 phút.");
      return;
    }
    const password = await confirmWithPassword(
      `Mở tiếp lượt cũ cho ${result.respondent_name} trong ${extraMinutes} phút? Câu trả lời được giữ nguyên; điểm cũ sẽ được xóa để chấm lại sau khi nộp.`,
      "Mở tiếp lượt cũ", "Mở tiếp",
    );
    if (!password) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}/results/${result.id}/reopen`, {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation_password: password, extra_minutes: extraMinutes }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const updated = await response.json();
      setResults((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice(`Đã mở tiếp lượt của ${result.respondent_name} trong ${extraMinutes} phút. Người học nhập đúng thông tin cũ để chọn tiếp tục hoặc tạo lượt mới.`);
      try {
        const detailResponse = await fetch(`/api/digital-training/assessments/${selected.id}`, { headers: auth });
        if (detailResponse.ok) {
          const detail = await detailResponse.json();
          setSelected(detail);
          setItems((current) => current.map((item) => item.id === detail.id ? detail : item));
        }
      } catch {
        // The attempt is already reopened; summary counts refresh on the next load.
      }
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const openAnswerEditor = (result: any) => {
    setEditingAnswerAttempt(result);
    setAnswerDrafts(structuredClone(result.answers || {}));
    setNotice("");
  };

  const saveAnswerEdits = async () => {
    if (!selected || !editingAnswerAttempt) return;
    const changes = Object.fromEntries(Object.entries(answerDrafts).filter(([questionId, value]) =>
      JSON.stringify(value) !== JSON.stringify(editingAnswerAttempt.answers?.[questionId])));
    if (!Object.keys(changes).length) {
      setEditingAnswerAttempt(null);
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}/results/${editingAnswerAttempt.id}/answers`, {
        method: "PATCH", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ answers: changes }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const updated = await response.json();
      setResults((current) => current.map((item) => item.id === updated.id ? updated : item));
      setGradingAttempt((current: any) => current?.id === updated.id ? updated : current);
      setEditingAnswerAttempt(null);
      setNotice(`Đã cập nhật bài làm của ${updated.respondent_name}. Điểm tự động đã được tính lại; các câu chấm tay vừa sửa cần chấm lại.`);
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const confirmWithPassword = async (message: string, title: string, confirmText: string) => {
    const confirmed = await appDialog.confirm(message, { title, confirmText, tone: "danger" });
    if (!confirmed) return null;
    return appDialog.prompt("Nhập mật khẩu tài khoản hiện tại để hoàn tất thao tác.", {
      title: "Xác nhận bằng mật khẩu",
      confirmText: "Xác nhận",
      placeholder: "Mật khẩu hiện tại",
      inputType: "password",
      tone: "danger",
    });
  };

  const openGrading = async (attempt?: any, single = false) => {
    if (!selected) return;
    if (!["closed", "graded"].includes(selected.status)) {
      await appDialog.alert("Chỉ có thể chấm sau khi đóng bài để tránh chấm khi học viên vẫn đang làm. Hãy đóng bài trước, rồi mở lại khi cần.", { title: "Bài kiểm tra đang mở", tone: "warning" });
      return;
    }
    const candidate = attempt || results.find((item) => item.status !== "in_progress" && item.manual_grading_required) || results.find((item) => item.status !== "in_progress");
    if (!candidate) {
      await appDialog.alert("Chưa có bài làm đã nộp hoặc hết giờ để chấm.", { title: "Chưa có bài để chấm" });
      return;
    }
    if (gradingAttempt && screen === "grading" && Object.entries(questionScores).some(([id, value]) => value !== String(gradingAttempt.grading?.[id] ?? gradingAttempt.automatic_grading?.[id] ?? 0))) {
      if (!await appDialog.confirm("Điểm chưa lưu sẽ bị bỏ. Tiếp tục chuyển bài?", { title: "Điểm chưa lưu", confirmText: "Chuyển bài" })) return;
    }
    setSingleGrading(single);
    setShowGradingRoster(false);
    setGradingAttempt(candidate);
    const candidateQuestions = selected.questions.filter((question) => question.variant === candidate.variant);
    setQuestionScores(Object.fromEntries(candidateQuestions.map((question) => {
      const saved = candidate.grading?.[question.id];
      const automatic = candidate.automatic_grading?.[question.id];
      return [question.id, String(saved ?? automatic ?? 0)];
    })));
    setGradingNoteDrafts({});
    setActiveGradingQuestionId("");
    setNotice("");
    setScreen("grading");
  };

  const saveQuestionGrades = async () => {
    if (!selected || !gradingAttempt) return;
    const changedScores = Object.fromEntries(Object.entries(questionScores)
      .filter(([, value]) => String(value).trim() !== "")
      .map(([questionId, value]) => [questionId, Number(value)]));
    const invalid = selected.questions.find((q) => q.variant === gradingAttempt.variant && questionScores[q.id]?.trim() && (!Number.isFinite(Number(questionScores[q.id])) || Number(questionScores[q.id]) < 0 || Number(questionScores[q.id]) > Number(q.points)));
    if (invalid) { setNotice(`Điểm câu ${invalid.order} phải từ 0 đến ${invalid.points}.`); setActiveGradingQuestionId(String(invalid.id)); return; }
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}/results/${gradingAttempt.id}`, {
        method: "PATCH", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ question_scores: changedScores }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const updated = await response.json();
      const refreshed = results.map((item) => item.id === updated.id ? updated : item);
      setResults(refreshed);
      setGradingAttempt(updated);
      // Re-initialize using the same logic as openGrading: teacher override > auto-grade > 0
      const variantQs = selected.questions.filter((q) => q.variant === updated.variant);
      setQuestionScores(Object.fromEntries(variantQs.map((q) => [q.id, String(updated.grading?.[q.id] ?? updated.automatic_grading?.[q.id] ?? 0)])));
      setNotice(updated.manual_grading_required ? "Đã lưu điểm. Vẫn còn câu cần chấm." : "Đã lưu điểm bài làm.");
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const importGradesFromSheet = async () => {
    if (!selected) return;
    const confirmed = await appDialog.confirm(
      "Điểm thực hành hoặc Tổng điểm trong các tab BÀI LÀM ĐỀ sẽ cập nhật ngược vào hệ thống. Câu trả lời và thông tin học viên sẽ không bị ghi đè.",
      { title: "Đồng bộ điểm từ Google Sheet", confirmText: "Đồng bộ điểm", tone: "warning" },
    );
    if (!confirmed) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}/import-sheet-grades`, { method: "POST", headers: auth });
      if (!response.ok) throw new Error(await errorText(response));
      const outcome = await response.json();
      const resultsResponse = await fetch(`/api/digital-training/assessments/${selected.id}/results`, { headers: auth });
      if (!resultsResponse.ok) throw new Error(await errorText(resultsResponse));
      const refreshed = await resultsResponse.json();
      setResults(refreshed);
      setManualScores(Object.fromEntries(refreshed.map((result: any) => [result.id, String(result.score ?? "")])));
      setNotice(outcome.errors?.length
        ? `Đã cập nhật ${outcome.updated} bài; ${outcome.errors.length} dòng cần kiểm tra: ${outcome.errors[0]}`
        : `Đã đồng bộ điểm từ Sheet cho ${outcome.updated} bài làm.`);
    } catch (error: any) { setNotice(String(error?.message || error)); } finally { setBusy(false); }
  };

  const saveGradingNote = async (questionId: string, note: string) => {
    if (!selected || !gradingAttempt || !note.trim()) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}/results/${gradingAttempt.id}`, {
        method: "PATCH", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ grading_note: note.trim(), question_id: questionId }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const updated = await response.json();
      setResults((current) => current.map((item) => item.id === updated.id ? updated : item));
      setGradingAttempt(updated);
      setGradingNoteDrafts((current) => ({ ...current, [questionId]: "" }));
      setNotice("Đã lưu ghi chú của người chấm.");
    } catch (error: any) { setNotice(String(error?.message || error)); } finally { setBusy(false); }
  };

  const returnToList = () => {
    if (selected && window.history.state?.trainingAssessmentId === selected.id) {
      window.history.back();
      return;
    }
    if (window.location.pathname !== "/training-assessments") window.history.pushState(null, "", "/training-assessments");
    setScreen("list");
    setSelected(null);
    setResults([]);
  };

  const syncPendingResults = async () => {
    if (!selected) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}/results/sync-pending`, { method: "POST", headers: auth });
      if (!response.ok) throw new Error(await errorText(response));
      const outcome = await response.json();
      const resultsResponse = await fetch(`/api/digital-training/assessments/${selected.id}/results`, { headers: auth });
      const refreshed = resultsResponse.ok ? await resultsResponse.json() : results;
      setResults(refreshed);
      const completed = refreshed.filter((item: any) => item.status !== "in_progress");
      const syncCounts = {
        pending: completed.filter((item: any) => item.sync_status === "pending").length,
        error: completed.filter((item: any) => item.sync_status === "error").length,
        synced: completed.filter((item: any) => item.sync_status === "synced").length,
      };
      setSelected((current) => current ? { ...current, sync_counts: syncCounts } : current);
      setItems((current) => current.map((item) => item.id === selected.id ? { ...item, sync_counts: syncCounts } : item));
      setNotice(outcome.remaining ? `Đã thử đồng bộ ${outcome.attempted} lượt; còn ${outcome.remaining} lượt cần kiểm tra lỗi.` : `Đã đồng bộ ${outcome.attempted} lượt còn tồn.`);
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const applyLocation = () => {
      const match = window.location.pathname.match(/^\/training-assessments\/(\d+)\/?$/);
      const requestedId = Number(match?.[1]);
      const item = items.find((candidate) => candidate.id === requestedId);
      if (item) {
        if (!selected || selected.id !== item.id || screen !== "detail") void openDetail(item, false);
        return;
      }
      setScreen("list");
      setSelected(null);
      setResults([]);
    };
    applyLocation();
    window.addEventListener("popstate", applyLocation);
    return () => window.removeEventListener("popstate", applyLocation);
  }, [items]);

  const endAttempt = async (result: any) => {
    if (!selected) return;
    const password = await confirmWithPassword(
      `Kết thúc ngay lượt làm của ${result.respondent_name}. Người này sẽ không thể tiếp tục làm hoặc nộp bài.`,
      "Kết thúc lượt làm",
      "Kết thúc lượt làm",
    );
    if (!password) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}/results/${result.id}/kick`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation_password: password }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const updated = await response.json();
      setResults((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSelected((current) => current ? { ...current, submitted_count: current.submitted_count + 1 } : current);
      setItems((current) => current.map((item) => item.id === selected.id ? { ...item, submitted_count: item.submitted_count + 1 } : item));
      setNotice(`Đã kết thúc lượt làm của ${result.respondent_name}.`);
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (status: Assessment["status"]) => {
    if (!selected) return;
    if (status === "closed") {
      const confirmed = await appDialog.confirm(
        "Đóng bài sẽ kết thúc ngay các lượt làm còn đang mở. Người học sẽ không thể tiếp tục làm bài.",
        { title: "Đóng bài kiểm tra", confirmText: "Đóng bài", tone: "warning" },
      );
      if (!confirmed) return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}`, {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const updated = await response.json();
      setSelected(updated);
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const saveSchedule = async () => {
    if (!selected) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}`, {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          opens_at: scheduleDraft.opens_at ? new Date(scheduleDraft.opens_at).toISOString() : null,
          closes_at: scheduleDraft.closes_at ? new Date(scheduleDraft.closes_at).toISOString() : null,
        }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const updated = await response.json();
      setSelected(updated);
      setScheduleDraft({ opens_at: toDateTimeLocal(updated.opens_at), closes_at: toDateTimeLocal(updated.closes_at) });
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice("Đã lưu lịch mở/đóng bài.");
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const saveAssessmentDetails = async () => {
    if (!selected) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}`, {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          duration_minutes: Number(detailDraft.duration_minutes),
          attempt_limit: Number(detailDraft.attempt_limit),
          description: detailDraft.description.trim(),
          instructions: detailDraft.instructions.trim(),
        }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const updated = await response.json();
      setSelected(updated);
      setDetailDraft({ duration_minutes: String(updated.duration_minutes), attempt_limit: String(updated.attempt_limit), description: updated.description || "", instructions: updated.instructions || "" });
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice("Đã cập nhật chi tiết bài kiểm tra.");
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    const hasAttempts = selected.attempts_count > 0;
    const hasActive = results.some((item) => item.status === "in_progress");
    let confirmMsg = `Xóa "${selected.title}" và toàn bộ lượt làm bài?`;
    if (hasActive) {
      confirmMsg = `Bài có lượt đang chờ đồng bộ. Xóa sẽ mất dữ liệu! Tiếp tục?`;
    } else if (hasAttempts) {
      confirmMsg = `Bài có ${selected.submitted_count} lượt đã nộp. Xóa toàn bộ?`;
    }
    const password = hasActive
      ? await confirmWithPassword(confirmMsg, "Xóa bài đang có người làm", "Xóa bài và kết thúc lượt làm")
      : (await appDialog.confirm(confirmMsg, { title: "Xóa bài kiểm tra", confirmText: "Xóa bài kiểm tra", tone: "danger" }) ? "" : null);
    if (password === null) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/digital-training/assessments/${selected.id}`, {
        method: "DELETE",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ force: true, confirmation_password: password }),
      });
      if (!response.ok) {
        const errText = await errorText(response);
        // 409 = active users or force needed
        throw new Error(errText);
      }
      setItems((current) => current.filter((item) => item.id !== selected.id));
      returnToList();
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const workbook = XLSX.utils.book_new();
    const sampleRows = [
      {
        STT: 1, "Loại câu": "Trắc nghiệm", "Câu hỏi": "Nội dung câu hỏi mẫu",
        A: "Phương án A", B: "Phương án B", C: "Phương án C", D: "Phương án D",
        "Đáp án": "B", Điểm: 1, "Bắt buộc": "Có",
        "Chủ đề": "Kiến thức chung", "Độ khó": "Trung bình", "Giải thích": "", "Hình ảnh": "",
      },
      {
        STT: 2, "Loại câu": "Trả lời ngắn", "Câu hỏi": "Nhập câu trả lời ngắn",
        A: "", B: "", C: "", D: "", "Đáp án": "Câu trả lời mẫu", Điểm: 1,
        "Bắt buộc": "Có", "Chủ đề": "Vận dụng", "Độ khó": "Khó", "Giải thích": "", "Hình ảnh": "",
      },
      {
        STT: 3, "Loại câu": "Tải ảnh", "Câu hỏi": "Tải ảnh kết quả bài thực hành",
        A: "", B: "", C: "", D: "", "Đáp án": "", Điểm: 2,
        "Bắt buộc": "Có", "Chủ đề": "Thực hành", "Độ khó": "Trung bình", "Giải thích": "", "Hình ảnh": "",
      },
    ];
    if (importMode === "auto_generate") {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sampleRows), "Câu hỏi nguồn");
      XLSX.writeFile(workbook, "mau_nguon_cau_hoi_tu_dong.xlsx");
      return;
    }
    const guide = XLSX.utils.aoa_to_sheet([
      ["HƯỚNG DẪN"],
      ["Mỗi sheet Đề 1, Đề 2... là một mã đề hoàn chỉnh."],
      ["Có thể thêm hoặc bớt sheet; không đổi tên các cột dữ liệu."],
      ["Mỗi dòng là một câu hỏi. Các sheet nên có cùng số câu và tổng điểm."],
    ]);
    XLSX.utils.book_append_sheet(workbook, guide, "Hướng dẫn");
    for (let index = 1; index <= 5; index += 1) {
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(sampleRows),
        `Đề ${index}`,
      );
    }
    XLSX.writeFile(workbook, "mau_5_ma_de_soan_san.xlsx");
  };

  const exportResults = () => {
    if (!selected || !results.length) return;
    const rows = results.map((item, index) => ({
      STT: index + 1,
      "Họ và tên": item.respondent_name,
      Email: item.email,
      "Số điện thoại": item.phone,
      "Tổ chuyên môn/Phòng ban": item.organization,
      "Chức vụ": item.position || "",
      "Mã đề": item.variant,
      Điểm: Number(item.score || 0),
      "Điểm tối đa": Number(item.max_score || 0),
      "Đánh giá": completionLabel(item),
      "Trạng thái": item.status,
      "Thời gian bắt đầu": item.started_at,
      "Thời gian nộp bài": item.submitted_at,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Kết quả");
    XLSX.writeFile(workbook, `ket_qua_${selected.public_slug}.xlsx`);
  };

  if (screen === "bank" && preview) {
    return <section className="mt-6 space-y-5">
      <button onClick={() => setScreen("create")} className="inline-flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft className="h-4 w-4" />Quay lại cấu hình đợt thi</button>
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase text-emerald-600">Ngân hàng câu hỏi</p><h2 className="mt-1 text-2xl font-extrabold">{preview.source_name}</h2><p className="mt-1 text-sm text-slate-500">{bankQuestions.length} câu · nguồn {preview.source_type === "google_sheet" ? "Google Sheets" : "XLSX"}</p></div>{preview.source_url && <a href={preview.source_url} target="_blank" rel="noreferrer" className="ft-btn ft-btn-secondary"><ExternalLink className="h-4 w-4" />Mở Google Sheet</a>}</div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">{(["category", "knowledge_type", "type", "difficulty"] as const).map((field) => <label key={field}><span className="mb-1 block text-xs font-bold uppercase text-slate-500">{field === "category" ? "Chủ đề" : field === "knowledge_type" ? "Loại câu" : field === "type" ? "Kiểu câu" : "Độ khó"}</span><select className="ft-input" value={bankFilters[field]} onChange={(event) => setBankFilters({ ...bankFilters, [field]: event.target.value })}><option value="">Tất cả</option>{bankFilterOptions(field).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>)}</div>
        <div className="mt-5 overflow-x-auto rounded-xl border"><table className="ft-table min-w-[1400px]"><thead><tr><th>Mã câu</th><th>Nhóm</th><th>Chủ đề</th><th>Loại</th><th>Kiểu</th><th>Độ khó</th><th>Nội dung</th><th>Phương án</th><th>Điểm</th></tr></thead><tbody>{filteredBankQuestions.map((question) => <tr key={question.id}><td className="font-mono text-xs">{question.question_code}</td><td>{question.audience_group}</td><td>{question.category || "-"}</td><td>{question.knowledge_type || "-"}</td><td>{question.type}</td><td>{question.difficulty || "-"}</td><td className="max-w-xl whitespace-normal"><b>{question.text}</b>{question.media_url && <span className="mt-1 block text-xs text-blue-600">Media: {question.media_url}</span>}</td><td>{(question.options || []).length}</td><td>{question.points}</td></tr>)}</tbody></table></div>
      </div>
    </section>;
  }

  if (screen === "create") {
    return (
      <section className="mt-6 space-y-5">
        <button onClick={() => setScreen("list")} className="inline-flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft className="h-4 w-4" />Quay lại danh sách</button>
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-xs font-bold uppercase tracking-wider text-blue-600">Bài kiểm tra cuối khóa tập huấn</p><h2 className="mt-1 text-2xl font-extrabold">Tạo một link, chia đều nhiều mã đề</h2><p className="mt-2 text-sm text-slate-500">Chọn nhập đề soạn sẵn hoặc tự động sinh mã đề trực tiếp từ XLSX/Google Sheet.</p></div>
            <button onClick={downloadTemplate} className="ft-btn ft-btn-secondary"><Download className="h-4 w-4" />{importMode === "auto_generate" ? "Tải mẫu nguồn câu hỏi" : "Tải mẫu 5 mã đề"}</button>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => { setImportMode("prepared"); setPreview(null); setTopicConfigs({}); setStructureDirty(false); }}
              className={`rounded-2xl border-2 p-4 text-left transition ${importMode === "prepared" ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:border-blue-200"}`}
            >
              <span className="flex items-center gap-2 font-extrabold text-[#001e40]"><Layers3 className="h-5 w-5 text-blue-600" />Nhập 4–5 đề soạn sẵn</span>
              <span className="mt-2 block text-sm text-slate-600">Một file XLSX/Google Sheet, mỗi mã đề là một sheet hoàn chỉnh.</span>
            </button>
            <button
              type="button"
              onClick={() => { setImportMode("auto_generate"); setPreview(null); setTopicConfigs({}); setStructureDirty(false); }}
              className={`rounded-2xl border-2 p-4 text-left transition ${importMode === "auto_generate" ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white hover:border-emerald-200"}`}
            >
              <span className="flex items-center gap-2 font-extrabold text-[#001e40]"><Shuffle className="h-5 w-5 text-emerald-600" />Sinh đề từ ngân hàng chuẩn</span>
              <span className="mt-2 block text-sm text-slate-600">Chọn nhóm đối tượng, chủ đề và cơ cấu đề ngay khi tạo bài.</span>
            </button>
          </div>
          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,.8fr)]">
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Tên bài *</span><input className="ft-input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Bài kiểm tra cuối học phần" /></label>
                <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Đơn vị / phân lớp *</span><select className="ft-input" value={draft.target} onChange={(event) => { const target = event.target.value; setDraft({ ...draft, target, audience_group: audienceGroupForTarget(target) }); setTopicConfigs({}); setStructureDirty(true); }}><option value="">Chọn đơn vị hoặc phân lớp</option>{targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select><small className="mt-1 block text-slate-500">Mỗi đơn vị/phân lớp chỉ có một khảo sát kết thúc tập huấn và một link công khai.</small></label>
                {importMode === "auto_generate" ? <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Nhóm đối tượng *</span><select className="ft-input" disabled={!audienceGroupOptions.length} value={draft.audience_group} onChange={(event) => { setDraft({ ...draft, audience_group: event.target.value }); setTopicConfigs({}); setStructureDirty(true); }}><option value="">{audienceGroupOptions.length ? "Chọn nhóm đối tượng" : "Chưa có chỉ mục ngân hàng"}</option>{audienceGroupOptions.map((group) => <option key={group} value={group}>{group}</option>)}</select><small className="mt-1 block text-slate-500">{selectedTargetPartner?.partner_subtype ? `Đã tự mapping theo phân loại khách hàng: ${selectedTargetPartner.partner_subtype}.` : "Chọn nhóm theo phân loại khách hàng. Chỉ mục giúp hiện chủ đề và số lượng ngay; khi tạo đề hệ thống đọc Google Sheet nguồn để random câu hỏi."}</small></label> : (preview?.available_groups || []).length > 0 && <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Nhóm đối tượng trong ngân hàng *</span><select className="ft-input" value={draft.audience_group} onChange={(event) => { setDraft({ ...draft, audience_group: event.target.value }); setPreview(null); }}><option value="">Chọn nhóm đối tượng</option>{(preview?.available_groups || []).map((group) => <option key={group} value={group}>{group}</option>)}</select></label>}
                <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Google Sheet đầu ra của đợt thi</span><input type="url" className="ft-input" value={draft.output_sheet_url} onChange={(event) => setDraft({ ...draft, output_sheet_url: event.target.value })} placeholder="https://docs.google.com/spreadsheets/d/..." /><small className="mt-1 block text-slate-500">Dùng file riêng của khách hàng; hệ thống tạo các trang Tổng quan, Phân đề, Đề, Bài làm và Nhật ký xóa.</small></label>
                <fieldset className="sm:col-span-2 rounded-xl border bg-slate-50 p-4"><legend className="px-2 text-sm font-extrabold text-slate-800">Nơi lưu tệp bài làm trên Google Drive</legend><label><span className="mb-1 block text-sm font-bold">ID thư mục gốc</span><input className="ft-input bg-white" value={draft.drive_folder_id} onChange={(event) => setDraft({ ...draft, drive_folder_id: event.target.value })} placeholder="Ví dụ: 1AbC... lấy từ URL thư mục Drive" /></label><p className="mt-2 text-xs text-slate-500">Hệ thống tự tạo thư mục theo khách hàng và theo họ tên người làm; nếu trùng tên sẽ thêm email để không lẫn tệp.</p></fieldset>
                <label><span className="mb-1 block text-sm font-bold">Thời gian làm bài (phút)</span><input type="number" min="1" max="480" className="ft-input" value={draft.duration_minutes} onChange={(event) => setDraft({ ...draft, duration_minutes: event.target.value })} /></label>
                <label><span className="mb-1 block text-sm font-bold">Số lượt tối đa/người</span><input type="number" min="1" max="20" className="ft-input" value={draft.attempt_limit} onChange={(event) => setDraft({ ...draft, attempt_limit: event.target.value })} /></label>
                <label><span className="mb-1 block text-sm font-bold">Mở từ</span><input type="datetime-local" className="ft-input" value={draft.opens_at} onChange={(event) => setDraft({ ...draft, opens_at: event.target.value })} /></label>
                <label><span className="mb-1 block text-sm font-bold">Đóng lúc</span><input type="datetime-local" className="ft-input" value={draft.closes_at} onChange={(event) => setDraft({ ...draft, closes_at: event.target.value })} /></label>
                <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Mô tả</span><textarea className="ft-input min-h-20" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
                <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Hướng dẫn người làm</span><textarea className="ft-input min-h-24" value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} /></label>
              </div>
            </div>
            <div className="rounded-2xl border bg-slate-50 p-5">
              <h3 className="font-extrabold">{importMode === "auto_generate" ? "Ngân hàng câu hỏi chuẩn FermatTech" : "Nguồn các mã đề"}</h3>
              {importMode === "auto_generate" && <div className="mt-3 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-sm font-bold text-emerald-900">Chọn nguồn ngân hàng đề thi và đọc lại dữ liệu trước khi cấu hình.</p>
                <div className="grid gap-2 text-sm font-bold">
                  <label className="rounded-lg border bg-white p-2"><input type="radio" className="mr-2" checked={bankSource === "default"} onChange={() => { setBankSource("default"); setPreview(null); setDraft({ ...draft, audience_group: "" }); }} />Tạo đề từ ngân hàng đề mặc định</label>
                  <label className="rounded-lg border bg-white p-2"><input type="radio" className="mr-2" checked={bankSource === "other"} onChange={() => { setBankSource("other"); setPreview(null); setDraft({ ...draft, audience_group: "" }); }} />Sử dụng ngân hàng khác</label>
                </div>
                {bankSource === "default" ? <p className="break-all text-xs text-emerald-800">{bankSettings.default_url || "Chua cau hinh lien ket mac dinh."}</p> : <label><span className="mb-1 block text-xs font-bold text-emerald-900">Lien ket Google Sheet / Drive</span><input className="ft-input bg-white" value={sheetUrl} onChange={(event) => { setSheetUrl(event.target.value); setPreview(null); }} placeholder="https://docs.google.com/... hoac https://drive.google.com/file/d/..." /></label>}
                <div className="grid gap-3 sm:grid-cols-2"><button type="button" disabled={busy} onClick={refreshQuestionBank} className="ft-btn ft-btn-secondary justify-center"><RefreshCw className="h-4 w-4" />Đọc / cập nhật ngân hàng</button><label><span className="mb-1 block text-xs font-bold text-emerald-900">Số mã đề</span><input type="number" min="1" max="200" className="ft-input bg-white" value={variantCount} onChange={(event) => { setVariantCount(event.target.value); setStructureDirty(true); }} /><small className="mt-1 block text-amber-800">Khuyến nghị chia tối đa 12 người/mã đề. Hệ thống vẫn cho phép vượt ngưỡng và tự chia đều theo số lượt thực tế.</small></label></div>
              </div>}          {importMode === "auto_generate" && <><div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-extrabold uppercase text-emerald-700">Thiết lập đề từ ngân hàng</p><h3 className="mt-1 text-lg font-extrabold">Chủ đề, loại câu và độ khó</h3><p className="mt-1 text-sm text-slate-600">Số liệu dưới đây được tính từ lần đọc ngân hàng gần nhất. Khi bấm tạo, hệ thống đọc lại file và kiểm tra đúng cơ cấu này.</p></div><b className="rounded-full bg-white px-3 py-1 text-xs text-emerald-700">{draft.audience_group || "Chưa chọn nhóm"}</b></div><div className="mt-4 grid gap-3 md:grid-cols-3"><label><span className="mb-1 block text-xs font-bold">Số câu mỗi đề *</span><input type="number" min="1" max="200" className="ft-input bg-white" value={questionsPerVariant} onChange={(event) => { setQuestionsPerVariant(event.target.value); setStructureDirty(true); }} /></label><label><span className="mb-1 block text-xs font-bold">Câu Lý thuyết *</span><input type="number" min="0" className="ft-input bg-white" value={knowledgeCounts.theory} onChange={(event) => { setKnowledgeCounts({ ...knowledgeCounts, theory: event.target.value }); setStructureDirty(true); }} /></label><label><span className="mb-1 block text-xs font-bold">Câu Thực hành *</span><input type="number" min="0" className="ft-input bg-white" value={knowledgeCounts.practice} onChange={(event) => { setKnowledgeCounts({ ...knowledgeCounts, practice: event.target.value }); setStructureDirty(true); }} /></label></div><div className="mt-3 grid gap-3 md:grid-cols-3"><label><span className="mb-1 block text-xs font-bold">Câu Dễ *</span><input type="number" min="0" className="ft-input bg-white" value={difficultyCounts.easy} onChange={(event) => { setDifficultyCounts({ ...difficultyCounts, easy: event.target.value }); setStructureDirty(true); }} /></label><label><span className="mb-1 block text-xs font-bold">Câu Trung bình *</span><input type="number" min="0" className="ft-input bg-white" value={difficultyCounts.medium} onChange={(event) => { setDifficultyCounts({ ...difficultyCounts, medium: event.target.value }); setStructureDirty(true); }} /></label><label><span className="mb-1 block text-xs font-bold">Câu Khó *</span><input type="number" min="0" className="ft-input bg-white" value={difficultyCounts.hard} onChange={(event) => { setDifficultyCounts({ ...difficultyCounts, hard: event.target.value }); setStructureDirty(true); }} /></label></div><div className="mt-3 grid gap-3 md:grid-cols-2"><label><span className="mb-1 block text-xs font-bold">Điểm mỗi câu Lý thuyết</span><input type="number" min="0" step="0.25" className="ft-input bg-white" value={scoreConfig.theory} onChange={(event) => { setScoreConfig({ ...scoreConfig, theory: event.target.value }); setStructureDirty(true); }} /></label><label><span className="mb-1 block text-xs font-bold">Điểm mỗi câu Thực hành</span><input type="number" min="0" step="0.25" className="ft-input bg-white" value={scoreConfig.practice} onChange={(event) => { setScoreConfig({ ...scoreConfig, practice: event.target.value }); setStructureDirty(true); }} /></label></div><div className="mt-4"><div className="flex items-center justify-between gap-2"><b className="text-sm">Chủ đề áp dụng</b><span className="text-xs text-slate-500">Tổng đã chọn: {topicConfigTotal}/{questionsPerVariantCount} câu</span></div>{draft.audience_group ? <div className="mt-2 grid gap-2">{topicRows.map((row) => { const config = topicConfigs[row.category] || { total: "0", theory: "0", practice: "0" }; return <div key={row.category} className="grid gap-3 rounded-xl border bg-white p-3 sm:grid-cols-[minmax(0,1fr)_88px_88px_88px]"><span><b className="block text-sm">{row.category}</b><span className="text-xs text-slate-500">Có {row.available} câu · LT {row.theory} · TH {row.practice} · Dễ {row.easy} · TB {row.medium} · Khó {row.hard}</span></span><label><span className="mb-1 block text-[11px] font-bold text-slate-500">TỔNG</span><input aria-label={`Tổng câu ${row.category}`} type="number" min="0" max={row.available} className="ft-input text-center" value={config.total} onChange={(event) => { setTopicConfigs((current) => ({ ...current, [row.category]: { ...config, total: event.target.value } })); setStructureDirty(true); }} /></label><label><span className="mb-1 block text-[11px] font-bold text-slate-500">LÝ THUYẾT</span><input aria-label={`Lý thuyết ${row.category}`} type="number" min="0" max={row.theory} className="ft-input text-center" value={config.theory} onChange={(event) => { setTopicConfigs((current) => ({ ...current, [row.category]: { ...config, theory: event.target.value } })); setStructureDirty(true); }} /></label><label><span className="mb-1 block text-[11px] font-bold text-slate-500">THỰC HÀNH</span><input aria-label={`Thực hành ${row.category}`} type="number" min="0" max={row.practice} className="ft-input text-center" value={config.practice} onChange={(event) => { setTopicConfigs((current) => ({ ...current, [row.category]: { ...config, practice: event.target.value } })); setStructureDirty(true); }} /></label></div>; })}</div> : <p className="mt-2 text-sm text-slate-500">Bấm Đọc / cập nhật ngân hàng, sau đó chọn nhóm đối tượng để hiện số liệu thật.</p>}</div>{(topicConfigInvalid || topicKnowledgeConfigInvalid || knowledgeConfigInvalid || difficultyConfigInvalid || scoreConfigInvalid) && <p className="mt-3 rounded-lg bg-rose-50 p-2 text-xs font-bold text-rose-700">Mỗi chủ đề phải có Tổng = Lý thuyết + Thực hành; tổng chủ đề, Lý thuyết + Thực hành và Dễ + Trung bình + Khó đều phải bằng {questionsPerVariantCount}; điểm không âm.</p>}</div><div className="mt-4 space-y-3"><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={draft.status === "published"} onChange={(event) => setDraft({ ...draft, status: event.target.checked ? "published" : "draft" })} />Phát hành ngay sau khi tạo</label><button disabled={busy} onClick={createAssessment} className="ft-primary w-full justify-center disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Tạo khảo sát kết thúc</button></div></>}              {importMode === "prepared" && <div className="mt-3 grid grid-cols-2 rounded-xl bg-slate-200 p-1 text-sm font-bold">
                <button onClick={() => { setSourceMode("xlsx"); setPreview(null); setTopicConfigs({}); setStructureDirty(false); }} className={`rounded-lg px-3 py-2 ${sourceMode === "xlsx" ? "bg-white shadow-sm" : ""}`}>Tệp XLSX</button>
                <button onClick={() => { setSourceMode("google_sheet"); setPreview(null); setTopicConfigs({}); setStructureDirty(false); }} className={`rounded-lg px-3 py-2 ${sourceMode === "google_sheet" ? "bg-white shadow-sm" : ""}`}>Google Sheet / Drive</button>
              </div>}
              {importMode === "prepared" && (sourceMode === "xlsx" ? <label className="mt-4 flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-slate-300 bg-white p-6 text-center"><FileSpreadsheet className="h-9 w-9 text-emerald-600" /><b className="mt-2">{file?.name || "Chọn file .xlsx hoặc .xlsm"}</b><span className="mt-1 text-xs text-slate-500">{importMode === "prepared" ? "Một file chứa toàn bộ 4–5 sheet đề" : "Một ngân hàng có thể gồm nhiều sheet/nhóm câu hỏi"} · Tối đa 10 MB</span><input type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); }} /></label> : <label className="mt-4 block"><span className="mb-1 block text-sm font-bold">Đường dẫn Google Sheet / Google Drive</span><input className="ft-input" value={sheetUrl} onChange={(event) => { setSheetUrl(event.target.value); setPreview(null); }} placeholder="https://docs.google.com/... hoặc https://drive.google.com/file/d/..." /><small className="mt-2 block text-slate-500">Nguồn cần bật quyền xem qua liên kết. Hệ thống đọc toàn bộ các tab/nhóm câu hỏi.</small></label>)}
              {importMode === "prepared" && <button disabled={busy} onClick={importQuestions} className="ft-primary mt-4 w-full justify-center"><Upload className="h-4 w-4" />Đọc và kiểm tra dữ liệu</button>}
              {preview && <div className="mt-4 space-y-3">
                <div className={`grid gap-2 ${preview.import_mode === "auto_generate" ? "grid-cols-3" : "grid-cols-2"}`}>
                  {preview.import_mode === "auto_generate" && <div className="rounded-lg bg-white p-3"><b className="text-xl">{preview.source_question_count}</b><span className="block text-xs text-slate-500">câu trong file nguồn</span></div>}
                  <div className="rounded-lg bg-white p-3"><b className="text-xl">{preview.variants.length}</b><span className="block text-xs text-slate-500">mã đề</span></div>
                  <div className="rounded-lg bg-white p-3"><b className="text-xl">{preview.question_count}</b><span className="block text-xs text-slate-500">câu sau khi chia</span></div>
                </div>
                <div className="flex flex-wrap gap-2">{preview.variants.map((variant) => <span key={variant.name} className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">{variant.name}: {variant.question_count} câu</span>)}</div>
                                {!!bankQuestions.length && <button type="button" onClick={() => setScreen("bank")} className="ft-btn ft-btn-secondary w-full justify-center"><FileSpreadsheet className="h-4 w-4" />Mở trang ngân hàng câu hỏi ({bankQuestions.length})</button>}
                {preview.warnings.map((warning) => <p key={warning} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">{warning}</p>)}
                {preview.question_errors?.map((error, index) => <div key={`${error.source}-${index}`} className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800"><b>{error.question_code ? `Câu ${error.question_code}` : "Câu hỏi"}{error.variant ? ` · ${error.variant}` : ""}</b>{error.source && <span className="ml-1 text-rose-600">({error.source})</span>}<p className="mt-1">{error.message}</p>{error.question_id && <button type="button" onClick={() => setEditingPreviewQuestionId(error.question_id || "")} className="mt-2 inline-flex items-center gap-1 rounded border border-rose-300 bg-white px-2 py-1 font-bold text-rose-700"><Pencil className="h-3 w-3" />Sửa câu này</button>}</div>)}
                {!preview.question_errors?.length && preview.errors.map((error) => <p key={error} className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</p>)}
                <div className="max-h-[34rem] space-y-2 overflow-y-auto rounded-xl border bg-white p-2">
                  <p className="px-2 pt-1 text-xs font-extrabold uppercase text-slate-500">Xem trước từng mã đề</p>
                  {preview.variants.map((variant, variantIndex) => <details key={variant.name} open={variantIndex === 0} className="rounded-lg border">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-extrabold text-[#001e40]">{variant.name} · {variant.question_count} câu</summary>
                    <ol className="space-y-2 border-t p-3">
                      {preview.questions.filter((q) => q.variant === variant.name).map((q) => {
                        const correctSet = new Set((q.correct_answers || []).map(String));
                        return <li key={q.id} className="rounded-lg border bg-slate-50 p-3 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <b className="text-slate-800">{q.order}. {q.text}</b>
                            <span className="flex shrink-0 items-center gap-1"><span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">{q.points}đ</span><button type="button" aria-label={`Sửa ${q.question_code || `câu ${q.order}`}`} onClick={() => setEditingPreviewQuestionId(q.id)} className="rounded border bg-white p-1 text-blue-700"><Pencil className="h-3 w-3" /></button></span>
                          </div>
                          {editingPreviewQuestionId === q.id && <QuestionEditor question={q} onChange={updatePreviewQuestion} onClose={() => setEditingPreviewQuestionId("")} />}
                          {q.category && <span className="mt-1 inline-block rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700">{q.category}{q.difficulty ? ` · ${q.difficulty}` : ""}</span>}
                          {(q.options || []).length > 0 && <ul className="mt-2 space-y-1">
                            {(q.options || []).map((opt: any) => {
                              const isCorrect = correctSet.has(String(opt.key));
                              return <li key={opt.key} className={`flex items-start gap-2 rounded px-2 py-1 ${isCorrect ? "bg-emerald-50 text-emerald-800" : "text-slate-600"}`}>
                                <span className={`shrink-0 font-black ${isCorrect ? "text-emerald-600" : "text-slate-400"}`}>{opt.key}.</span>
                                <span>{opt.text}</span>
                                {isCorrect && <span className="ml-auto shrink-0 text-emerald-600">✓</span>}
                              </li>;
                            })}
                          </ul>}
                          {q.type === "short_answer" && (q.correct_answers || []).length > 0 && (
                            <p className="mt-2 rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800">
                              Đáp án mẫu: {(q.correct_answers || []).join(" / ")}
                            </p>
                          )}
                          {(q.type === "practical_submission" || q.type === "file_upload") && (
                            <p className="mt-1 text-[11px] italic text-slate-500">Câu tải ảnh / nộp tệp — chấm thủ công</p>
                          )}
                        </li>;
                      })}
                    </ol>
                  </details>)}
                </div>
              </div>}
            </div>
          </div>
          {notice && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{notice}</p>}
          {importMode === "prepared" && (<div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
            <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={draft.status === "published"} onChange={(event) => setDraft({ ...draft, status: event.target.checked ? "published" : "draft" })} />Phát hành ngay sau khi tạo</label>
            <button disabled={busy || (importMode === "prepared" && (!preview || (preview.errors.length > 0 && !previewEdited) || structureDirty))} onClick={createAssessment} className="ft-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Tạo khảo sát kết thúc</button>
          </div>)}
        </div>
      </section>
    );
  }

  if (screen === "grading" && selected && gradingAttempt) {
    const gradingQuestions = selected.questions.filter((question) => question.variant === gradingAttempt.variant).slice().sort((left, right) => Number(left.order) - Number(right.order));
    const gradingCandidates = results.filter((item) => item.status !== "in_progress");
    const gradingIndex = gradingCandidates.findIndex((item) => item.id === gradingAttempt.id);
    const previousAttempt = gradingCandidates[gradingIndex - 1];
    const nextAttempt = gradingCandidates[gradingIndex + 1];
    const activeQuestion = gradingQuestions.find((question) => String(question.id) === activeGradingQuestionId) || gradingQuestions[0];
    const chooseQuestion = (id: string) => setActiveGradingQuestionId(id);
    const isChoice = (q: any) => ["single_choice", "multiple_choice"].includes(q.type);
    const isCorrectOption = (q: any, key: any) => isChoice(q) && (q.correct_answers || []).some((value: any) => String(value).trim().toUpperCase() === String(key).trim().toUpperCase());
    const isSelectedOption = (q: any, key: any) => {
      if (!isChoice(q)) return false;
      const answer = gradingAttempt.answers?.[q.id];
      const values = Array.isArray(answer) ? answer : String(answer ?? "").split(/[,;|]/);
      return values.some((value: any) => String(value).trim().toUpperCase() === String(key).trim().toUpperCase());
    };
    const dirty = Object.entries(questionScores).some(([id, value]) => value !== String(gradingAttempt.grading?.[id] ?? gradingAttempt.automatic_grading?.[id] ?? ""));
    const leaveGrading = async () => {
      if (dirty && !await appDialog.confirm("Điểm chưa lưu sẽ bị bỏ. Quay lại danh sách?", { title: "Điểm chưa lưu", confirmText: "Quay lại" })) return;
      setScreen("detail");
    };
    const activeIndex = gradingQuestions.findIndex((q) => q.id === activeQuestion?.id);
    return createPortal(
      <section className="assessment-grading fixed inset-0 z-40 flex h-dvh flex-col bg-slate-100 text-slate-900" aria-label="Không gian chấm bài">
        <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-6">
          <div className="flex items-start gap-3">
            <button disabled={busy} onClick={() => void leaveGrading()} className="ft-btn ft-btn-secondary shrink-0" title="Quay lại bài kiểm tra" aria-label="Quay lại bài kiểm tra"><ArrowLeft className="h-4 w-4" /></button>
            <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase text-blue-700">Chấm bài · {singleGrading ? "Bài làm đã chọn" : `Bài ${gradingIndex + 1}/${gradingCandidates.length}`} · {gradingAttempt.variant}</p><h1 className="mt-1 line-clamp-2 text-base font-extrabold sm:text-lg">{selected.title}</h1><p className="mt-1 break-words text-sm text-slate-600"><span className="font-semibold">Đơn vị:</span> {selected.partner_name || "Chưa có thông tin đơn vị"}</p></div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2 text-sm" aria-label="Thông tin học viên">
            <div><b className="text-base">{gradingAttempt.respondent_name}</b><span className="ml-3 text-slate-600">{[gradingAttempt.position, gradingAttempt.organization].filter(Boolean).join(" · ")}</span><p className="break-all text-slate-600">{[gradingAttempt.email, gradingAttempt.phone].filter(Boolean).join(" · ") || "Không có liên hệ"}</p></div>
            <div className="flex flex-wrap gap-4"><span>{gradingAttempt.status === "submitted" ? "Đã nộp" : "Hết giờ"}</span><span>Điểm đã lưu: <b>{Number(gradingAttempt.score || 0).toLocaleString("vi-VN")} / {gradingAttempt.max_score}</b></span></div>
          </div>
        </header>
        <div className="min-h-0 flex-1 grid grid-rows-[auto_minmax(0,1fr)] gap-3 p-3 md:grid-cols-[300px_minmax(0,1fr)] md:grid-rows-1 md:gap-4 md:p-4">
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b px-4 py-3"><h2 className="font-bold">Danh sách câu hỏi <span className="text-slate-500">({gradingQuestions.length})</span></h2><p className="hidden text-xs text-slate-500 md:block">Chọn câu để xem và chấm ngay bên cạnh.</p></div>
            <nav ref={gradingQuestionListRef} aria-label="Danh sách câu hỏi" className="grading-scroll flex max-h-32 gap-2 overflow-auto p-2 md:max-h-none md:flex-1 md:flex-col">
              {gradingQuestions.map((q, index) => { const score = questionScores[q.id] ?? "0"; const automatic = isChoice(q) || (["short_answer", "ordering"].includes(q.type) && q.correct_answers?.length > 0) || (q.type === "matching" && (q.options || []).length > 0); const needsManualReview = q.type === "short_answer" && automatic; const automaticScore = gradingAttempt.automatic_grading?.[q.id] ?? 0; const manuallyGraded = Object.prototype.hasOwnProperty.call(gradingAttempt.grading || {}, q.id); const reviewed = (automatic && !needsManualReview) || manuallyGraded; const displayScore = manuallyGraded ? Number(gradingAttempt.grading[q.id]) : automatic ? automaticScore : Number(score); const tone = !reviewed ? "border-amber-300 bg-amber-50" : displayScore > Number(q.points) / 2 ? "border-emerald-300 bg-emerald-50" : "border-rose-300 bg-rose-50"; const textColor = !reviewed ? "text-amber-800" : displayScore > Number(q.points) / 2 ? "text-emerald-800" : "text-rose-800"; return <button key={q.id} aria-current={q.id === activeQuestion?.id ? "true" : undefined} onClick={() => chooseQuestion(String(q.id))} className={`shrink-0 rounded-lg border p-3 text-left md:w-full ${tone} ${q.id === activeQuestion?.id ? "ring-2 ring-blue-500" : "hover:brightness-95"}`}><span className="flex items-center justify-between gap-3 text-sm"><b>Câu {q.order || index + 1}</b><span className={`text-xs font-bold ${textColor}`}>{manuallyGraded ? `${displayScore}/${q.points} đ` : automatic ? `Tự động: ${automaticScore}/${q.points}${needsManualReview ? " · cần chấm tay" : ""}` : `Chưa chấm · 0/${q.points}`}</span></span><span className="mt-1 hidden text-xs leading-5 text-slate-600 md:line-clamp-2">{q.text}</span></button>; })}
            </nav>
          </aside>
          <div ref={gradingDetailRef} className="grading-scroll min-h-0 overflow-y-scroll rounded-xl" aria-label="Chi tiết câu hỏi">
            <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-sm font-bold">Câu {activeIndex + 1} / {gradingQuestions.length}</h2><div className="flex gap-2"><button disabled={activeIndex <= 0} onClick={() => chooseQuestion(String(gradingQuestions[activeIndex - 1].id))} className="ft-btn ft-btn-secondary">Câu trước</button><button disabled={activeIndex >= gradingQuestions.length - 1} onClick={() => chooseQuestion(String(gradingQuestions[activeIndex + 1].id))} className="ft-btn ft-btn-secondary">Câu tiếp</button></div></div>
            {activeQuestion ? (() => { const question = activeQuestion; const questionIndex = gradingQuestions.findIndex((item) => String(item.id) === String(question.id)); const answer = gradingAttempt.answers?.[question.id]; const uploads = (gradingAttempt.uploads || []).filter((item: any) => String(item.question_id) === String(question.id)); const answerLink = typeof answer === "object" && answer ? String(answer.link || "") : ""; const answerText = Array.isArray(answer) ? answer.join(", ") : typeof answer === "object" && answer ? Object.entries(answer).filter(([key]) => !["link", "upload_id", "upload_ids", "upload_file_id", "upload_url", "upload_urls"].includes(key)).map(([key, value]) => `${key}: ${value}`).join(" · ") : String(answer ?? ""); const automatic = ["single_choice", "multiple_choice"].includes(question.type) || (["short_answer", "ordering"].includes(question.type) && (question.correct_answers || []).length > 0) || (question.type === "matching" && (question.options || []).length > 0); const duplicateWarnings = (gradingAttempt.duplicate_link_warnings || []).filter((item: any) => String(item.question_id) === String(question.id)); const questionNoteDraft = gradingNoteDrafts[question.id] || ""; const questionNotes = (gradingAttempt.grading_notes || []).filter((note: any) => String(note.question_id || "") === String(question.id)); return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">{duplicateWarnings.map((warning: any) => <div key={warning.scope} className="mb-4 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900"><p className="flex items-center gap-2 font-extrabold"><AlertTriangle className="h-5 w-5" />{warning.scope === "same_attempt" ? "Cảnh báo: đáp án trùng với câu khác trong chính bài làm này" : "Cảnh báo đáp án trùng link"}</p><p className="mt-2 break-all">{warning.link}</p><ul className="mt-2 list-disc pl-5">{warning.matches.map((match: any) => <li key={`${match.attempt_id}-${match.question_id}`}>{warning.scope === "same_attempt" ? <>Trùng với chính câu {match.question_order || match.question_id} của học viên này.</> : <>Trùng với bài của <b>{match.respondent_name}</b>, câu {match.question_order || match.question_id}.</>}</li>)}</ul></div>)}<div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-700">{question.question_code || `Câu ${questionIndex + 1}`}</p><div className="mt-2 flex flex-wrap gap-2"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{questionTypeLabels[question.type] || question.type}</span><span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800">{question.points} điểm</span></div></div><label className="min-w-36"><span className={`mb-1 block text-xs font-bold ${automatic ? "text-amber-800" : "text-emerald-800"}`}>{automatic ? `Tự động: ${gradingAttempt.automatic_grading?.[question.id] ?? 0}/${question.points} · có thể ghi đè` : "Điểm chấm trực tiếp"}</span><div className="flex items-center gap-2"><input type="number" min="0" max={Number(question.points || 0)} step="0.25" value={questionScores[question.id] ?? "0"} onChange={(event) => setQuestionScores((current) => ({ ...current, [question.id]: event.target.value }))} disabled={busy} aria-label={`Điểm câu ${question.order}`} className="w-28 rounded-lg border border-blue-300 px-3 py-2 text-lg font-bold" /><span className="text-xs text-slate-500">/ {question.points}</span></div></label></div><h2 className="mt-4 whitespace-pre-wrap text-lg font-bold leading-7 text-slate-900">{question.order}. {question.text}</h2>{question.media_url && (() => { const isImg = /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(question.media_url) || question.media_url.includes("drive.google.com"); const driveId = question.media_url.match(/(?:\/d\/|[?&]id=)([a-zA-Z0-9_-]+)/)?.[1]; const imgSrc = driveId ? `https://drive.google.com/thumbnail?id=${driveId}&sz=w1200` : question.media_url; return isImg ? <div className="mt-3"><img src={imgSrc} alt="Hình minh họa câu hỏi" className="max-h-72 max-w-full rounded-xl border object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; (e.currentTarget.nextSibling as HTMLElement | null)?.removeAttribute("hidden"); }} /><a hidden href={question.media_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-bold text-blue-700 underline">Mở tư liệu minh họa</a></div> : <a href={question.media_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-bold text-blue-700 underline">Mở tư liệu minh họa</a>; })()}{question.type === "matching" && (question.options || []).length > 0 ? (() => { const matchAns: Record<string, string> = answer && typeof answer === "object" && !Array.isArray(answer) ? answer as Record<string, string> : {}; const rightLabels = Object.fromEntries((question.options || []).map((opt: any, idx: number) => [String.fromCharCode(65 + idx), String(opt.match_text || "")])); const totalPairs = (question.options || []).length; const correctCount = (question.options || []).filter((opt: any, idx: number) => matchAns[opt.key] === String.fromCharCode(65 + idx)).length; return <div className="mt-4 space-y-2"><div className="flex items-center justify-between"><p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Kết quả ghép nối</p><span className={`text-xs font-bold ${correctCount === totalPairs ? "text-emerald-700" : correctCount === 0 ? "text-rose-700" : "text-amber-700"}`}>{correctCount}/{totalPairs} cặp đúng</span></div>{(question.options || []).map((option: any, optIdx: number) => { const studentRightKey = matchAns[option.key]; const correctRightKey = String.fromCharCode(65 + optIdx); const isCorrect = studentRightKey === correctRightKey; const hasAnswer = !!studentRightKey; const studentText = studentRightKey ? (rightLabels[studentRightKey] || studentRightKey) : null; const correctText = rightLabels[correctRightKey]; return <div key={option.key} className="flex items-stretch gap-2 text-sm"><div className="flex flex-1 items-center gap-2 rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5"><span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-slate-800 text-[11px] font-black text-white">{optIdx + 1}</span><span className="font-semibold leading-5 text-slate-800">{option.text}</span></div><div className="flex shrink-0 items-center font-bold text-slate-400">→</div><div className={`flex flex-1 flex-col justify-center rounded-xl border-2 px-3 py-2.5 ${!hasAnswer ? "border-slate-200 bg-slate-50" : isCorrect ? "border-emerald-300 bg-emerald-50" : "border-rose-300 bg-rose-50"}`}>{hasAnswer ? <span className={`font-semibold leading-5 ${isCorrect ? "text-emerald-900" : "text-rose-900"}`}>{studentText}</span> : <span className="italic text-slate-400">Chưa trả lời</span>}{!isCorrect && <span className="mt-1 text-xs text-slate-500">Đúng ra là: <b className="text-emerald-800">{correctText}</b></span>}</div><div className={`flex shrink-0 items-center text-base font-extrabold ${!hasAnswer ? "text-slate-400" : isCorrect ? "text-emerald-600" : "text-rose-600"}`}>{!hasAnswer ? "–" : isCorrect ? "✓" : "✗"}</div></div>; })}</div>; })() : (question.options || []).length > 0 && <ol className="mt-4 space-y-2">{question.options.map((option: any) => <li key={option.key} className={`rounded-lg border px-3 py-3 text-sm ${isCorrectOption(question, option.key) ? "border-emerald-300 bg-emerald-50" : isSelectedOption(question, option.key) ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"}`}><div className="flex flex-wrap items-start justify-between gap-2"><span><b>{option.key}.</b> {option.text}{option.match_text ? ` → ${option.match_text}` : ""}</span><span className="flex gap-2 text-xs font-bold">{isCorrectOption(question, option.key) && <span className="text-emerald-800">✓ Đáp án đúng</span>}{isSelectedOption(question, option.key) && <span className="text-blue-800">Học viên chọn</span>}</span></div></li>)}</ol>}{question.type === "short_answer" && ((question.correct_answers || []).length > 0 || question.answer_image_url) && <section className="mt-4 w-full rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><h3 className="font-bold">Đáp án chuẩn</h3>{(question.correct_answers || []).length > 0 && <p className="mt-2 whitespace-pre-wrap">{question.correct_answers.join("; ")}</p>}{question.answer_image_url && <AssessmentZoomableImage src={question.answer_image_url} alt="Đáp án minh họa" className="mt-3 max-h-80 w-full object-contain" />}</section>}<div className="mt-4"><div className="rounded-xl border border-blue-200 bg-blue-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Bài làm của học viên</p>{uploads.length ? <AssessmentEvidenceCarousel uploads={uploads} assessmentId={selected.id} attemptId={gradingAttempt.id} auth={auth} questionOrder={question.order} /> : answerLink ? <a href={answerLink} target="_blank" rel="noreferrer" className="mt-3 inline-block break-all font-bold text-blue-700 underline">{answerLink}</a> : <p className="mt-3 whitespace-pre-wrap text-sm text-slate-800">{answerText || "Chưa trả lời / chưa nộp bài."}</p>}</div></div><section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="flex items-center gap-2 text-sm font-extrabold"><MessageSquareText className="h-4 w-4 text-blue-700" />Ghi chú của người chấm cho câu này</h3><div className="mt-3 flex flex-wrap gap-2">{["Chưa làm", "Bài làm rất tốt", "Đã hoàn thành bài", "Link không hỗ trợ/link không truy cập được", "Sai yêu cầu", "Bài làm cần cải thiện hơn"].map((suggestion) => <button type="button" key={suggestion} onClick={() => setGradingNoteDrafts((current) => ({ ...current, [question.id]: suggestion }))} className="rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-800 hover:bg-blue-100">{suggestion}</button>)}</div><div className="mt-3 flex flex-col gap-2 sm:flex-row"><textarea value={questionNoteDraft} onChange={(event) => setGradingNoteDrafts((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="Nhập nhận xét hoặc chọn một gợi ý ở trên..." className="min-h-20 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm" /><button type="button" disabled={busy || !questionNoteDraft.trim()} onClick={() => void saveGradingNote(String(question.id), questionNoteDraft)} className="ft-primary self-end disabled:opacity-50">Lưu ghi chú</button></div><div className="mt-4 space-y-2">{questionNotes.slice().reverse().map((note: any) => <article key={note.id} className="rounded-xl border bg-white p-3 text-sm"><p className="whitespace-pre-wrap text-slate-800">{note.content}</p><p className="mt-2 text-xs text-slate-500"><b>Người chấm: {note.grader}</b> · {note.created_at ? new Date(note.created_at).toLocaleString("vi-VN") : ""}</p></article>)}{!questionNotes.length && <p className="text-sm text-slate-500">Chưa có ghi chú cho câu này.</p>}</div></section></article>; })() : <div className="mt-5 rounded-2xl border border-dashed bg-slate-50 p-8 text-center text-sm text-slate-500">Bài làm này chưa có câu hỏi để chấm.</div>}
            {(gradingAttempt.grading_notes || []).some((note: any) => !note.question_id) && <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="flex items-center gap-2 font-extrabold"><MessageSquareText className="h-5 w-5 text-blue-700" />Ghi chú chung (cũ, trước khi ghi chú gắn theo từng câu)</h3><div className="mt-4 space-y-2">{(gradingAttempt.grading_notes || []).filter((note: any) => !note.question_id).slice().reverse().map((note: any) => <article key={note.id} className="rounded-xl border bg-slate-50 p-3 text-sm"><p className="whitespace-pre-wrap text-slate-800">{note.content}</p><p className="mt-2 text-xs text-slate-500"><b>Người chấm: {note.grader}</b> · {note.created_at ? new Date(note.created_at).toLocaleString("vi-VN") : ""}</p></article>)}</div></section>}
            <p className="px-2 py-3 text-xs text-slate-600">Có thể sửa điểm trắc nghiệm. Điểm nhập sẽ thay thế điểm tự động sau khi lưu.</p>
          </div>
        </div>
        <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 shadow-lg sm:px-6">
          {notice && <p role="status" className={`mb-2 text-sm ${notice.startsWith("Đã") ? "text-emerald-800" : "text-rose-700"}`}>{notice}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2">
            {!singleGrading && <><button disabled={busy} onClick={() => setShowGradingRoster(true)} className="ft-btn ft-btn-secondary">Danh sách thí sinh</button><button disabled={!previousAttempt || busy} onClick={() => void openGrading(previousAttempt)} className="ft-btn ft-btn-secondary">Bài làm trước</button><button disabled={!nextAttempt || busy} onClick={() => void openGrading(nextAttempt)} className="ft-btn ft-btn-secondary">Bài làm tiếp theo</button></>}
            <span className={`text-xs font-bold ${dirty ? "text-amber-700" : "text-slate-500"}`}>{dirty ? "Có điểm chưa lưu" : "Không có thay đổi chưa lưu"}</span>
          </div><button disabled={busy} onClick={() => void saveQuestionGrades()} className="ft-primary"><Check className="h-4 w-4" />{busy ? "Đang lưu..." : "Lưu điểm"}</button></div>
        </footer>
        {showGradingRoster && <div onMouseDown={() => setShowGradingRoster(false)} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4"><div onMouseDown={(event) => event.stopPropagation()} className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex shrink-0 items-center justify-between gap-3 border-b bg-white p-5"><div><p className="text-xs font-bold uppercase text-violet-700">Danh sách thí sinh</p><h2 className="mt-1 text-xl font-extrabold">Chọn bài làm cần chấm</h2></div><button onClick={() => setShowGradingRoster(false)} className="ft-btn ft-btn-secondary">Đóng</button></div><div className="space-y-2 overflow-y-auto p-5">{gradingCandidates.map((item, index) => <button key={item.id} onClick={() => { setShowGradingRoster(false); void openGrading(item); }} className={`flex w-full items-center justify-between gap-3 rounded-xl border p-4 text-left ${item.id === gradingAttempt.id ? "border-violet-400 bg-violet-50" : "hover:border-violet-300"}`}><span><b className="block">{index + 1}. {item.respondent_name}</b><span className="text-sm text-slate-600">{item.variant} · {[item.position, item.organization].filter(Boolean).join(" · ") || "Chưa có thông tin đơn vị"}</span></span><span className={`rounded-full px-2 py-1 text-xs font-bold ${item.manual_grading_required ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{item.manual_grading_required ? "Chưa chấm xong" : "Đã chấm"}</span></button>)}</div></div></div>}
      </section>, document.body);
  }

  if (screen === "detail" && selected) {
    return (
      <section className="mt-6 space-y-5">
        <button onClick={returnToList} className="inline-flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft className="h-4 w-4" />Quay lại danh sách</button>
        <article className="assessment-detail-card overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 p-6">
            <div><p className="text-xs font-bold uppercase text-blue-600">Bài kiểm tra cuối khóa tập huấn</p><h2 className="mt-1 text-2xl font-extrabold">{selected.title}</h2><p className="mt-2 text-sm text-slate-500">{[selected.partner_name, selected.class_name].filter(Boolean).join(" · ")}</p></div>
            <div className="flex flex-wrap gap-2"><button aria-disabled={!['closed', 'graded'].includes(selected.status)} disabled={busy} onClick={() => void openGrading()} title={['closed', 'graded'].includes(selected.status) ? "Chấm các bài đã nộp" : "Đóng bài trước khi chấm"} className={`ft-btn ft-btn-secondary ${!['closed', 'graded'].includes(selected.status) ? "cursor-not-allowed opacity-50" : ""}`}><Check className="h-4 w-4" />Chấm bài</button><a href={`${publicLink}?preview=creator`} target="_blank" rel="noreferrer" className="ft-btn ft-btn-secondary" title="Xem trước mặc định ở chế độ quản trị viên"><Layers3 className="h-4 w-4" />Xem trước</a>{selected.status !== 'published' && <button disabled={busy} onClick={() => void changeStatus("published")} className="ft-primary"><Send className="h-4 w-4" />{['closed', 'graded', 'backup_complete'].includes(selected.status) ? "Mở lại bài" : "Phát hành"}</button>}{selected.status === "published" && <button disabled={busy} onClick={() => void changeStatus("closed")} className="ft-btn ft-btn-secondary">Đóng bài</button>}<button aria-label="Xóa bài kiểm tra" title="Xóa bài kiểm tra" onClick={() => void remove()} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-bold text-rose-700"><Trash2 className="h-4 w-4" /></button></div>
          </div>
          <div className="flex flex-wrap gap-2 border-t bg-white px-6 pt-4"><button type="button" onClick={() => setDetailTab("overview")} className={`rounded-lg px-4 py-2 text-sm font-bold ${detailTab === "overview" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}>Tổng quan</button><button type="button" onClick={() => setDetailTab("settings")} className={`rounded-lg px-4 py-2 text-sm font-bold ${detailTab === "settings" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}>Chi tiết bài kiểm tra</button></div>
          <div className={`${detailTab === "overview" ? "block" : "hidden"} border-t bg-slate-50 p-4 sm:p-6`}>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${selected.status === "published" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{statusLabel[selected.status]}</span>
              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">{selected.generation_mode === "auto_generate" ? "Sinh từ ngân hàng chuẩn" : "Đề soạn sẵn"}</span>
              <span className="text-sm text-slate-500">{selected.duration_minutes} phút · tối đa {selected.attempt_limit} lượt/người</span>
            </div>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <section className="min-w-0 rounded-xl border border-blue-200 bg-blue-50/50 p-4" aria-label="Lịch mở và đóng bài">
                <h3 className="text-sm font-extrabold text-slate-900" title={`Lịch đã lưu: mở ${selected.opens_at ? formatScheduleTime(selected.opens_at) : "ngay khi phát hành"}; đóng ${selected.closes_at ? formatScheduleTime(selected.closes_at) : "không hẹn giờ"}.`}>Lịch mở và đóng bài</h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label title="Để trống để mở ngay khi phát hành"><span className="mb-1 block text-xs font-bold text-slate-700">Mở từ</span><input type="datetime-local" className="ft-input min-w-0 bg-white" value={scheduleDraft.opens_at} onChange={(event) => setScheduleDraft((current) => ({ ...current, opens_at: event.target.value }))} /></label>
                  <label title="Để trống để không tự động đóng bài"><span className="mb-1 block text-xs font-bold text-slate-700">Đóng lúc</span><input type="datetime-local" className="ft-input min-w-0 bg-white" value={scheduleDraft.closes_at} onChange={(event) => setScheduleDraft((current) => ({ ...current, closes_at: event.target.value }))} /></label>
                </div>
                <div className="mt-4 flex justify-end"><button disabled={busy} onClick={() => void saveSchedule()} className="ft-btn ft-btn-secondary">Lưu lịch</button></div>
              </section>
              <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4" aria-label="Link và mã QR làm bài">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-extrabold text-slate-900" title="Tất cả người học dùng chung link này; hệ thống tự chia mã đề có ít lượt nhất.">Link làm bài</h3>
                    <input readOnly value={publicLink} aria-label="Link làm bài" title={publicLink} className="ft-input mt-3 min-w-0 text-sm" />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => void navigator.clipboard.writeText(publicLink)} className="ft-btn ft-btn-secondary" title="Sao chép link làm bài"><ClipboardCopy className="h-4 w-4" />Sao chép</button>
                      <a href={publicLink} target="_blank" rel="noreferrer" className="ft-btn ft-btn-secondary" title="Mở trang làm bài trong tab mới"><ExternalLink className="h-4 w-4" />Mở bài</a>
                    </div>
                  </div>
                  <div className="shrink-0 self-center text-center sm:border-l sm:border-slate-200 sm:pl-4">
                    {qrUrl ? <img src={qrUrl} alt="QR link làm bài" className="mx-auto h-36 w-36 object-contain" /> : <QrCode aria-label="Đang tạo QR" className="mx-auto h-36 w-36 text-slate-300" />}
                    {qrUrl && <a href={qrUrl} download={`qr-${selected.public_slug}.png`} className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-blue-700" title="Tải mã QR của link làm bài"><Download className="h-3.5 w-3.5" />Tải QR</a>}
                  </div>
                </div>
              </section>
            </div>
            <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4" aria-label="Danh sách mã đề">
              <div className="flex flex-wrap items-end justify-between gap-3"><h3 className="text-sm font-extrabold">Mã đề</h3><div className="flex items-end gap-2"><label><span className="mb-1 block text-xs font-bold">Số mã mới</span><input type="number" min="1" max="200" className="ft-input w-24" value={variantAddCount} onChange={(event) => setVariantAddCount(event.target.value)} /></label><button disabled={busy} onClick={() => void addVariants()} className="ft-btn ft-btn-secondary" title="Tạo mã mới từ cơ cấu hiện có, đổi thứ tự câu và phương án"><Plus className="h-4 w-4" />Bổ sung mã đề</button></div></div>
              <div className="mt-3 flex flex-wrap gap-2">{selected.variants.map((variant) => <a key={variant.name} href={`${publicLink}?preview=creator&variant=${encodeURIComponent(variant.name)}`} target="_blank" rel="noreferrer" title={`Xem và sửa ${variant.name}`} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800 hover:bg-blue-100">{variant.name}: {variant.question_count} câu · {selected.variant_distribution[variant.name] || 0} lượt<Pencil className="h-3 w-3" /></a>)}</div>
              {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
            </section>
          </div>
          {detailTab === "settings" && <section className="border-t bg-slate-50 p-6"><div className="mx-auto max-w-4xl rounded-2xl border bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-600">Cấu hình đã tạo</p><h3 className="mt-1 text-xl font-extrabold">Chi tiết bài kiểm tra</h3><p className="mt-1 text-sm text-slate-500">Chỉnh các thông tin vận hành mà không làm thay đổi câu hỏi hoặc mã đề.</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800">{selected.questions.length} câu · {selected.variants.length} mã đề</span></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label><span className="mb-1 block text-sm font-bold">Thời gian làm bài (phút)</span><input required type="number" min="1" max="480" className="ft-input" value={detailDraft.duration_minutes} onChange={(event) => setDetailDraft((current) => ({ ...current, duration_minutes: event.target.value }))} /></label><label><span className="mb-1 block text-sm font-bold">Số lượt tối đa/người</span><input required type="number" min="1" max="20" className="ft-input" value={detailDraft.attempt_limit} onChange={(event) => setDetailDraft((current) => ({ ...current, attempt_limit: event.target.value }))} /></label><label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Mô tả hiển thị cho người làm</span><textarea className="ft-input min-h-20" value={detailDraft.description} onChange={(event) => setDetailDraft((current) => ({ ...current, description: event.target.value }))} /></label><label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Hướng dẫn bổ sung</span><textarea className="ft-input min-h-24" value={detailDraft.instructions} onChange={(event) => setDetailDraft((current) => ({ ...current, instructions: event.target.value }))} /><small className="mt-1 block text-slate-500">Nội dung này được hiển thị sau hướng dẫn chuẩn ở trang bắt đầu bài.</small></label></div><div className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><p><b>Đơn vị / phân lớp:</b> {selected.partner_name || "—"}{selected.class_name ? ` · ${selected.class_name}` : ""}</p><p><b>Nhóm đối tượng:</b> {selected.audience_group || "—"}</p><p><b>Nguồn câu hỏi:</b> {selected.source_name || "—"}</p><p><b>Hình thức tạo:</b> {selected.generation_mode === "auto_generate" ? "Sinh từ ngân hàng chuẩn" : "Đề soạn sẵn"}</p>{selected.question_bank_url && <a href={selected.question_bank_url} target="_blank" rel="noreferrer" className="font-bold text-blue-700 underline">Mở ngân hàng câu hỏi</a>}{selected.output_sheet_url && <a href={selected.output_sheet_url} target="_blank" rel="noreferrer" className="font-bold text-blue-700 underline">Mở Sheet đầu ra</a>}</div>{notice && <p className={`mt-4 rounded-xl p-3 text-sm ${notice.startsWith("Đã") ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{notice}</p>}<div className="mt-5 flex justify-end"><button disabled={busy} onClick={() => void saveAssessmentDetails()} className="ft-primary">Lưu thay đổi</button></div></div></section>}

          {detailTab === "settings" && <div className="border-t bg-slate-50 px-6 pb-6"><div className="mx-auto max-w-5xl rounded-xl border border-blue-100 bg-blue-50/60 p-4"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm font-extrabold text-slate-900">Google Sheet liên kết</p><p className="mt-1 max-w-2xl text-sm text-slate-600">Bài nộp và điểm chấm tự động được ghi lên Sheet. Chỉ trạng thái “Đã hoàn thành sao lưu” mới xác nhận câu hỏi, đáp án, điểm và liên kết media đã khớp hoàn toàn.</p></div><div className="flex flex-wrap gap-2">{selected.output_sheet_url && <a href={selected.output_sheet_url} target="_blank" rel="noreferrer" className="ft-btn ft-btn-secondary bg-white"><FileSpreadsheet className="h-4 w-4" />Mở Google Sheet<ExternalLink className="h-3.5 w-3.5" /></a>}{driveFolderLink && <a href={driveFolderLink} target="_blank" rel="noreferrer" className="ft-btn ft-btn-secondary bg-white"><Upload className="h-4 w-4" />Mở thư mục bài làm<ExternalLink className="h-3.5 w-3.5" /></a>}<button disabled={busy || !selected.output_sheet_url} onClick={() => void prepareOutput()} className="ft-btn ft-btn-secondary bg-white" title="Hệ thống → Google Sheet"><RefreshCw className="h-4 w-4" />Cập nhật lên Sheet</button><button disabled={busy || !selected.output_sheet_url} onClick={() => void verifyBackup()} className="ft-btn ft-btn-secondary bg-white"><FileCheck2 className="h-4 w-4" />Kiểm chứng sao lưu</button><button disabled={busy || !selected.output_sheet_url} onClick={() => void importGradesFromSheet()} className="ft-btn ft-btn-secondary bg-white" title="Google Sheet → hệ thống; chỉ cập nhật điểm"><Download className="h-4 w-4" />Đồng bộ điểm từ Sheet</button></div></div></div></div>}
        </article>
        <div className="grid gap-4 sm:grid-cols-3"><div className="rounded-2xl border bg-white p-5"><Users className="h-5 w-5 text-blue-600" /><b className="mt-3 block text-3xl">{selected.attempts_count}</b><span className="text-sm text-slate-500">Lượt bắt đầu</span></div><div className="rounded-2xl border bg-white p-5"><Check className="h-5 w-5 text-emerald-600" /><b className="mt-3 block text-3xl">{selected.submitted_count}</b><span className="text-sm text-slate-500">Bài đã nộp</span></div><div className="rounded-2xl border bg-white p-5"><BarChart3 className="h-5 w-5 text-amber-600" /><b className="mt-3 block text-3xl">{selected.average_score ?? "—"}{selected.average_score != null && "%"}</b><span className="text-sm text-slate-500">Điểm trung bình</span></div></div>
        {selected.output_sheet_url && (selected.sync_counts.pending || selected.sync_counts.error) && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p><b>Cần đồng bộ:</b> {selected.sync_counts.pending} chờ, {selected.sync_counts.error} lỗi. Có thể thử đồng bộ lại hoặc xóa riêng lượt làm nếu cần cho người học bắt đầu lại.</p><button disabled={busy} onClick={() => void syncPendingResults()} className="ft-btn ft-btn-secondary bg-white"><RefreshCw className="h-4 w-4" />Đồng bộ lại tất cả</button></div>}
        <div className="hidden overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 p-5"><div><h3 className="text-lg font-extrabold">Kết quả người học</h3><p className="text-sm text-slate-500">Mở link/tệp minh chứng ngay tại đây rồi nhập tổng điểm để chấm trực tiếp bài thực hành.</p></div><button disabled={!results.length} onClick={exportResults} className="ft-btn ft-btn-secondary"><Download className="h-4 w-4" />Xuất XLSX</button></div>
          <div className="overflow-x-auto">
            <table className="ft-table min-w-[1420px]">
              <thead><tr><th>STT</th><th>Người học</th><th>Liên hệ</th><th>Tổ chuyên môn/Phòng ban</th><th>Chức vụ</th><th>Mã đề</th><th>Bài thực hành</th><th>Điểm</th><th>Trạng thái</th><th>Thời gian bắt đầu</th><th>Thời gian nộp bài</th></tr></thead>
              <tbody>{results.length ? results.map((item, index) => { const evidence = practicalEvidence(selected.questions, item); return <tr key={item.id}><td>{index + 1}</td><td><b>{item.respondent_name}</b></td><td>{item.email || item.phone || "—"}</td><td>{item.organization || "—"}</td><td>{item.position || "—"}</td><td>{item.variant}</td><td>{item.uploads?.length || evidence.length ? <div className="space-y-1">{evidence.map((entry) => <a key={`${entry.label}-${entry.link}`} href={entry.link} target="_blank" rel="noreferrer" className="block text-xs font-bold text-blue-700 underline">{entry.label}: mở bài nộp</a>)}{item.uploads.map((upload: any, uploadIndex: number) => <a key={upload.id} href={upload.url} target="_blank" rel="noreferrer" className="block text-xs font-bold text-blue-700 underline">Xem tệp minh chứng {uploadIndex + 1}</a>)}</div> : "—"}</td><td>{item.manual_grading_required ? <div className="min-w-40"><span className="mb-1 block text-[11px] font-bold text-amber-800">Chấm trực tiếp · tổng điểm</span><div className="flex items-center gap-2"><input type="number" min="0" max={Number(item.max_score || 0)} step="0.25" value={manualScores[item.id] ?? ""} onChange={(event) => setManualScores((current) => ({ ...current, [item.id]: event.target.value }))} className="w-20 rounded-lg border px-2 py-1.5 text-sm" aria-label="Tổng điểm sau chấm thủ công" /><span className="text-xs text-slate-500">/ {Number(item.max_score || 0).toLocaleString("vi-VN")}</span><button disabled={busy} onClick={() => void gradeResult(item)} className="rounded-lg bg-blue-600 px-2 py-1.5 text-xs font-bold text-white">Lưu</button></div></div> : <b>{Number(item.score || 0).toLocaleString("vi-VN")} / {Number(item.max_score || 0).toLocaleString("vi-VN")}</b>}</td><td>{item.status === "submitted" ? "Đã nộp" : item.status === "timed_out" ? "Hết giờ" : "Đang làm"}<div className={`mt-2 text-[11px] font-bold ${item.sync_status === "synced" ? "text-emerald-600" : item.sync_status === "error" ? "text-rose-600" : "text-amber-600"}`}>Sync: {item.sync_status || "pending"}</div>{item.sync_error && <p className="mt-1 max-w-52 text-[10px] text-rose-600" title={item.sync_error}>Lỗi: {item.sync_error}</p>}<div className="mt-1 flex flex-wrap gap-1">{item.status === "in_progress" && <button disabled={busy} onClick={() => void endAttempt(item)} className="rounded border border-amber-300 px-2 py-1 text-[11px] font-bold text-amber-800">Kết thúc lượt</button>}{item.status !== "in_progress" && item.sync_status !== "synced" && <button disabled={busy} onClick={() => void updateResultStorage(item)} className="rounded border px-2 py-1 text-[11px] font-bold">Thử lại</button>}{item.sync_status === "synced" && <button disabled={busy} onClick={() => void updateResultStorage(item, true)} className="rounded border border-rose-200 px-2 py-1 text-[11px] font-bold text-rose-600">Xóa lượt</button>}</div></td><td>{item.started_at ? new Date(item.started_at).toLocaleString("vi-VN") : "—"}</td><td>{item.submitted_at ? new Date(item.submitted_at).toLocaleString("vi-VN") : "—"}</td></tr>; }) : <tr><td colSpan={11} className="py-10 text-center text-slate-500">Chưa có lượt làm bài.</td></tr>}</tbody>
            </table>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 p-5"><div><h3 className="text-lg font-extrabold" title="Chọn Chấm bài này để chấm riêng một bài; chọn Chấm bài ở trên để duyệt lần lượt các học viên.">Kết quả người học</h3><p className="mt-1 text-sm text-slate-500">Bài nộp và điểm chấm trong hệ thống được tự động ghi lên Sheet; dùng các nút dưới đây khi cần đồng bộ thủ công.</p></div><div className="flex flex-wrap gap-2"><button disabled={busy || !selected.output_sheet_url} onClick={() => void prepareOutput()} className="ft-btn ft-btn-secondary" title="Ghi lại cấu trúc, danh sách bài làm, câu trả lời và điểm hiện tại từ hệ thống lên Google Sheet"><RefreshCw className="h-4 w-4" />Cập nhật lên Sheet</button><button disabled={busy || !selected.output_sheet_url} onClick={() => void importGradesFromSheet()} className="ft-btn ft-btn-secondary" title="Chỉ lấy Điểm thực hành hoặc Tổng điểm từ các tab BÀI LÀM ĐỀ về hệ thống"><Download className="h-4 w-4" />Đồng bộ điểm từ Sheet</button><button disabled={!results.length} onClick={exportResults} className="ft-btn ft-btn-secondary"><Download className="h-4 w-4" />Xuất XLSX</button></div></div>
          <div className="flex flex-wrap items-end gap-3 border-t bg-slate-50 p-4">
            <label className="min-w-56 flex-1">
              <span className="mb-1 block text-xs font-bold">Tìm người làm bài</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input className="ft-input" style={{ paddingLeft: "2.5rem" }} aria-label="Tìm người làm bài theo họ tên, email hoặc số điện thoại" value={resultSearch} onChange={(event) => { setResultSearch(event.target.value); setResultPage(1); }} placeholder="Họ tên, email hoặc số điện thoại" />
              </div>
            </label>
            <label><span className="mb-1 block text-xs font-bold">Trạng thái</span><select className="ft-input min-w-36" value={resultStatus} onChange={(event) => { setResultStatus(event.target.value); setResultPage(1); }}><option value="">Tất cả</option><option value="in_progress">Đang làm</option><option value="submitted">Đã nộp</option><option value="timed_out">Hết giờ</option></select></label>
            <label><span className="mb-1 block text-xs font-bold">Mã đề</span><select className="ft-input min-w-28" value={resultVariant} onChange={(event) => { setResultVariant(event.target.value); setResultPage(1); }}><option value="">Tất cả</option>{resultVariants.map((variant) => <option key={variant} value={variant}>{variant}</option>)}</select></label>
            <span className="pb-2 text-xs font-semibold text-slate-600">Hiển thị {filteredResults.length ? `${(currentResultPage - 1) * resultsPerPage + 1}–${Math.min(currentResultPage * resultsPerPage, filteredResults.length)}` : "0"}/{filteredResults.length} lượt · tổng {results.length}</span>
          </div>
          {notice && <p role="status" className="mx-4 mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{notice}</p>}
          <div className="overflow-x-auto">
            <table className="ft-table min-w-[1380px]">
              <thead><tr><th>STT</th><th>Người học</th><th>Liên hệ</th><th>Tổ chuyên môn/Phòng ban</th><th>Chức vụ</th><th>Mã đề</th><th>Điểm</th><th>Đánh giá</th><th>Trạng thái</th><th>Thời gian bắt đầu</th><th>Thời gian nộp bài</th><th aria-label="Thao tác" /></tr></thead>
              <tbody>{filteredResults.length ? pageResults.map((item, index) => (
                <tr key={item.id}>
                  <td>{(currentResultPage - 1) * resultsPerPage + index + 1}</td>
                  <td><b>{item.respondent_name}</b></td>
                  <td>{item.email || item.phone || "—"}</td>
                  <td>{item.organization || "—"}</td>
                  <td>{item.position || "—"}</td>
                  <td>{item.variant}</td>
                  <td><b>{Number(item.score || 0).toLocaleString("vi-VN")} / {Number(item.max_score || 0).toLocaleString("vi-VN")}</b><span className={`mt-1 block text-[11px] font-bold ${item.manual_grading_required ? "text-amber-800" : "text-emerald-700"}`}>{item.manual_grading_required ? "Cần chấm" : "Đã chấm"}</span></td>
                  <td><span className="whitespace-nowrap font-bold text-slate-700">{completionLabel(item)}</span></td>
                  <td>{item.status === "submitted" ? "Đã nộp" : item.status === "timed_out" ? "Hết giờ" : "Đang làm"}<div className={`mt-2 text-[11px] font-bold ${item.sync_status === "synced" ? "text-emerald-600" : item.sync_status === "error" ? "text-rose-600" : "text-amber-600"}`}>Sync: {item.sync_status || "pending"}</div>{item.sync_error && <p className="mt-1 max-w-52 text-[10px] text-rose-600" title={item.sync_error}>Lỗi: {item.sync_error}</p>}{item.status === "in_progress" && <button disabled={busy} onClick={() => void endAttempt(item)} className="mt-2 rounded border border-amber-300 px-2 py-1 text-[11px] font-bold text-amber-800">Kết thúc lượt</button>}{item.status !== "in_progress" && item.sync_status !== "synced" && <button disabled={busy} onClick={() => void updateResultStorage(item)} className="mt-2 rounded border px-2 py-1 text-[11px] font-bold">Thử lại</button>}</td>
                  <td>{item.started_at ? new Date(item.started_at).toLocaleString("vi-VN") : "—"}</td>
                  <td>{item.submitted_at ? new Date(item.submitted_at).toLocaleString("vi-VN") : "—"}</td>
                  <td><div className="flex items-center gap-2">
                    <button disabled={busy || item.status === "in_progress" || !["closed", "graded"].includes(selected.status)} onClick={() => void openGrading(item, true)} className="rounded-lg border border-violet-200 p-2 text-violet-700 hover:bg-violet-50 disabled:opacity-45" title={!["closed", "graded"].includes(selected.status) ? "Đóng bài kiểm tra trước khi chấm" : "Chấm bài này"} aria-label={`Chấm bài này: ${item.respondent_name}`}><FileCheck2 className="h-4 w-4" /></button>
                    <button disabled={busy || item.status === "in_progress"} onClick={() => void openGrading(item)} className="rounded-lg border border-blue-200 p-2 text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-45" title={item.status === "in_progress" ? "Chỉ chấm bài đã kết thúc" : "Mở chấm bài / sửa điểm"} aria-label={`Chấm hoặc sửa bài làm của ${item.respondent_name}`}><Pencil className="h-4 w-4" /></button>
                    <button disabled={busy} onClick={() => openAnswerEditor(item)} className="rounded-lg border border-blue-200 px-2 py-1 text-xs font-bold text-blue-800 hover:bg-blue-50 disabled:opacity-45" title="Sửa câu trả lời hoặc dán link bài thực hành hộ thí sinh">Sửa bài làm</button>
                    {item.status !== "in_progress" && <button disabled={busy} onClick={() => void reopenAttempt(item)} className="rounded-lg border border-amber-200 px-2 py-1 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-45" title="Giữ câu trả lời và cấp thêm thời gian cho lượt cũ">Mở tiếp lượt cũ</button>}
                    <button disabled={busy} onClick={() => void updateResultStorage(item, true)} className="rounded-lg border border-rose-200 p-2 text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-45" title="Xóa lượt làm để giải phóng giới hạn lượt" aria-label={`Xóa bài làm của ${item.respondent_name}`}><Trash2 className="h-4 w-4" /></button>
                  </div></td>
                </tr>
              )) : <tr><td colSpan={12} className="py-10 text-center text-slate-500">{results.length ? "Không có lượt làm phù hợp bộ lọc." : "Chưa có lượt làm bài."}</td></tr>}</tbody>
            </table>
          </div>
          {filteredResults.length > resultsPerPage && <nav className="flex flex-wrap items-center justify-between gap-3 border-t bg-white px-4 py-3 text-sm" aria-label="Chuyển trang danh sách bài làm">
            <span className="text-slate-600">Trang {currentResultPage}/{resultPageCount}</span>
            <div className="flex flex-wrap items-center gap-1">
              <button type="button" disabled={currentResultPage === 1} onClick={() => setResultPage(currentResultPage - 1)} className="ft-btn ft-btn-secondary disabled:opacity-40" aria-label="Trang trước"><ChevronLeft className="h-4 w-4" /></button>
              {Array.from({ length: resultPageCount }, (_, index) => index + 1).filter((page) => page === 1 || page === resultPageCount || Math.abs(page - currentResultPage) <= 2).map((page, index, visible) => <React.Fragment key={page}>{index > 0 && page - visible[index - 1] > 1 && <span className="px-1 text-slate-400">…</span>}<button type="button" onClick={() => setResultPage(page)} aria-label={`Trang ${page}`} aria-current={page === currentResultPage ? "page" : undefined} className={`min-w-9 rounded-lg px-2 py-1.5 font-bold ${page === currentResultPage ? "bg-blue-600 text-white" : "border text-slate-700 hover:bg-slate-50"}`}>{page}</button></React.Fragment>)}
              <button type="button" disabled={currentResultPage === resultPageCount} onClick={() => setResultPage(currentResultPage + 1)} className="ft-btn ft-btn-secondary disabled:opacity-40" aria-label="Trang sau"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </nav>}
        </div>
        {editingAnswerAttempt && <div role="dialog" aria-modal="true" aria-label={`Sửa bài làm của ${editingAnswerAttempt.respondent_name}`} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b p-5"><div><h3 className="text-xl font-extrabold">Sửa bài làm: {editingAnswerAttempt.respondent_name}</h3><p className="mt-1 text-sm text-slate-600">Mã đề {editingAnswerAttempt.variant} · Thay đổi được lưu vào nhật ký người chấm.</p></div><button type="button" onClick={() => setEditingAnswerAttempt(null)} className="ft-btn ft-btn-secondary">Đóng</button></div>
            {editingAnswerAttempt.status === "in_progress" && <p className="mx-5 mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Người học đang làm bài. Nếu họ tiếp tục lưu, câu trả lời trên trình duyệt của họ có thể ghi đè nội dung admin vừa sửa.</p>}
            {notice && <p role="status" className="mx-5 mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{notice}</p>}
            <div className="space-y-4 overflow-y-auto p-5">{selected.questions.filter((question) => question.variant === editingAnswerAttempt.variant).sort((a, b) => Number(a.order) - Number(b.order)).map((question) => {
              const value = answerDrafts[question.id];
              const setValue = (next: any) => setAnswerDrafts((current) => ({ ...current, [question.id]: next }));
              const options = question.options || [];
              return <section key={question.id} className="rounded-xl border p-4"><p className="text-xs font-bold text-blue-700">Câu {question.order} · {questionTypeLabels[question.type] || question.type}</p><p className="mt-1 whitespace-pre-wrap font-semibold">{question.text}</p>
                {(question.type === "practical_submission" || question.type === "file_upload") && <label className="mt-3 block text-sm"><span className="font-bold">Link bài làm</span><input type="url" className="ft-input mt-1" value={typeof value === "object" && value ? String(value.link || "") : String(value || "")} onChange={(event) => setValue({ ...(typeof value === "object" && value ? value : {}), link: event.target.value })} placeholder="https://drive.google.com/..." /></label>}
                {question.type === "short_answer" && <textarea className="ft-input mt-3 min-h-24" value={String(value || "")} onChange={(event) => setValue(event.target.value)} aria-label={`Câu trả lời câu ${question.order}`} />}
                {question.type === "single_choice" && <select className="ft-input mt-3" value={String(value || "")} onChange={(event) => setValue(event.target.value)} aria-label={`Đáp án câu ${question.order}`}><option value="">Chưa chọn</option>{options.map((option: any) => <option key={option.key} value={option.key}>{option.key}. {option.text}</option>)}</select>}
                {question.type === "multiple_choice" && <div className="mt-3 grid gap-2">{options.map((option: any) => { const picked = Array.isArray(value) ? value : String(value || "").split(/[;,|]/).map((item) => item.trim()).filter(Boolean); return <label key={option.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={picked.includes(option.key)} onChange={(event) => setValue(event.target.checked ? [...picked, option.key] : picked.filter((key) => key !== option.key))} />{option.key}. {option.text}</label>; })}</div>}
                {question.type === "matching" && <div className="mt-3 grid gap-2">{options.map((option: any) => { const matched = typeof value === "object" && value && !Array.isArray(value) ? value : {}; return <label key={option.key} className="grid gap-1 text-sm sm:grid-cols-2 sm:items-center"><span>{option.key}. {option.text}</span><select className="ft-input" value={String(matched[option.key] || "")} onChange={(event) => setValue({ ...matched, [option.key]: event.target.value })}><option value="">Chưa ghép</option>{options.map((right: any, index: number) => <option key={index} value={String.fromCharCode(65 + index)}>{String.fromCharCode(65 + index)}. {right.match_text}</option>)}</select></label>; })}</div>}
                {question.type === "ordering" && <label className="mt-3 block text-sm"><span className="font-bold">Thứ tự các mã đáp án, ngăn bằng dấu gạch ngang</span><input className="ft-input mt-1" value={String(value || "")} onChange={(event) => setValue(event.target.value)} placeholder={options.map((option: any) => option.key).join("-")} /><small className="mt-1 block text-slate-500">{options.map((option: any) => `${option.key}: ${option.text}`).join(" · ")}</small></label>}
              </section>;
            })}</div>
            <div className="flex justify-end gap-2 border-t p-4"><button type="button" disabled={busy} onClick={() => setEditingAnswerAttempt(null)} className="ft-btn ft-btn-secondary">Hủy</button><button type="button" disabled={busy} onClick={() => void saveAnswerEdits()} className="ft-primary">{busy ? "Đang lưu..." : "Lưu bài làm"}</button></div>
          </div>
        </div>}
        {toasts.length > 0 && createPortal(<div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-label="Thông báo thao tác">
          {toasts.map((toast) => <div key={toast.id} role="status" className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-lg ${toast.warning ? "border-amber-300 bg-amber-50 text-amber-950" : "border-emerald-300 bg-white text-emerald-950"}`}>
            <p className="min-w-0 flex-1 text-sm font-medium leading-5">{toast.message}</p>
            <button type="button" onClick={() => dismissToast(toast.id)} className="shrink-0 rounded-md border border-current/30 px-2 py-1 text-xs font-bold hover:bg-black/5" aria-label="Ẩn thông báo">Đóng</button>
          </div>)}
        </div>, document.body)}
      </section>
    );
  }

  if (showTrash) {
    return <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="flex items-center justify-between border-b p-5"><div><h2 className="text-xl font-extrabold">Thùng rác (3 ngày)</h2><p className="mt-1 text-sm text-slate-500">Quản trị viên có thể khôi phục trong 3 ngày; sau hạn này dữ liệu bị xóa vĩnh viễn.</p></div><button onClick={() => setShowTrash(false)} className="ft-btn ft-btn-secondary"><ArrowLeft className="h-4 w-4" />Quay lại</button></div>{notice && <p className="m-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{notice}</p>}<div className="overflow-x-auto"><table className="ft-table"><thead><tr><th>Bài kiểm tra</th><th>Đơn vị</th><th>Hạn khôi phục</th><th /></tr></thead><tbody>{trashItems.length ? trashItems.map(item => <tr key={item.id}><td><b>{item.title}</b></td><td>{item.partner_name || '—'}</td><td>{item.purge_at ? new Date(item.purge_at).toLocaleString('vi-VN') : '—'}</td><td><button disabled={busy} onClick={() => void restoreDraft(item)} className="ft-btn ft-btn-secondary">Khôi phục</button></td></tr>) : <tr><td colSpan={4} className="py-10 text-center text-slate-500">Không có bài kiểm tra trong thùng rác.</td></tr>}</tbody></table></div></section>;
  }

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5">
        <div><h2 className="text-xl font-extrabold">Bài kiểm tra cuối khóa tập huấn</h2><p className="mt-1 text-sm text-slate-500">Một link cho mỗi đơn vị/phân lớp, tự chia đều 4–5 mã đề và chấm điểm tập trung.</p></div>
        {!isGuest && <div className="flex gap-2">{userRole === 'ADMIN' && <button onClick={() => void loadTrash()} className="ft-btn ft-btn-secondary"><Trash2 className="h-4 w-4" />Thùng rác</button>}<button onClick={() => void load()} className="ft-btn ft-btn-secondary"><RefreshCw className="h-4 w-4" /></button><button onClick={openCreate} className="ft-primary"><Plus className="h-4 w-4" />Tạo bài kiểm tra</button></div>}
      </div>
      {/* Filter bar */}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-3 border-t bg-slate-50 px-5 py-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="ft-input pl-9 text-sm"
              placeholder="Tìm theo tên, đơn vị..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>
          <select className="ft-input w-auto text-sm" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">Tất cả trạng thái</option>
            <option value="draft">Bản nháp</option>
            <option value="published">Đang mở</option>
            <option value="closed">Đã đóng</option>
            <option value="graded">Đã chấm bài</option>
            <option value="backup_complete">Đã hoàn thành sao lưu</option>
          </select>
          {partnerOptions.length > 1 && (
            <select className="ft-input w-auto text-sm" value={filterPartner} onChange={(e) => setFilterPartner(e.target.value)}>
              <option value="">Tất cả đơn vị</option>
              {partnerOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {(filterText || filterStatus || filterPartner) && (
            <button onClick={() => { setFilterText(""); setFilterStatus(""); setFilterPartner(""); }} className="text-xs font-bold text-slate-500 hover:text-slate-800">✕ Xóa bộ lọc</button>
          )}
        </div>
      )}
      {notice && <p className="mx-5 mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{notice}</p>}
      <div className="overflow-x-auto"><table className="ft-table min-w-[1280px]"><thead><tr><th>STT</th><th>Người</th><th>Bài đánh giá</th><th>Đơn vị / phân lớp</th><th>Mã đề</th><th><button type="button" onClick={() => setWorkDateSort((current) => current === "desc" ? "asc" : "desc")} className="inline-flex items-center gap-1 font-bold">Ngày mở / tạo {workDateSort === "desc" ? "↓" : "↑"}</button></th><th>Ngày đóng</th><th>Thời gian</th><th>Lượt làm</th><th>Điểm TB</th><th>Trạng thái</th></tr></thead><tbody>{sortedItems.length ? sortedItems.map((item, index) => {
        const peoplePerVariant = item.variants.length ? Math.ceil((item.participant_count || 0) / item.variants.length) : 0;
        const warningClass = item.retention_warning?.level === "urgent" ? "bg-red-600 text-white" : item.retention_warning?.level === "strong" ? "bg-orange-100 text-orange-900" : "bg-amber-100 text-amber-900";
        const warningRowClass = item.retention_warning?.level === "urgent" ? "bg-red-100 hover:bg-red-200" : item.retention_warning?.level === "strong" ? "bg-orange-50 hover:bg-orange-100" : item.retention_warning ? "bg-amber-50 hover:bg-amber-100" : "hover:bg-blue-50";
        const statusClass = item.status === "published" ? "bg-emerald-100 text-emerald-800" : item.status === "backup_complete" ? "bg-blue-100 text-blue-800" : item.status === "graded" ? "bg-violet-100 text-violet-800" : item.status === "closed" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-700";
        return <tr key={item.id} onClick={() => void openDetail(item)} className={`cursor-pointer transition-colors ${warningRowClass}`}><td>{index + 1}</td><td><b>{item.participant_count || 0}</b><span className="block text-xs text-slate-500">{peoplePerVariant ? `đang tối đa ${peoplePerVariant}/mã` : "chưa có người làm"}</span><span className="block text-xs text-amber-700">khuyến nghị ≤ 12/mã</span></td><td><b>{item.title}</b><span className="mt-1 block text-xs font-bold text-blue-600">{item.generation_mode === "auto_generate" ? "Sinh từ ngân hàng chuẩn" : "Đề soạn sẵn"}</span><span className="mt-1 block font-mono text-xs text-slate-400">{assessmentDetailPath(item.id)}</span></td><td>{item.partner_name || "—"}<span className="block text-xs text-slate-500">{item.class_name || "Không chia lớp"}</span></td><td>{item.variants.length}<span className="block text-xs text-slate-500">{item.variants.map((v) => v.name).join(", ")}</span></td><td>{formatWorkDate(item.opens_at || item.created_at)}<span className="block text-xs text-slate-500">{item.opens_at ? "Theo lịch mở bài" : "Ngày tạo"}</span></td><td>{item.retention_started_at || item.closed_at ? formatScheduleTime(item.retention_started_at || item.closed_at) : "Chưa đóng"}</td><td><span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{item.duration_minutes} phút</span></td><td>{item.submitted_count} / {item.attempts_count}</td><td>{item.average_score == null ? "—" : `${item.average_score}%`}</td><td><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass}`}>{statusLabel[item.status]}</span>{item.retention_warning && <span className={`mt-2 block rounded px-2 py-1 text-[11px] font-extrabold ${warningClass}`}><AlertTriangle className="mr-1 inline h-3 w-3" />{item.retention_warning.label}</span>}<span className={`mt-1 block text-[11px] font-bold ${item.sync_counts?.error ? "text-rose-600" : item.sync_counts?.pending ? "text-amber-600" : "text-emerald-600"}`}>Sync: {item.sync_counts?.synced || 0}/{item.submitted_count}{item.sync_counts?.error ? ` - ${item.sync_counts.error} lỗi` : ""}</span></td></tr>;
      }) : <tr><td colSpan={11} className="py-12 text-center text-slate-500">{busy ? "Đang tải..." : items.length ? "Không có kết quả khớp bộ lọc." : "Chưa có bài kiểm tra cuối tập huấn."}</td></tr>}</tbody></table></div>
    </section>
  );
}
