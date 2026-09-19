import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, TriangleAlert } from 'lucide-react';
import type { BndcFolder } from './types';
import { Chip, SyncStatusChip } from './ui';

export type BndcFolderTreeProps = {
  folders: BndcFolder[];
  selectedId: string | null;
  onSelect: (folderId: string) => void;
};

/**
 * Tree view of a BNDC organisation. BNDC supports four levels, so the whole
 * tree stays small enough to render at once; expansion state is local.
 */
export default function BndcFolderTree({ folders, selectedId, onSelect }: BndcFolderTreeProps) {
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, BndcFolder[]>();
    folders.forEach(folder => {
      const key = folder.parentId;
      map.set(key, [...(map.get(key) || []), folder]);
    });
    return map;
  }, [folders]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (folderId: string) => setCollapsed(current => ({ ...current, [folderId]: !current[folderId] }));

  const renderRow = (folder: BndcFolder, depth: number): React.ReactNode => {
    const children = childrenByParent.get(folder.id) || [];
    const isCollapsed = Boolean(collapsed[folder.id]);
    const isActive = selectedId === folder.id;
    const Icon = children.length && !isCollapsed ? FolderOpen : Folder;
    return (
      <React.Fragment key={folder.id}>
        <div className="bndc-tree" style={{ paddingLeft: `${depth * 1.1}rem` }}>
          <div
            role="treeitem"
            aria-selected={isActive}
            aria-expanded={children.length ? !isCollapsed : undefined}
            className={`bndc-tree-row${isActive ? ' is-active' : ''}`}
            onClick={() => onSelect(folder.id)}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(folder.id);
              }
            }}
            tabIndex={0}
          >
            {children.length ? (
              <span
                className="bndc-tree-toggle"
                role="button"
                tabIndex={-1}
                aria-label={isCollapsed ? `Mở ${folder.name}` : `Thu gọn ${folder.name}`}
                onClick={event => {
                  event.stopPropagation();
                  toggle(folder.id);
                }}
              >
                {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </span>
            ) : (
              <span className="bndc-tree-toggle" aria-hidden="true" />
            )}
            <Icon className="h-4 w-4 shrink-0 text-sky-600" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="bndc-tree-name block truncate">{folder.name}</span>
              <span className="bndc-tree-meta block truncate">
                Cấp {folder.level} · {folder.googleFolderId} · {folder.permissionCount} quyền
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {folder.alertCount > 0 && (
                <Chip tone="rose">
                  <TriangleAlert className="h-3 w-3" aria-hidden="true" />
                  {folder.alertCount}
                </Chip>
              )}
              <SyncStatusChip status={folder.syncStatus} />
            </span>
          </div>
        </div>
        {!isCollapsed && children.map(child => renderRow(child, depth + 1))}
      </React.Fragment>
    );
  };

  const roots = childrenByParent.get(null) || [];
  if (!roots.length) return <p className="px-2 py-6 text-center text-sm font-semibold text-slate-500">Chưa có thư mục nào.</p>;

  return (
    <div role="tree" aria-label="Cấu trúc thư mục BNDC">
      {roots.map(root => renderRow(root, 0))}
    </div>
  );
}
