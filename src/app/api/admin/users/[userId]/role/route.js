import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { recordAuditEvent } from "@/lib/audit-log";
import { updateUserAccountRole } from "@/lib/user-accounts";

async function getUserId(paramsPromise) {
  const params = await paramsPromise;
  return typeof params?.userId === "string" ? params.userId : "";
}

export async function PATCH(request, { params }) {
  const auth = await authorizeApiRequest(request, {
    allowedRoles: ["SUPER_ADMIN", "GRC"],
    requiredPermissions: ["user_management:manage"],
    auditModule: "User Management",
    auditAction: "User role update request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const userId = await getUserId(params);

  try {
    const body = await request.json();
    const nextRole = typeof body?.role === "string" ? body.role : "";
    const normalizedTarget = String(userId || "").trim().toLowerCase();
    const normalizedActor = String(session.email || "").trim().toLowerCase();

    if (normalizedTarget && normalizedTarget === normalizedActor && String(nextRole || "").trim().toUpperCase() !== "SUPER_ADMIN") {
      await recordAuditEvent({
        activityName: "Self-role change attempt blocked",
        status: "Rejected",
        module: "User Management",
        performedBy: session.email,
        sensitivity: "Sensitive",
        metadata: {
          targetUserId: userId,
          targetEmail: session.email,
          attemptedRole: nextRole,
          reason: "self_privilege_change_blocked",
        },
        request,
      });

      return NextResponse.json(
        { message: "Cannot change your own Super Admin role." },
        { status: 400 },
      );
    }

    const updated = await updateUserAccountRole({
      userId,
      role: nextRole,
    });

    if (!updated) {
      return NextResponse.json({ message: "User not found." }, { status: 404 });
    }

    await recordAuditEvent({
      activityName: `User role updated: ${updated.email}`,
      status: "Approved",
      module: "User Management",
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        targetUserId: updated.id,
        targetEmail: updated.email,
        targetRole: updated.role,
      },
      request,
    });

    return NextResponse.json({ ok: true, user: updated });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";

    await recordAuditEvent({
      activityName: "User role update failed",
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
      reason === "invalid_role"
        ? "Invalid role selected."
        : reason === "invalid_user"
          ? "Invalid user identifier."
          : "Unable to update user role.";

    return NextResponse.json({ message }, { status: 400 });
  }
}
