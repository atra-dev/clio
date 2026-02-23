import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { listAuditEvents } from "@/lib/audit-log";
import { createActorDirectory, resolveActor } from "@/lib/actor-directory";
import { hasPermission } from "@/lib/rbac";
import {
  logApiAudit,
  paginateRows,
  parsePositiveInt,
} from "@/lib/hris-api";

function toTimestamp(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function inferActivityCategory(row) {
  const moduleName = normalizeText(row.module);
  const activityName = normalizeText(row.activityName);
  const requestPath = normalizeText(row.requestPath);

  if (moduleName.includes("authentication") || activityName.includes("login") || requestPath.includes("/auth/")) {
    return "login_history";
  }
  if (moduleName.includes("export") || activityName.includes("export")) {
    return "export_events";
  }
  if (moduleName.includes("template") || moduleName.includes("document") || activityName.includes("document")) {
    return "document_access_logs";
  }
  if (activityName.includes("updated") || activityName.includes("deleted") || activityName.includes("created")) {
    return "data_change_logs";
  }
  return "user_activity_logs";
}

function asCsvValue(value) {
  const raw = String(value ?? "");
  if (raw.includes(",") || raw.includes("\"") || raw.includes("\n")) {
    return `"${raw.replaceAll("\"", "\"\"")}"`;
  }
  return raw;
}

function summarizeFieldList(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return "";
  }
  return list
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" | ");
}

function summarizeDocumentList(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return "";
  }
  return list
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const name = String(item.name || "").trim();
      const type = String(item.type || "").trim();
      const id = String(item.id || "").trim();
      return [name, type ? `[${type}]` : "", id ? `#${id}` : ""].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(" | ");
}

export async function GET(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["activity_log:view"],
    auditModule: "Activity Log",
    auditAction: "Audit logs list request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const queryText = normalizeText(request.nextUrl?.searchParams.get("q"));
  const moduleFilter = normalizeText(request.nextUrl?.searchParams.get("module"));
  const statusFilter = normalizeText(request.nextUrl?.searchParams.get("status"));
  const sensitivityFilter = normalizeText(request.nextUrl?.searchParams.get("sensitivity"));
  const categoryFilter = normalizeText(request.nextUrl?.searchParams.get("category"));
  const fromDate = toTimestamp(request.nextUrl?.searchParams.get("from"));
  const toDate = toTimestamp(request.nextUrl?.searchParams.get("to"));
  const page = parsePositiveInt(request.nextUrl?.searchParams.get("page"), 1, { min: 1, max: 100000 });
  const pageSize = parsePositiveInt(request.nextUrl?.searchParams.get("pageSize"), 25, { min: 1, max: 200 });
  const limit = parsePositiveInt(request.nextUrl?.searchParams.get("limit"), 1200, { min: 1, max: 3000 });
  const exportMode = String(request.nextUrl?.searchParams.get("export") || "")
    .trim()
    .toLowerCase();

  const rows = await listAuditEvents({ limit });
  const actorDirectory = await createActorDirectory(rows.map((row) => row.performedBy));
  const filtered = rows.filter((row) => {
    const rowModule = normalizeText(row.module);
    const rowStatus = normalizeText(row.status);
    const rowSensitivity = normalizeText(row.sensitivity);
    const rowCategory = inferActivityCategory(row);
    const rowTimestamp = toTimestamp(row.occurredAt || row.loggedAt);
    const rowActor = resolveActor(actorDirectory, row.performedBy);
    const textBlob = normalizeText(
      [
        row.activityName,
        row.module,
        row.performedBy,
        rowActor.name,
        rowActor.email,
        row.requestPath,
        row.requestMethod,
        row.sourceIp,
        row.browser,
        row.operatingSystem,
        row.deviceSummary,
        row.recordRef,
        summarizeFieldList(row.changedFields),
        summarizeFieldList(row.viewedFields),
        summarizeDocumentList(row.accessedDocuments),
      ].join(" "),
    );

    const byQuery = queryText ? textBlob.includes(queryText) : true;
    const byModule = moduleFilter ? rowModule.includes(moduleFilter) : true;
    const byStatus = statusFilter ? rowStatus.includes(statusFilter) : true;
    const bySensitivity = sensitivityFilter ? rowSensitivity.includes(sensitivityFilter) : true;
    const byCategory = categoryFilter ? rowCategory === categoryFilter : true;
    const byFrom = fromDate ? rowTimestamp && rowTimestamp >= fromDate : true;
    const byTo = toDate ? rowTimestamp && rowTimestamp <= toDate : true;

    return byQuery && byModule && byStatus && bySensitivity && byCategory && byFrom && byTo;
  });
  const enrichedFiltered = filtered.map((row) => {
    const actor = resolveActor(actorDirectory, row.performedBy);
    return {
      ...row,
      performedByName: actor.name,
      performedByAvatar: actor.avatarUrl,
      performedByEmail: actor.email || row.performedBy || "",
    };
  });

  if (exportMode === "csv") {
    if (!hasPermission(session.role, "activity_log:export")) {
      return NextResponse.json({ message: "Forbidden." }, { status: 403 });
    }
    const headers = [
      "id",
      "activityName",
      "status",
      "module",
      "performedByName",
      "performedBy",
      "sensitivity",
      "occurredAt",
      "loggedAt",
      "requestPath",
      "requestMethod",
      "sourceIp",
      "browser",
      "operatingSystem",
      "deviceSummary",
      "recordRef",
      "changedFields",
      "viewedFields",
      "accessedDocuments",
      "category",
    ];
    const lines = enrichedFiltered.map((row) =>
      [
        row.id,
        row.activityName,
        row.status,
        row.module,
        row.performedByName,
        row.performedBy,
        row.sensitivity,
        row.occurredAt,
        row.loggedAt,
        row.requestPath,
        row.requestMethod,
        row.sourceIp,
        row.browser,
        row.operatingSystem,
        row.deviceSummary,
        row.recordRef,
        summarizeFieldList(row.changedFields),
        summarizeFieldList(row.viewedFields),
        summarizeDocumentList(row.accessedDocuments),
        inferActivityCategory(row),
      ]
        .map(asCsvValue)
        .join(","),
    );
    const csv = `${headers.join(",")}\n${lines.join("\n")}\n`;

    await logApiAudit({
      request,
      module: "Activity Log",
      activityName: "Activity logs exported",
      status: "Completed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        exportedCount: enrichedFiltered.length,
        format: "csv",
      },
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="clio-activity-logs-${Date.now()}.csv"`,
      },
    });
  }

  const { data, pagination } = paginateRows(enrichedFiltered, { page, pageSize });
  const records = data.map((row) => ({
    ...row,
    category: inferActivityCategory(row),
  }));

  await logApiAudit({
    request,
    module: "Activity Log",
    activityName: "Activity logs viewed",
    status: "Completed",
    sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        resultCount: records.length,
        totalMatched: enrichedFiltered.length,
        hasFilters: Boolean(queryText || moduleFilter || statusFilter || sensitivityFilter || categoryFilter || fromDate || toDate),
      },
    });

  return NextResponse.json({ records, pagination });
}
