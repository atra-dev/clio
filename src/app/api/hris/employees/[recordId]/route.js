import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import {
  collectEmployeeActorValues,
  createActorDirectory,
  enrichEmployeeRecordActors,
} from "@/lib/actor-directory";
import {
  deleteEmployeeRecordBackend,
  getEmployeeRecordBackend,
  updateEmployeeRecordBackend,
} from "@/lib/hris-backend";
import { hasPermission } from "@/lib/rbac";
import {
  canActorAccessOwner,
  canActorEditModule,
  logApiAudit,
  mapBackendError,
  parseJsonBody,
  sanitizeEmployeeRecordForViewer,
} from "@/lib/hris-api";

const SELF_EDITABLE_EMPLOYEE_FIELDS = new Set([
  "contact",
  "address",
  "mobileNumber",
  "phone",
]);

function sanitizeSelfEditPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  return Object.entries(payload).reduce((accumulator, [key, value]) => {
    if (SELF_EDITABLE_EMPLOYEE_FIELDS.has(key)) {
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
    requiredPermissions: ["employees:view"],
    auditModule: "Employee Records",
    auditAction: "Employee record view request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);

  try {
    const record = await getEmployeeRecordBackend(recordId);
    if (!record) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    const canAccess = canActorAccessOwner({
      session,
      ownerEmail: record.email,
    });
    if (!canAccess) {
      await logApiAudit({
        request,
        module: "Employee Records",
        activityName: "Employee record access blocked by ownership policy",
        status: "Rejected",
        sensitivity: "Sensitive",
        performedBy: session.email,
        metadata: {
          recordId,
          ownerEmail: record.email,
          role: session.role,
        },
      });
      return NextResponse.json({ message: "Forbidden." }, { status: 403 });
    }

    await logApiAudit({
      request,
      module: "Employee Records",
      activityName: "Employee record viewed",
      status: "Completed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        employeeEmail: record.email,
      },
    });

    const sanitizedRecord = sanitizeEmployeeRecordForViewer(record, session.role);
    const actorDirectory = await createActorDirectory(collectEmployeeActorValues(sanitizedRecord));
    return NextResponse.json({ record: enrichEmployeeRecordActors(sanitizedRecord, actorDirectory) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to load employee record.");

    await logApiAudit({
      request,
      module: "Employee Records",
      activityName: "Employee record view failed",
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
    requiredPermissions: ["employees:view"],
    auditModule: "Employee Records",
    auditAction: "Employee record update request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);

  try {
    const current = await getEmployeeRecordBackend(recordId);
    if (!current) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    const isSelfResource = canActorAccessOwner({
      session,
      ownerEmail: current.email,
    });

    const canEdit = canActorEditModule({
      role: session.role,
      editPermission: "employees:edit",
      selfEditPermission: "employees:edit:self",
      isSelfResource,
    });
    if (!canEdit) {
      await logApiAudit({
        request,
        module: "Employee Records",
        activityName: "Employee record update blocked by permission policy",
        status: "Rejected",
        sensitivity: "Sensitive",
        performedBy: session.email,
        metadata: {
          recordId,
          ownerEmail: current.email,
          role: session.role,
        },
      });
      return NextResponse.json({ message: "Forbidden." }, { status: 403 });
    }

    const body = await parseJsonBody(request);
    const hasFullEdit = hasPermission(session.role, "employees:edit");
    const nextPayload = hasFullEdit ? body : sanitizeSelfEditPayload(body);

    if (!hasFullEdit && Object.keys(nextPayload).length === 0) {
      return NextResponse.json(
        { message: "No allowed fields to update. Employees can only edit personal contact information." },
        { status: 400 },
      );
    }

    // Self-service updates cannot alter identity and role-scoped fields.
    if (!hasFullEdit) {
      nextPayload.email = current.email;
      nextPayload.employeeId = current.employeeId;
      nextPayload.name = current.name;
      nextPayload.status = current.status;
      nextPayload.employmentStatus = current.employmentStatus;
      nextPayload.govId = current.govId;
      nextPayload.governmentIds = current.governmentIds || {};
      nextPayload.payrollInformation = current.payrollInformation || {};
      nextPayload.payrollGroup = current.payrollGroup;
    }

    const updated = await updateEmployeeRecordBackend(recordId, nextPayload, session.email);
    if (!updated) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    await logApiAudit({
      request,
      module: "Employee Records",
      activityName: "Employee record updated",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        employeeEmail: updated.email,
        updatedFields: Object.keys(nextPayload),
        selfServiceUpdate: !hasFullEdit,
      },
    });

    const sanitizedRecord = sanitizeEmployeeRecordForViewer(updated, session.role);
    const actorDirectory = await createActorDirectory(collectEmployeeActorValues(sanitizedRecord));
    return NextResponse.json({ ok: true, record: enrichEmployeeRecordActors(sanitizedRecord, actorDirectory) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to update employee record.");

    await logApiAudit({
      request,
      module: "Employee Records",
      activityName: "Employee record update failed",
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

export async function DELETE(request, { params }) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["employees:view"],
    auditModule: "Employee Records",
    auditAction: "Employee record delete request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);

  const canDelete = canActorEditModule({
    role: session.role,
    editPermission: "employees:edit",
    isSelfResource: false,
  });
  if (!canDelete) {
    await logApiAudit({
      request,
      module: "Employee Records",
      activityName: "Employee record delete blocked by permission policy",
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
    const deleted = await deleteEmployeeRecordBackend(recordId);
    if (!deleted) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    await logApiAudit({
      request,
      module: "Employee Records",
      activityName: "Employee record deleted",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        employeeEmail: deleted.email,
      },
    });

    const sanitizedRecord = sanitizeEmployeeRecordForViewer(deleted, session.role);
    const actorDirectory = await createActorDirectory(collectEmployeeActorValues(sanitizedRecord));
    return NextResponse.json({ ok: true, record: enrichEmployeeRecordActors(sanitizedRecord, actorDirectory) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to delete employee record.");

    await logApiAudit({
      request,
      module: "Employee Records",
      activityName: "Employee record delete failed",
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
