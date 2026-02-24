import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { parsePositiveInt } from "@/lib/hris-api";
import { markAllInAppNotificationsRead } from "@/lib/security-notifications";

export async function POST(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["resource:own"],
    ownerIdentifier: (session) => session.email,
    ownerBypassRoles: ["SUPER_ADMIN", "GRC", "HR", "EA", "EMPLOYEE_L1", "EMPLOYEE_L2", "EMPLOYEE_L3"],
    auditModule: "Notifications",
    auditAction: "Notification mark-all-read request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  try {
    const body = await request.json().catch(() => ({}));
    const limit = parsePositiveInt(body?.limit, 120, { min: 1, max: 300 });
    const result = await markAllInAppNotificationsRead({
      recipientEmail: session.email,
      limit,
    });
    return NextResponse.json({
      ok: true,
      updatedCount: Number(result?.updatedCount || 0),
    });
  } catch {
    return NextResponse.json({ message: "Unable to mark notifications as read." }, { status: 400 });
  }
}
