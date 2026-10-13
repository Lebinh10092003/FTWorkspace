/**
 * Department-first layout for the Workspace launcher and the vertical rail.
 *
 * Presentation only: it reorders what an account can already open. Nothing is
 * hidden from access and no permission changes here. Areas of the person's own
 * departments come first, personal tools next, and every other area they may
 * open stays one click away under "Khác".
 *
 * Department names are matched by keyword without diacritics, so renaming
 * "Phòng Khảo thí" to "Khảo thí" keeps working. Leadership, admins without a
 * department and unknown departments keep the full, flat layout.
 * Plan: docs/WORKSPACE_DEPARTMENT_LAYOUT_PLAN.md
 */

export type DepartmentLayout = {
  /** Shown above the department's own areas, e.g. "Khảo thí". */
  label: string;
  primary: string[];
};

type DepartmentRule = { keywords: string[]; label: string; areas: string[] };

const DEPARTMENT_RULES: DepartmentRule[] = [
  { keywords: ['khao thi'], label: 'Khảo thí', areas: ['examination'] },
  { keywords: ['dao tao so', 'cong nghe', 'chuyen doi so', 'cntt'], label: 'Công nghệ & Đào tạo số', areas: ['digital-training', 'training-assessments'] },
  { keywords: ['truyen thong', 'marketing'], label: 'Truyền thông', areas: ['social-dashboard', 'communication-tools'] },
  { keywords: ['ke toan', 'tai chinh'], label: 'Kế toán', areas: ['finance-report'] },
  { keywords: ['hanh chinh', 'nhan su'], label: 'Hành chính – Nhân sự', areas: ['account-management', 'attendance'] },
];

const LEADERSHIP_KEYWORDS = ['giam doc', 'lanh dao', 'ban giam', 'bgd', 'chu tich'];

/** Tools everyone uses for their own work, whatever their department. */
export const PERSONAL_AREAS = ['work-schedule', 'attendance', 'examination-invigilation'];

export function normaliseDepartment(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ').trim();
}

export function resolveDepartmentLayout(departmentNames: string[], jobTitle = ''): DepartmentLayout | null {
  const names = departmentNames.map(normaliseDepartment).filter(Boolean);
  const title = normaliseDepartment(jobTitle);
  if ([...names, title].some(name => LEADERSHIP_KEYWORDS.some(keyword => name.includes(keyword)))) return null;
  const rules = DEPARTMENT_RULES.filter(rule => names.some(name => rule.keywords.some(keyword => name.includes(keyword))));
  if (!rules.length) return null;
  return {
    label: rules.map(rule => rule.label).join(' · '),
    primary: [...new Set(rules.flatMap(rule => rule.areas))],
  };
}

export type DepartmentGroups<T> = { primary: T[]; personal: T[]; others: T[] };

/** Splits items an account can already open into the three layout groups, keeping their order. */
export function groupByDepartment<T>(items: T[], idOf: (item: T) => string, layout: DepartmentLayout): DepartmentGroups<T> {
  const primary = items.filter(item => layout.primary.includes(idOf(item)));
  const personal = items.filter(item => !layout.primary.includes(idOf(item)) && PERSONAL_AREAS.includes(idOf(item)));
  const others = items.filter(item => !primary.includes(item) && !personal.includes(item));
  return { primary, personal, others };
}
