import React, { useEffect, useMemo, useRef, useState } from 'react';
import { appDialog } from '../AppDialog';
import {
  CheckCircle2,
  Copy,
  Download,
  FileUp,
  Layers3,
  Lock,
  Plus,
  Save,
  X,
} from 'lucide-react';
import type { Competition, ExaminationSession } from './types';
import FormField from '../ui/FormField';

type Slot = {
  id?: string;
  position: number;
  questionType: 'single_choice' | 'numeric_input';
  optionCount: number;
  score: number;
  difficulty: string;
  difficultyLabel?: string;
  topic: string;
  knowledgeSource: string;
  knowledgeRequirements: string;
  prohibitedKnowledge: string;
  assessmentIntent: string;
  estimatedSeconds: number;
  metadata: Record<string, unknown>;
};
type Version = {
  id: string;
  versionNumber: number;
  status: string;
  note: string;
  slotCount: number;
  difficultyDistribution?: Record<string, number>;
  analysis?: {
    totalQuestions?: number;
    totalScore?: number;
    estimatedDurationMinutes?: number;
    difficultyDistribution?: Record<string, number>;
    questionTypeDistribution?: Record<string, number>;
    optionCountDistribution?: Record<string, number>;
    topicDistribution?: Record<string, number>;
    warnings?: Array<{ code: string; message: string }>;
    source?: { fileName?: string; importedAt?: string; sha256?: string };
  };
  slots?: Slot[];
  lockedAt?: string;
};
type Blueprint = {
  id: string;
  name: string;
  competitionId: string;
  competitionName: string;
  sessionId: string;
  sessionName: string;
  roundName: string;
  subject: string;
  gradeOrCategory: string;
  language: string;
  durationMinutes?: number;
  description: string;
  metadataSchema: Record<string, unknown>;
  versions: Version[];
};
type Props = {
  idToken?: string | null;
  userRole: string;
  competitions: Competition[];
  sessions: ExaminationSession[];
  onNavigate: (page: any, id?: string) => void;
};
const LEVELS = ['EASY', 'MEDIUM', 'HARD', 'VERY_HARD'];
const labels: Record<string, string> = {
  EASY: 'Dễ',
  MEDIUM: 'Trung bình',
  HARD: 'Khó',
  VERY_HARD: 'Rất khó',
  DRAFT: 'Nháp',
  LOCKED: 'Đã khóa',
  ARCHIVED: 'Lưu trữ',
};
const defaultDistribution = (total: number) => {
  const easy = Math.floor(total * 0.2),
    hard = Math.floor(total * 0.2),
    very = Math.floor(total * 0.1);
  return {
    EASY: easy,
    MEDIUM: total - easy - hard - very,
    HARD: hard,
    VERY_HARD: very,
  };
};
const emptySlot = (position: number): Slot => ({
  position,
  questionType: 'single_choice',
  optionCount: 4,
  score: 1,
  difficulty: 'MEDIUM',
  topic: '',
  knowledgeSource: '',
  knowledgeRequirements: '',
  prohibitedKnowledge: '',
  assessmentIntent: '',
  estimatedSeconds: 90,
  metadata: {},
});
function apiFactory(token?: string | null) {
  return async (path: string, options: RequestInit = {}) => {
    const form = options.body instanceof FormData;
    const response = await fetch('/api/examination' + path, {
      ...options,
      headers: {
        Authorization: `Bearer ${token || ''}`,
        ...(form ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers || {}),
      },
    });
    const body = (response.headers.get('content-type') || '').includes(
      'application/json',
    )
      ? await response.json()
      : await response.blob();
    if (!response.ok) {
      const detail = (body as any)?.error;
      const guidance =
        response.status === 401
          ? 'Phiên đăng nhập đã hết. Hãy đăng nhập lại.'
          : response.status === 403
            ? 'Tài khoản của bạn chưa có quyền thực hiện thao tác này.'
            : `Yêu cầu không thành công (mã ${response.status}). Hãy thử Đồng bộ lại; nếu vẫn lỗi, gửi mã này cho quản trị viên.`;
      throw new Error(detail || guidance);
    }
    return body as any;
  };
}
const Field = (props: { label: string; children: React.ReactNode }) => <FormField tone="brand" {...props} />;
const Notice = ({ value, onClose }: { value: string; onClose: () => void }) => (
  <div className="fixed bottom-5 right-5 z-50 max-w-md rounded-xl border border-blue-200 bg-white p-4 text-sm font-semibold text-[#001e40] shadow-xl">
    {value}
    <button onClick={onClose} className="ml-4 text-slate-500">
      <X className="h-4 w-4" />
    </button>
  </div>
);

function LegacyBlueprintLibrary({
  idToken,
  userRole,
  competitions,
  sessions,
  onNavigate,
}: Props) {
  const api = apiFactory(idToken),
    canManage = ['ADMIN', 'MANAGER'].includes(userRole);
  const [rows, setRows] = useState<Blueprint[]>([]),
    [show, setShow] = useState(false),
    [notice, setNotice] = useState('');
  const [form, setForm] = useState<any>({
    name: '',
    competitionId: '',
    sessionId: '',
    roundName: '',
    subject: '',
    gradeOrCategory: '',
    language: 'Tiếng Việt',
    totalQuestions: 20,
    difficultyDistribution: defaultDistribution(20),
    topics: '',
    questionType: 'single_choice',
    optionCount: 4,
    description: '',
  });
  const load = async () => {
    try {
      const data = await api('/blueprints');
      setRows(data.items || []);
    } catch (e: any) {
      setNotice(e.message);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const totalDifficulty = Object.values(form.difficultyDistribution).reduce(
    (a: any, b: any) => a + Number(b || 0),
    0,
  );
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totalDifficulty !== Number(form.totalQuestions)) {
      setNotice('Tổng số slot theo độ khó chưa đúng.');
      return;
    }
    try {
      const data = await api('/blueprints/draft-from-config', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          topics: form.topics
            .split(',')
            .map((x: string) => x.trim())
            .filter(Boolean),
        }),
      });
      onNavigate('blueprint-detail', data.blueprint.id);
    } catch (err: any) {
      setNotice(err.message);
    }
  };
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-[#001e40]">Ma trận đề</h1>
          <p className="mt-1 text-sm text-slate-600">
            Mọi đề được sinh từ một phiên bản ma trận đã khóa và các slot cố
            định.
          </p>
        </div>
        {canManage && (
          <button onClick={() => setShow(true)} className="ft-primary">
            <Plus className="h-4 w-4" />
            Tạo ma trận nháp
          </button>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((item) => {
          const locked =
            item.versions?.filter((x) => x.status === 'LOCKED').length || 0;
          const latest = item.versions?.[0];
          return (
            <button
              key={item.id}
              onClick={() => onNavigate('blueprint-detail', item.id)}
              className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-sky-300"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-extrabold text-[#001e40]">{item.name}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {item.competitionName || 'Chưa gắn cuộc thi'} ·{' '}
                    {item.roundName || 'Chưa chọn vòng'}
                  </p>
                </div>
                <Layers3 className="h-5 w-5 text-sky-700" />
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
                <span className="rounded-full bg-sky-50 px-2 py-1 text-sky-800">
                  {item.subject || 'Chưa có môn'} ·{' '}
                  {item.gradeOrCategory || 'Chưa có khối/bảng'}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-1">
                  {item.versions?.length || 0} phiên bản
                </span>
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">
                  {locked} đã khóa
                </span>
                {latest && (
                  <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">
                    v{latest.versionNumber}: {latest.slotCount} slot
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {!rows.length && (
        <div className="rounded-2xl border border-dashed p-12 text-center text-sm text-slate-500">
          Chưa có ma trận. Tạo từ wizard để hệ thống chuyển số câu và tỷ lệ
          thành slot trước khi sinh đề.
        </div>
      )}
      {show && (
        <div className="ft-dialog-backdrop fixed inset-0 z-50 grid place-items-center p-4">
          <form
            onSubmit={create}
            className="ft-dialog-panel max-h-[calc(100vh-2rem)] w-full max-w-4xl overflow-y-auto bg-white p-6"
          >
            <div className="flex justify-between gap-3">
              <div>
                <h2 className="text-xl font-extrabold">Tạo ma trận nháp</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Các tỷ lệ dưới đây chỉ tạo slot nháp để bạn kiểm tra; AI không
                  tự quyết định tỷ lệ.
                </p>
              </div>
              <button type="button" onClick={() => setShow(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label="Tên ma trận *">
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="ft-input"
                />
              </Field>
              <Field label="Cuộc thi">
                <select
                  value={form.competitionId}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      competitionId: e.target.value,
                      sessionId: '',
                    })
                  }
                  className="ft-input"
                >
                  <option value="">Chọn cuộc thi</option>
                  {competitions.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.code} · {x.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Kỳ thi">
                <select
                  value={form.sessionId}
                  onChange={(e) =>
                    setForm({ ...form, sessionId: e.target.value })
                  }
                  className="ft-input"
                >
                  <option value="">Không gắn kỳ cụ thể</option>
                  {sessions
                    .filter(
                      (x) =>
                        !form.competitionId ||
                        x.competitionId === form.competitionId,
                    )
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.code}: {x.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Vòng thi">
                <input
                  value={form.roundName}
                  onChange={(e) =>
                    setForm({ ...form, roundName: e.target.value })
                  }
                  className="ft-input"
                />
              </Field>
              <Field label="Môn">
                <input
                  value={form.subject}
                  onChange={(e) =>
                    setForm({ ...form, subject: e.target.value })
                  }
                  className="ft-input"
                />
              </Field>
              <Field label="Khối / bảng thi">
                <input
                  value={form.gradeOrCategory}
                  onChange={(e) =>
                    setForm({ ...form, gradeOrCategory: e.target.value })
                  }
                  className="ft-input"
                />
              </Field>
              <Field label="Tổng số câu">
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={form.totalQuestions}
                  onChange={(e) => {
                    const total = Math.max(1, Number(e.target.value) || 1);
                    setForm({
                      ...form,
                      totalQuestions: total,
                      difficultyDistribution: defaultDistribution(total),
                    });
                  }}
                  className="ft-input"
                />
              </Field>
              <Field label="Loại câu mặc định">
                <select
                  value={form.questionType}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      questionType: e.target.value,
                      optionCount:
                        e.target.value === 'numeric_input'
                          ? 0
                          : form.optionCount || 4,
                    })
                  }
                  className="ft-input"
                >
                  <option value="single_choice">Trắc nghiệm một đáp án</option>
                  <option value="numeric_input">Điền đáp số</option>
                </select>
              </Field>
              {form.questionType === 'single_choice' && (
                <Field label="Số phương án mặc định">
                  <input
                    type="number"
                    min="2"
                    max="8"
                    value={form.optionCount}
                    onChange={(e) =>
                      setForm({ ...form, optionCount: Number(e.target.value) })
                    }
                    className="ft-input"
                  />
                </Field>
              )}
              <Field label="Chủ đề (phân cách bằng dấu phẩy)">
                <input
                  value={form.topics}
                  onChange={(e) => setForm({ ...form, topics: e.target.value })}
                  placeholder="Số học, Đại số, Hình học"
                  className="ft-input"
                />
              </Field>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              {LEVELS.map((level) => (
                <Field key={level} label={labels[level]}>
                  <input
                    type="number"
                    min="0"
                    value={form.difficultyDistribution[level]}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        difficultyDistribution: {
                          ...form.difficultyDistribution,
                          [level]: Number(e.target.value),
                        },
                      })
                    }
                    className="ft-input"
                  />
                </Field>
              ))}
            </div>
            <p
              className={`mt-2 text-sm font-bold ${totalDifficulty === Number(form.totalQuestions) ? 'text-emerald-700' : 'text-rose-600'}`}
            >
              Tổng {totalDifficulty}/{form.totalQuestions} slot
            </p>
            <Field label="Mô tả / yêu cầu bổ sung">
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                className="ft-input mt-1 min-h-24"
              />
            </Field>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShow(false)}
                className="rounded-lg border px-4 py-2 text-sm font-bold"
              >
                Hủy
              </button>
              <button
                disabled={totalDifficulty !== Number(form.totalQuestions)}
                className="ft-primary disabled:opacity-50"
              >
                Tạo slot nháp
              </button>
            </div>
          </form>
        </div>
      )}
      {notice && <Notice value={notice} onClose={() => setNotice('')} />}
    </section>
  );
}

export function BlueprintLibrary(props: Props) {
  const api = apiFactory(props.idToken),
    [rows, setRows] = useState<Blueprint[]>([]),
    [notice, setNotice] = useState('');
  useEffect(() => {
    api('/blueprints')
      .then((data: any) => setRows(data.items || []))
      .catch((error: any) => setNotice(error.message));
  }, []);
  const h = React.createElement;
  return h(
    React.Fragment,
    null,
    h(
      'section',
      { className: 'space-y-5' },
      h(
        'div',
        { className: 'flex flex-wrap items-end justify-between gap-4' },
        h(
          'div',
          null,
          h(
            'h1',
            { className: 'text-3xl font-extrabold text-[#001e40]' },
            'Ma trận đề',
          ),
          h(
            'p',
            { className: 'mt-1 text-sm text-slate-600' },
            'Nhập ma trận Word/Excel, kiểm tra từng slot rồi khóa để làm đầu vào tạo đề nháp.',
          ),
        ),
      ),
      h(
        'div',
        { className: 'grid gap-4 lg:grid-cols-2' },
        ...rows.map((item) => {
          const locked =
            item.versions?.filter((version) => version.status === 'LOCKED')
              .length || 0;
          const latest = item.versions?.[0];
          return h(
            'button',
            {
              key: item.id,
              onClick: () => props.onNavigate('blueprint-detail', item.id),
              className:
                'rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-sky-300',
            },
            h(
              'div',
              { className: 'flex items-start justify-between gap-3' },
              h(
                'div',
                null,
                h(
                  'h2',
                  { className: 'font-extrabold text-[#001e40]' },
                  item.name,
                ),
                h(
                  'p',
                  { className: 'mt-1 text-sm text-slate-500' },
                  `${item.competitionName || 'Chưa gắn cuộc thi'} · ${item.roundName || 'Chưa chọn vòng'}`,
                ),
              ),
              h(Layers3, { className: 'h-5 w-5 text-sky-700' }),
            ),
            h(
              'div',
              { className: 'mt-4 flex flex-wrap gap-2 text-xs font-bold' },
              h(
                'span',
                { className: 'rounded-full bg-sky-50 px-2 py-1 text-sky-800' },
                `${item.subject || 'Chưa có môn'} · ${item.gradeOrCategory || 'Chưa có khối/bảng'}`,
              ),
              h(
                'span',
                {
                  className:
                    'rounded-full bg-emerald-50 px-2 py-1 text-emerald-700',
                },
                `${locked} phiên bản đã khóa`,
              ),
              latest
                ? h(
                    'span',
                    {
                      className:
                        'rounded-full bg-amber-50 px-2 py-1 text-amber-700',
                    },
                    `v${latest.versionNumber}: ${latest.slotCount} slot`,
                  )
                : null,
            ),
          );
        }),
      ),
      rows.length
        ? null
        : h(
            'div',
            {
              className:
                'rounded-2xl border border-dashed p-12 text-center text-sm text-slate-500',
            },
            'Chưa có ma trận. Dùng nút Nhập ma trận để tải Word/Excel; hệ thống không tạo ma trận thủ công thay cho tài liệu đặc tả.',
          ),
      notice
        ? h(Notice, { value: notice, onClose: () => setNotice('') })
        : null,
    ),
    h(BlueprintImportLauncher, props),
  );
}

function BlueprintImportLauncher({
  idToken,
  userRole,
  competitions,
  sessions,
  onNavigate,
}: Props) {
  const api = apiFactory(idToken),
    canManage = ['ADMIN', 'MANAGER'].includes(userRole),
    [open, setOpen] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [form, setForm] = useState({
      name: '',
      competitionId: '',
      sessionId: '',
      gradeOrCategory: '',
      subject: '',
      roundName: '',
      language: 'Tiếng Việt',
      durationMinutes: 60,
    });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return setNotice('Hãy chọn file Word hoặc Excel.');
    setBusy(true);
    try {
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) =>
        body.append(key, String(value || '')),
      );
      body.append('file', file);
      const result: any = await api('/blueprints/import', {
        method: 'POST',
        body,
      });
      onNavigate('blueprint-detail', result.blueprint.id);
    } catch (error: any) {
      setNotice(error.message);
      void appDialog.alert(error.message, { title: 'Không thể nhập ma trận', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  if (!canManage) return null;
  const availableSessions = sessions.filter(
    (item) => !form.competitionId || item.competitionId === form.competitionId,
  );
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 rounded-lg bg-[#0055da] px-4 py-3 text-sm font-bold text-white shadow-lg"
      >
        <FileUp className="mr-2 inline h-4 w-4" />
        Nhập ma trận
      </button>
      {open && (
        <div className="ft-dialog-backdrop fixed inset-0 z-50 grid place-items-center p-4">
          <form
            onSubmit={submit}
            className="ft-dialog-panel max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto bg-white p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-extrabold text-[#001e40]">
                  Nhập và phân tích ma trận
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Các thông tin dưới đây được lưu cùng hồ sơ ma trận và tự động dùng khi tạo đề.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label="File ma trận Word/Excel *">
                <input
                  required
                  type="file"
                  accept=".docx,.xlsx"
                  className="ft-input"
                  onChange={(event) => {
                    const selected = event.target.files?.[0] || null;
                    setFile(selected);
                    if (selected && !form.name) {
                      setForm({
                        ...form,
                        name: selected.name.replace(/\.(docx|xlsx)$/i, ''),
                      });
                    }
                  }}
                />
              </Field>
              <Field label="Tên ma trận *">
                <input
                  required
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  className="ft-input"
                />
              </Field>
              <Field label="Cuộc thi">
                <select
                  value={form.competitionId}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      competitionId: event.target.value,
                      sessionId: '',
                    })
                  }
                  className="ft-input"
                >
                  <option value="">Chưa gắn cuộc thi</option>
                  {competitions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} · {item.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Kỳ thi">
                <select
                  value={form.sessionId}
                  onChange={(event) =>
                    setForm({ ...form, sessionId: event.target.value })
                  }
                  className="ft-input"
                >
                  <option value="">Chưa gắn kỳ thi</option>
                  {availableSessions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Môn">
                <input
                  value={form.subject}
                  onChange={(event) =>
                    setForm({ ...form, subject: event.target.value })
                  }
                  className="ft-input"
                  placeholder="Toán, Tiếng Anh..."
                />
              </Field>
              <Field label="Khối lớp / bảng thi">
                <input
                  value={form.gradeOrCategory}
                  onChange={(event) =>
                    setForm({ ...form, gradeOrCategory: event.target.value })
                  }
                  className="ft-input"
                  placeholder="Khối 7, Bảng A..."
                />
              </Field>
              <Field label="Vòng / kỳ tổ chức">
                <input
                  value={form.roundName}
                  onChange={(event) =>
                    setForm({ ...form, roundName: event.target.value })
                  }
                  className="ft-input"
                />
              </Field>
              <Field label="Thời gian làm bài (phút)">
                <input
                  type="number"
                  min="1"
                  value={form.durationMinutes}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      durationMinutes: Number(event.target.value) || 60,
                    })
                  }
                  className="ft-input"
                />
              </Field>
              <Field label="Ngôn ngữ">
                <select
                  value={form.language}
                  onChange={(event) =>
                    setForm({ ...form, language: event.target.value })
                  }
                  className="ft-input"
                >
                  <option>Tiếng Việt</option>
                  <option>Tiếng Anh</option>
                </select>
              </Field>
            </div>
            {notice && (
              <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">
                {notice}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border px-4 py-2 text-sm font-bold"
              >
                Hủy
              </button>
              <button disabled={busy || !file || !form.name.trim()} className="ft-primary disabled:opacity-50">
                {busy ? 'Đang phân tích...' : 'Nhập và lưu hồ sơ'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

export function BlueprintEditor({
  idToken,
  userRole,
  onNavigate,
  blueprintId,
}: Props & { blueprintId: string }) {
  const api = apiFactory(idToken),
    canManage = ['ADMIN', 'MANAGER'].includes(userRole),
    fileRef = useRef<HTMLInputElement>(null);
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null),
    [versionId, setVersionId] = useState(''),
    [slots, setSlots] = useState<Slot[]>([]),
    [busy, setBusy] = useState(''),
    [notice, setNotice] = useState('');
  const load = async (preferredVersionId = '') => {
    try {
      const data = await api(`/blueprints/${blueprintId}`);
      setBlueprint(data);
      const version =
        data.versions?.find(
          (x: Version) => x.id === (preferredVersionId || versionId),
        ) || data.versions?.[0];
      if (version) {
        setVersionId(version.id);
        setSlots(version.slots || []);
      }
    } catch (e: any) {
      setNotice(e.message);
    }
  };
  useEffect(() => {
    load();
  }, [blueprintId]);
  const version = useMemo(
    () => blueprint?.versions.find((x) => x.id === versionId),
    [blueprint, versionId],
  );
  const editable = canManage && version?.status === 'DRAFT';
  const save = async () => {
    if (!version) return;
    setBusy('save');
    try {
      const data = await api(`/blueprint-versions/${version.id}`, {
        method: 'PUT',
        body: JSON.stringify({ slots }),
      });
      setSlots(data.slots || []);
      await load();
      setNotice('Đã lưu các slot của phiên bản nháp.');
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy('');
    }
  };
  const lock = async () => {
    if (
      !version ||
      !(await appDialog.confirm(
        'Khóa phiên bản này? Sau đó muốn sửa phải tạo phiên bản mới.',
        {
          title: 'Khóa phiên bản ma trận',
          confirmText: 'Khóa phiên bản',
          tone: 'warning',
        },
      ))
    )
      return;
    setBusy('lock');
    try {
      await api(`/blueprint-versions/${version.id}/lock`, {
        method: 'POST',
        body: '{}',
      });
      await load();
      setNotice('Đã khóa phiên bản ma trận.');
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy('');
    }
  };
  const newVersion = async () => {
    try {
      const data = await api(`/blueprints/${blueprintId}/versions`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setVersionId(data.id);
      await load(data.id);
      setNotice('Đã tạo phiên bản nháp mới từ phiên bản gần nhất.');
    } catch (e: any) {
      setNotice(e.message);
    }
  };
  const importFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !version) return;
    const body = new FormData();
    body.append('file', file);
    setBusy('import');
    try {
      let targetVersionId = version.id;
      if (version.status !== 'DRAFT') {
        const created = await api(`/blueprints/${blueprintId}/versions`, {
          method: 'POST',
          body: JSON.stringify({ note: `Nhập lại từ ${file.name}` }),
        });
        targetVersionId = created.id;
      }
      const data = await api(`/blueprint-versions/${targetVersionId}/import`, {
        method: 'POST',
        body,
      });
      setVersionId(targetVersionId);
      setSlots(data.slots || []);
      await load(targetVersionId);
      setNotice(
        `Đã phân tích và lưu hồ sơ ${data.analysis?.totalQuestions || data.slots?.length || 0} câu từ ${file.name}.`,
      );
    } catch (err: any) {
      setNotice(err.message);
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const exportFile = async (type: 'docx' | 'xlsx') => {
    if (!version) return;
    setBusy(`export-${type}`);
    try {
      const blob = await api(`/blueprint-versions/${version.id}/export/${type}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${blueprint?.name || 'ma-tran-de'}-v${version.versionNumber}.${type}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      setNotice(error.message);
    } finally {
      setBusy('');
    }
  };
  if (!blueprint)
    return <p className="p-8 text-slate-500">Đang tải ma trận đề...</p>;
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            onClick={() => onNavigate('blueprints')}
            className="text-sm font-bold text-[#1f4fc9]"
          >
            ← Quay lại Ma trận đề
          </button>
          <h1 className="mt-3 text-3xl font-extrabold text-[#001e40]">
            {blueprint.name}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {blueprint.competitionName || 'Chưa gắn cuộc thi'} ·{' '}
            {blueprint.roundName || 'Chưa chọn vòng'} ·{' '}
            {blueprint.subject || 'Chưa có môn'} ·{' '}
            {blueprint.gradeOrCategory || 'Chưa có khối/bảng'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={versionId}
            onChange={(e) => {
              const next = blueprint.versions.find(
                (x) => x.id === e.target.value,
              );
              setVersionId(e.target.value);
              setSlots(next?.slots || []);
            }}
            className="ft-input max-w-40"
          >
            {blueprint.versions.map((x) => (
              <option key={x.id} value={x.id}>
                v{x.versionNumber} · {labels[x.status]}
              </option>
            ))}
          </select>
          {canManage && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.docx"
                className="hidden"
                onChange={importFile}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={!!busy}
                className="ft-primary"
              >
                <FileUp className="h-4 w-4" />
                Nhập file
              </button>
            </>
          )}
          <button
            onClick={() => exportFile('docx')}
            disabled={!version || !!busy}
            className="rounded-lg border px-3 py-2 text-sm font-bold"
          >
            <Download className="mr-1 inline h-4 w-4" />
            Xuất Word
          </button>
          <button
            onClick={() => exportFile('xlsx')}
            disabled={!version || !!busy}
            className="rounded-lg border px-3 py-2 text-sm font-bold"
          >
            <Download className="mr-1 inline h-4 w-4" />
            Xuất Excel
          </button>
          {canManage && (
            <button
              onClick={newVersion}
              className="rounded-lg border px-3 py-2 text-sm font-bold"
            >
              <Copy className="mr-1 inline h-4 w-4" />
              Phiên bản mới
            </button>
          )}
          {editable && (
            <button onClick={lock} disabled={!!busy} className="ft-primary">
              <Lock className="h-4 w-4" />
              Khóa phiên bản
            </button>
          )}
        </div>
      </div>
      {version?.analysis && (
        <section className="rounded-2xl border border-sky-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-extrabold text-[#001e40]">
                Hồ sơ ma trận đã phân tích
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Hồ sơ này được lưu ngay lúc nhập file và được dùng trực tiếp khi tạo đề.
              </p>
            </div>
            <div className="text-right text-sm font-bold text-[#001e40]">
              {version.analysis.totalQuestions || 0} câu ·{' '}
              {version.analysis.totalScore || 0} điểm
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ProfileBox
              label="Phân bố độ khó gốc"
              values={version.analysis.difficultyDistribution}
            />
            <ProfileBox
              label="Dạng câu"
              values={version.analysis.questionTypeDistribution}
            />
            <ProfileBox
              label="Số phương án"
              values={version.analysis.optionCountDistribution}
            />
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <b className="text-[#001e40]">File nguồn</b>
              <p className="mt-1 break-all text-slate-600">
                {version.analysis.source?.fileName || 'Dữ liệu cũ / chỉnh thủ công'}
              </p>
            </div>
          </div>
          {!!version.analysis.warnings?.length && (
            <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              {version.analysis.warnings.map((warning) => (
                <p key={warning.code}>• {warning.message}</p>
              ))}
            </div>
          )}
        </section>
      )}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-extrabold text-[#001e40]">
              Slot của phiên bản v{version?.versionNumber}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {editable
                ? 'Chỉnh sửa xong rồi khóa trước khi tạo đề.'
                : 'Phiên bản đã khóa; đề sinh từ đây sẽ giữ nguyên cấu trúc.'}
            </p>
          </div>
          {editable && (
            <div className="flex gap-2">
              <button
                onClick={() =>
                  setSlots([...slots, emptySlot(slots.length + 1)])
                }
                className="rounded-lg border px-3 py-2 text-sm font-bold text-[#1f4fc9]"
              >
                <Plus className="mr-1 inline h-4 w-4" />
                Thêm slot
              </button>
              <button onClick={save} disabled={!!busy} className="ft-primary">
                <Save className="h-4 w-4" />
                Lưu
              </button>
            </div>
          )}
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="ft-table min-w-[1250px]">
            <thead>
              <tr>
                <th>Vị trí</th>
                <th>Loại câu</th>
                <th>PA</th>
                <th>Điểm</th>
                <th>Độ khó (theo file)</th>
                <th>Chủ đề</th>
                <th>Nguồn / yêu cầu kiến thức</th>
                <th>Không sử dụng</th>
                <th>Assessment Intent</th>
                <th>Giây</th>
                {editable && <th />}
              </tr>
            </thead>
            <tbody>
              {slots.map((slot, index) => (
                <tr key={slot.id || index}>
                  <td>
                    {editable ? (
                      <input
                        type="number"
                        min="1"
                        value={slot.position}
                        onChange={(e) =>
                          setSlots(
                            slots.map((x, i) =>
                              i === index
                                ? { ...x, position: Number(e.target.value) }
                                : x,
                            ),
                          )
                        }
                        className="w-16 rounded border p-1"
                      />
                    ) : (
                      slot.position
                    )}
                  </td>
                  <td>
                    {editable ? (
                      <select
                        value={slot.questionType}
                        onChange={(e) =>
                          setSlots(
                            slots.map((x, i) =>
                              i === index
                                ? {
                                    ...x,
                                    questionType: e.target.value as any,
                                    optionCount:
                                      e.target.value === 'numeric_input'
                                        ? 0
                                        : x.optionCount,
                                  }
                                : x,
                            ),
                          )
                        }
                        className="rounded border p-1"
                      >
                        <option value="single_choice">Trắc nghiệm</option>
                        <option value="numeric_input">Đáp số</option>
                      </select>
                    ) : (
                      slot.questionType
                    )}
                  </td>
                  <td>
                    {editable ? (
                      <input
                        type="number"
                        min="0"
                        max="8"
                        disabled={slot.questionType === 'numeric_input'}
                        value={slot.optionCount}
                        onChange={(e) =>
                          setSlots(
                            slots.map((x, i) =>
                              i === index
                                ? { ...x, optionCount: Number(e.target.value) }
                                : x,
                            ),
                          )
                        }
                        className="w-14 rounded border p-1"
                      />
                    ) : (
                      slot.optionCount || '—'
                    )}
                  </td>
                  <td>
                    {editable ? (
                      <input
                        type="number"
                        min="0.01"
                        step="0.25"
                        value={slot.score}
                        onChange={(e) =>
                          setSlots(
                            slots.map((x, i) =>
                              i === index
                                ? { ...x, score: Number(e.target.value) }
                                : x,
                            ),
                          )
                        }
                        className="w-16 rounded border p-1"
                      />
                    ) : (
                      slot.score
                    )}
                  </td>
                  <td>
                    {editable ? (
                      <input
                        value={
                          slot.difficultyLabel ||
                          String(
                            slot.metadata?.difficultyLabel ||
                              labels[slot.difficulty] ||
                              slot.difficulty,
                          )
                        }
                        onChange={(e) =>
                          setSlots(
                            slots.map((x, i) =>
                              i === index
                                ? {
                                    ...x,
                                    difficultyLabel: e.target.value,
                                    metadata: {
                                      ...x.metadata,
                                      difficultyLabel: e.target.value,
                                    },
                                  }
                                : x,
                            ),
                          )
                        }
                        className="w-28 rounded border p-1"
                      />
                    ) : (
                      slot.difficultyLabel ||
                      String(
                        slot.metadata?.difficultyLabel ||
                          labels[slot.difficulty] ||
                          slot.difficulty,
                      )
                    )}
                  </td>
                  <td>
                    {editable ? (
                      <input
                        value={slot.topic}
                        onChange={(e) =>
                          setSlots(
                            slots.map((x, i) =>
                              i === index ? { ...x, topic: e.target.value } : x,
                            ),
                          )
                        }
                        className="w-36 rounded border p-1"
                      />
                    ) : (
                      slot.topic || '—'
                    )}
                  </td>
                  <td>
                    {editable ? (
                      <textarea
                        value={slot.knowledgeRequirements}
                        onChange={(e) =>
                          setSlots(
                            slots.map((x, i) =>
                              i === index
                                ? {
                                    ...x,
                                    knowledgeRequirements: e.target.value,
                                  }
                                : x,
                            ),
                          )
                        }
                        className="w-48 rounded border p-1"
                      />
                    ) : (
                      slot.knowledgeRequirements || '—'
                    )}
                  </td>
                  <td>
                    {editable ? (
                      <textarea
                        value={slot.prohibitedKnowledge}
                        onChange={(e) =>
                          setSlots(
                            slots.map((x, i) =>
                              i === index
                                ? { ...x, prohibitedKnowledge: e.target.value }
                                : x,
                            ),
                          )
                        }
                        className="w-40 rounded border p-1"
                      />
                    ) : (
                      slot.prohibitedKnowledge || '—'
                    )}
                  </td>
                  <td>
                    {editable ? (
                      <textarea
                        value={slot.assessmentIntent}
                        onChange={(e) =>
                          setSlots(
                            slots.map((x, i) =>
                              i === index
                                ? { ...x, assessmentIntent: e.target.value }
                                : x,
                            ),
                          )
                        }
                        className="w-48 rounded border p-1"
                      />
                    ) : (
                      slot.assessmentIntent || '—'
                    )}
                  </td>
                  <td>
                    {editable ? (
                      <input
                        type="number"
                        min="1"
                        value={slot.estimatedSeconds}
                        onChange={(e) =>
                          setSlots(
                            slots.map((x, i) =>
                              i === index
                                ? {
                                    ...x,
                                    estimatedSeconds: Number(e.target.value),
                                  }
                                : x,
                            ),
                          )
                        }
                        className="w-16 rounded border p-1"
                      />
                    ) : (
                      slot.estimatedSeconds
                    )}
                  </td>
                  {editable && (
                    <td>
                      <button
                        onClick={() =>
                          setSlots(
                            slots
                              .filter((_, i) => i !== index)
                              .map((x, i) => ({ ...x, position: i + 1 })),
                          )
                        }
                        className="text-rose-600"
                      >
                        Xóa
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {notice && <Notice value={notice} onClose={() => setNotice('')} />}
    </section>
  );
}

function ProfileBox({
  label,
  values,
}: {
  label: string;
  values?: Record<string, number>;
}) {
  const entries = Object.entries(values || {});
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-sm">
      <b className="text-[#001e40]">{label}</b>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entries.length ? (
          entries.map(([key, value]) => (
            <span
              key={key}
              className="rounded-full bg-white px-2 py-1 font-bold text-slate-700 shadow-sm"
            >
              {key}: {value}
            </span>
          ))
        ) : (
          <span className="text-slate-500">Chưa có dữ liệu</span>
        )}
      </div>
    </div>
  );
}
