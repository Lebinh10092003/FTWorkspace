import React, { useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { WORKSPACE_AREAS, WorkspaceArea, WorkspaceAreaId } from '../../config/workspaceNavigation';

const COMPACT_STORAGE_KEY = 'ft-workspace-rail-compact';

function readCompact() {
  try {
    return localStorage.getItem(COMPACT_STORAGE_KEY) === '1';
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
 * business domain. It shows full labels by default and can be collapsed to an
 * icon rail with tooltips; the choice is remembered per browser.
 */
export default function WorkspaceAppRail({ activeAreaId, canAccess, onSelect }: WorkspaceAppRailProps) {
  const [compact, setCompact] = useState(readCompact);
  const visibleAreas = WORKSPACE_AREAS.filter(canAccess);

  useEffect(() => {
    try {
      localStorage.setItem(COMPACT_STORAGE_KEY, compact ? '1' : '0');
    } catch {
      /* Private browsing keeps the default wide rail. */
    }
  }, [compact]);

  return (
    <nav
      className={`ft-app-rail${compact ? ' is-compact' : ''}`}
      aria-label="Điều hướng lĩnh vực FT Workspace"
      data-compact={compact ? 'true' : 'false'}
    >
      <div className="ft-app-rail-brand">
        <img src="/logo.png" alt="FermatTech" />
        {!compact && <span>FT Workspace</span>}
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
              title={area.label}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="ft-app-rail-label">{compact ? area.shortLabel : area.label}</span>
              {compact && <span className="ft-app-rail-tooltip" role="tooltip">{area.label}</span>}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="ft-app-rail-toggle"
        onClick={() => setCompact(value => !value)}
        aria-expanded={!compact}
        title={compact ? 'Mở rộng menu lĩnh vực' : 'Thu gọn menu lĩnh vực'}
      >
        {compact ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        {!compact && <span>Thu gọn</span>}
      </button>
    </nav>
  );
}
