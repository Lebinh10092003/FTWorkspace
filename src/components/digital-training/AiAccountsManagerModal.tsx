import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  AlertCircle,
  Bot,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  Eye,
  EyeOff,
  Filter,
  Key,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { appDialog } from "../AppDialog";
import { matchesSearch } from "../../lib/searchText";
import { type ProductPartner } from "./ProductManagement";
import { shiftDateKey, todayVN } from '../../lib/vnDate';

export type PartnerAiAccount = {
  id: number;
  partner: number;
  partner_name: string;
  subscription?: number | null;
  platform: string;
  platform_display: string;
  account_username: string;
  account_password: string;
  assigned_to: string;
  starts_at?: string | null;
  expires_at?: string | null;
  days_remaining?: number | null;
  status: "active" | "expired" | "locked" | "revoked";
  status_display: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

const PLATFORMS = [
  { id: "chatgpt_plus", label: "ChatGPT Plus", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { id: "chatgpt_team", label: "ChatGPT Team", badge: "bg-emerald-50 text-emerald-800 border-emerald-300" },
  { id: "claude_pro", label: "Claude Pro", badge: "bg-amber-50 text-amber-800 border-amber-200" },
  { id: "gemini_advanced", label: "Gemini Advanced", badge: "bg-blue-50 text-blue-700 border-blue-200" },
  { id: "canva_pro", label: "Canva Pro", badge: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  { id: "midjourney", label: "Midjourney", badge: "bg-purple-50 text-purple-700 border-purple-200" },
  { id: "copilot", label: "Microsoft Copilot", badge: "bg-teal-50 text-teal-700 border-teal-200" },
  { id: "shared_ai", label: "AI Dùng chung FT", badge: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  { id: "other", label: "Khác", badge: "bg-slate-50 text-slate-700 border-slate-200" },
];

function getPlatformBadge(platform: string) {
  const p = PLATFORMS.find((x) => x.id === platform);
  return p?.badge || "bg-slate-50 text-slate-700 border-slate-200";
}

function generateSecurePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
  let pass = "";
  for (let i = 0; i < 12; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

export default function AiAccountsManagerModal({
  isOpen,
  onClose,
  partners,
  initialPartnerId,
  idToken,
  isGuest,
  onAccountCountChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  partners: ProductPartner[];
  initialPartnerId?: number | null;
  idToken: string;
  isGuest: boolean;
  onAccountCountChange?: () => void;
}) {
  const [accounts, setAccounts] = useState<PartnerAiAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>(
    initialPartnerId ? String(initialPartnerId) : "all"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Masking toggles for passwords: map of accountId -> boolean
  const [revealedPasswords, setRevealedPasswords] = useState<Record<number, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Sub-modal: Single Account Create/Edit
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<{
    id?: number;
    partner: string;
    platform: string;
    account_username: string;
    account_password: string;
    assigned_to: string;
    starts_at: string;
    expires_at: string;
    status: string;
    notes: string;
  }>({
    partner: "",
    platform: "chatgpt_plus",
    account_username: "",
    account_password: "",
    assigned_to: "",
    starts_at: todayVN(),
    expires_at: "",
    status: "active",
    notes: "",
  });
  const [savingAccount, setSavingAccount] = useState(false);

  // Sub-modal: Bulk Paste
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [bulkPartner, setBulkPartner] = useState("");
  const [bulkPlatform, setBulkPlatform] = useState("chatgpt_plus");
  const [bulkStartsAt, setBulkStartsAt] = useState(todayVN());
  const [bulkExpiresAt, setBulkExpiresAt] = useState("");
  const [bulkRawText, setBulkRawText] = useState("");
  const [savingBulk, setSavingBulk] = useState(false);

  const authHeader = useMemo(() => (idToken ? { Authorization: `Bearer ${idToken}` } : {}), [idToken]);

  // Load accounts
  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      let url = "/api/digital-training/ai-accounts";
      if (selectedPartnerId !== "all") {
        url += `?partner=${selectedPartnerId}`;
      }
      const res = await fetch(url, { headers: authHeader });
      if (res.ok) {
        const data = await res.json();
        setAccounts(data || []);
      }
    } catch {
      // silently ignore or set empty
    } finally {
      setLoading(false);
    }
  }, [selectedPartnerId, authHeader]);

  useEffect(() => {
    if (isOpen) {
      if (initialPartnerId) {
        setSelectedPartnerId(String(initialPartnerId));
      }
      void loadAccounts();
    }
  }, [isOpen, initialPartnerId, loadAccounts]);

  // Copy to clipboard helper
  const handleCopy = (text: string, identifier: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(identifier);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === identifier ? null : prev));
    }, 2000);
  };

  // Toggle reveal password
  const toggleReveal = (id: number) => {
    setRevealedPasswords((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Filtered accounts
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      if (platformFilter !== "all" && acc.platform !== platformFilter) return false;
      if (statusFilter !== "all" && acc.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim();
        const ok =
          matchesSearch(acc.account_username, q) ||
          matchesSearch(acc.partner_name, q) ||
          matchesSearch(acc.assigned_to, q) ||
          matchesSearch(acc.notes, q) ||
          matchesSearch(acc.platform_display, q);
        if (!ok) return false;
      }
      return true;
    });
  }, [accounts, platformFilter, statusFilter, searchQuery]);

  // Summary Metrics
  const stats = useMemo(() => {
    const total = accounts.length;
    const active = accounts.filter((a) => a.status === "active").length;
    const expiring = accounts.filter((a) => a.status === "active" && a.days_remaining != null && a.days_remaining <= 30 && a.days_remaining >= 0).length;
    const expired = accounts.filter((a) => a.status === "expired" || (a.days_remaining != null && a.days_remaining < 0)).length;
    const uniqueSchools = new Set(accounts.map((a) => a.partner)).size;
    return { total, active, expiring, expired, uniqueSchools };
  }, [accounts]);

  // Save single account
  const handleSaveSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount.partner || !editingAccount.account_username || !editingAccount.account_password) {
      await appDialog.alert("Vui lòng điền đầy đủ Trường học, Tên tài khoản và Mật khẩu.", {
        title: "Thiếu thông tin",
      });
      return;
    }
    setSavingAccount(true);
    try {
      const url = editingAccount.id
        ? `/api/digital-training/ai-accounts/${editingAccount.id}`
        : `/api/digital-training/ai-accounts`;
      const method = editingAccount.id ? "PATCH" : "POST";
      const payload = {
        partner: Number(editingAccount.partner),
        platform: editingAccount.platform,
        account_username: editingAccount.account_username.trim(),
        account_password: editingAccount.account_password.trim(),
        assigned_to: editingAccount.assigned_to.trim(),
        starts_at: editingAccount.starts_at || null,
        expires_at: editingAccount.expires_at || null,
        status: editingAccount.status,
        notes: editingAccount.notes.trim(),
      };
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Không thể lưu tài khoản AI.");
      }
      setIsEditOpen(false);
      await loadAccounts();
      if (onAccountCountChange) onAccountCountChange();
    } catch (err: any) {
      await appDialog.alert(err.message || "Lỗi khi lưu tài khoản AI.", { title: "Lỗi", tone: "danger" });
    } finally {
      setSavingAccount(false);
    }
  };

  // Delete account
  const handleDelete = async (acc: PartnerAiAccount) => {
    const ok = await appDialog.confirm(
      `Bạn có chắc chắn muốn xóa tài khoản "${acc.account_username}" của "${acc.partner_name}" không?`,
      {
        title: "Xác nhận xóa tài khoản AI",
        confirmText: "Xóa tài khoản",
        cancelText: "Hủy",
      }
    );
    if (!ok) return;

    try {
      const res = await fetch(`/api/digital-training/ai-accounts/${acc.id}`, {
        method: "DELETE",
        headers: authHeader,
      });
      if (!res.ok) {
        throw new Error("Không thể xóa tài khoản.");
      }
      await loadAccounts();
      if (onAccountCountChange) onAccountCountChange();
    } catch (err: any) {
      await appDialog.alert(err.message || "Lỗi xóa tài khoản.", { title: "Lỗi", tone: "danger" });
    }
  };

  // Parse bulk text lines
  const parsedBulkAccounts = useMemo(() => {
    if (!bulkRawText.trim()) return [];
    const lines = bulkRawText.split("\n");
    const result: Array<{ username: string; password: string; assigned: string }> = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      // Split by tab, pipe, comma, or colon
      let parts: string[] = [];
      if (line.includes("\t")) {
        parts = line.split("\t");
      } else if (line.includes("|")) {
        parts = line.split("|");
      } else if (line.includes(",")) {
        parts = line.split(",");
      } else if (line.includes(":")) {
        parts = line.split(":");
      } else {
        parts = line.split(/\s+/);
      }
      const username = (parts[0] || "").trim();
      const password = (parts[1] || "").trim();
      const assigned = (parts.slice(2).join(" ") || "").trim();
      if (username) {
        result.push({ username, password: password || generateSecurePassword(), assigned });
      }
    }
    return result;
  }, [bulkRawText]);

  // Submit bulk
  const handleSaveBulk = async () => {
    if (!bulkPartner) {
      await appDialog.alert("Vui lòng chọn Trường học đối tác tiếp nhận tài khoản.", { title: "Thiếu trường học" });
      return;
    }
    if (parsedBulkAccounts.length === 0) {
      await appDialog.alert("Vui lòng dán danh sách tài khoản theo định dạng.", { title: "Chưa có danh sách" });
      return;
    }
    setSavingBulk(true);
    try {
      const payload = {
        partner_id: Number(bulkPartner),
        accounts: parsedBulkAccounts.map((a) => ({
          platform: bulkPlatform,
          account_username: a.username,
          account_password: a.password,
          assigned_to: a.assigned,
          starts_at: bulkStartsAt || null,
          expires_at: bulkExpiresAt || null,
          status: "active",
        })),
      };
      const res = await fetch("/api/digital-training/ai-accounts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Lỗi tạo tài khoản hàng loạt.");
      }
      setIsBulkOpen(false);
      setBulkRawText("");
      await loadAccounts();
      if (onAccountCountChange) onAccountCountChange();
      await appDialog.alert(`Đã thêm thành công ${data.count} tài khoản AI cho trường!`, {
        title: "Thành công",
      });
    } catch (err: any) {
      await appDialog.alert(err.message || "Lỗi thêm hàng loạt.", { title: "Lỗi", tone: "danger" });
    } finally {
      setSavingBulk(false);
    }
  };

  // Export to CSV
  const exportToCSV = () => {
    if (filteredAccounts.length === 0) {
      void appDialog.alert("Không có tài khoản nào để xuất file.", { title: "Thông báo" });
      return;
    }
    const headers = [
      "STT",
      "Trường học",
      "Nền tảng AI",
      "Tài khoản (Email / Username)",
      "Mật khẩu",
      "Người / Bộ môn sử dụng",
      "Ngày cấp",
      "Ngày hết hạn",
      "Còn lại (ngày)",
      "Trạng thái",
      "Ghi chú",
    ];
    const rows = filteredAccounts.map((acc, idx) => [
      idx + 1,
      `"${acc.partner_name.replace(/"/g, '""')}"`,
      `"${acc.platform_display.replace(/"/g, '""')}"`,
      `"${acc.account_username.replace(/"/g, '""')}"`,
      `"${acc.account_password.replace(/"/g, '""')}"`,
      `"${acc.assigned_to.replace(/"/g, '""')}"`,
      acc.starts_at || "",
      acc.expires_at || "Vô thời hạn",
      acc.days_remaining != null ? acc.days_remaining : "Không giới hạn",
      `"${acc.status_display.replace(/"/g, '""')}"`,
      `"${(acc.notes || "").replace(/"/g, '""')}"`,
    ]);
    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Danh_sach_Tai_khoan_AI_FermatTech_${todayVN()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-3 bg-slate-900/60 backdrop-blur-xs">
      <div className="flex h-full w-full flex-col rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-6 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600/30 text-purple-300 border border-purple-500/40">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  Quản lý Danh sách & Mật khẩu TK AI Dùng chung
                </h2>
                <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-[11px] font-semibold text-purple-300 border border-purple-500/30">
                  {accounts.length} tài khoản
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Kiểm soát tài khoản ChatGPT Plus, Claude Pro, Gemini, Canva cho từng khách hàng & trường học
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isGuest && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setBulkPartner(selectedPartnerId !== "all" ? selectedPartnerId : String(partners[0]?.id || ""));
                    setBulkRawText("");
                    setIsBulkOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-purple-400/40 bg-purple-950/60 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/80 transition-colors cursor-pointer"
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>Thêm hàng loạt (Bulk)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingAccount({
                      partner: selectedPartnerId !== "all" ? selectedPartnerId : String(partners[0]?.id || ""),
                      platform: "chatgpt_plus",
                      account_username: "",
                      account_password: generateSecurePassword(),
                      assigned_to: "",
                      starts_at: todayVN(),
                      expires_at: shiftDateKey(todayVN(), 365),
                      status: "active",
                      notes: "",
                    });
                    setIsEditOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-blue-500 transition-colors cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Cấp tài khoản mới</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Quick Stats Bar */}
        <div className="grid grid-cols-2 gap-3 border-b border-slate-100 bg-slate-50/70 p-4 sm:grid-cols-4">
          <div className="flex items-center gap-3 rounded-xl border border-slate-200/70 bg-white p-3 shadow-2xs">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
              <Bot className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500">Tổng số tài khoản</p>
              <p className="text-lg font-bold text-slate-900">{stats.total}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-slate-200/70 bg-white p-3 shadow-2xs">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500">Đang hoạt động</p>
              <p className="text-lg font-bold text-emerald-600">{stats.active}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-slate-200/70 bg-white p-3 shadow-2xs">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <Clock3 className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500">Sắp hết hạn (≤ 30 ngày)</p>
              <p className="text-lg font-bold text-amber-600">{stats.expiring}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-slate-200/70 bg-white p-3 shadow-2xs">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500">Trường học đang cấp</p>
              <p className="text-lg font-bold text-slate-900">{stats.uniqueSchools} trường</p>
            </div>
          </div>
        </div>

        {/* Toolbar & Filter Bar */}
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-white">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            {/* Filter by Partner / School */}
            <div className="flex items-center gap-1.5">
              <Building2 className="h-4 w-4 text-slate-400" />
              <select
                value={selectedPartnerId}
                onChange={(e) => setSelectedPartnerId(e.target.value)}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 shadow-2xs outline-none focus:border-purple-500 max-w-[220px]"
              >
                <option value="all">🏢 Tất cả trường học ({partners.length})</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter by Platform */}
            <div className="flex items-center gap-1.5">
              <Bot className="h-4 w-4 text-slate-400" />
              <select
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-2xs outline-none focus:border-purple-500"
              >
                <option value="all">Tất cả nền tảng AI</option>
                {PLATFORMS.map((pf) => (
                  <option key={pf.id} value={pf.id}>
                    {pf.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter by Status */}
            <div className="flex items-center gap-1.5">
              <Filter className="h-4 w-4 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-2xs outline-none focus:border-purple-500"
              >
                <option value="all">Tất cả trạng thái</option>
                <option value="active">Đang hoạt động</option>
                <option value="expired">Đã hết hạn</option>
                <option value="locked">Tạm khóa</option>
                <option value="revoked">Đã thu hồi</option>
              </select>
            </div>

            {/* Search Input */}
            <div className="relative min-w-[200px] flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm email, trường, giáo viên..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50/50 pl-8 pr-3 text-xs text-slate-800 outline-none focus:border-purple-500 focus:bg-white"
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportToCSV}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-slate-400" />
              <span>Xuất CSV</span>
            </button>
            <button
              type="button"
              onClick={loadAccounts}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors cursor-pointer"
              title="Tải lại danh sách"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-purple-600 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Account Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-semibold text-slate-600 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="py-3 pl-4 pr-2 whitespace-nowrap">STT</th>
                <th className="py-3 px-3">Trường học / Khách hàng</th>
                <th className="py-3 px-3 whitespace-nowrap">Nền tảng AI</th>
                <th className="py-3 px-3">Tài khoản (Email / ID)</th>
                <th className="py-3 px-3 whitespace-nowrap">Mật khẩu</th>
                <th className="py-3 px-3">Người / Bộ môn nhận</th>
                <th className="py-3 px-3 whitespace-nowrap">Hạn sử dụng</th>
                <th className="py-3 px-3 whitespace-nowrap">Trạng thái</th>
                <th className="py-3 pr-4 pl-3 text-right whitespace-nowrap">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-xs text-slate-400">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-purple-600" />
                    Đang tải danh sách tài khoản AI...
                  </td>
                </tr>
              ) : filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-xs text-slate-400">
                    <Bot className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                    Không tìm thấy tài khoản AI nào phù hợp với bộ lọc.
                  </td>
                </tr>
              ) : (
                filteredAccounts.map((acc, idx) => {
                  const isRevealed = revealedPasswords[acc.id] || false;
                  const isCopiedUser = copiedKey === `user-${acc.id}`;
                  const isCopiedPass = copiedKey === `pass-${acc.id}`;
                  const isExpired = acc.status === "expired" || (acc.days_remaining != null && acc.days_remaining < 0);
                  const isExpiring = acc.status === "active" && acc.days_remaining != null && acc.days_remaining <= 30 && acc.days_remaining >= 0;

                  return (
                    <tr key={acc.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 pl-4 pr-2 text-slate-400 font-mono text-[11px] whitespace-nowrap">{idx + 1}</td>

                      {/* Partner Name */}
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900 break-words" title={acc.partner_name}>
                          {acc.partner_name}
                        </div>
                      </td>

                      {/* Platform */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold border ${getPlatformBadge(
                            acc.platform
                          )}`}
                        >
                          <Sparkles className="h-2.5 w-2.5" />
                          <span>{acc.platform_display}</span>
                        </span>
                      </td>

                      {/* Username + Copy */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5 font-mono text-xs text-slate-800">
                          <span className="select-all font-medium break-all" title={acc.account_username}>
                            {acc.account_username}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy(acc.account_username, `user-${acc.id}`)}
                            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
                            title="Sao chép tên đăng nhập"
                          >
                            {isCopiedUser ? (
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Password + Mask/Reveal + Copy */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 font-mono text-xs">
                          <span
                            className={`px-1.5 py-0.5 rounded break-all select-all ${
                              isRevealed ? "bg-slate-100 text-slate-900 font-bold" : "text-slate-400 tracking-wider"
                            }`}
                            title={isRevealed ? acc.account_password : "Đã ẩn mật khẩu"}
                          >
                            {isRevealed ? acc.account_password : "••••••••••••"}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleReveal(acc.id)}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
                            title={isRevealed ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                          >
                            {isRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopy(acc.account_password, `pass-${acc.id}`)}
                            className="rounded p-1 text-slate-400 hover:bg-purple-100 hover:text-purple-700 transition-colors cursor-pointer"
                            title="Sao chép mật khẩu"
                          >
                            {isCopiedPass ? (
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Assigned to */}
                      <td className="py-3 px-3">
                        <div className="break-words text-slate-700 font-medium" title={acc.assigned_to}>
                          {acc.assigned_to || <span className="text-slate-400 italic">Chưa gán</span>}
                        </div>
                      </td>

                      {/* Expiry & Days */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="text-slate-800 font-medium">
                          {acc.expires_at ? new Date(acc.expires_at).toLocaleDateString("vi-VN") : "Vô thời hạn"}
                        </div>
                        {acc.days_remaining != null && (
                          <div
                            className={`text-[10px] font-bold ${
                              isExpired ? "text-rose-600" : isExpiring ? "text-amber-600" : "text-emerald-600"
                            }`}
                          >
                            {acc.days_remaining < 0
                              ? `Quá hạn ${Math.abs(acc.days_remaining)} ngày`
                              : `Còn ${acc.days_remaining} ngày`}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {acc.status === "active" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Đang dùng
                          </span>
                        ) : acc.status === "expired" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 border border-rose-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                            Hết hạn
                          </span>
                        ) : acc.status === "locked" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                            Tạm khóa
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 border border-slate-200">
                            Đã thu hồi
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 pr-4 pl-3 text-right whitespace-nowrap">
                        {!isGuest && (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingAccount({
                                  id: acc.id,
                                  partner: String(acc.partner),
                                  platform: acc.platform,
                                  account_username: acc.account_username,
                                  account_password: acc.account_password,
                                  assigned_to: acc.assigned_to,
                                  starts_at: acc.starts_at || "",
                                  expires_at: acc.expires_at || "",
                                  status: acc.status,
                                  notes: acc.notes,
                                });
                                setIsEditOpen(true);
                              }}
                              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-600 transition-colors cursor-pointer"
                              title="Sửa tài khoản"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(acc)}
                              className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
                              title="Xóa tài khoản"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>Mật khẩu được lưu trữ an toàn. Click biểu tượng Copy để gửi nhanh cho giáo viên.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>

      {/* ================= MODAL SUB 1: Single Account Add / Edit ================= */}
      {isEditOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-5 py-3.5 text-white">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Bot className="h-4 w-4 text-purple-400" />
                <span>{editingAccount.id ? "Chỉnh sửa tài khoản AI" : "Cấp tài khoản AI mới"}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsEditOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSingle} className="p-5 space-y-3.5 text-xs">
              {/* Partner */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Trường học / Khách hàng <span className="text-rose-500">*</span>
                </label>
                <select
                  value={editingAccount.partner}
                  onChange={(e) => setEditingAccount((prev) => ({ ...prev, partner: e.target.value }))}
                  required
                  className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 shadow-2xs outline-none focus:border-blue-500"
                >
                  <option value="">-- Chọn trường học --</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Platform */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nền tảng AI <span className="text-rose-500">*</span>
                </label>
                <select
                  value={editingAccount.platform}
                  onChange={(e) => setEditingAccount((prev) => ({ ...prev, platform: e.target.value }))}
                  required
                  className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 shadow-2xs outline-none focus:border-blue-500"
                >
                  {PLATFORMS.map((pf) => (
                    <option key={pf.id} value={pf.id}>
                      {pf.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Username */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Tên tài khoản (Email / ID) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editingAccount.account_username}
                  onChange={(e) => setEditingAccount((prev) => ({ ...prev, account_username: e.target.value }))}
                  placeholder="ams.toan01@fermat-ai.edu.vn"
                  className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs text-slate-800 shadow-2xs outline-none focus:border-blue-500"
                />
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700">
                    Mật khẩu <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingAccount((prev) => ({ ...prev, account_password: generateSecurePassword() }))
                    }
                    className="text-[11px] font-semibold text-purple-600 hover:text-purple-800 flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="h-3 w-3" />
                    <span>Tạo ngẫu nhiên</span>
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={editingAccount.account_password}
                  onChange={(e) => setEditingAccount((prev) => ({ ...prev, account_password: e.target.value }))}
                  placeholder="Mật khẩu tài khoản AI"
                  className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs text-slate-800 shadow-2xs outline-none focus:border-blue-500"
                />
              </div>

              {/* Assigned To */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Người / Tổ bộ môn tiếp nhận</label>
                <input
                  type="text"
                  value={editingAccount.assigned_to}
                  onChange={(e) => setEditingAccount((prev) => ({ ...prev, assigned_to: e.target.value }))}
                  placeholder="VD: Thầy Hoàng (Tổ Toán - Tin)"
                  className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 shadow-2xs outline-none focus:border-blue-500"
                />
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Ngày cấp</label>
                  <input
                    type="date"
                    value={editingAccount.starts_at}
                    onChange={(e) => setEditingAccount((prev) => ({ ...prev, starts_at: e.target.value }))}
                    className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 shadow-2xs outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Ngày hết hạn</label>
                  <input
                    type="date"
                    value={editingAccount.expires_at}
                    onChange={(e) => setEditingAccount((prev) => ({ ...prev, expires_at: e.target.value }))}
                    className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 shadow-2xs outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Trạng thái</label>
                <select
                  value={editingAccount.status}
                  onChange={(e) => setEditingAccount((prev) => ({ ...prev, status: e.target.value }))}
                  className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 shadow-2xs outline-none focus:border-blue-500"
                >
                  <option value="active">Đang hoạt động</option>
                  <option value="expired">Đã hết hạn</option>
                  <option value="locked">Tạm khóa</option>
                  <option value="revoked">Đã thu hồi</option>
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ghi chú</label>
                <textarea
                  rows={2}
                  value={editingAccount.notes}
                  onChange={(e) => setEditingAccount((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Ghi chú mục đích sử dụng..."
                  className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-800 shadow-2xs outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsEditOpen(false)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingAccount}
                  className="rounded-lg bg-blue-600 px-4 py-1.5 font-semibold text-white shadow-2xs hover:bg-blue-500 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {savingAccount ? "Đang lưu..." : editingAccount.id ? "Cập nhật" : "Tạo tài khoản"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL SUB 2: Bulk Import ================= */}
      {isBulkOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-5 py-3.5 text-white">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Layers className="h-4 w-4 text-purple-400" />
                <span>Thêm tài khoản AI hàng loạt cho trường</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsBulkOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                {/* Partner */}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Trường học đối tác <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={bulkPartner}
                    onChange={(e) => setBulkPartner(e.target.value)}
                    className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-800 shadow-2xs outline-none focus:border-purple-500"
                  >
                    <option value="">-- Chọn trường --</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Platform */}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nền tảng AI chung</label>
                  <select
                    value={bulkPlatform}
                    onChange={(e) => setBulkPlatform(e.target.value)}
                    className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800 shadow-2xs outline-none focus:border-purple-500"
                  >
                    {PLATFORMS.map((pf) => (
                      <option key={pf.id} value={pf.id}>
                        {pf.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Ngày bắt đầu</label>
                  <input
                    type="date"
                    value={bulkStartsAt}
                    onChange={(e) => setBulkStartsAt(e.target.value)}
                    className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 shadow-2xs outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Ngày hết hạn</label>
                  <input
                    type="date"
                    value={bulkExpiresAt}
                    onChange={(e) => setBulkExpiresAt(e.target.value)}
                    className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 shadow-2xs outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              {/* Bulk Textarea */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700">
                    Dán danh sách tài khoản <span className="text-rose-500">*</span>
                  </label>
                  <span className="text-[10px] text-slate-400">
                    Định dạng: <code>email | mật khẩu | người nhận</code> (mỗi dòng 1 TK)
                  </span>
                </div>
                <textarea
                  rows={6}
                  value={bulkRawText}
                  onChange={(e) => setBulkRawText(e.target.value)}
                  placeholder={`ams.toan01@fermat-ai.edu.vn | Pass123! | Thầy Hoàng\nams.toan02@fermat-ai.edu.vn | Pass456! | Cô Mai\nams.van01@fermat-ai.edu.vn | Pass789! | Tổ Văn`}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 font-mono text-xs text-slate-800 shadow-2xs outline-none focus:border-purple-500 focus:bg-white resize-none"
                />
              </div>

              {/* Live Preview */}
              {parsedBulkAccounts.length > 0 && (
                <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-3">
                  <div className="flex items-center justify-between font-semibold text-purple-900 mb-1.5">
                    <span>Xem trước dữ liệu ({parsedBulkAccounts.length} tài khoản)</span>
                    <span className="text-[10px] text-purple-700">Tự động nhận diện</span>
                  </div>
                  <div className="max-h-24 overflow-y-auto space-y-1 font-mono text-[11px] text-slate-700">
                    {parsedBulkAccounts.slice(0, 5).map((a, i) => (
                      <div key={i} className="flex items-center justify-between bg-white px-2 py-1 rounded border border-purple-100">
                        <span className="truncate max-w-[200px] font-bold text-slate-800">{a.username}</span>
                        <span className="text-slate-500">{a.password}</span>
                        <span className="text-purple-700 truncate max-w-[120px]">{a.assigned || "Chưa gán"}</span>
                      </div>
                    ))}
                    {parsedBulkAccounts.length > 5 && (
                      <p className="text-[10px] text-slate-500 italic text-center">
                        ... và {parsedBulkAccounts.length - 5} tài khoản khác
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsBulkOpen(false)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleSaveBulk}
                  disabled={savingBulk || parsedBulkAccounts.length === 0}
                  className="rounded-lg bg-purple-600 px-4 py-1.5 font-semibold text-white shadow-2xs hover:bg-purple-500 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {savingBulk ? "Đang xử lý..." : `Thêm ${parsedBulkAccounts.length || 0} tài khoản`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
