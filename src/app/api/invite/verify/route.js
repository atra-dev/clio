import { NextResponse } from "next/server";
import { enforceRateLimitByRequest } from "@/lib/api-rate-limit";
import { recordAuditEvent } from "@/lib/audit-log";
import { getInviteForEmailVerification, verifyInviteEmail } from "@/lib/user-accounts";

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
    return "Invite email is already verified. You can proceed to login.";
  }
  if (reason === "invite_user_not_found") {
    return "Invited account is not available. Contact Super Admin.";
  }
  if (reason === "account_disabled") {
    return "Invited account is disabled. Contact Super Admin.";
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
    return jsonResponse(
      { message: "Too many verification attempts. Please wait before trying again." },
      { status: 429, rateLimit: activeRateLimit },
    );
  }

  let token = "";
  try {
    const body = await request.json();
    token = normalizeToken(body?.token);
  } catch {
    token = "";
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

    return jsonResponse(
      { message: messageForReason(reason) },
      { status: statusForReason(reason), rateLimit: activeRateLimit },
    );
  }
}

