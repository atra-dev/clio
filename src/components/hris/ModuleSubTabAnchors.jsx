"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { toSubTabAnchor } from "@/lib/subtab-anchor";
import { cn } from "@/lib/utils";

const MODULE_SUBTABS = {};

export default function ModuleSubTabAnchors({ moduleId, moduleHref, visible = true }) {
  const pathname = usePathname();
  const [hash, setHash] = useState("");

  const subTabs = useMemo(() => MODULE_SUBTABS[moduleId] || [], [moduleId]);

  useEffect(() => {
    const syncHash = () => {
      if (typeof window === "undefined") {
        return;
      }
      const raw = String(window.location.hash || "").trim();
      setHash(raw.replace(/^#/, ""));
    };

    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  if (!visible || pathname !== moduleHref || subTabs.length === 0) {
    return null;
  }

  return (
    <div className="mt-1.5 space-y-1.5 pl-12 pr-1">
      {subTabs.map((subTab) => {
        const anchor = toSubTabAnchor(subTab.id);
        const href = `${moduleHref}#${anchor}`;
        const isActive = hash === anchor || (!hash && subTab.id === "directory");

        return (
          <Link
            key={subTab.id}
            href={href}
            className={cn(
              "block rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition",
              isActive
                ? "border-sky-200 bg-sky-50 text-sky-700"
                : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-800",
            )}
          >
            {subTab.label}
          </Link>
        );
      })}
    </div>
  );
}
