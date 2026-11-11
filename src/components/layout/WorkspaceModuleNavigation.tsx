import { createContext } from 'react';
import type { ModuleNavItem, WorkspaceAreaId } from '../../config/workspaceNavigation';

export type WorkspaceModuleNavigation = {
  areaId: WorkspaceAreaId | null;
  items: ModuleNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
};

// Register the actual menu rendered by each module, including its permissions
// and navigation handlers, rather than maintaining a second list in the rail.
export const WorkspaceModuleContext = createContext<{
  areaId: WorkspaceAreaId | null;
  areaTitle: string;
  areaPath: string;
  goHome: () => void;
  register: (navigation: WorkspaceModuleNavigation | null) => void;
} | null>(null);
