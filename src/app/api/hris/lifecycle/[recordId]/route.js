import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import {
  getLifecycleRecordBackend,
  updateLifecycleRecordBackend,
} from "@/lib/hris-backend";
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

export async function GET(request, { params }) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["lifecycle:view"],
    auditModule: "Employment Lifecycle",
    auditAction: "Lifecycle record view request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);

  try {
    const record = await getLifecycleRecordBackend(recordId);
    if (!record) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    await logApiAudit({
      request,
      module: "Employment Lifecycle",
      activityName: "Lifecycle record viewed",
      status: "Completed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        employeeEmail: record.employeeEmail || null,
        category: record.category || null,
      },
    });

    return NextResponse.json({ record });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to load lifecycle record.");

    await logApiAudit({
      request,
      module: "Employment Lifecycle",
      activityName: "Lifecycle record view failed",
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

export async function PATCH(request, { params }) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["lifecycle:view"],
    auditModule: "Employment Lifecycle",
    auditAction: "Lifecycle record update request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);
  const canEdit = canActorEditModule({
    role: session.role,
    editPermission: "lifecycle:edit",
    isSelfResource: false,
  });

  if (!canEdit) {
    await logApiAudit({
      request,
      module: "Employment Lifecycle",
      activityName: "Lifecycle record update blocked by permission policy",
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
    const workflowPatch = body?.workflow && typeof body.workflow === "object" ? body.workflow : null;
    const workflowActionType = String(body?.workflowAction?.type || "")
      .trim()
      .toLowerCase();

    if (workflowPatch) {
      return NextResponse.json(
        { message: "Direct workflow patch is not allowed. Use workflow actions from the workflow console." },
        { status: 403 },
      );
    }

    if (workflowActionType === "approval-decision" || workflowActionType === "approve" || workflowActionType === "reject") {
      return NextResponse.json({ message: "Approval chain actions are disabled for lifecycle workflows." }, { status: 403 });
    }

    const result = await updateLifecycleRecordBackend(recordId, body, session.email, session.role);
    const updated = result?.record || result;
    const effects = Array.isArray(result?.effects) ? result.effects : [];
    if (!updated) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    await logApiAudit({
      request,
      module: "Employment Lifecycle",
      activityName: "Lifecycle record updated",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        employeeEmail: updated.employeeEmail || null,
        category: updated.category || null,
        status: updated.status || null,
        updatedFields: Object.keys(body || {}),
        effects,
      },
    });

    return NextResponse.json({ ok: true, record: updated, effects });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to update lifecycle record.");

    await logApiAudit({
      request,
      module: "Employment Lifecycle",
      activityName: "Lifecycle record update failed",
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
