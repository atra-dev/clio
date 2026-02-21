import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import {
  collectTemplateActorValues,
  createActorDirectory,
  enrichTemplateRecordActors,
} from "@/lib/actor-directory";
import {
  createDocumentTemplateBackend,
  listDocumentTemplatesBackend,
} from "@/lib/hris-backend";
import {
  canActorEditModule,
  isEmployeeRole,
  logApiAudit,
  mapBackendError,
  parseJsonBody,
} from "@/lib/hris-api";

function sanitizeTemplateForEmployee(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  return {
    id: record.id,
    templateName: record.templateName,
    category: record.category,
    classification: record.classification,
    version: record.version,
    status: record.status,
    contentRef: record.contentRef || "",
    updatedAt: record.updatedAt || null,
  };
}

export async function GET(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["templates:view"],
    auditModule: "Template Repository",
    auditAction: "Template records list request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  try {
    const statusFilter = String(request.nextUrl?.searchParams.get("status") || "")
      .trim()
      .toLowerCase();
    const categoryFilter = String(request.nextUrl?.searchParams.get("category") || "")
      .trim()
      .toLowerCase();

    const rows = await listDocumentTemplatesBackend();
    const filtered = rows.filter((row) => {
      const byStatus = statusFilter ? String(row.status || "").trim().toLowerCase().includes(statusFilter) : true;
      const byCategory = categoryFilter
        ? String(row.category || "").trim().toLowerCase().includes(categoryFilter)
        : true;
      return byStatus && byCategory;
    });

    const employeeRole = isEmployeeRole(session.role);
    let records = employeeRole
      ? filtered
          .filter((row) => String(row.status || "").trim().toLowerCase() === "active")
          .map(sanitizeTemplateForEmployee)
          .filter(Boolean)
      : filtered;

    if (!employeeRole) {
      const actorValues = records.flatMap((record) => collectTemplateActorValues(record));
      const actorDirectory = await createActorDirectory(actorValues);
      records = records.map((record) => enrichTemplateRecordActors(record, actorDirectory));
    }

    await logApiAudit({
      request,
      module: "Template Repository",
      activityName: "Template records listed",
      status: "Completed",
      sensitivity: employeeRole ? "Non-sensitive" : "Sensitive",
      performedBy: session.email,
      metadata: {
        resultCount: records.length,
        hasStatusFilter: Boolean(statusFilter),
        hasCategoryFilter: Boolean(categoryFilter),
        employeeScope: employeeRole,
      },
    });

    return NextResponse.json({ records });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to load templates.");

    await logApiAudit({
      request,
      module: "Template Repository",
      activityName: "Template records list failed",
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
    requiredPermissions: ["templates:view"],
    auditModule: "Template Repository",
    auditAction: "Template create request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const canCreate = canActorEditModule({
    role: session.role,
    editPermission: "templates:edit",
    isSelfResource: false,
  });

  if (!canCreate) {
    await logApiAudit({
      request,
      module: "Template Repository",
      activityName: "Template create blocked by permission policy",
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
    const created = await createDocumentTemplateBackend(body, session.email);

    await logApiAudit({
      request,
      module: "Template Repository",
      activityName: "Template created",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId: created.id,
        templateName: created.templateName || null,
        version: created.version || null,
      },
    });

    const actorDirectory = await createActorDirectory(collectTemplateActorValues(created));
    return NextResponse.json({ ok: true, record: enrichTemplateRecordActors(created, actorDirectory) }, { status: 201 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to create template.");

    await logApiAudit({
      request,
      module: "Template Repository",
      activityName: "Template create failed",
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
