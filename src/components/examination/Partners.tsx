import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { ArrowLeft, Download, Pencil, Plus, Search, Trash2, Users, X } from 'lucide-react';
import LogNotes, { appendLogNote, formatChangeLog } from './LogNotes';
import ConfirmModal from '../ConfirmModal';
import SearchableSelect from '../SearchableSelect';
import { LIST_PAGE_SIZE, TablePagination } from './ui';
import { matchesSearch } from '../../lib/searchText';
import { todayVN } from '../../lib/vnDate';

export type PartnerStudentCount = { session: string; count: number };
export type Partner = {
  id: string;
  province: string;
  ward: string;
  school: string;
  level: string;
  representative: string;
  phone: string;
  email: string;
  contests: string[];
  studentCounts: PartnerStudentCount[];
};

export const demoPartners: Partner[] = [];

type Props = { partners: Partner[]; onPartnersChange: (partners: Partner[]) => void; actor?: string | null; idToken?: string | null; canManage: boolean; canDelete: boolean; selectedPartnerId?: string; onSelectPartner?: (partnerId: string) => void; onBackToList?: () => void; };
type EditorMode = 'create' | 'edit' | null;
const input = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2';
const emptyPartner = (): Partner => ({ id: `partner-${Date.now()}`, province: '', ward: '', school: '', level: 'THCS', representative: '', phone: '', email: '', contests: [], studentCounts: [] });
const contestText = (partner: Partner) => partner.contests.join(', ');
const countsText = (partner: Partner) => partner.studentCounts.map(item => `${item.session}: ${item.count}`).join(', ');
const totalStudentCount = (partner: Partner) => partner.studentCounts.reduce((sum, item) => sum + item.count, 0);
const parseContests = (value: string) => [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
const parseCounts = (value: string) => value.split(',').map(item => { const [session = '', amount = '0'] = item.split(':'); return { session: session.trim(), count: Math.max(0, Number.parseInt(amount.trim(), 10) || 0) }; }).filter(item => item.session);

export default function Partners({ partners, onPartnersChange, actor, idToken, canManage, canDelete, selectedPartnerId, onSelectPartner, onBackToList }: Props) {
  const [query, setQuery] = useState(''); const [partnerPage, setPartnerPage] = useState(1); const [partnerFilters, setPartnerFilters] = useState({ province: [] as string[], school: [] as string[], level: [] as string[] }); const [selectedId, setSelectedId] = useState<string | null>(null); const [selectedPartnerIds, setSelectedPartnerIds] = useState<string[]>([]); const [editor, setEditor] = useState<EditorMode>(null); const [draft, setDraft] = useState<Partner>(emptyPartner()); const [draftContests, setDraftContests] = useState(''); const [draftCounts, setDraftCounts] = useState(''); const [deleteTarget, setDeleteTarget] = useState<Partner | null>(null); const [error, setError] = useState('');
  useEffect(() => setSelectedId(selectedPartnerId || null), [selectedPartnerId]);
  const selectPartner = (partnerId: string) => { setSelectedId(partnerId); onSelectPartner?.(partnerId); };
  const closeDetail = () => { setSelectedId(null); onBackToList?.(); };
  const selected = partners.find(item => item.id === selectedId) || null;
  const partnerFilterOptions = useMemo(() => {
    const optionsFor = (field: 'province' | 'school' | 'level') => [...new Set(partners.map(item => item[field]).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'vi-VN'))
      .map(value => ({ value, label: value }));
    return { province: optionsFor('province'), school: optionsFor('school'), level: optionsFor('level') };
  }, [partners]);
  const filtered = useMemo(() => partners.filter(item => {
    const haystack = `${item.province} ${item.ward} ${item.school} ${item.level} ${item.representative} ${item.phone} ${item.email} ${item.contests.join(' ')}`;
    return matchesSearch(haystack, query)
      && (!partnerFilters.province.length || partnerFilters.province.includes(item.province))
      && (!partnerFilters.school.length || partnerFilters.school.includes(item.school))
      && (!partnerFilters.level.length || partnerFilters.level.includes(item.level));
  }), [partners, query, partnerFilters]);
  const partnerPageCount = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  const activePartnerPage = Math.min(partnerPage, partnerPageCount);
  const visiblePartners = filtered.slice((activePartnerPage - 1) * LIST_PAGE_SIZE, activePartnerPage * LIST_PAGE_SIZE);
  useEffect(() => setPartnerPage(1), [query, partnerFilters]);
  const totalStudents = selected ? totalStudentCount(selected) : 0;
  const selectedFilteredPartners = filtered.filter((partner) => selectedPartnerIds.includes(partner.id));
  const partnersForExport = selectedFilteredPartners.length ? selectedFilteredPartners : filtered;
  const togglePartnerSelection = (partnerId: string) => {
    setSelectedPartnerIds((current) => current.includes(partnerId) ? current.filter((id) => id !== partnerId) : [...current, partnerId]);
  };
  const toggleAllFilteredPartners = () => {
    const filteredIds = visiblePartners.map((partner) => partner.id);
    const areAllSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedPartnerIds.includes(id));
    setSelectedPartnerIds((current) => areAllSelected ? current.filter((id) => !filteredIds.includes(id)) : [...new Set([...current, ...filteredIds])]);
  };
  const exportPartnerList = () => {
    if (!partnersForExport.length) return;
    const rows = partnersForExport.map((partner, index) => ({
      'STT': index + 1,
      'Tỉnh / Thành phố': partner.province,
      'Phường / Xã': partner.ward,
      'Trường': partner.school,
      'Cấp học': partner.level,
      'Đại diện': partner.representative,
      'SĐT liên lạc': partner.phone,
      'Email liên lạc': partner.email,
      'Các cuộc thi đã từng tham gia': contestText(partner),
      'Tổng lượt thí sinh đã cộng tác': totalStudentCount(partner),
      'Chi tiết lượt thí sinh theo kỳ': countsText(partner),
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 10, r: rows.length } }) };
    worksheet['!cols'] = [{ wch: 8 }, { wch: 18 }, { wch: 18 }, { wch: 32 }, { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 30 }, { wch: 30 }, { wch: 24 }, { wch: 36 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Danh sách đối tác');
    XLSX.writeFile(workbook, `danh_sach_doi_tac_${todayVN()}.xlsx`);
  };
  const openCreate = () => { setDraft(emptyPartner()); setDraftContests(''); setDraftCounts(''); setError(''); setEditor('create'); };
  const openEdit = () => { if (!selected) return; setDraft({ ...selected, contests: [...selected.contests], studentCounts: [...selected.studentCounts] }); setDraftContests(contestText(selected)); setDraftCounts(countsText(selected)); setError(''); setEditor('edit'); };
  const save = () => { const next = { ...draft, school: draft.school.trim(), representative: draft.representative.trim(), email: draft.email.trim().toLowerCase(), contests: parseContests(draftContests), studentCounts: parseCounts(draftCounts) }; if (!next.school || !next.representative || !next.phone.trim() || !next.email) { setError('Vui lòng nhập trường, đại diện, số điện thoại và email.'); return; } if (editor === 'create') { onPartnersChange([...partners, next]); appendLogNote(`partner-${next.id}`, 'Tạo hồ sơ đối tác mới.', actor || 'Nhân viên FT Workspace', false, idToken); selectPartner(next.id); } else { onPartnersChange(partners.map(item => item.id === next.id ? next : item)); appendLogNote(`partner-${next.id}`, formatChangeLog('Cập nhật thông tin đối tác', selected, next), actor || 'Nhân viên FT Workspace', false, idToken); } setEditor(null); };
  const remove = () => { if (!deleteTarget) return; onPartnersChange(partners.filter(item => item.id !== deleteTarget.id)); appendLogNote(`partner-${deleteTarget.id}`, 'Xóa hồ sơ đối tác.', actor || 'Quản trị viên', false, idToken); if (selectedId === deleteTarget.id) closeDetail(); setDeleteTarget(null); };
  const form = <div className="grid gap-4 sm:grid-cols-2">{([['province', 'Tỉnh / Thành phố'], ['ward', 'Phường / Xã'], ['school', 'Trường *'], ['level', 'Cấp học'], ['representative', 'Đại diện *'], ['phone', 'SĐT liên lạc *'], ['email', 'Email liên lạc *']] as [keyof Partner, string][]).map(([field, label]) => <label key={field} className={field === 'school' ? 'sm:col-span-2' : ''}><span className="text-sm font-bold">{label}</span>{field === 'level' ? <select value={String(draft[field])} onChange={event => setDraft({ ...draft, [field]: event.target.value })} className={input}><option>Tiểu học</option><option>THCS</option><option>THPT</option><option>Liên cấp</option></select> : <input type={field === 'email' ? 'email' : 'text'} value={String(draft[field])} onChange={event => setDraft({ ...draft, [field]: event.target.value })} className={input}/>}</label>)}<label className="sm:col-span-2"><span className="text-sm font-bold">Các cuộc thi đã từng tham gia</span><input value={draftContests} onChange={event => setDraftContests(event.target.value)} className={input} placeholder="AYSBC, IMO, IEO"/></label><label className="sm:col-span-2"><span className="text-sm font-bold">Số học sinh cộng tác theo kỳ thi</span><input value={draftCounts} onChange={event => setDraftCounts(event.target.value)} className={input} placeholder="AYSBC: 18, IMO: 11"/><small className="mt-1 block text-slate-500">Nhập mỗi kỳ theo dạng mã kỳ: số lượng, ngăn cách bằng dấu phẩy.</small></label></div>;
  const editorModal = editor && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4"><div className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-2xl font-extrabold text-[#101827]">{editor === 'create' ? 'Thêm đối tác' : 'Thay đổi thông tin đối tác'}</h2><p className="mt-1 text-sm text-slate-600">Theo dõi đại diện trường và hiệu quả tuyển sinh theo từng kỳ thi.</p></div><button onClick={() => setEditor(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5"/></button></div><div className="mt-5">{form}</div>{error && <p className="mt-4 text-sm font-semibold text-rose-600">{error}</p>}<div className="mt-6 flex justify-end gap-3"><button onClick={() => setEditor(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">Hủy</button><button onClick={save} className="ft-primary">Lưu thông tin</button></div></div></div>;
  const list = <><div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><div className="mb-2 flex items-center gap-2 text-sm text-slate-500"><span>Khảo thí</span><span>/</span><b>Đối tác</b></div><h1 className="text-3xl font-extrabold text-[#101827]">Đối tác</h1><p className="mt-1 text-sm text-slate-600">Theo dõi đại diện trường và hiệu quả tuyển sinh qua từng kỳ thi.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={exportPartnerList} disabled={!partnersForExport.length} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#001e40] shadow-sm disabled:cursor-not-allowed disabled:opacity-50"><Download className="h-4 w-4"/>{selectedFilteredPartners.length ? `Xuất ${selectedFilteredPartners.length} đã chọn` : `Xuất theo bộ lọc (${filtered.length})`}</button><button disabled={!canManage} onClick={openCreate} className="ft-primary disabled:opacity-50"><Plus className="h-4 w-4"/>Thêm đối tác</button></div></div><section className="ft-surface overflow-visible"><div className="border-b p-4"><div className="grid gap-3 xl:grid-cols-[minmax(280px,1.6fr)_repeat(3,minmax(180px,1fr))]"><label className="ft-input-wrap"><Search className="h-5 w-5"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm tỉnh/thành, trường, đại diện, email..."/></label>{([['province', 'Tỉnh / Thành phố'], ['school', 'Trường'], ['level', 'Cấp học']] as const).map(([key, label]) => <label key={key}><span className="mb-1 block text-xs font-bold text-slate-500">{label}</span><SearchableSelect multiple value={partnerFilters[key]} onChange={value => setPartnerFilters(current => ({ ...current, [key]: value }))} options={partnerFilterOptions[key]} placeholder={`Tất cả ${label.toLocaleLowerCase('vi-VN')}`} searchPlaceholder={`Tìm ${label.toLocaleLowerCase('vi-VN')}...`}/></label>)}</div></div><div className="overflow-x-auto"><table className="ft-table min-w-[1580px]"><colgroup><col className="w-14"/><col className="w-16"/><col className="w-40"/><col className="w-44"/><col className="w-80"/><col className="w-28"/><col className="w-52"/><col className="w-40"/><col className="w-72"/><col className="w-48"/><col className="w-64"/></colgroup><thead><tr><th><input type="checkbox" aria-label="Chọn tất cả đối tác đang hiển thị" checked={visiblePartners.length > 0 && visiblePartners.every((partner) => selectedPartnerIds.includes(partner.id))} onChange={toggleAllFilteredPartners} /></th><th>STT</th><th>Tỉnh / Thành phố</th><th>Phường / Xã</th><th>Trường</th><th>Cấp học</th><th>Đại diện</th><th>SĐT liên lạc</th><th>Email liên lạc</th><th>Tổng lượt thí sinh đã cộng tác</th><th>Các cuộc thi đã từng tham gia</th></tr></thead><tbody>{visiblePartners.map((partner, index) => <tr key={partner.id} onClick={() => selectPartner(partner.id)} className="cursor-pointer hover:bg-blue-50/50"><td onClick={event => event.stopPropagation()}><input type="checkbox" aria-label={`Chọn ${partner.school || partner.representative || 'đối tác'}`} checked={selectedPartnerIds.includes(partner.id)} onChange={() => togglePartnerSelection(partner.id)} /></td><td>{(activePartnerPage - 1) * LIST_PAGE_SIZE + index + 1}</td><td>{partner.province || '—'}</td><td>{partner.ward || '—'}</td><td><b className="text-[#001e40]">{partner.school || '—'}</b></td><td>{partner.level || '—'}</td><td>{partner.representative || '—'}</td><td>{partner.phone || '—'}</td><td>{partner.email || '—'}</td><td className="text-right font-semibold tabular-nums">{totalStudentCount(partner).toLocaleString('vi-VN')}</td><td>{contestText(partner) || '—'}</td></tr>)}{!filtered.length && <tr><td colSpan={11} className="py-10 text-center text-slate-500">Không tìm thấy đối tác phù hợp.</td></tr>}</tbody></table></div><TablePagination total={filtered.length} page={activePartnerPage} onPageChange={setPartnerPage} label="đối tác"/></section></>;
  const detail = selected && <><button onClick={closeDetail} className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft className="h-4 w-4"/>Quay lại danh sách đối tác</button><section className="ft-surface"><p className="text-sm font-bold text-[#aa3000]">ĐỐI TÁC TUYỂN SINH</p><div className="mt-1 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-extrabold text-[#101827]">{selected.school}</h1><p className="mt-2 text-sm text-slate-600">Đại diện: {selected.representative}</p></div><div className="flex flex-wrap gap-2"><button disabled={!canManage} onClick={openEdit} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#001e40] disabled:opacity-50"><Pencil className="h-4 w-4"/>Thay đổi thông tin</button>{canDelete && <button onClick={() => setDeleteTarget(selected)} className="inline-flex items-center gap-2 rounded-lg border border-rose-300 px-4 py-2 text-sm font-bold text-rose-700"><Trash2 className="h-4 w-4"/>Xóa đối tác</button>}</div></div><div className="mt-6 grid gap-5 border-t pt-6 sm:grid-cols-2 lg:grid-cols-3">{([['Tỉnh / Thành phố', selected.province], ['Phường / Xã', selected.ward], ['Cấp học', selected.level], ['Đại diện', selected.representative], ['SĐT liên lạc', selected.phone], ['Email liên lạc', selected.email]] as [string, string][]).map(([label, value]) => <div key={label}><p className="text-xs font-bold uppercase text-slate-500">{label}</p><p className="mt-2 font-semibold text-[#001e40]">{value || '—'}</p></div>)}</div></section><section className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]"><div className="ft-surface"><p className="text-xs font-bold uppercase text-slate-500">Tổng số học sinh cộng tác</p><p className="mt-3 flex items-center gap-3 text-4xl font-extrabold text-[#001e40]"><Users className="h-8 w-8 text-[#aa3000]"/>{totalStudents.toLocaleString('vi-VN')}</p><p className="mt-2 text-sm text-slate-500">Tổng hợp từ {selected.studentCounts.length} kỳ thi.</p></div><div className="ft-surface overflow-hidden"><div className="mb-4"><h2 className="text-xl font-bold text-[#001e40]">Số lượng học sinh cộng tác ở các kỳ thi</h2><p className="mt-1 text-sm text-slate-500">Số học sinh do đại diện trường hỗ trợ tuyển sinh.</p></div><table className="ft-table"><thead><tr><th>Kỳ thi</th><th className="text-right">Số học sinh</th></tr></thead><tbody>{selected.studentCounts.length ? selected.studentCounts.map(item => <tr key={item.session}><td><b>{item.session}</b></td><td className="text-right font-bold text-[#001e40]">{item.count.toLocaleString('vi-VN')}</td></tr>) : <tr><td colSpan={2} className="py-8 text-center text-slate-500">Chưa có dữ liệu cộng tác.</td></tr>}</tbody></table></div></section><section className="mt-6 ft-surface"><h2 className="text-xl font-bold text-[#001e40]">Các cuộc thi đã từng tham gia</h2><div className="mt-4 flex flex-wrap gap-2">{selected.contests.length ? selected.contests.map(contest => <span key={contest} className="rounded-full bg-blue-50 px-3 py-1.5 text-sm font-bold text-[#001e40]">{contest}</span>) : <span className="text-slate-500">Chưa có thông tin.</span>}</div></section><LogNotes entityKey={`partner-${selected.id}`} actor={actor} canWrite={canManage} idToken={idToken}/></>;
  return <>{selected ? detail : list}{editorModal}<ConfirmModal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={remove} title="Xóa đối tác" message={`Bạn có chắc muốn xóa hồ sơ đối tác ${deleteTarget?.school || ''}? Thao tác này không thể hoàn tác.`} confirmText="Xóa đối tác" type="danger"/></>;
}
