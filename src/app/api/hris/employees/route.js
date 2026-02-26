import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import {
  collectEmployeeActorValues,
  createActorDirectory,
  enrichEmployeeRecordActors,
} from "@/lib/actor-directory";
import {
  createEmployeeRecordBackend,
  listEmployeeRecordsBackend,
} from "@/lib/hris-backend";
import {
  canActorEditModule,
  getSelfRestrictedOwnerEmail,
  isEmployeeRole,
  logApiAudit,
  mapBackendError,
  paginateRows,
  parseJsonBody,
  sanitizeEmployeeRecordForViewer,
} from "@/lib/hris-api";

function asString(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function parseBooleanQuery(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function sanitizeSelfCreatePayload(body, sessionEmail) {
  return {
    email: normalizeEmail(sessionEmail),
    role: "EMPLOYEE_L1",
    status: "Active",
    employmentStatus: "Active Employee",
    firstName: asString(body?.firstName),
    middleName: asString(body?.middleName),
    lastName: asString(body?.lastName),
    suffix: asString(body?.suffix),
    contact: asString(body?.contact),
    address: asString(body?.address),
    emergencyContact: asString(body?.emergencyContact),
  };
}

export async function GET(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["employees:view"],
    auditModule: "Employee Records",
    auditAction: "Employee records list request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  try {
    const requestedOwnerEmail = request.nextUrl?.searchParams.get("ownerEmail");
    const queryText = String(request.nextUrl?.searchParams.get("q") || "")
      .trim()
      .toLowerCase();
    const statusFilter = String(request.nextUrl?.searchParams.get("status") || "")
      .trim()
      .toLowerCase();
    const roleFilter = String(request.nextUrl?.searchParams.get("role") || "")
      .trim()
      .toLowerCase();
    const includeDocuments = parseBooleanQuery(request.nextUrl?.searchParams.get("includeDocuments"));
    const page = request.nextUrl?.searchParams.get("page");
    const pageSize = request.nextUrl?.searchParams.get("pageSize");
    const ownerEmail = getSelfRestrictedOwnerEmail({
      session,
      requestedOwnerEmail,
    });

    const rows = await listEmployeeRecordsBackend({
      ownerEmail: ownerEmail || undefined,
      includeDocuments,
    });
    const scopedRows = isEmployeeRole(session.role)
      ? rows.filter((record) => normalizeEmail(record.email) === normalizeEmail(session.email))
      : rows;
    const filtered = scopedRows.filter((record) => {
      const byStatus = statusFilter
        ? String(record.status || "").trim().toLowerCase().includes(statusFilter)
        : true;
      const byRole = roleFilter
        ? String(record.role || "").trim().toLowerCase().includes(roleFilter)
        : true;
      const byQuery = queryText
        ? [
            record.employeeId,
            record.name,
            record.email,
            record.role,
            record.employmentStatus,
          ]
            .map((value) => String(value || "").trim().toLowerCase())
            .join(" ")
            .includes(queryText)
        : true;
      return byStatus && byRole && byQuery;
    });
    const { data, pagination } = paginateRows(filtered, { page, pageSize });
    const sanitizedRecords = data.map((record) => sanitizeEmployeeRecordForViewer(record, session.role));
    const actorValues = sanitizedRecords.flatMap((record) => collectEmployeeActorValues(record));
    const actorDirectory = await createActorDirectory(actorValues);
    const records = sanitizedRecords.map((record) => enrichEmployeeRecordActors(record, actorDirectory));

    await logApiAudit({
      request,
      module: "Employee Records",
      activityName: "Employee records listed",
      status: "Completed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        resultCount: records.length,
        totalMatched: filtered.length,
        scopedResultCount: scopedRows.length,
        ownerFilterApplied: Boolean(ownerEmail),
        hasSearchQuery: Boolean(queryText),
        hasStatusFilter: Boolean(statusFilter),
        viewedRecordRefs: records.slice(0, 25).map((record) => ({
          recordId: record.id,
          employeeId: record.employeeId || "",
          employeeEmail: record.email || "",
        })),
        auditNote: `Listed ${records.length} employee record(s) in current page window.`,
        nextAction: "No further action required.",
      },
    });

    return NextResponse.json({ records, pagination });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to load employee records.");

    await logApiAudit({
      request,
      module: "Employee Records",
      activityName: "Employee records list failed",
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
    requiredPermissions: ["employees:view"],
    auditModule: "Employee Records",
    auditAction: "Employee record create request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const canCreate = canActorEditModule({
    role: session.role,
    editPermission: "employees:edit",
    selfEditPermission: "employees:edit:self",
    isSelfResource: true,
  });
  const hasFullCreate = canActorEditModule({
    role: session.role,
    editPermission: "employees:edit",
    isSelfResource: false,
  });

  if (!canCreate) {
    await logApiAudit({
      request,
      module: "Employee Records",
      activityName: "Employee record create blocked by permission policy",
      status: "Rejected",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        role: session.role,
      },
    });
    return NextResponse.json({ message: "Forbidden." }, { status: 403 });
  }

  try {
    const body = await parseJsonBody(request);
    let payload = body;
    if (!hasFullCreate) {
      payload = sanitizeSelfCreatePayload(body, session.email);
      if (!payload.firstName || !payload.lastName) {
        return NextResponse.json({ message: "First name and last name are required." }, { status: 400 });
      }

      const existingSelfRecords = await listEmployeeRecordsBackend({
        ownerEmail: session.email,
      });
      if (existingSelfRecords.length > 0) {
        return NextResponse.json({ message: "Your employee record already exists." }, { status: 409 });
      }
    }

    const created = await createEmployeeRecordBackend(payload, session.email);

    await logApiAudit({
      request,
      module: "Employee Records",
      activityName: "Employee record created",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId: created.id,
        employeeEmail: created.email,
        classification: created.classification || "Restricted PII",
        selfServiceCreate: !hasFullCreate,
      },
    });

    return NextResponse.json({ ok: true, record: sanitizeEmployeeRecordForViewer(created, session.role) }, { status: 201 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to create employee record.");

    await logApiAudit({
      request,
      module: "Employee Records",
      activityName: "Employee record create failed",
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
