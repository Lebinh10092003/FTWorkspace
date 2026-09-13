import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleDot, ClipboardCheck, ExternalLink, FileSpreadsheet, LayoutDashboard, ListChecks, Pencil, Plus, RefreshCw, Search, Trash2, UserCheck, X } from "lucide-react";
import AccountMenu from "./AccountMenu";
import { appDialog } from "./AppDialog";
import Time24Input from "./Time24Input";
import MonthlySheetLinkEditor from "./MonthlySheetLinkEditor";

type WorkStatus = "todo" | "doing" | "completed" | "reviewed";
type Priority = "low" | "medium" | "high";
type View = "board" | "week" | "team" | "sheet";
type Person = { email: string; name: string };
type TeamMember = Person & { employeeCode: string; department: string; jobTitle: string };
type WorkTask = {
  id: number;
  title: string;
  displayTitle: string;
  description: string;
  progressNote: string;
  date: string;
  startTime: string;
  endTime: string;
  status: WorkStatus;
  displayStatus: WorkStatus;
  priority: Priority;
  timePrefixInTitle: boolean;
  label: string;
  dailyOrder: number;
  trainingSessionId?: number | null;
  creator: Person;
  executor: Person;
  supporters: Person[];
  managers: Person[];
  viewerRelation: "executor" | "supporter" | "manager" | "creator" | "team_viewer";
  needsRevision: boolean;
  revisionCount: number;
  revisionOfId: number | null;
  reviewPercent: number | null;
  reviewNote: string;
  canEdit: boolean;
  canDelete: boolean;
  canReview: boolean;
  canManagePeople: boolean;
};
type WorkDraft = {
  id?: number;
  title: string;
  description: string;
  progressNote: string;
  date: string;
  startTime: string;
  endTime: string;
  status: Exclude<WorkStatus, "reviewed">;
  priority: Priority;
  label: string;
  executorEmail: string;
  executorEmails?: string[];
  assignmentMode?: boolean;
  supporterEmails: string[];
  managerEmails: string[];
  canEdit: boolean;
  canDelete: boolean;
  canReview: boolean;
  reviewPercent: number | null;
  reviewNote: string;
};
type InlineDayDraft = { content: string; selfAssessment: string; leaderAssessment: string };
type TimesheetShift = { shiftStart: string; shiftEnd: string; workMode: "direct" | "online"; isDayOff: boolean };
type TimesheetEditorShift = { start: string; end: string; workMode: "direct" | "online" };
type TimesheetEditorState = { date: string; isDayOff: boolean; shifts: TimesheetEditorShift[]; loading: boolean; saving: boolean; error: string };
type DayEditState = { date: string; tasks: WorkTask[] };
type DayAssessmentMode = "default" | "completed" | "custom";
type DayAssessmentEntry = { mode: DayAssessmentMode; note: string };
type DayEditorRow = { key: string; id?: number; title: string; status: WorkStatus; canEdit: boolean; assessment: DayAssessmentEntry };
type Props = {
  idToken: string;
  onBackToWorkspace: () => void;
  onAccountClick: () => void;
  onLogout: () => void;
  userName: string;
  userEmail: string;
  userRole: string;
  photoURL?: string | null;
};
type WorkScheduleSnapshot = {
  owner: string;
  savedAt: number;
  tasks: WorkTask[];
  staff: Person[];
  teamMembers: TeamMember[];
  teamTasks: WorkTask[];
  retentionStart: string;
};

const WORK_SCHEDULE_MEMORY_TTL_MS = 5 * 60 * 1000;
let workScheduleSnapshot: WorkScheduleSnapshot | null = null;

function scheduleLocation() {
  const path = window.location.pathname;
  if (path.endsWith("/team")) return { view: "team" as View, period: "week" as const };
  if (path.endsWith("/month")) return { view: "week" as View, period: "month" as const };
  if (path.endsWith("/week")) return { view: "week" as View, period: "week" as const };
  if (path.endsWith("/sheets")) return { view: "sheet" as View, period: "week" as const };
  return { view: "board" as View, period: "week" as const };
}

function schedulePath(view: View, period: "week" | "month" = "week") {
  if (view === "week") return `/work-schedule/${period}`;
  if (view === "team") return "/work-schedule/team";
  if (view === "sheet") return "/work-schedule/sheets";
  return "/work-schedule/personal";
}

const statuses: Array<{
  id: WorkStatus;
  label: string;
  dot: string;
  column: string;
}> = [
  {
    id: "todo",
    label: "Cần làm",
    dot: "bg-slate-400",
    column: "border-slate-200 bg-slate-100/80",
  },
  {
    id: "doing",
    label: "Đang thực hiện",
    dot: "bg-blue-600",
    column: "border-blue-200 bg-blue-50/80",
  },
  {
    id: "completed",
    label: "Đã hoàn thành",
    dot: "bg-emerald-600",
    column: "border-emerald-200 bg-emerald-50/80",
  },
  {
    id: "reviewed",
    label: "Đã review",
    dot: "bg-violet-600",
    column: "border-violet-200 bg-violet-50/80",
  },
];
const priorities: Record<Priority, { label: string; className: string }> = {
  high: { label: "Ưu tiên cao", className: "bg-rose-50 text-rose-700" },
  medium: { label: "Ưu tiên vừa", className: "bg-amber-50 text-amber-700" },
  low: { label: "Ưu tiên thấp", className: "bg-slate-100 text-slate-600" },
};
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const fromIso = (value: string) => new Date(`${value}T00:00:00`);
const addDays = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};
const mondayOf = (date: Date) => {
  const next = new Date(date);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  next.setHours(0, 0, 0, 0);
  return next;
};
const addMonths = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth() + amount, 1);
const monthCalendarDays = (date: Date) => {
  const first = new Date(date.getFullYear(), date.getMonth(), 1),
    last = new Date(date.getFullYear(), date.getMonth() + 1, 0),
    start = mondayOf(first),
    lastDay = last.getDay() || 7,
    end = addDays(last, 7 - lastDay),
    count = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  return Array.from({ length: count }, (_, index) => addDays(start, index));
};
const weekNumber = (value: string) => {
  const date = fromIso(value);
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
};
const prettyDate = (value: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(fromIso(value));
const shortDate = (value: string) => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(fromIso(value));
const fullDate = (value: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(fromIso(value));
const weekday = (value: string) => new Intl.DateTimeFormat("vi-VN", { weekday: "long" }).format(fromIso(value)).replace(/^./, (letter) => letter.toUpperCase());
const selfAssessment: Record<WorkStatus, string> = {
  todo: "Cần làm",
  doing: "Đang thực hiện",
  completed: "Hoàn thành",
  reviewed: "Hoàn thành",
};
const automaticSelfAssessment = (status: WorkStatus) => status === "completed" || status === "reviewed" ? "Hoàn thành" : "";
const displayedSelfAssessment = (task: WorkTask) => {
  const legacyAutomaticNote = task.progressNote === "Cần làm" || task.progressNote === "Đang thực hiện";
  return legacyAutomaticNote ? automaticSelfAssessment(task.status) : task.progressNote || automaticSelfAssessment(task.status);
};
function dayAssessmentEntry(task: WorkTask): DayAssessmentEntry {
  if (!task.progressNote || task.progressNote === "Cần làm" || task.progressNote === "Đang thực hiện") return { mode: "default", note: "" };
  return task.progressNote === "Hoàn thành" ? { mode: "completed", note: "Hoàn thành" } : { mode: "custom", note: task.progressNote };
}
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((item) => item[0])
    .join("")
    .toUpperCase();
const timeToMinutes = (value: string) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || "").trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= 24 * 60 ? minutes : null;
};
const FIXED_HOLIDAYS = new Set(["01-01", "04-30", "05-01", "09-02"]);
const isDefaultDayOff = (date: string) => {
  const weekday = new Date(`${date}T00:00:00`).getDay();
  return weekday === 0 || weekday === 6 || FIXED_HOLIDAYS.has(date.slice(5));
};
/** Worked minutes for one day, taken from the timesheet ("Công ca") shifts of that day. */
const timesheetDayMinutes = (shifts: TimesheetShift[]) =>
  shifts.reduce((total, shift) => {
    if (shift.isDayOff) return total;
    const from = timeToMinutes(shift.shiftStart),
      to = timeToMinutes(shift.shiftEnd);
    if (from === null || to === null || from === to) return total;
    return total + (to > from ? to - from : 24 * 60 - from + to);
  }, 0);
const formatWorkHours = (minutes: number) => {
  const hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, "0")}`;
};
const timesheetDaySummary = (date: string, shifts: TimesheetShift[] | undefined) => {
  if (shifts?.some((shift) => shift.isDayOff)) return "Ngày nghỉ";
  if (!shifts?.length) return isDefaultDayOff(date) ? "Ngày nghỉ" : "Chưa khai công ca";
  const minutes = timesheetDayMinutes(shifts);
  return minutes > 0 ? `Tổng giờ làm: ${formatWorkHours(minutes)}` : "Ngày nghỉ";
};
const authHeaders = (token: string, json = false): HeadersInit => ({
  Authorization: `Bearer ${token}`,
  ...(json ? { "Content-Type": "application/json" } : {}),
});
const draftFromTask = (task: WorkTask): WorkDraft => ({
  id: task.id,
  title: task.title,
  description: task.description,
  progressNote: task.progressNote,
  date: task.date,
  startTime: task.startTime,
  endTime: task.endTime,
  status: task.status === "reviewed" ? "completed" : task.status,
  priority: task.priority,
  label: task.label,
  executorEmail: task.executor.email,
  supporterEmails: task.supporters.map((item) => item.email),
  managerEmails: task.managers.map((item) => item.email),
  canEdit: task.canEdit && task.status !== "reviewed",
  canDelete: task.canDelete,
  canReview: task.canReview,
  reviewPercent: task.reviewPercent,
  reviewNote: task.reviewNote,
});
const blankDraft = (userEmail: string, date: string): WorkDraft => ({
  title: "",
  description: "",
  progressNote: "",
  date,
  startTime: "",
  endTime: "",
  status: "todo",
  priority: "medium",
  label: "Công việc",
  executorEmail: userEmail,
  supporterEmails: [],
  managerEmails: [],
  canEdit: true,
  canDelete: true,
  canReview: false,
  reviewPercent: null,
  reviewNote: "",
});

function PeoplePicker({ label, staff, selected, onChange, multiple = true, disabled = false }: { label: string; staff: Person[]; selected: string[]; onChange: (emails: string[]) => void; multiple?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedPeople = staff.filter((person) => selected.includes(person.email));
  const matches = staff.filter((person) => `${person.name} ${person.email}`.toLocaleLowerCase("vi-VN").includes(query.trim().toLocaleLowerCase("vi-VN")));
  const toggle = (person: Person) => {
    if (selected.includes(person.email)) {
      onChange(selected.filter((email) => email !== person.email));
      return;
    }
    onChange(multiple ? [...selected, person.email] : [person.email]);
    setQuery("");
    if (!multiple) setOpen(false);
  };
  return (
    <div className="relative">
      <span className="ws-label">{label}</span>
      <div className={`ws-input flex min-h-12 items-center gap-2 ${disabled ? "bg-slate-50" : ""}`}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {selectedPeople.map((person) => (
            <span key={person.email} className="inline-flex max-w-full items-center gap-2 rounded-lg bg-blue-50 px-2.5 py-1.5 text-sm font-semibold text-blue-900">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-100 text-[9px] font-extrabold text-blue-700">{initials(person.name)}</span>
              <span className="truncate">{person.name}</span>
              {!disabled && <button type="button" onClick={() => onChange(selected.filter((email) => email !== person.email))} className="rounded p-0.5 text-blue-400 hover:bg-blue-100 hover:text-blue-700" aria-label={`Bỏ chọn ${person.name}`}><X className="h-3.5 w-3.5" /></button>}
            </span>
          ))}
          <input
            value={query}
            disabled={disabled}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            placeholder={selectedPeople.length ? (multiple ? "Tìm thêm nhân sự..." : "Tìm người khác...") : "Tìm theo tên hoặc email..."}
            className="min-w-[180px] flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
            role="combobox"
            aria-expanded={open}
          />
        </div>
        <button type="button" disabled={disabled} onClick={() => setOpen((value) => !value)} className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed" aria-label={open ? "Đóng danh sách nhân sự" : "Mở danh sách nhân sự"}>
          <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && !disabled && (
        <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="max-h-60 overflow-y-auto p-2">
            {matches.map((person) => (
              <button key={person.email} type="button" onClick={() => toggle(person)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50 ${selected.includes(person.email) ? "bg-blue-50" : ""}`}>
                <input type={multiple ? "checkbox" : "radio"} readOnly checked={selected.includes(person.email)} tabIndex={-1} />
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-100 text-[10px] font-extrabold text-blue-700">{initials(person.name)}</span>
                <span className="min-w-0">
                  <b className="block truncate text-sm text-slate-800">{person.name}</b>
                  <span className="block truncate text-xs text-slate-400">{person.email}</span>
                </span>
              </button>
            ))}
            {!matches.length && <p className="px-3 py-5 text-center text-sm text-slate-400">Không tìm thấy nhân sự.</p>}
          </div>
          {multiple && (
            <div className="flex justify-end border-t border-slate-100 p-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white">
                Xong
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, displayOrder, selected, onSelect, onOpen, onDelete, onDragStart }: { task: WorkTask; displayOrder: number; selected: boolean; onSelect: () => void; onOpen: () => void; onDelete: () => void; onDragStart: () => void }) {
  const time = task.startTime || task.endTime ? `${task.startTime || "—"}${task.endTime ? `–${task.endTime}` : ""}` : "Cả ngày";
  return (
    <article draggable={task.canEdit && task.status !== "reviewed"} onDragStart={onDragStart} onClick={onOpen} className={`group cursor-pointer rounded-2xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${selected ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200"}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={selected} onChange={onSelect} onClick={(event) => event.stopPropagation()} aria-label={`Chọn ${task.displayTitle}`} />
          <span className={`rounded-md px-2 py-1 text-[11px] font-bold ${priorities[task.priority].className}`}>{priorities[task.priority].label}</span>
        </div>
        {task.canDelete && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            aria-label="Xóa lịch"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <h3 className={`text-sm font-bold leading-5 text-slate-900 ${task.priority === "high" ? "italic text-black" : ""}`}>
        <span className="mr-1.5 text-blue-600">{displayOrder}.</span>
        {task.displayTitle}
      </h3>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{task.description || "Không có mô tả."}</p>
      {task.progressNote && <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs font-semibold leading-5 text-amber-800">Ghi chú tiến trình: {task.progressNote}</p>}
      <div className="mt-3 text-xs font-semibold text-slate-500">
        <span>
          {shortDate(task.date)} · {time}
        </span>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
        <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-500">
          <UserCheck className="h-3.5 w-3.5" />
          {task.executor.name}
          {task.supporters.length > 0 && <span>· +{task.supporters.length} hỗ trợ</span>}
        </div>
        <span title={task.executor.name} className="grid h-7 w-7 place-items-center rounded-full bg-[#0055da] text-[10px] font-extrabold text-white">
          {initials(task.executor.name)}
        </span>
      </div>
      {task.reviewPercent !== null && (
        <div className="mt-3 rounded-lg bg-violet-50 px-2.5 py-2 text-[11px] font-bold text-violet-700">
          Lãnh đạo đánh giá: {task.reviewPercent}%{task.reviewNote ? ` · ${task.reviewNote}` : ""}
        </div>
      )}
    </article>
  );
}

export default function WorkSchedule({ idToken, onBackToWorkspace, onAccountClick, onLogout, userName, userEmail, userRole, photoURL }: Props) {
  const initialLocation = scheduleLocation();
  const cachedSnapshot = workScheduleSnapshot?.owner === userEmail && Date.now() - workScheduleSnapshot.savedAt < WORK_SCHEDULE_MEMORY_TTL_MS
    ? workScheduleSnapshot
    : null;
  const [view, setView] = useState<View>(initialLocation.view === "sheet" && userRole !== "ADMIN" ? "board" : initialLocation.view),
    [tasks, setTasks] = useState<WorkTask[]>(cachedSnapshot?.tasks || []),
    [staff, setStaff] = useState<Person[]>(cachedSnapshot?.staff || [{ email: userEmail, name: userName }]),
    [teamMembers, setTeamMembers] = useState<TeamMember[]>(cachedSnapshot?.teamMembers || []),
    [teamTasks, setTeamTasks] = useState<WorkTask[]>(cachedSnapshot?.teamTasks || []),
    [retentionStart, setRetentionStart] = useState(cachedSnapshot?.retentionStart || ""),
    [selectedDate, setSelectedDate] = useState(iso(new Date())),
    [weekStart, setWeekStart] = useState(mondayOf(new Date())),
    [calendarPeriod, setCalendarPeriod] = useState<"week" | "month">(initialLocation.period),
    [calendarLayout, setCalendarLayout] = useState<"calendar" | "table">("table"),
    [editing, setEditing] = useState<WorkDraft | null>(null),
    [selectedIds, setSelectedIds] = useState<number[]>([]),
    [draggedId, setDraggedId] = useState<number | null>(null),
    [query, setQuery] = useState(""),
    [bulkPeopleMode, setBulkPeopleMode] = useState<"supporters" | "managers" | null>(null),
    [loading, setLoading] = useState(!cachedSnapshot),
    [savingTask, setSavingTask] = useState(false),
    [error, setError] = useState("");
  const savingTaskRef = useRef(false);
  const localEditSeqRef = useRef(0);
  const loadSeqRef = useRef(0);
  const pendingMutationCountRef = useRef(0);
  const movingTaskIdsRef = useRef(new Set<number>());
  const [sheetUrl, setSheetUrl] = useState(""),
    [sheetNotice, setSheetNotice] = useState("");
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(mondayOf(weekStart), index)), [weekStart]);
  const visibleCalendarDays = useMemo(() => (calendarPeriod === "week" ? weekDays : monthCalendarDays(weekStart)), [calendarPeriod, weekDays, weekStart]);
  const requestJson = async (url: string, options: RequestInit = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...authHeaders(idToken, !!options.body),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Không thể xử lý lịch làm việc.");
    return data;
  };
  const mutationJson = async (url: string, options: RequestInit) => {
    localEditSeqRef.current += 1;
    pendingMutationCountRef.current += 1;
    try {
      return await requestJson(url, options);
    } finally {
      pendingMutationCountRef.current = Math.max(0, pendingMutationCountRef.current - 1);
    }
  };
  const navigateSchedule = (nextView: View, nextPeriod = calendarPeriod) => {
    setView(nextView);
    if (nextView === "week") setCalendarPeriod(nextPeriod);
    const path = schedulePath(nextView, nextPeriod);
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
  };
  useEffect(() => {
    const onPopState = () => {
      const next = scheduleLocation();
      setView(next.view);
      setCalendarPeriod(next.period);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const load = async (silent = false) => {
    // A background refresh must never replace an optimistic edit with the DB
    // snapshot taken just before that edit finished saving.
    if (silent && pendingMutationCountRef.current > 0) return;
    const loadSeq = ++loadSeqRef.current;
    if (!silent) setLoading(true);
    setError("");
    const editSeq = localEditSeqRef.current;
    try {
      const [items, people, team] = await Promise.all([requestJson("/api/work-schedule/items"), requestJson("/api/auth/assignable-staff"), requestJson("/api/work-schedule/team")]);
      if (
        loadSeq !== loadSeqRef.current
        || editSeq !== localEditSeqRef.current
        || pendingMutationCountRef.current > 0
      ) return;
      const nextTasks = Array.isArray(items.items) ? items.items : [];
      const nextStaff = Array.isArray(people) ? people : [];
      const nextTeamMembers = Array.isArray(team.members) ? team.members : [];
      const nextTeamTasks = Array.isArray(team.items) ? team.items : [];
      const nextRetentionStart = String(items.retentionStart || team.retentionStart || "");
      setTasks(nextTasks);
      setStaff(nextStaff);
      setTeamMembers(nextTeamMembers);
      setTeamTasks(nextTeamTasks);
      setRetentionStart(nextRetentionStart);
      if (userRole === "ADMIN") setSheetUrl(current => current || String(items.sheetUrl || team.sheetUrl || ""));
      workScheduleSnapshot = { owner: userEmail, savedAt: Date.now(), tasks: nextTasks, staff: nextStaff, teamMembers: nextTeamMembers, teamTasks: nextTeamTasks, retentionStart: nextRetentionStart };
    } catch (cause: any) {
      if (loadSeq === loadSeqRef.current && editSeq === localEditSeqRef.current) {
        setError(cause.message || "Không thể tải lịch làm việc.");
      }
    } finally {
      if (loadSeq === loadSeqRef.current) setLoading(false);
    }
  };
  const syncSheet = async () => {
    const data = await mutationJson("/api/work-schedule/sync", {
      method: "POST",
      body: JSON.stringify({ direction: "both" }),
    });
    const pulled = data.result?.pulled || {};
    const pushed = data.result?.pushed || {};
    setSheetNotice(`Đã đọc ${pulled.updated || 0} nhiệm vụ, tạo ${pulled.created || 0} nhiệm vụ mới và ghi ${pushed.tasks || 0} nhiệm vụ lên Sheet.`);
    await load();
  };
  useEffect(() => {
    void load(Boolean(cachedSnapshot));
  }, [idToken]);
  useEffect(() => {
    const refresh = window.setInterval(() => void load(true), 30_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [idToken]);
  useEffect(() => {
    if (loading) return;
    workScheduleSnapshot = { owner: userEmail, savedAt: Date.now(), tasks, staff, teamMembers, teamTasks, retentionStart };
  }, [loading, retentionStart, staff, tasks, teamMembers, teamTasks, userEmail]);
  useEffect(() => {
    if (!loading && view === "team" && teamMembers.length === 0) {
      navigateSchedule("board");
    }
  }, [loading, teamMembers.length, view]);
  const filtered = useMemo(
    () =>
      tasks.filter((task) => {
        const haystack = `${task.displayTitle} ${task.description} ${task.label} ${task.executor.name}`.toLocaleLowerCase("vi-VN");
        return haystack.includes(query.trim().toLocaleLowerCase("vi-VN"));
      }),
    [query, tasks],
  );
  const todayIso = iso(new Date()),
    notificationStart = `${todayIso.slice(0, 7)}-01`,
    overdueTasks = tasks.filter((task) => task.executor.email === userEmail && task.date >= notificationStart && task.date < todayIso && (task.status === "todo" || task.status === "doing")),
    overdueDates = [...new Set(overdueTasks.map((task) => task.date))].sort(),
    dailyTasks = filtered.filter((task) => task.date === selectedDate && task.executor.email === userEmail),
    completedCount = dailyTasks.filter((task) => task.status === "completed" || task.status === "reviewed").length,
    completionPercent = dailyTasks.length ? Math.round((completedCount / dailyTasks.length) * 100) : 0,
    selectedTasks = tasks.filter((task) => selectedIds.includes(task.id)),
    canBulkReview = selectedTasks.length > 0 && selectedTasks.every((task) => task.canReview),
    canBulkDelete = selectedTasks.length > 0 && selectedTasks.every((task) => task.canDelete),
    canBulkEdit = selectedTasks.length > 0 && selectedTasks.every((task) => task.canEdit),
    canBulkManagePeople = selectedTasks.length > 0 && selectedTasks.every((task) => task.canManagePeople);
  const historyEndDate = view === "board"
    ? selectedDate
    : view === "week" && visibleCalendarDays.length
      ? iso(visibleCalendarDays[visibleCalendarDays.length - 1])
      : "";
  const unavailableHistory = Boolean(retentionStart && historyEndDate && historyEndDate < retentionStart);

  const saveTask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || savingTaskRef.current) return;
    savingTaskRef.current = true;
    setSavingTask(true);
    try {
      const assignees = !editing.id && editing.assignmentMode ? (editing.executorEmails || []).filter(Boolean) : [editing.executorEmail];
      if (!assignees.length) throw new Error("Vui lòng chọn ít nhất một nhân viên nhận việc.");
      const data = await mutationJson(editing.id ? `/api/work-schedule/items/${editing.id}` : "/api/work-schedule/items", {
        method: editing.id ? "PATCH" : "POST",
        body: JSON.stringify(editing.assignmentMode ? { ...editing, executorEmails: assignees } : editing),
      });
      const createdItems = Array.isArray(data.items) ? data.items : data.item ? [data.item] : [];
      setTasks((rows) => editing.id
        ? rows.map((item) => (item.id === data.item.id ? data.item : item))
        : [...rows, ...createdItems]);
      setTeamTasks((rows) => editing.id
        ? rows.map((item) => (item.id === data.item.id ? data.item : item))
        : [...rows, ...createdItems]);
      setEditing(null);
    } catch (cause: any) {
      void appDialog.alert(cause.message, {
        title: "Không thể lưu công việc",
        tone: "danger",
      });
    } finally {
      savingTaskRef.current = false;
      setSavingTask(false);
    }
  };
  const saveInlineDay = async (date: string, items: Array<{ id?: number; title: string; progressNote: string; status: WorkStatus; dailyOrder: number }>, deleteIds: number[], executorEmail?: string, leaderAssessment?: string) => {
    return mutationJson("/api/work-schedule/day", {
      method: "POST",
      body: JSON.stringify({ date, items, deleteIds, executorEmail, ...(leaderAssessment !== undefined ? { leaderAssessment } : {}) }),
    });
  };
  const saveProgressNote = async (draft = editing) => {
    if (!draft?.id) return;
    try {
      const data = await mutationJson(`/api/work-schedule/items/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify({ progressNote: draft.progressNote }),
      });
      setTasks((rows) => rows.map((item) => (item.id === data.item.id ? data.item : item)));
      setEditing((current) => (current?.id === draft.id ? { ...current, progressNote: data.item.progressNote } : current));
      void appDialog.alert("Đã lưu ghi chú tiến trình.", { title: "Đã cập nhật", tone: "success" });
    } catch (cause: any) {
      void appDialog.alert(cause.message, { title: "Không thể lưu ghi chú tiến trình", tone: "danger" });
    }
  };
  const changeTaskDates = async (ids: number[], date: string) => {
    await mutationJson("/api/work-schedule/items/batch", {
      method: "POST",
      body: JSON.stringify({ ids, action: "date", date }),
    });
    setSelectedIds([]);
    await load();
  };
  const batchDate = async () => {
    const value = await appDialog.prompt("Chọn ngày mới cho toàn bộ công việc đã chọn.", {
      title: "Đổi ngày hàng loạt",
      inputType: "date",
      defaultValue: selectedDate,
      confirmText: "Đổi ngày",
    });
    if (!value) return;
    try {
      await changeTaskDates(selectedIds, value);
    } catch (cause: any) {
      void appDialog.alert(cause.message, { title: "Không thể đổi ngày hàng loạt", tone: "danger" });
    }
  };
  const batchAddPeople = async (mode: "supporters" | "managers", emails: string[]) => {
    try {
      await mutationJson("/api/work-schedule/items/batch", {
        method: "POST",
        body: JSON.stringify({ ids: selectedIds, action: mode === "supporters" ? "add_supporters" : "add_managers", emails }),
      });
      setBulkPeopleMode(null);
      setSelectedIds([]);
      await load();
    } catch (cause: any) {
      void appDialog.alert(cause.message, { title: "Không thể thêm nhân sự hàng loạt", tone: "danger" });
    }
  };
  const moveOverdueToToday = async () => {
    const confirmed = await appDialog.confirm(`Chuyển ${overdueTasks.length} công việc chưa hoàn thành sang ${fullDate(todayIso)}?`, {
      title: "Chuyển lịch công tác",
      confirmText: "Chuyển toàn bộ",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await changeTaskDates(overdueTasks.map((task) => task.id), todayIso);
      setSelectedDate(todayIso);
      navigateSchedule("board");
    } catch (cause: any) {
      void appDialog.alert(cause.message, { title: "Không thể chuyển lịch công tác", tone: "danger" });
    }
  };
  const deleteTasks = async (ids: number[]) => {
    const confirmed = await appDialog.confirm(`Bạn có chắc muốn xóa ${ids.length > 1 ? `${ids.length} lịch đã chọn` : "lịch này"}? Dữ liệu đã xóa không thể khôi phục.`, { title: "Xóa lịch làm việc", confirmText: "Xóa lịch", tone: "danger" });
    if (!confirmed) return;
    try {
      if (ids.length === 1)
        await mutationJson(`/api/work-schedule/items/${ids[0]}`, {
          method: "DELETE",
        });
      else
        await mutationJson("/api/work-schedule/items/batch", {
          method: "POST",
          body: JSON.stringify({ ids, action: "delete" }),
        });
      setTasks((rows) => rows.filter((item) => !ids.includes(item.id)));
      setTeamTasks((rows) => rows.filter((item) => !ids.includes(item.id)));
      setSelectedIds([]);
      setEditing(null);
    } catch (cause: any) {
      void appDialog.alert(cause.message, {
        title: "Không thể xóa lịch",
        tone: "danger",
      });
    }
  };
  const batchStatus = async (nextStatus: "todo" | "doing" | "completed") => {
    try {
      await mutationJson("/api/work-schedule/items/batch", {
        method: "POST",
        body: JSON.stringify({
          ids: selectedIds,
          action: "status",
          status: nextStatus,
        }),
      });
      setSelectedIds([]);
      await load();
    } catch (cause: any) {
      void appDialog.alert(cause.message, {
        title: "Không thể cập nhật hàng loạt",
        tone: "danger",
      });
    }
  };
  const review = async (action: "request_revision" | "confirm", draft = editing) => {
    if (!draft?.id || draft.reviewPercent === null) {
      void appDialog.alert("Vui lòng nhập mức độ hoàn thành từ 0 đến 100%.", {
        title: "Thiếu đánh giá",
        tone: "warning",
      });
      return;
    }
    try {
      await mutationJson(`/api/work-schedule/items/${draft.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          action,
          reviewPercent: draft.reviewPercent,
          reviewNote: draft.reviewNote,
        }),
      });
      setEditing(null);
      await load();
    } catch (cause: any) {
      void appDialog.alert(cause.message, {
        title: "Không thể review công việc",
        tone: "danger",
      });
    }
  };
  const batchReview = async (action: "request_revision" | "confirm") => {
    const value = await appDialog.prompt("Nhập mức độ hoàn thành áp dụng cho các công việc đã chọn (0–100).", {
      title: action === "confirm" ? "Xác nhận hoàn thành hàng loạt" : "Yêu cầu bổ sung hàng loạt",
      inputType: "number",
      placeholder: "100",
    });
    if (value === null) return;
    try {
      await mutationJson("/api/work-schedule/items/batch", {
        method: "POST",
        body: JSON.stringify({
          ids: selectedIds,
          action,
          reviewPercent: Number(value),
        }),
      });
      setSelectedIds([]);
      await load();
    } catch (cause: any) {
      void appDialog.alert(cause.message, {
        title: "Không thể review hàng loạt",
        tone: "danger",
      });
    }
  };
  const moveTask = async (patch: { status?: WorkStatus; date?: string }) => {
    const task = tasks.find((item) => item.id === draggedId);
    setDraggedId(null);
    if (!task || !task.canEdit || task.status === "reviewed") return;
    if (patch.status === "reviewed") {
      void appDialog.alert("Nhiệm vụ chỉ chuyển sang Đã review sau khi lãnh đạo xác nhận kết quả.", {
        title: "Không thể chuyển trực tiếp",
        tone: "info",
      });
      return;
    }
    if (movingTaskIdsRef.current.has(task.id)) return;
    movingTaskIdsRef.current.add(task.id);
    const targetDate = patch.date || task.date,
      nextOrder = Math.max(0, ...tasks.filter((item) => item.executor.email === task.executor.email && item.date === targetDate && item.id !== task.id).map((item) => item.dailyOrder)) + 1;
    setTasks((rows) =>
      rows.map((item) =>
        item.id === task.id
          ? {
              ...item,
              date: targetDate,
              dailyOrder: patch.date && patch.date !== task.date ? nextOrder : item.dailyOrder,
              status: patch.status && patch.status !== "reviewed" ? patch.status : item.status,
              displayStatus: patch.status || item.displayStatus,
            }
          : item,
      ),
    );
    try {
      const data = await mutationJson(`/api/work-schedule/items/${task.id}`, {
        method: "PATCH",
        // Only send the field represented by the drop. Sending a full, stale
        // task draft could overwrite another edit made at nearly the same time.
        body: JSON.stringify({
          ...(patch.date ? { date: targetDate } : {}),
          ...(patch.status ? { status: patch.status } : {}),
        }),
      });
      if (data.item) {
        setTasks((rows) => rows.map((item) => item.id === task.id ? data.item : item));
        setTeamTasks((rows) => rows.map((item) => item.id === task.id ? data.item : item));
      }
    } catch (cause: any) {
      // Roll back only this task so a failed request cannot undo other drops
      // that completed while it was in flight.
      setTasks((rows) => rows.map((item) => item.id === task.id ? task : item));
      setTeamTasks((rows) => rows.map((item) => item.id === task.id ? task : item));
      void appDialog.alert(cause.message, {
        title: "Không thể di chuyển lịch",
        tone: "danger",
      });
    } finally {
      movingTaskIdsRef.current.delete(task.id);
      if (pendingMutationCountRef.current === 0) void load(true);
    }
  };
  const navItems: Array<{ id: View; label: string; icon: React.ElementType }> = [
    { id: "board", label: "Công việc theo ngày", icon: LayoutDashboard },
    { id: "week", label: "Lịch tuần / tháng", icon: CalendarDays },
    ...(teamMembers.length > 0 ? [{ id: "team" as View, label: "Quản lý nhân sự", icon: UserCheck }] : []),
    ...(userRole === "ADMIN" ? [{ id: "sheet" as View, label: "Liên kết Google Sheets", icon: FileSpreadsheet }] : []),
  ];

  return (
    <div className="ft-module-shell flex min-h-dvh text-slate-900">
      <aside className="dt-sidebar ft-module-sidebar sticky top-0 flex h-dvh w-64 shrink-0 flex-col border-r">
        <button type="button" onClick={onBackToWorkspace} className="ft-sidebar-brand mx-3 mt-3 flex items-center gap-3 text-left">
          <img src="/logo.png" alt="FermatTech" className="h-9 object-contain" />
          <div className="min-w-0 border-l border-sky-100 pl-3"><b className="block text-xl font-extrabold leading-none">FermatTech</b><p className="mt-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-blue-200">Lịch làm việc</p></div>
        </button>
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" onClick={() => navigateSchedule(item.id)} className={`ft-nav-item flex w-full items-center gap-3 rounded-xl border-l-4 px-3.5 py-3 text-left text-sm font-semibold transition ${view === item.id ? "ft-nav-item-active" : ""}`}>
                <Icon className="h-4.5 w-4.5" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="ft-sidebar-footer border-t p-3">
          <button type="button" onClick={onBackToWorkspace} className="ft-sidebar-back mb-3 flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm font-bold">
            <ArrowLeft className="h-4 w-4" />
            Quay lại Workspace
          </button>
          <AccountMenu userName={userName} photoURL={photoURL} userRole={userRole} isGuest={false} onAccountClick={onAccountClick} onLogout={onLogout} variant="sidebar" />
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="ft-module-header sticky top-0 z-20 border-b px-4 py-3 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.16em] text-blue-600">Không gian làm việc</p>
              <h1 className="text-xl font-extrabold tracking-tight text-[#001e40]">{navItems.find((item) => item.id === view)?.label}</h1>
            </div>
            <div className="flex items-center gap-2">
              {view !== "team" && <label className="relative hidden md:block">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm công việc..." className="w-56 rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-400" />
              </label>}
              {view !== "team" && <button type="button" onClick={() => setEditing(blankDraft(userEmail, selectedDate))} className="inline-flex items-center gap-2 rounded-xl bg-[#0055da] px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-200">
                <Plus className="h-4 w-4" />
                Công việc mới
              </button>}
            </div>
          </div>
        </header>
        <div className="ft-module-content mx-auto max-w-[1680px] p-4 sm:p-6 lg:p-8">
          {error && (
            <div className="mb-5 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              <span>{error}</span>
              <button type="button" onClick={() => void load()} className="rounded-lg bg-white px-3 py-1.5">
                Thử lại
              </button>
            </div>
          )}
          {view === "board" && overdueTasks.length > 0 && (
            <section className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 shadow-sm">
              <div className="min-w-[260px] flex-1">
                <b>Bạn vẫn còn {overdueTasks.length} công việc chưa hoàn thành {overdueDates.length === 1 ? `ngày ${fullDate(overdueDates[0])}` : `từ ngày ${fullDate(overdueDates[0])} đến ${fullDate(overdueDates[overdueDates.length - 1])}`}.</b>
                <span className="ml-1">Vui lòng đánh giá hoặc chuyển lịch công tác.</span>
              </div>
              <button type="button" onClick={() => setSelectedDate(overdueDates[0])} className="rounded-xl border border-rose-300 bg-white px-4 py-2 text-xs font-extrabold text-rose-700 hover:bg-rose-100">
                Đánh giá ngay
              </button>
              <button type="button" onClick={() => void moveOverdueToToday()} className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-rose-700">
                Chuyển toàn bộ lịch công tác sang hôm nay
              </button>
            </section>
          )}
          {view === "board" && (
            <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="ws-stat">
                <span className="ws-stat-icon bg-blue-50 text-blue-700">
                  <ListChecks />
                </span>
                <div>
                  <span>Công việc trong ngày</span>
                  <b>{dailyTasks.length}</b>
                </div>
              </div>
              <div className="ws-stat">
                <span className="ws-stat-icon bg-sky-50 text-sky-700">
                  <CircleDot />
                </span>
                <div>
                  <span>Đang thực hiện</span>
                  <b>{dailyTasks.filter((item) => item.status === "doing").length}</b>
                </div>
              </div>
              <div className="ws-stat">
                <span className="ws-stat-icon bg-emerald-50 text-emerald-700">
                  <CheckCircle2 />
                </span>
                <div>
                  <span>Đã làm xong</span>
                  <b>{completedCount}</b>
                </div>
              </div>
              <div className="ws-stat">
                <span className="ws-stat-icon bg-violet-50 text-violet-700">
                  <ClipboardCheck />
                </span>
                <div>
                  <span>Tiến độ chung</span>
                  <b>
                    {completedCount}/{dailyTasks.length} đầu việc
                  </b>
                  <small className="text-[11px] font-semibold text-violet-600">{completionPercent}%</small>
                </div>
              </div>
            </section>
          )}
          {selectedIds.length > 0 && view !== "sheet" && (
            <div className="sticky top-[76px] z-20 mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-blue-200 bg-white p-3 shadow-lg">
              <b className="mr-2 text-sm text-blue-800">Đã chọn {selectedIds.length}</b>
              <button onClick={() => void batchStatus("todo")} className="ws-bulk-btn">
                Cần làm
              </button>
              <button onClick={() => void batchStatus("doing")} className="ws-bulk-btn text-blue-700">
                Đang thực hiện
              </button>
              <button onClick={() => void batchStatus("completed")} className="ws-bulk-btn text-emerald-700">
                Hoàn thành
              </button>
              {canBulkEdit && (
                <button onClick={() => void batchDate()} className="ws-bulk-btn text-blue-700">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Đổi ngày
                </button>
              )}
              {canBulkManagePeople && (
                <>
                  <button onClick={() => setBulkPeopleMode("supporters")} className="ws-bulk-btn text-sky-700">
                    Thêm người hỗ trợ
                  </button>
                  <button onClick={() => setBulkPeopleMode("managers")} className="ws-bulk-btn text-violet-700">
                    Thêm người quản lý
                  </button>
                </>
              )}
              {canBulkReview && (
                <>
                  <button onClick={() => void batchReview("request_revision")} className="ws-bulk-btn text-amber-700">
                    Yêu cầu bổ sung
                  </button>
                  <button onClick={() => void batchReview("confirm")} className="ws-bulk-btn text-violet-700">
                    Xác nhận hoàn thành
                  </button>
                </>
              )}
              {canBulkDelete && (
                <button onClick={() => void deleteTasks(selectedIds)} className="ws-bulk-btn text-rose-700">
                  <Trash2 className="h-3.5 w-3.5" />
                  Xóa
                </button>
              )}
              <button onClick={() => setSelectedIds([])} className="ml-auto rounded-lg p-2 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {loading ? <div className="grid min-h-[420px] place-items-center text-sm font-semibold text-slate-500">Đang tải lịch làm việc...</div> : unavailableHistory ? (
            <section className="grid min-h-[420px] place-items-center rounded-2xl border border-amber-200 bg-amber-50/70 p-8 text-center">
              <div className="max-w-xl">
                <FileSpreadsheet className="mx-auto h-12 w-12 text-amber-600" />
                <h2 className="mt-4 text-xl font-extrabold text-amber-950">Dữ liệu không được lưu trữ trên hệ thống</h2>
                <p className="mt-2 text-sm font-medium leading-6 text-amber-800">Hệ thống chỉ lưu tháng hiện tại và hai tháng liền trước. Vui lòng truy cập trang tính để kiểm tra dữ liệu cũ hơn.</p>
                {userRole === "ADMIN" && sheetUrl ? <a href={sheetUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-amber-700 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-amber-800">
                  <ExternalLink className="h-4 w-4" />Mở trang tính
                </a> : <p className="mt-4 text-sm font-semibold text-amber-800">Vui lòng liên hệ Admin để tra cứu trang tính lưu trữ.</p>}
              </div>
            </section>
          ) : view === "board" ? <BoardView tasks={dailyTasks} selectedDate={selectedDate} setSelectedDate={setSelectedDate} userEmail={userEmail} selectedIds={selectedIds} setSelectedIds={setSelectedIds} setEditing={setEditing} deleteTasks={deleteTasks} setDraggedId={setDraggedId} moveTask={moveTask} /> : view === "week" ? <WeekView tasks={tasks} userEmail={userEmail} idToken={idToken} visibleDays={visibleCalendarDays} anchor={weekStart} setAnchor={setWeekStart} period={calendarPeriod} setPeriod={(period: "week" | "month") => navigateSchedule("week", period)} layout={calendarLayout} setLayout={setCalendarLayout} setSelectedDate={setSelectedDate} setView={(next: View) => navigateSchedule(next)} setEditing={setEditing} setDraggedId={setDraggedId} moveTask={moveTask} saveInlineDay={saveInlineDay} reloadTasks={load} /> : view === "team" ? <TeamSpreadsheetView members={teamMembers} tasks={teamTasks} userEmail={userEmail} setEditing={setEditing} saveInlineDay={saveInlineDay} reloadTasks={load} /> : <SheetView idToken={idToken} sheetUrl={sheetUrl} setSheetUrl={setSheetUrl} notice={sheetNotice} setNotice={setSheetNotice} onSync={syncSheet} />}
        </div>
      </main>
      {editing && <TaskDialog draft={editing} setDraft={setEditing} staff={staff} userEmail={userEmail} saveTask={saveTask} saving={savingTask} saveProgressNote={saveProgressNote} deleteTasks={deleteTasks} review={review} />}
      {bulkPeopleMode && <BulkPeopleDialog mode={bulkPeopleMode} staff={staff} onClose={() => setBulkPeopleMode(null)} onApply={(emails: string[]) => void batchAddPeople(bulkPeopleMode, emails)} />}
    </div>
  );
}

function BoardView({ tasks, selectedDate, setSelectedDate, userEmail, selectedIds, setSelectedIds, setEditing, deleteTasks, setDraggedId, moveTask }: any) {
  const allSelected = tasks.length > 0 && tasks.every((task) => selectedIds.includes(task.id));
  const isToday = selectedDate === iso(new Date());
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-[#001e40]">Công việc {prettyDate(selectedDate)}</h2>
          <p className="mt-1 text-sm text-slate-500">Kéo thẻ để đổi trạng thái. Công việc hoàn thành cần quản lý review.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!tasks.length} onClick={() => setSelectedIds(allSelected ? [] : tasks.map((task) => task.id))} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-40">
            {allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
          </button>
          <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1">
            <button onClick={() => setSelectedDate(iso(addDays(fromIso(selectedDate), -1)))} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Ngày trước">
              <ChevronLeft className="h-4 w-4" />
            </button>
            {isToday && <span className="px-3 text-xs font-bold text-blue-700">Hôm nay</span>}
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="rounded-lg border-0 px-2 py-1 text-xs font-bold outline-none" />
            <button onClick={() => setSelectedDate(iso(addDays(fromIso(selectedDate), 1)))} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Ngày sau">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <div className="ws-board">
        {statuses.map((column) => (
          <section key={column.id} onDragOver={(event) => event.preventDefault()} onDrop={() => void moveTask({ status: column.id })} className={`min-w-[280px] rounded-2xl border p-3 ${column.column}`}>
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <i className={`h-2.5 w-2.5 rounded-full ${column.dot}`} />
                <h3 className="text-sm font-extrabold">{column.label}</h3>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500">{tasks.filter((task) => task.displayStatus === column.id).length}</span>
              </div>
              {column.id !== "reviewed" && (
                <button
                  onClick={() =>
                    setEditing({
                      ...blankDraft(userEmail, selectedDate),
                      status: column.id,
                    })
                  }
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-blue-600"
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="space-y-3">
              {tasks
                .filter((task) => task.displayStatus === column.id)
                .map((task) => (
                  <TaskCard key={task.id} task={task} displayOrder={tasks.findIndex((item) => item.id === task.id) + 1} selected={selectedIds.includes(task.id)} onSelect={() => setSelectedIds((ids) => (ids.includes(task.id) ? ids.filter((id) => id !== task.id) : [...ids, task.id]))} onOpen={() => setEditing(draftFromTask(task))} onDelete={() => void deleteTasks([task.id])} onDragStart={() => setDraggedId(task.id)} />
                ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function TeamView({ members, tasks, userEmail, setEditing }: { members: TeamMember[]; tasks: WorkTask[]; userEmail: string; setEditing: (draft: WorkDraft) => void }) {
  const [selectedEmail, setSelectedEmail] = useState(members[0]?.email || "");
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState(mondayOf(new Date()));
  useEffect(() => {
    if (!members.some((member) => member.email === selectedEmail)) setSelectedEmail(members[0]?.email || "");
  }, [members, selectedEmail]);
  const selected = members.find((member) => member.email === selectedEmail);
  const days = Array.from({ length: 7 }, (_, index) => addDays(mondayOf(anchor), index));
  const start = iso(days[0]),
    end = iso(days[6]);
  const rows = tasks
    .filter((task) => task.executor.email === selectedEmail && task.date >= start && task.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.dailyOrder - b.dailyOrder);
  const pending = rows.filter((task) => task.canReview).length;
  const reviewed = rows.filter((task) => task.status === "reviewed").length;
  const completed = rows.filter((task) => task.status === "completed" || task.status === "reviewed").length;
  const filteredMembers = members.filter((member) => `${member.name} ${member.email} ${member.employeeCode}`.toLocaleLowerCase("vi-VN").includes(query.trim().toLocaleLowerCase("vi-VN")));
  const statusStyle: Record<WorkStatus, string> = {
    todo: "bg-slate-100 text-slate-700",
    doing: "bg-blue-100 text-blue-700",
    completed: "bg-emerald-100 text-emerald-700",
    reviewed: "bg-violet-100 text-violet-700",
  };

  if (!members.length) {
    return (
      <section className="grid min-h-[420px] place-items-center rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <div>
          <UserCheck className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-4 text-lg font-extrabold text-[#001e40]">Chưa có nhân sự trực tiếp dưới quyền</h2>
          <p className="mt-2 text-sm text-slate-500">Danh sách sẽ xuất hiện khi quản trị viên thiết lập người quản lý cho nhân viên.</p>
        </div>
      </section>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[300px_1fr]">
      <aside className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-4">
          <h2 className="font-extrabold text-[#001e40]">Nhân sự dưới quyền</h2>
          <label className="relative mt-3 block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên, email, mã nhân sự..." className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-400" />
          </label>
        </div>
        <div className="max-h-[680px] space-y-1 overflow-y-auto p-2">
          {filteredMembers.map((member) => {
            const memberTasks = tasks.filter((task) => task.executor.email === member.email);
            const waiting = memberTasks.filter((task) => task.canReview).length;
            return (
              <button key={member.email} type="button" onClick={() => setSelectedEmail(member.email)} className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition ${selectedEmail === member.email ? "bg-blue-600 text-white shadow-md shadow-blue-200" : "hover:bg-slate-50"}`}>
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-extrabold ${selectedEmail === member.email ? "bg-white/20" : "bg-blue-50 text-blue-700"}`}>{initials(member.name)}</span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-sm">{member.name}</b>
                  <small className={`block truncate ${selectedEmail === member.email ? "text-blue-100" : "text-slate-400"}`}>{member.employeeCode || member.email}</small>
                </span>
                {waiting > 0 && <span className={`rounded-full px-2 py-1 text-[11px] font-extrabold ${selectedEmail === member.email ? "bg-white text-blue-700" : "bg-amber-100 text-amber-700"}`}>{waiting} chờ</span>}
              </button>
            );
          })}
        </div>
      </aside>
      <section className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Lịch nhân sự</p>
            <h2 className="mt-1 text-xl font-extrabold text-[#001e40]">{selected?.name}</h2>
            <p className="mt-1 text-sm text-slate-500">{[selected?.jobTitle, selected?.department, selected?.employeeCode].filter(Boolean).join(" · ") || selected?.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-xl border bg-white">
              <button type="button" onClick={() => setAnchor(addDays(anchor, -7))} className="p-2.5 hover:bg-slate-50" aria-label="Tuần trước"><ChevronLeft className="h-4 w-4" /></button>
              <div className="border-x px-4 py-2 text-center text-xs font-bold text-slate-600">Tuần {weekNumber(start)}<br /><span className="font-medium text-slate-400">{shortDate(start)}–{fullDate(end)}</span></div>
              <button type="button" onClick={() => setAnchor(addDays(anchor, 7))} className="p-2.5 hover:bg-slate-50" aria-label="Tuần sau"><ChevronRight className="h-4 w-4" /></button>
            </div>
            {selected && (
              <button type="button" onClick={() => setEditing({ ...blankDraft(userEmail, iso(new Date())), executorEmail: selected.email, managerEmails: [userEmail] })} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-extrabold text-white shadow-md shadow-blue-200">
                <Plus className="h-4 w-4" /> Giao việc
              </button>
            )}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="ws-stat"><span className="ws-stat-icon bg-blue-50 text-blue-700"><ListChecks /></span><div><span>Tổng việc trong tuần</span><b>{rows.length}</b></div></div>
          <div className="ws-stat"><span className="ws-stat-icon bg-sky-50 text-sky-700"><CircleDot /></span><div><span>Đang thực hiện</span><b>{rows.filter((task) => task.status === "doing").length}</b></div></div>
          <div className="ws-stat"><span className="ws-stat-icon bg-amber-50 text-amber-700"><ClipboardCheck /></span><div><span>Chờ quản lý review</span><b>{pending}</b></div></div>
          <div className="ws-stat"><span className="ws-stat-icon bg-violet-50 text-violet-700"><CheckCircle2 /></span><div><span>Đã review</span><b>{reviewed}</b><small className="text-[11px] font-semibold text-violet-600">{rows.length ? Math.round((completed / rows.length) * 100) : 0}% hoàn thành</small></div></div>
        </div>
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-5 py-4"><h3 className="font-extrabold text-[#001e40]">Lịch công việc tuần {weekNumber(start)}</h3></div>
          <div className="divide-y">
            {days.map((day) => {
              const date = iso(day), dayRows = rows.filter((task) => task.date === date);
              return (
                <div key={date} className="grid min-h-20 gap-3 p-4 sm:grid-cols-[150px_1fr]">
                  <div><b className="block text-sm text-slate-800">{weekday(date)}</b><span className="text-sm text-slate-400">{fullDate(date)}</span></div>
                  <div className="space-y-2">
                    {dayRows.length ? dayRows.map((task) => (
                      <button key={task.id} type="button" onClick={() => setEditing(draftFromTask(task))} className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left hover:border-blue-300 hover:bg-blue-50/40">
                        <span className="font-bold text-blue-600">{task.dailyOrder}.</span>
                        <span className="min-w-[240px] flex-1 font-semibold text-slate-800">{task.title}</span>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusStyle[task.status]}`}>{task.canReview ? "Chờ review" : selfAssessment[task.status]}</span>
                        {task.progressNote && <span className="w-full pl-7 text-sm text-slate-500">{task.progressNote}</span>}
                      </button>
                    )) : <span className="text-sm text-slate-300">Không có lịch</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
function TeamSpreadsheetView({ members, tasks, userEmail, setEditing, saveInlineDay, reloadTasks }: {
  members: TeamMember[];
  tasks: WorkTask[];
  userEmail: string;
  setEditing: (draft: WorkDraft) => void;
  saveInlineDay: (date: string, items: GridSaveItem[], deleteIds: number[], executorEmail?: string, leaderAssessment?: string) => Promise<unknown>;
  reloadTasks: (silent?: boolean) => Promise<void>;
}) {
  const [personEmail, setPersonEmail] = useState("all");
  const [period, setPeriod] = useState<"week" | "day" | "month">("week");
  const [anchor, setAnchor] = useState(mondayOf(new Date()));
  const [selectedDay, setSelectedDay] = useState(iso(new Date()));
  const visiblePeople = personEmail === "all" ? members : members.filter((member) => member.email === personEmail);
  const days = period === "week"
    ? Array.from({ length: 7 }, (_, index) => addDays(mondayOf(anchor), index))
    : period === "month"
      ? Array.from({ length: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate() }, (_, index) => new Date(anchor.getFullYear(), anchor.getMonth(), index + 1))
      : [fromIso(selectedDay)];
  const start = iso(days[0]), end = iso(days[days.length - 1]);
  const rows = tasks.filter((task) => visiblePeople.some((person) => person.email === task.executor.email) && task.date >= start && task.date <= end);
  const pending = rows.filter((task) => task.canReview).length;
  const reviewed = rows.filter((task) => task.status === "reviewed").length;
  const completed = rows.filter((task) => task.status === "completed" || task.status === "reviewed").length;

  if (!members.length) return <section className="grid min-h-[420px] place-items-center border border-dashed border-slate-300 bg-white p-8 text-center"><div><UserCheck className="mx-auto h-10 w-10 text-slate-300" /><h2 className="mt-4 text-lg font-extrabold text-[#001e40]">Chưa có nhân sự trực tiếp</h2><p className="mt-2 text-sm text-slate-500">Danh sách xuất hiện khi quản trị viên thiết lập người quản lý cho nhân viên trong hệ thống.</p></div></section>;

  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="ws-stat"><span className="ws-stat-icon bg-blue-50 text-blue-700"><ListChecks /></span><div><span>Tổng công việc</span><b>{rows.length}</b></div></div>
      <div className="ws-stat"><span className="ws-stat-icon bg-sky-50 text-sky-700"><CircleDot /></span><div><span>Đang thực hiện</span><b>{rows.filter((task) => task.status === "doing").length}</b></div></div>
      <div className="ws-stat"><span className="ws-stat-icon bg-amber-50 text-amber-700"><ClipboardCheck /></span><div><span>Chờ quản lý review</span><b>{pending}</b></div></div>
      <div className="ws-stat"><span className="ws-stat-icon bg-violet-50 text-violet-700"><CheckCircle2 /></span><div><span>Đã review</span><b>{reviewed}</b><small className="text-[11px] font-semibold text-violet-600">{rows.length ? Math.round((completed / rows.length) * 100) : 0}% hoàn thành</small></div></div>
    </div>
    <section className="flex flex-wrap items-end gap-3 border border-slate-300 bg-white p-3 shadow-sm">
      <label className="min-w-64"><span className="mb-1 block text-xs font-bold text-slate-500">Nhân sự</span><select value={personEmail} onChange={(event) => setPersonEmail(event.target.value)} className="w-full border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"><option value="all">Tất cả nhân sự ({members.length})</option>{members.map((member) => <option key={member.email} value={member.email}>{member.name}</option>)}</select></label>
      <label><span className="mb-1 block text-xs font-bold text-slate-500">Kiểu lọc thời gian</span><select value={period} onChange={(event) => setPeriod(event.target.value as "week" | "day" | "month")} className="border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"><option value="week">Theo tuần</option><option value="month">Theo tháng</option><option value="day">Theo ngày</option></select></label>
      {period === "day"
        ? <label><span className="mb-1 block text-xs font-bold text-slate-500">Ngày</span><input type="date" value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)} className="border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" /></label>
        : <div><span className="mb-1 block text-xs font-bold text-slate-500">{period === "month" ? "Tháng" : "Tuần"}</span><div className="flex border border-slate-300"><button type="button" onClick={() => setAnchor(period === "month" ? addMonths(anchor, -1) : addDays(anchor, -7))} className="border-r border-slate-300 p-2 hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button><div className="min-w-40 px-3 py-1 text-center text-xs font-bold">{period === "month" ? `Tháng ${anchor.getMonth() + 1}/${anchor.getFullYear()}` : `Tuần ${weekNumber(start)}`}<br/><span className="font-normal text-slate-500">{shortDate(start)}–{fullDate(end)}</span></div><button type="button" onClick={() => setAnchor(period === "month" ? addMonths(anchor, 1) : addDays(anchor, 7))} className="border-l border-slate-300 p-2 hover:bg-slate-50"><ChevronRight className="h-4 w-4" /></button></div></div>}
      <button type="button" onClick={() => setEditing({ ...blankDraft(userEmail, period === "day" ? selectedDay : iso(new Date())), executorEmails: personEmail === "all" ? [] : [personEmail], executorEmail: personEmail === "all" ? "" : personEmail, assignmentMode: true, managerEmails: [userEmail] })} className="ml-auto inline-flex items-center gap-2 rounded-xl bg-[#0055da] px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-200"><Plus className="h-4 w-4" />Giao việc</button>
    </section>
    <SpreadsheetScheduleTable days={days} people={visiblePeople} tasks={tasks} saveInlineDay={saveInlineDay} reloadTasks={reloadTasks} />
  </div>;
}

function WeekView({ tasks, userEmail, idToken, visibleDays, anchor, setAnchor, period, setPeriod, layout, setLayout, setSelectedDate, setView, setEditing, setDraggedId, moveTask, saveInlineDay, reloadTasks }: any) {
  const today = iso(new Date());
  const currentMonth = anchor.getMonth();
  const [dragTargetDate, setDragTargetDate] = useState<string | null>(null);
  const [timesheetByDate, setTimesheetByDate] = useState<Record<string, TimesheetShift[]>>({});
  const showDaySummary = layout === "calendar" && period === "week";
  const rangeStart = iso(visibleDays[0]),
    rangeEnd = iso(visibleDays[visibleDays.length - 1]);

  // The daily total comes from the "Công ca" timesheet, not from task start/end times.
  useEffect(() => {
    if (!showDaySummary || !idToken) return;
    let active = true;
    const loadTimesheet = async () => {
      try {
        const response = await fetch(`/api/attendance/timesheet/range?start=${rangeStart}&end=${rangeEnd}`, { headers: { Authorization: `Bearer ${idToken}` } });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Không thể tải công ca.");
        if (active) setTimesheetByDate(payload.dates || {});
      } catch {
        if (active) setTimesheetByDate({});
      }
    };
    void loadTimesheet();
    const onSaved = () => void loadTimesheet();
    window.addEventListener("ft-timesheet-saved", onSaved);
    return () => {
      active = false;
      window.removeEventListener("ft-timesheet-saved", onSaved);
    };
  }, [idToken, rangeStart, rangeEnd, showDaySummary]);
  const go = (amount: number) => setAnchor(period === "week" ? addDays(anchor, amount * 7) : addMonths(anchor, amount));
  const heading = period === "week" ? `LỊCH CÔNG TÁC TUẦN ${weekNumber(iso(visibleDays[0]))} NĂM ${visibleDays[0].getFullYear()}` : `LỊCH CÔNG TÁC THÁNG ${anchor.getMonth() + 1} NĂM ${anchor.getFullYear()}`;
  const dateRange = period === "week" ? `Từ ${fullDate(iso(visibleDays[0]))} đến ${fullDate(iso(visibleDays[visibleDays.length - 1]))}` : "";
  const rowsFor = (day: Date) => tasks.filter((task: WorkTask) => task.date === iso(day)).sort((a: WorkTask, b: WorkTask) => a.dailyOrder - b.dailyOrder);
  const taskButton = (task: WorkTask, displayOrder: number) => (
    <button key={task.id} draggable={task.canEdit && task.status !== "reviewed"} onDragStart={() => setDraggedId(task.id)} onDragEnd={() => setDragTargetDate(null)} onClick={() => setEditing(draftFromTask(task))} className={`w-full rounded-lg border-l-4 p-2.5 text-left text-xs shadow-sm transition duration-150 active:cursor-grabbing ${task.canEdit ? "cursor-grab" : "cursor-pointer"} ${task.displayStatus === "reviewed" ? "border-violet-500 bg-violet-50" : task.displayStatus === "completed" ? "border-emerald-500 bg-emerald-50" : task.displayStatus === "doing" ? "border-blue-500 bg-blue-50" : "border-slate-400 bg-slate-50"}`}>
      <span className="font-bold text-slate-500">
        {displayOrder}. {task.startTime || "Cả ngày"}
      </span>
      <b className="mt-1 block leading-5">{task.displayTitle}</b>
    </button>
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-[#001e40]">{heading}</h2>
          {dateRange && <p className="mt-1 text-sm font-semibold text-slate-500">{dateRange}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-xl border bg-white p-1">
            <button onClick={() => setPeriod("week")} className={`rounded-lg px-3 py-2 text-xs font-bold ${period === "week" ? "bg-blue-600 text-white" : "text-slate-600"}`}>
              Tuần
            </button>
            <button onClick={() => setPeriod("month")} className={`rounded-lg px-3 py-2 text-xs font-bold ${period === "month" ? "bg-blue-600 text-white" : "text-slate-600"}`}>
              Tháng
            </button>
          </div>
          <div className="flex rounded-xl border bg-white p-1">
            <button onClick={() => setLayout("calendar")} className={`rounded-lg px-3 py-2 text-xs font-bold ${layout === "calendar" ? "bg-slate-800 text-white" : "text-slate-600"}`}>
              Lịch
            </button>
            <button onClick={() => setLayout("table")} className={`rounded-lg px-3 py-2 text-xs font-bold ${layout === "table" ? "bg-slate-800 text-white" : "text-slate-600"}`}>
              Bảng
            </button>
          </div>
          <div className="flex overflow-hidden rounded-xl bg-blue-600 text-white shadow-md shadow-blue-200">
            <button onClick={() => go(-1)} className="p-2.5 transition hover:bg-blue-700" aria-label={period === "week" ? "Tuần trước" : "Tháng trước"}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="w-px bg-white/25" />
            <button onClick={() => go(1)} className="p-2.5 transition hover:bg-blue-700" aria-label={period === "week" ? "Tuần sau" : "Tháng sau"}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      {layout === "calendar" ? (
        <section className="overflow-x-auto rounded-2xl border bg-white">
          <div className="grid min-w-[980px] grid-cols-7 border-b bg-slate-50">
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index} className="p-2 text-center text-xs font-extrabold uppercase text-slate-500">
                {new Intl.DateTimeFormat("vi-VN", { weekday: "short" }).format(addDays(mondayOf(new Date()), index))}
              </div>
            ))}
          </div>
          <div className="grid min-w-[980px] grid-cols-7">
            {visibleDays.map((day: Date) => {
              const dayIso = iso(day),
                rows = rowsFor(day),
                muted = period === "month" && day.getMonth() !== currentMonth;
              return (
                <div
                  key={dayIso}
                  onDragEnter={() => setDragTargetDate(dayIso)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    setDragTargetDate(null);
                    void moveTask({ date: dayIso });
                  }}
                  className={`${period === "week" ? "min-h-[520px]" : "min-h-[170px]"} border-b border-r p-2 transition-colors ${dragTargetDate === dayIso ? "bg-blue-100 ring-2 ring-inset ring-blue-400" : muted ? "bg-slate-50/80" : "bg-white"}`}
                >
                  <button
                    onClick={() => {
                      setSelectedDate(dayIso);
                      setView("board");
                    }}
                    className={`${showDaySummary ? "mb-1" : "mb-2"} grid h-8 w-8 place-items-center rounded-full text-sm font-extrabold ${dayIso === today ? "bg-blue-600 text-white" : muted ? "text-slate-400" : "text-slate-700"}`}
                  >
                    {day.getDate()}
                  </button>
                  {showDaySummary && (() => {
                    const summary = timesheetDaySummary(dayIso, timesheetByDate[dayIso]),
                      worked = summary.startsWith("Tổng giờ làm");
                    return <p className={`mb-2 rounded-lg px-2 py-1 text-[11px] font-bold leading-4 ${worked ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{summary}</p>;
                  })()}
                  <div className="space-y-2">{rows.map((task: WorkTask, index: number) => taskButton(task, index + 1))}</div>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <SpreadsheetScheduleTable days={visibleDays} tasks={tasks.filter((task: WorkTask) => task.executor.email === userEmail)} executorEmail={userEmail} idToken={idToken} saveInlineDay={saveInlineDay} reloadTasks={reloadTasks} />
      )}
    </>
  );
}

const numberedCell = (values: string[]) => values.map((value, index) => `${index + 1}. ${value}`).join("\n");
const splitNumberedCell = (value: string) => {
  const entries: Array<{ number: number; text: string[] }> = [];
  String(value || "").replace(/\r\n/g, "\n").split("\n").forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    const match = line.match(/^\s*(\d{1,3})\s*[.,)]\s*(.*)$/);
    if (match) entries.push({ number: Number(match[1]), text: [match[2].trim()] });
    else if (entries.length) entries[entries.length - 1].text.push(line);
    else entries.push({ number: 1, text: [line] });
  });
  return entries.map((entry) => ({ number: entry.number, text: entry.text.join("\n").trim() }));
};
const isCompletionNote = (value: string) => ["hoàn thành", "đã hoàn thành", "xong"].includes(value.trim().toLocaleLowerCase("vi-VN"));

type GridSaveItem = { id?: number; title: string; progressNote: string; status: WorkStatus; dailyOrder: number };
type ScheduleGridRow = { key: string; date: string; executorEmail: string; person?: TeamMember };

const numberedGridCell = (values: Array<{ number: number; text: string }>) => values.map((value) => `${value.number}. ${value.text}`).join("\n");
const timePrefixedGridLine = /^\s*\d+\s*[.,)]\s*\d{1,2}(?:\s*[hH]\s*\d{0,2}|\s*:\s*\d{2})(?=\s|[:;,.-])/;

function ImportantWorkContentEditor({ value, tasks, className, onInput, onChange, onBlur }: {
  value: string;
  tasks: WorkTask[];
  className: string;
  onInput: React.FormEventHandler<HTMLTextAreaElement>;
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  onBlur: React.FocusEventHandler<HTMLTextAreaElement>;
}) {
  const [focused, setFocused] = useState(false);
  const priorityByOrder = new Map(tasks.map((task) => [task.dailyOrder, task.priority]));
  let currentImportant = false;
  const renderedLines = value.split("\n").map((line, index) => {
    const numbered = line.match(/^\s*(\d{1,3})\s*[.,)]\s*/);
    if (numbered) currentImportant = timePrefixedGridLine.test(line) || priorityByOrder.get(Number(numbered[1])) === "high";
    return <React.Fragment key={`${index}-${line}`}><span className={currentImportant ? "font-bold italic text-black" : "font-medium text-slate-900"}>{line || " "}</span>{index < value.split("\n").length - 1 && "\n"}</React.Fragment>;
  });
  return <div className="relative">
    {!!value && !focused && <div aria-hidden className="pointer-events-none absolute inset-0 whitespace-pre-wrap p-2 leading-5">{renderedLines}</div>}
    <textarea
      ref={resizeGridTextarea}
      value={value}
      onFocus={() => setFocused(true)}
      onInput={onInput}
      onChange={onChange}
      onBlur={(event) => { setFocused(false); onBlur(event); }}
      placeholder={'1. Nhập nội dung công việc\n2. Nhiệm vụ tiếp theo'}
      className={`${className} font-medium ${value && !focused ? "text-transparent" : "text-slate-900"}`}
    />
  </div>;
}
const resizeGridTextarea = (element: HTMLTextAreaElement | null) => {
  if (!element) return;
  const row = element.closest("tr");
  const editors = row ? Array.from(row.querySelectorAll<HTMLTextAreaElement>("textarea")) : [element];
  editors.forEach((editor) => { editor.style.height = "auto"; });
  const height = Math.max(80, ...editors.map((editor) => editor.scrollHeight));
  editors.forEach((editor) => { editor.style.height = `${height}px`; });
};

function SpreadsheetScheduleTable({ days, tasks, executorEmail, people, idToken, saveInlineDay, reloadTasks }: {
  days: Date[];
  tasks: WorkTask[];
  executorEmail?: string;
  people?: TeamMember[];
  idToken?: string;
  saveInlineDay: (date: string, items: GridSaveItem[], deleteIds: number[], executorEmail?: string, leaderAssessment?: string) => Promise<unknown>;
  reloadTasks: (silent?: boolean) => Promise<void>;
}) {
  const gridRows: ScheduleGridRow[] = people?.length
    ? days.flatMap((day) => people.map((person) => ({ key: `${person.email}|${iso(day)}`, date: iso(day), executorEmail: person.email, person })))
    : days.map((day) => ({ key: `${executorEmail || "self"}|${iso(day)}`, date: iso(day), executorEmail: executorEmail || "" }));
  const rowsFor = (row: ScheduleGridRow) => tasks.filter((task) => task.date === row.date && (!row.executorEmail || task.executor.email === row.executorEmail)).sort((a, b) => a.dailyOrder - b.dailyOrder);
  const makeDrafts = () => Object.fromEntries(gridRows.map((row) => {
    const workItems = rowsFor(row);
    const allCompleted = workItems.length > 0 && workItems.every((task) => task.status === "completed" || task.status === "reviewed");
    const allReviewed = workItems.length > 0 && workItems.every((task) => task.status === "reviewed");
    const leaderAssessments = [...new Set(workItems
      .filter((task) => task.reviewPercent !== null)
      .map((task) => `${task.reviewPercent}%${task.reviewNote ? ` · ${task.reviewNote}` : ""}`))];
    return [row.key, {
      content: numberedGridCell(workItems.map((task) => ({ number: task.dailyOrder, text: task.title }))),
      selfAssessment: allCompleted ? "Hoàn thành" : numberedGridCell(workItems.map((task) => ({ number: task.dailyOrder, text: displayedSelfAssessment(task) }))),
      leaderAssessment: allReviewed ? "Hoàn thành" : leaderAssessments.join("\n"),
    }];
  })) as Record<string, InlineDayDraft>;
  const gridKey = gridRows.map((row) => row.key).join("|");
  const [drafts, setDrafts] = useState<Record<string, InlineDayDraft>>(makeDrafts);
  const [dirtyRows, setDirtyRows] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [attendanceByDate, setAttendanceByDate] = useState<Record<string, TimesheetShift[]>>({});
  const [attendanceEditor, setAttendanceEditor] = useState<TimesheetEditorState | null>(null);
  const savingRef = useRef(false);
  const draftsRef = useRef(drafts);
  const dirtyRowsRef = useRef(dirtyRows);

  useEffect(() => { draftsRef.current = drafts; }, [drafts]);
  useEffect(() => { dirtyRowsRef.current = dirtyRows; }, [dirtyRows]);

  useEffect(() => {
    if (people || !idToken || !days.length) return;
    let active = true;
    const loadAttendance = async () => {
      try {
        const start = iso(days[0]);
        const end = iso(days[days.length - 1]);
        const response = await fetch(`/api/attendance/timesheet/range?start=${start}&end=${end}`, { headers: { Authorization: `Bearer ${idToken}` } });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Không thể tải chấm công.");
        if (active) setAttendanceByDate(payload.dates || {});
      } catch {
        if (active) setAttendanceByDate({});
      }
    };
    void loadAttendance();
    const refresh = window.setInterval(() => void loadAttendance(), 30_000);
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void loadAttendance(); };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [gridKey, idToken, people]);

  const openAttendanceEditor = async (date: string) => {
    if (people || !idToken) return;
    setAttendanceEditor({ date, isDayOff: false, shifts: [], loading: true, saving: false, error: "" });
    try {
      const response = await fetch(`/api/attendance/timesheet/prefill?date=${date}`, { headers: { Authorization: `Bearer ${idToken}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Không thể tải công ca.");
      const existing = payload.existing || [];
      const isDayOff = Boolean(existing[0]?.isDayOff || (!existing.length && payload.defaultDayOff));
      const shifts = existing.length && !isDayOff
        ? existing.map((item: any) => ({ start: item.shiftStart, end: item.shiftEnd, workMode: item.workMode }))
        : (payload.shifts || []).map((item: any) => ({ start: item.start, end: item.end, workMode: item.workMode }));
      setAttendanceEditor({
        date,
        isDayOff,
        shifts: isDayOff ? [] : (shifts.length ? shifts : [{ start: "08:00", end: "12:00", workMode: "direct" }]),
        loading: false,
        saving: false,
        error: "",
      });
    } catch (cause: any) {
      setAttendanceEditor(current => current?.date === date ? { ...current, loading: false, error: cause.message || "Không thể tải công ca." } : current);
    }
  };

  const updateAttendanceShift = (index: number, patch: Partial<TimesheetEditorShift>) => {
    setAttendanceEditor(current => current ? {
      ...current,
      shifts: current.shifts.map((shift, shiftIndex) => shiftIndex === index ? { ...shift, ...patch } : shift),
    } : current);
  };

  const saveAttendanceEditor = async () => {
    const current = attendanceEditor;
    if (!current || current.loading || current.saving || !idToken) return;
    if (!current.isDayOff && !current.shifts.length) {
      setAttendanceEditor({ ...current, error: "Vui lòng thêm ít nhất một ca." });
      return;
    }
    setAttendanceEditor({ ...current, saving: true, error: "" });
    try {
      const response = await fetch("/api/attendance/timesheet/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ workDate: current.date, isDayOff: current.isDayOff, shifts: current.isDayOff ? [] : current.shifts }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Không thể lưu công ca.");
      setAttendanceByDate(previous => ({ ...previous, [current.date]: payload.entries || [] }));
      setAttendanceEditor(null);
      window.dispatchEvent(new CustomEvent("ft-timesheet-saved", { detail: { date: current.date } }));
    } catch (cause: any) {
      setAttendanceEditor(latest => latest?.date === current.date ? { ...latest, saving: false, error: cause.message || "Không thể lưu công ca." } : latest);
    }
  };

  useEffect(() => {
    setDrafts((current) => {
      const refreshed = makeDrafts();
      dirtyRowsRef.current.forEach((key) => {
        if (current[key]) refreshed[key] = current[key];
      });
      draftsRef.current = refreshed;
      return refreshed;
    });
  }, [tasks, gridKey]);

  const updateCell = (key: string, patch: Partial<InlineDayDraft>) => {
    const nextDrafts = { ...draftsRef.current, [key]: { ...(draftsRef.current[key] || { content: "", selfAssessment: "", leaderAssessment: "" }), ...patch } };
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
    if (!dirtyRowsRef.current.includes(key)) {
      dirtyRowsRef.current = [...dirtyRowsRef.current, key];
      setDirtyRows(dirtyRowsRef.current);
    }
  };
  const saveTable = async () => {
    if (savingRef.current || !dirtyRowsRef.current.length) return;
    const savingRows = [...dirtyRowsRef.current];
    const sourceDrafts = draftsRef.current;
    const savedDrafts = Object.fromEntries(savingRows.map((key) => [key, sourceDrafts[key]]));
    savingRef.current = true;
    setSaving(true);
    try {
      let nextDrafts = { ...sourceDrafts };
      const duplicateMessages: string[] = [];
      for (const key of savingRows) {
        const row = gridRows.find((item) => item.key === key)!;
        const counts = new Map<number, number>();
        splitNumberedCell(nextDrafts[key]?.content || "").filter((entry) => entry.text).forEach((entry) => counts.set(entry.number, (counts.get(entry.number) || 0) + 1));
        counts.forEach((count, number) => {
          if (count > 1) duplicateMessages.push(`${row.person?.name ? `${row.person.name}, ` : ""}${fullDate(row.date)}: có ${count} lịch làm việc cùng thứ tự ${number}`);
        });
      }
      if (duplicateMessages.length) {
        const reorder = await appDialog.confirm(`Bạn có lịch làm việc trùng số thứ tự:\n\n${duplicateMessages.join("\n")}\n\nBạn có muốn hệ thống đánh lại số theo thứ tự đang hiển thị không?`, {
          title: "Trùng số thứ tự lịch làm việc",
          confirmText: "Tự sắp xếp lại",
          cancelText: "Giữ nguyên để sửa",
          tone: "warning",
        });
        if (!reorder) return;
        nextDrafts = { ...nextDrafts };
        savingRows.forEach((key) => {
          const content = splitNumberedCell(nextDrafts[key]?.content || "").filter((entry) => entry.text);
          const singleCompletion = isCompletionNote(nextDrafts[key]?.selfAssessment || "");
          const notes = splitNumberedCell(nextDrafts[key]?.selfAssessment || "");
          nextDrafts[key] = {
            content: numberedGridCell(content.map((entry, index) => ({ number: index + 1, text: entry.text }))),
            selfAssessment: singleCompletion ? "Hoàn thành" : numberedGridCell(content.map((_, index) => ({ number: index + 1, text: notes[index]?.text || "" }))),
            leaderAssessment: nextDrafts[key]?.leaderAssessment || "",
          };
        });
        setDrafts(nextDrafts);
        draftsRef.current = nextDrafts;
      }
      for (const key of savingRows) {
        const row = gridRows.find((item) => item.key === key)!;
        const original = rowsFor(row);
        const content = splitNumberedCell(nextDrafts[key]?.content || "").filter((entry) => entry.text);
        const singleCompletion = isCompletionNote(nextDrafts[key]?.selfAssessment || "");
        const notes = splitNumberedCell(nextDrafts[key]?.selfAssessment || "");
        if (content.length > 100) throw new Error(`Ngày ${fullDate(row.date)} vượt quá 100 nhiệm vụ.`);
        if (content.some((entry) => entry.number < 1 || entry.number > 100)) throw new Error(`Số thứ tự nhiệm vụ của ngày ${fullDate(row.date)} phải nằm trong khoảng 1–100.`);
        const usedIds = new Set<number>();
        const items = content.map((entry, index) => {
          let current = original.find((task) => !usedIds.has(task.id) && task.title.trim() === entry.text.trim());
          if (!current) current = original.find((task) => !usedIds.has(task.id) && task.dailyOrder === entry.number);
          if (!current) current = original.find((task, taskIndex) => taskIndex >= index && !usedIds.has(task.id));
          if (current) usedIds.add(current.id);
          const note = singleCompletion ? "Hoàn thành" : notes.find((item) => item.number === entry.number)?.text || notes[index]?.text || "";
          return {
            ...(current ? { id: current.id } : {}), title: entry.text, progressNote: note,
            status: current?.status === "reviewed" ? "reviewed" : isCompletionNote(note) ? "completed" : current?.status || "todo",
            dailyOrder: entry.number,
          } as GridSaveItem;
        });
        const removed = original.filter((task) => !usedIds.has(task.id));
        const blocked = removed.find((task) => !task.canDelete);
        if (blocked) throw new Error(`Bạn không có quyền xóa nhiệm vụ số ${blocked.dailyOrder} của ngày ${fullDate(row.date)}.`);
        await saveInlineDay(row.date, items, removed.map((task) => task.id), row.executorEmail || undefined, nextDrafts[key]?.leaderAssessment);
      }
      await reloadTasks(true);
      const remainingDirtyRows = dirtyRowsRef.current.filter((key) => {
        if (!savingRows.includes(key)) return true;
        return JSON.stringify(draftsRef.current[key]) !== JSON.stringify(savedDrafts[key]);
      });
      dirtyRowsRef.current = remainingDirtyRows;
      setDirtyRows(remainingDirtyRows);
    } catch (cause: any) {
      void appDialog.alert(cause.message || "Không thể lưu bảng lịch.", { title: "Không thể lưu bảng", tone: "danger" });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!dirtyRows.length || saving) return;
    const timer = window.setTimeout(() => void saveTable(), 30_000);
    const saveWhenLeaving = () => void saveTable();
    const saveWhenHidden = () => { if (document.visibilityState === "hidden") void saveTable(); };
    window.addEventListener("blur", saveWhenLeaving);
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("blur", saveWhenLeaving);
      document.removeEventListener("visibilitychange", saveWhenHidden);
    };
  }, [dirtyRows, drafts, saving]);

  return <><section className="overflow-hidden border border-slate-400 bg-white shadow-sm">
    <div className="overflow-x-auto"><table className="w-full min-w-[1400px] table-fixed border-collapse text-sm">
      <thead className="bg-[#e5f4e8] text-[#001e40]"><tr>
        <th className="w-24 border-b border-r border-slate-400 px-2 py-2 text-left">Thứ</th><th className="w-28 border-b border-r border-slate-400 px-2 py-2 text-left">Ngày</th><th className="w-16 border-b border-r border-slate-400 px-2 py-2 text-center">Tuần</th>
        {people && <th className="w-44 border-b border-r border-slate-400 px-2 py-2 text-left">Nhân sự</th>}
        <th className="border-b border-r border-slate-400 px-2 py-2 text-left">Nội dung công việc</th><th className="w-64 border-b border-r border-slate-400 px-2 py-2 text-left">Tự đánh giá / ghi chú</th>{!people && <th className="w-64 border-b border-r border-slate-400 px-2 py-2 text-left">Chấm công</th>}<th className="w-64 border-b border-slate-400 px-2 py-2 text-left">Lãnh đạo đánh giá</th>
      </tr></thead>
      <tbody>{gridRows.map((row) => {
        const workItems = rowsFor(row), draft = drafts[row.key] || { content: "", selfAssessment: "", leaderAssessment: "" };
        const canReviewDay = workItems.some((task) => task.canReview) && workItems.every((task) => task.status === "completed" || task.status === "reviewed");
        const compactSelfAssessment = isCompletionNote(draft.selfAssessment);
        const compactLeaderAssessment = isCompletionNote(draft.leaderAssessment);
        const editorClass = "block min-h-20 w-full resize-none overflow-hidden border-0 bg-transparent p-2 leading-5 outline-none hover:bg-blue-50/30 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500";
        return <tr key={row.key} className="align-top">
          <td className="border-b border-r border-slate-400 px-2 py-2 font-bold">{weekday(row.date)}</td><td className="border-b border-r border-slate-400 px-2 py-2">{fullDate(row.date)}</td><td className="border-b border-r border-slate-400 px-2 py-2 text-center font-semibold">{weekNumber(row.date)}</td>
          {people && <td className="border-b border-r border-slate-400 px-2 py-2"><b className="block">{row.person?.name}</b></td>}
          <td className="border-b border-r border-slate-400 p-0"><ImportantWorkContentEditor value={draft.content} tasks={workItems} onInput={(event) => resizeGridTextarea(event.currentTarget)} onChange={(event) => updateCell(row.key, { content: event.target.value })} onBlur={() => void saveTable()} className={editorClass} /></td>
          <td className="border-b border-r border-slate-400 p-0"><textarea ref={resizeGridTextarea} value={draft.selfAssessment} onInput={(event) => resizeGridTextarea(event.currentTarget)} onChange={(event) => updateCell(row.key, { selfAssessment: event.target.value })} onBlur={() => void saveTable()} placeholder="1. Ghi chú tiến trình hiện tại" className={`${editorClass} text-xs ${compactSelfAssessment ? "content-center text-center font-bold text-emerald-700" : ""}`} /></td>
          {!people && <td onDoubleClick={() => void openAttendanceEditor(row.date)} title="Bấm đúp để chỉnh sửa công ca" className="cursor-pointer border-b border-r border-slate-400 px-3 py-2 align-middle text-xs leading-6 text-slate-700 hover:bg-emerald-50/60">
            {(attendanceByDate[row.date] || []).some((shift) => !shift.isDayOff)
              ? (attendanceByDate[row.date] || []).filter((shift) => !shift.isDayOff).map((shift, index) => <div key={index} className="font-semibold">{`${shift.workMode === "online" ? "Online" : "Trực tiếp"}: ${shift.shiftStart} - ${shift.shiftEnd}`}</div>)
              : (attendanceByDate[row.date] || []).some((shift) => shift.isDayOff)
                ? null
              : <span className="text-slate-300">—</span>}
          </td>}
          <td className="border-b border-slate-400 p-0"><textarea ref={resizeGridTextarea} readOnly={!canReviewDay} value={draft.leaderAssessment} onInput={(event) => resizeGridTextarea(event.currentTarget)} onChange={(event) => updateCell(row.key, { leaderAssessment: event.target.value })} onBlur={() => void saveTable()} placeholder="Chưa đánh giá" className={`${editorClass} text-xs ${canReviewDay ? "" : "bg-slate-50/50 text-slate-600"} ${compactLeaderAssessment ? "content-center text-center font-bold text-violet-700" : ""}`} /></td>
        </tr>;
      })}</tbody>
    </table></div>
  </section>
    {attendanceEditor && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={event => { if (event.target === event.currentTarget) void saveAttendanceEditor(); }}>
      <div className="w-full max-w-2xl rounded-2xl border bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div><p className="text-xs font-bold uppercase text-emerald-600">Chỉnh sửa công ca</p><h3 className="mt-1 text-lg font-extrabold">Ngày {fullDate(attendanceEditor.date)}</h3></div>
          <button type="button" onClick={() => setAttendanceEditor(null)} aria-label="Đóng không lưu" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">
          {attendanceEditor.loading ? <p className="py-10 text-center text-sm text-slate-500">Đang tải công ca...</p> : <>
            <label className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
              <input type="checkbox" checked={attendanceEditor.isDayOff} onChange={event => setAttendanceEditor(current => current ? { ...current, isDayOff: event.target.checked, shifts: event.target.checked ? [] : (current.shifts.length ? current.shifts : [{ start: "08:00", end: "12:00", workMode: "direct" }]) } : current)} className="h-4 w-4" />
              Tích vào đây nếu là ngày nghỉ
            </label>
            {!attendanceEditor.isDayOff && <div className="mt-4 space-y-3">{attendanceEditor.shifts.map((shift, index) => <div key={index} className="grid gap-3 rounded-xl border bg-slate-50 p-4 sm:grid-cols-[1fr_1fr_1.2fr_auto]">
              <label><span className="mb-1 block text-xs font-bold text-slate-500">Bắt đầu (24h)</span><Time24Input label={`Bắt đầu ca ${index + 1}`} value={shift.start} onChange={value => updateAttendanceShift(index, { start: value })} /></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-500">Kết thúc (24h)</span><Time24Input label={`Kết thúc ca ${index + 1}`} value={shift.end} onChange={value => updateAttendanceShift(index, { end: value })} /></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-500">Hình thức</span><select value={shift.workMode} onChange={event => updateAttendanceShift(index, { workMode: event.target.value as "direct" | "online" })} className="ft-input"><option value="direct">Trực tiếp</option><option value="online">Online</option></select></label>
              <button type="button" onClick={() => setAttendanceEditor(current => current ? { ...current, shifts: current.shifts.filter((_, shiftIndex) => shiftIndex !== index) } : current)} title="Xóa ca" className="self-end rounded-lg p-2 text-rose-500 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
            </div>)}
              <button type="button" onClick={() => setAttendanceEditor(current => current ? { ...current, shifts: [...current.shifts, { start: "13:30", end: "17:30", workMode: "direct" }] } : current)} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed py-2.5 text-sm font-bold text-slate-500 hover:border-emerald-400 hover:text-emerald-700"><Plus className="h-4 w-4" />Thêm ca</button>
            </div>}
            {attendanceEditor.error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{attendanceEditor.error}</p>}
          </>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-5 py-4"><button type="button" onClick={() => setAttendanceEditor(null)} className="ft-btn ft-btn-secondary">Hủy</button><button type="button" disabled={attendanceEditor.loading || attendanceEditor.saving} onClick={() => void saveAttendanceEditor()} className="ft-btn ft-btn-primary">{attendanceEditor.saving ? "Đang lưu..." : "Lưu"}</button></div>
      </div>
    </div>}
  </>;
}

function SheetView({ idToken, sheetUrl, setSheetUrl, notice, setNotice, onSync }: any) {
  const [syncing, setSyncing] = useState(false);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const runSync = async () => {
    setSyncing(true);
    setNotice("");
    try {
      await onSync();
    } catch (cause: any) {
      setNotice(cause.message || "Không thể đồng bộ Google Sheets.");
    } finally {
      setSyncing(false);
    }
  };
  return (
    <section className="mx-auto max-w-4xl">
      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="bg-gradient-to-br from-[#0055da] to-[#003a98] p-8 text-white">
          <FileSpreadsheet className="h-8 w-8" />
          <h2 className="mt-5 text-2xl font-extrabold">Lịch công tác FT</h2>
          <p className="mt-2 text-sm text-blue-100">Bảng công tác dùng chung làm nguồn đối chiếu lịch và chuẩn bị đồng bộ trạng thái hoàn thành.</p>
          {sheetUrl && <button type="button" onClick={() => window.open(sheetUrl, "_blank", "noopener,noreferrer")} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-extrabold text-blue-700">
            <ExternalLink className="h-4 w-4" />
            Mở Lịch công tác FT
          </button>}
        </div>
        <div className="space-y-5 p-8">
          <label className="block max-w-xs"><span className="mb-1 block text-sm font-bold">Tháng áp dụng</span><input type="month" value={month} onChange={event => setMonth(event.target.value)} className="ws-input" /></label>
          <MonthlySheetLinkEditor idToken={idToken} month={month} module="work_schedule" title="Trang tính Lịch làm việc" description="Cấu hình dùng chung theo tháng; chỉ Admin nhìn thấy và chỉnh sửa." accent="blue" onLinkChange={setSheetUrl} />
          {notice && <p className={`mt-3 text-sm font-semibold ${notice.startsWith("Không") ? "text-rose-700" : "text-emerald-700"}`}>{notice}</p>}
          <div className="mt-5 flex gap-3">
            <button title={month !== currentMonth ? "Chỉ đồng bộ tự động trang tính của tháng hiện tại." : ""} disabled={syncing || !sheetUrl || month !== currentMonth} onClick={() => void runSync()} className="inline-flex items-center gap-2 rounded-xl bg-[#0055da] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Đang đồng bộ..." : "Đồng bộ hai chiều"}
            </button>
            <button disabled={!sheetUrl} onClick={() => window.open(sheetUrl, "_blank", "noopener,noreferrer")} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold disabled:opacity-50">
              <ExternalLink className="h-4 w-4" />
              Mở bảng tính
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function BulkPeopleDialog({ mode, staff, onClose, onApply }: { mode: "supporters" | "managers"; staff: Person[]; onClose: () => void; onApply: (emails: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const label = mode === "supporters" ? "người hỗ trợ/theo dõi" : "người quản lý";
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Cập nhật hàng loạt</p>
            <h2 className="mt-1 text-xl font-extrabold text-[#001e40]">Thêm {label}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100" aria-label="Đóng">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-5">
          <PeoplePicker label={`Chọn ${label}`} staff={staff} selected={selected} onChange={setSelected} />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border px-4 py-2.5 text-sm font-bold text-slate-600">Hủy</button>
          <button type="button" disabled={!selected.length} onClick={() => onApply(selected)} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">Thêm vào công việc đã chọn</button>
        </div>
      </div>
    </div>
  );
}

function TaskDialog({ draft, setDraft, staff, userEmail, saveTask, saving, saveProgressNote, deleteTasks, review }: any) {
  const lockedPeople = !draft.canEdit || (!!draft.id && draft.canReview);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setDraft(null);
      }}
    >
      <form onSubmit={saveTask} className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600">{draft.canReview ? "Review kết quả công việc" : "Chi tiết lịch làm việc"}</p>
            <h2 className="mt-1 text-xl font-extrabold text-[#001e40]">{draft.id ? draft.title : draft.assignmentMode ? "Giao việc cho nhân viên" : "Thêm công việc mới"}</h2>
          </div>
          <div className="flex items-center gap-1">
            {draft.id && draft.canDelete && (
              <button type="button" onClick={() => void deleteTasks([draft.id])} className="rounded-xl p-2 text-rose-500 hover:bg-rose-50" aria-label="Xóa lịch">
                <Trash2 className="h-5 w-5" />
              </button>
            )}
            <button type="button" onClick={() => setDraft(null)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="space-y-5 p-6">
          <label className="block">
            <span className="ws-label">Tên công việc *</span>
            <input required disabled={!draft.canEdit} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="ws-input disabled:bg-slate-50" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label>
              <span className="ws-label">Ngày thực hiện *</span>
              <input disabled={!draft.canEdit} type="date" required value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className="ws-input disabled:bg-slate-50" />
            </label>
            <label>
              <span className="ws-label">Bắt đầu (không bắt buộc)</span>
              <Time24Input disabled={!draft.canEdit} label="Bắt đầu" value={draft.startTime} onChange={(value) => setDraft({ ...draft, startTime: value })} />
            </label>
            <label>
              <span className="ws-label">Kết thúc (không bắt buộc)</span>
              <Time24Input disabled={!draft.canEdit} label="Kết thúc" value={draft.endTime} onChange={(value) => setDraft({ ...draft, endTime: value })} />
            </label>
            <label>
              <span className="ws-label">Trạng thái</span>
              <select disabled={!draft.canEdit || draft.canReview} value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })} className="ws-input disabled:bg-slate-50">
                <option value="todo">Cần làm</option>
                <option value="doing">Đang thực hiện</option>
                <option value="completed">Đã hoàn thành</option>
              </select>
            </label>
            <label>
              <span className="ws-label">Mức ưu tiên</span>
              <select disabled={!draft.canEdit} value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })} className="ws-input disabled:bg-slate-50">
                {Object.entries(priorities).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="space-y-4">
            {draft.assignmentMode
              ? <PeoplePicker label="Nhân viên nhận việc * (chọn một hoặc nhiều)" staff={staff.filter((item: Person) => item.email !== userEmail)} selected={draft.executorEmails || []} onChange={(emails) => setDraft({ ...draft, executorEmails: emails, executorEmail: emails[0] || "" })} disabled={lockedPeople} />
              : <PeoplePicker label="Người thực hiện * (chọn 1)" staff={staff} selected={[draft.executorEmail]} onChange={(emails) => setDraft({ ...draft, executorEmail: emails[0] || userEmail })} multiple={false} disabled={lockedPeople} />}
            <PeoplePicker label="Người hỗ trợ/theo dõi (chọn nhiều)" staff={staff.filter((item) => item.email !== draft.executorEmail)} selected={draft.supporterEmails} onChange={(emails) => setDraft({ ...draft, supporterEmails: emails })} disabled={lockedPeople} />
            <PeoplePicker label={draft.assignmentMode ? "Người giao việc / quản lý (có thể thay đổi)" : "Người quản lý (chọn nhiều)"} staff={staff.filter((item) => !(draft.assignmentMode ? draft.executorEmails || [] : [draft.executorEmail]).includes(item.email))} selected={draft.managerEmails} onChange={(emails) => setDraft({ ...draft, managerEmails: emails })} disabled={lockedPeople} />
          </div>
          <label className="block rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
            <span className="ws-label text-amber-900">Ghi chú tiến trình</span>
            <textarea rows={3} value={draft.progressNote} onChange={(event) => setDraft({ ...draft, progressNote: event.target.value })} placeholder="Nhập tình hình xử lý, nội dung đang chờ hoặc kết quả từng phần..." className="ws-input resize-y bg-white" />
            {draft.id && (
              <span className="mt-3 flex justify-end">
                <button type="button" onClick={() => void saveProgressNote(draft)} className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-amber-700">
                  Lưu ghi chú tiến trình
                </button>
              </span>
            )}
          </label>
          <label className="block">
            <span className="ws-label">Mô tả</span>
            <textarea disabled={!draft.canEdit} rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="ws-input resize-y disabled:bg-slate-50" />
          </label>
          {draft.canReview && (
            <section className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
              <h3 className="font-extrabold text-violet-900">Đánh giá của người quản lý</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr]">
                <label>
                  <span className="ws-label">Mức hoàn thành (%) *</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    placeholder="100"
                    value={draft.reviewPercent ?? ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        reviewPercent: event.target.value === "" ? null : Number(event.target.value),
                      })
                    }
                    className="ws-input"
                  />
                </label>
                <label>
                  <span className="ws-label">Nhận xét / nội dung cần bổ sung</span>
                  <textarea rows={2} value={draft.reviewNote} onChange={(event) => setDraft({ ...draft, reviewNote: event.target.value })} className="ws-input resize-none" />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => void review("request_revision")} className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white">
                  Yêu cầu làm lại, bổ sung
                </button>
                <button type="button" onClick={() => void review("confirm")} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white">
                  Xác nhận hoàn thành
                </button>
              </div>
            </section>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t px-6 py-4">
          <button type="button" onClick={() => setDraft(null)} className="rounded-xl border px-4 py-2.5 text-sm font-bold text-slate-600">
            Đóng
          </button>
          {draft.canEdit && !draft.canReview && (
            <button type="submit" disabled={saving} className="rounded-xl bg-[#0055da] px-5 py-2.5 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60">
              {saving ? "Đang lưu..." : draft.id ? "Lưu thay đổi" : draft.assignmentMode ? "Giao việc" : "Thêm công việc"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
