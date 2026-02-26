import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { consumeRateLimit, enforceRateLimitByRequest } from "@/lib/api-rate-limit";
import {
  getIncidentRecordBackend,
  updateIncidentRecordBackend,
} from "@/lib/hris-backend";
import { hasPermission } from "@/lib/rbac";
import {
  createInAppNotificationsBulk,
  resolveIncidentStakeholderRecipients,
} from "@/lib/security-notifications";
import { buildIncidentUpdatedNotification } from "@/lib/incident-notification-text";
import { validateIncidentEvidenceDocumentsStrict } from "@/lib/incident-evidence-security";
import { drainSecurityDetectionRetryQueue } from "@/lib/security-detection";
import { dispatchSecurityIncidentAlerts } from "@/lib/security-alert-delivery";
import {
  enrichIncidentRecordForApi,
  logApiAudit,
  mapBackendError,
  parseJsonBody,
  resolveAuditChangedFields,
  resolveAuditRecordRef,
  resolveAuditViewedFields,
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
  ipLimit = 140,
  actorLimit = 100,
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
      activityName: "Incident record API rate-limited (IP)",
      status: "Rejected",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        reason: "rate_limit_exceeded",
        scope: `${scopePrefix}-ip`,
      },
    });
    return rateLimitedResponse("Too many incident record requests. Please retry shortly.", ipRateLimit);
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
      activityName: "Incident record API rate-limited (actor)",
      status: "Rejected",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        reason: "rate_limit_exceeded",
        scope: `${scopePrefix}-actor`,
      },
    });
    return rateLimitedResponse("Too many incident record requests for this account. Please retry shortly.", actorRateLimit);
  }

  return null;
}

const INCIDENT_NOTIFICATION_TRIGGER_FIELDS = new Set([
  "severity",
  "status",
  "containmentStatus",
  "impactAssessmentStatus",
  "regulatoryNotificationRequired",
  "regulatoryNotifiedAt",
  "affectedIndividualsNotifiedAt",
  "grcAlertedAt",
  "executiveNotifiedAt",
]);

function asString(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function resolveSourceIp(request) {
  const fromForwarded = String(request.headers.get("x-forwarded-for") || "")
    .split(",")
    .map((item) => item.trim())
    .find(Boolean);
  return fromForwarded || String(request.headers.get("x-real-ip") || "").trim() || "";
}

function buildIncidentUpdateDetection(updated, changedFields = []) {
  return {
    ruleId: "MANUAL_INCIDENT_UPDATE",
    severity: asString(updated?.severity, "Medium"),
    observedCount: Math.max(1, changedFields.length),
    windowMinutes: 1,
    summary:
      changedFields.length > 0
        ? `Incident updated (${changedFields.join(", ")})`
        : asString(updated?.summary || updated?.title, "Incident updated"),
  };
}

function buildIncidentUpdateSourceEvent({ request, session, updated, changedFields = [] }) {
  return {
    id: asString(updated?.id || updated?.recordId),
    module: "Incident Management",
    activityName: "Manual incident updated",
    status: "Completed",
    occurredAt: new Date().toISOString(),
    performedBy: asString(session?.email),
    requestMethod: request.method,
    requestPath: request.nextUrl?.pathname || "/api/hris/incidents/:recordId",
    sourceIp: resolveSourceIp(request),
    metadata: {
      sourceIp: resolveSourceIp(request),
      requestPath: request.nextUrl?.pathname || "/api/hris/incidents/:recordId",
      requestMethod: request.method,
      changedFields,
    },
  };
}
 
function normalizeSeverityForNotification(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "high") return "high";
  if (normalized === "low") return "low";
  return "medium";
}

function shouldNotifyIncidentUpdate(changedFields = []) {
  return changedFields.some((field) =>
    INCIDENT_NOTIFICATION_TRIGGER_FIELDS.has(String(field || "").trim()),
  );
}

async function getRecordId(paramsPromise) {
  const params = await paramsPromise;
  return typeof params?.recordId === "string" ? params.recordId : "";
}

export async function GET(request, { params }) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["incident_management:view"],
    auditModule: "Incident Management",
    auditAction: "Incident record view request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const rateLimited = await enforceIncidentRateLimit({
    request,
    session,
    scopePrefix: "incident-record-view",
    ipLimit: 160,
    actorLimit: 120,
  });
  if (rateLimited) {
    return rateLimited;
  }
  void drainSecurityDetectionRetryQueue({ reason: "incident-record-get" }).catch(() => null);
  const recordId = await getRecordId(params);

  try {
    const record = await getIncidentRecordBackend(recordId);
    if (!record) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    await logApiAudit({
      request,
      module: "Incident Management",
      activityName: "Incident record viewed",
      status: "Completed",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        recordRef: resolveAuditRecordRef(record, recordId, ["incidentCode", "id"]),
        incidentCode: record.incidentCode || null,
        severity: record.severity || null,
        status: record.status || null,
        restrictedPiiInvolved: Boolean(record.restrictedPiiInvolved),
        resourceType: "Incident Record",
        resourceLabel: record.title || record.incidentCode || record.id,
        viewedFields: resolveAuditViewedFields(record, ["traceability"]),
        accessedDocuments: Array.isArray(record.evidenceDocuments)
          ? record.evidenceDocuments.map((entry) => ({
              id: String(entry?.id || "").trim(),
              name: String(entry?.name || "").trim(),
              type: String(entry?.type || "").trim(),
            }))
          : [],
        auditNote: `Viewed incident record "${record.title || record.incidentCode || record.id}".`,
        nextAction: "No further action required.",
      },
    });

    return NextResponse.json({ record: enrichIncidentRecordForApi(record) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to load incident record.");

    await logApiAudit({
      request,
      module: "Incident Management",
      activityName: "Incident record view failed",
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
    requiredPermissions: ["incident_management:view"],
    auditModule: "Incident Management",
    auditAction: "Incident record update request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;
  const rateLimited = await enforceIncidentRateLimit({
    request,
    session,
    scopePrefix: "incident-record-update",
    ipLimit: 80,
    actorLimit: 60,
  });
  if (rateLimited) {
    return rateLimited;
  }

  void drainSecurityDetectionRetryQueue({ reason: "incident-record-patch" }).catch(() => null);
  const recordId = await getRecordId(params);

  if (!hasPermission(session.role, "incident_management:edit")) {
    await logApiAudit({
      request,
      module: "Incident Management",
      activityName: "Incident record update blocked by permission policy",
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
    const current = await getIncidentRecordBackend(recordId);
    if (!current) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    const body = await parseJsonBody(request);
    if (Object.prototype.hasOwnProperty.call(body || {}, "evidenceDocuments")) {
      body.evidenceDocuments = await validateIncidentEvidenceDocumentsStrict(body.evidenceDocuments, {
        actorEmail: session.email,
      });
    }
    const updated = await updateIncidentRecordBackend(recordId, body, session.email);
    if (!updated) {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }

    const changedFields = resolveAuditChangedFields(current, updated, Object.keys(body || {}));
    if (changedFields.length > 0 && shouldNotifyIncidentUpdate(changedFields)) {
      const recipients = await resolveIncidentStakeholderRecipients({
        ownerEmail: updated.ownerEmail,
        affectedEmployeeEmail: updated.affectedEmployeeEmail,
        actorEmail: session.email,
        includeAffectedEmployee: true,
        includeActor: false,
      });
      const incidentActionUrl = `/incident-management?incident=${encodeURIComponent(updated.id || recordId)}`;
      const notificationCopy = buildIncidentUpdatedNotification(
        updated,
        changedFields,
        updated.id || recordId,
      );
      await createInAppNotificationsBulk(
        recipients.map((recipientEmail) => ({
          recipientEmail,
          title: notificationCopy.title,
          message: notificationCopy.message,
          severity: normalizeSeverityForNotification(updated.severity),
          type: "incident-updated",
          module: "Incident Management",
          actionUrl: incidentActionUrl,
          status: "unread",
          createdBy: session.email,
          metadata: {
            incidentId: updated.id || recordId,
            incidentCode: updated.incidentCode || "",
            changedFields,
          },
        })),
      );

      const deliverySummary = await dispatchSecurityIncidentAlerts({
        incident: {
          ...updated,
          actionUrl: incidentActionUrl,
        },
        detection: buildIncidentUpdateDetection(updated, changedFields),
        sourceEvent: buildIncidentUpdateSourceEvent({ request, session, updated, changedFields }),
        emailRecipients: recipients,
        smsRecipients: [],
      });
      await updateIncidentRecordBackend(
        updated.id || recordId,
        {
          alertRecipients: recipients,
          alertDispatchSummary: deliverySummary,
          lastAlertDispatchAt: new Date().toISOString(),
          externalIntegrations: {
            ...(updated?.externalIntegrations || {}),
            manualDispatch: true,
          },
        },
        session.email,
      ).catch(() => null);
    }

    await logApiAudit({
      request,
      module: "Incident Management",
      activityName: "Incident record updated",
      status: "Approved",
      sensitivity: "Sensitive",
      performedBy: session.email,
      metadata: {
        recordId,
        recordRef: resolveAuditRecordRef(updated, recordId, ["incidentCode", "id"]),
        incidentCode: updated.incidentCode || null,
        severity: updated.severity || null,
        status: updated.status || null,
        restrictedPiiInvolved: Boolean(updated.restrictedPiiInvolved),
        resourceType: "Incident Record",
        resourceLabel: updated.title || updated.incidentCode || updated.id,
        updatedFields: Object.keys(body || {}),
        changedFields,
        changedFieldCount: changedFields.length,
        pushTriggered: changedFields.length > 0 && shouldNotifyIncidentUpdate(changedFields),
        auditNote:
          changedFields.length > 0
            ? `Updated incident fields: ${summarizeAuditFieldList(changedFields)}.`
            : "Update request completed but no incident field values changed.",
        nextAction:
          changedFields.length > 0
            ? "Validate escalation, regulatory, and forensic status."
            : "Review payload and retry if needed.",
      },
    });

    return NextResponse.json({ ok: true, record: enrichIncidentRecordForApi(updated) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error";
    const mapped = mapBackendError(reason, "Unable to update incident record.");

    await logApiAudit({
      request,
      module: "Incident Management",
      activityName: "Incident record update failed",
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
