import { useEffect, useMemo, useState } from "react";
import { appDialog } from "../AppDialog";
import { matchesSearch } from "../../lib/searchText";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CircleDollarSign,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";

export type FinancePartner = { id: number; name: string };

type FinanceEntry = {
  id: number;
  transaction_date: string;
  entry_type: "income" | "expense";
  category: string;
  description: string;
  amount: string | number;
  partner?: number | null;
  partner_name?: string;
  status: "pending" | "completed" | "overdue" | "cancelled";
  payment_method: string;
  reference_code: string;
  notes: string;
  created_by: string;
  updated_by: string;
};

const statusLabel: Record<FinanceEntry["status"], string> = {
  pending: "Chờ xử lý",
  completed: "Đã hoàn thành",
  overdue: "Quá hạn",
  cancelled: "Đã hủy",
};

const statusClass: Record<FinanceEntry["status"], string> = {
  pending: "border-blue-200 bg-blue-50 text-blue-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  overdue: "border-rose-200 bg-rose-50 text-rose-700",
  cancelled: "border-slate-200 bg-slate-100 text-slate-600",
};

const formatMoney = (value: string | number) =>
  `${Number(value || 0).toLocaleString("vi-VN")} VNĐ`;

const showDate = (value: string) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString("vi-VN") : "—";

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 7)}-01`;
const blankDraft = () => ({
  id: 0,
  transaction_date: today(),
  entry_type: "income" as FinanceEntry["entry_type"],
  category: "",
  description: "",
  amount: "",
  partner: "",
  status: "pending" as FinanceEntry["status"],
  payment_method: "",
  reference_code: "",
  notes: "",
});

async function errorMessage(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (body.error) return body.error;
  return Object.values(body).flat().join(" · ") || "Không thể xử lý yêu cầu.";
}

export default function FinanceReport({
  partners,
  idToken,
  canEdit,
}: {
  partners: FinancePartner[];
  idToken: string;
  canEdit: boolean;
}) {
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState(blankDraft);
  const [filters, setFilters] = useState({
    search: "",
    dateFrom: monthStart(),
    dateTo: today(),
    entryType: "",
    status: "",
    partner: "",
  });
  const auth = { Authorization: `Bearer ${idToken}` };

  const load = async () => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/digital-training/finance-entries", { headers: auth });
      if (!response.ok) throw new Error(await errorMessage(response));
      setEntries(await response.json());
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, [idToken]);

  const visible = useMemo(() => entries.filter((item) => {
    const needle = filters.search;
    const searchable = [item.category, item.description, item.partner_name, item.reference_code]
      .join(" ")
      .toLocaleLowerCase("vi-VN");
    return matchesSearch(searchable, needle)
      && (!filters.dateFrom || item.transaction_date >= filters.dateFrom)
      && (!filters.dateTo || item.transaction_date <= filters.dateTo)
      && (!filters.entryType || item.entry_type === filters.entryType)
      && (!filters.status || item.status === filters.status)
      && (!filters.partner || String(item.partner || "") === filters.partner);
  }), [entries, filters]);

  const effective = visible.filter((item) => item.status !== "cancelled");
  const income = effective.filter((item) => item.entry_type === "income")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expense = effective.filter((item) => item.entry_type === "expense")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pending = effective.filter((item) => ["pending", "overdue"].includes(item.status)).length;

  const openEditor = (item?: FinanceEntry) => {
    setNotice("");
    setDraft(item ? {
      id: item.id,
      transaction_date: item.transaction_date,
      entry_type: item.entry_type,
      category: item.category,
      description: item.description,
      amount: String(item.amount),
      partner: item.partner ? String(item.partner) : "",
      status: item.status,
      payment_method: item.payment_method || "",
      reference_code: item.reference_code || "",
      notes: item.notes || "",
    } : blankDraft());
    setModalOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/digital-training/finance-entries${draft.id ? `/${draft.id}` : ""}`,
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({
            transaction_date: draft.transaction_date,
            entry_type: draft.entry_type,
            category: draft.category.trim(),
            description: draft.description.trim(),
            amount: Number(draft.amount),
            partner: draft.partner ? Number(draft.partner) : null,
            status: draft.status,
            payment_method: draft.payment_method.trim(),
            reference_code: draft.reference_code.trim(),
            notes: draft.notes.trim(),
          }),
        },
      );
      if (!response.ok) throw new Error(await errorMessage(response));
      setModalOpen(false);
      await load();
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft.id || !canEdit) return;
    const confirmed = await appDialog.confirm("Xóa khoản thu chi này?", {
      title: "Xóa khoản thu chi",
      confirmText: "Xóa khoản",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/digital-training/finance-entries/${draft.id}`, {
        method: "DELETE",
        headers: auth,
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      setModalOpen(false);
      await load();
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  return <section className="mt-1 space-y-5">
    <header className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-blue-600">Tài chính nội bộ</p>
          <h1 className="mt-1 text-2xl font-extrabold">Báo cáo thu chi</h1>
          <p className="mt-2 text-sm text-slate-500">Theo dõi các khoản thu, chi, công nợ và tình trạng xử lý theo từng khách hàng.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load()} className="ft-btn ft-btn-secondary">
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />Làm mới
          </button>
          {canEdit && <button onClick={() => openEditor()} className="ft-primary"><Plus className="h-4 w-4" />Thêm khoản thu chi</button>}
        </div>
      </div>
      {!canEdit && <p className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-700">Bạn đang có quyền xem. Chỉ Kế toán và Admin được chỉnh sửa dữ liệu.</p>}
    </header>

    <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
      <article className="rounded-xl sm:rounded-2xl border border-emerald-200 bg-emerald-50 p-3 sm:p-5"><ArrowDownCircle className="h-5 w-5 text-emerald-700" /><span className="mt-2 sm:mt-3 block text-xs font-bold uppercase text-emerald-700">Tổng thu</span><b className="mt-1 block text-lg sm:text-2xl text-emerald-900">{formatMoney(income)}</b></article>
      <article className="rounded-xl sm:rounded-2xl border border-rose-200 bg-rose-50 p-3 sm:p-5"><ArrowUpCircle className="h-5 w-5 text-rose-700" /><span className="mt-2 sm:mt-3 block text-xs font-bold uppercase text-rose-700">Tổng chi</span><b className="mt-1 block text-lg sm:text-2xl text-rose-900">{formatMoney(expense)}</b></article>
      <article className={`rounded-xl sm:rounded-2xl border p-3 sm:p-5 ${income - expense >= 0 ? "border-blue-200 bg-blue-50" : "border-orange-200 bg-orange-50"}`}><WalletCards className={`h-5 w-5 ${income - expense >= 0 ? "text-blue-700" : "text-orange-700"}`} /><span className="mt-2 sm:mt-3 block text-xs font-bold uppercase text-slate-600">Chênh lệch</span><b className="mt-1 block text-lg sm:text-2xl text-slate-900">{formatMoney(income - expense)}</b></article>
      <article className={`rounded-xl sm:rounded-2xl border p-3 sm:p-5 ${pending ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}><CircleDollarSign className={`h-5 w-5 ${pending ? "text-amber-700" : "text-emerald-700"}`} /><span className="mt-2 sm:mt-3 block text-xs font-bold uppercase text-slate-600">Chờ xử lý</span><b className="mt-1 block text-lg sm:text-2xl text-slate-900">{pending}</b></article>
    </div>

    <article className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-7">
        <label className="relative xl:col-span-2"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} className="w-full rounded-lg border py-2.5 pl-9 pr-3 text-sm min-h-[44px]" placeholder="Tìm nội dung, mã, khách hàng..." /></label>
        <input type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} className="rounded-lg border px-3 py-2 text-sm min-h-[44px]" title="Từ ngày" />
        <input type="date" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} className="rounded-lg border px-3 py-2 text-sm min-h-[44px]" title="Đến ngày" />
        <select value={filters.entryType} onChange={(event) => setFilters({ ...filters, entryType: event.target.value })} className="rounded-lg border px-3 py-2 text-sm min-h-[44px]"><option value="">Tất cả thu / chi</option><option value="income">Khoản thu</option><option value="expense">Khoản chi</option></select>
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className="rounded-lg border px-3 py-2 text-sm min-h-[44px]"><option value="">Tất cả trạng thái</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select value={filters.partner} onChange={(event) => setFilters({ ...filters, partner: event.target.value })} className="rounded-lg border px-3 py-2 text-sm min-h-[44px]"><option value="">Tất cả khách hàng</option>{partners.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </div>
      {notice && <p className="mx-4 mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{notice}</p>}

      {/* Mobile Card List (<768px) */}
      <div className="md:hidden divide-y divide-slate-100 border-t">
        {visible.map(item => (
          <div key={item.id} className="p-4 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${
                    item.entry_type === "income" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"
                  }`}>
                    {item.entry_type === "income" ? "Thu" : "Chi"}
                  </span>
                  <span className="text-xs font-medium text-slate-500">{showDate(item.transaction_date)}</span>
                </div>
                <p className="mt-1 font-bold text-slate-800 text-sm leading-snug">{item.description}</p>
                {item.notes && <p className="text-xs text-slate-500 mt-0.5">{item.notes}</p>}
              </div>
              <b className={`text-base font-extrabold shrink-0 ${item.entry_type === "income" ? "text-emerald-700" : "text-rose-700"}`}>
                {item.entry_type === "income" ? "+" : "-"}{formatMoney(item.amount)}
              </b>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1 border-t border-slate-50">
              <div>
                <span className="text-slate-400 font-medium">Khách hàng: </span>
                <span className="font-semibold text-slate-700">{item.partner_name || "—"}</span>
              </div>
              <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-bold ${statusClass[item.status]}`}>
                {statusLabel[item.status]}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
              <span>{item.payment_method || "Tiền mặt"} · {item.reference_code || "Không có mã"}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => openEditor(item)}
                  className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:text-blue-900 min-h-[44px] px-2.5 py-1 rounded-lg hover:bg-blue-50"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Sửa
                </button>
              )}
            </div>
          </div>
        ))}
        {!visible.length && (
          <div className="p-8 text-center text-sm text-slate-500">Chưa có dữ liệu phù hợp bộ lọc.</div>
        )}
      </div>

      {/* Desktop Table (>=768px) with sticky first column */}
      <div className="hidden md:block overflow-x-auto border-t">
        <table className="ft-table min-w-[1100px]">
          <thead><tr><th className="sticky left-0 bg-slate-50 z-10">Ngày</th><th>Loại</th><th>Nhóm thu chi</th><th>Nội dung</th><th>Khách hàng</th><th>Số tiền</th><th>Trạng thái</th><th>Thanh toán / chứng từ</th>{canEdit && <th></th>}</tr></thead>
          <tbody>{visible.map((item) => <tr key={item.id}>
            <td className="sticky left-0 bg-white font-semibold z-10 shadow-[1px_0_0_0_#e2e8f0]">{showDate(item.transaction_date)}</td>
            <td><span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${item.entry_type === "income" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{item.entry_type === "income" ? "Thu" : "Chi"}</span></td>
            <td><b>{item.category}</b></td>
            <td className="max-w-sm whitespace-normal">{item.description}<span className="block text-xs text-slate-500">{item.notes}</span></td>
            <td>{item.partner_name || "—"}</td>
            <td><b className={item.entry_type === "income" ? "text-emerald-700" : "text-rose-700"}>{formatMoney(item.amount)}</b></td>
            <td><span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${statusClass[item.status]}`}>{statusLabel[item.status]}</span></td>
            <td><span className="block">{item.payment_method || "—"}</span><span className="block text-xs text-slate-500">{item.reference_code || "Chưa có mã chứng từ"}</span></td>
            {canEdit && <td><button onClick={() => openEditor(item)} className="ft-btn ft-btn-secondary min-h-[44px]"><Pencil className="h-4 w-4" />Sửa</button></td>}
          </tr>)}{!visible.length && <tr><td colSpan={canEdit ? 9 : 8} className="py-12 text-center text-slate-500">Chưa có dữ liệu phù hợp bộ lọc.</td></tr>}</tbody>
        </table>
      </div>
    </article>

    {modalOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4">
      <form onSubmit={save} className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-extrabold">{draft.id ? "Cập nhật khoản thu chi" : "Thêm khoản thu chi"}</h2><p className="mt-1 text-sm text-slate-500">Nhập giá trị dương; loại Thu hoặc Chi quyết định cách tổng hợp.</p></div><button type="button" onClick={() => setModalOpen(false)}><X className="h-5 w-5" /></button></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label><span className="mb-1 block text-sm font-bold">Ngày giao dịch *</span><input required type="date" className="ft-input" value={draft.transaction_date} onChange={(event) => setDraft({ ...draft, transaction_date: event.target.value })} /></label>
          <label><span className="mb-1 block text-sm font-bold">Loại *</span><select className="ft-input" value={draft.entry_type} onChange={(event) => setDraft({ ...draft, entry_type: event.target.value as FinanceEntry["entry_type"] })}><option value="income">Khoản thu</option><option value="expense">Khoản chi</option></select></label>
          <label><span className="mb-1 block text-sm font-bold">Nhóm thu chi *</span><input required className="ft-input" placeholder="Ví dụ: Hợp đồng, vận hành..." value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label>
          <label><span className="mb-1 block text-sm font-bold">Số tiền *</span><input required type="number" min="1" className="ft-input" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label>
          <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Nội dung *</span><input required className="ft-input" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <label><span className="mb-1 block text-sm font-bold">Khách hàng</span><select className="ft-input" value={draft.partner} onChange={(event) => setDraft({ ...draft, partner: event.target.value })}><option value="">Không gắn khách hàng</option>{partners.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span className="mb-1 block text-sm font-bold">Trạng thái</span><select className="ft-input" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as FinanceEntry["status"] })}>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span className="mb-1 block text-sm font-bold">Phương thức thanh toán</span><input className="ft-input" placeholder="Chuyển khoản, tiền mặt..." value={draft.payment_method} onChange={(event) => setDraft({ ...draft, payment_method: event.target.value })} /></label>
          <label><span className="mb-1 block text-sm font-bold">Mã chứng từ</span><input className="ft-input" value={draft.reference_code} onChange={(event) => setDraft({ ...draft, reference_code: event.target.value })} /></label>
          <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Ghi chú</span><textarea className="ft-input min-h-24" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
        </div>
        {notice && <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{notice}</p>}
        <div className="mt-6 flex gap-3">{draft.id > 0 && <button type="button" onClick={() => void remove()} className="ft-btn border-rose-200 text-rose-700"><Trash2 className="h-4 w-4" />Xóa</button>}<div className="ml-auto flex gap-2"><button type="button" onClick={() => setModalOpen(false)} className="ft-btn ft-btn-secondary">Hủy</button><button disabled={busy} className="ft-primary">{busy ? "Đang lưu..." : "Lưu dữ liệu"}</button></div></div>
      </form>
    </div>}
  </section>;
}
