// Hàm tiện ích, hằng số và đường dẫn của phân hệ Đào tạo số (tách từ DigitalTraining.tsx).
import React from "react";
import { BadgeDollarSign, BookOpen, CalendarDays, ClipboardList, FolderTree, Handshake, LayoutDashboard, Package, PackageSearch, Users } from "lucide-react";
import { type ProductView } from "./ProductManagement";

import type { Tab, TrainingScheduleDraft, PartnerClassDraft, PartnerDraft, CalendarItem, CalendarLayoutItem, CalendarDetail } from './digitalTrainingTypes';
import { formatDateVN } from '../../lib/format';

export const calendarMinute = (value?: string | null) => {
  const match = (value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return Number.NaN;
  const hour = Number(match[1]),
    minute = Number(match[2]);
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60
    ? hour * 60 + minute
    : Number.NaN;
};
export const calendarInterval = (item: CalendarItem) => {
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
export const newTrainingSchedule = (): TrainingScheduleDraft => ({
  date: "",
  start_time: "",
  location: "",
  unscheduled: false,
});
export const newClassDraft = (index: number): PartnerClassDraft => ({
  name: "",
  members: "",
  planned_sessions: "0",
  training_contents: [],
  training_schedule: [],
});
export const newPartnerDraft = (): PartnerDraft => ({
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
export const partnerSubtypeCatalog: Record<string, string[]> = {
  "Khối Giáo dục": ["Mầm non", "Tiểu học", "THCS", "THPT"],
  "Khối Hành chính công": ["Khối Xã/Phường", "Cơ quan nhà nước khác"],
};
export const categories = [
  "Triển khai BNDC",
  "Ứng dụng AI trong quản lý hành chính",
  "Ứng dụng AI trong giảng dạy",
  "Đào tạo lớp học số",
];
export const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Tổng quan", icon: LayoutDashboard },
  { id: "calendar", label: "Lịch", icon: CalendarDays },
  { id: "sessions", label: "Báo cáo lịch công tác", icon: ClipboardList },
  { id: "partners", label: "Danh sách khách hàng", icon: Handshake },
  { id: "subscriptions", label: "Theo dõi dịch vụ & Hạn dùng", icon: Package },
  { id: "partner-sessions", label: "Theo dõi tập huấn", icon: ClipboardList },
  { id: "products", label: "Sản phẩm & dịch vụ", icon: PackageSearch },
  { id: "finance", label: "Báo cáo thu chi", icon: BadgeDollarSign },
  { id: "survey", label: "Khảo sát", icon: Users },
  { id: "materials", label: "Tài liệu", icon: BookOpen },
  { id: "quanlybndc", label: "Quản lý BNDC", icon: FolderTree },
];
export const localDateKey = (value: Date) =>
  String(value.getFullYear()) +
  "-" +
  String(value.getMonth() + 1).padStart(2, "0") +
  "-" +
  String(value.getDate()).padStart(2, "0");
export const today = () => localDateKey(new Date());
export const showDate = (v?: string | null) => formatDateVN(v);
export const relativeMonthLabel = (offset = 0) => {
  const value = new Date();
  value.setDate(1);
  value.setMonth(value.getMonth() + offset);
  return `Tháng ${value.getMonth() + 1} - ${value.getFullYear()}`;
};
export const showTime = (s: {
  start_time?: string | null;
  end_time?: string | null;
}) =>
  [s.start_time?.slice(0, 5), s.end_time?.slice(0, 5)]
    .filter(Boolean)
    .join(" – ") || "Chưa đặt giờ";
export const threeHoursAfter = (value?: string | null) => {
  const [hour, minute] = (value || "").slice(0, 5).split(":");
  if (!/^\d{2}$/.test(hour) || !/^\d{2}$/.test(minute)) return "";
  const total = (Number(hour) + 3) * 60 + Number(minute);
  return `${String(Math.floor((total % 1440) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
export const status: { [key: string]: string } = {
  unscheduled: "Chưa có lịch",
  planned: "Đã lên lịch",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
};
export const scheduleStatusClass: Record<string, string> = {
  unscheduled: "border-amber-200 bg-amber-50 text-amber-700",
  planned: "border-blue-200 bg-blue-50 text-blue-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-slate-200 bg-slate-100 text-slate-600",
};
export const contractStatusClass: Record<string, string> = {
  not_signed: "border-amber-200 bg-amber-50 text-amber-700",
  negotiating: "border-blue-200 bg-blue-50 text-blue-700",
  signed: "border-cyan-200 bg-cyan-50 text-cyan-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  expiring: "border-orange-200 bg-orange-50 text-orange-700",
  expired: "border-rose-200 bg-rose-50 text-rose-700",
};
export function currentRoute() {
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
export const pathFor = (tab: Tab, id?: number | null) =>
  tab === "overview"
    ? "/digital-training"
    : tab === "products"
      ? "/digital-training/products/catalog"
      : (tab === "partners" || tab === "partner-sessions" || tab === "survey") &&
          id
        ? `/digital-training/${tab}/${id}`
        : `/digital-training/${tab}`;
export const productPath = (view: ProductView) => `/digital-training/products/${view}`;
export const calendarDetailPath = (detail: CalendarDetail) =>
  `/digital-training/calendar/${detail.kind}/${detail.sourceId}`;
export const menuOpenState = (tab: Tab, productView: ProductView) => ({
  schedule: tab === "calendar" || tab === "sessions",
  customer:
    tab === "partners" ||
    tab === "leads" ||
    tab === "subscriptions" ||
    tab === "partner-sessions" ||
    (tab === "products" && productView === "allocation"),
  products: tab === "products" && productView !== "allocation",
  survey: tab === "survey",
});
export const vietnamProvinces = [
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
export const provinceOptions = vietnamProvinces.map((value) => ({
  value,
  label: value,
}));
