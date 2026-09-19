import {
  BNDC_MOCK_ALERTS,
  BNDC_MOCK_FOLDERS,
  BNDC_MOCK_LOGS,
  BNDC_MOCK_ORGANIZATIONS,
  BNDC_MOCK_PERMISSIONS,
  BNDC_MOCK_REQUESTS,
  BNDC_MOCK_USERS,
} from './mockData';
import type {
  BndcAlert,
  BndcFolder,
  BndcLogEntry,
  BndcOrganization,
  BndcOverviewStats,
  BndcPermission,
  BndcPermissionRole,
  BndcRequest,
  BndcUser,
} from './types';

/**
 * Data access layer for BNDC.
 *
 * Every screen talks to this module only. While `BNDC_USE_MOCK` is true the
 * calls resolve against the in-memory demo dataset; once the Django endpoints
 * exist, each method swaps its body for a `request(...)` call and the UI stays
 * untouched. Mutations already return the updated rows so optimistic rendering
 * keeps working either way.
 */

export const BNDC_API_BASE = '/api/digital-training/bndc';
export const BNDC_USE_MOCK = true;

export type BndcRequestOptions = { idToken?: string };

/** Shared fetch helper kept ready for the real endpoints. */
async function request<T>(path: string, options: RequestInit & BndcRequestOptions = {}): Promise<T> {
  const { idToken, headers, ...rest } = options;
  const response = await fetch(`${BNDC_API_BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...(headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as any)?.error || 'Không thể tải dữ liệu BNDC.');
  }
  return response.json() as Promise<T>;
}

/** Keeps demo interactions asynchronous so screens exercise their loading paths. */
const delay = <T>(value: T, ms = 140): Promise<T> =>
  new Promise(resolve => window.setTimeout(() => resolve(value), ms));

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Mutable copies so demo actions (grant / revoke / sync) are visible. */
let organizations: BndcOrganization[] = clone(BNDC_MOCK_ORGANIZATIONS);
let folders: BndcFolder[] = clone(BNDC_MOCK_FOLDERS);
let users: BndcUser[] = clone(BNDC_MOCK_USERS);
let permissions: BndcPermission[] = clone(BNDC_MOCK_PERMISSIONS);
let alerts: BndcAlert[] = clone(BNDC_MOCK_ALERTS);
let requests: BndcRequest[] = clone(BNDC_MOCK_REQUESTS);
let logs: BndcLogEntry[] = clone(BNDC_MOCK_LOGS);

let permissionSequence = permissions.length;
let logSequence = logs.length;

function pushLog(organizationId: string, actor: string, action: string, target: string, detail: string) {
  logSequence += 1;
  logs = [
    {
      id: `lg-${String(logSequence).padStart(3, '0')}`,
      organizationId,
      actor,
      action,
      target,
      at: new Date().toISOString(),
      detail,
    },
    ...logs,
  ];
}

function recountOrganization(organizationId: string) {
  organizations = organizations.map(organization => {
    if (organization.id !== organizationId) return organization;
    const organizationPermissions = permissions.filter(item => item.organizationId === organizationId);
    return {
      ...organization,
      permissionCount: organizationPermissions.length,
      alertCount: alerts.filter(item => item.organizationId === organizationId && item.status === 'open').length,
      pendingRequestCount: requests.filter(item => item.organizationId === organizationId && item.status === 'pending').length,
    };
  });
}

function recountFolder(folderId: string) {
  folders = folders.map(item =>
    item.id === folderId
      ? { ...item, permissionCount: permissions.filter(permission => permission.folderId === folderId).length }
      : item,
  );
}

export const bndcService = {
  async listOrganizations(_options: BndcRequestOptions = {}): Promise<BndcOrganization[]> {
    if (!BNDC_USE_MOCK) return request<BndcOrganization[]>('/organizations', _options);
    return delay(clone(organizations));
  },

  async getOverviewStats(_options: BndcRequestOptions = {}): Promise<BndcOverviewStats> {
    if (!BNDC_USE_MOCK) return request<BndcOverviewStats>('/overview', _options);
    return delay({
      organizations: organizations.length,
      folders: organizations.reduce((total, item) => total + item.folderCount, 0),
      users: organizations.reduce((total, item) => total + item.userCount, 0),
      activePermissions: organizations.reduce((total, item) => total + item.permissionCount, 0),
      alerts: alerts.filter(item => item.status === 'open').length,
      pendingRequests: requests.filter(item => item.status === 'pending').length,
    });
  },

  async getOrganization(organizationId: string, _options: BndcRequestOptions = {}): Promise<BndcOrganization | null> {
    if (!BNDC_USE_MOCK) return request<BndcOrganization>(`/organizations/${organizationId}`, _options);
    return delay(clone(organizations.find(item => item.id === organizationId) || null));
  },

  async listFolders(organizationId: string, _options: BndcRequestOptions = {}): Promise<BndcFolder[]> {
    if (!BNDC_USE_MOCK) return request<BndcFolder[]>(`/organizations/${organizationId}/folders`, _options);
    return delay(clone(folders.filter(item => item.organizationId === organizationId)));
  },

  async listUsers(organizationId: string, _options: BndcRequestOptions = {}): Promise<BndcUser[]> {
    if (!BNDC_USE_MOCK) return request<BndcUser[]>(`/organizations/${organizationId}/users`, _options);
    return delay(clone(users.filter(item => item.organizationId === organizationId)));
  },

  async listPermissions(organizationId: string, _options: BndcRequestOptions = {}): Promise<BndcPermission[]> {
    if (!BNDC_USE_MOCK) return request<BndcPermission[]>(`/organizations/${organizationId}/permissions`, _options);
    return delay(clone(permissions.filter(item => item.organizationId === organizationId)));
  },

  async listAlerts(organizationId: string, _options: BndcRequestOptions = {}): Promise<BndcAlert[]> {
    if (!BNDC_USE_MOCK) return request<BndcAlert[]>(`/organizations/${organizationId}/alerts`, _options);
    return delay(clone(alerts.filter(item => item.organizationId === organizationId)));
  },

  async listRequests(organizationId: string, _options: BndcRequestOptions = {}): Promise<BndcRequest[]> {
    if (!BNDC_USE_MOCK) return request<BndcRequest[]>(`/organizations/${organizationId}/requests`, _options);
    return delay(clone(requests.filter(item => item.organizationId === organizationId)));
  },

  async listLogs(organizationId: string, _options: BndcRequestOptions = {}): Promise<BndcLogEntry[]> {
    if (!BNDC_USE_MOCK) return request<BndcLogEntry[]>(`/organizations/${organizationId}/logs`, _options);
    return delay(clone(logs.filter(item => item.organizationId === organizationId)));
  },

  async grantPermission(
    input: { organizationId: string; folderId: string; email: string; displayName?: string; role: BndcPermissionRole },
    _options: BndcRequestOptions = {},
  ): Promise<BndcPermission> {
    if (!BNDC_USE_MOCK) {
      return request<BndcPermission>('/permissions', { ..._options, method: 'POST', body: JSON.stringify(input) });
    }
    const email = input.email.trim().toLowerCase();
    const matchedUser = users.find(item => item.organizationId === input.organizationId && item.email.toLowerCase() === email) || null;
    permissionSequence += 1;
    const permission: BndcPermission = {
      id: `p-${String(permissionSequence).padStart(3, '0')}-new`,
      organizationId: input.organizationId,
      folderId: input.folderId,
      userId: matchedUser?.id || null,
      displayName: input.displayName?.trim() || matchedUser?.fullName || email.split('@')[0],
      email,
      role: input.role,
      source: matchedUser ? 'system' : 'external',
      status: matchedUser ? 'normal' : 'warning',
      grantedAt: new Date().toISOString(),
      grantedBy: 'FT Workspace',
    };
    permissions = [...permissions, permission];
    recountFolder(input.folderId);
    recountOrganization(input.organizationId);
    pushLog(
      input.organizationId,
      'FT Workspace',
      'Cấp quyền',
      folders.find(item => item.id === input.folderId)?.name || input.folderId,
      `Cấp quyền cho ${email}.`,
    );
    return delay(clone(permission));
  },

  async changePermissionRole(permissionId: string, role: BndcPermissionRole, _options: BndcRequestOptions = {}): Promise<BndcPermission | null> {
    if (!BNDC_USE_MOCK) {
      return request<BndcPermission>(`/permissions/${permissionId}`, { ..._options, method: 'PATCH', body: JSON.stringify({ role }) });
    }
    permissions = permissions.map(item => (item.id === permissionId ? { ...item, role } : item));
    const updated = permissions.find(item => item.id === permissionId) || null;
    if (updated) {
      pushLog(
        updated.organizationId,
        'FT Workspace',
        'Đổi quyền',
        folders.find(item => item.id === updated.folderId)?.name || updated.folderId,
        `Đổi quyền của ${updated.email}.`,
      );
    }
    return delay(clone(updated));
  },

  async revokePermission(permissionId: string, _options: BndcRequestOptions = {}): Promise<{ removed: string }> {
    if (!BNDC_USE_MOCK) {
      return request<{ removed: string }>(`/permissions/${permissionId}`, { ..._options, method: 'DELETE' });
    }
    const target = permissions.find(item => item.id === permissionId) || null;
    permissions = permissions.filter(item => item.id !== permissionId);
    if (target) {
      recountFolder(target.folderId);
      recountOrganization(target.organizationId);
      pushLog(
        target.organizationId,
        'FT Workspace',
        'Thu hồi quyền',
        folders.find(item => item.id === target.folderId)?.name || target.folderId,
        `Thu hồi quyền của ${target.email}.`,
      );
    }
    return delay({ removed: permissionId });
  },

  /** Used when a teacher leaves or transfers: clears every folder at once. */
  async revokeAllForEmail(organizationId: string, email: string, _options: BndcRequestOptions = {}): Promise<{ removed: number }> {
    if (!BNDC_USE_MOCK) {
      return request<{ removed: number }>(`/organizations/${organizationId}/permissions/revoke-all`, {
        ..._options,
        method: 'POST',
        body: JSON.stringify({ email }),
      });
    }
    const normalized = email.trim().toLowerCase();
    const affected = permissions.filter(item => item.organizationId === organizationId && item.email.toLowerCase() === normalized);
    permissions = permissions.filter(item => !(item.organizationId === organizationId && item.email.toLowerCase() === normalized));
    affected.forEach(item => recountFolder(item.folderId));
    users = users.map(item =>
      item.organizationId === organizationId && item.email.toLowerCase() === normalized ? { ...item, permissionCount: 0 } : item,
    );
    recountOrganization(organizationId);
    pushLog(organizationId, 'FT Workspace', 'Thu hồi toàn bộ quyền', email, `Đã thu hồi ${affected.length} quyền.`);
    return delay({ removed: affected.length });
  },

  async resolveAlert(alertId: string, _options: BndcRequestOptions = {}): Promise<BndcAlert | null> {
    if (!BNDC_USE_MOCK) {
      return request<BndcAlert>(`/alerts/${alertId}/resolve`, { ..._options, method: 'POST' });
    }
    alerts = alerts.map(item => (item.id === alertId ? { ...item, status: 'resolved' as const } : item));
    const updated = alerts.find(item => item.id === alertId) || null;
    if (updated) {
      recountOrganization(updated.organizationId);
      folders = folders.map(item =>
        item.id === updated.folderId
          ? { ...item, alertCount: alerts.filter(alert => alert.folderId === item.id && alert.status === 'open').length }
          : item,
      );
      pushLog(updated.organizationId, 'FT Workspace', 'Xử lý cảnh báo', updated.email, updated.note);
    }
    return delay(clone(updated));
  },

  async decideRequest(requestId: string, decision: 'approved' | 'rejected', _options: BndcRequestOptions = {}): Promise<BndcRequest | null> {
    if (!BNDC_USE_MOCK) {
      return request<BndcRequest>(`/requests/${requestId}`, { ..._options, method: 'PATCH', body: JSON.stringify({ status: decision }) });
    }
    requests = requests.map(item => (item.id === requestId ? { ...item, status: decision } : item));
    const updated = requests.find(item => item.id === requestId) || null;
    if (updated) {
      recountOrganization(updated.organizationId);
      pushLog(
        updated.organizationId,
        'FT Workspace',
        decision === 'approved' ? 'Duyệt yêu cầu' : 'Từ chối yêu cầu',
        updated.target,
        updated.note,
      );
    }
    return delay(clone(updated));
  },

  /**
   * Triggers a Drive sync for one organisation. The backend resolves which
   * Google credential to use from the organisation's `google_connection_id`.
   */
  async syncOrganization(organizationId: string, _options: BndcRequestOptions = {}): Promise<BndcOrganization | null> {
    if (!BNDC_USE_MOCK) {
      return request<BndcOrganization>(`/organizations/${organizationId}/sync`, { ..._options, method: 'POST' });
    }
    const now = new Date().toISOString();
    organizations = organizations.map(item =>
      item.id === organizationId ? { ...item, last_sync_at: now, connection_status: 'connected' as const } : item,
    );
    folders = folders.map(item =>
      item.organizationId === organizationId ? { ...item, syncStatus: 'synced' as const, lastSyncAt: now } : item,
    );
    const organization = organizations.find(item => item.id === organizationId) || null;
    if (organization) {
      pushLog(organizationId, organization.google_admin_email, 'Đồng bộ Google Drive', organization.name, `Đồng bộ ${organization.folderCount} thư mục.`);
    }
    return delay(clone(organization), 420);
  },
};

export default bndcService;
