import React from 'react';
import ModuleTopNav from './ModuleTopNav';
import { ModuleNavItem } from '../../config/workspaceNavigation';

export type ModuleShellHeaderProps = {
  /** Module name, shown at the far left. The logo lives in the shared rail. */
  title: string;
  /** Optional small line above the title (breadcrumb / context). */
  eyebrow?: string;
  items: ModuleNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  ariaLabel?: string;
  /** Module-specific controls (search, "new" buttons) placed before the account menu. */
  actions?: React.ReactNode;
  account?: React.ReactNode;
};

/**
 * The single bar every module screen starts with: module name on the left, its
 * horizontal menu immediately to the right, then module actions and the account
 * menu. One frame, one logo (in the rail), so modules stop repeating chrome.
 */
export default function ModuleShellHeader({
  title,
  eyebrow,
  items,
  activeId,
  onSelect,
  ariaLabel,
  actions,
  account,
}: ModuleShellHeaderProps) {
  return (
    <header className="ft-module-bar">
      <div className="ft-module-bar-title">
        {eyebrow && <p className="ft-module-bar-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
      </div>
      <div className="ft-module-bar-nav">
        <ModuleTopNav items={items} activeId={activeId} onSelect={onSelect} ariaLabel={ariaLabel || `Điều hướng ${title}`} />
      </div>
      {actions && <div className="ft-module-bar-actions">{actions}</div>}
      {account && <div className="ft-module-bar-account">{account}</div>}
    </header>
  );
}
