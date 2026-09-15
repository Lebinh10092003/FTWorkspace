import React, { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

const HOURS = Array.from({ length: 24 }, (_, value) => String(value).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, value) => String(value).padStart(2, "0"));

type Props = {
  value: string;
  label: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

type Part = "hour" | "minute";

const validPart = (value: string, maximum: number) => {
  if (!/^\d{1,2}$/.test(value)) return null;
  const number = Number(value);
  return number <= maximum ? String(number).padStart(2, "0") : null;
};

export default function Time24Input({ value, label, onChange, disabled = false, className = "" }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [rawHour = "", rawMinute = ""] = (value || "").slice(0, 5).split(":");
  const [hour, setHour] = useState(validPart(rawHour, 23) || "");
  const [minute, setMinute] = useState(validPart(rawMinute, 59) || "00");
  const [open, setOpen] = useState<Part | null>(null);

  useEffect(() => {
    setHour(validPart(rawHour, 23) || "");
    setMinute(validPart(rawMinute, 59) || "00");
  }, [rawHour, rawMinute]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const emit = (nextHour: string, nextMinute: string) => {
    const h = validPart(nextHour, 23);
    const m = validPart(nextMinute, 59);
    onChange(h ? `${h}:${m || "00"}` : "");
  };
  const typePart = (part: Part, raw: string) => {
    const next = raw.replace(/\D/g, "").slice(0, 2);
    if (part === "hour") {
      setHour(next);
      if (next.length === 2 && validPart(next, 23)) emit(next, minute);
    } else {
      setMinute(next);
      if (next.length === 2 && validPart(next, 59) && validPart(hour, 23)) emit(hour, next);
    }
  };
  const commitPart = (part: Part) => {
    if (part === "hour") {
      const next = validPart(hour, 23) || "";
      setHour(next);
      emit(next, minute);
    } else {
      const next = validPart(minute, 59) || "00";
      setMinute(next);
      emit(hour, next);
    }
  };
  const choose = (part: Part, next: string) => {
    if (part === "hour") {
      setHour(next);
      emit(next, minute);
    } else {
      setMinute(next);
      emit(hour, next);
    }
    setOpen(null);
  };
  const partInput = (part: Part, items: string[]) => {
    const current = part === "hour" ? hour : minute;
    const partLabel = part === "hour" ? "giờ" : "phút";
    return (
      <div className="relative min-w-0 flex-1">
        <div className="flex min-w-0 items-center rounded-lg bg-sky-50 focus-within:ring-2 focus-within:ring-blue-200">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            disabled={disabled}
            aria-label={`${label} - ${partLabel}`}
            value={current}
            onChange={(event) => typePart(part, event.target.value)}
            onBlur={() => commitPart(part)}
            onFocus={(event) => event.currentTarget.select()}
            className="w-0 min-w-0 flex-1 bg-transparent py-1.5 pl-2 text-center font-semibold tabular-nums outline-none disabled:cursor-not-allowed"
          />
          <button
            type="button"
            disabled={disabled}
            aria-label={`Mở danh sách ${partLabel}`}
            aria-expanded={open === part}
            onClick={() => setOpen((currentOpen) => currentOpen === part ? null : part)}
            className="shrink-0 rounded-r-lg p-1 text-slate-500 hover:bg-sky-100 disabled:cursor-not-allowed"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
        {open === part && (
          <div className="absolute left-0 right-0 top-full z-[90] mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
            {items.map((item) => (
              <button
                type="button"
                key={item}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(part, item)}
                className={`block h-8 w-full rounded-md text-center text-sm font-semibold tabular-nums hover:bg-sky-100 ${current === item ? "bg-blue-600 text-white hover:bg-blue-600" : "text-slate-700"}`}
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={rootRef} data-time-picker="24h" className={`flex w-full min-w-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-1.5 py-1 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 ${disabled ? "bg-slate-50 opacity-70" : ""} ${className}`}>
      {partInput("hour", HOURS)}
      <span className="font-extrabold text-slate-400">:</span>
      {partInput("minute", MINUTES)}
    </div>
  );
}
