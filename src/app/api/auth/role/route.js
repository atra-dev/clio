import { NextResponse } from "next/server";
import {
  createSession,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "@/lib/auth-session";
import { normalizeRole } from "@/lib/hris";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { recordAuditEvent } from "@/lib/audit-log";

export async function POST(request) {
  const auth = await authorizeApiRequest(request, {
    allowedRoles: ["SUPER_ADMIN"],
    requiredPermissions: ["role:manage"],
    auditModule: "Authentication",
    auditAction: "Role change request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  try {
    const body = await request.json();
    const nextRole = normalizeRole(body?.role);
    const { token: nextToken, expiresAt } = createSession(session.email, nextRole, {
      sessionVersion: session.sessionVersion,
    });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, nextToken, getSessionCookieOptions(expiresAt));

    await recordAuditEvent({
      activityName: `Role context changed to ${nextRole}`,
      status: "Approved",
      module: "Authentication",
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        previousRole: session.role,
        nextRole,
      },
      request,
    });

    return response;
  } catch {
    await recordAuditEvent({
      activityName: "Role change request failed",
      status: "Failed",
      module: "Authentication",
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        reason: "request_parse_or_internal_error",
      },
      request,
    });

    return NextResponse.json({ message: "Unable to update role." }, { status: 400 });
  }
}
