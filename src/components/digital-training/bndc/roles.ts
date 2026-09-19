/**
 * Role / permission configuration for BNDC.
 *
 * The demo only needs enough structure to drive which buttons are offered, but
 * the shape is the one the backend will return, so wiring real roles later is a
 * data change rather than a UI change.
 */

export type BndcCapability =
  | 'organization.view'
  | 'organization.manage'
  | 'folder.view'
  | 'folder.manage'
  | 'permission.view'
  | 'permission.grant'
  | 'permission.revoke'
  | 'permission.revoke_all'
  | 'user.view'
  | 'user.manage'
  | 'alert.view'
  | 'alert.resolve'
  | 'request.view'
  | 'request.approve'
  | 'log.view'
  | 'google.sync';

export type BndcRole = {
  id: string;
  label: string;
  description: string;
  capabilities: BndcCapability[];
};

export type BndcRoleGroup = {
  id: 'ft' | 'unit';
  label: string;
  description: string;
  roles: BndcRole[];
};

const ALL_CAPABILITIES: BndcCapability[] = [
  'organization.view', 'organization.manage',
  'folder.view', 'folder.manage',
  'permission.view', 'permission.grant', 'permission.revoke', 'permission.revoke_all',
  'user.view', 'user.manage',
  'alert.view', 'alert.resolve',
  'request.view', 'request.approve',
  'log.view', 'google.sync',
];

export const BNDC_ROLE_GROUPS: BndcRoleGroup[] = [
  {
    id: 'ft',
    label: 'FT',
    description: 'Nhóm vai trò của FermatTech, làm việc trên nhiều đơn vị.',
    roles: [
      {
        id: 'ft_super_admin',
        label: 'Super Admin',
        description: 'Toàn quyền trên mọi đơn vị, cấu hình kết nối Google và vai trò.',
        capabilities: ALL_CAPABILITIES,
      },
      {
        id: 'ft_system_admin',
        label: 'Quản trị hệ thống',
        description: 'Quản trị cấu trúc thư mục, phân quyền và xử lý cảnh báo.',
        capabilities: [
          'organization.view', 'organization.manage',
          'folder.view', 'folder.manage',
          'permission.view', 'permission.grant', 'permission.revoke', 'permission.revoke_all',
          'user.view', 'user.manage',
          'alert.view', 'alert.resolve',
          'request.view', 'request.approve',
          'log.view', 'google.sync',
        ],
      },
      {
        id: 'ft_account_owner',
        label: 'Nhân viên phụ trách đơn vị',
        description: 'Phụ trách một nhóm đơn vị: cấp/thu hồi quyền và theo dõi yêu cầu.',
        capabilities: [
          'organization.view',
          'folder.view',
          'permission.view', 'permission.grant', 'permission.revoke',
          'user.view',
          'alert.view',
          'request.view',
          'log.view', 'google.sync',
        ],
      },
      {
        id: 'ft_auditor',
        label: 'Người kiểm tra',
        description: 'Chỉ xem dữ liệu, cảnh báo và nhật ký để đối soát.',
        capabilities: [
          'organization.view', 'folder.view', 'permission.view',
          'user.view', 'alert.view', 'request.view', 'log.view',
        ],
      },
    ],
  },
  {
    id: 'unit',
    label: 'Đơn vị',
    description: 'Nhóm vai trò thuộc về nhà trường / đơn vị sử dụng BNDC.',
    roles: [
      {
        id: 'unit_admin',
        label: 'Quản trị đơn vị',
        description: 'Quản trị toàn bộ thư mục và người dùng của đơn vị mình.',
        capabilities: [
          'organization.view',
          'folder.view', 'folder.manage',
          'permission.view', 'permission.grant', 'permission.revoke', 'permission.revoke_all',
          'user.view', 'user.manage',
          'alert.view', 'request.view', 'log.view',
        ],
      },
      {
        id: 'unit_department_admin',
        label: 'Quản trị bộ phận',
        description: 'Quản trị thư mục và quyền trong phạm vi bộ phận được giao.',
        capabilities: [
          'organization.view', 'folder.view',
          'permission.view', 'permission.grant', 'permission.revoke',
          'user.view', 'alert.view', 'request.view',
        ],
      },
      {
        id: 'unit_member',
        label: 'Người dùng',
        description: 'Xem thư mục và quyền của chính mình.',
        capabilities: ['organization.view', 'folder.view', 'permission.view'],
      },
    ],
  },
];

export const BNDC_ROLES: BndcRole[] = BNDC_ROLE_GROUPS.flatMap(group => group.roles);

export function bndcRole(roleId: string): BndcRole | null {
  return BNDC_ROLES.find(role => role.id === roleId) || null;
}

export function hasBndcCapability(roleId: string, capability: BndcCapability) {
  return Boolean(bndcRole(roleId)?.capabilities.includes(capability));
}

/**
 * Maps a Workspace account onto a BNDC role until the backend stores the real
 * assignment. Keeping the mapping in one place means the screens never branch
 * on Workspace roles directly.
 */
export function bndcRoleForWorkspaceUser(userRole?: string | null): string {
  const role = String(userRole || '').toUpperCase();
  if (role === 'ADMIN') return 'ft_super_admin';
  if (role === 'MANAGER') return 'ft_account_owner';
  return 'ft_auditor';
}
