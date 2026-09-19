import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeDollarSign,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FolderTree,
  GraduationCap,
  Handshake,
  LayoutDashboard,
  PackageSearch,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import LogNotes, {
  appendLogNote,
  formatChangeLog,
} from "../examination/LogNotes";
import AccountMenu from "../AccountMenu";
import ConfirmModal from "../ConfirmModal";
import { appDialog } from "../AppDialog";
import SearchableSelect from "../SearchableSelect";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import FinanceReport from "./FinanceReport";
import ProductManagement, { type ProductView, type ProductSubscription } from "./ProductManagement";
import TrainingOverview from "./TrainingOverview";
import Time24Input from "../Time24Input";
import ModuleTopNav from "../layout/ModuleTopNav";
import { DIGITAL_TRAINING_NAV } from "../../config/workspaceNavigation";

const BndcWorkspace = React.lazy(() => import("./bndc/BndcWorkspace"));

type Tab =
  | "overview"
  | "calendar"
  | "bndc"
  | "sessions"
  | "partner-sessions"
  | "partners"
  | "leads"
  | "products"
  | "finance"
  | "survey"
  | "materials";
type Mode = "week" | "month";
type Modal =
  | "schedule-kind"
  | "session"
  | "meeting"
  | "other"
  | "partner"
  | "quick-partner"
  | "lead"
  | "class"
  | "material"
  | "survey"
  | "renewal"
  | null;
type AdditionalContact = {
  contact_person: string;
  position: string;
  phone: string;
  email: string;
};
type TrainingScheduleDraft = {
  date: string;
  start_time: string;
  location: string;
  unscheduled: boolean;
};
type PartnerClassDraft = {
  id?: number;
  name: string;
  members: string;
  planned_sessions: string;
  training_contents: string[];
  training_schedule: TrainingScheduleDraft[];
  planned_sessions_custom?: boolean;
  training_contents_custom?: boolean;
};
type PartnerDraft = {
  name: string;
  partner_type: string;
  partner_subtype: string;
  province: string;
  ward: string;
  contact_person: string;
  contact_position: string;
  phone: string;
  email: string;
  additional_contacts: AdditionalContact[];
  products: string[];
  contract_duration: string;
  contract_duration_unit: string;
  contract_signed_date: string;
  contract_status: string;
  budget: string;
  ai_account_count: string;
  training_location: string;
  class_count: string;
  shared_sessions: string;
  shared_training_schedule: TrainingScheduleDraft[];
  class_plans: PartnerClassDraft[];
  notes: string;
};
type Partner = {
  id: number;
  name: string;
  address: string;
  contact_person: string;
  phone: string;
  email: string;
  additional_contacts?: AdditionalContact[];
  contract_start: string;
  contract_end: string;
  training_content: string;
  planned_sessions: number;
  completed_sessions: number;
  notes: string;
  partner_type?: string;
  partner_subtype?: string;
  province?: string;
  ward?: string;
  contact_position?: string;
  products?: string[];
  contract_duration?: number | null;
  contract_duration_unit?: string;
  contract_signed_date?: string | null;
  contract_status?: string;
  ai_account_count?: number;
  training_contents?: string[];
  training_schedule?: TrainingScheduleDraft[];
  training_location?: string;
  training_staff?: string;
  budget?: number | null;
  created_at?: string;
};
type Session = {
  id: number;
  title: string;
  session_number?: number | null;
  date: string | null;
  start_time?: string | null;
  end_time?: string | null;
  partner: string;
  partner_id?: number | null;
  partner_name?: string;
  class_group_id?: number | null;
  class_group_name?: string;
  category: string;
  contents?: string[];
  attendees: number;
  location: string;
  staff_name?: string;
  instructor_name?: string;
  support_staff_name?: string;
  status: "unscheduled" | "planned" | "completed" | "cancelled";
  notes: string;
  has_materials: boolean;
};
type Lead = {
  id: number;
  name: string;
  lead_type: string;
  address: string;
  representative: string;
  representative_position: string;
  phone: string;
  email: string;
  interested_products?: string[];
  stage: "discussion" | "meeting" | "proposal" | "negotiation" | "on_hold" | "lost" | "converted";
  notes: string;
  converted_partner?: number | null;
  converted_partner_name?: string;
  meeting_count: number;
  next_meeting_at?: { id: number; date: string; start_time?: string | null; title: string } | null;
};type CustomerMeeting = {
  id: number;
  title: string;
  schedule_type?: "meeting" | "other";
  activity_type?: string;
  customer_type: string;
  representative: string;
  phone: string;
  email: string;
  lead?: number | null;
  lead_name?: string;
  partner?: number | null;
  partner_name?: string;
  opportunity?: number | null;
  product_name?: string;
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  location: string;
  content: string;
  status: "unscheduled" | "planned" | "completed" | "cancelled";
  staff_name?: string;
  notes: string;
};
type EmployeeOption = { name: string; email: string };
type ProductOption = { id: number; name: string; active: boolean };
type ProductOpportunity = { id: number; partner: number; partner_name: string; product: number; product_name: string; status: "negotiating" | "on_hold" | "won" | "lost"; notes: string; meeting_count: number };
type CalendarItem = {
  id: string | number;
  title: string;
  date: string | null;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  staff_name?: string | null;
  content?: string | null;
  status: "unscheduled" | "planned" | "completed" | "cancelled";
  kind?: "training" | "meeting" | "other";
};
type CalendarLayoutItem = {
  item: CalendarItem;
  start: number;
  end: number;
  column: number;
  columnCount: number;
};

const calendarMinute = (value?: string | null) => {
  const match = (value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return Number.NaN;
  const hour = Number(match[1]),
    minute = Number(match[2]);
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60
    ? hour * 60 + minute
    : Number.NaN;
};
const calendarInterval = (item: CalendarItem) => {
  const start = calendarMinute(item.start_time);
  if (!Number.isFinite(start)) return null;
  const parsedEnd = calendarMinute(item.end_time);
  const fallback = item.kind === "meeting" || item.kind === "other" ? 60 : 180;
  return {
    item,
    start,
    end:
      Number.isFinite(parsedEnd) && parsedEnd > start
        ? parsedEnd
        : start + fallback,
  };
};
export const layoutCalendarEvents = (
  items: CalendarItem[],
): CalendarLayoutItem[] => {
  const intervals = items
    .map(calendarInterval)
    .filter(
      (item): item is NonNullable<ReturnType<typeof calendarInterval>> =>
        !!item,
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const result: CalendarLayoutItem[] = [];
  let cluster: typeof intervals = [],
    clusterEnd = -1;
  const flush = () => {
    if (!cluster.length) return;
    const columnEnds: number[] = [];
    const placed = cluster.map((entry) => {
      let column = columnEnds.findIndex((end) => end <= entry.start);
      if (column < 0) column = columnEnds.length;
      columnEnds[column] = entry.end;
      return { ...entry, column };
    });
    result.push(
      ...placed.map((entry) => ({ ...entry, columnCount: columnEnds.length })),
    );
    cluster = [];
    clusterEnd = -1;
  };
  intervals.forEach((entry) => {
    if (cluster.length && entry.start >= clusterEnd) flush();
    cluster.push(entry);
    clusterEnd = Math.max(clusterEnd, entry.end);
  });
  flush();
  return result;
};
type CalendarDetail = {
  kind: "training" | "meeting" | "other";
  sourceId: number;
};
type WorkActivity = {
  key: string;
  sourceId: number;
  kind: "training" | "meeting" | "other";
  title: string;
  date: string | null;
  start_time?: string | null;
  end_time?: string | null;
  customerId?: number | null;
  customerName: string;
  className: string;
  activityLabel: string;
  content: string;
  location: string;
  status: "unscheduled" | "planned" | "completed" | "cancelled";
  staffName: string;
  attendees?: number;
  instructorName?: string;
  supportStaffName?: string;
};
type TrainingClass = {
  id: number;
  partner: number;
  partner_name?: string;
  name: string;
  members: string;
  planned_sessions: number;
  training_contents?: string[];
  completed_sessions: number;
  notes: string;
};
type Material = {
  id: number;
  title: string;
  file_url: string;
  external_url: string;
  file_name: string;
  file_type: string;
  session?: number | null;
  session_name?: string;
  partner?: number | null;
  partner_name?: string;
  notes: string;
};
type Survey = {
  id: number;
  title: string;
  form_type: "end_session" | "end_course";
  session?: number | null;
  session_name?: string;
  partner?: number | null;
  partner_name?: string;
  notes: string;
};
const newTrainingSchedule = (): TrainingScheduleDraft => ({
  date: "",
  start_time: "",
  location: "",
  unscheduled: false,
});
const newClassDraft = (index: number): PartnerClassDraft => ({
  name: "",
  members: "",
  planned_sessions: "0",
  training_contents: [],
  training_schedule: [],
});
const newPartnerDraft = (): PartnerDraft => ({
  name: "",
  partner_type: "",
  partner_subtype: "",
  province: "",
  ward: "",
  contact_person: "",
  contact_position: "",
  phone: "",
  email: "",
  additional_contacts: [],
  products: [],
  contract_duration: "",
  contract_duration_unit: "month",
  contract_signed_date: "",
  contract_status: "not_signed",
  budget: "",
  ai_account_count: "",
  training_location: "",
  class_count: "1",
  shared_sessions: "0",
  shared_training_schedule: [],
  class_plans: [newClassDraft(1)],
  notes: "",
});
const partnerSubtypeCatalog: Record<string, string[]> = {
  "Khối Giáo dục": ["Mầm non", "Tiểu học", "THCS", "THPT"],
  "Khối Hành chính công": ["Khối Xã/Phường", "Cơ quan nhà nước khác"],
};
const categories = [
  "Triển khai BNDC",
  "Ứng dụng AI trong quản lý hành chính",
  "Ứng dụng AI trong giảng dạy",
  "Đào tạo lớp học số",
];
const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Tổng quan", icon: LayoutDashboard },
  { id: "calendar", label: "Lịch", icon: CalendarDays },
  { id: "sessions", label: "Báo cáo lịch công tác", icon: ClipboardList },
  { id: "partners", label: "Danh sách khách hàng", icon: Handshake },
  { id: "partner-sessions", label: "Theo dõi tập huấn", icon: ClipboardList },
  { id: "products", label: "Sản phẩm & dịch vụ", icon: PackageSearch },
  { id: "finance", label: "Báo cáo thu chi", icon: BadgeDollarSign },
  { id: "survey", label: "Khảo sát", icon: Users },
  { id: "materials", label: "Tài liệu", icon: BookOpen },
  { id: "bndc", label: "Quản lý BNDC", icon: FolderTree },
];
const localDateKey = (value: Date) =>
  String(value.getFullYear()) +
  "-" +
  String(value.getMonth() + 1).padStart(2, "0") +
  "-" +
  String(value.getDate()).padStart(2, "0");
const today = () => localDateKey(new Date());
const showDate = (v?: string | null) =>
  v ? new Date(`${v}T00:00:00`).toLocaleDateString("vi-VN") : "—";
const relativeMonthLabel = (offset = 0) => {
  const value = new Date();
  value.setDate(1);
  value.setMonth(value.getMonth() + offset);
  return `Tháng ${value.getMonth() + 1} - ${value.getFullYear()}`;
};
const showTime = (s: {
  start_time?: string | null;
  end_time?: string | null;
}) =>
  [s.start_time?.slice(0, 5), s.end_time?.slice(0, 5)]
    .filter(Boolean)
    .join(" – ") || "Chưa đặt giờ";
const threeHoursAfter = (value?: string | null) => {
  const [hour, minute] = (value || "").slice(0, 5).split(":");
  if (!/^\d{2}$/.test(hour) || !/^\d{2}$/.test(minute)) return "";
  const total = (Number(hour) + 3) * 60 + Number(minute);
  return `${String(Math.floor((total % 1440) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const status: { [key: string]: string } = {
  unscheduled: "Chưa có lịch",
  planned: "Đã lên lịch",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
};
const scheduleStatusClass: Record<string, string> = {
  unscheduled: "border-amber-200 bg-amber-50 text-amber-700",
  planned: "border-blue-200 bg-blue-50 text-blue-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-slate-200 bg-slate-100 text-slate-600",
};
const contractStatusClass: Record<string, string> = {
  not_signed: "border-amber-200 bg-amber-50 text-amber-700",
  negotiating: "border-blue-200 bg-blue-50 text-blue-700",
  signed: "border-cyan-200 bg-cyan-50 text-cyan-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  expiring: "border-orange-200 bg-orange-50 text-orange-700",
  expired: "border-rose-200 bg-rose-50 text-rose-700",
};
function currentRoute() {
  const p = location.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const tab = (tabs.some((x) => x.id === p[1]) ? p[1] : "overview") as Tab;
  const kind = p[2] as CalendarDetail["kind"];
  const sourceId = Number(p[3]);
  const productView = (["catalog", "allocation", "statistics"].includes(p[2])
    ? p[2]
    : "catalog") as ProductView;
  const calendarDetail =
    tab === "calendar" &&
    ["training", "meeting", "other"].includes(kind) &&
    Number.isFinite(sourceId)
      ? { kind, sourceId }
      : null;
  return {
    tab,
    partnerId:
      (tab === "partners" || tab === "partner-sessions") && p[2]
        ? Number(p[2])
        : null,
    surveyId: tab === "survey" && p[2] ? Number(p[2]) : null,
    productView,
    calendarDetail,
  };
}
const pathFor = (tab: Tab, id?: number | null) =>
  tab === "overview"
    ? "/digital-training"
    : tab === "products"
      ? "/digital-training/products/catalog"
      : (tab === "partners" || tab === "partner-sessions" || tab === "survey") &&
          id
        ? `/digital-training/${tab}/${id}`
        : `/digital-training/${tab}`;
const productPath = (view: ProductView) => `/digital-training/products/${view}`;
const calendarDetailPath = (detail: CalendarDetail) =>
  `/digital-training/calendar/${detail.kind}/${detail.sourceId}`;
const menuOpenState = (tab: Tab, productView: ProductView) => ({
  schedule: tab === "calendar" || tab === "sessions",
  customer:
    tab === "partners" ||
    tab === "leads" ||
    tab === "partner-sessions" ||
    (tab === "products" && productView === "allocation"),
  products: tab === "products" && productView !== "allocation",
  survey: tab === "survey",
});
function Dialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="ft-dialog-backdrop fixed inset-0 z-50 grid place-items-center p-4">
      <div
        className={`ft-dialog-panel max-h-[calc(100vh-2rem)] w-full overflow-y-auto bg-white p-6 ${wide ? "max-w-[88rem]" : "max-w-2xl"}`}
      >
        <div className="mb-5 flex justify-between gap-3">
          <h2 className="text-xl font-extrabold">{title}</h2>
          <button onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Input({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label>
      <span className="mb-1 block text-sm font-bold">{label}</span>
      <input
        {...props}
        className="w-full rounded-lg border border-slate-300 px-3 py-2"
      />
    </label>
  );
}
function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-slate-200 pt-5">
      <h3 className="mb-4 text-sm font-extrabold uppercase tracking-wide text-sky-800">
        {title}
      </h3>
      {children}
    </section>
  );
}
function CreateScheduleMenu({
  onTraining,
  onNewMeeting,
  onExistingMeeting,
  onOther,
}: {
  onTraining: () => void;
  onNewMeeting: () => void;
  onExistingMeeting: () => void;
  onOther: () => void;
}) {
  const [open, setOpen] = useState(false);
  const select = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="ft-primary"
      >
        <Plus className="h-4 w-4" />
        Tạo lịch mới
        <ChevronDown className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          <button
            type="button"
            onClick={() => select(onTraining)}
            className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-bold hover:bg-sky-50"
          >
            Tạo lịch tập huấn
          </button>
          <button
            type="button"
            onClick={() => select(onNewMeeting)}
            className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-bold hover:bg-sky-50"
          >
            Gặp Khách hàng mới
          </button>
          <button
            type="button"
            onClick={() => select(onExistingMeeting)}
            className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-bold hover:bg-sky-50"
          >
            Gặp Khách hàng hiện tại
          </button>
          <button
            type="button"
            onClick={() => select(onOther)}
            className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-bold hover:bg-sky-50"
          >
            Khác
          </button>
        </div>
      )}
    </div>
  );
}
function TimePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="mb-1 block text-sm font-bold">{label}</span>
      <Time24Input label={label} value={value} onChange={onChange} />
      <small className="mt-1 block text-xs text-slate-500">
        Có thể nhập trực tiếp hoặc mở danh sách giờ và phút.
      </small>
    </label>
  );
}
function CompactTimePicker({
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <Time24Input
      label={ariaLabel}
      value={value}
      onChange={onChange}
      disabled={disabled}
      className="rounded-lg py-0"
    />
  );
}
function ContentsPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [custom, setCustom] = useState("");
  const choices = [
      ...categories,
      ...value.filter((x) => !categories.includes(x)),
    ],
    toggle = (item: string) =>
      onChange(
        value.includes(item)
          ? value.filter((x) => x !== item)
          : [...value, item],
      ),
    add = () => {
      const next = custom.trim();
      if (next && !value.includes(next)) onChange([...value, next]);
      setCustom("");
    };
  return (
    <div>
      <span className="mb-1 block text-sm font-bold">Nội dung tập huấn</span>
      <p className="mb-2 text-xs text-slate-500">
        Có thể chọn nhiều nội dung hoặc tự thêm nội dung mới.
      </p>
      <div className="flex flex-wrap gap-2">
        {choices.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => toggle(item)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${value.includes(item) ? "border-sky-600 bg-sky-600 text-white" : "border-sky-200 text-sky-800"}`}
          >
            {value.includes(item) ? "✓ " : ""}
            {item}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Nhập nội dung mới"
          className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={add}
          className="rounded-lg border border-sky-300 px-3 text-sm font-bold text-sky-700"
        >
          Thêm
        </button>
      </div>
    </div>
  );
}

const vietnamProvinces = [
  "Hà Nội",
  "Cao Bằng",
  "Tuyên Quang",
  "Điện Biên",
  "Lai Châu",
  "Sơn La",
  "Lào Cai",
  "Thái Nguyên",
  "Lạng Sơn",
  "Quảng Ninh",
  "Bắc Ninh",
  "Phú Thọ",
  "Hải Phòng",
  "Hưng Yên",
  "Ninh Bình",
  "Thanh Hóa",
  "Nghệ An",
  "Hà Tĩnh",
  "Quảng Trị",
  "Huế",
  "Đà Nẵng",
  "Quảng Ngãi",
  "Gia Lai",
  "Khánh Hòa",
  "Đắk Lắk",
  "Lâm Đồng",
  "Đồng Nai",
  "Thành phố Hồ Chí Minh",
  "Tây Ninh",
  "Đồng Tháp",
  "Vĩnh Long",
  "An Giang",
  "Cần Thơ",
  "Cà Mau",
];
const provinceOptions = vietnamProvinces.map((value) => ({
  value,
  label: value,
}));
function ProductSelect({
  label,
  value,
  onChange,
  options = [],
  allowCustom = false,
  disabled = false,
  placeholder = "Chọn sản phẩm",
  searchPlaceholder = "Tìm hoặc nhập sản phẩm...",
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  options?: string[];
  allowCustom?: boolean;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const rootRef = useRef<HTMLLabelElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const normalized = query.trim().toLocaleLowerCase("vi-VN");
  const visible = options.filter((item) =>
    item.toLocaleLowerCase("vi-VN").includes(normalized),
  );
  const toggle = (item: string) =>
    onChange(
      value.includes(item) ? value.filter((x) => x !== item) : [...value, item],
    );
  return (
    <label ref={rootRef} className="relative block">
      <span className="mb-1 block text-sm font-bold">{label}</span>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        onClick={() => !disabled && setOpen(!open)}
        className={`flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm ${disabled ? "cursor-not-allowed bg-slate-100 text-slate-600" : ""}`}
      >
        {value.length ? (
          value.map((item) => (
            <span
              key={item}
              className="relative inline-flex items-center rounded bg-sky-100 py-1 pl-2 pr-6 text-sky-900"
            >
              {item}
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(value.filter((x) => x !== item));
                  }}
                  className="absolute right-0.5 top-0.5 grid h-3.5 w-3.5 place-items-center rounded-sm text-[11px] font-extrabold leading-none transition-colors hover:bg-sky-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-700"
                  aria-label={`Bỏ ${item}`}
                >
                  ×
                </button>
              )}
            </span>
          ))
        ) : (
          <span className="text-slate-400">{placeholder}</span>
        )}
      </div>
      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border bg-white p-2 shadow-xl">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="mb-2 w-full rounded-lg border px-3 py-2 text-sm"
          />
          <div className="max-h-60 overflow-y-auto">
            {visible.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => toggle(item)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-sky-50"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${value.includes(item) ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300"}`}
                >
                  {value.includes(item) && (
                    <Check className="h-3 w-3 stroke-[3]" />
                  )}
                </span>
                {item}
              </button>
            ))}
          </div>
          {allowCustom &&
            query.trim() &&
            !options.some(
              (item) => item.toLocaleLowerCase("vi-VN") === normalized,
            ) && (
              <button
                type="button"
                onClick={() => {
                  toggle(query.trim());
                  setQuery("");
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-sky-700 hover:bg-sky-50"
              >
                + Thêm “{query.trim()}”
              </button>
            )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-2 w-full rounded-lg border px-3 py-1.5 text-xs font-bold"
          >
            Xong
          </button>
        </div>
      )}
    </label>
  );
}
export function Calendar({
  mode,
  onModeChange,
  sessions,
  onPick,
  onOpen,
  onMove,
  actions,
}: {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  sessions: CalendarItem[];
  onPick: (date: string, start?: string, end?: string) => void;
  onOpen: (item: CalendarItem) => void;
  onMove: (item: CalendarItem, date: string, start?: string) => void;
  actions?: React.ReactNode;
}) {
  const [cursor, setCursor] = useState(() => new Date());
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [appliedRange, setAppliedRange] = useState<{
    start: string;
    end: string;
    days: number;
  } | null>(null);
  const [rangeError, setRangeError] = useState("");
  const [drag, setDrag] = useState<{ date: string; minute: number } | null>(
    null,
  );
  const [hover, setHover] = useState<{ date: string; minute: number } | null>(
    null,
  );
  const [moving, setMoving] = useState<CalendarItem | null>(null);
  const draggedRef = useRef(false);
  const movingRef = useRef<CalendarItem | null>(null);
  const iso = (value: Date) => localDateKey(value);
  const fromIso = (value: string) => new Date(`${value}T00:00:00`);
  const addDays = (value: Date, days: number) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate() + days);
  const addMonths = (value: Date, months: number) => {
    const target = new Date(value.getFullYear(), value.getMonth() + months, 1);
    const lastDay = new Date(
      target.getFullYear(),
      target.getMonth() + 1,
      0,
    ).getDate();
    target.setDate(Math.min(value.getDate(), lastDay));
    return target;
  };
  const weekStart = (value: Date) =>
    addDays(value, -((value.getDay() + 6) % 7));
  const toTime = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const rangeLength = (start: string, end: string) => {
    const a = fromIso(start),
      b = fromIso(end);
    return (
      Math.round(
        (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
          Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
          86400000,
      ) + 1
    );
  };
  const enumerateDays = (start: string, end: string) => {
    const rows: Date[] = [];
    for (
      let value = fromIso(start);
      iso(value) <= end;
      value = addDays(value, 1)
    )
      rows.push(value);
    return rows;
  };
  const first = weekStart(cursor);
  const weekDays = Array.from({ length: 7 }, (_, index) =>
    addDays(first, index),
  );
  const timelineDays =
    appliedRange && appliedRange.days <= 7
      ? enumerateDays(appliedRange.start, appliedRange.end)
      : weekDays;
  const inRange = (date: string) =>
    !appliedRange || (date >= appliedRange.start && date <= appliedRange.end);
  const visibleSessions = sessions.filter((item) => inRange(item.date || ""));
  const events = (date: string) =>
    visibleSessions.filter((item) => item.date === date);
  const clearRange = () => {
    setRangeStart("");
    setRangeEnd("");
    setAppliedRange(null);
    setRangeError("");
  };
  const shift = (step: number) => {
    clearRange();
    setCursor((value) =>
      mode === "week"
        ? addDays(value, step * 7)
        : new Date(value.getFullYear(), value.getMonth() + step, 1),
    );
  };
  const selectToday = () => {
    const value = today();
    setCursor(fromIso(value));
    setRangeStart(value);
    setRangeEnd(value);
    setAppliedRange({ start: value, end: value, days: 1 });
    setRangeError("");
    onModeChange("week");
  };
  const applyRange = () => {
    if (!rangeStart || !rangeEnd) {
      setRangeError("Vui lòng chọn đầy đủ ngày bắt đầu và ngày kết thúc.");
      return;
    }
    if (rangeEnd < rangeStart) {
      setRangeError("Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.");
      return;
    }
    const maxEnd = iso(addMonths(fromIso(rangeStart), 3));
    if (rangeEnd > maxEnd) {
      setRangeError(
        `Khoảng thời gian tối đa là 3 tháng, đến ${fromIso(maxEnd).toLocaleDateString("vi-VN")}.`,
      );
      return;
    }
    const days = rangeLength(rangeStart, rangeEnd);
    setAppliedRange({ start: rangeStart, end: rangeEnd, days });
    setCursor(fromIso(rangeStart));
    setRangeError("");
    onModeChange(days <= 7 ? "week" : "month");
  };
  useEffect(() => {
    if (!appliedRange) return;
    const expected = appliedRange.days <= 7 ? "week" : "month";
    if (mode !== expected) clearRange();
  }, [mode]);
  const beginMove = (event: React.DragEvent, item: CalendarItem) => {
    if (item.status === "cancelled") {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    draggedRef.current = true;
    movingRef.current = item;
    setMoving(item);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(item.id));
  };
  const cancelMove = () => {
    movingRef.current = null;
    setMoving(null);
    window.setTimeout(() => {
      draggedRef.current = false;
    }, 0);
  };
  const dropMove = (event: React.DragEvent, date: string, minute?: number) => {
    event.preventDefault();
    event.stopPropagation();
    const item = movingRef.current;
    if (!item) return false;
    movingRef.current = null;
    setMoving(null);
    const targetStart =
      minute === undefined
        ? (item.start_time || "").slice(0, 5)
        : toTime(minute);
    if (
      item.date === date &&
      (!targetStart || targetStart === (item.start_time || "").slice(0, 5))
    )
      return true;
    onMove(item, date, targetStart);
    return true;
  };
  const openItem = (event: React.MouseEvent, item: CalendarItem) => {
    event.stopPropagation();
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    onOpen(item);
  };
  const renderEvent = (
    item: CalendarItem,
    variant: "week" | "month",
    style?: React.CSSProperties,
    layout?: CalendarLayoutItem,
  ) => {
    const details = [
      item.staff_name?.trim() ? `Phụ trách: ${item.staff_name.trim()}` : "",
      item.content?.trim() ? `Nội dung: ${item.content.trim()}` : "",
      item.location?.trim() ? `Địa điểm: ${item.location.trim()}` : "",
    ].filter(Boolean);
    const label = [`${showTime(item)} · ${item.title}`, ...details].join(" · ");
    return (
      <span
        key={item.id}
        role="button"
        tabIndex={0}
        title={label}
        data-calendar-event={variant}
        data-start={(item.start_time || "").slice(0, 5)}
        data-end={(item.end_time || "").slice(0, 5)}
        data-overlap-column={layout?.column}
        data-overlap-columns={layout?.columnCount}
        draggable={item.status !== "cancelled"}
        onMouseDown={(event) => event.stopPropagation()}
        onMouseUp={(event) => event.stopPropagation()}
        onDragStart={(event) => beginMove(event, item)}
        onDragEnd={cancelMove}
        onClick={(event) => openItem(event, item)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            onOpen(item);
          }
        }}
        style={style}
        className={`${variant === "week" ? "dt-calendar-event" : "dt-month-event"} cursor-grab ${moving?.id === item.id ? "is-moving" : ""} ${item.status === "completed" ? "is-completed" : item.status === "cancelled" ? "is-cancelled" : ""}`}
      >
        <span className="dt-calendar-event-main">
          {showTime(item)} · {item.title}
        </span>
        {variant === "week"
          ? details.map((detail) => (
              <span key={detail} className={`dt-calendar-event-meta${detail.startsWith("Nội dung:") ? " dt-calendar-event-content" : ""}`}>
                {detail}
              </span>
            ))
          : details.length
            ? ` · ${details.join(" · ")}`
            : null}
      </span>
    );
  };
  const rangeLabel = appliedRange
    ? `${fromIso(appliedRange.start).toLocaleDateString("vi-VN")} – ${fromIso(appliedRange.end).toLocaleDateString("vi-VN")}`
    : mode === "week"
      ? `${first.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })} – ${weekDays[6].toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}`
      : cursor.toLocaleDateString("vi-VN", { month: "long", year: "numeric" });
  const toolbar = (
    <>
      <div className="dt-calendar-toolbar">
        <div className="dt-calendar-period">
          <button type="button" onClick={selectToday}>
            Hôm nay
          </button>
          <button type="button" onClick={() => shift(-1)} aria-label="Kỳ trước">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => shift(1)} aria-label="Kỳ sau">
            <ChevronRight className="h-4 w-4" />
          </button>
          <b className="text-sm text-slate-800">{rangeLabel}</b>
        </div>
        <div className="dt-calendar-toolbar-right">
          <div className="dt-calendar-range">
            <label>
              Từ
              <input
                type="date"
                value={rangeStart}
                onChange={(event) => {
                  setRangeStart(event.target.value);
                  setRangeError("");
                }}
              />
            </label>
            <label>
              Đến
              <input
                type="date"
                min={rangeStart || undefined}
                max={
                  rangeStart
                    ? iso(addMonths(fromIso(rangeStart), 3))
                    : undefined
                }
                value={rangeEnd}
                onChange={(event) => {
                  setRangeEnd(event.target.value);
                  setRangeError("");
                }}
              />
            </label>
            <button type="button" onClick={applyRange}>
              Xem khoảng
            </button>
            {(rangeStart || rangeEnd || appliedRange) && (
              <button type="button" onClick={clearRange}>
                Bỏ lọc
              </button>
            )}
          </div>
          {actions}
        </div>
      </div>
      {rangeError && (
        <p className="dt-calendar-range-error" role="alert">
          {rangeError}
        </p>
      )}
    </>
  );
  const renderMonthDay = (
    day: Date,
    key: string,
    active: boolean,
    outside: boolean = false,
  ) => {
    const date = iso(day),
      rows = active ? events(date) : [],
      todayDate = date === today();
    return (
      <div
        key={key}
        role={active ? "button" : undefined}
        tabIndex={active ? 0 : -1}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (active) dropMove(event, date);
        }}
        onClick={() => {
          if (active && !draggedRef.current) onPick(date);
          draggedRef.current = false;
        }}
        className={`dt-month-day ${outside ? "is-outside" : ""} ${todayDate ? "is-today" : ""} ${active ? "" : "is-filtered"}`}
      >
        <span className="dt-month-number">{day.getDate()}</span>
        <span className="dt-month-events">
          {rows.slice(0, 3).map((item) => renderEvent(item, "month"))}
          {rows.length > 3 && (
            <span className="dt-month-more">+{rows.length - 3} buổi khác</span>
          )}
        </span>
      </div>
    );
  };
  const weekdayHeads = [
    "Thứ 2",
    "Thứ 3",
    "Thứ 4",
    "Thứ 5",
    "Thứ 6",
    "Thứ 7",
    "Chủ nhật",
  ].map((label) => (
    <div key={label} className="dt-month-head">
      {label}
    </div>
  ));
  if (appliedRange && appliedRange.days > 7) {
    const monthStarts: Date[] = [];
    const end = fromIso(appliedRange.end);
    for (
      let value = new Date(
        fromIso(appliedRange.start).getFullYear(),
        fromIso(appliedRange.start).getMonth(),
        1,
      );
      value <= end;
      value = new Date(value.getFullYear(), value.getMonth() + 1, 1)
    )
      monthStarts.push(value);
    return (
      <div className="dt-calendar">
        {toolbar}
        <div className="dt-calendar-multi-month">
          {monthStarts.map((month) => {
            const leading = (month.getDay() + 6) % 7,
              daysInMonth = new Date(
                month.getFullYear(),
                month.getMonth() + 1,
                0,
              ).getDate(),
              cellCount = Math.ceil((leading + daysInMonth) / 7) * 7;
            return (
              <section key={iso(month)} className="dt-calendar-range-month">
                <h3 className="dt-calendar-month-title">
                  {month.toLocaleDateString("vi-VN", {
                    month: "long",
                    year: "numeric",
                  })}
                </h3>
                <div className="dt-calendar-month-scroll">
                  <div className="dt-calendar-month is-range-month">
                    {weekdayHeads}
                    {Array.from({ length: cellCount }, (_, index) => {
                      const dayNumber = index - leading + 1;
                      if (dayNumber < 1 || dayNumber > daysInMonth)
                        return (
                          <div
                            key={`blank-${index}`}
                            className="dt-month-day is-placeholder"
                            aria-hidden="true"
                          />
                        );
                      const day = new Date(
                          month.getFullYear(),
                          month.getMonth(),
                          dayNumber,
                        ),
                        date = iso(day);
                      return renderMonthDay(day, date, inRange(date));
                    })}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
        <p className="border-t border-sky-100 px-4 py-2 text-xs text-slate-500">
          Hiển thị liên tục theo tháng trong khoảng đã chọn; kéo lịch sang ngày
          khác để chuyển lịch.
        </p>
      </div>
    );
  }
  if (mode === "month") {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1),
      gridStart = weekStart(monthStart),
      days = Array.from({ length: 42 }, (_, index) =>
        addDays(gridStart, index),
      );
    return (
      <div className="dt-calendar">
        {toolbar}
        <div className="dt-calendar-month-scroll">
          <div className="dt-calendar-month">
            {weekdayHeads}
            {days.map((day) =>
              renderMonthDay(
                day,
                iso(day),
                true,
                day.getMonth() !== cursor.getMonth(),
              ),
            )}
          </div>
        </div>
        <p className="border-t border-sky-100 px-4 py-2 text-xs text-slate-500">
          Kéo một lịch sang ngày khác để chuyển lịch; bấm vào ngày trống để chọn
          loại lịch cần tạo.
        </p>
      </div>
    );
  }
  const timelineStart = 480,
    timelineEnd = 1260,
    slotMinutes = 30,
    slotHeight = 112 / 3;
  const slots = Array.from(
    { length: (timelineEnd - timelineStart) / slotMinutes },
    (_, index) => timelineStart + index * slotMinutes,
  );
  const timelineEvents = timelineDays
    .flatMap((day, dayIndex) =>
      layoutCalendarEvents(events(iso(day))).map((entry) => ({
        ...entry,
        dayIndex,
      })),
    )
    .filter((entry) => entry.end > timelineStart && entry.start < timelineEnd);
  const renderTimelineEvent = (
    entry: CalendarLayoutItem & { dayIndex: number },
  ) => {
    const start = Math.max(timelineStart, entry.start),
      end = Math.min(timelineEnd, entry.end),
      row = Math.floor((start - timelineStart) / slotMinutes) + 2,
      offset = start - (timelineStart + (row - 2) * slotMinutes);
    const style = {
      gridColumnStart: entry.dayIndex + 2,
      gridRowStart: row,
      transform: `translateY(${(offset * slotHeight) / slotMinutes}px)`,
      height: `${Math.max(20, ((end - start) * slotHeight) / slotMinutes)}px`,
      width: `calc(${100 / entry.columnCount}% - 4px)`,
      marginLeft: `calc(${(entry.column * 100) / entry.columnCount}% + 2px)`,
    } as React.CSSProperties;
    return renderEvent(entry.item, "week", style, entry);
  };
  const finish = (date: string, minute: number) => {
    if (!drag) {
      onPick(date, toTime(minute), toTime(minute + 30));
      return;
    }
    const start = Math.min(drag.minute, minute),
      end = Math.max(drag.minute, minute) + 30;
    onPick(drag.date, toTime(start), toTime(end));
    setDrag(null);
    setHover(null);
  };
  return (
    <div className="dt-calendar">
      {toolbar}
      <div className="dt-calendar-scroll">
        <div
          className={`dt-calendar-week is-dynamic ${moving ? "is-moving-calendar" : ""}`}
          style={
            {
              "--dt-calendar-days": timelineDays.length,
              "--dt-calendar-slot-height": `${slotHeight}px`,
            } as React.CSSProperties
          }
        >
          <div
            className="dt-calendar-head"
            style={{ gridColumnStart: 1, gridRowStart: 1 }}
          />
          {timelineDays.map((day, dayIndex) => {
            const date = iso(day);
            return (
              <div
                key={date}
                style={{ gridColumnStart: dayIndex + 2, gridRowStart: 1 }}
                className={`dt-calendar-head ${date === today() ? "is-today" : ""}`}
              >
                <span>
                  {day.toLocaleDateString("vi-VN", { weekday: "long" })}
                </span>
                <strong>{day.getDate()}</strong>
              </div>
            );
          })}
          {slots.flatMap((minute, slotIndex) => [
            <div
              key={`hour-${minute}`}
              style={{ gridColumnStart: 1, gridRowStart: slotIndex + 2 }}
              className="dt-calendar-hour"
            >
              {minute % 60 === 0 ? toTime(minute) : ""}
            </div>,
            ...timelineDays.map((day, dayIndex) => {
              const date = iso(day),
                selected =
                  !!drag &&
                  !!hover &&
                  drag.date === date &&
                  hover.date === date &&
                  minute >= Math.min(drag.minute, hover.minute) &&
                  minute <= Math.max(drag.minute, hover.minute);
              return (
                <div
                  key={`${date}-${minute}`}
                  style={{
                    gridColumnStart: dayIndex + 2,
                    gridRowStart: slotIndex + 2,
                  }}
                  role="button"
                  tabIndex={0}
                  data-calendar-slot={`${date}T${toTime(minute)}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    draggedRef.current = false;
                    setDrag({ date, minute });
                    setHover({ date, minute });
                  }}
                  onMouseEnter={() => {
                    if (drag) setHover({ date, minute });
                  }}
                  onMouseUp={() => {
                    draggedRef.current = true;
                    finish(date, minute);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    dropMove(event, date, minute);
                  }}
                  onClick={() => {
                    if (!draggedRef.current)
                      onPick(date, toTime(minute), toTime(minute + 30));
                    draggedRef.current = false;
                  }}
                  className={`dt-calendar-cell ${selected ? "is-selecting" : ""} ${moving ? "is-drop-target" : ""}`}
                />
              );
            }),
          ])}
          {timelineEvents.map(renderTimelineEvent)}
        </div>
      </div>
      <p className="border-t border-sky-100 px-4 py-2 text-xs text-slate-500">
        Kéo một lịch sang ô ngày/giờ khác để chuyển lịch. Kéo chuột qua ô trống
        để chọn loại lịch cần tạo theo đúng khoảng đã chọn.
      </p>
    </div>
  );
}
function WorkScheduleDetail({
  activity,
  canWrite,
  actor,
  idToken,
  onBack,
  onEdit,
  onCancel,
  onDelete,
}: {
  activity: WorkActivity;
  canWrite: boolean;
  actor?: string | null;
  idToken?: string;
  onBack: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const title =
    activity.kind === "training"
      ? "Lịch tập huấn"
      : activity.kind === "meeting"
        ? "Lịch gặp Khách hàng"
        : "Lịch công tác khác";
  const logKey =
    activity.kind === "training"
      ? `digital-training-session-${activity.sourceId}`
      : `digital-training-activity-${activity.kind}-${activity.sourceId}`;
  return (
    <section className="mt-6 space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-bold text-slate-600"
      >
        <ArrowLeft className="h-4 w-4" />
        Quay lại Lịch
      </button>
      <article className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase text-cyan-600">{title}</p>
            <h2 className="mt-1 text-2xl font-extrabold">{activity.title}</h2>
            <p className="mt-2 text-sm text-slate-500">
              {showDate(activity.date)} · {showTime(activity)}
            </p>
          </div>
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onEdit}
                className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-bold text-sky-800"
              >
                <Pencil className="mr-2 inline h-4 w-4" />
                Chỉnh sửa
              </button>
              {activity.status !== "cancelled" && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800"
                >
                  Hủy lịch
                </button>
              )}
              <button
                type="button"
                onClick={onDelete}
                className="rounded-lg border border-rose-200 px-4 py-2 text-sm font-bold text-rose-700"
              >
                <Trash2 className="mr-2 inline h-4 w-4" />
                Xóa
              </button>
            </div>
          )}
        </div>
        <div className="mt-6 grid gap-5 border-t pt-5 sm:grid-cols-2 xl:grid-cols-3">
          <p>
            <b className="block text-xs uppercase text-slate-500">{"Tr\u1ea1ng th\u00e1i"}</b>
            <span className={`mt-1 inline-flex rounded-full border px-2 py-1 text-xs font-bold ${scheduleStatusClass[activity.status] || "border-slate-200 bg-slate-100 text-slate-600"}`}>
              {status[activity.status]}
            </span>
          </p>
          <p>
            <b className="block text-xs uppercase text-slate-500">{"Kh\u00e1ch h\u00e0ng"}</b>
            {activity.customerName || "\u2014"}
          </p>
          <p>
            <b className="block text-xs uppercase text-slate-500">{"L\u1edbp/Ph\u00e2n nh\u00f3m"}</b>
            {activity.className || "\u2014"}
          </p>
          <p>
            <b className="block text-xs uppercase text-slate-500">{"\u0110\u1ecba \u0111i\u1ec3m"}</b>
            {activity.location || "\u2014"}
          </p>
          {activity.kind === "training" ? (
            <>
              <p>
                <b className="block text-xs uppercase text-slate-500">{"Gi\u1ea3ng vi\u00ean"}</b>
                {activity.instructorName || activity.staffName || "\u2014"}
              </p>
              <p>
                <b className="block text-xs uppercase text-slate-500">{"Nh\u00e2n vi\u00ean h\u1ed7 tr\u1ee3"}</b>
                {activity.supportStaffName || "\u2014"}
              </p>
              <p>
                <b className="block text-xs uppercase text-slate-500">Số người tham gia</b>
                {(activity.attendees || 0).toLocaleString("vi-VN")}
              </p>
            </>
          ) : (
            <p>
              <b className="block text-xs uppercase text-slate-500">{"Nh\u00e2n vi\u00ean ph\u1ee5 tr\u00e1ch"}</b>
              {activity.staffName || "\u2014"}
            </p>
          )}
          <p className="sm:col-span-2 xl:col-span-3">
            <b className="block text-xs uppercase text-slate-500">Nội dung</b>
            {activity.content || "—"}
          </p>
        </div>
      </article>
      <LogNotes
        entityKey={logKey}
        actor={actor}
        canWrite={canWrite}
        idToken={idToken}
      />
    </section>
  );
}
type DigitalTrainingSnapshot = {
  owner: string;
  savedAt: number;
  sessions: Session[];
  employees: EmployeeOption[];
  meetings: CustomerMeeting[];
  partners: Partner[];
  partnerProductSubscriptions: ProductSubscription[];
  productCatalog: ProductOption[];
  productOpportunities: ProductOpportunity[];
  leads: Lead[];
  classes: TrainingClass[];
  materials: Material[];
  surveys: Survey[];
};
const DIGITAL_TRAINING_MEMORY_TTL_MS = 5 * 60 * 1000;
const DIGITAL_TRAINING_CACHE_KEY = 'ft-digital-training-bootstrap-v1';
const DIGITAL_TRAINING_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const loadDigitalTrainingCache = (owner: string): DigitalTrainingSnapshot | null => {
  try {
    const record = JSON.parse(window.localStorage.getItem(DIGITAL_TRAINING_CACHE_KEY) || 'null');
    if (!record?.savedAt || !record?.owner || record.owner !== owner || Date.now() - Number(record.savedAt) >= DIGITAL_TRAINING_CACHE_TTL_MS) {
      window.localStorage.removeItem(DIGITAL_TRAINING_CACHE_KEY);
      return null;
    }
    return record.payload || null;
  } catch { return null; }
};
const storeDigitalTrainingCache = (owner: string, payload: unknown) => {
  try {
    window.localStorage.setItem(DIGITAL_TRAINING_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), owner, payload }));
  } catch {}
};
let digitalTrainingSnapshot: DigitalTrainingSnapshot | null = null;

export default function DigitalTraining({
  onBackToWorkspace,
  onOpenTrainingAssessment,
  onAccountClick,
  onLogout,
  isGuest,
  userName,
  userRole,
  jobTitle,
  photoURL,
  departmentNames = [],
  accessModules = [],
  idToken = "",
}: {
  onBackToWorkspace: () => void;
  onOpenTrainingAssessment: () => void;
  onAccountClick: () => void;
  onLogout: () => void;
  isGuest: boolean;
  userName?: string | null;
  userRole?: string | null;
  jobTitle?: string | null;
  departmentNames?: string[];
  accessModules?: string[];
  photoURL?: string | null;
  idToken?: string;
}) {
  const normalisedJobTitle = [jobTitle || "", ...departmentNames].join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(new RegExp(String.fromCharCode(273), "g"), "d")
    .toLocaleLowerCase("vi-VN");
  const isAccountant = normalisedJobTitle.includes("ke toan");
  const hasFinanceAccess = userRole === "ADMIN" || accessModules.includes("finance-report");
  const canViewFinance = !isGuest && hasFinanceAccess && (
    userRole === "ADMIN"
    || userRole === "MANAGER"
    || isAccountant
    || normalisedJobTitle.includes("giam doc")
    || normalisedJobTitle.includes("quan ly")
  );
  const canEditFinance = canViewFinance && (userRole === "ADMIN" || isAccountant);
  const cacheOwner = isGuest ? "guest" : idToken;
  const [localStorageCache] = useState(() => isGuest ? null : loadDigitalTrainingCache(cacheOwner));
  const cachedSnapshot = digitalTrainingSnapshot?.owner === cacheOwner && Date.now() - digitalTrainingSnapshot.savedAt < DIGITAL_TRAINING_MEMORY_TTL_MS
    ? digitalTrainingSnapshot
    : localStorageCache;
  const route = currentRoute(),
    [tab, setTab] = useState<Tab>(route.tab),
    [scheduleOpen, setScheduleOpen] = useState(
      menuOpenState(route.tab, route.productView).schedule,
    ),
    [customerOpen, setCustomerOpen] = useState(
      menuOpenState(route.tab, route.productView).customer,
    ),
    [productsOpen, setProductsOpen] = useState(
      menuOpenState(route.tab, route.productView).products,
    ),
    [productView, setProductView] = useState<ProductView>(route.productView),
    [surveyOpen, setSurveyOpen] = useState(
      menuOpenState(route.tab, route.productView).survey,
    ),
    [selected, setSelected] = useState<number | null>(route.partnerId),
    [partnerDetailTab, setPartnerDetailTab] = useState<"products" | "training">("products"),
    [editingProductSubscription, setEditingProductSubscription] = useState<ProductSubscription | null>(null),
    [selectedSurvey, setSelectedSurvey] = useState<number | null>(
      route.surveyId,
    ),
    [sessions, setSessions] = useState<Session[]>(cachedSnapshot?.sessions || []),
    [employees, setEmployees] = useState<EmployeeOption[]>(cachedSnapshot?.employees || []),
    [meetings, setMeetings] = useState<CustomerMeeting[]>(cachedSnapshot?.meetings || []),
    [partners, setPartners] = useState<Partner[]>(cachedSnapshot?.partners || []),
    [partnerProductSubscriptions, setPartnerProductSubscriptions] = useState<ProductSubscription[]>(cachedSnapshot?.partnerProductSubscriptions || []),
    [productCatalog, setProductCatalog] = useState<ProductOption[]>(cachedSnapshot?.productCatalog || []),
    [productOpportunities, setProductOpportunities] = useState<ProductOpportunity[]>(cachedSnapshot?.productOpportunities || []),
    [leads, setLeads] = useState<Lead[]>(cachedSnapshot?.leads || []),
    [classes, setClasses] = useState<TrainingClass[]>(cachedSnapshot?.classes || []),
    [materials, setMaterials] = useState<Material[]>(cachedSnapshot?.materials || []),
    [surveys, setSurveys] = useState<Survey[]>(cachedSnapshot?.surveys || []),
    [mode, setMode] = useState<Mode>("week"),
    [modal, setModal] = useState<Modal>(null),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(!cachedSnapshot),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""),
    [sessionPartnerTypeFilter, setSessionPartnerTypeFilter] = useState(""),
    [sessionPartnerFilter, setSessionPartnerFilter] = useState(""),
    [sessionTimeFilter, setSessionTimeFilter] = useState("this-month"),
    [sessionDateFrom, setSessionDateFrom] = useState(""),
    [sessionDateTo, setSessionDateTo] = useState(""),
    [sessionFilter, setSessionFilter] = useState(""),
    [sessionStaffFilter, setSessionStaffFilter] = useState(""),
    [partnerContract, setPartnerContract] = useState(""),
    [partnerProgress, setPartnerProgress] = useState(""),
    [partnerStatusFilter, setPartnerStatusFilter] = useState(""),
    [partnerManagementTypeFilter, setPartnerManagementTypeFilter] =
      useState(""),
    [partnerManagementSubtypeFilter, setPartnerManagementSubtypeFilter] =
      useState(""),
    [partnerManagementFilter, setPartnerManagementFilter] = useState(""),
    [partnerProvinceFilter, setPartnerProvinceFilter] = useState(""),
    [partnerWardFilter, setPartnerWardFilter] = useState(""),
    [trackingPartnerTypeFilter, setTrackingPartnerTypeFilter] = useState(""),
    [trackingPartnerFilter, setTrackingPartnerFilter] = useState(""),
    [trackingContentFilter, setTrackingContentFilter] = useState(""),
    [editingPartner, setEditingPartner] = useState<Partner | null>(null),
    [editingLead, setEditingLead] = useState<Lead | null>(null),
    [editingSession, setEditingSession] = useState<Session | null>(null),
    [editingMeeting, setEditingMeeting] = useState<CustomerMeeting | null>(
      null,
    ),
    [pendingCalendarPick, setPendingCalendarPick] = useState<{
      date: string;
      start_time: string;
      end_time: string;
    } | null>(null),
    [calendarDetail, setCalendarDetail] = useState<CalendarDetail | null>(
      route.calendarDetail,
    ),
    [deletePartner, setDeletePartner] = useState<Partner | null>(null),
    [convertLead, setConvertLead] = useState<Lead | null>(null),
    [deleteSurvey, setDeleteSurvey] = useState<Survey | null>(null),
    [deleteActivity, setDeleteActivity] = useState<WorkActivity | null>(null),
    [deleteMaterial, setDeleteMaterial] = useState<Material | null>(null),
    [editingSurvey, setEditingSurvey] = useState<Survey | null>(null),
    [materialPartnerTypeFilter, setMaterialPartnerTypeFilter] = useState(""),
    [materialPartnerFilter, setMaterialPartnerFilter] = useState(""),
    [surveyPartnerTypeFilter, setSurveyPartnerTypeFilter] = useState(""),
    [surveyPartnerFilter, setSurveyPartnerFilter] = useState(""),
    [file, setFile] = useState<File | null>(null);
  const applyMenuState = (nextTab: Tab, nextProductView: ProductView) => {
    const menu = menuOpenState(nextTab, nextProductView);
    setScheduleOpen(menu.schedule);
    setCustomerOpen(menu.customer);
    setProductsOpen(menu.products);
    setSurveyOpen(menu.survey);
  };
  const [sd, setSd] = useState({
    title: "",
    date: today(),
    start_time: "",
    end_time: "",
    partner_id: "",
    class_group_id: "",
    contents: [] as string[],
    attendees: "0",
    location: "",
    instructor_name: "",
    support_staff_name: "",
    status: "planned",
    notes: "",
  });
  const [meeting, setMeeting] = useState({
    title: "",
    schedule_type: "meeting" as "meeting" | "other",
    activity_type: "",
    customer_type: "",
    representative: "",
    phone: "",
    email: "",
    date: today(),
    start_time: "",
    end_time: "",
    location: "",
    content: "",
    status: "planned" as "unscheduled" | "planned" | "completed" | "cancelled",
    staff_name: "",
    notes: "",
    lead: "",
  partner: "",
  product: "",
  });
  const [leadDraft, setLeadDraft] = useState({ name: "", lead_type: "", address: "", representative: "", representative_position: "", phone: "", email: "", interested_products: [] as string[], stage: "discussion", notes: "" });
  const [pd, setPd] = useState<PartnerDraft>(newPartnerDraft);
  const [quickPartner, setQuickPartner] = useState({
    name: "",
    partner_type: "",
    partner_subtype: "",
    province: "",
    ward: "",
    contact_person: "",
    contact_position: "",
    phone: "",
    email: "",
    address: "",
  });
  const [renewal, setRenewal] = useState({
    contract_signed_date: "",
    contract_duration: "",
    contract_duration_unit: "month",
  });
  const [cd, setCd] = useState({
    partner: "",
    name: "",
    members: "",
    planned_sessions: "1",
    notes: "",
  });
  const [md, setMd] = useState({
    title: "",
    external_url: "",
    session: "",
    partner: "",
    notes: "",
  });
  const [sv, setSv] = useState({
    title: "",
    form_type: "end_session",
    session: "",
    partner: "",
    notes: "",
  });
  const auth = () => (idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    load = async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const sessionResponse = await fetch("/api/digital-training/sessions", {
          headers: auth(),
          cache: "no-store",
        });
        if (!sessionResponse.ok)
          throw Error("Không thể tải dữ liệu Đào tạo số.");
        const sessionRows = await sessionResponse.json();
        const productSubscriptionResponse = await fetch("/api/digital-training/product-subscriptions", { headers: auth() });
        if (!productSubscriptionResponse.ok) throw Error("Could not load product subscriptions.");
        const productSubscriptionRows = await productSubscriptionResponse.json();
        const [productRows, opportunityRows] = await Promise.all([
          fetch("/api/digital-training/products", { headers: auth() }).then(async (r) => { if (!r.ok) throw Error("Kh�ng th? t?i danh m?c s?n ph?m."); return r.json(); }),
          fetch("/api/digital-training/product-opportunities", { headers: auth() }).then(async (r) => { if (!r.ok) throw Error("Kh�ng th? t?i co h?i s?n ph?m."); return r.json(); }),
        ]);
        const staffResponse = await fetch("/api/auth/assignable-staff", { headers: auth() });
        const staffRows = staffResponse.ok ? await staffResponse.json() : [];
        const endpoints = [
          "customer-meetings",
          ...(isGuest ? [] : ["leads"]),
          "partners",
          "classes",
          "materials",
          "surveys",
        ];
        const list = await Promise.all(
          endpoints.map(async (x) => {
            const r = await fetch(`/api/digital-training/${x}`, {
              headers: auth(),
            });
            if (!r.ok) throw Error("Không thể tải dữ liệu Đào tạo số.");
            return r.json();
          }),
        );
        const leadOffset = isGuest ? 0 : 1;
        const nextEmployees = Array.isArray(staffRows) ? staffRows : [];
        const nextLeads = isGuest ? [] : list[1];
        const nextPartners = list[1 + leadOffset];
        const nextClasses = list[2 + leadOffset];
        const nextMaterials = list[3 + leadOffset];
        const nextSurveys = list[4 + leadOffset];
        setSessions(sessionRows);
        setEmployees(nextEmployees);
        setPartnerProductSubscriptions(productSubscriptionRows);
        setProductCatalog(productRows);
        setProductOpportunities(opportunityRows);
        setMeetings(list[0]);
        setLeads(nextLeads);
        setPartners(nextPartners);
        setClasses(nextClasses);
        setMaterials(nextMaterials);
        setSurveys(nextSurveys);
        digitalTrainingSnapshot = {
          owner: cacheOwner, savedAt: Date.now(), sessions: sessionRows, employees: nextEmployees,
          meetings: list[0], partners: nextPartners, partnerProductSubscriptions: productSubscriptionRows,
          productCatalog: productRows, productOpportunities: opportunityRows, leads: nextLeads,
          classes: nextClasses, materials: nextMaterials, surveys: nextSurveys,
        };
        storeDigitalTrainingCache(cacheOwner, digitalTrainingSnapshot);
      } catch (e: any) {
        setNotice(e.message);
      } finally {
        if (!silent) setLoading(false);
      }
    };
  useEffect(() => {
    void load(Boolean(cachedSnapshot));
  }, [idToken, isGuest]);
  useEffect(() => {
    setPartnerDetailTab("products");
    setEditingProductSubscription(null);
  }, [selected]);
  useEffect(() => {
    if (loading) return;
    digitalTrainingSnapshot = {
      owner: cacheOwner, savedAt: Date.now(), sessions, employees, meetings, partners,
      partnerProductSubscriptions, productCatalog, productOpportunities, leads, classes, materials, surveys,
    };
    storeDigitalTrainingCache(cacheOwner, digitalTrainingSnapshot);
  }, [cacheOwner, classes, employees, leads, loading, materials, meetings, partnerProductSubscriptions, partners, productCatalog, productOpportunities, sessions, surveys]);
  useEffect(() => {
    const h = () => {
      const r = currentRoute();
      setTab(r.tab);
      applyMenuState(r.tab, r.productView);
      setProductView(r.productView);
      setSelected(r.partnerId);
      setSelectedSurvey(r.surveyId);
      setCalendarDetail(r.calendarDetail);
    };
    addEventListener("popstate", h);
    return () => removeEventListener("popstate", h);
  }, []);
  const go = (t: Tab, id?: number | null) => {
      setCalendarDetail(null);
      const nextProductView = t === "products" ? "catalog" : productView;
      applyMenuState(t, nextProductView);
      if (t === "products") setProductView("catalog");
      setTab(t);
      if (t === "survey") {
        setSelected(null);
        setSelectedSurvey(id || null);
      } else {
        setSelected(id || null);
        setSelectedSurvey(null);
      }
      history.pushState(null, "", pathFor(t, id));
    },
    goProduct = (view: ProductView) => {
      setCalendarDetail(null);
      applyMenuState("products", view);
      setProductView(view);
      setTab("products");
      setSelected(null);
      setSelectedSurvey(null);
      history.pushState(null, "", productPath(view));
    },
    openCalendarDetail = (detail: CalendarDetail) => {
      setCalendarDetail(detail);
      applyMenuState("calendar", productView);
      setTab("calendar");
      setSelected(null);
      setSelectedSurvey(null);
      history.pushState(null, "", calendarDetailPath(detail));
    },
    openPartnerDetail = (
      t: "partners" | "partner-sessions",
      partnerId: number,
    ) => {
      go(t, partnerId);
      window.requestAnimationFrame(() =>
        window.scrollTo({ top: 0, behavior: "auto" }),
      );
    },
    patch = async (url: string, data: any) => {
      const r = await fetch(`/api/digital-training/${url}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...auth() },
          body: JSON.stringify(data),
        }),
        b = await r.json(),
        detail =
          b.error ||
          Object.entries(b || {})
            .flatMap(([field, value]) =>
              Array.isArray(value)
                ? value.map((message) => String(field) + ": " + String(message))
                : [String(field) + ": " + String(value)],
            )
            .join(" · ");
      if (!r.ok) throw Error(detail || "Không thể lưu dữ liệu.");
      return b;
    },
    can = () => {
      if (!idToken || isGuest) {
        setNotice(
          "Vui lòng đăng nhập bằng tài khoản quản lý để tạo hoặc chỉnh sửa dữ liệu.",
        );
        return false;
      }
      return true;
    },
    post = async (url: string, data: any) => {
      const r = await fetch(`/api/digital-training/${url}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...auth() },
          body: JSON.stringify(data),
        }),
        b = await r.json(),
        detail =
          b.error ||
          Object.entries(b || {})
            .flatMap(([field, value]) =>
              Array.isArray(value)
                ? value.map((message) => String(field) + ": " + String(message))
                : [String(field) + ": " + String(value)],
            )
            .join(" · ");
      if (!r.ok) throw Error(detail || "Không thể lưu dữ liệu.");
      return b;
    },
    pick = (date: string, start_time = "", end_time = "") => {
      setPendingCalendarPick({ date, start_time, end_time });
      setModal("schedule-kind");
    },
    openTraining = (date: string = today(), start_time = "", end_time = "") => {
      setEditingSession(null);
      setSd({
        title: "",
        date,
        start_time,
        end_time: threeHoursAfter(start_time) || end_time,
        partner_id: "",
        class_group_id: "",
        contents: [],
        attendees: "0",
        location: "",
        instructor_name: "",
        support_staff_name: "",
        status: "planned",
        notes: "",
      });
      setModal("session");
    },
    openMeeting = (date: string = today(), start_time = "", end_time = "") => {
      setEditingMeeting(null);
      setMeeting({
        title: "",
        schedule_type: "meeting",
        activity_type: "",
        customer_type: "",
        representative: "",
        phone: "",
        email: "",
        date,
        start_time,
        end_time,
        location: "",
        content: "",
        status: "planned",
        staff_name: "",
        notes: "",
        lead: "",
      partner: "",
      product: "",
      });
      setModal("meeting");
    },
    openOther = (date: string = today(), start_time = "", end_time = "") => {
      setEditingMeeting(null);
      setMeeting({
        title: "",
        schedule_type: "other",
        activity_type: "",
        customer_type: "",
        representative: "",
        phone: "",
        email: "",
        date,
        start_time,
        end_time,
        location: "",
        content: "",
        status: "planned",
        staff_name: "",
        notes: "",
        lead: "",
      partner: "",
      product: "",
      });
      setModal("other");
    };
  const openSessionEditor = (item: Session) => {
    setEditingSession(item);
    setSd({
      title: item.title,
      date: item.date || "",
      start_time: item.start_time || "",
      end_time: item.end_time || threeHoursAfter(item.start_time) || "",
      partner_id: item.partner_id ? String(item.partner_id) : "",
      class_group_id: item.class_group_id ? String(item.class_group_id) : "",
      contents: item.contents || [],
      attendees: String(item.attendees || 0),
      location: item.location || "",
      instructor_name: item.instructor_name || item.staff_name || "",
      support_staff_name: item.support_staff_name || "",
      status: item.status,
      notes: item.notes || "",
    });
    setModal("session");
  };
  const openMeetingEditor = (item: CustomerMeeting) => {
    setEditingMeeting(item);
    setMeeting({
      title: item.title,
      schedule_type: item.schedule_type || "meeting",
      activity_type: item.activity_type || "",
      customer_type: item.customer_type || "",
      representative: item.representative || "",
      phone: item.phone || "",
      email: item.email || "",
      date: item.date || today(),
      start_time: item.start_time || "",
      end_time: item.end_time || "",
      location: item.location || "",
      content: item.content || "",
      status: item.status || "planned",
      staff_name: item.staff_name || "",
      notes: item.notes || "",
      lead: item.lead ? String(item.lead) : "",
      partner: item.partner ? String(item.partner) : "",
      product: "",
    });
    setModal(item.schedule_type === "other" ? "other" : "meeting");
  };
  const openCalendarItem = (item: CalendarItem) => {
    const kind = item.kind || "training";
    const sourceId =
      typeof item.id === "number"
        ? item.id
        : Number(String(item.id).split("-").pop());
    if (!Number.isFinite(sourceId)) {
      setNotice("Không xác định được lịch cần mở.");
      return;
    }
    openCalendarDetail({ kind, sourceId });
  };
  const moveCalendarItem = async (
    item: CalendarItem,
    date: string,
    start?: string,
  ) => {
    if (!can()) return;
    try {
      const kind = item.kind || "training";
      const sourceId =
        typeof item.id === "number"
          ? item.id
          : Number(String(item.id).split("-").pop());
      const existing =
        kind === "training"
          ? sessions.find((entry) => entry.id === sourceId)
          : meetings.find((entry) => entry.id === sourceId);
      if (!existing || !Number.isFinite(sourceId))
        throw Error("Không xác định được lịch cần chuyển.");
      const currentStart = (existing.start_time || "").slice(0, 5);
      if (existing.date === date && (!start || currentStart === start)) return;
      const minute = (value?: string | null) => {
        const [hour = "0", minute = "0"] = (value || "").slice(0, 5).split(":");
        return Number(hour) * 60 + Number(minute);
      };
      const clock = (value: number) =>
        `${String(Math.floor(((value + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((value + 1440) % 1440) % 60).padStart(2, "0")}`;
      const nextStart = start || currentStart || "";
      const nextEnd =
        nextStart && existing.end_time && currentStart
          ? clock(
              minute(nextStart) +
                Math.max(
                  0,
                  minute(existing.end_time) - minute(existing.start_time),
                ),
            )
          : existing.end_time || "";
      const nextStatus =
        existing.status === "cancelled"
          ? "cancelled"
          : date < today()
            ? "completed"
            : "planned";
      const endpoint =
        kind === "training"
          ? `sessions/${sourceId}`
          : `customer-meetings/${sourceId}`;
      const saved = await patch(endpoint, {
        date,
        start_time: nextStart || null,
        end_time: nextEnd || null,
        status: nextStatus,
      });
      if (kind === "training")
        setSessions((current) =>
          current.map((entry) =>
            entry.id === sourceId ? (saved as Session) : entry,
          ),
        );
      else
        setMeetings((current) =>
          current.map((entry) =>
            entry.id === sourceId ? (saved as CustomerMeeting) : entry,
          ),
        );
      appendLogNote(
        kind === "training"
          ? `digital-training-session-${sourceId}`
          : `digital-training-activity-${kind}-${sourceId}`,
        formatChangeLog("Chuyển lịch công tác", existing, saved),
        userName || "Nhân viên FT Workspace",
        true,
        idToken,
      );
      setNotice(
        `Đã chuyển lịch sang ${showDate(date)}${nextStart ? ` lúc ${nextStart}` : ""}.`,
      );
    } catch (error: any) {
      setNotice(error.message);
    }
  };
  const cancelCalendarActivity = async (detail: CalendarDetail) => {
    if (!can()) return;
    try {
      const existing =
        detail.kind === "training"
          ? sessions.find((item) => item.id === detail.sourceId)
          : meetings.find((item) => item.id === detail.sourceId);
      if (!existing) return;
      const endpoint =
        detail.kind === "training"
          ? `sessions/${detail.sourceId}`
          : `customer-meetings/${detail.sourceId}`;
      const saved = await patch(endpoint, { status: "cancelled" });
      appendLogNote(
        detail.kind === "training"
          ? `digital-training-session-${detail.sourceId}`
          : `digital-training-activity-${detail.kind}-${detail.sourceId}`,
        formatChangeLog("Hủy lịch công tác", existing, saved),
        userName || "Nhân viên FT Workspace",
        true,
        idToken,
      );
      await load();
      setNotice("Đã hủy lịch công tác.");
    } catch (error: any) {
      setNotice(error.message);
    }
  };
  const saveLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!can()) return;
    let leadPayload: any = leadDraft;
    if (!editingLead) {
      const duplicate = partners.find((item) => item.name.trim().toLocaleLowerCase("vi-VN") === leadDraft.name.trim().toLocaleLowerCase("vi-VN"));
      if (duplicate) {
        const services = partnerProductSubscriptions.filter((item) => item.partner === duplicate.id).map((item) => `${item.product_name}: ${productSubscriptionStatus(item.effective_status)}${item.expires_at ? ` (${showDate(item.expires_at)})` : ""}`).join("\n") || "Ch\u01b0a ghi nh\u1eadn d\u1ecbch v\u1ee5 \u0111ang s\u1eed d\u1ee5ng.";
        const openExisting = await appDialog.confirm(`\u0110\u00e3 c\u00f3 kh\u00e1ch h\u00e0ng \"${duplicate.name}\".\n${services}\n\nM\u1edf h\u1ed3 s\u01a1 hi\u1ec7n c\u00f3 \u0111\u1ec3 c\u1eadp nh\u1eadt ho\u1eb7c t\u1ea1o l\u1ecbch g\u1eb7p?`, { title: "Ph\u00e1t hi\u1ec7n kh\u00e1ch h\u00e0ng tr\u00f9ng", confirmText: "M\u1edf h\u1ed3 s\u01a1", cancelText: "Kh\u00f4ng ph\u1ea3i kh\u00e1ch n\u00e0y", tone: "warning" });
        if (openExisting) { setModal(null); go("partners", duplicate.id); return; }
        leadPayload = { ...leadDraft, allow_existing_partner: true };
      }
    }    try {
      const saved = editingLead
        ? await patch(`leads/${editingLead.id}`, leadDraft)
        : await post("leads", leadPayload);
      setModal(null);
      setEditingLead(null);
      await load();
      setNotice(editingLead ? "Đã cập nhật khách hàng mới." : `Đã thêm khách hàng mới: ${saved.name}.`);
    } catch (error: any) {
      setNotice(error.message);
    }
  };
  const promoteLead = async () => {
    if (!convertLead || !can()) return;
    try {
      const result = await post(`leads/${convertLead.id}/convert`, {});
      setConvertLead(null);
      await load();
      go("partners", result.partner.id);
      setNotice(`Đã chuyển ${result.partner.name} thành khách hàng hiện tại.`);
    } catch (error: any) {
      setNotice(error.message);
    }
  };
  const scheduleLeadMeeting = (lead: Lead) => {
    setEditingMeeting(null);
    setMeeting({
      title: `Gặp ${lead.name}`,
      schedule_type: "meeting",
      activity_type: "",
      customer_type: lead.lead_type || "",
      representative: lead.representative || "",
      phone: lead.phone || "",
      email: lead.email || "",
      date: today(), start_time: "", end_time: "", location: lead.address || "", content: "", status: "planned", staff_name: "", notes: lead.notes || "", lead: String(lead.id), partner: "", product: "",
    });
    setModal("meeting");
  };
  const schedulePartnerMeeting = (item: Partner, productId?: number) => {
    setEditingMeeting(null);
    setMeeting({ title: `G\u1eb7p ${item.name}`, schedule_type: "meeting", activity_type: "", customer_type: item.partner_type || "", representative: item.contact_person || "", phone: item.phone || "", email: item.email || "", date: today(), start_time: "", end_time: "", location: item.address || "", content: "", status: "planned", staff_name: "", notes: "", lead: "", partner: String(item.id), product: productId ? String(productId) : "" });
    setModal("meeting");
  };
  const saveSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!can()) return;
    const wasEditing = Boolean(editingSession);
    try {
      const payload = {
        ...sd,
        start_time: sd.start_time || null,
        end_time: sd.end_time || null,
        category: sd.contents.join(" · "),
        partner_id: sd.partner_id ? Number(sd.partner_id) : null,
        class_group_id: sd.class_group_id ? Number(sd.class_group_id) : null,
        attendees: Number(sd.attendees),
      };
      const saved = editingSession
        ? await patch(`sessions/${editingSession.id}`, payload)
        : await post("sessions", payload);
      if (editingSession)
        appendLogNote(
          `digital-training-session-${saved.id}`,
          formatChangeLog("Cập nhật lịch tập huấn", editingSession, saved),
          userName || "Nhân viên FT Workspace",
          true,
          idToken,
        );
      setSessions((current) =>
        wasEditing
          ? current.map((item) => item.id === saved.id ? saved : item)
          : [...current, saved],
      );
      setModal(null);
      setEditingSession(null);
      await load();
      setNotice(
        wasEditing ? "Đã cập nhật lịch tập huấn." : "Đã tạo buổi tập huấn.",
      );
    } catch (e: any) {
      setNotice(e.message);
    }
  };
  const openQuickPartner = () => {
    if (!can()) return;
    setQuickPartner({
      name: "",
      partner_type: "",
      partner_subtype: "",
      province: "",
      ward: "",
      contact_person: "",
      contact_position: "",
      phone: "",
      email: "",
      address: "",
    });
    setModal("quick-partner");
  };
  const saveQuickPartner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!can()) return;
    try {
      const created = await post("partners", quickPartner);
      setPartners((current) =>
        [...current, created].sort((a, b) =>
          a.name.localeCompare(b.name, "vi"),
        ),
      );
      setSd((current) => ({
        ...current,
        partner_id: String(created.id),
        class_group_id: "",
      }));
      setModal("session");
      setNotice("Đã thêm khách hàng mới và chọn cho lịch tập huấn.");
    } catch (e: any) {
      setNotice(e.message);
    }
  };
  const saveMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!can()) return;
    try {
      const payload = {
        ...meeting,
        schedule_type: "meeting" as const,
        activity_type: "",
        lead: meeting.lead ? Number(meeting.lead) : null,
        partner: meeting.partner ? Number(meeting.partner) : null,
        product: meeting.product ? Number(meeting.product) : null,
      };
      const saved = editingMeeting
        ? await patch(`customer-meetings/${editingMeeting.id}`, payload)
        : await post("customer-meetings", payload);
      if (editingMeeting)
        appendLogNote(
          `digital-training-activity-meeting-${saved.id}`,
          formatChangeLog(
            "Cập nhật lịch gặp Khách hàng",
            editingMeeting,
            saved,
          ),
          userName || "Nhân viên FT Workspace",
          true,
          idToken,
        );
      setModal(null);
      setEditingMeeting(null);
      await load();
      setNotice(
        editingMeeting
          ? "Đã cập nhật lịch gặp Khách hàng."
          : "Đã tạo lịch gặp Khách hàng mới.",
      );
    } catch (e: any) {
      setNotice(e.message);
    }
  };
  const saveOther = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!can()) return;
    try {
      const payload = { ...meeting, schedule_type: "other" as const };
      const saved = editingMeeting
        ? await patch(`customer-meetings/${editingMeeting.id}`, payload)
        : await post("customer-meetings", payload);
      if (editingMeeting)
        appendLogNote(
          `digital-training-activity-other-${saved.id}`,
          formatChangeLog("Cập nhật lịch công tác khác", editingMeeting, saved),
          userName || "Nhân viên FT Workspace",
          true,
          idToken,
        );
      setModal(null);
      setEditingMeeting(null);
      await load();
      setNotice(
        editingMeeting
          ? "Đã cập nhật lịch công tác khác."
          : "Đã tạo lịch công tác khác.",
      );
    } catch (e: any) {
      setNotice(e.message);
    }
  };
  const resizeSchedule = (schedule: TrainingScheduleDraft[], count: number) =>
    Array.from(
      { length: Math.max(0, count) },
      (_, index) => schedule[index] || newTrainingSchedule(),
    );
  const resizeClassPlans = (value: string) =>
    setPd((current) => {
      if (value.trim() === "")
        return {
          ...current,
          class_count: "",
          shared_sessions: "0",
          shared_training_schedule: [],
          class_plans: [],
        };
      const count = Math.max(1, Number(value) || 1);
      return {
        ...current,
        class_count: String(count),
        shared_sessions: count > 1 ? current.shared_sessions : "0",
        shared_training_schedule:
          count > 1 ? current.shared_training_schedule : [],
        class_plans: Array.from(
          { length: count },
          (_, index) =>
            current.class_plans[index] || {
              ...newClassDraft(index + 1),
              planned_sessions: current.class_plans[0]?.planned_sessions || "0",
              training_contents:
                current.class_plans[0]?.training_contents || [],
              planned_sessions_custom: false,
              training_contents_custom: false,
            },
        ),
      };
    });
  const updateSharedSessions = (value: string) =>
    setPd((current) => {
      if (value.trim() === "")
        return {
          ...current,
          shared_sessions: "",
          shared_training_schedule: [],
        };
      const count = Math.max(0, Number(value) || 0);
      return {
        ...current,
        shared_sessions: String(count),
        shared_training_schedule: resizeSchedule(
          current.shared_training_schedule,
          count,
        ),
      };
    });
  const updateSharedSchedule = (
    sessionIndex: number,
    patch: Partial<TrainingScheduleDraft>,
  ) =>
    setPd((current) => ({
      ...current,
      shared_training_schedule: current.shared_training_schedule.map(
        (slot, index) =>
          index === sessionIndex ? { ...slot, ...patch } : slot,
      ),
    }));
  const updateClassPlan = (index: number, patch: Partial<PartnerClassDraft>) =>
    setPd((current) => ({
      ...current,
      class_plans: current.class_plans.map((plan, i) =>
        i === index ? { ...plan, ...patch } : plan,
      ),
    }));
  const updateClassPlannedSessions = (index: number, value: string) =>
    setPd((current) => {
      if (value.trim() === "")
        return {
          ...current,
          class_plans: current.class_plans.map((plan, i) => {
            if (i === index)
              return {
                ...plan,
                planned_sessions: "",
                training_schedule: [],
                planned_sessions_custom:
                  i > 0 ? true : plan.planned_sessions_custom,
              };
            if (index === 0 && !plan.planned_sessions_custom)
              return { ...plan, planned_sessions: "", training_schedule: [] };
            return plan;
          }),
        };
      const count = Math.max(0, Number(value) || 0);
      return {
        ...current,
        class_plans: current.class_plans.map((plan, i) => {
          if (i === index)
            return {
              ...plan,
              planned_sessions: String(count),
              training_schedule: resizeSchedule(plan.training_schedule, count),
              planned_sessions_custom:
                i > 0 ? true : plan.planned_sessions_custom,
            };
          if (index === 0 && !plan.planned_sessions_custom)
            return {
              ...plan,
              planned_sessions: String(count),
              training_schedule: resizeSchedule(plan.training_schedule, count),
            };
          return plan;
        }),
      };
    });
  const updateClassTrainingContents = (
    index: number,
    training_contents: string[],
  ) =>
    setPd((current) => ({
      ...current,
      class_plans: current.class_plans.map((plan, i) => {
        if (i === index)
          return {
            ...plan,
            training_contents,
            training_contents_custom:
              i > 0 ? true : plan.training_contents_custom,
          };
        if (index === 0 && !plan.training_contents_custom)
          return { ...plan, training_contents };
        return plan;
      }),
    }));
  const updateClassSchedule = (
    classIndex: number,
    sessionIndex: number,
    patch: Partial<TrainingScheduleDraft>,
  ) =>
    setPd((current) => ({
      ...current,
      class_plans: current.class_plans.map((plan, index) =>
        index === classIndex
          ? {
              ...plan,
              training_schedule: plan.training_schedule.map((slot, i) =>
                i === sessionIndex ? { ...slot, ...patch } : slot,
              ),
            }
          : plan,
      ),
    }));
  const savePartner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!can()) return;
    try {
      if (editingPartner) {
        const trainingEnabled = pd.products.includes("Tập huấn");
        const classPlans = trainingEnabled ? pd.class_plans : [];
        const sharedTrainingSchedule =
          classPlans.length > 1 ? pd.shared_training_schedule : [];
        const sharedSessions =
          classPlans.length > 1 ? Number(pd.shared_sessions) || 0 : 0;
        const firstPlan = classPlans[0];
        const saved = await patch(`partners/${editingPartner.id}`, {
          name: pd.name,
          partner_type: pd.partner_type,
          partner_subtype: pd.partner_subtype,
          province: pd.province,
          ward: pd.ward,
          address: [pd.ward, pd.province].filter(Boolean).join(", "),
          contact_person: pd.contact_person,
          contact_position: pd.contact_position,
          phone: pd.phone,
          email: pd.email,
          additional_contacts: pd.additional_contacts.filter(
            (contact) =>
              contact.contact_person ||
              contact.position ||
              contact.phone ||
              contact.email,
          ),
          products: pd.products,
          contract_duration: pd.contract_duration
            ? Number(pd.contract_duration)
            : null,
          contract_duration_unit: pd.contract_duration_unit,
          contract_signed_date: pd.contract_signed_date || null,
          contract_status: pd.contract_status,
          budget: pd.budget ? Number(pd.budget) : null,
          ai_account_count: pd.ai_account_count
            ? Number(pd.ai_account_count)
            : 0,
          training_location: pd.training_location,
          planned_sessions:
            classPlans.reduce(
              (total, plan) => total + (Number(plan.planned_sessions) || 0),
              0,
            ) + sharedSessions,
          training_contents: firstPlan?.training_contents || [],
          training_content: (firstPlan?.training_contents || []).join(" · "),
          training_schedule: sharedTrainingSchedule,
          notes: pd.notes,
        });
        if (trainingEnabled) {
          if (classPlans.length === 1) {
            const plan = classPlans[0],
              desiredSchedule = plan.training_schedule,
              currentSessions = sessions
                .filter((session) => session.partner_id === editingPartner.id)
                .sort(
                  (a, b) =>
                    (a.session_number || 999) - (b.session_number || 999) ||
                    a.id - b.id,
                );
            const removeRecord = async (url: string) => {
              const response = await fetch(`/api/digital-training/${url}`, {
                method: "DELETE",
                headers: auth(),
              });
              if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw Error(
                  body.error || "Không thể đồng bộ dữ liệu tập huấn.",
                );
              }
            };
            for (
              let scheduleIndex = 0;
              scheduleIndex < desiredSchedule.length;
              scheduleIndex += 1
            ) {
              const slot = desiredSchedule[scheduleIndex],
                sessionNumber = scheduleIndex + 1,
                current = currentSessions.find(
                  (session) => (session.session_number || 0) === sessionNumber,
                ),
                sessionStatus =
                  slot.unscheduled || !slot.date
                    ? "unscheduled"
                    : slot.date < today()
                      ? "completed"
                      : "planned",
                sessionPayload = {
                  // Đồng bộ lịch lớp không được thay đổi người phụ trách đã phân công thủ công.
                  title: `Buổi ${sessionNumber} · ${pd.name}`,
                  session_number: sessionNumber,
                  date: slot.unscheduled ? null : slot.date || null,
                  start_time: slot.unscheduled ? null : slot.start_time || null,
                  end_time: threeHoursAfter(slot.start_time) || null,
                  partner_id: editingPartner.id,
                  class_group_id: null,
                  contents: plan.training_contents,
                  location: slot.location.trim(),
                  status: sessionStatus,
                  notes: "Cập nhật từ thông tin khách hàng.",
                };
              if (current)
                await patch(`sessions/${current.id}`, sessionPayload);
              else await post("sessions", { ...sessionPayload, attendees: 0 });
            }
            for (const obsolete of currentSessions.filter(
              (session) =>
                (session.session_number || 0) > desiredSchedule.length,
            )) {
              await removeRecord(`sessions/${obsolete.id}`);
            }
            for (const group of classes.filter(
              (group) => group.partner === editingPartner.id,
            )) {
              await removeRecord(`classes/${group.id}`);
            }
          } else {
            const existingGroups = classes.filter(
                (group) => group.partner === editingPartner.id,
              ),
              retainedGroupIds = new Set<number>();
            const removeRecord = async (url: string) => {
              const response = await fetch(`/api/digital-training/${url}`, {
                method: "DELETE",
                headers: auth(),
              });
              if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw Error(
                  body.error || "Không thể đồng bộ dữ liệu tập huấn.",
                );
              }
            };
            for (
              let classIndex = 0;
              classIndex < classPlans.length;
              classIndex += 1
            ) {
              const plan = classPlans[classIndex],
                className = plan.name.trim() || `Lớp ${classIndex + 1}`,
                groupPayload = {
                  partner: editingPartner.id,
                  name: className,
                  members: plan.members,
                  planned_sessions:
                    (Number(plan.planned_sessions) || 0) + sharedSessions,
                  training_contents: plan.training_contents,
                  notes: "",
                };
              const groupItem: TrainingClass = plan.id
                ? await patch(`classes/${plan.id}`, groupPayload)
                : await post("classes", groupPayload);
              retainedGroupIds.add(groupItem.id);
              const currentSessions = sessions.filter(
                  (session) => session.class_group_id === groupItem.id,
                ),
                desiredSchedule = [
                  ...sharedTrainingSchedule,
                  ...plan.training_schedule,
                ];
              for (
                let scheduleIndex = 0;
                scheduleIndex < desiredSchedule.length;
                scheduleIndex += 1
              ) {
                const slot = desiredSchedule[scheduleIndex],
                  sessionNumber = scheduleIndex + 1,
                  isShared = scheduleIndex < sharedSessions,
                  current = currentSessions.find(
                    (session) =>
                      (session.session_number || 0) === sessionNumber,
                  ),
                  sessionStatus =
                    slot.unscheduled || !slot.date
                      ? "unscheduled"
                      : slot.date < today()
                        ? "completed"
                        : "planned",
                  sessionPayload = {
                    // Đồng bộ lịch lớp không được thay đổi người phụ trách đã phân công thủ công.
                    title: `Buổi ${sessionNumber} · ${pd.name} · ${className}`,
                    session_number: sessionNumber,
                    date: slot.unscheduled ? null : slot.date || null,
                    start_time: slot.unscheduled
                      ? null
                      : slot.start_time || null,
                    end_time: threeHoursAfter(slot.start_time) || null,
                    partner_id: editingPartner.id,
                    class_group_id: groupItem.id,
                    contents: plan.training_contents,
                    location: slot.location.trim(),
                    status: sessionStatus,
                    notes: isShared
                      ? "Buổi tập huấn chung áp dụng cho lớp này."
                      : "Cập nhật từ thông tin khách hàng.",
                  };
                if (current)
                  await patch(`sessions/${current.id}`, sessionPayload);
                else
                  await post("sessions", { ...sessionPayload, attendees: 0 });
              }
              for (const obsolete of currentSessions.filter(
                (session) =>
                  (session.session_number || 0) > desiredSchedule.length,
              )) {
                await removeRecord(`sessions/${obsolete.id}`);
              }
            }
            for (const obsoleteGroup of existingGroups.filter(
              (group) => !retainedGroupIds.has(group.id),
            )) {
              await removeRecord(`classes/${obsoleteGroup.id}`);
            }
          }
        }
        appendLogNote(
          `digital-training-partner-${editingPartner.id}`,
          formatChangeLog("Cập nhật Khách hàng", editingPartner, saved),
          userName || "Nhân viên FT Workspace",
          true,
          idToken,
        );
        setModal(null);
        setEditingPartner(null);
        await load();
        setNotice("Đã cập nhật khách hàng và toàn bộ lịch tập huấn.");
        return;
      }
      const trainingEnabled = pd.products.includes("Tập huấn");
      const classPlans = trainingEnabled ? pd.class_plans : [];
      const sharedTrainingSchedule =
        classPlans.length > 1 ? pd.shared_training_schedule : [];
      const sharedSessions =
        classPlans.length > 1 ? Number(pd.shared_sessions) || 0 : 0;
      const firstPlan = classPlans[0];
      const created = await post("partners", {
        name: pd.name,
        partner_type: pd.partner_type,
        partner_subtype: pd.partner_subtype,
        province: pd.province,
        ward: pd.ward,
        address: [pd.ward, pd.province].filter(Boolean).join(", "),
        contact_person: pd.contact_person,
        contact_position: pd.contact_position,
        phone: pd.phone,
        email: pd.email,
        additional_contacts: pd.additional_contacts.filter(
          (contact) =>
            contact.contact_person ||
            contact.position ||
            contact.phone ||
            contact.email,
        ),
        products: pd.products,
        contract_duration: pd.contract_duration
          ? Number(pd.contract_duration)
          : null,
        contract_duration_unit: pd.contract_duration_unit,
        contract_signed_date: pd.contract_signed_date || null,
        contract_status: pd.contract_status,
        budget: pd.budget ? Number(pd.budget) : null,
        ai_account_count: pd.ai_account_count ? Number(pd.ai_account_count) : 0,
        training_location: pd.training_location,
        planned_sessions:
          classPlans.reduce(
            (total, plan) => total + (Number(plan.planned_sessions) || 0),
            0,
          ) + sharedSessions,
        training_contents: firstPlan?.training_contents || [],
        training_content: (firstPlan?.training_contents || []).join(" · "),
        training_schedule: sharedTrainingSchedule,
        contract_start: pd.contract_signed_date || "",
        notes: pd.notes,
      });
      if (classPlans.length === 1) {
        const plan = classPlans[0];
        for (
          let sessionIndex = 0;
          sessionIndex < plan.training_schedule.length;
          sessionIndex += 1
        ) {
          const slot = plan.training_schedule[sessionIndex];
          await post("sessions", {
            // Lịch sinh tự động để trống người phụ trách cho đến khi được phân công.
            title: `Buổi ${sessionIndex + 1} · ${created.name}`,
            session_number: sessionIndex + 1,
            date: slot.unscheduled ? null : slot.date || null,
            start_time: slot.unscheduled ? null : slot.start_time || null,
            end_time: threeHoursAfter(slot.start_time) || null,
            partner_id: created.id,
            class_group_id: null,
            contents: plan.training_contents,
            attendees: 0,
            location: slot.location.trim(),
            status: slot.unscheduled || !slot.date ? "unscheduled" : "planned",
            notes: "Tạo từ đăng ký tập huấn.",
          });
        }
      } else {
        for (
          let classIndex = 0;
          classIndex < classPlans.length;
          classIndex += 1
        ) {
          const plan = classPlans[classIndex],
            className = plan.name.trim() || `Lớp ${classIndex + 1}`,
            classItem = await post("classes", {
              partner: created.id,
              name: className,
              members: plan.members,
              planned_sessions:
                (Number(plan.planned_sessions) || 0) + sharedSessions,
              training_contents: plan.training_contents,
              notes: "",
            });
          for (
            let sharedIndex = 0;
            sharedIndex < sharedTrainingSchedule.length;
            sharedIndex += 1
          ) {
            const sharedSlot = sharedTrainingSchedule[sharedIndex];
            await post("sessions", {
              // Lịch sinh tự động để trống người phụ trách cho đến khi được phân công.
              title: `Buổi ${sharedIndex + 1} · ${created.name} · ${className}`,
              session_number: sharedIndex + 1,
              date: sharedSlot.unscheduled ? null : sharedSlot.date || null,
              start_time: sharedSlot.unscheduled
                ? null
                : sharedSlot.start_time || null,
              end_time: threeHoursAfter(sharedSlot.start_time) || null,
              partner_id: created.id,
              class_group_id: classItem.id,
              contents: plan.training_contents,
              attendees: 0,
              location: sharedSlot.location.trim(),
              status:
                sharedSlot.unscheduled || !sharedSlot.date
                  ? "unscheduled"
                  : "planned",
              notes: "Buổi tập huấn chung áp dụng cho lớp này.",
            });
          }
          for (
            let sessionIndex = 0;
            sessionIndex < plan.training_schedule.length;
            sessionIndex += 1
          ) {
            const slot = plan.training_schedule[sessionIndex];
            await post("sessions", {
              // Lịch sinh tự động để trống người phụ trách cho đến khi được phân công.
              title: `Buổi ${sharedSessions + sessionIndex + 1} · ${created.name} · ${className}`,
              session_number: sharedSessions + sessionIndex + 1,
              date: slot.unscheduled ? null : slot.date || null,
              start_time: slot.unscheduled ? null : slot.start_time || null,
              end_time: threeHoursAfter(slot.start_time) || null,
              partner_id: created.id,
              class_group_id: classItem.id,
              contents: plan.training_contents,
              attendees: 0,
              location: slot.location.trim(),
              status:
                slot.unscheduled || !slot.date ? "unscheduled" : "planned",
              notes: "Tạo từ đăng ký tập huấn.",
            });
          }
        }
      }
      setModal(null);
      await load();
      setNotice(
        `Đã thêm khách hàng${classPlans.length > 1 ? `, ${classPlans.length} lớp/phân nhóm` : ""}${sharedSessions ? ` và ${sharedSessions} buổi tập huấn chung` : ""}.`,
      );
    } catch (e: any) {
      setNotice(e.message);
    }
  };
  const saveClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!can()) return;
    try {
      await post("classes", {
        ...cd,
        partner: Number(cd.partner),
        planned_sessions: Number(cd.planned_sessions),
      });
      setModal(null);
      await load();
      setNotice("Đã thêm lớp/phân nhóm.");
    } catch (e: any) {
      setNotice(e.message);
    }
  };
  const saveSurvey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!can()) return;
    const selectedSession = sessions.find(
      (item) => String(item.id) === sv.session,
    );
    if (!selectedSession) {
      setNotice("Vui lòng chọn lịch tập huấn.");
      return;
    }
    try {
      const payload = {
        title: sv.title,
        form_type: sv.form_type,
        session: selectedSession.id,
        notes: sv.notes,
      };
      if (editingSurvey) await patch(`surveys/${editingSurvey.id}`, payload);
      else await post("surveys", payload);
      setModal(null);
      setEditingSurvey(null);
      await load();
      setNotice(
        editingSurvey ? "Đã cập nhật form khảo sát." : "Đã tạo form khảo sát.",
      );
    } catch (e: any) {
      setNotice(e.message);
    }
  };
  const saveMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!can()) return;
    try {
      const b = new FormData();
      Object.entries(md).forEach(([k, v]) => {
        if ((k === "session" || k === "partner") && !v) return;
        b.append(k, v);
      });
      if (file) b.append("file", file);
      const r = await fetch("/api/digital-training/materials", {
          method: "POST",
          headers: auth(),
          body: b,
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error || "Không thể lưu tài liệu.");
      setModal(null);
      setFile(null);
      await load();
      setNotice("Đã thêm tài liệu.");
    } catch (e: any) {
      setNotice(e.message);
    }
  };
  const sessionDateMatches = (date?: string | null) => {
    if (!sessionTimeFilter) return true;
    if (!date) return false;
    const value = new Date(`${date}T00:00:00`);
    const now = new Date();
    const dayStart = (source: Date) =>
      new Date(source.getFullYear(), source.getMonth(), source.getDate());
    const isoDate = (source: Date) => localDateKey(source);
    const sameDay = (a: Date, b: Date) => isoDate(a) === isoDate(b);
    const weekStart = (source: Date) => {
      const result = dayStart(source);
      result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
      return result;
    };
    if (sessionTimeFilter === "today") return sameDay(value, now);
    if (sessionTimeFilter === "yesterday") {
      const previous = dayStart(now);
      previous.setDate(previous.getDate() - 1);
      return sameDay(value, previous);
    }
    if (sessionTimeFilter === "this-week") {
      const start = weekStart(now),
        end = new Date(start);
      end.setDate(end.getDate() + 6);
      return value >= start && value <= end;
    }
    if (sessionTimeFilter === "last-week") {
      const end = weekStart(now);
      end.setDate(end.getDate() - 1);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      return value >= start && value <= end;
    }
    if (sessionTimeFilter === "this-month")
      return (
        value.getFullYear() === now.getFullYear() &&
        value.getMonth() === now.getMonth()
      );
    if (sessionTimeFilter === "last-month") {
      const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return (
        value.getFullYear() === previous.getFullYear() &&
        value.getMonth() === previous.getMonth()
      );
    }
    if (sessionTimeFilter === "custom")
      return (
        (!sessionDateFrom || date >= sessionDateFrom) &&
        (!sessionDateTo || date <= sessionDateTo)
      );
    return true;
  };
  const reportPeriodLabel = (() => {
    if (sessionTimeFilter === "custom") {
      if (sessionDateFrom && sessionDateTo)
        return `Từ ${showDate(sessionDateFrom)} đến ${showDate(sessionDateTo)}`;
      if (sessionDateFrom) return `Từ ${showDate(sessionDateFrom)}`;
      if (sessionDateTo) return `Đến ${showDate(sessionDateTo)}`;
      return "Khoảng ngày tùy chỉnh";
    }
    return (
      (
        {
          today: "Hôm nay",
          yesterday: "Hôm qua",
          "this-week": "Tuần này",
          "last-week": "Tuần trước",
          "this-month": relativeMonthLabel(),
          "last-month": relativeMonthLabel(-1),
        } as Record<string, string>
      )[sessionTimeFilter] || "Tất cả thời gian"
    );
  })();
  const normalizeEmail = (value?: string) =>
      String(value || "")
        .trim()
        .toLocaleLowerCase("vi-VN"),
    normalizePhone = (value?: string) => String(value || "").replace(/\D/g, "");
  const meetingPartner = (item: CustomerMeeting) =>
    partners.find(
      (customer) =>
        (normalizeEmail(item.email) &&
          normalizeEmail(customer.email) === normalizeEmail(item.email)) ||
        (normalizePhone(item.phone) &&
          normalizePhone(customer.phone) === normalizePhone(item.phone)),
    );
  const workActivities = useMemo<WorkActivity[]>(
    () => [
      ...sessions.map((item) => ({
        key: `training-${item.id}`,
        sourceId: item.id,
        kind: "training" as const,
        title:
          item.class_group_id &&
          classes.filter((group) => group.partner === item.partner_id).length <=
            1
            ? item.title.replace(/\s*·\s*Lớp\s+\d+\s*$/, "")
            : item.title,
        date: item.date,
        start_time: item.start_time,
        end_time: item.end_time,
        customerId: item.partner_id,
        customerName: item.partner_name || item.partner || "—",
        className:
          item.class_group_id &&
          classes.filter((group) => group.partner === item.partner_id).length >
            1
            ? item.class_group_name || "—"
            : "—",
        activityLabel: item.session_number
          ? `Buổi ${item.session_number}`
          : "Tập huấn",
        content: (item.contents || []).join(" · ") || item.category || "—",
        location: item.location || "—",
        status: item.status,
        staffName: item.staff_name || "",
        instructorName: item.instructor_name || "",
        supportStaffName: item.support_staff_name || "",
        attendees: item.attendees,
      })),
      ...meetings.map((item) => {
        const isOther = item.schedule_type === "other",
          customer = isOther ? undefined : meetingPartner(item);
        return {
          key: `${isOther ? "other" : "meeting"}-${item.id}`,
          sourceId: item.id,
          kind: isOther ? ("other" as const) : ("meeting" as const),
          title: item.title,
          date: item.date,
          start_time: item.start_time,
          end_time: item.end_time,
          customerId: customer?.id || null,
          customerName: isOther
            ? item.customer_type || "—"
            : customer?.name || item.title,
          className: "—",
          activityLabel: isOther
            ? item.activity_type || "Khác"
            : "Gặp Khách hàng mới",
          content: item.content || "—",
          location: item.location || "—",
          status: item.status || "planned",
          staffName: item.staff_name || "",
        };
      }),
    ],
    [sessions, meetings, partners],
  );
  const calendarActivity = calendarDetail
    ? workActivities.find(
        (item) =>
          item.kind === calendarDetail.kind &&
          item.sourceId === calendarDetail.sourceId,
      )
    : undefined;
  const activeProductNames = useMemo(
    () => productCatalog.filter((item) => item.active).map((item) => item.name),
    [productCatalog],
  );
  const employeeOptions = useMemo(
    () =>
      Array.from(new Set(employees.map((item) => item.name.trim()).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b, "vi"),
      ),
    [employees],
  );
  const sessionStaffOptions = useMemo(
    () =>
      Array.from(
        new Set(
          workActivities.map((item) => item.staffName.trim()).filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, "vi")),
    [workActivities],
  );
  const reportActivities = workActivities.filter(
    (item) =>
      (!query ||
        [
          item.title,
          item.customerName,
          item.className,
          item.content,
          item.location,
          item.staffName,
        ]
          .join(" ")
          .toLocaleLowerCase("vi-VN")
          .includes(query.toLocaleLowerCase("vi-VN"))) &&
      (!filter || item.status === filter) &&
      (!sessionPartnerTypeFilter ||
        partners.find((partner) => partner.id === Number(item.customerId))
          ?.partner_type === sessionPartnerTypeFilter) &&
      (!sessionPartnerFilter ||
        String(item.customerId || "") === sessionPartnerFilter) &&
      (!sessionFilter || item.key === sessionFilter) &&
      (!sessionStaffFilter || item.staffName === sessionStaffFilter) &&
      sessionDateMatches(item.date),
  );
  const reportDistribution = [
    {
      name: "Lịch tập huấn",
      value: reportActivities.filter((item) => item.kind === "training").length,
      color: "#0055DA",
    },
    {
      name: "Gặp Khách hàng",
      value: reportActivities.filter((item) => item.kind === "meeting").length,
      color: "#00C68D",
    },
    {
      name: "Khác",
      value: reportActivities.filter((item) => item.kind === "other").length,
      color: "#FFD400",
    },
  ];
  const conversionSnapshot = (() => {
    const scopedMeetings = meetings.filter(
      (item) =>
        item.schedule_type !== "other" &&
        item.status !== "cancelled" &&
        sessionDateMatches(item.date),
    );
    const scopedTraining = sessions.filter(
      (item) =>
        item.status !== "cancelled" &&
        !!item.partner_id &&
        sessionDateMatches(item.date),
    );
    const convertedIds = new Set<number>();
    const reasons = new Map<number, string[]>();
    scopedTraining.forEach((item) => {
      if (!item.partner_id) return;
      convertedIds.add(item.partner_id);
      reasons.set(item.partner_id, [
        ...(reasons.get(item.partner_id) || []),
        "Có lịch tập huấn trong kỳ",
      ]);
    });
    partners.forEach((item) => {
      const createdDate = item.created_at?.slice(0, 10);
      if (createdDate && sessionDateMatches(createdDate)) {
        convertedIds.add(item.id);
        reasons.set(item.id, [
          ...(reasons.get(item.id) || []),
          "Trở thành Khách hàng trong kỳ",
        ]);
      }
    });
    const eligible = new Set<string>();
    scopedMeetings.forEach((item) => {
      const customer = meetingPartner(item);
      if (
        !sessionPartnerFilter ||
        String(customer?.id || "") === sessionPartnerFilter
      )
        eligible.add(
          customer
            ? `customer-${customer.id}`
            : normalizeEmail(item.email)
              ? `email-${normalizeEmail(item.email)}`
              : normalizePhone(item.phone)
                ? `phone-${normalizePhone(item.phone)}`
                : `meeting-${item.id}`,
        );
    });
    convertedIds.forEach((id) => {
      if (!sessionPartnerFilter || String(id) === sessionPartnerFilter)
        eligible.add(`customer-${id}`);
    });
    const converted = partners
      .filter(
        (item) =>
          convertedIds.has(item.id) &&
          (!sessionPartnerFilter || String(item.id) === sessionPartnerFilter),
      )
      .map((item) => ({
        item,
        reasons: Array.from(new Set(reasons.get(item.id) || [])),
      }));
    return {
      eligible: eligible.size,
      converted,
      rate: eligible.size
        ? Math.round((converted.length * 1000) / eligible.size) / 10
        : 0,
    };
  })();
  const partner = partners.find((x) => x.id === selected);
  const partnerProducts = partner ? partnerProductSubscriptions.filter((item) => item.partner === partner.id) : [];
  const hasTrainingProduct = !!partner && (
    partner.planned_sessions > 0 || partnerProducts.some((item) => item.product_code === "tap-huan")
  );
  const productSubscriptionStatus = (value?: string) => ({ active: "\u0110ang s\u1eed d\u1ee5ng", expiring: "S\u1eafp h\u1ebft h\u1ea1n", expired: "\u0110\u00e3 h\u1ebft h\u1ea1n", paused: "T\u1ea1m d\u1eebng", cancelled: "\u0110\u00e3 h\u1ee7y" }[value || ""] || "Ch\u01b0a c\u1eadp nh\u1eadt");
  const surveyDetail = surveys.find((x) => x.id === selectedSurvey);
  const partnerWardOptions = Array.from(
    new Set(
      partners
        .filter(
          (item) =>
            (!partnerManagementTypeFilter ||
              item.partner_type === partnerManagementTypeFilter) &&
            (!partnerManagementSubtypeFilter ||
              item.partner_subtype === partnerManagementSubtypeFilter) &&
            (!partnerProvinceFilter || item.province === partnerProvinceFilter),
        )
        .map((item) => item.ward || "")
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, "vi"));
  const partnerTypeOptions = Array.from(
    new Set(partners.map((item) => item.partner_type || "").filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, "vi"));
  const partnerManagementSubtypeOptions = Array.from(
    new Set([
      ...(partnerSubtypeCatalog[partnerManagementTypeFilter] || []),
      ...partners
        .filter((item) => item.partner_type === partnerManagementTypeFilter)
        .map((item) => item.partner_subtype || "")
        .filter(Boolean),
    ]),
  ).sort((a, b) => a.localeCompare(b, "vi"));
  const matchesPartnerType = (
    partnerId: number | string | null | undefined,
    partnerType: string,
  ) =>
    !partnerType ||
    partners.find((item) => item.id === Number(partnerId))?.partner_type ===
      partnerType;
  const contractStatusLabel = (value?: string) =>
    ({
      signed: "Đã ký",
      paid: "Đã thanh toán",
      not_signed: "Chưa ký",
      negotiating: "Đang thương thảo",
      expiring: "Sắp hết hạn",
      expired: "Hết hạn",
    })[value || ""] || "Chưa cập nhật";
  const contractExpiry = (item: Partner) => {
    if (!item.contract_signed_date || !item.contract_duration) return null;
    const expiry = new Date(`${item.contract_signed_date}T00:00:00`);
    if (item.contract_duration_unit === "year")
      expiry.setFullYear(expiry.getFullYear() + item.contract_duration);
    else expiry.setMonth(expiry.getMonth() + item.contract_duration);
    return localDateKey(expiry);
  };
  const contractTiming = (item: Partner) => {
    const expiry = contractExpiry(item);
    if (!expiry)
      return {
        expiry: "",
        label: "Chưa đủ ngày ký và thời hạn",
        expired: false,
        days: null as number | null,
      };
    const days = Math.ceil(
      (new Date(`${expiry}T00:00:00`).getTime() -
        new Date(`${today()}T00:00:00`).getTime()) /
        86400000,
    );
    return {
      expiry,
      label:
        days < 0
          ? `Đã quá hạn ${Math.abs(days)} ngày`
          : days === 0
            ? "Hết hạn hôm nay"
            : `Còn ${days} ngày`,
      expired: days <= 0,
      days,
    };
  };
  const effectiveContractStatus = (item: Partner) => {
    const timing = contractTiming(item);
    return timing.expired
      ? "expired"
      : timing.days !== null && timing.days <= 30
        ? "expiring"
        : item.contract_status;
  };
  const formatBudget = (value?: number | null) =>
    value === null || value === undefined
      ? "Chưa cập nhật"
      : `${Number(value).toLocaleString("vi-VN")} VNĐ`;
  const saveRenewal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partner || !can()) return;
    try {
      await patch(`partners/${partner.id}`, {
        contract_signed_date: renewal.contract_signed_date,
        contract_duration: Number(renewal.contract_duration),
        contract_duration_unit: renewal.contract_duration_unit,
        contract_status: "signed",
        contract_start: renewal.contract_signed_date,
      });
      setModal(null);
      await load();
      setNotice("Đã gia hạn hợp đồng.");
    } catch (e: any) {
      setNotice(e.message);
    }
  };
  const partnerProgressStatus = (item: Partner) => {
    const completed = sessions.filter(
      (x) => x.partner_id === item.id && x.status === "completed",
    ).length;
    return item.planned_sessions > 0 && completed >= item.planned_sessions
      ? "completed"
      : "active";
  };
  const trainingContentsForGroup = (group: TrainingClass) =>
    group.training_contents?.length
      ? group.training_contents
      : sessions.find(
          (item) => item.class_group_id === group.id && item.contents?.length,
        )?.contents || [];
  const trainingContentsForPartner = (partnerId: number) =>
    Array.from(
      new Set([
        ...classes
          .filter((group) => group.partner === partnerId)
          .flatMap(trainingContentsForGroup),
        ...(partners.find((item) => item.id === partnerId)?.training_contents ||
          []),
      ]),
    );
  const trainingContentOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...classes.flatMap(trainingContentsForGroup),
          ...partners.flatMap((item) => item.training_contents || []),
        ]),
      ).sort((a, b) => a.localeCompare(b, "vi")),
    [partners, classes, sessions],
  );
  const displayedPartners = useMemo(
    () =>
      partners.filter((item) => {
        const hasTrainingRegistration =
          item.planned_sessions > 0 ||
          (item.training_schedule || []).length > 0 ||
          classes.some(
            (group) => group.partner === item.id && group.planned_sessions > 0,
          ) ||
          sessions.some((session) => session.partner_id === item.id);
        if (!hasTrainingRegistration) return false;
        const partnerContents = trainingContentsForPartner(item.id);
        const searchable = [
          item.name,
          item.address,
          item.contact_person,
          ...partnerContents,
          ...(item.products || []),
        ]
          .join(" ")
          .toLocaleLowerCase("vi-VN");
        const matchesQuery =
          !query || searchable.includes(query.toLocaleLowerCase("vi-VN"));
        const matchesPartnerType =
          !trackingPartnerTypeFilter ||
          item.partner_type === trackingPartnerTypeFilter;
        const matchesPartner =
          !trackingPartnerFilter || item.id === Number(trackingPartnerFilter);
        const matchesContent =
          !trackingContentFilter ||
          partnerContents.includes(trackingContentFilter);
        const matchesProgress =
          !partnerProgress || partnerProgressStatus(item) === partnerProgress;
        const matchesContract =
          !partnerContract || effectiveContractStatus(item) === partnerContract;
        return (
          matchesQuery &&
          matchesPartnerType &&
          matchesPartner &&
          matchesContent &&
          matchesProgress &&
          matchesContract
        );
      }),
    [
      partners,
      classes,
      query,
      trackingPartnerTypeFilter,
      trackingPartnerFilter,
      trackingContentFilter,
      partnerContract,
      partnerProgress,
      sessions,
    ],
  );
  const managementPartners = useMemo(
    () =>
      partners.filter(
        (item) =>
          (!query ||
            [
              item.name,
              item.address,
              item.province,
              item.ward,
              item.contact_person,
              item.phone,
              item.email,
              ...(item.products || []),
            ]
              .join(" ")
              .toLocaleLowerCase("vi-VN")
              .includes(query.toLocaleLowerCase("vi-VN"))) &&
          (!partnerManagementTypeFilter ||
            item.partner_type === partnerManagementTypeFilter) &&
          (!partnerManagementSubtypeFilter ||
            item.partner_subtype === partnerManagementSubtypeFilter) &&
          (!partnerManagementFilter ||
            item.id === Number(partnerManagementFilter)) &&
          (!partnerProvinceFilter || item.province === partnerProvinceFilter) &&
          (!partnerWardFilter || item.ward === partnerWardFilter) &&
          (!partnerStatusFilter ||
            effectiveContractStatus(item) === partnerStatusFilter),
      ),
    [
      partners,
      query,
      partnerManagementTypeFilter,
      partnerManagementSubtypeFilter,
      partnerManagementFilter,
      partnerProvinceFilter,
      partnerWardFilter,
      partnerStatusFilter,
    ],
  );
  const scheduleDraftFromSession = (
    item?: Session,
    legacyLocation = "",
  ): TrainingScheduleDraft =>
    item && item.status !== "cancelled"
      ? {
          date: item.date || "",
          start_time: (item.start_time || "").slice(0, 5),
          location: item.location || legacyLocation,
          unscheduled: item.status === "unscheduled" || !item.date,
        }
      : {
          date: "",
          start_time: "",
          location: legacyLocation,
          unscheduled: true,
        };
  const openPartnerEditor = (item: Partner) => {
    const partnerClasses = classes.filter((group) => group.partner === item.id);
    const storedShared = (item.training_schedule || []).map((slot) => ({
      date: slot.date || "",
      start_time: (slot.start_time || "").slice(0, 5),
      location: slot.location || item.training_location || "",
      unscheduled: !!slot.unscheduled || !slot.date,
    }));
    const sharedFromNotes = sessions
      .filter(
        (session) =>
          session.partner_id === item.id && session.notes?.includes("chung"),
      )
      .reduce(
        (maximum, session) => Math.max(maximum, session.session_number || 0),
        0,
      );
    const sharedCount = Math.max(storedShared.length, sharedFromNotes);
    const firstClassSessions = partnerClasses[0]
      ? sessions.filter(
          (session) => session.class_group_id === partnerClasses[0].id,
        )
      : [];
    const sharedSchedule = Array.from({ length: sharedCount }, (_, index) => {
      const current = firstClassSessions.find(
        (session) => (session.session_number || 0) === index + 1,
      );
      return current
        ? scheduleDraftFromSession(current, item.training_location || "")
        : storedShared[index] || newTrainingSchedule();
    });
    const sourceGroups = partnerClasses.length
      ? partnerClasses
      : [
          {
            id: 0,
            partner: item.id,
            name: "",
            members: "",
            planned_sessions: Math.max(0, item.planned_sessions - sharedCount),
            completed_sessions: 0,
            notes: "",
          },
        ];
    const plans = sourceGroups.map((group, index) => {
      const groupItems = sessions
        .filter((session) =>
          group.id
            ? session.class_group_id === group.id
            : session.partner_id === item.id && !session.class_group_id,
        )
        .sort(
          (a, b) =>
            (a.session_number || 999) - (b.session_number || 999) ||
            a.id - b.id,
        );
      const individualCount = Math.max(0, group.planned_sessions - sharedCount);
      const trainingSchedule = Array.from(
        { length: individualCount },
        (_, slot) =>
          scheduleDraftFromSession(
            groupItems.find(
              (session) =>
                (session.session_number || 0) === sharedCount + slot + 1,
            ),
            item.training_location || "",
          ),
      );
      const contents = group.training_contents?.length
        ? group.training_contents
        : groupItems.find((session) => session.contents?.length)?.contents ||
          item.training_contents ||
          [];
      return {
        id: group.id || undefined,
        name: group.name || "",
        members: group.members || "",
        planned_sessions: String(individualCount),
        training_contents: contents,
        training_schedule: trainingSchedule,
        planned_sessions_custom: index > 0,
        training_contents_custom: index > 0,
      };
    });
    const products = item.products || [];
    setPd({
      ...newPartnerDraft(),
      name: item.name,
      partner_type: item.partner_type || "",
      partner_subtype: item.partner_subtype || "",
      province:
        item.province ||
        (item.partner_type === "Khối Giáo dục" ||
        (item.partner_type === "Khối Hành chính công" &&
          item.partner_subtype === "Khối Xã/Phường")
          ? "Hà Nội"
          : ""),
      ward: item.ward || "",
      contact_person: item.contact_person || "",
      contact_position: item.contact_position || "",
      phone: item.phone || "",
      email: item.email || "",
      additional_contacts: item.additional_contacts || [],
      products:
        partnerClasses.length && !products.includes("Tập huấn")
          ? [...products, "Tập huấn"]
          : products,
      contract_duration:
        item.contract_duration === null || item.contract_duration === undefined
          ? ""
          : String(item.contract_duration),
      contract_duration_unit: item.contract_duration_unit || "month",
      contract_signed_date: item.contract_signed_date || "",
      contract_status: item.contract_status || "not_signed",
      budget:
        item.budget === null || item.budget === undefined
          ? ""
          : String(item.budget),
      ai_account_count:
        item.ai_account_count === null || item.ai_account_count === undefined
          ? ""
          : String(item.ai_account_count),
      training_location: item.training_location || "",
      class_count: String(plans.length),
      shared_sessions: String(sharedCount),
      shared_training_schedule: sharedSchedule,
      class_plans: plans,
      notes: item.notes || "",
    });
    setEditingPartner(item);
    setModal("partner");
  };
  const removePartner = async () => {
    if (!deletePartner || !can()) return;
    try {
      const response = await fetch(
        `/api/digital-training/partners/${deletePartner.id}`,
        { method: "DELETE", headers: auth() },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw Error(body.error || "Không thể xóa khách hàng.");
      }
      setDeletePartner(null);
      await load();
      setNotice("Đã xóa khách hàng.");
    } catch (error: any) {
      setNotice(error.message);
    }
  };
  const removeSurvey = async () => {
    if (!deleteSurvey || !can()) return;
    try {
      const response = await fetch(
        `/api/digital-training/surveys/${deleteSurvey.id}`,
        { method: "DELETE", headers: auth() },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw Error(body.error || "Không thể xóa phiếu khảo sát.");
      }
      setDeleteSurvey(null);
      if (selectedSurvey === deleteSurvey.id) go("survey");
      await load();
      setNotice("Đã xóa phiếu khảo sát.");
    } catch (error: any) {
      setNotice(error.message);
    }
  };
  const removeActivity = async () => {
    if (!deleteActivity || !can()) return;
    try {
      const endpoint =
        deleteActivity.kind === "training" ? "sessions" : "customer-meetings";
      const response = await fetch(
        `/api/digital-training/${endpoint}/${deleteActivity.sourceId}`,
        { method: "DELETE", headers: auth() },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw Error(body.error || "Không thể xóa lịch công tác.");
      }
      setDeleteActivity(null);
      setCalendarDetail(null);
      await load();
      setNotice("Đã xóa lịch công tác.");
    } catch (error: any) {
      setNotice(error.message);
    }
  };
  const removeMaterial = async () => {
    if (!deleteMaterial || !can()) return;
    try {
      const response = await fetch(
        `/api/digital-training/materials/${deleteMaterial.id}`,
        { method: "DELETE", headers: auth() },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw Error(body.error || "Không thể xóa tài liệu.");
      }
      setDeleteMaterial(null);
      await load();
      setNotice("Đã xóa tài liệu.");
    } catch (error: any) {
      setNotice(error.message);
    }
  };
  const groupsFor = (partnerId: number) => {
    const item = partners.find((x) => x.id === partnerId),
      list = classes.filter((x) => x.partner === partnerId);
    return list.length
      ? list
      : [
          {
            id: 0,
            partner: partnerId,
            name: "Chưa phân nhóm",
            members: "",
            planned_sessions: item?.planned_sessions || 0,
            training_contents: item?.training_contents || [],
            completed_sessions: 0,
            notes: "",
          },
        ];
  };
  const maxSessionColumns = Math.max(
    1,
    ...displayedPartners.flatMap((p) =>
      groupsFor(p.id).map((g) => g.planned_sessions),
    ),
  );
  const showClassName = (group: TrainingClass) =>
    classes.filter((item) => item.partner === group.partner).length > 1 &&
    !["Lớp chung", "Nhóm chung", "Chưa phân nhóm"].includes(group.name);
  const groupSessions = (group: TrainingClass, partnerId: number) =>
    sessions
      .filter((x) =>
        group.id
          ? x.class_group_id === group.id
          : x.partner_id === partnerId && !x.class_group_id,
      )
      .sort(
        (a, b) =>
          // Historical imports may contain duplicate session numbers.  Prefer
          // the record that has an actual date over a later blank placeholder,
          // so the progress table remains correct until the server cleans it.
          Number(Boolean(b.date)) - Number(Boolean(a.date)) ||
          Number(Boolean(b.start_time)) - Number(Boolean(a.start_time)) ||
          ({ completed: 3, planned: 2, unscheduled: 1, cancelled: 0 }[b.status] || 0) -
            ({ completed: 3, planned: 2, unscheduled: 1, cancelled: 0 }[a.status] || 0) ||
          (a.session_number || 999) - (b.session_number || 999) ||
          String(a.date || "").localeCompare(String(b.date || "")) ||
          a.id - b.id,
      );
  const sessionCell = (
    group: TrainingClass,
    partnerId: number,
    index: number,
  ) => {
    const item =
      groupSessions(group, partnerId).find(
        (x) => (x.session_number || 0) === index,
      ) ||
      (!groupSessions(group, partnerId).some((x) => x.session_number) &&
        groupSessions(group, partnerId)[index - 1]);
    if (item) {
      const attendeeLabel = item.attendees ? ` · ${item.attendees.toLocaleString("vi-VN")} người` : "";
      return item.status === "completed"
        ? `Đã hoàn thành: ${showDate(item.date || undefined)}${attendeeLabel}`
        : item.status === "cancelled"
          ? `Đã hủy: ${showDate(item.date || undefined)}${attendeeLabel}`
          : item.status === "unscheduled"
            ? "Chưa có lịch"
            : `Đã lên lịch: ${showDate(item.date || undefined)}${attendeeLabel}`;
    }
    return index <= group.planned_sessions ? "Chưa có lịch" : "";
  };
  const sessionCellType = (
    group: TrainingClass,
    partnerId: number,
    index: number,
  ) => {
    const item =
      groupSessions(group, partnerId).find(
        (x) => (x.session_number || 0) === index,
      ) ||
      (!groupSessions(group, partnerId).some((x) => x.session_number) &&
        groupSessions(group, partnerId)[index - 1]);
    return item
      ? item.status
      : index <= group.planned_sessions
        ? "missing"
        : "empty";
  };
  const sessionOrdinal = (item: Session) =>
    item.class_group_id
      ? groupSessions(
          classes.find((x) => x.id === item.class_group_id) || {
            id: 0,
            partner: item.partner_id || 0,
            name: "",
            members: "",
            planned_sessions: 0,
            completed_sessions: 0,
            notes: "",
          },
          item.partner_id || 0,
        ).findIndex((x) => x.id === item.id) + 1
      : 0;
  const sessionMaximum = (item: Session) => {
    const group = item.class_group_id
      ? classes.find((x) => x.id === item.class_group_id)
      : null;
    const shared = item.partner_id
      ? (
          partners.find((x) => x.id === item.partner_id)?.training_schedule ||
          []
        ).length
      : 0;
    return group?.planned_sessions || shared || item.session_number || 0;
  };
  const saveProductSubscription = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingProductSubscription || !can()) return;
    try {
      const saved = await patch(`product-subscriptions/${editingProductSubscription.id}`, {
        quantity: Number(editingProductSubscription.quantity || 1),
        starts_at: editingProductSubscription.starts_at || null,
        expires_at: editingProductSubscription.product_code === "tap-huan" ? null : editingProductSubscription.expires_at || null,
        status: editingProductSubscription.status,
        notes: editingProductSubscription.notes || "",
      });
      setPartnerProductSubscriptions((current) => current.map((item) => item.id === saved.id ? saved : item));
      setEditingProductSubscription(null);
      setNotice("Đã cập nhật thời hạn sản phẩm.");
    } catch (error: any) {
      setNotice(error.message);
    }
  };
  // The vertical rail owns application switching, so this module only lists its
  // own tasks - horizontally, above the content.
  const moduleNavItems = useMemo(
    () => DIGITAL_TRAINING_NAV.filter((item) => item.requires !== "finance" || canViewFinance),
    [canViewFinance],
  );
  const moduleNavActiveId =
    tab === "products"
      ? `products-${productView}`
      : tab === "partners"
        ? "products-allocation"
        : tab;
  const selectModuleNav = (id: string) => {
    if (id === "training-assessments") {
      onOpenTrainingAssessment();
      return;
    }
    if (id.startsWith("products-")) {
      goProduct(id.replace("products-", "") as ProductView);
      return;
    }
    go(id as Tab);
  };

  return (
    <div className="ft-module-shell flex min-h-screen flex-col text-slate-800">
      <div className="sticky top-0 z-30">
        <header className="ft-module-header flex items-center justify-between gap-3 border-b px-4 py-3 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/logo.png" alt="FermatTech" className="h-8 shrink-0 object-contain" />
            <div className="min-w-0">
              <p className="text-[11px] font-extrabold uppercase tracking-[.14em] text-sky-600">
                FermatTech Workspace
              </p>
              <h1 className="truncate text-lg font-extrabold text-[#0b4275]">
                Công nghệ &amp; đào tạo số
              </h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onBackToWorkspace}
              className="ft-btn ft-btn-secondary hidden text-xs sm:inline-flex"
            >
              <ArrowLeft className="h-4 w-4" />
              Workspace
            </button>
            <AccountMenu
              userName={userName}
              userRole={userRole}
              photoURL={photoURL}
              isGuest={isGuest}
              onAccountClick={onAccountClick}
              onLogout={onLogout}
              variant="avatar"
            />
          </div>
        </header>
        <ModuleTopNav
          items={moduleNavItems}
          activeId={moduleNavActiveId}
          onSelect={selectModuleNav}
          ariaLabel="Điều hướng Công nghệ & đào tạo số"
        />
      </div>
      <main className="min-w-0 flex-1">
        <div className="ft-module-content mx-auto p-5 md:p-7">
          {/* BNDC loads its own data, so it does not wait for the module fetch. */}
          {tab === "bndc" ? (
            <React.Suspense
              fallback={
                <p className="py-16 text-center text-sm font-semibold text-slate-500">
                  Đang nạp Quản lý BNDC...
                </p>
              }
            >
              <BndcWorkspace userRole={userRole} idToken={idToken} />
            </React.Suspense>
          ) : loading ? (
            <div className="py-20 text-center text-sm text-slate-500">
              Đang tải dữ liệu...
            </div>
          ) : (
            <>
              {tab === "overview" && (
                <TrainingOverview
                  sessions={sessions}
                  meetings={meetings}
                  partners={partners}
                  idToken={idToken}
                  onOpenCalendar={() => go("calendar")}
                  onOpenPartners={() => go("partners")}
                  onOpenProducts={() => go("products")}
                />
              )}
              {tab === "calendar" && !calendarDetail && (
                <section className="dt-calendar-page mt-1 rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
                  <Calendar
                    actions={
                      <div className="dt-calendar-actions">
                        <div className="flex rounded-lg border border-sky-200 bg-sky-50 p-1">
                          {(["week", "month"] as Mode[]).map((x) => (
                            <button
                              key={x}
                              onClick={() => setMode(x)}
                              className={
                                "rounded px-3 py-1.5 text-xs font-bold " +
                                (mode === x
                                  ? "bg-sky-600 text-white shadow-sm"
                                  : "text-slate-600 hover:bg-white")
                              }
                            >
                              {
                                (
                                  { week: "Tuần", month: "Tháng" } as Record<
                                    Mode,
                                    string
                                  >
                                )[x]
                              }
                            </button>
                          ))}
                        </div>
                        {!isGuest && (
                          <CreateScheduleMenu
                            onTraining={() => openTraining(today())}
                            onNewMeeting={() => openMeeting(today())}
                            onExistingMeeting={() => openMeeting(today())}
                            onOther={() => openOther(today())}
                          />
                        )}
                      </div>
                    }
                    mode={mode}
                    onModeChange={setMode}
                    sessions={[
                      ...sessions.map((item) => {
                        const partner = partners.find(
                          (candidate) => candidate.id === item.partner_id,
                        );
                        const contents = (item.contents || []).filter(Boolean);
                        const fallbackContents = (partner?.training_contents || []).filter(Boolean);
                        return {
                          ...item,
                          // Automatically generated schedules may have been
                          // created before per-session details were stored.
                          // Keep them as informative as a manually created
                          // schedule by inheriting the customer's defaults.
                          content:
                            contents.join("\n") ||
                            item.category ||
                            fallbackContents.join("\n") ||
                            partner?.training_content ||
                            "",
                          location:
                            item.location || partner?.training_location || "",
                          staff_name:
                            item.staff_name || partner?.training_staff || "",
                        };
                      }),
                      ...(() => {
                        const seenMeetings = new Set<string>();
                        return meetings.filter((item) => {
                          const key = `${item.schedule_type}|${item.title}|${item.date}|${item.start_time ?? ""}|${item.end_time ?? ""}|${item.staff_name ?? ""}`;
                          if (seenMeetings.has(key)) return false;
                          seenMeetings.add(key);
                          return true;
                        }).map((item) => ({
                          id: `${item.schedule_type === "other" ? "other" : "meeting"}-${item.id}`,
                          title: item.title,
                          date: item.date,
                          start_time: item.start_time,
                          end_time: item.end_time,
                          location: item.location,
                          staff_name: item.staff_name,
                          content: item.content,
                          status: item.status,
                          kind:
                            item.schedule_type === "other"
                              ? ("other" as const)
                              : ("meeting" as const),
                        }));
                      })(),
                    ]}
                    onPick={
                      isGuest
                        ? () =>
                            setNotice("Chế độ Khách chỉ có thể xem dữ liệu.")
                        : pick
                    }
                    onOpen={openCalendarItem}
                    onMove={
                      isGuest
                        ? () =>
                            setNotice("Chế độ Khách chỉ có thể xem dữ liệu.")
                        : moveCalendarItem
                    }
                  />
                </section>
              )}
              {tab === "calendar" && calendarDetail && calendarActivity && (
                <WorkScheduleDetail
                  activity={calendarActivity}
                  canWrite={!!idToken && !isGuest}
                  actor={userName}
                  idToken={idToken}
                  onBack={() => go("calendar")}
                  onEdit={() => {
                    if (calendarActivity.kind === "training") {
                      const item = sessions.find(
                        (entry) => entry.id === calendarActivity.sourceId,
                      );
                      if (item) openSessionEditor(item);
                    } else {
                      const item = meetings.find(
                        (entry) => entry.id === calendarActivity.sourceId,
                      );
                      if (item) openMeetingEditor(item);
                    }
                  }}
                  onCancel={() => cancelCalendarActivity(calendarDetail)}
                  onDelete={() => setDeleteActivity(calendarActivity)}
                />
              )}{" "}
              {tab === "sessions" && (
                <section className="mt-6 space-y-5">
                  <article className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                      <div>
                        <h2 className="text-xl font-extrabold">
                          Báo cáo lịch công tác · {reportPeriodLabel}
                        </h2>
                        <p className="mt-1 text-sm text-slate-500">
                          Tổng quan lịch công tác theo thời gian, loại lịch,
                          Khách hàng và nhân viên.
                        </p>
                      </div>
                      {!isGuest && (
                        <CreateScheduleMenu
                          onTraining={() => openTraining(today())}
                          onNewMeeting={() => openMeeting(today())}
                            onExistingMeeting={() => openMeeting(today())}
                          onOther={() => openOther(today())}
                        />
                      )}
                    </div>
                    <div className="border-y p-4">
                      <label className="relative block w-full">
                        <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Tìm lịch công tác, Khách hàng, nội dung hoặc nhân viên..."
                          className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm"
                        />
                      </label>
                    </div>
                    <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-6">
                      <select
                        value={sessionTimeFilter}
                        onChange={(e) => {
                          setSessionTimeFilter(e.target.value);
                          if (e.target.value !== "custom") {
                            setSessionDateFrom("");
                            setSessionDateTo("");
                          }
                        }}
                        className="rounded-lg border px-3 py-2 text-sm"
                      >
                        <option value="today">Hôm nay</option>
                        <option value="yesterday">Hôm qua</option>
                        <option value="this-week">Tuần này</option>
                        <option value="last-week">Tuần trước</option>
                        <option value="this-month">{relativeMonthLabel()}</option>
                        <option value="last-month">{relativeMonthLabel(-1)}</option>
                        <option value="custom">Ngày tùy chỉnh</option>
                        <option value="">Tất cả thời gian</option>
                      </select>
                      <select
                        value={sessionPartnerTypeFilter}
                        onChange={(e) => {
                          setSessionPartnerTypeFilter(e.target.value);
                          setSessionPartnerFilter("");
                        }}
                        className="rounded-lg border px-3 py-2 text-sm"
                      >
                        <option value="">Tất cả loại khách hàng</option>
                        {partnerTypeOptions.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                      <select
                        value={sessionPartnerFilter}
                        onChange={(e) =>
                          setSessionPartnerFilter(e.target.value)
                        }
                        className="rounded-lg border px-3 py-2 text-sm"
                      >
                        <option value="">Tất cả Khách hàng</option>
                        {partners
                          .filter(
                            (item) =>
                              !sessionPartnerTypeFilter ||
                              item.partner_type === sessionPartnerTypeFilter,
                          )
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                      </select>
                      <select
                        value={sessionFilter}
                        onChange={(e) => setSessionFilter(e.target.value)}
                        className="rounded-lg border px-3 py-2 text-sm"
                      >
                        <option value="">Tất cả lịch công tác</option>
                        {workActivities.map((item) => (
                          <option key={item.key} value={item.key}>
                            {showDate(item.date)} · {item.title}
                          </option>
                        ))}
                      </select>
                      <select
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="rounded-lg border px-3 py-2 text-sm"
                      >
                        <option value="">Tất cả trạng thái</option>
                        <option value="unscheduled">Chưa có lịch</option>
                        <option value="planned">Đã lên lịch</option>
                        <option value="completed">Hoàn thành</option>
                        <option value="cancelled">Đã hủy</option>
                      </select>
                      <select
                        value={sessionStaffFilter}
                        onChange={(e) => setSessionStaffFilter(e.target.value)}
                        className="rounded-lg border px-3 py-2 text-sm"
                      >
                        <option value="">Tất cả nhân viên</option>
                        {sessionStaffOptions.map((staff) => (
                          <option key={staff} value={staff}>
                            {staff}
                          </option>
                        ))}
                      </select>
                      {sessionTimeFilter === "custom" && (
                        <>
                          <label className="text-xs font-bold text-slate-600">
                            <span className="mb-1 block">Từ ngày</span>
                            <input
                              type="date"
                              value={sessionDateFrom}
                              onChange={(e) =>
                                setSessionDateFrom(e.target.value)
                              }
                              className="w-full rounded-lg border px-3 py-2 text-sm font-normal"
                            />
                          </label>
                          <label className="text-xs font-bold text-slate-600">
                            <span className="mb-1 block">Đến ngày</span>
                            <input
                              type="date"
                              min={sessionDateFrom || undefined}
                              value={sessionDateTo}
                              onChange={(e) => setSessionDateTo(e.target.value)}
                              className="w-full rounded-lg border px-3 py-2 text-sm font-normal"
                            />
                          </label>
                        </>
                      )}
                    </div>
                  </article>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      {
                        label: `Tổng lịch công tác · ${reportPeriodLabel}`,
                        value: reportActivities.length,
                        accent: "text-blue-700",
                        background: "bg-blue-50",
                      },
                      {
                        label: "Tổng lượt tập huấn",
                        value: reportActivities.filter(
                          (item) => item.kind === "training",
                        ).length,
                        accent: "text-emerald-700",
                        background: "bg-emerald-50",
                      },
                      {
                        label: "Tổng lượt gặp Khách hàng",
                        value: reportActivities.filter(
                          (item) => item.kind === "meeting",
                        ).length,
                        accent: "text-pink-700",
                        background: "bg-pink-50",
                      },
                      {
                        label: "Tỉ lệ chuyển đổi Khách hàng",
                        value: `${conversionSnapshot.rate}%`,
                        accent: "text-amber-700",
                        background: "bg-amber-50",
                      },
                    ].map((card) => (
                      <article
                        key={card.label}
                        className="rounded-2xl border bg-white p-5 shadow-sm"
                      >
                        <span
                          className={`inline-flex rounded-lg px-2 py-1 text-xs font-extrabold ${card.accent} ${card.background}`}
                        >
                          {card.label}
                        </span>
                        <strong className="mt-4 block text-3xl text-slate-950">
                          {card.value}
                        </strong>
                      </article>
                    ))}
                  </div>
                  <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
                    <article className="rounded-2xl border bg-white p-5 shadow-sm">
                      <div className="mb-5">
                        <h3 className="font-extrabold">
                          Cơ cấu lịch công tác · {reportPeriodLabel}
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                          Tỷ trọng từng loại lịch trong phạm vi đang chọn.
                        </p>
                      </div>
                      <div className="h-80">
                        {reportDistribution.some((item) => item.value > 0) ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={reportDistribution}
                                dataKey="value"
                                nameKey="name"
                                innerRadius={65}
                                outerRadius={110}
                                paddingAngle={3}
                              >
                                {reportDistribution.map((item) => (
                                  <Cell key={item.name} fill={item.color} />
                                ))}
                              </Pie>
                              <Tooltip />
                            </PieChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="grid h-full place-items-center rounded-xl bg-slate-50 text-sm text-slate-500">
                            Chưa có lịch trong phạm vi đang chọn.
                          </div>
                        )}
                        <div className="-mt-8 flex flex-wrap justify-center gap-3 text-xs">
                          {reportDistribution.map((item) => (
                            <span
                              key={item.name}
                              className="inline-flex items-center gap-1"
                            >
                              <i
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ background: item.color }}
                              />
                              {item.name}: {item.value}
                            </span>
                          ))}
                        </div>
                      </div>
                    </article>
                    <article className="rounded-2xl border bg-white p-5 shadow-sm">
                      <h3 className="font-extrabold">
                        Khách hàng chuyển đổi trong kỳ
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Tính từ Khách hàng mới hoặc Khách hàng có lịch tập huấn
                        trong kỳ. Không bị ảnh hưởng bởi lọc lịch, trạng thái và
                        nhân viên.
                      </p>
                      <div className="mt-4 space-y-3">
                        {conversionSnapshot.converted.length ? (
                          conversionSnapshot.converted.map(
                            ({ item, reasons }) => (
                              <div
                                key={item.id}
                                className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3"
                              >
                                <b className="text-sm text-slate-950">
                                  {item.name}
                                </b>
                                <span className="mt-1 block text-xs text-emerald-800">
                                  {reasons.join(" · ")}
                                </span>
                              </div>
                            ),
                          )
                        ) : (
                          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                            Chưa ghi nhận Khách hàng chuyển đổi trong kỳ.
                          </div>
                        )}
                      </div>
                      <div className="mt-4 border-t pt-3 text-xs text-slate-500">
                        {conversionSnapshot.converted.length}/
                        {conversionSnapshot.eligible} Khách hàng hoặc đầu mối
                        được ghi nhận.
                      </div>
                    </article>
                  </div>
                  <article className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                    <div className="p-5">
                      <h3 className="text-lg font-extrabold">
                        Tổng hợp lịch công tác · {reportPeriodLabel}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Danh sách chi tiết theo toàn bộ bộ lọc phía trên.
                      </p>
                    </div>
                    <div className="overflow-x-auto border-t">
                      <table className="ft-table">
                        <thead>
                          <tr>
                            <th>STT</th>
                            <th>Ngày</th>
                            <th>Thời gian</th>
                            <th>Loại lịch</th>
                            <th>Khách hàng</th>
                            <th>Lớp/Phân nhóm</th>
                            <th>Nội dung</th>
                            <th>Địa điểm</th>
                            <th>Trạng thái</th>
                            <th>Nhân viên</th>
                            <th aria-label="Xóa"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportActivities.length ? (
                            reportActivities.map((item, index) => (
                              <tr
                                key={item.key}
                                onClick={() =>
                                  openCalendarDetail({
                                    kind: item.kind,
                                    sourceId: item.sourceId,
                                  })
                                }
                                className="cursor-pointer hover:bg-cyan-50"
                              >
                                <td>{index + 1}</td>
                                <td>{showDate(item.date)}</td>
                                <td>{showTime(item)}</td>
                                <td>
                                  <b>
                                    {item.kind === "training"
                                      ? "Tập huấn"
                                      : item.kind === "meeting"
                                        ? "Gặp Khách hàng"
                                        : "Khác"}
                                  </b>
                                  <span className="block text-xs text-slate-500">
                                    {item.activityLabel}
                                  </span>
                                </td>
                                <td>{item.customerName}</td>
                                <td>{item.className}</td>
                                <td className="max-w-xs whitespace-normal">
                                  {item.content}
                                </td>
                                <td>{item.location}</td>
                                <td>
                                  <span
                                    className={`rounded-full px-2 py-1 text-xs font-bold ${item.status === "unscheduled" ? "bg-rose-50 text-rose-700" : item.status === "completed" ? "bg-emerald-50 text-emerald-700" : item.status === "cancelled" ? "bg-slate-100 text-slate-600" : "bg-blue-50 text-blue-700"}`}
                                  >
                                    {status[item.status]}
                                  </span>
                                </td>
                                <td>{item.staffName || "Chưa phân công"}</td>
                                <td>
                                  {!isGuest && (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setDeleteActivity(item);
                                      }}
                                      className="grid h-8 w-8 place-items-center rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50"
                                      title="Xóa lịch công tác"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td
                                colSpan={11}
                                className="py-10 text-center text-slate-500"
                              >
                                Chưa có lịch công tác phù hợp.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </article>
                </section>
              )}
              {tab === "products" && (
                <ProductManagement
                  partners={partners}
                  idToken={idToken}
                  isGuest={isGuest}
                  view={productView}
                  onOpenPartnerDetail={(partnerId) => { openPartnerDetail("partners", partnerId); void load(); }}
                  onScheduleNegotiation={(partnerId, productId) => { const partner = partners.find((item) => item.id === partnerId); if (partner) schedulePartnerMeeting(partner, productId); }}
                  onCreatePartner={() => { setEditingPartner(null); setPd(newPartnerDraft()); setModal("partner"); }}
                />
              )}
              {tab === "finance" && canViewFinance && (
                <FinanceReport
                  partners={partners}
                  idToken={idToken}
                  canEdit={canEditFinance}
                />
              )}
              {tab === "finance" && !canViewFinance && (
                <section className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700">
                  <h1 className="text-xl font-extrabold">Không có quyền truy cập</h1>
                  <p className="mt-2 text-sm">Báo cáo thu chi chỉ dành cho Kế toán, Admin, Quản lý và Giám đốc.</p>
                </section>
              )}
              {tab === "leads" && (
                <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3 p-5">
                    <div>
                      <h2 className="text-xl font-extrabold">Khách hàng mới</h2>
                      <p className="mt-1 text-sm text-slate-500">Theo dõi đầu mối đang thảo luận, gặp mặt hoặc thương thảo trước khi ký hợp đồng.</p>
                    </div>
                    {!isGuest && <button onClick={() => { setEditingLead(null); setLeadDraft({ name: "", lead_type: "", address: "", representative: "", representative_position: "", phone: "", email: "", interested_products: [], stage: "discussion", notes: "" }); setModal("lead"); }} className="ft-primary"><Plus className="h-4 w-4" />Thêm khách hàng mới</button>}
                  </div>
                  <div className="grid gap-3 border-y bg-slate-50/70 p-4 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <label className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm đơn vị, đầu mối, số điện thoại hoặc email..." className="w-full rounded-lg border bg-white py-2 pl-9 pr-3 text-sm" /></label>
                    <div className="rounded-lg border bg-white px-3 py-2 text-sm"><b>{leads.filter(item => item.stage !== "converted").length}</b> đang theo dõi</div>
                    <div className="rounded-lg border bg-white px-3 py-2 text-sm"><b>{leads.filter(item => item.next_meeting_at).length}</b> có lịch gặp sắp tới</div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="ft-table min-w-[1050px]">
                      <thead><tr><th>Khách hàng mới</th><th>Đầu mối</th><th>Giai đoạn</th><th>Lịch gặp</th><th>Lịch gần nhất</th><th>Ghi chú</th><th aria-label="Thao tác"></th></tr></thead>
                      <tbody>
                        {leads.filter(item => !item.converted_partner && item.stage !== "converted" && (!query || [item.name, item.representative, item.phone, item.email, item.address].join(" ").toLocaleLowerCase("vi-VN").includes(query.toLocaleLowerCase("vi-VN")))).map((item) => (
                          <tr key={item.id}>
                            <td><b>{item.name}</b><span className="block text-xs text-slate-500">{item.lead_type || "Chưa phân loại"}</span></td>
                            <td><b>{item.representative || "—"}</b><span className="block text-xs text-slate-500">{[item.representative_position, item.phone, item.email].filter(Boolean).join(" · ") || "Chưa cập nhật"}</span></td>
                            <td><span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">{({ discussion: "Thảo luận", meeting: "Gặp mặt", proposal: "Gửi đề xuất", negotiation: "Thương thảo", on_hold: "Tạm dừng", lost: "Không tiếp tục", converted: "Đã chuyển đổi" } as Record<string, string>)[item.stage] || item.stage}</span></td>
                            <td>{item.meeting_count} lượt</td>
                            <td>{item.next_meeting_at ? <><b>{showDate(item.next_meeting_at.date)}</b><span className="block text-xs text-slate-500">{item.next_meeting_at.start_time || "Chưa đặt giờ"}</span></> : <span className="text-slate-400">Chưa có</span>}</td>
                            <td className="max-w-xs whitespace-normal text-xs text-slate-600">{item.notes || "—"}</td>
                            <td><div className="flex items-center justify-end gap-2">{!isGuest && <><button type="button" onClick={() => scheduleLeadMeeting(item)} className="ft-btn ft-btn-secondary whitespace-nowrap">Lên lịch gặp</button><button type="button" onClick={() => { setEditingLead(item); setLeadDraft({ name: item.name, lead_type: item.lead_type || "", address: item.address || "", representative: item.representative || "", representative_position: item.representative_position || "", phone: item.phone || "", email: item.email || "", interested_products: item.interested_products || [], stage: item.stage || "discussion", notes: item.notes || "" }); setModal("lead"); }} className="ft-btn ft-btn-secondary"><Pencil className="h-4 w-4" /></button>{!item.converted_partner && <button type="button" onClick={() => setConvertLead(item)} className="ft-btn border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 whitespace-nowrap">Chuyển thành khách hàng</button>}</>}</div></td>
                          </tr>
                        ))}
                        {!leads.some(item => !item.converted_partner && item.stage !== "converted") && <tr><td colSpan={7} className="py-10 text-center text-slate-500">Chưa có khách hàng mới. Hãy thêm đầu mối hoặc tạo từ lịch gặp đầu tiên.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {tab === "partners" && !partner && (
                <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm">
                  <div className="flex flex-wrap justify-between gap-3 p-5">
                    <div>
                      <h2 className="text-xl font-extrabold">Khách hàng hiện tại</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Quản lý thông tin liên hệ, sản phẩm đăng ký và tình
                        trạng hợp đồng.
                      </p>
                    </div>
                    {!isGuest && (
                      <button
                        onClick={() => {
                          setEditingPartner(null);
                          setPd(newPartnerDraft());
                          setModal("partner");
                        }}
                        className="ft-primary"
                      >
                        <Plus className="h-4 w-4" />
                        Thêm khách hàng hiện tại
                      </button>
                    )}
                  </div>
                  <div className="grid gap-3 border-y p-4 md:grid-cols-2 xl:grid-cols-8">
                    <label className="relative w-full xl:col-span-2">
                      <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Tìm khách hàng, địa chỉ, đại diện, số điện thoại, email..."
                        className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm"
                      />
                    </label>
                    <select
                      value={partnerManagementTypeFilter}
                      onChange={(e) => {
                        setPartnerManagementTypeFilter(e.target.value);
                        setPartnerManagementSubtypeFilter("");
                        setPartnerManagementFilter("");
                      }}
                      className="rounded-lg border px-3 py-2 text-sm"
                    >
                      <option value="">Tất cả loại khách hàng</option>
                      {partnerTypeOptions.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    {partnerManagementSubtypeOptions.length > 0 && (
                      <select
                        value={partnerManagementSubtypeFilter}
                        onChange={(e) => {
                          setPartnerManagementSubtypeFilter(e.target.value);
                          setPartnerManagementFilter("");
                        }}
                        className="rounded-lg border px-3 py-2 text-sm"
                      >
                        <option value="">Tất cả phân loại</option>
                        {partnerManagementSubtypeOptions.map((subtype) => (
                          <option key={subtype} value={subtype}>
                            {subtype}
                          </option>
                        ))}
                      </select>
                    )}
                    <select
                      value={partnerProvinceFilter}
                      onChange={(e) => {
                        setPartnerProvinceFilter(e.target.value);
                        setPartnerWardFilter("");
                        setPartnerManagementFilter("");
                      }}
                      className="rounded-lg border px-3 py-2 text-sm"
                    >
                      <option value="">Tất cả tỉnh/thành phố</option>
                      {vietnamProvinces.map((province) => (
                        <option key={province} value={province}>
                          {province}
                        </option>
                      ))}
                    </select>
                    <select
                      value={partnerWardFilter}
                      onChange={(e) => {
                        setPartnerWardFilter(e.target.value);
                        setPartnerManagementFilter("");
                      }}
                      className="rounded-lg border px-3 py-2 text-sm"
                    >
                      <option value="">Tất cả xã/phường</option>
                      {partnerWardOptions.map((ward) => (
                        <option key={ward} value={ward}>
                          {ward}
                        </option>
                      ))}
                    </select>
                    <select
                      value={partnerManagementFilter}
                      onChange={(e) =>
                        setPartnerManagementFilter(e.target.value)
                      }
                      className="rounded-lg border px-3 py-2 text-sm"
                    >
                      <option value="">Tất cả khách hàng</option>
                      {partners
                        .filter(
                          (item) =>
                            (!partnerManagementTypeFilter ||
                              item.partner_type ===
                                partnerManagementTypeFilter) &&
                            (!partnerManagementSubtypeFilter ||
                              item.partner_subtype ===
                                partnerManagementSubtypeFilter) &&
                            (!partnerProvinceFilter ||
                              item.province === partnerProvinceFilter) &&
                            (!partnerWardFilter ||
                              item.ward === partnerWardFilter),
                        )
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                    <select
                      value={partnerStatusFilter}
                      onChange={(e) => setPartnerStatusFilter(e.target.value)}
                      className="rounded-lg border px-3 py-2 text-sm"
                    >
                      <option value="">Tất cả tình trạng hợp đồng</option>
                      <option value="not_signed">Chưa ký</option>
                      <option value="signed">Đã ký</option>
                      <option value="paid">Đã thanh toán</option>
                      <option value="negotiating">Đang thương thảo</option>
                      <option value="expiring">Sắp hết hạn</option>
                      <option value="expired">Hết hạn</option>
                    </select>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="ft-table dt-partner-management">
                      <thead>
                        <tr>
                          <th>STT</th>
                          <th>Khách hàng</th>
                          <th>Địa chỉ</th>
                          <th>Đại diện</th>
                          <th>SĐT</th>
                          <th>Email</th>
                          <th>Sản phẩm đăng ký</th>
                          <th>Tình trạng hợp đồng</th>
                          <th>Ghi chú</th>
                          <th aria-label="Xóa"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {managementPartners.length ? (
                          managementPartners.map((item, index) => (
                            <tr
                              key={item.id}
                              onClickCapture={(event) => {
                                if (
                                  (event.target as HTMLElement).closest(
                                    "button,a,input,select,textarea,label",
                                  )
                                )
                                  return;
                                openPartnerDetail("partners", item.id);
                              }}
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Enter" ||
                                  event.key === " "
                                ) {
                                  event.preventDefault();
                                  openPartnerDetail("partners", item.id);
                                }
                              }}
                              role="link"
                              tabIndex={0}
                              className="cursor-pointer hover:bg-cyan-50 focus-within:bg-cyan-50"
                            >
                              <td>{index + 1}</td>
                              <td>
                                <b>{item.name}</b>
                                <span className="block text-xs text-slate-500">
                                  {item.partner_type || "—"}
                                </span>
                              </td>
                              <td>
                                <b>
                                  {[item.ward, item.province]
                                    .filter(Boolean)
                                    .join(", ") ||
                                    item.address ||
                                    "—"}
                                </b>
                                <span className="block text-xs text-slate-500">
                                  {item.partner_subtype || "—"}
                                </span>
                              </td>
                              <td>
                                <b>{item.contact_person || "—"}</b>
                                <span className="block text-xs text-slate-500">
                                  {item.contact_position || "—"}
                                </span>
                              </td>
                              <td>{item.phone || "—"}</td>
                              <td className="break-all">{item.email || "—"}</td>
                              <td>
                                {item.products?.length ? (
                                  <div className="flex flex-wrap gap-1">
                                    {item.products.map((product) => (
                                      <span
                                        key={product}
                                        className="rounded bg-sky-50 px-2 py-1 text-xs text-sky-800"
                                      >
                                        {product}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td>
                                <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${contractStatusClass[effectiveContractStatus(item)] || "border-slate-200 bg-slate-100 text-slate-600"}`}>
                                  {contractStatusLabel(
                                    effectiveContractStatus(item),
                                  )}
                                </span>
                              </td>
                              <td className="whitespace-normal text-xs">
                                {item.notes || "—"}
                              </td>
                              <td>
                                {!isGuest && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setDeletePartner(item);
                                    }}
                                    className="grid h-8 w-8 place-items-center rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50"
                                    title="Xóa khách hàng"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td
                              colSpan={10}
                              className="py-10 text-center text-slate-500"
                            >
                              Chưa có khách hàng phù hợp.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {tab === "partner-sessions" && !partner && (
                <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm">
                  <div className="flex flex-wrap justify-between gap-3 p-5">
                    <div>
                      <h2 className="text-xl font-extrabold">
                        Theo dõi tập huấn
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Theo dõi từng lớp/phân nhóm, số buổi và tiến độ thực
                        hiện.
                      </p>
                    </div>
                    {!isGuest && (
                      <button
                        onClick={() => {
                          setEditingPartner(null);
                          setPd(newPartnerDraft());
                          setModal("partner");
                        }}
                        className="ft-primary"
                      >
                        <Plus className="h-4 w-4" />
                        Thêm khách hàng mới
                      </button>
                    )}
                  </div>
                  <div className="border-y p-4">
                    <label className="relative block w-full">
                      <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Tìm khách hàng hoặc nội dung tập huấn..."
                        className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm"
                      />
                    </label>
                  </div>
                  <div className="grid gap-3 border-x border-b p-4 md:grid-cols-2 xl:grid-cols-5">
                    <select
                      value={trackingPartnerTypeFilter}
                      onChange={(e) => {
                        setTrackingPartnerTypeFilter(e.target.value);
                        setTrackingPartnerFilter("");
                      }}
                      className="rounded-lg border px-3 py-2 text-sm"
                    >
                      <option value="">Tất cả loại khách hàng</option>
                      {partnerTypeOptions.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <select
                      value={trackingPartnerFilter}
                      onChange={(e) => setTrackingPartnerFilter(e.target.value)}
                      className="rounded-lg border px-3 py-2 text-sm"
                    >
                      <option value="">Tất cả khách hàng</option>
                      {partners
                        .filter(
                          (item) =>
                            !trackingPartnerTypeFilter ||
                            item.partner_type === trackingPartnerTypeFilter,
                        )
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                    <select
                      value={trackingContentFilter}
                      onChange={(e) => setTrackingContentFilter(e.target.value)}
                      className="rounded-lg border px-3 py-2 text-sm"
                    >
                      <option value="">Tất cả nội dung tập huấn</option>
                      {trainingContentOptions.map((content) => (
                        <option key={content} value={content}>
                          {content}
                        </option>
                      ))}
                    </select>
                    <select
                      value={partnerProgress}
                      onChange={(e) => setPartnerProgress(e.target.value)}
                      className="rounded-lg border px-3 py-2 text-sm"
                    >
                      <option value="">Tất cả tiến độ</option>
                      <option value="active">Đang triển khai</option>
                      <option value="completed">Đã hoàn thành</option>
                    </select>
                    <select
                      value={partnerContract}
                      onChange={(e) => setPartnerContract(e.target.value)}
                      className="rounded-lg border px-3 py-2 text-sm"
                    >
                      <option value="">Tất cả tình trạng hợp đồng</option>
                      <option value="not_signed">Chưa ký</option>
                      <option value="signed">Đã ký</option>
                      <option value="paid">Đã thanh toán</option>
                      <option value="negotiating">Đang thương thảo</option>
                      <option value="expiring">Sắp hết hạn</option>
                      <option value="expired">Hết hạn</option>
                    </select>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="ft-table dt-partner-table">
                      <thead>
                        <tr>
                          <th>STT</th>
                          <th>Khách hàng</th>
                          <th>Lớp/Phân nhóm</th>
                          <th>Tình trạng hợp đồng</th>
                          <th>Nội dung đào tạo</th>
                          <th>Số buổi đăng ký</th>
                          <th>Đã thực hiện</th>
                          {Array.from({ length: maxSessionColumns }, (_, i) => (
                            <th key={i}>Buổi {i + 1}</th>
                          ))}
                          <th>Ghi chú</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedPartners.length ? (
                          displayedPartners
                            .flatMap((item, partnerIndex) =>
                              groupsFor(item.id).map((group) => ({
                                item,
                                partnerIndex,
                                group,
                              })),
                            )
                            .map(({ item, group }, rowIndex) => {
                              const trainingContents =
                                trainingContentsForGroup(group);
                              return (
                                <tr
                                  key={`${item.id}-${group.id || group.name}`}
                                  onClickCapture={(event) => {
                                    if (
                                      (event.target as HTMLElement).closest(
                                        "button,a,input,select,textarea,label",
                                      )
                                    )
                                      return;
                                    openPartnerDetail(
                                      "partner-sessions",
                                      item.id,
                                    );
                                  }}
                                  onKeyDown={(event) => {
                                    if (
                                      event.key === "Enter" ||
                                      event.key === " "
                                    ) {
                                      event.preventDefault();
                                      openPartnerDetail(
                                        "partner-sessions",
                                        item.id,
                                      );
                                    }
                                  }}
                                  role="link"
                                  tabIndex={0}
                                  className="cursor-pointer hover:bg-cyan-50 focus-within:bg-cyan-50"
                                >
                                  <td>{rowIndex + 1}</td>
                                  <td>
                                    <b>{item.name}</b>
                                    <span className="block text-xs text-slate-500">
                                      {item.contact_person ||
                                        "Chưa có đại diện"}
                                    </span>
                                  </td>
                                  <td>
                                    {showClassName(group) && (
                                      <>
                                        <b>{group.name}</b>
                                        {group.members && (
                                          <span className="block text-xs text-slate-500">
                                            {group.members}
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </td>
                                  <td>
                                    <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${contractStatusClass[effectiveContractStatus(item)] || "border-slate-200 bg-slate-100 text-slate-600"}`}>
                                      {contractStatusLabel(
                                        effectiveContractStatus(item),
                                      )}
                                    </span>
                                  </td>
                                  <td className="whitespace-normal">
                                    {trainingContents.length ? (
                                      <div className="flex flex-wrap gap-1">
                                        {trainingContents.map((content) => (
                                          <span
                                            key={content}
                                            className="rounded bg-sky-50 px-2 py-1 text-xs text-sky-800"
                                          >
                                            {content}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                  <td>{group.planned_sessions}</td>
                                  <td>
                                    {
                                      groupSessions(group, item.id).filter(
                                        (x) => x.status === "completed",
                                      ).length
                                    }
                                  </td>
                                  {Array.from(
                                    { length: maxSessionColumns },
                                    (_, slot) => (
                                      <td
                                        key={slot}
                                        className="min-w-32 text-xs"
                                      >
                                        <span
                                          className={`dt-session-${sessionCellType(group, item.id, slot + 1)}`}
                                        >
                                          {sessionCell(
                                            group,
                                            item.id,
                                            slot + 1,
                                          )}
                                        </span>
                                      </td>
                                    ),
                                  )}
                                  <td className="whitespace-normal text-xs">
                                    {group.notes || item.notes || "—"}
                                  </td>
                                </tr>
                              );
                            })
                        ) : (
                          <tr>
                            <td
                              colSpan={8 + maxSessionColumns}
                              className="py-10 text-center text-slate-500"
                            >
                              Chưa có khách hàng phù hợp.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {(tab === "partner-sessions" || tab === "partners") &&
                partner && (
                  <section className="mt-6">
                    <button
                      onClick={() =>
                        go(tab === "partners" ? "partners" : "partner-sessions")
                      }
                      className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-600"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Quay lại danh sách khách hàng
                    </button>
                    <article className="rounded-2xl border bg-white p-6 shadow-sm">
                      <p className="text-xs font-bold uppercase text-cyan-600">
                        Khách hàng hiện tại
                      </p>
                      <div className="flex flex-wrap justify-between gap-4">
                        <div>
                          <h2 className="mt-1 text-2xl font-extrabold">
                            {partner.name}
                          </h2>
                          <p className="mt-2 text-sm text-slate-500">
                            {partner.address || "Chưa cập nhật địa chỉ"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {!isGuest &&
                            effectiveContractStatus(partner) === "expired" && (
                              <button
                                onClick={() => {
                                  setRenewal({
                                    contract_signed_date: today(),
                                    contract_duration: String(
                                      partner.contract_duration || "",
                                    ),
                                    contract_duration_unit:
                                      partner.contract_duration_unit || "month",
                                  });
                                  setModal("renewal");
                                }}
                                className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800"
                              >
                                Gia hạn hợp đồng
                              </button>
                            )}
                          {!isGuest && (
                            <>
                              <button onClick={() => schedulePartnerMeeting(partner)} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800"><CalendarDays className="mr-2 inline h-4 w-4" />Thêm lịch gặp KH</button>
                              <button
                                onClick={() => openPartnerEditor(partner)}
                                className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-bold text-sky-800"
                              >
                                <Pencil className="mr-2 inline h-4 w-4" />
                                Chỉnh sửa
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="mt-5 grid gap-4 border-t pt-5 md:grid-cols-4">
                        <p>
                          <b className="block text-xs uppercase text-slate-500">
                            Hợp đồng
                          </b>
                          <span className={`mt-1 inline-flex rounded-full border px-2 py-1 text-xs font-bold ${contractStatusClass[effectiveContractStatus(partner)] || "border-slate-200 bg-slate-100 text-slate-600"}`}>
                            {contractStatusLabel(
                              effectiveContractStatus(partner),
                            )}
                          </span>
                        </p>
                        <p>
                          <b className="block text-xs uppercase text-slate-500">
                            Thời hạn hợp đồng
                          </b>
                          {partner.contract_signed_date
                            ? `Ký ${showDate(partner.contract_signed_date)} · ${partner.contract_duration || "—"} ${partner.contract_duration_unit === "year" ? "năm" : "tháng"}`
                            : "Chưa cập nhật"}
                          <span
                            className={`mt-1 block text-xs font-bold ${contractTiming(partner).expired ? "text-rose-600" : "text-emerald-700"}`}
                          >
                            {contractTiming(partner).expiry
                              ? `${showDate(contractTiming(partner).expiry)} · ${contractTiming(partner).label}`
                              : contractTiming(partner).label}
                          </span>
                        </p>
                        <p>
                          <b className="block text-xs uppercase text-slate-500">
                            Kinh phí
                          </b>
                          {formatBudget(partner.budget)}
                        </p>
                        <p>
                          <b className="block text-xs uppercase text-slate-500">
                            Đại diện
                          </b>
                          <span className="block">
                            {partner.contact_person || "—"}
                            {partner.contact_position &&
                              ` · ${partner.contact_position}`}
                            {partner.phone && ` · ${partner.phone}`}
                          </span>
                          {partner.email && (
                            <span className="block text-xs text-slate-500">
                              {partner.email}
                            </span>
                          )}
                          {partner.additional_contacts?.map(
                            (contact, index) => (
                              <span
                                key={index}
                                className="mt-1 block border-t pt-1 text-xs"
                              >
                                <b>
                                  {contact.contact_person || "Đại diện khác"}
                                </b>
                                {contact.position && ` · ${contact.position}`}
                                {contact.phone && ` · ${contact.phone}`}
                                {contact.email && ` · ${contact.email}`}
                              </span>
                            ),
                          )}
                        </p>
                        <p className="md:col-span-2">
                          <b className="block text-xs uppercase text-slate-500">
                            Nội dung
                          </b>
                          {partner.training_content || "—"}
                        </p>
                      </div>
                    </article>
                    <div className="mt-5 flex flex-wrap gap-2 rounded-xl border bg-white p-2 shadow-sm">
                      <button type="button" onClick={() => setPartnerDetailTab("products")} className={`rounded-lg px-4 py-2 text-sm font-bold ${partnerDetailTab === "products" ? "bg-cyan-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>Danh mục sản phẩm đã đăng ký</button>
                      {hasTrainingProduct && <button type="button" onClick={() => setPartnerDetailTab("training")} className={`rounded-lg px-4 py-2 text-sm font-bold ${partnerDetailTab === "training" ? "bg-cyan-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>Tiến độ đào tạo</button>}
                    </div>
                    {partnerDetailTab === "products" && (
                    <article className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
                      <div>
                        <h3 className="font-extrabold">{"S\u1ea3n ph\u1ea9m \u0111\u0103ng k\u00fd"}</h3>
                        <p className="mt-1 text-sm text-slate-500">{"Th\u00f4ng tin \u0111\u1ea7y \u0111\u1ee7 v\u1ec1 s\u1ed1 l\u01b0\u1ee3ng, tr\u1ea1ng th\u00e1i v\u00e0 th\u1eddi h\u1ea1n s\u1eed d\u1ee5ng."}</p>
                      </div>
                      <div className="mt-4 overflow-x-auto rounded-xl border">
                        <table className="ft-table"><thead><tr><th>Sản phẩm</th><th>Số lượng</th><th>Trạng thái</th><th>Ngày bắt đầu</th><th>Hạn sử dụng</th><th>Ghi chú</th><th /></tr></thead><tbody>
                          {partner.planned_sessions > 0 && !partnerProducts.some((item) => item.product_code === "tap-huan") && <tr><td><b>Tập huấn</b></td><td>{partner.planned_sessions} buổi</td><td><span className="rounded-full bg-cyan-50 px-2 py-1 text-xs font-bold text-cyan-700">Đang sử dụng</span></td><td>—</td><td><b>Không giới hạn</b></td><td>Đã thực hiện {partner.completed_sessions || 0} buổi</td><td /></tr>}
                          {partnerProducts.map((item) => <tr key={item.id} className={item.effective_status === "expired" ? "bg-rose-50" : item.effective_status === "expiring" ? "bg-amber-50" : ""}><td><b>{item.product_name}</b></td><td>{item.product_code === "tap-huan" ? `${item.quantity} buổi` : item.quantity}</td><td><span className={`rounded-full px-2 py-1 text-xs font-bold ${item.effective_status === "expired" ? "bg-rose-100 text-rose-700" : item.effective_status === "expiring" ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{productSubscriptionStatus(item.effective_status)}</span></td><td>{item.starts_at ? showDate(item.starts_at) : "—"}</td><td className={item.effective_status === "expired" ? "font-bold text-rose-700" : ""}>{item.product_code === "tap-huan" || !item.expires_at ? "Không giới hạn" : showDate(item.expires_at)}</td><td className="max-w-xs whitespace-pre-wrap text-xs">{item.notes || "—"}</td><td>{!isGuest && <button type="button" onClick={() => setEditingProductSubscription({ ...item })} className="ft-btn ft-btn-secondary"><Pencil className="h-4 w-4" />Sửa</button>}</td></tr>)}
                          {productOpportunities.filter((item) => item.partner === partner.id).map((item) => <tr key={`opportunity-${item.id}`} className="bg-amber-50/60"><td><b>{item.product_name}</b></td><td>—</td><td className="font-bold text-amber-800">Đang thương thảo</td><td>—</td><td>—</td><td>{item.meeting_count} lịch gặp liên quan</td><td /></tr>)}
                          {!partner.planned_sessions && !partnerProducts.length && <tr><td colSpan={7} className="py-10 text-center text-slate-500">Chưa có sản phẩm đăng ký.</td></tr>}
                        </tbody></table>
                      </div>
                    </article>
                    )}
                    {hasTrainingProduct && partnerDetailTab === "training" && <>
                    <article className="mt-5 overflow-x-auto rounded-2xl border bg-white shadow-sm">
                      <div className="flex items-center justify-between p-5">
                        <div>
                          <h3 className="font-extrabold">
                            Tiến độ theo lớp/phân nhóm
                          </h3>
                          <p className="mt-1 text-sm text-slate-500">
                            Ngày học, lịch dự kiến và các buổi còn thiếu lịch.
                          </p>
                        </div>
                      </div>
                      <table className="ft-table dt-progress-table">
                        <thead>
                          <tr>
                            <th>Lớp/Phân nhóm</th>
                            <th>Số buổi đăng ký</th>
                            <th>Đã thực hiện</th>
                            {Array.from(
                              {
                                length: Math.max(
                                  1,
                                  ...groupsFor(partner.id).map(
                                    (g) => g.planned_sessions,
                                  ),
                                ),
                              },
                              (_, i) => (
                                <th key={i}>Buổi {i + 1}</th>
                              ),
                            )}
                            <th>Ghi chú</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupsFor(partner.id).map((group) => (
                            <tr key={group.id || group.name}>
                              <td>
                                {showClassName(group) && (
                                  <>
                                    <b>{group.name}</b>
                                    {group.members && (
                                      <span className="block text-xs text-slate-500">
                                        {group.members}
                                      </span>
                                    )}
                                  </>
                                )}
                              </td>
                              <td>{group.planned_sessions}</td>
                              <td>
                                {
                                  groupSessions(group, partner.id).filter(
                                    (x) => x.status === "completed",
                                  ).length
                                }
                              </td>
                              {Array.from(
                                {
                                  length: Math.max(
                                    1,
                                    ...groupsFor(partner.id).map(
                                      (g) => g.planned_sessions,
                                    ),
                                  ),
                                },
                                (_, slot) => (
                                  <td key={slot} className="min-w-32 text-xs">
                                    <span
                                      className={`dt-session-${sessionCellType(group, partner.id, slot + 1)}`}
                                    >
                                      {sessionCell(group, partner.id, slot + 1)}
                                    </span>
                                  </td>
                                ),
                              )}
                              <td className="text-xs">{group.notes || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </article>
                    <div className="mt-5 grid gap-5 xl:grid-cols-2">
                      {[
                        [
                          "Phiếu khảo sát",
                          surveys
                            .filter((x) => x.partner === partner.id)
                            .map((x) => x.title),
                        ],
                        [
                          "Tài liệu",
                          materials
                            .filter((x) => x.partner === partner.id)
                            .map((x) => x.title),
                        ],
                      ].map(([title, rows]: any) => (
                        <article
                          key={title}
                          className="rounded-2xl border bg-white p-5"
                        >
                          <h3 className="font-extrabold">{title}</h3>
                          {rows.length ? (
                            <div className="mt-3 space-y-2">
                              {rows.map((x: string) => (
                                <p
                                  key={x}
                                  className="rounded-lg bg-slate-50 p-3 text-sm"
                                >
                                  {x}
                                </p>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-3 text-sm text-slate-500">
                              Chưa có dữ liệu.
                            </p>
                          )}
                        </article>
                      ))}
                    </div>
                    </>}
                  </section>
                )}
              {(tab === "partner-sessions" || tab === "partners") &&
                partner && (
                  <LogNotes
                    entityKey={`digital-training-partner-${partner.id}`}
                    actor={userName}
                    canWrite={!!idToken && !isGuest}
                    idToken={idToken}
                  />
                )}
              {tab === "survey" && !surveyDetail && (
                <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm">
                  <div className="flex flex-wrap justify-between gap-3 p-5">
                    <div>
                      <h2 className="text-xl font-extrabold">Khảo sát cuối buổi</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Tạo và theo dõi phiếu khảo sát sau từng buổi tập huấn.
                      </p>
                    </div>
                    {!isGuest && (
                      <button
                        onClick={() => {
                          setEditingSurvey(null);
                          setSv({
                            title: "",
                            form_type: "end_session",
                            session: "",
                            partner: "",
                            notes: "",
                          });
                          setModal("survey");
                        }}
                        className="ft-primary"
                      >
                        <Plus className="h-4 w-4" />
                        Tạo form
                      </button>
                    )}
                  </div>
                  <div className="grid gap-3 border-x border-b p-4 md:grid-cols-3">
                    <label className="relative">
                      <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Tìm tên form, lịch hoặc khách hàng..."
                        className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm"
                      />
                    </label>
                    <select
                      value={surveyPartnerTypeFilter}
                      onChange={(e) => {
                        setSurveyPartnerTypeFilter(e.target.value);
                        setSurveyPartnerFilter("");
                      }}
                      className="rounded-lg border px-3 py-2 text-sm"
                    >
                      <option value="">Tất cả loại khách hàng</option>
                      {partnerTypeOptions.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <select
                      value={surveyPartnerFilter}
                      onChange={(e) => setSurveyPartnerFilter(e.target.value)}
                      className="rounded-lg border px-3 py-2 text-sm"
                    >
                      <option value="">Tất cả khách hàng</option>
                      {partners
                        .filter(
                          (x) =>
                            !surveyPartnerTypeFilter ||
                            x.partner_type === surveyPartnerTypeFilter,
                        )
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="ft-table">
                      <thead>
                        <tr>
                          <th>STT</th>
                          <th>Phiếu khảo sát</th>
                          <th>Loại</th>
                          <th>Lịch tập huấn</th>
                          <th>Khách hàng</th>
                          <th>Ghi chú</th>
                          <th aria-label="Xóa"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {surveys.filter((item) => {
                          const linked = sessions.find(
                            (x) => x.id === item.session,
                          );
                          const searchable = [
                            item.title,
                            item.notes,
                            item.session_name,
                            linked?.title,
                            item.partner_name,
                            linked?.partner,
                          ]
                            .join(" ")
                            .toLocaleLowerCase("vi-VN");
                          return (
                            item.form_type === "end_session" &&
                            (!query ||
                              searchable.includes(
                                query.toLocaleLowerCase("vi-VN"),
                              )) &&
                            (!surveyPartnerTypeFilter ||
                              matchesPartnerType(
                                item.partner || linked?.partner_id,
                                surveyPartnerTypeFilter,
                              )) &&
                            (!surveyPartnerFilter ||
                              String(
                                item.partner || linked?.partner_id || "",
                              ) === surveyPartnerFilter)
                          );
                        }).length ? (
                          surveys
                            .filter((item) => {
                              const linked = sessions.find(
                                (x) => x.id === item.session,
                              );
                              const searchable = [
                                item.title,
                                item.notes,
                                item.session_name,
                                linked?.title,
                                item.partner_name,
                                linked?.partner,
                              ]
                                .join(" ")
                                .toLocaleLowerCase("vi-VN");
                              return (
                                item.form_type === "end_session" &&
                                (!query ||
                                  searchable.includes(
                                    query.toLocaleLowerCase("vi-VN"),
                                  )) &&
                                (!surveyPartnerTypeFilter ||
                                  matchesPartnerType(
                                    item.partner || linked?.partner_id,
                                    surveyPartnerTypeFilter,
                                  )) &&
                                (!surveyPartnerFilter ||
                                  String(
                                    item.partner || linked?.partner_id || "",
                                  ) === surveyPartnerFilter)
                              );
                            })
                            .map((item, index) => {
                              const linked = sessions.find(
                                (x) => x.id === item.session,
                              );
                              return (
                                <tr
                                  key={item.id}
                                  onClick={() => go("survey", item.id)}
                                  className="cursor-pointer hover:bg-cyan-50"
                                >
                                  <td>{index + 1}</td>
                                  <td>
                                    <b>{item.title}</b>
                                  </td>
                                  <td>
                                    Cuối buổi
                                  </td>
                                  <td>
                                    {linked?.title || item.session_name || "—"}
                                    <span className="block text-xs text-slate-500">
                                      {showDate(linked?.date)}
                                    </span>
                                  </td>
                                  <td>
                                    {item.partner_name ||
                                      linked?.partner_name ||
                                      linked?.partner ||
                                      "—"}
                                  </td>
                                  <td className="max-w-xs whitespace-normal text-xs">
                                    {item.notes || "—"}
                                  </td>
                                  <td>
                                    {!isGuest && (
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setDeleteSurvey(item);
                                        }}
                                        className="grid h-8 w-8 place-items-center rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50"
                                        title="Xóa khảo sát"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                        ) : (
                          <tr>
                            <td
                              colSpan={7}
                              className="py-10 text-center text-slate-500"
                            >
                              Chưa có phiếu khảo sát phù hợp.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {tab === "survey" && surveyDetail && (
                <section className="mt-6 space-y-5">
                  <button
                    onClick={() => go("survey")}
                    className="inline-flex items-center gap-2 text-sm font-bold text-slate-600"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Quay lại danh sách khảo sát
                  </button>
                  <article className="rounded-2xl border bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-bold uppercase text-cyan-600">
                          Phiếu khảo sát
                        </p>
                        <h2 className="mt-1 text-2xl font-extrabold">
                          {surveyDetail.title}
                        </h2>
                        <p className="mt-2 text-sm text-slate-500">
                          {surveyDetail.form_type === "end_course"
                            ? "Bài đánh giá cuối khóa tập huấn"
                            : "Phiếu khảo sát cuối buổi"}
                        </p>
                      </div>
                      {!isGuest && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setEditingSurvey(surveyDetail);
                              setSv({
                                title: surveyDetail.title,
                                form_type: surveyDetail.form_type,
                                session: String(surveyDetail.session || ""),
                                partner: String(surveyDetail.partner || ""),
                                notes: surveyDetail.notes || "",
                              });
                              setModal("survey");
                            }}
                            className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-bold text-sky-800"
                          >
                            <Pencil className="mr-2 inline h-4 w-4" />
                            Chỉnh sửa
                          </button>
                          <button
                            onClick={() => setDeleteSurvey(surveyDetail)}
                            className="rounded-lg border border-rose-200 px-4 py-2 text-sm font-bold text-rose-700"
                          >
                            <Trash2 className="mr-2 inline h-4 w-4" />
                            Xóa
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="mt-6 grid gap-5 border-t pt-5 sm:grid-cols-2">
                      <p>
                        <b className="block text-xs uppercase text-slate-500">
                          Lịch tập huấn
                        </b>
                        {sessions.find((x) => x.id === surveyDetail.session)
                          ?.title ||
                          surveyDetail.session_name ||
                          "—"}
                      </p>
                      <p>
                        <b className="block text-xs uppercase text-slate-500">
                          Khách hàng
                        </b>
                        {surveyDetail.partner_name ||
                          sessions.find((x) => x.id === surveyDetail.session)
                            ?.partner_name ||
                          "—"}
                      </p>
                      <p className="sm:col-span-2">
                        <b className="block text-xs uppercase text-slate-500">
                          Ghi chú
                        </b>
                        {surveyDetail.notes || "—"}
                      </p>
                    </div>
                  </article>
                  <LogNotes
                    entityKey={`digital-training-survey-${surveyDetail.id}`}
                    actor={userName}
                    canWrite={!!idToken && !isGuest}
                    idToken={idToken}
                  />
                </section>
              )}
              {tab === "materials" && (
                <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm">
                  <div className="flex flex-wrap justify-between gap-3 p-5">
                    <div>
                      <h2 className="text-xl font-extrabold">Tài liệu</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Ưu tiên lưu link Google Drive; cũng hỗ trợ tải tài liệu,
                        slide, bảng tính và hình ảnh.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setMd({
                          title: "",
                          external_url: "",
                          session: "",
                          partner: "",
                          notes: "",
                        });
                        setFile(null);
                        setModal("material");
                      }}
                      className="ft-primary"
                    >
                      <Plus className="h-4 w-4" />
                      Thêm tài liệu mới
                    </button>
                  </div>
                  <div className="grid gap-3 border-x border-b p-4 md:grid-cols-3">
                    <label className="relative">
                      <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Tìm tài liệu hoặc ghi chú..."
                        className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm"
                      />
                    </label>
                    <select
                      value={materialPartnerTypeFilter}
                      onChange={(e) => {
                        setMaterialPartnerTypeFilter(e.target.value);
                        setMaterialPartnerFilter("");
                      }}
                      className="rounded-lg border px-3 py-2 text-sm"
                    >
                      <option value="">Tất cả loại khách hàng</option>
                      {partnerTypeOptions.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <select
                      value={materialPartnerFilter}
                      onChange={(e) => setMaterialPartnerFilter(e.target.value)}
                      className="rounded-lg border px-3 py-2 text-sm"
                    >
                      <option value="">Tất cả khách hàng</option>
                      {partners
                        .filter(
                          (x) =>
                            !materialPartnerTypeFilter ||
                            x.partner_type === materialPartnerTypeFilter,
                        )
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="ft-table">
                      <thead>
                        <tr>
                          <th>Tài liệu</th>
                          <th>Buổi tập huấn</th>
                          <th>Khách hàng</th>
                          <th>Nguồn</th>
                          <th>Ghi chú</th>
                          <th aria-label="Xóa"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {materials
                          .filter(
                            (x) =>
                              (!query ||
                                [x.title, x.file_name, x.notes]
                                  .join(" ")
                                  .toLowerCase()
                                  .includes(query.toLowerCase())) &&
                              (!materialPartnerTypeFilter ||
                                matchesPartnerType(
                                  x.partner,
                                  materialPartnerTypeFilter,
                                )) &&
                              (!materialPartnerFilter ||
                                String(x.partner || "") ===
                                  materialPartnerFilter),
                          )
                          .map((x) => (
                            <tr key={x.id}>
                              <td>
                                <b>{x.title}</b>
                                <span className="block text-xs text-slate-500">
                                  {x.file_name ||
                                    x.file_type ||
                                    "Link Google Drive / URL"}
                                </span>
                              </td>
                              <td>{x.session_name || "—"}</td>
                              <td>{x.partner_name || "—"}</td>
                              <td>
                                <a
                                  href={x.external_url || x.file_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 font-bold text-cyan-700"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  Mở
                                </a>
                              </td>
                              <td>{x.notes || "—"}</td>
                              <td>
                                {!isGuest && (
                                  <button
                                    type="button"
                                    onClick={() => setDeleteMaterial(x)}
                                    className="grid h-8 w-8 place-items-center rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50"
                                    title="Xóa tài liệu"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
          {editingProductSubscription && (
            <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">
              <form onSubmit={saveProductSubscription} className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
                <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-extrabold">Cập nhật sản phẩm đăng ký</h2><p className="mt-1 text-sm text-slate-500">{editingProductSubscription.partner_name} · {editingProductSubscription.product_name}</p></div><button type="button" onClick={() => setEditingProductSubscription(null)}><X className="h-5 w-5" /></button></div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label><span className="mb-1 block text-sm font-bold">Số lượng</span><input type="number" min="1" required className="ft-input" value={editingProductSubscription.quantity} onChange={(event) => setEditingProductSubscription({ ...editingProductSubscription, quantity: Number(event.target.value) })} /></label>
                  <label><span className="mb-1 block text-sm font-bold">Trạng thái</span><select className="ft-input" value={editingProductSubscription.status} onChange={(event) => setEditingProductSubscription({ ...editingProductSubscription, status: event.target.value as ProductSubscription["status"] })}><option value="active">Đang sử dụng</option><option value="paused">Tạm dừng</option><option value="cancelled">Đã hủy</option></select></label>
                  <label><span className="mb-1 block text-sm font-bold">Ngày bắt đầu</span><input type="date" className="ft-input" value={editingProductSubscription.starts_at || ""} onChange={(event) => setEditingProductSubscription({ ...editingProductSubscription, starts_at: event.target.value || null })} /></label>
                  <label><span className="mb-1 block text-sm font-bold">Hạn sử dụng</span>{editingProductSubscription.product_code === "tap-huan" ? <div className="ft-input bg-slate-100 font-semibold text-slate-600">Không giới hạn</div> : <input type="date" className="ft-input" value={editingProductSubscription.expires_at || ""} onChange={(event) => setEditingProductSubscription({ ...editingProductSubscription, expires_at: event.target.value || null })} />}</label>
                  <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Ghi chú</span><textarea className="ft-input min-h-24" value={editingProductSubscription.notes || ""} onChange={(event) => setEditingProductSubscription({ ...editingProductSubscription, notes: event.target.value })} /></label>
                </div>
                <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setEditingProductSubscription(null)} className="ft-btn ft-btn-secondary">Hủy</button><button className="ft-primary">Lưu thay đổi</button></div>
              </form>
            </div>
          )}
          {modal === "schedule-kind" && (
            <Dialog
              title="Tạo lịch mới"
              onClose={() => {
                setModal(null);
                setPendingCalendarPick(null);
              }}
            >
              <p className="text-sm text-slate-600">
                {pendingCalendarPick
                  ? `Chọn loại lịch cho ${showDate(pendingCalendarPick.date)}${pendingCalendarPick.start_time ? `, ${pendingCalendarPick.start_time}–${pendingCalendarPick.end_time || ""}` : ""}.`
                  : "Chọn loại lịch cần tạo."}
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => {
                    const slot = pendingCalendarPick;
                    setPendingCalendarPick(null);
                    openTraining(slot?.date, slot?.start_time, slot?.end_time);
                  }}
                  className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-left transition hover:border-sky-400 hover:bg-sky-100"
                >
                  <GraduationCap className="h-6 w-6 text-sky-700" />
                  <b className="mt-3 block text-sm text-slate-900">Lịch tập huấn</b>
                  <span className="mt-1 block text-xs leading-5 text-slate-600">Buổi học, lớp hoặc chương trình tập huấn.</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const slot = pendingCalendarPick;
                    setPendingCalendarPick(null);
                    openMeeting(slot?.date, slot?.start_time, slot?.end_time);
                  }}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-left transition hover:border-emerald-400 hover:bg-emerald-100"
                >
                  <Handshake className="h-6 w-6 text-emerald-700" />
                  <b className="mt-3 block text-sm text-slate-900">Gặp Khách hàng</b>
                  <span className="mt-1 block text-xs leading-5 text-slate-600">Gặp gỡ, tư vấn hoặc làm việc với Khách hàng.</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const slot = pendingCalendarPick;
                    setPendingCalendarPick(null);
                    openOther(slot?.date, slot?.start_time, slot?.end_time);
                  }}
                  className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-left transition hover:border-violet-400 hover:bg-violet-100"
                >
                  <ClipboardList className="h-6 w-6 text-violet-700" />
                  <b className="mt-3 block text-sm text-slate-900">Lịch khác</b>
                  <span className="mt-1 block text-xs leading-5 text-slate-600">Công việc nội bộ hoặc hoạt động khác.</span>
                </button>
              </div>
            </Dialog>
          )}
          {modal === "session" && (
            <Dialog
              title={
                editingSession ? "Chỉnh sửa lịch tập huấn" : "Tạo lịch tập huấn"
              }
              onClose={() => {
                setModal(null);
                setEditingSession(null);
              }}
            >
              <form onSubmit={saveSession} className="grid gap-4">
                <Input
                  label="Tên buổi *"
                  required
                  value={sd.title}
                  onChange={(e) => setSd({ ...sd, title: e.target.value })}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Ngày *"
                    required
                    type="date"
                    value={sd.date}
                    onChange={(e) => setSd({ ...sd, date: e.target.value })}
                  />
                  <label>
                    <span className="mb-1 block text-sm font-bold">
                      Khách hàng
                    </span>
                    <div className="flex gap-2">
                      <select
                        value={sd.partner_id}
                        onChange={(e) =>
                          setSd({
                            ...sd,
                            partner_id: e.target.value,
                            class_group_id: "",
                          })
                        }
                        className="min-w-0 flex-1 rounded-lg border px-3 py-2"
                      >
                        <option value="">Chọn khách hàng</option>
                        {partners.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                      {!isGuest && (
                        <button
                          type="button"
                          onClick={openQuickPartner}
                          className="ft-btn ft-btn-secondary shrink-0"
                        >
                          <Plus className="h-4 w-4" />
                          Thêm mới
                        </button>
                      )}
                    </div>
                  </label>
                  <label>
                    <span className="mb-1 block text-sm font-bold">
                      Lớp/Phân nhóm
                    </span>
                    <select
                      value={sd.class_group_id}
                      onChange={(e) => {
                        const group = classes.find(
                          (x) => x.id === Number(e.target.value),
                        );
                        setSd({
                          ...sd,
                          class_group_id: e.target.value,
                          partner_id: group
                            ? String(group.partner)
                            : sd.partner_id,
                        });
                      }}
                      className="w-full rounded-lg border px-3 py-2"
                    >
                      <option value="">Chưa phân nhóm</option>
                      {classes
                        .filter(
                          (x) =>
                            !sd.partner_id ||
                            x.partner === Number(sd.partner_id),
                        )
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                            {x.members ? ` · ${x.members}` : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                  <TimePicker
                    label="Bắt đầu"
                    value={sd.start_time}
                    onChange={(start_time) =>
                      setSd((current) => ({
                        ...current,
                        start_time,
                        end_time:
                          current.end_time || threeHoursAfter(start_time),
                      }))
                    }
                  />
                  <TimePicker
                    label="Kết thúc"
                    value={sd.end_time}
                    onChange={(value) => setSd({ ...sd, end_time: value })}
                  />
                </div>
                <ContentsPicker
                  value={sd.contents}
                  onChange={(contents) => setSd({ ...sd, contents })}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <label>
                    <span className="mb-1 block text-sm font-bold">
                      Trạng thái
                    </span>
                    <select
                      value={sd.status}
                      onChange={(e) => setSd({ ...sd, status: e.target.value })}
                      className="w-full rounded-lg border px-3 py-2"
                    >
                      <option value="unscheduled">Chưa có lịch</option>
                      <option value="planned">Đã lên lịch</option>
                      <option value="completed">Hoàn thành</option>
                      <option value="cancelled">Đã hủy</option>
                    </select>
                  </label>
                  <Input
                    label="Địa điểm / Link"
                    value={sd.location}
                    onChange={(e) => setSd({ ...sd, location: e.target.value })}
                  />
                  <ProductSelect
                    label="Giảng viên"
                    value={sd.instructor_name.split(", ").filter(Boolean)}
                    onChange={(instructors) => setSd({ ...sd, instructor_name: instructors.join(", ") })}
                    options={employeeOptions}
                    placeholder="Chọn một hoặc nhiều nhân viên"
                    searchPlaceholder="Tìm nhân viên..."
                  />
                  <ProductSelect
                    label="Nhân viên hỗ trợ"
                    value={sd.support_staff_name.split(", ").filter(Boolean)}
                    onChange={(supportStaff) =>
                      setSd({
                        ...sd,
                        support_staff_name: supportStaff.join(", "),
                      })
                    }
                    options={employeeOptions}
                    placeholder="Chọn một hoặc nhiều nhân viên"
                    searchPlaceholder="Tìm nhân viên..."
                  />
                  <Input
                    label="Số người tham gia"
                    type="number"
                    min="0"
                    value={sd.attendees}
                    onChange={(e) =>
                      setSd({ ...sd, attendees: e.target.value })
                    }
                  />
                </div>
                <label>
                  <span className="mb-1 block text-sm font-bold">Ghi chú</span>
                  <textarea
                    value={sd.notes}
                    onChange={(e) => setSd({ ...sd, notes: e.target.value })}
                    className="min-h-20 w-full rounded-lg border px-3 py-2"
                  />
                </label>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="rounded-lg border px-4 py-2 text-sm font-bold"
                  >
                    Hủy
                  </button>
                  <button className="ft-primary">
                    {editingSession ? "Lưu thay đổi" : "Tạo lịch tập huấn"}
                  </button>
                </div>
              </form>
            </Dialog>
          )}
          {modal === "meeting" && (
            <Dialog
              title={
                editingMeeting
                  ? "Chỉnh sửa lịch gặp Khách hàng"
                  : "Gặp Khách hàng mới"
              }
              onClose={() => {
                setModal(null);
                setEditingMeeting(null);
              }}
            >
              <form onSubmit={saveMeeting} className="grid gap-4">
                <Input
                  label="Tên buổi gặp *"
                  required
                  value={meeting.title}
                  onChange={(e) =>
                    setMeeting({ ...meeting, title: e.target.value })
                  }
                />
                <label>
                  <span className="mb-1 block text-sm font-bold">
                    Loại Khách hàng
                  </span>
                  <select
                    value={meeting.customer_type}
                    onChange={(e) =>
                      setMeeting({ ...meeting, customer_type: e.target.value })
                    }
                    className="w-full rounded-lg border px-3 py-2"
                  >
                    <option value="">Chọn loại Khách hàng</option>
                    <option>Khối Hành chính công</option>
                    <option>Khối Giáo dục</option>
                    <option>Khối Doanh nghiệp</option>
                    <option>Khác</option>
                  </select>
                </label>
                                <label>
                  <span className="mb-1 block text-sm font-bold">{"Kh\u00e1ch h\u00e0ng hi\u1ec7n t\u1ea1i"}</span>
                  <select value={meeting.partner} onChange={(event) => { const selectedPartner = partners.find(item => item.id === Number(event.target.value)); setMeeting({ ...meeting, partner: event.target.value, lead: "", title: meeting.title || (selectedPartner ? `G\u1eb7p ${selectedPartner.name}` : ""), customer_type: meeting.customer_type || selectedPartner?.partner_type || "", representative: meeting.representative || selectedPartner?.contact_person || "", phone: meeting.phone || selectedPartner?.phone || "", email: meeting.email || selectedPartner?.email || "", location: meeting.location || selectedPartner?.address || "" }); }} className="w-full rounded-lg border px-3 py-2"><option value="">{"Kh\u00f4ng g\u1eafn kh\u00e1ch h\u00e0ng hi\u1ec7n t\u1ea1i"}</option>{partners.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                  <small className="mt-1 block text-xs text-slate-500">{"L\u1ecbch g\u1eb7p \u0111\u01b0\u1ee3c l\u01b0u trong h\u1ed3 s\u01a1 kh\u00e1ch h\u00e0ng n\u00e0y."}</small>
                </label>
                {meeting.partner && <label><span className="mb-1 block text-sm font-bold">{"S\u1ea3n ph\u1ea9m \u0111ang trao \u0111\u1ed5i"}</span><select value={meeting.product} onChange={(event) => setMeeting({ ...meeting, product: event.target.value })} className="w-full rounded-lg border px-3 py-2"><option value="">{"Ch\u01b0a g\u1eafn s\u1ea3n ph\u1ea9m"}</option>{productCatalog.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small className="mt-1 block text-xs text-amber-700">{"S\u1ea3n ph\u1ea9m \u0111\u01b0\u1ee3c ghi l\u00e0 \u0111ang th\u01b0\u01a1ng th\u1ea3o, ch\u01b0a t\u00ednh l\u00e0 \u0111ang s\u1eed d\u1ee5ng."}</small></label>}
                <label>
                  <span className="mb-1 block text-sm font-bold">Liên kết khách hàng mới</span>
                  <select value={meeting.lead} onChange={(event) => { const selectedLead = leads.find(item => item.id === Number(event.target.value)); setMeeting({ ...meeting, lead: event.target.value, title: meeting.title || (selectedLead ? `Gặp ${selectedLead.name}` : ""), customer_type: meeting.customer_type || selectedLead?.lead_type || "", representative: meeting.representative || selectedLead?.representative || "", phone: meeting.phone || selectedLead?.phone || "", email: meeting.email || selectedLead?.email || "", location: meeting.location || selectedLead?.address || "" }); }} className="w-full rounded-lg border px-3 py-2">
                    <option value="">Không gắn khách hàng mới</option>
                    {leads.filter(item => !item.converted_partner).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <small className="mt-1 block text-xs text-slate-500">Lịch gặp sẽ xuất hiện trong hồ sơ khách hàng mới.</small>
                </label><div className="grid gap-4 sm:grid-cols-3">
                  <Input
                    label="Người đại diện"
                    value={meeting.representative}
                    onChange={(e) =>
                      setMeeting({ ...meeting, representative: e.target.value })
                    }
                  />
                  <Input
                    label="Điện thoại"
                    value={meeting.phone}
                    onChange={(e) =>
                      setMeeting({ ...meeting, phone: e.target.value })
                    }
                  />
                  <Input
                    label="Email"
                    type="email"
                    value={meeting.email}
                    onChange={(e) =>
                      setMeeting({ ...meeting, email: e.target.value })
                    }
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Input
                    label="Ngày *"
                    required
                    type="date"
                    value={meeting.date}
                    onChange={(e) =>
                      setMeeting({ ...meeting, date: e.target.value })
                    }
                  />
                  <TimePicker
                    label="Bắt đầu"
                    value={meeting.start_time}
                    onChange={(start_time) =>
                      setMeeting({ ...meeting, start_time })
                    }
                  />
                  <TimePicker
                    label="Kết thúc"
                    value={meeting.end_time}
                    onChange={(end_time) =>
                      setMeeting({ ...meeting, end_time })
                    }
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label>
                    <span className="mb-1 block text-sm font-bold">{"Tr\u1ea1ng th\u00e1i"}</span>
                    <select value={meeting.status} onChange={(e) => setMeeting({ ...meeting, status: e.target.value as typeof meeting.status })} className="w-full rounded-lg border px-3 py-2">
                      <option value="unscheduled">{"Ch\u01b0a c\u00f3 l\u1ecbch"}</option>
                      <option value="planned">{"\u0110\u00e3 l\u00ean l\u1ecbch"}</option>
                      <option value="completed">{"Ho\u00e0n th\u00e0nh"}</option>
                      <option value="cancelled">{"\u0110\u00e3 h\u1ee7y"}</option>
                    </select>
                  </label>
                  <label>
                    <span className="mb-1 block text-sm font-bold">{"Nh\u00e2n vi\u00ean ph\u1ee5 tr\u00e1ch"}</span>
                    <select value={meeting.staff_name} onChange={(e) => setMeeting({ ...meeting, staff_name: e.target.value })} className="w-full rounded-lg border px-3 py-2">
                      <option value="">{"Ch\u01b0a ph\u00e2n c\u00f4ng"}</option>
                      {employeeOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </label>
                </div>
                <Input
                  label="Địa điểm"
                  value={meeting.location}
                  onChange={(e) =>
                    setMeeting({ ...meeting, location: e.target.value })
                  }
                />
                <label>
                  <span className="mb-1 block text-sm font-bold">Nội dung</span>
                  <textarea
                    value={meeting.content}
                    onChange={(e) =>
                      setMeeting({ ...meeting, content: e.target.value })
                    }
                    className="min-h-20 w-full rounded-lg border px-3 py-2"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-sm font-bold">Ghi chú</span>
                  <textarea
                    value={meeting.notes}
                    onChange={(e) =>
                      setMeeting({ ...meeting, notes: e.target.value })
                    }
                    className="min-h-20 w-full rounded-lg border px-3 py-2"
                  />
                </label>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="rounded-lg border px-4 py-2 text-sm font-bold"
                  >
                    Hủy
                  </button>
                  <button className="ft-primary">
                    {editingMeeting
                      ? "Lưu thay đổi"
                      : "Tạo lịch gặp Khách hàng"}
                  </button>
                </div>
              </form>
            </Dialog>
          )}
          {modal === "other" && (
            <Dialog
              title={
                editingMeeting
                  ? "Chỉnh sửa lịch công tác khác"
                  : "Tạo lịch khác"
              }
              onClose={() => {
                setModal(null);
                setEditingMeeting(null);
              }}
            >
              <form onSubmit={saveOther} className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label>
                    <span className="mb-1 block text-sm font-bold">
                      Loại lịch *
                    </span>
                    <select
                      required
                      value={meeting.activity_type}
                      onChange={(e) =>
                        setMeeting({
                          ...meeting,
                          activity_type: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border px-3 py-2"
                    >
                      <option value="">Chọn loại lịch</option>
                      <option value="Họp nội bộ">Họp nội bộ</option>
                      <option value="Làm việc với khách hàng">
                        Làm việc với khách hàng
                      </option>
                      <option value="Sự kiện">Sự kiện</option>
                      <option value="Công tác khác">Công tác khác</option>
                    </select>
                  </label>
                  <Input
                    label="Tên lịch *"
                    required
                    value={meeting.title}
                    onChange={(e) =>
                      setMeeting({ ...meeting, title: e.target.value })
                    }
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Input
                    label="Đơn vị/nhóm liên quan"
                    value={meeting.customer_type}
                    onChange={(e) =>
                      setMeeting({ ...meeting, customer_type: e.target.value })
                    }
                  />
                  <Input
                    label="Người liên hệ"
                    value={meeting.representative}
                    onChange={(e) =>
                      setMeeting({ ...meeting, representative: e.target.value })
                    }
                  />
                  <Input
                    label="Điện thoại"
                    value={meeting.phone}
                    onChange={(e) =>
                      setMeeting({ ...meeting, phone: e.target.value })
                    }
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Input
                    label="Email"
                    type="email"
                    value={meeting.email}
                    onChange={(e) =>
                      setMeeting({ ...meeting, email: e.target.value })
                    }
                  />
                  <Input
                    label="Ngày *"
                    required
                    type="date"
                    value={meeting.date}
                    onChange={(e) =>
                      setMeeting({ ...meeting, date: e.target.value })
                    }
                  />
                  <TimePicker
                    label="Bắt đầu"
                    value={meeting.start_time}
                    onChange={(start_time) =>
                      setMeeting({ ...meeting, start_time })
                    }
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <TimePicker
                    label="Kết thúc"
                    value={meeting.end_time}
                    onChange={(end_time) =>
                      setMeeting({ ...meeting, end_time })
                    }
                  />
                  <label>
                    <span className="mb-1 block text-sm font-bold">
                      Trạng thái
                    </span>
                    <select
                      value={meeting.status}
                      onChange={(e) =>
                        setMeeting({
                          ...meeting,
                          status: e.target.value as typeof meeting.status,
                        })
                      }
                      className="w-full rounded-lg border px-3 py-2"
                    >
                      <option value="unscheduled">Chưa có lịch</option>
                      <option value="planned">Đã lên lịch</option>
                      <option value="completed">Hoàn thành</option>
                      <option value="cancelled">Đã hủy</option>
                    </select>
                  </label>
                  <label>
                    <span className="mb-1 block text-sm font-bold">{"Nh\u00e2n vi\u00ean ph\u1ee5 tr\u00e1ch"}</span>
                    <select value={meeting.staff_name} onChange={(e) => setMeeting({ ...meeting, staff_name: e.target.value })} className="w-full rounded-lg border px-3 py-2">
                      <option value="">{"Ch\u01b0a ph\u00e2n c\u00f4ng"}</option>
                      {employeeOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </label>
                </div>
                <Input
                  label="Địa điểm"
                  value={meeting.location}
                  onChange={(e) =>
                    setMeeting({ ...meeting, location: e.target.value })
                  }
                />
                <label>
                  <span className="mb-1 block text-sm font-bold">Nội dung</span>
                  <textarea
                    value={meeting.content}
                    onChange={(e) =>
                      setMeeting({ ...meeting, content: e.target.value })
                    }
                    className="min-h-20 w-full rounded-lg border px-3 py-2"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-sm font-bold">Ghi chú</span>
                  <textarea
                    value={meeting.notes}
                    onChange={(e) =>
                      setMeeting({ ...meeting, notes: e.target.value })
                    }
                    className="min-h-20 w-full rounded-lg border px-3 py-2"
                  />
                </label>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="rounded-lg border px-4 py-2 text-sm font-bold"
                  >
                    Hủy
                  </button>
                  <button className="ft-primary">
                    {editingMeeting ? "Lưu thay đổi" : "Tạo lịch khác"}
                  </button>
                </div>
              </form>
            </Dialog>
          )}
          {modal === "lead" && (
            <Dialog title={editingLead ? "Chỉnh sửa khách hàng mới" : "Thêm khách hàng mới"} onClose={() => { setModal(null); setEditingLead(null); }}>
              <form onSubmit={saveLead} className="grid gap-4">
                <Input label="Tên đơn vị / khách hàng *" required value={leadDraft.name} onChange={(event) => setLeadDraft({ ...leadDraft, name: event.target.value })} />
                <ProductSelect label="Sản phẩm quan tâm" value={leadDraft.interested_products} onChange={(interested_products) => setLeadDraft({ ...leadDraft, interested_products })} options={activeProductNames} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <label><span className="mb-1 block text-sm font-bold">Loại khách hàng</span><select value={leadDraft.lead_type} onChange={(event) => setLeadDraft({ ...leadDraft, lead_type: event.target.value })} className="w-full rounded-lg border px-3 py-2"><option value="">Chưa phân loại</option><option>Khối Giáo dục</option><option>Khối Hành chính công</option><option>Khối Doanh nghiệp</option><option>Khác</option></select></label>
                  <label><span className="mb-1 block text-sm font-bold">Giai đoạn</span><select value={leadDraft.stage} onChange={(event) => setLeadDraft({ ...leadDraft, stage: event.target.value })} className="w-full rounded-lg border px-3 py-2"><option value="discussion">Thảo luận</option><option value="meeting">Gặp mặt</option><option value="proposal">Gửi đề xuất</option><option value="negotiation">Thương thảo</option><option value="on_hold">Tạm dừng</option><option value="lost">Không tiếp tục</option></select></label>
                </div>
                <Input label="Địa chỉ" value={leadDraft.address} onChange={(event) => setLeadDraft({ ...leadDraft, address: event.target.value })} />
                <div className="grid gap-4 sm:grid-cols-2"><Input label="Người đại diện" value={leadDraft.representative} onChange={(event) => setLeadDraft({ ...leadDraft, representative: event.target.value })} /><Input label="Chức vụ" value={leadDraft.representative_position} onChange={(event) => setLeadDraft({ ...leadDraft, representative_position: event.target.value })} /></div>
                <div className="grid gap-4 sm:grid-cols-2"><Input label="Số điện thoại" value={leadDraft.phone} onChange={(event) => setLeadDraft({ ...leadDraft, phone: event.target.value })} /><Input label="Email" type="email" value={leadDraft.email} onChange={(event) => setLeadDraft({ ...leadDraft, email: event.target.value })} /></div>
                <label><span className="mb-1 block text-sm font-bold">Ghi chú trao đổi</span><textarea value={leadDraft.notes} onChange={(event) => setLeadDraft({ ...leadDraft, notes: event.target.value })} className="min-h-24 w-full rounded-lg border px-3 py-2" /></label>
                <div className="flex justify-end gap-3"><button type="button" onClick={() => { setModal(null); setEditingLead(null); }} className="rounded-lg border px-4 py-2 text-sm font-bold">Hủy</button><button className="ft-primary">{editingLead ? "Lưu thay đổi" : "Thêm khách hàng mới"}</button></div>
              </form>
            </Dialog>
          )}
          {modal === "quick-partner" && (
            <Dialog
              title="Thêm khách hàng mới"
              onClose={() => setModal("session")}
            >
              <form onSubmit={saveQuickPartner} className="grid gap-4">
                <p className="text-sm text-slate-500">
                  Thông tin cơ bản. Khách hàng mới sẽ được tự động chọn cho
                  lịch tập huấn này.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Tên khách hàng *"
                    required
                    value={quickPartner.name}
                    onChange={(e) =>
                      setQuickPartner({ ...quickPartner, name: e.target.value })
                    }
                  />
                  <label>
                    <span className="mb-1 block text-sm font-bold">
                      Loại khách hàng *
                    </span>
                    <select
                      required
                      value={quickPartner.partner_type}
                      onChange={(e) =>
                        setQuickPartner({
                          ...quickPartner,
                          partner_type: e.target.value,
                          partner_subtype: "",
                          province: "",
                          ward: "",
                        })
                      }
                      className="w-full rounded-lg border px-3 py-2"
                    >
                      <option value="">Chọn loại khách hàng</option>
                      <option>Khối Hành chính công</option>
                      <option>Khối Giáo dục</option>
                      <option>Khối Doanh nghiệp</option>
                      <option>Khác</option>
                    </select>
                  </label>
                  {(quickPartner.partner_type === "Khối Hành chính công" ||
                    quickPartner.partner_type === "Khối Giáo dục") && (
                    <label>
                      <span className="mb-1 block text-sm font-bold">
                        Phân loại *
                      </span>
                      <select
                        required
                        value={quickPartner.partner_subtype}
                        onChange={(e) => {
                          const partner_subtype = e.target.value;
                          const needsLocation =
                            quickPartner.partner_type === "Khối Giáo dục" ||
                            partner_subtype === "Khối Xã/Phường";
                          setQuickPartner({
                            ...quickPartner,
                            partner_subtype,
                            province: needsLocation
                              ? quickPartner.province || "Hà Nội"
                              : "",
                            ward: needsLocation ? quickPartner.ward : "",
                          });
                        }}
                        className="w-full rounded-lg border px-3 py-2"
                      >
                        <option value="">Chọn phân loại</option>
                        {(partnerSubtypeCatalog[quickPartner.partner_type] || []).map(
                          (subtype) => (
                            <option key={subtype} value={subtype}>
                              {subtype}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  )}
                  {(quickPartner.partner_type === "Khối Giáo dục" ||
                    quickPartner.partner_subtype === "Khối Xã/Phường") && (
                    <>
                      <label>
                        <span className="mb-1 block text-sm font-bold">
                          Tỉnh/Thành phố
                        </span>
                        <SearchableSelect
                          value={quickPartner.province}
                          onChange={(province) =>
                            setQuickPartner({ ...quickPartner, province })
                          }
                          options={provinceOptions}
                          placeholder="Chọn tỉnh/thành phố"
                          searchPlaceholder="Tìm tỉnh/thành phố..."
                        />
                      </label>
                      <Input
                        label="Xã/Phường"
                        value={quickPartner.ward}
                        onChange={(e) =>
                          setQuickPartner({ ...quickPartner, ward: e.target.value })
                        }
                      />
                    </>
                  )}
                  <Input
                    label="Đại diện"
                    value={quickPartner.contact_person}
                    onChange={(e) =>
                      setQuickPartner({
                        ...quickPartner,
                        contact_person: e.target.value,
                      })
                    }
                  />
                  <Input
                    label="Chức vụ"
                    value={quickPartner.contact_position}
                    onChange={(e) =>
                      setQuickPartner({
                        ...quickPartner,
                        contact_position: e.target.value,
                      })
                    }
                  />
                  <Input
                    label="Điện thoại"
                    value={quickPartner.phone}
                    onChange={(e) =>
                      setQuickPartner({ ...quickPartner, phone: e.target.value })
                    }
                  />
                  <Input
                    label="Email"
                    type="email"
                    value={quickPartner.email}
                    onChange={(e) =>
                      setQuickPartner({ ...quickPartner, email: e.target.value })
                    }
                  />
                </div>
                <Input
                  label="Địa chỉ"
                  value={quickPartner.address}
                  onChange={(e) =>
                    setQuickPartner({ ...quickPartner, address: e.target.value })
                  }
                />
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setModal("session")}
                    className="rounded-lg border px-4 py-2 text-sm font-bold"
                  >
                    Hủy
                  </button>
                  <button className="ft-primary">Thêm và chọn khách hàng</button>
                </div>
              </form>
            </Dialog>
          )}
          {modal === "partner" && (
            <Dialog
              title={
                editingPartner ? "Chỉnh sửa khách hàng" : "Thêm khách hàng mới"
              }
              onClose={() => {
                setModal(null);
                setEditingPartner(null);
              }}
              wide
            >
              <form onSubmit={savePartner} className="grid gap-6">
                <FormSection title="Thông tin chung">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Input
                      label="Tên khách hàng *"
                      required
                      value={pd.name}
                      onChange={(e) => setPd({ ...pd, name: e.target.value })}
                    />
                    <label>
                      <span className="mb-1 block text-sm font-bold">
                        Loại khách hàng *
                      </span>
                      <select
                        required
                        value={pd.partner_type}
                        onChange={(e) => {
                          const partner_type = e.target.value;
                          setPd({
                            ...pd,
                            partner_type,
                            partner_subtype: "",
                            province:
                              partner_type === "Khối Giáo dục" ? "Hà Nội" : "",
                            ward: "",
                          });
                        }}
                        className="w-full rounded-lg border px-3 py-2"
                      >
                        <option value="">Chọn loại khách hàng</option>
                        <option>Khối Hành chính công</option>
                        <option>Khối Giáo dục</option>
                        <option>Khối Doanh nghiệp</option>
                        <option>Khác</option>
                      </select>
                    </label>
                  </div>
                  {(pd.partner_type === "Khối Hành chính công" ||
                    pd.partner_type === "Khối Giáo dục") && (
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <label>
                        <span className="mb-1 block text-sm font-bold">
                          Phân loại
                        </span>
                        <select
                          value={pd.partner_subtype}
                          onChange={(e) => {
                            const partner_subtype = e.target.value;
                            const hasLocation =
                              pd.partner_type === "Khối Giáo dục" ||
                              partner_subtype === "Khối Xã/Phường";
                            setPd({
                              ...pd,
                              partner_subtype,
                              province: hasLocation
                                ? pd.province || "Hà Nội"
                                : "",
                              ward: hasLocation ? pd.ward : "",
                            });
                          }}
                          className="w-full rounded-lg border px-3 py-2"
                        >
                          <option value="">Chọn phân loại</option>
                          {pd.partner_type === "Khối Hành chính công" ? (
                            <>
                              <option>Khối Xã/Phường</option>
                              <option>Cơ quan nhà nước khác</option>
                            </>
                          ) : (
                            <>
                              <option>Mầm non</option>
                              <option>Tiểu học</option>
                              <option>THCS</option>
                              <option>THPT</option>
                            </>
                          )}
                        </select>
                      </label>
                      {(pd.partner_type === "Khối Giáo dục" ||
                        pd.partner_subtype === "Khối Xã/Phường") && (
                        <>
                          <label>
                            <span className="mb-1 block text-sm font-bold">
                              Tỉnh/Thành phố
                            </span>
                            <SearchableSelect
                              value={pd.province}
                              onChange={(province) =>
                                setPd({ ...pd, province })
                              }
                              options={provinceOptions}
                              placeholder="Chọn tỉnh/thành phố"
                              searchPlaceholder="Tìm trong 34 tỉnh/thành phố..."
                            />
                          </label>
                          <Input
                            label="Xã/Phường"
                            value={pd.ward}
                            onChange={(e) =>
                              setPd({ ...pd, ward: e.target.value })
                            }
                          />
                        </>
                      )}
                    </div>
                  )}
                  <div className="mt-4 grid gap-4 md:grid-cols-4">
                    <Input
                      label="Đại diện"
                      value={pd.contact_person}
                      onChange={(e) =>
                        setPd({ ...pd, contact_person: e.target.value })
                      }
                    />
                    <Input
                      label="Chức vụ"
                      value={pd.contact_position}
                      onChange={(e) =>
                        setPd({ ...pd, contact_position: e.target.value })
                      }
                    />
                    <Input
                      label="Điện thoại"
                      value={pd.phone}
                      onChange={(e) => setPd({ ...pd, phone: e.target.value })}
                    />
                    <Input
                      label="Email"
                      type="email"
                      value={pd.email}
                      onChange={(e) => setPd({ ...pd, email: e.target.value })}
                    />
                  </div>
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() =>
                        setPd({
                          ...pd,
                          additional_contacts: [
                            ...pd.additional_contacts,
                            {
                              contact_person: "",
                              position: "",
                              phone: "",
                              email: "",
                            },
                          ],
                        })
                      }
                      className="rounded-lg border border-sky-300 px-3 py-2 text-sm font-bold text-sky-800"
                    >
                      + Thêm đại diện khác
                    </button>
                    {pd.additional_contacts.map((contact, index) => (
                      <div
                        key={index}
                        className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="mb-3 flex items-center justify-between">
                          <b className="text-sm">Đại diện khác {index + 2}</b>
                          <button
                            type="button"
                            onClick={() =>
                              setPd({
                                ...pd,
                                additional_contacts:
                                  pd.additional_contacts.filter(
                                    (_, i) => i !== index,
                                  ),
                              })
                            }
                            className="text-sm font-bold text-rose-600"
                          >
                            Xóa
                          </button>
                        </div>
                        <div className="grid gap-4 md:grid-cols-4">
                          <Input
                            label="Đại diện"
                            value={contact.contact_person}
                            onChange={(e) =>
                              setPd({
                                ...pd,
                                additional_contacts: pd.additional_contacts.map(
                                  (row, i) =>
                                    i === index
                                      ? {
                                          ...row,
                                          contact_person: e.target.value,
                                        }
                                      : row,
                                ),
                              })
                            }
                          />
                          <Input
                            label="Chức vụ"
                            value={contact.position || ""}
                            onChange={(e) =>
                              setPd({
                                ...pd,
                                additional_contacts: pd.additional_contacts.map(
                                  (row, i) =>
                                    i === index
                                      ? { ...row, position: e.target.value }
                                      : row,
                                ),
                              })
                            }
                          />
                          <Input
                            label="Điện thoại"
                            value={contact.phone}
                            onChange={(e) =>
                              setPd({
                                ...pd,
                                additional_contacts: pd.additional_contacts.map(
                                  (row, i) =>
                                    i === index
                                      ? { ...row, phone: e.target.value }
                                      : row,
                                ),
                              })
                            }
                          />
                          <Input
                            label="Email"
                            type="email"
                            value={contact.email}
                            onChange={(e) =>
                              setPd({
                                ...pd,
                                additional_contacts: pd.additional_contacts.map(
                                  (row, i) =>
                                    i === index
                                      ? { ...row, email: e.target.value }
                                      : row,
                                ),
                              })
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </FormSection>
                <FormSection title="Hợp đồng">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label>
                      <span className="mb-1 block text-sm font-bold">
                        Thời gian hợp đồng
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          min="1"
                          value={pd.contract_duration}
                          onChange={(e) =>
                            setPd({ ...pd, contract_duration: e.target.value })
                          }
                          className="w-full rounded-lg border px-3 py-2"
                          placeholder="Số"
                        />
                        <select
                          value={pd.contract_duration_unit}
                          onChange={(e) =>
                            setPd({
                              ...pd,
                              contract_duration_unit: e.target.value,
                            })
                          }
                          className="rounded-lg border px-3 py-2"
                        >
                          <option value="month">Tháng</option>
                          <option value="year">Năm</option>
                        </select>
                      </div>
                    </label>
                    <Input
                      label="Ngày ký hợp đồng"
                      type="date"
                      value={pd.contract_signed_date}
                      onChange={(e) =>
                        setPd({ ...pd, contract_signed_date: e.target.value })
                      }
                    />
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <Input
                      label="Kinh phí (VNĐ)"
                      type="number"
                      min="0"
                      value={pd.budget}
                      onChange={(e) => setPd({ ...pd, budget: e.target.value })}
                    />
                    <label>
                      <span className="mb-1 block text-sm font-bold">
                        Tình trạng hợp đồng
                      </span>
                      <select
                        value={pd.contract_status}
                        onChange={(e) =>
                          setPd({ ...pd, contract_status: e.target.value })
                        }
                        className="w-full rounded-lg border px-3 py-2"
                      >
                        <option value="not_signed">Chưa ký</option>
                        <option value="signed">Đã ký</option>
                        <option value="paid">Đã thanh toán</option>
                        <option value="negotiating">Đang thương thảo</option>
                        <option value="expired">Hết hạn</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-4">
                    <ProductSelect
                      label="Sản phẩm đăng ký"
                      value={pd.products}
                      onChange={(products) => setPd({ ...pd, products })}
                      options={activeProductNames}
                    />
                    {pd.products.some((product) => product.toLocaleLowerCase("vi-VN").includes("ai")) && (
                      <div className="mt-4 max-w-sm">
                        <Input
                          label="Số tài khoản AI đăng ký"
                          type="number"
                          min="0"
                          value={pd.ai_account_count}
                          onChange={(e) =>
                            setPd({ ...pd, ai_account_count: e.target.value })
                          }
                        />
                      </div>
                    )}
                  </div>
                </FormSection>
                {pd.products.includes("Tập huấn") && (
                  <FormSection title="Tập huấn">
                    <div className="max-w-sm">
                      <Input
                        label="Số lớp tập huấn"
                        type="number"
                        min="1"
                        required
                        value={pd.class_count}
                        onChange={(e) => resizeClassPlans(e.target.value)}
                      />
                    </div>
                    {Number(pd.class_count) > 1 && (
                      <article className="mt-4 rounded-xl border border-violet-200 bg-violet-50/50 p-4">
                        <div className="max-w-sm">
                          <Input
                            label="Số buổi tập huấn chung (nếu có)"
                            type="number"
                            min="0"
                            value={pd.shared_sessions}
                            onChange={(e) =>
                              updateSharedSessions(e.target.value)
                            }
                          />
                        </div>
                        {pd.shared_training_schedule.length > 0 && (
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            {pd.shared_training_schedule.map(
                              (slot, sessionIndex) => (
                                <div
                                  key={sessionIndex}
                                  className="rounded-lg border border-violet-200 bg-white p-3"
                                >
                                  <b className="text-sm">
                                    Buổi chung {sessionIndex + 1}
                                  </b>
                                  <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                                    <input
                                      type="date"
                                      disabled={slot.unscheduled}
                                      value={slot.date}
                                      onChange={(e) =>
                                        updateSharedSchedule(sessionIndex, {
                                          date: e.target.value,
                                        })
                                      }
                                      className="min-w-0 rounded-lg border px-2 py-1.5 text-sm"
                                    />
                                    <CompactTimePicker
                                      ariaLabel={`Buổi chung ${sessionIndex + 1} - giờ bắt đầu`}
                                      disabled={slot.unscheduled}
                                      value={slot.start_time}
                                      onChange={(start_time) =>
                                        updateSharedSchedule(sessionIndex, {
                                          start_time,
                                        })
                                      }
                                    />
                                    <label className="flex items-center gap-1 whitespace-nowrap text-xs font-bold text-rose-700">
                                      <input
                                        type="checkbox"
                                        checked={slot.unscheduled}
                                        onChange={(e) =>
                                          updateSharedSchedule(sessionIndex, {
                                            unscheduled: e.target.checked,
                                            date: e.target.checked
                                              ? ""
                                              : slot.date,
                                            start_time: e.target.checked
                                              ? ""
                                              : slot.start_time,
                                            location: e.target.checked
                                              ? ""
                                              : slot.location,
                                          })
                                        }
                                      />
                                      Chưa có lịch
                                    </label>
                                  </div>
                                  <label className="mt-2 block">
                                    <span className="mb-1 block text-xs font-bold text-slate-600">
                                      Địa điểm / Link
                                    </span>
                                    <input
                                      type="text"
                                      disabled={slot.unscheduled}
                                      value={slot.location}
                                      onChange={(e) =>
                                        updateSharedSchedule(sessionIndex, {
                                          location: e.target.value,
                                        })
                                      }
                                      placeholder="Hội trường, phòng học hoặc link trực tuyến..."
                                      className="w-full rounded-lg border px-2 py-1.5 text-sm"
                                    />
                                  </label>
                                </div>
                              ),
                            )}
                          </div>
                        )}
                      </article>
                    )}
                    <p className="mt-3 text-sm text-slate-500">
                      Số buổi và nội dung áp dụng chung cho các lớp; ngày, giờ
                      và địa điểm của từng buổi được thiết lập riêng.
                    </p>
                    <div className="mt-4 grid gap-5">
                      {pd.class_plans.map((plan, classIndex) => (
                        <article
                          key={classIndex}
                          className="rounded-xl border border-sky-200 bg-sky-50/50 p-4"
                        >
                          {pd.class_plans.length > 1 && (
                            <>
                              <h4 className="font-extrabold text-sky-950">
                                Lớp {classIndex + 1}
                              </h4>
                            </>
                          )}
                          <div className="mt-3 grid gap-4 sm:grid-cols-2">
                            {pd.class_plans.length > 1 && (
                              <>
                                <Input
                                  label="Tên lớp"
                                  value={plan.name}
                                  placeholder={`Lớp ${classIndex + 1}`}
                                  onChange={(e) =>
                                    updateClassPlan(classIndex, {
                                      name: e.target.value,
                                    })
                                  }
                                />
                                <Input
                                  label="Đối tượng/Thành phần"
                                  value={plan.members}
                                  placeholder="Phòng ban, nhóm người học..."
                                  onChange={(e) =>
                                    updateClassPlan(classIndex, {
                                      members: e.target.value,
                                    })
                                  }
                                />
                              </>
                            )}
                            <Input
                              label="Số buổi tập huấn"
                              type="number"
                              min="0"
                              value={plan.planned_sessions}
                              onChange={(e) =>
                                updateClassPlannedSessions(
                                  classIndex,
                                  e.target.value,
                                )
                              }
                            />
                            <ProductSelect
                              label="Nội dung tập huấn"
                              value={plan.training_contents}
                              onChange={(training_contents) =>
                                updateClassTrainingContents(
                                  classIndex,
                                  training_contents,
                                )
                              }
                              options={pd.products.filter(
                                (item) => item !== "Tập huấn",
                              )}
                            />
                          </div>
                          {plan.training_schedule.length > 0 && (
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              {plan.training_schedule.map(
                                (slot, sessionIndex) => (
                                  <div
                                    key={sessionIndex}
                                    className="rounded-lg border border-slate-300 bg-white p-3"
                                  >
                                    <b className="text-sm">
                                      Buổi {sessionIndex + 1}
                                    </b>
                                    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                                      <input
                                        type="date"
                                        disabled={slot.unscheduled}
                                        value={slot.date}
                                        onChange={(e) =>
                                          updateClassSchedule(
                                            classIndex,
                                            sessionIndex,
                                            { date: e.target.value },
                                          )
                                        }
                                        className="min-w-0 rounded-lg border px-2 py-1.5 text-sm"
                                      />
                                      <CompactTimePicker
                                        ariaLabel={`Buổi ${sessionIndex + 1} - giờ bắt đầu`}
                                        disabled={slot.unscheduled}
                                        value={slot.start_time}
                                        onChange={(start_time) =>
                                          updateClassSchedule(
                                            classIndex,
                                            sessionIndex,
                                            { start_time },
                                          )
                                        }
                                      />
                                      <label className="flex items-center gap-1 whitespace-nowrap text-xs font-bold text-rose-700">
                                        <input
                                          type="checkbox"
                                          checked={slot.unscheduled}
                                          onChange={(e) =>
                                            updateClassSchedule(
                                              classIndex,
                                              sessionIndex,
                                              {
                                                unscheduled: e.target.checked,
                                                date: e.target.checked
                                                  ? ""
                                                  : slot.date,
                                                start_time: e.target.checked
                                                  ? ""
                                                  : slot.start_time,
                                                location: e.target.checked
                                                  ? ""
                                                  : slot.location,
                                              },
                                            )
                                          }
                                        />
                                        Chưa có lịch
                                      </label>
                                    </div>
                                    <label className="mt-2 block">
                                      <span className="mb-1 block text-xs font-bold text-slate-600">
                                        Địa điểm / Link
                                      </span>
                                      <input
                                        type="text"
                                        disabled={slot.unscheduled}
                                        value={slot.location}
                                        onChange={(e) =>
                                          updateClassSchedule(
                                            classIndex,
                                            sessionIndex,
                                            { location: e.target.value },
                                          )
                                        }
                                        placeholder="Hội trường, phòng học hoặc link trực tuyến..."
                                        className="w-full rounded-lg border px-2 py-1.5 text-sm"
                                      />
                                    </label>
                                  </div>
                                ),
                              )}
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  </FormSection>
                )}
                <label>
                  <span className="mb-1 block text-sm font-bold">Ghi chú</span>
                  <textarea
                    value={pd.notes}
                    onChange={(e) => setPd({ ...pd, notes: e.target.value })}
                    className="min-h-16 w-full rounded-lg border px-3 py-2"
                  />
                </label>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="rounded-lg border px-4 py-2 text-sm font-bold"
                  >
                    Hủy
                  </button>
                  <button className="ft-primary">
                    {editingPartner ? "Lưu thay đổi" : "Thêm khách hàng"}
                  </button>
                </div>
              </form>
            </Dialog>
          )}
          {modal === "class" && (
            <Dialog title="Thêm lớp / phân nhóm" onClose={() => setModal(null)}>
              <form onSubmit={saveClass} className="grid gap-4">
                <label>
                  <span className="mb-1 block text-sm font-bold">
                    Khách hàng *
                  </span>
                  <select
                    required
                    value={cd.partner}
                    onChange={(e) => setCd({ ...cd, partner: e.target.value })}
                    className="w-full rounded-lg border px-3 py-2"
                  >
                    <option value="">Chọn khách hàng</option>
                    {partners.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Input
                  label="Tên lớp / phân nhóm *"
                  required
                  value={cd.name}
                  onChange={(e) => setCd({ ...cd, name: e.target.value })}
                  placeholder="Ví dụ: Lớp 1, Phòng 201, Khối Giáo dục"
                />
                <Input
                  label="Phòng ban / thành phần (nếu có)"
                  value={cd.members}
                  onChange={(e) => setCd({ ...cd, members: e.target.value })}
                  placeholder="Ví dụ: Phòng VH-TT, nhóm cán bộ..."
                />
                <Input
                  label="Số buổi dự kiến"
                  type="number"
                  min="0"
                  value={cd.planned_sessions}
                  onChange={(e) =>
                    setCd({ ...cd, planned_sessions: e.target.value })
                  }
                />
                <label>
                  <span className="mb-1 block text-sm font-bold">Ghi chú</span>
                  <textarea
                    value={cd.notes}
                    onChange={(e) => setCd({ ...cd, notes: e.target.value })}
                    className="min-h-16 w-full rounded-lg border px-3 py-2"
                  />
                </label>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="rounded-lg border px-4 py-2 text-sm font-bold"
                  >
                    Hủy
                  </button>
                  <button className="ft-primary">Lưu lớp/phân nhóm</button>
                </div>
              </form>
            </Dialog>
          )}
          {modal === "material" && (
            <Dialog title="Thêm tài liệu mới" onClose={() => setModal(null)}>
              <form onSubmit={saveMaterial} className="grid gap-4">
                <p className="rounded-lg bg-cyan-50 p-3 text-sm text-cyan-900">
                  Ưu tiên dán link Google Drive, Google Docs hoặc Google Sheets.
                  Hệ thống cũng nhận PDF, Word, PowerPoint, Excel, ảnh và các
                  tệp tài liệu phổ biến.
                </p>
                <Input
                  label="Tên tài liệu *"
                  required
                  value={md.title}
                  onChange={(e) => setMd({ ...md, title: e.target.value })}
                />
                <Input
                  label="Link tài liệu"
                  type="url"
                  value={md.external_url}
                  onChange={(e) =>
                    setMd({ ...md, external_url: e.target.value })
                  }
                  placeholder="https://drive.google.com/..."
                />
                <label>
                  <span className="mb-1 block text-sm font-bold">
                    Hoặc tải file lên
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.rtf,.odt,.ods,.odp,.jpg,.jpeg,.png,.gif,.webp"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="w-full rounded-lg border p-2 text-sm"
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label>
                    <span className="mb-1 block text-sm font-bold">
                      Buổi tập huấn
                    </span>
                    <select
                      value={md.session}
                      onChange={(e) =>
                        setMd({ ...md, session: e.target.value })
                      }
                      className="w-full rounded-lg border px-3 py-2"
                    >
                      <option value="">Không gắn buổi cụ thể</option>
                      {sessions.map((x) => (
                        <option key={x.id} value={x.id}>
                          {showDate(x.date)} · {x.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="mb-1 block text-sm font-bold">
                      Khách hàng
                    </span>
                    <select
                      value={md.partner}
                      onChange={(e) =>
                        setMd({ ...md, partner: e.target.value })
                      }
                      className="w-full rounded-lg border px-3 py-2"
                    >
                      <option value="">Không gắn khách hàng cụ thể</option>
                      {partners.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  <span className="mb-1 block text-sm font-bold">Ghi chú</span>
                  <textarea
                    value={md.notes}
                    onChange={(e) => setMd({ ...md, notes: e.target.value })}
                    className="min-h-16 w-full rounded-lg border px-3 py-2"
                  />
                </label>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="rounded-lg border px-4 py-2 text-sm font-bold"
                  >
                    Hủy
                  </button>
                  <button className="ft-primary">Thêm tài liệu</button>
                </div>
              </form>
            </Dialog>
          )}
          {modal === "survey" && (
            <Dialog
              title={
                editingSurvey ? "Chỉnh sửa form khảo sát" : "Tạo form khảo sát"
              }
              onClose={() => setModal(null)}
            >
              <form onSubmit={saveSurvey} className="grid gap-4">
                <div>
                  <button
                    type="button"
                    onClick={() => setSv({ ...sv, form_type: "end_session" })}
                    className="w-full rounded-xl border border-cyan-600 bg-cyan-50 p-4 text-left"
                  >
                    <ClipboardList className="h-6 w-6 text-cyan-700" />
                    <b className="mt-3 block">Tạo phiếu khảo sát cuối buổi</b>
                  </button>
                </div>
                <Input
                  label="Tên form *"
                  required
                  value={sv.title}
                  onChange={(e) => setSv({ ...sv, title: e.target.value })}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <label>
                    <span className="mb-1 block text-sm font-bold">
                      Lịch tập huấn *
                    </span>
                    <select
                      required
                      value={sv.session}
                      onChange={(e) => {
                        const nextSession = sessions.find(
                          (item) => String(item.id) === e.target.value,
                        );
                        setSv({
                          ...sv,
                          session: e.target.value,
                          partner: nextSession?.partner_id
                            ? String(nextSession.partner_id)
                            : "",
                        });
                      }}
                      className="w-full rounded-lg border px-3 py-2"
                    >
                      <option value="">Chọn lịch tập huấn</option>
                      {sessions.map((x) => (
                        <option key={x.id} value={x.id}>
                          {showDate(x.date)} · {x.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="mb-1 block text-sm font-bold">
                      Khách hàng
                    </span>
                    <div className="min-h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      {sessions.find((item) => String(item.id) === sv.session)
                        ?.partner_name ||
                        sessions.find((item) => String(item.id) === sv.session)
                          ?.partner ||
                        "Tự động theo lịch tập huấn"}
                    </div>
                  </label>
                </div>
                <label>
                  <span className="mb-1 block text-sm font-bold">Ghi chú</span>
                  <textarea
                    value={sv.notes}
                    onChange={(e) => setSv({ ...sv, notes: e.target.value })}
                    className="min-h-16 w-full rounded-lg border px-3 py-2"
                  />
                </label>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="rounded-lg border px-4 py-2 text-sm font-bold"
                  >
                    Hủy
                  </button>
                  <button className="ft-primary">
                    {editingSurvey ? "Lưu thay đổi" : "Tạo form"}
                  </button>
                </div>
              </form>
            </Dialog>
          )}
          <ConfirmModal
            isOpen={!!deleteSurvey}
            onClose={() => setDeleteSurvey(null)}
            onConfirm={removeSurvey}
            title="Xóa phiếu khảo sát"
            message={`Xóa ${deleteSurvey?.title || ""}? Thao tác này không thể hoàn tác.`}
            confirmText="Xóa phiếu khảo sát"
            type="danger"
          />
          <ConfirmModal
            isOpen={!!deleteActivity}
            onClose={() => setDeleteActivity(null)}
            onConfirm={removeActivity}
            title="Xóa lịch công tác"
            message={`Xóa ${deleteActivity?.title || ""}? Thao tác này không thể hoàn tác.`}
            confirmText="Xóa lịch"
            type="danger"
          />
          <ConfirmModal
            isOpen={!!deleteMaterial}
            onClose={() => setDeleteMaterial(null)}
            onConfirm={removeMaterial}
            title="Xóa tài liệu"
            message={`Xóa ${deleteMaterial?.title || ""}? Thao tác này không thể hoàn tác.`}
            confirmText="Xóa tài liệu"
            type="danger"
          />
          <ConfirmModal
            isOpen={!!deletePartner}
            onClose={() => setDeletePartner(null)}
            onConfirm={removePartner}
            title="Xóa khách hàng"
            message={`Xóa ${deletePartner?.name || ""}? Các lớp, buổi tập huấn, tài liệu và khảo sát liên quan cũng sẽ bị xóa.`}
            confirmText="Xóa khách hàng"
            type="danger"
          />
          <ConfirmModal
            isOpen={!!convertLead}
            onClose={() => setConvertLead(null)}
            onConfirm={promoteLead}
            title="Chuyển thành khách hàng hiện tại"
            message={`Xác nhận ${convertLead?.name || ""} đã ký hợp đồng? Hệ thống sẽ tạo khách hàng hiện tại, giữ nguyên hồ sơ khách hàng mới và toàn bộ lịch gặp liên kết.`}
            confirmText="Chuyển thành khách hàng"
            type="info"
          />          {notice && (
            <div className="fixed bottom-5 right-5 z-[60] flex max-w-md gap-3 rounded-xl border border-cyan-200 bg-white p-4 shadow-xl">
              <p className="text-sm font-semibold">{notice}</p>
              <button
                onClick={() => setNotice("")}
                className="text-sm font-bold text-slate-500"
              >
                Đóng
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
