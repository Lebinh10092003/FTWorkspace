export default function RegistrationProgress({ step }: { step: number }) {
  return <ol className="mb-6 grid grid-cols-3 gap-2" aria-label="Tiến trình đăng ký">
    {['Thí sinh & cuộc thi', 'Liên hệ & lưu hồ sơ', 'Thanh toán'].map((title, index) => <li key={title} aria-current={step === index ? 'step' : undefined} className={`rounded-xl border px-2 py-3 text-xs font-bold sm:px-3 sm:text-sm ${step === index ? 'border-sky-300 bg-sky-50 text-sky-900' : step > index ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-500'}`}><span className="mr-1">{index + 1}.</span>{title}</li>)}
  </ol>;
}
