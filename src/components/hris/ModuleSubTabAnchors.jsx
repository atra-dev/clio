"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { toSubTabAnchor } from "@/lib/subtab-anchor";
import { cn } from "@/lib/utils";

const MODULE_SUBTABS = {
  "employment-lifecycle": [
    { id: "workflow-status-tracking", label: "Workflow Status Tracking" },
    { id: "onboarding", label: "Onboarding" },
    { id: "role-changes", label: "Role Changes" },
    { id: "disciplinary-records", label: "Disciplinary Records" },
    { id: "offboarding-access-revocation", label: "Offboarding + Access Revocation" },
  ],
};

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

  const handleSubTabClick = (anchor) => {
    if (typeof window === "undefined") {
      return;
    }

    const nextUrl = `${moduleHref}#${anchor}`;
    window.history.pushState(null, "", nextUrl);
    setHash(anchor);
    window.dispatchEvent(
      new CustomEvent("clio:subtab-anchor", {
        detail: { moduleId, anchor },
      }),
    );
  };

  return (
    <div className="mt-1.5 space-y-1.5 pl-12 pr-1">
      {subTabs.map((subTab, index) => {
        const anchor = toSubTabAnchor(subTab.id);
        const isActive = hash === anchor || (!hash && index === 0);

        return (
          <button
            key={subTab.id}
            type="button"
            onClick={() => handleSubTabClick(anchor)}
            className={cn(
              "block w-full rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-medium transition",
              isActive
                ? "border-sky-200 bg-sky-50 text-sky-700"
                : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-800",
            )}
          >
            {subTab.label}
          </button>
        );
      })}
    </div>
  );
}
