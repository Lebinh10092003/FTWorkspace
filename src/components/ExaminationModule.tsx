// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, Bell, Bot, CalendarDays, Check, ChevronDown, ChevronRight, CircleHelp, ClipboardCheck, GraduationCap, Handshake, LayoutDashboard, Layers3, Link2, Mail, MapPin, Pencil, FileSpreadsheet, FileText, Phone, Plus, Search, RefreshCw, School, Trophy, Trash2, UploadCloud, Users, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { initialCandidates, initialCompetitions, initialSessions, navigationItems as nav } from "./examination/fixtures";
import type { Candidate, Competition, DraftDate, ExaminationModuleProps as Props, ExaminationPage as Page, ExaminationSession as Session, TrainingClass } from "./examination/types";
import ClassDetail from "./examination/ClassDetail";
import TrainingClasses, { initialTrainingCourses, type TrainingCourse, type TrainingTeacher } from "./examination/TrainingClasses";
import Partners, { demoPartners, type Partner } from "./examination/Partners";
import ImportData from "./examination/ImportData";
import SessionSheetSources from "./examination/SessionSheetSources";
import { AiConfig, PaperCreate, PaperEditor, PaperLibrary } from "./examination/ExamPapers";
import { BlueprintEditor, BlueprintLibrary } from "./examination/ExamBlueprints";
import LogNotes, { appendLogNote as saveLogNote, formatChangeLog } from "./examination/LogNotes";
import DetailEditDialogs from "./examination/DetailEditDialogs";
import CandidateProfileDetail from "./examination/CandidateProfileDetail";
import SessionRoster from "./examination/SessionRoster";
import ConfirmModal from "./ConfirmModal";
import AccountMenu from "./AccountMenu";
import ModuleMobileNav from "./ModuleMobileNav";
import SearchableSelect from "./SearchableSelect";
import { matchesSearch } from "../lib/searchText";
import { DateBadge, DeadlineLegend as Legend, Metric, SessionsTable, TimeField, dateValue, emptyDate, todayIso, sessionDisplayName, sessionTimelineLabel, sessionRecencyKey, formatGrade, BirthDateControl, LIST_PAGE_SIZE, TablePagination } from "./examination/ui";
import { roundDates, sessionRounds } from "./examination/rounds";
import { examinationPathFor, examinationRouteFromPath } from "./examination/routes";
const emptyCandidate: Candidate = {
  code: "",
  name: "",
  school: "",
  className: "",
  city: "",
  contests: "",
  achievement: "",
  updated: "",
  email: "",
  parent: "",
  phone: "",
  identity: "",
  address: "",
  birthDate: "",
};
const candidateCodeOrder = (code: string) => {
  const match = String(code || "")
    .trim()
    .toUpperCase()
    .match(/^FT-(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};
const OverviewChartTick = ({ x, y, payload }: { x?: number; y?: number; payload?: { value?: string } }) => {
  const [code = "", timeline = ""] = String(payload?.value || "").split(" · ");
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <text x={0} y={12} textAnchor="middle" fill="#52677f" fontSize={11}>
        <tspan x={0} dy={0} fontWeight={700}>
          {code}
        </tspan>
        <tspan x={0} dy={13} fontSize={10}>
          {timeline}
        </tspan>
      </text>
    </g>
  );
};
const EXAMINATION_CACHE_KEY = "ft-examination-bootstrap-v4";
const EXAMINATION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const loadExaminationCache = () => {
  try {
    const record = JSON.parse(window.localStorage.getItem(EXAMINATION_CACHE_KEY) || "null");
    if (!record?.savedAt || Date.now() - Number(record.savedAt) >= EXAMINATION_CACHE_TTL_MS) {
      window.localStorage.removeItem(EXAMINATION_CACHE_KEY);
      return null;
    }
    return record.payload || null;
  } catch {
    return null;
  }
};
const storeExaminationCache = (payload: unknown) => {
  const save = (nextPayload: unknown) => window.localStorage.setItem(EXAMINATION_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), payload: nextPayload }));
  try {
    save(payload);
  } catch {
    // Candidate histories can exceed the browser storage quota. Keep the smaller
    // overview payload so reopening the module can still render immediately.
    try {
      const corePayload = typeof payload === "object" && payload ? { ...(payload as Record<string, unknown>), candidates: [] } : payload;
      save(corePayload);
    } catch {}
  }
};
export default function ExaminationModule({ onBackToWorkspace, onAccountClick, onLogout, userName, userEmail, photoURL, idToken, googleAccessToken, userRole, isGuest }: Props) {
  const [bootstrapCache] = useState(() => (isGuest ? null : loadExaminationCache()));
  const [page, setPage] = useState<Page>(() => examinationRouteFromPath(window.location.pathname).page),
    [routePath, setRoutePath] = useState(() => window.location.pathname),
    [query, setQuery] = useState(""),
    [sessions, setSessions] = useState(() => bootstrapCache?.sessions || initialSessions),
    [sheetLinks, setSheetLinks] = useState<
      Array<{
        id: string;
        url: string;
        sessionId: string;
        stage?: string;
        name?: string;
        sheetTab?: string;
        automationEnabled?: boolean;
        automationStartDate?: string;
        automationEndDate?: string;
        pendingManualImport?: boolean;
      }>
    >(() => bootstrapCache?.sheetLinks || []),
    [sheetAction, setSheetAction] = useState<{
      id: string;
      type: "import" | "export";
    } | null>(null),
    [candidates, setCandidates] = useState(() => bootstrapCache?.candidates || initialCandidates),
    [selected, setSelected] = useState(() => (bootstrapCache?.sessions || initialSessions)[0]),
    [selectedCompetition, setSelectedCompetition] = useState<Competition>(() => (bootstrapCache?.competitions || initialCompetitions())[0]),
    [student, setStudent] = useState<Candidate>(emptyCandidate),
    [showCreate, setShowCreate] = useState(false),
    [step, setStep] = useState<"choice" | "competition" | "ask" | "session">("choice"),
    [error, setError] = useState(""),
    [newCompetition, setNewCompetition] = useState({
      name: "",
      code: "",
      organizer: "",
      parent: "",
    }),
    [competitions, setCompetitions] = useState<Competition[]>(() => bootstrapCache?.competitions || initialCompetitions()),
    [draft, setDraft] = useState({
      name: "",
      competitionId: "",
      national: emptyDate(),
      international: emptyDate(),
      note: "",
      registrationSheetUrl: "",
      registrationSheetTab: "",
      outputSheetUrl: "",
      outputSheetTab: "",
      rounds: [
        { id: "round-national", name: "Vòng loại Quốc Gia", time: emptyDate() },
        {
          id: "round-final",
          name: "Vòng Chung kết Quốc gia",
          time: emptyDate(),
        },
        { id: "round-international", name: "Vòng Quốc tế", time: emptyDate() },
      ] as { id: string; name: string; time: DraftDate }[],
    }),
    [editing, setEditing] = useState(false),
    [studentDraft, setStudentDraft] = useState<Candidate>(emptyCandidate),
    [sessionTab, setSessionTab] = useState<"info" | "students" | "classes" | number>("info"),
    [compOpen, setCompOpen] = useState(false),
    [classOpen, setClassOpen] = useState(false),
    [paperOpen, setPaperOpen] = useState(() => ["papers", "paper-create", "paper-detail", "blueprints", "blueprint-detail", "ai-config"].includes(page)),
    [classDetail, setClassDetail] = useState({
      name: "",
      teacher: "",
      schedule: "",
    }),
    [showTeachers, setShowTeachers] = useState(false),
    [teachers, setTeachers] = useState<TrainingTeacher[]>([
      {
        name: "Đinh Thị Thanh Huyền",
        subject: "",
        phone: "0962072212",
        email: "dinhthanhhuyen152@gmail.com",
        workplace: "Trường THCS Trương Công Giai",
      },
      {
        name: "Chử Thị Trang Nhung",
        subject: "",
        phone: "0344369009",
        email: "Trangnhung0407@gmail.com",
        workplace: "THCS Trương Công Giai",
      },
      {
        name: "Nguyễn Minh Châu",
        subject: "",
        phone: "0769723316",
        email: "s2318009@u.tsukuba.ac.jp",
        workplace: "Đại học Tsukuba",
      },
    ]),
    [trainingClasses, setTrainingClasses] = useState<TrainingCourse[]>(() => {
      try {
        const stored = JSON.parse(localStorage.getItem("ft-examination-training-classes") || "[]");
        return Array.isArray(stored) ? stored : initialTrainingCourses;
      } catch {
        return initialTrainingCourses;
      }
    }),
    [partners, setPartners] = useState<Partner[]>(() => {
      try {
        return JSON.parse(localStorage.getItem("ft-examination-partners") || "[]");
      } catch {
        return demoPartners;
      }
    }),
    [classSessionFilter, setClassSessionFilter] = useState(""),
    [classToOpen, setClassToOpen] = useState<string | null>(null),
    [candidateContestFilter, setCandidateContestFilter] = useState<string[]>([]),
    [candidateGradeFilter, setCandidateGradeFilter] = useState<string[]>([]),
    [candidateSchoolFilter, setCandidateSchoolFilter] = useState<string[]>([]),
    [sessionCompetitionFilter, setSessionCompetitionFilter] = useState<string[]>([]),
    [sessionOrganizerFilter, setSessionOrganizerFilter] = useState<string[]>([]),
    [sessionYearFilter, setSessionYearFilter] = useState<string[]>([]),
    [sessionMonthFilter, setSessionMonthFilter] = useState<string[]>([]),
    [sessionPhaseFilter, setSessionPhaseFilter] = useState<string[]>(["Hoàn thành"]),
    [teacherSubjectFilter, setTeacherSubjectFilter] = useState<string[]>([]),
    [teacherWorkplaceFilter, setTeacherWorkplaceFilter] = useState<string[]>([]),
    [teacherAssignmentFilter, setTeacherAssignmentFilter] = useState<string[]>([]),
    [teacherQuery, setTeacherQuery] = useState(""),
    [showCandidateAdd, setShowCandidateAdd] = useState(false),
    [candidateAdd, setCandidateAdd] = useState({
      code: "",
      name: "",
      school: "",
      className: "",
      birthDate: "",
      contests: "",
      sessionId: "",
    }),
    [selectedTeacher, setSelectedTeacher] = useState({
      name: "Đinh Thị Thanh Huyền",
      subject: "",
      phone: "0962072212",
      email: "dinhthanhhuyen152@gmail.com",
      workplace: "Trường THCS Trương Công Giai",
    }),
    [dialog, setDialog] = useState<"competition" | "session" | "candidate" | "teacher" | "enrol" | null>(null),
    [dialogError, setDialogError] = useState(""),
    [dialogBusy, setDialogBusy] = useState(false),
    [competitionEdit, setCompetitionEdit] = useState<Competition>(initialCompetitions()[0]),
    [sessionEdit, setSessionEdit] = useState<Session>(initialSessions[0]),
    [candidateEdit, setCandidateEdit] = useState<Candidate>(emptyCandidate),
    [bootstrapError, setBootstrapError] = useState(""),
    [teacherEdit, setTeacherEdit] = useState<any>({
      name: "Đinh Thị Thanh Huyền",
      subject: "",
      phone: "0962072212",
      email: "dinhthanhhuyen152@gmail.com",
      workplace: "Trường THCS Trương Công Giai",
    }),
    [candidateEnroll, setCandidateEnroll] = useState<Candidate>({
      code: "",
      name: "",
      school: "",
      className: "",
      city: "",
      contests: "",
      achievement: "",
      email: "",
      parent: "",
      phone: "",
      identity: "",
      address: "",
      birthDate: "",
      updated: "",
    }),
    [notice, setNotice] = useState(""),
    [importSessionId, setImportSessionId] = useState(""),
    [deleteTarget, setDeleteTarget] = useState<{
      kind: "candidate" | "session" | "enrollment" | "competition" | "teacher" | "bulk-candidate" | "bulk-enrollment" | "draft-round";
      id: string;
      code?: string;
      ids?: string[];
      name: string;
    } | null>(null),
    [selectedCandidateCodes, setSelectedCandidateCodes] = useState<string[]>([]),
    [selectedSessionStudentCodes, setSelectedSessionStudentCodes] = useState<string[]>([]),
    [candidatePage, setCandidatePage] = useState(1),
    [competitionPage, setCompetitionPage] = useState(1),
    [teacherPage, setTeacherPage] = useState(1),
    [overviewCompetitionFilter, setOverviewCompetitionFilter] = useState("");
  const [sessionPhaseFilterMode, setSessionPhaseFilterMode] = useState<"include" | "exclude">("exclude");
  const [today, setToday] = useState(() => todayIso());
  useEffect(() => {
    const now = new Date(),
      next = new Date(now);
    next.setHours(24, 0, 2, 0);
    const timer = window.setTimeout(() => setToday(todayIso()), next.getTime() - now.getTime());
    return () => window.clearTimeout(timer);
  }, [today]);
  const api = async (path: string, options: RequestInit = {}) => {
    const response = await fetch(`/api/examination${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        ...options.headers,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const guidance = response.status === 401 ? "Phiên đăng nhập đã hết hoặc bạn đang ở chế độ Khách. Hãy đăng nhập lại để lưu dữ liệu." : response.status === 403 ? "Tài khoản của bạn chưa có quyền lưu dữ liệu này." : "Không thể lưu dữ liệu (mã " + response.status + "). Hãy thử lại hoặc liên hệ quản trị viên.";
      throw new Error(body.error || body.detail || guidance);
    }
    return body;
  };
  const forceExaminationSync = () => {
    try {
      window.localStorage.removeItem(EXAMINATION_CACHE_KEY);
    } catch {}
    window.location.reload();
  };
  useEffect(() => {
    let active = true;
    Promise.all([api("/bootstrap"), isGuest ? Promise.resolve([]) : api("/sheets")])
      .then(([data, sheetRows]) => {
        if (!active) return;
        setBootstrapError("");
        storeExaminationCache({
          ...data,
          sheetLinks: Array.isArray(sheetRows) ? sheetRows : [],
        });
        setSessions(data.sessions || []);
        setSheetLinks(Array.isArray(sheetRows) ? sheetRows : []);
        setCandidates(data.candidates || []);
        setPartners((current) => (Array.isArray(data.partners) && data.partners.length ? data.partners : current));
        setCompetitions(data.competitions || []);
        if (data.sessions?.[0]) setSelected(data.sessions[0]);
        if (data.candidates?.[0]) {
          setStudent(data.candidates[0]);
          setStudentDraft(data.candidates[0]);
        }
      })
      .catch((error) => {
        console.warn("Không thể tải dữ liệu khảo thí:", error);
        if (active && !bootstrapCache) setBootstrapError("Không thể tải dữ liệu từ máy chủ. Dữ liệu cục bộ/demo không được xem là dữ liệu chính thức. Vui lòng tải lại hoặc đăng nhập lại.");
      });
    return () => {
      active = false;
    };
  }, [idToken, today]);
  const persistPartners = (next: Partner[]) => {
    setPartners(next);
    localStorage.setItem("ft-examination-partners", JSON.stringify(next));
    api("/partners", {
      method: "PUT",
      body: JSON.stringify({ partners: next }),
    })
      .then((result) => {
        if (Array.isArray(result.partners)) {
          setPartners(result.partners);
          localStorage.setItem("ft-examination-partners", JSON.stringify(result.partners));
        }
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "Không thể lưu đối tác."));
  };
  const appendLogNote = (entityKey: string, content: string, actor = "Hệ thống FT Workspace", system = false) => saveLogNote(entityKey, content, actor, system, idToken);
  const canEdit = !isGuest && userRole === "ADMIN";
  const canManage = !isGuest && (userRole === "ADMIN" || userRole === "MANAGER");
  const canContribute = !isGuest && Boolean(idToken);
  const go = (next: Page, id = "") => {
    const path = examinationPathFor(next, id);
    if (window.location.pathname !== path) {
      window.history.pushState(null, "", path);
      setRoutePath(path);
    }
    setPage(next);
    if (["papers", "paper-create", "paper-detail", "blueprints", "blueprint-detail"].includes(next)) setPaperOpen(true);
    setQuery("");
    setEditing(false);
  };
  useEffect(() => {
    const onPopState = () => setRoutePath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    const route = examinationRouteFromPath(routePath);
    setPage(route.page);
    if (route.page === "session-detail" && route.id) {
      const item = sessions.find((value) => value.id === route.id);
      if (item) setSelected(item);
    } else if (route.page === "competition-detail" && route.id) {
      const item = competitions.find((value) => value.id === route.id);
      if (item) setSelectedCompetition(item);
    } else if (route.page === "candidate-detail" && route.id) {
      const item = candidates.find((value) => value.code === route.id);
      if (item) {
        setStudent(item);
        setStudentDraft(item);
      }
    } else if (route.page === "teacher-detail" && route.id) {
      const item = teachers.find((value) => value.email === route.id);
      if (item) setSelectedTeacher(item);
    } else if (route.page === "class-detail" && route.id) {
      setClassToOpen(route.id);
      setPage("classes");
    }
  }, [routePath, sessions, competitions, candidates, teachers]);
  const select = (s: Session) => {
    setSelected(s);
    go("session-detail", s.id);
  };
  const selectCompetition = (competition: Competition) => {
    setSelectedCompetition(competition);
    go("competition-detail", competition.id);
  };
  const sortedDatedRounds = (session: Session) =>
    sessionRounds(session)
      .flatMap((round) => roundDates(round).map((date) => ({ ...round, date })))
      .sort((left, right) => left.date.localeCompare(right.date));
  const finalRound = (session: Session) => {
    const rounds = sortedDatedRounds(session);
    return rounds[rounds.length - 1] || null;
  };
  const nextScheduledRound = (session: Session) => sortedDatedRounds(session).find((round) => String(round.date) >= today) || null;
  const sessionPriority = (session: Session) => nextScheduledRound(session)?.date || finalRound(session)?.date || "9999-12-31";
  const overviewPhaseKey = (value: string) =>
    String(value || "")
      .trim()
      .toLocaleLowerCase("vi-VN")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/\s*\/\s*/g, "/")
      .replace(/\s+/g, " ");
  const completedPhase = (session: Session) => overviewPhaseKey(session.phase) === "hoan thanh";
  const trackedPhase = (session: Session) => {
    const phase = overviewPhaseKey(session.phase);
    if (!phase || phase === "chua cap nhat" || phase === "hoan thanh") return false;
    // Preparation/communications do not yet have a candidate population to
    // monitor. Track recruitment, actual round/revision phases and the
    // post-round result lifecycle instead of relying on exact editable labels.
    if (phase.startsWith("chuan bi") || phase.startsWith("truyen thong")) return false;
    if (phase === "tuyen sinh" || phase.includes("vong")) return true;
    const resultPhases = ["tong hop ket qua", "cong bo ket qua", "vinh danh"];
    return resultPhases.some((item) => phase === item || phase.startsWith(item + " ") || phase.startsWith(item + ","));
  };
  const roundDayOffset = (roundDate?: string) => {
    const value = String(roundDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    return Math.round((new Date(`${value}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000);
  };
  const isOverviewSession = (session: Session) => {
    const final = finalRound(session),
      finalOffset = roundDayOffset(final?.date);
    if (finalOffset !== null && finalOffset < -30) return false;
    if (completedPhase(session)) return finalOffset !== null && finalOffset <= 0 && finalOffset >= -30;
    return trackedPhase(session);
  };
  const overviewSort = (left: Session, right: Session) => {
    const leftFinal = roundDayOffset(finalRound(left)?.date),
      rightFinal = roundDayOffset(finalRound(right)?.date),
      leftPost = leftFinal !== null && leftFinal < 0,
      rightPost = rightFinal !== null && rightFinal < 0;
    if (leftPost !== rightPost) return leftPost ? 1 : -1;
    const leftKey = leftPost ? String(finalRound(left)?.date || "9999-12-31") : String(nextScheduledRound(left)?.date || finalRound(left)?.date || "9999-12-31"),
      rightKey = rightPost ? String(finalRound(right)?.date || "9999-12-31") : String(nextScheduledRound(right)?.date || finalRound(right)?.date || "9999-12-31");
    return leftKey.localeCompare(rightKey);
  };
  const overviewSourceSessions = useMemo(() => sessions.filter(isOverviewSession).sort(overviewSort), [sessions, today]);
  const overviewCompetitionOptions = useMemo(
    () => [
      ...new Map(
        overviewSourceSessions.map((session) => [
          session.code,
          {
            value: session.code,
            label: `${session.code} · ${session.competitionName || session.parent || session.name}`,
          },
        ]),
      ).values(),
    ],
    [overviewSourceSessions],
  );
  const overviewSessions = useMemo(() => (overviewCompetitionFilter ? overviewSourceSessions.filter((session) => session.code === overviewCompetitionFilter) : overviewSourceSessions), [overviewSourceSessions, overviewCompetitionFilter]);
  useEffect(() => {
    if (overviewCompetitionFilter && !overviewSourceSessions.some((session) => session.code === overviewCompetitionFilter)) setOverviewCompetitionFilter("");
  }, [overviewCompetitionFilter, overviewSourceSessions]);
  const overviewChartSessions = useMemo(() => overviewSessions.filter((session) => !completedPhase(session)), [overviewSessions]);
  const overviewChartData = useMemo(
    () =>
      overviewChartSessions.map((session) => ({
        ...session,
        chartLabel: `${session.code} · ${sessionTimelineLabel(session)}`,
      })),
    [overviewChartSessions],
  );
  const overviewChartWidth = Math.max(760, overviewChartData.length * 180);
  const milestoneSessions = useMemo(() => overviewSessions.filter((session) => Boolean(nextScheduledRound(session))), [overviewSessions, today]);
  const sessionMonthKey = (session: Session) => session.nationalDate?.slice(0, 7) || session.internationalDate?.slice(0, 7) || "";
  const sessionYear = (session: Session) => sessionMonthKey(session).slice(0, 4) || session.time.match(/20\d{2}/)?.[0] || "";
  const sessionMonthLabel = (key: string) => (key ? `T${Number(key.slice(5, 7))}/${key.slice(0, 4)}` : "Chưa có thông tin");
  const prioritizedSessions = useMemo(() => [...sessions].sort((a, b) => String(sessionPriority(a)).localeCompare(String(sessionPriority(b)))), [sessions, today]);
  const search = useMemo(() => prioritizedSessions.filter((s) => matchesSearch(s.code + s.name + s.organizer + sessionDisplayName(s), query) && (!sessionCompetitionFilter.length || sessionCompetitionFilter.includes(s.code)) && (!sessionOrganizerFilter.length || sessionOrganizerFilter.includes(s.organizer)) && (!sessionYearFilter.length || sessionYearFilter.includes(sessionYear(s))) && (!sessionMonthFilter.length || sessionMonthFilter.includes(sessionMonthKey(s))) && (!sessionPhaseFilter.length || (sessionPhaseFilterMode === "include" ? sessionPhaseFilter.includes(s.phase) : !sessionPhaseFilter.includes(s.phase)))), [prioritizedSessions, query, sessionCompetitionFilter, sessionOrganizerFilter, sessionYearFilter, sessionMonthFilter, sessionPhaseFilter, sessionPhaseFilterMode]);
  const filteredCompetitions = useMemo(
    () =>
      competitions
        .filter((c) => matchesSearch(c.code + c.name + c.organizer + c.parent, query))
        .sort((a, b) => {
          const aDate = Math.min(...sessions.filter((s) => s.competitionId === a.id || s.code === a.code).map((s) => Number(sessionPriority(s).replace(/-/g, ""))), 99991231);
          const bDate = Math.min(...sessions.filter((s) => s.competitionId === b.id || s.code === b.code).map((s) => Number(sessionPriority(s).replace(/-/g, ""))), 99991231);
          return aDate - bDate;
        }),
    [competitions, sessions, today, query],
  );
  const latestCompetitionSession = (competition: Competition) => sessions.filter((session) => session.competitionId === competition.id || session.code === competition.code).sort((a, b) => sessionRecencyKey(b).localeCompare(sessionRecencyKey(a)))[0];
  const gradeOf = (candidate: Candidate) => formatGrade(candidate?.grade) || (candidate?.className || "").match(/\d+/)?.[0] || candidate.className;
  const people = useMemo(
    () =>
      candidates
        .filter((c) => matchesSearch(c.code + c.name + c.school + c.contests, query) && (!candidateContestFilter.length || candidateContestFilter.some((item) => (c.contests || "").includes(item))) && (!candidateGradeFilter.length || candidateGradeFilter.includes(gradeOf(c))) && (!candidateSchoolFilter.length || candidateSchoolFilter.includes(c.school)))
        .sort(
          (left, right) =>
            candidateCodeOrder(left.code) - candidateCodeOrder(right.code) ||
            left.code.localeCompare(right.code, "en", {
              numeric: true,
              sensitivity: "base",
            }),
        ),
    [candidates, query, candidateContestFilter, candidateGradeFilter, candidateSchoolFilter],
  );
  const candidatePageCount = Math.max(1, Math.ceil(people.length / LIST_PAGE_SIZE));
  const activeCandidatePage = Math.min(candidatePage, candidatePageCount);
  const visibleCandidates = people.slice((activeCandidatePage - 1) * LIST_PAGE_SIZE, activeCandidatePage * LIST_PAGE_SIZE);
  const competitionPageCount = Math.max(1, Math.ceil(filteredCompetitions.length / LIST_PAGE_SIZE));
  const activeCompetitionPage = Math.min(competitionPage, competitionPageCount);
  const visibleCompetitions = filteredCompetitions.slice((activeCompetitionPage - 1) * LIST_PAGE_SIZE, activeCompetitionPage * LIST_PAGE_SIZE);
  const nextMilestone = (session: Session) => {
    const round = nextScheduledRound(session);
    const date = String(round?.date || "");
    return round
      ? { label: round.name || round.label, date, dateLabel: date.split("-").reverse().join("/") }
      : { label: "Chưa có thông tin", date: "", dateLabel: "Chưa có thông tin" };
  };
  const open = (next: "choice" | "competition" | "session" = "choice", id = "") => {
    setError("");
    setStep(next);
    if (next === "session")
      setDraft({
        name: "",
        competitionId: id,
        national: emptyDate(),
        international: emptyDate(),
        note: "",
        registrationSheetUrl: "",
        registrationSheetTab: "",
        outputSheetUrl: "",
        outputSheetTab: "",
        rounds: [
          {
            id: "round-national",
            name: "Vòng loại Quốc Gia",
            time: emptyDate(),
          },
          {
            id: "round-final",
            name: "Vòng Chung kết Quốc gia",
            time: emptyDate(),
          },
          {
            id: "round-international",
            name: "Vòng Quốc tế",
            time: emptyDate(),
          },
        ],
      });
    else if (id) setDraft((d) => ({ ...d, competitionId: id }));
    setShowCreate(true);
  };
  const close = () => {
    setShowCreate(false);
    setStep("choice");
    setError("");
  };
  const recordChanges = (entityKey: string, before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>) => {
    const details = Object.entries(labels)
      .flatMap(([field, label]) => {
        const previous = String(before[field] ?? "").trim(),
          next = String(after[field] ?? "").trim();
        if (previous === next) return [];
        return [`${previous ? `Đổi ${label} từ "${previous}" thành "${next}"` : `Bổ sung thêm thông tin ${label} thành "${next}"`}`];
      })
      .filter(Boolean);
    if (details.length) appendLogNote(entityKey, details.join("\n"), userName || "Nhân viên FT Workspace");
  };
  const createCandidate = async () => {
    const item = {
      ...candidateAdd,
      code: candidateAdd.code,
      city: "",
      achievement: "",
      email: "",
      parent: "",
      phone: "",
      identity: "",
      address: "",
      birthDate: candidateAdd.birthDate,
      updated: new Date().toLocaleDateString("vi-VN"),
    };
    try {
      const result = await api("/import/candidates", {
        method: "POST",
        body: JSON.stringify({
          records: [item],
          sessionId: candidateAdd.sessionId,
          source: "Nhập thủ công",
        }),
      });
      (result.items || [item]).forEach((candidate: Candidate) => appendLogNote(`candidate-${candidate.code}`, "Tạo thí sinh mới.", userName || "Nhân viên FT Workspace"));
      setCandidates((list) => [...list, ...(result.items || [item])]);
      setCandidateAdd({
        code: "",
        name: "",
        school: "",
        className: "",
        birthDate: "",
        contests: "",
        sessionId: "",
      });
      setShowCandidateAdd(false);
    } catch (requestError: any) {
      setNotice(requestError.message || "Không thể thêm thí sinh.");
    }
  };
  const updateCompetitionDetails = () => {
    setCompetitionEdit(selectedCompetition);
    setDialogError("");
    setDialog("competition");
  };
  const updateSelectedSession = () => {
    setSessionEdit({ ...selected, rounds: sessionRounds(selected) });
    setDialogError("");
    setDialog("session");
  };
  const updateTeacherDetails = () => {
    setTeacherEdit(selectedTeacher);
    setDialogError("");
    setDialog("teacher");
  };
  const runSessionSheetAction = async (type: "import" | "export") => {
    if (type === "import") {
      setImportSessionId(selected.id);
      go("import");
      return;
    }
    const link = sheetLinks.find((item) => item.sessionId === selected.id && item.stage === "session-output");
    if (!link) {
      setNotice("Kỳ này chưa có Sheet tổng hợp.");
      return;
    }
    setSheetAction({ id: link.id, type });
    try {
      await api(`/sheets/${link.id}/export`, { method: "POST" });
      setNotice("Đã xuất dữ liệu sang Sheet tổng hợp.");
    } catch (e: any) {
      setNotice(e.message || "Không thể xuất Sheet tổng hợp.");
    } finally {
      setSheetAction(null);
    }
  };
  const createCompetition = async () => {
    try {
      const row = await api("/competitions", {
        method: "POST",
        body: JSON.stringify(newCompetition),
      });
      setCompetitions((list) => [...list, row]);
      setSelectedCompetition(row);
      setStep("ask");
    } catch (e: any) {
      setError(e.message || "Không thể tạo cuộc thi.");
    }
  };
  const createSession = async () => {
    try {
      const payload = {
        ...draft,
        national: dateValue(draft.national),
        international: dateValue(draft.international),
        rounds: draft.rounds.map((item) => {
          const days = item.days?.length ? item.days : [item.time];
          return {
            id: item.id,
            name: item.name,
            ...dateValue(days[0]),
            slots: days.map((time, index) => ({
              id: `${item.id}-day-${index + 1}`,
              ...dateValue(time),
            })),
          };
        }),
      };
      const row = await api("/sessions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setSessions((list) => [...list, row]);
      setSelected(row);
      close();
      go("session-detail", row.id);
    } catch (e: any) {
      setError(e.message || "Không thể tạo kỳ tổ chức.");
    }
  };
  const saveDialog = async () => {
    setDialogBusy(true);
    try {
      if (dialog === "competition") {
        const row = await api(`/competitions/${competitionEdit.id}`, {
          method: "PUT",
          body: JSON.stringify(competitionEdit),
        });
        setCompetitions((list) => list.map((item) => (item.id === row.id ? row : item)));
        setSelectedCompetition(row);
      } else if (dialog === "session") {
        const row = await api(`/sessions/${sessionEdit.id}`, {
          method: "PUT",
          body: JSON.stringify(sessionEdit),
        });
        setSessions((list) => list.map((item) => (item.id === row.id ? row : item)));
        setSelected(row);
      } else if (dialog === "candidate") {
        const row = await api(`/candidates/${candidateEdit.code}`, {
          method: "PUT",
          body: JSON.stringify(candidateEdit),
        });
        setCandidates((list) => list.map((item) => (item.code === row.code ? row : item)));
        setStudent(row);
      } else if (dialog === "enrol") {
        if (!selected?.id) throw new Error("Ch\u01b0a ch\u1ecdn k\u1ef3 t\u1ed5 ch\u1ee9c.");
        if (!candidateEnroll.name.trim()) throw new Error("H\u00e3y ch\u1ecdn m\u1ed9t th\u00ed sinh t\u1eeb kho ho\u1eb7c nh\u1eadp h\u1ecd t\u00ean h\u1ed3 s\u01a1 m\u1edbi.");
        await api("/import/candidates", {
          method: "POST",
          body: JSON.stringify({
            sessionId: selected.id,
            source: "Th\u00eam th\u00ed sinh t\u1eeb kho",
            records: [
              {
                ...candidateEnroll,
                contests: candidateEnroll.contests || selected.code,
              },
            ],
          }),
        });
        const refreshed = await api("/bootstrap");
        setCandidates(refreshed.candidates || []);
        setSessions(refreshed.sessions || []);
        const refreshedSession = (refreshed.sessions || []).find((item: Session) => item.id === selected.id);
        if (refreshedSession) setSelected(refreshedSession);
        setNotice(`\u0110\u00e3 th\u00eam ${candidateEnroll.name} v\u00e0o k\u1ef3 t\u1ed5 ch\u1ee9c.`);
      } else if (dialog === "teacher") {
        const before = selectedTeacher;
        const row = { ...teacherEdit };
        setTeachers((list) => list.map((item) => (item.email === row.email ? row : item)));
        setSelectedTeacher(row);
        appendLogNote(`teacher-${row.email}`, formatChangeLog("Cập nhật hồ sơ giáo viên", before, row), userName || "Nhân viên FT Workspace");
      }
      setDialog(null);
    } catch (e: any) {
      setDialogError(e.message || "Không thể lưu thay đổi.");
    } finally {
      setDialogBusy(false);
    }
  };
  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    try {
      if (target.kind === "draft-round") {
        setDraft((current) => ({
          ...current,
          rounds: current.rounds.filter((item) => item.id !== target.id),
        }));
        setNotice("Đã xóa vòng thi.");
      } else if (target.kind === "candidate") {
        await api(`/candidates/${encodeURIComponent(target.id)}`, {
          method: "DELETE",
        });
        setCandidates((list) => list.filter((item) => item.code !== target.id));
        setSelectedCandidateCodes((list) => list.filter((code) => code !== target.id));
        if (student.code === target.id) setStudent(emptyCandidate);
        setNotice(`Đã xóa thí sinh ${target.name}.`);
      } else if (target.kind === "bulk-candidate") {
        const ids = target.ids || [];
        await Promise.all(
          ids.map((code) =>
            api(`/candidates/${encodeURIComponent(code)}`, {
              method: "DELETE",
            }),
          ),
        );
        setCandidates((list) => list.filter((item) => !ids.includes(item.code)));
        setSelectedCandidateCodes([]);
        if (ids.includes(student.code)) setStudent(emptyCandidate);
        setNotice(`Đã xóa ${ids.length} thí sinh.`);
      } else if (target.kind === "enrollment") {
        const code = target.code || target.id;
        await api(`/candidates/${encodeURIComponent(code)}/sessions/${encodeURIComponent(target.id)}`, { method: "DELETE" });
        const refreshed = await api("/bootstrap");
        setCandidates(refreshed.candidates || []);
        setSessions(refreshed.sessions || []);
        setNotice(`Đã gỡ ${target.name} khỏi kỳ thi.`);
      } else if (target.kind === "session") {
        await api(`/sessions/${encodeURIComponent(target.id)}`, {
          method: "DELETE",
        });
        setSessions((list) => list.filter((item) => item.id !== target.id));
        setNotice(`Đã xóa kỳ thi ${target.name}.`);
      } else if (target.kind === "competition") {
        await api(`/competitions/${encodeURIComponent(target.id)}`, {
          method: "DELETE",
        });
        setCompetitions((list) => list.filter((item) => item.id !== target.id));
        setNotice(`Đã xóa cuộc thi ${target.name}.`);
      } else if (target.kind === "teacher") {
        setTeachers((list) => list.filter((item) => item.email !== target.id));
        setNotice(`Đã xóa giáo viên ${target.name}.`);
      }
      setDeleteTarget(null);
    } catch (error: any) {
      setNotice(error?.message || "Không thể xóa dữ liệu.");
    }
  };
  const teacherCourses = (teacher: TrainingTeacher) => trainingClasses.filter((course) => course.teacherEmail === teacher.email || (!course.teacherEmail && course.teacher === teacher.name));
  const filteredTeachers = teachers.filter((teacher) => {
    const courses = teacherCourses(teacher),
      haystack = [teacher.name, teacher.subject, teacher.email, teacher.phone, teacher.workplace].join(" ");
    return matchesSearch(haystack, teacherQuery) && (!teacherSubjectFilter.length || teacherSubjectFilter.includes(teacher.subject)) && (!teacherWorkplaceFilter.length || teacherWorkplaceFilter.includes(teacher.workplace)) && (!teacherAssignmentFilter.length || (teacherAssignmentFilter.includes("assigned") && courses.length) || (teacherAssignmentFilter.includes("unassigned") && !courses.length));
  });
  const teacherPageCount = Math.max(1, Math.ceil(filteredTeachers.length / LIST_PAGE_SIZE));
  const activeTeacherPage = Math.min(teacherPage, teacherPageCount);
  const visibleTeachers = filteredTeachers.slice((activeTeacherPage - 1) * LIST_PAGE_SIZE, activeTeacherPage * LIST_PAGE_SIZE);
  useEffect(() => setCandidatePage(1), [query, candidateContestFilter, candidateGradeFilter, candidateSchoolFilter]);
  useEffect(() => setCompetitionPage(1), [query]);
  useEffect(() => setTeacherPage(1), [teacherQuery, teacherSubjectFilter, teacherWorkplaceFilter, teacherAssignmentFilter]);
  const classes = (
    <>
      <section className="mb-6 ft-surface">
        <h1 className="text-2xl font-extrabold text-[#001e40]">Lớp ôn tập</h1>
        <p className="mt-2 text-sm text-slate-600">Quản lý lớp ôn tập theo kỳ tổ chức, giáo viên và lịch học.</p>
      </section>
      <TrainingClasses
        idToken={idToken}
        candidates={candidates}
        sessions={sessions}
        courses={trainingClasses}
        teachers={teachers}
        onCoursesChange={(next) => {
          setTrainingClasses(next);
          try {
            localStorage.setItem("ft-examination-training-classes", JSON.stringify(next));
          } catch {}
        }}
        onAddTeacher={(teacher) => setTeachers((list) => (list.some((item) => item.email === teacher.email) ? list : [...list, teacher]))}
        onCandidate={(candidate) => {
          setStudent(candidate);
          setStudentDraft(candidate);
          go("candidate-detail", candidate.code);
        }}
        canManage={canManage}
        canDelete={canEdit}
        actor={userName}
        initialSessionId={classSessionFilter || undefined}
        openCourseId={classToOpen}
        onOpened={() => setClassToOpen(null)}
      />
    </>
  );
  const teachersPage = (
    <>
      <section className="mb-6 ft-surface">
        <h1 className="text-2xl font-extrabold text-[#001e40]">Thông tin giáo viên</h1>
        <p className="mt-2 text-sm text-slate-600">Theo dõi chuyên môn, thông tin liên hệ và các lớp ôn tập được phân công.</p>
      </section>
      <section className="mb-5 grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="ft-input-wrap">
          <Search className="h-5 w-5" />
          <input value={teacherQuery} onChange={(event) => setTeacherQuery(event.target.value)} placeholder="Tìm tên, email, SĐT..." />
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold text-slate-500">Chuyên môn</span>
          <SearchableSelect multiple value={teacherSubjectFilter} onChange={setTeacherSubjectFilter} options={[...new Set(teachers.map((teacher) => teacher.subject).filter(Boolean))].sort().map((subject) => ({ value: subject, label: subject }))} placeholder="Tất cả chuyên môn" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold text-slate-500">Đơn vị công tác</span>
          <SearchableSelect multiple value={teacherWorkplaceFilter} onChange={setTeacherWorkplaceFilter} options={[...new Set(teachers.map((teacher) => teacher.workplace).filter(Boolean))].sort().map((workplace) => ({ value: workplace, label: workplace }))} placeholder="Tất cả đơn vị" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold text-slate-500">Phân công lớp</span>
          <SearchableSelect
            multiple
            value={teacherAssignmentFilter}
            onChange={setTeacherAssignmentFilter}
            options={[
              { value: "assigned", label: "Đã phân công lớp" },
              { value: "unassigned", label: "Chưa phân công lớp" },
            ]}
            placeholder="Tất cả trạng thái"
          />
        </label>
      </section>
      <section className="ft-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="ft-table min-w-[1040px]">
            <thead>
              <tr>
                <th>Giáo viên</th>
                <th>Chuyên môn</th>
                <th>Liên hệ</th>
                <th>Đơn vị công tác</th>
                <th>Lớp phụ trách</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleTeachers.map((teacher) => {
                const courses = teacherCourses(teacher);
                return (
                  <tr
                    key={teacher.email}
                    onClick={() => {
                      setSelectedTeacher(teacher);
                      go("teacher-detail", teacher.email);
                    }}
                    className="cursor-pointer hover:bg-blue-50/50"
                  >
                    <td>
                      <b className="text-[#001e40]">{teacher.name}</b>
                      <p className="mt-1 text-xs text-slate-500">{teacher.email}</p>
                    </td>
                    <td>{teacher.subject || "Chưa cập nhật"}</td>
                    <td>{teacher.phone || "Chưa cập nhật"}</td>
                    <td>{teacher.workplace || "Chưa cập nhật"}</td>
                    <td>
                      {courses.length ? (
                        <div className="flex flex-wrap gap-1">
                          {courses.map((course) => (
                            <span key={course.id} className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-[#001e40]">
                              {course.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400">Chưa phân công</span>
                      )}
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {canManage && (
                          <button
                            title="Thay đổi thông tin giáo viên"
                            onClick={() => {
                              setTeacherEdit(teacher);
                              setDialogError("");
                              setDialog("teacher");
                            }}
                            className="rounded p-2 text-[#001e40] hover:bg-blue-50"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            title="Xóa giáo viên"
                            onClick={() =>
                              setDeleteTarget({
                                kind: "teacher",
                                id: teacher.email,
                                name: teacher.name,
                              })
                            }
                            className="rounded p-2 text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!filteredTeachers.length && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm text-slate-500">
                    Không tìm thấy giáo viên phù hợp với bộ lọc.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination total={filteredTeachers.length} page={activeTeacherPage} onPageChange={setTeacherPage} label="giáo viên" />
      </section>
    </>
  );
  const importPage = (
    <ImportData
      idToken={idToken}
      googleAccessToken={googleAccessToken}
      canImport={canContribute}
      sessionId={importSessionId}
      sessions={sessions}
      onImported={(items) =>
        setCandidates((list) => {
          const map = new Map(list.map((item) => [item.code, item]));
          items.forEach((item) => map.set(item.code, item));
          return [...map.values()];
        })
      }
    />
  );
  const Header = ({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) => {
    const isOverview = title === "Tổng quan khảo thí";
    const resolvedAction = isOverview ? (
      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-end">
        <label className="block w-full sm:w-[320px]">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Cuộc thi</span>
          <select value={overviewCompetitionFilter} onChange={(event) => setOverviewCompetitionFilter(event.target.value)} className="ft-input w-full bg-white">
            <option value="">Tất cả cuộc thi đang tổ chức</option>
            {overviewCompetitionOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={forceExaminationSync} className="inline-flex h-[42px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-[#001e40] shadow-sm hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" />
          Đồng bộ lại
        </button>
      </div>
    ) : (
      action
    );
    return (
      <div className={`mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between ${isOverview ? "ft-overview-header" : ""}`}>
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
            <span>Khảo thí</span>
            <ChevronRight className="h-4 w-4" />
            <b>{title}</b>
          </div>
          <h1 className="text-3xl font-extrabold text-[#101827]">{title}</h1>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        {resolvedAction}
      </div>
    );
  };
  const overview = (
    <>
      <Header
        title="Tổng quan khảo thí"
        description="Theo dõi cuộc thi đang triển khai, quy mô thí sinh và các mốc sắp tới."
        action={
          <button type="button" onClick={forceExaminationSync} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#001e40] shadow-sm hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" />
            Đồng bộ lại
          </button>
        }
      />
      <section className="ft-surface mb-6 p-5">
        <div className="flex flex-wrap justify-end">
          <label className="block min-w-[280px]">
            <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Cuộc thi</span>
            <select value={overviewCompetitionFilter} onChange={(event) => setOverviewCompetitionFilter(event.target.value)} className="ft-input w-full bg-white">
              <option value="">Tất cả cuộc thi đang tổ chức</option>
              {overviewCompetitionOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Metric label="Các cuộc thi đang theo dõi" value={String(overviewSessions.length).padStart(2, "0")} icon={Trophy} onClick={() => overviewCompetitionFilter && setOverviewCompetitionFilter("")} />
          <Metric label="Tổng số thí sinh" value={overviewSessions.reduce((sum, session) => sum + Number(session.candidates || 0), 0).toLocaleString("vi-VN")} icon={Users} onClick={() => go("candidates")} />
        </div>
      </section>
      <div className="ft-examination-overview-grid grid min-w-0 gap-6 xl:grid-cols-3">
        <section className="ft-examination-chart ft-surface min-w-0 xl:col-span-2">
          <div className="mb-5 flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="min-w-0 text-xl font-bold text-[#001e40]">Số thí sinh theo kỳ tổ chức</h2>
              <p className="mt-1 text-sm text-slate-500">Chỉ tính các kỳ từ Tuyển sinh đến trước Hoàn thành đang được theo dõi.</p>
            </div>
            <BarChart3 className="h-6 w-6 text-[#0055DA]" />
          </div>
          <div className="h-80 overflow-x-auto pb-3 [scrollbar-color:#94a3b8_#e2e8f0] [scrollbar-width:auto] [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-slate-100">
            <div className="h-72 pr-3" style={{ minWidth: `${overviewChartWidth}px` }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={overviewChartData}>
                  <CartesianGrid vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="chartLabel" tickLine={false} axisLine={false} interval={0} height={50} tick={<OverviewChartTick />} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Bar dataKey="candidates" fill="#0055DA" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
        <section className="ft-examination-milestones ft-surface min-w-0">
          <h2 className="text-xl font-bold text-[#001e40]">Mốc cần chú ý</h2>
          <div className="mt-5 max-h-[304px] space-y-4 overflow-y-auto pr-1">
            {milestoneSessions.map((s) => {
              const milestone = nextMilestone(s);
              return (
                <button key={s.id} onClick={() => select(s)} className="flex min-w-0 w-full items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-left transition hover:border-[#0055DA]/30 hover:bg-slate-100/50">
                  <span className="min-w-0 flex-1">
                    <b className="block text-[#001e40]">
                      {s.code} · {sessionTimelineLabel(s)}
                    </b>
                    <small className="mt-0.5 block text-xs text-slate-500">{milestone.label}</small>
                  </span>
                  <span className="min-w-0 shrink-0 max-[420px]:max-w-[45%] max-[420px]:whitespace-normal"><DateBadge label={milestone.dateLabel} date={milestone.date} /></span>
                </button>
              );
            })}
            {!milestoneSessions.length && <p className="py-4 text-sm text-slate-500">Chưa có mốc thi cần theo dõi.</p>}
          </div>
          <div className="mt-5 border-t pt-4">
            <Legend />
          </div>
        </section>
      </div>
      <section className="mt-6 ft-surface overflow-hidden">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-[#001e40]">Các cuộc thi đang tổ chức</h2>
            <p className="mt-1 text-sm text-slate-500">Chỉ hiển thị vòng gần nhất; toàn bộ các vòng vẫn có trong trang chi tiết. Các kỳ sau vòng cuối được xếp cuối bảng.</p>
          </div>
          <Legend />
        </div>
        <SessionsTable items={overviewSessions} onSelect={select} showNearestRoundOnly />
      </section>
    </>
  );
  const list = (
    <>
      <Header
        title="Các kỳ tổ chức"
        description="Theo dõi các kỳ thi, mốc vòng quốc gia và vòng quốc tế."
        action={
          <button onClick={() => open("session")} className="ft-primary">
            <Plus className="h-4 w-4" />
            Tạo kỳ tổ chức
          </button>
        }
      />
      <section className="ft-surface overflow-visible">
        <div className="border-b p-4">
          <label className="ft-input-wrap max-w-xl">
            <Search className="h-5 w-5" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm theo tên kỳ, cuộc thi hoặc BTC..." />
          </label>
        </div>
        <div className="ft-examination-session-filters grid min-w-0 gap-3 border-b bg-slate-50 p-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="min-w-0">
            <span className="mb-1 block text-xs font-bold text-slate-500">Cuộc thi</span>
            <SearchableSelect
              multiple
              value={sessionCompetitionFilter}
              onChange={setSessionCompetitionFilter}
              options={competitions.map((item) => ({
                value: item.code,
                label: item.code + " · " + item.name,
              }))}
              placeholder="Tất cả cuộc thi"
            />
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-xs font-bold text-slate-500">BTC quốc tế</span>
            <SearchableSelect multiple value={sessionOrganizerFilter} onChange={setSessionOrganizerFilter} options={[...new Set(sessions.map((item) => item.organizer))].map((item) => ({ value: item, label: item }))} placeholder="Tất cả BTC" />
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-xs font-bold text-slate-500">Năm</span>
            <SearchableSelect multiple value={sessionYearFilter} onChange={setSessionYearFilter} options={[...new Set(sessions.map(sessionYear).filter(Boolean))].sort().map((item) => ({ value: item, label: item }))} placeholder="Tất cả năm" />
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-xs font-bold text-slate-500">Tháng / năm</span>
            <SearchableSelect
              multiple
              value={sessionMonthFilter}
              onChange={setSessionMonthFilter}
              options={[...new Set(sessions.map(sessionMonthKey).filter(Boolean))].sort().map((item) => ({
                value: item,
                label: sessionMonthLabel(item),
              }))}
              placeholder="Tất cả thời gian"
            />
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-xs font-bold text-slate-500">Giai đoạn hiện tại</span>
            <div className="flex gap-2">
              <select value={sessionPhaseFilterMode} onChange={(event) => setSessionPhaseFilterMode(event.target.value as "include" | "exclude")} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-700" aria-label="Cách lọc giai đoạn">
                <option value="include">Chứa</option>
                <option value="exclude">Không chứa</option>
              </select>
              <SearchableSelect multiple value={sessionPhaseFilter} onChange={setSessionPhaseFilter} options={[...new Set(sessions.map((item) => item.phase))].map((item) => ({ value: item, label: item }))} placeholder="Chọn giai đoạn" className="min-w-0 flex-1" />
            </div>
          </label>
        </div>
        <SessionsTable items={search} onSelect={select} />
      </section>
    </>
  );
  const competitionList = (
    <>
      <Header
        title="Cuộc thi"
        description="Danh mục các cuộc thi và toàn bộ kỳ tổ chức thuộc từng cuộc thi."
        action={
          <button onClick={() => open("competition")} className="ft-primary">
            <Plus className="h-4 w-4" />
            Tạo cuộc thi
          </button>
        }
      />
      <section className="ft-surface overflow-hidden">
        <div className="border-b p-4">
          <label className="ft-input-wrap max-w-md">
            <Search className="h-5 w-5" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Lọc mã, tên cuộc thi hoặc BTC..." />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="ft-table min-w-[900px]">
            <thead>
              <tr>
                <th>Cuộc thi</th>
                <th>BTC quốc tế</th>
                <th>Số kỳ tổ chức</th>
                <th>Thí sinh tích lũy</th>
                <th>Kỳ tổ chức gần nhất</th>
              </tr>
            </thead>
            <tbody>
              {visibleCompetitions.map((c) => {
                const rounds = sessions.filter((s) => s.competitionId === c.id || s.code === c.code);
                const latest = latestCompetitionSession(c);
                return (
                  <tr key={c.id} onClick={() => selectCompetition(c)} className="cursor-pointer hover:bg-blue-50/50">
                    <td>
                      <b className="text-[#001e40]">{c.code}</b>
                      <p className="mt-1 text-xs text-slate-500">{c.name}</p>
                    </td>
                    <td>{c.organizer}</td>
                    <td>{rounds.length}</td>
                    <td>{rounds.reduce((total, item) => total + item.candidates, 0).toLocaleString("vi-VN")}</td>
                    <td>
                      {latest ? (
                        <>
                          <b className="text-[#001e40]">{sessionDisplayName(latest)}</b>
                          <p className="mt-1 text-xs text-slate-500">{latest.name}</p>
                        </>
                      ) : (
                        "Chưa có kỳ tổ chức"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <TablePagination total={filteredCompetitions.length} page={activeCompetitionPage} onPageChange={setCompetitionPage} label="cuộc thi" />
      </section>
    </>
  );
  const competitionRounds = sessions.filter((s) => s.competitionId === selectedCompetition.id || s.code === selectedCompetition.code);
  const competitionDetail = (
    <>
      <button onClick={() => go("competitions")} className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-600">
        <ArrowLeft className="h-4 w-4" />
        Quay lại danh sách cuộc thi
      </button>
      <section className="ft-surface">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-[#101827]">
              {selectedCompetition.code} — {selectedCompetition.name}
            </h1>
            <p className="mt-2 text-sm text-slate-600">BTC quốc tế: {selectedCompetition.organizer}</p>
          </div>
          <div className="flex gap-2">
            {canManage && (
              <button onClick={updateCompetitionDetails} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#001e40]">
                <Pencil className="h-4 w-4" />
                Thay đổi thông tin
              </button>
            )}
            {canEdit && (
              <button
                onClick={() =>
                  setDeleteTarget({
                    kind: "competition",
                    id: selectedCompetition.id,
                    name: selectedCompetition.name,
                  })
                }
                className="inline-flex items-center gap-2 rounded-lg border border-rose-300 px-4 py-2 text-sm font-bold text-rose-700"
              >
                Xóa cuộc thi
              </button>
            )}
          </div>
        </div>
        <div className="mt-6 flex gap-5 border-t pt-4 text-sm">
          <button className="border-b-2 border-[#aa3000] pb-2 font-bold text-[#aa3000]">Thông tin chung</button>
          <button onClick={() => document.getElementById("competition-rounds")?.scrollIntoView({ behavior: "smooth" })} className="pb-2 font-semibold text-slate-600">
            Các kỳ tổ chức
          </button>
          {!isGuest && (
            <button onClick={() => go("import")} className="pb-2 font-semibold text-slate-600">
              Tài liệu
            </button>
          )}
        </div>
      </section>
      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <section className="ft-surface lg:col-span-2">
          <h2 className="text-xl font-bold text-[#001e40]">Thông tin chung</h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-xs font-bold uppercase text-slate-500">Cuộc thi mẹ</p>
              <p className="mt-2 font-semibold">{selectedCompetition.parent}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-slate-500">Ban tổ chức quốc tế</p>
              <p className="mt-2 font-semibold">{selectedCompetition.organizer}</p>
            </div>
          </div>
        </section>
        <Metric label="Tổng số kỳ tổ chức" value={String(competitionRounds.length).padStart(2, "0")} icon={CalendarDays} onClick={() => document.getElementById("competition-rounds")?.scrollIntoView({ behavior: "smooth" })} />
      </div>
      <section id="competition-rounds" className="mt-6 ft-surface overflow-hidden">
        <h2 className="mb-4 text-xl font-bold text-[#001e40]">Các kỳ tổ chức</h2>
        <SessionsTable items={competitionRounds} onSelect={select} />
      </section>
      <LogNotes entityKey={`competition-${selectedCompetition.id}`} actor={userName} canWrite={canContribute} idToken={idToken} />
    </>
  );
  const selectedRounds = sessionRounds(selected);
  const sessionSheetLink = sheetLinks.find((item) => item.sessionId === selected.id && item.stage === "session-output") || sheetLinks.find((item) => item.sessionId === selected.id && item.stage === "registration-source");
  const sessionSheetSources = sheetLinks.filter((item) => item.sessionId === selected.id);
  const visibleSessionSheetSources = sessionSheetSources.length
    ? sessionSheetSources
    : [
        ...(selected.registrationSheetUrl
          ? [
              {
                id: `legacy-input-${selected.id}`,
                name: "Danh sách đăng ký",
                url: selected.registrationSheetUrl,
                stage: "registration-source",
                sheetTab: selected.registrationSheetTab,
              },
            ]
          : []),
        ...(selected.outputSheetUrl
          ? [
              {
                id: `legacy-output-${selected.id}`,
                name: "Sheet tổng hợp",
                url: selected.outputSheetUrl,
                stage: "session-output",
                sheetTab: selected.outputSheetTab,
              },
            ]
          : []),
      ];
  const sessionDetail = (
    <>
      <button onClick={() => go("sessions")} className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-600">
        <ArrowLeft className="h-4 w-4" />
        Quay lại danh sách kỳ tổ chức
      </button>
      <section className="ft-surface">
        <div className="flex flex-wrap justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-[#aa3000]">KỲ TỔ CHỨC · {selected.code}</p>
            <h1 className="mt-1 text-3xl font-extrabold text-[#101827]">{sessionDisplayName(selected)}</h1>
            <p className="mt-2 text-sm text-slate-600">
              Cuộc thi: {selected.parent} · BTC quốc tế: {selected.organizer}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage && (
              <button onClick={updateSelectedSession} className="inline-flex h-fit items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#001e40]">
                <Pencil className="h-4 w-4" />
                Thay đổi thông tin
              </button>
            )}
            {canEdit && (
              <button
                onClick={() =>
                  setDeleteTarget({
                    kind: "session",
                    id: selected.id,
                    name: sessionDisplayName(selected),
                  })
                }
                className="inline-flex h-fit items-center gap-2 rounded-lg border border-rose-300 px-4 py-2 text-sm font-bold text-rose-700"
              >
                Xóa kỳ thi
              </button>
            )}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-5 border-t pt-4 text-sm">
          <button onClick={() => setSessionTab("info")} className={sessionTab === "info" ? "border-b-2 border-[#aa3000] pb-2 font-bold text-[#aa3000]" : "pb-2 font-semibold text-slate-600"}>
            Thông tin kỳ tổ chức
          </button>
          <button onClick={() => setSessionTab("students")} className={sessionTab === "students" ? "border-b-2 border-[#aa3000] pb-2 font-bold text-[#aa3000]" : "pb-2 font-semibold text-slate-600"}>
            Danh sách thí sinh
          </button>
          {selectedRounds.map((round, index) => (
            <button key={round.id || index} onClick={() => setSessionTab(index)} className={sessionTab === index ? "border-b-2 border-[#aa3000] pb-2 font-bold text-[#aa3000]" : "pb-2 font-semibold text-slate-600"}>
              {round.name}
            </button>
          ))}
          <button onClick={() => setSessionTab("classes")} className={sessionTab === "classes" ? "border-b-2 border-[#aa3000] pb-2 font-bold text-[#aa3000]" : "pb-2 font-semibold text-slate-600"}>
            Lớp ôn tập
          </button>
        </div>
      </section>
      {sessionTab === "info" && (
        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          <section className="ft-surface lg:col-span-2">
            <h2 className="text-xl font-bold text-[#001e40]">Giai đoạn hiện tại</h2>
            <p className="mt-3 inline-flex rounded-full bg-blue-50 px-3 py-2 text-sm font-bold text-[#001e40]">{selected.phase}</p>
            <p className="mt-4 text-sm text-slate-600">{selected.note}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              {selectedRounds.map((round, index) => (
                <div key={round.id || index}>
                  <p className="mb-1 text-xs font-bold uppercase text-slate-500">{round.name}</p>
                  <DateBadge label={round.label} date={round.date} />
                </div>
              ))}
              {!selectedRounds.length && <p className="text-sm text-slate-500">Chưa có thông tin vòng thi.</p>}
            </div>
          </section>
          <Metric label="Tổng thí sinh" value={candidates.filter((c) => (c.sessionIds?.length ? c.sessionIds.includes(selected.id) : (c.contests || "").includes(selected.code))).length.toLocaleString("vi-VN")} icon={Users} onClick={() => document.getElementById("session-students")?.scrollIntoView({ behavior: "smooth" })} />
        </div>
      )}
      {sessionTab === "info" && (
        <SessionSheetSources
          sources={visibleSessionSheetSources}
          sessionId={selected.id}
          sessionLabel={sessionDisplayName(selected)}
          idToken={idToken}
          canManage={canManage}
          onImport={async () => {
            const fresh = await api("/bootstrap");
            setCandidates(fresh.candidates || []);
            setSessions(fresh.sessions || []);
            const refreshedSession = (fresh.sessions || []).find((item: Session) => item.id === selected.id);
            if (refreshedSession) setSelected(refreshedSession);
          }}
          onSourcesChanged={(rows) => setSheetLinks(rows)}
        />
      )}{" "}
      {sessionTab !== "classes" && (
        <SessionRoster
          tab={sessionTab === "students" ? "all" : sessionTab}
          hideTabs
          session={selected}
          candidates={candidates}
          idToken={idToken}
          canEdit={canManage}
          onSessionUpdated={(row) => {
            setSessions((list) => list.map((item) => (item.id === row.id ? row : item)));
            setSelected(row);
          }}
          onCandidateUpdated={(candidate) => {
            setCandidates((list) => list.map((item) => (item.code === candidate.code ? candidate : item)));
            setStudent((current) => (current?.code === candidate.code ? candidate : current));
          }}
          onOpenCandidate={(candidate) => {
            setStudent(candidate);
            setStudentDraft(candidate);
            go("candidate-detail", candidate.code);
          }}
          toolbar={
            <div className="flex gap-2">
              <button
                disabled={!canContribute}
                onClick={() => {
                  setImportSessionId(selected.id);
                  go("import");
                }}
                className="rounded-lg border border-[#aa3000] px-3 py-2 text-sm font-bold text-[#aa3000] disabled:opacity-50"
              >
                <UploadCloud className="mr-1 inline h-4 w-4" />
                Nhập file / URL
              </button>
              <button
                disabled={!canContribute}
                onClick={() => {
                  setCandidateEnroll({
                    ...emptyCandidate,
                    contests: selected.code,
                  });
                  setDialogError("");
                  setDialog("enrol");
                }}
                className="ft-primary disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                Thêm thí sinh
              </button>
            </div>
          }
        />
      )}{" "}
      {sessionTab === "classes" && (
        <section className="mt-6">
          <div className="mb-4 flex justify-between">
            <div>
              <h2 className="text-xl font-bold text-[#001e40]">Lớp ôn tập thuộc kỳ này</h2>
              <p className="mt-1 text-sm text-slate-500">Danh sách dùng chung với trang Lớp ôn tập.</p>
            </div>
            <button
              onClick={() => {
                setClassSessionFilter(selected.id);
                go("classes");
              }}
              className="ft-primary"
            >
              <Plus className="h-4 w-4" />
              Tạo lớp mới
            </button>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {trainingClasses
              .filter((item) => item.sessionId === selected.id)
              .map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setClassSessionFilter(selected.id);
                    setClassToOpen(item.id);
                    go("classes");
                  }}
                  className="ft-surface text-left"
                >
                  <School className="h-7 w-7 text-[#001e40]" />
                  <h2 className="mt-4 text-lg font-bold">{item.name}</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    {item.subject} · Giáo viên: {item.teacher}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">Khóa học đến {new Date(item.end + "T00:00:00").toLocaleDateString("vi-VN")}</p>
                </button>
              ))}
            {!trainingClasses.some((item) => item.sessionId === selected.id) && <p className="text-sm text-slate-500">Chưa có lớp ôn tập cho kỳ này.</p>}
          </div>
        </section>
      )}
      <LogNotes entityKey={`session-${selected.id}`} actor={userName} canWrite={canContribute} idToken={idToken} />
    </>
  );
  const candidateList = (
    <>
      <Header
        title="Danh sách thí sinh"
        description="Theo dõi lịch sử tham gia, thành tích và hồ sơ cập nhật gần nhất."
        action={
          <button disabled={!canContribute} onClick={() => setShowCandidateAdd(true)} className="ft-primary disabled:opacity-50">
            <Plus className="h-4 w-4" />
            Thêm thí sinh
          </button>
        }
      />
      <div className="rounded-xl border bg-white p-4">
        <label className="ft-input-wrap">
          <Search className="h-5 w-5" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tên, mã FT, trường hoặc cuộc thi..." />
        </label>
      </div>
      <div className="mb-5 mt-3 grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3">
        <label>
          <span className="mb-1 block text-xs font-bold text-slate-500">Khối lớp</span>
          <SearchableSelect value={candidateGradeFilter} onChange={setCandidateGradeFilter} multiple options={[{ value: "", label: "Tất cả khối lớp" }, ...[...new Set(candidates.map(gradeOf))].sort().map((grade) => ({ value: grade, label: `Khối ${grade}` }))]} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold text-slate-500">Trường</span>
          <SearchableSelect value={candidateSchoolFilter} onChange={setCandidateSchoolFilter} multiple options={[{ value: "", label: "Tất cả trường" }, ...[...new Set(candidates.map((candidate) => candidate.school))].sort().map((school) => ({ value: school, label: school }))]} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold text-slate-500">Cuộc thi đã tham gia</span>
          <SearchableSelect
            value={candidateContestFilter}
            onChange={setCandidateContestFilter}
            multiple
            options={[
              { value: "", label: "Tất cả cuộc thi" },
              ...competitions.map((competition) => ({
                value: competition.code,
                label: `${competition.code} · ${competition.name}`,
              })),
            ]}
          />
        </label>
      </div>
      <section className="ft-surface overflow-hidden">
        {canEdit && selectedCandidateCodes.length > 0 && (
          <div className="flex items-center justify-between border-b bg-rose-50 px-4 py-3">
            <b className="text-sm text-[#001e40]">Đã chọn {selectedCandidateCodes.length} thí sinh</b>
            <button
              onClick={() =>
                setDeleteTarget({
                  kind: "bulk-candidate",
                  id: "",
                  ids: selectedCandidateCodes,
                  name: `${selectedCandidateCodes.length} thí sinh đã chọn`,
                })
              }
              className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-sm font-bold text-white"
            >
              <Trash2 className="h-4 w-4" />
              Xóa đã chọn
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="ft-table min-w-[1180px]">
            <thead>
              <tr>
                <th>
                  <input aria-label="Chọn tất cả thí sinh" type="checkbox" checked={visibleCandidates.length > 0 && visibleCandidates.every((item) => selectedCandidateCodes.includes(item.code))} onChange={(event) => setSelectedCandidateCodes((list) => (event.target.checked ? [...new Set([...list, ...visibleCandidates.map((item) => item.code)])] : list.filter((code) => !visibleCandidates.some((item) => item.code === code))))} />
                </th>
                <th>Mã FT</th>
                <th>Họ và tên</th>
                <th>Trường học</th>
                <th>Khối lớp</th>
                <th>Các cuộc thi đã tham gia</th>
                <th>Cập nhật lần cuối</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleCandidates.map((c) => (
                <tr
                  key={c.code}
                  className="cursor-pointer hover:bg-blue-50/50"
                  onClick={() => {
                    setStudent(c);
                    setStudentDraft(c);
                    go("candidate-detail", c.code);
                  }}
                >
                  <td onClick={(event) => event.stopPropagation()}>
                    <input aria-label={`Chọn ${c.name}`} type="checkbox" checked={selectedCandidateCodes.includes(c.code)} onChange={(event) => setSelectedCandidateCodes((list) => (event.target.checked ? [...list, c.code] : list.filter((code) => code !== c.code)))} />
                  </td>
                  <td className="font-mono text-xs font-bold">{c.code}</td>
                  <td>
                    <b className="text-[#001e40]">{c.name}</b>
                    <p className="mt-1 text-xs text-slate-500">{c.city}</p>
                  </td>
                  <td>{c.school}</td>
                  <td>Khối {gradeOf(c)}</td>
                  <td>{c.contests}</td>
                  <td>{c.updated}</td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      {canManage && (
                        <button
                          title="Sửa thông tin"
                          onClick={() => {
                            setCandidateEdit(c);
                            setDialogError("");
                            setDialog("candidate");
                          }}
                          className="rounded p-2 text-[#001e40] hover:bg-blue-50"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          title="Xóa thí sinh"
                          onClick={() =>
                            setDeleteTarget({
                              kind: "candidate",
                              id: c.code,
                              name: c.name,
                            })
                          }
                          className="rounded p-2 text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination total={people.length} page={activeCandidatePage} onPageChange={setCandidatePage} label="thí sinh" />
      </section>
      {showCandidateAdd && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <button onClick={() => setShowCandidateAdd(false)} className="float-right rounded p-1 text-slate-500 hover:bg-slate-100">
              <X className="h-5 w-5" />
            </button>
            <h2 className="text-2xl font-extrabold">Thêm thí sinh</h2>
            <p className="mt-2 text-sm text-slate-600">Nhập nhanh một hồ sơ hoặc chuyển sang công cụ nhập hàng loạt từ file mẫu và Google Sheets.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label>
                <span className="mb-1 block text-sm font-bold">Mã FT</span>
                <input value={candidateAdd.code} onChange={(e) => setCandidateAdd({ ...candidateAdd, code: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Để trống để tự tạo" />
              </label>
              <label>
                <span className="mb-1 block text-sm font-bold">Họ và tên *</span>
                <input value={candidateAdd.name} onChange={(e) => setCandidateAdd({ ...candidateAdd, name: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label>
                <span className="mb-1 block text-sm font-bold">Trường học</span>
                <input value={candidateAdd.school} onChange={(e) => setCandidateAdd({ ...candidateAdd, school: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label>
                <span className="mb-1 block text-sm font-bold">Lớp</span>
                <input
                  value={candidateAdd.className}
                  onChange={(e) =>
                    setCandidateAdd({
                      ...candidateAdd,
                      className: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label>
                <span className="mb-1 block text-sm font-bold">Ngày sinh</span>
                <BirthDateControl value={candidateAdd.birthDate} onChange={(birthDate) => setCandidateAdd({ ...candidateAdd, birthDate })} />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1 block text-sm font-bold">Kỳ tổ chức *</span>
                <select
                  value={candidateAdd.sessionId}
                  onChange={(e) => {
                    const session = sessions.find((item) => item.id === e.target.value);
                    setCandidateAdd({
                      ...candidateAdd,
                      sessionId: e.target.value,
                      contests: session?.code || "",
                    });
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="">Chọn kỳ tổ chức</option>
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.code} · {sessionDisplayName(session)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                onClick={() => {
                  setShowCandidateAdd(false);
                  go("import");
                }}
                className="rounded-lg border border-[#aa3000] px-4 py-2 text-sm font-bold text-[#aa3000]"
              >
                <UploadCloud className="mr-1 inline h-4 w-4" />
                Nhập file / Google Sheets
              </button>
              <button disabled={!candidateAdd.name.trim() || !candidateAdd.sessionId} onClick={createCandidate} className="ft-primary disabled:opacity-50">
                <Plus className="h-4 w-4" />
                Thêm hồ sơ
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
  const detail = (
    <>
      <button onClick={() => go("competitions")} className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-600">
        <ArrowLeft className="h-4 w-4" />
        Quay lại danh sách cuộc thi
      </button>
      <section className="ft-surface">
        <div className="flex flex-col justify-between gap-5 lg:flex-row">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-extrabold text-[#101827]">
                {selected.code} — {selected.name}
              </h1>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">Đang hoạt động</span>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              BTC quốc tế: {selected.organizer} · {selected.time}
            </p>
            <p className="mt-3 text-sm text-slate-600">{selected.note}</p>
          </div>
          <button onClick={() => open("session", selected.id)} className="ft-primary h-fit">
            <Plus className="h-4 w-4" />
            Tạo kỳ thi mới
          </button>
        </div>
        <div className="mt-6 flex flex-wrap gap-5 border-t pt-4 text-sm">
          <button className="border-b-2 border-[#aa3000] pb-2 font-bold text-[#aa3000]">Thông tin chung</button>
          <button onClick={() => go("sessions")} className="pb-2 font-semibold text-slate-600">
            Các kỳ tổ chức
          </button>
          <button onClick={() => go("classes")} className="pb-2 font-semibold text-slate-600">
            Lớp ôn tập
          </button>
          <button onClick={() => go("import")} className="pb-2 font-semibold text-slate-600">
            Tài liệu
          </button>
        </div>
      </section>
      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <section className="ft-surface lg:col-span-2">
          <h2 className="text-xl font-bold text-[#001e40]">Thông tin cơ bản</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-xs font-bold uppercase text-slate-500">Cuộc thi mẹ</p>
              <p className="mt-2 font-semibold">{selected.parent}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-slate-500">Ban tổ chức quốc tế</p>
              <p className="mt-2 font-semibold">{selected.organizer}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-slate-500">Vòng quốc gia</p>
              <div className="mt-2">
                <DateBadge label={selected.national} date={selected.nationalDate} />
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-slate-500">Vòng quốc tế</p>
              <div className="mt-2">
                <DateBadge label={selected.international} date={selected.internationalDate} />
              </div>
            </div>
          </div>
        </section>
        <div className="grid gap-4">
          <Metric label="Tổng số kỳ" value="01" icon={CalendarDays} onClick={() => go("sessions")} />
          <Metric label="Thí sinh tích lũy" value={candidates.filter((c) => (c.sessionIds?.length ? c.sessionIds.includes(selected.id) : (c.contests || "").includes(selected.code))).length.toLocaleString("vi-VN")} icon={Users} onClick={() => go("candidates")} />
        </div>
      </div>
    </>
  );
  const importedCandidateHistory = Object.values(
    (student?.examHistory || []).reduce(
      (groups, record) => {
        const key = record.sessionId || record.sessionCode || "unknown";
        const session = sessions.find((item) => item.id === record.sessionId || item.code === record.sessionCode);
        const entry = groups[key] || {
          code: session?.code || record.sessionCode || "--",
          name: session?.name || record.sessionCode || "Kỳ tổ chức",
          time: session ? sessionDisplayName(session) : record.sessionId || "--",
          scores: [],
          award: "Chưa có kết quả",
        };
        entry.scores.push({
          round: record.round,
          score: record.score || record.result || "Chưa có điểm",
        });
        if (record.result) entry.award = record.result;
        groups[key] = entry;
        return groups;
      },
      {} as Record<
        string,
        {
          code: string;
          name: string;
          time: string;
          scores: { round: string; score: string }[];
          award: string;
        }
      >,
    ),
  );
  const candidateHistory = importedCandidateHistory.length
    ? importedCandidateHistory
    : (student?.contests || "")
        .split(",")
        .map((code) => code.trim())
        .filter(Boolean)
        .map((code, index) => {
          const session = sessions.find((item) => item.code === code);
          const rounds = session?.rounds?.length ? session.rounds.map((item) => item.name) : ["Vòng quốc tế", "Vòng quốc gia"];
          return {
            code,
            name: session?.name || competitions.find((item) => item.code === code)?.name || code,
            time: session ? sessionDisplayName(session) : "Chưa cập nhật kỳ tổ chức",
            scores: rounds.reverse().map((round, scoreIndex) => ({
              round,
              score: Math.max(60, 96 - index * 7 - scoreIndex * 5),
            })),
            award: index === 0 ? student.achievement : index === 1 ? "Top 10 — vòng quốc gia" : "Đạt yêu cầu dự thi",
          };
        });
  const candidateDetail = (
    <>
      <CandidateProfileDetail
        candidate={student}
        sessions={sessions}
        canManage={canManage}
        canDelete={canEdit}
        onBack={() => go("candidates")}
        onEdit={() => {
          setCandidateEdit(student);
          setDialogError("");
          setDialog("candidate");
        }}
        onDelete={() =>
          setDeleteTarget({
            kind: "candidate",
            id: student.code,
            name: student.name,
          })
        }
        onOpenSession={(sessionId) => {
          const target = sessions.find((item) => item.id === sessionId);
          if (target) {
            setSelected(target);
            go("session-detail", target.id);
          }
        }}
      />
      <LogNotes entityKey={`candidate-${student.code}`} actor={userName} canWrite={canContribute} idToken={idToken} />
    </>
  );
  const teacherDetail = (
    <>
      <button onClick={() => go("teachers")} className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-600">
        <ArrowLeft className="h-4 w-4" />
        Quay lại danh sách giáo viên
      </button>
      <section className="ft-surface">
        <p className="text-sm font-bold text-[#aa3000]">GIÁO VIÊN</p>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="mt-1 text-3xl font-extrabold text-[#101827]">{selectedTeacher.name}</h1>
          <div className="flex flex-wrap gap-2">
            {canManage && (
              <button onClick={updateTeacherDetails} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#001e40]">
                <Pencil className="h-4 w-4" />
                Thay đổi thông tin
              </button>
            )}
            {canEdit && (
              <button
                onClick={() =>
                  setDeleteTarget({
                    kind: "teacher",
                    id: selectedTeacher.email,
                    name: selectedTeacher.name,
                  })
                }
                className="inline-flex items-center gap-2 rounded-lg border border-rose-300 px-4 py-2 text-sm font-bold text-rose-700"
              >
                <Trash2 className="h-4 w-4" />
                Xóa giáo viên
              </button>
            )}
          </div>
        </div>
        <div className="mt-6 grid gap-5 border-t pt-6 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="text-xs font-bold uppercase text-slate-500">Chuyên môn</p>
            <p className="mt-2 font-semibold">{selectedTeacher.subject || "—"}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-slate-500">Điện thoại</p>
            <p className="mt-2 font-semibold">{selectedTeacher.phone}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-slate-500">Email</p>
            <p className="mt-2 font-semibold">{selectedTeacher.email}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-slate-500">Đơn vị công tác chính</p>
            <p className="mt-2 font-semibold">{selectedTeacher.workplace}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-slate-500">Lớp đang phụ trách</p>
            <p className="mt-2 font-semibold">
              {trainingClasses
                .filter((course) => course.teacherEmail === selectedTeacher.email || (!course.teacherEmail && course.teacher === selectedTeacher.name))
                .map((course) => course.name)
                .join(", ") || "Chưa phân công"}
            </p>
          </div>
        </div>
      </section>
      <LogNotes entityKey={`teacher-${selectedTeacher.email}`} actor={userName} canWrite={canContribute} idToken={idToken} />
    </>
  );
  const currentRoute = examinationRouteFromPath(routePath);
  const partnersPage = <Partners partners={partners} onPartnersChange={persistPartners} actor={userName} idToken={idToken} canManage={canManage} canDelete={canEdit} selectedPartnerId={page === "partners" ? currentRoute.id : undefined} onSelectPartner={(partnerId) => go("partners", partnerId)} onBackToList={() => go("partners")} />;
  const paperProps = {
    idToken,
    userRole,
    competitions,
    sessions,
    onNavigate: (next: any, id?: string) => go(next, id),
  };
  const content: Record<Page, React.ReactNode> = {
    overview,
    competitions: competitionList,
    sessions: list,
    candidates: candidateList,
    classes,
    teachers: teachersPage,
    partners: partnersPage,
    import: importPage,
    papers: <PaperLibrary {...paperProps} />,
    blueprints: <BlueprintLibrary {...paperProps} />,
    "blueprint-detail": <BlueprintEditor {...paperProps} blueprintId={currentRoute.id || ""} />,
    "paper-create": <PaperCreate {...paperProps} />,
    "paper-detail": <PaperEditor {...paperProps} paperId={currentRoute.id || ""} />,
    "ai-config": <AiConfig {...paperProps} />,
    "competition-detail": competitionDetail,
    "session-detail": sessionDetail,
    "candidate-detail": candidateDetail,
    "class-detail": (
      <ClassDetail
        data={classDetail}
        candidates={candidates}
        onBack={() => go("classes")}
        onCandidate={(c) => {
          setStudent(c);
          setStudentDraft(c);
          go("candidate-detail", c.code);
        }}
      />
    ),
    "teacher-detail": teacherDetail,
  };
  return (
    <div className="ft-module-shell min-h-screen font-sans text-[#121c2a]">
      <aside className="ft-module-sidebar fixed inset-y-0 left-0 hidden w-[280px] flex-col text-white md:flex">
        <div className="ft-sidebar-brand flex items-center gap-3">
          <img src="/logo.png" alt="Fermat" className="h-9 w-auto object-contain" />
          <div className="min-w-0 border-l border-sky-100 pl-3">
            <b className="block text-xl font-extrabold leading-none">Fermat</b>
            <p className="mt-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-blue-200">Khảo thí</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          <button onClick={() => go("overview")} className={`flex w-full items-center gap-3 rounded-md border-l-4 px-4 py-3 text-left text-sm font-bold ${page === "overview" ? "ft-nav-item-active" : "ft-nav-item"}`}>
            <LayoutDashboard className="h-5 w-5" />
            Tổng quan
          </button>
          <button onClick={() => setCompOpen(!compOpen)} className={`flex w-full items-center gap-3 rounded-md border-l-4 px-4 py-3 text-left text-sm font-bold ${page === "sessions" || page === "session-detail" || page === "competitions" || page === "competition-detail" ? "ft-nav-item-active" : "ft-nav-item"}`}>
            <Trophy className="h-5 w-5" />
            Cuộc thi
            <ChevronDown className={`ml-auto h-4 w-4 ${compOpen ? "rotate-180" : ""}`} />
          </button>
          {compOpen && (
            <div className="space-y-1">
              <button onClick={() => go("sessions")} className={`ml-4 flex w-[calc(100%-1rem)] items-center gap-2 whitespace-nowrap rounded border-l-4 px-3 py-2 text-left text-[13px] font-semibold ${page === "sessions" || page === "session-detail" ? "ft-nav-item-active" : "ft-nav-item"}`}>
                <CalendarDays className="h-4 w-4 shrink-0" />
                Các kỳ tổ chức
              </button>
              <button onClick={() => go("competitions")} className={`ml-4 flex w-[calc(100%-1rem)] items-center gap-2 whitespace-nowrap rounded border-l-4 px-3 py-2 text-left text-[13px] font-semibold ${page === "competitions" || page === "competition-detail" ? "ft-nav-item-active" : "ft-nav-item"}`}>
                <Trophy className="h-4 w-4 shrink-0" />
                Thông tin các cuộc thi
              </button>
            </div>
          )}
          <button onClick={() => go("candidates")} className={`flex w-full items-center gap-3 rounded-md border-l-4 px-4 py-3 text-left text-sm font-bold ${page === "candidates" || page === "candidate-detail" ? "ft-nav-item-active" : "ft-nav-item"}`}>
            <Users className="h-5 w-5" />
            Thí sinh
          </button>
          <button onClick={() => go("partners")} className={`flex w-full items-center gap-3 rounded-md border-l-4 px-4 py-3 text-left text-sm font-bold ${page === "partners" ? "ft-nav-item-active" : "ft-nav-item"}`}>
            <Handshake className="h-5 w-5" />
            Đối tác
          </button>
          <button onClick={() => setClassOpen(!classOpen)} className={`flex w-full items-center gap-3 rounded-md border-l-4 px-4 py-3 text-left text-sm font-bold ${page === "classes" || page === "class-detail" || page === "teachers" || page === "teacher-detail" ? "ft-nav-item-active" : "ft-nav-item"}`}>
            <GraduationCap className="h-5 w-5" />
            Lớp ôn tập
            <ChevronDown className={`ml-auto h-4 w-4 ${classOpen ? "rotate-180" : ""}`} />
          </button>
          {classOpen && (
            <div className="space-y-1">
              <button onClick={() => go("classes")} className={`ml-4 flex w-[calc(100%-1rem)] items-center gap-2 whitespace-nowrap rounded border-l-4 px-3 py-2 text-left text-[13px] font-semibold ${page === "classes" || page === "class-detail" ? "ft-nav-item-active" : "ft-nav-item"}`}>
                <School className="h-4 w-4 shrink-0" />
                Các lớp ôn tập
              </button>
              <button onClick={() => go("teachers")} className={`ml-4 flex w-[calc(100%-1rem)] items-center gap-2 whitespace-nowrap rounded border-l-4 px-3 py-2 text-left text-[13px] font-semibold ${page === "teachers" || page === "teacher-detail" ? "ft-nav-item-active" : "ft-nav-item"}`}>
                <Users className="h-4 w-4 shrink-0" />
                Thông tin giáo viên
              </button>
            </div>
          )}
          <button onClick={() => setPaperOpen(!paperOpen)} className={`flex w-full items-center gap-3 rounded-md border-l-4 px-4 py-3 text-left text-sm font-bold ${page === "papers" || page === "paper-create" || page === "paper-detail" || page === "blueprints" || page === "blueprint-detail" || page === "ai-config" ? "ft-nav-item-active" : "ft-nav-item"}`}>
            <FileText className="h-5 w-5" />
            Đề thi
            <ChevronDown className={`ml-auto h-4 w-4 ${paperOpen ? "rotate-180" : ""}`} />
          </button>
          {paperOpen && (
            <div className="space-y-1">
              <button onClick={() => go("papers")} className={`ml-4 flex w-[calc(100%-1rem)] items-center gap-2 whitespace-nowrap rounded border-l-4 px-3 py-2 text-left text-[13px] font-semibold ${page === "papers" || page === "paper-create" || page === "paper-detail" ? "ft-nav-item-active" : "ft-nav-item"}`}>
                <FileText className="h-4 w-4 shrink-0" />
                Ngân hàng đề thi
              </button>
              <button onClick={() => go("blueprints")} className={`ml-4 flex w-[calc(100%-1rem)] items-center gap-2 whitespace-nowrap rounded border-l-4 px-3 py-2 text-left text-[13px] font-semibold ${page === "blueprints" || page === "blueprint-detail" ? "ft-nav-item-active" : "ft-nav-item"}`}>
                <Layers3 className="h-4 w-4 shrink-0" />
                Ma trận đề
              </button>
              {canEdit && (
                <button onClick={() => go("ai-config")} className={`ml-4 flex w-[calc(100%-1rem)] items-center gap-2 whitespace-nowrap rounded border-l-4 px-3 py-2 text-left text-[13px] font-semibold ${page === "ai-config" ? "ft-nav-item-active" : "ft-nav-item"}`}>
                  <Bot className="h-4 w-4 shrink-0" />
                  Cấu hình AI
                </button>
              )}
            </div>
          )}
          {!isGuest && (
            <button onClick={() => go("import")} className={`flex w-full items-center gap-3 rounded-md border-l-4 px-4 py-3 text-left text-sm font-bold ${page === "import" ? "ft-nav-item-active" : "ft-nav-item"}`}>
              <UploadCloud className="h-5 w-5" />
              Nhập dữ liệu
            </button>
          )}
        </nav>
        <div className="ft-sidebar-footer border-t p-4">
          <button onClick={onBackToWorkspace} className="ft-sidebar-back mb-3 flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm font-bold">
            <ArrowLeft className="h-5 w-5" />
            Quay lại Workspace
          </button>
          <AccountMenu userName={userName} userRole={userRole} photoURL={photoURL} isGuest={isGuest} onAccountClick={onAccountClick} onLogout={onLogout} variant="sidebar" />
        </div>
      </aside>
      <ModuleMobileNav
        className="lg:hidden dt-mobile-nav"
        onBack={onBackToWorkspace}
        activeId={page}
        onSelect={(nextPage) => go(nextPage as Page)}
        items={nav.map((item) => ({ id: item.id, label: item.label, icon: item.icon }))}
        ariaLabel="Điều hướng Khảo thí"
      />
      <main className="md:ml-64">
        <header className="ft-module-header sticky top-0 z-10 flex h-16 items-center justify-between border-b px-5 md:px-8">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span>Khảo thí</span>
            <ChevronRight className="h-4 w-4" />
            <b>{page === "competition-detail" ? "Chi tiết cuộc thi" : page === "session-detail" ? "Chi tiết kỳ tổ chức" : page === "candidate-detail" ? "Hồ sơ thí sinh" : page === "paper-detail" ? "Chi tiết đề thi" : page === "blueprint-detail" ? "Chi tiết ma trận đề" : page === "blueprints" ? "Ma trận đề" : page === "paper-create" ? "Tạo đề mới" : page === "papers" ? "Đề thi" : page === "ai-config" ? "Cấu hình AI" : nav.find((x) => x.id === page)?.label}</b>
          </div>
          <div className="flex items-center gap-5">
            <Bell className="h-5 w-5" />
            <CircleHelp className="h-5 w-5" />
            <AccountMenu userName={userName} userRole={userRole} photoURL={photoURL} isGuest={isGuest} onAccountClick={onAccountClick} onLogout={onLogout} variant="avatar" />
          </div>
        </header>
        <div className="ft-module-content mx-auto p-5 md:p-8">
          {bootstrapError && <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{bootstrapError}</div>}
          {sessions === initialSessions && !bootstrapError ? (
            <div className="grid min-h-[60vh] place-items-center text-sm font-semibold text-slate-500">
              <span className="inline-flex items-center gap-3">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#001e40] border-t-transparent" />
                Đang tải dữ liệu khảo thí...
              </span>
            </div>
          ) : (
            content[page]
          )}
        </div>
      </main>
      <ConfirmModal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={confirmDelete} title={deleteTarget?.kind === "draft-round" ? "Xóa vòng thi" : deleteTarget?.kind === "enrollment" ? "Gỡ thí sinh khỏi kỳ thi" : deleteTarget?.kind === "teacher" ? "Xóa giáo viên" : "Xóa dữ liệu"} message={deleteTarget?.kind === "enrollment" ? `Gỡ ${deleteTarget?.name} khỏi kỳ thi này? Hồ sơ chung của thí sinh vẫn được giữ lại.` : deleteTarget?.kind === "teacher" ? `Xóa ${deleteTarget?.name}? Các lớp đang được phân công sẽ chuyển sang trạng thái chưa phân công.` : `Bạn có chắc muốn xóa ${deleteTarget?.name}? Thao tác này không thể hoàn tác.`} confirmText={deleteTarget?.kind === "enrollment" ? "Gỡ khỏi kỳ" : deleteTarget?.kind === "draft-round" ? "Xóa vòng" : "Xóa"} type="danger" />
      <DetailEditDialogs
        mode={dialog}
        error={dialogError}
        busy={dialogBusy}
        competitions={competitions}
        competition={competitionEdit}
        session={sessionEdit}
        candidate={dialog === "enrol" ? candidateEnroll : candidateEdit}
        candidates={candidates}
        enrollmentSessionId={dialog === "enrol" ? selected.id : undefined}
        teacher={teacherEdit}
        onClose={() => {
          setDialog(null);
          setDialogError("");
        }}
        onCompetitionChange={setCompetitionEdit}
        onSessionChange={setSessionEdit}
        onCandidateChange={(value) => (dialog === "enrol" ? setCandidateEnroll(value) : setCandidateEdit(value))}
        onTeacherChange={setTeacherEdit}
        onSave={saveDialog}
      />
      {notice && (
        <div className="fixed bottom-5 right-5 z-[80] flex max-w-md items-start gap-3 rounded-xl border border-blue-200 bg-white p-4 shadow-xl">
          <p className="text-sm font-semibold text-[#001e40]">{notice}</p>
          <button onClick={() => setNotice("")} className="text-sm font-bold text-slate-500">
            Đóng
          </button>
        </div>
      )}
      {showTeachers && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/35 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <button onClick={() => setShowTeachers(false)} className="float-right">
              <X className="h-5 w-5" />
            </button>
            <h2 className="text-2xl font-extrabold">Thông tin giáo viên</h2>
            <p className="mt-2 text-sm text-slate-600">Danh sách giáo viên tham gia các lớp ôn tập.</p>
            <div className="mt-5 overflow-x-auto">
              <table className="ft-table">
                <thead>
                  <tr>
                    <th>Giáo viên</th>
                    <th>Chuyên môn</th>
                    <th>Liên hệ</th>
                    {canEdit && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {teachers.map((teacher, index) => (
                    <tr key={teacher.email}>
                      <td>
                        <b>{teacher.name}</b>
                      </td>
                      <td>{teacher.subject}</td>
                      <td>{teacher.phone}</td>
                      {canEdit && (
                        <td>
                          <button
                            onClick={() =>
                              setTeachers((list) =>
                                list.map((item, i) =>
                                  i === index
                                    ? {
                                        ...item,
                                        subject: item.subject + " (đã cập nhật)",
                                      }
                                    : item,
                                ),
                              )
                            }
                            className="text-sm font-bold text-[#aa3000]"
                          >
                            Chỉnh sửa
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {showCreate && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-slate-950/35 p-4">
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <button onClick={close} className="float-right rounded p-1 text-slate-500 hover:bg-slate-100">
              <X className="h-5 w-5" />
            </button>
            {step === "choice" && (
              <>
                <h2 className="text-2xl font-extrabold">Tạo mới</h2>
                <p className="mt-2 text-sm text-slate-600">Chọn loại thông tin cần khởi tạo.</p>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <button onClick={() => setStep("competition")} className="rounded-xl border border-slate-200 p-5 text-left hover:border-[#aa3000]">
                    <Trophy className="h-7 w-7 text-[#aa3000]" />
                    <b className="mt-3 block">Tạo cuộc thi mới</b>
                    <span className="mt-1 block text-sm text-slate-500">Khai báo tên và Ban tổ chức quốc tế.</span>
                  </button>
                  <button onClick={() => setStep("session")} className="rounded-xl border border-slate-200 p-5 text-left hover:border-[#aa3000]">
                    <CalendarDays className="h-7 w-7 text-[#aa3000]" />
                    <b className="mt-3 block">Tạo kỳ thi mới cho cuộc thi đã có</b>
                    <span className="mt-1 block text-sm text-slate-500">Khai báo kỳ tổ chức và thời gian các vòng.</span>
                  </button>
                </div>
              </>
            )}
            {step === "competition" && (
              <>
                <h2 className="text-2xl font-extrabold">Tạo cuộc thi mới</h2>
                <p className="mt-2 text-sm text-slate-600">Tên cuộc thi và Ban tổ chức quốc tế là thông tin bắt buộc.</p>
                <div className="mt-5 grid gap-4">
                  <label>
                    <span className="mb-1 block text-sm font-bold">Tên cuộc thi *</span>
                    <input
                      value={newCompetition.name}
                      onChange={(e) =>
                        setNewCompetition({
                          ...newCompetition,
                          name: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label>
                      <span className="mb-1 block text-sm font-bold">Tên viết tắt</span>
                      <input
                        value={newCompetition.code}
                        onChange={(e) =>
                          setNewCompetition({
                            ...newCompetition,
                            code: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                        placeholder="Ví dụ: FIMO"
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-sm font-bold">Cuộc thi mẹ</span>
                      <input
                        value={newCompetition.parent}
                        onChange={(e) =>
                          setNewCompetition({
                            ...newCompetition,
                            parent: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                  </div>
                  <label>
                    <span className="mb-1 block text-sm font-bold">Ban tổ chức quốc tế *</span>
                    <input
                      value={newCompetition.organizer}
                      onChange={(e) =>
                        setNewCompetition({
                          ...newCompetition,
                          organizer: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </label>
                </div>
                {error && <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p>}
                <div className="mt-6 flex justify-end gap-3">
                  <button onClick={close} className="rounded-lg border px-4 py-2 text-sm font-bold">
                    Hủy
                  </button>
                  <button onClick={createCompetition} className="ft-primary">
                    Tạo cuộc thi
                  </button>
                </div>
              </>
            )}
            {step === "ask" && (
              <div className="py-6 text-center">
                <Check className="mx-auto h-12 w-12 rounded-full bg-emerald-50 p-2 text-emerald-600" />
                <h2 className="mt-4 text-2xl font-extrabold">Đã tạo cuộc thi</h2>
                <p className="mt-2 text-slate-600">Bạn có muốn tạo Đợt thi mới cho cuộc thi này?</p>
                <div className="mt-7 flex justify-center gap-3">
                  <button onClick={close} className="rounded-lg border px-4 py-2 text-sm font-bold">
                    Không, để sau
                  </button>
                  <button onClick={() => setStep("session")} className="ft-primary">
                    Có, tạo kỳ thi
                  </button>
                </div>
              </div>
            )}
            {step === "session" && (
              <>
                <h2 className="text-2xl font-extrabold">Tạo kỳ tổ chức mới</h2>
                <p className="mt-2 text-sm text-slate-600">Thời gian chính thức cần đủ ngày/tháng/năm; thời gian dự kiến có thể không có ngày.</p>
                <div className="mt-5 grid gap-4">
                  <label>
                    <span className="mb-1 block text-sm font-bold">Tên kỳ tổ chức *</span>
                    <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </label>
                  <label>
                    <span className="mb-1 block text-sm font-bold">Cuộc thi *</span>
                    <select value={draft.competitionId} onChange={(e) => setDraft({ ...draft, competitionId: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
                      <option value="">Chọn cuộc thi</option>
                      {filteredCompetitions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {draft.rounds.map((round, index) => (
                    <div key={round.id} className="rounded-xl border border-dashed border-slate-300 p-3">
                      <label>
                        <span className="mb-1 block text-sm font-bold">Tên vòng thi *</span>
                        <input
                          value={round.name}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              rounds: draft.rounds.map((item, i) => (i === index ? { ...item, name: e.target.value } : item)),
                            })
                          }
                          className="w-full rounded-lg border border-slate-300 px-3 py-2"
                          placeholder="Ví dụ: Vòng bán kết"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteTarget({
                            kind: "draft-round",
                            id: round.id,
                            name: round.name || "vòng thi",
                          })
                        }
                        className="mt-2 text-sm font-bold text-rose-600"
                      >
                        Xóa vòng này
                      </button>
                      <div className="mt-3 grid gap-3">
                        {(round.days?.length ? round.days : [round.time]).map((day, dayIndex) => (
                          <div key={dayIndex} className="rounded-lg border border-slate-200 p-3">
                            <div className="mb-2 flex items-center justify-between">
                              <b className="text-xs text-slate-600">Ngày tổ chức {dayIndex + 1}</b>
                              {(round.days?.length || 1) > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraft({
                                      ...draft,
                                      rounds: draft.rounds.map((item) =>
                                        item.id === round.id
                                          ? {
                                              ...item,
                                              days: (item.days?.length ? item.days : [item.time]).filter((_: DraftDate, i: number) => i !== dayIndex),
                                            }
                                          : item,
                                      ),
                                    })
                                  }
                                  className="text-xs font-bold text-rose-600"
                                >
                                  Xóa ngày
                                </button>
                              )}
                            </div>
                            <TimeField
                              label={"Thời gian " + (round.name || "vòng bổ sung")}
                              value={day}
                              onChange={(time) =>
                                setDraft({
                                  ...draft,
                                  rounds: draft.rounds.map((item) => {
                                    if (item.id !== round.id) return item;
                                    const days = (item.days?.length ? item.days : [item.time]).map((value: DraftDate, i: number) => (i === dayIndex ? time : value));
                                    return { ...item, time: days[0], days };
                                  }),
                                })
                              }
                            />
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              rounds: draft.rounds.map((item) =>
                                item.id === round.id
                                  ? {
                                      ...item,
                                      days: [...(item.days?.length ? item.days : [item.time]), emptyDate()],
                                    }
                                  : item,
                              ),
                            })
                          }
                          className="w-fit rounded-lg border border-dashed border-[#aa3000] px-3 py-2 text-xs font-bold text-[#aa3000]"
                        >
                          + Thêm ngày tổ chức
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        rounds: [
                          ...draft.rounds,
                          {
                            id: "round-" + Date.now(),
                            name: "",
                            time: emptyDate(),
                            days: [emptyDate()],
                          },
                        ],
                      })
                    }
                    className="w-fit rounded-lg border border-dashed border-[#aa3000] px-4 py-2 text-sm font-bold text-[#aa3000]"
                  >
                    <Plus className="mr-1 inline h-4 w-4" />
                    Thêm vòng thi khác
                  </button>
                  <div className="grid gap-4 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 sm:grid-cols-2">
                    <p className="sm:col-span-2 text-sm font-extrabold text-emerald-950">Google Sheets của kỳ tổ chức</p>
                    <label className="sm:col-span-2">
                      <span className="mb-1 block text-sm font-bold">Danh sách đăng ký (Sheet nguồn vào)</span>
                      <input
                        type="url"
                        value={draft.registrationSheetUrl}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            registrationSheetUrl: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-sm font-bold">Tab danh sách đăng ký</span>
                      <input
                        value={draft.registrationSheetTab}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            registrationSheetTab: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                        placeholder="Ví dụ: Form Responses 1"
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-sm font-bold">Google Sheet output (Sheet đầu ra riêng)</span>
                      <input type="url" value={draft.outputSheetUrl} onChange={(e) => setDraft({ ...draft, outputSheetUrl: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="https://docs.google.com/spreadsheets/d/..." />
                    </label>
                    <label>
                      <span className="mb-1 block text-sm font-bold">Tab output (nếu có)</span>
                      <input value={draft.outputSheetTab} onChange={(e) => setDraft({ ...draft, outputSheetTab: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Ví dụ: Danh sách thí sinh" />
                    </label>
                    <p className="sm:col-span-2 text-xs text-emerald-800">Hai link là hai Sheet độc lập: chỉ nhập từ Sheet đăng ký và chỉ xuất dữ liệu ra Sheet output của chính kỳ này.</p>
                  </div>
                  <label>
                    <span className="mb-1 block text-sm font-bold">Ghi chú</span>
                    <textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Ghi chú theo dõi kỳ tổ chức..." />
                  </label>
                </div>
                {error && <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p>}
                <div className="mt-6 flex justify-end gap-3">
                  <button onClick={close} className="rounded-lg border px-4 py-2 text-sm font-bold">
                    Hủy
                  </button>
                  <button onClick={createSession} className="ft-primary">
                    <Check className="h-4 w-4" />
                    Tạo kỳ tổ chức
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
