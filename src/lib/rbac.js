import { MODULE_ACCESS } from "@/features/hris/constants";
import { normalizeRole } from "@/lib/hris";

const ROLE_PERMISSIONS = {
  SUPER_ADMIN: ["*"],
  HR: [
    "dashboard:view",
    "employees:view",
    "documents:view",
    "audit:write:nonsensitive",
    "auth:logout",
    "resource:own",
  ],
  GRC: [
    "dashboard:view",
    "activity_log:view",
    "exports:view",
    "exports:manage",
    "audit:view",
    "audit:write:nonsensitive",
    "auth:logout",
    "resource:own",
  ],
  EA: [
    "dashboard:view",
    "documents:view",
    "audit:write:nonsensitive",
    "auth:logout",
    "resource:own",
  ],
};

const MODULE_REQUIRED_PERMISSION = {
  dashboard: "dashboard:view",
  employees: "employees:view",
  "activity-log": "activity_log:view",
  exports: "exports:view",
  documents: "documents:view",
  settings: "settings:view",
  "user-management": "user_management:view",
};

const DEFAULT_ROLE_EMAILS = {
  SUPER_ADMIN: ["superadmin@clio.local"],
  HR: ["hr@clio.local"],
  GRC: ["grc@clio.local"],
  EA: ["ea@clio.local"],
};

function parseEnvEmailList(rawValue, fallbackValues = []) {
  if (typeof rawValue !== "string") {
    return new Set(fallbackValues.map((value) => value.trim().toLowerCase()).filter(Boolean));
  }

  if (rawValue.trim().length === 0) {
    return new Set(fallbackValues.map((value) => value.trim().toLowerCase()).filter(Boolean));
  }

  return new Set(
    rawValue
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function getPermissionsForRole(role) {
  const normalized = normalizeRole(role);
  return ROLE_PERMISSIONS[normalized] ?? [];
}

export function hasPermission(role, permission) {
  const permissions = getPermissionsForRole(role);
  return permissions.includes("*") || permissions.includes(permission);
}

export function canAccessModule(role, moduleId) {
  const normalized = normalizeRole(role);
  const allowedModules = new Set(MODULE_ACCESS[normalized] ?? []);

  if (!allowedModules.has(moduleId)) {
    return false;
  }

  const requiredPermission = MODULE_REQUIRED_PERMISSION[moduleId];
  if (!requiredPermission) {
    return true;
  }

  return hasPermission(normalized, requiredPermission);
}

export function canAccessResource({
  role,
  actorIdentifier,
  ownerIdentifier,
  allowRoles = ["SUPER_ADMIN"],
}) {
  const normalized = normalizeRole(role);
  if (allowRoles.includes(normalized)) {
    return true;
  }

  if (!hasPermission(normalized, "resource:own")) {
    return false;
  }

  const actor = String(actorIdentifier || "").trim().toLowerCase();
  const owner = String(ownerIdentifier || "").trim().toLowerCase();
  if (!actor || !owner) {
    return false;
  }

  return actor === owner;
}

export function resolveRoleForEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  const explicitRoleMap = {
    SUPER_ADMIN: parseEnvEmailList(process.env.SUPER_ADMIN_EMAILS, DEFAULT_ROLE_EMAILS.SUPER_ADMIN),
    HR: parseEnvEmailList(process.env.HR_EMAILS, DEFAULT_ROLE_EMAILS.HR),
    GRC: parseEnvEmailList(process.env.GRC_EMAILS, DEFAULT_ROLE_EMAILS.GRC),
    EA: parseEnvEmailList(process.env.EA_EMAILS, DEFAULT_ROLE_EMAILS.EA),
  };

  for (const role of ["SUPER_ADMIN", "HR", "GRC", "EA"]) {
    if (explicitRoleMap[role].has(normalizedEmail)) {
      return role;
    }
  }

  return null;
}

export function getModuleIdFromPathname(pathname) {
  const path = String(pathname || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");

  if (!path) {
    return "dashboard";
  }

  const firstSegment = path.split("/")[0];
  return MODULE_REQUIRED_PERMISSION[firstSegment] ? firstSegment : null;
}
