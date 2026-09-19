import type {
  BndcAlert,
  BndcFolder,
  BndcLogEntry,
  BndcOrganization,
  BndcPermission,
  BndcRequest,
  BndcUser,
} from './types';

/**
 * Demo dataset for BNDC.
 *
 * It is deliberately kept in one module so that swapping to the live API means
 * deleting this file and pointing `bndcService` at the backend — no screen
 * imports mock data directly.
 */

export const BNDC_MOCK_ORGANIZATIONS: BndcOrganization[] = [
  {
    id: 'org-th-trung-van',
    name: 'TH Trung Văn',
    code: 'TH-TV',
    status: 'active',
    google_connection_id: 'gconn-001',
    google_admin_email: 'admin1@thtrungvan.edu.vn',
    google_drive_id: '0ABCdefTHTrungVanDrive',
    connection_status: 'connected',
    last_sync_at: '2026-09-18T07:15:00+07:00',
    userCount: 68,
    folderCount: 42,
    permissionCount: 184,
    alertCount: 2,
    pendingRequestCount: 3,
  },
  {
    id: 'org-thcs-a',
    name: 'THCS A',
    code: 'THCS-A',
    status: 'active',
    google_connection_id: 'gconn-002',
    google_admin_email: 'admin2@thcsa.edu.vn',
    google_drive_id: '0ABCdefTHCSADrive',
    connection_status: 'connected',
    last_sync_at: '2026-09-18T06:40:00+07:00',
    userCount: 91,
    folderCount: 58,
    permissionCount: 236,
    alertCount: 0,
    pendingRequestCount: 1,
  },
  {
    id: 'org-mn-dai-mo',
    name: 'MN Đại Mỗ',
    code: 'MN-DM',
    status: 'active',
    google_connection_id: 'gconn-003',
    google_admin_email: 'admin3@mndaimo.edu.vn',
    google_drive_id: '0ABCdefMNDaiMoDrive',
    connection_status: 'pending',
    last_sync_at: '2026-09-16T17:05:00+07:00',
    userCount: 43,
    folderCount: 27,
    permissionCount: 98,
    alertCount: 1,
    pendingRequestCount: 0,
  },
];

const folder = (
  id: string,
  organizationId: string,
  parentId: string | null,
  name: string,
  level: 1 | 2 | 3 | 4,
  googleFolderId: string,
  permissionCount: number,
  alertCount = 0,
  syncStatus: BndcFolder['syncStatus'] = 'synced',
  lastSyncAt: string | null = '2026-09-18T07:15:00+07:00',
): BndcFolder => ({
  id,
  organizationId,
  parentId,
  name,
  level,
  googleFolderId,
  syncStatus,
  lastSyncAt,
  permissionCount,
  alertCount,
});

export const BNDC_MOCK_FOLDERS: BndcFolder[] = [
  // TH Trung Văn — the four-level example from the specification.
  folder('f-tv-root', 'org-th-trung-van', null, 'TH Trung Văn', 1, '1TVroot_0001', 68),
  folder('f-tv-bgh', 'org-th-trung-van', 'f-tv-root', 'Ban giám hiệu', 2, '1TVbgh_0002', 6),
  folder('f-tv-tcm', 'org-th-trung-van', 'f-tv-root', 'Tổ chuyên môn', 2, '1TVtcm_0003', 41, 2),
  folder('f-tv-toan', 'org-th-trung-van', 'f-tv-tcm', 'Tổ Toán', 3, '1TVtoan_0004', 18, 2),
  folder('f-tv-toan-k4', 'org-th-trung-van', 'f-tv-toan', 'Khối 4', 4, '1TVk4_0005', 9, 2, 'pending', '2026-09-17T21:30:00+07:00'),
  folder('f-tv-toan-k5', 'org-th-trung-van', 'f-tv-toan', 'Khối 5', 4, '1TVk5_0006', 8),
  folder('f-tv-van', 'org-th-trung-van', 'f-tv-tcm', 'Tổ Văn', 3, '1TVvan_0007', 15),
  folder('f-tv-vp', 'org-th-trung-van', 'f-tv-root', 'Văn phòng', 2, '1TVvp_0008', 12),

  // THCS A
  folder('f-a-root', 'org-thcs-a', null, 'THCS A', 1, '1Aroot_1001', 91),
  folder('f-a-bgh', 'org-thcs-a', 'f-a-root', 'Ban giám hiệu', 2, '1Abgh_1002', 7),
  folder('f-a-tcm', 'org-thcs-a', 'f-a-root', 'Tổ chuyên môn', 2, '1Atcm_1003', 52),
  folder('f-a-tn', 'org-thcs-a', 'f-a-tcm', 'Tổ Tự nhiên', 3, '1Atn_1004', 26),
  folder('f-a-tn-k8', 'org-thcs-a', 'f-a-tn', 'Khối 8', 4, '1Ak8_1005', 13),
  folder('f-a-tn-k9', 'org-thcs-a', 'f-a-tn', 'Khối 9', 4, '1Ak9_1006', 12),
  folder('f-a-xh', 'org-thcs-a', 'f-a-tcm', 'Tổ Xã hội', 3, '1Axh_1007', 24),
  folder('f-a-vp', 'org-thcs-a', 'f-a-root', 'Văn phòng', 2, '1Avp_1008', 14),

  // MN Đại Mỗ
  folder('f-dm-root', 'org-mn-dai-mo', null, 'MN Đại Mỗ', 1, '1DMroot_2001', 43, 0, 'pending', '2026-09-16T17:05:00+07:00'),
  folder('f-dm-bgh', 'org-mn-dai-mo', 'f-dm-root', 'Ban giám hiệu', 2, '1DMbgh_2002', 5),
  folder('f-dm-khoi', 'org-mn-dai-mo', 'f-dm-root', 'Các khối lớp', 2, '1DMkhoi_2003', 29, 1),
  folder('f-dm-mgl', 'org-mn-dai-mo', 'f-dm-khoi', 'Mẫu giáo lớn', 3, '1DMmgl_2004', 15, 1),
  folder('f-dm-mgn', 'org-mn-dai-mo', 'f-dm-khoi', 'Mẫu giáo nhỡ', 3, '1DMmgn_2005', 12),
  folder('f-dm-vp', 'org-mn-dai-mo', 'f-dm-root', 'Văn phòng', 2, '1DMvp_2006', 9, 0, 'error', '2026-09-15T09:20:00+07:00'),
];

export const BNDC_MOCK_USERS: BndcUser[] = [
  { id: 'u-tv-a', organizationId: 'org-th-trung-van', fullName: 'Nguyễn Văn A', email: 'a@thtrungvan.edu.vn', department: 'Tổ Toán', status: 'active', permissionCount: 5 },
  { id: 'u-tv-b', organizationId: 'org-th-trung-van', fullName: 'Nguyễn Văn B', email: 'b@thtrungvan.edu.vn', department: 'Văn phòng', status: 'active', permissionCount: 3 },
  { id: 'u-tv-c', organizationId: 'org-th-trung-van', fullName: 'Nguyễn Văn C', email: 'c@thtrungvan.edu.vn', department: 'Tổ Văn', status: 'left', permissionCount: 4 },
  { id: 'u-tv-d', organizationId: 'org-th-trung-van', fullName: 'Trần Thị B', email: 'tranthib@thtrungvan.edu.vn', department: 'Tổ Toán', status: 'active', permissionCount: 2 },
  { id: 'u-tv-e', organizationId: 'org-th-trung-van', fullName: 'Lê Minh H', email: 'leminhh@thtrungvan.edu.vn', department: 'Ban giám hiệu', status: 'active', permissionCount: 6 },
  { id: 'u-tv-f', organizationId: 'org-th-trung-van', fullName: 'Phạm Thu T', email: 'phamthut@thtrungvan.edu.vn', department: 'Tổ Văn', status: 'transferred', permissionCount: 1 },

  { id: 'u-a-a', organizationId: 'org-thcs-a', fullName: 'Đỗ Quang M', email: 'doquangm@thcsa.edu.vn', department: 'Tổ Tự nhiên', status: 'active', permissionCount: 4 },
  { id: 'u-a-b', organizationId: 'org-thcs-a', fullName: 'Vũ Thị N', email: 'vuthin@thcsa.edu.vn', department: 'Tổ Xã hội', status: 'active', permissionCount: 3 },
  { id: 'u-a-c', organizationId: 'org-thcs-a', fullName: 'Hoàng Văn P', email: 'hoangvanp@thcsa.edu.vn', department: 'Văn phòng', status: 'active', permissionCount: 2 },

  { id: 'u-dm-a', organizationId: 'org-mn-dai-mo', fullName: 'Bùi Thị K', email: 'buithik@mndaimo.edu.vn', department: 'Mẫu giáo lớn', status: 'active', permissionCount: 3 },
  { id: 'u-dm-b', organizationId: 'org-mn-dai-mo', fullName: 'Ngô Thị L', email: 'ngothil@mndaimo.edu.vn', department: 'Ban giám hiệu', status: 'active', permissionCount: 5 },
];

export const BNDC_MOCK_PERMISSIONS: BndcPermission[] = [
  // Khối 4 — the table used as the specification example.
  { id: 'p-001', organizationId: 'org-th-trung-van', folderId: 'f-tv-toan-k4', userId: 'u-tv-a', displayName: 'Nguyễn Văn A', email: 'a@thtrungvan.edu.vn', role: 'contributor', source: 'system', status: 'normal', grantedAt: '2026-08-12T09:00:00+07:00', grantedBy: 'admin1@thtrungvan.edu.vn' },
  { id: 'p-002', organizationId: 'org-th-trung-van', folderId: 'f-tv-toan-k4', userId: 'u-tv-d', displayName: 'Trần Thị B', email: 'tranthib@thtrungvan.edu.vn', role: 'viewer', source: 'system', status: 'normal', grantedAt: '2026-08-12T09:02:00+07:00', grantedBy: 'admin1@thtrungvan.edu.vn' },
  { id: 'p-003', organizationId: 'org-th-trung-van', folderId: 'f-tv-toan-k4', userId: null, displayName: 'User X', email: 'x@gmail.com', role: 'editor', source: 'external', status: 'warning', grantedAt: '2026-09-10T14:31:00+07:00', grantedBy: 'Google Drive' },
  { id: 'p-004', organizationId: 'org-th-trung-van', folderId: 'f-tv-toan-k4', userId: null, displayName: 'abc', email: 'abc@gmail.com', role: 'editor', source: 'external', status: 'warning', grantedAt: '2026-09-14T08:12:00+07:00', grantedBy: 'Google Drive' },
  { id: 'p-005', organizationId: 'org-th-trung-van', folderId: 'f-tv-toan-k4', userId: 'u-tv-e', displayName: 'Lê Minh H', email: 'leminhh@thtrungvan.edu.vn', role: 'content_manager', source: 'inherited', status: 'normal', grantedAt: '2026-07-01T08:00:00+07:00', grantedBy: 'Hệ thống' },

  { id: 'p-006', organizationId: 'org-th-trung-van', folderId: 'f-tv-toan-k5', userId: 'u-tv-a', displayName: 'Nguyễn Văn A', email: 'a@thtrungvan.edu.vn', role: 'contributor', source: 'system', status: 'normal', grantedAt: '2026-08-12T09:05:00+07:00', grantedBy: 'admin1@thtrungvan.edu.vn' },
  { id: 'p-007', organizationId: 'org-th-trung-van', folderId: 'f-tv-toan', userId: 'u-tv-a', displayName: 'Nguyễn Văn A', email: 'a@thtrungvan.edu.vn', role: 'content_manager', source: 'system', status: 'normal', grantedAt: '2026-07-20T10:00:00+07:00', grantedBy: 'admin1@thtrungvan.edu.vn' },
  { id: 'p-008', organizationId: 'org-th-trung-van', folderId: 'f-tv-tcm', userId: 'u-tv-a', displayName: 'Nguyễn Văn A', email: 'a@thtrungvan.edu.vn', role: 'viewer', source: 'inherited', status: 'normal', grantedAt: '2026-07-01T08:00:00+07:00', grantedBy: 'Hệ thống' },
  { id: 'p-009', organizationId: 'org-th-trung-van', folderId: 'f-tv-root', userId: 'u-tv-a', displayName: 'Nguyễn Văn A', email: 'a@thtrungvan.edu.vn', role: 'viewer', source: 'inherited', status: 'normal', grantedAt: '2026-07-01T08:00:00+07:00', grantedBy: 'Hệ thống' },

  { id: 'p-010', organizationId: 'org-th-trung-van', folderId: 'f-tv-vp', userId: 'u-tv-b', displayName: 'Nguyễn Văn B', email: 'b@thtrungvan.edu.vn', role: 'content_manager', source: 'system', status: 'normal', grantedAt: '2026-07-22T10:20:00+07:00', grantedBy: 'admin1@thtrungvan.edu.vn' },
  { id: 'p-011', organizationId: 'org-th-trung-van', folderId: 'f-tv-root', userId: 'u-tv-b', displayName: 'Nguyễn Văn B', email: 'b@thtrungvan.edu.vn', role: 'viewer', source: 'inherited', status: 'normal', grantedAt: '2026-07-01T08:00:00+07:00', grantedBy: 'Hệ thống' },
  { id: 'p-012', organizationId: 'org-th-trung-van', folderId: 'f-tv-bgh', userId: 'u-tv-b', displayName: 'Nguyễn Văn B', email: 'b@thtrungvan.edu.vn', role: 'commenter', source: 'system', status: 'normal', grantedAt: '2026-08-02T15:40:00+07:00', grantedBy: 'admin1@thtrungvan.edu.vn' },

  { id: 'p-013', organizationId: 'org-th-trung-van', folderId: 'f-tv-van', userId: 'u-tv-c', displayName: 'Nguyễn Văn C', email: 'c@thtrungvan.edu.vn', role: 'content_manager', source: 'system', status: 'warning', grantedAt: '2026-06-18T09:00:00+07:00', grantedBy: 'admin1@thtrungvan.edu.vn' },
  { id: 'p-014', organizationId: 'org-th-trung-van', folderId: 'f-tv-tcm', userId: 'u-tv-c', displayName: 'Nguyễn Văn C', email: 'c@thtrungvan.edu.vn', role: 'contributor', source: 'system', status: 'warning', grantedAt: '2026-06-18T09:01:00+07:00', grantedBy: 'admin1@thtrungvan.edu.vn' },
  { id: 'p-015', organizationId: 'org-th-trung-van', folderId: 'f-tv-root', userId: 'u-tv-c', displayName: 'Nguyễn Văn C', email: 'c@thtrungvan.edu.vn', role: 'viewer', source: 'inherited', status: 'warning', grantedAt: '2026-06-18T09:01:00+07:00', grantedBy: 'Hệ thống' },
  { id: 'p-016', organizationId: 'org-th-trung-van', folderId: 'f-tv-bgh', userId: 'u-tv-c', displayName: 'Nguyễn Văn C', email: 'c@thtrungvan.edu.vn', role: 'commenter', source: 'system', status: 'warning', grantedAt: '2026-06-18T09:02:00+07:00', grantedBy: 'admin1@thtrungvan.edu.vn' },

  { id: 'p-017', organizationId: 'org-th-trung-van', folderId: 'f-tv-bgh', userId: 'u-tv-e', displayName: 'Lê Minh H', email: 'leminhh@thtrungvan.edu.vn', role: 'content_manager', source: 'system', status: 'normal', grantedAt: '2026-07-01T08:00:00+07:00', grantedBy: 'admin1@thtrungvan.edu.vn' },
  { id: 'p-018', organizationId: 'org-th-trung-van', folderId: 'f-tv-van', userId: 'u-tv-d', displayName: 'Trần Thị B', email: 'tranthib@thtrungvan.edu.vn', role: 'viewer', source: 'system', status: 'normal', grantedAt: '2026-08-20T11:00:00+07:00', grantedBy: 'admin1@thtrungvan.edu.vn' },
  { id: 'p-019', organizationId: 'org-th-trung-van', folderId: 'f-tv-van', userId: 'u-tv-f', displayName: 'Phạm Thu T', email: 'phamthut@thtrungvan.edu.vn', role: 'contributor', source: 'system', status: 'warning', grantedAt: '2026-05-06T13:10:00+07:00', grantedBy: 'admin1@thtrungvan.edu.vn' },

  { id: 'p-020', organizationId: 'org-thcs-a', folderId: 'f-a-tn-k8', userId: 'u-a-a', displayName: 'Đỗ Quang M', email: 'doquangm@thcsa.edu.vn', role: 'content_manager', source: 'system', status: 'normal', grantedAt: '2026-08-05T08:30:00+07:00', grantedBy: 'admin2@thcsa.edu.vn' },
  { id: 'p-021', organizationId: 'org-thcs-a', folderId: 'f-a-tn-k9', userId: 'u-a-a', displayName: 'Đỗ Quang M', email: 'doquangm@thcsa.edu.vn', role: 'contributor', source: 'system', status: 'normal', grantedAt: '2026-08-05T08:31:00+07:00', grantedBy: 'admin2@thcsa.edu.vn' },
  { id: 'p-022', organizationId: 'org-thcs-a', folderId: 'f-a-xh', userId: 'u-a-b', displayName: 'Vũ Thị N', email: 'vuthin@thcsa.edu.vn', role: 'content_manager', source: 'system', status: 'normal', grantedAt: '2026-08-06T09:00:00+07:00', grantedBy: 'admin2@thcsa.edu.vn' },
  { id: 'p-023', organizationId: 'org-thcs-a', folderId: 'f-a-vp', userId: 'u-a-c', displayName: 'Hoàng Văn P', email: 'hoangvanp@thcsa.edu.vn', role: 'viewer', source: 'system', status: 'normal', grantedAt: '2026-08-07T09:00:00+07:00', grantedBy: 'admin2@thcsa.edu.vn' },

  { id: 'p-024', organizationId: 'org-mn-dai-mo', folderId: 'f-dm-mgl', userId: 'u-dm-a', displayName: 'Bùi Thị K', email: 'buithik@mndaimo.edu.vn', role: 'contributor', source: 'system', status: 'normal', grantedAt: '2026-08-11T10:00:00+07:00', grantedBy: 'admin3@mndaimo.edu.vn' },
  { id: 'p-025', organizationId: 'org-mn-dai-mo', folderId: 'f-dm-mgl', userId: null, displayName: 'Cộng tác viên', email: 'ctv.media@gmail.com', role: 'editor', source: 'external', status: 'warning', grantedAt: '2026-09-12T16:45:00+07:00', grantedBy: 'Google Drive' },
  { id: 'p-026', organizationId: 'org-mn-dai-mo', folderId: 'f-dm-bgh', userId: 'u-dm-b', displayName: 'Ngô Thị L', email: 'ngothil@mndaimo.edu.vn', role: 'content_manager', source: 'system', status: 'normal', grantedAt: '2026-07-30T08:00:00+07:00', grantedBy: 'admin3@mndaimo.edu.vn' },
];

export const BNDC_MOCK_ALERTS: BndcAlert[] = [
  {
    id: 'al-001',
    organizationId: 'org-th-trung-van',
    folderId: 'f-tv-toan-k4',
    type: 'external_grant',
    severity: 'high',
    email: 'abc@gmail.com',
    role: 'editor',
    detectedAt: '2026-09-14T08:15:00+07:00',
    status: 'open',
    note: 'Quyền được thêm trực tiếp trên Google Drive, không đi qua BNDC.',
  },
  {
    id: 'al-002',
    organizationId: 'org-th-trung-van',
    folderId: 'f-tv-toan-k4',
    type: 'external_email',
    severity: 'high',
    email: 'x@gmail.com',
    role: 'editor',
    detectedAt: '2026-09-10T14:35:00+07:00',
    status: 'open',
    note: 'Email không thuộc danh sách nhân sự của đơn vị.',
  },
  {
    id: 'al-003',
    organizationId: 'org-th-trung-van',
    folderId: 'f-tv-van',
    type: 'left_staff_retains',
    severity: 'high',
    email: 'c@thtrungvan.edu.vn',
    role: 'content_manager',
    detectedAt: '2026-09-15T07:00:00+07:00',
    status: 'open',
    note: 'Nhân sự đã nghỉ việc nhưng vẫn giữ quyền quản lý nội dung.',
  },
  {
    id: 'al-004',
    organizationId: 'org-th-trung-van',
    folderId: 'f-tv-toan-k4',
    type: 'child_override',
    severity: 'medium',
    email: 'leminhh@thtrungvan.edu.vn',
    role: 'content_manager',
    detectedAt: '2026-09-13T10:20:00+07:00',
    status: 'open',
    note: 'Thư mục cấp 4 có quyền riêng khác cấu hình của Tổ Toán.',
  },
  {
    id: 'al-005',
    organizationId: 'org-th-trung-van',
    folderId: 'f-tv-van',
    type: 'config_mismatch',
    severity: 'low',
    email: 'phamthut@thtrungvan.edu.vn',
    role: 'contributor',
    detectedAt: '2026-09-11T09:40:00+07:00',
    status: 'resolved',
    note: 'Người dùng đã chuyển đơn vị, quyền chưa được cập nhật theo cấu hình.',
  },
  {
    id: 'al-006',
    organizationId: 'org-mn-dai-mo',
    folderId: 'f-dm-mgl',
    type: 'elevated_role',
    severity: 'medium',
    email: 'ctv.media@gmail.com',
    role: 'editor',
    detectedAt: '2026-09-12T16:50:00+07:00',
    status: 'open',
    note: 'Tài khoản ngoài hệ thống đang giữ quyền chỉnh sửa toàn thư mục khối.',
  },
];

export const BNDC_MOCK_REQUESTS: BndcRequest[] = [
  { id: 'rq-001', organizationId: 'org-th-trung-van', kind: 'grant', requester: 'Lê Minh H', target: 'tranthib@thtrungvan.edu.vn', folderId: 'f-tv-toan-k5', createdAt: '2026-09-17T09:10:00+07:00', status: 'pending', note: 'Bổ sung giáo viên phụ trách Khối 5.' },
  { id: 'rq-002', organizationId: 'org-th-trung-van', kind: 'revoke', requester: 'Văn phòng', target: 'c@thtrungvan.edu.vn', folderId: 'f-tv-van', createdAt: '2026-09-16T15:25:00+07:00', status: 'pending', note: 'Giáo viên đã nghỉ việc từ 01/09/2026.' },
  { id: 'rq-003', organizationId: 'org-th-trung-van', kind: 'new_folder', requester: 'Tổ Văn', target: 'Khối 3', folderId: 'f-tv-van', createdAt: '2026-09-15T11:00:00+07:00', status: 'pending', note: 'Tạo thư mục cấp 4 cho Khối 3.' },
  { id: 'rq-004', organizationId: 'org-thcs-a', kind: 'grant', requester: 'Vũ Thị N', target: 'hoangvanp@thcsa.edu.vn', folderId: 'f-a-xh', createdAt: '2026-09-17T14:05:00+07:00', status: 'pending', note: 'Hỗ trợ số hoá học liệu Tổ Xã hội.' },
  { id: 'rq-005', organizationId: 'org-th-trung-van', kind: 'transfer', requester: 'Nhân sự', target: 'phamthut@thtrungvan.edu.vn', folderId: null, createdAt: '2026-09-08T08:30:00+07:00', status: 'approved', note: 'Chuyển công tác sang THCS A.' },
];

export const BNDC_MOCK_LOGS: BndcLogEntry[] = [
  { id: 'lg-001', organizationId: 'org-th-trung-van', actor: 'admin1@thtrungvan.edu.vn', action: 'Đồng bộ Google Drive', target: 'TH Trung Văn', at: '2026-09-18T07:15:00+07:00', detail: 'Đồng bộ 42 thư mục, phát hiện 2 cảnh báo mới.' },
  { id: 'lg-002', organizationId: 'org-th-trung-van', actor: 'Hệ thống', action: 'Phát hiện quyền ngoài hệ thống', target: 'Khối 4', at: '2026-09-14T08:15:00+07:00', detail: 'abc@gmail.com được cấp quyền Editor trực tiếp trên Drive.' },
  { id: 'lg-003', organizationId: 'org-th-trung-van', actor: 'Lê Minh H', action: 'Cấp quyền', target: 'Khối 5', at: '2026-09-13T10:05:00+07:00', detail: 'Cấp quyền Người đóng góp cho a@thtrungvan.edu.vn.' },
  { id: 'lg-004', organizationId: 'org-th-trung-van', actor: 'Văn phòng', action: 'Gửi yêu cầu thu hồi', target: 'Tổ Văn', at: '2026-09-16T15:25:00+07:00', detail: 'Yêu cầu thu hồi toàn bộ quyền của c@thtrungvan.edu.vn.' },
  { id: 'lg-005', organizationId: 'org-thcs-a', actor: 'admin2@thcsa.edu.vn', action: 'Đồng bộ Google Drive', target: 'THCS A', at: '2026-09-18T06:40:00+07:00', detail: 'Đồng bộ 58 thư mục, không có cảnh báo.' },
  { id: 'lg-006', organizationId: 'org-mn-dai-mo', actor: 'Hệ thống', action: 'Kết nối Google', target: 'MN Đại Mỗ', at: '2026-09-16T17:05:00+07:00', detail: 'Chờ quản trị viên đơn vị xác thực lại tài khoản admin3@mndaimo.edu.vn.' },
];
