import React, { useRef, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, RefreshCw, School, UploadCloud, UserRound } from 'lucide-react';
import type { Candidate, ExaminationSession } from './types';
import type { Partner } from './Partners';
import SchoolImportDialog from './SchoolImportDialog';

type Props = {
  idToken?: string | null;
  googleAccessToken?: string | null;
  canImport: boolean;
  sessionId?: string;
  sessions: ExaminationSession[];
  onImported: (items: Candidate[]) => void;
  onPartnersImported?: (partners: Partner[]) => void;
  onSessionsImported?: (sessions: ExaminationSession[]) => void;
};

const TEMPLATE_URL = '/templates/Mau_dang_ky_theo_truong.xlsx';
const NOTES: [typeof School, string, string][] = [
  [UserRound, 'Đăng ký cá nhân', 'Nhận từ Form đăng ký, tự vào kỳ thi và khoản đối soát. Không cần nhập tay.'],
  [RefreshCw, 'Sheet khảo thí', 'Web ghi thẳng ra Sheet. Sửa tay trên Sheet sẽ tự cập nhật về web; dòng chưa ghép chắc chắn được ghi vào nhật ký kỳ.'],
  [FileSpreadsheet, 'File của trường', 'Dùng mẫu Phụ lục 4: thông tin trường ở đầu, mỗi học sinh một dòng, cột “Cuộc thi đăng ký” ghi FIMO, FIEO hoặc FIMO & FIEO.'],
];

// Individual registrations arrive through the public Form and the examination
// Sheets sync on their own; the only manual import left is a school's Excel.
export default function ImportData({ idToken, canImport, sessions, onImported, onPartnersImported, onSessionsImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dialogFile, setDialogFile] = useState<File | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState('');

  const open = (file: File | null) => {
    if (!canImport) return;
    if (file && !file.name.toLowerCase().endsWith('.xlsx')) { setMessage('Chỉ nhận file Excel .xlsx theo mẫu đăng ký của trường.'); return; }
    setMessage(''); setDialogFile(file); setDialogOpen(true);
  };
  const close = () => { setDialogOpen(false); setDialogFile(null); if (inputRef.current) inputRef.current.value = ''; };

  return <>
    <div className="mb-6">
      <h1 className="text-3xl font-extrabold text-[#101827]">Nhập dữ liệu</h1>
      <p className="mt-1 text-sm text-slate-600">Nhập danh sách đăng ký do trường học gửi. Thí sinh cá nhân và dữ liệu trên Sheet khảo thí được đồng bộ tự động.</p>
    </div>

    {!canImport && <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Chỉ quản lý hoặc quản trị viên mới có thể nhập dữ liệu.</div>}

    <section
      onDragOver={event => { event.preventDefault(); if (canImport) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); open(event.dataTransfer.files?.[0] || null); }}
      className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${dragging ? 'border-emerald-500 bg-emerald-50' : 'border-emerald-200 bg-white'}`}
    >
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><School className="h-7 w-7" /></span>
      <h2 className="mt-4 text-xl font-extrabold text-[#001e40]">Nhập Excel đăng ký của trường</h2>
      <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-600">Một file cho nhiều học sinh và nhiều cuộc thi (ví dụ FIMO &amp; FIEO). Hệ thống đọc thông tin trường, ghép hồ sơ đã có, chia lệ phí theo cuộc thi và gom đối soát theo trường. Chưa ghi gì cho đến khi bạn xác nhận.</p>
      <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={event => open(event.target.files?.[0] || null)} />
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" disabled={!canImport} onClick={() => inputRef.current?.click()} className="ft-primary disabled:opacity-50"><UploadCloud className="h-4 w-4" />Chọn file Excel</button>
        <a href={TEMPLATE_URL} download className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#001e40] hover:bg-slate-50"><Download className="h-4 w-4" />Tải file mẫu</a>
      </div>
      <p className="mt-3 text-xs text-slate-500">Hoặc kéo thả file .xlsx vào khung này.</p>
    </section>

    {message && <p role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-[#001e40]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />{message}</p>}

    <div className="mt-5 grid gap-3 md:grid-cols-3">
      {NOTES.map(([Icon, title, body]) => <div key={title} className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="flex items-center gap-2 text-sm font-extrabold text-[#001e40]"><Icon className="h-4 w-4 text-emerald-700" />{title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">{body}</p>
      </div>)}
    </div>

    {dialogOpen && <SchoolImportDialog
      idToken={idToken}
      sessions={sessions}
      initialFile={dialogFile}
      onClose={close}
      onImported={result => {
        onImported(result.items);
        onPartnersImported?.(result.partners);
        onSessionsImported?.(result.sessions);
        setMessage(`Đã nhập ${result.summary.candidates} học sinh · ${result.summary.newRegistrations} lượt đăng ký bổ sung. Báo cáo chi tiết đã ghi vào nhật ký từng kỳ.`);
      }}
    />}
  </>;
}
