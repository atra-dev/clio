import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import {
  collectEmailsFromTrail,
  createActorDirectory,
  enrichTrailActors,
  resolveActor,
} from "@/lib/actor-directory";
import {
  createLeaveRequestBackend,
  listLeaveRequestsBackend,
} from "@/lib/hris-backend";
import {
  canActorEditModule,
  getSelfRestrictedOwnerEmail,
  logApiAudit,
  mapBackendError,
  normalizeEmail,
  parseJsonBody,
} from "@/lib/hris-api";

const SELF_EDITABLE_LEAVE_FIELDS = new Set([
  "leaveType",
  "startDate",
  "endDate",
  "reason",
  "employee",
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

export async function GET(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["attendance:view"],
    auditModule: "Attendance Management",
    auditAction: "Leave requests list request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  try {
    const requestedOwnerEmail = request.nextUrl?.searchParams.get("employeeEmail");
    const ownerEmail = getSelfRestrictedOwnerEmail({
      session,
      requestedOwnerEmail,
    });
    const statusFilter = String(request.nextUrl?.searchParams.get("status") || "")
      .trim()
      .toLowerCase();

    const rows = await listLeaveRequestsBackend({
      ownerEmail: ownerEmail || undefined,
    });
    const records = rows.filter((row) => {
      if (!statusFilter) {
        return true;
      }
      return String(row.status || "").trim().toLowerCase().includes(statusFilter);
    });
    const actorValues = [];
    records.forEach((row) => {
      actorValues.push(row.approver, row.createdBy, row.updatedBy);
      actorValues.push(...collectEmailsFromTrail(row.modificationTrail, "by"));
    });
    const actorDirectory = await createActorDirectory(actorValues);
    const enrichedRecords = records.map((row) => {
      const approverActor = resolveActor(actorDirectory, row.approver);
      const createdActor = resolveActor(actorDirectory, row.createdBy);
      const updatedActor = resolveActor(actorDirectory, row.updatedBy);

      return {
        ...row,
        approverName: approverActor.name,
        approverEmail: approverActor.email || String(row.approver || ""),
        approverAvatar: approverActor.avatarUrl,
        createdByName: createdActor.name,
        createdByEmail: createdActor.email || String(row.createdBy || ""),
        createdByAvatar: createdActor.avatarUrl,
        updatedByName: updatedActor.name,
        updatedByEmail: updatedActor.email || String(row.updatedBy || ""),
        updatedByAvatar: updatedActor.avatarUrl,
        modificationTrail: enrichTrailActors(row.modificationTrail, actorDirectory, { actorKey: "by" }),
      };
    });

    await logApiAudit({
      request,
      module: "Attendance Management",
      activityName: "Leave requests listed",
      status: "Completed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        resultCount: enrichedRecords.length,
        ownerFilterApplied: Boolean(ownerEmail),
        hasStatusFilter: Boolean(statusFilter),
      },
    });

    return NextResponse.json({ records: enrichedRecords });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to load leave requests.");

    await logApiAudit({
      request,
      module: "Attendance Management",
      activityName: "Leave requests list failed",
      status: "Failed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        reason,
      },
    });

    return NextResponse.json({ message: mapped.message }, { status: mapped.status });
  }
}

export async function POST(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["attendance:view"],
    auditModule: "Attendance Management",
    auditAction: "Leave request create request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  try {
    const body = await parseJsonBody(request);
    const targetEmployeeEmail = normalizeEmail(body.employeeEmail || session.email);
    const actorEmail = normalizeEmail(session.email);
    const isSelfResource = targetEmployeeEmail === actorEmail;
    const canCreate = canActorEditModule({
      role: session.role,
      editPermission: "attendance:edit",
      selfEditPermission: "requests:create:self",
      isSelfResource,
    });

    if (!canCreate) {
      await logApiAudit({
        request,
        module: "Attendance Management",
        activityName: "Leave request create blocked by permission policy",
        status: "Rejected",
        sensitivity: "Sensitive",
        performedBy: session.email,
        metadata: {
          role: session.role,
          targetEmployeeEmail: targetEmployeeEmail || null,
        },
      });
      return NextResponse.json({ message: "Forbidden." }, { status: 403 });
    }

    const fullEdit = canActorEditModule({
      role: session.role,
      editPermission: "attendance:edit",
      isSelfResource: false,
    });
    const nextPayload = fullEdit ? body : sanitizeSelfLeavePayload(body);
    if (!fullEdit && Object.keys(nextPayload).length === 0) {
      return NextResponse.json({ message: "No allowed leave request fields to update." }, { status: 400 });
    }

    nextPayload.employeeEmail = fullEdit ? targetEmployeeEmail : actorEmail;
    if (!nextPayload.employee && !fullEdit) {
      nextPayload.employee = session.email;
    }
    if (!nextPayload.status) {
      nextPayload.status = "Pending";
    }

    const created = await createLeaveRequestBackend(nextPayload, session.email);

    await logApiAudit({
      request,
      module: "Attendance Management",
      activityName: "Leave request created",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId: created.id,
        employeeEmail: created.employeeEmail,
        leaveType: created.leaveType,
        status: created.status,
        selfService: !fullEdit,
      },
    });

    return NextResponse.json({ ok: true, record: created }, { status: 201 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to create leave request.");

    await logApiAudit({
      request,
      module: "Attendance Management",
      activityName: "Leave request create failed",
      status: "Failed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        reason,
      },
    });

    return NextResponse.json({ message: mapped.message }, { status: mapped.status });
  }
}
