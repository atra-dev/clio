import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import {
  getExportRequestBackend,
  markExportAsCompletedBackend,
} from "@/lib/hris-backend";
import { hasPermission } from "@/lib/rbac";
import { canActorAccessOwner, logApiAudit } from "@/lib/hris-api";

async function getRecordId(paramsPromise) {
  const params = await paramsPromise;
  return typeof params?.recordId === "string" ? params.recordId : "";
}

function asCsvValue(value) {
  const raw = String(value ?? "");
  if (raw.includes(",") || raw.includes("\"") || raw.includes("\n")) {
    return `"${raw.replaceAll("\"", "\"\"")}"`;
  }
  return raw;
}

export async function POST(request, { params }) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["resource:own"],
    auditModule: "Export Control",
    auditAction: "Export execution request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const recordId = await getRecordId(params);

  const current = await getExportRequestBackend(recordId);
  if (!current) {
    return NextResponse.json({ message: "Record not found." }, { status: 404 });
  }

  const canPrivilegedExecute = hasPermission(session.role, "exports:manage") || hasPermission(session.role, "exports:approve");
  const canOwnerExecute = canActorAccessOwner({
    session,
    ownerEmail: current.requestedBy,
    ownerBypassRoles: ["SUPER_ADMIN", "GRC", "HR", "EA"],
  });
  if (!canPrivilegedExecute && !canOwnerExecute) {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 });
  }

  const normalizedStatus = String(current.status || "").trim().toLowerCase();
  if (!canPrivilegedExecute && normalizedStatus !== "approved" && normalizedStatus !== "exported") {
    return NextResponse.json({ message: "Export requires approval before execution." }, { status: 409 });
  }

  const updated = await markExportAsCompletedBackend(recordId, session.email);
  if (!updated) {
    return NextResponse.json({ message: "Record not found." }, { status: 404 });
  }

  const csvHeaders = ["dataset", "format", "requestedBy", "status", "justification", "exportedAt"];
  const csvRow = [
    updated.dataset,
    updated.format,
    updated.requestedBy,
    updated.status,
    updated.justification,
    updated.exportedAt,
  ];
  const csvContent = `${csvHeaders.join(",")}\n${csvRow.map(asCsvValue).join(",")}\n`;

  await logApiAudit({
    request,
    module: "Export Control",
    activityName: "Data export generated",
    status: "Completed",
    sensitivity: "Sensitive",
    performedBy: session.email,
    metadata: {
      recordId,
      dataset: updated.dataset,
      format: updated.format,
      requestedBy: updated.requestedBy,
      exportedAt: updated.exportedAt,
    },
  });

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clio-export-${recordId}.csv"`,
    },
  });
}
