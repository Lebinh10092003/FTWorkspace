import React, { useEffect, useId, useState } from 'react';
import { AlertTriangle, Trash2, HelpCircle, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
}

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Xác nhận',
  cancelText = 'Hủy bỏ',
  type = 'warning'
}: ConfirmModalProps) {
  const titleId = useId();
  const [confirming, setConfirming] = useState(false);
  
  // Close on ESC key
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirming) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [confirming, isOpen, onClose]);

  if (!isOpen) return null;

  const getIcon = () => {
    switch (type) {
      case 'danger':
        return <Trash2 className="w-6 h-6 text-red-600" />;
      case 'warning':
        return <AlertTriangle className="w-6 h-6 text-amber-600" />;
      default:
        return <HelpCircle className="w-6 h-6 text-blue-600" />;
    }
  };

  const getColorClasses = () => {
    switch (type) {
      case 'danger':
        return {
          iconBg: 'bg-rose-50 border border-rose-100',
          confirmBtn: 'ft-btn ft-btn-danger'
        };
      case 'warning':
        return {
          iconBg: 'bg-amber-50 border border-amber-100',
          confirmBtn: 'ft-btn bg-amber-600 text-white hover:bg-amber-700'
        };
      default:
        return {
          iconBg: 'bg-blue-50 border border-blue-100',
          confirmBtn: 'ft-btn ft-btn-primary'
        };
    }
  };

  const colors = getColorClasses();
  const close = () => {
    if (!confirming) onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] overflow-y-auto flex items-center justify-center p-4">
      {/* Backdrop overlay */}
      <div
        onClick={close}
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity duration-200 cursor-pointer"
      />

      {/* Modal container */}
      <div
        role={'dialog'}
        aria-modal={'true'}
        aria-labelledby={titleId}
        className="relative w-full max-w-lg transform overflow-hidden rounded-2xl bg-white px-4 pt-5 pb-4 text-left shadow-2xl transition-all sm:my-8 sm:p-6 border border-slate-100 z-10 animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Close button top right */}
        <button
          aria-label={'Đóng hộp thoại xác nhận'}
          type="button"
          onClick={close}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 rounded-lg p-1 hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="sm:flex sm:items-start">
          {/* Header Icon */}
          <div className={`mx-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full sm:mx-0 sm:h-10 sm:w-10 ${colors.iconBg}`}>
            {getIcon()}
          </div>

          <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
            <h3 className="text-base font-bold text-slate-900 leading-6">
              <span id={titleId}>{title}</span>
            </h3>
            <div className="mt-2">
              <p className="text-sm text-slate-500 leading-relaxed">
                {message}
              </p>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-5 sm:mt-6 flex flex-wrap justify-end gap-2.5">
          <button
            type="button"
            disabled={confirming}
            onClick={close}
            className="ft-btn ft-btn-secondary"
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={confirming}
            onClick={async () => {
              if (confirming) return;
              setConfirming(true);
              try {
                await onConfirm();
                onClose();
              } finally {
                setConfirming(false);
              }
            }}
            className={colors.confirmBtn}
          >
            {confirming ? 'Đang xử lý…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
