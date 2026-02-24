import { NextResponse } from "next/server";
import { enforceRateLimitByRequest } from "@/lib/api-rate-limit";
import { recordAuditEvent } from "@/lib/audit-log";
import { verifyFirebaseIdToken } from "@/lib/firebase-auth-identity";
import { dispatchDirectSms } from "@/lib/security-alert-delivery";
import { startLoginSmsVerification } from "@/lib/user-accounts";

function parseBooleanEnv(name, fallbackValue = false) {
  const raw = String(process.env[name] || "")
    .trim()
    .toLowerCase();
  if (!raw) {
    return fallbackValue;
  }
  return raw === "true" || raw === "1" || raw === "yes";
}

function statusForReason(reason) {
  if (reason === "invalid_phone_number" || reason === "invalid_otp") {
    return 400;
  }
  if (reason === "otp_cooldown" || reason === "otp_attempts_exceeded") {
    return 429;
  }
  if (reason === "invalid_mfa_challenge" || reason === "account_disabled") {
    return 403;
  }
  if (reason === "user_not_found") {
    return 404;
  }
  if (reason === "sms_provider_not_configured" || reason === "sms_delivery_failed") {
    return 503;
  }
  return 400;
}

function messageForReason(reason) {
  if (reason === "invalid_phone_number") {
    return "Phone number is invalid. Enter a valid mobile number with country code.";
  }
  if (reason === "otp_cooldown") {
    return "OTP was recently requested. Please wait before requesting another code.";
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
  if (reason === "sms_provider_not_configured") {
    return "SMS provider is not configured. Contact Super Admin.";
  }
  if (reason === "sms_delivery_failed") {
    return "Unable to deliver SMS OTP right now. Please try again later.";
  }
  return "Unable to send SMS OTP.";
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
    scope: "auth-mfa-sms-start-ip",
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });

  if (!activeRateLimit.allowed) {
    return jsonResponse(
      { message: "Too many OTP requests. Please wait before trying again." },
      { status: 429, rateLimit: activeRateLimit },
    );
  }

  try {
    const body = await request.json();
    const idToken = typeof body?.idToken === "string" ? body.idToken : "";
    const challengeToken = typeof body?.challengeToken === "string" ? body.challengeToken : "";
    const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber : "";

    const identity = await verifyFirebaseIdToken(idToken);
    const email = identity.email;
    activeRateLimit = enforceRateLimitByRequest({
      request,
      scope: "auth-mfa-sms-start-email",
      identifier: email,
      limit: 10,
      windowMs: 10 * 60 * 1000,
    });

    if (!activeRateLimit.allowed) {
      await recordAuditEvent({
        activityName: "SMS OTP send rate-limited",
        status: "Rejected",
        module: "Authentication",
        performedBy: email,
        sensitivity: "Sensitive",
        metadata: {
          reason: "rate_limit_exceeded",
          scope: "auth-mfa-sms-start-email",
        },
        request,
      });

      return jsonResponse(
        { message: "Too many OTP requests for this account. Please wait and retry." },
        { status: 429, rateLimit: activeRateLimit },
      );
    }

    const result = await startLoginSmsVerification({
      email,
      challengeToken,
      phoneNumber,
    });

    const otpBody = `CLIO verification code: ${result.otpCode}. This code expires soon.`;
    const delivery = await dispatchDirectSms({
      recipients: [result.phoneNumber],
      body: otpBody,
    });

    const smsDeliveryFailed =
      delivery?.status === "failed" ||
      delivery?.status === "partial" ||
      (delivery?.status === "skipped" &&
        (delivery?.reason === "provider_disabled" || delivery?.reason === "unsupported_provider"));

    if (smsDeliveryFailed && process.env.NODE_ENV === "production") {
      throw new Error(
        delivery?.reason === "provider_disabled" || delivery?.reason === "unsupported_provider"
          ? "sms_provider_not_configured"
          : "sms_delivery_failed",
      );
    }

    await recordAuditEvent({
      activityName: "Login SMS OTP requested",
      status: "Completed",
      module: "Authentication",
      performedBy: email,
      sensitivity: "Sensitive",
      metadata: {
        phoneMasked: result.phoneMasked,
        otpExpiresAt: result.otpExpiresAt,
        smsProvider: String(delivery?.provider || "none"),
        smsStatus: String(delivery?.status || "unknown"),
      },
      request,
    });

    const exposeDevOtp = parseBooleanEnv("CLIO_EXPOSE_DEV_OTP", process.env.NODE_ENV !== "production");
    return jsonResponse(
      {
        ok: true,
        message: "OTP sent. Enter the code to complete SMS verification.",
        phoneMasked: result.phoneMasked,
        otpExpiresAt: result.otpExpiresAt,
        resendAvailableAt: result.resendAvailableAt,
        ...(exposeDevOtp ? { devOtpCode: result.otpCode } : {}),
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
      activityName: "Login SMS OTP request failed",
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
