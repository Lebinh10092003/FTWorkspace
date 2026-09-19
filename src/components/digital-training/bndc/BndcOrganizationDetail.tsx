import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BellRing,
  FileClock,
  FolderTree,
  Inbox,
  LayoutDashboard,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { appDialog } from '../../AppDialog';
import bndcService from './bndcService';
import BndcFolderTree from './BndcFolderTree';
import { hasBndcCapability } from './roles';
import type {
  BndcAlert,
  BndcFolder,
  BndcLogEntry,
  BndcOrganization,
  BndcPermission,
  BndcPermissionRole,
  BndcRequest,
  BndcUser,
} from './types';
import {
  BNDC_ALERT_TYPE_LABELS,
  BNDC_PERMISSION_ROLE_LABELS,
  BNDC_REQUEST_KIND_LABELS,
} from './types';
import {
  Chip,
  ConnectionStatusChip,
  EmptyState,
  OrganizationStatusChip,
  RoleChip,
  SeverityChip,
  SourceChip,
  StatCard,
  SyncStatusChip,
  UserStatusChip,
  folderPathLabel,
  formatDateTime,
} from './ui';

export type BndcDetailTab = 'overview' | 'folders' | 'users' | 'permissions' | 'requests' | 'alerts' | 'logs';

const DETAIL_TABS: { id: BndcDetailTab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'folders', label: 'Cấu trúc thư mục', icon: FolderTree },
  { id: 'users', label: 'Người dùng', icon: Users },
  { id: 'permissions', label: 'Phân quyền', icon: ShieldCheck },
  { id: 'requests', label: 'Yêu cầu', icon: Inbox },
  { id: 'alerts', label: 'Cảnh báo', icon: BellRing },
  { id: 'logs', label: 'Nhật ký', icon: FileClock },
];

const ASSIGNABLE_ROLES: BndcPermissionRole[] = ['content_manager', 'contributor', 'commenter', 'viewer'];

export type BndcOrganizationDetailProps = {
  organizationId: string;
  roleId: string;
  idToken?: string;
  activeTab: BndcDetailTab;
  onTabChange: (tab: BndcDetailTab) => void;
  onBack: () => void;
  onOrganizationChanged?: (organization: BndcOrganization) => void;
};

export default function BndcOrganizationDetail({
  organizationId,
  roleId,
  idToken,
  activeTab,
  onTabChange,
  onBack,
  onOrganizationChanged,
}: BndcOrganizationDetailProps) {
  const [organization, setOrganization] = useState<BndcOrganization | null>(null);
  const [folders, setFolders] = useState<BndcFolder[]>([]);
  const [users, setUsers] = useState<BndcUser[]>([]);
  const [permissions, setPermissions] = useState<BndcPermission[]>([]);
  const [alerts, setAlerts] = useState<BndcAlert[]>([]);
  const [requests, setRequests] = useState<BndcRequest[]>([]);
  const [logs, setLogs] = useState<BndcLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState('');

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [permissionFilter, setPermissionFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');

  const can = (capability: Parameters<typeof hasBndcCapability>[1]) => hasBndcCapability(roleId, capability);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const options = { idToken };
    Promise.all([
      bndcService.getOrganization(organizationId, options),
      bndcService.listFolders(organizationId, options),
      bndcService.listUsers(organizationId, options),
      bndcService.listPermissions(organizationId, options),
      bndcService.listAlerts(organizationId, options),
      bndcService.listRequests(organizationId, options),
      bndcService.listLogs(organizationId, options),
    ])
      .then(([nextOrganization, nextFolders, nextUsers, nextPermissions, nextAlerts, nextRequests, nextLogs]) => {
        if (!active) return;
        setOrganization(nextOrganization);
        setFolders(nextFolders);
        setUsers(nextUsers);
        setPermissions(nextPermissions);
        setAlerts(nextAlerts);
        setRequests(nextRequests);
        setLogs(nextLogs);
        setSelectedFolderId(current => current || nextFolders.find(folder => folder.level === 1)?.id || null);
      })
      .catch((error: any) => {
        if (active) setNotice(error?.message || 'Không thể tải dữ liệu đơn vị.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [organizationId, idToken]);

  const selectedFolder = useMemo(
    () => folders.find(folder => folder.id === selectedFolderId) || null,
    [folders, selectedFolderId],
  );
  const folderPermissions = useMemo(
    () => permissions.filter(permission => permission.folderId === selectedFolderId),
    [permissions, selectedFolderId],
  );
  const selectedUser = useMemo(() => users.find(user => user.id === selectedUserId) || null, [users, selectedUserId]);
  const selectedUserPermissions = useMemo(
    () =>
      selectedUser
        ? permissions.filter(permission => permission.email.toLowerCase() === selectedUser.email.toLowerCase())
        : [],
    [permissions, selectedUser],
  );
  const openAlerts = useMemo(() => alerts.filter(alert => alert.status === 'open'), [alerts]);
  const pendingRequests = useMemo(() => requests.filter(item => item.status === 'pending'), [requests]);

  const filteredPermissions = useMemo(() => {
    const keyword = permissionFilter.trim().toLowerCase();
    if (!keyword) return permissions;
    return permissions.filter(permission =>
      [permission.displayName, permission.email, folderPathLabel(folders, permission.folderId)]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    );
  }, [folders, permissionFilter, permissions]);

  const filteredUsers = useMemo(() => {
    const keyword = userFilter.trim().toLowerCase();
    if (!keyword) return users;
    return users.filter(user => [user.fullName, user.email, user.department].join(' ').toLowerCase().includes(keyword));
  }, [userFilter, users]);

  const reloadPermissions = async () => {
    const [nextPermissions, nextFolders, nextUsers, nextLogs] = await Promise.all([
      bndcService.listPermissions(organizationId, { idToken }),
      bndcService.listFolders(organizationId, { idToken }),
      bndcService.listUsers(organizationId, { idToken }),
      bndcService.listLogs(organizationId, { idToken }),
    ]);
    setPermissions(nextPermissions);
    setFolders(nextFolders);
    setUsers(nextUsers);
    setLogs(nextLogs);
    const refreshed = await bndcService.getOrganization(organizationId, { idToken });
    if (refreshed) {
      setOrganization(refreshed);
      onOrganizationChanged?.(refreshed);
    }
  };

  const addPerson = async () => {
    if (!selectedFolder) return;
    const email = await appDialog.prompt(`Nhập email cần cấp quyền vào "${selectedFolder.name}".`, {
      title: 'Thêm người vào thư mục',
      placeholder: 'ten@donvi.edu.vn',
      inputType: 'email',
      confirmText: 'Tiếp tục',
    });
    if (!email || !email.trim()) return;
    const role = await appDialog.prompt(
      `Chọn quyền cho ${email.trim()}:\n${ASSIGNABLE_ROLES.map((item, index) => `${index + 1}. ${BNDC_PERMISSION_ROLE_LABELS[item]}`).join('\n')}`,
      { title: 'Chọn quyền', defaultValue: '2', placeholder: '1 - 4', confirmText: 'Cấp quyền' },
    );
    const index = Number(role) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= ASSIGNABLE_ROLES.length) return;
    await bndcService.grantPermission(
      { organizationId, folderId: selectedFolder.id, email: email.trim(), role: ASSIGNABLE_ROLES[index] },
      { idToken },
    );
    await reloadPermissions();
    setNotice(`Đã cấp quyền cho ${email.trim()}.`);
  };

  const changeRole = async (permission: BndcPermission, role: BndcPermissionRole) => {
    await bndcService.changePermissionRole(permission.id, role, { idToken });
    await reloadPermissions();
    setNotice(`Đã đổi quyền của ${permission.email}.`);
  };

  const revokeOne = async (permission: BndcPermission) => {
    const confirmed = await appDialog.confirm(
      `Thu hồi quyền "${BNDC_PERMISSION_ROLE_LABELS[permission.role]}" của ${permission.email} tại thư mục này?`,
      { title: 'Thu hồi quyền', tone: 'danger', confirmText: 'Thu hồi' },
    );
    if (!confirmed) return;
    await bndcService.revokePermission(permission.id, { idToken });
    await reloadPermissions();
    setNotice(`Đã thu hồi quyền của ${permission.email}.`);
  };

  const revokeAll = async (email: string) => {
    const confirmed = await appDialog.confirm(
      `Thu hồi toàn bộ quyền của ${email} trên mọi thư mục của đơn vị này?`,
      { title: 'Thu hồi toàn bộ quyền', tone: 'danger', confirmText: 'Thu hồi tất cả' },
    );
    if (!confirmed) return;
    const result = await bndcService.revokeAllForEmail(organizationId, email, { idToken });
    await reloadPermissions();
    setNotice(`Đã thu hồi ${result.removed} quyền của ${email}.`);
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const updated = await bndcService.syncOrganization(organizationId, { idToken });
      if (updated) {
        setOrganization(updated);
        onOrganizationChanged?.(updated);
      }
      const [nextFolders, nextLogs] = await Promise.all([
        bndcService.listFolders(organizationId, { idToken }),
        bndcService.listLogs(organizationId, { idToken }),
      ]);
      setFolders(nextFolders);
      setLogs(nextLogs);
      setNotice('Đã gửi yêu cầu đồng bộ với Google Drive của đơn vị.');
    } catch (error: any) {
      setNotice(error?.message || 'Không thể đồng bộ với Google Drive.');
    } finally {
      setSyncing(false);
    }
  };

  const resolveAlert = async (alert: BndcAlert) => {
    await bndcService.resolveAlert(alert.id, { idToken });
    const [nextAlerts, nextFolders, nextLogs] = await Promise.all([
      bndcService.listAlerts(organizationId, { idToken }),
      bndcService.listFolders(organizationId, { idToken }),
      bndcService.listLogs(organizationId, { idToken }),
    ]);
    setAlerts(nextAlerts);
    setFolders(nextFolders);
    setLogs(nextLogs);
    const refreshed = await bndcService.getOrganization(organizationId, { idToken });
    if (refreshed) {
      setOrganization(refreshed);
      onOrganizationChanged?.(refreshed);
    }
    setNotice('Đã đánh dấu cảnh báo là đã xử lý.');
  };

  const decideRequest = async (item: BndcRequest, decision: 'approved' | 'rejected') => {
    await bndcService.decideRequest(item.id, decision, { idToken });
    const [nextRequests, nextLogs] = await Promise.all([
      bndcService.listRequests(organizationId, { idToken }),
      bndcService.listLogs(organizationId, { idToken }),
    ]);
    setRequests(nextRequests);
    setLogs(nextLogs);
    const refreshed = await bndcService.getOrganization(organizationId, { idToken });
    if (refreshed) {
      setOrganization(refreshed);
      onOrganizationChanged?.(refreshed);
    }
    setNotice(decision === 'approved' ? 'Đã duyệt yêu cầu.' : 'Đã từ chối yêu cầu.');
  };

  if (loading) return <p className="py-16 text-center text-sm font-semibold text-slate-500">Đang tải dữ liệu đơn vị...</p>;
  if (!organization) return <EmptyState message="Không tìm thấy đơn vị." />;

  return (
    <section className="space-y-4">
      <header className="ft-page-header flex flex-wrap items-start justify-between gap-3 p-4 md:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <button type="button" onClick={onBack} className="ft-btn ft-btn-secondary shrink-0" aria-label="Quay lại danh sách đơn vị">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-[.14em] text-sky-600">Quản lý BNDC</p>
            <h2 className="truncate text-xl font-extrabold text-[#0b4275]">{organization.name}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
              <span>Mã đơn vị: {organization.code}</span>
              <OrganizationStatusChip status={organization.status} />
              <ConnectionStatusChip status={organization.connection_status} />
            </p>
          </div>
        </div>
        {can('google.sync') && (
          <button type="button" onClick={syncNow} disabled={syncing} className="ft-btn ft-btn-primary">
            <RefreshCw className={`h-4 w-4${syncing ? ' animate-spin' : ''}`} />
            {syncing ? 'Đang đồng bộ...' : 'Đồng bộ Google Drive'}
          </button>
        )}
      </header>

      {notice && (
        <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-800">{notice}</p>
      )}

      <nav className="ft-toolbar flex flex-wrap gap-1.5 p-2" aria-label="Nội dung đơn vị">
        {DETAIL_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const badge =
            tab.id === 'alerts' ? openAlerts.length : tab.id === 'requests' ? pendingRequests.length : 0;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition ${
                isActive ? 'bg-sky-100 text-sky-800 ring-1 ring-sky-300' : 'text-slate-600 hover:bg-sky-50 hover:text-sky-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              {badge > 0 && <span className="rounded-full bg-rose-100 px-1.5 text-[10px] font-extrabold text-rose-700">{badge}</span>}
            </button>
          );
        })}
      </nav>

      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="ft-surface rounded-2xl border p-4 md:p-5">
            <h3 className="text-sm font-extrabold text-[#0b4275]">Thông tin chung</h3>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[
                { label: 'Tên đơn vị', value: organization.name },
                { label: 'Mã đơn vị', value: organization.code },
                { label: 'Email quản trị Google', value: organization.google_admin_email },
                { label: 'Google Drive/BNDC đang kết nối', value: organization.google_drive_id },
                { label: 'Mã kết nối', value: organization.google_connection_id },
                { label: 'Lần đồng bộ gần nhất', value: formatDateTime(organization.last_sync_at) },
              ].map(field => (
                <div key={field.label} className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                  <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{field.label}</dt>
                  <dd className="mt-1 break-all text-sm font-bold text-[#17324d]">{field.value}</dd>
                </div>
              ))}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Trạng thái kết nối</dt>
                <dd className="mt-1.5"><ConnectionStatusChip status={organization.connection_status} /></dd>
              </div>
            </dl>
          </div>

          <div className="bndc-stat-grid">
            <StatCard label="Thư mục đang quản lý" value={organization.folderCount} icon={FolderTree} />
            <StatCard label="Người dùng" value={organization.userCount} icon={Users} />
            <StatCard label="Quyền đang hoạt động" value={permissions.length} icon={ShieldCheck} tone="green" />
            <StatCard label="Cảnh báo phân quyền" value={openAlerts.length} icon={TriangleAlert} tone="rose" onClick={() => onTabChange('alerts')} />
            <StatCard label="Yêu cầu chờ xử lý" value={pendingRequests.length} icon={Inbox} tone="amber" onClick={() => onTabChange('requests')} />
          </div>

          <div className="ft-surface rounded-2xl border p-4 md:p-5">
            <h3 className="text-sm font-extrabold text-[#0b4275]">Hoạt động gần đây</h3>
            <ul className="mt-3 space-y-2">
              {logs.slice(0, 5).map(entry => (
                <li key={entry.id} className="rounded-xl border border-slate-200 px-3 py-2.5">
                  <p className="text-sm font-bold text-[#17324d]">{entry.action} · {entry.target}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{entry.detail}</p>
                  <p className="mt-1 text-[11px] font-semibold text-slate-400">{entry.actor} · {formatDateTime(entry.at)}</p>
                </li>
              ))}
              {!logs.length && <EmptyState message="Chưa có hoạt động nào." />}
            </ul>
          </div>
        </div>
      )}

      {activeTab === 'folders' && (
        <div className="bndc-split">
          <div className="ft-surface rounded-2xl border p-3 md:p-4">
            <h3 className="px-1 pb-2 text-sm font-extrabold text-[#0b4275]">Cấu trúc thư mục (tối đa 4 cấp)</h3>
            <BndcFolderTree folders={folders} selectedId={selectedFolderId} onSelect={setSelectedFolderId} />
          </div>
          <div className="ft-surface rounded-2xl border p-4">
            {selectedFolder ? (
              <>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  {folderPathLabel(folders, selectedFolder.id)}
                </p>
                <h3 className="mt-1 text-lg font-extrabold text-[#0b4275]">{selectedFolder.name}</h3>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[
                    { label: 'Cấp thư mục', value: `Cấp ${selectedFolder.level}` },
                    { label: 'Google Folder ID', value: selectedFolder.googleFolderId },
                    { label: 'Số người có quyền', value: String(selectedFolder.permissionCount) },
                    { label: 'Số cảnh báo', value: String(selectedFolder.alertCount) },
                    { label: 'Đồng bộ gần nhất', value: formatDateTime(selectedFolder.lastSyncAt) },
                  ].map(field => (
                    <div key={field.label} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                      <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{field.label}</dt>
                      <dd className="mt-0.5 break-all text-sm font-bold text-[#17324d]">{field.value}</dd>
                    </div>
                  ))}
                  <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                    <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Trạng thái đồng bộ</dt>
                    <dd className="mt-1"><SyncStatusChip status={selectedFolder.syncStatus} /></dd>
                  </div>
                </dl>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-extrabold text-[#0b4275]">Phân quyền thư mục</h4>
                  {can('permission.grant') && (
                    <button type="button" onClick={addPerson} className="ft-btn ft-btn-secondary text-xs">
                      <UserPlus className="h-4 w-4" />Thêm người
                    </button>
                  )}
                </div>
                <div className="mt-2 overflow-x-auto">
                  <table className="ft-table min-w-[620px]">
                    <thead>
                      <tr><th>Người dùng</th><th>Email</th><th>Quyền</th><th>Nguồn quyền</th><th>Trạng thái</th><th>Thao tác</th></tr>
                    </thead>
                    <tbody>
                      {folderPermissions.map(permission => (
                        <tr key={permission.id}>
                          <td className="font-bold text-[#17324d]">{permission.displayName}</td>
                          <td className="break-all text-xs">{permission.email}</td>
                          <td>
                            {can('permission.grant') && permission.source !== 'inherited' ? (
                              <select
                                value={ASSIGNABLE_ROLES.includes(permission.role) ? permission.role : ''}
                                onChange={event => void changeRole(permission, event.currentTarget.value as BndcPermissionRole)}
                                className="ws-input max-w-[12rem] py-1.5 text-xs"
                                aria-label={`Quyền của ${permission.email}`}
                              >
                                {!ASSIGNABLE_ROLES.includes(permission.role) && (
                                  <option value="">{BNDC_PERMISSION_ROLE_LABELS[permission.role]}</option>
                                )}
                                {ASSIGNABLE_ROLES.map(role => (
                                  <option key={role} value={role}>{BNDC_PERMISSION_ROLE_LABELS[role]}</option>
                                ))}
                              </select>
                            ) : (
                              <RoleChip role={permission.role} />
                            )}
                          </td>
                          <td><SourceChip source={permission.source} /></td>
                          <td>
                            {permission.status === 'warning' ? <Chip tone="rose">Cảnh báo</Chip> : <Chip tone="green">Bình thường</Chip>}
                          </td>
                          <td>
                            <div className="flex flex-wrap gap-1.5">
                              {can('permission.revoke') && (
                                <button type="button" onClick={() => void revokeOne(permission)} className="ws-bulk-btn text-rose-700">
                                  Thu hồi
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setPermissionFilter(permission.email);
                                  onTabChange('permissions');
                                }}
                                className="ws-bulk-btn"
                              >
                                Xem quyền
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!folderPermissions.length && (
                        <tr><td colSpan={6} className="py-6 text-center text-sm font-semibold text-slate-500">Thư mục này chưa có quyền nào.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <EmptyState message="Chọn một thư mục để xem chi tiết." />
            )}
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="bndc-split">
          <div className="ft-surface rounded-2xl border p-4">
            <div className="ft-input-wrap mb-3 flex items-center gap-2 px-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={userFilter}
                onChange={event => setUserFilter(event.currentTarget.value)}
                placeholder="Tìm theo họ tên, email hoặc bộ phận"
                className="w-full bg-transparent py-2 text-sm outline-none"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="ft-table min-w-[560px]">
                <thead><tr><th>Họ tên</th><th>Email</th><th>Bộ phận</th><th>Trạng thái</th><th>Số quyền</th></tr></thead>
                <tbody>
                  {filteredUsers.map(user => (
                    <tr
                      key={user.id}
                      onClick={() => setSelectedUserId(user.id)}
                      className={`cursor-pointer ${selectedUserId === user.id ? 'bg-sky-50' : ''}`}
                    >
                      <td className="font-bold text-[#17324d]">{user.fullName}</td>
                      <td className="break-all text-xs">{user.email}</td>
                      <td>{user.department}</td>
                      <td><UserStatusChip status={user.status} /></td>
                      <td className="text-center font-bold">{user.permissionCount}</td>
                    </tr>
                  ))}
                  {!filteredUsers.length && (
                    <tr><td colSpan={5} className="py-6 text-center text-sm font-semibold text-slate-500">Không tìm thấy người dùng phù hợp.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="ft-surface rounded-2xl border p-4">
            {selectedUser ? (
              <>
                <h3 className="text-lg font-extrabold text-[#0b4275]">{selectedUser.fullName}</h3>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                  <Mail className="h-3.5 w-3.5" />
                  <span className="break-all">{selectedUser.email}</span>
                  <UserStatusChip status={selectedUser.status} />
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-500">Bộ phận: {selectedUser.department}</p>

                <h4 className="mt-4 text-sm font-extrabold text-[#0b4275]">Người này đang có quyền tại đâu?</h4>
                <ul className="mt-2 space-y-2">
                  {selectedUserPermissions.map(permission => (
                    <li key={permission.id} className="rounded-xl border border-slate-200 px-3 py-2.5">
                      <p className="text-xs font-bold text-[#17324d]">{folderPathLabel(folders, permission.folderId, ' → ')}</p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <RoleChip role={permission.role} />
                        <SourceChip source={permission.source} />
                      </p>
                    </li>
                  ))}
                  {!selectedUserPermissions.length && <EmptyState message="Người dùng này không còn quyền nào." />}
                </ul>

                {can('permission.revoke_all') && selectedUserPermissions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void revokeAll(selectedUser.email)}
                    className="ft-btn ft-btn-danger mt-4 w-full"
                  >
                    <UserMinus className="h-4 w-4" />Thu hồi toàn bộ quyền
                  </button>
                )}
              </>
            ) : (
              <EmptyState message="Chọn một người dùng để xem quyền của họ." />
            )}
          </div>
        </div>
      )}

      {activeTab === 'permissions' && (
        <div className="ft-surface rounded-2xl border p-4">
          <div className="ft-input-wrap mb-3 flex items-center gap-2 px-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={permissionFilter}
              onChange={event => setPermissionFilter(event.currentTarget.value)}
              placeholder="Tìm theo người dùng, email hoặc thư mục"
              className="w-full bg-transparent py-2 text-sm outline-none"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="ft-table min-w-[900px]">
              <thead>
                <tr><th>Người dùng</th><th>Email</th><th>Thư mục</th><th>Quyền</th><th>Nguồn quyền</th><th>Trạng thái</th><th>Thao tác</th></tr>
              </thead>
              <tbody>
                {filteredPermissions.map(permission => (
                  <tr key={permission.id}>
                    <td className="font-bold text-[#17324d]">{permission.displayName}</td>
                    <td className="break-all text-xs">{permission.email}</td>
                    <td className="text-xs">{folderPathLabel(folders, permission.folderId, ' / ')}</td>
                    <td><RoleChip role={permission.role} /></td>
                    <td><SourceChip source={permission.source} /></td>
                    <td>{permission.status === 'warning' ? <Chip tone="rose">Cảnh báo</Chip> : <Chip tone="green">Bình thường</Chip>}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFolderId(permission.folderId);
                            onTabChange('folders');
                          }}
                          className="ws-bulk-btn"
                        >
                          Mở thư mục
                        </button>
                        {can('permission.revoke') && (
                          <button type="button" onClick={() => void revokeOne(permission)} className="ws-bulk-btn text-rose-700">Thu hồi</button>
                        )}
                        {can('permission.revoke_all') && (
                          <button type="button" onClick={() => void revokeAll(permission.email)} className="ws-bulk-btn text-rose-700">Thu hồi tất cả</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!filteredPermissions.length && (
                  <tr><td colSpan={7} className="py-6 text-center text-sm font-semibold text-slate-500">Không có quyền nào khớp bộ lọc.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'requests' && (
        <div className="ft-surface rounded-2xl border p-4">
          <div className="overflow-x-auto">
            <table className="ft-table min-w-[760px]">
              <thead><tr><th>Loại yêu cầu</th><th>Người gửi</th><th>Đối tượng</th><th>Thư mục</th><th>Thời gian</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
              <tbody>
                {requests.map(item => (
                  <tr key={item.id}>
                    <td className="font-bold text-[#17324d]">{BNDC_REQUEST_KIND_LABELS[item.kind]}</td>
                    <td>{item.requester}</td>
                    <td className="break-all text-xs">{item.target}</td>
                    <td className="text-xs">{item.folderId ? folderPathLabel(folders, item.folderId) : '—'}</td>
                    <td className="text-xs">{formatDateTime(item.createdAt)}</td>
                    <td>
                      {item.status === 'pending' ? <Chip tone="amber">Chờ xử lý</Chip> : item.status === 'approved' ? <Chip tone="green">Đã duyệt</Chip> : <Chip tone="slate">Đã từ chối</Chip>}
                    </td>
                    <td>
                      {item.status === 'pending' && can('request.approve') ? (
                        <div className="flex flex-wrap gap-1.5">
                          <button type="button" onClick={() => void decideRequest(item, 'approved')} className="ws-bulk-btn text-emerald-700">Duyệt</button>
                          <button type="button" onClick={() => void decideRequest(item, 'rejected')} className="ws-bulk-btn text-rose-700">Từ chối</button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">{item.note}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!requests.length && (
                  <tr><td colSpan={7} className="py-6 text-center text-sm font-semibold text-slate-500">Không có yêu cầu nào.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'alerts' && (
        <div className="space-y-3">
          {alerts.map(alert => (
            <article
              key={alert.id}
              className={`ft-surface rounded-2xl border p-4 ${alert.status === 'resolved' ? 'opacity-70' : ''}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <Chip tone="rose"><TriangleAlert className="h-3 w-3" />Cảnh báo</Chip>
                    <SeverityChip severity={alert.severity} />
                    {alert.status === 'resolved' && <Chip tone="green">Đã xử lý</Chip>}
                  </p>
                  <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                    {folderPathLabel(folders, alert.folderId)}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm font-extrabold text-[#17324d]">
                    <span className="break-all">{alert.email}</span>
                    <RoleChip role={alert.role} />
                  </p>
                  <p className="mt-1.5 text-xs font-semibold text-slate-600">
                    Loại: {BNDC_ALERT_TYPE_LABELS[alert.type]}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{alert.note}</p>
                  <p className="mt-1 text-[11px] font-semibold text-slate-400">Phát hiện: {formatDateTime(alert.detectedAt)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFolderId(alert.folderId);
                      onTabChange('folders');
                    }}
                    className="ft-btn ft-btn-secondary text-xs"
                  >
                    Chi tiết
                  </button>
                  {alert.status === 'open' && can('alert.resolve') && (
                    <button type="button" onClick={() => void resolveAlert(alert)} className="ft-btn ft-btn-danger text-xs">
                      Thu hồi
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
          {!alerts.length && <EmptyState message="Đơn vị này không có cảnh báo phân quyền." />}
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="ft-surface rounded-2xl border p-4">
          <ul className="space-y-2">
            {logs.map(entry => (
              <li key={entry.id} className="rounded-xl border border-slate-200 px-3 py-2.5">
                <p className="text-sm font-bold text-[#17324d]">{entry.action} · {entry.target}</p>
                <p className="mt-0.5 text-xs text-slate-500">{entry.detail}</p>
                <p className="mt-1 text-[11px] font-semibold text-slate-400">{entry.actor} · {formatDateTime(entry.at)}</p>
              </li>
            ))}
            {!logs.length && <EmptyState message="Chưa có nhật ký nào." />}
          </ul>
        </div>
      )}
    </section>
  );
}
