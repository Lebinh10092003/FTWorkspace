import { useRef, useState } from "react";
import { Minus, Plus, X } from "lucide-react";

export default function AssessmentZoomableImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState(1);

  return <>
    <button type="button" className="block w-full cursor-zoom-in rounded-lg focus-visible:outline-2 focus-visible:outline-blue-600" title="Bấm để phóng to ảnh" aria-label={`Phóng to: ${alt}`} onClick={() => { setZoom(1); dialogRef.current?.showModal(); }}>
      <img src={src} alt={alt} className={className} />
    </button>
    <dialog ref={dialogRef} aria-label={alt} className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-slate-950 p-0 text-white backdrop:bg-slate-950/80">
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/20 p-3">
          <p className="min-w-0 text-sm font-bold">{alt}</p>
          <div className="flex items-center gap-2">
            <button type="button" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - 0.5))} className="rounded-lg border border-white/30 p-2 disabled:opacity-40" aria-label="Thu nhỏ ảnh" title="Thu nhỏ"><Minus className="h-5 w-5" /></button>
            <button type="button" onClick={() => setZoom(1)} className="rounded-lg border border-white/30 px-3 py-2 text-sm">Vừa màn hình</button>
            <button type="button" disabled={zoom >= 3} onClick={() => setZoom((value) => Math.min(3, value + 0.5))} className="rounded-lg border border-white/30 p-2 disabled:opacity-40" aria-label="Phóng to ảnh" title="Phóng to"><Plus className="h-5 w-5" /></button>
            <button type="button" autoFocus onClick={() => dialogRef.current?.close()} className="rounded-lg border border-white/30 p-2" aria-label="Đóng ảnh" title="Đóng (Esc)"><X className="h-5 w-5" /></button>
          </div>
        </div>
        <div key={zoom} className="min-h-0 flex-1 overflow-auto p-3" style={{ scrollbarWidth: "auto", scrollbarColor: "#94a3b8 #1e293b" }}>
          <img src={src} alt={alt} className="mx-auto block object-contain" style={zoom === 1 ? { maxWidth: "100%", maxHeight: "100%" } : { width: `${zoom * 100}%`, maxWidth: "none" }} />
        </div>
      </div>
    </dialog>
  </>;
}
