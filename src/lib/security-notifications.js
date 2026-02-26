import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit as queryLimit,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore/lite";
import { getFirestoreDb, isFirestoreEnabled } from "@/lib/firebase";
import { listUserAccounts } from "@/lib/user-accounts";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 120;
const MAX_READ_ALL_LIMIT = 300;

function nowIso() {
  return new Date().toISOString();
}

function asString(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function asBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return fallback;
    }
    if (["true", "1", "yes", "on", "y"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off", "n"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
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

function clampInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function parseEmailList(rawValue) {
  return String(rawValue || "")
    .split(",")
    .map((item) => normalizeEmail(item))
    .filter(Boolean);
}

function normalizeSeverity(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "high") return "high";
  if (normalized === "low") return "low";
  return "medium";
}

function normalizeNotificationStatus(value) {
  return String(value || "").trim().toLowerCase() === "read" ? "read" : "unread";
}

function getNotificationsCollectionName() {
  return asString(process.env.CLIO_FIRESTORE_NOTIFICATIONS_COLLECTION, "clio_notifications");
}

function getFirestoreStore() {
  if (!isFirestoreEnabled()) {
    return null;
  }
  return getFirestoreDb();
}

function toNotificationRecord(snapshot) {
  const payload = snapshot.data() || {};
  return {
    ...payload,
    id: snapshot.id,
    recordId: snapshot.id,
  };
}

function isVisibleNotification(row, recipientEmail) {
  const recipient = normalizeEmail(recipientEmail);
  const owner = normalizeEmail(row?.recipientEmail);
  const broadcast = asBoolean(row?.broadcast, false);
  return broadcast || (recipient && owner && recipient === owner);
}

function sortByCreatedDesc(left, right) {
  return new Date(right?.createdAt || 0).getTime() - new Date(left?.createdAt || 0).getTime();
}

function normalizeNotificationPayload(payload) {
  const now = nowIso();
  const recipientEmail = normalizeEmail(payload?.recipientEmail);
  const broadcast = asBoolean(payload?.broadcast, false);
  if (!recipientEmail && !broadcast) {
    throw new Error("invalid_notification_recipient");
  }

  return {
    title: asString(payload?.title, "Security notification"),
    message: asString(payload?.message, "A security event requires review."),
    severity: normalizeSeverity(payload?.severity),
    type: asString(payload?.type, "security"),
    module: asString(payload?.module, "Incident Management"),
    actionUrl: asString(payload?.actionUrl, "/incident-management"),
    recipientEmail,
    broadcast,
    status: normalizeNotificationStatus(payload?.status),
    metadata: asObject(payload?.metadata),
    createdAt: asString(payload?.createdAt, now),
    updatedAt: asString(payload?.updatedAt, now),
    readAt: asString(payload?.readAt, ""),
    createdBy: normalizeEmail(payload?.createdBy),
  };
}

export async function createInAppNotification(payload) {
  const db = getFirestoreStore();
  if (!db) {
    return null;
  }

  const normalized = normalizeNotificationPayload(payload);
  const ref = await addDoc(collection(db, getNotificationsCollectionName()), normalized);
  return {
    ...normalized,
    id: ref.id,
    recordId: ref.id,
  };
}

export async function createInAppNotificationsBulk(payloads) {
  const entries = asArray(payloads);
  if (entries.length === 0) {
    return [];
  }

  const created = [];
  for (const payload of entries) {
    const result = await createInAppNotification(payload);
    if (result) {
      created.push(result);
    }
  }
  return created;
}

export async function getInAppNotificationForRecipient(recordId, recipientEmail) {
  const db = getFirestoreStore();
  if (!db) {
    return null;
  }

  const normalizedId = asString(recordId);
  if (!normalizedId) {
    throw new Error("invalid_record_id");
  }

  const ref = doc(db, getNotificationsCollectionName(), normalizedId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    return null;
  }

  const current = toNotificationRecord(snapshot);
  if (!isVisibleNotification(current, recipientEmail)) {
    throw new Error("forbidden_notification_access");
  }

  return current;
}

export async function listInAppNotifications({
  recipientEmail,
  status = "all",
  limit = DEFAULT_LIST_LIMIT,
} = {}) {
  const db = getFirestoreStore();
  if (!db) {
    return {
      records: [],
      unreadCount: 0,
      totalScoped: 0,
    };
  }

  const normalizedStatus = String(status || "").trim().toLowerCase();
  const safeLimit = clampInt(limit, DEFAULT_LIST_LIMIT, { min: 1, max: MAX_LIST_LIMIT });
  const scanLimit = Math.max(safeLimit * 4, 100);

  const snapshot = await getDocs(
    query(
      collection(db, getNotificationsCollectionName()),
      orderBy("createdAt", "desc"),
      queryLimit(scanLimit),
    ),
  );

  const scoped = snapshot.docs.map(toNotificationRecord).filter((row) => isVisibleNotification(row, recipientEmail));
  const unreadCount = scoped.reduce((count, row) => count + (normalizeNotificationStatus(row?.status) === "unread" ? 1 : 0), 0);

  const statusFiltered = scoped.filter((row) => {
    if (normalizedStatus === "all" || !normalizedStatus) {
      return true;
    }
    return normalizeNotificationStatus(row?.status) === normalizedStatus;
  });

  return {
    records: statusFiltered.sort(sortByCreatedDesc).slice(0, safeLimit),
    unreadCount,
    totalScoped: scoped.length,
  };
}

export async function markInAppNotificationRead(recordId, recipientEmail) {
  const db = getFirestoreStore();
  if (!db) {
    return null;
  }

  const normalizedId = asString(recordId);
  if (!normalizedId) {
    throw new Error("invalid_record_id");
  }

  const ref = doc(db, getNotificationsCollectionName(), normalizedId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    return null;
  }

  const current = toNotificationRecord(snapshot);
  if (!isVisibleNotification(current, recipientEmail)) {
    throw new Error("forbidden_notification_access");
  }

  if (normalizeNotificationStatus(current.status) === "read") {
    return current;
  }

  const patched = {
    ...current,
    status: "read",
    readAt: nowIso(),
    updatedAt: nowIso(),
  };
  await updateDoc(ref, patched);
  return patched;
}

export async function resolveDeviceVerificationNotification(recordId, recipientEmail, decision) {
  const db = getFirestoreStore();
  if (!db) {
    return null;
  }

  const normalizedId = asString(recordId);
  if (!normalizedId) {
    throw new Error("invalid_record_id");
  }

  const normalizedRecipient = normalizeEmail(recipientEmail);
  const normalizedDecision = asString(decision).toLowerCase();
  if (normalizedDecision !== "confirm" && normalizedDecision !== "deny") {
    throw new Error("invalid_device_verification_decision");
  }

  const ref = doc(db, getNotificationsCollectionName(), normalizedId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    return null;
  }

  const current = toNotificationRecord(snapshot);
  if (!isVisibleNotification(current, normalizedRecipient)) {
    throw new Error("forbidden_notification_access");
  }

  const metadata = asObject(current?.metadata);
  const now = nowIso();
  const patched = {
    ...current,
    status: "read",
    readAt: asString(current?.readAt, now),
    updatedAt: now,
    metadata: {
      ...metadata,
      deviceVerificationDecision: normalizedDecision,
      deviceVerificationResolvedAt: now,
      deviceVerificationResponder: normalizedRecipient,
    },
  };

  await updateDoc(ref, patched);
  return patched;
}

export async function markAllInAppNotificationsRead({ recipientEmail, limit = 120 } = {}) {
  const normalizedRecipient = normalizeEmail(recipientEmail);
  if (!normalizedRecipient) {
    return {
      updatedCount: 0,
    };
  }

  const db = getFirestoreStore();
  if (!db) {
    return {
      updatedCount: 0,
    };
  }

  const safeLimit = clampInt(limit, 120, { min: 1, max: MAX_READ_ALL_LIMIT });
  const { records } = await listInAppNotifications({
    recipientEmail: normalizedRecipient,
    status: "unread",
    limit: safeLimit,
  });

  let updatedCount = 0;
  for (const row of records) {
    const recordId = asString(row?.id || row?.recordId);
    if (!recordId) {
      continue;
    }
    const ref = doc(db, getNotificationsCollectionName(), recordId);
    await updateDoc(ref, {
      status: "read",
      readAt: nowIso(),
      updatedAt: nowIso(),
    });
    updatedCount += 1;
  }

  return {
    updatedCount,
  };
}

export function resolveNotificationRecipients(values = []) {
  return Array.from(
    new Set(
      asArray(values)
        .map((value) => normalizeEmail(value))
        .filter(Boolean),
    ),
  );
}

export async function resolveIncidentStakeholderRecipients({
  ownerEmail,
  affectedEmployeeEmail,
  actorEmail,
  includeAffectedEmployee = true,
  includeActor = false,
} = {}) {
  const baseRecipients = [
    normalizeEmail(process.env.CLIO_GRC_ALERT_EMAIL),
    ...parseEmailList(process.env.GRC_EMAILS),
    normalizeEmail(ownerEmail),
  ];

  if (includeAffectedEmployee) {
    baseRecipients.push(normalizeEmail(affectedEmployeeEmail));
  }
  if (includeActor) {
    baseRecipients.push(normalizeEmail(actorEmail));
  }

  let dynamicRoleRecipients = [];
  try {
    const users = await listUserAccounts();
    dynamicRoleRecipients = asArray(users)
      .filter((user) => normalizeEmail(user?.email))
      .filter((user) => normalizeText(user?.status) === "active")
      .filter((user) => {
        const role = String(user?.role || "").trim().toUpperCase();
        return role === "GRC";
      })
      .map((user) => normalizeEmail(user?.email));
  } catch {
    dynamicRoleRecipients = [];
  }

  return resolveNotificationRecipients([...baseRecipients, ...dynamicRoleRecipients]);
}

export async function resolveGrcRecipients() {
  const baseRecipients = [
    normalizeEmail(process.env.CLIO_GRC_ALERT_EMAIL),
    ...parseEmailList(process.env.GRC_EMAILS),
  ];

  let dynamicRoleRecipients = [];
  try {
    const users = await listUserAccounts();
    dynamicRoleRecipients = asArray(users)
      .filter((user) => normalizeEmail(user?.email))
      .filter((user) => normalizeText(user?.status) === "active")
      .filter((user) => String(user?.role || "").trim().toUpperCase() === "GRC")
      .map((user) => normalizeEmail(user?.email));
  } catch {
    dynamicRoleRecipients = [];
  }

  return resolveNotificationRecipients([...baseRecipients, ...dynamicRoleRecipients]);
}
