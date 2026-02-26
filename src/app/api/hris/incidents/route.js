import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { consumeRateLimit, enforceRateLimitByRequest } from "@/lib/api-rate-limit";
import {
  createIncidentRecordBackend,
  listIncidentRecordsBackend,
  updateIncidentRecordBackend,
} from "@/lib/hris-backend";
import { hasPermission } from "@/lib/rbac";
import {
  createInAppNotificationsBulk,
  resolveIncidentStakeholderRecipients,
} from "@/lib/security-notifications";
import { buildIncidentCreatedNotification } from "@/lib/incident-notification-text";
import { validateIncidentEvidenceDocumentsStrict } from "@/lib/incident-evidence-security";
import { drainSecurityDetectionRetryQueue } from "@/lib/security-detection";
import { dispatchSecurityIncidentAlerts } from "@/lib/security-alert-delivery";
import {
  enrichIncidentRecordForApi,
  logApiAudit,
  mapBackendError,
  paginateRows,
  parseJsonBody,
  parsePositiveInt,
  resolveAuditRecordRef,
  summarizeAuditFieldList,
} from "@/lib/hris-api";

function applyRateLimitHeaders(response, rateLimitResult) {
  if (!rateLimitResult?.headers || typeof rateLimitResult.headers !== "object") {
    return response;
  }
  for (const [headerKey, headerValue] of Object.entries(rateLimitResult.headers)) {
    response.headers.set(headerKey, String(headerValue));
  }
  return response;
}

function rateLimitedResponse(message, rateLimitResult) {
  return applyRateLimitHeaders(NextResponse.json({ message }, { status: 429 }), rateLimitResult);
}

async function enforceIncidentRateLimit({
  request,
  session,
  scopePrefix,
  ipLimit = 120,
  actorLimit = 90,
}) {
  const ipRateLimit = enforceRateLimitByRequest({
    request,
    scope: `${scopePrefix}-ip`,
    limit: ipLimit,
    windowMs: 5 * 60 * 1000,
  });
  if (!ipRateLimit.allowed) {
    await logApiAudit({
      request,
      module: "Incident Management",
      activityName: "Incident API rate-limited (IP)",
      status: "Rejected",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        reason: "rate_limit_exceeded",
        scope: `${scopePrefix}-ip`,
      },
    });
    return rateLimitedResponse("Too many incident requests. Please retry shortly.", ipRateLimit);
  }

  const actorRateLimit = consumeRateLimit({
    scope: `${scopePrefix}-actor`,
    identifier: session.email,
    limit: actorLimit,
    windowMs: 5 * 60 * 1000,
  });
  if (!actorRateLimit.allowed) {
    await logApiAudit({
      request,
      module: "Incident Management",
      activityName: "Incident API rate-limited (actor)",
      status: "Rejected",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        reason: "rate_limit_exceeded",
        scope: `${scopePrefix}-actor`,
      },
    });
    return rateLimitedResponse("Too many incident requests for this account. Please retry shortly.", actorRateLimit);
  }

  return null;
}

function normalizeSeverityForNotification(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "high") return "high";
  if (normalized === "low") return "low";
  return "medium";
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function asString(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseSmsRecipientsFromPayload(payload) {
  const list = [
    ...asArray(payload?.alertSmsRecipients),
    ...String(payload?.alertSmsRecipient || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  ];
  return Array.from(
    new Set(
      list
        .map((item) => String(item || "").replace(/[^\d+]/g, "").trim())
        .filter(Boolean),
    ),
  );
}

function resolveSourceIp(request) {
  const fromForwarded = String(request.headers.get("x-forwarded-for") || "")
    .split(",")
    .map((item) => item.trim())
    .find(Boolean);
  return fromForwarded || String(request.headers.get("x-real-ip") || "").trim() || "";
}

function buildManualIncidentDetection(record) {
  return {
    ruleId: "MANUAL_INCIDENT_CREATE",
    severity: asString(record?.severity, "Medium"),
    observedCount: 1,
    windowMinutes: 1,
    summary: asString(record?.summary || record?.title, "Manual incident created"),
  };
}

function buildManualIncidentSourceEvent({ request, session, record }) {
  return {
    id: asString(record?.id || record?.recordId),
    module: "Incident Management",
    activityName: "Manual incident created",
    status: "Completed",
    occurredAt: new Date().toISOString(),
    performedBy: asString(session?.email),
    requestMethod: request.method,
    requestPath: request.nextUrl?.pathname || "/api/hris/incidents",
    sourceIp: resolveSourceIp(request),
    metadata: {
      sourceIp: resolveSourceIp(request),
      requestPath: request.nextUrl?.pathname || "/api/hris/incidents",
      requestMethod: request.method,
    },
  };
}

function toTimeMs(value) {
  const timestamp = new Date(value || "").getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function asBooleanFilter(value) {
  const normalized = normalizeText(value);
  if (!normalized || normalized === "all") {
    return null;
  }
  if (["yes", "true", "1", "restricted", "required"].includes(normalized)) {
    return true;
  }
  if (["no", "false", "0", "not-required", "none"].includes(normalized)) {
    return false;
  }
  return null;
}

function summarizeIncidentWindow(records) {
  const nowMs = Date.now();
  let openCases = 0;
  let criticalOpen = 0;
  let containmentPending = 0;
  let dueWithin72Hours = 0;
  let overdue72HourNotifications = 0;

  records.forEach((record) => {
    const status = normalizeText(record?.status);
    const severity = normalizeText(record?.severity);
    const containment = normalizeText(record?.containmentStatus);
    const regulatoryRequired = Boolean(record?.regulatoryNotificationRequired);
    const regulatoryNotifiedAtMs = toTimeMs(record?.regulatoryNotifiedAt);
    const regulatoryDueAtMs = toTimeMs(record?.regulatoryDueAt);

    const isOpen = !["resolved", "closed"].includes(status);
    if (isOpen) {
      openCases += 1;
      if (severity === "critical") {
        criticalOpen += 1;
      }
    }
    if (containment !== "contained") {
      containmentPending += 1;
    }
    if (regulatoryRequired && !Number.isFinite(regulatoryNotifiedAtMs) && Number.isFinite(regulatoryDueAtMs)) {
      if (regulatoryDueAtMs < nowMs) {
        overdue72HourNotifications += 1;
      } else if (regulatoryDueAtMs <= nowMs + 72 * 60 * 60 * 1000) {
        dueWithin72Hours += 1;
      }
    }
  });

  return {
    total: records.length,
    openCases,
    criticalOpen,
    containmentPending,
    dueWithin72Hours,
    overdue72HourNotifications,
  };
}

export async function GET(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["incident_management:view"],
    auditModule: "Incident Management",
    auditAction: "Incident records list request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const rateLimited = await enforceIncidentRateLimit({
    request,
    session,
    scopePrefix: "incident-list",
    ipLimit: 140,
    actorLimit: 110,
  });
  if (rateLimited) {
    return rateLimited;
  }

  void drainSecurityDetectionRetryQueue({ reason: "incident-list-get" }).catch(() => null);

  try {
    const searchQuery = normalizeText(request.nextUrl?.searchParams.get("q"));
    const statusFilter = normalizeText(request.nextUrl?.searchParams.get("status"));
    const severityFilter = normalizeText(request.nextUrl?.searchParams.get("severity"));
    const incidentTypeFilter = normalizeText(request.nextUrl?.searchParams.get("incidentType"));
    const escalationFilter = normalizeText(request.nextUrl?.searchParams.get("escalationLevel"));
    const regulatoryFilter = normalizeText(request.nextUrl?.searchParams.get("regulatoryStatus"));
    const restrictedPiiFilter = asBooleanFilter(request.nextUrl?.searchParams.get("restrictedPii"));
    const page = parsePositiveInt(request.nextUrl?.searchParams.get("page"), 1, { min: 1, max: 100000 });
    const pageSize = parsePositiveInt(request.nextUrl?.searchParams.get("pageSize"), 12, { min: 1, max: 200 });

    const rows = await listIncidentRecordsBackend();
    const filtered = rows.filter((record) => {
      const rowStatus = normalizeText(record?.status);
      const rowSeverity = normalizeText(record?.severity);
      const rowIncidentType = normalizeText(record?.incidentType);
      const rowEscalation = normalizeText(record?.escalationLevel);
      const rowRegulatory = normalizeText(record?.regulatoryStatus);
      const rowRestrictedPii = Boolean(record?.restrictedPiiInvolved);

      const textBlob = normalizeText(
        [
          record?.incidentCode,
          record?.title,
          record?.summary,
          record?.incidentType,
          record?.severity,
          record?.status,
          record?.affectedEmployeeEmail,
          record?.department,
          Array.isArray(record?.involvedEmployees) ? record.involvedEmployees.join(" ") : record?.involvedEmployees,
          record?.ownerEmail,
          record?.escalationLevel,
          record?.regulatoryStatus,
        ].join(" "),
      );

      const byQuery = searchQuery ? textBlob.includes(searchQuery) : true;
      const byStatus = statusFilter && statusFilter !== "all" ? rowStatus.includes(statusFilter) : true;
      const bySeverity = severityFilter && severityFilter !== "all" ? rowSeverity.includes(severityFilter) : true;
      const byIncidentType =
        incidentTypeFilter && incidentTypeFilter !== "all" ? rowIncidentType.includes(incidentTypeFilter) : true;
      const byEscalation =
        escalationFilter && escalationFilter !== "all" ? rowEscalation.includes(escalationFilter) : true;
      const byRegulatory =
        regulatoryFilter && regulatoryFilter !== "all" ? rowRegulatory.includes(regulatoryFilter) : true;
      const byRestrictedPii =
        restrictedPiiFilter === null ? true : rowRestrictedPii === restrictedPiiFilter;

      return byQuery && byStatus && bySeverity && byIncidentType && byEscalation && byRegulatory && byRestrictedPii;
    });

    const summary = summarizeIncidentWindow(filtered);
    const { data, pagination } = paginateRows(filtered, { page, pageSize });
    const detailedRecords = data.map((row) => enrichIncidentRecordForApi(row));

    await logApiAudit({
      request,
      module: "Incident Management",
      activityName: "Incident records listed",
      status: "Completed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        resultCount: detailedRecords.length,
        totalMatched: filtered.length,
        viewedRecordRefs: detailedRecords.slice(0, 25).map((row) => ({
          recordId: row.id,
          recordRef: resolveAuditRecordRef(row, row.id, ["incidentCode", "id"]),
          severity: row.severity || "",
          status: row.status || "",
        })),
        hasFilters: Boolean(
          searchQuery ||
            (statusFilter && statusFilter !== "all") ||
            (severityFilter && severityFilter !== "all") ||
            (incidentTypeFilter && incidentTypeFilter !== "all") ||
            (escalationFilter && escalationFilter !== "all") ||
            (regulatoryFilter && regulatoryFilter !== "all") ||
            restrictedPiiFilter !== null,
        ),
        auditNote: `Listed ${detailedRecords.length} incident record(s) in current page window.`,
        nextAction: "No further action required.",
      },
    });

    return NextResponse.json({ records: detailedRecords, pagination, summary });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to load incident records.");

    await logApiAudit({
      request,
      module: "Incident Management",
      activityName: "Incident records list failed",
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
    requiredPermissions: ["incident_management:view"],
    auditModule: "Incident Management",
    auditAction: "Incident record create request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const rateLimited = await enforceIncidentRateLimit({
    request,
    session,
    scopePrefix: "incident-create",
    ipLimit: 50,
    actorLimit: 35,
  });
  if (rateLimited) {
    return rateLimited;
  }

  void drainSecurityDetectionRetryQueue({ reason: "incident-create-post" }).catch(() => null);

  if (!hasPermission(session.role, "incident_management:edit")) {
    await logApiAudit({
      request,
      module: "Incident Management",
      activityName: "Incident record create blocked by permission policy",
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
    if (Object.prototype.hasOwnProperty.call(body || {}, "evidenceDocuments")) {
      body.evidenceDocuments = await validateIncidentEvidenceDocumentsStrict(body.evidenceDocuments, {
        actorEmail: session.email,
      });
    }
    const created = await createIncidentRecordBackend(body, session.email);
    const changedFields = Object.keys(body || {});
    const incidentActionUrl = `/incident-management?incident=${encodeURIComponent(created.id)}`;
    const notificationCopy = buildIncidentCreatedNotification(created, created.id);

    const recipients = await resolveIncidentStakeholderRecipients({
      ownerEmail: created.ownerEmail,
      affectedEmployeeEmail: created.affectedEmployeeEmail,
      actorEmail: session.email,
      includeAffectedEmployee: true,
      includeActor: false,
    });
    await createInAppNotificationsBulk(
      recipients.map((recipientEmail) => ({
        recipientEmail,
        title: notificationCopy.title,
        message: notificationCopy.message,
        severity: normalizeSeverityForNotification(created.severity),
        type: "incident-created",
        module: "Incident Management",
        actionUrl: incidentActionUrl,
        status: "unread",
        createdBy: session.email,
        metadata: {
          incidentId: created.id,
          incidentCode: created.incidentCode || "",
          autoGenerated: Boolean(created.autoGenerated),
        },
      })),
    );

    const smsRecipients = parseSmsRecipientsFromPayload(body);
    const deliverySummary = await dispatchSecurityIncidentAlerts({
      incident: {
        ...created,
        actionUrl: incidentActionUrl,
      },
      detection: buildManualIncidentDetection(created),
      sourceEvent: buildManualIncidentSourceEvent({ request, session, record: created }),
      emailRecipients: recipients,
      smsRecipients,
    });
    await updateIncidentRecordBackend(created.id, {
      alertRecipients: recipients,
      alertDispatchSummary: deliverySummary,
      lastAlertDispatchAt: new Date().toISOString(),
      externalIntegrations: {
        ...(created?.externalIntegrations || {}),
        manualDispatch: true,
      },
    }, session.email).catch(() => null);

    await logApiAudit({
      request,
      module: "Incident Management",
      activityName: "Incident record created",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId: created.id,
        recordRef: resolveAuditRecordRef(created, created.id, ["incidentCode", "id"]),
        incidentCode: created.incidentCode,
        severity: created.severity,
        status: created.status,
        restrictedPiiInvolved: Boolean(created.restrictedPiiInvolved),
        changedFields,
        changedFieldCount: changedFields.length,
        pushEmailStatus: asString(deliverySummary?.email?.status, "unknown"),
        pushSmsStatus: asString(deliverySummary?.sms?.status, "unknown"),
        pushWebhookStatus: asString(deliverySummary?.webhooks?.status, "unknown"),
        pushSmsRecipients: asArray(deliverySummary?.smsRecipients).length,
        resourceType: "Incident Record",
        resourceLabel: created.title || created.incidentCode || created.id,
        auditNote: `Created incident with fields: ${summarizeAuditFieldList(
          changedFields,
          "No explicit payload fields captured.",
        )}.`,
        nextAction: "Run containment and impact assessment workflow.",
      },
    });

    return NextResponse.json({ ok: true, record: enrichIncidentRecordForApi(created) }, { status: 201 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to create incident record.");

    await logApiAudit({
      request,
      module: "Incident Management",
      activityName: "Incident record create failed",
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
