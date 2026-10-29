import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import type { ExaminationSession } from './types';
import type { TrainingCourse } from './TrainingClasses';

type LessonEvent = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  course: TrainingCourse;
  label: string;
};

type Props = { courses: TrainingCourse[]; sessions: ExaminationSession[]; onOpenCourse?: (courseId: string) => void };

const weekDays = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'];
const colorStyles = [
  'border-blue-500 bg-blue-50 text-blue-800',
  'border-violet-500 bg-violet-50 text-violet-800',
  'border-emerald-500 bg-emerald-50 text-emerald-800',
  'border-amber-500 bg-amber-50 text-amber-900',
  'border-rose-500 bg-rose-50 text-rose-800',
];

const pad = (value: number) => String(value).padStart(2, '0');
const dateKey = (value: Date) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
const asDate = (value: string) => new Date(`${value}T12:00:00`);
const addDays = (value: Date, days: number) => { const next = new Date(value); next.setDate(next.getDate() + days); return next; };
const mondayOf = (value: Date) => addDays(value, -((value.getDay() + 6) % 7));
const timeToMinutes = (value: string) => { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes; };
const courseColor = (course: TrainingCourse) => colorStyles[Math.abs([...course.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0)) % colorStyles.length];

function courseLessons(course: TrainingCourse): LessonEvent[] {
  if (!course.start || !course.end || course.start > course.end) return [];
  const slots = course.scheduleSlots?.length ? course.scheduleSlots : [{ id: `legacy-${course.id}`, days: course.days || [], startTime: course.startTime || '', endTime: course.endTime || '' }];
  const first = asDate(course.start), last = asDate(course.end), lessons: LessonEvent[] = [];
  for (const current = new Date(first); current <= last && lessons.length < 180; current.setDate(current.getDate() + 1)) {
    slots.filter((item) => item.days.includes(current.getDay())).forEach((item) => lessons.push({
      id: `${course.id}-${dateKey(current)}-${item.id}`,
      date: dateKey(current), startTime: item.startTime, endTime: item.endTime, course,
      label: `Buổi ${lessons.length + 1}`,
    }));
  }
  return lessons;
}

export default function TrainingClassesCalendar({ courses, sessions, onOpenCourse }: Props) {
  const [anchor, setAnchor] = useState(() => mondayOf(new Date()));
  const [view, setView] = useState<'week' | 'month'>('week');
  const lessons = useMemo(() => courses.flatMap(courseLessons), [courses]);
  const today = dateKey(new Date());
  const weekStart = mondayOf(anchor);
  const days = Array.from({ length: view === 'week' ? 7 : 42 }, (_, index) => view === 'week' ? addDays(weekStart, index) : addDays(mondayOf(new Date(anchor.getFullYear(), anchor.getMonth(), 1)), index));
  const from = days[0], to = days[days.length - 1];
  const inRange = lessons.filter((lesson) => lesson.date >= dateKey(from) && lesson.date <= dateKey(to));
  const heading = view === 'week'
    ? `${from.toLocaleDateString('vi-VN')} – ${to.toLocaleDateString('vi-VN')}`
    : `Tháng ${anchor.getMonth() + 1}/${anchor.getFullYear()}`;
  const move = (amount: number) => setAnchor((current) => view === 'week' ? addDays(current, amount * 7) : new Date(current.getFullYear(), current.getMonth() + amount, 1));
  const sessionName = (course: TrainingCourse) => sessions.find((session) => session.id === course.sessionId)?.code || 'Lớp ôn tập';

  return <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays className="h-5 w-5 text-[#1f4fc9]"/>
        <h2 className="font-extrabold text-[#001e40]">Lịch dạy lớp ôn tập</h2>
        <span className="text-sm font-bold text-slate-500">{heading}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setAnchor(mondayOf(new Date()))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-[#1f4fc9]">Hôm nay</button>
        <button aria-label="Khoảng thời gian trước" onClick={() => move(-1)} className="rounded-lg border border-slate-300 p-2 text-[#1f4fc9]"><ChevronLeft className="h-4 w-4"/></button>
        <button aria-label="Khoảng thời gian tiếp theo" onClick={() => move(1)} className="rounded-lg border border-slate-300 p-2 text-[#1f4fc9]"><ChevronRight className="h-4 w-4"/></button>
        <div className="flex rounded-lg border border-slate-300 p-0.5 text-sm font-bold"><button onClick={() => setView('week')} className={`rounded-md px-3 py-1.5 ${view === 'week' ? 'bg-[#1f4fc9] text-white' : 'text-slate-600'}`}>Tuần</button><button onClick={() => setView('month')} className={`rounded-md px-3 py-1.5 ${view === 'month' ? 'bg-[#1f4fc9] text-white' : 'text-slate-600'}`}>Tháng</button></div>
      </div>
    </div>
    {view === 'week' ? <WeekView days={days} lessons={inRange} today={today} sessionName={sessionName} onOpenCourse={onOpenCourse}/> : <MonthView days={days} lessons={inRange} today={today} month={anchor.getMonth()} sessionName={sessionName} onOpenCourse={onOpenCourse}/>}
  </section>;
}

function WeekView({ days, lessons, today, sessionName, onOpenCourse }: { days: Date[]; lessons: LessonEvent[]; today: string; sessionName: (course: TrainingCourse) => string; onOpenCourse?: (courseId: string) => void }) {
  const startHour = 7, endHour = 22, pixelsPerMinute = 1.05;
  return <div className="overflow-x-auto"><div className="min-w-[960px]"><div className="grid grid-cols-[68px_repeat(7,minmax(0,1fr))] border-b border-slate-200 bg-slate-50"><div/>{days.map((day, index) => { const key = dateKey(day); return <div key={key} className="border-l border-slate-200 py-2 text-center text-sm"><span className="font-semibold text-slate-500">{weekDays[index]}</span><b className={`ml-1 inline-flex h-7 w-7 items-center justify-center rounded-full ${key === today ? 'bg-[#1f4fc9] text-white' : 'text-[#001e40]'}`}>{day.getDate()}</b></div>; })}</div><div className="grid grid-cols-[68px_repeat(7,minmax(0,1fr))]"><div className="relative h-[945px] border-r border-slate-200 text-right text-xs text-slate-400">{Array.from({ length: endHour - startHour + 1 }, (_, index) => <span key={index} className="absolute right-2 -translate-y-2" style={{ top: index * 60 * pixelsPerMinute }}>{pad(startHour + index)}:00</span>)}</div>{days.map((day) => { const key = dateKey(day); return <div key={key} className="relative h-[945px] border-r border-slate-200" style={{ backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 62px, #e7eef7 63px)' }}>{lessons.filter((lesson) => lesson.date === key).map((lesson) => { const top = Math.max(0, timeToMinutes(lesson.startTime) - startHour * 60) * pixelsPerMinute; const height = Math.max(46, (timeToMinutes(lesson.endTime) - timeToMinutes(lesson.startTime)) * pixelsPerMinute); return <button key={lesson.id} onClick={() => onOpenCourse?.(lesson.course.id)} className={`absolute inset-x-1 overflow-hidden rounded-lg border-l-4 p-2 text-left text-xs shadow-sm ${courseColor(lesson.course)}`} style={{ top, height }} title={`${lesson.course.name} · ${lesson.course.teacher}`}><b className="block">{lesson.startTime}–{lesson.endTime} · {lesson.label}</b><span className="block font-extrabold">{lesson.course.name}</span><span className="block truncate">GV: {lesson.course.teacher}</span><span className="block truncate">{sessionName(lesson.course)} · {lesson.course.mode}</span></button>; })}</div>; })}</div></div></div>;
}

function MonthView({ days, lessons, today, month, sessionName, onOpenCourse }: { days: Date[]; lessons: LessonEvent[]; today: string; month: number; sessionName: (course: TrainingCourse) => string; onOpenCourse?: (courseId: string) => void }) {
  return <div className="overflow-x-auto"><div className="min-w-[900px]"><div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">{weekDays.map((name) => <div key={name} className="border-r border-slate-200 py-2 text-center text-sm font-bold text-slate-500">{name}</div>)}</div><div className="grid grid-cols-7">{days.map((day) => { const key = dateKey(day), currentLessons = lessons.filter((lesson) => lesson.date === key); return <div key={key} className={`min-h-36 border-b border-r border-slate-200 p-2 ${day.getMonth() === month ? 'bg-white' : 'bg-slate-50 text-slate-400'}`}><b className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm ${key === today ? 'bg-[#1f4fc9] text-white' : ''}`}>{day.getDate()}</b><div className="mt-1 space-y-1">{currentLessons.slice(0, 3).map((lesson) => <button key={lesson.id} onClick={() => onOpenCourse?.(lesson.course.id)} className={`block w-full truncate rounded border-l-4 px-1.5 py-1 text-left text-[11px] font-bold ${courseColor(lesson.course)}`}><Clock3 className="mr-1 inline h-3 w-3"/>{lesson.startTime} {lesson.course.name}</button>)}{currentLessons.length > 3 && <span className="text-xs font-bold text-slate-500">+{currentLessons.length - 3} buổi khác</span>}</div></div>; })}</div></div></div>;
}
