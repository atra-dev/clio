import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import {
  createExportRequestBackend,
  listExportRequestsBackend,
} from "@/lib/hris-backend";
import { hasPermission } from "@/lib/rbac";
import {
  getSelfRestrictedOwnerEmail,
  logApiAudit,
  mapBackendError,
  normalizeEmail,
  paginateRows,
  parseJsonBody,
} from "@/lib/hris-api";

const MASS_EXPORT_THRESHOLD = 500;

function parseVolume(value) {
  const normalized = String(value || "").trim();
  const numeric = Number.parseInt(normalized.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function canReadExports(role) {
  return hasPermission(role, "exports:view") || hasPermission(role, "exports:request:self");
}

function canRequestExports(role) {
  return (
    hasPermission(role, "exports:request") ||
    hasPermission(role, "exports:manage") ||
    hasPermission(role, "exports:request:self")
  );
}

export async function GET(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["resource:own"],
    auditModule: "Export Control",
    auditAction: "Export requests list request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  if (!canReadExports(session.role)) {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 });
  }

  try {
    const requestedOwnerEmail = request.nextUrl?.searchParams.get("ownerEmail");
    const statusFilter = String(request.nextUrl?.searchParams.get("status") || "")
      .trim()
      .toLowerCase();
    const datasetFilter = String(request.nextUrl?.searchParams.get("dataset") || "")
      .trim()
      .toLowerCase();
    const page = request.nextUrl?.searchParams.get("page");
    const pageSize = request.nextUrl?.searchParams.get("pageSize");

    const ownerEmail = getSelfRestrictedOwnerEmail({
      session,
      requestedOwnerEmail,
      fallbackOwnerEmail: hasPermission(session.role, "exports:view") ? "" : session.email,
    });

    const rows = await listExportRequestsBackend({
      ownerEmail: ownerEmail || undefined,
    });
    const filtered = rows.filter((row) => {
      const byStatus = statusFilter ? String(row.status || "").trim().toLowerCase().includes(statusFilter) : true;
      const byDataset = datasetFilter
        ? String(row.dataset || "").trim().toLowerCase().includes(datasetFilter)
        : true;
      return byStatus && byDataset;
    });

    const { data, pagination } = paginateRows(filtered, { page, pageSize });

    await logApiAudit({
      request,
      module: "Export Control",
      activityName: "Export requests listed",
      status: "Completed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        resultCount: data.length,
        totalMatched: filtered.length,
        ownerFilterApplied: Boolean(ownerEmail),
      },
    });

    return NextResponse.json({ records: data, pagination });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to load export requests.");

    await logApiAudit({
      request,
      module: "Export Control",
      activityName: "Export requests list failed",
      status: "Failed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: { reason },
    });

    return NextResponse.json({ message: mapped.message }, { status: mapped.status });
  }
}

export async function POST(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["resource:own"],
    auditModule: "Export Control",
    auditAction: "Export request create",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  if (!canRequestExports(session.role)) {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 });
  }

  try {
    const body = await parseJsonBody(request);
    const actorEmail = normalizeEmail(session.email);
    const requestedBy = normalizeEmail(body.requestedBy || actorEmail);
    const selfOnly = hasPermission(session.role, "exports:request:self") && !hasPermission(session.role, "exports:view");
    if (selfOnly && requestedBy !== actorEmail) {
      return NextResponse.json({ message: "Employees can request exports for own data only." }, { status: 403 });
    }

    const estimateVolume = String(body.estimateVolume || "").trim();
    const volumeCount = parseVolume(estimateVolume);
    const alert = volumeCount >= MASS_EXPORT_THRESHOLD ? "mass_export_threshold" : "";
    const status = hasPermission(session.role, "exports:manage") ? "Approved" : "Pending";
    const created = await createExportRequestBackend(
      {
        ...body,
        requestedBy,
        status,
        alert,
      },
      session.email,
    );

    await logApiAudit({
      request,
      module: "Export Control",
      activityName: "Export request submitted",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId: created.id,
        dataset: created.dataset,
        requestedBy: created.requestedBy,
        status: created.status,
        alert: created.alert || null,
      },
    });

    return NextResponse.json({ ok: true, record: created }, { status: 201 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to create export request.");

    await logApiAudit({
      request,
      module: "Export Control",
      activityName: "Export request create failed",
      status: "Failed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: { reason },
    });

    return NextResponse.json({ message: mapped.message }, { status: mapped.status });
  }
}

