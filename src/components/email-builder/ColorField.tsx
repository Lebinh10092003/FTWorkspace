import React from 'react';
import { ChevronDown, Palette } from 'lucide-react';
import {
  EMAIL_COLOR_SWATCHES,
  EmailColorSwatch,
  formatEmailColor,
  normalizeEmailColor,
  parseEmailColor,
} from '../../lib/emailColor';

export { EMAIL_COLOR_SWATCHES } from '../../lib/emailColor';

interface ColorFieldProps {
  label: string;
  value?: string;
  fallback?: string;
  swatches?: EmailColorSwatch[];
  onChange: (color: string) => void;
  compact?: boolean;
}

export default function ColorField({
  label,
  value,
  fallback = '#FFFFFF',
  swatches = EMAIL_COLOR_SWATCHES,
  onChange,
  compact = false,
}: ColorFieldProps) {
  const initialFormat = String(value || '').trim().toLowerCase().startsWith('rgb') ? 'rgb' : 'hex';
  const [format, setFormat] = React.useState<'hex' | 'rgb'>(initialFormat);
  const [draft, setDraft] = React.useState(() => formatEmailColor(value, initialFormat, fallback));
  const [showPalette, setShowPalette] = React.useState(false);

  React.useEffect(() => {
    setDraft(formatEmailColor(value, format, fallback));
  }, [fallback, format, value]);

  const commit = (next: string) => {
    const parsed = parseEmailColor(next);
    if (!parsed) return false;
    setDraft(format === 'rgb' ? parsed.rgb : parsed.hex);
    onChange(parsed.hex);
    return true;
  };

  const parsedDraft = parseEmailColor(draft);
  const parsedValue = parseEmailColor(value) || parseEmailColor(fallback);
  const pickerValue = parsedDraft?.hex || normalizeEmailColor(fallback);
  const quickColorValues = ['#0F3A72', '#1473D1', '#16A34A', '#EA580C', '#E11D48', '#7C3AED', '#F59E0B', '#0891B2', '#FFFFFF', '#F1F5F9', '#1E293B', '#000000'];
  const preferredSwatches = quickColorValues.map(color => swatches.find(swatch => normalizeEmailColor(swatch.value) === color)).filter(Boolean) as EmailColorSwatch[];
  const quickSwatches = (preferredSwatches.length ? preferredSwatches : swatches).slice(0, compact ? 8 : 12);
  const setColorFormat = (nextFormat: 'hex' | 'rgb') => {
    setFormat(nextFormat);
    setDraft(formatEmailColor(draft, nextFormat, fallback));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="block text-xs font-bold text-slate-600">{label}</label>
        <div className="flex rounded-lg bg-slate-100 p-0.5" aria-label="Định dạng mã màu">
          {(['hex', 'rgb'] as const).map(item => (
            <button
              key={item}
              type="button"
              onClick={() => setColorFormat(item)}
              className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase transition min-h-[36px] ${
                format === item ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={pickerValue}
          onChange={event => commit(event.target.value)}
          className="h-11 w-11 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1 shadow-sm min-h-[44px] min-w-[44px]"
          aria-label={`Mở bộ chọn ${label.toLowerCase()}`}
          title="Mở bộ chọn màu đầy đủ"
        />
        <input
          type="text"
          value={draft}
          onChange={event => {
            const next = event.target.value;
            setDraft(next);
            const parsed = parseEmailColor(next);
            if (parsed) onChange(parsed.hex);
          }}
          onBlur={() => {
            if (!commit(draft)) setDraft(formatEmailColor(value, format, fallback));
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit(draft);
              event.currentTarget.blur();
            }
          }}
          spellCheck={false}
          className={`h-11 min-h-[44px] min-w-0 flex-1 rounded-lg border px-3 text-xs font-semibold outline-none shadow-sm transition ${
            parsedDraft ? 'border-slate-200 focus:border-blue-500' : 'border-rose-300 bg-rose-50 text-rose-700 focus:border-rose-400'
          }`}
          placeholder={format === 'rgb' ? 'rgb(20, 115, 209)' : '#1473D1'}
          aria-invalid={!parsedDraft}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {quickSwatches.map(swatch => (
          <button
            key={swatch.value}
            type="button"
            onClick={() => commit(swatch.value)}
            title={`${swatch.name} · ${swatch.value}`}
            aria-label={`Chọn màu ${swatch.name}`}
            className={`h-9 w-9 min-h-[36px] min-w-[36px] rounded-lg border transition hover:-translate-y-0.5 ${
              parsedDraft?.hex === normalizeEmailColor(swatch.value)
                ? 'border-white ring-2 ring-blue-550'
                : 'border-slate-300'
            }`}
            style={{ backgroundColor: swatch.value }}
          />
        ))}
        {swatches.length > quickSwatches.length && (
          <button
            type="button"
            onClick={() => setShowPalette(open => !open)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:border-blue-300 hover:text-blue-700 min-h-[40px]"
            aria-expanded={showPalette}
          >
            <Palette className="h-4 w-4" />
            {showPalette ? 'Thu gọn' : 'Bảng màu'}
            <ChevronDown className={`h-4 w-4 transition ${showPalette ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      {showPalette && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-inner">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(36px,1fr))] gap-2">
            {swatches.map(swatch => (
              <button
                key={swatch.value}
                type="button"
                onClick={() => commit(swatch.value)}
                title={`${swatch.name} · ${swatch.value}`}
                aria-label={`Chọn màu ${swatch.name}`}
                className={`aspect-square min-h-9 min-w-9 rounded-lg border transition hover:scale-105 ${
                  parsedDraft?.hex === normalizeEmailColor(swatch.value)
                    ? 'border-white ring-2 ring-blue-550'
                    : 'border-slate-300'
                }`}
                style={{ backgroundColor: swatch.value }}
              />
            ))}
          </div>
        </div>
      )}
      {parsedDraft ? (
        <p className="text-xs font-medium text-slate-400">{parsedDraft.hex} · {parsedDraft.rgb}</p>
      ) : (
        <p className="text-xs font-bold text-rose-600">Nhập #RGB, #RRGGBB hoặc rgb(0, 0, 0).</p>
      )}
    </div>
  );
}