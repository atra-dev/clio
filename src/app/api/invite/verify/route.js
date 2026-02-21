import { NextResponse } from "next/server";
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

export async function GET(request) {
  const token = normalizeToken(request.nextUrl.searchParams.get("token"));
  if (!token) {
    return NextResponse.json({ message: messageForReason("invalid_invite_token") }, { status: 400 });
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
      return NextResponse.json({ message: messageForReason("invite_not_found") }, { status: 404 });
    }

    if (invite.status === "expired") {
      return NextResponse.json({ message: messageForReason("invite_expired"), invite }, { status: 410 });
    }

    if (invite.status === "revoked") {
      return NextResponse.json({ message: messageForReason("invite_revoked"), invite }, { status: 403 });
    }

    return NextResponse.json({ ok: true, invite });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    if (reason === "invite_already_verified") {
      const invite = await getInviteForEmailVerification(token).catch(() => null);
      return NextResponse.json(
        {
          ok: true,
          alreadyVerified: true,
          invite,
          message: messageForReason(reason),
        },
        { status: 200 },
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

    return NextResponse.json(
      { message: messageForReason(reason) },
      { status: statusForReason(reason) },
    );
  }
}

export async function POST(request) {
  let token = "";
  try {
    const body = await request.json();
    token = normalizeToken(body?.token);
  } catch {
    token = "";
  }

  if (!token) {
    return NextResponse.json({ message: messageForReason("invalid_invite_token") }, { status: 400 });
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

    return NextResponse.json({
      ok: true,
      user: result.user,
      invite: result.invite,
      message: "Email verification completed. You can now sign in with Google.",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";

    if (reason === "invite_already_verified") {
      const invite = await getInviteForEmailVerification(token).catch(() => null);
      return NextResponse.json(
        {
          ok: true,
          alreadyVerified: true,
          invite,
          message: messageForReason(reason),
        },
        { status: 200 },
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

    return NextResponse.json(
      { message: messageForReason(reason) },
      { status: statusForReason(reason) },
    );
  }
}

