import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import {
  collectEmailsFromTrail,
  createActorDirectory,
  enrichTrailActors,
  resolveActor,
} from "@/lib/actor-directory";
import {
  createAttendanceLogBackend,
  listAttendanceLogsBackend,
} from "@/lib/hris-backend";
import {
  canActorEditModule,
  getSelfRestrictedOwnerEmail,
  logApiAudit,
  mapBackendError,
  normalizeEmail,
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

function asDate(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["attendance:view"],
    auditModule: "Attendance Management",
    auditAction: "Attendance records list request",
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
    const dateFromFilter = asDate(request.nextUrl?.searchParams.get("dateFrom"));
    const dateToFilter = asDate(request.nextUrl?.searchParams.get("dateTo"));

    const rows = await listAttendanceLogsBackend({
      ownerEmail: ownerEmail || undefined,
    });

    const records = rows.filter((row) => {
      const rowStatus = String(row.status || "").trim().toLowerCase();
      const rowDate = asDate(row.date || row.createdAt);
      const byStatus = statusFilter ? rowStatus.includes(statusFilter) : true;
      const byDateFrom = dateFromFilter ? rowDate && rowDate.getTime() >= dateFromFilter.getTime() : true;
      const byDateTo = dateToFilter ? rowDate && rowDate.getTime() <= dateToFilter.getTime() : true;
      return byStatus && byDateFrom && byDateTo;
    });
    const actorValues = [];
    records.forEach((row) => {
      actorValues.push(row.createdBy, row.updatedBy, row.approver);
      actorValues.push(...collectEmailsFromTrail(row.modificationTrail, "by"));
    });
    const actorDirectory = await createActorDirectory(actorValues);
    const enrichedRecords = records.map((row) => {
      const createdActor = resolveActor(actorDirectory, row.createdBy);
      const updatedActor = resolveActor(actorDirectory, row.updatedBy);
      const approverActor = resolveActor(actorDirectory, row.approver);

      return {
        ...row,
        createdByName: createdActor.name,
        createdByEmail: createdActor.email || String(row.createdBy || ""),
        createdByAvatar: createdActor.avatarUrl,
        updatedByName: updatedActor.name,
        updatedByEmail: updatedActor.email || String(row.updatedBy || ""),
        updatedByAvatar: updatedActor.avatarUrl,
        approverName: approverActor.name,
        approverEmail: approverActor.email || String(row.approver || ""),
        approverAvatar: approverActor.avatarUrl,
        modificationTrail: enrichTrailActors(row.modificationTrail, actorDirectory, { actorKey: "by" }),
      };
    });

    await logApiAudit({
      request,
      module: "Attendance Management",
      activityName: "Attendance records listed",
      status: "Completed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        resultCount: enrichedRecords.length,
        ownerFilterApplied: Boolean(ownerEmail),
        hasStatusFilter: Boolean(statusFilter),
        hasDateRangeFilter: Boolean(dateFromFilter || dateToFilter),
      },
    });

    return NextResponse.json({ records: enrichedRecords });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to load attendance records.");

    await logApiAudit({
      request,
      module: "Attendance Management",
      activityName: "Attendance records list failed",
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
    auditAction: "Attendance log create request",
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
      selfEditPermission: "attendance:edit:self",
      isSelfResource,
    });

    if (!canCreate) {
      await logApiAudit({
        request,
        module: "Attendance Management",
        activityName: "Attendance log create blocked by permission policy",
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
    const nextPayload = fullEdit ? body : sanitizeSelfAttendancePayload(body);
    if (!fullEdit && Object.keys(nextPayload).length === 0) {
      return NextResponse.json({ message: "No allowed attendance fields to update." }, { status: 400 });
    }

    nextPayload.employeeEmail = fullEdit ? targetEmployeeEmail : actorEmail;
    if (!nextPayload.employee && !fullEdit) {
      nextPayload.employee = session.email;
    }

    const created = await createAttendanceLogBackend(nextPayload, session.email);

    await logApiAudit({
      request,
      module: "Attendance Management",
      activityName: "Attendance log created",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId: created.id,
        employeeEmail: created.employeeEmail,
        selfService: !fullEdit,
      },
    });

    return NextResponse.json({ ok: true, record: created }, { status: 201 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to create attendance log.");

    await logApiAudit({
      request,
      module: "Attendance Management",
      activityName: "Attendance log create failed",
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
