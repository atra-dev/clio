"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

const ConfirmContext = createContext(null);

const DEFAULT_OPTIONS = {
  title: "Please Confirm",
  message: "Are you sure you want to continue?",
  confirmText: "Confirm",
  cancelText: "Cancel",
  tone: "default",
};

function normalizeConfirmOptions(input) {
  if (typeof input === "string") {
    return {
      ...DEFAULT_OPTIONS,
      message: input,
    };
  }
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_OPTIONS };
  }
  return {
    title: String(input.title || DEFAULT_OPTIONS.title),
    message: String(input.message || DEFAULT_OPTIONS.message),
    confirmText: String(input.confirmText || DEFAULT_OPTIONS.confirmText),
    cancelText: String(input.cancelText || DEFAULT_OPTIONS.cancelText),
    tone: String(input.tone || DEFAULT_OPTIONS.tone),
  };
}

function toneClasses(tone) {
  if (tone === "danger") {
    return {
      confirmButton:
        "border-rose-200 bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500/30",
      iconBadge: "border-rose-200 bg-rose-50 text-rose-600",
    };
  }
  return {
    confirmButton:
      "border-sky-200 bg-sky-600 text-white hover:bg-sky-700 focus-visible:ring-sky-500/30",
    iconBadge: "border-slate-200 bg-slate-50 text-slate-600",
  };
}

export default function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolverRef = useRef(null);

  const settle = useCallback((value) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    if (resolver) {
      resolver(Boolean(value));
    }
  }, []);

  const confirm = useCallback((options) => {
    const normalized = normalizeConfirmOptions(options);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setDialog(normalized);
    });
  }, []);

  const api = useMemo(() => ({ confirm }), [confirm]);
  const tone = toneClasses(dialog?.tone);

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      {dialog ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/45 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clio-confirm-title"
            aria-describedby="clio-confirm-message"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-900/20"
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full border ${tone.iconBadge}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                  <path d="M12 7v6m0 4h.01M10.3 3.8 2.9 17.2A1.4 1.4 0 0 0 4.1 19h15.8a1.4 1.4 0 0 0 1.2-1.8L13.7 3.8a1.9 1.9 0 0 0-3.4 0Z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="clio-confirm-title" className="text-sm font-semibold text-slate-900">
                  {dialog.title}
                </h2>
                <p id="clio-confirm-message" className="mt-1 text-sm text-slate-600">
                  {dialog.message}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => settle(false)}
                className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/30"
              >
                {dialog.cancelText}
              </button>
              <button
                type="button"
                onClick={() => settle(true)}
                className={`inline-flex h-9 items-center rounded-lg border px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 ${tone.confirmButton}`}
              >
                {dialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error("useConfirm must be used within ConfirmProvider.");
  }
  return context.confirm;
}

