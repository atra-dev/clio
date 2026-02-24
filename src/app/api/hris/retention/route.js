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
const RETENTION_STATE_RANK = {
  due: 0,
  due_soon: 1,
  scheduled: 2,
  no_retention: 3,
};

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function toTimeMs(value) {
  const timestamp = new Date(value || "").getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
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

function getStateRank(state) {
  const normalized = normalizeText(state);
  return RETENTION_STATE_RANK[normalized] ?? 9;
}

function getDisplayEmployeeName(record) {
  const title = String(record?.title || "").trim();
  const moduleId = normalizeText(record?.moduleId);
  if (moduleId === "employees" && title) {
    return title;
  }

  if (title.includes(" - ")) {
    const [first] = title.split(" - ");
    return String(first || "").trim() || "Employee";
  }

  const subtitle = String(record?.subtitle || "").trim();
  if (subtitle.includes("|")) {
    const [first] = subtitle.split("|");
    const value = String(first || "").trim();
    if (value && value.includes("@")) {
      return "Employee";
    }
    if (value) {
      return value;
    }
  }

  return title || "Employee";
}

function toRetentionGroupRecord(record) {
  return {
    id: String(record?.id || "").trim(),
    moduleId: String(record?.moduleId || "").trim(),
    moduleLabel: String(record?.moduleLabel || "").trim() || "Module",
    recordId: String(record?.recordId || "").trim(),
    title: String(record?.title || "").trim(),
    subtitle: String(record?.subtitle || "").trim(),
    status: String(record?.status || "").trim(),
    archiveReason: String(record?.archiveReason || "").trim(),
    archivedAt: String(record?.archivedAt || "").trim(),
    retentionDeleteAt: String(record?.retentionDeleteAt || "").trim(),
    deletionState: String(record?.deletionState || "").trim(),
    daysToDeletion: Number.isFinite(Number(record?.daysToDeletion)) ? Number(record.daysToDeletion) : null,
    updatedAt: String(record?.updatedAt || "").trim(),
  };
}

function groupRetentionRecordsByEmployee(records = []) {
  const grouped = new Map();

  records.forEach((record) => {
    const ownerEmail = normalizeText(record?.ownerEmail);
    const fallbackKey = normalizeText(`${record?.title || ""}|${record?.subtitle || ""}|${record?.moduleId || ""}|${record?.recordId || ""}`);
    const groupKey = ownerEmail || fallbackKey || `group-${Math.random().toString(36).slice(2, 10)}`;
    const displayName = getDisplayEmployeeName(record);
    const displayEmail = String(record?.ownerEmail || "").trim().toLowerCase();
    const moduleId = String(record?.moduleId || "").trim();
    const moduleLabel = String(record?.moduleLabel || "").trim() || "Module";

    let group = grouped.get(groupKey);
    if (!group) {
      group = {
        id: groupKey,
        employeeName: displayName || "Employee",
        employeeEmail: displayEmail,
        totalRecords: 0,
        deletionState: String(record?.deletionState || "").trim() || "scheduled",
        daysToDeletion: Number.isFinite(Number(record?.daysToDeletion)) ? Number(record.daysToDeletion) : null,
        archivedAt: String(record?.archivedAt || "").trim(),
        retentionDeleteAt: String(record?.retentionDeleteAt || "").trim(),
        moduleBreakdown: [],
        records: [],
      };
      grouped.set(groupKey, group);
    }

    if (displayEmail && !group.employeeEmail) {
      group.employeeEmail = displayEmail;
    }
    if ((group.employeeName === "Employee" || !group.employeeName) && displayName) {
      group.employeeName = displayName;
    }

    group.totalRecords += 1;
    group.records.push(toRetentionGroupRecord(record));

    const currentStateRank = getStateRank(group.deletionState);
    const incomingStateRank = getStateRank(record?.deletionState);
    if (incomingStateRank < currentStateRank) {
      group.deletionState = String(record?.deletionState || "").trim();
      group.daysToDeletion = Number.isFinite(Number(record?.daysToDeletion)) ? Number(record.daysToDeletion) : null;
    } else if (
      incomingStateRank === currentStateRank &&
      Number.isFinite(Number(record?.daysToDeletion)) &&
      (!Number.isFinite(group.daysToDeletion) || Number(record.daysToDeletion) < group.daysToDeletion)
    ) {
      group.daysToDeletion = Number(record.daysToDeletion);
    }

    const groupArchivedMs = toTimeMs(group.archivedAt);
    const recordArchivedMs = toTimeMs(record?.archivedAt);
    if (!Number.isFinite(groupArchivedMs) || (Number.isFinite(recordArchivedMs) && recordArchivedMs < groupArchivedMs)) {
      group.archivedAt = String(record?.archivedAt || "").trim();
    }

    const groupRetentionMs = toTimeMs(group.retentionDeleteAt);
    const recordRetentionMs = toTimeMs(record?.retentionDeleteAt);
    if (!Number.isFinite(groupRetentionMs) || (Number.isFinite(recordRetentionMs) && recordRetentionMs < groupRetentionMs)) {
      group.retentionDeleteAt = String(record?.retentionDeleteAt || "").trim();
    }

    const moduleEntry = group.moduleBreakdown.find((entry) => entry.moduleId === moduleId);
    if (moduleEntry) {
      moduleEntry.count += 1;
    } else {
      group.moduleBreakdown.push({
        moduleId,
        moduleLabel,
        count: 1,
      });
    }
  });

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      moduleBreakdown: [...group.moduleBreakdown].sort((left, right) => right.count - left.count),
      records: [...group.records].sort((left, right) => {
        const leftRank = getStateRank(left.deletionState);
        const rightRank = getStateRank(right.deletionState);
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }

        const leftRetention = toTimeMs(left.retentionDeleteAt);
        const rightRetention = toTimeMs(right.retentionDeleteAt);
        if (Number.isFinite(leftRetention) && Number.isFinite(rightRetention) && leftRetention !== rightRetention) {
          return leftRetention - rightRetention;
        }
        if (Number.isFinite(leftRetention) && !Number.isFinite(rightRetention)) {
          return -1;
        }
        if (!Number.isFinite(leftRetention) && Number.isFinite(rightRetention)) {
          return 1;
        }
        return (toTimeMs(right.archivedAt) || 0) - (toTimeMs(left.archivedAt) || 0);
      }),
    }))
    .sort((left, right) => {
      const leftRank = getStateRank(left.deletionState);
      const rightRank = getStateRank(right.deletionState);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      const leftRetention = toTimeMs(left.retentionDeleteAt);
      const rightRetention = toTimeMs(right.retentionDeleteAt);
      if (Number.isFinite(leftRetention) && Number.isFinite(rightRetention) && leftRetention !== rightRetention) {
        return leftRetention - rightRetention;
      }
      if (Number.isFinite(leftRetention) && !Number.isFinite(rightRetention)) {
        return -1;
      }
      if (!Number.isFinite(leftRetention) && Number.isFinite(rightRetention)) {
        return 1;
      }

      return (toTimeMs(right.archivedAt) || 0) - (toTimeMs(left.archivedAt) || 0);
    });
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
  const view = normalizeText(request.nextUrl?.searchParams.get("view")) || "records";
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
    let data = [];
    let pagination = {
      page,
      pageSize,
      total: 0,
      totalPages: 1,
    };
    let employeeGroups = [];

    if (view === "employee") {
      const grouped = groupRetentionRecordsByEmployee(snapshot.records);
      const groupedPage = paginateRows(grouped, { page, pageSize });
      employeeGroups = groupedPage.data;
      pagination = groupedPage.pagination;
    } else {
      const recordPage = paginateRows(snapshot.records, { page, pageSize });
      data = recordPage.data;
      pagination = recordPage.pagination;
    }

    await logApiAudit({
      request,
      module: "Retention & Archive",
      activityName: "Retention archive records listed",
      status: "Completed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        resultCount: view === "employee" ? employeeGroups.length : data.length,
        totalMatched: snapshot.records.length,
        moduleId,
        status,
        view,
        dueWithinDays,
        hasSearchQuery: Boolean(queryText),
      },
    });

    return NextResponse.json({
      records: data,
      employeeGroups,
      pagination,
      summary: snapshot.summary,
      policy: snapshot.policy,
      view,
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
        view,
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
