"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import BrandMark from "@/components/ui/BrandMark";
import ModuleSubTabAnchors from "@/components/hris/ModuleSubTabAnchors";
import { useToast } from "@/components/ui/ToastProvider";
import { getModulesForRole, normalizeRole } from "@/lib/hris";
import { formatPersonName } from "@/lib/name-utils";
import {
  removeStorageObjectByPath,
  uploadProfilePhotoToStorage,
} from "@/services/firebase-storage-client";
import { cn } from "@/lib/utils";

function getInitials(label) {
  const initials = label
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");

  return initials || "CU";
}

function getModuleLabelForRole(moduleId, defaultLabel, role) {
  const normalizedRole = String(role || "").trim().toUpperCase();
  if (!normalizedRole.startsWith("EMPLOYEE_")) {
    return defaultLabel;
  }

  const employeeLabels = {
    employees: "My Profile",
    attendance: "My Attendance",
    performance: "My Performance",
    documents: "My Documents",
    requests: "Requests",
  };

  return employeeLabels[moduleId] || defaultLabel;
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
    case "requests":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClass} aria-hidden="true">
          <rect x="4" y="4.5" width="16" height="15" rx="2" />
          <path d="M8 9h8M8 13h5" />
          <path d="m14 16 2.1 2.1L20 14.2" />
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
  const toast = useToast();
  const role = normalizeRole(session?.role);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const userEmail = session?.email ?? "user@gmail.com";
  const [profile, setProfile] = useState(null);
  const [profileDraft, setProfileDraft] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    profilePhotoDataUrl: "",
    profilePhotoStoragePath: "",
  });
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const fileInputRef = useRef(null);
  const userName = useMemo(
    () =>
      formatPersonName({
        firstName: profile?.firstName,
        middleName: profile?.middleName,
        lastName: profile?.lastName,
        fallbackEmail: userEmail,
        fallbackLabel: "Clio User",
      }),
    [profile?.firstName, profile?.middleName, profile?.lastName, userEmail],
  );
  const userInitials = useMemo(() => getInitials(userName), [userName]);
  const userAvatar = useMemo(() => {
    const value = String(profile?.profilePhotoDataUrl || "").trim();
    return value || "";
  }, [profile]);

  useEffect(() => {
    const savedState = window.localStorage.getItem("clio_sidebar_collapsed");
    setIsSidebarCollapsed(savedState === "true");
  }, []);

  useEffect(() => {
    window.localStorage.setItem("clio_sidebar_collapsed", String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      setIsProfileLoading(true);
      try {
        const response = await fetch("/api/auth/profile", { method: "GET", cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.message || "Unable to load account profile.");
        }
        if (!isMounted) {
          return;
        }

        const nextProfile = {
          firstName: String(payload?.firstName || ""),
          middleName: String(payload?.middleName || ""),
          lastName: String(payload?.lastName || ""),
          profilePhotoDataUrl: String(payload?.profilePhotoDataUrl || ""),
          profilePhotoStoragePath: String(payload?.profilePhotoStoragePath || ""),
        };
        setProfile(nextProfile);
        setProfileDraft(nextProfile);
      } catch (error) {
        if (isMounted) {
          toast.error(error.message || "Unable to load account profile.");
        }
      } finally {
        if (isMounted) {
          setIsProfileLoading(false);
        }
      }
    }

    loadProfile();
    return () => {
      isMounted = false;
    };
  }, [toast, userEmail]);

  useEffect(() => {
    if (!isProfileModalOpen || typeof window === "undefined") {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !isSavingProfile && !isUploadingPhoto) {
        setIsProfileModalOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isProfileModalOpen, isSavingProfile, isUploadingPhoto]);

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

  const openProfileEditor = () => {
    setProfileDraft({
      firstName: String(profile?.firstName || ""),
      middleName: String(profile?.middleName || ""),
      lastName: String(profile?.lastName || ""),
      profilePhotoDataUrl: String(profile?.profilePhotoDataUrl || ""),
      profilePhotoStoragePath: String(profile?.profilePhotoStoragePath || ""),
    });
    setIsProfileModalOpen(true);
  };

  const closeProfileEditor = () => {
    if (isSavingProfile || isUploadingPhoto) {
      return;
    }
    setIsProfileModalOpen(false);
  };

  const handleDraftChange = (field) => (event) => {
    setProfileDraft((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const handlePhotoFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const mimeType = String(file.type || "").toLowerCase();
    const isAllowed = ["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(mimeType);
    if (!isAllowed) {
      toast.error("Only PNG, JPG, or WEBP images are allowed.");
      event.target.value = "";
      return;
    }

    if (file.size > 1_000_000) {
      toast.error("Profile picture must be 1MB or below.");
      event.target.value = "";
      return;
    }

    setIsUploadingPhoto(true);
    try {
      const uploaded = await uploadProfilePhotoToStorage({
        file,
        userEmail,
      });
      setProfileDraft((current) => ({
        ...current,
        profilePhotoDataUrl: uploaded.downloadUrl,
        profilePhotoStoragePath: uploaded.storagePath,
      }));
      toast.success("Profile photo uploaded to secure storage.");
    } catch (error) {
      toast.error(error.message || "Unable to upload profile photo.");
    } finally {
      setIsUploadingPhoto(false);
      event.target.value = "";
    }
  };

  const removeProfilePhoto = () => {
    setProfileDraft((current) => ({
      ...current,
      profilePhotoDataUrl: "",
      profilePhotoStoragePath: "",
    }));
  };

  const handleProfileSave = async () => {
    if (isUploadingPhoto) {
      return;
    }
    setIsSavingProfile(true);
    try {
      const previousStoragePath = String(profile?.profilePhotoStoragePath || "").trim();
      const response = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: profileDraft.firstName,
          middleName: profileDraft.middleName,
          lastName: profileDraft.lastName,
          profilePhotoDataUrl: profileDraft.profilePhotoDataUrl || null,
          profilePhotoStoragePath: profileDraft.profilePhotoStoragePath || null,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || "Unable to save profile.");
      }

      const savedProfile = {
        firstName: String(payload?.profile?.firstName || ""),
        middleName: String(payload?.profile?.middleName || ""),
        lastName: String(payload?.profile?.lastName || ""),
        profilePhotoDataUrl: String(payload?.profile?.profilePhotoDataUrl || ""),
        profilePhotoStoragePath: String(payload?.profile?.profilePhotoStoragePath || ""),
      };
      setProfile(savedProfile);
      setProfileDraft(savedProfile);
      setIsProfileModalOpen(false);

      const nextStoragePath = String(savedProfile.profilePhotoStoragePath || "").trim();
      if (previousStoragePath && previousStoragePath !== nextStoragePath) {
        removeStorageObjectByPath(previousStoragePath).catch(() => null);
      }
      toast.success("Profile updated.");
    } catch (error) {
      toast.error(error.message || "Unable to save profile.");
    } finally {
      setIsSavingProfile(false);
    }
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
          <div className="flex h-full min-h-0 flex-col">
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

            <div className={cn("mt-7 min-h-0 flex-1", isSidebarCollapsed && "mt-6")}>
              <div
                className={cn(
                  "overflow-hidden px-1 transition-all duration-300 ease-out",
                  isSidebarCollapsed ? "max-h-0 opacity-0" : "max-h-6 opacity-100",
                )}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700/80">Navigation</p>
              </div>
              <nav
                className="mt-2 max-h-full space-y-1.5 overflow-y-auto pr-1 pb-3 [scrollbar-color:#bfdbfe_transparent] [scrollbar-width:thin]"
                aria-label="Main navigation"
              >
                {modules.map((module) => {
                  const isActive = pathname === module.href;
                  const moduleLabel = getModuleLabelForRole(module.id, module.label, role);
                  return (
                    <div key={module.id}>
                      <Link
                        href={module.href}
                        aria-current={isActive ? "page" : undefined}
                        title={isSidebarCollapsed ? moduleLabel : undefined}
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
                          {moduleLabel}
                        </span>
                      </Link>

                      <ModuleSubTabAnchors
                        moduleId={module.id}
                        moduleHref={module.href}
                        visible={!isSidebarCollapsed}
                      />
                    </div>
                  );
                })}
              </nav>
            </div>

            <div className="mt-auto shrink-0 pt-5">
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
              <button
                type="button"
                onClick={openProfileEditor}
                disabled={isProfileLoading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-left transition hover:border-sky-300 hover:bg-sky-50/50 disabled:cursor-wait disabled:opacity-70"
                aria-label="Open account profile editor"
                title="Edit account profile"
              >
                {userAvatar ? (
                  <span className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <Image src={userAvatar} alt="Profile picture" width={32} height={32} className="h-full w-full object-cover" unoptimized />
                  </span>
                ) : (
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-xs font-semibold text-white">
                    {userInitials}
                  </span>
                )}
                <span className="hidden text-left sm:block">
                  <p className="max-w-[12rem] truncate text-xs font-semibold text-slate-900">{userName}</p>
                  <p className="max-w-[12rem] truncate text-[11px] text-slate-500">{userEmail}</p>
                </span>
              </button>
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

      {isProfileModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Edit account profile"
          onClick={closeProfileEditor}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Edit Account Profile</h2>
                <p className="mt-0.5 text-sm text-slate-600">Update your name and profile picture.</p>
              </div>
              <button
                type="button"
                onClick={closeProfileEditor}
                disabled={isSavingProfile}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-70"
                aria-label="Close profile editor"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-4 w-4" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-3">
                {profileDraft.profilePhotoDataUrl ? (
                  <span className="inline-flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <Image
                      src={profileDraft.profilePhotoDataUrl}
                      alt="Profile preview"
                      width={56}
                      height={56}
                      className="h-full w-full object-cover"
                      unoptimized
                    />
                  </span>
                ) : (
                  <span className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white">
                    {userInitials}
                  </span>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingPhoto || isSavingProfile}
                    className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    {isUploadingPhoto ? "Uploading..." : "Upload Photo"}
                  </button>
                  <button
                    type="button"
                    onClick={removeProfilePhoto}
                    disabled={isUploadingPhoto || isSavingProfile}
                    className="inline-flex h-9 items-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                  >
                    Remove
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    className="hidden"
                    onChange={handlePhotoFileChange}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <input
                  value={profileDraft.firstName}
                  onChange={handleDraftChange("firstName")}
                  placeholder="First name"
                  className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
                />
                <input
                  value={profileDraft.middleName}
                  onChange={handleDraftChange("middleName")}
                  placeholder="Middle name"
                  className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
                />
                <input
                  value={profileDraft.lastName}
                  onChange={handleDraftChange("lastName")}
                  placeholder="Last name"
                  className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeProfileEditor}
                disabled={isSavingProfile || isUploadingPhoto}
                className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-70"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleProfileSave}
                disabled={isSavingProfile || isUploadingPhoto}
                className="inline-flex h-9 items-center rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
              >
                {isUploadingPhoto ? "Uploading..." : isSavingProfile ? "Saving..." : "Save Profile"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

