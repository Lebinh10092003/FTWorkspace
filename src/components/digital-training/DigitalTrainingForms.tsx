// Ô nhập, hộp thoại và chi tiết lịch công tác dùng trong Đào tạo số (tách từ DigitalTraining.tsx).
import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import LogNotes from "../examination/LogNotes";
import Time24Input from "../Time24Input";

import type { WorkActivity } from './digitalTrainingTypes';
import { categories, showDate, showTime, status, scheduleStatusClass } from './digitalTrainingUtils';

export function Dialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="ft-dialog-backdrop fixed inset-0 z-50 grid place-items-center p-4">
      <div
        className={`ft-dialog-panel max-h-[calc(100vh-2rem)] w-full overflow-y-auto bg-white p-6 ${wide ? "max-w-[88rem]" : "max-w-2xl"}`}
      >
        <div className="mb-5 flex justify-between gap-3">
          <h2 className="text-xl font-extrabold">{title}</h2>
          <button onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Input({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label>
      <span className="mb-1 block text-sm font-bold">{label}</span>
      <input
        {...props}
        className="w-full rounded-lg border border-slate-300 px-3 py-2"
      />
    </label>
  );
}
export function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-slate-200 pt-5">
      <h3 className="mb-4 text-sm font-extrabold uppercase tracking-wide text-sky-800">
        {title}
      </h3>
      {children}
    </section>
  );
}
export function CreateScheduleMenu({
  onTraining,
  onNewMeeting,
  onExistingMeeting,
  onOther,
}: {
  onTraining: () => void;
  onNewMeeting: () => void;
  onExistingMeeting: () => void;
  onOther: () => void;
}) {
  const [open, setOpen] = useState(false);
  const select = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="ft-primary"
      >
        <Plus className="h-4 w-4" />
        Tạo lịch mới
        <ChevronDown className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          <button
            type="button"
            onClick={() => select(onTraining)}
            className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-bold hover:bg-sky-50"
          >
            Tạo lịch tập huấn
          </button>
          <button
            type="button"
            onClick={() => select(onNewMeeting)}
            className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-bold hover:bg-sky-50"
          >
            Gặp Khách hàng mới
          </button>
          <button
            type="button"
            onClick={() => select(onExistingMeeting)}
            className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-bold hover:bg-sky-50"
          >
            Gặp Khách hàng hiện tại
          </button>
          <button
            type="button"
            onClick={() => select(onOther)}
            className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-bold hover:bg-sky-50"
          >
            Khác
          </button>
        </div>
      )}
    </div>
  );
}
export function TimePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="mb-1 block text-sm font-bold">{label}</span>
      <Time24Input label={label} value={value} onChange={onChange} />
      <small className="mt-1 block text-xs text-slate-500">
        Có thể nhập trực tiếp hoặc mở danh sách giờ và phút.
      </small>
    </label>
  );
}
export function CompactTimePicker({
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <Time24Input
      label={ariaLabel}
      value={value}
      onChange={onChange}
      disabled={disabled}
      className="rounded-lg py-0"
    />
  );
}
export function ContentsPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [custom, setCustom] = useState("");
  const choices = [
      ...categories,
      ...value.filter((x) => !categories.includes(x)),
    ],
    toggle = (item: string) =>
      onChange(
        value.includes(item)
          ? value.filter((x) => x !== item)
          : [...value, item],
      ),
    add = () => {
      const next = custom.trim();
      if (next && !value.includes(next)) onChange([...value, next]);
      setCustom("");
    };
  return (
    <div>
      <span className="mb-1 block text-sm font-bold">Nội dung tập huấn</span>
      <p className="mb-2 text-xs text-slate-500">
        Có thể chọn nhiều nội dung hoặc tự thêm nội dung mới.
      </p>
      <div className="flex flex-wrap gap-2">
        {choices.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => toggle(item)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${value.includes(item) ? "border-sky-600 bg-sky-600 text-white" : "border-sky-200 text-sky-800"}`}
          >
            {value.includes(item) ? "✓ " : ""}
            {item}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Nhập nội dung mới"
          className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={add}
          className="rounded-lg border border-sky-300 px-3 text-sm font-bold text-sky-700"
        >
          Thêm
        </button>
      </div>
    </div>
  );
}

export function ProductSelect({
  label,
  value,
  onChange,
  options = [],
  allowCustom = false,
  disabled = false,
  placeholder = "Chọn sản phẩm",
  searchPlaceholder = "Tìm hoặc nhập sản phẩm...",
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  options?: string[];
  allowCustom?: boolean;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const rootRef = useRef<HTMLLabelElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const normalized = query.trim().toLocaleLowerCase("vi-VN");
  const visible = options.filter((item) =>
    item.toLocaleLowerCase("vi-VN").includes(normalized),
  );
  const toggle = (item: string) =>
    onChange(
      value.includes(item) ? value.filter((x) => x !== item) : [...value, item],
    );
  return (
    <label ref={rootRef} className="relative block">
      <span className="mb-1 block text-sm font-bold">{label}</span>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        onClick={() => !disabled && setOpen(!open)}
        className={`flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm ${disabled ? "cursor-not-allowed bg-slate-100 text-slate-600" : ""}`}
      >
        {value.length ? (
          value.map((item) => (
            <span
              key={item}
              className="relative inline-flex items-center rounded bg-sky-100 py-1 pl-2 pr-6 text-sky-900"
            >
              {item}
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(value.filter((x) => x !== item));
                  }}
                  className="absolute right-0.5 top-0.5 grid h-3.5 w-3.5 place-items-center rounded-sm text-[11px] font-extrabold leading-none transition-colors hover:bg-sky-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-700"
                  aria-label={`Bỏ ${item}`}
                >
                  ×
                </button>
              )}
            </span>
          ))
        ) : (
          <span className="text-slate-400">{placeholder}</span>
        )}
      </div>
      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border bg-white p-2 shadow-xl">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="mb-2 w-full rounded-lg border px-3 py-2 text-sm"
          />
          <div className="max-h-60 overflow-y-auto">
            {visible.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => toggle(item)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-sky-50"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${value.includes(item) ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300"}`}
                >
                  {value.includes(item) && (
                    <Check className="h-3 w-3 stroke-[3]" />
                  )}
                </span>
                {item}
              </button>
            ))}
          </div>
          {allowCustom &&
            query.trim() &&
            !options.some(
              (item) => item.toLocaleLowerCase("vi-VN") === normalized,
            ) && (
              <button
                type="button"
                onClick={() => {
                  toggle(query.trim());
                  setQuery("");
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-sky-700 hover:bg-sky-50"
              >
                + Thêm “{query.trim()}”
              </button>
            )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-2 w-full rounded-lg border px-3 py-1.5 text-xs font-bold"
          >
            Xong
          </button>
        </div>
      )}
    </label>
  );
}
export function WorkScheduleDetail({
  activity,
  canWrite,
  actor,
  idToken,
  onBack,
  onEdit,
  onCancel,
  onDelete,
}: {
  activity: WorkActivity;
  canWrite: boolean;
  actor?: string | null;
  idToken?: string;
  onBack: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const title =
    activity.kind === "training"
      ? "Lịch tập huấn"
      : activity.kind === "meeting"
        ? "Lịch gặp Khách hàng"
        : "Lịch công tác khác";
  const logKey =
    activity.kind === "training"
      ? `digital-training-session-${activity.sourceId}`
      : `digital-training-activity-${activity.kind}-${activity.sourceId}`;
  return (
    <section className="mt-6 space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-bold text-slate-600"
      >
        <ArrowLeft className="h-4 w-4" />
        Quay lại Lịch
      </button>
      <article className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase text-cyan-600">{title}</p>
            <h2 className="mt-1 text-2xl font-extrabold">{activity.title}</h2>
            <p className="mt-2 text-sm text-slate-500">
              {showDate(activity.date)} · {showTime(activity)}
            </p>
          </div>
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onEdit}
                className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-bold text-sky-800"
              >
                <Pencil className="mr-2 inline h-4 w-4" />
                Chỉnh sửa
              </button>
              {activity.status !== "cancelled" && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800"
                >
                  Hủy lịch
                </button>
              )}
              <button
                type="button"
                onClick={onDelete}
                className="rounded-lg border border-rose-200 px-4 py-2 text-sm font-bold text-rose-700"
              >
                <Trash2 className="mr-2 inline h-4 w-4" />
                Xóa
              </button>
            </div>
          )}
        </div>
        <div className="mt-6 grid gap-5 border-t pt-5 sm:grid-cols-2 xl:grid-cols-3">
          <p>
            <b className="block text-xs uppercase text-slate-500">{"Tr\u1ea1ng th\u00e1i"}</b>
            <span className={`mt-1 inline-flex rounded-full border px-2 py-1 text-xs font-bold ${scheduleStatusClass[activity.status] || "border-slate-200 bg-slate-100 text-slate-600"}`}>
              {status[activity.status]}
            </span>
          </p>
          <p>
            <b className="block text-xs uppercase text-slate-500">{"Kh\u00e1ch h\u00e0ng"}</b>
            {activity.customerName || "\u2014"}
          </p>
          <p>
            <b className="block text-xs uppercase text-slate-500">{"L\u1edbp/Ph\u00e2n nh\u00f3m"}</b>
            {activity.className || "\u2014"}
          </p>
          <p>
            <b className="block text-xs uppercase text-slate-500">{"\u0110\u1ecba \u0111i\u1ec3m"}</b>
            {activity.location || "\u2014"}
          </p>
          {activity.kind === "training" ? (
            <>
              <p>
                <b className="block text-xs uppercase text-slate-500">{"Gi\u1ea3ng vi\u00ean"}</b>
                {activity.instructorName || activity.staffName || "\u2014"}
              </p>
              <p>
                <b className="block text-xs uppercase text-slate-500">{"Nh\u00e2n vi\u00ean h\u1ed7 tr\u1ee3"}</b>
                {activity.supportStaffName || "\u2014"}
              </p>
              <p>
                <b className="block text-xs uppercase text-slate-500">Số người tham gia</b>
                {(activity.attendees || 0).toLocaleString("vi-VN")}
              </p>
            </>
          ) : (
            <p>
              <b className="block text-xs uppercase text-slate-500">{"Nh\u00e2n vi\u00ean ph\u1ee5 tr\u00e1ch"}</b>
              {activity.staffName || "\u2014"}
            </p>
          )}
          <p className="sm:col-span-2 xl:col-span-3">
            <b className="block text-xs uppercase text-slate-500">Nội dung</b>
            {activity.content || "—"}
          </p>
        </div>
      </article>
      <LogNotes
        entityKey={logKey}
        actor={actor}
        canWrite={canWrite}
        idToken={idToken}
      />
    </section>
  );
}
