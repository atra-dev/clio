"use client";

export default function PaginationControls({ pagination, onPageChange }) {
  if (!pagination) {
    return null;
  }

  const { page = 1, totalPages = 1, total = 0 } = pagination;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
      <p className="text-xs text-slate-600">
        Page <span className="font-semibold text-slate-800">{page}</span> of{" "}
        <span className="font-semibold text-slate-800">{totalPages}</span> | Total{" "}
        <span className="font-semibold text-slate-800">{total}</span> records
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Next
        </button>
      </div>
    </div>
  );
}

