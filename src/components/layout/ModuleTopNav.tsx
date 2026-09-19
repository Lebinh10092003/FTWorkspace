import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
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
 *
 * The strip scrolls horizontally, which clips absolutely positioned children,
 * so submenus are rendered through a portal and positioned against the
 * trigger's viewport box instead.
 */
export default function ModuleTopNav({ items, activeId, onSelect, ariaLabel = 'Điều hướng mô-đun' }: ModuleTopNavProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [menuBox, setMenuBox] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const menuRef = useRef<HTMLDivElement>(null);

  const placeMenu = (id: string) => {
    const trigger = triggerRefs.current[id];
    if (!trigger) return;
    const box = trigger.getBoundingClientRect();
    setMenuBox({ left: box.left, top: box.bottom + 6 });
  };

  useLayoutEffect(() => {
    if (openId) placeMenu(openId);
  }, [openId]);

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
    const reposition = () => placeMenu(openId);
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [openId]);

  const choose = (id: string) => {
    setOpenId(null);
    onSelect(id);
  };

  const openItem = openId ? items.find(item => item.id === openId) : null;

  return (
    <div className="ft-module-topnav" ref={rootRef}>
      <nav className="ft-module-topnav-scroll" aria-label={ariaLabel}>
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
                type="button"
                onClick={() => choose(item.id)}
                className={`ft-module-topnav-item${isActive ? ' is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
                {item.badge ? <span className="ft-module-topnav-badge">{item.badge}</span> : null}
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
              className={`ft-module-topnav-item${isActive ? ' is-active' : ''}`}
              aria-expanded={isOpen}
              aria-haspopup="true"
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{item.label}</span>
              {item.badge ? <span className="ft-module-topnav-badge">{item.badge}</span> : null}
              <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform${isOpen ? ' rotate-180' : ''}`} aria-hidden="true" />
            </button>
          );
        })}
      </nav>

      {openItem && menuBox
        && createPortal(
          <div
            ref={menuRef}
            className="ft-module-topnav-menu"
            role="menu"
            style={{ left: menuBox.left, top: menuBox.top }}
          >
            {(openItem.children || []).map(child => {
              const ChildIcon = child.icon;
              return (
                <button
                  key={child.id}
                  type="button"
                  role="menuitem"
                  onClick={() => choose(child.id)}
                  className={`ft-module-topnav-menu-item${child.id === activeId ? ' is-active' : ''}`}
                >
                  <ChildIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{child.label}</span>
                  {child.badge ? <span className="ft-module-topnav-badge">{child.badge}</span> : null}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
