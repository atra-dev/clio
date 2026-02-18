import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { recordAuditEvent } from "@/lib/audit-log";

export async function POST(request) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(token);
  const performedBy = session?.email || "anonymous@clio.local";

  await recordAuditEvent({
    activityName: "User logged out",
    status: "Completed",
    module: "Authentication",
    performedBy,
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
