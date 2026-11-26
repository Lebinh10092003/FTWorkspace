import React, { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import { useModalFocus } from '../../lib/useModalFocus';

type Props = {
  open: boolean;
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
  onSubmit?: () => void | Promise<void>;
  submitLabel?: string;
  busy?: boolean;
  submitDisabled?: boolean;
};

export default function ExamDialog({
  open,
  title,
  description,
  children,
  onClose,
  onSubmit,
  submitLabel = 'Lưu thay đổi',
  busy,
  submitDisabled = false,
}: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const [submitting, setSubmitting] = useState(false);
  const locked = Boolean(busy || submitting);

  const panelRef = useModalFocus<HTMLFormElement>({ open, onClose: () => { if (!locked) onClose(); } });

  useEffect(() => {
    if (!open) setSubmitting(false);
  }, [open]);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!onSubmit || locked || submitDisabled) return;
    setSubmitting(true);
    try {
      await onSubmit();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={'ft-dialog-backdrop fixed inset-0 z-[70] grid place-items-center p-4'}
      onMouseDown={event => {
        if (event.target === event.currentTarget && !locked) onClose();
      }}
    >
      <form
        ref={panelRef}
        tabIndex={-1}
        role={'dialog'}
        aria-modal={'true'}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={locked}
        onSubmit={submit}
        className={'ft-dialog-panel max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto bg-white p-4 shadow-2xl sm:p-6'}
      >
        <button
          type={'button'}
          disabled={locked}
          onClick={onClose}
          className={'float-right grid min-h-11 min-w-11 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-40'}
          aria-label={'Đóng hộp thoại'}
        >
          <X className={'h-5 w-5'} />
        </button>
        <h2 id={titleId} className={'pr-8 text-2xl font-extrabold text-[#101827]'}>
          {title}
        </h2>
        {description && <p id={descriptionId} className={'mt-2 text-sm text-slate-600'}>{description}</p>}
        <div className={'mt-5'}>{children}</div>
        <div className={'mt-6 flex flex-wrap justify-end gap-3 border-t pt-5'}>
          <button
            type={'button'}
            disabled={locked}
            onClick={onClose}
            className={'ft-btn ft-btn-secondary'}
          >
            Hủy
          </button>
          {onSubmit && (
            <button
              disabled={locked || submitDisabled}
              className={'ft-btn ft-btn-primary'}
              type={'submit'}
            >
              {locked ? 'Đang lưu…' : submitLabel}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
