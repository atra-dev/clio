"use client";

import { cn } from "@/lib/utils";

const STATUS_CLASS = {
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

