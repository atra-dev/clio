import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { listAuditEvents } from "@/lib/audit-log";
import { listEmployeeRecordsBackend } from "@/lib/hris-backend";
import { getLoginAccount } from "@/lib/user-accounts";
import { formatEmployeeName } from "@/lib/name-utils";

const RECENT_ACTIVITY_LIMIT = 5;
const AUDIT_SCAN_LIMIT = 300;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function toText(value, fallback = "-") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function resolveBrowser(userAgent) {
  const ua = String(userAgent || "").toLowerCase();
  if (!ua || ua === "unknown") {
    return "Unknown Browser";
  }
  if (ua.includes("edg/")) return "Microsoft Edge";
  if (ua.includes("opr/") || ua.includes("opera")) return "Opera";
  if (ua.includes("firefox/")) return "Firefox";
  if (ua.includes("safari/") && !ua.includes("chrome/")) return "Safari";
  if (ua.includes("chrome/")) return "Chrome";
  return "Browser";
}

function resolveOs(userAgent) {
  const ua = String(userAgent || "").toLowerCase();
  if (!ua || ua === "unknown") {
    return "Unknown OS";
  }
  if (ua.includes("windows")) return "Windows";
  if (ua.includes("mac os x") || ua.includes("macintosh")) return "macOS";
  if (ua.includes("android")) return "Android";
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios")) return "iOS";
  if (ua.includes("linux")) return "Linux";
  return "OS";
}

function summarizeDevice(userAgent) {
  const ua = String(userAgent || "").trim();
  if (!ua || ua === "unknown") {
    return "Unknown device";
  }
  return `${resolveBrowser(ua)} on ${resolveOs(ua)}`;
}

function normalizeRecentActivity(entry) {
  return {
    id: entry.id,
    activityName: toText(entry.activityName, "Activity"),
    module: toText(entry.module, "System"),
    status: toText(entry.status, "Completed"),
    loggedAt: toText(entry.loggedAt, "-"),
    relativeTime: toText(entry.relativeTime, "-"),
    sourceIp: toText(entry.sourceIp, "unknown"),
  };
}

export async function GET(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["resource:own"],
    ownerIdentifier: (session) => session.email,
    ownerBypassRoles: ["SUPER_ADMIN"],
    auditModule: "Authentication",
    auditAction: "Account profile insights request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const actorEmail = normalizeEmail(session.email);

  const account = await getLoginAccount(actorEmail).catch(() => null);

  let employeeRecord = null;
  try {
    const ownEmployeeRecords = await listEmployeeRecordsBackend({ ownerEmail: actorEmail });
    if (Array.isArray(ownEmployeeRecords) && ownEmployeeRecords.length > 0) {
      employeeRecord =
        ownEmployeeRecords.find((item) => !item?.isArchived && item?.status !== "archived") || ownEmployeeRecords[0];
    }
  } catch {
    employeeRecord = null;
  }

  let ownEvents = [];
  try {
    const events = await listAuditEvents({ limit: AUDIT_SCAN_LIMIT });
    ownEvents = (Array.isArray(events) ? events : []).filter(
      (entry) => normalizeEmail(entry?.performedBy) === actorEmail,
    );
  } catch {
    ownEvents = [];
  }

  const recentActivity = ownEvents.slice(0, RECENT_ACTIVITY_LIMIT).map(normalizeRecentActivity);
  const lastContextEvent = ownEvents.find(
    (entry) => String(entry?.sourceIp || "").trim() !== "unknown" || String(entry?.userAgent || "").trim() !== "unknown",
  );
  const employeeName = formatEmployeeName({
    firstName: employeeRecord?.firstName,
    middleName: employeeRecord?.middleName,
    lastName: employeeRecord?.lastName,
    suffix: employeeRecord?.suffix,
    fallback: employeeRecord?.name,
    fallbackEmail: employeeRecord?.email || actorEmail,
    fallbackLabel: "Employee",
  });

  return NextResponse.json({
    role: toText(account?.role || session.role, "EMPLOYEE"),
    employmentRole: toText(employeeRecord?.role || account?.role || session.role, "EMPLOYEE"),
    employeeId: toText(employeeRecord?.employeeId || account?.id || "-", "-"),
    employeeName: toText(employeeName, "-"),
    department: toText(employeeRecord?.department || "-", "-"),
    jobTitle: toText(employeeRecord?.jobTitle || "-", "-"),
    employmentStatus: toText(employeeRecord?.employmentStatus || "-", "-"),
    recordStatus: toText(employeeRecord?.status || "-", "-"),
    managerEmail: toText(employeeRecord?.managerEmail || "-", "-"),
    hireDate: toText(employeeRecord?.hireDate || "-", "-"),
    employeeEmail: toText(employeeRecord?.email || actorEmail, actorEmail),
    lastLoginAt: account?.lastLoginAt || null,
    lastActiveIp: toText(lastContextEvent?.sourceIp || "unknown", "unknown"),
    lastActiveDevice: summarizeDevice(lastContextEvent?.userAgent || "unknown"),
    recentActivity,
  });
}
