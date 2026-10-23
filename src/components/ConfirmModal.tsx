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
          iconBg: 'bg-red-50 border border-red-100',
          confirmBtn: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500'
        };
      case 'warning':
        return {
          iconBg: 'bg-amber-50 border border-amber-100',
          confirmBtn: 'bg-amber-600 hover:bg-amber-700 text-white focus:ring-amber-500'
        };
      default:
        return {
          iconBg: 'bg-blue-50 border border-blue-100',
          confirmBtn: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500'
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
        <div className="mt-5 sm:mt-6 sm:flex sm:flex-row-reverse gap-3">
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
            className={`inline-flex w-full justify-center rounded-xl px-4 py-2.5 text-xs font-semibold shadow-xs transition-all focus:outline-none cursor-pointer sm:ml-3 sm:w-auto ${colors.confirmBtn}`}
          >
            {confirming ? 'Đang xử lý…' : confirmText}
          </button>
          <button
            type="button"
            disabled={confirming}
            onClick={close}
            className="mt-3 inline-flex w-full justify-center rounded-xl bg-white border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-all focus:outline-none cursor-pointer sm:mt-0 sm:w-auto"
          >
            {cancelText}
          </button>
        </div>
      </div>
    </div>
  );
}
