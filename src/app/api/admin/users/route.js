import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { recordAuditEvent } from "@/lib/audit-log";
import { inviteUserAccount, listUserAccounts } from "@/lib/user-accounts";

export async function GET(request) {
  const auth = await authorizeApiRequest(request, {
    allowedRoles: ["SUPER_ADMIN"],
    requiredPermissions: ["user_management:view"],
    auditModule: "User Management",
    auditAction: "User directory access",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const users = await listUserAccounts();

  await recordAuditEvent({
    activityName: "User directory viewed",
    status: "Completed",
    module: "User Management",
    performedBy: session.email,
    sensitivity: "Non-sensitive",
    request,
  });

  return NextResponse.json({ users });
}

export async function POST(request) {
  const auth = await authorizeApiRequest(request, {
    allowedRoles: ["SUPER_ADMIN"],
    requiredPermissions: ["user_management:manage"],
    auditModule: "User Management",
    auditAction: "User invitation request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  try {
    const body = await request.json();
    const email = typeof body?.email === "string" ? body.email : "";
    const role = typeof body?.role === "string" ? body.role : "";
    const result = await inviteUserAccount({
      email,
      role,
      invitedBy: session.email,
    });

    await recordAuditEvent({
      activityName: `User invited (${result.user.role}): ${result.user.email}`,
      status: "Approved",
      module: "User Management",
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        invitedEmail: result.user.email,
        invitedRole: result.user.role,
        inviteId: result.invite.id,
        invitationStatus: result.invite.status,
      },
      request,
    });

    return NextResponse.json(
      {
        ok: true,
        user: result.user,
        invite: result.invite,
        delivery: "Email provider not configured. Use invitation token/link preview for now.",
      },
      { status: 201 },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";

    await recordAuditEvent({
      activityName: "User invitation failed",
      status: "Failed",
      module: "User Management",
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        reason,
      },
      request,
    });

    const message =
      reason === "invalid_email"
        ? "Invalid email address."
        : reason === "invalid_role"
          ? "Invalid role selected."
          : "Unable to create invitation.";

    return NextResponse.json({ message }, { status: 400 });
  }
}
