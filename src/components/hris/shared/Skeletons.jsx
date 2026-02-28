"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useSkeletonLoading } from "@/lib/use-skeleton-loading";

function SkeletonBlock({ className }) {
  return <div aria-hidden="true" className={cn("clio-skeleton rounded-lg", className)} />;
}

function buildArray(count) {
  const safeCount = Number.isFinite(count) ? Math.max(1, Math.trunc(count)) : 1;
  return Array.from({ length: safeCount }, (_, index) => index);
}

export function LoadingTransition({ isLoading, skeleton, children, minimumMs = 300, className }) {
  const showSkeleton = useSkeletonLoading(Boolean(isLoading), minimumMs);

  return (
    <div className={className}>
      {showSkeleton ? <div className="clio-fade-in">{skeleton}</div> : <div className="clio-fade-in">{children}</div>}
    </div>
  );
}

export function CardSkeleton({ count = 4, className }) {
  const rows = useMemo(() => buildArray(count), [count]);
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {rows.map((item) => (
        <div key={`card-skeleton-${item}`} className="rounded-xl border border-slate-200 bg-white p-4">
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="mt-3 h-9 w-16" />
          <SkeletonBlock className="mt-3 h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ type = "bar", className }) {
  if (type === "pie") {
    return (
      <div className={cn("rounded-xl border border-slate-200 bg-white p-4", className)}>
        <SkeletonBlock className="h-4 w-28" />
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-center">
          <SkeletonBlock className="h-40 w-40 rounded-full" />
          <div className="flex-1 space-y-3">
            <SkeletonBlock className="h-3 w-full" />
            <SkeletonBlock className="h-3 w-5/6" />
            <SkeletonBlock className="h-3 w-3/4" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border border-slate-200 bg-white p-4", className)}>
      <SkeletonBlock className="h-4 w-28" />
      <div className="mt-4 flex h-40 items-end gap-2">
        <SkeletonBlock className="h-16 w-8 rounded-md" />
        <SkeletonBlock className="h-24 w-8 rounded-md" />
        <SkeletonBlock className="h-10 w-8 rounded-md" />
        <SkeletonBlock className="h-32 w-8 rounded-md" />
        <SkeletonBlock className="h-20 w-8 rounded-md" />
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 6, className }) {
  const rowItems = useMemo(() => buildArray(rows), [rows]);
  const columnItems = useMemo(() => buildArray(columns), [columns]);

  return (
    <div className={cn("overflow-x-auto rounded-xl border border-slate-200 bg-white", className)}>
      <table className="min-w-full border-separate border-spacing-0">
        <thead>
          <tr className="border-b border-slate-200">
            {columnItems.map((column) => (
              <th key={`table-skeleton-header-${column}`} className="px-3 py-3">
                <SkeletonBlock className="h-3 w-16" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowItems.map((row) => (
            <tr key={`table-skeleton-row-${row}`} className="border-b border-slate-100 last:border-b-0">
              {columnItems.map((column) => (
                <td key={`table-skeleton-${row}-${column}`} className="px-3 py-3">
                  <SkeletonBlock className={cn("h-3", column === 0 ? "w-28" : "w-20")} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FormSkeleton({ fields = 6, showActions = true, className }) {
  const fieldItems = useMemo(() => buildArray(fields), [fields]);

  return (
    <div className={cn("space-y-3 rounded-xl border border-slate-200 bg-white p-4", className)}>
      <SkeletonBlock className="h-5 w-40" />
      <div className="grid gap-3 md:grid-cols-2">
        {fieldItems.map((item) => (
          <div key={`form-skeleton-field-${item}`} className="space-y-2">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="h-10 w-full" />
          </div>
        ))}
      </div>
      {showActions ? (
        <div className="flex justify-end gap-2 pt-2">
          <SkeletonBlock className="h-9 w-24 rounded-lg" />
          <SkeletonBlock className="h-9 w-28 rounded-lg" />
        </div>
      ) : null}
    </div>
  );
}

export function ProfileSkeleton({ className }) {
  return (
    <div className={cn("space-y-4 rounded-xl border border-slate-200 bg-white p-4", className)}>
      <div className="flex items-center gap-3">
        <SkeletonBlock className="h-14 w-14 rounded-2xl" />
        <div className="space-y-2">
          <SkeletonBlock className="h-4 w-40" />
          <SkeletonBlock className="h-3 w-28" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <SkeletonBlock className="h-10 w-full" />
        <SkeletonBlock className="h-10 w-full" />
        <SkeletonBlock className="h-10 w-full" />
      </div>
      <SkeletonBlock className="h-28 w-full" />
    </div>
  );
}

export function SidePanelSkeleton({ rows = 5, className }) {
  const rowItems = useMemo(() => buildArray(rows), [rows]);
  return (
    <div className={cn("space-y-2", className)}>
      {rowItems.map((row) => (
        <div key={`panel-skeleton-${row}`} className="rounded-xl border border-slate-200 bg-white p-3">
          <SkeletonBlock className="h-3 w-3/5" />
          <SkeletonBlock className="mt-2 h-3 w-full" />
          <SkeletonBlock className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function TabsSkeleton({ count = 4, className }) {
  const items = useMemo(() => buildArray(count), [count]);
  return (
    <div className={cn("flex gap-2 overflow-hidden", className)}>
      {items.map((item) => (
        <SkeletonBlock key={`tabs-skeleton-${item}`} className="h-8 w-24 rounded-lg" />
      ))}
    </div>
  );
}

