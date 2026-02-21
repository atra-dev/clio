import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import {
  collectTemplateActorValues,
  createActorDirectory,
  enrichTemplateRecordActors,
} from "@/lib/actor-directory";
import {
  deleteDocumentTemplateBackend,
  getDocumentTemplateBackend,
  updateDocumentTemplateBackend,
} from "@/lib/hris-backend";
import {
  canActorEditModule,
  isEmployeeRole,
  logApiAudit,
  mapBackendError,
  parseJsonBody,
} from "@/lib/hris-api";

async function getRecordId(paramsPromise) {
  const params = await paramsPromise;
  return typeof params?.recordId === "string" ? params.recordId : "";
}

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

export async function GET(request, { params }) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["templates:view"],
    auditModule: "Template Repository",
    auditAction: "Template view request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);

  try {
    const record = await getDocumentTemplateBackend(recordId);
    if (!record) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    const employeeRole = isEmployeeRole(session.role);
    if (employeeRole && String(record.status || "").trim().toLowerCase() !== "active") {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    let responseRecord = employeeRole ? sanitizeTemplateForEmployee(record) : record;
    if (!employeeRole) {
      const actorDirectory = await createActorDirectory(collectTemplateActorValues(responseRecord));
      responseRecord = enrichTemplateRecordActors(responseRecord, actorDirectory);
    }

    await logApiAudit({
      request,
      module: "Template Repository",
      activityName: "Template viewed",
      status: "Completed",
      sensitivity: employeeRole ? "Non-sensitive" : "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        templateName: record.templateName || null,
        employeeScope: employeeRole,
      },
    });

    return NextResponse.json({ record: responseRecord });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to load template.");

    await logApiAudit({
      request,
      module: "Template Repository",
      activityName: "Template view failed",
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
    requiredPermissions: ["templates:view"],
    auditModule: "Template Repository",
    auditAction: "Template update request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);
  const canEdit = canActorEditModule({
    role: session.role,
    editPermission: "templates:edit",
    isSelfResource: false,
  });

  if (!canEdit) {
    await logApiAudit({
      request,
      module: "Template Repository",
      activityName: "Template update blocked by permission policy",
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
    const body = await parseJsonBody(request);
    const updated = await updateDocumentTemplateBackend(recordId, body, session.email);
    if (!updated) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    await logApiAudit({
      request,
      module: "Template Repository",
      activityName: "Template updated",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        templateName: updated.templateName || null,
        version: updated.version || null,
        updatedFields: Object.keys(body || {}),
      },
    });

    const actorDirectory = await createActorDirectory(collectTemplateActorValues(updated));
    return NextResponse.json({ ok: true, record: enrichTemplateRecordActors(updated, actorDirectory) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to update template.");

    await logApiAudit({
      request,
      module: "Template Repository",
      activityName: "Template update failed",
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
    requiredPermissions: ["templates:view"],
    auditModule: "Template Repository",
    auditAction: "Template archive request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);
  const canArchive = canActorEditModule({
    role: session.role,
    editPermission: "templates:edit",
    isSelfResource: false,
  });

  if (!canArchive) {
    await logApiAudit({
      request,
      module: "Template Repository",
      activityName: "Template archive blocked by permission policy",
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
    const archived = await deleteDocumentTemplateBackend(recordId, session.email);
    if (!archived) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    await logApiAudit({
      request,
      module: "Template Repository",
      activityName: "Template archived",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        templateName: archived.templateName || null,
        status: archived.status || null,
      },
    });

    const actorDirectory = await createActorDirectory(collectTemplateActorValues(archived));
    return NextResponse.json({ ok: true, record: enrichTemplateRecordActors(archived, actorDirectory) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to archive template.");

    await logApiAudit({
      request,
      module: "Template Repository",
      activityName: "Template archive failed",
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
