import React from 'react';

export default function PaymentImagesInput({ files, onChange, onError, disabled = false }: {
  files: File[]; onChange: (files: File[]) => void; onError: (message: string) => void; disabled?: boolean;
}) {
  const add = (incoming: File[]) => {
    if (disabled || !incoming.length) return;
    const next = [...files, ...incoming];
    if (next.length > 20) { onError('Mỗi lần tối đa 20 ảnh.'); return; }
    if (incoming.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) { onError('Chỉ nhận ảnh PNG, JPEG hoặc WebP.'); return; }
    if (incoming.some(file => file.size > 5 * 1024 * 1024)) { onError('Mỗi ảnh tối đa 5 MB.'); return; }
    if (next.reduce((total, file) => total + file.size, 0) > 10 * 1024 * 1024) { onError('Tổng dung lượng mỗi lần tối đa 10 MB.'); return; }
    onChange(next); onError('');
  };
  return <div>
    <label className="block cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-600" tabIndex={0}
      onPaste={event => add(Array.from(event.clipboardData.files))} onDragOver={event => event.preventDefault()}
      onDrop={event => { event.preventDefault(); add(Array.from(event.dataTransfer.files)); }}>
      Chọn nhiều ảnh chuyển khoản, kéo thả hoặc Ctrl+V. Mỗi ảnh tối đa 5 MB, tổng 10 MB/lần.
      <input disabled={disabled} type="file" multiple accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={event => { add(Array.from(event.target.files || [])); event.target.value = ''; }} />
    </label>
    {files.map((file, index) => <div key={`${file.name}-${index}`} className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"><span>{index + 1}. {file.name}</span><button disabled={disabled} type="button" onClick={() => onChange(files.filter((_, i) => i !== index))} className="text-rose-700">Bỏ ảnh</button></div>)}
  </div>;
}
