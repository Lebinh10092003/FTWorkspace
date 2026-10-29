import React from 'react';

export type FormFieldProps = {
  label: string;
  children: React.ReactNode;
  hint?: string;
  /** Chiếm 2 cột trong lưới sm:grid-cols-2. */
  wide?: boolean;
  /** `brand`: chữ đậm màu navy (Khảo thí); mặc định: chữ xám. */
  tone?: 'default' | 'brand';
};

/** Nhãn + ô nhập dùng chung cho các form. */
export default function FormField({ label, children, hint, wide = false, tone = 'default' }: FormFieldProps) {
  const toneClass = tone === 'brand' ? 'font-bold text-[#001e40]' : 'font-semibold text-slate-700';
  return (
    <label className={`block text-sm ${toneClass} ${wide ? 'sm:col-span-2' : ''}`}>
      <span className={`${tone === 'brand' ? 'mb-1' : 'mb-1.5'} block`}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs font-normal text-slate-500">{hint}</span>}
    </label>
  );
}
