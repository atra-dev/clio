"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import BrandMark from "@/components/ui/BrandMark";
import { getModulesForRole, normalizeRole } from "@/lib/hris";
import { cn } from "@/lib/utils";

function formatDisplayName(email) {
  if (typeof email !== "string" || email.trim().length === 0) {
    return "Clio User";
  }

  const localPart = email.split("@")[0] ?? "";
  const tokens = localPart
    .replace(/[._-]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return "Clio User";
  }

  return tokens
    .slice(0, 2)
    .map((token) => `${token.charAt(0).toUpperCase()}${token.slice(1)}`)
    .join(" ");
}

function getInitials(label) {
  const initials = label
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");

  return initials || "CU";
}

function ModuleIcon({ moduleId, active }) {
  const iconClass = cn(
    "h-4 w-4 transition-colors",
    active ? "text-sky-700" : "text-slate-500 group-hover:text-slate-700",
  );

  switch (moduleId) {
    case "dashboard":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClass} aria-hidden="true">
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
          <rect x="13.5" y="3.5" width="7" height="4.5" rx="1.2" />
          <rect x="13.5" y="10.5" width="7" height="10" rx="1.2" />
          <rect x="3.5" y="13" width="7" height="7.5" rx="1.2" />
        </svg>
      );
    case "employees":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClass} aria-hidden="true">
          <circle cx="9" cy="8.3" r="3.1" />
          <path d="M3.8 18.3c0-3.2 2.4-5.2 5.2-5.2s5.2 2 5.2 5.2" />
          <path d="M15.1 9.3a2.5 2.5 0 1 0 0-5" />
          <path d="M20 18.2c0-2.3-1.3-3.9-3.4-4.7" />
        </svg>
      );
    case "employment-lifecycle":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClass} aria-hidden="true">
          <path d="M4.5 6.2h15" />
          <path d="M4.5 12h15" />
          <path d="M4.5 17.8h15" />
          <circle cx="7.2" cy="6.2" r="1.2" />
          <circle cx="12" cy="12" r="1.2" />
          <circle cx="16.8" cy="17.8" r="1.2" />
        </svg>
      );
    case "attendance":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClass} aria-hidden="true">
          <rect x="4" y="5.2" width="16" height="14.2" rx="2" />
          <path d="M8 3.8v2.4M16 3.8v2.4M4 9.2h16" />
          <path d="m9.1 14 1.9 1.9 4-4" />
        </svg>
      );
    case "performance":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClass} aria-hidden="true">
          <path d="M4.2 18.5h15.6" />
          <rect x="6.2" y="11.5" width="2.8" height="7" rx="0.8" />
          <rect x="10.6" y="8.5" width="2.8" height="10" rx="0.8" />
          <rect x="15" y="5.5" width="2.8" height="13" rx="0.8" />
        </svg>
      );
    case "activity-log":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClass} aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.4v5.1l3.6 2.2" />
        </svg>
      );
    case "exports":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClass} aria-hidden="true">
          <path d="M12 4.2v9.6" />
          <path d="m8.4 10.1 3.6 3.7 3.6-3.7" />
          <rect x="4" y="15.5" width="16" height="4.3" rx="1.2" />
        </svg>
      );
    case "documents":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClass} aria-hidden="true">
          <path d="M7.5 3.8h7l4 4v12.4a1.8 1.8 0 0 1-1.8 1.8H7.5a1.8 1.8 0 0 1-1.8-1.8V5.6a1.8 1.8 0 0 1 1.8-1.8Z" />
          <path d="M14.5 3.8v4h4" />
          <path d="M8.8 13h6.6M8.8 16.4h6.6" />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClass} aria-hidden="true">
          <path d="M9.9 4.8h4.2l.7 2 2.1.9 1.9-1.1 2.1 3.6-1.6 1.4v2.4l1.6 1.4-2.1 3.6-1.9-1.1-2.1.9-.7 2H9.9l-.7-2-2.1-.9-1.9 1.1-2.1-3.6 1.6-1.4v-2.4l-1.6-1.4 2.1-3.6 1.9 1.1 2.1-.9.7-2Z" />
          <circle cx="12" cy="12" r="2.7" />
        </svg>
      );
    case "user-management":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClass} aria-hidden="true">
          <circle cx="8.2" cy="8.4" r="2.6" />
          <circle cx="16.1" cy="9.6" r="2.2" />
          <path d="M3.9 18.7c0-2.9 2.1-4.8 4.8-4.8s4.8 1.9 4.8 4.8" />
          <path d="M13.4 18.3c.3-2 1.7-3.4 3.9-3.4 2.1 0 3.4 1.1 3.8 2.9" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={iconClass} aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
  }
}

function SignOutIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className} aria-hidden="true">
      <path d="M14 4.5h3.2a1.8 1.8 0 0 1 1.8 1.8v11.4a1.8 1.8 0 0 1-1.8 1.8H14" />
      <path d="M10.3 16.8 6 12.5l4.3-4.3" />
      <path d="M18.8 12.5H6.2" />
    </svg>
  );
}

function SidebarCloseIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className} aria-hidden="true">
      <rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2.2" />
      <path d="M9 4.8v14.4" />
      <path d="m14.9 9-2.7 3 2.7 3" />
    </svg>
  );
}

function SidebarOpenIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className} aria-hidden="true">
      <rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2.2" />
      <path d="M9 4.8v14.4" />
      <path d="m13 9 2.8 3-2.8 3" />
    </svg>
  );
}

export default function HrisShell({ children, session }) {
  const pathname = usePathname();
  const router = useRouter();
  const role = normalizeRole(session?.role);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const userName = formatDisplayName(session?.email);
  const userEmail = session?.email ?? "user@clio.local";
  const userInitials = getInitials(userName);

  useEffect(() => {
    const savedState = window.localStorage.getItem("clio_sidebar_collapsed");
    setIsSidebarCollapsed(savedState === "true");
  }, []);

  useEffect(() => {
    window.localStorage.setItem("clio_sidebar_collapsed", String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  const modules = getModulesForRole(role);
  const currentDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date());

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  };

  const toggleSidebar = () => {
    setIsSidebarCollapsed((current) => !current);
  };

  return (
    <div className="h-dvh w-full overflow-hidden bg-slate-100/80">
      <a
        href="#main-content"
        className="sr-only rounded-lg bg-white px-4 py-2 text-sm text-slate-900 focus:not-sr-only"
      >
        Skip to main content
      </a>

      <div
        className={cn(
          "grid h-full w-full gap-0 lg:transition-[grid-template-columns] lg:duration-500 lg:ease-[cubic-bezier(0.22,1,0.36,1)]",
          isSidebarCollapsed ? "lg:grid-cols-[88px_minmax(0,1fr)]" : "lg:grid-cols-[280px_minmax(0,1fr)]",
        )}
      >
        <aside
          className={cn(
            "h-full border-r border-slate-200 bg-[linear-gradient(180deg,#f8fbff_0%,#f2f7fc_45%,#eef3f8_100%)] p-5 lg:overflow-hidden lg:transition-[padding] lg:duration-500 lg:ease-[cubic-bezier(0.22,1,0.36,1)]",
            isSidebarCollapsed ? "lg:px-3.5 lg:py-5" : "lg:p-6",
          )}
        >
          <div className="flex h-full flex-col">
            <div
              className={cn(
                "flex transition-all duration-300 ease-out",
                isSidebarCollapsed ? "flex-col items-center gap-2" : "items-center justify-between",
              )}
            >
              <BrandMark href="/dashboard" iconOnly={isSidebarCollapsed} />

              <button
                type="button"
                onClick={toggleSidebar}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900"
                aria-label={isSidebarCollapsed ? "Open sidebar" : "Close sidebar"}
                title={isSidebarCollapsed ? "Open sidebar" : "Close sidebar"}
              >
                {isSidebarCollapsed ? <SidebarOpenIcon className="h-4 w-4" /> : <SidebarCloseIcon className="h-4 w-4" />}
              </button>
            </div>

            <div className={cn("mt-7", isSidebarCollapsed && "mt-6")}>
              <div
                className={cn(
                  "overflow-hidden px-1 transition-all duration-300 ease-out",
                  isSidebarCollapsed ? "max-h-0 opacity-0" : "max-h-6 opacity-100",
                )}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700/80">Navigation</p>
              </div>
              <nav className="mt-2 space-y-1.5" aria-label="Main navigation">
                {modules.map((module) => {
                  const isActive = pathname === module.href;
                  return (
                    <Link
                      key={module.id}
                      href={module.href}
                      aria-current={isActive ? "page" : undefined}
                      title={isSidebarCollapsed ? module.label : undefined}
                      className={cn(
                        "group flex items-center gap-3 rounded-xl border py-2.5 text-sm transition",
                        isSidebarCollapsed ? "justify-center px-2.5" : "px-3",
                        isActive
                          ? "border-sky-200 bg-white text-sky-700 shadow-[0_12px_28px_-20px_rgba(14,116,214,0.8)]"
                          : "border-transparent text-slate-700 hover:border-slate-200/90 hover:bg-white/75",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition",
                          isActive ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white",
                        )}
                      >
                        <ModuleIcon moduleId={module.id} active={isActive} />
                      </span>
                      <span
                        className={cn(
                          "overflow-hidden whitespace-nowrap font-medium transition-all duration-300 ease-out",
                          isActive ? "text-sky-700" : "text-slate-800",
                          isSidebarCollapsed ? "max-w-0 -translate-x-2 opacity-0" : "max-w-[10rem] translate-x-0 opacity-100",
                        )}
                      >
                        {module.label}
                      </span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div className="mt-auto pt-5">
              <button
                type="button"
                onClick={handleSignOut}
                disabled={isSigningOut}
                title={isSidebarCollapsed ? "Sign out" : undefined}
                aria-label="Sign out"
                className={cn(
                  "inline-flex h-10 items-center rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-700 transition-all duration-300 ease-out hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70",
                  isSidebarCollapsed ? "mx-auto w-10 justify-center px-0" : "w-full justify-center gap-2",
                )}
              >
                <SignOutIcon className="h-4 w-4" />
                <span
                  className={cn(
                    "overflow-hidden whitespace-nowrap transition-all duration-300 ease-out",
                    isSidebarCollapsed ? "max-w-0 opacity-0" : "max-w-[8rem] opacity-100",
                  )}
                >
                  {isSigningOut ? "Signing out..." : "Sign out"}
                </span>
              </button>
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <header className="shrink-0 flex flex-col gap-3 border-b border-slate-200 bg-white/90 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
            <div>
              <p className="text-sm font-medium text-slate-900">Clio HRIS Workspace</p>
              <p className="text-xs text-slate-500">Today: {currentDate}</p>
            </div>

            <div className="flex items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-xs font-semibold text-white">
                  {userInitials}
                </span>
                <span className="hidden text-left sm:block">
                  <p className="max-w-[12rem] truncate text-xs font-semibold text-slate-900">{userName}</p>
                  <p className="max-w-[12rem] truncate text-[11px] text-slate-500">{userEmail}</p>
                </span>
              </div>
            </div>
          </header>

          <main
            id="main-content"
            className="min-h-0 flex-1 overflow-y-auto bg-slate-100/70 px-5 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-7"
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
