import React, { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Link2, Loader2, RefreshCw, Save } from "lucide-react";
import { normalizeSearchText } from '../../lib/searchText';

type QuestionBankSettings = { default_url: string };
type BankQuestion = { audience_group?: string; category?: string; knowledge_type?: string; difficulty?: string };
type BankInventoryTopic = { name: string; total: number; theory: number; practice: number; easy: number; medium: number; hard: number };
type BankPreview = { bank_questions?: BankQuestion[]; source_name?: string; synced_at?: string; inventory?: { sheets?: Array<{ name: string; topics?: BankInventoryTopic[] }> }; errors?: string[] };
type BankSummaryRow = { group: string; category: string; total: number; theory: number; practice: number; easy: number; medium: number; hard: number };

const errorText = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  if (body.error) return String(body.error);
  const first = Object.values(body)[0];
  return Array.isArray(first) ? first.join(" ") : String(first || "Không thể xử lý yêu cầu.");
};
const normalized = (value: unknown) => normalizeSearchText(value || "");

export default function QuestionBankSettings({ idToken }: { idToken: string }) {
  const [settings, setSettings] = useState<QuestionBankSettings>({ default_url: "" });
  const [busy, setBusy] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [bankError, setBankError] = useState("");
  const [bankQuestions, setBankQuestions] = useState<BankQuestion[]>([]);
  const [bankInventory, setBankInventory] = useState<BankPreview["inventory"]>({ sheets: [] });
  const [bankSource, setBankSource] = useState("");
  const [readAt, setReadAt] = useState("");
  const auth = { Authorization: `Bearer ${idToken}` };
  const summaryRows = useMemo(() => {
    const cachedRows = (bankInventory?.sheets || []).flatMap((sheet) => (sheet.topics || []).map((topic) => ({
      group: sheet.name, category: topic.name, total: topic.total, theory: topic.theory,
      practice: topic.practice, easy: topic.easy, medium: topic.medium, hard: topic.hard,
    })));
    if (cachedRows.length) return cachedRows.sort((a, b) => a.group.localeCompare(b.group, "vi") || a.category.localeCompare(b.category, "vi"));
    const rows = new Map<string, BankSummaryRow>();
    bankQuestions.forEach((question) => {
      const group = String(question.audience_group || "Chưa phân nhóm").trim() || "Chưa phân nhóm";
      const category = String(question.category || "Chưa phân chủ đề").trim() || "Chưa phân chủ đề";
      const key = `${group}\u0000${category}`;
      const row = rows.get(key) || { group, category, total: 0, theory: 0, practice: 0, easy: 0, medium: 0, hard: 0 };
      row.total += 1;
      const knowledge = normalized(question.knowledge_type);
      const difficulty = normalized(question.difficulty);
      if (["ly thuyet", "theory"].includes(knowledge)) row.theory += 1;
      if (["thuc hanh", "practice"].includes(knowledge)) row.practice += 1;
      if (["de", "easy"].includes(difficulty)) row.easy += 1;
      if (["trung binh", "medium"].includes(difficulty)) row.medium += 1;
      if (["kho", "hard"].includes(difficulty)) row.hard += 1;
      rows.set(key, row);
    });
    return Array.from(rows.values()).sort((a, b) => a.group.localeCompare(b.group, "vi") || a.category.localeCompare(b.category, "vi"));
  }, [bankQuestions]);
  const applyBank = (preview: BankPreview, url: string) => {
    setBankQuestions(preview.bank_questions || []);
    setBankInventory(preview.inventory || { sheets: [] });
    setBankSource(preview.source_name || url.trim());
    setReadAt(preview.synced_at ? new Date(preview.synced_at).toLocaleString("vi-VN") : new Date().toLocaleString("vi-VN"));
  };
  const loadCachedBank = async (url = settings.default_url) => {
    if (!url.trim()) return;
    setBankError("");
    const response = await fetch(`/api/digital-training/question-bank-snapshot?google_sheet_url=${encodeURIComponent(url.trim())}`, { headers: auth });
    if (!response.ok) throw new Error(await errorText(response));
    applyBank(await response.json() as BankPreview, url);
  };
  const syncBank = async (url = settings.default_url) => {
    if (!url.trim()) { setBankError("Chưa có liên kết ngân hàng đề thi để đồng bộ."); return; }
    setSyncing(true); setBankError("");
    try {
      const response = await fetch("/api/digital-training/question-bank-snapshot", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ google_sheet_url: url.trim() }) });
      if (!response.ok) throw new Error(await errorText(response));
      applyBank(await response.json() as BankPreview, url);
      setNotice("Đã đồng bộ và lập chỉ mục ngân hàng đề thi.");
    } catch (error: any) { setBankError(String(error?.message || error)); }
    finally { setSyncing(false); }
  };
  const load = async () => {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/digital-training/question-bank-settings", { headers: auth });
      if (!response.ok) throw new Error(await errorText(response));
      const next = await response.json() as QuestionBankSettings;
      setSettings(next);
      await loadCachedBank(next.default_url);
    } catch (error: any) {
      const message = String(error?.message || error);
      if (!message.includes("chưa được đồng bộ")) setNotice(message);
    } finally { setBusy(false); }
  };
  useEffect(() => { if (idToken) void load(); }, [idToken]);
  const save = async () => {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/digital-training/question-bank-settings", { method: "PATCH", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ default_url: settings.default_url.trim() }) });
      if (!response.ok) throw new Error(await errorText(response));
      const next = await response.json() as QuestionBankSettings;
      setSettings(next);
      setNotice("Đã lưu liên kết. Bấm Đồng bộ từ Google Sheet để cập nhật chỉ mục.");
    } catch (error: any) { setNotice(String(error?.message || error)); }
    finally { setBusy(false); }
  };
  return <section className="space-y-5">
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3"><span className="rounded-xl bg-emerald-100 p-3 text-emerald-700"><Link2 className="h-6 w-6" /></span><div><p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Cấu hình dùng chung</p><h2 className="mt-1 text-2xl font-extrabold text-[#001e40]">Set up ngân hàng đề thi</h2><p className="mt-2 max-w-2xl text-sm text-slate-600">Đồng bộ để lưu chỉ mục sheet, chủ đề và số lượng câu. Khi sinh đề, hệ thống vẫn đọc Google Sheet nguồn hiện tại để random câu hỏi; nội dung câu hỏi không lưu trong backend.</p></div></div>
      <label className="mt-6 block"><span className="mb-1 block text-sm font-bold">Liên kết Google Sheet / Google Drive</span><input type="url" className="ft-input" value={settings.default_url} onChange={(event) => setSettings({ default_url: event.target.value })} placeholder="https://docs.google.com/..." /></label>
      <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy} onClick={save} className="ft-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Lưu liên kết</button><button disabled={busy} onClick={() => void load()} className="ft-btn ft-btn-secondary disabled:opacity-50"><RefreshCw className="h-4 w-4" />Tải chỉ mục đã lưu</button></div>
      {notice && <p className={`mt-4 rounded-xl p-3 text-sm ${notice.startsWith("Đã") ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{notice}</p>}
    </div>
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b p-5"><div className="flex items-start gap-3"><span className="rounded-xl bg-blue-100 p-3 text-blue-700"><FileSpreadsheet className="h-6 w-6" /></span><div><h2 className="text-lg font-extrabold text-[#001e40]">Mô tả ngân hàng đề thi</h2><p className="mt-1 text-sm text-slate-500">{bankSource ? `${summaryRows.reduce((sum, row) => sum + row.total, 0)} câu · ${summaryRows.length} chủ đề` : "Đồng bộ ngân hàng để lập chỉ mục dữ liệu."}{readAt ? ` · cập nhật ${readAt}` : ""}</p></div></div><button disabled={syncing || busy} onClick={() => void syncBank()} className="ft-btn ft-btn-secondary disabled:opacity-50">{syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Đồng bộ từ Google Sheet</button></div>
      {syncing ? <div className="grid min-h-52 place-items-center text-sm text-slate-500"><span className="inline-flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin text-blue-600" />Đang đồng bộ ngân hàng…</span></div> : bankError ? <p className="m-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{bankError}</p> : summaryRows.length ? <div className="overflow-x-auto"><table className="ft-table min-w-[920px]"><thead><tr><th>Sheet / nhóm</th><th>Chủ đề</th><th>Tổng câu</th><th>Lý thuyết</th><th>Thực hành</th><th>Dễ</th><th>Trung bình</th><th>Khó</th></tr></thead><tbody>{summaryRows.map((row) => <tr key={`${row.group}-${row.category}`}><td><b>{row.group}</b></td><td>{row.category}</td><td className="font-bold">{row.total}</td><td>{row.theory}</td><td>{row.practice}</td><td>{row.easy}</td><td>{row.medium}</td><td>{row.hard}</td></tr>)}</tbody></table></div> : <div className="p-8 text-center text-sm text-slate-500">Chưa có chỉ mục ngân hàng để mô tả.</div>}
    </section>
  </section>;
}
