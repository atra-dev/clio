export default function WorkspaceLoading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <svg className="h-5 w-5 animate-spin text-sky-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
