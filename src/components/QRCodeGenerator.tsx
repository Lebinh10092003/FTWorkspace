import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Clipboard, Download, ExternalLink, FileImage, Link2, LockKeyhole, QrCode, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';

type QRCodeGeneratorProps = { onBackToWorkspace: () => void; backLabel?: string };
type UrlAssessment = { normalizedUrl: string; hostname: string; error: string; warnings: string[]; checks: Array<{ label: string; passed: boolean }> };
type LinkVerification = {
  status: 'idle' | 'checking' | 'valid' | 'invalid';
  sourceUrl: string;
  resolvedUrl: string;
  error: string;
};

const SHORT_LINK_HOSTS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'forms.gle', 'shorturl.at', 'rebrand.ly', 'ow.ly', 'buff.ly', 'cutt.ly', 'vnlink.top']);
const REDIRECT_PARAM_NAMES = new Set(['redirect', 'redirect_url', 'redirect_uri', 'return', 'return_url', 'target', 'url', 'destination', 'dest']);

function assessUrl(rawValue: string): UrlAssessment {
  const value = rawValue.trim();
  if (!value) return { normalizedUrl: '', hostname: '', error: '', warnings: [], checks: [] };
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let parsed: URL;
  try { parsed = new URL(withProtocol); }
  catch { return { normalizedUrl: '', hostname: '', error: 'Đường dẫn chưa đúng định dạng. Ví dụ: https://forms.google.com/...', warnings: [], checks: [] }; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return { normalizedUrl: '', hostname: parsed.hostname, error: 'Chỉ hỗ trợ đường dẫn web bắt đầu bằng https:// hoặc http://.', warnings: [], checks: [] };
  if (!parsed.hostname || !parsed.hostname.includes('.')) return { normalizedUrl: '', hostname: parsed.hostname, error: 'Tên miền chưa hợp lệ. Hãy kiểm tra lại đường dẫn.', warnings: [], checks: [] };

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const warnings: string[] = [];
  const isShortLink = SHORT_LINK_HOSTS.has(hostname);
  const hasRedirectParam = [...parsed.searchParams.keys()].some(key => REDIRECT_PARAM_NAMES.has(key.toLowerCase()));
  if (parsed.protocol !== 'https:') warnings.push('Link dùng HTTP nên một số điện thoại có thể hiện cảnh báo không an toàn.');
  if (isShortLink) warnings.push(hostname === 'forms.gle' ? 'forms.gle là link rút gọn. Nên mở form rồi sao chép URL đầy đủ dạng docs.google.com/forms/...' : 'Đây là tên miền rút gọn; máy quét có thể cảnh báo vì chưa thấy tên miền đích thật.');
  if (hasRedirectParam) warnings.push('Link có tham số chuyển hướng. Nếu có thể, hãy dùng trực tiếp URL cuối cùng.');
  return { normalizedUrl: parsed.toString(), hostname, error: '', warnings, checks: [
    { label: 'Kết nối HTTPS', passed: parsed.protocol === 'https:' },
    { label: 'Không dùng link rút gọn', passed: !isShortLink },
    { label: 'Không có tham số chuyển hướng', passed: !hasRedirectParam },
  ] };
}

function safeFilename(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 70) || 'ma-qr';
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath(); context.moveTo(x + r, y); context.arcTo(x + width, y, x + width, y + height, r); context.arcTo(x + width, y + height, x, y + height, r); context.arcTo(x, y + height, x, y, r); context.arcTo(x, y, x + width, y, r); context.closePath();
}

function triggerDownload(dataUrl: string, filename: string) {
  const anchor = document.createElement('a'); anchor.href = dataUrl; anchor.download = filename; anchor.click();
}

export default function QRCodeGenerator({ onBackToWorkspace, backLabel = 'Workspace' }: QRCodeGeneratorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rawUrl, setRawUrl] = useState('');
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('Khảo sát tập huấn');
  const [foreground, setForeground] = useState('#102A43');
  const [previewUrl, setPreviewUrl] = useState('');
  const [renderError, setRenderError] = useState('');
  const [notice, setNotice] = useState('');
  const [verification, setVerification] = useState<LinkVerification>({ status: 'idle', sourceUrl: '', resolvedUrl: '', error: '' });
  const assessment = useMemo(() => assessUrl(rawUrl), [rawUrl]);
  const isGoogleShortLink = assessment.hostname === 'forms.gle';
  const verifiedGoogleShortLink = isGoogleShortLink
    && verification.status === 'valid'
    && verification.sourceUrl === assessment.normalizedUrl;
  const effectiveUrl = isGoogleShortLink
    ? (verifiedGoogleShortLink ? verification.resolvedUrl : '')
    : assessment.normalizedUrl;
  const effectiveHostname = useMemo(() => {
    if (!effectiveUrl) return assessment.hostname;
    try { return new URL(effectiveUrl).hostname; } catch { return assessment.hostname; }
  }, [assessment.hostname, effectiveUrl]);
  const hasUrlError = Boolean(
    assessment.error
    || (isGoogleShortLink && verification.sourceUrl === assessment.normalizedUrl && verification.status === 'invalid'),
  );
  const displayedChecks = verifiedGoogleShortLink
    ? assessment.checks.map(check => check.label === 'Không dùng link rút gọn' ? { label: 'Đã giải nén forms.gle', passed: true } : check)
    : assessment.checks;
  const displayedWarnings = verifiedGoogleShortLink
    ? assessment.warnings.filter(warning => !warning.includes('forms.gle'))
    : assessment.warnings;
  const canGenerate = Boolean(effectiveUrl && !assessment.error);

  useEffect(() => {
    if (!isGoogleShortLink || !assessment.normalizedUrl || assessment.error) {
      setVerification({ status: 'idle', sourceUrl: '', resolvedUrl: '', error: '' });
      return;
    }

    const sourceUrl = assessment.normalizedUrl;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setVerification({ status: 'checking', sourceUrl, resolvedUrl: '', error: '' });
      try {
        const response = await fetch('/api/auth/qr/resolve-google-form', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url: sourceUrl }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({})) as { resolvedUrl?: string; error?: string };
        if (!response.ok || !payload.resolvedUrl) {
          throw new Error(payload.error || 'Không thể xác minh liên kết Google Forms này.');
        }
        setVerification({ status: 'valid', sourceUrl, resolvedUrl: payload.resolvedUrl, error: '' });
      } catch (error) {
        if (controller.signal.aborted) return;
        setVerification({
          status: 'invalid',
          sourceUrl,
          resolvedUrl: '',
          error: error instanceof Error ? error.message : 'Không thể xác minh liên kết Google Forms này.',
        });
      }
    }, 450);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [assessment.error, assessment.normalizedUrl, isGoogleShortLink]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    if (!canGenerate) { const context = canvas.getContext('2d'); if (context) context.clearRect(0, 0, canvas.width, canvas.height); setPreviewUrl(''); setRenderError(''); return; }
    setPreviewUrl('');
    QRCode.toCanvas(canvas, effectiveUrl, { width: 960, margin: 4, errorCorrectionLevel: 'H', color: { dark: foreground, light: '#FFFFFF' } })
      .then(() => { if (!cancelled) { setPreviewUrl(canvas.toDataURL('image/png')); setRenderError(''); } })
      .catch(() => { if (!cancelled) { setPreviewUrl(''); setRenderError('Không thể tạo mã QR từ đường dẫn này.'); } });
    return () => { cancelled = true; };
  }, [canGenerate, effectiveUrl, foreground]);

  useEffect(() => { if (!notice) return; const timeout = window.setTimeout(() => setNotice(''), 2600); return () => window.clearTimeout(timeout); }, [notice]);

  const downloadQR = () => {
    const canvas = canvasRef.current; if (!canvas || !canGenerate) return;
    triggerDownload(canvas.toDataURL('image/png'), `${safeFilename(title || effectiveHostname)}-qr.png`); setNotice('Đã tải mã QR PNG chất lượng cao.');
  };

  const copyQR = async () => {
    const canvas = canvasRef.current; if (!canvas || !canGenerate) return;
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') { downloadQR(); setNotice('Thiết bị không hỗ trợ sao chép ảnh; mã QR đã được tải xuống.'); return; }
    try {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Canvas export failed')), 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); setNotice('Đã sao chép ảnh QR.');
    } catch { setNotice('Trình duyệt chưa cho phép sao chép ảnh. Bạn có thể tải PNG.'); }
  };

  const downloadPoster = () => {
    const source = canvasRef.current;
    if (!source || !canGenerate) return;
    const poster = document.createElement('canvas');
    poster.width = 1600;
    poster.height = 2000;
    const context = poster.getContext('2d');
    if (!context) return;
    context.fillStyle = '#F7F4EE';
    context.fillRect(0, 0, poster.width, poster.height);
    context.fillStyle = '#F4A261';
    context.fillRect(0, 0, poster.width, 22);
    context.fillStyle = '#102A43';
    context.font = '700 36px "Be Vietnam Pro", Arial, sans-serif';
    context.fillText('FERMAT WORKSPACE', 120, 132);
    context.fillStyle = '#64748B';
    context.font = '600 28px "Be Vietnam Pro", Arial, sans-serif';
    context.fillText(purpose.toUpperCase(), 120, 224);
    context.fillStyle = '#102A43';
    context.font = '800 72px "Be Vietnam Pro", Arial, sans-serif';
    const words = (title.trim() || 'Quét mã để truy cập').split(/\s+/);
    let line = '';
    let y = 330;
    for (const word of words) {
      const testLine = `${line}${word} `;
      if (context.measureText(testLine).width > 1360 && line) {
        context.fillText(line.trim(), 120, y);
        line = `${word} `;
        y += 92;
      } else line = testLine;
    }
    context.fillText(line.trim(), 120, y);
    const qrSize = 1100;
    const qrX = (poster.width - qrSize) / 2;
    const qrY = Math.max(540, y + 100);
    context.fillStyle = '#FFFFFF';
    roundedRect(context, qrX - 45, qrY - 45, qrSize + 90, qrSize + 90, 42);
    context.fill();
    context.drawImage(source, qrX, qrY, qrSize, qrSize);
    context.textAlign = 'center';
    context.fillStyle = '#102A43';
    context.font = '700 34px "Be Vietnam Pro", Arial, sans-serif';
    context.fillText('Mở camera điện thoại và hướng vào mã QR', poster.width / 2, qrY + qrSize + 120);
    context.fillStyle = '#64748B';
    context.font = '500 28px "Be Vietnam Pro", Arial, sans-serif';
    context.fillText(effectiveHostname, poster.width / 2, qrY + qrSize + 180);
    triggerDownload(poster.toDataURL('image/png'), `${safeFilename(title || purpose)}-poster.png`);
    setNotice('Đã tải poster QR sẵn sàng để trình chiếu hoặc in.');
  };

  const colors = [
    { value: '#102A43', label: 'Xanh đậm' },
    { value: '#0F5132', label: 'Xanh lá' },
    { value: '#111827', label: 'Đen' },
  ];

  return (
    <div className="ft-module-shell workspace-module-canvas flex min-h-dvh bg-[#f7f4ee] font-sans text-[#102A43]">
      <aside className="ft-module-sidebar fixed inset-y-0 left-0 hidden w-64 flex-col md:flex">
        <div className="ft-sidebar-brand flex items-center gap-3 text-left"><img src="/logo.png" alt="FermatTech" className="h-9 w-auto object-contain" /><span><b>FermatTech</b><small>Bộ công cụ FermatTech</small></span></div>
        <nav className="flex-1 space-y-1 p-4"><button type="button" className="ft-nav-item ft-nav-item-active flex w-full items-center gap-3 rounded-xl border-l-4 px-4 py-3 text-left text-sm font-bold"><QrCode className="h-5 w-5" />Tạo mã QR</button></nav>
        <div className="ft-sidebar-footer border-t p-4"><button type="button" onClick={onBackToWorkspace} className="ft-sidebar-back flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm font-bold"><ArrowLeft className="h-5 w-5" />{backLabel}</button></div>
      </aside>
      <div className="min-w-0 flex-1 md:ml-64">
        <header className="ft-module-header sticky top-0 z-20 flex h-16 items-center justify-between border-b px-5 md:px-8"><div><p className="text-xs font-extrabold uppercase tracking-[.14em] text-blue-600">Bộ công cụ FermatTech</p><h1 className="text-lg font-extrabold">Trình tạo mã QR</h1></div><div className="workspace-canvas-muted hidden items-center gap-2 text-xs font-semibold sm:flex"><LockKeyhole className="h-4 w-4 text-emerald-500" />Kiểm tra link trước khi xuất</div></header>
        <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12">
        <section className="mb-9 max-w-3xl">
          <div className="mb-3 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.18em] text-[#de6b35]"><span className="h-px w-8 bg-[#de6b35]" />Trình tạo mã QR trực tiếp</div>
          <h1 className="max-w-2xl text-3xl font-extrabold leading-tight tracking-[-0.035em] sm:text-5xl">Một lần quét.<br />Đến đúng nơi cần đến.</h1>
          <p className="workspace-canvas-muted mt-4 max-w-2xl text-sm leading-7 sm:text-base">Tạo mã QR dẫn thẳng tới form khảo sát, tài liệu hoặc bất kỳ trang web nào — không chèn link trung gian và không thu thập dữ liệu người quét.</p>
        </section>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.12fr)_minmax(360px,.88fr)]">
          <section className="border border-[#102A43]/10 bg-white p-5 shadow-[0_18px_60px_rgba(16,42,67,.08)] sm:p-7">
            <div className="flex items-start justify-between gap-5 border-b border-[#102A43]/10 pb-5">
              <div><p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#de6b35]">Nội dung</p><h2 className="mt-1 text-xl font-extrabold tracking-tight">Đường dẫn cần chia sẻ</h2></div>
              <span className="text-sm font-bold text-[#9a6a50]">01</span>
            </div>
            <div className="mt-6 space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-bold">URL đích</span>
                <div className={`flex items-center border bg-[#fbfaf7] transition focus-within:ring-4 ${hasUrlError ? 'border-rose-400 focus-within:ring-rose-100' : 'border-[#102A43]/20 focus-within:border-[#de6b35] focus-within:ring-[#de6b35]/10'}`}>
                  <Link2 className="ml-4 h-5 w-5 shrink-0 text-[#718294]" />
                  <input type="url" inputMode="url" autoComplete="url" value={rawUrl} onChange={event => setRawUrl(event.target.value)} placeholder="https://docs.google.com/forms/..." className="min-w-0 flex-1 bg-transparent px-3 py-4 text-sm font-medium outline-none placeholder:text-[#93a1ad]" aria-describedby="url-help" />
                  {canGenerate && <Check className="mr-4 h-5 w-5 text-emerald-700" />}
                </div>
                <span id="url-help" className={`mt-2 block text-xs leading-5 ${hasUrlError ? 'font-semibold text-rose-600' : 'text-[#718294]'}`}>{assessment.error || 'Có thể dán link không có https:// — hệ thống sẽ tự bổ sung.'}</span>
                {isGoogleShortLink && verification.sourceUrl === assessment.normalizedUrl && verification.status === 'checking' && (
                  <span className="mt-2 flex items-center gap-2 text-xs font-semibold text-sky-700" role="status">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-sky-600" />Đang xác minh và giải nén liên kết forms.gle...
                  </span>
                )}
                {isGoogleShortLink && verification.sourceUrl === assessment.normalizedUrl && verification.status === 'invalid' && (
                  <span className="mt-2 flex items-start gap-2 text-xs font-semibold leading-5 text-rose-700" role="alert">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{verification.error}
                  </span>
                )}
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-bold">Mục đích sử dụng</span>
                  <select value={purpose} onChange={event => setPurpose(event.target.value)} className="w-full border border-[#102A43]/20 bg-[#fbfaf7] px-4 py-3.5 text-sm font-semibold outline-none focus:border-[#de6b35] focus:ring-4 focus:ring-[#de6b35]/10">
                    <option>Khảo sát tập huấn</option><option>Điểm danh / check-in</option><option>Tài liệu chia sẻ</option><option>Đăng ký sự kiện</option><option>Thanh toán</option><option>Khác</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-bold">Tiêu đề poster <span className="font-normal text-[#718294]">(tùy chọn)</span></span>
                  <input value={title} onChange={event => setTitle(event.target.value)} maxLength={90} placeholder="Khảo sát cuối buổi tập huấn" className="w-full border border-[#102A43]/20 bg-[#fbfaf7] px-4 py-3.5 text-sm font-medium outline-none focus:border-[#de6b35] focus:ring-4 focus:ring-[#de6b35]/10" />
                </label>
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-bold">Màu mã QR</legend>
                <div className="flex flex-wrap gap-2.5">{colors.map(color => <button key={color.value} type="button" onClick={() => setForeground(color.value)} className={`inline-flex items-center gap-2 border px-3 py-2 text-xs font-bold transition ${foreground === color.value ? 'border-[#de6b35] bg-[#fff5ed] text-[#a94720]' : 'border-[#102A43]/15 bg-white text-[#52677a]'}`} aria-pressed={foreground === color.value}><span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: color.value }} />{color.label}</button>)}</div>
              </fieldset>
            </div>
            <div className="mt-7 border-t border-[#102A43]/10 pt-6">
              <div className="flex items-center justify-between gap-5">
                <div><p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#de6b35]">Kiểm tra link</p><h2 className="mt-1 text-lg font-extrabold tracking-tight">Giảm cảnh báo khi quét</h2></div>
                <ShieldCheck className="h-7 w-7 text-emerald-700" />
              </div>
              {!rawUrl.trim() ? (
                <p className="mt-4 border-l-2 border-[#de6b35] pl-4 text-sm leading-6 text-[#52677a]">Nhập URL để kiểm tra HTTPS, link rút gọn và dấu hiệu chuyển hướng.</p>
              ) : assessment.error ? (
                <div className="mt-4 flex items-start gap-3 bg-rose-50 p-4 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><p>{assessment.error}</p></div>
              ) : isGoogleShortLink && !verifiedGoogleShortLink ? (
                <div className="mt-4 flex items-start gap-3 bg-sky-50 p-4 text-sm leading-6 text-sky-900">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
                  <p>{verification.status === 'invalid' ? 'Mã QR đang bị khóa để tránh phát hành một liên kết hỏng.' : 'Hệ thống đang kiểm tra đích thật của liên kết trước khi cho phép tải mã QR.'}</p>
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <div className="flex items-center gap-3 bg-emerald-50 p-4">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-700 text-white"><ExternalLink className="h-4 w-4" /></div>
                    <div className="min-w-0"><p className="text-xs font-semibold text-emerald-800">URL chính xác được mã hóa vào QR</p><p className="break-all text-sm font-extrabold leading-5 text-emerald-950">{effectiveUrl}</p></div>
                  </div>
                  <a href={effectiveUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-xs font-extrabold text-[#a94720] underline decoration-[#de6b35]/40 underline-offset-4 hover:text-[#7c3218]"><ExternalLink className="h-4 w-4" />Mở thử URL đích trước khi tải QR</a>
                  {verifiedGoogleShortLink && <div className="flex items-start gap-3 border-l-2 border-emerald-600 bg-emerald-50/70 px-4 py-3 text-xs font-medium leading-5 text-emerald-900"><Check className="mt-0.5 h-4 w-4 shrink-0" />Đã giải nén forms.gle và thay bằng URL Google Forms đầy đủ để tránh lỗi Dynamic Link.</div>}
                  <div className="grid gap-2 sm:grid-cols-3">
                    {displayedChecks.map(check => <div key={check.label} className={`flex items-center gap-2 border px-3 py-2.5 text-xs font-bold ${check.passed ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{check.passed ? <Check className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}{check.label}</div>)}
                  </div>
                  {displayedWarnings.map(warning => <div key={warning} className="flex items-start gap-3 border-l-2 border-amber-500 bg-amber-50/70 px-4 py-3 text-xs font-medium leading-5 text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{warning}</div>)}
                </div>
              )}
            </div>
          </section>

          <aside className="min-w-0 lg:sticky lg:top-6">
            <div className="bg-[#102A43] p-5 text-white shadow-[0_22px_70px_rgba(16,42,67,.24)] sm:p-7">
              <div className="flex items-start justify-between gap-5">
                <div><p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#f4a261]">Xem trước</p><h2 className="mt-1 text-xl font-extrabold tracking-tight">Mã QR của bạn</h2></div>
                <span className="text-sm font-bold text-white/45">02</span>
              </div>
              <div className="mx-auto mt-6 flex aspect-square w-full max-w-[420px] items-center justify-center overflow-hidden bg-white p-4 sm:p-6">
                {!canGenerate ? (
                  <div className="flex max-w-[250px] flex-col items-center text-center text-[#718294]">
                    <div className="mb-4 grid h-20 w-20 place-items-center rounded-full bg-[#f7f4ee]"><QrCode className="h-10 w-10 text-[#9a6a50]" /></div>
                    <p className="text-sm font-extrabold text-[#102A43]">Mã QR sẽ xuất hiện tại đây</p>
                    <p className="mt-2 text-xs leading-5">Dán một đường dẫn hợp lệ để bắt đầu.</p>
                  </div>
                ) : previewUrl ? <img src={previewUrl} className="block h-full w-full object-contain" alt={`Mã QR dẫn tới ${effectiveHostname}`} /> : <p className="text-sm font-bold text-[#718294]">Đang tạo mã QR...</p>}
              </div>
              <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
              {renderError && <p className="mt-3 text-center text-xs font-semibold text-rose-300">{renderError}</p>}
              <div className="mt-5 min-h-12 border border-white/10 bg-white/[0.06] px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">URL được mã hóa trong QR</p>
                <p className="mt-1 break-all text-xs font-bold leading-5">{effectiveUrl || assessment.normalizedUrl || 'Chưa có đường dẫn'}</p>
              </div>
              <button type="button" onClick={downloadQR} disabled={!canGenerate} className="mt-4 inline-flex w-full items-center justify-center gap-2 bg-[#f4a261] px-4 py-3.5 text-sm font-extrabold text-[#102A43] transition hover:bg-[#ffb37a] disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-4 w-4" />Tải mã QR (PNG)</button>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" onClick={copyQR} disabled={!canGenerate} className="inline-flex items-center justify-center gap-2 border border-white/15 px-3 py-3 text-xs font-bold transition hover:bg-white/10 disabled:opacity-35"><Clipboard className="h-4 w-4" />Sao chép ảnh</button>
                <button type="button" onClick={downloadPoster} disabled={!canGenerate} className="inline-flex items-center justify-center gap-2 border border-white/15 px-3 py-3 text-xs font-bold transition hover:bg-white/10 disabled:opacity-35"><FileImage className="h-4 w-4" />Tải poster</button>
              </div>
              <div className="mt-5 flex items-start gap-3 text-xs leading-5 text-white/58"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /><p>URL thường được mã hóa ngay trên thiết bị. Riêng forms.gle được gửi tới máy chủ Fermat để xác minh và giải nén trước khi tạo QR.</p></div>
            </div>
            <p className="mt-4 px-1 text-xs leading-5 text-[#718294]">Mẹo: thử quét bằng ít nhất một iPhone và một máy Android trước khi trình chiếu hoặc in số lượng lớn.</p>
          </aside>
        </div>
        </main>
      </div>
      {notice && <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 bg-[#102A43] px-4 py-3 text-sm font-bold text-white shadow-2xl" role="status"><Check className="h-4 w-4 text-emerald-400" />{notice}</div>}
    </div>
  );
}
