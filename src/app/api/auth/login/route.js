import { NextResponse } from "next/server";
import { createSession, getSessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/auth-session";
import { normalizeRole } from "@/lib/hris";
import { recordAuditEvent } from "@/lib/audit-log";

function isValidEmail(value) {
  if (typeof value !== "string") {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function POST(request) {
  try {
    const body = await request.json();
    const email = typeof body?.email === "string" ? body.email : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const role = normalizeRole(body?.role);
    const normalizedEmail = email.trim().toLowerCase() || "anonymous@clio.local";

    if (!isValidEmail(email) || password.length < 8) {
      await recordAuditEvent({
        activityName: "Login attempt failed",
        status: "Failed",
        module: "Authentication",
        performedBy: normalizedEmail,
        sensitivity: "Sensitive",
        metadata: {
          reason: "invalid_credentials",
          requestedRole: role,
        },
        request,
      });

      return NextResponse.json(
        { message: "Invalid credentials. Please check your email and password." },
        { status: 400 },
      );
    }

    const { token, expiresAt } = createSession(email, role);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions(expiresAt));

    await recordAuditEvent({
      activityName: `User login successful (${role})`,
      status: "Completed",
      module: "Authentication",
      performedBy: normalizedEmail,
      sensitivity: "Sensitive",
      metadata: {
        requestedRole: role,
      },
      request,
    });

    return response;
  } catch {
    await recordAuditEvent({
      activityName: "Login request failed",
      status: "Failed",
      module: "Authentication",
      performedBy: "anonymous@clio.local",
      sensitivity: "Sensitive",
      metadata: {
        reason: "request_parse_or_internal_error",
      },
      request,
    });

    return NextResponse.json({ message: "Unable to process login request." }, { status: 400 });
  }
}
