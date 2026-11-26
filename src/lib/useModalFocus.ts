import { useLayoutEffect, useRef, type RefObject } from 'react';

type ModalEntry = { panel: HTMLElement; focus: () => void };
const openModals: ModalEntry[] = [];
let originalOverflow = '';

function activeModal() {
  return openModals[openModals.length - 1];
}

function isAvailable(element: HTMLElement) {
  return !element.matches(':disabled')
    && !element.closest('[hidden], [inert], [aria-hidden="true"]')
    && element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden';
}

function tabbableElements(panel: HTMLElement) {
  return [...panel.querySelectorAll<HTMLElement>(
    'a[href], area[href], button, input, select, textarea, iframe, [contenteditable], [tabindex]',
  )].filter(element => element.tabIndex >= 0 && isAvailable(element));
}

/** Shares focus and scroll ownership across the common dialog components. */
export function useModalFocus<T extends HTMLElement>({
  open,
  onClose,
  initialFocusRef,
  focusKey,
}: {
  open: boolean;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  focusKey?: unknown;
}) {
  const panelRef = useRef<T>(null);
  const closeRef = useRef(onClose);
  const preferredRef = useRef(initialFocusRef);
  const entryRef = useRef<ModalEntry | null>(null);
  useLayoutEffect(() => {
    closeRef.current = onClose;
    preferredRef.current = initialFocusRef;
  }, [onClose, initialFocusRef]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!openModals.length) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    const entry: ModalEntry = {
      panel,
      focus: () => {
        const preferred = preferredRef.current?.current;
        const target = preferred && panel.contains(preferred) && isAvailable(preferred)
          ? preferred : tabbableElements(panel)[0] || panel;
        target.focus({ preventScroll: true });
      },
    };
    // Children can mount first. Keep ownership stable even after a child DOM node is removed.
    const childIndex = openModals.findIndex(existing => panel.contains(existing.panel));
    if (childIndex < 0) openModals.push(entry);
    else openModals.splice(childIndex, 0, entry);
    entryRef.current = entry;

    const onFocus = (event: FocusEvent) => {
      if (activeModal() === entry && !panel.contains(event.target as Node)) entry.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (activeModal() !== entry || event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const elements = tabbableElements(panel);
        const first = elements[0];
        const last = elements[elements.length - 1];
        const focused = document.activeElement;
        if (!first) {
          event.preventDefault();
          panel.focus();
        } else if (!panel.contains(focused) || focused === panel
          || (event.shiftKey && focused === first) || (!event.shiftKey && focused === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener('focusin', onFocus);
    document.addEventListener('keydown', onKey);
    return () => {
      entryRef.current = null;
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('keydown', onKey);
      const wasActive = activeModal() === entry;
      openModals.splice(openModals.indexOf(entry), 1);
      const remaining = activeModal();
      if (!openModals.length) document.body.style.overflow = originalOverflow;
      if (wasActive) {
        if (previousFocus?.isConnected && (!remaining || remaining.panel.contains(previousFocus))) {
          previousFocus.focus({ preventScroll: true });
        } else {
          remaining?.focus();
        }
      }
    };
  }, [open]);

  // A queued request changes content, but still belongs to the original opener.
  useLayoutEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const entry = entryRef.current;
      if (entry && activeModal() === entry) entry.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, initialFocusRef, focusKey]);

  return panelRef;
}
