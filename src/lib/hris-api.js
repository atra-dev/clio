import { NextResponse } from "next/server";
import { canAccessResource, hasPermission } from "@/lib/rbac";
import { recordAuditEvent } from "@/lib/audit-log";

const PRIVILEGED_OWNER_BYPASS_ROLES = ["SUPER_ADMIN", "GRC", "HR", "EA"];

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function maskValue(value, { start = 2, end = 2, fallback = "Masked" } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    return fallback;
  }

  if (raw.length <= start + end) {
    return `${raw.slice(0, 1)}***`;
  }

  return `${raw.slice(0, start)}***${raw.slice(raw.length - end)}`;
}

export function isEmployeeRole(role) {
  return String(role || "")
    .trim()
    .toUpperCase()
    .startsWith("EMPLOYEE_");
}

export function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export function parsePositiveInt(value, fallback, { min = 1, max = 1000 } = {}) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

export function paginateRows(rows, { page = 1, pageSize = 20 } = {}) {
  const safePage = parsePositiveInt(page, 1, { min: 1, max: 100000 });
  const safePageSize = parsePositiveInt(pageSize, 20, { min: 1, max: 200 });
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const currentPage = Math.min(safePage, totalPages);
  const start = (currentPage - 1) * safePageSize;
  const end = start + safePageSize;
  const data = rows.slice(start, end);

  return {
    data,
    pagination: {
      page: currentPage,
      pageSize: safePageSize,
      total,
      totalPages,
    },
  };
}

export async function parseJsonBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    throw new Error("invalid_json_body");
  }
}

export function badRequest(message) {
  return NextResponse.json({ message }, { status: 400 });
}

export function forbidden(message = "Forbidden.") {
  return NextResponse.json({ message }, { status: 403 });
}

export function notFound(message = "Record not found.") {
  return NextResponse.json({ message }, { status: 404 });
}

export function getSelfRestrictedOwnerEmail({ session, requestedOwnerEmail, fallbackOwnerEmail }) {
  if (!session || !isEmployeeRole(session.role)) {
    const requested = normalizeEmail(requestedOwnerEmail || fallbackOwnerEmail);
    return requested || null;
  }

  return normalizeEmail(session.email);
}

export function canViewSensitiveEmployeeFields(role) {
  return hasPermission(role, "employees:view:sensitive");
}

export function sanitizeEmployeeRecordForViewer(record, role) {
  if (!record || typeof record !== "object") {
    return record;
  }

  if (canViewSensitiveEmployeeFields(role)) {
    return record;
  }

  const maskedGovernmentIds =
    record.governmentIds && typeof record.governmentIds === "object"
      ? Object.entries(record.governmentIds).reduce((accumulator, [key, value]) => {
          accumulator[key] = maskValue(value, { start: 2, end: 2 });
          return accumulator;
        }, {})
      : {};

  const payrollInformation =
    record.payrollInformation && typeof record.payrollInformation === "object"
      ? Object.keys(record.payrollInformation).reduce((accumulator, key) => {
          accumulator[key] = "Restricted";
          return accumulator;
        }, {})
      : {};

  return {
    ...record,
    govId: maskValue(record.govId, { start: 2, end: 2 }),
    governmentIds: maskedGovernmentIds,
    payrollInformation,
  };
}

export function canActorAccessOwner({
  session,
  ownerEmail,
  ownerBypassRoles = PRIVILEGED_OWNER_BYPASS_ROLES,
}) {
  const owner = normalizeEmail(ownerEmail);
  if (!owner) {
    return false;
  }

  return canAccessResource({
    role: session.role,
    actorIdentifier: session.email,
    ownerIdentifier: owner,
    allowRoles: ownerBypassRoles,
  });
}

export function canActorEditModule({
  role,
  editPermission,
  selfEditPermission,
  isSelfResource,
}) {
  if (hasPermission(role, editPermission)) {
    return true;
  }

  if (isSelfResource && selfEditPermission && hasPermission(role, selfEditPermission)) {
    return true;
  }

  return false;
}

export function mapBackendError(reason, fallbackMessage) {
  const normalized = String(reason || "").trim();
  switch (normalized) {
    case "invalid_json_body":
      return { status: 400, message: "Invalid request payload." };
    case "invalid_record_id":
      return { status: 400, message: "Invalid record identifier." };
    case "invalid_employee_email":
      return { status: 400, message: "Employee email is required." };
    case "employee_account_not_found":
      return {
        status: 409,
        message: "No user account found for this employee email. Invite or activate the user account first.",
      };
    case "invalid_target_role":
      return {
        status: 400,
        message: "Target role is required and must be a valid system role.",
      };
    case "forbidden_target_role":
      return {
        status: 403,
        message: "Target role assignment is not allowed by lifecycle permission policy.",
      };
    case "role_sync_failed":
      return {
        status: 409,
        message: "Employee user account was not found. Invite or activate the account before applying role changes.",
      };
    case "approval_required":
      return {
        status: 409,
        message: "Workflow approval chain must be completed before setting this status.",
      };
    case "invalid_workflow_action":
      return {
        status: 400,
        message: "Invalid workflow action payload.",
      };
    case "invalid_approval_decision":
      return {
        status: 400,
        message: "Approval decision must be approve or reject.",
      };
    case "no_pending_approval_step":
      return {
        status: 409,
        message: "No pending approval step remains for this workflow.",
      };
    case "approval_not_allowed_for_role":
      return {
        status: 403,
        message: "Current role is not allowed to approve the active step.",
      };
    case "invalid_template_name":
      return { status: 400, message: "Template name is required." };
    case "invalid_export_dataset":
      return { status: 400, message: "Export dataset is required." };
    case "invalid_reference_kind":
      return { status: 400, message: "Reference type is invalid." };
    case "invalid_reference_label":
      return {
        status: 400,
        message: "Reference label is required and must be within the allowed length.",
      };
    case "invalid_retention_module":
      return {
        status: 400,
        message: "Retention module filter is invalid.",
      };
    case "invalid_purge_confirmation":
      return {
        status: 400,
        message: "Invalid purge confirmation phrase.",
      };
    case "duplicate_reference_value":
      return {
        status: 409,
        message: "Reference value already exists.",
      };
    case "immutable_reference_item":
      return {
        status: 403,
        message: "System reference values cannot be removed.",
      };
    case "access_revocation_failed":
      return {
        status: 409,
        message:
          "Access revocation could not be confirmed for this employee account. Retry offboarding or review account status.",
      };
    case "account_activation_failed":
      return {
        status: 409,
        message: "Account activation could not be confirmed for this employee account.",
      };
    case "firestore_not_configured":
      return {
        status: 503,
        message:
          "Database is not configured. Set Firebase environment variables and restart the app.",
      };
    default:
      return { status: 400, message: fallbackMessage || "Unable to process request." };
  }
}

export async function logApiAudit({
  request,
  module,
  activityName,
  status = "Completed",
  sensitivity = "Sensitive",
  performedBy = "system@gmail.com",
  metadata,
}) {
  const shouldWriteAsync =
    process.env.CLIO_AUDIT_ASYNC === "true" ||
    (process.env.CLIO_AUDIT_ASYNC !== "false" && process.env.NODE_ENV !== "production");

  const writePromise = recordAuditEvent({
    activityName,
    status,
    module,
    performedBy,
    sensitivity,
    metadata,
    request,
  }).catch(() => null);

  if (shouldWriteAsync) {
    return;
  }

  await writePromise;
}
