import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, FolderTree, Inbox, Search, ShieldCheck, TriangleAlert, Users } from 'lucide-react';
import bndcService from './bndcService';
import BndcOrganizationDetail, { BndcDetailTab } from './BndcOrganizationDetail';
import { BNDC_ROLE_GROUPS, bndcRole, bndcRoleForWorkspaceUser } from './roles';
import type { BndcOrganization, BndcOrganizationStatus, BndcOverviewStats } from './types';
import { BNDC_ORGANIZATION_STATUS_LABELS } from './types';
import { ConnectionStatusChip, EmptyState, OrganizationStatusChip, StatCard, formatDateTime } from './ui';

const DETAIL_TABS: BndcDetailTab[] = ['overview', 'folders', 'users', 'permissions', 'requests', 'alerts', 'logs'];

const BNDC_BASE_PATH = '/digital-training/quanlybndc';

type BndcRoute = { organizationId: string | null; tab: BndcDetailTab };

function readRoute(): BndcRoute {
  const segments = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/');
  // /digital-training/quanlybndc/<organizationId>/<tab>
  const organizationId = segments[2] || null;
  const tab = (DETAIL_TABS as string[]).includes(segments[3] || '') ? (segments[3] as BndcDetailTab) : 'overview';
  return { organizationId, tab };
}

export type BndcWorkspaceProps = {
  /** Workspace role of the signed-in account; mapped onto a BNDC role. */
  userRole?: string | null;
  idToken?: string;
};

/**
 * "Quản lý BNDC" — shared data space administration.
 *
 * Frontend demo: every read and write goes through `bndcService`, which is
 * currently backed by mock data and is ready to be pointed at the Google Drive
 * endpoints once the backend exposes them.
 */
export default function BndcWorkspace({ userRole, idToken }: BndcWorkspaceProps) {
  const roleId = useMemo(() => bndcRoleForWorkspaceUser(userRole), [userRole]);
  const role = bndcRole(roleId);

  const [organizations, setOrganizations] = useState<BndcOrganization[]>([]);
  const [stats, setStats] = useState<BndcOverviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | BndcOrganizationStatus>('all');
  const [route, setRoute] = useState<BndcRoute>(readRoute);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const [nextOrganizations, nextStats] = await Promise.all([
        bndcService.listOrganizations({ idToken }),
        bndcService.getOverviewStats({ idToken }),
      ]);
      setOrganizations(nextOrganizations);
      setStats(nextStats);
      setError('');
    } catch (loadError: any) {
      setError(loadError?.message || 'Không thể tải dữ liệu BNDC.');
    } finally {
      setLoading(false);
    }
  }, [idToken]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    const syncFromLocation = () => setRoute(readRoute());
    window.addEventListener('popstate', syncFromLocation);
    return () => window.removeEventListener('popstate', syncFromLocation);
  }, []);

  // The module menu can push a new path without a popstate event (for example
  // re-selecting "Quản lý BNDC" while a unit is open), so re-read it on render.
  const pathname = window.location.pathname;
  useEffect(() => setRoute(readRoute()), [pathname]);

  const navigate = (next: BndcRoute) => {
    setRoute(next);
    const path = next.organizationId
      ? `${BNDC_BASE_PATH}/${next.organizationId}${next.tab === 'overview' ? '' : `/${next.tab}`}`
      : BNDC_BASE_PATH;
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  };

  const filteredOrganizations = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return organizations.filter(organization => {
      const matchesKeyword = !needle
        || [organization.name, organization.code, organization.google_admin_email].join(' ').toLowerCase().includes(needle);
      const matchesStatus = statusFilter === 'all' || organization.status === statusFilter;
      return matchesKeyword && matchesStatus;
    });
  }, [keyword, organizations, statusFilter]);

  if (route.organizationId) {
    return (
      <BndcOrganizationDetail
        organizationId={route.organizationId}
        roleId={roleId}
        idToken={idToken}
        activeTab={route.tab}
        onTabChange={tab => navigate({ organizationId: route.organizationId, tab })}
        onBack={() => {
          navigate({ organizationId: null, tab: 'overview' });
          void loadList();
        }}
        onOrganizationChanged={updated => {
          setOrganizations(current => current.map(item => (item.id === updated.id ? updated : item)));
        }}
      />
    );
  }

  return (
    <section className="space-y-4">
      <header className="ft-page-header flex flex-wrap items-start justify-between gap-3 p-4 md:p-5">
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold uppercase tracking-[.14em] text-sky-600">Công nghệ &amp; Đào tạo số</p>
          <h2 className="text-xl font-extrabold text-[#0b4275]">Quản lý BNDC</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Quản trị không gian dữ liệu dùng chung của từng đơn vị: cấu trúc thư mục, phân quyền, cảnh báo và kết nối Google Drive riêng của đơn vị.
          </p>
        </div>
        {role && (
          <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-800">
            Vai trò: {role.label}
            <span className="mt-0.5 block font-semibold text-sky-700">
              {BNDC_ROLE_GROUPS.find(group => group.roles.some(item => item.id === role.id))?.label}
            </span>
          </p>
        )}
      </header>

      {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800">{error}</p>}

      {loading ? (
        <p className="py-16 text-center text-sm font-semibold text-slate-500">Đang tải dữ liệu BNDC...</p>
      ) : (
        <>
          <div className="bndc-stat-grid">
            <StatCard label="Tổng đơn vị đang quản lý" value={stats?.organizations ?? 0} icon={Building2} />
            <StatCard label="Tổng thư mục đang quản lý" value={stats?.folders ?? 0} icon={FolderTree} />
            <StatCard label="Tổng người dùng" value={stats?.users ?? 0} icon={Users} />
            <StatCard label="Số quyền đang hoạt động" value={stats?.activePermissions ?? 0} icon={ShieldCheck} tone="green" />
            <StatCard label="Số cảnh báo phân quyền" value={stats?.alerts ?? 0} icon={TriangleAlert} tone="rose" />
            <StatCard label="Số yêu cầu đang chờ xử lý" value={stats?.pendingRequests ?? 0} icon={Inbox} tone="amber" />
          </div>

          <div className="ft-surface rounded-2xl border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="ft-input-wrap flex min-w-[16rem] flex-1 items-center gap-2 px-3">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  value={keyword}
                  onChange={event => setKeyword(event.currentTarget.value)}
                  placeholder="Tìm kiếm đơn vị theo tên, mã hoặc email quản trị"
                  className="w-full bg-transparent py-2 text-sm outline-none"
                  aria-label="Tìm kiếm đơn vị"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                Trạng thái
                <select
                  value={statusFilter}
                  onChange={event => setStatusFilter(event.currentTarget.value as 'all' | BndcOrganizationStatus)}
                  className="ws-input w-auto py-2 text-xs"
                >
                  <option value="all">Tất cả</option>
                  {(Object.keys(BNDC_ORGANIZATION_STATUS_LABELS) as BndcOrganizationStatus[]).map(status => (
                    <option key={status} value={status}>{BNDC_ORGANIZATION_STATUS_LABELS[status]}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="ft-table min-w-[900px]">
                <thead>
                  <tr>
                    <th>Đơn vị</th>
                    <th>Trạng thái</th>
                    <th>Người dùng</th>
                    <th>Thư mục</th>
                    <th>Cảnh báo</th>
                    <th>Kết nối Google</th>
                    <th>Đồng bộ gần nhất</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrganizations.map(organization => (
                    <tr
                      key={organization.id}
                      onClick={() => navigate({ organizationId: organization.id, tab: 'overview' })}
                      className="cursor-pointer"
                    >
                      <td>
                        <b className="text-[#0b4275]">{organization.name}</b>
                        <p className="mt-0.5 text-xs text-slate-500">{organization.code}</p>
                      </td>
                      <td><OrganizationStatusChip status={organization.status} /></td>
                      <td className="text-center font-bold">{organization.userCount}</td>
                      <td className="text-center font-bold">{organization.folderCount}</td>
                      <td className="text-center font-bold">
                        <span className={organization.alertCount ? 'text-rose-600' : 'text-slate-400'}>{organization.alertCount}</span>
                      </td>
                      <td>
                        <ConnectionStatusChip status={organization.connection_status} />
                        <p className="mt-1 break-all text-[11px] text-slate-500">{organization.google_admin_email}</p>
                      </td>
                      <td className="text-xs">{formatDateTime(organization.last_sync_at)}</td>
                    </tr>
                  ))}
                  {!filteredOrganizations.length && (
                    <tr><td colSpan={7} className="py-6 text-center text-sm font-semibold text-slate-500">Không tìm thấy đơn vị phù hợp.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {!organizations.length && <EmptyState message="Chưa có đơn vị nào được kết nối BNDC." />}
          </div>
        </>
      )}
    </section>
  );
}
