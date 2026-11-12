import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, ExternalLink, MoreHorizontal } from 'lucide-react';

const outline = 'inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45';

/** Nút mở trang công khai và sao chép liên kết. Trang chưa công bố thì nút Mở
 *  bị khóa, vì URL công khai chưa truy cập được. */
export function PublicPageButtons({ path, published }: { path: string; published: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${path}`;
  useEffect(() => setCopied(false), [path]);
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); }
  };
  return <>
    {published
      ? <a href={path} target="_blank" rel="noreferrer" className={outline} title={url}><ExternalLink className="h-4 w-4" />Mở trang</a>
      : <button type="button" disabled className={outline} title="Công bố trang để mở được liên kết công khai"><ExternalLink className="h-4 w-4" />Mở trang</button>}
    <button type="button" onClick={() => void copyLink()} className={outline} title={url}>{copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}{copied ? 'Đã sao chép' : 'Sao chép link'}</button>
  </>;
}

/** Gom các thao tác ít dùng (nhân bản, lưu mẫu, xóa) để thanh công cụ chỉ còn việc chính. */
export function MoreMenu({ items }: { items: Array<{ label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean } | false> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  const visible = items.filter(Boolean) as Exclude<(typeof items)[number], false>[];
  return <div ref={ref} className="relative">
    <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label="Thao tác khác" onClick={() => setOpen(value => !value)} className={outline}><MoreHorizontal className="h-4 w-4" /></button>
    {open && <div role="menu" className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
      {visible.map(item => <button key={item.label} role="menuitem" type="button" disabled={item.disabled} onClick={() => { setOpen(false); item.onClick(); }} className={`flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm font-semibold disabled:opacity-40 ${item.danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-50'}`}>{item.icon}{item.label}</button>)}
    </div>}
  </div>;
}
