import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, Plus, Save, Trash2 } from 'lucide-react';
import PublicExamRegistration from './PublicExamRegistration';
import type { CompetitionOption, RegistrationContent, RegistrationField, SessionRegistrationStatus } from './registrationConfig';
import { money, shortDate } from './registrationOffers';

const input = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm';
const card = 'rounded-2xl border border-slate-200 bg-white p-5';
// Khớp FERMAT_REQUIRED_FIELDS ở backend/examination/registration_requirements.py.
const FERMAT_REQUIRED = new Set(['name', 'birthDate', 'identity', 'school', 'grade', 'className', 'email', 'submitterEmail', 'phone', 'city', 'ward', 'address']);
const STATUS_TEXT: Record<SessionRegistrationStatus['status'], string> = { open: 'Đang hiện', 'not-yet': 'Chưa tới thời gian mở', 'missing-deadline': 'Thiếu hạn đăng ký', superseded: 'Kỳ khác cùng mã đang hiện' };
const button = 'inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold disabled:opacity-50';
type TextKey = { [K in keyof RegistrationContent]: RegistrationContent[K] extends string ? K : never }[keyof RegistrationContent];
const textGroups: { title: string; keys: [TextKey, string][] }[] = [
  { title: 'Đầu trang', keys: [['brand', 'Tên đơn vị'], ['academicYear', 'Năm học / nhãn đầu trang'], ['title', 'Tiêu đề'], ['intro', 'Lời giới thiệu']] },
  { title: 'Tiêu đề các phần', keys: [['competitionTitle', 'Chọn cuộc thi'], ['competitionDescription', 'Hướng dẫn chọn cuộc thi'], ['candidateTitle', 'Thông tin thí sinh'], ['candidateDescription', 'Hướng dẫn thông tin thí sinh'], ['contactTitle', 'Liên hệ'], ['contactDescription', 'Hướng dẫn liên hệ'], ['extraTitle', 'Thông tin bổ sung']] },
  { title: 'Thanh toán', keys: [['paymentTitle', 'Tiêu đề thanh toán'], ['paymentDescription', 'Hướng dẫn thanh toán'], ['paymentDeclaration', 'Lời xác nhận chuyển khoản']] },
  { title: 'Xác nhận và kết quả gửi', keys: [['confirmationTitle', 'Tiêu đề xác nhận'], ['consent', 'Lời đồng ý xử lý đăng ký'], ['submitLabel', 'Tên nút gửi'], ['submitNote', 'Ghi chú khi gửi'], ['successTitle', 'Tiêu đề sau khi gửi thành công'], ['successMessage', 'Thông báo sau khi gửi thành công']] },
];

export default function RegistrationPageStudio({ idToken }: { idToken: string }) {
  const [content, setContent] = useState<RegistrationContent | null>(null);
  const [competitions, setCompetitions] = useState<CompetitionOption[]>([]);
  const [sessionStatus, setSessionStatus] = useState<SessionRegistrationStatus[]>([]);
  const [published, setPublished] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState('');
  const [live, setLive] = useState('');
  const headers = { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    let active = true;
    fetch('/api/examination/registration-page', { headers: { Authorization: `Bearer ${idToken}` } }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Không thể tải trang đăng ký.');
      if (active) { setContent(body.content); setSaved(JSON.stringify(body.content)); setLive(JSON.stringify(body.publishedContent)); setCompetitions(body.competitions); setSessionStatus(body.sessionStatus || []); setPublished(body.published); setCanEdit(body.canEdit); }
    }).catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [idToken]);

  const patch = (changes: Partial<RegistrationContent>) => { setContent(current => current ? { ...current, ...changes } : current); setMessage(''); };
  const toggleHidden = (code: string) => { if (content) patch({ hiddenCodes: content.hiddenCodes.includes(code) ? content.hiddenCodes.filter(item => item !== code) : [...content.hiddenCodes, code] }); };
  const updateField = (index: number, changes: Partial<RegistrationField>) => { if (content) patch({ fields: content.fields.map((field, i) => i === index ? { ...field, ...changes } : field) }); };
  const move = (kind: 'fields' | 'blocks', index: number, direction: number) => {
    if (!content) return;
    const rows = [...content[kind]];
    const next = index + direction;
    if (next < 0 || next >= rows.length) return;
    [rows[index], rows[next]] = [rows[next], rows[index]];
    patch({ [kind]: rows });
  };
  const write = async (action: 'save' | 'publish' | 'unpublish') => {
    if (!content || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/examination/registration-page', { method: action === 'save' ? 'PUT' : 'POST', headers, body: JSON.stringify({ content, action }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Không thể lưu trang đăng ký.');
      if (action !== 'unpublish') { setContent(body.content); setSaved(JSON.stringify(body.content)); }
      setLive(JSON.stringify(body.publishedContent)); setPublished(body.published);
      setMessage(action === 'save' ? 'Đã lưu nháp. Bấm Xuất bản để cập nhật trang công khai.' : action === 'publish' ? 'Đã xuất bản trang đăng ký.' : 'Đã tạm đóng trang đăng ký.');
    } catch (cause: any) { setError(cause.message || 'Không thể kết nối máy chủ.'); }
    finally { setBusy(false); }
  };
  if (!content) return <div role="status" className={card}>{error || 'Đang tải trình sửa trang đăng ký…'}</div>;
  const shown = competitions.filter(item => !content.hiddenCodes.includes(item.code));
  if (preview) return <div><div className="sticky top-0 z-10 mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-bold text-amber-900">Xem trước nội dung đang chỉnh · chưa gửi hồ sơ</p><button className={button} onClick={() => setPreview(false)}>Quay lại chỉnh sửa</button></div><PublicExamRegistration previewContent={content} previewCompetitions={shown} /></div>;
  const fermatActive = !['FIMO', 'FIEO'].every(code => content.hiddenCodes.includes(code));
  const requiredForFermat = FERMAT_REQUIRED;
  const dirty = JSON.stringify(content) !== saved;
  const unpublished = JSON.stringify(content) !== live;
  return <div className="space-y-5">
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-extrabold text-[#001e40]">Trang đăng ký dự thi</h1><p className="mt-2 text-sm text-slate-600">Chỉnh nội dung, trường thông tin và các cuộc thi nhận đăng ký. Lưu hồ sơ trước; thanh toán và gửi chứng từ ở bước tiếp theo. FIMO/FIEO giữ đủ các mục bắt buộc theo form gốc.</p><p className="mt-2 text-sm font-semibold text-slate-700">{published ? 'Đang xuất bản' : 'Đang tạm đóng'}{dirty ? ' · Có thay đổi chưa lưu' : ''}{unpublished ? ' · Bản nháp chưa xuất bản' : ''}</p></div><a href="/dang-ky-du-thi" target="_blank" rel="noreferrer" className={button}>Mở trang công khai</a></div>
      <div className="mt-4 flex flex-wrap gap-2"><button onClick={() => setPreview(true)} className={button}><Eye className="h-4 w-4" />Xem trước</button>{canEdit && <><button disabled={busy} onClick={() => void write('save')} className={button}><Save className="h-4 w-4" />Lưu nháp</button><button disabled={busy} onClick={() => void write('publish')} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-50">Xuất bản</button>{published && <button disabled={busy} onClick={() => void write('unpublish')} className={button}>Tạm đóng đăng ký</button>}</>}</div>
      {message && <p role="status" className="mt-4 text-sm font-semibold text-emerald-700">{message}</p>}{error && <p role="alert" className="mt-4 text-sm font-semibold text-rose-700">{error}</p>}{!canEdit && <p className="mt-4 text-sm text-slate-500">Tài khoản quản lý hoặc quản trị viên có thể chỉnh sửa và xuất bản.</p>}
    </section>
    <fieldset disabled={!canEdit || busy} className="space-y-5">
      <section className={card}><h2 className="text-lg font-bold">Cuộc thi trên form</h2><p className="mt-2 text-sm leading-6 text-slate-500">Tự lấy từ Khảo thí: kỳ ở giai đoạn Chuẩn bị/Tuyển sinh tự hiện từ 4 tháng trước hạn đăng ký vòng đầu đến hết hạn. Lệ phí và hạn đăng ký khai ở từng vòng trong kỳ tổ chức (Khảo thí → Kỳ tổ chức → Sửa). Hồ sơ đã lưu giữ lệ phí tại thời điểm đăng ký.</p>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2 pr-3">Cuộc thi · kỳ</th><th className="py-2 pr-3">Vòng đầu · lệ phí</th><th className="py-2 pr-3">Hạn đăng ký</th><th className="py-2 pr-3">Trạng thái</th><th className="py-2" /></tr></thead><tbody className="divide-y divide-slate-100">{sessionStatus.map(row => { const hidden = content.hiddenCodes.includes(row.code); const live = row.status === 'open' && !hidden; return <tr key={row.sessionId} className="align-top">
          <td className="py-3 pr-3"><b>{row.code}</b><span className="block text-xs text-slate-500">{row.sessionName}{row.phase ? ` · ${row.phase}` : ''}</span></td>
          <td className="py-3 pr-3">{row.entryRound || <span className="text-amber-700">Chưa có vòng thi</span>}<span className={`block text-xs font-semibold ${row.fee != null ? 'text-slate-700' : 'text-amber-700'}`}>{row.fee != null ? money(row.fee) : 'Chưa khai báo lệ phí'}</span>{row.laterRounds.length > 0 && <span className="block text-xs text-slate-500">Sau: {row.laterRounds.map(item => `${item.name}${item.fee != null ? ` ${money(item.fee)}` : ''}`).join(' · ')}</span>}</td>
          <td className="py-3 pr-3">{row.deadline ? shortDate(row.deadline) : '—'}{row.deadline && !row.deadlineIsExplicit && <span className="block text-xs text-amber-700">Theo ngày thi, nên khai hạn riêng</span>}</td>
          <td className="py-3 pr-3"><span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${live ? 'bg-emerald-50 text-emerald-700' : row.status === 'open' ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-800'}`}>{hidden && row.status === 'open' ? 'Đang tạm ẩn' : STATUS_TEXT[row.status]}</span>{row.status === 'not-yet' && <span className="block text-xs text-slate-500">Tự mở từ {shortDate(row.opensOn)}</span>}</td>
          <td className="py-3 text-right"><div className="flex justify-end gap-2">{row.status === 'open' && <button type="button" onClick={() => toggleHidden(row.code)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold">{hidden ? 'Hiện lại' : 'Tạm ẩn'}</button>}<a href={`/examination/sessions/${encodeURIComponent(row.sessionId)}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold">Sửa kỳ</a></div></td>
        </tr>; })}</tbody></table>{!sessionStatus.length && <p className="py-4 text-sm text-slate-500">Chưa có kỳ tổ chức nào ở giai đoạn Chuẩn bị/Tuyển sinh.</p>}</div>
        {content.hiddenCodes.length > 0 && <p className="mt-3 text-xs text-slate-500">Tạm ẩn và xuất bản để áp dụng: {content.hiddenCodes.join(', ')}.</p>}
      </section>
      {textGroups.map(group => <section key={group.title} className={card}><h2 className="text-lg font-bold">{group.title}</h2>{group.title === 'Thanh toán' && <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" disabled={fermatActive} checked={content.paymentEnabled} onChange={event => patch({ paymentEnabled: event.target.checked })} />Hiển thị phần thanh toán và tải chứng từ</label>}<div className="mt-4 grid gap-4 sm:grid-cols-2">{group.keys.map(([key, caption]) => <label key={key} className="block text-sm font-semibold text-slate-700"><span className="mb-2 block">{caption}</span><textarea rows={key.toLowerCase().includes('description') || ['intro', 'consent', 'successMessage'].includes(key) ? 3 : 2} value={content[key]} onChange={event => patch({ [key]: event.target.value })} className={input} /></label>)}</div></section>)}
      <section className={card}><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">Khối nội dung trước biểu mẫu</h2><button className={button} onClick={() => patch({ blocks: [...content.blocks, { title: '', body: '' }] })}><Plus className="h-4 w-4" />Thêm nội dung</button></div><div className="mt-4 space-y-4">{content.blocks.map((block, index) => <div key={index} className="rounded-xl border border-slate-200 p-4"><div className="mb-3 flex justify-end gap-2"><button aria-label="Đưa nội dung lên" disabled={index === 0} onClick={() => move('blocks', index, -1)}><ArrowUp className="h-4 w-4" /></button><button aria-label="Đưa nội dung xuống" disabled={index === content.blocks.length - 1} onClick={() => move('blocks', index, 1)}><ArrowDown className="h-4 w-4" /></button><button aria-label="Xóa khối nội dung" onClick={() => patch({ blocks: content.blocks.filter((_, i) => i !== index) })}><Trash2 className="h-4 w-4 text-rose-600" /></button></div><label className="block text-sm">Tiêu đề<input className={`${input} mt-2`} value={block.title} onChange={event => patch({ blocks: content.blocks.map((row, i) => i === index ? { ...row, title: event.target.value } : row) })} /></label><label className="mt-3 block text-sm">Nội dung<textarea className={`${input} mt-2`} rows={4} value={block.body} onChange={event => patch({ blocks: content.blocks.map((row, i) => i === index ? { ...row, body: event.target.value } : row) })} /></label></div>)}</div></section>
      <section className={card}><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">Trường thông tin của biểu mẫu</h2><button className={button} onClick={() => patch({ fields: [...content.fields, { key: `custom_${crypto.randomUUID()}`, label: 'Thông tin bổ sung', type: 'text', enabled: true, required: false, section: 'extra', options: [] }] })}><Plus className="h-4 w-4" />Thêm trường</button></div><p className="mt-2 text-sm text-slate-500">FIMO/FIEO giữ đủ các mục bắt buộc theo form gốc; yêu cầu cụ thể được áp dụng khi người dùng chọn cuộc thi. Bỏ “Hiển thị” để ẩn các trường khác. Họ tên là thông tin bắt buộc để tạo hồ sơ thí sinh.</p><div className="mt-4 space-y-3">{content.fields.map((field, index) => <div key={field.key} className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Nhãn hiển thị<input className={`${input} mt-2`} value={field.label} onChange={event => updateField(index, { label: event.target.value })} /></label><label className="text-sm">Loại thông tin<select className={`${input} mt-2`} value={field.type} disabled={!field.key.startsWith('custom_')} onChange={event => updateField(index, { type: event.target.value as RegistrationField['type'] })}><option value="text">Văn bản ngắn</option><option value="textarea">Văn bản dài</option><option value="email">Email</option><option value="tel">Điện thoại</option><option value="date">Ngày tháng</option><option value="select">Danh sách lựa chọn</option></select></label>{field.type === 'select' && field.key.startsWith('custom_') && <label className="text-sm sm:col-span-2">Các lựa chọn (mỗi dòng một lựa chọn)<textarea rows={3} className={`${input} mt-2`} value={field.options.join('\n')} onChange={event => updateField(index, { options: event.target.value.split('\n') })} /></label>}</div><div className="mt-4 flex flex-wrap items-center gap-4 text-sm"><label className="flex gap-2"><input type="checkbox" disabled={field.key === 'name' || fermatActive && requiredForFermat.has(field.key)} checked={field.enabled} onChange={event => updateField(index, { enabled: event.target.checked })} />Hiển thị</label><label className="flex gap-2"><input type="checkbox" disabled={field.key === 'name'} checked={field.required} onChange={event => updateField(index, { required: event.target.checked })} />Bắt buộc</label><div className="ml-auto flex gap-3"><button aria-label="Đưa trường lên" disabled={index === 0} onClick={() => move('fields', index, -1)}><ArrowUp className="h-4 w-4" /></button><button aria-label="Đưa trường xuống" disabled={index === content.fields.length - 1} onClick={() => move('fields', index, 1)}><ArrowDown className="h-4 w-4" /></button>{field.key.startsWith('custom_') && <button aria-label="Xóa trường" onClick={() => patch({ fields: content.fields.filter((_, i) => i !== index) })}><Trash2 className="h-4 w-4 text-rose-600" /></button>}</div></div></div>)}</div></section>
    </fieldset>
  </div>;
}
