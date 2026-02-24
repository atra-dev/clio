import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import {
  approveExportRequestBackend,
  getExportRequestBackend,
} from "@/lib/hris-backend";
import { hasPermission } from "@/lib/rbac";
import { logApiAudit, mapBackendError, parseJsonBody } from "@/lib/hris-api";

async function getRecordId(paramsPromise) {
  const params = await paramsPromise;
  return typeof params?.recordId === "string" ? params.recordId : "";
}

export async function POST(request, { params }) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["resource:own"],
    auditModule: "Export Control",
    auditAction: "Export approval request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  if (!hasPermission(session.role, "exports:approve") && !hasPermission(session.role, "exports:manage")) {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 });
  }

  const recordId = await getRecordId(params);

  try {
    const current = await getExportRequestBackend(recordId);
    if (!current) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    const body = await parseJsonBody(request);
    const approved = Boolean(body.approved);
    const note = typeof body.note === "string" ? body.note : "";
    const updated = await approveExportRequestBackend(recordId, session.email, { approved, note });
    if (!updated) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    await logApiAudit({
      request,
      module: "Export Control",
      activityName: approved ? "Export request approved" : "Export request rejected",
      status: approved ? "Approved" : "Rejected",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        requestedBy: updated.requestedBy || null,
        reviewerNote: note || null,
      },
    });

    return NextResponse.json({ ok: true, record: updated });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to process approval.");
    return NextResponse.json({ message: mapped.message }, { status: mapped.status });
  }
}
