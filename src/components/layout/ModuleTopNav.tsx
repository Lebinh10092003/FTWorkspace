import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { ModuleNavItem } from '../../config/workspaceNavigation';

export type ModuleTopNavProps = {
  items: ModuleNavItem[];
  /** Leaf id of the task currently open (e.g. "calendar", "products-catalog"). */
  activeId: string;
  onSelect: (id: string) => void;
  ariaLabel?: string;
};

/**
 * Horizontal menu listing the tasks of the selected area.
 * Modeled after shadcn segmented tabs list with responsive smooth scroll and overflow indicators.
 */
export default function ModuleTopNav({ items, activeId, onSelect, ariaLabel = 'Điều hướng mô-đun' }: ModuleTopNavProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [menuBox, setMenuBox] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const menuRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 2);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 2);
  }, []);

  const placeMenu = useCallback((id: string) => {
    const trigger = triggerRefs.current[id];
    if (!trigger) return;
    const box = trigger.getBoundingClientRect();
    if (scrollContainerRef.current) {
      const cBox = scrollContainerRef.current.getBoundingClientRect();
      if (box.right < cBox.left || box.left > cBox.right) {
        setOpenId(null);
        return;
      }
    }
    const safeLeft = Math.max(12, Math.min(box.left, window.innerWidth - 240));
    setMenuBox({ left: safeLeft, top: box.bottom + 6 });
  }, []);

  useLayoutEffect(() => {
    if (openId) placeMenu(openId);
  }, [openId, placeMenu]);

  useEffect(() => {
    checkScroll();
    const el = scrollContainerRef.current;
    if (!el) return;

    const handleResize = () => {
      checkScroll();
      if (openId) placeMenu(openId);
    };

    window.addEventListener('resize', handleResize);
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => checkScroll());
      resizeObserver.observe(el);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [items, checkScroll, openId, placeMenu]);

  useEffect(() => {
    if (!openId) return;
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpenId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenId(null);
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openId]);

  // Auto-scroll active item into visible view when activeId changes or items change
  useEffect(() => {
    const activeItem = items.find(
      item => item.id === activeId || (item.children && item.children.some(child => child.id === activeId))
    );
    if (!activeItem) return;
    const trigger = triggerRefs.current[activeItem.id];
    if (trigger && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const cRect = container.getBoundingClientRect();
      const tRect = trigger.getBoundingClientRect();
      if (tRect.left < cRect.left || tRect.right > cRect.right) {
        trigger.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }
  }, [activeId, items]);

  const handleScroll = () => {
    checkScroll();
    if (openId) placeMenu(openId);
  };

  const scrollByAmount = (delta: number) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  };

  const choose = (id: string) => {
    setOpenId(null);
    onSelect(id);
  };

  const openItem = openId ? items.find(item => item.id === openId) : null;

  return (
    <div className="relative w-full flex items-center min-w-0" ref={rootRef}>
      {/* Scroll Left Button */}
      {canScrollLeft && (
        <div className="absolute left-0 z-20 flex items-center pr-2 pl-0.5">
          <button
            type="button"
            onClick={() => scrollByAmount(-220)}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/95 dark:bg-slate-800/95 text-slate-600 dark:text-slate-300 shadow-md border border-slate-200/90 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Cuộn sang trái"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Left Fade Gradient Mask */}
      {canScrollLeft && (
        <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-9 bg-gradient-to-r from-[var(--workspace-card,#ffffff)] via-[var(--workspace-card,#ffffff)]/80 to-transparent z-10" />
      )}

      {/* Main Scrollable Nav Track */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="w-full flex items-center overflow-x-auto scrollbar-none scroll-smooth px-1 py-1"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', justifyContent: 'safe center' }}
      >
        <nav
          className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100/90 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 shadow-2xs shrink-0"
          aria-label={ariaLabel}
        >
          {items.map(item => {
            const Icon = item.icon;
            const children = item.children || [];
            const isActive = children.length
              ? children.some(child => child.id === activeId) || item.id === activeId
              : item.id === activeId;

            if (!children.length) {
              return (
                <button
                  key={item.id}
                  ref={element => {
                    triggerRefs.current[item.id] = element;
                  }}
                  type="button"
                  onClick={() => choose(item.id)}
                  className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer select-none whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs ring-1 ring-slate-900/5 dark:ring-white/10'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700/60'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}`} aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.badge ? (
                    <span className="ml-1 inline-grid place-items-center rounded-full bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 px-1.5 py-0.2 text-[10px] font-bold">
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            }

            const isOpen = openId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                ref={element => {
                  triggerRefs.current[item.id] = element;
                }}
                onClick={() => setOpenId(isOpen ? null : item.id)}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer select-none whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs ring-1 ring-slate-900/5 dark:ring-white/10'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700/60'
                }`}
                aria-expanded={isOpen}
                aria-haspopup="true"
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}`} aria-hidden="true" />
                <span>{item.label}</span>
                {item.badge ? (
                  <span className="ml-1 inline-grid place-items-center rounded-full bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 px-1.5 py-0.2 text-[10px] font-bold">
                    {item.badge}
                  </span>
                ) : null}
                <ChevronDown className={`h-3 w-3 shrink-0 text-slate-400 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
            );
          })}
        </nav>
      </div>

      {/* Right Fade Gradient Mask */}
      {canScrollRight && (
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-9 bg-gradient-to-l from-[var(--workspace-card,#ffffff)] via-[var(--workspace-card,#ffffff)]/80 to-transparent z-10" />
      )}

      {/* Scroll Right Button */}
      {canScrollRight && (
        <div className="absolute right-0 z-20 flex items-center pl-2 pr-0.5">
          <button
            type="button"
            onClick={() => scrollByAmount(220)}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/95 dark:bg-slate-800/95 text-slate-600 dark:text-slate-300 shadow-md border border-slate-200/90 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Cuộn sang phải"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Dropdown Menu Portal */}
      {openItem && menuBox &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-60 min-w-[14rem] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 shadow-xl shadow-slate-900/10 animate-scale-in"
            role="menu"
            style={{ left: menuBox.left, top: menuBox.top }}
          >
            {(openItem.children || []).map(child => {
              const ChildIcon = child.icon;
              const isChildActive = child.id === activeId;
              return (
                <button
                  key={child.id}
                  type="button"
                  role="menuitem"
                  onClick={() => choose(child.id)}
                  className={`flex w-full items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-left transition-colors cursor-pointer ${
                    isChildActive
                      ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-semibold'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <ChildIcon className={`h-3.5 w-3.5 shrink-0 ${isChildActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}`} aria-hidden="true" />
                  <span className="flex-1 truncate">{child.label}</span>
                  {child.badge ? (
                    <span className="inline-grid place-items-center rounded-full bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 px-1.5 py-0.2 text-[10px] font-bold">
                      {child.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}
