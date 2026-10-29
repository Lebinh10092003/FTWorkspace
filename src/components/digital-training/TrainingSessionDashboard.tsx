import React, { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  CalendarCheck,
  CalendarDays, CheckCircle2, Clock,
  Download,
  ExternalLink, GraduationCap,
  Layers, Pencil,
  Plus,
  RefreshCw,
  Search, Trash2, Users, X,
  XCircle
} from "lucide-react";
import { Badge } from "../ui/badge";
import { matchesSearch } from "../../lib/searchText";
import { appDialog } from "../AppDialog";
import { todayVN } from '../../lib/vnDate';

export type SessionStatus = "unscheduled" | "planned" | "completed" | "cancelled";

export type SessionItem = {
  id: number;
  title: string;
  source?: string;
  session_number?: number | null;
  date: string | null;
  start_time?: string | null;
  end_time?: string | null;
  partner: string;
  partner_id?: number | null;
  partner_name?: string;
  class_group_id?: number | null;
  class_group_name?: string;
  category?: string;
  contents?: string[];
  attendees?: number;
  location?: string;
  status: SessionStatus;
  notes?: string;
  staff_name?: string;
  instructor_name?: string;
  support_staff_name?: string;
  has_materials?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type ClassItem = {
  id: number;
  partner: number;
  partner_name?: string;
  name: string;
  members?: string;
  planned_sessions: number;
  training_contents?: string[];
  completed_sessions?: number;
  notes?: string;
  created_at?: string;
  updated_at?: string;
};

export type PartnerOption = {
  id: number;
  name: string;
  partner_type?: string;
  contact_person?: string;
  phone?: string;
  contract_status?: string;
  planned_sessions?: number;
  training_contents?: string[];
  notes?: string;
};

export interface TrainingSessionDashboardProps {
  partners: PartnerOption[];
  idToken: string;
  isGuest: boolean;
  onOpenPartnerDetail?: (partnerId: number) => void;
  onAddPartner?: () => void;
}

const GOOGLE_SHEET_URL = "https://docs.google.com/spreadsheets/d/1ENU0abZu6hCiVz-u7ypMLmLzudzMewKF_6s-6NJ26qk/edit?usp=sharing";

const TRAINING_TOPICS = [
  "Ứng dụng AI trong quản lý hành chính",
  "Ứng dụng AI trong giảng dạy",
  "Đào tạo lớp học số",
  "Ứng dụng AI trong kiểm tra đánh giá",
  "Tập huấn chuyên sâu giáo viên",
];

export default function TrainingSessionDashboard({
  partners,
  idToken,
  isGuest,
  onOpenPartnerDetail,
  onAddPartner,
}: TrainingSessionDashboardProps) {
  // Data states
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [employees, setEmployees] = useState<{ name: string; email: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  // View state: timeline (Nhật ký ca học) vs matrix (Tiến độ trường & lớp)
  const [viewMode, setViewMode] = useState<"timeline" | "matrix">("timeline");

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [partnerFilter, setPartnerFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [timeFilter, setTimeFilter] = useState<string>("all"); // all, this_month, upcoming, past

  // Session Modal State
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<{
    id?: number;
    partner_id: string;
    class_group_id: string;
    session_number: number;
    title: string;
    date: string;
    start_time: string;
    end_time: string;
    instructor_name: string;
    support_staff_name: string;
    attendees: number;
    location: string;
    status: SessionStatus;
    contents: string[];
    notes: string;
  }>({
    partner_id: "",
    class_group_id: "",
    session_number: 1,
    title: "",
    date: "",
    start_time: "08:30",
    end_time: "11:30",
    instructor_name: "",
    support_staff_name: "",
    attendees: 0,
    location: "Trực tiếp tại trường",
    status: "planned",
    contents: [],
    notes: "",
  });
  const [savingSession, setSavingSession] = useState(false);

  // Class Modal State
  const [classModalOpen, setClassModalOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<{
    id?: number;
    partner: string;
    name: string;
    members: string;
    planned_sessions: number;
    training_contents: string[];
    notes: string;
  }>({
    partner: "",
    name: "",
    members: "",
    planned_sessions: 3,
    training_contents: [],
    notes: "",
  });
  const [savingClass, setSavingClass] = useState(false);

  const authHeader = useMemo(
    () => (idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    [idToken],
  );

  const partnerMap = useMemo(() => new Map(partners.map((p) => [p.id, p])), [partners]);

  // Load all initial data
  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [sessRes, classRes, staffRes] = await Promise.all([
        fetch("/api/digital-training/sessions", { credentials: "include", headers: authHeader }),
        fetch("/api/digital-training/classes", { credentials: "include", headers: authHeader }),
        fetch("/api/auth/assignable-staff", { credentials: "include", headers: authHeader }),
      ]);

      if (sessRes.ok) {
        const sessData = await sessRes.json();
        setSessions(Array.isArray(sessData) ? sessData : []);
      }
      if (classRes.ok) {
        const classData = await classRes.json();
        setClasses(Array.isArray(classData) ? classData : []);
      }
      if (staffRes.ok) {
        const staffData = await staffRes.json();
        setEmployees(Array.isArray(staffData) ? staffData : []);
      }
    } catch (err: any) {
      void appDialog.alert(err.message || "Lỗi tải dữ liệu ca tập huấn.", {
        title: "Lỗi tải dữ liệu",
        tone: "danger",
      });
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [idToken]);

  // 2-way Google Sheet Sync
  const handleSyncSheet = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/digital-training/sessions/sheet-sync", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể đồng bộ với Google Sheet.");
      }
      const nowStr = new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      setLastSynced(nowStr);
      await appDialog.alert(
        `Đồng bộ thành công Tab Nhật ký tập huấn!\nĐã xuất ${data.exported_count || 0} ca học sang Google Sheet.`,
        { title: "Đồng bộ thành công", tone: "success" }
      );
      await loadData(true);
    } catch (err: any) {
      await appDialog.alert(
        err.message || "Đồng bộ thất bại. Vui lòng kiểm tra quyền truy cập Sheet.",
        { title: "Lỗi đồng bộ", tone: "danger" }
      );
    } finally {
      setSyncing(false);
    }
  };

  // Helper date formatters
  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return "Chưa xếp ngày";
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const formatTime = (start?: string | null, end?: string | null) => {
    if (!start && !end) return "Chưa xếp giờ";
    const s = (start || "").slice(0, 5);
    const e = (end || "").slice(0, 5);
    return `${s || "—"} - ${e || "—"}`;
  };

  // Stats calculation
  const stats = useMemo(() => {
    const totalSessions = sessions.length;
    const completedSessions = sessions.filter((s) => s.status === "completed").length;
    const plannedSessions = sessions.filter((s) => s.status === "planned").length;
    const totalAttendees = sessions.reduce((sum, s) => sum + (Number(s.attendees) || 0), 0);
    const completionRate = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;
    const totalClasses = classes.length;
    return {
      totalSessions,
      completedSessions,
      plannedSessions,
      totalAttendees,
      completionRate,
      totalClasses,
    };
  }, [sessions, classes]);

  // Filtered Sessions for Timeline
  const filteredSessions = useMemo(() => {
    const today = todayVN();
    const thisMonth = today.slice(0, 7);

    return sessions
      .filter((s) => {
        // Partner filter
        if (partnerFilter !== "all" && String(s.partner_id) !== partnerFilter) return false;

        // Status filter
        if (statusFilter !== "all" && s.status !== statusFilter) return false;

        // Topic filter
        if (topicFilter !== "all") {
          const contents = s.contents || [];
          if (!contents.includes(topicFilter) && s.category !== topicFilter) return false;
        }

        // Time filter
        if (timeFilter === "this_month") {
          if (!s.date || !s.date.startsWith(thisMonth)) return false;
        } else if (timeFilter === "upcoming") {
          if (!s.date || s.date < today) return false;
        } else if (timeFilter === "past") {
          if (!s.date || s.date >= today) return false;
        }

        // Search query
        if (searchQuery.trim()) {
          const pName = s.partner_name || s.partner || "";
          const cName = s.class_group_name || "";
          const iName = s.instructor_name || "";
          const sName = s.support_staff_name || "";
          const loc = s.location || "";
          const notes = s.notes || "";
          const title = s.title || "";
          const cont = (s.contents || []).join(" ");
          const combined = `${pName} ${cName} ${iName} ${sName} ${loc} ${notes} ${title} ${cont}`;
          if (!matchesSearch(combined, searchQuery)) return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Sort by date descending (newest first), then start_time
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return (a.start_time || "").localeCompare(b.start_time || "");
      });
  }, [sessions, partnerFilter, statusFilter, topicFilter, timeFilter, searchQuery]);

  // Filtered Matrix (Schools + Classes)
  const matrixData = useMemo(() => {
    return partners
      .filter((p) => {
        if (partnerFilter !== "all" && String(p.id) !== partnerFilter) return false;
        if (searchQuery.trim() && !matchesSearch(`${p.name} ${p.contact_person || ""}`, searchQuery)) return false;
        return true;
      })
      .map((p) => {
        const partnerClasses = classes.filter((c) => c.partner === p.id);
        const effectiveClasses: ClassItem[] = partnerClasses.length
          ? partnerClasses
          : [
              {
                id: 0,
                partner: p.id,
                partner_name: p.name,
                name: "Lớp chung / Toàn trường",
                members: "Tất cả giáo viên",
                planned_sessions: p.planned_sessions || 3,
                training_contents: p.training_contents || [],
                completed_sessions: 0,
              },
            ];

        return {
          partner: p,
          classes: effectiveClasses.map((cls) => {
            const clsSessions = sessions
              .filter((s) => (cls.id ? s.class_group_id === cls.id : s.partner_id === p.id && !s.class_group_id))
              .sort((a, b) => (a.session_number || 0) - (b.session_number || 0));

            const completedCount = clsSessions.filter((s) => s.status === "completed").length;
            return {
              classInfo: cls,
              sessions: clsSessions,
              completedCount,
              plannedCount: cls.planned_sessions || p.planned_sessions || 3,
            };
          }),
        };
      });
  }, [partners, classes, sessions, partnerFilter, searchQuery]);

  // Export CSV
  const handleExportCSV = () => {
    const headers = [
      "STT",
      "Ngày tập huấn",
      "Khung giờ",
      "Trường / Khách hàng",
      "Lớp / Phân nhóm",
      "Buổi thứ",
      "Nội dung đào tạo",
      "Giảng viên chính",
      "Trợ giảng",
      "Số học viên",
      "Hình thức / Địa điểm",
      "Trạng thái",
      "Ghi chú",
    ];

    const rows = filteredSessions.map((s, index) => {
      const statusText =
        s.status === "completed"
          ? "Đã hoàn thành"
          : s.status === "planned"
            ? "Đã lên lịch"
            : s.status === "cancelled"
              ? "Đã hủy"
              : "Chưa có lịch";

      return [
        index + 1,
        s.date || "",
        formatTime(s.start_time, s.end_time),
        `"${(s.partner_name || s.partner || "").replace(/"/g, '""')}"`,
        `"${(s.class_group_name || "Lớp chung").replace(/"/g, '""')}"`,
        s.session_number || 1,
        `"${(s.contents || []).join(", ").replace(/"/g, '""')}"`,
        `"${(s.instructor_name || "").replace(/"/g, '""')}"`,
        `"${(s.support_staff_name || "").replace(/"/g, '""')}"`,
        s.attendees || 0,
        `"${(s.location || "").replace(/"/g, '""')}"`,
        statusText,
        `"${(s.notes || "").replace(/"/g, '""')}"`,
      ];
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Nhat_ky_tap_huan_${todayVN()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Open Add Session Modal
  const handleOpenAddSession = (presetPartnerId?: number, presetClassId?: number, nextSessionNum?: number) => {
    const selectedP = presetPartnerId ? partnerMap.get(presetPartnerId) : partners[0];
    const initialPartnerId = selectedP ? String(selectedP.id) : "";
    const partnerClasses = classes.filter((c) => String(c.partner) === initialPartnerId);

    setEditingSession({
      partner_id: initialPartnerId,
      class_group_id: presetClassId ? String(presetClassId) : partnerClasses[0] ? String(partnerClasses[0].id) : "",
      session_number: nextSessionNum || 1,
      title: `Buổi ${nextSessionNum || 1}: Tập huấn đào tạo số`,
      date: todayVN(),
      start_time: "08:30",
      end_time: "11:30",
      instructor_name: employees[0]?.name || "",
      support_staff_name: employees[1]?.name || "",
      attendees: 30,
      location: "Trực tiếp tại trường",
      status: "planned",
      contents: [TRAINING_TOPICS[0]],
      notes: "",
    });
    setSessionModalOpen(true);
  };

  // Open Edit Session Modal
  const handleOpenEditSession = (s: SessionItem) => {
    setEditingSession({
      id: s.id,
      partner_id: String(s.partner_id || ""),
      class_group_id: s.class_group_id ? String(s.class_group_id) : "",
      session_number: s.session_number || 1,
      title: s.title || `Buổi ${s.session_number || 1}`,
      date: s.date || "",
      start_time: s.start_time ? s.start_time.slice(0, 5) : "08:30",
      end_time: s.end_time ? s.end_time.slice(0, 5) : "11:30",
      instructor_name: s.instructor_name || "",
      support_staff_name: s.support_staff_name || "",
      attendees: s.attendees || 0,
      location: s.location || "Trực tiếp tại trường",
      status: s.status,
      contents: s.contents || [],
      notes: s.notes || "",
    });
    setSessionModalOpen(true);
  };

  // Save Session
  const handleSaveSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSession.partner_id) {
      void appDialog.alert("Vui lòng chọn trường / khách hàng.");
      return;
    }
    setSavingSession(true);

    const partner = partnerMap.get(Number(editingSession.partner_id));
    const payload: any = {
      title: editingSession.title.trim() || `Buổi ${editingSession.session_number}`,
      session_number: Number(editingSession.session_number) || 1,
      date: editingSession.date || null,
      start_time: editingSession.start_time || null,
      end_time: editingSession.end_time || null,
      partner_id: Number(editingSession.partner_id),
      partner: partner?.name || "",
      class_group_id: editingSession.class_group_id ? Number(editingSession.class_group_id) : null,
      instructor_name: editingSession.instructor_name.trim(),
      support_staff_name: editingSession.support_staff_name.trim(),
      attendees: Number(editingSession.attendees) || 0,
      location: editingSession.location.trim(),
      status: editingSession.status,
      contents: editingSession.contents,
      notes: editingSession.notes.trim(),
    };

    try {
      const url = editingSession.id
        ? `/api/digital-training/sessions/${editingSession.id}`
        : "/api/digital-training/sessions";
      const method = editingSession.id ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || data.detail || JSON.stringify(data));
      }

      setSessionModalOpen(false);
      await appDialog.alert(
        editingSession.id ? "Đã cập nhật ca tập huấn thành công!" : "Đã tạo mới ca tập huấn thành công!",
        { title: "Thành công", tone: "success" }
      );
      await loadData(true);
    } catch (err: any) {
      await appDialog.alert(`Lỗi lưu ca tập huấn: ${err.message}`, { title: "Lỗi lưu ca học", tone: "danger" });
    } finally {
      setSavingSession(false);
    }
  };

  // Delete Session with appDialog.confirm
  const handleDeleteSession = async (session: SessionItem) => {
    const confirmed = await appDialog.confirm(
      `Bạn có chắc chắn muốn xóa ca tập huấn "${session.title}" (${session.partner_name || session.partner})?\n\nHành động này sẽ được ghi log kiểm tra và cập nhật tức thì ra Google Sheet.`,
      {
        title: "Xác nhận xóa ca tập huấn",
        confirmText: "Xóa ca học",
        cancelText: "Hủy bỏ",
        tone: "danger",
      }
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/digital-training/sessions/${session.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: authHeader,
      });
      if (!res.ok) {
        throw new Error("Không thể xóa ca tập huấn.");
      }
      await appDialog.alert("Đã xóa ca tập huấn thành công.", { title: "Đã xóa", tone: "success" });
      await loadData(true);
    } catch (err: any) {
      await appDialog.alert(err.message || "Không thể xóa ca tập huấn.", { title: "Lỗi", tone: "danger" });
    }
  };

  // Open Add Class Modal
  const handleOpenAddClass = (presetPartnerId?: number) => {
    setEditingClass({
      partner: presetPartnerId ? String(presetPartnerId) : partners[0] ? String(partners[0].id) : "",
      name: "",
      members: "30 giáo viên",
      planned_sessions: 3,
      training_contents: [TRAINING_TOPICS[0]],
      notes: "",
    });
    setClassModalOpen(true);
  };

  // Save Class
  const handleSaveClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClass.partner || !editingClass.name.trim()) {
      void appDialog.alert("Vui lòng nhập đầy đủ trường và tên lớp.");
      return;
    }
    setSavingClass(true);
    try {
      const res = await fetch("/api/digital-training/classes", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify({
          partner: Number(editingClass.partner),
          name: editingClass.name.trim(),
          members: editingClass.members.trim(),
          planned_sessions: Number(editingClass.planned_sessions) || 1,
          training_contents: editingClass.training_contents,
          notes: editingClass.notes.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || JSON.stringify(data));
      }
      setClassModalOpen(false);
      await appDialog.alert("Đã tạo lớp / phân nhóm mới thành công!", { title: "Thành công", tone: "success" });
      await loadData(true);
    } catch (err: any) {
      await appDialog.alert(`Lỗi tạo lớp: ${err.message}`, { title: "Lỗi", tone: "danger" });
    } finally {
      setSavingClass(false);
    }
  };

  // Helper status badge renderer
  const renderStatusBadge = (status: SessionStatus) => {
    switch (status) {
      case "completed":
        return (
          <Badge variant="success" className="gap-1 font-medium">
            <CheckCircle2 className="h-3 w-3" />
            Đã hoàn thành
          </Badge>
        );
      case "planned":
        return (
          <Badge variant="info" className="gap-1 font-medium">
            <Clock className="h-3 w-3" />
            Đã lên lịch
          </Badge>
        );
      case "unscheduled":
        return (
          <Badge variant="warning" className="gap-1 font-medium">
            <Calendar className="h-3 w-3" />
            Chưa có lịch
          </Badge>
        );
      case "cancelled":
        return (
          <Badge variant="destructive" className="gap-1 font-medium">
            <XCircle className="h-3 w-3" />
            Đã hủy
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">

      {/* Modern Header Section */}
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 md:text-2xl">
                Theo dõi & Nhật ký tập huấn
              </h1>
              <p className="text-xs text-slate-500 md:text-sm">
                Quản lý các ca đào tạo số, phân nhóm lớp học, tiến độ hoàn thành và đồng bộ 2 chiều với Google Sheet.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Mở Google Sheet Button */}
          <a
            href={GOOGLE_SHEET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <ExternalLink className="h-3.5 w-3.5 text-emerald-600" />
            Mở Sheet Nhật ký
          </a>

          {/* Sync Button */}
          {!isGuest && (
            <button
              onClick={handleSyncSheet}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3.5 py-2 text-xs font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-100/80 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-indigo-600 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Đang đồng bộ..." : "Đồng bộ Sheet"}
            </button>
          )}

          {/* Export CSV */}
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5 text-slate-500" />
            Xuất CSV
          </button>

          {/* Add Session Button */}
          {!isGuest && (
            <button
              onClick={() => handleOpenAddSession()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              <Plus className="h-4 w-4" />
              Thêm ca tập huấn
            </button>
          )}

          {/* Add Class Button */}
          {!isGuest && (
            <button
              onClick={() => handleOpenAddClass()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3.5 py-2 text-xs font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <Plus className="h-3.5 w-3.5 text-indigo-600" />
              Thêm lớp / nhóm
            </button>
          )}
        </div>
      </div>

      {/* Sync Status Banner */}
      {lastSynced && (
        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2 text-xs text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Đã đồng bộ lần cuối lúc: <b>{lastSynced}</b> (Tab 2: Nhật ký tập huấn)
          </span>
          <span className="text-slate-400">Tự động cập nhật 2 chiều khi chỉnh sửa</span>
        </div>
      )}

      {/* Bento KPI Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Tổng ca tập huấn */}
        <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Tổng số ca tập huấn
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <CalendarCheck className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
              {stats.totalSessions}
            </span>
            <span className="text-xs font-medium text-slate-500">ca đã ghi nhận</span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Phân bổ cho <b>{stats.totalClasses}</b> lớp / phân nhóm đào tạo
          </div>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-indigo-500 to-indigo-600" />
        </div>

        {/* Card 2: Đã hoàn thành */}
        <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Đã hoàn thành
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-emerald-700 md:text-3xl">
              {stats.completedSessions}
            </span>
            <span className="text-xs font-medium text-slate-500">/ {stats.totalSessions} ca</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-slate-100">
              <div
                className="h-1.5 rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${stats.completionRate}%` }}
              />
            </div>
            <span className="text-xs font-bold text-emerald-600">{stats.completionRate}%</span>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-emerald-500 to-emerald-600" />
        </div>

        {/* Card 3: Sắp diễn ra */}
        <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Sắp diễn ra / Đã lên lịch
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-sky-700 md:text-3xl">
              {stats.plannedSessions}
            </span>
            <span className="text-xs font-medium text-slate-500">ca đã chốt lịch</span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Giảng viên & trợ giảng đã được phân công đầy đủ
          </div>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-sky-500 to-sky-600" />
        </div>

        {/* Card 4: Tổng học viên */}
        <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Tổng số học viên / GV
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-purple-700 md:text-3xl">
              {stats.totalAttendees.toLocaleString("vi-VN")}
            </span>
            <span className="text-xs font-medium text-slate-500">lượt tham dự</span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Trung bình{" "}
            <b>
              {stats.totalSessions > 0
                ? Math.round(stats.totalAttendees / stats.totalSessions)
                : 0}
            </b>{" "}
            người / ca
          </div>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-purple-500 to-purple-600" />
        </div>
      </div>

      {/* Main Content Section */}
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        {/* Navigation View Switcher & Action Tabs */}
        <div className="flex flex-col gap-4 border-b border-slate-200/80 p-5 sm:flex-row sm:items-center sm:justify-between">
          {/* View Mode Buttons */}
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            <button
              onClick={() => setViewMode("timeline")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                viewMode === "timeline"
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Nhật ký ca tập huấn (Timeline)
            </button>
            <button
              onClick={() => setViewMode("matrix")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                viewMode === "matrix"
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              Tiến độ theo trường & lớp (Matrix)
            </button>
          </div>

          <div className="text-xs text-slate-500">
            Hiển thị <b>{viewMode === "timeline" ? filteredSessions.length : matrixData.length}</b> kết quả phù hợp
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="grid grid-cols-1 gap-3 border-b border-slate-100 bg-slate-50/50 p-4 sm:grid-cols-2 lg:grid-cols-5">
          {/* Search Box */}
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm trường, lớp, GV, nội dung..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-slate-800 placeholder-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Partner Filter */}
          <select
            value={partnerFilter}
            onChange={(e) => setPartnerFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">Tất cả khách hàng / Trường</option>
            {partners.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.name}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="completed">Đã hoàn thành</option>
            <option value="planned">Đã lên lịch</option>
            <option value="unscheduled">Chưa có lịch</option>
            <option value="cancelled">Đã hủy</option>
          </select>

          {/* Topic Filter */}
          <select
            value={topicFilter}
            onChange={(e) => setTopicFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">Tất cả nội dung đào tạo</option>
            {TRAINING_TOPICS.map((topic) => (
              <option key={topic} value={topic}>
                {topic}
              </option>
            ))}
          </select>

          {/* Time Filter */}
          <select
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">Tất cả thời gian</option>
            <option value="this_month">Trong tháng này</option>
            <option value="upcoming">Sắp diễn ra</option>
            <option value="past">Đã qua</option>
          </select>
        </div>

        {/* View Content */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <RefreshCw className="h-8 w-8 animate-spin text-indigo-500" />
            <p className="mt-3 text-sm font-medium">Đang tải nhật ký ca tập huấn...</p>
          </div>
        ) : viewMode === "timeline" ? (
          /* TIMELINE / SESSION LOG TABLE */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
                  <th className="px-4 py-3 font-semibold">STT</th>
                  <th className="px-4 py-3 font-semibold">Ngày & Giờ</th>
                  <th className="px-4 py-3 font-semibold">Trường / Khách hàng</th>
                  <th className="px-4 py-3 font-semibold">Lớp / Phân nhóm</th>
                  <th className="px-4 py-3 font-semibold">Buổi số</th>
                  <th className="px-4 py-3 font-semibold">Nội dung tập huấn</th>
                  <th className="px-4 py-3 font-semibold">Giảng viên chính</th>
                  <th className="px-4 py-3 font-semibold">Trợ giảng</th>
                  <th className="px-4 py-3 font-semibold">Học viên</th>
                  <th className="px-4 py-3 font-semibold">Trạng thái</th>
                  <th className="px-4 py-3 text-right font-semibold">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSessions.length ? (
                  filteredSessions.map((s, index) => {
                    const partner = partnerMap.get(s.partner_id || 0);
                    return (
                      <tr
                        key={s.id}
                        className="group transition-colors hover:bg-indigo-50/30"
                      >
                        {/* STT */}
                        <td className="px-4 py-3.5 font-medium text-slate-400">{index + 1}</td>

                        {/* Ngày & Giờ */}
                        <td className="px-4 py-3.5">
                          <div className="font-semibold text-slate-900">{formatDate(s.date)}</div>
                          <div className="flex items-center gap-1 text-[11px] text-slate-500">
                            <Clock className="h-3 w-3 text-slate-400" />
                            {formatTime(s.start_time, s.end_time)}
                          </div>
                        </td>

                        {/* Trường học */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-900">
                              {s.partner_name || s.partner || "Chưa chọn trường"}
                            </span>
                            {s.partner_id && onOpenPartnerDetail && (
                              <button
                                onClick={() => onOpenPartnerDetail(s.partner_id!)}
                                title="Xem chi tiết khách hàng"
                                className="text-slate-400 opacity-0 transition group-hover:opacity-100 hover:text-indigo-600"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                          {partner?.contact_person && (
                            <span className="text-[11px] text-slate-500">
                              ĐD: {partner.contact_person}
                            </span>
                          )}
                        </td>

                        {/* Lớp / Phân nhóm */}
                        <td className="px-4 py-3.5">
                          <span className="inline-flex rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                            {s.class_group_name || "Lớp chung"}
                          </span>
                        </td>

                        {/* Buổi số */}
                        <td className="px-4 py-3.5">
                          <span className="inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-bold text-indigo-700">
                            Buổi {s.session_number || 1}
                          </span>
                        </td>

                        {/* Nội dung */}
                        <td className="max-w-xs px-4 py-3.5">
                          <div className="flex flex-wrap gap-1">
                            {(s.contents && s.contents.length > 0 ? s.contents : [s.title || "Tập huấn"]).map(
                              (c) => (
                                <span
                                  key={c}
                                  className="rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-800"
                                >
                                  {c}
                                </span>
                              ),
                            )}
                          </div>
                        </td>

                        {/* Giảng viên */}
                        <td className="px-4 py-3.5">
                          {s.instructor_name ? (
                            <div className="flex items-center gap-1.5 text-slate-800">
                              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700">
                                {s.instructor_name.charAt(0)}
                              </div>
                              <span className="font-medium">{s.instructor_name}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        {/* Trợ giảng */}
                        <td className="px-4 py-3.5">
                          {s.support_staff_name ? (
                            <div className="flex items-center gap-1.5 text-slate-700">
                              <span className="text-slate-400">·</span>
                              <span>{s.support_staff_name}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        {/* Học viên */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1 font-semibold text-slate-800">
                            <Users className="h-3 w-3 text-slate-400" />
                            {s.attendees ? s.attendees.toLocaleString("vi-VN") : "0"}
                          </div>
                        </td>

                        {/* Trạng thái */}
                        <td className="px-4 py-3.5">{renderStatusBadge(s.status)}</td>

                        {/* Thao tác */}
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {!isGuest && (
                              <>
                                <button
                                  onClick={() => handleOpenEditSession(s)}
                                  title="Chỉnh sửa ca tập huấn"
                                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => void handleDeleteSession(s)}
                                  title="Xóa ca tập huấn"
                                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-slate-400">
                      <GraduationCap className="mx-auto h-8 w-8 text-slate-300" />
                      <p className="mt-2 font-medium">Không tìm thấy ca tập huấn nào phù hợp.</p>
                      <p className="text-[11px] text-slate-400">Thử thay đổi bộ lọc tìm kiếm hoặc thêm ca học mới.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* MATRIX PROGRESS VIEW */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
                  <th className="px-4 py-3 font-semibold">STT</th>
                  <th className="px-4 py-3 font-semibold">Trường học / Đơn vị</th>
                  <th className="px-4 py-3 font-semibold">Lớp / Phân nhóm</th>
                  <th className="px-4 py-3 font-semibold">Nội dung đào tạo</th>
                  <th className="px-4 py-3 font-semibold">Tiến độ (Buổi)</th>
                  <th className="px-4 py-3 font-semibold">Chi tiết từng buổi tập huấn</th>
                  <th className="px-4 py-3 text-right font-semibold">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {matrixData.length ? (
                  matrixData.flatMap(({ partner, classes: pClasses }, pIndex) =>
                    pClasses.map((item, cIndex) => {
                      const { classInfo, sessions: clsSessions, completedCount, plannedCount } = item;
                      const progressPct =
                        plannedCount > 0 ? Math.min(100, Math.round((completedCount / plannedCount) * 100)) : 0;

                      return (
                        <tr
                          key={`${partner.id}-${classInfo.id || cIndex}`}
                          className="group transition-colors hover:bg-slate-50/60"
                        >
                          {/* STT */}
                          <td className="px-4 py-3.5 font-medium text-slate-400">
                            {cIndex === 0 ? pIndex + 1 : ""}
                          </td>

                          {/* Trường học */}
                          <td className="px-4 py-3.5">
                            {cIndex === 0 && (
                              <div>
                                <div className="font-bold text-slate-900">{partner.name}</div>
                                {partner.contact_person && (
                                  <span className="text-[11px] text-slate-500">
                                    {partner.contact_person}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Lớp / Phân nhóm */}
                          <td className="px-4 py-3.5">
                            <div className="font-semibold text-slate-800">{classInfo.name}</div>
                            {classInfo.members && (
                              <span className="text-[11px] text-slate-500">
                                Đối tượng: {classInfo.members}
                              </span>
                            )}
                          </td>

                          {/* Nội dung đào tạo */}
                          <td className="max-w-xs px-4 py-3.5">
                            <div className="flex flex-wrap gap-1">
                              {(classInfo.training_contents || partner.training_contents || []).map((c) => (
                                <span
                                  key={c}
                                  className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700"
                                >
                                  {c}
                                </span>
                              ))}
                            </div>
                          </td>

                          {/* Tiến độ */}
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-800">
                                {completedCount} / {plannedCount}
                              </span>
                              <div className="h-1.5 w-16 rounded-full bg-slate-200">
                                <div
                                  className={`h-1.5 rounded-full ${
                                    completedCount >= plannedCount ? "bg-emerald-500" : "bg-indigo-600"
                                  }`}
                                  style={{ width: `${progressPct}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          {/* Các buổi */}
                          <td className="px-4 py-3.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {Array.from({ length: Math.max(plannedCount, clsSessions.length) }, (_, i) => {
                                const slotNum = i + 1;
                                const sessionInSlot = clsSessions.find(
                                  (s) => s.session_number === slotNum,
                                );

                                if (sessionInSlot) {
                                  const isComp = sessionInSlot.status === "completed";
                                  const isPlan = sessionInSlot.status === "planned";
                                  return (
                                    <button
                                      key={slotNum}
                                      onClick={() => handleOpenEditSession(sessionInSlot)}
                                      title={`Buổi ${slotNum}: ${sessionInSlot.title} (${sessionInSlot.date || "Chưa có ngày"}) - Nhấn để xem/sửa`}
                                      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                                        isComp
                                          ? "border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                                          : isPlan
                                            ? "border border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100"
                                            : "border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200"
                                      }`}
                                    >
                                      {isComp ? (
                                        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                      ) : (
                                        <Clock className="h-3 w-3 text-sky-600" />
                                      )}
                                      Buổi {slotNum}
                                      {sessionInSlot.date && (
                                        <span className="font-normal opacity-75">
                                          ({sessionInSlot.date.slice(5)})
                                        </span>
                                      )}
                                    </button>
                                  );
                                }

                                return (
                                  <button
                                    key={slotNum}
                                    onClick={() =>
                                      handleOpenAddSession(partner.id, classInfo.id, slotNum)
                                    }
                                    title={`Chưa lên lịch buổi ${slotNum} - Nhấn để thêm nhanh`}
                                    className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-500 hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700"
                                  >
                                    <Plus className="h-3 w-3" />
                                    Buổi {slotNum}
                                  </button>
                                );
                              })}
                            </div>
                          </td>

                          {/* Thao tác */}
                          <td className="px-4 py-3.5 text-right">
                            {!isGuest && (
                              <button
                                onClick={() =>
                                  handleOpenAddSession(partner.id, classInfo.id, clsSessions.length + 1)
                                }
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-indigo-600"
                              >
                                <Plus className="h-3 w-3" />
                                Thêm ca
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    }),
                  )
                ) : (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      Không có dữ liệu trường học phù hợp.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: Thêm / Sửa Buổi tập huấn */}
      {sessionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  <GraduationCap className="h-4 w-4" />
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  {editingSession.id ? "Chỉnh sửa ca tập huấn" : "Thêm mới ca tập huấn"}
                </h3>
              </div>
              <button
                onClick={() => setSessionModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveSession} className="space-y-4 p-6 text-xs">
              {/* Partner Select */}
              <div>
                <label className="mb-1 block font-semibold text-slate-700">
                  Trường học / Khách hàng <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={editingSession.partner_id}
                  onChange={(e) => {
                    const pId = e.target.value;
                    const partnerClasses = classes.filter((c) => String(c.partner) === pId);
                    setEditingSession({
                      ...editingSession,
                      partner_id: pId,
                      class_group_id: partnerClasses[0] ? String(partnerClasses[0].id) : "",
                    });
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">-- Chọn trường học --</option>
                  {partners.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Class Select & Session Number */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">
                    Lớp / Phân nhóm
                  </label>
                  <select
                    value={editingSession.class_group_id}
                    onChange={(e) =>
                      setEditingSession({ ...editingSession, class_group_id: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">-- Lớp chung / Chưa phân nhóm --</option>
                    {classes
                      .filter((c) => String(c.partner) === editingSession.partner_id)
                      .map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.name} ({c.planned_sessions} buổi)
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-slate-700">
                    Buổi thứ mấy? <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    required
                    value={editingSession.session_number}
                    onChange={(e) =>
                      setEditingSession({
                        ...editingSession,
                        session_number: Number(e.target.value),
                        title: `Buổi ${e.target.value}: Tập huấn đào tạo số`,
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Title / Topic */}
              <div>
                <label className="mb-1 block font-semibold text-slate-700">
                  Tiêu đề ca tập huấn
                </label>
                <input
                  type="text"
                  value={editingSession.title}
                  onChange={(e) => setEditingSession({ ...editingSession, title: e.target.value })}
                  placeholder="Ví dụ: Buổi 1: Ứng dụng AI trong giảng dạy môn Toán"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Date & Time */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">Ngày tập huấn</label>
                  <input
                    type="date"
                    value={editingSession.date}
                    onChange={(e) => setEditingSession({ ...editingSession, date: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">Giờ bắt đầu</label>
                  <input
                    type="time"
                    value={editingSession.start_time}
                    onChange={(e) =>
                      setEditingSession({ ...editingSession, start_time: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">Giờ kết thúc</label>
                  <input
                    type="time"
                    value={editingSession.end_time}
                    onChange={(e) =>
                      setEditingSession({ ...editingSession, end_time: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Instructor & Support Staff */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">
                    Giảng viên chính
                  </label>
                  <input
                    type="text"
                    list="staff-list"
                    value={editingSession.instructor_name}
                    onChange={(e) =>
                      setEditingSession({ ...editingSession, instructor_name: e.target.value })
                    }
                    placeholder="Chọn hoặc nhập tên giảng viên..."
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <datalist id="staff-list">
                    {employees.map((emp) => (
                      <option key={emp.email} value={emp.name} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">Trợ giảng</label>
                  <input
                    type="text"
                    list="staff-list"
                    value={editingSession.support_staff_name}
                    onChange={(e) =>
                      setEditingSession({ ...editingSession, support_staff_name: e.target.value })
                    }
                    placeholder="Chọn hoặc nhập tên trợ giảng..."
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Attendees & Location */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">
                    Số học viên / GV tham dự
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={editingSession.attendees}
                    onChange={(e) =>
                      setEditingSession({ ...editingSession, attendees: Number(e.target.value) })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">
                    Hình thức / Địa điểm
                  </label>
                  <input
                    type="text"
                    value={editingSession.location}
                    onChange={(e) =>
                      setEditingSession({ ...editingSession, location: e.target.value })
                    }
                    placeholder="Trực tiếp tại trường hoặc Google Meet / Zoom..."
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="mb-1 block font-semibold text-slate-700">Trạng thái</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      { key: "planned", label: "Đã lên lịch", icon: Clock },
                      { key: "completed", label: "Hoàn thành", icon: CheckCircle2 },
                      { key: "unscheduled", label: "Chưa có lịch", icon: Calendar },
                      { key: "cancelled", label: "Đã hủy", icon: XCircle },
                    ] as const
                  ).map(({ key, label, icon: Icon }) => (
                    <button
                      type="button"
                      key={key}
                      onClick={() => setEditingSession({ ...editingSession, status: key })}
                      className={`flex items-center justify-center gap-1.5 rounded-xl border p-2 text-xs font-semibold transition ${
                        editingSession.status === key
                          ? "border-indigo-600 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-500/20"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Training Topics (Checkboxes) */}
              <div>
                <label className="mb-1 block font-semibold text-slate-700">
                  Nội dung đào tạo
                </label>
                <div className="flex flex-wrap gap-2">
                  {TRAINING_TOPICS.map((topic) => {
                    const selected = editingSession.contents.includes(topic);
                    return (
                      <button
                        type="button"
                        key={topic}
                        onClick={() => {
                          const next = selected
                            ? editingSession.contents.filter((t) => t !== topic)
                            : [...editingSession.contents, topic];
                          setEditingSession({ ...editingSession, contents: next });
                        }}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                          selected
                            ? "bg-indigo-600 text-white"
                            : "border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {topic}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="mb-1 block font-semibold text-slate-700">Ghi chú</label>
                <textarea
                  rows={2}
                  value={editingSession.notes}
                  onChange={(e) => setEditingSession({ ...editingSession, notes: e.target.value })}
                  placeholder="Ghi chú về buổi học, đường dẫn Google Drive tài liệu..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setSessionModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={savingSession}
                  className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                >
                  {savingSession ? "Đang lưu..." : editingSession.id ? "Cập nhật" : "Tạo buổi học"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Thêm Lớp / Phân nhóm */}
      {classModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="text-base font-bold text-slate-900">Thêm lớp / phân nhóm đào tạo</h3>
              <button
                onClick={() => setClassModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveClass} className="space-y-4 p-6 text-xs">
              <div>
                <label className="mb-1 block font-semibold text-slate-700">
                  Trường học / Khách hàng <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={editingClass.partner}
                  onChange={(e) => setEditingClass({ ...editingClass, partner: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">-- Chọn trường học --</option>
                  {partners.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-slate-700">
                  Tên lớp / phân nhóm <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editingClass.name}
                  onChange={(e) => setEditingClass({ ...editingClass, name: e.target.value })}
                  placeholder="Ví dụ: Khối 6-7, Ban Giám Hiệu, Tổ Toán - Tin..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">
                    Đối tượng / Số lượng
                  </label>
                  <input
                    type="text"
                    value={editingClass.members}
                    onChange={(e) => setEditingClass({ ...editingClass, members: e.target.value })}
                    placeholder="Ví dụ: 30 giáo viên"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700">
                    Số buổi dự kiến
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={editingClass.planned_sessions}
                    onChange={(e) =>
                      setEditingClass({
                        ...editingClass,
                        planned_sessions: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-slate-700">Ghi chú</label>
                <textarea
                  rows={2}
                  value={editingClass.notes}
                  onChange={(e) => setEditingClass({ ...editingClass, notes: e.target.value })}
                  placeholder="Ghi chú về phân nhóm này..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setClassModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingClass}
                  className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                >
                  {savingClass ? "Đang lưu..." : "Tạo phân nhóm"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
