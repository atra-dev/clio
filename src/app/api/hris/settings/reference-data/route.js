import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import {
  createSettingsReferenceItemBackend,
  deleteSettingsReferenceItemBackend,
  listSettingsReferenceCatalogBackend,
} from "@/lib/hris-backend";
import {
  logApiAudit,
  mapBackendError,
  notFound,
  parseJsonBody,
} from "@/lib/hris-api";

const PRIVILEGED_SETTINGS_ROLES = ["SUPER_ADMIN", "GRC", "HR", "EA"];

export async function GET(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["settings:view"],
    auditModule: "Settings",
    auditAction: "Reference catalog list request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  try {
    const catalogs = await listSettingsReferenceCatalogBackend();

    await logApiAudit({
      request,
      module: "Settings",
      activityName: "Reference catalog listed",
      status: "Completed",
      sensitivity: "Non-sensitive",
      performedBy: session.email,
      metadata: {
        rolesCount: Array.isArray(catalogs.roles) ? catalogs.roles.length : 0,
        departmentsCount: Array.isArray(catalogs.departments) ? catalogs.departments.length : 0,
      },
    });

    return NextResponse.json({ catalogs });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to load settings reference catalog.");

    await logApiAudit({
      request,
      module: "Settings",
      activityName: "Reference catalog list failed",
      status: "Failed",
      sensitivity: "Non-sensitive",
      performedBy: session.email,
      metadata: { reason },
    });

    return NextResponse.json({ message: mapped.message }, { status: mapped.status });
  }
}

export async function POST(request) {
  const auth = await authorizeApiRequest(request, {
    allowedRoles: PRIVILEGED_SETTINGS_ROLES,
    requiredPermissions: ["settings:view"],
    auditModule: "Settings",
    auditAction: "Reference catalog create request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  try {
    const body = await parseJsonBody(request);
    const kind = String(body?.kind || "").trim();
    const label = String(body?.label || "").trim();
    const created = await createSettingsReferenceItemBackend({ kind, label }, session.email);
    const catalogs = await listSettingsReferenceCatalogBackend();

    await logApiAudit({
      request,
      module: "Settings",
      activityName: "Reference catalog item created",
      status: "Approved",
      sensitivity: "Non-sensitive",
      performedBy: session.email,
      metadata: {
        kind: created.kind,
        value: created.value,
        label: created.label,
        recordId: created.id,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        item: created,
        catalogs,
      },
      { status: 201 },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to create settings reference value.");

    await logApiAudit({
      request,
      module: "Settings",
      activityName: "Reference catalog item create failed",
      status: "Failed",
      sensitivity: "Non-sensitive",
      performedBy: session.email,
      metadata: { reason },
    });

    return NextResponse.json({ message: mapped.message }, { status: mapped.status });
  }
}

export async function DELETE(request) {
  const auth = await authorizeApiRequest(request, {
    allowedRoles: PRIVILEGED_SETTINGS_ROLES,
    requiredPermissions: ["settings:view"],
    auditModule: "Settings",
    auditAction: "Reference catalog delete request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  try {
    const body = await parseJsonBody(request);
    const kind = String(body?.kind || "").trim();
    const recordId = String(body?.recordId || "").trim();
    const deleted = await deleteSettingsReferenceItemBackend({ kind, recordId });
    if (!deleted) {
      return notFound("Reference value not found.");
    }

    const catalogs = await listSettingsReferenceCatalogBackend();

    await logApiAudit({
      request,
      module: "Settings",
      activityName: "Reference catalog item removed",
      status: "Approved",
      sensitivity: "Non-sensitive",
      performedBy: session.email,
      metadata: {
        kind: deleted.kind,
        value: deleted.value,
        recordId: deleted.id,
      },
    });

    return NextResponse.json({ ok: true, deleted, catalogs });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to remove settings reference value.");

    await logApiAudit({
      request,
      module: "Settings",
      activityName: "Reference catalog item remove failed",
      status: "Failed",
      sensitivity: "Non-sensitive",
      performedBy: session.email,
      metadata: { reason },
    });

    return NextResponse.json({ message: mapped.message }, { status: mapped.status });
  }
}

