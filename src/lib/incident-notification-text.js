function asString(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

const INCIDENT_FIELD_LABELS = {
  title: "Incident title",
  summary: "Incident summary",
  incidentType: "Incident type",
  severity: "Severity",
  status: "Status",
  containmentStatus: "Containment status",
  containmentSummary: "Containment summary",
  impactAssessmentStatus: "Impact assessment status",
  impactSummary: "Impact assessment summary",
  ownerEmail: "Incident owner",
  affectedEmployeeEmail: "Affected employee",
  restrictedPiiInvolved: "Restricted PII flag",
  escalationRequired: "Escalation requirement",
  executiveNotificationRequired: "Executive notification requirement",
  regulatoryNotificationRequired: "Regulatory notification requirement",
  regulatoryNotifiedAt: "Regulator notification",
  affectedIndividualsNotifiedAt: "Affected-individual notification",
  grcAlertedAt: "GRC alert timestamp",
  executiveNotifiedAt: "Executive notification timestamp",
  documentationRetained: "Documentation retention",
  documentationLocation: "Documentation location",
  classificationStandard: "Classification standard",
  notes: "Investigation notes",
  forensicWindowStart: "Forensic window start",
  forensicWindowEnd: "Forensic window end",
};

function humanizeFieldKey(key) {
  const normalized = asString(key);
  if (!normalized) return "Field";
  if (INCIDENT_FIELD_LABELS[normalized]) {
    return INCIDENT_FIELD_LABELS[normalized];
  }
  return normalized
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function summarizeChangedFields(changedFields = [], { max = 4 } = {}) {
  const labels = Array.from(
    new Set(
      (Array.isArray(changedFields) ? changedFields : [])
        .map((field) => humanizeFieldKey(field))
        .filter(Boolean),
    ),
  );

  if (labels.length === 0) {
    return "";
  }
  if (labels.length <= max) {
    return labels.join(", ");
  }
  const visible = labels.slice(0, max).join(", ");
  return `${visible}, +${labels.length - max} more`;
}

export function resolveIncidentDisplayName(incident = {}, fallbackRecordId = "") {
  const title = asString(incident?.title);
  if (title) {
    return title;
  }
  const code = asString(incident?.incidentCode);
  if (code) {
    return `Case ${code}`;
  }
  if (asString(fallbackRecordId)) {
    return "Incident Record";
  }
  return "Incident";
}

export function buildIncidentCreatedNotification(incident = {}, fallbackRecordId = "") {
  const displayName = resolveIncidentDisplayName(incident, fallbackRecordId);
  const severity = asString(incident?.severity, "Medium");
  const status = asString(incident?.status, "Open");
  return {
    title: `New Incident: ${displayName}`,
    message: `A new incident has been logged for review. Severity: ${severity}. Current status: ${status}.`,
  };
}

export function buildIncidentUpdatedNotification(
  incident = {},
  changedFields = [],
  fallbackRecordId = "",
) {
  const displayName = resolveIncidentDisplayName(incident, fallbackRecordId);
  const changedSummary = summarizeChangedFields(changedFields);

  const normalizedChanged = new Set((Array.isArray(changedFields) ? changedFields : []).map((field) => asString(field)));

  let actionSummary = "Incident workflow details were updated.";
  if (normalizedChanged.has("status")) {
    actionSummary = `Incident status is now ${asString(incident?.status, "updated")}.`;
  } else if (normalizedChanged.has("containmentStatus")) {
    actionSummary = `Containment status is now ${asString(incident?.containmentStatus, "updated")}.`;
  } else if (normalizedChanged.has("regulatoryNotifiedAt")) {
    actionSummary = "Regulator notification has been recorded.";
  } else if (normalizedChanged.has("affectedIndividualsNotifiedAt")) {
    actionSummary = "Affected-individual notification has been recorded.";
  } else if (normalizedChanged.has("executiveNotifiedAt")) {
    actionSummary = "Executive notification has been recorded.";
  } else if (normalizedChanged.has("grcAlertedAt")) {
    actionSummary = "GRC alert timestamp has been recorded.";
  }

  const changedText = changedSummary ? ` Updated fields: ${changedSummary}.` : "";
  return {
    title: `Incident Updated: ${displayName}`,
    message: `${actionSummary}${changedText}`.trim(),
  };
}
