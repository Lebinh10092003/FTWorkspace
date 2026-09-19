import React, { useEffect, useRef, useState } from 'react';
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
 * Horizontal menu listing the tasks of the selected area. Entries with children
 * open a small dropdown; everything stays keyboard reachable and scrolls
 * horizontally on narrow screens instead of wrapping into a tall block.
 */
export default function ModuleTopNav({ items, activeId, onSelect, ariaLabel = 'Điều hướng mô-đun' }: ModuleTopNavProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openId) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpenId(null);
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

  const choose = (id: string) => {
    setOpenId(null);
    onSelect(id);
  };

  return (
    <div className="ft-module-topnav" ref={rootRef}>
      <nav className="ft-module-topnav-scroll" aria-label={ariaLabel}>
        {items.map(item => {
          const Icon = item.icon;
          const children = item.children || [];
          const isActive = children.length
            ? children.some(child => child.id === activeId)
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
              </button>
            );
          }

          const isOpen = openId === item.id;
          return (
            <div key={item.id} className="ft-module-topnav-group">
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : item.id)}
                className={`ft-module-topnav-item${isActive ? ' is-active' : ''}`}
                aria-expanded={isOpen}
                aria-haspopup="true"
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform${isOpen ? ' rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {isOpen && (
                <div className="ft-module-topnav-menu" role="menu">
                  {children.map(child => {
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
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
