import React from 'react';

export type StatCardProps = {
  label: string;
  value: React.ReactNode;
  icon: React.ElementType;
  /** Lớp màu cho biểu tượng. */
  tone: string;
};

/** Ô số liệu kiểu `bndc-stat` (trang Tài chính). Số được định dạng kiểu Việt Nam. */
export default function StatCard({ label, value, icon: Icon, tone }: StatCardProps) {
  return (
    <div className="bndc-stat">
      <span className="bndc-stat-head">
        <span>{label}</span>
        <Icon className={tone} aria-hidden="true" />
      </span>
      <b>{typeof value === 'number' ? value.toLocaleString('vi-VN') : value}</b>
    </div>
  );
}
