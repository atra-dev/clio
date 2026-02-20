import { NextResponse } from "next/server";
import { createSession, getSessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/auth-session";
import { recordAuditEvent } from "@/lib/audit-log";
import { verifyFirebaseIdToken } from "@/lib/firebase-auth-identity";
import { getLoginAccount, markUserLogin } from "@/lib/user-accounts";

export async function POST(request) {
  try {
    const body = await request.json();
    const idToken = typeof body?.idToken === "string" ? body.idToken : "";
    const firebaseIdentity = await verifyFirebaseIdToken(idToken);
    const normalizedEmail = firebaseIdentity.email;

    if (!firebaseIdentity.emailVerified) {
      await recordAuditEvent({
        activityName: "Login attempt rejected: email not verified",
        status: "Rejected",
        module: "Authentication",
        performedBy: normalizedEmail,
        sensitivity: "Sensitive",
        metadata: {
          reason: "email_not_verified",
          authProvider: "firebase",
          firebaseUid: firebaseIdentity.uid,
        },
        request,
      });

      return NextResponse.json({ message: "Google account email must be verified." }, { status: 403 });
    }

    const isGoogleProvider = firebaseIdentity.providerIds.includes("google.com");
    if (!isGoogleProvider) {
      await recordAuditEvent({
        activityName: "Login attempt rejected: unsupported auth provider",
        status: "Rejected",
        module: "Authentication",
        performedBy: normalizedEmail,
        sensitivity: "Sensitive",
        metadata: {
          reason: "provider_not_allowed",
          authProvider: "firebase",
          firebaseUid: firebaseIdentity.uid,
          providerIds: firebaseIdentity.providerIds,
        },
        request,
      });

      return NextResponse.json(
        { message: "Only Google sign-in is allowed for this workspace." },
        { status: 403 },
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
          authProvider: "google",
          firebaseUid: firebaseIdentity.uid,
        },
        request,
      });

      return NextResponse.json(
        { message: "Account is not provisioned for this workspace." },
        { status: 403 },
      );
    }

    if (account.status === "disabled") {
      await recordAuditEvent({
        activityName: "Login attempt rejected: account disabled",
        status: "Rejected",
        module: "Authentication",
        performedBy: normalizedEmail,
        sensitivity: "Sensitive",
        metadata: {
          reason: "account_disabled",
          accountStatus: account.status,
          authProvider: "google",
          firebaseUid: firebaseIdentity.uid,
        },
        request,
      });

      return NextResponse.json(
        { message: "Account is disabled. Please contact Super Admin." },
        { status: 403 },
      );
    }

    const requiresInviteVerification = account.source === "invite" && !account.emailVerifiedAt;
    if (requiresInviteVerification) {
      await recordAuditEvent({
        activityName: "Login attempt rejected: invite email verification required",
        status: "Rejected",
        module: "Authentication",
        performedBy: normalizedEmail,
        sensitivity: "Sensitive",
        metadata: {
          reason: "invite_email_verification_required",
          accountStatus: account.status,
          authProvider: "google",
          firebaseUid: firebaseIdentity.uid,
          source: account.source,
        },
        request,
      });

      return NextResponse.json(
        {
          message: "Account invitation must be verified first. Open your invite verification email link.",
        },
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
          authProvider: "google",
          firebaseUid: firebaseIdentity.uid,
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
        authProvider: "google",
        firebaseUid: firebaseIdentity.uid,
      },
      request,
    });

    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "request_parse_or_internal_error";

    await recordAuditEvent({
      activityName: "Login request failed",
      status: "Failed",
      module: "Authentication",
      performedBy: "anonymous@clio.local",
      sensitivity: "Sensitive",
      metadata: {
        reason,
      },
      request,
    });

    const message =
      reason === "missing_id_token"
        ? "Google sign-in token is missing."
        : reason === "invalid_id_token"
          ? "Invalid Google sign-in token."
          : reason === "firebase_api_key_not_configured"
            ? "Firebase API key is not configured."
            : reason === "firebase_user_not_found"
              ? "Unable to verify Google account."
              : reason === "firebase_user_missing_email"
                ? "Google account does not expose an email."
                : reason === "identity_lookup_failed"
                  ? "Unable to verify Google login with Firebase."
                  : reason === "invite_email_verification_required"
                    ? "Account invitation must be verified first."
                    : "Unable to process login request.";

    return NextResponse.json({ message }, { status: 400 });
  }
}
