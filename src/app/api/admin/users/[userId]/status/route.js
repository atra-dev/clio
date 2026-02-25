import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { recordAuditEvent } from "@/lib/audit-log";
import { updateUserAccountStatus } from "@/lib/user-accounts";

async function getUserId(paramsPromise) {
  const params = await paramsPromise;
  return typeof params?.userId === "string" ? params.userId : "";
}

export async function PATCH(request, { params }) {
  const auth = await authorizeApiRequest(request, {
    allowedRoles: ["SUPER_ADMIN", "GRC"],
    requiredPermissions: ["user_management:manage"],
    auditModule: "User Management",
    auditAction: "User status update request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const userId = await getUserId(params);

  try {
    const body = await request.json();
    const nextStatus = typeof body?.status === "string" ? body.status : "";
    const normalizedTarget = String(userId || "").trim().toLowerCase();
    const normalizedActor = String(session.email || "").trim().toLowerCase();
    const normalizedStatus = String(nextStatus || "").trim().toLowerCase();

    if (normalizedTarget && normalizedTarget === normalizedActor && normalizedStatus !== "active") {
      await recordAuditEvent({
        activityName: "Self-disable attempt blocked",
        status: "Rejected",
        module: "User Management",
        performedBy: session.email,
        sensitivity: "Sensitive",
        metadata: {
          targetUserId: userId,
          targetEmail: session.email,
          attemptedStatus: nextStatus,
          reason: "self_lockout_prevented",
        },
        request,
      });

      return NextResponse.json(
        { message: "Cannot disable your own Super Admin account." },
        { status: 400 },
      );
    }

    const updated = await updateUserAccountStatus({
      userId,
      status: nextStatus,
    });

    if (!updated) {
      return NextResponse.json({ message: "User not found." }, { status: 404 });
    }

    await recordAuditEvent({
      activityName: `User account ${updated.status}: ${updated.email}`,
      status: "Approved",
      module: "User Management",
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        targetUserId: updated.id,
        targetEmail: updated.email,
        targetRole: updated.role,
        status: updated.status,
      },
      request,
    });

    return NextResponse.json({ ok: true, user: updated });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";

    await recordAuditEvent({
      activityName: "User status update failed",
      status: "Failed",
      module: "User Management",
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        reason,
        targetUserId: userId,
      },
      request,
    });

    const message =
      reason === "invalid_status"
        ? "Invalid account status."
        : reason === "invalid_user"
          ? "Invalid user identifier."
          : "Unable to update account status.";

    return NextResponse.json({ message }, { status: 400 });
  }
}
