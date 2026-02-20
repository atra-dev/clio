import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth-session";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { recordAuditEvent } from "@/lib/audit-log";

export async function POST(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["auth:logout"],
    auditModule: "Authentication",
    auditAction: "Logout request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  await recordAuditEvent({
    activityName: "User logged out",
    status: "Completed",
    module: "Authentication",
    performedBy: session.email,
    sensitivity: "Sensitive",
    request,
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
  return response;
}
