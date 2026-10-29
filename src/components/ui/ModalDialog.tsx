import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export type ModalDialogProps = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  /** Độ rộng khi `wide` (mặc định max-w-4xl). */
  wideClassName?: string;
};

/** Hộp thoại dùng chung: nền mờ bấm để đóng, phím Esc để đóng, tiêu đề dính ở trên khi cuộn. */
export default function ModalDialog({ title, onClose, children, wide = false, wideClassName = 'max-w-4xl' }: ModalDialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <button aria-label="Đóng" onClick={onClose} className="absolute inset-0 cursor-default bg-slate-950/45 backdrop-blur-sm" />
      <section role="dialog" aria-modal="true" aria-label={title} className={`relative max-h-[92vh] w-full overflow-y-auto rounded-2xl bg-white shadow-2xl ${wide ? wideClassName : 'max-w-2xl'}`}>
        <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-4">
          <h3 className="text-lg font-extrabold text-slate-900">{title}</h3>
          <button onClick={onClose} aria-label="Đóng" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </header>
        {children}
      </section>
    </div>
  );
}
