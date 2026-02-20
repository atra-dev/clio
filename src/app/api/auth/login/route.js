import { NextResponse } from "next/server";
import { createSession, getSessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/auth-session";
import { recordAuditEvent } from "@/lib/audit-log";
import { getLoginAccount, markUserLogin } from "@/lib/user-accounts";

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
        },
        request,
      });

      return NextResponse.json(
        { message: "Invalid credentials. Please check your email and password." },
        { status: 400 },
      );
    }

    const account = await getLoginAccount(normalizedEmail);
    if (!account) {
      await recordAuditEvent({
        activityName: "Login attempt rejected: account not provisioned",
        status: "Rejected",
        module: "Authentication",
        performedBy: normalizedEmail,
        sensitivity: "Sensitive",
        metadata: {
          reason: "role_not_provisioned",
        },
        request,
      });

      return NextResponse.json(
        { message: "Account is not provisioned for this workspace." },
        { status: 403 },
      );
    }

    if (account.status !== "active") {
      await recordAuditEvent({
        activityName: "Login attempt rejected: account inactive",
        status: "Rejected",
        module: "Authentication",
        performedBy: normalizedEmail,
        sensitivity: "Sensitive",
        metadata: {
          reason: "account_inactive",
          accountStatus: account.status,
        },
        request,
      });

      return NextResponse.json(
        { message: "Account is not active yet. Please contact Super Admin." },
        { status: 403 },
      );
    }

    const { token, expiresAt } = createSession(normalizedEmail, account.role);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions(expiresAt));
    await markUserLogin(normalizedEmail);

    await recordAuditEvent({
      activityName: `User login successful (${account.role})`,
      status: "Completed",
      module: "Authentication",
      performedBy: normalizedEmail,
      sensitivity: "Sensitive",
      metadata: {
        assignedRole: account.role,
        accountStatus: account.status,
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
