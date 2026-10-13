import React, { useEffect, useState } from 'react';
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { WORKSPACE_AREAS, WorkspaceArea, WorkspaceAreaId } from '../../config/workspaceNavigation';
import { DepartmentLayout, groupByDepartment } from '../../config/departmentLayout';

const COMPACT_STORAGE_KEY = 'ft-workspace-rail-compact';
const OTHERS_STORAGE_KEY = 'ft-workspace-rail-others';

function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* Private browsing keeps the defaults. */
  }
}

export type WorkspaceAppRailProps = {
  activeAreaId: WorkspaceAreaId | null;
  /** Returns false for areas the current account may not open. */
  canAccess: (area: WorkspaceArea) => boolean;
  onSelect: (area: WorkspaceArea) => void;
  /** Department-first ordering; null keeps the full flat list. */
  layout?: DepartmentLayout | null;
};

/**
 * Vertical navigation shared by every FT Workspace module: one entry per
 * business domain. It shows full labels by default and can be collapsed to an
 * icon rail with tooltips; the choice is remembered per browser. With a
 * department layout, the person's own areas come first and the other areas
 * they may open sit under "Khác".
 */
export default function WorkspaceAppRail({ activeAreaId, canAccess, onSelect, layout = null }: WorkspaceAppRailProps) {
  const [compact, setCompact] = useState(() => readFlag(COMPACT_STORAGE_KEY));
  const [othersOpen, setOthersOpen] = useState(() => readFlag(OTHERS_STORAGE_KEY));
  const visibleAreas = WORKSPACE_AREAS.filter(canAccess);

  useEffect(() => { writeFlag(COMPACT_STORAGE_KEY, compact); }, [compact]);
  useEffect(() => { writeFlag(OTHERS_STORAGE_KEY, othersOpen); }, [othersOpen]);

  const renderItem = (area: WorkspaceArea) => {
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
  };

  let items: React.ReactNode;
  if (!layout) {
    items = visibleAreas.map(renderItem);
  } else {
    const home = visibleAreas.filter(area => area.id === 'workspace');
    const groups = groupByDepartment(visibleAreas.filter(area => area.id !== 'workspace'), area => area.id, layout);
    // The area being viewed is always reachable, even when "Khác" is folded.
    const showOthers = othersOpen || groups.others.some(area => area.id === activeAreaId);
    items = (
      <>
        {home.map(renderItem)}
        {groups.primary.length > 0 && <p className="ft-app-rail-group" title={layout.label}>{compact ? 'Bộ phận' : layout.label}</p>}
        {groups.primary.map(renderItem)}
        {groups.personal.length > 0 && <p className="ft-app-rail-group">Cá nhân</p>}
        {groups.personal.map(renderItem)}
        {groups.others.length > 0 && (
          <button
            type="button"
            className="ft-app-rail-more"
            onClick={() => setOthersOpen(!showOthers)}
            aria-expanded={showOthers}
            title={showOthers ? 'Thu gọn các khu khác' : 'Xem các khu khác'}
          >
            <span>{compact ? 'Khác' : `Khác (${groups.others.length})`}</span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform${showOthers ? ' rotate-180' : ''}`} aria-hidden="true" />
          </button>
        )}
        {showOthers && groups.others.map(renderItem)}
      </>
    );
  }

  return (
    <nav
      className={`ft-app-rail${compact ? ' is-compact' : ''}`}
      aria-label="Điều hướng lĩnh vực FT Workspace"
      data-compact={compact ? 'true' : 'false'}
    >
      <div className="ft-app-rail-brand">
        <img src="/logo.png" alt="FermatTech" />
      </div>
      <div className="ft-app-rail-items">{items}</div>
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
