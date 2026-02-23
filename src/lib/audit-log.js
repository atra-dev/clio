import { promises as fs } from "node:fs";
import path from "node:path";
import { addDoc, collection, getDocs, limit as queryLimit, orderBy, query } from "firebase/firestore/lite";
import { ACTIVITY_LOG_ROWS } from "@/features/hris/mock-data";
import { getFirestoreDb, isFirestoreEnabled } from "@/lib/firebase";

const AUDIT_DIR = path.join(process.cwd(), "data");
const AUDIT_FILE = path.join(AUDIT_DIR, "audit-log.ndjson");
const MAX_AUDIT_ENTRIES = 2500;

let storeInitPromise;
let securityDetectionModulePromise;

function toIsoDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function createAuditId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AUD-${timestamp}-${random}`;
}

function mapSeedRowsToEntries() {
  return ACTIVITY_LOG_ROWS.map((row) => ({
    id: row.id || createAuditId(),
    activityName: row.activityName || "Legacy Audit Event",
    status: row.status || "Completed",
    occurredAt: toIsoDate(row.loggedAt),
    module: row.module || "System",
    performedBy: row.performedBy || "system@gmail.com",
    sensitivity: row.status === "Failed" || row.status === "Rejected" ? "Sensitive" : "Non-sensitive",
    metadata: {
      seeded: true,
      relativeTime: row.relativeTime || "N/A",
    },
  }));
}

function getAuditCollectionName() {
  return String(process.env.CLIO_FIRESTORE_AUDIT_COLLECTION || "clio_audit_logs").trim() || "clio_audit_logs";
}

async function getFirestoreStore() {
  if (!isFirestoreEnabled()) {
    return null;
  }
  return getFirestoreDb();
}

function parseAuditLine(line) {
  try {
    const parsed = JSON.parse(line);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function formatLoggedAt(isoValue) {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  const datePart = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date);

  const timePart = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);

  return `${datePart} ${timePart}`;
}

function formatRelativeTime(isoValue) {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }

  const now = Date.now();
  const diffMs = Math.max(0, now - date.getTime());
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffMinutes < 1) {
    return "just now";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function normalizeAuditStatus(status) {
  const valid = new Set(["Completed", "Approved", "Pending", "Failed", "Rejected"]);
  return valid.has(status) ? status : "Completed";
}

function normalizeSensitivity(value) {
  return value === "Sensitive" ? "Sensitive" : "Non-sensitive";
}

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return metadata;
}

function resolveBrowser(userAgent) {
  const ua = normalizeText(userAgent).toLowerCase();
  if (!ua || ua === "unknown") {
    return "Unknown Browser";
  }
  if (ua.includes("edg/")) return "Microsoft Edge";
  if (ua.includes("opr/") || ua.includes("opera")) return "Opera";
  if (ua.includes("firefox/")) return "Firefox";
  if (ua.includes("safari/") && !ua.includes("chrome/")) return "Safari";
  if (ua.includes("chrome/")) return "Chrome";
  return "Browser";
}

function resolveOperatingSystem(userAgent) {
  const ua = normalizeText(userAgent).toLowerCase();
  if (!ua || ua === "unknown") {
    return "Unknown OS";
  }
  if (ua.includes("windows")) return "Windows";
  if (ua.includes("mac os x") || ua.includes("macintosh")) return "macOS";
  if (ua.includes("android")) return "Android";
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios")) return "iOS";
  if (ua.includes("linux")) return "Linux";
  return "OS";
}

function resolveDeviceSummary(userAgent, browserName, operatingSystem) {
  const ua = normalizeText(userAgent).toLowerCase();
  const browser = normalizeText(browserName, "Unknown Browser");
  const os = normalizeText(operatingSystem, "Unknown OS");
  const deviceType = ua.includes("mobile")
    ? "Mobile"
    : ua.includes("tablet")
      ? "Tablet"
      : "Desktop";
  return {
    deviceType,
    deviceSummary: `${browser} on ${os}`,
  };
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toStringList(value) {
  return toArray(value)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function toDocumentList(value) {
  return toArray(value)
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const name = normalizeText(item.name);
      const id = normalizeText(item.id || item.recordId);
      const type = normalizeText(item.type);
      if (!name && !id && !type) {
        return null;
      }
      return {
        name: name || "Employee Document",
        id: id || "",
        type: type || "General",
      };
    })
    .filter(Boolean);
}

function resolveRecordReference(entry) {
  const metadata = normalizeMetadata(entry?.metadata);
  const candidates = [
    metadata.recordRef,
    metadata.recordId,
    metadata.employeeId,
    metadata.workflowId,
    metadata.templateId,
    metadata.exportId,
  ];
  for (const value of candidates) {
    const normalized = normalizeText(value);
    if (normalized) {
      return normalized;
    }
  }
  return "N/A";
}

function getRequestContext(request) {
  if (!request) {
    return {};
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientIp = forwardedFor ? forwardedFor.split(",")[0]?.trim() : request.headers.get("x-real-ip") || "unknown";
  const userAgent = request.headers.get("user-agent") || "unknown";
  const browser = resolveBrowser(userAgent);
  const operatingSystem = resolveOperatingSystem(userAgent);
  const { deviceType, deviceSummary } = resolveDeviceSummary(userAgent, browser, operatingSystem);

  return {
    requestMethod: request.method || "GET",
    requestPath: request.nextUrl?.pathname || "unknown",
    sourceIp: clientIp || "unknown",
    userAgent,
    browser,
    operatingSystem,
    deviceType,
    deviceSummary,
  };
}

function shouldSkipSecurityDetection(entry) {
  const metadata = normalizeMetadata(entry?.metadata);
  if (metadata.skipAnomalyDetection === true || metadata.autoGenerated === true) {
    return true;
  }
  const moduleName = normalizeText(entry?.module).toLowerCase();
  if (moduleName.includes("incident management")) {
    return true;
  }
  return false;
}

async function getSecurityDetectionModule() {
  if (!securityDetectionModulePromise) {
    securityDetectionModulePromise = import("@/lib/security-detection");
  }
  return securityDetectionModulePromise;
}

function queueSecurityDetection(entry) {
  if (shouldSkipSecurityDetection(entry)) {
    return;
  }

  void (async () => {
    const detectionModule = await getSecurityDetectionModule();
    const result = await detectionModule.processAuditEventForSecurityDetections(entry);
    if (!result?.detected || result?.duplicate || !result?.incidentRecord?.id) {
      return;
    }

    await recordAuditEvent({
      activityName: `Auto incident created by IDS (${normalizeText(result?.detection?.ruleId, "rule")})`,
      status: "Approved",
      module: "Incident Management",
      performedBy: String(process.env.CLIO_IDS_SYSTEM_ACTOR_EMAIL || "system@gmail.com").trim().toLowerCase() || "system@gmail.com",
      sensitivity: "Sensitive",
      metadata: {
        skipAnomalyDetection: true,
        autoGenerated: true,
        recordId: result.incidentRecord.id,
        incidentCode: result.incidentRecord.incidentCode || "",
        detectionRuleId: result?.detection?.ruleId || "",
        detectionFingerprint: result?.fingerprint || "",
        recipients: Array.isArray(result.recipients) ? result.recipients : [],
        inAppNotificationCount: Number(result.inAppNotificationCount || 0),
        webhookStatus: result?.deliverySummary?.webhooks?.status || "skipped",
        emailDispatchStatus: result?.deliverySummary?.email?.status || "skipped",
        smsDispatchStatus: result?.deliverySummary?.sms?.status || "skipped",
        auditNote: `IDS detected suspicious activity and opened incident ${result.incidentRecord.incidentCode || result.incidentRecord.id}.`,
        nextAction: "Review Incident Management workbench and execute containment workflow.",
      },
    });
  })().catch(() => null);
}

function toUiEntry(entry) {
  const metadata = normalizeMetadata(entry?.metadata);
  const userAgent = metadata.userAgent || "unknown";
  const browser = normalizeText(metadata.browser) || resolveBrowser(userAgent);
  const operatingSystem = normalizeText(metadata.operatingSystem) || resolveOperatingSystem(userAgent);
  const { deviceType, deviceSummary } = resolveDeviceSummary(userAgent, browser, operatingSystem);
  const changedFields = toStringList(metadata.changedFields || metadata.updatedFields);
  const viewedFields = toStringList(metadata.viewedFields);
  const accessedDocuments = toDocumentList(
    metadata.accessedDocuments ||
      metadata.viewedDocuments ||
      metadata.documentChanges?.added ||
      metadata.documents,
  );

  return {
    id: entry.id || createAuditId(),
    activityName: entry.activityName || "HRIS Action",
    status: normalizeAuditStatus(entry.status),
    occurredAt: entry.occurredAt,
    relativeTime: formatRelativeTime(entry.occurredAt),
    loggedAt: formatLoggedAt(entry.occurredAt),
    module: entry.module || "System",
    performedBy: entry.performedBy || "system@gmail.com",
    sensitivity: normalizeSensitivity(entry.sensitivity),
    sourceIp: metadata.sourceIp || "unknown",
    requestPath: metadata.requestPath || "unknown",
    requestMethod: metadata.requestMethod || "unknown",
    userAgent,
    browser,
    operatingSystem,
    deviceType,
    deviceSummary,
    recordRef: resolveRecordReference(entry),
    auditNote: normalizeText(
      metadata.auditNote,
      `Change logged under ${entry.module || "System"} module and included in HRIS compliance trail.`,
    ),
    nextAction: normalizeText(
      metadata.nextAction,
      entry.status === "Failed" || entry.status === "Pending" || entry.status === "Rejected"
        ? "Review and resolve with assigned owner."
        : "No further action required.",
    ),
    changedFields,
    viewedFields,
    accessedDocuments,
    metadata,
  };
}

async function ensureAuditStore() {
  if (!storeInitPromise) {
    storeInitPromise = (async () => {
      await fs.mkdir(AUDIT_DIR, { recursive: true });

      try {
        await fs.access(AUDIT_FILE);
      } catch {
        const seedEntries = mapSeedRowsToEntries();
        const content = seedEntries.map((item) => JSON.stringify(item)).join("\n");
        await fs.writeFile(AUDIT_FILE, `${content}\n`, "utf8");
      }
    })();
  }

  return storeInitPromise;
}

async function readAuditEntriesFromFile() {
  await ensureAuditStore();
  const content = await fs.readFile(AUDIT_FILE, "utf8").catch(() => "");
  if (!content.trim()) {
    return [];
  }

  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseAuditLine)
    .filter(Boolean);
}

async function recordAuditEventToFile(entry) {
  try {
    await ensureAuditStore();
    await fs.appendFile(AUDIT_FILE, `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  } catch {
    return null;
  }
}

async function ensureFirestoreAuditSeed(db) {
  const collectionName = getAuditCollectionName();
  const snapshot = await getDocs(query(collection(db, collectionName), queryLimit(1)));
  if (!snapshot.empty) {
    return;
  }

  const seedEntries = mapSeedRowsToEntries();
  for (const entry of seedEntries) {
    await addDoc(collection(db, collectionName), entry);
  }
}

async function readAuditEntriesFromFirestore(db, limitCount) {
  const collectionName = getAuditCollectionName();
  await ensureFirestoreAuditSeed(db);

  const safeLimit = Math.min(Math.max(Number(limitCount) || 0, 1), MAX_AUDIT_ENTRIES);
  const snapshot = await getDocs(
    query(collection(db, collectionName), orderBy("occurredAt", "desc"), queryLimit(safeLimit)),
  );

  return snapshot.docs
    .map((item) => {
      const payload = item.data();
      return {
        ...payload,
        id: payload?.id || item.id,
      };
    })
    .filter((item) => item?.occurredAt);
}

async function recordAuditEventToFirestore(db, entry) {
  const collectionName = getAuditCollectionName();
  await addDoc(collection(db, collectionName), entry);
  return entry;
}

export async function recordAuditEvent({
  activityName,
  status = "Completed",
  module = "System",
  performedBy = "system@gmail.com",
  sensitivity = "Non-sensitive",
  metadata = {},
  occurredAt,
  request,
}) {
  const entry = {
    id: createAuditId(),
    activityName: activityName || "HRIS Action",
    status: normalizeAuditStatus(status),
    occurredAt: toIsoDate(occurredAt),
    module,
    performedBy,
    sensitivity: normalizeSensitivity(sensitivity),
    metadata: {
      ...metadata,
      ...getRequestContext(request),
    },
  };

  let persistedEntry;
  const db = await getFirestoreStore();
  if (db) {
    try {
      persistedEntry = await recordAuditEventToFirestore(db, entry);
      queueSecurityDetection(persistedEntry || entry);
      return persistedEntry;
    } catch {
      persistedEntry = await recordAuditEventToFile(entry);
      queueSecurityDetection(persistedEntry || entry);
      return persistedEntry;
    }
  }

  persistedEntry = await recordAuditEventToFile(entry);
  queueSecurityDetection(persistedEntry || entry);
  return persistedEntry;
}

export async function listAuditEvents({ limit = 400 } = {}) {
  const db = await getFirestoreStore();
  if (db) {
    try {
      const remoteEntries = await readAuditEntriesFromFirestore(db, limit);
      return remoteEntries.map(toUiEntry);
    } catch {
      const fallbackEntries = await readAuditEntriesFromFile().catch(() => []);
      const sortedFallback = fallbackEntries
        .filter((entry) => entry?.occurredAt)
        .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
        .slice(0, Math.min(Math.max(Number(limit) || 0, 1), MAX_AUDIT_ENTRIES));

      return sortedFallback.map(toUiEntry);
    }
  }

  const entries = await readAuditEntriesFromFile().catch(() => []);

  const sorted = entries
    .filter((entry) => entry?.occurredAt)
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, Math.min(Math.max(Number(limit) || 0, 1), MAX_AUDIT_ENTRIES));

  return sorted.map(toUiEntry);
}

