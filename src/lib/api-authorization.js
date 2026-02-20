import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRole } from "@/lib/hris";
import { canAccessResource, hasPermission } from "@/lib/rbac";
import { recordAuditEvent } from "@/lib/audit-log";

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
      performedBy: "anonymous@clio.local",
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
