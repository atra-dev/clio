import { NextResponse } from "next/server";
import { getExpiredCookieOptions, MFA_LOGIN_PROOF_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/lib/auth-session";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { recordAuditEvent } from "@/lib/audit-log";
import { revokeUserSessions } from "@/lib/user-accounts";

export async function POST(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["auth:logout"],
    ownerIdentifier: (session) => session.email,
    ownerBypassRoles: ["SUPER_ADMIN"],
    auditModule: "Authentication",
    auditAction: "Session revocation request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  try {
    const updated = await revokeUserSessions({ userId: session.email });
    if (!updated) {
      return NextResponse.json({ message: "Account not found." }, { status: 404 });
    }

    await recordAuditEvent({
      activityName: "All sessions revoked by account owner",
      status: "Completed",
      module: "Authentication",
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        sessionVersion: updated.sessionVersion,
      },
      request,
    });

    const response = NextResponse.json({
      ok: true,
      sessionVersion: updated.sessionVersion,
    });
    const expiredCookieOptions = getExpiredCookieOptions();
    response.cookies.set(SESSION_COOKIE_NAME, "", expiredCookieOptions);
    response.cookies.set(MFA_LOGIN_PROOF_COOKIE_NAME, "", expiredCookieOptions);
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "session_revocation_failed";
    await recordAuditEvent({
      activityName: "Session revocation failed",
      status: "Failed",
      module: "Authentication",
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        reason,
      },
      request,
    });

    const message = reason === "invalid_user" ? "Invalid account identifier." : "Unable to revoke active sessions.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
