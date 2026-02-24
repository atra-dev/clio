"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signOut as signOutFirebase } from "firebase/auth";
import BrandMark from "@/components/ui/BrandMark";
import ModuleSubTabAnchors from "@/components/hris/ModuleSubTabAnchors";
import { useToast } from "@/components/ui/ToastProvider";
import { getModulesForRole, normalizeRole } from "@/lib/hris";
import { canAccessModule } from "@/lib/rbac";
import { MODULES } from "@/features/hris/constants";
import { formatPersonName } from "@/lib/name-utils";
import { getFirebaseClientAuth } from "@/lib/firebase-client-auth";
import {
  removeStorageObjectByPath,
  uploadProfilePhotoToStorage,
} from "@/services/firebase-storage-client";
import { cn } from "@/lib/utils";

const MODULE_ID_BY_HREF = new Map(
  MODULES.map((module) => [String(module?.href || "").trim().toLowerCase(), module.id]),
);
const MODULE_ID_BY_LABEL = new Map(
  MODULES.map((module) => [String(module?.label || "").trim().toLowerCase(), module.id]),
);

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
  };

  return employeeLabels[moduleId] || defaultLabel;
}

function formatRoleLabel(roleValue) {
  const role = String(roleValue || "").trim().toUpperCase();
  if (role === "EMPLOYEE" || role.startsWith("EMPLOYEE_")) {
    return "Employee";
  }
  const map = {
    SUPER_ADMIN: "Super Admin",
    GRC: "GRC",
    HR: "HR",
    EA: "EA",
  };
  return map[role] || "Employee";
}

function formatEmployeeRoleLabel(roleValue) {
  const role = String(roleValue || "").trim().toUpperCase();
  const employeeMap = {
    EMPLOYEE: "Employee",
    EMPLOYEE_L1: "Employee (L1)",
    EMPLOYEE_L2: "Employee (L2)",
    EMPLOYEE_L3: "Employee (L3)",
  };
  if (employeeMap[role]) {
    return employeeMap[role];
  }
  return formatRoleLabel(role);
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatSourceIp(value) {
  const ip = String(value || "").trim();
  if (!ip || ip.toLowerCase() === "unknown") {
    return "Unknown";
  }

  const localIpSet = new Set(["::1", "127.0.0.1", "::ffff:127.0.0.1"]);
  if (localIpSet.has(ip.toLowerCase())) {
    return `Loopback (${ip})`;
  }

  return ip;
}

function formatNotificationRelativeTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "Just now";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  if (diffMinutes <= 0) {
    return "Just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  return formatDateTime(date.toISOString());
}

function notificationSeverityClass(value) {
  const severity = String(value || "").trim().toLowerCase();
  if (severity === "critical") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (severity === "high") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (severity === "low") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function resolveActionPathname(actionUrl) {
  const raw = String(actionUrl || "").trim();
  if (!raw) {
    return "";
  }

  try {
    const base = typeof window === "undefined" ? "https://clio.invalid" : window.location.origin;
    return String(new URL(raw, base).pathname || "").trim().toLowerCase();
  } catch {
    return raw.split("?")[0].split("#")[0].trim().toLowerCase();
  }
}

function resolveNotificationModuleId(notification) {
  const actionPathname = resolveActionPathname(notification?.actionUrl);
  if (actionPathname) {
    const firstSegment = actionPathname.replace(/^\/+/, "").split("/")[0];
    const fromHref = MODULE_ID_BY_HREF.get(`/${firstSegment}`);
    if (fromHref) {
      return fromHref;
    }
  }

  const moduleLabel = String(notification?.module || "").trim().toLowerCase();
  return MODULE_ID_BY_LABEL.get(moduleLabel) || "";
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
    case "access-management":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClass} aria-hidden="true">
          <path d="M12 3.8 5.2 6.5v5.3c0 4.1 2.5 7.7 6.8 8.4 4.3-.7 6.8-4.3 6.8-8.4V6.5L12 3.8Z" />
          <path d="M9.2 12.3 11 14l3.8-3.9" />
        </svg>
      );
    case "retention-archive":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClass} aria-hidden="true">
          <rect x="4.4" y="5.2" width="15.2" height="4.2" rx="1" />
          <path d="M6.1 9.6h11.8v8.7a1.7 1.7 0 0 1-1.7 1.7H7.8a1.7 1.7 0 0 1-1.7-1.7V9.6Z" />
          <path d="M9 13.1h6M9 16h6" />
        </svg>
      );
    case "incident-management":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClass} aria-hidden="true">
          <path d="m12 3.8 8.1 14.1a1.2 1.2 0 0 1-1 1.8H4.9a1.2 1.2 0 0 1-1-1.8L12 3.8Z" />
          <path d="M12 9v5.2M12 17.5h.01" />
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

function clearLoginRedirectPendingFlag() {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.removeItem("clio_google_redirect_pending");
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
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [isMarkingNotifications, setIsMarkingNotifications] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isLoadingProfileInsights, setIsLoadingProfileInsights] = useState(false);
  const [isRevokingSessions, setIsRevokingSessions] = useState(false);
  const [profileInsights, setProfileInsights] = useState({
    role: String(session?.role || ""),
    employmentRole: String(session?.role || ""),
    employeeId: "-",
    employeeName: "-",
    employeeEmail: userEmail,
    department: "-",
    jobTitle: "-",
    employmentStatus: "-",
    recordStatus: "-",
    managerEmail: "-",
    hireDate: "-",
    lastLoginAt: null,
    lastActiveIp: "unknown",
    lastActiveDevice: "Unknown device",
    recentActivity: [],
  });
  const fileInputRef = useRef(null);
  const notificationsButtonRef = useRef(null);
  const notificationsPanelRef = useRef(null);
  const profileButtonRef = useRef(null);
  const profilePanelRef = useRef(null);
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

  const loadNotifications = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) {
      setIsLoadingNotifications(true);
    }
    try {
      const response = await fetch("/api/notifications?status=all&limit=16", {
        method: "GET",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || "Unable to load notifications.");
      }
      setNotifications(Array.isArray(payload?.records) ? payload.records : []);
      setNotificationUnreadCount(Number(payload?.unreadCount || 0));
    } catch (error) {
      if (!quiet) {
        toast.error(error.message || "Unable to load notifications.");
      }
    } finally {
      if (!quiet) {
        setIsLoadingNotifications(false);
      }
    }
  }, [toast]);

  useEffect(() => {
    loadNotifications().catch(() => null);
    const timer = window.setInterval(() => {
      loadNotifications({ quiet: true }).catch(() => null);
    }, 30000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadNotifications]);

  useEffect(() => {
    if ((!isProfileModalOpen && !isNotificationsOpen) || typeof window === "undefined") {
      return;
    }

    const onKeyDown = (event) => {
      if (event.key !== "Escape") {
        return;
      }
      if (!isSavingProfile && !isUploadingPhoto && !isRevokingSessions) {
        setIsProfileModalOpen(false);
      }
      if (!isMarkingNotifications) {
        setIsNotificationsOpen(false);
      }
    };
    const onPointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const insideProfile =
        profilePanelRef.current?.contains(target) || profileButtonRef.current?.contains(target);
      const insideNotifications =
        notificationsPanelRef.current?.contains(target) || notificationsButtonRef.current?.contains(target);
      if (insideProfile || insideNotifications) {
        return;
      }

      if (!isSavingProfile && !isUploadingPhoto && !isRevokingSessions) {
        setIsProfileModalOpen(false);
      }
      if (!isMarkingNotifications) {
        setIsNotificationsOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [
    isMarkingNotifications,
    isNotificationsOpen,
    isProfileModalOpen,
    isRevokingSessions,
    isSavingProfile,
    isUploadingPhoto,
  ]);

  const modules = useMemo(() => getModulesForRole(role), [role]);
  const currentDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date());
  const accountRoleLabel = formatRoleLabel(profileInsights.role || role);
  const employmentRoleLabel = formatEmployeeRoleLabel(profileInsights.employmentRole || profileInsights.role || role);
  const recentAccountActivity = Array.isArray(profileInsights.recentActivity)
    ? profileInsights.recentActivity.slice(0, 5)
    : [];
  const canOpenNotificationTarget = useCallback(
    (notification) => {
      const actionUrl = String(notification?.actionUrl || "").trim();
      if (!actionUrl) {
        return false;
      }

      const moduleId = resolveNotificationModuleId(notification);
      if (!moduleId) {
        return false;
      }

      return canAccessModule(role, moduleId);
    },
    [role],
  );

  useEffect(() => {
    modules.forEach((module) => {
      router.prefetch(module.href);
    });
  }, [modules, router]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      const auth = getFirebaseClientAuth();
      await signOutFirebase(auth).catch(() => null);
      clearLoginRedirectPendingFlag();
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    } finally {
      if (typeof window !== "undefined") {
        window.location.assign("/login");
      } else {
        router.replace("/login");
        router.refresh();
      }
    }
  };

  const toggleSidebar = () => {
    setIsSidebarCollapsed((current) => !current);
  };

  const toggleNotificationsPanel = () => {
    if (isNotificationsOpen) {
      setIsNotificationsOpen(false);
      return;
    }
    setIsProfileModalOpen(false);
    setIsNotificationsOpen(true);
    loadNotifications({ quiet: true }).catch(() => null);
  };

  const toggleProfileEditor = () => {
    if (isProfileModalOpen) {
      closeProfileEditor();
      return;
    }
    setProfileDraft({
      firstName: String(profile?.firstName || ""),
      middleName: String(profile?.middleName || ""),
      lastName: String(profile?.lastName || ""),
      profilePhotoDataUrl: String(profile?.profilePhotoDataUrl || ""),
      profilePhotoStoragePath: String(profile?.profilePhotoStoragePath || ""),
    });
    setIsNotificationsOpen(false);
    setIsProfileModalOpen(true);
    loadProfileInsights();
  };

  const closeProfileEditor = () => {
    if (isSavingProfile || isUploadingPhoto || isRevokingSessions) {
      return;
    }
    setIsProfileModalOpen(false);
  };

  const markNotificationAsRead = async (record) => {
    const recordId = String(record?.id || record?.recordId || "").trim();
    if (!recordId || String(record?.status || "").trim().toLowerCase() === "read") {
      return;
    }

    setIsMarkingNotifications(true);
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(recordId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ read: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || "Unable to update notification.");
      }

      setNotifications((current) =>
        current.map((item) =>
          String(item?.id || item?.recordId || "").trim() === recordId
            ? { ...item, status: "read", readAt: new Date().toISOString() }
            : item,
        ),
      );
      setNotificationUnreadCount((current) => Math.max(0, current - 1));
    } catch (error) {
      toast.error(error.message || "Unable to update notification.");
    } finally {
      setIsMarkingNotifications(false);
    }
  };

  const markAllNotificationsAsRead = async () => {
    if (isMarkingNotifications) {
      return;
    }
    setIsMarkingNotifications(true);
    try {
      const response = await fetch("/api/notifications/read-all", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ limit: 200 }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || "Unable to mark notifications as read.");
      }

      setNotifications((current) =>
        current.map((item) => ({
          ...item,
          status: "read",
          readAt: item?.readAt || new Date().toISOString(),
        })),
      );
      setNotificationUnreadCount(0);
    } catch (error) {
      toast.error(error.message || "Unable to mark notifications as read.");
    } finally {
      setIsMarkingNotifications(false);
    }
  };

  const openNotificationTarget = async (notification) => {
    if (!canOpenNotificationTarget(notification)) {
      return;
    }

    await markNotificationAsRead(notification);
    const actionUrl = String(notification?.actionUrl || "").trim();
    if (actionUrl) {
      setIsNotificationsOpen(false);
      router.push(actionUrl);
    }
  };

  const loadProfileInsights = async () => {
    setIsLoadingProfileInsights(true);
    try {
      const response = await fetch("/api/auth/profile/activity", { method: "GET", cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || "Unable to load account insights.");
      }

      setProfileInsights((current) => ({
        ...current,
        role: String(payload?.role || current.role || session?.role || ""),
        employmentRole: String(
          payload?.employmentRole || current.employmentRole || payload?.role || current.role || session?.role || "",
        ),
        employeeId: String(payload?.employeeId || "-"),
        employeeName: String(payload?.employeeName || "-"),
        employeeEmail: String(payload?.employeeEmail || userEmail),
        department: String(payload?.department || "-"),
        jobTitle: String(payload?.jobTitle || "-"),
        employmentStatus: String(payload?.employmentStatus || "-"),
        recordStatus: String(payload?.recordStatus || "-"),
        managerEmail: String(payload?.managerEmail || "-"),
        hireDate: String(payload?.hireDate || "-"),
        lastLoginAt: payload?.lastLoginAt || null,
        lastActiveIp: String(payload?.lastActiveIp || "unknown"),
        lastActiveDevice: String(payload?.lastActiveDevice || "Unknown device"),
        recentActivity: Array.isArray(payload?.recentActivity) ? payload.recentActivity : [],
      }));
    } catch (error) {
      toast.error(error.message || "Unable to load account insights.");
    } finally {
      setIsLoadingProfileInsights(false);
    }
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
    if (isUploadingPhoto || isRevokingSessions) {
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

  const handleSignOutAllDevices = async () => {
    if (isSavingProfile || isUploadingPhoto || isSigningOut || isRevokingSessions) {
      return;
    }

    setIsRevokingSessions(true);
    try {
      const response = await fetch("/api/auth/sessions/revoke", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || "Unable to revoke active sessions.");
      }

      const auth = getFirebaseClientAuth();
      await signOutFirebase(auth).catch(() => null);
      clearLoginRedirectPendingFlag();
      toast.success("All active sessions were signed out.");
      setIsProfileModalOpen(false);
      if (typeof window !== "undefined") {
        window.location.assign("/login");
      } else {
        router.replace("/login");
        router.refresh();
      }
    } catch (error) {
      toast.error(error.message || "Unable to revoke active sessions.");
    } finally {
      setIsRevokingSessions(false);
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
                className="mt-2 max-h-full space-y-1 overflow-y-auto pr-1 pb-3 [scrollbar-color:#bfdbfe_transparent] [scrollbar-width:thin]"
                aria-label="Main navigation"
              >
                {modules.map((module) => {
                  const isActive = pathname === module.href;
                  const moduleLabel = getModuleLabelForRole(module.id, module.label, role);
                  return (
                    <div key={module.id}>
                      <Link
                        href={module.href}
                        prefetch
                        aria-current={isActive ? "page" : undefined}
                        title={isSidebarCollapsed ? moduleLabel : undefined}
                        className={cn(
                          "group flex items-center gap-2.5 rounded-lg border py-2 text-[13px] transition",
                          isSidebarCollapsed ? "justify-center px-2.5" : "px-3",
                          isActive
                            ? "border-sky-200 bg-white text-sky-700 shadow-[0_12px_28px_-20px_rgba(14,116,214,0.8)]"
                            : "border-transparent text-slate-700 hover:border-slate-200/90 hover:bg-white/75",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition",
                            isActive ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white",
                          )}
                        >
                          <ModuleIcon moduleId={module.id} active={isActive} />
                        </span>
                        <span
                          className={cn(
                            "overflow-hidden whitespace-nowrap font-medium leading-none transition-all duration-300 ease-out",
                            isActive ? "text-sky-700" : "text-slate-800",
                            isSidebarCollapsed ? "max-w-0 -translate-x-2 opacity-0" : "max-w-[11.5rem] translate-x-0 opacity-100",
                          )}
                        >
                          {moduleLabel}
                        </span>
                      </Link>

                      <ModuleSubTabAnchors
                        moduleId={module.id}
                        moduleHref={module.href}
                        role={role}
                        visible={!isSidebarCollapsed}
                      />
                    </div>
                  );
                })}
              </nav>
            </div>

            <div className="mt-auto shrink-0 pt-2" />
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <header className="shrink-0 flex flex-col gap-3 border-b border-slate-200 bg-white/90 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
            <div>
              <p className="text-sm font-medium text-slate-900">Clio HRIS Workspace</p>
              <p className="text-xs text-slate-500">Today: {currentDate}</p>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <button
                  ref={notificationsButtonRef}
                  type="button"
                  onClick={toggleNotificationsPanel}
                  className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:border-sky-300 hover:bg-sky-50/60"
                  aria-label="Open notifications"
                  aria-expanded={isNotificationsOpen}
                  title="Notifications"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-4.5 w-4.5" aria-hidden="true">
                    <path d="M7.3 10.2a4.7 4.7 0 1 1 9.4 0v3.3l1.4 2v1h-12v-1l1.2-2v-3.3" />
                    <path d="M10.1 17.6a2.1 2.1 0 0 0 3.8 0" />
                  </svg>
                  {notificationUnreadCount > 0 ? (
                    <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {notificationUnreadCount > 99 ? "99+" : notificationUnreadCount}
                    </span>
                  ) : null}
                </button>

                <div
                  ref={notificationsPanelRef}
                  role="dialog"
                  aria-label="Notifications"
                  aria-hidden={!isNotificationsOpen}
                  className={cn(
                    "absolute right-0 top-[calc(100%+0.55rem)] z-50 w-[min(92vw,24rem)] max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_20px_50px_-30px_rgba(15,23,42,0.45)] transition-all duration-200",
                    isNotificationsOpen ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0",
                  )}
                >
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Notifications</p>
                      <p className="text-[11px] text-slate-500">
                        {notificationUnreadCount > 0
                          ? `${notificationUnreadCount} unread alert${notificationUnreadCount === 1 ? "" : "s"}`
                          : "No unread alerts"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={markAllNotificationsAsRead}
                      disabled={isMarkingNotifications || notificationUnreadCount === 0}
                      className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                    >
                      Mark all read
                    </button>
                  </div>

                  <div className="mt-2">
                    {isLoadingNotifications ? (
                      <div className="flex justify-center py-6">
                        <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" aria-hidden="true" />
                      </div>
                    ) : notifications.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500">
                        No notifications yet.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {notifications.map((item) => {
                          const itemId = String(item?.id || item?.recordId || "").trim() || `${item?.title}-${item?.createdAt}`;
                          const unread = String(item?.status || "").trim().toLowerCase() !== "read";
                          const canOpen = canOpenNotificationTarget(item);
                          return (
                            <li key={itemId}>
                              <button
                                type="button"
                                onClick={() => openNotificationTarget(item)}
                                disabled={!canOpen}
                                aria-disabled={!canOpen}
                                title={canOpen ? "Open notification" : "You do not have access to open this notification target."}
                                className={cn(
                                  "w-full rounded-lg border px-2.5 py-2 text-left transition",
                                  canOpen ? "hover:bg-slate-50" : "cursor-default",
                                  unread ? "border-sky-200 bg-sky-50/50" : "border-slate-200 bg-white",
                                )}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-xs font-semibold text-slate-900">{String(item?.title || "Security notification")}</p>
                                  <span
                                    className={cn(
                                      "inline-flex shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold capitalize",
                                      notificationSeverityClass(item?.severity),
                                    )}
                                  >
                                    {String(item?.severity || "medium")}
                                  </span>
                                </div>
                                <p className="mt-1 text-[11px] text-slate-600">{String(item?.message || "")}</p>
                                {!canOpen ? (
                                  <p className="mt-1 text-[10px] font-medium text-slate-500">Read-only alert for visibility.</p>
                                ) : null}
                                <p className="mt-1 text-[10px] text-slate-500">
                                  {formatNotificationRelativeTime(item?.createdAt)} | {String(item?.module || "System")}
                                </p>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              <div className="relative">
                <button
                  ref={profileButtonRef}
                  type="button"
                  onClick={toggleProfileEditor}
                  disabled={isProfileLoading}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-left transition hover:border-sky-300 hover:bg-sky-50/50 disabled:cursor-wait disabled:opacity-70"
                  aria-label="Open account profile"
                  title="Account profile"
                  aria-expanded={isProfileModalOpen}
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
                  <span className="inline-flex h-5 w-5 items-center justify-center text-slate-400">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-3.5 w-3.5" aria-hidden="true">
                      <path d="m6.7 9.3 5.3 5.4 5.3-5.4" />
                    </svg>
                  </span>
                </button>

                <div
                ref={profilePanelRef}
                role="dialog"
                aria-label="Account profile"
                aria-hidden={!isProfileModalOpen}
                className={cn(
                  "absolute right-0 top-[calc(100%+0.6rem)] z-50 w-[min(94vw,42rem)] max-h-[calc(100dvh-7rem)] origin-top-right overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_22px_60px_-28px_rgba(15,23,42,0.45)] transition-all duration-200 sm:p-5",
                  isProfileModalOpen ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Account Profile</h2>
                    <p className="mt-0.5 text-sm text-slate-600">Update your name and profile picture.</p>
                  </div>
                  <button
                    type="button"
                    onClick={closeProfileEditor}
                    disabled={isSavingProfile || isUploadingPhoto || isRevokingSessions}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-70"
                    aria-label="Close profile panel"
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
                        disabled={isUploadingPhoto || isSavingProfile || isRevokingSessions}
                        className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        {isUploadingPhoto ? "Uploading..." : "Upload Photo"}
                      </button>
                      <button
                        type="button"
                        onClick={removeProfilePhoto}
                        disabled={isUploadingPhoto || isSavingProfile || isRevokingSessions}
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

                  <div className="grid gap-2.5 sm:grid-cols-3">
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

                  <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Account Role</p>
                        <p className="text-sm font-medium text-slate-900">{accountRoleLabel}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Employment Role</p>
                        <p className="text-sm font-medium text-slate-900">{employmentRoleLabel}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Employee ID</p>
                        <p className="text-sm font-medium text-slate-900">{profileInsights.employeeId || "-"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Employee Name</p>
                        <p className="text-sm font-medium text-slate-900">{profileInsights.employeeName || "-"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Employee Email</p>
                        <p className="truncate text-sm font-medium text-slate-900">{profileInsights.employeeEmail || userEmail}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Department</p>
                        <p className="text-sm font-medium text-slate-900">{profileInsights.department || "-"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Position</p>
                        <p className="text-sm font-medium text-slate-900">{profileInsights.jobTitle || "-"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Employment Status</p>
                        <p className="text-sm font-medium text-slate-900">{profileInsights.employmentStatus || "-"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Record Status</p>
                        <p className="text-sm font-medium text-slate-900">{profileInsights.recordStatus || "-"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Employment Start Date</p>
                        <p className="text-sm font-medium text-slate-900">{formatDate(profileInsights.hireDate)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Manager</p>
                        <p className="truncate text-sm font-medium text-slate-900">{profileInsights.managerEmail || "-"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Last Login</p>
                        <p className="text-sm font-medium text-slate-900">{formatDateTime(profileInsights.lastLoginAt)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Last Active</p>
                        <p className="text-sm font-medium text-slate-900">
                          {profileInsights.lastActiveDevice || "Unknown device"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Source IP</p>
                        <p className="text-sm font-medium text-slate-900">{formatSourceIp(profileInsights.lastActiveIp)}</p>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                        Recent Account Activity
                      </p>
                      {isLoadingProfileInsights ? (
                        <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" aria-hidden="true" />
                      ) : null}
                    </div>
                    {isLoadingProfileInsights ? (
                      <div className="flex justify-center py-3">
                        <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" aria-hidden="true" />
                      </div>
                    ) : recentAccountActivity.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">No recent account activity.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {recentAccountActivity.map((item) => (
                          <li key={item.id || `${item.activityName}-${item.loggedAt}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                            <p className="text-xs font-medium text-slate-800">{item.activityName}</p>
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              {item.module} | {item.status} | {item.relativeTime || item.loggedAt}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSignOut}
                      disabled={isSigningOut || isSavingProfile || isUploadingPhoto || isRevokingSessions}
                      className="inline-flex h-9 items-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-70"
                    >
                      {isSigningOut ? "Signing out..." : "Sign out"}
                    </button>
                    <button
                      type="button"
                      onClick={handleSignOutAllDevices}
                      disabled={isRevokingSessions || isSigningOut || isSavingProfile || isUploadingPhoto}
                      className="inline-flex h-9 items-center rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-70"
                    >
                      {isRevokingSessions ? "Revoking..." : "Sign out all devices"}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={closeProfileEditor}
                      disabled={isSavingProfile || isUploadingPhoto || isRevokingSessions}
                      className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-70"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleProfileSave}
                      disabled={isSavingProfile || isUploadingPhoto || isRevokingSessions}
                      className="inline-flex h-9 items-center rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
                    >
                      {isUploadingPhoto ? "Uploading..." : isSavingProfile ? "Saving..." : "Save Profile"}
                    </button>
                  </div>
                </div>
                </div>
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

