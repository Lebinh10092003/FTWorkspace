import React, { useRef, useState } from 'react';
import { 
  ArrowLeft, 
  Files,
  Copy, 
  RotateCcw, 
  Undo2,
  Redo2,
  Download, 
  Upload, 
  Code2,
  FileCode2,
  Trash2, 
  Eye, 
  Check, Edit2, Share2
} from 'lucide-react';
import { EmailTemplate } from '../../types/emailBuilder';
import AccountMenu from '../AccountMenu';
import { useEmailBuilderDialog } from './EmailBuilderDialog';

interface EmailBuilderHeaderProps {
  template: EmailTemplate;
  templatesList: EmailTemplate[];
  onSelectTemplate: (id: string) => void;
  onRenameTemplate: (name: string) => void;
  onDuplicateTemplate: () => void;
  onExportHtml: () => void;
  onDeleteTemplate: () => void;
  onPublishTemplate: () => void;
  onUnpublishTemplate: () => void;
  canDeleteTemplate: boolean;
  canManageSharing: boolean;
  onRestoreDefaults: () => void;
  onImportFile: (file: File) => Promise<void>;
  onEditHtmlClick: () => void;
  onPasteHtmlClick: () => void;
  onPreviewClick: () => void;
  onBackToWorkspace: () => void;
  onAccountClick: () => void;
  onLogout: () => void;
  isGuest: boolean;
  userName?: string | null;
  userRole?: string | null;
  photoURL?: string | null;
  onCopyEmail: () => void;
  onCopySubject: () => void;
  copySuccess: boolean;
  copySubjectSuccess: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export default function EmailBuilderHeader({
  template,
  templatesList,
  onSelectTemplate,
  onRenameTemplate,
  onDuplicateTemplate,
  onExportHtml,
  onDeleteTemplate,
  onPublishTemplate,
  onUnpublishTemplate,
  canDeleteTemplate,
  canManageSharing,
  onRestoreDefaults,
  onImportFile,
  onEditHtmlClick,
  onPasteHtmlClick,
  onPreviewClick,
  onBackToWorkspace,
  onAccountClick,
  onLogout,
  isGuest,
  userName,
  userRole,
  photoURL,
  onCopyEmail,
  onCopySubject,
  copySuccess,
  copySubjectSuccess,
  onUndo,
  onRedo,
  canUndo,
  canRedo
}: EmailBuilderHeaderProps) {
  
  const dialog = useEmailBuilderDialog();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(template.name);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      await onImportFile(file);
    } finally {
      input.value = '';
    }
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameVal.trim() && nameVal.trim() !== template.name) {
      onRenameTemplate(nameVal.trim());
    }
    setIsEditingName(false);
  };

  const iconButtonClass = 'grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-30';
  const secondaryButtonClass = 'inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100';

  return (
    <header className="email-builder-header z-10 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 border-b border-slate-200/80 bg-white px-4 py-3 shadow-[0_1px_10px_rgba(0,0,0,0.01)] xl:grid-cols-[minmax(0,1fr)_auto_auto] xl:px-5">
      
      {/* Left section: back & active template dropdown/editor */}
      <div className="email-builder-header-left col-start-1 row-start-1 flex min-w-0 items-center gap-3">
        <img src="/logo.png" alt="Fermat" className="ft-module-logo hidden h-8 w-auto shrink-0 object-contain sm:block" />
        <button
          onClick={onBackToWorkspace}
          className="flex items-center justify-center p-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200/60 transition-all cursor-pointer hover:text-slate-800"
          title="Quay lại Workspace"
        >
          <ArrowLeft className="w-4 h-4 text-slate-550" />
        </button>
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
          <button type="button" onClick={onUndo} disabled={isGuest || !canUndo} title="Hoàn tác (Ctrl+Z)" className="rounded-lg p-1.5 text-slate-600 hover:bg-white hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-30"><Undo2 className="h-4 w-4" /></button>
          <button type="button" onClick={onRedo} disabled={isGuest || !canRedo} title="Làm lại (Ctrl+Y hoặc Ctrl+Shift+Z)" className="rounded-lg p-1.5 text-slate-600 hover:bg-white hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-30"><Redo2 className="h-4 w-4" /></button>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isEditingName ? (
              <form onSubmit={handleRenameSubmit} className="flex items-center gap-1.5">
                <input
                  autoFocus
                  type="text"
                  value={nameVal}
                  onChange={e => setNameVal(e.target.value)}
                  onBlur={handleRenameSubmit}
                  className="text-sm font-extrabold text-slate-900 border-b-2 border-blue-500 outline-none px-1 py-0.5 max-w-[250px]"
                />
                <button type="submit" className="text-[10px] bg-blue-600 text-white font-bold px-2 py-0.5 rounded cursor-pointer">OK</button>
              </form>
            ) : (
              <div className="flex items-center gap-2 group">
                <h1 className="text-sm font-extrabold text-slate-900 truncate leading-none">{template.name}</h1>
                <button 
                  onClick={() => {
                    setNameVal(template.name);
                    setIsEditingName(true);
                  }}
                  disabled={isGuest}
                  className="p-1 opacity-0 group-hover:opacity-100 hover:bg-slate-100 rounded text-slate-450 hover:text-slate-700 transition-all cursor-pointer"
                  title="Đổi tên mẫu"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            )}
            <span className="hidden shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-emerald-700 sm:inline-flex">Tự động lưu</span>
          </div>

            {template.isPublished && (
              <span title={`Mẫu chia sẻ · Chủ sở hữu: ${template.ownerName || template.createdBy || 'Bạn'}`} className="hidden shrink-0 rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-violet-700 sm:inline-flex">Đã chia sẻ</span>
            )}
          {/* Quick template selector dropdown */}
          <div className="email-builder-template-row mt-1.5 flex items-center gap-2 text-xs">
            <span className="text-slate-400 font-medium">Đang sửa:</span>
            <select
              value={template.id}
              onChange={e => onSelectTemplate(e.target.value)}
              className="email-builder-template-select max-w-[210px] cursor-pointer truncate rounded-md border border-transparent bg-transparent px-1 py-0.5 font-bold text-slate-700 outline-none hover:border-slate-200 hover:text-blue-650 sm:max-w-[360px]"
            >
              {templatesList.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Right section: utility operations + COPY CTA */}
      <div className="email-builder-header-actions col-span-2 row-start-2 flex min-w-0 items-center justify-end gap-1.5 overflow-x-auto border-t border-slate-100 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xl:col-span-1 xl:col-start-2 xl:row-start-1 xl:overflow-visible xl:border-t-0 xl:pt-0">
        {/* Template admin controls */}
        <button
          onClick={onDuplicateTemplate}
          title="Nhân bản mẫu này"
          className={iconButtonClass}
         disabled={isGuest}>
          <Files className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onExportHtml}
          title="Xuất file HTML"
          className={iconButtonClass}
        >
          <Download className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={handleImportClick}
          title="Nhập mẫu từ file JSON hoặc HTML"
          className={iconButtonClass}
         disabled={isGuest}>
          <Upload className="w-3.5 h-3.5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.html,.htm,application/json,text/html"
          onChange={handleFileChange}
          className="hidden"
        />

        <button
          onClick={onEditHtmlClick}
          title="Xem và sửa mã HTML của email đang mở"
          className={iconButtonClass}
          disabled={isGuest}
        >
          <FileCode2 className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onPasteHtmlClick}
          title="Dán mã HTML vào email hiện tại"
          className={iconButtonClass}
          disabled={isGuest}
        >
          <Code2 className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={async () => { if (await dialog.confirm('Bạn muốn khôi phục tất cả các mẫu mặc định ban đầu của FermatTech? Các sửa đổi hiện tại sẽ bị xóa.', { title: 'Khôi phục mẫu mặc định', confirmText: 'Khôi phục', danger: true })) onRestoreDefaults(); }}
          title="Khôi phục mẫu mặc định"
          disabled={isGuest}
          className={iconButtonClass}
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        {canManageSharing && (
          <button
            disabled={isGuest}
            onClick={async () => {
              if (template.isPublished) {
                if (await dialog.confirm('Mẫu sẽ chỉ còn bạn xem và chỉnh sửa.', { title: 'Dừng chia sẻ mẫu email', confirmText: 'Dừng chia sẻ', danger: true })) onUnpublishTemplate();
                return;
              }
              if (await dialog.confirm('Mọi nhân viên có thể xem và chỉnh sửa mẫu sau khi chia sẻ. Chỉ bạn vẫn có quyền xóa.', { title: 'Chia sẻ mẫu email', confirmText: 'Chia sẻ' })) onPublishTemplate();
            }}
            title={template.isPublished ? 'Dừng chia sẻ mẫu này' : 'Chia sẻ mẫu với toàn bộ nhân viên'}
            className={`${secondaryButtonClass} ${template.isPublished ? 'hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700' : 'hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700'}`}
          >
            <Share2 className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">{template.isPublished ? 'Dừng chia sẻ' : 'Chia sẻ mẫu'}</span>
          </button>
        )}
        <button
          disabled={isGuest || !canDeleteTemplate || templatesList.length <= 1}
          onClick={async () => { if (await dialog.confirm('Bạn chắc chắn muốn xóa mẫu này?', { title: 'Xóa mẫu email', confirmText: 'Xóa mẫu', danger: true })) onDeleteTemplate(); }}
          title="Xóa mẫu này"
          className={`${iconButtonClass} hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-600`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        <div className="mx-1 h-6 w-px shrink-0 bg-slate-200"></div>

        {/* View / Copy operations */}
        <button
          onClick={onPreviewClick}
          className={secondaryButtonClass}
          title="Xem trước email"
        >
          <Eye className="w-3.5 h-3.5" />
          Xem trước
        </button>

        <button
          onClick={onCopySubject}
          className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-bold transition-colors ${
            copySubjectSuccess 
              ? 'border-emerald-600 bg-emerald-600 text-white'
              : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'
          }`}
          title="Sao chép tiêu đề email"
        >
          {copySubjectSuccess ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          Sao chép tiêu đề
        </button>

        <button
          onClick={onCopyEmail}
          className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3.5 text-xs font-bold text-white shadow-sm transition-colors ${
            copySuccess 
              ? 'border-emerald-600 bg-emerald-600 hover:bg-emerald-700'
              : 'border-blue-700 bg-blue-700 hover:border-blue-800 hover:bg-blue-800'
          }`}
          title="Sao chép nội dung email"
        >
          {copySuccess ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          Sao chép nội dung
        </button>
      </div>

      <div className="email-builder-account col-start-2 row-start-1 xl:col-start-3">
        <AccountMenu userName={userName} userRole={userRole} photoURL={photoURL} isGuest={isGuest} onAccountClick={onAccountClick} onLogout={onLogout} variant="avatar"/>
      </div>

    </header>
  );
}
