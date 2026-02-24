import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import {
  getExportRequestBackend,
  updateExportRequestBackend,
} from "@/lib/hris-backend";
import { hasPermission } from "@/lib/rbac";
import {
  canActorAccessOwner,
  logApiAudit,
  mapBackendError,
  parseJsonBody,
} from "@/lib/hris-api";

async function getRecordId(paramsPromise) {
  const params = await paramsPromise;
  return typeof params?.recordId === "string" ? params.recordId : "";
}

function canManageExportUpdate(role) {
  return hasPermission(role, "exports:manage") || hasPermission(role, "exports:approve");
}

export async function GET(request, { params }) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["resource:own"],
    auditModule: "Export Control",
    auditAction: "Export request view",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);

  try {
    const record = await getExportRequestBackend(recordId);
    if (!record) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    const canAccess = canActorAccessOwner({
      session,
      ownerEmail: record.requestedBy,
      ownerBypassRoles: ["SUPER_ADMIN", "GRC", "HR", "EA"],
    });
    if (!canAccess) {
      return NextResponse.json({ message: "Forbidden." }, { status: 403 });
    }

    await logApiAudit({
      request,
      module: "Export Control",
      activityName: "Export request viewed",
      status: "Completed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        requestedBy: record.requestedBy || null,
      },
    });

    return NextResponse.json({ record });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to load export request.");
    return NextResponse.json({ message: mapped.message }, { status: mapped.status });
  }
}

export async function PATCH(request, { params }) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["resource:own"],
    auditModule: "Export Control",
    auditAction: "Export request update",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);

  try {
    const current = await getExportRequestBackend(recordId);
    if (!current) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    const ownerAccess = canActorAccessOwner({
      session,
      ownerEmail: current.requestedBy,
      ownerBypassRoles: ["SUPER_ADMIN", "GRC", "HR", "EA"],
    });
    if (!ownerAccess) {
      return NextResponse.json({ message: "Forbidden." }, { status: 403 });
    }

    const body = await parseJsonBody(request);
    const privileged = canManageExportUpdate(session.role);
    if (!privileged) {
      delete body.status;
      delete body.reviewer;
      delete body.reviewNote;
      delete body.reviewedAt;
      delete body.exportedAt;
      delete body.exportedBy;
      body.requestedBy = current.requestedBy;
    }

    const updated = await updateExportRequestBackend(recordId, body, session.email);
    if (!updated) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    await logApiAudit({
      request,
      module: "Export Control",
      activityName: "Export request updated",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        updatedFields: Object.keys(body || {}),
      },
    });

    return NextResponse.json({ ok: true, record: updated });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to update export request.");

    await logApiAudit({
      request,
      module: "Export Control",
      activityName: "Export request update failed",
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
