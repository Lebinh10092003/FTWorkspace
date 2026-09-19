import React from 'react';
import type {
  BndcAlertSeverity,
  BndcConnectionStatus,
  BndcFolder,
  BndcOrganizationStatus,
  BndcPermissionRole,
  BndcPermissionSource,
  BndcSyncStatus,
  BndcUserStatus,
} from './types';
import {
  BNDC_CONNECTION_STATUS_LABELS,
  BNDC_ORGANIZATION_STATUS_LABELS,
  BNDC_PERMISSION_ROLE_LABELS,
  BNDC_SYNC_STATUS_LABELS,
  BNDC_USER_STATUS_LABELS,
} from './types';

export type ChipTone = 'green' | 'blue' | 'amber' | 'rose' | 'slate' | 'violet';

export function Chip({ tone = 'slate', children }: { tone?: ChipTone; children: React.ReactNode }) {
  return <span className={`bndc-chip bndc-chip-${tone}`}>{children}</span>;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'blue',
  onClick,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  tone?: ChipTone;
  onClick?: () => void;
}) {
  const iconTone: Record<ChipTone, string> = {
    green: 'text-emerald-600',
    blue: 'text-sky-600',
    amber: 'text-amber-600',
    rose: 'text-rose-600',
    slate: 'text-slate-500',
    violet: 'text-violet-600',
  };
  const body = (
    <>
      <span className="bndc-stat-head">
        <span>{label}</span>
        <Icon className={iconTone[tone]} aria-hidden="true" />
      </span>
      <b>{typeof value === 'number' ? value.toLocaleString('vi-VN') : value}</b>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="bndc-stat text-left transition hover:border-sky-300 hover:shadow-md">
      {body}
    </button>
  ) : (
    <div className="bndc-stat">{body}</div>
  );
}

export function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function OrganizationStatusChip({ status }: { status: BndcOrganizationStatus }) {
  const tone: Record<BndcOrganizationStatus, ChipTone> = { active: 'green', onboarding: 'blue', suspended: 'slate' };
  return <Chip tone={tone[status]}>{BNDC_ORGANIZATION_STATUS_LABELS[status]}</Chip>;
}

export function ConnectionStatusChip({ status }: { status: BndcConnectionStatus }) {
  const tone: Record<BndcConnectionStatus, ChipTone> = { connected: 'green', pending: 'amber', error: 'rose', disconnected: 'slate' };
  return <Chip tone={tone[status]}>{BNDC_CONNECTION_STATUS_LABELS[status]}</Chip>;
}

export function SyncStatusChip({ status }: { status: BndcSyncStatus }) {
  const tone: Record<BndcSyncStatus, ChipTone> = { synced: 'green', pending: 'amber', error: 'rose' };
  return <Chip tone={tone[status]}>{BNDC_SYNC_STATUS_LABELS[status]}</Chip>;
}

export function UserStatusChip({ status }: { status: BndcUserStatus }) {
  const tone: Record<BndcUserStatus, ChipTone> = { active: 'green', left: 'rose', transferred: 'amber' };
  return <Chip tone={tone[status]}>{BNDC_USER_STATUS_LABELS[status]}</Chip>;
}

export function RoleChip({ role }: { role: BndcPermissionRole }) {
  const tone: Record<BndcPermissionRole, ChipTone> = {
    content_manager: 'violet',
    contributor: 'blue',
    commenter: 'slate',
    viewer: 'slate',
    editor: 'amber',
  };
  return <Chip tone={tone[role]}>{BNDC_PERMISSION_ROLE_LABELS[role]}</Chip>;
}

export function SourceChip({ source }: { source: BndcPermissionSource }) {
  const label: Record<BndcPermissionSource, string> = { system: 'Hệ thống', inherited: 'Kế thừa', external: 'Ngoài hệ thống' };
  const tone: Record<BndcPermissionSource, ChipTone> = { system: 'blue', inherited: 'slate', external: 'rose' };
  return <Chip tone={tone[source]}>{label[source]}</Chip>;
}

export function SeverityChip({ severity }: { severity: BndcAlertSeverity }) {
  const label: Record<BndcAlertSeverity, string> = { high: 'Nghiêm trọng', medium: 'Trung bình', low: 'Thấp' };
  const tone: Record<BndcAlertSeverity, ChipTone> = { high: 'rose', medium: 'amber', low: 'slate' };
  return <Chip tone={tone[severity]}>{label[severity]}</Chip>;
}

/** Builds the "TH Trung Văn / Tổ chuyên môn / Tổ Toán / Khối 4" breadcrumb. */
export function folderPath(folders: BndcFolder[], folderId: string | null): BndcFolder[] {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const chain: BndcFolder[] = [];
  let current = folderId ? byId.get(folderId) || null : null;
  // The tree is capped at four levels, so the guard only protects against bad data.
  while (current && chain.length < 8) {
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) || null : null;
  }
  return chain;
}

export function folderPathLabel(folders: BndcFolder[], folderId: string | null, separator = ' / ') {
  const chain = folderPath(folders, folderId);
  return chain.length ? chain.map(folder => folder.name).join(separator) : '—';
}

export function EmptyState({ message }: { message: string }) {
  return <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-8 text-center text-sm font-semibold text-slate-500">{message}</p>;
}
