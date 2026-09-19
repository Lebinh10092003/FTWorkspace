/**
 * Domain model of "Quản lý BNDC" (Bộ nhớ dữ liệu chung / shared data space).
 *
 * The field names mirror what the Django backend will expose so the demo can be
 * switched from mock data to the real API without touching the screens.
 * Every organisation carries its own Google credential reference: the platform
 * never assumes a single Google Admin account for the whole system.
 */

export type BndcOrganizationStatus = 'active' | 'onboarding' | 'suspended';
export type BndcConnectionStatus = 'connected' | 'pending' | 'error' | 'disconnected';
export type BndcSyncStatus = 'synced' | 'pending' | 'error';

export type BndcOrganization = {
  id: string;
  name: string;
  code: string;
  status: BndcOrganizationStatus;
  /** Per-organisation Google credential, resolved server side when syncing. */
  google_connection_id: string;
  google_admin_email: string;
  google_drive_id: string;
  connection_status: BndcConnectionStatus;
  last_sync_at: string | null;
  userCount: number;
  folderCount: number;
  permissionCount: number;
  alertCount: number;
  pendingRequestCount: number;
};

/** BNDC manages at most four folder levels below the organisation root. */
export type BndcFolderLevel = 1 | 2 | 3 | 4;

export type BndcFolder = {
  id: string;
  organizationId: string;
  parentId: string | null;
  name: string;
  level: BndcFolderLevel;
  googleFolderId: string;
  syncStatus: BndcSyncStatus;
  lastSyncAt: string | null;
  permissionCount: number;
  alertCount: number;
};

export type BndcPermissionRole = 'content_manager' | 'contributor' | 'commenter' | 'viewer' | 'editor';
export type BndcPermissionSource = 'system' | 'inherited' | 'external';
export type BndcPermissionStatus = 'normal' | 'warning';

export type BndcPermission = {
  id: string;
  organizationId: string;
  folderId: string;
  userId: string | null;
  displayName: string;
  email: string;
  role: BndcPermissionRole;
  source: BndcPermissionSource;
  status: BndcPermissionStatus;
  grantedAt: string;
  grantedBy: string;
};

export type BndcUserStatus = 'active' | 'left' | 'transferred';

export type BndcUser = {
  id: string;
  organizationId: string;
  fullName: string;
  email: string;
  department: string;
  status: BndcUserStatus;
  permissionCount: number;
};

export type BndcAlertType =
  | 'external_email'
  | 'left_staff_retains'
  | 'external_grant'
  | 'config_mismatch'
  | 'child_override'
  | 'elevated_role';

export type BndcAlertSeverity = 'high' | 'medium' | 'low';

export type BndcAlert = {
  id: string;
  organizationId: string;
  folderId: string;
  type: BndcAlertType;
  severity: BndcAlertSeverity;
  email: string;
  role: BndcPermissionRole;
  detectedAt: string;
  status: 'open' | 'resolved';
  note: string;
};

export type BndcRequestKind = 'grant' | 'revoke' | 'new_folder' | 'transfer';

export type BndcRequest = {
  id: string;
  organizationId: string;
  kind: BndcRequestKind;
  requester: string;
  target: string;
  folderId: string | null;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
  note: string;
};

export type BndcLogEntry = {
  id: string;
  organizationId: string;
  actor: string;
  action: string;
  target: string;
  at: string;
  detail: string;
};

export type BndcOverviewStats = {
  organizations: number;
  folders: number;
  users: number;
  activePermissions: number;
  alerts: number;
  pendingRequests: number;
};

export const BNDC_PERMISSION_ROLE_LABELS: Record<BndcPermissionRole, string> = {
  content_manager: 'Người quản lý nội dung',
  contributor: 'Người đóng góp',
  commenter: 'Người nhận xét',
  viewer: 'Người xem',
  editor: 'Editor',
};

export const BNDC_ORGANIZATION_STATUS_LABELS: Record<BndcOrganizationStatus, string> = {
  active: 'Hoạt động',
  onboarding: 'Đang thiết lập',
  suspended: 'Tạm dừng',
};

export const BNDC_CONNECTION_STATUS_LABELS: Record<BndcConnectionStatus, string> = {
  connected: 'Đã kết nối',
  pending: 'Chờ xác thực',
  error: 'Lỗi kết nối',
  disconnected: 'Chưa kết nối',
};

export const BNDC_SYNC_STATUS_LABELS: Record<BndcSyncStatus, string> = {
  synced: 'Đã đồng bộ',
  pending: 'Chờ đồng bộ',
  error: 'Lỗi đồng bộ',
};

export const BNDC_USER_STATUS_LABELS: Record<BndcUserStatus, string> = {
  active: 'Hoạt động',
  left: 'Đã nghỉ',
  transferred: 'Đã chuyển đơn vị',
};

export const BNDC_ALERT_TYPE_LABELS: Record<BndcAlertType, string> = {
  external_email: 'Email ngoài danh sách nhân sự',
  left_staff_retains: 'Người đã nghỉ nhưng vẫn còn quyền',
  external_grant: 'Quyền được thêm trực tiếp ngoài hệ thống',
  config_mismatch: 'Quyền không khớp cấu hình',
  child_override: 'Thư mục cấp dưới có quyền riêng không phù hợp',
  elevated_role: 'Người có quyền cao bất thường',
};

export const BNDC_REQUEST_KIND_LABELS: Record<BndcRequestKind, string> = {
  grant: 'Cấp quyền',
  revoke: 'Thu hồi quyền',
  new_folder: 'Tạo thư mục',
  transfer: 'Chuyển đơn vị',
};
