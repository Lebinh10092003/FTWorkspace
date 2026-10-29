import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AppDialogProvider } from './components/AppDialog.tsx';
import './index.css';

const originalFetch = window.fetch.bind(window);
const apiBase = String((import.meta as any).env?.VITE_API_URL || '').trim().replace(/\/$/, '');
const useLocalApiProxy = Boolean((import.meta as any).env?.DEV && apiBase);

window.fetch = async (input, init) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.toString()
        : '';
  const isRelativeApiCall = url.startsWith('/api/');
  const isSameOriginApiCall = url.startsWith(`${window.location.origin}/api/`);

  if (useLocalApiProxy || !apiBase || (!isRelativeApiCall && !isSameOriginApiCall)) {
    return originalFetch(input, init);
  }

  const apiPath = isRelativeApiCall ? url : url.slice(window.location.origin.length);
  const targetUrl = `${apiBase}${apiPath.replace(/^\/api(?=\/|$)/, '')}`;
  if (typeof input === 'string') return originalFetch(targetUrl, init);
  if (input instanceof URL) return originalFetch(new URL(targetUrl), init);

  const requestInit: RequestInit = {
    method: input.method,
    headers: new Headers(input.headers),
    credentials: input.credentials,
    mode: input.mode,
    cache: input.cache,
    redirect: input.redirect,
    referrer: input.referrer,
    integrity: input.integrity,
    keepalive: input.keepalive,
    signal: input.signal,
  };
  if (!['GET', 'HEAD'].includes(input.method) && input.body !== null) {
    requestInit.body = await input.clone().blob();
  }
  return originalFetch(new Request(targetUrl, requestInit));
};

const isInteractiveTarget = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('button, input, select, textarea, a, [data-no-drag-scroll]'));
const dragScrollThreshold = 7;
let dragScroll: { element: HTMLElement; startX: number; startLeft: number; pointerId: number; moved: boolean } | null = null;
let suppressedDragClick: { element: HTMLElement; expiresAt: number } | null = null;

document.addEventListener('pointerdown', event => {
  if (event.button !== 0 || isInteractiveTarget(event.target)) return;
  const element = event.target instanceof Element ? event.target.closest<HTMLElement>('.overflow-x-auto, [data-drag-scroll]') : null;
  if (!element || element.scrollWidth <= element.clientWidth) return;
  dragScroll = { element, startX: event.clientX, startLeft: element.scrollLeft, pointerId: event.pointerId, moved: false };
});
document.addEventListener('pointermove', event => {
  if (!dragScroll || event.pointerId !== dragScroll.pointerId) return;
  const distance = event.clientX - dragScroll.startX;
  if (!dragScroll.moved && Math.abs(distance) <= dragScrollThreshold) return;
  if (!dragScroll.moved) {
    dragScroll.moved = true;
    dragScroll.element.setPointerCapture?.(event.pointerId);
    dragScroll.element.classList.add('is-drag-scrolling');
  }
  dragScroll.element.scrollLeft = dragScroll.startLeft - distance;
  event.preventDefault();
}, { passive: false });
const endDragScroll = (event: PointerEvent) => {
  if (!dragScroll || event.pointerId !== dragScroll.pointerId) return;
  const { element, moved, pointerId } = dragScroll;
  element.classList.remove('is-drag-scrolling');
  if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture?.(pointerId);
  if (moved) suppressedDragClick = { element, expiresAt: performance.now() + 250 };
  dragScroll = null;
};
document.addEventListener('click', event => {
  if (!suppressedDragClick || performance.now() > suppressedDragClick.expiresAt) {
    suppressedDragClick = null;
    return;
  }
  if (event.target instanceof Node && suppressedDragClick.element.contains(event.target)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressedDragClick = null;
  }
}, true);
document.addEventListener('pointerup', endDragScroll);
document.addEventListener('pointercancel', endDragScroll);
createRoot(document.getElementById('root')!).render(
  <StrictMode><AppDialogProvider><App /></AppDialogProvider></StrictMode>,
);
