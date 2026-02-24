import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { recordAuditEvent } from "@/lib/audit-log";
import { purgeArchivedEmployeeDataBackend } from "@/lib/hris-backend";

export async function POST(request) {
  const auth = await authorizeApiRequest(request, {
    allowedRoles: ["SUPER_ADMIN"],
    requiredPermissions: ["user_management:manage"],
    auditModule: "Retention",
    auditAction: "Retention purge request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  try {
    const body = await request.json().catch(() => ({}));
    const requestedCutoff = typeof body?.cutoff === "string" ? body.cutoff : "";
    const result = await purgeArchivedEmployeeDataBackend({
      now: requestedCutoff || undefined,
    });

    await recordAuditEvent({
      activityName: "Retention purge completed",
      status: "Approved",
      module: "Retention",
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: result,
      request,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";

    await recordAuditEvent({
      activityName: "Retention purge failed",
      status: "Failed",
      module: "Retention",
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        reason,
      },
      request,
    });

    return NextResponse.json({ message: "Unable to run retention purge." }, { status: 400 });
  }
}
