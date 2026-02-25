"use client";

import { cn } from "@/lib/utils";

export default function ModuleTabs({ tabs, value, onChange, className }) {
  return (
    <div className={cn("flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible", className)}>
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium transition",
              active
                ? "border-sky-300 bg-sky-50 text-sky-700"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

