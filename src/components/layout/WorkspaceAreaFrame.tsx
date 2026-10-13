import React from 'react';
import WorkspaceAppRail from './WorkspaceAppRail';
import { WorkspaceArea, WorkspaceAreaId } from '../../config/workspaceNavigation';
import type { DepartmentLayout } from '../../config/departmentLayout';

export type WorkspaceAreaFrameProps = {
  activeAreaId: WorkspaceAreaId | null;
  canAccess: (area: WorkspaceArea) => boolean;
  onSelect: (area: WorkspaceArea) => void;
  layout?: DepartmentLayout | null;
  children: React.ReactNode;
};

/**
 * Wraps a module screen with the shared vertical rail so users can switch
 * between domains without returning to the Workspace launcher. The rail is
 * fixed; the frame reserves its width through CSS, which keeps every existing
 * module layout (sticky and fixed sidebars alike) working unchanged.
 */
export default function WorkspaceAreaFrame({ activeAreaId, canAccess, onSelect, layout = null, children }: WorkspaceAreaFrameProps) {
  return (
    <div className="ft-workspace-frame">
      <WorkspaceAppRail activeAreaId={activeAreaId} canAccess={canAccess} onSelect={onSelect} layout={layout} />
      <div className="ft-workspace-frame-body">{children}</div>
    </div>
  );
}
