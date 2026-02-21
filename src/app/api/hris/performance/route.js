import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import {
  createPerformanceRecordBackend,
  listPerformanceRecordsBackend,
} from "@/lib/hris-backend";
import {
  canActorEditModule,
  getSelfRestrictedOwnerEmail,
  logApiAudit,
  mapBackendError,
  parseJsonBody,
} from "@/lib/hris-api";

export async function GET(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["performance:view"],
    auditModule: "Performance Management",
    auditAction: "Performance records list request",
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
    const periodFilter = String(request.nextUrl?.searchParams.get("period") || "")
      .trim()
      .toLowerCase();
    const statusFilter = String(request.nextUrl?.searchParams.get("status") || "")
      .trim()
      .toLowerCase();

    const rows = await listPerformanceRecordsBackend({
      ownerEmail: ownerEmail || undefined,
    });
    const records = rows.filter((row) => {
      const byPeriod = periodFilter ? String(row.period || "").trim().toLowerCase().includes(periodFilter) : true;
      const byStatus = statusFilter ? String(row.status || "").trim().toLowerCase().includes(statusFilter) : true;
      return byPeriod && byStatus;
    });

    await logApiAudit({
      request,
      module: "Performance Management",
      activityName: "Performance records listed",
      status: "Completed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        resultCount: records.length,
        ownerFilterApplied: Boolean(ownerEmail),
        hasPeriodFilter: Boolean(periodFilter),
        hasStatusFilter: Boolean(statusFilter),
      },
    });

    return NextResponse.json({ records });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to load performance records.");

    await logApiAudit({
      request,
      module: "Performance Management",
      activityName: "Performance records list failed",
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
    requiredPermissions: ["performance:view"],
    auditModule: "Performance Management",
    auditAction: "Performance record create request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const canCreate = canActorEditModule({
    role: session.role,
    editPermission: "performance:edit",
    isSelfResource: false,
  });

  if (!canCreate) {
    await logApiAudit({
      request,
      module: "Performance Management",
      activityName: "Performance record create blocked by permission policy",
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
    const created = await createPerformanceRecordBackend(body, session.email);

    await logApiAudit({
      request,
      module: "Performance Management",
      activityName: "Performance record created",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId: created.id,
        employeeEmail: created.employeeEmail || null,
        period: created.period || null,
        status: created.status || null,
      },
    });

    return NextResponse.json({ ok: true, record: created }, { status: 201 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to create performance record.");

    await logApiAudit({
      request,
      module: "Performance Management",
      activityName: "Performance record create failed",
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

