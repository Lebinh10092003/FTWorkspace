import { useState } from 'react';
import { X, Monitor, Smartphone, AlertTriangle } from 'lucide-react';
import { EmailTemplate, EmailVariable } from '../../types/emailBuilder';
import { generateEmailHtml } from '../../lib/emailHtmlGenerator';

interface EmailPreviewProps {
  template: EmailTemplate;
  variables: EmailVariable[];
  onClose: () => void;
}

export default function EmailPreview({
  template,
  variables,
  onClose
}: EmailPreviewProps) {
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [useMock, setUseMock] = useState(false);

  // Dùng previewHtml (WYSIWYG) thay vì html (email export)
  const { previewHtml, subject, warnings } = generateEmailHtml(template, variables, useMock);

  // Màu nền ngoài để container preview khớp với iframe
  const externalBg = template.settings?.externalBg || '#f1f5f9';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 animate-fade-in-fast">
      <div className="relative w-full max-w-7xl bg-slate-100 rounded-3xl border border-slate-200 shadow-2xl flex flex-col h-[90vh] overflow-hidden">

        {/* Header Toolbar */}
        <div className="p-4 bg-white border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-extrabold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Xem trước Email</h2>
            <div className="flex bg-slate-100 border border-slate-200 p-0.5 rounded-xl">
              <button
                onClick={() => setViewMode('desktop')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all ${viewMode === 'desktop' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
              >
                <Monitor className="w-3.5 h-3.5" />
                Máy tính (Desktop)
              </button>
              <button
                onClick={() => setViewMode('mobile')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all ${viewMode === 'mobile' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                Điện thoại (Mobile)
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto">
            {/* Toggle Mock Data */}
            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-705 font-bold select-none bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl hover:bg-slate-100/75 transition-all">
              <input
                type="checkbox"
                checked={useMock}
                onChange={e => setUseMock(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-slate-350 rounded focus:ring-blue-500 cursor-pointer"
              />
              Điền dữ liệu mẫu (Mock data)
            </label>

            <button
              onClick={onClose}
              aria-label="Đóng bản xem trước"
              className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-700 transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Warnings Pane */}
        {warnings.length > 0 && (
          <div className="bg-amber-50 border-b border-amber-200/60 p-3.5 px-6 shrink-0 max-h-[120px] overflow-y-auto">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4.5 h-4.5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <h4 className="text-xs font-bold text-amber-900 leading-tight">Cảnh báo chất lượng hiển thị ({warnings.length})</h4>
                <ul className="list-disc pl-4 mt-1 space-y-1">
                  {warnings.map((w, i) => (
                    <li key={i} className="text-[10px] text-amber-700 font-semibold">{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Subject preview bar */}
        <div
          className="shrink-0 border-b px-5 py-2.5 flex items-center gap-2 text-xs select-none"
          style={{ background: externalBg }}
        >
          <span className="font-bold text-slate-750 shrink-0">Tiêu đề:</span>
          <span className="truncate text-slate-900 font-semibold">{subject || '[Trống]'}</span>
        </div>

        {/* Email preview frame - cho phép iframe tự cuộn độc lập */}
        <div
          className="flex flex-1 overflow-hidden h-full p-4 justify-center"
          style={{ background: externalBg }}
        >
          {/* Desktop: căn giữa email trong khung, Mobile: giới hạn 390px căn giữa */}
          <div
            className="w-full h-full flex flex-col transition-all duration-300 shadow-lg rounded-2xl overflow-hidden border border-slate-200/80 bg-white"
            style={{
              maxWidth: viewMode === 'mobile' ? '390px' : `${template.settings?.maxWidth || 680}px`,
            }}
          >
            <iframe
              key={`${viewMode}-${previewHtml.length}`}
              title="Email Preview Frame"
              srcDoc={previewHtml}
              className="w-full h-full border-0 block"
              style={{ background: '#ffffff' }}
            />
          </div>
        </div>

      </div>
    </div>
  );
}
