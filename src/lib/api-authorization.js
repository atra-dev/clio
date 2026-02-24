import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRole } from "@/lib/hris";
import { canAccessResource, hasPermission } from "@/lib/rbac";
import { recordAuditEvent } from "@/lib/audit-log";
import { getLoginAccount } from "@/lib/user-accounts";

function deny(status, message) {
  return { error: NextResponse.json({ message }, { status }) };
}

export async function authorizeApiRequest(
  request,
  {
    allowedRoles,
    requiredPermissions = [],
    ownerIdentifier,
    ownerBypassRoles = ["SUPER_ADMIN"],
    auditModule = "Authorization",
    auditAction = "API access check",
  } = {},
) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const rawSession = verifySessionToken(token);

  if (!rawSession) {
    await recordAuditEvent({
      activityName: `${auditAction} denied (no active session)`,
      status: "Failed",
      module: auditModule,
      performedBy: "anonymous@gmail.com",
      sensitivity: "Sensitive",
      metadata: {
        reason: "unauthorized",
      },
      request,
    });

    return deny(401, "Unauthorized.");
  }

  const session = {
    ...rawSession,
    role: normalizeRole(rawSession.role),
  };

  const account = await getLoginAccount(session.email).catch(() => null);
  if (!account) {
    await recordAuditEvent({
      activityName: `${auditAction} denied (account not found)`,
      status: "Failed",
      module: auditModule,
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        reason: "account_not_found",
      },
      request,
    });

    return deny(401, "Session is no longer valid. Please sign in again.");
  }

  if (account.status !== "active") {
    await recordAuditEvent({
      activityName: `${auditAction} blocked by account status`,
      status: "Rejected",
      module: auditModule,
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        reason: "account_not_active",
        accountStatus: account.status,
      },
      request,
    });

    return deny(403, "Account is not active.");
  }

  const accountRole = normalizeRole(account.role);
  const accountSessionVersion = Number.parseInt(String(account.sessionVersion ?? ""), 10) || 1;
  const allowsRoleContextSwitch = accountRole === "SUPER_ADMIN";
  const roleMismatch = session.role !== accountRole;
  const staleSessionVersion = session.sessionVersion !== accountSessionVersion;
  if (staleSessionVersion || (roleMismatch && !allowsRoleContextSwitch)) {
    await recordAuditEvent({
      activityName: `${auditAction} denied (stale session)`,
      status: "Rejected",
      module: auditModule,
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        reason: staleSessionVersion ? "session_version_mismatch" : "session_role_mismatch",
        tokenRole: session.role,
        accountRole,
        tokenSessionVersion: session.sessionVersion,
        accountSessionVersion,
      },
      request,
    });

    return deny(401, "Session expired. Please sign in again.");
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && !allowedRoles.includes(session.role)) {
    await recordAuditEvent({
      activityName: `${auditAction} blocked by role policy`,
      status: "Rejected",
      module: auditModule,
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        role: session.role,
        allowedRoles,
        reason: "role_not_allowed",
      },
      request,
    });

    return deny(403, "Forbidden.");
  }

  if (requiredPermissions.length > 0) {
    const hasAllPermissions = requiredPermissions.every((permission) =>
      hasPermission(session.role, permission),
    );

    if (!hasAllPermissions) {
      await recordAuditEvent({
        activityName: `${auditAction} blocked by permission policy`,
        status: "Rejected",
        module: auditModule,
        performedBy: session.email,
        sensitivity: "Sensitive",
        metadata: {
          role: session.role,
          requiredPermissions,
          reason: "missing_permission",
        },
        request,
      });

      return deny(403, "Forbidden.");
    }
  }

  if (ownerIdentifier) {
    const actorEmail = session.email;
    const ownerEmail = typeof ownerIdentifier === "function" ? await ownerIdentifier(session) : ownerIdentifier;

    if (
      !canAccessResource({
        role: session.role,
        actorIdentifier: actorEmail,
        ownerIdentifier: ownerEmail,
        allowRoles: ownerBypassRoles,
      })
    ) {
      await recordAuditEvent({
        activityName: `${auditAction} blocked by ownership policy`,
        status: "Rejected",
        module: auditModule,
        performedBy: session.email,
        sensitivity: "Sensitive",
        metadata: {
          role: session.role,
          ownerIdentifier: ownerEmail,
          reason: "ownership_validation_failed",
        },
        request,
      });

      return deny(403, "Forbidden.");
    }
  }

  return { session };
}

