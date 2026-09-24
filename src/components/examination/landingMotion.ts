/** Hiệu ứng dùng chung cho landing page: lộ ra khi cuộn, thanh tiến độ,
 *  đánh dấu mục đang xem và độ nghiêng nhẹ theo con trỏ.
 *  Mọi hook đều tắt khi người xem chọn giảm chuyển động hoặc khi xem trước trong Studio. */
import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Quan sát mọi phần tử [data-reveal] bên trong vùng gốc và cho chúng hiện dần khi lọt vào khung nhìn.
 *  Hiện xong thì gỡ hẳn thuộc tính, để các hiệu ứng hover của từng khối giữ nguyên transform riêng. */
export function useRevealScope<T extends HTMLElement>(enabled = true, key: unknown = null) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!targets.length) return;
    const settle = (element: HTMLElement) => {
      element.classList.remove('is-revealed');
      element.removeAttribute('data-reveal');
    };
    if (!enabled || typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) {
      targets.forEach(settle);
      return;
    }
    const timers: number[] = [];
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const element = entry.target as HTMLElement;
        observer.unobserve(element);
        element.classList.add('is-revealed');
        timers.push(window.setTimeout(() => settle(element), 2000));
      });
    }, { threshold: 0.06, rootMargin: '0px 0px -8% 0px' });
    targets.forEach(element => observer.observe(element));
    return () => {
      observer.disconnect();
      timers.forEach(window.clearTimeout);
    };
  }, [enabled, key]);
  return ref;
}

/** Tỷ lệ đã cuộn của cả trang, dùng cho thanh tiến độ trên thanh điều hướng. */
export function useScrollProgress(enabled = true) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 8 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [enabled]);
  return progress;
}

/** Id của khối đang nằm giữa khung nhìn, để làm nổi mục điều hướng tương ứng. */
export function useActiveSection(ids: string[], enabled = true) {
  const [active, setActive] = useState('');
  const signature = ids.join('|');
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === 'undefined') return;
    const sections = signature.split('|').map(id => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (!sections.length) return;
    const observer = new IntersectionObserver(entries => {
      const hit = entries.find(entry => entry.isIntersecting);
      if (hit) setActive(hit.target.id);
    }, { threshold: 0, rootMargin: '-42% 0px -52% 0px' });
    sections.forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, [enabled, signature]);
  return active;
}

/** Nghiêng rất nhẹ theo con trỏ; chỉ chạy với chuột và khi không giảm chuyển động. */
export function usePointerTilt<T extends HTMLElement>(enabled = true, strength = 7) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled || typeof window === 'undefined') return;
    if (prefersReducedMotion() || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let frame = 0;
    const move = (event: PointerEvent) => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const box = element.getBoundingClientRect();
        const x = (event.clientX - box.left) / box.width - 0.5;
        const y = (event.clientY - box.top) / box.height - 0.5;
        element.style.setProperty('--tilt-x', `${(-y * strength).toFixed(2)}deg`);
        element.style.setProperty('--tilt-y', `${(x * strength).toFixed(2)}deg`);
        element.style.setProperty('--tilt-glare-x', `${((x + 0.5) * 100).toFixed(1)}%`);
        element.style.setProperty('--tilt-glare-y', `${((y + 0.5) * 100).toFixed(1)}%`);
      });
    };
    const reset = () => {
      if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
      element.style.setProperty('--tilt-x', '0deg');
      element.style.setProperty('--tilt-y', '0deg');
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerleave', reset);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerleave', reset);
    };
  }, [enabled, strength]);
  return ref;
}

/** Cho biết trang đã cuộn qua ngưỡng, dùng để hiện nút về đầu trang. */
export function useScrolledPast(offset = 520, enabled = true) {
  const [passed, setPassed] = useState(false);
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const update = () => setPassed(window.scrollY > offset);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [enabled, offset]);
  return passed;
}
