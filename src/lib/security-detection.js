import {
  createIncidentRecordBackend,
  listIncidentRecordsBackend,
  updateIncidentRecordBackend,
} from "@/lib/hris-backend";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit as queryLimit,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore/lite";
import { getFirestoreDb, isFirestoreEnabled } from "@/lib/firebase";
import {
  createInAppNotificationsBulk,
  resolveIncidentStakeholderRecipients,
} from "@/lib/security-notifications";
import {
  dispatchSecurityIncidentAlerts,
  resolveSecurityAlertEmailRecipients,
} from "@/lib/security-alert-delivery";

const EVENT_COUNTER_WINDOWS = new Map();
const INCIDENT_COOLDOWN_CACHE = new Map();
const MAX_COUNTER_BUCKET_SIZE = 256;
const DEFAULT_SYSTEM_ACTOR = "system@gmail.com";
let IDS_RETRY_DRAIN_PROMISE = null;

const PERMISSION_DENIED_REASONS = new Set([
  "missing_permission",
  "role_not_allowed",
  "ownership_validation_failed",
  "unauthorized",
  "account_not_active",
  "session_role_mismatch",
  "session_version_mismatch",
]);
const ACCOUNT_ACCESS_BLOCK_REASONS = new Set([
  "account_disabled",
  "account_inactive",
  "account_archived",
  "offboarded_user",
]);
const PRIVILEGED_ROLE_KEYS = new Set(["SUPER_ADMIN", "GRC", "HR", "EA"]);

function nowIso() {
  return new Date().toISOString();
}

function asString(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return asString(value).toLowerCase();
}

function normalizeEmail(value) {
  return asString(value).toLowerCase();
}

function normalizeIp(value) {
  const ip = asString(value).toLowerCase();
  return ip || "unknown";
}

function normalizeRoleKey(value) {
  return asString(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toTimeMs(value) {
  const timestamp = new Date(value || "").getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function parseBooleanEnv(name, fallbackValue = false) {
  const raw = normalizeText(process.env[name]);
  if (!raw) {
    return fallbackValue;
  }
  return raw === "true" || raw === "1" || raw === "yes";
}

function parseIntegerEnv(name, fallbackValue, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(asString(process.env[name]), 10);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }
  return Math.min(max, Math.max(min, parsed));
}

function normalizeBaseUrl(value) {
  const raw = asString(value);
  if (!raw) {
    return "";
  }
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw.replace(/\/+$/, "");
  }
  return `https://${raw.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function resolveAppBaseUrl() {
  const configured = normalizeBaseUrl(process.env.CLIO_APP_BASE_URL);
  if (configured) {
    return configured;
  }

  const publicSiteUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL);
  if (publicSiteUrl) {
    return publicSiteUrl;
  }

  const firebaseAuthDomain = normalizeBaseUrl(
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
  );
  if (firebaseAuthDomain) {
    return firebaseAuthDomain;
  }

  const vercelUrl = normalizeBaseUrl(
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL,
  );
  if (vercelUrl) {
    return vercelUrl;
  }

  return "";
}

function getDetectionRetryQueueCollectionName() {
  return asString(process.env.CLIO_FIRESTORE_IDS_RETRY_COLLECTION, "clio_ids_retry_queue");
}

function getDetectionDeadLetterCollectionName() {
  return asString(process.env.CLIO_FIRESTORE_IDS_DEAD_LETTER_COLLECTION, "clio_ids_dead_letter");
}

function getDetectionQueueDb() {
  if (!isFirestoreEnabled()) {
    return null;
  }
  return getFirestoreDb();
}

function getDetectionConfig() {
  return {
    enabled: parseBooleanEnv("CLIO_IDS_ENABLED", true),
    authFailureThreshold: parseIntegerEnv("CLIO_IDS_AUTH_FAILURE_THRESHOLD", 5, { min: 2, max: 30 }),
    authFailureWindowMinutes: parseIntegerEnv("CLIO_IDS_AUTH_FAILURE_WINDOW_MINUTES", 10, { min: 1, max: 120 }),
    permissionDeniedThreshold: parseIntegerEnv("CLIO_IDS_PERMISSION_DENIED_THRESHOLD", 3, { min: 2, max: 20 }),
    permissionDeniedWindowMinutes: parseIntegerEnv("CLIO_IDS_PERMISSION_DENIED_WINDOW_MINUTES", 15, { min: 1, max: 120 }),
    exportSpikeThreshold: parseIntegerEnv("CLIO_IDS_EXPORT_SPIKE_THRESHOLD", 4, { min: 2, max: 20 }),
    exportSpikeWindowMinutes: parseIntegerEnv("CLIO_IDS_EXPORT_SPIKE_WINDOW_MINUTES", 20, { min: 1, max: 180 }),
    piiAccessSpikeThreshold: parseIntegerEnv("CLIO_IDS_PII_ACCESS_SPIKE_THRESHOLD", 12, { min: 4, max: 80 }),
    piiAccessSpikeWindowMinutes: parseIntegerEnv("CLIO_IDS_PII_ACCESS_SPIKE_WINDOW_MINUTES", 15, { min: 1, max: 180 }),
    offboardedAccessThreshold: parseIntegerEnv("CLIO_IDS_OFFBOARDED_ACCESS_THRESHOLD", 2, { min: 1, max: 30 }),
    offboardedAccessWindowMinutes: parseIntegerEnv("CLIO_IDS_OFFBOARDED_ACCESS_WINDOW_MINUTES", 30, { min: 1, max: 240 }),
    privilegedRoleChangeThreshold: parseIntegerEnv("CLIO_IDS_ROLE_ESCALATION_THRESHOLD", 2, { min: 1, max: 20 }),
    privilegedRoleChangeWindowMinutes: parseIntegerEnv("CLIO_IDS_ROLE_ESCALATION_WINDOW_MINUTES", 60, { min: 1, max: 480 }),
    breachWindowMinutes: parseIntegerEnv("CLIO_IDS_BREACH_WINDOW_MINUTES", 30, { min: 5, max: 240 }),
    breachExportThreshold: parseIntegerEnv("CLIO_IDS_BREACH_EXPORT_THRESHOLD", 2, { min: 1, max: 50 }),
    breachPiiThreshold: parseIntegerEnv("CLIO_IDS_BREACH_PII_THRESHOLD", 6, { min: 1, max: 120 }),
    breachDeniedThreshold: parseIntegerEnv("CLIO_IDS_BREACH_DENIED_THRESHOLD", 2, { min: 0, max: 50 }),
    incidentCooldownMinutes: parseIntegerEnv("CLIO_IDS_INCIDENT_COOLDOWN_MINUTES", 15, { min: 1, max: 360 }),
    maxRecipientCount: parseIntegerEnv("CLIO_IDS_MAX_RECIPIENTS", 20, { min: 1, max: 100 }),
    systemActorEmail: normalizeEmail(process.env.CLIO_IDS_SYSTEM_ACTOR_EMAIL) || DEFAULT_SYSTEM_ACTOR,
    appBaseUrl: resolveAppBaseUrl(),
    retryEnabled: parseBooleanEnv("CLIO_IDS_RETRY_ENABLED", true),
    retryBatchSize: parseIntegerEnv("CLIO_IDS_RETRY_BATCH_SIZE", 8, { min: 1, max: 32 }),
    retryMaxAttempts: parseIntegerEnv("CLIO_IDS_RETRY_MAX_ATTEMPTS", 5, { min: 1, max: 20 }),
    retryBaseBackoffSeconds: parseIntegerEnv("CLIO_IDS_RETRY_BASE_BACKOFF_SECONDS", 30, {
      min: 5,
      max: 3600,
    }),
    retryMaxBackoffSeconds: parseIntegerEnv("CLIO_IDS_RETRY_MAX_BACKOFF_SECONDS", 1800, {
      min: 30,
      max: 24 * 3600,
    }),
    retryCollectionName: getDetectionRetryQueueCollectionName(),
    deadLetterCollectionName: getDetectionDeadLetterCollectionName(),
  };
}

function pruneCounterWindow(values, currentTimeMs, windowMs) {
  const cutoff = currentTimeMs - windowMs;
  return values.filter((value) => value >= cutoff).slice(-MAX_COUNTER_BUCKET_SIZE);
}

function incrementCounterWindow(key, timestampMs, windowMs) {
  const normalizedKey = asString(key);
  if (!normalizedKey) {
    return 0;
  }
  const safeTimestamp = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  const existing = EVENT_COUNTER_WINDOWS.get(normalizedKey) || [];
  const pruned = pruneCounterWindow(existing, safeTimestamp, windowMs);
  pruned.push(safeTimestamp);
  EVENT_COUNTER_WINDOWS.set(normalizedKey, pruned);
  return pruned.length;
}

function getCounterCount(key, timestampMs, windowMs) {
  const normalizedKey = asString(key);
  if (!normalizedKey) {
    return 0;
  }
  const safeTimestamp = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  const existing = EVENT_COUNTER_WINDOWS.get(normalizedKey) || [];
  const pruned = pruneCounterWindow(existing, safeTimestamp, windowMs);
  EVENT_COUNTER_WINDOWS.set(normalizedKey, pruned);
  return pruned.length;
}

function cleanupIncidentCooldown(nowMs) {
  const current = Number.isFinite(nowMs) ? nowMs : Date.now();
  for (const [key, value] of INCIDENT_COOLDOWN_CACHE.entries()) {
    if (!Number.isFinite(value) || value <= current) {
      INCIDENT_COOLDOWN_CACHE.delete(key);
    }
  }
}

function isInIncidentCooldown(fingerprint, nowMs) {
  cleanupIncidentCooldown(nowMs);
  const expiresAt = INCIDENT_COOLDOWN_CACHE.get(fingerprint);
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

function rememberIncidentCooldown(fingerprint, nowMs, minutes) {
  const ttlMs = Math.max(1, Number(minutes || 1)) * 60 * 1000;
  INCIDENT_COOLDOWN_CACHE.set(fingerprint, nowMs + ttlMs);
}

function shouldSkipEvent(entry) {
  const metadata = asObject(entry?.metadata);
  if (metadata.skipAnomalyDetection === true || metadata.autoGenerated === true) {
    return true;
  }

  const moduleName = normalizeText(entry?.module);
  const requestPath = normalizeText(metadata.requestPath || entry?.requestPath);
  if (moduleName.includes("incident management")) {
    return true;
  }
  if (requestPath.startsWith("/api/notifications")) {
    return true;
  }
  return false;
}

function buildFingerprint(ruleId, entry, detection, nowMs, windowMinutes) {
  const actor = normalizeEmail(entry?.performedBy);
  const sourceIp = normalizeIp(entry?.metadata?.sourceIp || entry?.sourceIp);
  const moduleName = normalizeText(entry?.module || "");
  const target = normalizeEmail(detection?.affectedEmployeeEmail || entry?.metadata?.employeeEmail || "");
  const bucket = Math.floor(nowMs / (Math.max(1, Number(windowMinutes || 1)) * 60 * 1000));
  return [asString(ruleId), actor || "unknown", sourceIp, moduleName || "module", target || "none", bucket].join("|");
}

function buildCorrelationKey(ruleId, entry, detection) {
  const actor = normalizeEmail(entry?.performedBy);
  const sourceIp = normalizeIp(entry?.metadata?.sourceIp || entry?.sourceIp);
  const moduleName = normalizeText(entry?.module || "");
  const target = normalizeEmail(detection?.affectedEmployeeEmail || entry?.metadata?.employeeEmail || "");
  return [asString(ruleId), actor || "unknown", sourceIp, moduleName || "module", target || "none"].join("|");
}

function normalizeIncidentState(value) {
  return normalizeText(value).replace(/\s+/g, "_");
}

function isIncidentOpenForConsolidation(status) {
  const state = normalizeIncidentState(status);
  return !["resolved", "closed"].includes(state);
}

function toDetectionOccurrenceEntry(entry) {
  const metadata = asObject(entry?.metadata);
  return {
    at: asString(entry?.occurredAt, nowIso()),
    activityName: asString(entry?.activityName, "Activity"),
    module: asString(entry?.module, "System"),
    sourceEventId: asString(entry?.id),
    sourceIp: asString(metadata.sourceIp || entry?.sourceIp),
    requestPath: asString(metadata.requestPath || entry?.requestPath),
    requestMethod: asString(metadata.requestMethod || entry?.requestMethod),
    actorEmail: normalizeEmail(entry?.performedBy),
    targetEmployeeEmail: normalizeEmail(metadata.targetEmployeeEmail || metadata.employeeEmail || metadata.affectedEmployeeEmail),
  };
}

function chooseSeverity(baseSeverity, observedCount, threshold) {
  const severity = normalizeText(baseSeverity);
  if (severity === "critical") {
    return "High";
  }
  const safeThreshold = Math.max(1, Number(threshold || 1));
  if (observedCount >= safeThreshold * 2) {
    return "High";
  }
  if (severity === "high") {
    return "High";
  }
  return "Low";
}

function extractEventContext(entry) {
  const metadata = asObject(entry?.metadata);
  return {
    actorEmail: normalizeEmail(entry?.performedBy),
    status: normalizeText(entry?.status),
    moduleName: normalizeText(entry?.module),
    activityName: normalizeText(entry?.activityName),
    reason: normalizeText(metadata.reason),
    requestPath: normalizeText(metadata.requestPath || entry?.requestPath),
    requestMethod: normalizeText(metadata.requestMethod || entry?.requestMethod),
    sourceIp: normalizeIp(metadata.sourceIp || entry?.sourceIp),
    sensitivity: normalizeText(entry?.sensitivity),
    targetEmployeeEmail: normalizeEmail(metadata.targetEmployeeEmail || metadata.employeeEmail || metadata.affectedEmployeeEmail),
    ownerEmail: normalizeEmail(metadata.ownerEmail),
    targetRole: normalizeRoleKey(metadata.targetRole || metadata.assignedRole || ""),
    actorRole: normalizeRoleKey(metadata.actorRole || metadata.currentRole || ""),
    occurredAtMs: toTimeMs(entry?.occurredAt) || Date.now(),
  };
}

function isDeniedStatus(status) {
  return status === "failed" || status === "rejected";
}

function detectAuthFailureSpike(entry, context, config) {
  if (!context.moduleName.includes("authentication") || !isDeniedStatus(context.status)) {
    return null;
  }

  const key = `auth-fail:${context.sourceIp || context.actorEmail || "unknown"}`;
  const count = incrementCounterWindow(
    key,
    context.occurredAtMs,
    config.authFailureWindowMinutes * 60 * 1000,
  );
  if (count < config.authFailureThreshold) {
    return null;
  }

  const severity = chooseSeverity("high", count, config.authFailureThreshold);
  return {
    ruleId: "AUTH_BRUTE_FORCE",
    incidentType: "Credential Compromise",
    severity,
    restrictedPiiInvolved: false,
    observedCount: count,
    windowMinutes: config.authFailureWindowMinutes,
    affectedEmployeeEmail: context.actorEmail,
    title: "Repeated authentication failures detected",
    summary: `Detected ${count} failed/rejected authentication events from ${context.sourceIp} within ${config.authFailureWindowMinutes} minute(s).`,
    tags: ["authentication", "brute-force", "ids"],
  };
}

function detectPermissionDeniedSpike(entry, context, config) {
  const isPermissionDenied =
    isDeniedStatus(context.status) &&
    (PERMISSION_DENIED_REASONS.has(context.reason) ||
      context.activityName.includes("permission") ||
      context.activityName.includes("ownership") ||
      context.activityName.includes("forbidden"));
  if (!isPermissionDenied) {
    return null;
  }

  const key = `permission-denied:${context.actorEmail || context.sourceIp || "unknown"}`;
  const count = incrementCounterWindow(
    key,
    context.occurredAtMs,
    config.permissionDeniedWindowMinutes * 60 * 1000,
  );
  if (count < config.permissionDeniedThreshold) {
    return null;
  }

  const piiModule =
    context.moduleName.includes("employee records") ||
    context.moduleName.includes("performance") ||
    context.moduleName.includes("attendance");
  const severity = chooseSeverity(piiModule ? "high" : "low", count, config.permissionDeniedThreshold);
  return {
    ruleId: "UNAUTHORIZED_ACCESS_ATTEMPT",
    incidentType: "Unauthorized Access",
    severity,
    restrictedPiiInvolved: piiModule,
    observedCount: count,
    windowMinutes: config.permissionDeniedWindowMinutes,
    affectedEmployeeEmail: context.targetEmployeeEmail || context.actorEmail,
    title: "Repeated unauthorized access attempts detected",
    summary: `Detected ${count} permission/ownership denials for actor ${context.actorEmail || "unknown"} within ${config.permissionDeniedWindowMinutes} minute(s).`,
    tags: ["authorization", "idor", "least-privilege", "ids"],
  };
}

function detectExportSpike(entry, context, config) {
  const isExportActivity =
    context.moduleName.includes("export") ||
    context.requestPath.includes("/api/hris/exports") ||
    context.activityName.includes("export");
  if (!isExportActivity) {
    return null;
  }

  if (!(context.status === "approved" || context.status === "completed")) {
    return null;
  }

  const key = `export-spike:${context.actorEmail || context.sourceIp || "unknown"}`;
  const count = incrementCounterWindow(
    key,
    context.occurredAtMs,
    config.exportSpikeWindowMinutes * 60 * 1000,
  );
  if (count < config.exportSpikeThreshold) {
    return null;
  }

  const severity = chooseSeverity("high", count, config.exportSpikeThreshold);
  return {
    ruleId: "MASS_EXPORT_ACTIVITY",
    incidentType: "Data Exposure",
    severity,
    restrictedPiiInvolved: true,
    observedCount: count,
    windowMinutes: config.exportSpikeWindowMinutes,
    affectedEmployeeEmail: context.targetEmployeeEmail || "",
    title: "Mass export activity detected",
    summary: `Detected ${count} export-related actions by ${context.actorEmail || context.sourceIp} within ${config.exportSpikeWindowMinutes} minute(s).`,
    tags: ["export", "dlp", "ids"],
  };
}

function detectPiiAccessSpike(entry, context, config) {
  const isRecordViewActivity = context.activityName.includes("view") || context.activityName.includes("list");
  const isUnauthorizedRecordView =
    context.moduleName.includes("employee records") &&
    isRecordViewActivity &&
    isDeniedStatus(context.status) &&
    (PERMISSION_DENIED_REASONS.has(context.reason) ||
      context.activityName.includes("permission") ||
      context.activityName.includes("ownership") ||
      context.activityName.includes("forbidden"));
  if (!isUnauthorizedRecordView) {
    return null;
  }

  const key = `unauthorized-record-view:${context.actorEmail || context.sourceIp || "unknown"}`;
  const count = incrementCounterWindow(
    key,
    context.occurredAtMs,
    config.piiAccessSpikeWindowMinutes * 60 * 1000,
  );
  if (count < config.piiAccessSpikeThreshold) {
    return null;
  }

  const severity = chooseSeverity("high", count, config.piiAccessSpikeThreshold);
  return {
    ruleId: "UNAUTHORIZED_RECORD_VIEW_SPIKE",
    incidentType: "Unauthorized Access",
    severity,
    restrictedPiiInvolved: true,
    observedCount: count,
    windowMinutes: config.piiAccessSpikeWindowMinutes,
    affectedEmployeeEmail: context.targetEmployeeEmail || "",
    title: "Unauthorized employee-record view attempts detected",
    summary: `Detected ${count} denied employee-record view/list actions in ${config.piiAccessSpikeWindowMinutes} minute(s).`,
    tags: ["authorization", "employee-records", "pii", "ids"],
  };
}

function detectOffboardedAccessAttempt(entry, context, config) {
  const isAuthenticationModule = context.moduleName.includes("authentication") || context.requestPath.includes("/api/auth/");
  const isAccountBlockedAttempt =
    isDeniedStatus(context.status) &&
    (ACCOUNT_ACCESS_BLOCK_REASONS.has(context.reason) ||
      context.activityName.includes("account disabled") ||
      context.activityName.includes("account inactive") ||
      context.activityName.includes("offboard"));
  if (!(isAuthenticationModule && isAccountBlockedAttempt)) {
    return null;
  }

  const key = `offboarded-access:${context.actorEmail || context.sourceIp || "unknown"}`;
  const count = incrementCounterWindow(
    key,
    context.occurredAtMs,
    config.offboardedAccessWindowMinutes * 60 * 1000,
  );
  if (count < config.offboardedAccessThreshold) {
    return null;
  }

  const severity = chooseSeverity("high", count, config.offboardedAccessThreshold);
  return {
    ruleId: "OFFBOARDED_ACCESS_ATTEMPT",
    incidentType: "Unauthorized Access",
    severity,
    restrictedPiiInvolved: true,
    observedCount: count,
    windowMinutes: config.offboardedAccessWindowMinutes,
    affectedEmployeeEmail: context.actorEmail || context.targetEmployeeEmail,
    title: "Offboarded/disabled account access attempts detected",
    summary: `Detected ${count} blocked sign-in/access attempts for disabled or offboarded account ${context.actorEmail || "unknown"} within ${config.offboardedAccessWindowMinutes} minute(s).`,
    tags: ["authentication", "offboarding", "access-control", "ids"],
  };
}

function detectPrivilegedRoleAssignmentSpike(entry, context, config) {
  const isRoleAssignmentActivity =
    context.moduleName.includes("user management") &&
    context.activityName.includes("role updated") &&
    (context.status === "approved" || context.status === "completed");
  if (!isRoleAssignmentActivity) {
    return null;
  }
  if (!context.targetRole || !PRIVILEGED_ROLE_KEYS.has(context.targetRole)) {
    return null;
  }

  const key = `priv-role-assignment:${context.actorEmail || "unknown"}:${context.targetRole}`;
  const count = incrementCounterWindow(
    key,
    context.occurredAtMs,
    config.privilegedRoleChangeWindowMinutes * 60 * 1000,
  );
  if (count < config.privilegedRoleChangeThreshold) {
    return null;
  }

  const severity = chooseSeverity("high", count, config.privilegedRoleChangeThreshold);
  return {
    ruleId: "PRIVILEGED_ROLE_ASSIGNMENT_SPIKE",
    incidentType: "Policy Violation",
    severity,
    restrictedPiiInvolved: true,
    observedCount: count,
    windowMinutes: config.privilegedRoleChangeWindowMinutes,
    affectedEmployeeEmail: context.targetEmployeeEmail || "",
    title: "Privileged role assignment spike detected",
    summary: `Detected ${count} privileged role assignments (${context.targetRole}) by ${context.actorEmail || "unknown"} within ${config.privilegedRoleChangeWindowMinutes} minute(s).`,
    tags: ["rbac", "role-assignment", "privilege", "ids"],
  };
}

function detectPotentialBreach(entry, context, config) {
  const windowMs = config.breachWindowMinutes * 60 * 1000;
  const actorKey = context.actorEmail || context.sourceIp || "unknown";

  const isExportActivity =
    context.moduleName.includes("export") ||
    context.requestPath.includes("/api/hris/exports") ||
    context.activityName.includes("export");
  const isExportCompleted =
    isExportActivity && (context.status === "approved" || context.status === "completed");
  if (isExportCompleted) {
    incrementCounterWindow(`breach-export:${actorKey}`, context.occurredAtMs, windowMs);
  }

  const isPiiRead =
    context.sensitivity === "sensitive" &&
    context.moduleName.includes("employee records") &&
    (context.activityName.includes("view") || context.activityName.includes("list")) &&
    (context.status === "completed" || context.status === "approved");
  if (isPiiRead) {
    incrementCounterWindow(`breach-pii:${actorKey}`, context.occurredAtMs, windowMs);
  }

  const isPermissionDenied =
    isDeniedStatus(context.status) &&
    (PERMISSION_DENIED_REASONS.has(context.reason) ||
      context.activityName.includes("permission") ||
      context.activityName.includes("ownership") ||
      context.activityName.includes("forbidden"));
  if (isPermissionDenied) {
    incrementCounterWindow(`breach-denied:${actorKey}`, context.occurredAtMs, windowMs);
  }

  const exportCount = getCounterCount(`breach-export:${actorKey}`, context.occurredAtMs, windowMs);
  const piiCount = getCounterCount(`breach-pii:${actorKey}`, context.occurredAtMs, windowMs);
  const deniedCount = getCounterCount(`breach-denied:${actorKey}`, context.occurredAtMs, windowMs);

  const meetsExport = exportCount >= config.breachExportThreshold;
  const meetsPii = piiCount >= config.breachPiiThreshold;
  const meetsDenied = config.breachDeniedThreshold <= 0 || deniedCount >= config.breachDeniedThreshold;
  if (!(meetsExport && meetsPii && meetsDenied)) {
    return null;
  }

  const severity = chooseSeverity("high", exportCount + piiCount + deniedCount, Math.max(1, config.breachExportThreshold));
  return {
    ruleId: "POTENTIAL_BREACH_SIGNAL",
    incidentType: "Data Exposure",
    severity,
    restrictedPiiInvolved: true,
    observedCount: exportCount + piiCount + deniedCount,
    windowMinutes: config.breachWindowMinutes,
    affectedEmployeeEmail: context.targetEmployeeEmail || context.actorEmail,
    title: "Potential breach indicators detected",
    summary: `Detected ${exportCount} export action(s), ${piiCount} PII access event(s), and ${deniedCount} access denial(s) for ${actorKey} within ${config.breachWindowMinutes} minute(s).`,
    tags: ["breach-signal", "export", "pii", "ids"],
  };
}

function detectSuspiciousEvent(entry, context, config) {
  const rules = [
    detectAuthFailureSpike,
    detectPermissionDeniedSpike,
    detectOffboardedAccessAttempt,
    detectPrivilegedRoleAssignmentSpike,
    detectExportSpike,
    detectPiiAccessSpike,
    detectPotentialBreach,
  ];

  for (const detect of rules) {
    const match = detect(entry, context, config);
    if (match) {
      return match;
    }
  }
  return null;
}

function toNotificationTitle(incident, detection) {
  return asString(incident?.title || detection?.title, "Security anomaly detected");
}

function toNotificationMessage(incident, detection) {
  const severity = asString(incident?.severity || detection?.severity, "Medium");
  const code = asString(incident?.incidentCode, "INCIDENT");
  const summary = asString(incident?.summary || detection?.summary, "Review incident workbench for containment.");
  return `[${severity}] ${code}: ${summary}`;
}

function parseRoleEmails(value) {
  return asString(value)
    .split(",")
    .map((item) => normalizeEmail(item))
    .filter(Boolean);
}

function resolveOwnerEmail(entry, detection) {
  const preferredOwner =
    normalizeEmail(process.env.CLIO_GRC_ALERT_EMAIL) ||
    parseRoleEmails(process.env.GRC_EMAILS)[0] ||
    parseRoleEmails(process.env.SUPER_ADMIN_EMAILS)[0];
  if (preferredOwner) {
    return preferredOwner;
  }
  return normalizeEmail(detection?.affectedEmployeeEmail || entry?.metadata?.ownerEmail || entry?.performedBy || DEFAULT_SYSTEM_ACTOR);
}

async function resolveAlertRecipients(entry, detection, incident, config) {
  const owner = resolveOwnerEmail(entry, detection) || normalizeEmail(incident?.ownerEmail);
  const resolved = await resolveIncidentStakeholderRecipients({
    ownerEmail: owner,
    affectedEmployeeEmail: normalizeEmail(detection?.affectedEmployeeEmail),
    actorEmail: normalizeEmail(entry?.performedBy),
    includeAffectedEmployee: true,
    includeActor: true,
  });
  const withExplicitSecurityRecipients = resolveSecurityAlertEmailRecipients(resolved);
  return withExplicitSecurityRecipients.slice(0, config.maxRecipientCount);
}

function buildActionUrl(config, incidentId) {
  if (!incidentId) {
    return "/incident-management";
  }
  return `/incident-management?incident=${encodeURIComponent(incidentId)}`;
}

function buildAbsoluteActionUrl(config, actionPath) {
  const base = asString(config?.appBaseUrl).replace(/\/+$/, "");
  const path = asString(actionPath, "/incident-management");
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  if (!base) {
    return path.startsWith("/") ? path : `/${path}`;
  }
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function getRetryDelaySeconds(attempt, config) {
  const safeAttempt = Math.max(1, Number(attempt || 1));
  const baseSeconds = Math.max(5, Number(config?.retryBaseBackoffSeconds || 30));
  const maxSeconds = Math.max(baseSeconds, Number(config?.retryMaxBackoffSeconds || 1800));
  return Math.min(maxSeconds, baseSeconds * Math.pow(2, Math.max(0, safeAttempt - 1)));
}

function buildRetryQueueEntry({
  entry,
  detection,
  fingerprint,
  correlationKey,
  errorMessage,
  config,
  attempts = 1,
  source = "live",
  queuedAtIso = nowIso(),
}) {
  const safeAttempts = Math.max(1, Number(attempts || 1));
  const delaySeconds = getRetryDelaySeconds(safeAttempts, config);
  const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
  return {
    status: "pending",
    source: asString(source, "live"),
    attempts: safeAttempts,
    maxAttempts: Math.max(1, Number(config?.retryMaxAttempts || 5)),
    nextAttemptAt,
    lastError: asString(errorMessage, "ids_processing_failed"),
    fingerprint: asString(fingerprint),
    correlationKey: asString(correlationKey),
    entry: asObject(entry),
    detection: asObject(detection),
    createdAt: queuedAtIso,
    updatedAt: queuedAtIso,
  };
}

async function enqueueDetectionRetryWorkItem({
  entry,
  detection,
  fingerprint,
  correlationKey,
  errorMessage,
  config,
  attempts = 1,
  source = "live",
}) {
  if (!config?.retryEnabled) {
    return {
      queued: false,
      reason: "retry_disabled",
    };
  }

  const db = getDetectionQueueDb();
  if (!db) {
    return {
      queued: false,
      reason: "retry_queue_unavailable",
    };
  }

  const now = nowIso();
  const payload = buildRetryQueueEntry({
    entry,
    detection,
    fingerprint,
    correlationKey,
    errorMessage,
    config,
    attempts,
    source,
    queuedAtIso: now,
  });
  const ref = await addDoc(collection(db, config.retryCollectionName), payload);
  return {
    queued: true,
    retryRecordId: ref.id,
    attempts: payload.attempts,
    nextAttemptAt: payload.nextAttemptAt,
  };
}

async function listDueRetryQueueRecords(config, { batchSize } = {}) {
  const db = getDetectionQueueDb();
  if (!db) {
    return [];
  }

  const limitValue = Math.max(1, Number(batchSize || config?.retryBatchSize || 8));
  const scanLimit = Math.max(limitValue * 3, 16);
  const snapshot = await getDocs(
    query(
      collection(db, config.retryCollectionName),
      orderBy("nextAttemptAt", "asc"),
      queryLimit(scanLimit),
    ),
  );
  const nowMs = Date.now();
  return snapshot.docs
    .map((docSnapshot) => ({
      id: docSnapshot.id,
      ...(docSnapshot.data() || {}),
    }))
    .filter((row) => normalizeText(row?.status || "pending") === "pending")
    .filter((row) => {
      const nextAttemptMs = toTimeMs(row?.nextAttemptAt);
      return !Number.isFinite(nextAttemptMs) || nextAttemptMs <= nowMs;
    })
    .slice(0, limitValue);
}

async function moveRetryRecordToDeadLetter(config, record, reason) {
  const db = getDetectionQueueDb();
  if (!db) {
    return null;
  }

  const payload = {
    ...record,
    status: "dead-letter",
    deadLetteredAt: nowIso(),
    deadLetterReason: asString(reason, "ids_retry_exhausted"),
    originalRetryRecordId: asString(record?.id),
  };
  const ref = await addDoc(collection(db, config.deadLetterCollectionName), payload);
  return ref.id;
}

async function updateRetryQueueRecord(config, recordId, patch) {
  const db = getDetectionQueueDb();
  if (!db) {
    return;
  }
  await updateDoc(doc(db, config.retryCollectionName, recordId), {
    ...patch,
    updatedAt: nowIso(),
  });
}

async function deleteRetryQueueRecord(config, recordId) {
  const db = getDetectionQueueDb();
  if (!db) {
    return;
  }
  await deleteDoc(doc(db, config.retryCollectionName, recordId));
}

async function findConsolidationIncident({ correlationKey, fingerprint, nowMs, config }) {
  let rows = [];
  try {
    rows = await listIncidentRecordsBackend();
  } catch {
    rows = [];
  }

  const exactActiveMatch = asArray(rows).find((row) => {
    if (!isIncidentOpenForConsolidation(row?.status)) {
      return false;
    }
    const currentCorrelationKey = asString(row?.detectionCorrelationKey);
    if (currentCorrelationKey && currentCorrelationKey === correlationKey) {
      return true;
    }
    const currentFingerprint = asString(row?.detectionFingerprint);
    return Boolean(currentFingerprint && currentFingerprint === fingerprint);
  });
  if (exactActiveMatch) {
    return exactActiveMatch;
  }

  if (isInIncidentCooldown(fingerprint, nowMs)) {
    return { id: "", duplicateOnly: true };
  }

  return null;
}

async function mergeDetectionIntoIncident({
  incident,
  entry,
  detection,
  correlationKey,
  fingerprint,
  nowMs,
  config,
}) {
  if (!incident?.id) {
    return null;
  }
  const nextCount = Math.max(1, Number(incident?.alertOccurrenceCount || 1)) + 1;
  const previousOccurrences = asArray(incident?.alertOccurrences).slice(-39);
  const nextOccurrences = [...previousOccurrences, toDetectionOccurrenceEntry(entry)];
  const patchPayload = {
    detectionFingerprint: asString(incident?.detectionFingerprint || fingerprint),
    detectionCorrelationKey: asString(incident?.detectionCorrelationKey || correlationKey),
    detectionWindowEnd: new Date(nowMs).toISOString(),
    alertDescription: detection.summary,
    alertOccurrenceCount: nextCount,
    alertFirstObservedAt: asString(incident?.alertFirstObservedAt || incident?.detectedAt || nowIso()),
    alertLastObservedAt: asString(entry?.occurredAt, nowIso()),
    alertOccurrences: nextOccurrences,
    summary: detection.summary,
    notes: [
      asString(incident?.notes),
      `Latest alert occurrence #${nextCount}: ${asString(entry?.activityName, "Activity")} | ${asString(entry?.module, "System")} | ${asString(entry?.occurredAt, nowIso())} | Source IP: ${asString(entry?.metadata?.sourceIp || entry?.sourceIp, "unknown")}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };

  const updated = await updateIncidentRecordBackend(incident.id, patchPayload, config.systemActorEmail);
  rememberIncidentCooldown(fingerprint, nowMs, config.incidentCooldownMinutes);
  return updated;
}

async function createAutoIncident(entry, detection, config, fingerprint, correlationKey, nowMs) {
  const occurredAt = asString(entry?.occurredAt, nowIso());
  const ownerEmail = resolveOwnerEmail(entry, detection);
  const actorEmail = config.systemActorEmail || DEFAULT_SYSTEM_ACTOR;
  const sourceMetadata = asObject(entry?.metadata);
  const targetEmployee = asString(
    sourceMetadata.targetEmployeeEmail || sourceMetadata.employeeEmail || detection.affectedEmployeeEmail,
    "",
  );
  const recordLabel = asString(sourceMetadata.resourceLabel || sourceMetadata.recordRef || sourceMetadata.recordId, "");
  const viewedFields = asArray(sourceMetadata.viewedFields, []);
  const accessedDocuments = asArray(sourceMetadata.accessedDocuments, []);
  const firstObservedAt = asString(entry?.occurredAt, nowIso());
  const firstOccurrence = toDetectionOccurrenceEntry(entry);
  const payload = {
    title: detection.title,
    summary: detection.summary,
    incidentType: detection.incidentType,
    severity: detection.severity,
    status: "Open",
    restrictedPiiInvolved: Boolean(detection.restrictedPiiInvolved),
    affectedEmployeeEmail: normalizeEmail(detection.affectedEmployeeEmail || sourceMetadata.targetEmployeeEmail || ""),
    ownerEmail,
    detectedAt: occurredAt,
    escalationRequired: true,
    containmentStatus: "Not Started",
    impactAssessmentStatus: "Pending",
    regulatoryNotificationRequired: Boolean(detection.restrictedPiiInvolved),
    documentationRetained: true,
    classificationStandard: "CLIO-IDS-V1",
    notes: [
      `Auto-generated by CLIO IDS rule: ${detection.ruleId}`,
      `Observed count: ${Number(detection.observedCount || 0)}`,
      `Window: ${Number(detection.windowMinutes || 0)} minute(s)`,
      targetEmployee ? `Target employee: ${targetEmployee}` : null,
      recordLabel ? `Record reference: ${recordLabel}` : null,
      viewedFields.length > 0 ? `Viewed fields: ${viewedFields.slice(0, 12).join(", ")}` : null,
      accessedDocuments.length > 0
        ? `Accessed documents: ${accessedDocuments
            .map((doc) => asString(doc?.name || doc?.ref || doc?.id))
            .filter(Boolean)
            .slice(0, 6)
            .join(", ")}`
        : null,
      `Source event: ${asString(entry?.id, "N/A")} | ${asString(entry?.module, "System")} | ${asString(entry?.activityName, "Activity")}`,
      `Source IP: ${asString(sourceMetadata.sourceIp || entry?.sourceIp, "unknown")}`,
      `Request: ${asString(sourceMetadata.requestMethod || entry?.requestMethod, "GET")} ${asString(sourceMetadata.requestPath || entry?.requestPath, "unknown")}`,
    ]
      .filter(Boolean)
      .join("\n"),
    autoGenerated: true,
    detectionRuleId: detection.ruleId,
    detectionFingerprint: fingerprint,
    detectionCorrelationKey: correlationKey,
    detectionWindowStart: new Date(nowMs - detection.windowMinutes * 60 * 1000).toISOString(),
    detectionWindowEnd: new Date(nowMs).toISOString(),
    alertDescription: detection.summary,
    alertOccurrenceCount: 1,
    alertFirstObservedAt: firstObservedAt,
    alertLastObservedAt: firstObservedAt,
    alertOccurrences: [firstOccurrence],
    sourceSystem: "CLIO_IDS",
    sourceEventId: asString(entry?.id),
    sourceEventModule: asString(entry?.module),
    sourceEventPath: asString(sourceMetadata.requestPath || entry?.requestPath),
    sourceIp: asString(sourceMetadata.sourceIp || entry?.sourceIp),
    alertRecipients: [],
    actionUrl: "/incident-management",
  };

  const created = await createIncidentRecordBackend(payload, actorEmail);
  rememberIncidentCooldown(fingerprint, nowMs, config.incidentCooldownMinutes);
  return created;
}

async function createInAppIncidentNotifications({
  incident,
  detection,
  recipients,
  actionUrl,
  actorEmail,
}) {
  const notifications = recipients.map((recipientEmail) => ({
    recipientEmail,
    title: toNotificationTitle(incident, detection),
    message: toNotificationMessage(incident, detection),
    severity: normalizeText(incident?.severity || detection?.severity || "medium"),
    type: "security-anomaly",
    module: "Incident Management",
    actionUrl,
    status: "unread",
    createdBy: actorEmail,
    metadata: {
      incidentId: asString(incident?.id || incident?.recordId),
      incidentCode: asString(incident?.incidentCode),
      detectionRuleId: asString(detection?.ruleId),
      autoGenerated: true,
    },
  }));
  return await createInAppNotificationsBulk(notifications);
}

async function executeDetectionWorkflow({
  entry,
  detection,
  config,
  fingerprint,
  correlationKey,
  nowMs,
}) {
  const existingIncident = await findConsolidationIncident({
    correlationKey,
    fingerprint,
    nowMs,
    config,
  });
  if (existingIncident?.duplicateOnly) {
    return {
      detected: true,
      duplicate: true,
      detection,
      fingerprint,
      correlationKey,
    };
  }
  if (existingIncident?.id) {
    const updatedIncident = await mergeDetectionIntoIncident({
      incident: existingIncident,
      entry,
      detection,
      correlationKey,
      fingerprint,
      nowMs,
      config,
    });
    return {
      detected: true,
      duplicate: true,
      consolidated: true,
      detection,
      fingerprint,
      correlationKey,
      incidentRecord: updatedIncident || existingIncident,
    };
  }

  const incident = await createAutoIncident(entry, detection, config, fingerprint, correlationKey, nowMs);
  const actionUrl = buildActionUrl(config, incident?.id || incident?.recordId);
  const absoluteActionUrl = buildAbsoluteActionUrl(config, actionUrl);
  const recipients = await resolveAlertRecipients(entry, detection, incident, config);
  const inAppNotifications = await createInAppIncidentNotifications({
    incident,
    detection,
    recipients,
    actionUrl,
    actorEmail: config.systemActorEmail,
  });
  const deliverySummary = await dispatchSecurityIncidentAlerts({
    incident: {
      ...incident,
      actionUrl: absoluteActionUrl,
    },
    detection,
    sourceEvent: entry,
    emailRecipients: recipients,
  });

  const patchPayload = {
    alertRecipients: recipients,
    alertDispatchSummary: deliverySummary,
    externalIntegrations: {
      webhooks: deliverySummary?.webhooks || {},
    },
    lastAlertDispatchAt: nowIso(),
  };
  await updateIncidentRecordBackend(incident.id, patchPayload, config.systemActorEmail).catch(() => null);

  return {
    detected: true,
    duplicate: false,
    detection,
    incidentRecord: incident,
    fingerprint,
    recipients,
    inAppNotificationCount: inAppNotifications.length,
    deliverySummary,
  };
}

function hasForcedDetectionPayload(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function processSingleRetryQueueRecord(config, row) {
  const recordId = asString(row?.id);
  if (!recordId) {
    return { processed: false, reason: "missing_retry_record_id" };
  }

  const attempts = Math.max(1, Number(row?.attempts || 1));
  const maxAttempts = Math.max(1, Number(row?.maxAttempts || config.retryMaxAttempts || 5));
  const entry = asObject(row?.entry);
  const detection = asObject(row?.detection);
  const fingerprint = asString(row?.fingerprint);
  const correlationKey = asString(row?.correlationKey);
  if (!fingerprint || !asString(detection?.ruleId) || (!asString(entry?.activityName) && !asString(entry?.module))) {
    await moveRetryRecordToDeadLetter(config, row, "invalid_retry_payload");
    await deleteRetryQueueRecord(config, recordId);
    return { processed: false, deadLettered: true, reason: "invalid_retry_payload" };
  }

  const result = await processAuditEventForSecurityDetections(entry, {
    forcedDetection: detection,
    forcedFingerprint: fingerprint,
    forcedCorrelationKey: correlationKey,
    skipQueueOnError: true,
    disableQueueDrain: true,
  });

  if (!result?.failed) {
    await deleteRetryQueueRecord(config, recordId);
    return {
      processed: true,
      duplicate: Boolean(result?.duplicate),
      detected: Boolean(result?.detected),
    };
  }

  const nextAttempts = attempts + 1;
  const errorMessage = asString(result?.error, "ids_processing_failed");
  if (nextAttempts > maxAttempts) {
    await moveRetryRecordToDeadLetter(config, {
      ...row,
      attempts: nextAttempts,
      maxAttempts,
      lastError: errorMessage,
    }, errorMessage);
    await deleteRetryQueueRecord(config, recordId);
    return {
      processed: false,
      deadLettered: true,
      reason: errorMessage,
    };
  }

  const nextAttemptAt = new Date(Date.now() + getRetryDelaySeconds(nextAttempts, config) * 1000).toISOString();
  await updateRetryQueueRecord(config, recordId, {
    attempts: nextAttempts,
    maxAttempts,
    nextAttemptAt,
    lastError: errorMessage,
    status: "pending",
  });

  return {
    processed: false,
    retried: true,
    reason: errorMessage,
    nextAttemptAt,
  };
}

export async function drainSecurityDetectionRetryQueue({ reason = "manual", batchSize } = {}) {
  const config = getDetectionConfig();
  if (!config.enabled || !config.retryEnabled) {
    return {
      processedCount: 0,
      reason: !config.enabled ? "ids_disabled" : "retry_disabled",
    };
  }

  if (IDS_RETRY_DRAIN_PROMISE) {
    return IDS_RETRY_DRAIN_PROMISE;
  }

  IDS_RETRY_DRAIN_PROMISE = (async () => {
    const dueRecords = await listDueRetryQueueRecords(config, {
      batchSize: Number(batchSize || config.retryBatchSize || 8),
    });
    let processedCount = 0;
    let deadLetterCount = 0;
    let failedCount = 0;

    for (const row of dueRecords) {
      try {
        const result = await processSingleRetryQueueRecord(config, row);
        if (result?.processed) {
          processedCount += 1;
        }
        if (result?.deadLettered) {
          deadLetterCount += 1;
        }
      } catch {
        failedCount += 1;
      }
    }

    return {
      reason: asString(reason, "manual"),
      processedCount,
      deadLetterCount,
      failedCount,
      dueCount: dueRecords.length,
    };
  })();

  try {
    return await IDS_RETRY_DRAIN_PROMISE;
  } finally {
    IDS_RETRY_DRAIN_PROMISE = null;
  }
}

export async function processAuditEventForSecurityDetections(entry, options = {}) {
  const config = getDetectionConfig();
  if (!config.enabled) {
    return {
      detected: false,
      reason: "ids_disabled",
    };
  }

  if (!entry || typeof entry !== "object") {
    return {
      detected: false,
      reason: "invalid_audit_entry",
    };
  }

  if (!options?.disableQueueDrain && config.retryEnabled) {
    void drainSecurityDetectionRetryQueue({ reason: "audit-event" }).catch(() => null);
  }

  const forcedDetection = hasForcedDetectionPayload(options?.forcedDetection)
    ? options.forcedDetection
    : null;
  if (!forcedDetection && shouldSkipEvent(entry)) {
    return {
      detected: false,
      reason: "event_skipped",
    };
  }

  const context = extractEventContext(entry);
  const detection = forcedDetection || detectSuspiciousEvent(entry, context, config);
  if (!detection) {
    return {
      detected: false,
      reason: "no_rule_match",
    };
  }

  const nowMs = context.occurredAtMs || Date.now();
  const fingerprint =
    asString(options?.forcedFingerprint) ||
    buildFingerprint(
      detection.ruleId,
      entry,
      detection,
      nowMs,
      detection.windowMinutes || config.incidentCooldownMinutes,
    );
  const correlationKey =
    asString(options?.forcedCorrelationKey) || buildCorrelationKey(detection.ruleId, entry, detection);

  try {
    return await executeDetectionWorkflow({
      entry,
      detection,
      config,
      fingerprint,
      correlationKey,
      nowMs,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? asString(error.message, "ids_processing_failed") : "ids_processing_failed";
    if (options?.skipQueueOnError) {
      return {
        detected: true,
        duplicate: false,
        failed: true,
        detection,
        fingerprint,
        reason: "processing_failed",
        error: errorMessage,
      };
    }

    const queueResult = await enqueueDetectionRetryWorkItem({
      entry,
      detection,
      fingerprint,
      correlationKey,
      errorMessage,
      config,
      attempts: 1,
      source: "live",
    });
    return {
      detected: true,
      duplicate: false,
      failed: true,
      queuedForRetry: Boolean(queueResult?.queued),
      retryRecordId: asString(queueResult?.retryRecordId),
      detection,
      fingerprint,
      reason: "processing_failed",
      error: errorMessage,
    };
  }
}
