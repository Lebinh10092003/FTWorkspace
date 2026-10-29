// Lịch tuần/tháng của Đào tạo số (tách từ DigitalTraining.tsx).
import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { Mode, CalendarItem, CalendarLayoutItem } from './digitalTrainingTypes';
import { layoutCalendarEvents, localDateKey, today, showTime } from './digitalTrainingUtils';

export function Calendar({
  mode,
  onModeChange,
  sessions,
  onPick,
  onOpen,
  onMove,
  actions,
}: {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  sessions: CalendarItem[];
  onPick: (date: string, start?: string, end?: string) => void;
  onOpen: (item: CalendarItem) => void;
  onMove: (item: CalendarItem, date: string, start?: string) => void;
  actions?: React.ReactNode;
}) {
  const [cursor, setCursor] = useState(() => new Date());
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [appliedRange, setAppliedRange] = useState<{
    start: string;
    end: string;
    days: number;
  } | null>(null);
  const [rangeError, setRangeError] = useState("");
  const [drag, setDrag] = useState<{ date: string; minute: number } | null>(
    null,
  );
  const [hover, setHover] = useState<{ date: string; minute: number } | null>(
    null,
  );
  const [moving, setMoving] = useState<CalendarItem | null>(null);
  const draggedRef = useRef(false);
  const movingRef = useRef<CalendarItem | null>(null);
  const iso = (value: Date) => localDateKey(value);
  const fromIso = (value: string) => new Date(`${value}T00:00:00`);
  const addDays = (value: Date, days: number) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate() + days);
  const addMonths = (value: Date, months: number) => {
    const target = new Date(value.getFullYear(), value.getMonth() + months, 1);
    const lastDay = new Date(
      target.getFullYear(),
      target.getMonth() + 1,
      0,
    ).getDate();
    target.setDate(Math.min(value.getDate(), lastDay));
    return target;
  };
  const weekStart = (value: Date) =>
    addDays(value, -((value.getDay() + 6) % 7));
  const toTime = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const rangeLength = (start: string, end: string) => {
    const a = fromIso(start),
      b = fromIso(end);
    return (
      Math.round(
        (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
          Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
          86400000,
      ) + 1
    );
  };
  const enumerateDays = (start: string, end: string) => {
    const rows: Date[] = [];
    for (
      let value = fromIso(start);
      iso(value) <= end;
      value = addDays(value, 1)
    )
      rows.push(value);
    return rows;
  };
  const first = weekStart(cursor);
  const weekDays = Array.from({ length: 7 }, (_, index) =>
    addDays(first, index),
  );
  const timelineDays =
    appliedRange && appliedRange.days <= 7
      ? enumerateDays(appliedRange.start, appliedRange.end)
      : weekDays;
  const inRange = (date: string) =>
    !appliedRange || (date >= appliedRange.start && date <= appliedRange.end);
  const visibleSessions = sessions.filter((item) => inRange(item.date || ""));
  const events = (date: string) =>
    visibleSessions.filter((item) => item.date === date);
  const clearRange = () => {
    setRangeStart("");
    setRangeEnd("");
    setAppliedRange(null);
    setRangeError("");
  };
  const shift = (step: number) => {
    clearRange();
    setCursor((value) =>
      mode === "week"
        ? addDays(value, step * 7)
        : new Date(value.getFullYear(), value.getMonth() + step, 1),
    );
  };
  const selectToday = () => {
    const value = today();
    setCursor(fromIso(value));
    setRangeStart(value);
    setRangeEnd(value);
    setAppliedRange({ start: value, end: value, days: 1 });
    setRangeError("");
    onModeChange("week");
  };
  const applyRange = () => {
    if (!rangeStart || !rangeEnd) {
      setRangeError("Vui lòng chọn đầy đủ ngày bắt đầu và ngày kết thúc.");
      return;
    }
    if (rangeEnd < rangeStart) {
      setRangeError("Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.");
      return;
    }
    const maxEnd = iso(addMonths(fromIso(rangeStart), 3));
    if (rangeEnd > maxEnd) {
      setRangeError(
        `Khoảng thời gian tối đa là 3 tháng, đến ${fromIso(maxEnd).toLocaleDateString("vi-VN")}.`,
      );
      return;
    }
    const days = rangeLength(rangeStart, rangeEnd);
    setAppliedRange({ start: rangeStart, end: rangeEnd, days });
    setCursor(fromIso(rangeStart));
    setRangeError("");
    onModeChange(days <= 7 ? "week" : "month");
  };
  useEffect(() => {
    if (!appliedRange) return;
    const expected = appliedRange.days <= 7 ? "week" : "month";
    if (mode !== expected) clearRange();
  }, [mode]);
  const beginMove = (event: React.DragEvent, item: CalendarItem) => {
    if (item.status === "cancelled") {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    draggedRef.current = true;
    movingRef.current = item;
    setMoving(item);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(item.id));
  };
  const cancelMove = () => {
    movingRef.current = null;
    setMoving(null);
    window.setTimeout(() => {
      draggedRef.current = false;
    }, 0);
  };
  const dropMove = (event: React.DragEvent, date: string, minute?: number) => {
    event.preventDefault();
    event.stopPropagation();
    const item = movingRef.current;
    if (!item) return false;
    movingRef.current = null;
    setMoving(null);
    const targetStart =
      minute === undefined
        ? (item.start_time || "").slice(0, 5)
        : toTime(minute);
    if (
      item.date === date &&
      (!targetStart || targetStart === (item.start_time || "").slice(0, 5))
    )
      return true;
    onMove(item, date, targetStart);
    return true;
  };
  const openItem = (event: React.MouseEvent, item: CalendarItem) => {
    event.stopPropagation();
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    onOpen(item);
  };
  const renderEvent = (
    item: CalendarItem,
    variant: "week" | "month",
    style?: React.CSSProperties,
    layout?: CalendarLayoutItem,
  ) => {
    const details = [
      item.staff_name?.trim() ? `Phụ trách: ${item.staff_name.trim()}` : "",
      item.content?.trim() ? `Nội dung: ${item.content.trim()}` : "",
      item.location?.trim() ? `Địa điểm: ${item.location.trim()}` : "",
    ].filter(Boolean);
    const label = [`${showTime(item)} · ${item.title}`, ...details].join(" · ");
    return (
      <span
        key={item.id}
        role="button"
        tabIndex={0}
        title={label}
        data-calendar-event={variant}
        data-start={(item.start_time || "").slice(0, 5)}
        data-end={(item.end_time || "").slice(0, 5)}
        data-overlap-column={layout?.column}
        data-overlap-columns={layout?.columnCount}
        draggable={item.status !== "cancelled"}
        onMouseDown={(event) => event.stopPropagation()}
        onMouseUp={(event) => event.stopPropagation()}
        onDragStart={(event) => beginMove(event, item)}
        onDragEnd={cancelMove}
        onClick={(event) => openItem(event, item)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            onOpen(item);
          }
        }}
        style={style}
        className={`${variant === "week" ? "dt-calendar-event" : "dt-month-event"} cursor-grab ${moving?.id === item.id ? "is-moving" : ""} ${item.status === "completed" ? "is-completed" : item.status === "cancelled" ? "is-cancelled" : ""}`}
      >
        <span className="dt-calendar-event-main">
          {showTime(item)} · {item.title}
        </span>
        {variant === "week"
          ? details.map((detail) => (
              <span key={detail} className={`dt-calendar-event-meta${detail.startsWith("Nội dung:") ? " dt-calendar-event-content" : ""}`}>
                {detail}
              </span>
            ))
          : details.length
            ? ` · ${details.join(" · ")}`
            : null}
      </span>
    );
  };
  const rangeLabel = appliedRange
    ? `${fromIso(appliedRange.start).toLocaleDateString("vi-VN")} – ${fromIso(appliedRange.end).toLocaleDateString("vi-VN")}`
    : mode === "week"
      ? `${first.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })} – ${weekDays[6].toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}`
      : cursor.toLocaleDateString("vi-VN", { month: "long", year: "numeric" });
  const toolbar = (
    <>
      <div className="dt-calendar-toolbar">
        <div className="dt-calendar-period">
          <button type="button" onClick={selectToday}>
            Hôm nay
          </button>
          <button type="button" onClick={() => shift(-1)} aria-label="Kỳ trước">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => shift(1)} aria-label="Kỳ sau">
            <ChevronRight className="h-4 w-4" />
          </button>
          <b className="text-sm text-slate-800">{rangeLabel}</b>
        </div>
        <div className="dt-calendar-toolbar-right">
          <div className="dt-calendar-range">
            <label>
              Từ
              <input
                type="date"
                value={rangeStart}
                onChange={(event) => {
                  setRangeStart(event.target.value);
                  setRangeError("");
                }}
              />
            </label>
            <label>
              Đến
              <input
                type="date"
                min={rangeStart || undefined}
                max={
                  rangeStart
                    ? iso(addMonths(fromIso(rangeStart), 3))
                    : undefined
                }
                value={rangeEnd}
                onChange={(event) => {
                  setRangeEnd(event.target.value);
                  setRangeError("");
                }}
              />
            </label>
            <button type="button" onClick={applyRange}>
              Xem khoảng
            </button>
            {(rangeStart || rangeEnd || appliedRange) && (
              <button type="button" onClick={clearRange}>
                Bỏ lọc
              </button>
            )}
          </div>
          {actions}
        </div>
      </div>
      {rangeError && (
        <p className="dt-calendar-range-error" role="alert">
          {rangeError}
        </p>
      )}
    </>
  );
  const renderMonthDay = (
    day: Date,
    key: string,
    active: boolean,
    outside: boolean = false,
  ) => {
    const date = iso(day),
      rows = active ? events(date) : [],
      todayDate = date === today();
    return (
      <div
        key={key}
        role={active ? "button" : undefined}
        tabIndex={active ? 0 : -1}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (active) dropMove(event, date);
        }}
        onClick={() => {
          if (active && !draggedRef.current) onPick(date);
          draggedRef.current = false;
        }}
        className={`dt-month-day ${outside ? "is-outside" : ""} ${todayDate ? "is-today" : ""} ${active ? "" : "is-filtered"}`}
      >
        <span className="dt-month-number">{day.getDate()}</span>
        <span className="dt-month-events">
          {rows.slice(0, 3).map((item) => renderEvent(item, "month"))}
          {rows.length > 3 && (
            <span className="dt-month-more">+{rows.length - 3} buổi khác</span>
          )}
        </span>
      </div>
    );
  };
  const weekdayHeads = [
    "Thứ 2",
    "Thứ 3",
    "Thứ 4",
    "Thứ 5",
    "Thứ 6",
    "Thứ 7",
    "Chủ nhật",
  ].map((label) => (
    <div key={label} className="dt-month-head">
      {label}
    </div>
  ));
  if (appliedRange && appliedRange.days > 7) {
    const monthStarts: Date[] = [];
    const end = fromIso(appliedRange.end);
    for (
      let value = new Date(
        fromIso(appliedRange.start).getFullYear(),
        fromIso(appliedRange.start).getMonth(),
        1,
      );
      value <= end;
      value = new Date(value.getFullYear(), value.getMonth() + 1, 1)
    )
      monthStarts.push(value);
    return (
      <div className="dt-calendar">
        {toolbar}
        <div className="dt-calendar-multi-month">
          {monthStarts.map((month) => {
            const leading = (month.getDay() + 6) % 7,
              daysInMonth = new Date(
                month.getFullYear(),
                month.getMonth() + 1,
                0,
              ).getDate(),
              cellCount = Math.ceil((leading + daysInMonth) / 7) * 7;
            return (
              <section key={iso(month)} className="dt-calendar-range-month">
                <h3 className="dt-calendar-month-title">
                  {month.toLocaleDateString("vi-VN", {
                    month: "long",
                    year: "numeric",
                  })}
                </h3>
                <div className="dt-calendar-month-scroll">
                  <div className="dt-calendar-month is-range-month">
                    {weekdayHeads}
                    {Array.from({ length: cellCount }, (_, index) => {
                      const dayNumber = index - leading + 1;
                      if (dayNumber < 1 || dayNumber > daysInMonth)
                        return (
                          <div
                            key={`blank-${index}`}
                            className="dt-month-day is-placeholder"
                            aria-hidden="true"
                          />
                        );
                      const day = new Date(
                          month.getFullYear(),
                          month.getMonth(),
                          dayNumber,
                        ),
                        date = iso(day);
                      return renderMonthDay(day, date, inRange(date));
                    })}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
        <p className="border-t border-sky-100 px-4 py-2 text-xs text-slate-500">
          Hiển thị liên tục theo tháng trong khoảng đã chọn; kéo lịch sang ngày
          khác để chuyển lịch.
        </p>
      </div>
    );
  }
  if (mode === "month") {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1),
      gridStart = weekStart(monthStart),
      days = Array.from({ length: 42 }, (_, index) =>
        addDays(gridStart, index),
      );
    return (
      <div className="dt-calendar">
        {toolbar}
        <div className="dt-calendar-month-scroll">
          <div className="dt-calendar-month">
            {weekdayHeads}
            {days.map((day) =>
              renderMonthDay(
                day,
                iso(day),
                true,
                day.getMonth() !== cursor.getMonth(),
              ),
            )}
          </div>
        </div>
        <p className="border-t border-sky-100 px-4 py-2 text-xs text-slate-500">
          Kéo một lịch sang ngày khác để chuyển lịch; bấm vào ngày trống để chọn
          loại lịch cần tạo.
        </p>
      </div>
    );
  }
  const timelineStart = 480,
    timelineEnd = 1260,
    slotMinutes = 30,
    slotHeight = 112 / 3;
  const slots = Array.from(
    { length: (timelineEnd - timelineStart) / slotMinutes },
    (_, index) => timelineStart + index * slotMinutes,
  );
  const timelineEvents = timelineDays
    .flatMap((day, dayIndex) =>
      layoutCalendarEvents(events(iso(day))).map((entry) => ({
        ...entry,
        dayIndex,
      })),
    )
    .filter((entry) => entry.end > timelineStart && entry.start < timelineEnd);
  const renderTimelineEvent = (
    entry: CalendarLayoutItem & { dayIndex: number },
  ) => {
    const start = Math.max(timelineStart, entry.start),
      end = Math.min(timelineEnd, entry.end),
      row = Math.floor((start - timelineStart) / slotMinutes) + 2,
      offset = start - (timelineStart + (row - 2) * slotMinutes);
    const style = {
      gridColumnStart: entry.dayIndex + 2,
      gridRowStart: row,
      transform: `translateY(${(offset * slotHeight) / slotMinutes}px)`,
      height: `${Math.max(20, ((end - start) * slotHeight) / slotMinutes)}px`,
      width: `calc(${100 / entry.columnCount}% - 4px)`,
      marginLeft: `calc(${(entry.column * 100) / entry.columnCount}% + 2px)`,
    } as React.CSSProperties;
    return renderEvent(entry.item, "week", style, entry);
  };
  const finish = (date: string, minute: number) => {
    if (!drag) {
      onPick(date, toTime(minute), toTime(minute + 30));
      return;
    }
    const start = Math.min(drag.minute, minute),
      end = Math.max(drag.minute, minute) + 30;
    onPick(drag.date, toTime(start), toTime(end));
    setDrag(null);
    setHover(null);
  };
  return (
    <div className="dt-calendar">
      {toolbar}
      <div className="dt-calendar-scroll">
        <div
          className={`dt-calendar-week is-dynamic ${moving ? "is-moving-calendar" : ""}`}
          style={
            {
              "--dt-calendar-days": timelineDays.length,
              "--dt-calendar-slot-height": `${slotHeight}px`,
            } as React.CSSProperties
          }
        >
          <div
            className="dt-calendar-head"
            style={{ gridColumnStart: 1, gridRowStart: 1 }}
          />
          {timelineDays.map((day, dayIndex) => {
            const date = iso(day);
            return (
              <div
                key={date}
                style={{ gridColumnStart: dayIndex + 2, gridRowStart: 1 }}
                className={`dt-calendar-head ${date === today() ? "is-today" : ""}`}
              >
                <span>
                  {day.toLocaleDateString("vi-VN", { weekday: "long" })}
                </span>
                <strong>{day.getDate()}</strong>
              </div>
            );
          })}
          {slots.flatMap((minute, slotIndex) => [
            <div
              key={`hour-${minute}`}
              style={{ gridColumnStart: 1, gridRowStart: slotIndex + 2 }}
              className="dt-calendar-hour"
            >
              {minute % 60 === 0 ? toTime(minute) : ""}
            </div>,
            ...timelineDays.map((day, dayIndex) => {
              const date = iso(day),
                selected =
                  !!drag &&
                  !!hover &&
                  drag.date === date &&
                  hover.date === date &&
                  minute >= Math.min(drag.minute, hover.minute) &&
                  minute <= Math.max(drag.minute, hover.minute);
              return (
                <div
                  key={`${date}-${minute}`}
                  style={{
                    gridColumnStart: dayIndex + 2,
                    gridRowStart: slotIndex + 2,
                  }}
                  role="button"
                  tabIndex={0}
                  data-calendar-slot={`${date}T${toTime(minute)}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    draggedRef.current = false;
                    setDrag({ date, minute });
                    setHover({ date, minute });
                  }}
                  onMouseEnter={() => {
                    if (drag) setHover({ date, minute });
                  }}
                  onMouseUp={() => {
                    draggedRef.current = true;
                    finish(date, minute);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    dropMove(event, date, minute);
                  }}
                  onClick={() => {
                    if (!draggedRef.current)
                      onPick(date, toTime(minute), toTime(minute + 30));
                    draggedRef.current = false;
                  }}
                  className={`dt-calendar-cell ${selected ? "is-selecting" : ""} ${moving ? "is-drop-target" : ""}`}
                />
              );
            }),
          ])}
          {timelineEvents.map(renderTimelineEvent)}
        </div>
      </div>
      <p className="border-t border-sky-100 px-4 py-2 text-xs text-slate-500">
        Kéo một lịch sang ô ngày/giờ khác để chuyển lịch. Kéo chuột qua ô trống
        để chọn loại lịch cần tạo theo đúng khoảng đã chọn.
      </p>
    </div>
  );
}
