import { promises as fs } from "node:fs";
import path from "node:path";
import { addDoc, collection, getDocs, limit as queryLimit, orderBy, query } from "firebase/firestore/lite";
import { ACTIVITY_LOG_ROWS } from "@/features/hris/mock-data";
import { getFirestoreDb, isFirestoreEnabled } from "@/lib/firebase";

const AUDIT_DIR = path.join(process.cwd(), "data");
const AUDIT_FILE = path.join(AUDIT_DIR, "audit-log.ndjson");
const MAX_AUDIT_ENTRIES = 2500;

let storeInitPromise;

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
    performedBy: row.performedBy || "system@clio.local",
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

function getRequestContext(request) {
  if (!request) {
    return {};
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientIp = forwardedFor ? forwardedFor.split(",")[0]?.trim() : request.headers.get("x-real-ip") || "unknown";

  return {
    requestMethod: request.method || "GET",
    requestPath: request.nextUrl?.pathname || "unknown",
    sourceIp: clientIp || "unknown",
    userAgent: request.headers.get("user-agent") || "unknown",
  };
}

function toUiEntry(entry) {
  return {
    id: entry.id || createAuditId(),
    activityName: entry.activityName || "HRIS Action",
    status: normalizeAuditStatus(entry.status),
    occurredAt: entry.occurredAt,
    relativeTime: formatRelativeTime(entry.occurredAt),
    loggedAt: formatLoggedAt(entry.occurredAt),
    module: entry.module || "System",
    performedBy: entry.performedBy || "system@clio.local",
    sensitivity: normalizeSensitivity(entry.sensitivity),
    sourceIp: entry.metadata?.sourceIp || "unknown",
    requestPath: entry.metadata?.requestPath || "unknown",
    requestMethod: entry.metadata?.requestMethod || "unknown",
    userAgent: entry.metadata?.userAgent || "unknown",
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
  performedBy = "system@clio.local",
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

  const db = await getFirestoreStore();
  if (db) {
    try {
      return await recordAuditEventToFirestore(db, entry);
    } catch {
      return await recordAuditEventToFile(entry);
    }
  }

  return await recordAuditEventToFile(entry);
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
