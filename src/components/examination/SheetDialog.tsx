import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export default function SheetDialog({ children, onClose, busy = false }: { children: ReactNode; onClose: () => void; busy?: boolean }) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const pending = useRef(busy);
  close.current = onClose;
  pending.current = busy;
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const controls = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || []).filter(element => element.offsetParent !== null);
    (controls()[0] || dialog.current)?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending.current) close.current();
      if (event.key === 'Tab') {
        const elements = controls();
        const next = event.shiftKey ? elements.at(-1) : elements[0];
        const edge = event.shiftKey ? elements[0] : elements.at(-1);
        if (!dialog.current?.contains(document.activeElement) || document.activeElement === edge || !elements.length) {
          event.preventDefault(); (next || dialog.current)?.focus();
        }
      }
    };
    document.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', escape); previousFocus?.focus(); };
  }, []);
  return createPortal(<div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Đối soát nguồn Google Sheets" className="fixed inset-0 z-[200] grid place-items-center overflow-y-auto bg-slate-950/50 p-4">{children}</div>, document.body);
}
