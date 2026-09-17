import React, { useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, Eye, EyeOff, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { createEmailBlock } from '../../data/emailBlockRegistry';
import { copyEmailToClipboard } from '../../lib/emailClipboard';
import { generateEmailHtml } from '../../lib/emailHtmlGenerator';
import { EmailTemplate } from '../../types/emailBuilder';

interface SignatureBuilderProps {
  onBack: () => void;
  userName?: string;
  userEmail?: string;
  jobTitle?: string;
}

type CustomField = { id: string; label: string; value: string; url: string; visible: boolean };

const fieldClass = 'mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100';
const labelClass = 'block text-[10px] font-extrabold uppercase tracking-wide text-slate-500';
const visibilityFields: Array<[string, string]> = [
  ['Chức vụ', 'showJobTitle'], ['Công ty', 'showCompany'], ['Điện thoại', 'showPhone'],
  ['Email chính', 'showEmail'], ['Email phụ', 'showSecondaryEmail'], ['Website', 'showWebsite'], ['Địa chỉ', 'showAddress'],
];
const socialFields: Array<[string, string, string]> = [
  ['Facebook', 'showFacebook', 'facebookUrl'], ['Zalo', 'showZalo', 'zaloUrl'],
  ['LinkedIn', 'showLinkedIn', 'linkedInUrl'], ['YouTube', 'showYoutube', 'youtubeUrl'],
  ['Instagram', 'showInstagram', 'instagramUrl'], ['Kênh khác', 'showOther', 'otherUrl'],
];

export default function SignatureBuilder({ onBack, userName, userEmail, jobTitle }: SignatureBuilderProps) {
  const defaultContent = useMemo<Record<string, any>>(() => ({
    ...createEmailBlock('signature-builder', 'signature-studio').content,
    fullName: userName || 'HỌ VÀ TÊN', email: userEmail || '', jobTitle: jobTitle || 'Chức vụ',
  }), [jobTitle, userEmail, userName]);
  const [content, setContent] = useState(defaultContent);
  const [copied, setCopied] = useState(false);
  const update = (key: string, value: unknown) => setContent(current => ({ ...current, [key]: value }));
  const customFields = (Array.isArray(content.customFields) ? content.customFields : []) as CustomField[];
  const updateCustomField = (id: string, patch: Partial<CustomField>) => update('customFields', customFields.map(field => field.id === id ? { ...field, ...patch } : field));
  const addCustomField = () => update('customFields', [...customFields, { id: `field-${Date.now()}`, label: 'Tiêu đề tùy ý', value: '', url: '', visible: true }]);
  const template = useMemo<EmailTemplate>(() => ({
    id: 'signature-studio', name: 'Chữ ký email', subject: '', lastUpdated: Date.now(),
    blocks: [{ id: 'signature-studio', type: 'signature-builder', content, styles: { marginTop: 0, marginBottom: 0 }, visible: true }],
    settings: { maxWidth: 900, externalBg: '#eef3f9', contentBg: '#ffffff', fontFamily: 'Arial, sans-serif', textColor: '#28323D', contentPadding: 24, borderRadius: 12, linkColor: '#1473D1', btnDefaultBg: '#1473D1', btnDefaultTextColor: '#ffffff' },
  }), [content]);
  const output = useMemo(() => generateEmailHtml(template, []), [template]);
  const copySignature = async () => {
    const ok = await copyEmailToClipboard(output.copyHtml, output.plainText, Number(content.width) || 650);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const toggle = (label: string, key: string) => <button key={key} type="button" onClick={() => update(key, content[key] === false)} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-bold transition ${content[key] !== false ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-400'}`}>{content[key] !== false ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}{label}</button>;

  return <div className="signature-builder-canvas min-h-screen bg-[#eef3f9] font-sans text-slate-800">
    <header className="sticky top-0 z-20 border-b border-blue-900/10 bg-gradient-to-r from-[#104581] to-[#1473D1] px-4 py-4 text-white shadow-sm sm:px-7">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <div className="flex items-center gap-3"><button type="button" onClick={onBack} className="rounded-xl p-2 text-blue-100 hover:bg-white/10" title="Quay lại Bộ công cụ FermatTech"><ArrowLeft className="h-5 w-5" /></button><div><h1 className="text-lg font-black sm:text-2xl">Bộ chữ ký email FermatTech</h1><p className="mt-0.5 hidden text-xs text-blue-100 sm:block">Chọn thành phần muốn hiện, chỉnh nội dung rồi sao chép vào Gmail hoặc Outlook.</p></div></div>
        <div className="flex items-center gap-2"><button type="button" onClick={() => setContent(defaultContent)} className="hidden items-center gap-1.5 rounded-xl border border-white/25 px-3 py-2 text-xs font-bold hover:bg-white/10 sm:inline-flex"><RotateCcw className="h-3.5 w-3.5" />Khôi phục</button><button type="button" onClick={() => void copySignature()} className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-black text-[#1465b5] shadow hover:bg-blue-50">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Đã sao chép' : 'Copy chữ ký'}</button></div>
      </div>
    </header>

    <main className="mx-auto grid max-w-7xl gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_390px] lg:p-7">
      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-black text-[#104581]">Xem trước chữ ký</h2><p className="mt-1 text-xs text-slate-500">Bản HTML email-safe, giữ bố cục khi dán vào trình soạn thư.</p></div><span className="rounded-full bg-blue-50 px-3 py-1.5 text-[10px] font-black text-blue-700">{content.width || 650}px</span></div>
        <div className="overflow-hidden rounded-2xl border border-dashed border-blue-200 bg-slate-50"><iframe title="Xem trước chữ ký" sandbox="" srcDoc={output.previewHtml} className="h-[460px] w-full border-0 bg-slate-50" /></div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-5"><h2 className="text-base font-black text-[#104581]">Panel sửa nội dung</h2><p className="mt-1 text-xs leading-5 text-slate-500">Có thể ẩn trường không dùng hoặc thêm tiêu đề riêng.</p></div>
        <div className="space-y-5">
          <div><p className={labelClass}>Thành phần hiển thị</p><div className="mt-2 flex flex-wrap gap-2">{visibilityFields.map(([label, key]) => toggle(label, key))}</div></div>
          <div><label className={labelClass}>URL logo</label><input className={fieldClass} value={content.logoUrl || ''} onChange={event => update('logoUrl', event.target.value)} placeholder="https://..." /></div>
          <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>Họ và tên</label><input className={fieldClass} value={content.fullName || ''} onChange={event => update('fullName', event.target.value)} /></div><div><label className={labelClass}>Chức vụ</label><input className={fieldClass} value={content.jobTitle || ''} onChange={event => update('jobTitle', event.target.value)} /></div></div>
          <div><label className={labelClass}>Tên công ty</label><input className={fieldClass} value={content.company || ''} onChange={event => update('company', event.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3"><div><label className={labelClass}>Số điện thoại</label><input className={fieldClass} value={content.phone || ''} onChange={event => update('phone', event.target.value)} /></div><div><label className={labelClass}>Email chính</label><input className={fieldClass} value={content.email || ''} onChange={event => update('email', event.target.value)} /></div><div><label className={labelClass}>Email phụ</label><input className={fieldClass} value={content.secondaryEmail || ''} onChange={event => update('secondaryEmail', event.target.value)} /></div><div><label className={labelClass}>Website</label><input className={fieldClass} value={content.website || ''} onChange={event => update('website', event.target.value)} /></div></div>
          <div><label className={labelClass}>Địa chỉ</label><textarea rows={2} className={fieldClass} value={content.address || ''} onChange={event => update('address', event.target.value)} /></div>

          <div className="border-t border-slate-100 pt-4"><p className={labelClass}>Mạng xã hội & liên kết</p><div className="mt-3 space-y-2.5">{socialFields.map(([label, visibleKey, urlKey]) => <div key={visibleKey} className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2"><label className="flex items-center gap-1.5 text-xs font-bold text-slate-700"><input type="checkbox" checked={content[visibleKey] !== false} onChange={event => update(visibleKey, event.target.checked)} />{label}</label><input className={fieldClass} value={content[urlKey] || ''} onChange={event => update(urlKey, event.target.value)} placeholder={label === 'Zalo' ? 'Số điện thoại hoặc URL Zalo' : 'https://...'} /></div>)}</div><div className="mt-3"><label className={labelClass}>Nhãn kênh khác</label><input className={fieldClass} value={content.otherLabel || ''} onChange={event => update('otherLabel', event.target.value)} /></div></div>

          <div className="border-t border-slate-100 pt-4"><div className="flex items-center justify-between"><div><p className={labelClass}>Trường tùy ý</p><p className="mt-1 text-[10px] text-slate-400">Ví dụ: Hotline tuyển dụng, Đặt lịch, Mã nhân viên.</p></div><button type="button" onClick={addCustomField} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 px-2.5 py-1.5 text-[10px] font-black text-blue-700 hover:bg-blue-50"><Plus className="h-3 w-3" />Thêm</button></div><div className="mt-3 space-y-3">{customFields.map(field => <div key={field.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="grid grid-cols-[1fr_1fr_auto] gap-2"><input className={fieldClass} value={field.label} onChange={event => updateCustomField(field.id, { label: event.target.value })} placeholder="Tiêu đề" /><input className={fieldClass} value={field.value} onChange={event => updateCustomField(field.id, { value: event.target.value })} placeholder="Nội dung" /><button type="button" onClick={() => update('customFields', customFields.filter(item => item.id !== field.id))} className="mt-1 rounded-lg p-2 text-rose-500 hover:bg-rose-50" title="Xóa trường"><Trash2 className="h-4 w-4" /></button></div><div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-2"><label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600"><input type="checkbox" checked={field.visible} onChange={event => updateCustomField(field.id, { visible: event.target.checked })} />Hiện</label><input className={fieldClass} value={field.url} onChange={event => updateCustomField(field.id, { url: event.target.value })} placeholder="Liên kết khi bấm (không bắt buộc)" /></div></div>)}</div></div>

          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4"><div><label className={labelClass}>Rộng chữ ký</label><input type="number" min="320" max="900" className={fieldClass} value={content.width ?? 650} onChange={event => update('width', Number(event.target.value))} /></div><div><label className={labelClass}>Rộng logo</label><input type="number" min="48" max="320" className={fieldClass} value={content.logoWidth ?? 150} onChange={event => update('logoWidth', Number(event.target.value))} /></div><div><label className={labelClass}>Màu nhấn</label><input type="color" className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white p-1" value={content.accentColor || '#1473D1'} onChange={event => update('accentColor', event.target.value)} /></div><div><label className={labelClass}>Màu chữ</label><input type="color" className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white p-1" value={content.textColor || '#28323D'} onChange={event => update('textColor', event.target.value)} /></div></div>
        </div>
      </section>
    </main>
  </div>;
}
