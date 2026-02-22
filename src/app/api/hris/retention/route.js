import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import {
  listRetentionArchiveSnapshotBackend,
  purgeArchivedEmployeeDataBackend,
} from "@/lib/hris-backend";
import {
  logApiAudit,
  mapBackendError,
  paginateRows,
  parseJsonBody,
  parsePositiveInt,
} from "@/lib/hris-api";
import { hasPermission } from "@/lib/rbac";

const PURGE_CONFIRMATION_PHRASE = "PURGE ARCHIVED DATA";

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeIso(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const timestamp = new Date(raw);
  if (Number.isNaN(timestamp.getTime())) {
    return "";
  }
  return timestamp.toISOString();
}

export async function GET(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["retention_archive:view"],
    auditModule: "Retention & Archive",
    auditAction: "Retention archive list request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const moduleId = normalizeText(request.nextUrl?.searchParams.get("module")) || "all";
  const status = normalizeText(request.nextUrl?.searchParams.get("status")) || "all";
  const queryText = String(request.nextUrl?.searchParams.get("q") || "").trim();
  const dueWithinDays = parsePositiveInt(request.nextUrl?.searchParams.get("dueWithinDays"), 30, {
    min: 1,
    max: 365,
  });
  const page = parsePositiveInt(request.nextUrl?.searchParams.get("page"), 1, { min: 1, max: 100000 });
  const pageSize = parsePositiveInt(request.nextUrl?.searchParams.get("pageSize"), 20, { min: 1, max: 200 });
  const now = normalizeIso(request.nextUrl?.searchParams.get("now"));

  try {
    const snapshot = await listRetentionArchiveSnapshotBackend({
      moduleId,
      status,
      queryText,
      dueWithinDays,
      now: now || undefined,
    });
    const { data, pagination } = paginateRows(snapshot.records, {
      page,
      pageSize,
    });

    await logApiAudit({
      request,
      module: "Retention & Archive",
      activityName: "Retention archive records listed",
      status: "Completed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        resultCount: data.length,
        totalMatched: snapshot.records.length,
        moduleId,
        status,
        dueWithinDays,
        hasSearchQuery: Boolean(queryText),
      },
    });

    return NextResponse.json({
      records: data,
      pagination,
      summary: snapshot.summary,
      policy: snapshot.policy,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to load retention archive records.");

    await logApiAudit({
      request,
      module: "Retention & Archive",
      activityName: "Retention archive list failed",
      status: "Failed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        reason,
        moduleId,
        status,
      },
    });

    return NextResponse.json({ message: mapped.message }, { status: mapped.status });
  }
}

export async function POST(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["retention_archive:view"],
    auditModule: "Retention & Archive",
    auditAction: "Retention purge request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  if (!hasPermission(session.role, "retention_archive:manage")) {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 });
  }

  try {
    const body = await parseJsonBody(request);
    const cutoff = normalizeIso(body?.cutoff);
    const confirmation = String(body?.confirmation || "").trim().toUpperCase();
    if (confirmation !== PURGE_CONFIRMATION_PHRASE) {
      throw new Error("invalid_purge_confirmation");
    }

    const result = await purgeArchivedEmployeeDataBackend({
      now: cutoff || undefined,
    });

    await logApiAudit({
      request,
      module: "Retention & Archive",
      activityName: "Retention purge completed",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        cutoff: result.cutoff,
        deletedByCollection: result.deletedByCollection,
        deletedUsers: result.deletedUsers,
      },
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to run retention purge.");

    await logApiAudit({
      request,
      module: "Retention & Archive",
      activityName: "Retention purge failed",
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
