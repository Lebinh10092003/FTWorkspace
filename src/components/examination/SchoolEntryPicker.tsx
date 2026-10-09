import React from 'react';
import type { Partner } from './Partners';

export type SchoolEntry = { partnerId: string; fee: string };
export const emptySchoolEntry: SchoolEntry = { partnerId: '', fee: '' };

// Manual entry for pupils of a school (e.g. rows the school file could not
// import): the registration joins that school's billing group instead of
// becoming a separate individual bill.
export default function SchoolEntryPicker({ partners, value, onChange }: { partners: Partner[]; value: SchoolEntry; onChange: (value: SchoolEntry) => void }) {
  const field = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
  return <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
    <label className="text-sm font-bold">Đăng ký qua
      <select className={field} value={value.partnerId} onChange={event => onChange({ ...value, partnerId: event.target.value })}>
        <option value="">Cá nhân (tự đăng ký)</option>
        {[...partners].sort((a, b) => a.school.localeCompare(b.school, 'vi')).map(partner => <option key={partner.id} value={partner.id}>{partner.school}{partner.province ? ` · ${partner.province}` : ''}</option>)}
      </select>
    </label>
    {value.partnerId && <label className="text-sm font-bold">Lệ phí mỗi cuộc thi
      <input className={field} inputMode="numeric" value={value.fee} onChange={event => onChange({ ...value, fee: event.target.value })} placeholder="250000 hoặc 250 (nghìn đồng)" />
    </label>}
    {value.partnerId && <p className="text-xs text-slate-600 sm:col-span-2">Lượt đăng ký vào nhóm đối soát của trường, tổng tiền của trường tự cộng thêm. Lượt đã có thanh toán cá nhân được giữ nguyên.</p>}
  </div>;
}
