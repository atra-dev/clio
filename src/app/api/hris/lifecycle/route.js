import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import {
  createLifecycleRecordBackend,
  listLifecycleRecordsBackend,
} from "@/lib/hris-backend";
import {
  canActorEditModule,
  logApiAudit,
  mapBackendError,
  normalizeEmail,
  parseJsonBody,
} from "@/lib/hris-api";

export async function GET(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["lifecycle:view"],
    auditModule: "Employment Lifecycle",
    auditAction: "Lifecycle records list request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  try {
    const rows = await listLifecycleRecordsBackend();
    const queryEmployeeEmail = normalizeEmail(request.nextUrl?.searchParams.get("employeeEmail"));
    const queryCategory = String(request.nextUrl?.searchParams.get("category") || "")
      .trim()
      .toLowerCase();
    const queryStatus = String(request.nextUrl?.searchParams.get("status") || "")
      .trim()
      .toLowerCase();

    const records = rows.filter((row) => {
      const byEmployee = queryEmployeeEmail ? normalizeEmail(row.employeeEmail) === queryEmployeeEmail : true;
      const byCategory = queryCategory ? String(row.category || "").trim().toLowerCase().includes(queryCategory) : true;
      const byStatus = queryStatus ? String(row.status || "").trim().toLowerCase().includes(queryStatus) : true;
      return byEmployee && byCategory && byStatus;
    });

    await logApiAudit({
      request,
      module: "Employment Lifecycle",
      activityName: "Lifecycle records listed",
      status: "Completed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        resultCount: records.length,
        hasEmployeeFilter: Boolean(queryEmployeeEmail),
        hasCategoryFilter: Boolean(queryCategory),
        hasStatusFilter: Boolean(queryStatus),
      },
    });

    return NextResponse.json({ records });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to load lifecycle records.");

    await logApiAudit({
      request,
      module: "Employment Lifecycle",
      activityName: "Lifecycle records list failed",
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
    requiredPermissions: ["lifecycle:view"],
    auditModule: "Employment Lifecycle",
    auditAction: "Lifecycle record create request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const canCreate = canActorEditModule({
    role: session.role,
    editPermission: "lifecycle:edit",
    isSelfResource: false,
  });

  if (!canCreate) {
    await logApiAudit({
      request,
      module: "Employment Lifecycle",
      activityName: "Lifecycle record create blocked by permission policy",
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
    const nextPayload = {
      ...body,
    };
    delete nextPayload.workflow;
    delete nextPayload.workflowAction;
    delete nextPayload.evidence;

    const result = await createLifecycleRecordBackend(nextPayload, session.email, session.role);
    const created = result?.record || result;
    const effects = Array.isArray(result?.effects) ? result.effects : [];

    await logApiAudit({
      request,
      module: "Employment Lifecycle",
      activityName: "Lifecycle record created",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId: created.id,
        employeeEmail: created.employeeEmail || null,
        category: created.category,
        status: created.status,
        effects,
      },
    });

    return NextResponse.json({ ok: true, record: created, effects }, { status: 201 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to create lifecycle record.");

    await logApiAudit({
      request,
      module: "Employment Lifecycle",
      activityName: "Lifecycle record create failed",
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
