import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { parsePositiveInt } from "@/lib/hris-api";
import { listInAppNotifications } from "@/lib/security-notifications";

export async function GET(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["resource:own"],
    ownerIdentifier: (session) => session.email,
    ownerBypassRoles: ["SUPER_ADMIN", "GRC", "HR", "EA", "EMPLOYEE_L1", "EMPLOYEE_L2", "EMPLOYEE_L3"],
    auditModule: "Notifications",
    auditAction: "Notification list request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const status = String(request.nextUrl?.searchParams.get("status") || "all")
    .trim()
    .toLowerCase();
  const limit = parsePositiveInt(request.nextUrl?.searchParams.get("limit"), 20, {
    min: 1,
    max: 120,
  });

  try {
    const result = await listInAppNotifications({
      recipientEmail: session.email,
      status,
      limit,
    });
    return NextResponse.json({
      records: result.records,
      unreadCount: Number(result.unreadCount || 0),
      totalScoped: Number(result.totalScoped || 0),
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Unable to load notifications.",
      },
      { status: 400 },
    );
  }
}
