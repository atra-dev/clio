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
  resolveAuditRecordRef,
  summarizeAuditFieldList,
} from "@/lib/hris-api";

function summarizeLifecycleEvidence(record) {
  const evidenceItems = Array.isArray(record?.evidence) ? record.evidence : [];
  return evidenceItems
    .map((entry, index) => {
      const source = entry && typeof entry === "object" ? entry : {};
      const name = String(source.name || source.fileName || "").trim();
      const type = String(source.type || "Lifecycle Evidence").trim();
      const id = String(source.id || source.recordId || source.storagePath || `${index + 1}`).trim();
      if (!name && !id) {
        return null;
      }
      return {
        id,
        name: name || "Lifecycle Evidence",
        type: type || "Lifecycle Evidence",
      };
    })
    .filter(Boolean)
    .slice(0, 20);
}

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
        viewedRecordRefs: records.slice(0, 25).map((row) => ({
          recordId: row.id,
          recordRef: resolveAuditRecordRef(row, row.id, ["workflowId", "employeeId", "id"]),
          employeeEmail: row.employeeEmail || "",
          category: row.category || "",
          status: row.status || "",
        })),
        auditNote: `Listed ${records.length} lifecycle workflow record(s) in the current query window.`,
        nextAction: "No further action required.",
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
    const accessedDocuments = summarizeLifecycleEvidence(created);
    const payloadFields = Object.keys(nextPayload || {});

    await logApiAudit({
      request,
      module: "Employment Lifecycle",
      activityName: "Lifecycle record created",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId: created.id,
        recordRef: resolveAuditRecordRef(created, created.id, ["workflowId", "employeeId", "id"]),
        employeeEmail: created.employeeEmail || null,
        category: created.category,
        status: created.status,
        resourceType: "Lifecycle Workflow",
        resourceLabel: `${created.category || "Lifecycle"} - ${created.employeeEmail || "Employee"}`,
        changedFields: payloadFields,
        changedFieldCount: payloadFields.length,
        accessedDocuments,
        accessedDocumentCount: accessedDocuments.length,
        effects,
        auditNote: `Created lifecycle workflow with fields: ${summarizeAuditFieldList(
          payloadFields,
          "No explicit payload fields captured.",
        )}.`,
        nextAction: "No further action required.",
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
