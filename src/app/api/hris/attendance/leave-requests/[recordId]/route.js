import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import {
  getLeaveRequestBackend,
  updateLeaveRequestBackend,
} from "@/lib/hris-backend";
import {
  canActorAccessOwner,
  canActorEditModule,
  logApiAudit,
  mapBackendError,
  parseJsonBody,
} from "@/lib/hris-api";

const SELF_EDITABLE_LEAVE_FIELDS = new Set([
  "leaveType",
  "startDate",
  "endDate",
  "reason",
]);

function sanitizeSelfLeavePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  return Object.entries(payload).reduce((accumulator, [key, value]) => {
    if (SELF_EDITABLE_LEAVE_FIELDS.has(key)) {
      accumulator[key] = value;
    }
    return accumulator;
  }, {});
}

async function getRecordId(paramsPromise) {
  const params = await paramsPromise;
  return typeof params?.recordId === "string" ? params.recordId : "";
}

export async function GET(request, { params }) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["attendance:view"],
    auditModule: "Attendance Management",
    auditAction: "Leave request view request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);

  try {
    const record = await getLeaveRequestBackend(recordId);
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
        module: "Attendance Management",
        activityName: "Leave request access blocked by ownership policy",
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
      module: "Attendance Management",
      activityName: "Leave request viewed",
      status: "Completed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        employeeEmail: record.employeeEmail || null,
        status: record.status || null,
      },
    });

    return NextResponse.json({ record });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to load leave request.");

    await logApiAudit({
      request,
      module: "Attendance Management",
      activityName: "Leave request view failed",
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
    requiredPermissions: ["attendance:view"],
    auditModule: "Attendance Management",
    auditAction: "Leave request update request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);

  try {
    const current = await getLeaveRequestBackend(recordId);
    if (!current) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    const isSelfResource = canActorAccessOwner({
      session,
      ownerEmail: current.employeeEmail,
    });
    const canUpdate = canActorEditModule({
      role: session.role,
      editPermission: "attendance:edit",
      selfEditPermission: "requests:create:self",
      isSelfResource,
    });
    if (!canUpdate) {
      await logApiAudit({
        request,
        module: "Attendance Management",
        activityName: "Leave request update blocked by permission policy",
        status: "Rejected",
        sensitivity: "Sensitive",
        performedBy: session.email,
        metadata: {
          recordId,
          role: session.role,
          ownerEmail: current.employeeEmail || null,
        },
      });
      return NextResponse.json({ message: "Forbidden." }, { status: 403 });
    }

    const body = await parseJsonBody(request);
    const fullEdit = canActorEditModule({
      role: session.role,
      editPermission: "attendance:edit",
      isSelfResource: false,
    });

    const nextPayload = fullEdit ? body : sanitizeSelfLeavePayload(body);
    if (!fullEdit && Object.keys(nextPayload).length === 0) {
      return NextResponse.json({ message: "No allowed leave request fields to update." }, { status: 400 });
    }

    if (!fullEdit) {
      nextPayload.employeeEmail = current.employeeEmail;
      nextPayload.employee = current.employee;
      nextPayload.status = current.status;
      nextPayload.approver = current.approver;
      nextPayload.approvalNote = current.approvalNote;
    }

    const updated = await updateLeaveRequestBackend(recordId, nextPayload, session.email);
    if (!updated) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    await logApiAudit({
      request,
      module: "Attendance Management",
      activityName: "Leave request updated",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        employeeEmail: updated.employeeEmail || null,
        status: updated.status || null,
        updatedFields: Object.keys(nextPayload),
        selfServiceUpdate: !fullEdit,
      },
    });

    return NextResponse.json({ ok: true, record: updated });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to update leave request.");

    await logApiAudit({
      request,
      module: "Attendance Management",
      activityName: "Leave request update failed",
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
