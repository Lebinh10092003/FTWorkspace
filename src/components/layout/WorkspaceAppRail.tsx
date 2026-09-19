import React, { useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { WORKSPACE_AREAS, WorkspaceArea, WorkspaceAreaId } from '../../config/workspaceNavigation';

const EXPANDED_STORAGE_KEY = 'ft-workspace-rail-expanded';

function readExpanded() {
  try {
    return localStorage.getItem(EXPANDED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export type WorkspaceAppRailProps = {
  activeAreaId: WorkspaceAreaId | null;
  /** Returns false for areas the current account may not open. */
  canAccess: (area: WorkspaceArea) => boolean;
  onSelect: (area: WorkspaceArea) => void;
};

/**
 * Vertical navigation shared by every FT Workspace module: one entry per
 * business domain. It stays compact (icon + tooltip) and can be expanded to
 * show labels; the choice is remembered per browser.
 */
export default function WorkspaceAppRail({ activeAreaId, canAccess, onSelect }: WorkspaceAppRailProps) {
  const [expanded, setExpanded] = useState(readExpanded);
  const visibleAreas = WORKSPACE_AREAS.filter(canAccess);

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_STORAGE_KEY, expanded ? '1' : '0');
    } catch {
      /* Private browsing keeps the default collapsed rail. */
    }
  }, [expanded]);

  return (
    <nav
      className={`ft-app-rail${expanded ? ' is-expanded' : ''}`}
      aria-label="Điều hướng lĩnh vực FT Workspace"
      data-expanded={expanded ? 'true' : 'false'}
    >
      <div className="ft-app-rail-brand">
        <img src="/logo.png" alt="FermatTech" />
        {expanded && <span>FT Workspace</span>}
      </div>
      <div className="ft-app-rail-items">
        {visibleAreas.map(area => {
          const Icon = area.icon;
          const isActive = activeAreaId === area.id;
          return (
            <button
              key={area.id}
              type="button"
              onClick={() => onSelect(area)}
              className={`ft-app-rail-item${isActive ? ' is-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              title={expanded ? undefined : area.label}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="ft-app-rail-label">{expanded ? area.label : area.shortLabel}</span>
              {!expanded && <span className="ft-app-rail-tooltip" role="tooltip">{area.label}</span>}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="ft-app-rail-toggle"
        onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded}
        title={expanded ? 'Thu gọn menu lĩnh vực' : 'Mở rộng menu lĩnh vực'}
      >
        {expanded ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        {expanded && <span>Thu gọn</span>}
      </button>
    </nav>
  );
}
