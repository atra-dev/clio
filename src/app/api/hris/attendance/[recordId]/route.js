import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import {
  getAttendanceLogBackend,
  updateAttendanceLogBackend,
} from "@/lib/hris-backend";
import {
  canActorAccessOwner,
  canActorEditModule,
  logApiAudit,
  mapBackendError,
  parseJsonBody,
} from "@/lib/hris-api";

const SELF_EDITABLE_ATTENDANCE_FIELDS = new Set([
  "date",
  "checkIn",
  "checkOut",
  "status",
  "reason",
  "employee",
]);

function sanitizeSelfAttendancePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  return Object.entries(payload).reduce((accumulator, [key, value]) => {
    if (SELF_EDITABLE_ATTENDANCE_FIELDS.has(key)) {
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
    auditAction: "Attendance record view request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);

  try {
    const record = await getAttendanceLogBackend(recordId);
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
        activityName: "Attendance record access blocked by ownership policy",
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
      activityName: "Attendance record viewed",
      status: "Completed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        employeeEmail: record.employeeEmail || null,
      },
    });

    return NextResponse.json({ record });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to load attendance record.");

    await logApiAudit({
      request,
      module: "Attendance Management",
      activityName: "Attendance record view failed",
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
    auditAction: "Attendance record update request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);

  try {
    const current = await getAttendanceLogBackend(recordId);
    if (!current) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    const isSelfResource = canActorAccessOwner({
      session,
      ownerEmail: current.employeeEmail,
    });
    const canEdit = canActorEditModule({
      role: session.role,
      editPermission: "attendance:edit",
      selfEditPermission: "attendance:edit:self",
      isSelfResource,
    });
    if (!canEdit) {
      await logApiAudit({
        request,
        module: "Attendance Management",
        activityName: "Attendance record update blocked by permission policy",
        status: "Rejected",
        sensitivity: "Sensitive",
        performedBy: session.email,
        metadata: {
          recordId,
          ownerEmail: current.employeeEmail || null,
          role: session.role,
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
    const nextPayload = fullEdit ? body : sanitizeSelfAttendancePayload(body);
    if (!fullEdit && Object.keys(nextPayload).length === 0) {
      return NextResponse.json({ message: "No allowed attendance fields to update." }, { status: 400 });
    }

    if (!fullEdit) {
      nextPayload.employeeEmail = current.employeeEmail;
      nextPayload.employee = current.employee;
    }

    const updated = await updateAttendanceLogBackend(recordId, nextPayload, session.email);
    if (!updated) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    await logApiAudit({
      request,
      module: "Attendance Management",
      activityName: "Attendance record updated",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        employeeEmail: updated.employeeEmail || null,
        updatedFields: Object.keys(nextPayload),
        selfServiceUpdate: !fullEdit,
      },
    });

    return NextResponse.json({ ok: true, record: updated });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to update attendance record.");

    await logApiAudit({
      request,
      module: "Attendance Management",
      activityName: "Attendance record update failed",
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
