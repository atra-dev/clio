import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { recordAuditEvent } from "@/lib/audit-log";

export async function GET(request) {
  const requestedEmail = request.nextUrl.searchParams.get("email")?.trim().toLowerCase() || "";

  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["resource:own"],
    ownerIdentifier: (session) => requestedEmail || session.email,
    ownerBypassRoles: ["SUPER_ADMIN"],
    auditModule: "Authentication",
    auditAction: "Profile fetch request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  await recordAuditEvent({
    activityName: "Session profile viewed",
    status: "Completed",
    module: "Authentication",
    performedBy: session.email,
    sensitivity: "Non-sensitive",
    metadata: {
      targetEmail: requestedEmail || session.email,
    },
    request,
  });

  return NextResponse.json({
    email: requestedEmail || session.email,
    role: session.role,
  });
}
