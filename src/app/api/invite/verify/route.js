import { NextResponse } from "next/server";
import { enforceRateLimitByRequest } from "@/lib/api-rate-limit";
import { recordAuditEvent } from "@/lib/audit-log";
import { dispatchDirectSms } from "@/lib/security-alert-delivery";
import { alertRepeatedOtpFailures } from "@/lib/security-auth-alerts";
import {
  completeInviteSmsVerification,
  getInviteForEmailVerification,
  startInviteSmsVerification,
  verifyInviteEmail,
} from "@/lib/user-accounts";

function parseBooleanEnv(name, fallbackValue = false) {
  const raw = String(process.env[name] || "")
    .trim()
    .toLowerCase();
  if (!raw) {
    return fallbackValue;
  }
  return raw === "true" || raw === "1" || raw === "yes";
}

function normalizeToken(value) {
  const token = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{24,128}$/.test(token)) {
    return "";
  }
  return token;
}

function tokenHint(token) {
  const normalized = normalizeToken(token);
  if (!normalized) {
    return "invalid";
  }
  if (normalized.length <= 12) {
    return normalized;
  }
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

function messageForReason(reason) {
  if (reason === "invalid_invite_token") {
    return "Invite link is invalid or unavailable.";
  }
  if (reason === "invite_not_found") {
    return "Invite link is invalid or unavailable.";
  }
  if (reason === "invite_expired") {
    return "Invite link has expired. Ask Super Admin to send a new invitation.";
  }
  if (reason === "invite_revoked") {
    return "Invite link has been revoked. Contact Super Admin.";
  }
  if (reason === "invite_already_verified") {
    return "Invite verification is already completed. You can proceed to login.";
  }
  if (reason === "invite_user_not_found") {
    return "Invited account is not available. Contact Super Admin.";
  }
  if (reason === "account_disabled") {
    return "Invited account is disabled. Contact Super Admin.";
  }
  if (reason === "invalid_phone_number") {
    return "Phone number is invalid. Enter a valid mobile number with country code.";
  }
  if (reason === "otp_cooldown") {
    return "OTP was recently requested. Please wait before requesting another code.";
  }
  if (reason === "otp_not_requested") {
    return "Request OTP first before entering a verification code.";
  }
  if (reason === "invalid_otp") {
    return "OTP is invalid. Check the code and try again.";
  }
  if (reason === "otp_expired") {
    return "OTP has expired. Request a new code.";
  }
  if (reason === "otp_attempts_exceeded") {
    return "Maximum OTP attempts exceeded. Contact Super Admin for a new invite.";
  }
  if (reason === "sms_provider_not_configured") {
    return "SMS provider is not configured. Contact Super Admin.";
  }
  if (reason === "sms_delivery_failed") {
    return "Unable to deliver SMS OTP right now. Please try again later.";
  }
  return "Unable to process invite verification.";
}

function statusForReason(reason) {
  if (reason === "invalid_invite_token") {
    return 400;
  }
  if (reason === "invite_not_found" || reason === "invite_user_not_found") {
    return 404;
  }
  if (reason === "invite_expired") {
    return 410;
  }
  if (reason === "invite_revoked" || reason === "account_disabled") {
    return 403;
  }
  if (reason === "invite_already_verified") {
    return 200;
  }
  if (reason === "invalid_phone_number") {
    return 400;
  }
  if (reason === "otp_cooldown") {
    return 429;
  }
  if (reason === "otp_not_requested") {
    return 409;
  }
  if (reason === "invalid_otp") {
    return 400;
  }
  if (reason === "otp_expired") {
    return 410;
  }
  if (reason === "otp_attempts_exceeded") {
    return 429;
  }
  if (reason === "sms_provider_not_configured") {
    return 503;
  }
  if (reason === "sms_delivery_failed") {
    return 503;
  }
  return 400;
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

export async function GET(request) {
  let activeRateLimit = enforceRateLimitByRequest({
    request,
    scope: "invite-verify-get-ip",
    limit: 80,
    windowMs: 10 * 60 * 1000,
  });

  if (!activeRateLimit.allowed) {
    await recordAuditEvent({
      activityName: "Invite verification lookup rate-limited (IP)",
      status: "Rejected",
      module: "User Management",
      performedBy: "anonymous@gmail.com",
      sensitivity: "Sensitive",
      metadata: {
        reason: "rate_limit_exceeded",
        scope: "invite-verify-get-ip",
      },
      request,
    });
    return jsonResponse(
      { message: "Too many verification requests. Please try again shortly." },
      { status: 429, rateLimit: activeRateLimit },
    );
  }

  const token = normalizeToken(request.nextUrl.searchParams.get("token"));
  activeRateLimit = enforceRateLimitByRequest({
    request,
    scope: "invite-verify-get-token",
    identifier: token || undefined,
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });

  if (!activeRateLimit.allowed) {
    await recordAuditEvent({
      activityName: "Invite verification lookup rate-limited (token)",
      status: "Rejected",
      module: "User Management",
      performedBy: "anonymous@gmail.com",
      sensitivity: "Sensitive",
      metadata: {
        reason: "rate_limit_exceeded",
        scope: "invite-verify-get-token",
        tokenHint: tokenHint(token),
      },
      request,
    });
    return jsonResponse(
      { message: "Too many verification attempts for this invite link. Please wait and retry." },
      { status: 429, rateLimit: activeRateLimit },
    );
  }

  if (!token) {
    return jsonResponse(
      { message: messageForReason("invalid_invite_token") },
      { status: 400, rateLimit: activeRateLimit },
    );
  }

  try {
    const invite = await getInviteForEmailVerification(token);
    if (!invite) {
      await recordAuditEvent({
        activityName: "Invite verification lookup failed",
        status: "Rejected",
        module: "User Management",
        performedBy: "anonymous@gmail.com",
        sensitivity: "Sensitive",
        metadata: {
          reason: "invite_not_found",
          tokenHint: tokenHint(token),
        },
        request,
      });
      return jsonResponse(
        { message: messageForReason("invite_not_found") },
        { status: 404, rateLimit: activeRateLimit },
      );
    }

    if (invite.status === "expired") {
      return jsonResponse(
        { message: messageForReason("invite_expired"), invite },
        { status: 410, rateLimit: activeRateLimit },
      );
    }

    if (invite.status === "revoked") {
      return jsonResponse(
        { message: messageForReason("invite_revoked"), invite },
        { status: 403, rateLimit: activeRateLimit },
      );
    }

    return jsonResponse({ ok: true, invite }, { rateLimit: activeRateLimit });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    if (reason === "invite_already_verified") {
      const invite = await getInviteForEmailVerification(token).catch(() => null);
      return jsonResponse(
        {
          ok: true,
          alreadyVerified: true,
          invite,
          message: messageForReason(reason),
        },
        { status: 200, rateLimit: activeRateLimit },
      );
    }

    await recordAuditEvent({
      activityName: "Invite verification lookup failed",
      status: "Failed",
      module: "User Management",
      performedBy: "anonymous@gmail.com",
      sensitivity: "Sensitive",
      metadata: {
        reason,
        tokenHint: tokenHint(token),
      },
      request,
    });

    return jsonResponse(
      { message: messageForReason(reason) },
      { status: statusForReason(reason), rateLimit: activeRateLimit },
    );
  }
}

export async function POST(request) {
  let activeRateLimit = enforceRateLimitByRequest({
    request,
    scope: "invite-verify-post-ip",
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });

  if (!activeRateLimit.allowed) {
    await recordAuditEvent({
      activityName: "Invite verification submit rate-limited (IP)",
      status: "Rejected",
      module: "User Management",
      performedBy: "anonymous@gmail.com",
      sensitivity: "Sensitive",
      metadata: {
        reason: "rate_limit_exceeded",
        scope: "invite-verify-post-ip",
      },
      request,
    });
    await alertRepeatedOtpFailures({
      request,
      reason: "otp_attempts_exceeded",
      context: "invite_verify_post_ip",
    }).catch(() => null);
    return jsonResponse(
      { message: "Too many verification attempts. Please wait before trying again." },
      { status: 429, rateLimit: activeRateLimit },
    );
  }

  let token = "";
  let action = "verify_email";
  let phoneNumber = "";
  let otpCode = "";
  try {
    const body = await request.json();
    token = normalizeToken(body?.token);
    action = String(body?.action || "verify_email")
      .trim()
      .toLowerCase();
    phoneNumber = String(body?.phoneNumber || "").trim();
    otpCode = String(body?.otpCode || "").trim();
  } catch {
    token = "";
    action = "verify_email";
    phoneNumber = "";
    otpCode = "";
  }

  activeRateLimit = enforceRateLimitByRequest({
    request,
    scope: "invite-verify-post-token",
    identifier: token || undefined,
    limit: 8,
    windowMs: 10 * 60 * 1000,
  });

  if (!activeRateLimit.allowed) {
    await recordAuditEvent({
      activityName: "Invite verification submit rate-limited (token)",
      status: "Rejected",
      module: "User Management",
      performedBy: "anonymous@gmail.com",
      sensitivity: "Sensitive",
      metadata: {
        reason: "rate_limit_exceeded",
        scope: "invite-verify-post-token",
        tokenHint: tokenHint(token),
      },
      request,
    });
    await alertRepeatedOtpFailures({
      request,
      reason: "otp_attempts_exceeded",
      context: "invite_verify_post_token",
    }).catch(() => null);
    return jsonResponse(
      { message: "Too many verification attempts for this invite. Please try again later." },
      { status: 429, rateLimit: activeRateLimit },
    );
  }

  if (!token) {
    return jsonResponse(
      { message: messageForReason("invalid_invite_token") },
      { status: 400, rateLimit: activeRateLimit },
    );
  }

  try {
    if (action === "start_sms") {
      const result = await startInviteSmsVerification({ token, phoneNumber });
      const otpBody = `CLIO verification code: ${result.otpCode}. This code will expire soon.`;
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
        activityName: "Invite SMS OTP requested",
        status: "Completed",
        module: "User Management",
        performedBy: "anonymous@gmail.com",
        sensitivity: "Sensitive",
        metadata: {
          tokenHint: tokenHint(token),
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
          invite: result.invite,
          phoneMasked: result.phoneMasked,
          otpExpiresAt: result.otpExpiresAt,
          resendAvailableAt: result.resendAvailableAt,
          message: "OTP sent. Enter the code to complete SMS verification.",
          ...(exposeDevOtp ? { devOtpCode: result.otpCode } : {}),
        },
        { rateLimit: activeRateLimit },
      );
    }

    if (action === "complete_sms") {
      const result = await completeInviteSmsVerification({ token, otpCode });
      await recordAuditEvent({
        activityName: `Invite SMS verification completed: ${result.user.email}`,
        status: "Approved",
        module: "User Management",
        performedBy: result.user.email,
        sensitivity: "Sensitive",
        metadata: {
          role: result.user.role,
          verificationMethod: result.user.verificationMethod || "sms",
          phoneVerifiedAt: result.user.phoneVerifiedAt || null,
        },
        request,
      });

      return jsonResponse(
        {
          ok: true,
          user: result.user,
          invite: result.invite,
          message: "SMS verification completed. You can now sign in with Google.",
        },
        { rateLimit: activeRateLimit },
      );
    }

    const result = await verifyInviteEmail({ token });

    await recordAuditEvent({
      activityName: `Invite email verified: ${result.user.email}`,
      status: "Approved",
      module: "User Management",
      performedBy: result.user.email,
      sensitivity: "Sensitive",
      metadata: {
        role: result.user.role,
        status: result.user.status,
        verificationMethod: result.user.verificationMethod || "email",
      },
      request,
    });

    return jsonResponse({
      ok: true,
      user: result.user,
      invite: result.invite,
      message: "Email verification completed. You can now sign in with Google.",
    }, { rateLimit: activeRateLimit });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";

    if (reason === "invite_already_verified") {
      const invite = await getInviteForEmailVerification(token).catch(() => null);
      return jsonResponse(
        {
          ok: true,
          alreadyVerified: true,
          invite,
          message: messageForReason(reason),
        },
        { status: 200, rateLimit: activeRateLimit },
      );
    }

    await recordAuditEvent({
      activityName: "Invite email verification failed",
      status: "Failed",
      module: "User Management",
      performedBy: "anonymous@gmail.com",
      sensitivity: "Sensitive",
      metadata: {
        reason,
        tokenHint: tokenHint(token),
      },
      request,
    });
    await alertRepeatedOtpFailures({
      request,
      reason,
      context: action === "complete_sms" ? "invite_complete_sms" : "invite_verification",
    }).catch(() => null);

    return jsonResponse(
      { message: messageForReason(reason), reason },
      { status: statusForReason(reason), rateLimit: activeRateLimit },
    );
  }
}

