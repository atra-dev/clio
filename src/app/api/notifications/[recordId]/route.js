import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { markInAppNotificationRead } from "@/lib/security-notifications";

async function getRecordId(paramsPromise) {
  const params = await paramsPromise;
  return typeof params?.recordId === "string" ? params.recordId : "";
}

export async function PATCH(request, { params }) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["resource:own"],
    ownerIdentifier: (session) => session.email,
    ownerBypassRoles: ["SUPER_ADMIN", "GRC", "HR", "EA", "EMPLOYEE_L1", "EMPLOYEE_L2", "EMPLOYEE_L3"],
    auditModule: "Notifications",
    auditAction: "Notification update request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);

  try {
    const body = await request.json().catch(() => ({}));
    const shouldMarkRead =
      typeof body?.read === "boolean" ? body.read : String(body?.status || "").trim().toLowerCase() !== "unread";
    if (!shouldMarkRead) {
      return NextResponse.json({ message: "Only mark-as-read is supported." }, { status: 400 });
    }

    const updated = await markInAppNotificationRead(recordId, session.email);
    if (!updated) {
      return NextResponse.json({ message: "Notification not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, record: updated });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "notification_update_failed";
    const status = reason === "forbidden_notification_access" ? 403 : 400;
    return NextResponse.json({ message: "Unable to update notification." }, { status });
  }
}
