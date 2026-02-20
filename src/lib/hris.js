import { MODULE_ACCESS, MODULES, ROLES } from "@/features/hris/constants";

const DEFAULT_ROLE = "HR";
const roleIds = new Set(ROLES.map((role) => role.id));

export function normalizeRole(value) {
  if (typeof value !== "string") {
    return DEFAULT_ROLE;
  }

  const sanitized = value.trim().toUpperCase();
  return roleIds.has(sanitized) ? sanitized : DEFAULT_ROLE;
}

export function getRoleDetails(role) {
  const normalized = normalizeRole(role);
  return ROLES.find((item) => item.id === normalized) ?? ROLES.find((item) => item.id === DEFAULT_ROLE);
}

export function getModulesForRole(role) {
  const normalized = normalizeRole(role);
  const allowed = new Set(MODULE_ACCESS[normalized] ?? []);
  return MODULES.filter((module) => allowed.has(module.id));
}
