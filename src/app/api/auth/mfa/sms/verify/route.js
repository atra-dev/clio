import { NextResponse } from "next/server";
import { enforceRateLimitByRequest } from "@/lib/api-rate-limit";
import { recordAuditEvent } from "@/lib/audit-log";
import { verifyFirebaseIdToken } from "@/lib/firebase-auth-identity";
import { completeLoginSmsVerification } from "@/lib/user-accounts";

function statusForReason(reason) {
  if (reason === "invalid_otp") {
    return 400;
  }
  if (reason === "otp_not_requested") {
    return 409;
  }
  if (reason === "otp_expired") {
    return 410;
  }
  if (reason === "otp_attempts_exceeded") {
    return 429;
  }
  if (reason === "invalid_mfa_challenge" || reason === "account_disabled") {
    return 403;
  }
  if (reason === "user_not_found") {
    return 404;
  }
  return 400;
}

function messageForReason(reason) {
  if (reason === "invalid_otp") {
    return "OTP is invalid. Check the code and try again.";
  }
  if (reason === "otp_not_requested") {
    return "Request OTP first before entering a verification code.";
  }
  if (reason === "otp_expired") {
    return "OTP has expired. Request a new code.";
  }
  if (reason === "otp_attempts_exceeded") {
    return "Maximum OTP attempts exceeded. Retry Google sign-in to restart verification.";
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
  return "Unable to verify OTP.";
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

export async function POST(request) {
  let activeRateLimit = enforceRateLimitByRequest({
    request,
    scope: "auth-mfa-sms-verify-ip",
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });

  if (!activeRateLimit.allowed) {
    return jsonResponse(
      { message: "Too many OTP verification attempts. Please wait before retrying." },
      { status: 429, rateLimit: activeRateLimit },
    );
  }

  try {
    const body = await request.json();
    const idToken = typeof body?.idToken === "string" ? body.idToken : "";
    const challengeToken = typeof body?.challengeToken === "string" ? body.challengeToken : "";
    const otpCode = typeof body?.otpCode === "string" ? body.otpCode : "";

    const identity = await verifyFirebaseIdToken(idToken);
    const email = identity.email;

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

      return jsonResponse(
        { message: "Too many OTP verification attempts for this account. Please wait and retry." },
        { status: 429, rateLimit: activeRateLimit },
      );
    }

    const updatedUser = await completeLoginSmsVerification({
      email,
      challengeToken,
      otpCode,
    });

    await recordAuditEvent({
      activityName: "Login SMS verification completed",
      status: "Approved",
      module: "Authentication",
      performedBy: email,
      sensitivity: "Sensitive",
      metadata: {
        verificationMethod: updatedUser?.verificationMethod || "sms",
        phoneVerifiedAt: updatedUser?.phoneVerifiedAt || null,
      },
      request,
    });

    return jsonResponse(
      {
        ok: true,
        message: "SMS verification completed. Continue sign-in.",
      },
      { rateLimit: activeRateLimit },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    if (reason === "already_verified") {
      return jsonResponse(
        {
          ok: true,
          alreadyVerified: true,
          message: "Phone number is already verified. Continue sign-in.",
        },
        { status: 200, rateLimit: activeRateLimit },
      );
    }
    const message = messageForReason(reason);
    const status = statusForReason(reason);

    await recordAuditEvent({
      activityName: "Login SMS verification failed",
      status: "Failed",
      module: "Authentication",
      performedBy: "anonymous@gmail.com",
      sensitivity: "Sensitive",
      metadata: {
        reason,
      },
      request,
    });

    return jsonResponse(
      {
        reason,
        message,
      },
      { status, rateLimit: activeRateLimit },
    );
  }
}
