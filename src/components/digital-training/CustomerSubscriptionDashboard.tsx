import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Bot, Calendar,
  CalendarDays, CheckCircle2, Clock3,
  Download,
  ExternalLink,
  Eye, Mail, Package, Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal, TrendingUp, Users,
  X
} from "lucide-react";
import { appDialog } from "../AppDialog";
import { matchesSearch } from "../../lib/searchText";
import { type ProductPartner, type ProductSubscription } from "./ProductManagement";
import AiAccountsManagerModal from "./AiAccountsManagerModal";
import SubscriptionSheetConfigModal from "./SubscriptionSheetConfigModal";
import { todayVN } from '../../lib/vnDate';

type SubscriptionItem = ProductSubscription & {
  created_at?: string;
  updated_at?: string;
};

function effectiveExpiry(sub: ProductSubscription): string | null {
  return sub.effective_expires_at ?? sub.expires_at ?? sub.contract_expires_at ?? null;
}

function showDay(value?: string | null): string {
  return value ? new Date(value).toLocaleDateString("vi-VN") : "";
}

/** Khoảng thời gian giống ô trên Sheet: "a - b", "Từ a", "Đến b". */
function formatRange(start?: string | null, end?: string | null): string {
  if (start && end) return `${showDay(start)} - ${showDay(end)}`;
  if (start) return `Từ ${showDay(start)}`;
  if (end) return `Đến ${showDay(end)}`;
  return "";
}

function getDaysRemaining(sub: ProductSubscription): number | null {
  if (sub.days_remaining != null) return sub.days_remaining;
  const expiry = effectiveExpiry(sub);
  if (!expiry) return null;
  const target = new Date(expiry).getTime();
  const now = Date.now();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

function getProgressPercent(sub: ProductSubscription): number {
  const startValue = sub.expires_at ? sub.starts_at : sub.contract_starts_at || sub.starts_at;
  const endValue = effectiveExpiry(sub);
  if (!startValue || !endValue) return 50;
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  const total = end - start;
  if (total <= 0) return 100;
  const elapsed = Date.now() - start;
  return Math.min(Math.max(Math.round((elapsed / total) * 100), 5), 100);
}

type FilterStatus = "all" | "active" | "expiring" | "expired" | "paused";

const SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1ENU0abZu6hCiVz-u7ypMLmLzudzMewKF_6s-6NJ26qk/edit?usp=sharing";

export default function CustomerSubscriptionDashboard({
  partners,
  idToken,
  isGuest,
  onOpenPartnerDetail,
  onScheduleMeeting,
  onCreatePartner,
}: {
  partners: ProductPartner[];
  idToken: string;
  isGuest: boolean;
  onOpenPartnerDetail?: (partnerId: number) => void;
  onScheduleMeeting?: (partnerId: number, productId: number) => void;
  onCreatePartner?: () => void;
}) {
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [detailSub, setDetailSub] = useState<SubscriptionItem | null>(null);
  const [bulkRenewing, setBulkRenewing] = useState(false);
  const [sheetConfigModalOpen, setSheetConfigModalOpen] = useState(false);

  const partnerMap = useMemo(() => new Map(partners.map((p) => [p.id, p])), [partners]);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [provinceFilter, setProvinceFilter] = useState<string>("all");

  // Renew Modal state
  const [renewTarget, setRenewTarget] = useState<SubscriptionItem | null>(null);
  const [renewMonths, setRenewMonths] = useState<number>(12);
  const [renewCustomDate, setRenewCustomDate] = useState<string>("");
  const [renewNotes, setRenewNotes] = useState<string>("");
  const [renewing, setRenewing] = useState<boolean>(false);

  // Edit / Add modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<{
    id?: number;
    partner: string;
    product: string;
    quantity: number;
    starts_at: string;
    expires_at: string;
    contract_starts_at: string;
    contract_expires_at: string;
    status: string;
    notes: string;
  }>({
    partner: "",
    product: "",
    quantity: 1,
    starts_at: "",
    expires_at: "",
    contract_starts_at: "",
    contract_expires_at: "",
    status: "active",
    notes: "",
  });
  const [savingSub, setSavingSub] = useState(false);

  // Selected table rows
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // AI Accounts modal state
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiModalPartnerId, setAiModalPartnerId] = useState<number | null>(null);
  const [aiTotalCount, setAiTotalCount] = useState<number>(0);

  const authHeader = useMemo(() => (idToken ? { Authorization: `Bearer ${idToken}` } : {}), [idToken]);

  const loadAiTotal = async () => {
    try {
      const res = await fetch("/api/digital-training/ai-accounts", { headers: authHeader });
      if (res.ok) {
        const data = await res.json();
        setAiTotalCount(data?.length || 0);
      }
    } catch {
      // ignore
    }
  };

  const loadData = async () => {
    setLoading(true);
    setNotice("");
    try {
      const [subRes, prodRes] = await Promise.all([
        fetch("/api/digital-training/product-subscriptions", { headers: authHeader }),
        fetch("/api/digital-training/products", { headers: authHeader }),
      ]);
      if (subRes.ok) {
        const subData = await subRes.json();
        setSubscriptions(subData || []);
      }
      if (prodRes.ok) {
        const prodData = await prodRes.json();
        setProducts(prodData || []);
      }
      void loadAiTotal();
    } catch (err: any) {
      setNotice(err.message || "Lỗi nạp danh sách dịch vụ khách hàng.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    void loadAiTotal();
  }, [idToken]);

  // Sync Google Sheet
  const handleSyncSheet = async () => {
    setSyncing(true);
    setNotice("");
    try {
      const res = await fetch("/api/digital-training/subscriptions/sheet-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setLastSynced(new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
        await loadData();
      } else {
        const errMsg = data.error || "Không thể đồng bộ Google Sheet.";
        setNotice(errMsg);
        if (data.error_code === "NO_CREDENTIALS" || data.error_code === "SHEET_ACCESS_DENIED") {
          const openConfig = await appDialog.confirm(
            `${errMsg}\n\nBạn có muốn mở bảng 'Cài đặt Google Sheet' để kết nối tài khoản dịch vụ hoặc lấy mã Apps Script đồng bộ tức thì không?`,
            {
              title: "Cần thiết lập kết nối Sheet",
              tone: "info",
              confirmText: "Mở Cài đặt Sheet",
              cancelText: "Đóng",
            }
          );
          if (openConfig) {
            setSheetConfigModalOpen(true);
          }
        }
      }
    } catch (err: any) {
      setNotice(err.message || "Lỗi kết nối khi đồng bộ Sheet.");
    } finally {
      setSyncing(false);
    }
  };

  // Renew action
  const handleRenewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renewTarget) return;
    setRenewing(true);
    try {
      const payload: any = { notes: renewNotes.trim() };
      if (renewCustomDate) {
        payload.new_expiry_date = renewCustomDate;
      } else {
        payload.months = renewMonths;
      }
      const res = await fetch(`/api/digital-training/product-subscriptions/${renewTarget.id}/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Gia hạn dịch vụ thất bại.");
      }
      setRenewTarget(null);
      setRenewNotes("");
      setRenewCustomDate("");
      await loadData();
    } catch (err: any) {
      await appDialog.alert(err.message || "Lỗi khi gia hạn dịch vụ.", { title: "Lỗi gia hạn", tone: "danger" });
    } finally {
      setRenewing(false);
    }
  };

  // Export to CSV with UTF-8 BOM
  const exportToCSV = (onlySelected = false) => {
    const listToExport = onlySelected
      ? subscriptions.filter((s) => selectedIds.includes(s.id))
      : filteredSubscriptions;

    if (listToExport.length === 0) {
      void appDialog.alert("Không có dữ liệu để xuất file.", { title: "Thông báo" });
      return;
    }

    const headers = [
      "STT",
      "Mã khách hàng",
      "Tên trường / Khách hàng",
      "Tỉnh / Thành phố",
      "Người liên hệ",
      "Số điện thoại",
      "Sản phẩm / Dịch vụ",
      "Số lượng",
      "Thời gian theo HĐ",
      "Thời gian thực tế",
      "Còn lại (ngày)",
      "Trạng thái",
      "Ghi chú",
    ];

    const rows = listToExport.map((sub, idx) => {
      const partner = partnerMap.get(sub.partner);
      const days = getDaysRemaining(sub);
      const statusText =
        sub.effective_status === "expired"
          ? "Đã quá hạn"
          : sub.effective_status === "expiring"
          ? "Sắp hết hạn"
          : "Đang sử dụng";

      return [
        idx + 1,
        sub.partner,
        `"${(sub.partner_name || "").replace(/"/g, '""')}"`,
        `"${(sub.partner_province || "").replace(/"/g, '""')}"`,
        `"${(partner?.contact_person || "").replace(/"/g, '""')}"`,
        `"${(partner?.phone || "").replace(/"/g, '""')}"`,
        `"${(sub.product_name || "").replace(/"/g, '""')}"`,
        sub.quantity || 1,
        `"${formatRange(sub.contract_starts_at, sub.contract_expires_at)}"`,
        `"${formatRange(sub.starts_at, sub.expires_at)}"`,
        days != null ? days : "Không giới hạn",
        `"${statusText}"`,
        `"${(sub.notes || "").replace(/"/g, '""')}"`,
      ].join(",");
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Danh_sach_dich_vu_khach_hang_FermatTech_${todayVN()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Bulk Renew +1 year
  const handleBulkRenewOneYear = async () => {
    if (selectedIds.length === 0) return;
    const confirmed = await appDialog.confirm(
      `Bạn có chắc chắn muốn gia hạn thêm 1 năm (+12 tháng) cho ${selectedIds.length} gói dịch vụ đã chọn không?`,
      {
        title: "Xác nhận gia hạn hàng loạt",
        confirmText: "Gia hạn tất cả",
        cancelText: "Hủy",
      }
    );
    if (!confirmed) return;

    setBulkRenewing(true);
    try {
      let successCount = 0;
      for (const id of selectedIds) {
        try {
          const res = await fetch(`/api/digital-training/product-subscriptions/${id}/renew`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeader },
            body: JSON.stringify({ months: 12, notes: "Gia hạn hàng loạt +12 tháng" }),
          });
          if (res.ok) successCount++;
        } catch {
          // ignore single failure to continue
        }
      }
      setSelectedIds([]);
      await loadData();
      await appDialog.alert(`Đã gia hạn thành công ${successCount}/${selectedIds.length} gói dịch vụ.`, {
        title: "Gia hạn hoàn tất",
      });
    } finally {
      setBulkRenewing(false);
    }
  };

  // Save add/edit subscription
  const handleSaveSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSub.partner || !editingSub.product) {
      await appDialog.alert("Vui lòng chọn khách hàng và sản phẩm/dịch vụ.", { title: "Thiếu thông tin" });
      return;
    }
    setSavingSub(true);
    try {
      const url = editingSub.id
        ? `/api/digital-training/product-subscriptions/${editingSub.id}`
        : `/api/digital-training/product-subscriptions`;
      const method = editingSub.id ? "PATCH" : "POST";
      const payload = {
        partner: Number(editingSub.partner),
        product: Number(editingSub.product),
        quantity: Number(editingSub.quantity || 1),
        starts_at: editingSub.starts_at || null,
        expires_at: editingSub.expires_at || null,
        contract_starts_at: editingSub.contract_starts_at || null,
        contract_expires_at: editingSub.contract_expires_at || null,
        status: editingSub.status,
        notes: editingSub.notes.trim(),
      };
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Không thể lưu thông tin gói dịch vụ.");
      }
      setEditModalOpen(false);
      await loadData();
    } catch (err: any) {
      await appDialog.alert(err.message || "Lỗi lưu dữ liệu.", { title: "Lỗi", tone: "danger" });
    } finally {
      setSavingSub(false);
    }
  };

  // KPIs
  const kpis = useMemo(() => {
    const total = subscriptions.length;
    let active = 0;
    let expiring = 0;
    let expired = 0;
    let paused = 0;

    subscriptions.forEach((s) => {
      if (s.effective_status === "expiring") expiring++;
      else if (s.effective_status === "expired") expired++;
      else if (s.effective_status === "paused") paused++;
      else active++;
    });

    const safePercentage = total > 0 ? Math.round((active / total) * 100) : 100;
    return { total, active, expiring, expired, paused, safePercentage };
  }, [subscriptions]);

  // Product distribution stats
  const productDistribution = useMemo(() => {
    const counts: Record<string, { name: string; count: number; totalQuantity: number }> = {};
    subscriptions.forEach((s) => {
      const name = s.product_name || "Dịch vụ khác";
      if (!counts[name]) counts[name] = { name, count: 0, totalQuantity: 0 };
      counts[name].count += 1;
      counts[name].totalQuantity += (s.quantity || 1);
    });
    return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 4);
  }, [subscriptions]);

  // List of urgent follow-ups
  const urgentFollowUps = useMemo(() => {
    return subscriptions
      .filter((s) => s.effective_status === "expiring" || s.effective_status === "expired")
      .slice(0, 3);
  }, [subscriptions]);

  // Unique lists for filter dropdowns
  const availableProvinces = useMemo(() => {
    const set = new Set<string>();
    subscriptions.forEach((s) => {
      if (s.partner_province?.trim()) set.add(s.partner_province.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "vi"));
  }, [subscriptions]);

  // Filtered subscriptions
  const filteredSubscriptions = useMemo(() => {
    return subscriptions.filter((s) => {
      if (statusFilter !== "all" && s.effective_status !== statusFilter) return false;
      if (productFilter !== "all" && String(s.product) !== productFilter) return false;
      if (provinceFilter !== "all" && s.partner_province !== provinceFilter) return false;
      if (searchQuery.trim()) {
        const text = `${s.partner_name} ${s.product_name} ${s.partner_province || ""} ${s.notes || ""}`;
        if (!matchesSearch(text, searchQuery)) return false;
      }
      return true;
    });
  }, [subscriptions, statusFilter, productFilter, provinceFilter, searchQuery]);

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredSubscriptions.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredSubscriptions.map((s) => s.id));
    }
  };

  const toggleSelectOne = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="min-h-screen bg-slate-50/60 p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto font-sans">
      {/* 1. Page Header (matching shadcnuikit.com/dashboard/crm) */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Quản lý Thời hạn sử dụng BNDC & Dịch vụ số
          </h1>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm">
            Theo dõi chi tiết thời điểm đăng ký, thời gian hết hạn, số ngày còn lại và chu kỳ gia hạn bản quyền của từng đơn vị.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Date Range Button */}
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
            <span>Tháng 10/2026 (Hiện tại)</span>
          </button>

          {/* Open Sheet */}
          <a
            href={SPREADSHEET_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
            title="Mở Google Sheet theo dõi khách hàng"
          >
            <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
            <span>Mở Sheet</span>
          </a>

          {/* Sync Sheet */}
          <button
            type="button"
            onClick={handleSyncSheet}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
            title="Đồng bộ thủ công 2 chiều giữa Web và Google Sheet"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-blue-600 ${syncing ? "animate-spin" : ""}`} />
            <span>{syncing ? "Đang đồng bộ..." : "Đồng bộ Sheet"}</span>
            {lastSynced && <span className="text-[10px] text-slate-400 font-normal">({lastSynced})</span>}
          </button>

          {/* Cài đặt Sheet & Apps Script */}
          <button
            type="button"
            onClick={() => setSheetConfigModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-blue-600 transition-colors cursor-pointer"
            title="Cài đặt kết nối Google Sheet & Lấy mã Apps Script"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
            <span>Cài đặt Sheet</span>
          </button>

          {/* Quản lý TK AI Dùng chung */}
          <button
            type="button"
            onClick={() => {
              setAiModalPartnerId(null);
              setAiModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200/90 bg-purple-50 px-3 py-2 text-xs font-semibold text-purple-700 shadow-2xs hover:bg-purple-100 hover:border-purple-300 transition-colors cursor-pointer"
            title="Quản lý danh sách tài khoản & mật khẩu AI Dùng chung"
          >
            <Bot className="h-3.5 w-3.5 text-purple-600" />
            <span>Quản lý TK AI</span>
            {aiTotalCount > 0 && (
              <span className="rounded-full bg-purple-200/80 px-1.5 py-0.2 text-[10px] font-bold text-purple-800">
                {aiTotalCount}
              </span>
            )}
          </button>

          {/* Export CSV */}
          <button
            type="button"
            onClick={() => exportToCSV(false)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-blue-600 transition-colors cursor-pointer"
            title="Xuất danh sách dịch vụ ra file CSV"
          >
            <Download className="h-3.5 w-3.5 text-slate-400" />
            <span>Xuất CSV</span>
          </button>

          {/* New Subscription */}
          {!isGuest && (
            <button
              type="button"
              onClick={() => {
                setEditingSub({
                  partner: partners[0]?.id ? String(partners[0].id) : "",
                  product: products[0]?.id ? String(products[0].id) : "",
                  quantity: 1,
                  starts_at: new Date().toISOString().split("T")[0],
                  expires_at: "",
                  contract_starts_at: "",
                  contract_expires_at: "",
                  status: "active",
                  notes: "",
                });
                setEditModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Đăng ký dịch vụ mới</span>
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="text-rose-500 hover:text-rose-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 2. Bento Row 1: 4 Metric Cards (Matching shadcnuikit.com/dashboard/crm) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Target Ring Metric */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs flex items-center gap-4">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
            <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
              <path
                className="text-slate-100"
                strokeWidth="3.5"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="text-blue-600 transition-all duration-700"
                strokeDasharray={`${kpis.safePercentage}, 100`}
                strokeWidth="3.5"
                strokeLinecap="round"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <span className="absolute text-xs font-bold text-slate-900">{kpis.safePercentage}%</span>
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 truncate">Tỷ lệ duy trì an toàn</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {kpis.active}/{kpis.total || 1} gói còn hạn sử dụng trên 30 ngày
            </p>
          </div>
        </div>

        {/* Card 2: Total Customers */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Khách hàng & Đối tác</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold tracking-tight text-slate-900">
              {partners.length || subscriptions.length}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
              <TrendingUp className="h-3 w-3" />
              <span>+10.4% so với kỳ trước</span>
            </div>
          </div>
        </div>

        {/* Card 3: Active Subscriptions */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Dịch vụ đang kích hoạt</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Package className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold tracking-tight text-slate-900">
              {kpis.active}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
              <CheckCircle2 className="h-3 w-3" />
              <span>Hoạt động ổn định</span>
            </div>
          </div>
        </div>

        {/* Card 4: Action Required */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Cần xử lý tái ký</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold tracking-tight text-slate-900">
              {kpis.expiring + kpis.expired}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-amber-700 font-medium">
              <Clock3 className="h-3 w-3" />
              <span>{kpis.expiring} sắp hết hạn • {kpis.expired} quá hạn</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Bento Row 2: Insights & Action Items */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left: Product Distribution (2 cols) */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Cơ cấu phân bổ dịch vụ theo Sản phẩm</h3>
              <p className="text-xs text-slate-500">Tỷ trọng các dịch vụ giáo dục và phần mềm đang vận hành</p>
            </div>
            <span className="text-xs font-medium text-slate-400">{kpis.total} tổng gói</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            {productDistribution.map((item, idx) => {
              const pct = kpis.total > 0 ? Math.round((item.count / kpis.total) * 100) : 0;
              const barColors = ["bg-blue-600", "bg-emerald-500", "bg-purple-500", "bg-amber-500"];
              return (
                <div key={item.name} className="space-y-1.5 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 truncate">{item.name}</span>
                    <span className="font-bold text-slate-900">{item.count} gói ({pct}%)</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full ${barColors[idx % barColors.length]} transition-all duration-500`}
                      style={{ width: `${Math.max(pct, 5)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Quy mô: {item.totalQuantity} tài khoản/license</span>
                    <span className="text-emerald-600 font-medium">Đang triển khai</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Urgent Follow-ups / Tasks (1 col) */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xs space-y-3.5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Khách hàng cần liên hệ ngay</h3>
              <p className="text-xs text-slate-500">Ưu tiên gia hạn trong 30 ngày</p>
            </div>
            <span className="rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-[10px] font-bold border border-amber-200/60">
              {urgentFollowUps.length} việc
            </span>
          </div>

          <div className="space-y-2.5">
            {urgentFollowUps.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                Tuyệt vời! Hiện không có gói dịch vụ nào sắp hết hạn hoặc quá hạn.
              </div>
            ) : (
              urgentFollowUps.map((sub) => {
                const days = getDaysRemaining(sub);
                return (
                  <div
                    key={sub.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200/70 bg-white p-3 hover:border-blue-300 transition-colors shadow-2xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-900 truncate">{sub.partner_name}</p>
                      <p className="text-[11px] text-slate-500 truncate">{sub.product_name}</p>
                      <p className="mt-1 text-[10px] font-semibold text-amber-700">
                        {days == null
                          ? "Không giới hạn"
                          : days < 0
                          ? `Đã quá hạn ${Math.abs(days)} ngày`
                          : `Còn lại ${days} ngày`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setRenewTarget(sub);
                        setRenewMonths(12);
                        setRenewCustomDate("");
                      }}
                      className="ml-2 shrink-0 rounded-md bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 border border-blue-200/60 transition-colors cursor-pointer"
                    >
                      Gia hạn
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 4. Bento Row 3: Subscriptions Data Table (Matching shadcnuikit.com/dashboard/crm) */}
      <div className="rounded-xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden">
        {/* Table Toolbar */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter Tabs (Segmented Control) */}
            <div className="inline-flex rounded-lg bg-slate-100/90 p-1 text-slate-500 border border-slate-200/60 shadow-2xs">
              {[
                { id: "all", label: "Tất cả", count: kpis.total },
                { id: "active", label: "Đang dùng", count: kpis.active },
                { id: "expiring", label: "Sắp hết hạn", count: kpis.expiring },
                { id: "expired", label: "Đã quá hạn", count: kpis.expired },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id as FilterStatus)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                    statusFilter === tab.id
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`ml-1 rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                      statusFilter === tab.id
                        ? "bg-blue-100 text-blue-700"
                        : "bg-slate-200/70 text-slate-600"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Faceted Dropdowns */}
            <div className="flex items-center gap-2">
              <select
                value={productFilter}
                onChange={(e) => setProductFilter(e.target.value)}
                className="h-8 rounded-lg border border-slate-200/90 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-2xs outline-none focus:border-blue-500"
              >
                <option value="all">Tất cả sản phẩm</option>
                {products.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>

              <select
                value={provinceFilter}
                onChange={(e) => setProvinceFilter(e.target.value)}
                className="h-8 rounded-lg border border-slate-200/90 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-2xs outline-none focus:border-blue-500"
              >
                <option value="all">Tất cả tỉnh / thành</option>
                {availableProvinces.map((prov) => (
                  <option key={prov} value={prov}>
                    {prov}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick Search */}
          <div className="relative min-w-[240px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo tên trường, dịch vụ..."
              className="h-9 w-full rounded-lg border border-slate-200/90 bg-slate-50/50 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:bg-white focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="border-b border-slate-200/80 bg-slate-50/60 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-3 pl-4 pr-2 w-8">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === filteredSubscriptions.length && filteredSubscriptions.length > 0}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="py-3 px-3">Khách hàng / Trường học</th>
                <th className="py-3 px-3">Gói dịch vụ / BNDC</th>
                <th className="py-3 px-3">Thời gian theo HĐ</th>
                <th className="py-3 px-3">Thời gian thực tế</th>
                <th className="py-3 px-3">Thời hạn còn lại</th>
                <th className="py-3 px-3">Trạng thái</th>
                <th className="py-3 px-3">Đầu mối & Ghi chú</th>
                <th className="py-3 pr-4 pl-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-xs text-slate-400">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-blue-600" />
                    Đang nạp dữ liệu dịch vụ khách hàng...
                  </td>
                </tr>
              ) : filteredSubscriptions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-xs text-slate-400">
                    <Package className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                    Không tìm thấy gói dịch vụ nào phù hợp với bộ lọc.
                  </td>
                </tr>
              ) : (
                filteredSubscriptions.map((sub) => {
                  const isSelected = selectedIds.includes(sub.id);
                  const isExpiring = sub.effective_status === "expiring";
                  const isExpired = sub.effective_status === "expired";
                  const safePercent = getProgressPercent(sub);
                  const days = getDaysRemaining(sub);
                  const partnerInfo = partnerMap.get(sub.partner);

                  return (
                    <tr
                      key={sub.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isSelected ? "bg-blue-50/40" : ""
                      }`}
                    >
                      <td className="py-3.5 pl-4 pr-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectOne(sub.id)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>

                      {/* School & Province */}
                      <td className="py-3.5 px-3">
                        <div
                          className="flex items-center gap-2.5 cursor-pointer group"
                          onClick={() => setDetailSub(sub)}
                          title="Bấm để xem chi tiết trường học & hợp đồng"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 font-bold text-xs border border-blue-200/60 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                            {sub.partner_name?.charAt(0) || "T"}
                          </div>
                          <div className="min-w-0 max-w-[200px]">
                            <p className="font-semibold text-slate-900 truncate group-hover:text-blue-600 transition-colors">{sub.partner_name}</p>
                            {sub.partner_province && (
                              <span className="inline-block rounded-md bg-slate-100 px-1.5 py-0.2 text-[10px] font-medium text-slate-600 border border-slate-200/50 mt-0.5">
                                {sub.partner_province}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Product & Quantity */}
                      <td className="py-3.5 px-3">
                        <div className="min-w-0 max-w-[170px]">
                          <p className="font-semibold text-slate-900 truncate">{sub.product_name}</p>
                          <p className="text-[11px] text-slate-500 font-normal">
                            Số lượng: <span className="font-bold text-slate-700">{sub.quantity}</span> tài khoản/license
                          </p>
                          {(sub.product_code === "ai-dung-chung" || (partnerInfo?.ai_account_count && partnerInfo.ai_account_count > 0)) && (
                            <button
                              type="button"
                              onClick={() => {
                                setAiModalPartnerId(sub.partner);
                                setAiModalOpen(true);
                              }}
                              className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-purple-50 hover:bg-purple-100 text-purple-700 px-2 py-0.5 text-[10px] font-bold border border-purple-200/80 transition-colors cursor-pointer shadow-2xs"
                              title="Xem và quản lý danh sách tài khoản & mật khẩu AI của trường này"
                            >
                              <Bot className="h-3 w-3 text-purple-600" />
                              <span>{partnerInfo?.ai_account_count ? `${partnerInfo.ai_account_count} TK AI` : "Quản lý TK AI"}</span>
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Thời gian theo HĐ / thực tế; cột đang dùng để tính hạn được tô màu */}
                      {[
                        { start: sub.contract_starts_at, end: sub.contract_expires_at, drivesExpiry: !sub.expires_at && !!sub.contract_expires_at, Icon: Calendar },
                        { start: sub.starts_at, end: sub.expires_at, drivesExpiry: !!sub.expires_at, Icon: Clock3 },
                      ].map(({ start, end, drivesExpiry, Icon }, colIdx) => {
                        const tone = drivesExpiry && isExpired ? "rose" : drivesExpiry && isExpiring ? "amber" : "";
                        return (
                          <td key={colIdx} className="py-3.5 px-3 whitespace-nowrap">
                            <div className={`flex items-center gap-1.5 text-xs ${drivesExpiry ? "font-semibold" : "font-medium"}`}>
                              <Icon className={`h-3.5 w-3.5 shrink-0 ${tone === "rose" ? "text-rose-500" : tone === "amber" ? "text-amber-500" : "text-slate-400"}`} />
                              <span className={tone === "rose" ? "text-rose-600 font-bold" : tone === "amber" ? "text-amber-600 font-bold" : "text-slate-700"}>
                                {formatRange(start, end) || "—"}
                              </span>
                            </div>
                          </td>
                        );
                      })}

                      {/* Thời hạn còn lại & Tiến độ */}
                      <td className="py-3.5 px-3 min-w-[140px]">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span
                              className={`font-bold ${
                                isExpired
                                  ? "text-rose-600"
                                  : isExpiring
                                  ? "text-amber-600"
                                  : "text-emerald-600"
                              }`}
                            >
                              {days == null
                                ? "Không giới hạn"
                                : days < 0
                                ? `Quá hạn ${Math.abs(days)} ngày`
                                : `Còn ${days} ngày`}
                            </span>
                            <span className="text-[10px] text-slate-400">{safePercent}%</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                isExpired
                                  ? "bg-rose-500"
                                  : isExpiring
                                  ? "bg-amber-500"
                                  : "bg-blue-600"
                              }`}
                              style={{ width: `${safePercent}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Trạng thái */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {isExpired ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 border border-rose-200/60">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                            Quá hạn
                          </span>
                        ) : isExpiring ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 border border-amber-200/60">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                            Sắp hết hạn
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200/60">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Còn hạn
                          </span>
                        )}
                      </td>

                      {/* Contact Info & Notes */}
                      <td className="py-3.5 px-3 max-w-[170px]">
                        <div className="text-[11px]">
                          <p className="font-medium text-slate-800">{partnerInfo?.contact_person || "—"}</p>
                          {partnerInfo?.phone && (
                            <a
                              href={`tel:${partnerInfo.phone}`}
                              className="text-slate-500 hover:text-blue-600 flex items-center gap-1 mt-0.5"
                            >
                              <Phone className="h-2.5 w-2.5" />
                              <span>{partnerInfo.phone}</span>
                            </a>
                          )}
                          {sub.notes && (
                            <p className="mt-0.5 text-[10px] text-slate-400 truncate" title={sub.notes}>
                              {sub.notes}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 pr-4 pl-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {(sub.product_code === "ai-dung-chung" || (partnerInfo?.ai_account_count && partnerInfo.ai_account_count > 0)) && (
                            <button
                              type="button"
                              onClick={() => {
                                setAiModalPartnerId(sub.partner);
                                setAiModalOpen(true);
                              }}
                              className="rounded-md border border-purple-200 bg-purple-50 px-2 py-1 text-[11px] font-semibold text-purple-700 shadow-2xs hover:bg-purple-100 hover:border-purple-300 transition-colors cursor-pointer"
                              title="Xem danh sách tài khoản & mật khẩu AI của trường này"
                            >
                              <Bot className="h-3 w-3 inline mr-1 text-purple-600" />
                              TK AI
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setRenewTarget(sub);
                              setRenewMonths(12);
                              setRenewCustomDate("");
                            }}
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-blue-600 transition-colors cursor-pointer"
                          >
                            Gia hạn
                          </button>

                          <button
                            type="button"
                            onClick={() => setDetailSub(sub)}
                            className="rounded-md border border-slate-200 bg-white p-1 text-slate-400 hover:text-blue-600 hover:border-blue-200 transition-colors cursor-pointer"
                            title="Xem chi tiết đối tác & hợp đồng"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setEditingSub({
                                id: sub.id,
                                partner: String(sub.partner),
                                product: String(sub.product),
                                quantity: sub.quantity,
                                starts_at: sub.starts_at || "",
                                expires_at: sub.expires_at || "",
                                contract_starts_at: sub.contract_starts_at || "",
                                contract_expires_at: sub.contract_expires_at || "",
                                status: sub.status,
                                notes: sub.notes || "",
                              });
                              setEditModalOpen(true);
                            }}
                            className="p-1 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
                            title="Sửa thông tin"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>
            Hiển thị <strong className="text-slate-800">{filteredSubscriptions.length}</strong> / {subscriptions.length} gói dịch vụ
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled
              className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-400 text-xs font-medium cursor-not-allowed"
            >
              Trang trước
            </button>
            <button
              type="button"
              disabled
              className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-400 text-xs font-medium cursor-not-allowed"
            >
              Trang sau
            </button>
          </div>
        </div>
      </div>

      {/* 5. Quick Renew Modal (Shadcn Dialog) */}
      {renewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-5 animate-scale-in">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Gia hạn dịch vụ
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  {renewTarget.partner_name} • {renewTarget.product_name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRenewTarget(null)}
                className="text-slate-400 hover:text-slate-600 rounded-md p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleRenewSubmit} className="space-y-4">
              {/* Presets */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-700">Chọn gói thời gian gia hạn</label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: "+3 Tháng", months: 3 },
                    { label: "+6 Tháng", months: 6 },
                    { label: "+1 Năm", months: 12 },
                    { label: "+2 Năm", months: 24 },
                  ].map((p) => (
                    <button
                      key={p.months}
                      type="button"
                      onClick={() => {
                        setRenewMonths(p.months);
                        setRenewCustomDate("");
                      }}
                      className={`h-9 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                        renewMonths === p.months && !renewCustomDate
                          ? "border-blue-600 bg-blue-50 text-blue-700 shadow-2xs"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Or Custom Date */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Hoặc chọn ngày hết hạn cụ thể</label>
                <input
                  type="date"
                  value={renewCustomDate}
                  onChange={(e) => setRenewCustomDate(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Ghi chú gia hạn</label>
                <textarea
                  rows={2}
                  value={renewNotes}
                  onChange={(e) => setRenewNotes(e.target.value)}
                  placeholder="VD: Gia hạn theo Hợp đồng số 24/2026/FMT-THPT..."
                  className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setRenewTarget(null)}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={renewing}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-blue-700 disabled:opacity-50"
                >
                  {renewing ? "Đang xử lý..." : "Xác nhận gia hạn"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. Add/Edit Subscription Modal */}
      {editModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-5 animate-scale-in">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {editingSub.id ? "Chỉnh sửa gói dịch vụ" : "Đăng ký dịch vụ mới cho khách hàng"}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Thông tin sẽ được lưu trên hệ thống và tự động đồng bộ sang Google Sheet.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 rounded-md p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSubscription} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Khách hàng / Trường học *</label>
                <select
                  value={editingSub.partner}
                  onChange={(e) => setEditingSub({ ...editingSub, partner: e.target.value })}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-blue-500"
                  required
                >
                  <option value="">-- Chọn đối tác / trường học --</option>
                  {partners.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name} {p.province ? `(${p.province})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Sản phẩm / Dịch vụ *</label>
                  <select
                    value={editingSub.product}
                    onChange={(e) => setEditingSub({ ...editingSub, product: e.target.value })}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-blue-500"
                    required
                  >
                    <option value="">-- Chọn sản phẩm --</option>
                    {products.map((prod) => (
                      <option key={prod.id} value={String(prod.id)}>
                        {prod.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Số lượng tài khoản/license</label>
                  <input
                    type="number"
                    min="1"
                    value={editingSub.quantity}
                    onChange={(e) => setEditingSub({ ...editingSub, quantity: Number(e.target.value) || 1 })}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <p className="text-xs font-bold text-slate-800">Thời gian theo hợp đồng</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Bắt đầu (HĐ)</label>
                  <input
                    type="date"
                    value={editingSub.contract_starts_at}
                    onChange={(e) => setEditingSub({ ...editingSub, contract_starts_at: e.target.value })}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Hết hạn (HĐ)</label>
                  <input
                    type="date"
                    value={editingSub.contract_expires_at}
                    onChange={(e) => setEditingSub({ ...editingSub, contract_expires_at: e.target.value })}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <p className="text-xs font-bold text-slate-800">Thời gian thực tế</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Bắt đầu (thực tế)</label>
                  <input
                    type="date"
                    value={editingSub.starts_at}
                    onChange={(e) => setEditingSub({ ...editingSub, starts_at: e.target.value })}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Hết hạn (thực tế)</label>
                  <input
                    type="date"
                    value={editingSub.expires_at}
                    onChange={(e) => setEditingSub({ ...editingSub, expires_at: e.target.value })}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-500">Còn lại và cảnh báo hết hạn tính theo ngày hết hạn thực tế; chưa có thì theo hợp đồng.</p>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Trạng thái</label>
                <select
                  value={editingSub.status}
                  onChange={(e) => setEditingSub({ ...editingSub, status: e.target.value })}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-blue-500"
                >
                  <option value="active">Đang hoạt động (active)</option>
                  <option value="paused">Tạm dừng (paused)</option>
                  <option value="cancelled">Đã hủy (cancelled)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Ghi chú & Theo dõi</label>
                <textarea
                  rows={2}
                  value={editingSub.notes}
                  onChange={(e) => setEditingSub({ ...editingSub, notes: e.target.value })}
                  placeholder="Ghi chú thêm về hợp đồng, điều khoản..."
                  className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingSub}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingSub ? "Đang lưu..." : "Lưu gói dịch vụ"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Floating Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-5 py-3 text-white shadow-2xl animate-in slide-in-from-bottom-4 duration-200 font-sans">
          <div className="flex items-center gap-2 pr-3 border-r border-slate-700 text-xs font-semibold">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] text-white">
              {selectedIds.length}
            </span>
            <span>Đã chọn {selectedIds.length} gói dịch vụ</span>
          </div>

          <button
            type="button"
            disabled={bulkRenewing}
            onClick={handleBulkRenewOneYear}
            className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${bulkRenewing ? "animate-spin" : ""}`} />
            <span>Gia hạn +1 năm</span>
          </button>

          <button
            type="button"
            onClick={() => exportToCSV(true)}
            className="flex items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Xuất đã chọn</span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedIds([])}
            className="text-xs text-slate-400 hover:text-white transition-colors cursor-pointer pl-1"
          >
            Bỏ chọn
          </button>
        </div>
      )}

      {/* 7. School / Customer Detail Modal */}
      {detailSub && (() => {
        const partner = partnerMap.get(detailSub.partner);
        const days = getDaysRemaining(detailSub);
        const isExpiring = detailSub.effective_status === "expiring";
        const isExpired = detailSub.effective_status === "expired";

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4 font-sans">
            <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-5 animate-scale-in">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 font-bold text-base border border-blue-200/60">
                    {detailSub.partner_name?.charAt(0) || "T"}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">{detailSub.partner_name}</h3>
                    <p className="text-xs text-slate-500">{detailSub.partner_province || "Chưa cập nhật địa bàn"}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailSub(null)}
                  className="text-slate-400 hover:text-slate-600 rounded-md p-1 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Status and Days Badge */}
              <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50 p-3.5">
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Gói dịch vụ</span>
                  <p className="text-sm font-bold text-slate-900 mt-0.5">{detailSub.product_name}</p>
                  <p className="text-xs text-slate-600 font-medium">Quy mô: {detailSub.quantity} tài khoản/license</p>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold border ${
                      isExpired
                        ? "bg-rose-50 text-rose-700 border-rose-200"
                        : isExpiring
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-emerald-50 text-emerald-700 border-emerald-200"
                    }`}
                  >
                    {isExpired ? "Đã quá hạn" : isExpiring ? "Sắp hết hạn" : "Đang dùng"}
                  </span>
                  <p className="text-xs font-semibold text-slate-700 mt-1">
                    {days == null ? "Không giới hạn" : days < 0 ? `Quá hạn ${Math.abs(days)} ngày` : `Còn lại ${days} ngày`}
                  </p>
                </div>
              </div>

              {/* Contact Information */}
              <div className="space-y-2 rounded-xl border border-slate-200/80 p-3.5">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Đầu mối nhà trường</span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Người liên hệ:</span>
                    <span className="font-semibold text-slate-800">{partner?.contact_person || "Chưa có thông tin"}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Chức vụ:</span>
                    <span className="font-medium text-slate-700">{partner?.contact_position || "Ban Giám hiệu"}</span>
                  </div>
                  {partner?.phone && (
                    <div>
                      <span className="text-slate-400 block text-[11px]">Điện thoại:</span>
                      <a href={`tel:${partner.phone}`} className="font-bold text-blue-600 hover:underline flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {partner.phone}
                      </a>
                    </div>
                  )}
                  {partner?.email && (
                    <div>
                      <span className="text-slate-400 block text-[11px]">Email:</span>
                      <a href={`mailto:${partner.email}`} className="font-medium text-blue-600 hover:underline flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {partner.email}
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Duration and Notes */}
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Thời gian theo HĐ:</span>
                  <span className="font-medium text-slate-800">
                    {formatRange(detailSub.contract_starts_at, detailSub.contract_expires_at) || "—"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Thời gian thực tế:</span>
                  <span className="font-medium text-slate-800">
                    {formatRange(detailSub.starts_at, detailSub.expires_at) || "—"}
                  </span>
                </div>
                <div className="pt-1">
                  <span className="text-slate-500 block mb-1">Ghi chú & Lịch sử trao đổi:</span>
                  <div className="rounded-lg bg-slate-50 p-2.5 text-slate-700 text-xs whitespace-pre-wrap border border-slate-100">
                    {detailSub.notes || "Chưa có ghi chú đặc biệt."}
                  </div>
                </div>
              </div>

              {/* Actions Footer */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    const pid = detailSub.partner;
                    setDetailSub(null);
                    setAiModalPartnerId(pid);
                    setAiModalOpen(true);
                  }}
                  className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-semibold text-purple-700 hover:bg-purple-100 transition-colors cursor-pointer"
                >
                  <Bot className="h-3.5 w-3.5 inline mr-1 text-purple-600" />
                  Xem TK AI
                </button>
                <button
                  type="button"
                  onClick={() => setDetailSub(null)}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const target = detailSub;
                    setDetailSub(null);
                    setRenewTarget(target);
                    setRenewMonths(12);
                    setRenewCustomDate("");
                  }}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-blue-700 transition-colors cursor-pointer"
                >
                  Gia hạn dịch vụ
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* AI Accounts Manager Modal */}
      <AiAccountsManagerModal
        isOpen={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        partners={partners}
        initialPartnerId={aiModalPartnerId}
        idToken={idToken}
        isGuest={isGuest}
        onAccountCountChange={() => {
          void loadAiTotal();
          void loadData();
        }}
      />

      {/* Google Sheet Configuration Modal */}
      <SubscriptionSheetConfigModal
        isOpen={sheetConfigModalOpen}
        onClose={() => setSheetConfigModalOpen(false)}
        idToken={idToken}
        onConfigSaved={() => {
          void loadData();
        }}
      />
    </div>
  );
}
