import { NextResponse } from "next/server";
import { createSession, getSessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/auth-session";
import { enforceRateLimitByRequest, consumeRateLimit } from "@/lib/api-rate-limit";
import { recordAuditEvent } from "@/lib/audit-log";
import { verifyFirebaseIdToken } from "@/lib/firebase-auth-identity";
import { syncFirebaseCustomClaimsForUser } from "@/lib/firebase-custom-claims";
import { getLoginAccount, markUserLogin } from "@/lib/user-accounts";

function applyRateLimitHeaders(response, rateLimitResult) {
  if (!rateLimitResult?.headers || typeof rateLimitResult.headers !== "object") {
    return response;
  }
  for (const [headerKey, headerValue] of Object.entries(rateLimitResult.headers)) {
    response.headers.set(headerKey, String(headerValue));
  }
  return response;
}

function jsonResponse(payload, { status = 200, rateLimit } = {}) {
  const response = NextResponse.json(payload, { status });
  return applyRateLimitHeaders(response, rateLimit);
}

function parseBooleanEnv(name, fallbackValue = false) {
  const raw = String(process.env[name] || "")
    .trim()
    .toLowerCase();
  if (!raw) {
    return fallbackValue;
  }
  return raw === "true" || raw === "1" || raw === "yes";
}

function isClaimsSyncStrictMode() {
  const defaultRequired = process.env.NODE_ENV === "production";
  return parseBooleanEnv("CLIO_REQUIRE_FIREBASE_CUSTOM_CLAIMS", defaultRequired);
}

function mapClaimsSyncFailureMessage(reason) {
  const normalized = String(reason || "").trim();
  if (normalized === "firebase_custom_claims_not_configured") {
    return "Secure login is unavailable: Firebase Admin credentials are not configured on the server.";
  }
  if (normalized === "firebase_admin_access_token_failed") {
    return "Secure login is unavailable: Firebase Admin token generation failed. Check service account key format.";
  }
  if (normalized === "firebase_admin_permission_denied") {
    return "Secure login is unavailable: Firebase Admin service account lacks Identity Toolkit permissions.";
  }
  if (normalized === "firebase_project_not_found") {
    return "Secure login is unavailable: Firebase Admin project ID is invalid.";
  }
  if (normalized === "firebase_user_not_found") {
    return "Secure login is unavailable: signed-in Firebase user was not found in the configured project.";
  }
  return "Secure login is temporarily unavailable. Please contact Super Admin.";
}

export async function POST(request) {
  const isProduction = process.env.NODE_ENV === "production";
  const claimsSyncStrict = isClaimsSyncStrictMode();
  let activeRateLimit = enforceRateLimitByRequest({
    request,
    scope: "auth-login-ip",
    limit: 30,
    windowMs: 5 * 60 * 1000,
  });

  if (!activeRateLimit.allowed) {
    await recordAuditEvent({
      activityName: "Login request rate-limited (IP)",
      status: "Rejected",
      module: "Authentication",
      performedBy: "anonymous@gmail.com",
      sensitivity: "Sensitive",
      metadata: {
        reason: "rate_limit_exceeded",
        scope: "auth-login-ip",
      },
      request,
    });

    return jsonResponse(
      { message: "Too many login attempts. Please try again in a few minutes." },
      { status: 429, rateLimit: activeRateLimit },
    );
  }

  try {
    const body = await request.json();
    const idToken = typeof body?.idToken === "string" ? body.idToken : "";
    const firebaseIdentity = await verifyFirebaseIdToken(idToken);
    const normalizedEmail = firebaseIdentity.email;

    const emailRateLimit = consumeRateLimit({
      scope: "auth-login-email",
      identifier: normalizedEmail,
      limit: 12,
      windowMs: 10 * 60 * 1000,
    });
    activeRateLimit = emailRateLimit;
    if (!emailRateLimit.allowed) {
      await recordAuditEvent({
        activityName: "Login request rate-limited (account)",
        status: "Rejected",
        module: "Authentication",
        performedBy: normalizedEmail,
        sensitivity: "Sensitive",
        metadata: {
          reason: "rate_limit_exceeded",
          scope: "auth-login-email",
        },
        request,
      });

      return jsonResponse(
        { message: "Too many login attempts for this account. Please try again shortly." },
        { status: 429, rateLimit: emailRateLimit },
      );
    }

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

      return jsonResponse(
        { message: "Google account email must be verified." },
        { status: 403, rateLimit: activeRateLimit },
      );
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

      return jsonResponse(
        { message: "Only Google sign-in is allowed for this workspace." },
        { status: 403, rateLimit: activeRateLimit },
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

      return jsonResponse(
        { message: "Account is not provisioned for this workspace." },
        { status: 403, rateLimit: activeRateLimit },
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

      return jsonResponse(
        { message: "Account is disabled. Please contact Super Admin." },
        { status: 403, rateLimit: activeRateLimit },
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

      return jsonResponse(
        {
          message: "Account invitation must be verified first. Open your invite verification email link.",
        },
        { status: 403, rateLimit: activeRateLimit },
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

      return jsonResponse(
        { message: "Account is not active yet. Please contact Super Admin." },
        { status: 403, rateLimit: activeRateLimit },
      );
    }

    let claimsSyncResult = null;
    try {
      claimsSyncResult = await syncFirebaseCustomClaimsForUser({
        uid: firebaseIdentity.uid,
        email: normalizedEmail,
        role: account.role,
        status: account.status,
        sessionVersion: account.sessionVersion,
        allowMissingUser: false,
        strict: claimsSyncStrict,
      });
    } catch (error) {
      const syncReason = error instanceof Error ? error.message : "firebase_claims_sync_failed";
      const canBypassClaimsSync = !claimsSyncStrict;

      if (canBypassClaimsSync) {
        claimsSyncResult = {
          ok: false,
          reason: syncReason,
          skipped: true,
        };

        await recordAuditEvent({
          activityName: "Login warning: custom claims sync skipped",
          status: "Completed",
          module: "Authentication",
          performedBy: normalizedEmail,
          sensitivity: "Sensitive",
          metadata: {
            reason: syncReason,
            authProvider: "google",
            firebaseUid: firebaseIdentity.uid,
            mode: "claims_sync_optional_bypass",
          },
          request,
        });
      } else {
      await recordAuditEvent({
        activityName: "Login attempt rejected: custom claims sync failed",
        status: "Failed",
        module: "Authentication",
        performedBy: normalizedEmail,
        sensitivity: "Sensitive",
        metadata: {
          reason: syncReason,
          authProvider: "google",
          firebaseUid: firebaseIdentity.uid,
        },
        request,
      });

      return jsonResponse(
        {
          message: mapClaimsSyncFailureMessage(syncReason),
          reason: syncReason,
        },
        { status: 503, rateLimit: activeRateLimit },
      );
      }
    }

    if (!claimsSyncResult?.ok) {
      const canBypassClaimsSync = !claimsSyncStrict;
      if (!canBypassClaimsSync) {
      await recordAuditEvent({
        activityName: "Login attempt rejected: custom claims not synchronized",
        status: "Failed",
        module: "Authentication",
        performedBy: normalizedEmail,
        sensitivity: "Sensitive",
        metadata: {
          reason: claimsSyncResult?.reason || "firebase_claims_sync_failed",
          authProvider: "google",
          firebaseUid: firebaseIdentity.uid,
        },
        request,
      });

      return jsonResponse(
        {
          message: mapClaimsSyncFailureMessage(claimsSyncResult?.reason || "firebase_claims_sync_failed"),
          reason: claimsSyncResult?.reason || "firebase_claims_sync_failed",
        },
        { status: 503, rateLimit: activeRateLimit },
      );
      }
    }

    const { token, expiresAt } = createSession(normalizedEmail, account.role, {
      sessionVersion: account.sessionVersion,
    });
    const response = jsonResponse({ ok: true }, { rateLimit: activeRateLimit });
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
        sessionVersion: account.sessionVersion,
        authProvider: "google",
        firebaseUid: firebaseIdentity.uid,
        claimsSync: claimsSyncResult.reason || "synced",
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
      performedBy: "anonymous@gmail.com",
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
                    : reason === "firebase_custom_claims_not_configured"
                      ? "Firebase custom claims are not configured."
                      : "Unable to process login request.";

    return jsonResponse({ message }, { status: 400, rateLimit: activeRateLimit });
  }
}

