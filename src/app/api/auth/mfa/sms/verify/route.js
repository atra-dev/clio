import { NextResponse } from "next/server";
import {
  createMfaLoginProof,
  getExpiredCookieOptions,
  getMfaLoginProofCookieOptions,
  MFA_LOGIN_PROOF_COOKIE_NAME,
} from "@/lib/auth-session";
import { enforceRateLimitByRequest } from "@/lib/api-rate-limit";
import { recordAuditEvent } from "@/lib/audit-log";
import { verifyFirebaseIdToken } from "@/lib/firebase-auth-identity";
import { alertRepeatedOtpFailures } from "@/lib/security-auth-alerts";
import { completeLoginSmsVerificationWithFirebase, getLoginAccount } from "@/lib/user-accounts";

function statusForReason(reason) {
  if (reason === "invalid_phone_number") {
    return 400;
  }
  if (reason === "invalid_mfa_challenge" || reason === "account_disabled") {
    return 403;
  }
  if (reason === "user_not_found") {
    return 404;
  }
  if (reason === "firebase_phone_not_verified") {
    return 409;
  }
  return 400;
}

function messageForReason(reason) {
  if (reason === "invalid_phone_number") {
    return "Phone number is invalid. Please use a valid mobile number with country code.";
  }
  if (reason === "invalid_mfa_challenge") {
    return "SMS verification challenge expired. Retry Google sign-in.";
  }
  if (reason === "user_not_found") {
    return "Account is not provisioned for this workspace.";
  }
  if (reason === "account_disabled") {
    return "Account is disabled. Please contact Super Admin.";
  }
  if (reason === "already_verified") {
    return "Phone number is already verified. Continue sign-in.";
  }
  if (reason === "firebase_phone_not_verified") {
    return "Phone verification is not yet completed in Firebase. Complete OTP first.";
  }
  return "Unable to complete SMS verification.";
}

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

function withMfaProofCookie(response, email, sessionVersion = 1) {
  const proof = createMfaLoginProof(email, { sessionVersion });
  response.cookies.set(
    MFA_LOGIN_PROOF_COOKIE_NAME,
    proof.token,
    getMfaLoginProofCookieOptions(proof.expiresAt),
  );
  return response;
}

function clearMfaProofCookie(response) {
  response.cookies.set(MFA_LOGIN_PROOF_COOKIE_NAME, "", getExpiredCookieOptions());
  return response;
}

export async function POST(request) {
  let activeRateLimit = enforceRateLimitByRequest({
    request,
    scope: "auth-mfa-sms-verify-ip",
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });

  if (!activeRateLimit.allowed) {
    await alertRepeatedOtpFailures({
      request,
      reason: "otp_attempts_exceeded",
      context: "login_sms_verify_ip",
    }).catch(() => null);
    return jsonResponse(
      { message: "Too many OTP verification attempts. Please wait before retrying." },
      { status: 429, rateLimit: activeRateLimit },
    );
  }

  let actorEmail = "anonymous@gmail.com";
  try {
    const body = await request.json();
    const idToken = typeof body?.idToken === "string" ? body.idToken : "";
    const challengeToken = typeof body?.challengeToken === "string" ? body.challengeToken : "";
    const phoneNumberInput = typeof body?.phoneNumber === "string" ? body.phoneNumber : "";

    const identity = await verifyFirebaseIdToken(idToken);
    const email = identity.email;
    actorEmail = email;

    activeRateLimit = enforceRateLimitByRequest({
      request,
      scope: "auth-mfa-sms-verify-email",
      identifier: email,
      limit: 12,
      windowMs: 10 * 60 * 1000,
    });

    if (!activeRateLimit.allowed) {
      await recordAuditEvent({
        activityName: "SMS OTP verify rate-limited",
        status: "Rejected",
        module: "Authentication",
        performedBy: email,
        sensitivity: "Sensitive",
        metadata: {
          reason: "rate_limit_exceeded",
          scope: "auth-mfa-sms-verify-email",
        },
        request,
      });
      await alertRepeatedOtpFailures({
        request,
        actorEmail: email,
        reason: "otp_attempts_exceeded",
        context: "login_sms_verify_email",
      }).catch(() => null);

      return jsonResponse(
        { message: "Too many OTP verification attempts for this account. Please wait and retry." },
        { status: 429, rateLimit: activeRateLimit },
      );
    }

    const hasPhoneProvider = Array.isArray(identity.providerIds) && identity.providerIds.includes("phone");
    const mfaPhoneNumber = Array.isArray(identity.mfaFactors)
      ? String(identity.mfaFactors.find((factor) => factor?.factorId === "phone")?.phoneNumber || "").trim()
      : "";
    const identityPhoneNumber = String(identity.phoneNumber || mfaPhoneNumber || "").trim();
    const hasFirebasePhoneVerification = (hasPhoneProvider && Boolean(String(identity.phoneNumber || "").trim())) || Boolean(mfaPhoneNumber);
    if (!hasFirebasePhoneVerification || !identityPhoneNumber) {
      throw new Error("firebase_phone_not_verified");
    }

    const updatedUser = await completeLoginSmsVerificationWithFirebase({
      email,
      challengeToken,
      phoneNumber: identityPhoneNumber || phoneNumberInput,
    });

    await recordAuditEvent({
      activityName: "Login SMS verification completed (Firebase phone)",
      status: "Approved",
      module: "Authentication",
      performedBy: email,
      sensitivity: "Sensitive",
      metadata: {
        verificationMethod: updatedUser?.verificationMethod || "sms",
        phoneVerifiedAt: updatedUser?.phoneVerifiedAt || null,
        phoneNumber: identityPhoneNumber || null,
      },
      request,
    });

    const response = jsonResponse(
      {
        ok: true,
        message: "SMS verification completed. Continue sign-in.",
      },
      { rateLimit: activeRateLimit },
    );
    return withMfaProofCookie(response, email, updatedUser?.sessionVersion || 1);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    if (reason === "already_verified") {
      const account = await getLoginAccount(actorEmail).catch(() => null);
      const response = jsonResponse(
        {
          ok: true,
          alreadyVerified: true,
          message: "Phone number is already verified. Continue sign-in.",
        },
        { status: 200, rateLimit: activeRateLimit },
      );
      return withMfaProofCookie(response, actorEmail, account?.sessionVersion || 1);
    }
    const message = messageForReason(reason);
    const status = statusForReason(reason);

    await recordAuditEvent({
      activityName: "Login SMS verification failed",
      status: "Failed",
      module: "Authentication",
      performedBy: actorEmail,
      sensitivity: "Sensitive",
      metadata: {
        reason,
      },
      request,
    });
    await alertRepeatedOtpFailures({
      request,
      actorEmail,
      reason,
      context: "login_sms_verify",
    }).catch(() => null);

    const response = jsonResponse(
      {
        reason,
        message,
      },
      { status, rateLimit: activeRateLimit },
    );
    return clearMfaProofCookie(response);
  }
}
