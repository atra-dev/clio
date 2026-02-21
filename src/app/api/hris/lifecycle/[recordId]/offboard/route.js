import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { forceOffboardLifecycleRecordBackend } from "@/lib/hris-backend";
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
    auditAction: "Lifecycle offboarding request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);
  const canOffboard = canActorEditModule({
    role: session.role,
    editPermission: "lifecycle:edit",
    isSelfResource: false,
  });

  if (!canOffboard) {
    await logApiAudit({
      request,
      module: "Employment Lifecycle",
      activityName: "Lifecycle offboarding blocked by permission policy",
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
    const reason = typeof body.reason === "string" ? body.reason : "";
    const result = await forceOffboardLifecycleRecordBackend(recordId, session.email, reason);
    const updated = result?.record || result;
    const effects = Array.isArray(result?.effects) ? result.effects : [];
    if (!updated) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    await logApiAudit({
      request,
      module: "Employment Lifecycle",
      activityName: "Immediate offboarding completed",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        employeeEmail: updated.employeeEmail || null,
        status: updated.status || null,
        reason: reason || null,
        effects,
      },
    });

    return NextResponse.json({ ok: true, record: updated, effects });
  } catch (error) {
    const rawReason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(rawReason, "Unable to complete offboarding action.");

    await logApiAudit({
      request,
      module: "Employment Lifecycle",
      activityName: "Immediate offboarding failed",
      status: "Failed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        reason: rawReason,
      },
    });

    return NextResponse.json({ message: mapped.message }, { status: mapped.status });
  }
}
