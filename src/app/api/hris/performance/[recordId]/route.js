import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import {
  getPerformanceRecordBackend,
  updatePerformanceRecordBackend,
} from "@/lib/hris-backend";
import {
  canActorAccessOwner,
  canActorEditModule,
  logApiAudit,
  mapBackendError,
  parseJsonBody,
  resolveAuditChangedFields,
  resolveAuditRecordRef,
  resolveAuditViewedFields,
  summarizeAuditFieldList,
} from "@/lib/hris-api";

async function getRecordId(paramsPromise) {
  const params = await paramsPromise;
  return typeof params?.recordId === "string" ? params.recordId : "";
}

export async function GET(request, { params }) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["performance:view"],
    auditModule: "Performance Management",
    auditAction: "Performance record view request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);

  try {
    const record = await getPerformanceRecordBackend(recordId);
    if (!record) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    const canAccess = canActorAccessOwner({
      session,
      ownerEmail: record.employeeEmail,
    });
    if (!canAccess) {
      await logApiAudit({
        request,
        module: "Performance Management",
        activityName: "Performance record access blocked by ownership policy",
        status: "Rejected",
        sensitivity: "Sensitive",
        performedBy: session.email,
        metadata: {
          recordId,
          ownerEmail: record.employeeEmail || null,
          role: session.role,
        },
      });
      return NextResponse.json({ message: "Forbidden." }, { status: 403 });
    }

    await logApiAudit({
      request,
      module: "Performance Management",
      activityName: "Performance record viewed",
      status: "Completed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        recordRef: resolveAuditRecordRef(record, recordId, ["employeeId", "id"]),
        employeeEmail: record.employeeEmail || null,
        resourceType: "Performance Record",
        resourceLabel: `${record.employee || record.employeeEmail || "Employee"} ${record.period ? `- ${record.period}` : ""}`.trim(),
        viewedFields: resolveAuditViewedFields(record, ["traceability"]),
        auditNote: `Viewed performance record for ${record.employeeEmail || "employee"}.`,
        nextAction: "No further action required.",
      },
    });

    return NextResponse.json({ record });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to load performance record.");

    await logApiAudit({
      request,
      module: "Performance Management",
      activityName: "Performance record view failed",
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
    requiredPermissions: ["performance:view"],
    auditModule: "Performance Management",
    auditAction: "Performance record update request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);
  const canEdit = canActorEditModule({
    role: session.role,
    editPermission: "performance:edit",
    isSelfResource: false,
  });

  if (!canEdit) {
    await logApiAudit({
      request,
      module: "Performance Management",
      activityName: "Performance record update blocked by permission policy",
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
    const updated = await updatePerformanceRecordBackend(recordId, body, session.email);
    if (!updated) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }
    const changedFields = resolveAuditChangedFields(record, updated, Object.keys(body || {}));

    await logApiAudit({
      request,
      module: "Performance Management",
      activityName: "Performance record updated",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        recordRef: resolveAuditRecordRef(updated, recordId, ["employeeId", "id"]),
        employeeEmail: updated.employeeEmail || null,
        updatedFields: Object.keys(body || {}),
        changedFields,
        changedFieldCount: changedFields.length,
        resourceType: "Performance Record",
        resourceLabel: `${updated.employee || updated.employeeEmail || "Employee"} ${updated.period ? `- ${updated.period}` : ""}`.trim(),
        auditNote:
          changedFields.length > 0
            ? `Updated performance fields: ${summarizeAuditFieldList(changedFields)}.`
            : "Update request completed but no performance field values changed.",
        nextAction: changedFields.length > 0 ? "No further action required." : "Review update payload and retry if needed.",
      },
    });

    return NextResponse.json({ ok: true, record: updated });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to update performance record.");

    await logApiAudit({
      request,
      module: "Performance Management",
      activityName: "Performance record update failed",
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
