"use client";

import { cn } from "@/lib/utils";

const STATUS_CLASS = {
  critical: "bg-rose-100 text-rose-700 ring-1 ring-rose-200",
  high: "bg-orange-100 text-orange-700 ring-1 ring-orange-200",
  medium: "bg-amber-100 text-amber-700 ring-1 ring-amber-200",
  low: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200",
  open: "bg-cyan-100 text-cyan-700 ring-1 ring-cyan-200",
  containment: "bg-blue-100 text-blue-700 ring-1 ring-blue-200",
  investigating: "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200",
  escalated: "bg-violet-100 text-violet-700 ring-1 ring-violet-200",
  "regulatory review": "bg-fuchsia-100 text-fuchsia-700 ring-1 ring-fuchsia-200",
  resolved: "bg-teal-100 text-teal-700 ring-1 ring-teal-200",
  closed: "bg-slate-200 text-slate-700 ring-1 ring-slate-300",
  active: "bg-emerald-100 text-emerald-700",
  approved: "bg-emerald-100 text-emerald-700",
  completed: "bg-sky-100 text-sky-700",
  exported: "bg-sky-100 text-sky-700",
  pending: "bg-amber-100 text-amber-700",
  rejected: "bg-rose-100 text-rose-700",
  failed: "bg-rose-100 text-rose-700",
  archived: "bg-slate-200 text-slate-700",
  "in progress": "bg-indigo-100 text-indigo-700",
};

export default function StatusBadge({ value, className }) {
  const normalized = String(value || "").trim().toLowerCase();
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2 py-1 text-xs font-medium",
        STATUS_CLASS[normalized] || "bg-slate-100 text-slate-700",
        className,
      )}
    >
      {value || "N/A"}
    </span>
  );
}
