import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { approveLifecycleRecordBackend } from "@/lib/hris-backend";
import {
  canActorEditModule,
  logApiAudit,
  mapBackendError,
  parseJsonBody,
} from "@/lib/hris-api";

async function getRecordId(paramsPromise) {
  const params = await paramsPromise;
  return typeof params?.recordId === "string" ? params.recordId : "";
}

export async function POST(request, { params }) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["lifecycle:view"],
    auditModule: "Employment Lifecycle",
    auditAction: "Lifecycle approval request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);
  const canApprove = canActorEditModule({
    role: session.role,
    editPermission: "lifecycle:approve",
    isSelfResource: false,
  });

  if (!canApprove) {
    await logApiAudit({
      request,
      module: "Employment Lifecycle",
      activityName: "Lifecycle approval blocked by permission policy",
      status: "Rejected",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        role: session.role,
      },
    });
    return NextResponse.json({ message: "Forbidden." }, { status: 403 });
  }

  try {
    const body = await parseJsonBody(request);
    const result = await approveLifecycleRecordBackend(
      recordId,
      {
        decision: body?.decision,
        note: body?.note,
      },
      session.email,
      session.role,
    );
    const updated = result?.record || result;
    const effects = Array.isArray(result?.effects) ? result.effects : [];
    if (!updated) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    await logApiAudit({
      request,
      module: "Employment Lifecycle",
      activityName: "Lifecycle workflow approval processed",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        employeeEmail: updated.employeeEmail || null,
        status: updated.status || null,
        decision: String(body?.decision || "").trim() || null,
        effects,
      },
    });

    return NextResponse.json({ ok: true, record: updated, effects });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to process lifecycle approval.");

    await logApiAudit({
      request,
      module: "Employment Lifecycle",
      activityName: "Lifecycle workflow approval failed",
      status: "Failed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        reason,
      },
    });

    return NextResponse.json({ message: mapped.message }, { status: mapped.status });
  }
}
