import {
  addDoc,
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore/lite";
import { getFirestoreDb, isFirestoreEnabled } from "@/lib/firebase";
import {
  archiveUserAccount,
  getLoginAccount,
  inviteUserAccount,
  listUserAccounts,
  purgeDueArchivedUserAccounts,
  revokeInviteById,
  updateUserAccountRole,
  updateUserAccountStatus,
} from "@/lib/user-accounts";
import { deliverInviteEmail } from "@/lib/invite-delivery";
import { formatEmployeeName } from "@/lib/name-utils";
import { listAuditEvents } from "@/lib/audit-log";

const MAX_AUDIT_TRAIL_ITEMS = 80;
const DEFAULT_ARCHIVE_RETENTION_YEARS = 5;
const MAX_LIFECYCLE_CHECKLIST_ITEMS = 32;
const MAX_LIFECYCLE_EVIDENCE_ITEMS = 80;
const MAX_INCIDENT_EVIDENCE_ITEMS = 50;
const MAX_INCIDENT_FORENSIC_SAMPLES = 8;
const MAX_REFERENCE_LABEL_LENGTH = 72;
const MAX_REFERENCE_CATALOG_ITEMS = 256;
const ALLOWED_REFERENCE_KINDS = new Set(["role", "department"]);
const SYSTEM_REFERENCE_ROLES = [
  { value: "SUPER_ADMIN", label: "Super Admin" },
  { value: "GRC", label: "GRC" },
  { value: "HR", label: "HR" },
  { value: "EA", label: "EA" },
  { value: "EMPLOYEE_L1", label: "Employee (L1)" },
  { value: "EMPLOYEE_L2", label: "Employee (L2)" },
  { value: "EMPLOYEE_L3", label: "Employee (L3)" },
];
const SYSTEM_REFERENCE_DEPARTMENTS = [
  "Governance, Risk, and Compliance (GRC)",
  "Research and Development (R&D)",
  "Cyber Security Operations Center (CSOC)",
  "Threat Intelligence (TI)",
];
const LIFECYCLE_ROLE_ALIAS = new Map([
  ["SUPER_ADMIN", "SUPER_ADMIN"],
  ["SUPERADMIN", "SUPER_ADMIN"],
  ["ADMIN", "SUPER_ADMIN"],
  ["GRC", "GRC"],
  ["HR", "HR"],
  ["EA", "EA"],
  ["EMPLOYEE", "EMPLOYEE_L1"],
  ["EMPLOYEE_L1", "EMPLOYEE_L1"],
  ["EMPLOYEE_L2", "EMPLOYEE_L2"],
  ["EMPLOYEE_L3", "EMPLOYEE_L3"],
  ["L1", "EMPLOYEE_L1"],
  ["L2", "EMPLOYEE_L2"],
  ["L3", "EMPLOYEE_L3"],
]);

const LIFECYCLE_WORKFLOW_TEMPLATES = {
  onboarding: {
    type: "onboarding",
    category: "Onboarding",
    stages: ["Initiated", "Document Verification", "Access Provisioning", "Activation"],
    checklist: [
      { id: "profile-intake", label: "Collect employee profile and contacts", required: true, slaHours: 12 },
      { id: "contract-check", label: "Validate contract and onboarding requirements", required: true, slaHours: 24 },
      { id: "account-activation", label: "Activate employee account", required: true, slaHours: 48 },
    ],
    approverRoles: ["HR", "GRC"],
    slaHours: 72,
  },
  "role-change": {
    type: "role-change",
    category: "Role Change",
    stages: ["Initiated", "Approval Review", "Role Sync", "Completed"],
    checklist: [
      { id: "movement-justification", label: "Attach role-change justification", required: true, slaHours: 24 },
      { id: "effective-date-review", label: "Validate effective date and scope", required: true, slaHours: 24 },
      { id: "permission-sync", label: "Apply role and permission sync", required: true, slaHours: 48 },
    ],
    approverRoles: ["HR", "GRC"],
    slaHours: 96,
  },
  disciplinary: {
    type: "disciplinary",
    category: "Disciplinary",
    stages: ["Case Opened", "Investigation", "Decision", "Closed"],
    checklist: [
      { id: "incident-report", label: "Record incident report", required: true, slaHours: 24 },
      { id: "evidence-review", label: "Attach and review case evidence", required: true, slaHours: 48 },
      { id: "decision-log", label: "Finalize disciplinary decision", required: true, slaHours: 72 },
    ],
    approverRoles: ["HR", "GRC"],
    slaHours: 120,
  },
  offboarding: {
    type: "offboarding",
    category: "Offboarding",
    stages: ["Initiated", "Clearance", "Access Revocation", "Archived"],
    checklist: [
      { id: "clearance-init", label: "Start employee clearance checklist", required: true, slaHours: 12 },
      { id: "access-revoked", label: "Disable account and revoke access", required: true, slaHours: 24 },
      { id: "archive-records", label: "Archive employee records", required: true, slaHours: 48 },
    ],
    approverRoles: ["HR", "GRC"],
    slaHours: 72,
  },
};

const LIFECYCLE_PRIVILEGED_TARGET_ROLES = new Set(["SUPER_ADMIN", "GRC", "HR", "EA"]);
const LIFECYCLE_ASSIGNABLE_BY_PRIVILEGED = new Set(["EMPLOYEE_L1", "EMPLOYEE_L2", "EMPLOYEE_L3"]);
const LIFECYCLE_ASSIGNABLE_BY_GRC = new Set(["GRC", "HR", "EA", "EMPLOYEE_L1", "EMPLOYEE_L2", "EMPLOYEE_L3"]);
const LIFECYCLE_REQUIRED_EVIDENCE_RULES = {
  disciplinary: [
    {
      id: "incident-report",
      label: "Incident Report",
      keywords: ["incident", "report"],
    },
    {
      id: "notice-to-explain",
      label: "Notice to Explain / Written Explanation",
      keywords: ["notice", "explain", "written explanation", "explanation"],
    },
    {
      id: "decision-memo",
      label: "Decision Memo",
      keywords: ["decision", "memo"],
    },
  ],
  offboarding: [
    {
      id: "resignation-termination",
      label: "Resignation / Termination Document",
      keywords: ["resignation", "termination", "termination notice"],
    },
    {
      id: "clearance-form",
      label: "Clearance Form",
      keywords: ["clearance"],
    },
    {
      id: "handover-exit",
      label: "Handover / Exit Checklist",
      keywords: ["handover", "exit checklist", "exit interview", "knowledge transfer"],
    },
  ],
};
const INCIDENT_SEVERITY_LEVELS = ["Low", "High"];
const INCIDENT_STATUS_VALUES = ["Open", "Containment", "Investigating", "Escalated", "Regulatory Review", "Resolved", "Closed"];
const INCIDENT_CONTAINMENT_STATUS_VALUES = ["Not Started", "In Progress", "Contained"];
const INCIDENT_IMPACT_STATUS_VALUES = ["Pending", "In Progress", "Completed"];
const INCIDENT_TYPE_VALUES = [
  "Unauthorized Access",
  "Data Exposure",
  "Credential Compromise",
  "Insider Misuse",
  "Malware / Ransomware",
  "Policy Violation",
  "System Misconfiguration",
  "Other",
];
const DEFAULT_INCIDENT_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_INCIDENT_EVIDENCE_ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "txt",
]);
const DEFAULT_INCIDENT_EVIDENCE_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
]);

function env(name, fallback) {
  const value = String(process.env[name] || "").trim();
  return value || fallback;
}

function parseBooleanEnv(name, fallbackValue = false) {
  const raw = String(process.env[name] || "")
    .trim()
    .toLowerCase();
  if (!raw) {
    return fallbackValue;
  }
  return raw === "true" || raw === "1" || raw === "yes";
}

function parseCsvSet(value, fallbackSet) {
  const normalized = String(value || "")
    .split(",")
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean);
  if (normalized.length === 0) {
    return new Set([...fallbackSet]);
  }
  return new Set(normalized);
}

function parseIntegerEnv(name, fallbackValue, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(process.env[name] || "").trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }
  return Math.min(max, Math.max(min, parsed));
}

function getIncidentEvidenceValidationConfig() {
  return {
    maxBytes: parseIntegerEnv("CLIO_INCIDENT_EVIDENCE_MAX_BYTES", DEFAULT_INCIDENT_EVIDENCE_MAX_BYTES, {
      min: 128 * 1024,
      max: 50 * 1024 * 1024,
    }),
    allowedExtensions: parseCsvSet(
      process.env.CLIO_INCIDENT_EVIDENCE_ALLOWED_EXTENSIONS,
      DEFAULT_INCIDENT_EVIDENCE_ALLOWED_EXTENSIONS,
    ),
    allowedMimeTypes: parseCsvSet(
      process.env.CLIO_INCIDENT_EVIDENCE_ALLOWED_MIME_TYPES,
      DEFAULT_INCIDENT_EVIDENCE_ALLOWED_MIME_TYPES,
    ),
  };
}

function isInviteDeliveryRequired() {
  const defaultRequired = process.env.NODE_ENV === "production";
  return parseBooleanEnv("CLIO_REQUIRE_EMAIL_DELIVERY", defaultRequired);
}

function extractDeliveryErrorInfo(reason) {
  const normalized = String(reason || "").trim();
  if (normalized.startsWith("email_delivery_failed:")) {
    return {
      code: "email_delivery_failed",
      providerMessage: normalized.slice("email_delivery_failed:".length).trim(),
    };
  }

  return {
    code: normalized || "email_delivery_failed",
    providerMessage: "",
  };
}

function nowIso() {
  return new Date().toISOString();
}

function addYearsToIso(isoTimestamp, years) {
  const base = new Date(isoTimestamp);
  if (Number.isNaN(base.getTime())) {
    const fallback = new Date();
    fallback.setUTCFullYear(fallback.getUTCFullYear() + years);
    return fallback.toISOString();
  }
  base.setUTCFullYear(base.getUTCFullYear() + years);
  return base.toISOString();
}

function getArchiveRetentionYears() {
  const raw = Number.parseInt(String(process.env.CLIO_RETENTION_YEARS || "").trim(), 10);
  if (!Number.isFinite(raw) || raw < 1) {
    return DEFAULT_ARCHIVE_RETENTION_YEARS;
  }
  return Math.min(raw, 25);
}

function asString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRoleKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeReferenceKind(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return ALLOWED_REFERENCE_KINDS.has(normalized) ? normalized : "";
}

function normalizeReferenceLabel(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeDepartmentKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeReferenceKey(kind, value) {
  const normalizedKind = normalizeReferenceKind(kind);
  if (!normalizedKind) {
    return "";
  }
  if (normalizedKind === "role") {
    return normalizeRoleKey(value);
  }
  return normalizeDepartmentKey(value);
}

function buildSystemReferenceCatalog() {
  const roles = SYSTEM_REFERENCE_ROLES.map((entry) => {
    const value = asString(entry.value);
    const label = asString(entry.label, value);
    const key = normalizeReferenceKey("role", value || label);
    return {
      id: `system-role-${key}`,
      kind: "role",
      key,
      value,
      label,
      isSystem: true,
      createdAt: "",
      updatedAt: "",
    };
  });

  const departments = SYSTEM_REFERENCE_DEPARTMENTS.map((entry) => {
    const label = asString(entry);
    const key = normalizeReferenceKey("department", label);
    return {
      id: `system-department-${key}`,
      kind: "department",
      key,
      value: label,
      label,
      isSystem: true,
      createdAt: "",
      updatedAt: "",
    };
  });

  return {
    roles,
    departments,
  };
}

function sortReferenceCatalogItems(items) {
  return [...items].sort((left, right) => {
    if (Boolean(left?.isSystem) !== Boolean(right?.isSystem)) {
      return left?.isSystem ? -1 : 1;
    }
    return String(left?.label || "").localeCompare(String(right?.label || ""), undefined, {
      sensitivity: "base",
    });
  });
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return fallback;
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
    if (["true", "1", "yes", "y", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function normalizeEmployeeDocumentsPayload(documents, { actorEmail, now } = {}) {
  const fallbackActor = normalizeEmail(actorEmail) || "system@gmail.com";
  const fallbackAt = asString(now, nowIso());
  return asArray(documents)
    .map((entry, index) => {
      const source = asObject(entry, {});
      const uploadedAt = asString(source.uploadedAt, fallbackAt);
      const uploadedBy = normalizeEmail(source.uploadedBy || fallbackActor) || fallbackActor;
      const sizeRaw = Number(source.sizeBytes);
      return {
        id: asString(source.id),
        name: asString(source.name, "Employee Document"),
        type: asString(source.type, "General"),
        ref: asString(source.ref),
        storagePath: asString(source.storagePath),
        contentType: asString(source.contentType),
        sizeBytes: Number.isFinite(sizeRaw) && sizeRaw >= 0 ? sizeRaw : 0,
        uploadedAt,
        uploadedBy,
        order: Number.isFinite(Number(source.order)) ? Number(source.order) : index,
      };
    })
    .filter((entry) => entry.ref || entry.name);
}

async function listEmployeeDocumentSubcollectionById(recordId, { db } = {}) {
  const normalizedId = asString(recordId);
  if (!normalizedId) {
    return [];
  }

  const database = db || getDbOrThrow();
  const employeesCollection = getCollectionName("employees");
  const subcollectionName = getEmployeeDocumentsSubcollectionName();
  const snapshot = await getDocs(collection(database, employeesCollection, normalizedId, subcollectionName));
  return snapshot.docs
    .map((item, index) => {
      const payload = normalizeEmployeeDocumentsPayload([item.data()], {
        now: nowIso(),
      })[0];
      if (!payload) {
        return null;
      }
      return {
        ...payload,
        id: item.id,
        recordId: item.id,
        order: Number.isFinite(Number(payload.order)) ? Number(payload.order) : index,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = new Date(left.uploadedAt || 0).getTime();
      const rightTime = new Date(right.uploadedAt || 0).getTime();
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return Number(left.order || 0) - Number(right.order || 0);
    });
}

async function deleteEmployeeDocumentSubcollectionById(recordId, { db } = {}) {
  const normalizedId = asString(recordId);
  if (!normalizedId) {
    return 0;
  }

  const database = db || getDbOrThrow();
  const employeesCollection = getCollectionName("employees");
  const subcollectionName = getEmployeeDocumentsSubcollectionName();
  const snapshot = await getDocs(collection(database, employeesCollection, normalizedId, subcollectionName));
  let removed = 0;
  for (const item of snapshot.docs) {
    await deleteDoc(item.ref);
    removed += 1;
  }
  return removed;
}

async function replaceEmployeeDocumentSubcollectionById(recordId, documents, { actorEmail, db } = {}) {
  const normalizedId = asString(recordId);
  if (!normalizedId) {
    throw new Error("invalid_record_id");
  }

  const database = db || getDbOrThrow();
  const employeesCollection = getCollectionName("employees");
  const subcollectionName = getEmployeeDocumentsSubcollectionName();
  const collectionRef = collection(database, employeesCollection, normalizedId, subcollectionName);
  const normalizedDocuments = normalizeEmployeeDocumentsPayload(documents, {
    actorEmail,
    now: nowIso(),
  });

  await deleteEmployeeDocumentSubcollectionById(normalizedId, { db: database });
  const created = [];
  for (const item of normalizedDocuments) {
    const payload = {
      name: item.name,
      type: item.type,
      ref: item.ref,
      storagePath: item.storagePath,
      contentType: item.contentType,
      sizeBytes: item.sizeBytes,
      uploadedAt: item.uploadedAt,
      uploadedBy: item.uploadedBy,
      order: item.order,
    };
    const createdRef = await addDoc(collectionRef, payload);
    created.push({
      ...payload,
      id: createdRef.id,
      recordId: createdRef.id,
    });
  }

  return created
    .sort((left, right) => new Date(right.uploadedAt || 0).getTime() - new Date(left.uploadedAt || 0).getTime())
    .map((item, index) => ({
      ...item,
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
    }));
}

function resolveEmployeeDocumentsForResponse(record, subcollectionDocs = []) {
  if (Array.isArray(subcollectionDocs) && subcollectionDocs.length > 0) {
    return subcollectionDocs;
  }
  return normalizeEmployeeDocumentsPayload(record?.documents, {
    actorEmail: record?.updatedBy || record?.createdBy,
    now: record?.updatedAt || record?.createdAt || nowIso(),
  });
}

function withEmployeeDocuments(record, documents = []) {
  const normalized = Array.isArray(documents) ? documents : [];
  return {
    ...record,
    documents: normalized,
    documentsCount: normalized.length,
  };
}

async function resolveAndMigrateEmployeeDocuments(record, { db } = {}) {
  if (!record?.id) {
    return [];
  }

  const documentsFromSubcollection = await listEmployeeDocumentSubcollectionById(record.id, { db });
  if (documentsFromSubcollection.length > 0) {
    return documentsFromSubcollection;
  }

  const legacyDocuments = resolveEmployeeDocumentsForResponse(record, []);
  if (legacyDocuments.length === 0) {
    return [];
  }

  const migrated = await replaceEmployeeDocumentSubcollectionById(record.id, legacyDocuments, {
    actorEmail: record.updatedBy || record.createdBy,
    db,
  });
  await clearLegacyEmployeeDocumentsField(record.id, {
    documentsCount: migrated.length,
    db,
  });
  return migrated;
}

async function clearLegacyEmployeeDocumentsField(recordId, { documentsCount, db } = {}) {
  const normalizedId = asString(recordId);
  if (!normalizedId) {
    return;
  }

  const database = db || getDbOrThrow();
  const patch = {
    documents: deleteField(),
  };
  if (Number.isFinite(Number(documentsCount))) {
    patch.documentsCount = Math.max(0, Number(documentsCount));
  }
  await updateDoc(doc(database, getCollectionName("employees"), normalizedId), patch);
}

function toEmployeeDocumentMergeKey(document) {
  const storagePath = asString(document?.storagePath);
  if (storagePath) {
    return `path:${storagePath}`;
  }
  const ref = asString(document?.ref);
  if (ref) {
    return `ref:${ref}`;
  }
  return `fallback:${asString(document?.name)}|${Number.isFinite(Number(document?.sizeBytes)) ? Number(document.sizeBytes) : 0}|${asString(
    document?.uploadedAt,
  )}`;
}

function mergeEmployeeDocuments(existingDocuments, incomingDocuments) {
  const merged = [];
  const seen = new Set();
  let addedCount = 0;

  const pushUnique = (entry, trackAdded = false) => {
    const normalized = normalizeEmployeeDocumentsPayload([entry], {
      actorEmail: entry?.uploadedBy,
      now: entry?.uploadedAt,
    })[0];
    if (!normalized) {
      return;
    }
    const key = toEmployeeDocumentMergeKey(normalized);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(normalized);
    if (trackAdded) {
      addedCount += 1;
    }
  };

  asArray(existingDocuments).forEach((entry) => pushUnique(entry, false));
  asArray(incomingDocuments).forEach((entry) => pushUnique(entry, true));

  return {
    merged,
    addedCount,
  };
}

function toOnboardingEvidenceDocuments(evidence, actorEmail) {
  const now = nowIso();
  const mapped = asArray(evidence).map((item) => {
    const source = asObject(item, {});
    return {
      id: asString(source.id),
      name: asString(source.name, "Onboarding Document"),
      type: asString(source.type, "Onboarding"),
      ref: asString(source.ref),
      storagePath: asString(source.storagePath),
      contentType: asString(source.contentType),
      sizeBytes: Number.isFinite(Number(source.sizeBytes)) ? Number(source.sizeBytes) : 0,
      uploadedAt: asString(source.uploadedAt, now),
      uploadedBy: asString(source.uploadedBy, actorEmail),
    };
  });
  return normalizeEmployeeDocumentsPayload(mapped, {
    actorEmail,
    now,
  });
}

async function syncOnboardingEvidenceToEmployeeDocuments(record, actorEmail) {
  const category = asString(record?.category).toLowerCase();
  if (!category.includes("onboarding")) {
    return {
      synced: false,
      addedCount: 0,
    };
  }

  const employeeEmail = normalizeEmail(record?.employeeEmail);
  if (!employeeEmail) {
    return {
      synced: false,
      addedCount: 0,
    };
  }

  const onboardingDocuments = toOnboardingEvidenceDocuments(record?.evidence, actorEmail);
  if (onboardingDocuments.length === 0) {
    return {
      synced: false,
      addedCount: 0,
    };
  }

  const employeeRows = await listCollectionRecords(getCollectionName("employees"), {
    filterField: "email",
    filterValue: employeeEmail,
  });
  const employeeRecord = employeeRows[0];
  if (!employeeRecord?.id) {
    return {
      synced: false,
      addedCount: 0,
    };
  }

  const existingDocuments = await resolveAndMigrateEmployeeDocuments(employeeRecord);
  const { merged, addedCount } = mergeEmployeeDocuments(existingDocuments, onboardingDocuments);
  if (addedCount <= 0) {
    return {
      synced: false,
      addedCount: 0,
    };
  }

  const syncedDocuments = await replaceEmployeeDocumentSubcollectionById(employeeRecord.id, merged, {
    actorEmail,
  });
  await clearLegacyEmployeeDocumentsField(employeeRecord.id, {
    documentsCount: syncedDocuments.length,
  });

  return {
    synced: true,
    addedCount,
    documentsCount: syncedDocuments.length,
    employeeRecordId: employeeRecord.id,
  };
}

async function collectOnboardingEvidenceDocumentsByEmployeeEmail(employeeEmail, actorEmail) {
  const normalizedEmail = normalizeEmail(employeeEmail);
  if (!normalizedEmail) {
    return [];
  }

  const lifecycleRows = await listCollectionRecords(getCollectionName("lifecycle"), {
    filterField: "employeeEmail",
    filterValue: normalizedEmail,
  });

  const onboardingEvidenceDocuments = lifecycleRows
    .filter((row) => asString(row?.category).toLowerCase().includes("onboarding"))
    .flatMap((row) => toOnboardingEvidenceDocuments(row?.evidence, actorEmail));

  return mergeEmployeeDocuments([], onboardingEvidenceDocuments).merged;
}

function composeEmployeeName({ firstName, middleName, lastName, suffix, fallback }) {
  return formatEmployeeName({
    firstName: asString(firstName),
    middleName: asString(middleName),
    lastName: asString(lastName),
    suffix: asString(suffix),
    fallback: asString(fallback),
    fallbackLabel: "Employee",
  });
}

function normalizeLifecycleType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "onboarding";
  }
  if (normalized.includes("role") || normalized.includes("promotion")) {
    return "role-change";
  }
  if (normalized.includes("disciplin")) {
    return "disciplinary";
  }
  if (normalized.includes("offboard") || normalized.includes("resign") || normalized.includes("terminate")) {
    return "offboarding";
  }
  if (normalized.includes("onboard")) {
    return "onboarding";
  }
  return "onboarding";
}

function getLifecycleTemplateByCategory(category) {
  const type = normalizeLifecycleType(category);
  return LIFECYCLE_WORKFLOW_TEMPLATES[type] || LIFECYCLE_WORKFLOW_TEMPLATES.onboarding;
}

function addHoursToIso(isoValue, hours) {
  const timestamp = Number.isFinite(Number(hours)) ? Number(hours) : 0;
  const base = new Date(isoValue || nowIso());
  if (Number.isNaN(base.getTime())) {
    return nowIso();
  }
  base.setTime(base.getTime() + Math.max(0, timestamp) * 60 * 60 * 1000);
  return base.toISOString();
}

function normalizeRoleId(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "");
}

function normalizeDecision(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "approve" || normalized === "approved") {
    return "approved";
  }
  if (normalized === "reject" || normalized === "rejected") {
    return "rejected";
  }
  return "";
}

function buildChecklistFromTemplate(template, { atIso }) {
  return asArray(template?.checklist)
    .slice(0, MAX_LIFECYCLE_CHECKLIST_ITEMS)
    .map((task, index) => {
      const id = asString(task?.id, `task-${index + 1}`);
      const slaHours = Number.parseInt(String(task?.slaHours || ""), 10);
      return {
        id,
        label: asString(task?.label, id),
        required: task?.required !== false,
        status: "Pending",
        dueAt: addHoursToIso(atIso, Number.isFinite(slaHours) && slaHours > 0 ? slaHours : 24),
        completedAt: "",
        completedBy: "",
      };
    });
}

function mergeChecklistWithTemplate(baseChecklist, templateChecklist) {
  const existing = new Map();
  asArray(baseChecklist).forEach((task) => {
    const key = asString(task?.id);
    if (key) {
      existing.set(key, task);
    }
  });

  return templateChecklist.map((task) => {
    const previous = existing.get(task.id);
    if (!previous) {
      return task;
    }
    return {
      ...task,
      status: asString(previous.status, task.status),
      dueAt: asString(previous.dueAt, task.dueAt),
      completedAt: asString(previous.completedAt),
      completedBy: asString(previous.completedBy),
    };
  });
}

function buildApprovalChain(requiredRoles, existingChain) {
  const existingByRole = new Map();
  asArray(existingChain).forEach((entry) => {
    const role = normalizeRoleId(entry?.role);
    if (role) {
      existingByRole.set(role, entry);
    }
  });

  return requiredRoles.map((role, index) => {
    const previous = existingByRole.get(role);
    return {
      order: index + 1,
      role,
      status: asString(previous?.status, "Pending"),
      decidedAt: asString(previous?.decidedAt),
      decidedBy: asString(previous?.decidedBy),
      note: asString(previous?.note),
    };
  });
}

function resolveApprovalState(approvalChain) {
  const chain = asArray(approvalChain);
  if (chain.length === 0) {
    return "Not Required";
  }
  if (chain.some((step) => normalizeText(step?.status) === "rejected")) {
    return "Rejected";
  }
  if (chain.length > 0 && chain.every((step) => normalizeText(step?.status) === "approved")) {
    return "Approved";
  }
  return "Pending";
}

function summarizeChecklistProgress(checklist) {
  const requiredTasks = checklist.filter((task) => task.required !== false);
  const completedRequired = requiredTasks.filter((task) => normalizeText(task.status) === "completed").length;
  const totalRequired = requiredTasks.length;
  return {
    completedRequired,
    totalRequired,
    percent: totalRequired === 0 ? 0 : Math.round((completedRequired / totalRequired) * 100),
  };
}

function isLifecycleFinalStatusForEvidence(workflowType, statusValue) {
  const workflow = normalizeText(workflowType);
  const status = normalizeText(statusValue);
  if (!workflow || !status) {
    return false;
  }

  if (workflow === "disciplinary") {
    return status.includes("approved") || status.includes("completed");
  }

  if (workflow === "offboarding") {
    return (
      status.includes("approved") ||
      status.includes("completed") ||
      status.includes("access revoked") ||
      status.includes("revoked") ||
      status.includes("resign") ||
      status.includes("terminated")
    );
  }

  return false;
}

function summarizeLifecycleRequiredEvidence(workflowType, evidenceItems = []) {
  const normalizedWorkflowType = normalizeText(workflowType);
  const requiredRules = asArray(LIFECYCLE_REQUIRED_EVIDENCE_RULES[normalizedWorkflowType]);
  if (requiredRules.length === 0) {
    return {
      required: [],
      matched: [],
      missing: [],
      complete: true,
    };
  }

  const normalizedEvidence = asArray(evidenceItems).map((entry) => {
    const source = asObject(entry, {});
    return normalizeText([source.name, source.type, source.note].filter(Boolean).join(" "));
  });

  const matched = [];
  const missing = [];

  requiredRules.forEach((rule) => {
    const keywords = asArray(rule?.keywords).map((item) => normalizeText(item)).filter(Boolean);
    const isMatch = normalizedEvidence.some((evidenceText) => keywords.some((keyword) => evidenceText.includes(keyword)));
    const detail = {
      id: asString(rule?.id),
      label: asString(rule?.label),
    };
    if (isMatch) {
      matched.push(detail);
    } else {
      missing.push(detail);
    }
  });

  return {
    required: requiredRules.map((rule) => ({
      id: asString(rule?.id),
      label: asString(rule?.label),
    })),
    matched,
    missing,
    complete: missing.length === 0,
  };
}

function sanitizeWorkflowStageIndex(stageIndex, stagesLength) {
  const parsed = Number.parseInt(String(stageIndex ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(parsed, Math.max(0, stagesLength - 1)));
}

function resolveRequiredApproverRoles() {
  return [];
}

function validateLifecycleTargetRolePermission({ actorRole, targetRole }) {
  if (!targetRole) {
    return;
  }

  const normalizedActorRole = normalizeRoleId(actorRole);
  const normalizedTargetRole = normalizeRoleId(targetRole);

  if (normalizedActorRole === "SUPER_ADMIN") {
    return;
  }

  if (normalizedActorRole === "GRC") {
    if (normalizedTargetRole === "SUPER_ADMIN") {
      throw new Error("forbidden_target_role");
    }
    if (!LIFECYCLE_ASSIGNABLE_BY_GRC.has(normalizedTargetRole)) {
      throw new Error("invalid_target_role");
    }
    return;
  }

  if (normalizedActorRole === "HR" || normalizedActorRole === "EA") {
    if (!LIFECYCLE_ASSIGNABLE_BY_PRIVILEGED.has(normalizedTargetRole)) {
      throw new Error("forbidden_target_role");
    }
    return;
  }

  if (LIFECYCLE_PRIVILEGED_TARGET_ROLES.has(normalizedTargetRole)) {
    throw new Error("forbidden_target_role");
  }

  if (!LIFECYCLE_ASSIGNABLE_BY_PRIVILEGED.has(normalizedTargetRole)) {
    throw new Error("invalid_target_role");
  }
}

function buildInitialLifecycleWorkflow({
  template,
  baseWorkflow,
  requiredApprovers,
  atIso,
  actorEmail,
}) {
  const templateChecklist = buildChecklistFromTemplate(template, { atIso });
  const checklist = mergeChecklistWithTemplate(baseWorkflow?.checklist, templateChecklist);
  const approvalChain = buildApprovalChain(requiredApprovers, baseWorkflow?.approvalChain);
  const stages = asArray(template?.stages).map((stage) => asString(stage)).filter(Boolean);
  const stageIndex = sanitizeWorkflowStageIndex(baseWorkflow?.stageIndex ?? 0, stages.length);
  const stage = asString(stages[stageIndex], "Initiated");
  const stageHistory = appendTrail(baseWorkflow?.stageHistory, {
    at: atIso,
    by: actorEmail,
    stage,
  });
  const progress = summarizeChecklistProgress(checklist);

  return {
    type: asString(template?.type, "onboarding"),
    stageIndex,
    stage,
    stages,
    checklist,
    stageHistory,
    approvalChain,
    approvalState: resolveApprovalState(approvalChain),
    progress,
    slaDueAt: asString(baseWorkflow?.slaDueAt, addHoursToIso(atIso, Number.parseInt(String(template?.slaHours || 72), 10))),
    slaBreached: false,
    updatedAt: atIso,
  };
}

function applyLifecycleWorkflowAction({
  workflow,
  evidence,
  action,
  actorEmail,
  atIso,
}) {
  const nextWorkflow = {
    ...workflow,
    checklist: asArray(workflow.checklist).map((task) => ({ ...task })),
    stageHistory: asArray(workflow.stageHistory).map((entry) => ({ ...entry })),
  };
  let nextEvidence = asArray(evidence).map((item) => ({ ...item }));
  const actionType = normalizeText(action?.type);

  if (!actionType) {
    return {
      workflow: nextWorkflow,
      evidence: nextEvidence,
    };
  }

  if (actionType === "toggle-task") {
    const taskId = asString(action?.taskId);
    if (!taskId) {
      throw new Error("invalid_workflow_action");
    }

    let matched = false;
    nextWorkflow.checklist = nextWorkflow.checklist.map((task) => {
      if (task.id !== taskId) {
        return task;
      }
      matched = true;
      const completed = Boolean(action?.completed);
      return {
        ...task,
        status: completed ? "Completed" : "Pending",
        completedAt: completed ? atIso : "",
        completedBy: completed ? actorEmail : "",
      };
    });
    if (!matched) {
      throw new Error("invalid_workflow_action");
    }
  } else if (actionType === "set-stage") {
    const nextIndex = sanitizeWorkflowStageIndex(action?.stageIndex, asArray(nextWorkflow.stages).length);
    const nextStage = asString(nextWorkflow.stages?.[nextIndex], nextWorkflow.stage);
    nextWorkflow.stageIndex = nextIndex;
    nextWorkflow.stage = nextStage;
    nextWorkflow.stageHistory = appendTrail(nextWorkflow.stageHistory, {
      at: atIso,
      by: actorEmail,
      stage: nextStage,
      action: "stage-update",
    });
  } else if (actionType === "add-evidence") {
    const evidenceEntry = asObject(action?.evidence, null);
    if (!evidenceEntry) {
      throw new Error("invalid_workflow_action");
    }
    const evidenceId = asString(evidenceEntry.id, `evidence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    nextEvidence = [
      ...nextEvidence,
      {
        id: evidenceId,
        name: asString(evidenceEntry.name, "Evidence File"),
        ref: asString(evidenceEntry.ref),
        storagePath: asString(evidenceEntry.storagePath),
        contentType: asString(evidenceEntry.contentType),
        sizeBytes: Number.isFinite(Number(evidenceEntry.sizeBytes)) ? Number(evidenceEntry.sizeBytes) : 0,
        uploadedAt: asString(evidenceEntry.uploadedAt, atIso),
        uploadedBy: asString(evidenceEntry.uploadedBy, actorEmail),
        note: asString(evidenceEntry.note),
      },
    ].slice(-MAX_LIFECYCLE_EVIDENCE_ITEMS);
  } else if (actionType === "remove-evidence") {
    const evidenceId = asString(action?.evidenceId);
    if (!evidenceId) {
      throw new Error("invalid_workflow_action");
    }
    nextEvidence = nextEvidence.filter((item) => asString(item?.id) !== evidenceId);
  } else {
    throw new Error("invalid_workflow_action");
  }

  const progress = summarizeChecklistProgress(nextWorkflow.checklist);
  nextWorkflow.progress = progress;
  nextWorkflow.updatedAt = atIso;
  nextWorkflow.slaBreached =
    Boolean(nextWorkflow.slaDueAt) &&
    new Date(nextWorkflow.slaDueAt).getTime() < new Date(atIso).getTime() &&
    progress.completedRequired < progress.totalRequired;

  return {
    workflow: nextWorkflow,
    evidence: nextEvidence,
  };
}

function applyApprovalDecision({
  workflow,
  actorRole,
  actorEmail,
  decision,
  note,
  atIso,
}) {
  const normalizedDecision = normalizeDecision(decision);
  if (!normalizedDecision) {
    throw new Error("invalid_approval_decision");
  }

  const chain = asArray(workflow?.approvalChain).map((step) => ({ ...step }));
  const pendingIndex = chain.findIndex((step) => normalizeText(step?.status) === "pending");
  if (pendingIndex < 0) {
    throw new Error("no_pending_approval_step");
  }

  const actorRoleId = normalizeRoleId(actorRole);
  const expectedRole = normalizeRoleId(chain[pendingIndex]?.role);
  if (!actorRoleId || actorRoleId !== expectedRole) {
    throw new Error("approval_not_allowed_for_role");
  }

  chain[pendingIndex] = {
    ...chain[pendingIndex],
    status: normalizedDecision === "approved" ? "Approved" : "Rejected",
    decidedAt: atIso,
    decidedBy: actorEmail,
    note: asString(note),
  };

  if (normalizedDecision === "rejected") {
    return {
      workflow: {
        ...workflow,
        approvalChain: chain,
        approvalState: "Rejected",
        updatedAt: atIso,
      },
      status: "Rejected",
    };
  }

  const approvalState = resolveApprovalState(chain);
  const nextWorkflow = {
    ...workflow,
    approvalChain: chain,
    approvalState,
    updatedAt: atIso,
  };

  const nextStatus = approvalState === "Approved" ? "Approved" : asString(workflow?.status, "Pending Approval");
  return {
    workflow: nextWorkflow,
    status: nextStatus,
  };
}

function appendTrail(currentValue, entry) {
  const trail = [...asArray(currentValue), entry];
  if (trail.length <= MAX_AUDIT_TRAIL_ITEMS) {
    return trail;
  }
  return trail.slice(trail.length - MAX_AUDIT_TRAIL_ITEMS);
}

function byRecentUpdated(a, b) {
  return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
}

function getCollectionName(key) {
  const map = {
    employees: env("CLIO_FIRESTORE_EMPLOYEES_COLLECTION", "employees"),
    lifecycle: env("CLIO_FIRESTORE_LIFECYCLE_COLLECTION", "employment_lifecycle"),
    attendance: env("CLIO_FIRESTORE_ATTENDANCE_COLLECTION", "attendance"),
    leave: env("CLIO_FIRESTORE_LEAVE_COLLECTION", "leave_requests"),
    performance: env("CLIO_FIRESTORE_PERFORMANCE_COLLECTION", "performance_records"),
    templates: env("CLIO_FIRESTORE_TEMPLATES_COLLECTION", "document_templates"),
    exports: env("CLIO_FIRESTORE_EXPORTS_COLLECTION", "export_requests"),
    incidents: env("CLIO_FIRESTORE_INCIDENTS_COLLECTION", "security_incidents"),
    settingsReference: env("CLIO_FIRESTORE_SETTINGS_REFERENCE_COLLECTION", "settings_reference_data"),
  };
  return map[key] || key;
}

function getEmployeeDocumentsSubcollectionName() {
  return env("CLIO_FIRESTORE_EMPLOYEE_DOCUMENTS_SUBCOLLECTION", "documents");
}

function getDbOrThrow() {
  if (!isFirestoreEnabled()) {
    throw new Error("firestore_not_configured");
  }
  const db = getFirestoreDb();
  if (!db) {
    throw new Error("firestore_not_configured");
  }
  return db;
}

async function listCollectionRecords(collectionName, { filterField, filterValue } = {}) {
  const db = getDbOrThrow();
  const ref = collection(db, collectionName);
  let snapshot;
  if (filterField && typeof filterValue === "string" && filterValue.trim()) {
    snapshot = await getDocs(query(ref, where(filterField, "==", filterValue.trim())));
  } else {
    snapshot = await getDocs(ref);
  }

  return snapshot.docs
    .map((item) => ({
      ...item.data(),
      id: item.id,
      recordId: item.id,
    }))
    .sort(byRecentUpdated);
}

async function getCollectionRecordById(collectionName, recordId) {
  const db = getDbOrThrow();
  const normalizedId = asString(recordId);
  if (!normalizedId) {
    throw new Error("invalid_record_id");
  }

  const ref = doc(db, collectionName, normalizedId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    return null;
  }
  return {
    ...snapshot.data(),
    id: snapshot.id,
    recordId: snapshot.id,
  };
}

async function createCollectionRecord(collectionName, payload) {
  const db = getDbOrThrow();
  const ref = await addDoc(collection(db, collectionName), payload);
  return {
    ...payload,
    id: ref.id,
    recordId: ref.id,
  };
}

async function updateCollectionRecord(collectionName, recordId, payload) {
  const db = getDbOrThrow();
  const normalizedId = asString(recordId);
  if (!normalizedId) {
    throw new Error("invalid_record_id");
  }

  const ref = doc(db, collectionName, normalizedId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    return null;
  }

  const current = snapshot.data() || {};
  const next = {
    ...current,
    ...payload,
  };
  await updateDoc(ref, next);
  return {
    ...next,
    id: snapshot.id,
    recordId: snapshot.id,
  };
}

async function updateCollectionRecordsByField(collectionName, filterField, filterValue, buildPatch) {
  const db = getDbOrThrow();
  const normalized = asString(filterValue);
  if (!normalized) {
    return 0;
  }

  const snapshot = await getDocs(
    query(collection(db, collectionName), where(filterField, "==", normalized)),
  );

  let updatedCount = 0;
  for (const recordSnapshot of snapshot.docs) {
    const current = recordSnapshot.data() || {};
    const patch = buildPatch(current, recordSnapshot.id);
    if (!patch || typeof patch !== "object" || Object.keys(patch).length === 0) {
      continue;
    }
    await updateDoc(doc(db, collectionName, recordSnapshot.id), patch);
    updatedCount += 1;
  }

  return updatedCount;
}

async function deleteCollectionRecord(collectionName, recordId) {
  const db = getDbOrThrow();
  const normalizedId = asString(recordId);
  if (!normalizedId) {
    throw new Error("invalid_record_id");
  }

  const ref = doc(db, collectionName, normalizedId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    return null;
  }

  await deleteDoc(ref);
  return {
    ...snapshot.data(),
    id: snapshot.id,
    recordId: snapshot.id,
  };
}

function toReferenceCatalogItem(raw, kind) {
  const normalizedKind = normalizeReferenceKind(kind || raw?.kind);
  if (!normalizedKind) {
    return null;
  }

  const valueSource = asString(raw?.value || raw?.label);
  const labelSource = asString(raw?.label || raw?.value);
  const value = valueSource || labelSource;
  const label = labelSource || valueSource;
  const key = normalizeReferenceKey(normalizedKind, value || label);
  if (!value || !label || !key) {
    return null;
  }

  return {
    id: asString(raw?.id || raw?.recordId),
    kind: normalizedKind,
    key,
    value,
    label,
    isSystem: Boolean(raw?.isSystem),
    createdAt: asString(raw?.createdAt),
    updatedAt: asString(raw?.updatedAt),
  };
}

export async function listSettingsReferenceCatalogBackend() {
  const collectionName = getCollectionName("settingsReference");
  const baseCatalog = buildSystemReferenceCatalog();
  const rows = (await listCollectionRecords(collectionName)).slice(0, MAX_REFERENCE_CATALOG_ITEMS);

  const roleByKey = new Map(baseCatalog.roles.map((item) => [item.key, item]));
  const departmentByKey = new Map(baseCatalog.departments.map((item) => [item.key, item]));

  rows.forEach((row) => {
    const item = toReferenceCatalogItem(row);
    if (!item) {
      return;
    }

    if (item.kind === "role") {
      if (!roleByKey.has(item.key)) {
        roleByKey.set(item.key, item);
      }
      return;
    }

    if (!departmentByKey.has(item.key)) {
      departmentByKey.set(item.key, item);
    }
  });

  return {
    roles: sortReferenceCatalogItems([...roleByKey.values()]),
    departments: sortReferenceCatalogItems([...departmentByKey.values()]),
  };
}

export async function createSettingsReferenceItemBackend({ kind, label }, actorEmail) {
  const normalizedKind = normalizeReferenceKind(kind);
  if (!normalizedKind) {
    throw new Error("invalid_reference_kind");
  }

  const normalizedLabel = normalizeReferenceLabel(label);
  if (!normalizedLabel || normalizedLabel.length > MAX_REFERENCE_LABEL_LENGTH) {
    throw new Error("invalid_reference_label");
  }

  const key = normalizeReferenceKey(normalizedKind, normalizedLabel);
  if (!key) {
    throw new Error("invalid_reference_label");
  }

  const catalog = await listSettingsReferenceCatalogBackend();
  const targetRows = normalizedKind === "role" ? catalog.roles : catalog.departments;
  const alreadyExists = targetRows.some((entry) => entry.key === key);
  if (alreadyExists) {
    throw new Error("duplicate_reference_value");
  }

  const timestamp = nowIso();
  const payload = {
    kind: normalizedKind,
    key,
    value: normalizedLabel,
    label: normalizedLabel,
    isSystem: false,
    createdAt: timestamp,
    createdBy: actorEmail,
    updatedAt: timestamp,
    updatedBy: actorEmail,
  };

  const created = await createCollectionRecord(getCollectionName("settingsReference"), payload);
  const item = toReferenceCatalogItem(created, normalizedKind);
  if (!item) {
    throw new Error("invalid_reference_label");
  }
  return item;
}

export async function deleteSettingsReferenceItemBackend({ kind, recordId }) {
  const normalizedKind = normalizeReferenceKind(kind);
  if (!normalizedKind) {
    throw new Error("invalid_reference_kind");
  }

  const normalizedRecordId = asString(recordId);
  if (!normalizedRecordId || normalizedRecordId.startsWith("system-")) {
    throw new Error("immutable_reference_item");
  }

  const current = await getCollectionRecordById(getCollectionName("settingsReference"), normalizedRecordId);
  if (!current) {
    return null;
  }

  const currentKind = normalizeReferenceKind(current.kind);
  if (!currentKind || currentKind !== normalizedKind || current.isSystem === true) {
    throw new Error("immutable_reference_item");
  }

  const deleted = await deleteCollectionRecord(getCollectionName("settingsReference"), normalizedRecordId);
  return toReferenceCatalogItem(deleted, normalizedKind);
}

function normalizeEmployeeWritePayload(payload, actorEmail, { base } = {}) {
  const timestamp = nowIso();
  const employeeEmail = normalizeEmail(payload?.email || base?.email);
  if (!employeeEmail) {
    throw new Error("invalid_employee_email");
  }

  const baseGovernmentIds = asObject(base?.governmentIds, {});
  const incomingGovernmentIds = asObject(payload?.governmentIds, {});
  const governmentIds = {
    ...baseGovernmentIds,
    ...incomingGovernmentIds,
  };

  const basePayrollInformation = asObject(base?.payrollInformation, {});
  const incomingPayrollInformation = asObject(payload?.payrollInformation, {});
  const payrollInformation = {
    ...basePayrollInformation,
    ...incomingPayrollInformation,
  };

  const managerEmail = normalizeEmail(payload?.managerEmail || base?.managerEmail);
  const contact = asString(payload?.contact, asString(base?.contact, "-"));
  const address = asString(payload?.address, asString(base?.address, "-"));
  const emergencyContact = asString(payload?.emergencyContact, asString(base?.emergencyContact, "-"));
  const govId = asString(payload?.govId, asString(base?.govId, "Masked"));
  const firstName = asString(payload?.firstName, asString(base?.firstName, ""));
  const middleName = asString(payload?.middleName, asString(base?.middleName, ""));
  const lastName = asString(payload?.lastName, asString(base?.lastName, ""));
  const suffix = asString(payload?.suffix, asString(base?.suffix, ""));
  const legacyName = asString(payload?.name, asString(base?.name, employeeEmail));
  const composedName = composeEmployeeName({
    firstName,
    middleName,
    lastName,
    suffix,
    fallback: legacyName || employeeEmail,
  });

  if (!governmentIds.primaryId) {
    governmentIds.primaryId = govId;
  }

  const payloadHasDocuments = Object.prototype.hasOwnProperty.call(asObject(payload, {}), "documents");
  const payloadDocuments = payloadHasDocuments ? asArray(payload?.documents) : null;
  const baseDocumentsCountRaw = Number(base?.documentsCount);
  const baseDocumentsCount = Number.isFinite(baseDocumentsCountRaw)
    ? Math.max(0, baseDocumentsCountRaw)
    : asArray(base?.documents).length;
  const documentsCount = payloadDocuments ? payloadDocuments.length : baseDocumentsCount;

  return {
    employeeId: asString(payload?.employeeId, asString(base?.employeeId, `CL-${Date.now().toString().slice(-6)}`)),
    name: composedName,
    firstName,
    middleName,
    lastName,
    suffix,
    email: employeeEmail,
    role: asString(payload?.role, asString(base?.role, "EMPLOYEE_L1")),
    department: asString(payload?.department, asString(base?.department, "-")),
    jobTitle: asString(payload?.jobTitle, asString(base?.jobTitle, "-")),
    managerEmail,
    hireDate: asString(payload?.hireDate, asString(base?.hireDate, "")),
    employmentStatus: asString(payload?.employmentStatus, asString(base?.employmentStatus, "Active Employee")),
    status: asString(payload?.status, asString(base?.status, "Active")),
    governmentIds,
    govId,
    contact,
    address,
    emergencyContact,
    contactInformation: {
      primaryPhone: contact,
      address,
      emergencyContact,
    },
    payrollInformation,
    payrollGroup: asString(payload?.payrollGroup, asString(base?.payrollGroup, "-")),
    documentsCount,
    classification: "Restricted PII",
    createdAt: asString(base?.createdAt, timestamp),
    createdBy: asString(base?.createdBy, actorEmail),
    updatedAt: timestamp,
    updatedBy: actorEmail,
    activityHistory: appendTrail(base?.activityHistory, {
      at: timestamp,
      by: actorEmail,
      action: base ? "update" : "create",
    }),
  };
}

export async function listEmployeeRecordsBackend({ ownerEmail, includeDocuments = false } = {}) {
  const rows = await listCollectionRecords(getCollectionName("employees"), {
    filterField: ownerEmail ? "email" : undefined,
    filterValue: ownerEmail ? normalizeEmail(ownerEmail) : undefined,
  });
  if (!includeDocuments) {
    return rows;
  }

  const enriched = await Promise.all(
    rows.map(async (record) => {
      const documents = await resolveAndMigrateEmployeeDocuments(record);
      return withEmployeeDocuments(record, documents);
    }),
  );
  return enriched;
}

export async function getEmployeeRecordBackend(recordId, { includeDocuments = true } = {}) {
  const record = await getCollectionRecordById(getCollectionName("employees"), recordId);
  if (!record || !includeDocuments) {
    return record;
  }

  let documents = await resolveAndMigrateEmployeeDocuments(record);
  if (documents.length === 0) {
    const backfilledDocuments = await collectOnboardingEvidenceDocumentsByEmployeeEmail(
      record.email,
      record.updatedBy || record.createdBy,
    );
    if (backfilledDocuments.length > 0) {
      documents = await replaceEmployeeDocumentSubcollectionById(record.id, backfilledDocuments, {
        actorEmail: record.updatedBy || record.createdBy,
      });
      await clearLegacyEmployeeDocumentsField(record.id, {
        documentsCount: documents.length,
      });
    }
  }
  return withEmployeeDocuments(record, documents);
}

export async function createEmployeeRecordBackend(payload, actorEmail) {
  const normalized = normalizeEmployeeWritePayload(payload, actorEmail);
  const created = await createCollectionRecord(getCollectionName("employees"), normalized);
  const payloadDocuments = asArray(payload?.documents);
  if (payloadDocuments.length === 0) {
    return withEmployeeDocuments(created, []);
  }

  const syncedDocuments = await replaceEmployeeDocumentSubcollectionById(created.id, payloadDocuments, {
    actorEmail,
  });
  await clearLegacyEmployeeDocumentsField(created.id, {
    documentsCount: syncedDocuments.length,
  });
  return withEmployeeDocuments(created, syncedDocuments);
}

export async function updateEmployeeRecordBackend(recordId, payload, actorEmail) {
  const current = await getEmployeeRecordBackend(recordId, { includeDocuments: true });
  if (!current) {
    return null;
  }
  const payloadHasDocuments = Object.prototype.hasOwnProperty.call(asObject(payload, {}), "documents");
  const payloadDocuments = payloadHasDocuments ? asArray(payload?.documents) : null;
  const normalized = normalizeEmployeeWritePayload(payload, actorEmail, { base: current });
  const updated = await updateCollectionRecord(getCollectionName("employees"), recordId, normalized);
  if (!updated) {
    return null;
  }

  if (payloadDocuments) {
    const syncedDocuments = await replaceEmployeeDocumentSubcollectionById(recordId, payloadDocuments, {
      actorEmail,
    });
    await clearLegacyEmployeeDocumentsField(recordId, {
      documentsCount: syncedDocuments.length,
    });
    return withEmployeeDocuments(updated, syncedDocuments);
  }

  const documents = await resolveAndMigrateEmployeeDocuments(updated);
  return withEmployeeDocuments(updated, documents);
}

export async function deleteEmployeeRecordBackend(recordId) {
  await deleteEmployeeDocumentSubcollectionById(recordId);
  return await deleteCollectionRecord(getCollectionName("employees"), recordId);
}

function normalizeLifecyclePayload(payload, actorEmail, actorRole, { base } = {}) {
  const timestamp = nowIso();
  const category = asString(payload?.category, asString(base?.category, "Onboarding"));
  const employeeEmail = normalizeEmail(payload?.employeeEmail || base?.employeeEmail);
  if (!employeeEmail) {
    throw new Error("invalid_employee_email");
  }

  const baseDetails = asObject(base?.details, {});
  const incomingDetails = asObject(payload?.details, {});
  const details = {
    ...baseDetails,
    ...incomingDetails,
  };

  const template = getLifecycleTemplateByCategory(category);
  const requiredApprovers = resolveRequiredApproverRoles(template, details);
  const baseWorkflow = asObject(base?.workflow, {});
  const workflowPatch = asObject(payload?.workflow, {});
  const workflowSeed = {
    ...baseWorkflow,
    ...workflowPatch,
  };

  const workflow = buildInitialLifecycleWorkflow({
    template,
    baseWorkflow: workflowSeed,
    requiredApprovers,
    atIso: timestamp,
    actorEmail,
  });

  const action = payload?.workflowAction && typeof payload.workflowAction === "object" ? payload.workflowAction : null;
  const withAction = applyLifecycleWorkflowAction({
    workflow,
    evidence: asArray(base?.evidence),
    action,
    actorEmail,
    atIso: timestamp,
  });

  const progress = summarizeChecklistProgress(withAction.workflow.checklist);
  withAction.workflow.progress = progress;
  withAction.workflow.slaBreached =
    Boolean(withAction.workflow.slaDueAt) &&
    new Date(withAction.workflow.slaDueAt).getTime() < new Date(timestamp).getTime() &&
    progress.completedRequired < progress.totalRequired;
  withAction.workflow.approvalState = resolveApprovalState(withAction.workflow.approvalChain);

  const requestedStatus = asString(payload?.status, asString(base?.status, "In Progress"));
  const status = requestedStatus;
  const workflowType = asString(template.type, "onboarding");
  const workflowActionType = normalizeText(action?.type);
  const requiredEvidence = summarizeLifecycleRequiredEvidence(workflowType, withAction.evidence);
  const mustEnforceRequiredEvidence = isLifecycleFinalStatusForEvidence(workflowType, status);
  if (mustEnforceRequiredEvidence && requiredEvidence.missing.length > 0 && workflowActionType !== "add-evidence") {
    throw new Error("lifecycle_required_evidence_missing");
  }

  return {
    employeeEmail,
    employee: asString(payload?.employee, asString(base?.employee, employeeEmail || "Unknown Employee")),
    category,
    workflowType,
    owner: asString(payload?.owner, asString(base?.owner, "HR Operations")),
    details,
    evidence: withAction.evidence,
    requiredEvidence,
    workflow: withAction.workflow,
    status,
    createdAt: asString(base?.createdAt, timestamp),
    createdBy: asString(base?.createdBy, actorEmail),
    updatedAt: timestamp,
    updatedBy: actorEmail,
    traceability: appendTrail(base?.traceability, {
      at: timestamp,
      by: actorEmail,
      action: base ? "update" : "create",
      category,
      status,
      stage: withAction.workflow.stage,
      checklistProgress: withAction.workflow.progress.percent,
      approvalState: withAction.workflow.approvalState,
    }),
  };
}

function shouldTriggerAccessRevocation(record) {
  const category = asString(record?.category).toLowerCase();
  const status = asString(record?.status).toLowerCase();
  return (
    category.includes("offboarding") ||
    status.includes("resign") ||
    status.includes("terminated") ||
    status.includes("access revoked")
  );
}

function shouldApplyLifecycleRoleSync(record) {
  const category = asString(record?.category).toLowerCase();
  const status = asString(record?.status).toLowerCase();
  const isRoleMovement = category.includes("role change") || category.includes("promotion");
  const isFinalized = status.includes("approved") || status.includes("completed");
  return isRoleMovement && isFinalized;
}

function shouldApplyLifecycleArchivePolicy(record) {
  const category = asString(record?.category).toLowerCase();
  const status = asString(record?.status).toLowerCase();
  const exitStatusDetected =
    status.includes("resign") || status.includes("terminated") || status.includes("access revoked");
  const finalizedOffboarding =
    category.includes("offboarding") &&
    (status.includes("approved") || status.includes("completed") || status.includes("revoked"));
  return exitStatusDetected || finalizedOffboarding;
}

function shouldApplyOnboardingActivation(record) {
  const category = asString(record?.category).toLowerCase();
  const status = asString(record?.status).toLowerCase();
  const hasEmployeeEmail = Boolean(normalizeEmail(record?.employeeEmail));
  const isOnboarding = category.includes("onboarding");
  const isFinalized = status.includes("approved") || status.includes("completed");
  return hasEmployeeEmail && isOnboarding && isFinalized;
}

function shouldTriggerOnboardingInvite(record) {
  const category = asString(record?.category).toLowerCase();
  const hasEmployeeEmail = Boolean(normalizeEmail(record?.employeeEmail));
  return hasEmployeeEmail && category.includes("onboarding");
}

function resolveLifecycleInviteRole(record) {
  const details = asObject(record?.details, {});
  const roleRaw = asString(details?.roleTo || details?.role || details?.roleFrom);
  if (!roleRaw) {
    return "EMPLOYEE_L1";
  }
  const normalized = normalizeRoleKey(roleRaw);
  if (!normalized) {
    return "EMPLOYEE_L1";
  }
  return LIFECYCLE_ROLE_ALIAS.get(normalized) || normalized || "EMPLOYEE_L1";
}

async function triggerOnboardingInvite(record, actorEmail, actorRole, { requestOrigin = "" } = {}) {
  const normalizedEmail = normalizeEmail(record?.employeeEmail);
  if (!normalizedEmail) {
    throw new Error("invalid_employee_email");
  }

  const existingAccount = await getLoginAccount(normalizedEmail).catch(() => null);
  const existingStatus = asString(existingAccount?.status).toLowerCase();
  if (existingStatus === "active") {
    return {
      type: "onboarding-invite-skipped",
      message: "User account is already active. Invite was not reissued.",
      accountStatus: "active",
    };
  }

  const inviteRole = resolveLifecycleInviteRole(record);
  validateLifecycleTargetRolePermission({
    actorRole,
    targetRole: inviteRole,
  });
  const result = await inviteUserAccount({
    email: normalizedEmail,
    role: inviteRole,
    invitedBy: actorEmail,
  });

  const enforceDelivery = isInviteDeliveryRequired();
  let delivery = null;
  try {
    delivery = await deliverInviteEmail({
      toEmail: result.user.email,
      role: result.user.role,
      invitedBy: actorEmail,
      expiresAt: result.invite.expiresAt,
      inviteToken: result.invite.token,
      requestOrigin,
    });
  } catch (deliveryError) {
    const rawReason = deliveryError instanceof Error ? deliveryError.message : "email_delivery_failed";
    const deliveryErrorInfo = extractDeliveryErrorInfo(rawReason);
    if (enforceDelivery) {
      await revokeInviteById(result.invite.id).catch(() => null);
      throw new Error(deliveryErrorInfo.code || "email_delivery_failed");
    }

    delivery = {
      provider: "unavailable",
      status: "failed",
      messageId: null,
      reason: deliveryErrorInfo.code || "email_delivery_failed",
      providerMessage: deliveryErrorInfo.providerMessage || null,
    };
  }

  return {
    type: "onboarding-invite",
    message:
      delivery?.status === "failed"
        ? "Onboarding invite was created. Email delivery failed in test mode."
        : delivery?.provider === "firebase"
          ? "Onboarding invite sent via Firebase email-link template. User must verify email to open the CLIO account, then complete SMS OTP."
          : "Onboarding invite sent. User must verify email to open the CLIO account, then complete SMS OTP.",
    inviteId: result.invite.id,
    inviteStatus: result.invite.status,
    role: result.user.role,
    deliveryProvider: delivery?.provider || "unknown",
    deliveryStatus: delivery?.status || "unknown",
  };
}

function resolveLifecycleRoleTarget(record) {
  const details = asObject(record?.details, {});
  const roleToRaw = asString(details?.roleTo);
  if (!roleToRaw) {
    return "";
  }

  const normalized = normalizeRoleKey(roleToRaw);
  return LIFECYCLE_ROLE_ALIAS.get(normalized) || "";
}

function resolveArchiveReasonFromLifecycle(record) {
  const details = asObject(record?.details, {});
  const detailReason = asString(details?.offboardingReason || details?.reason || details?.note);
  if (detailReason) {
    return detailReason;
  }

  const category = asString(record?.category);
  const status = asString(record?.status);
  if (category || status) {
    return [category, status].filter(Boolean).join(" - ");
  }

  return "Resigned";
}

function buildArchivePatch(current, { actorEmail, archivedAt, reason, retentionDeleteAt, trailField }) {
  const patch = {
    isArchived: true,
    archivedAt,
    archivedBy: actorEmail,
    archiveReason: reason,
    retentionDeleteAt,
    updatedAt: archivedAt,
    updatedBy: actorEmail,
  };

  if (trailField) {
    patch[trailField] = appendTrail(current?.[trailField], {
      at: archivedAt,
      by: actorEmail,
      action: "archive",
      reason,
    });
  }

  return patch;
}

async function syncUserRoleByLifecycle(record, actorRole) {
  const normalizedEmail = normalizeEmail(record?.employeeEmail);
  if (!normalizedEmail) {
    throw new Error("invalid_employee_email");
  }

  const targetRole = resolveLifecycleRoleTarget(record);
  if (!targetRole) {
    throw new Error("invalid_target_role");
  }
  validateLifecycleTargetRolePermission({
    actorRole,
    targetRole,
  });

  const updated = await updateUserAccountRole({
    userId: normalizedEmail,
    role: targetRole,
  });
  if (!updated) {
    throw new Error("role_sync_failed");
  }

  return updated;
}

async function syncEmployeeRecordRoleByLifecycle(record, actorEmail, actorRole) {
  const normalizedEmail = normalizeEmail(record?.employeeEmail);
  if (!normalizedEmail) {
    throw new Error("invalid_employee_email");
  }

  const targetRole = resolveLifecycleRoleTarget(record);
  if (!targetRole) {
    throw new Error("invalid_target_role");
  }
  validateLifecycleTargetRolePermission({
    actorRole,
    targetRole,
  });

  const details = asObject(record?.details, {});
  const nextDepartment = asString(details?.departmentTo);
  const updatedAt = nowIso();
  const updatedCount = await updateCollectionRecordsByField(
    getCollectionName("employees"),
    "email",
    normalizedEmail,
    (current) => {
      const patch = {
        role: targetRole,
        updatedAt,
        updatedBy: actorEmail,
        activityHistory: appendTrail(current?.activityHistory, {
          at: updatedAt,
          by: actorEmail,
          action: "lifecycle-role-sync",
          role: targetRole,
        }),
      };
      if (nextDepartment) {
        patch.department = nextDepartment;
      }
      return patch;
    },
  );

  return updatedCount;
}

async function revokeUserAccessByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("invalid_employee_email");
  }

  const updated = await updateUserAccountStatus({
    userId: normalizedEmail,
    status: "disabled",
  });
  if (!updated) {
    throw new Error("employee_account_not_found");
  }
  if (asString(updated.status).toLowerCase() !== "disabled") {
    throw new Error("access_revocation_failed");
  }
  return updated;
}

async function activateUserAccessByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("invalid_employee_email");
  }

  const updated = await updateUserAccountStatus({
    userId: normalizedEmail,
    status: "active",
  });
  if (!updated) {
    throw new Error("employee_account_not_found");
  }
  if (asString(updated.status).toLowerCase() !== "active") {
    throw new Error("account_activation_failed");
  }
  return updated;
}

async function activateEmployeeRecordByEmail(record, actorEmail) {
  const normalizedEmail = normalizeEmail(record?.employeeEmail);
  if (!normalizedEmail) {
    throw new Error("invalid_employee_email");
  }

  const details = asObject(record?.details, {});
  const employeeId = asString(details?.employeeId || details?.employeeNumber);
  const firstName = asString(details?.firstName);
  const middleName = asString(details?.middleName);
  const lastName = asString(details?.lastName);
  const suffix = asString(details?.suffix);
  const startDate = asString(details?.startDate);
  const roleRaw = asString(details?.roleTo || details?.role || details?.roleFrom);
  const roleNormalized = normalizeRoleKey(roleRaw);
  const roleValue = LIFECYCLE_ROLE_ALIAS.get(roleNormalized) || roleNormalized || "EMPLOYEE_L1";
  const departmentValue = asString(details?.departmentTo || details?.department);
  const displayName = composeEmployeeName({
    firstName,
    middleName,
    lastName,
    suffix,
    fallback: asString(record?.employee, normalizedEmail),
  });
  const updatedAt = nowIso();
  const updatedCount = await updateCollectionRecordsByField(getCollectionName("employees"), "email", normalizedEmail, (current) => {
    const patch = {
      status: "Active",
      employmentStatus: "Active Employee",
      isArchived: false,
      updatedAt,
      updatedBy: actorEmail,
      activityHistory: appendTrail(current?.activityHistory, {
        at: updatedAt,
        by: actorEmail,
        action: "lifecycle-onboarding-sync",
        status: "Active",
      }),
    };
    if (employeeId) {
      patch.employeeId = employeeId;
    }
    if (firstName) {
      patch.firstName = firstName;
    }
    if (middleName) {
      patch.middleName = middleName;
    }
    if (lastName) {
      patch.lastName = lastName;
    }
    if (suffix) {
      patch.suffix = suffix;
    }
    if (displayName) {
      patch.name = displayName;
    }
    if (departmentValue) {
      patch.department = departmentValue;
    }
    if (roleValue) {
      patch.role = roleValue;
    }
    if (startDate) {
      patch.hireDate = startDate;
    }
    return patch;
  });

  if (updatedCount > 0) {
    return updatedCount;
  }

  const createdPayload = normalizeEmployeeWritePayload(
    {
      employeeId,
      email: normalizedEmail,
      name: displayName,
      firstName,
      middleName,
      lastName,
      suffix,
      role: roleValue || "EMPLOYEE_L1",
      department: departmentValue || "-",
      hireDate: startDate || "",
      status: "Active",
      employmentStatus: "Active Employee",
    },
    actorEmail,
  );
  await createCollectionRecord(getCollectionName("employees"), createdPayload);
  return 1;
}

async function archiveEmployeeDataByEmail(record, actorEmail) {
  const normalizedEmail = normalizeEmail(record?.employeeEmail);
  if (!normalizedEmail) {
    throw new Error("invalid_employee_email");
  }

  const archivedAt = nowIso();
  const retentionDeleteAt = addYearsToIso(archivedAt, getArchiveRetentionYears());
  const reason = resolveArchiveReasonFromLifecycle(record);

  const userArchive = await archiveUserAccount({
    userId: normalizedEmail,
    archivedBy: actorEmail,
    reason,
    retentionDeleteAt,
  });

  const employeesArchived = await updateCollectionRecordsByField(getCollectionName("employees"), "email", normalizedEmail, (current) => ({
    ...buildArchivePatch(current, {
      actorEmail,
      archivedAt,
      reason,
      retentionDeleteAt,
      trailField: "activityHistory",
    }),
    status: "Archived",
    employmentStatus: "Resigned",
  }));

  const lifecycleArchived = await updateCollectionRecordsByField(getCollectionName("lifecycle"), "employeeEmail", normalizedEmail, (current) => ({
    ...buildArchivePatch(current, {
      actorEmail,
      archivedAt,
      reason,
      retentionDeleteAt,
      trailField: "traceability",
    }),
    archiveStatus: "Archived",
  }));

  const attendanceArchived = await updateCollectionRecordsByField(getCollectionName("attendance"), "employeeEmail", normalizedEmail, (current) => ({
    ...buildArchivePatch(current, {
      actorEmail,
      archivedAt,
      reason,
      retentionDeleteAt,
      trailField: "modificationTrail",
    }),
    archiveStatus: "Archived",
  }));

  const leaveArchived = await updateCollectionRecordsByField(getCollectionName("leave"), "employeeEmail", normalizedEmail, (current) => ({
    ...buildArchivePatch(current, {
      actorEmail,
      archivedAt,
      reason,
      retentionDeleteAt,
      trailField: "modificationTrail",
    }),
    archiveStatus: "Archived",
  }));

  const performanceArchived = await updateCollectionRecordsByField(getCollectionName("performance"), "employeeEmail", normalizedEmail, (current) => ({
    ...buildArchivePatch(current, {
      actorEmail,
      archivedAt,
      reason,
      retentionDeleteAt,
      trailField: "traceability",
    }),
    archiveStatus: "Archived",
  }));

  const exportsArchived = await updateCollectionRecordsByField(getCollectionName("exports"), "requestedBy", normalizedEmail, (current) => ({
    ...buildArchivePatch(current, {
      actorEmail,
      archivedAt,
      reason,
      retentionDeleteAt,
      trailField: "history",
    }),
    archiveStatus: "Archived",
  }));

  return {
    archivedAt,
    retentionDeleteAt,
    reason,
    userStatus: userArchive?.status || "disabled",
    counts: {
      employees: employeesArchived,
      lifecycle: lifecycleArchived,
      attendance: attendanceArchived,
      leave: leaveArchived,
      performance: performanceArchived,
      exports: exportsArchived,
    },
  };
}

async function applyLifecycleAutomations(record, actorEmail, actorRole) {
  const effects = [];
  if (shouldApplyOnboardingActivation(record)) {
    const activatedAccount = await activateUserAccessByEmail(record.employeeEmail);
    const activatedEmployeeRecords = await activateEmployeeRecordByEmail(record, actorEmail);
    effects.push({
      type: "onboarding-activation",
      message: "User account and employee profile activated.",
      accountStatus: activatedAccount?.status || "active",
      employeeRecordsUpdated: activatedEmployeeRecords,
    });
  }
  if (shouldApplyLifecycleRoleSync(record)) {
    const employeeRecordsUpdated = await syncEmployeeRecordRoleByLifecycle(record, actorEmail, actorRole);
    const account = await syncUserRoleByLifecycle(record, actorRole);
    effects.push({
      type: "role-sync",
      message: `Role synchronized to ${account?.role || "target role"}.`,
      role: account?.role || null,
      employeeRecordsUpdated,
    });
  }
  if (shouldTriggerAccessRevocation(record)) {
    const account = await revokeUserAccessByEmail(record.employeeEmail);
    effects.push({
      type: "access-revocation",
      message: "User account access revoked.",
      accountStatus: account?.status || "disabled",
    });
  }
  if (shouldApplyLifecycleArchivePolicy(record)) {
    const archiveResult = await archiveEmployeeDataByEmail(record, actorEmail);
    effects.push({
      type: "archive-policy",
      message: `Employee data archived until ${archiveResult.retentionDeleteAt}.`,
      retentionDeleteAt: archiveResult.retentionDeleteAt,
      archivedAt: archiveResult.archivedAt,
      counts: archiveResult.counts,
    });
  }
  return effects;
}

export async function listLifecycleRecordsBackend() {
  return await listCollectionRecords(getCollectionName("lifecycle"));
}

export async function getLifecycleRecordBackend(recordId) {
  return await getCollectionRecordById(getCollectionName("lifecycle"), recordId);
}

export async function createLifecycleRecordBackend(payload, actorEmail, actorRole = "", { requestOrigin = "" } = {}) {
  const normalized = normalizeLifecyclePayload(payload, actorEmail, actorRole);
  const effects = [];
  if (shouldTriggerOnboardingInvite(normalized)) {
    const inviteEffect = await triggerOnboardingInvite(normalized, actorEmail, actorRole, {
      requestOrigin,
    });
    if (inviteEffect) {
      effects.push(inviteEffect);
    }
  }
  const automationEffects = await applyLifecycleAutomations(normalized, actorEmail, actorRole);
  effects.push(...automationEffects);

  const created = await createCollectionRecord(getCollectionName("lifecycle"), {
    ...normalized,
    lastAutomationEffects: effects,
    lastAutomationAt: nowIso(),
    lastAutomationBy: actorEmail,
  });

  await syncOnboardingEvidenceToEmployeeDocuments(created, actorEmail).catch(() => null);

  return {
    record: created,
    effects,
  };
}

export async function updateLifecycleRecordBackend(recordId, payload, actorEmail, actorRole = "") {
  const current = await getLifecycleRecordBackend(recordId);
  if (!current) {
    return null;
  }
  const normalized = normalizeLifecyclePayload(payload, actorEmail, actorRole, { base: current });
  const effects = await applyLifecycleAutomations(normalized, actorEmail, actorRole);

  const updated = await updateCollectionRecord(getCollectionName("lifecycle"), recordId, {
    ...normalized,
    lastAutomationEffects: effects,
    lastAutomationAt: nowIso(),
    lastAutomationBy: actorEmail,
  });

  await syncOnboardingEvidenceToEmployeeDocuments(updated, actorEmail).catch(() => null);

  return {
    record: updated,
    effects,
  };
}

export async function forceOffboardLifecycleRecordBackend(recordId, actorEmail, reason, actorRole = "") {
  return await updateLifecycleRecordBackend(
    recordId,
    {
      category: "Offboarding",
      status: "Access Revoked",
      details: {
        offboardingReason: asString(reason, "Resignation"),
      },
    },
    actorEmail,
    actorRole,
  );
}

export async function approveLifecycleRecordBackend(
  recordId,
  { decision, note } = {},
  actorEmail,
  actorRole = "",
) {
  const current = await getLifecycleRecordBackend(recordId);
  if (!current) {
    return null;
  }

  const timestamp = nowIso();
  const baseWorkflow = asObject(current.workflow, {});
  const approvalResult = applyApprovalDecision({
    workflow: baseWorkflow,
    actorRole,
    actorEmail,
    decision,
    note,
    atIso: timestamp,
  });

  const normalized = normalizeLifecyclePayload(
    {
      status: approvalResult.status,
      workflow: approvalResult.workflow,
    },
    actorEmail,
    actorRole,
    { base: current },
  );

  const effects = await applyLifecycleAutomations(normalized, actorEmail, actorRole);
  const updated = await updateCollectionRecord(getCollectionName("lifecycle"), recordId, {
    ...normalized,
    lastAutomationEffects: effects,
    lastAutomationAt: nowIso(),
    lastAutomationBy: actorEmail,
  });

  await syncOnboardingEvidenceToEmployeeDocuments(updated, actorEmail).catch(() => null);

  return {
    record: updated,
    effects,
  };
}

function normalizeAttendancePayload(payload, actorEmail, { base } = {}) {
  const timestamp = nowIso();
  const employeeEmail = normalizeEmail(payload?.employeeEmail || base?.employeeEmail);
  if (!employeeEmail) {
    throw new Error("invalid_employee_email");
  }

  const next = {
    employeeEmail,
    employee: asString(payload?.employee, asString(base?.employee, employeeEmail)),
    date: asString(payload?.date, asString(base?.date, timestamp.slice(0, 10))),
    checkIn: asString(payload?.checkIn, asString(base?.checkIn, "-")),
    checkOut: asString(payload?.checkOut, asString(base?.checkOut, "-")),
    status: asString(payload?.status, asString(base?.status, "Recorded")),
    reason: asString(payload?.reason, asString(base?.reason, "")),
    createdAt: asString(base?.createdAt, timestamp),
    createdBy: asString(base?.createdBy, actorEmail),
    updatedAt: timestamp,
    updatedBy: actorEmail,
  };

  next.modificationTrail = appendTrail(base?.modificationTrail, {
    at: timestamp,
    by: actorEmail,
    action: base ? "update" : "create",
    status: next.status,
    checkIn: next.checkIn,
    checkOut: next.checkOut,
    reason: next.reason,
  });

  return next;
}

function normalizeLeavePayload(payload, actorEmail, { base } = {}) {
  const timestamp = nowIso();
  const employeeEmail = normalizeEmail(payload?.employeeEmail || base?.employeeEmail);
  if (!employeeEmail) {
    throw new Error("invalid_employee_email");
  }

  const status = asString(payload?.status, asString(base?.status, "Pending"));
  const next = {
    employeeEmail,
    employee: asString(payload?.employee, asString(base?.employee, employeeEmail)),
    leaveType: asString(payload?.leaveType, asString(base?.leaveType, "Leave")),
    startDate: asString(payload?.startDate, asString(base?.startDate, "")),
    endDate: asString(payload?.endDate, asString(base?.endDate, "")),
    reason: asString(payload?.reason, asString(base?.reason, "")),
    status,
    approver: asString(payload?.approver, asString(base?.approver, "")),
    approvalNote: asString(payload?.approvalNote, asString(base?.approvalNote, "")),
    createdAt: asString(base?.createdAt, timestamp),
    createdBy: asString(base?.createdBy, actorEmail),
    updatedAt: timestamp,
    updatedBy: actorEmail,
  };

  next.modificationTrail = appendTrail(base?.modificationTrail, {
    at: timestamp,
    by: actorEmail,
    action: base ? "update" : "create",
    status,
    leaveType: next.leaveType,
  });

  return next;
}

export async function listAttendanceLogsBackend({ ownerEmail } = {}) {
  return await listCollectionRecords(getCollectionName("attendance"), {
    filterField: ownerEmail ? "employeeEmail" : undefined,
    filterValue: ownerEmail ? normalizeEmail(ownerEmail) : undefined,
  });
}

export async function getAttendanceLogBackend(recordId) {
  return await getCollectionRecordById(getCollectionName("attendance"), recordId);
}

export async function createAttendanceLogBackend(payload, actorEmail) {
  const normalized = normalizeAttendancePayload(payload, actorEmail);
  return await createCollectionRecord(getCollectionName("attendance"), normalized);
}

export async function updateAttendanceLogBackend(recordId, payload, actorEmail) {
  const current = await getAttendanceLogBackend(recordId);
  if (!current) {
    return null;
  }
  const normalized = normalizeAttendancePayload(payload, actorEmail, { base: current });
  return await updateCollectionRecord(getCollectionName("attendance"), recordId, normalized);
}

export async function listLeaveRequestsBackend({ ownerEmail } = {}) {
  return await listCollectionRecords(getCollectionName("leave"), {
    filterField: ownerEmail ? "employeeEmail" : undefined,
    filterValue: ownerEmail ? normalizeEmail(ownerEmail) : undefined,
  });
}

export async function getLeaveRequestBackend(recordId) {
  return await getCollectionRecordById(getCollectionName("leave"), recordId);
}

export async function createLeaveRequestBackend(payload, actorEmail) {
  const normalized = normalizeLeavePayload(payload, actorEmail);
  return await createCollectionRecord(getCollectionName("leave"), normalized);
}

export async function updateLeaveRequestBackend(recordId, payload, actorEmail) {
  const current = await getLeaveRequestBackend(recordId);
  if (!current) {
    return null;
  }
  const normalized = normalizeLeavePayload(payload, actorEmail, { base: current });
  return await updateCollectionRecord(getCollectionName("leave"), recordId, normalized);
}

function normalizePerformancePayload(payload, actorEmail, { base } = {}) {
  const timestamp = nowIso();
  const employeeEmail = normalizeEmail(payload?.employeeEmail || base?.employeeEmail);
  if (!employeeEmail) {
    throw new Error("invalid_employee_email");
  }

  return {
    employeeEmail,
    employee: asString(payload?.employee, asString(base?.employee, employeeEmail)),
    period: asString(payload?.period, asString(base?.period, "")),
    kpiScore: asString(payload?.kpiScore, asString(base?.kpiScore, "")),
    evaluationForm: payload?.evaluationForm ?? base?.evaluationForm ?? {},
    reviewHistory: asArray(payload?.reviewHistory ?? base?.reviewHistory),
    promotionJustification: asString(payload?.promotionJustification, asString(base?.promotionJustification, "")),
    reviewer: asString(payload?.reviewer, asString(base?.reviewer, "")),
    rating: asString(payload?.rating, asString(base?.rating, "")),
    status: asString(payload?.status, asString(base?.status, "Draft")),
    createdAt: asString(base?.createdAt, timestamp),
    createdBy: asString(base?.createdBy, actorEmail),
    updatedAt: timestamp,
    updatedBy: actorEmail,
    traceability: appendTrail(base?.traceability, {
      at: timestamp,
      by: actorEmail,
      action: base ? "update" : "create",
      period: asString(payload?.period, asString(base?.period, "")),
    }),
  };
}

export async function listPerformanceRecordsBackend({ ownerEmail } = {}) {
  return await listCollectionRecords(getCollectionName("performance"), {
    filterField: ownerEmail ? "employeeEmail" : undefined,
    filterValue: ownerEmail ? normalizeEmail(ownerEmail) : undefined,
  });
}

export async function getPerformanceRecordBackend(recordId) {
  return await getCollectionRecordById(getCollectionName("performance"), recordId);
}

export async function createPerformanceRecordBackend(payload, actorEmail) {
  const normalized = normalizePerformancePayload(payload, actorEmail);
  return await createCollectionRecord(getCollectionName("performance"), normalized);
}

export async function updatePerformanceRecordBackend(recordId, payload, actorEmail) {
  const current = await getPerformanceRecordBackend(recordId);
  if (!current) {
    return null;
  }
  const normalized = normalizePerformancePayload(payload, actorEmail, { base: current });
  return await updateCollectionRecord(getCollectionName("performance"), recordId, normalized);
}

function normalizeTemplatePayload(payload, actorEmail, { base } = {}) {
  const timestamp = nowIso();
  const version = asString(payload?.version, asString(base?.version, "v1.0"));
  const templateName = asString(payload?.templateName, asString(base?.templateName));
  if (!templateName) {
    throw new Error("invalid_template_name");
  }

  const previousVersionEntry = base
    ? {
        version: asString(base.version, "v1.0"),
        changedAt: timestamp,
        changedBy: actorEmail,
        note: asString(payload?.changeNote, "Template updated"),
      }
    : null;

  const currentHistory = asArray(base?.versionHistory);
  const nextHistory = previousVersionEntry ? appendTrail(currentHistory, previousVersionEntry) : currentHistory;

  const modificationLog = appendTrail(base?.modificationLog, {
    at: timestamp,
    by: actorEmail,
    action: base ? "update" : "upload",
    version,
  });

  return {
    templateName,
    category: asString(payload?.category, asString(base?.category, "HR Template")),
    classification: asString(payload?.classification, asString(base?.classification, "Restricted PII")),
    documentType: asString(payload?.documentType, asString(base?.documentType, "Template")),
    tags: asArray(payload?.tags ?? base?.tags),
    version,
    status: asString(payload?.status, asString(base?.status, "Active")),
    contentRef: asString(payload?.contentRef, asString(base?.contentRef, "")),
    acknowledgments: asArray(payload?.acknowledgments ?? base?.acknowledgments),
    usageLogs: asArray(payload?.usageLogs ?? base?.usageLogs),
    versionHistory: nextHistory,
    modificationLog,
    createdAt: asString(base?.createdAt, timestamp),
    createdBy: asString(base?.createdBy, actorEmail),
    updatedAt: timestamp,
    updatedBy: actorEmail,
  };
}

export async function listDocumentTemplatesBackend() {
  return await listCollectionRecords(getCollectionName("templates"));
}

export async function getDocumentTemplateBackend(recordId) {
  return await getCollectionRecordById(getCollectionName("templates"), recordId);
}

export async function createDocumentTemplateBackend(payload, actorEmail) {
  const normalized = normalizeTemplatePayload(payload, actorEmail);
  return await createCollectionRecord(getCollectionName("templates"), normalized);
}

export async function updateDocumentTemplateBackend(recordId, payload, actorEmail) {
  const current = await getDocumentTemplateBackend(recordId);
  if (!current) {
    return null;
  }
  const normalized = normalizeTemplatePayload(payload, actorEmail, { base: current });
  return await updateCollectionRecord(getCollectionName("templates"), recordId, normalized);
}

export async function deleteDocumentTemplateBackend(recordId, actorEmail) {
  const current = await getDocumentTemplateBackend(recordId);
  if (!current) {
    return null;
  }
  return await updateCollectionRecord(getCollectionName("templates"), recordId, {
    ...current,
    status: "Archived",
    archivedAt: nowIso(),
    archivedBy: actorEmail,
    updatedAt: nowIso(),
    updatedBy: actorEmail,
    modificationLog: appendTrail(current.modificationLog, {
      at: nowIso(),
      by: actorEmail,
      action: "archive",
      version: asString(current.version, "v1.0"),
    }),
  });
}

function normalizeExportRequestPayload(payload, actorEmail, { base } = {}) {
  const timestamp = nowIso();
  const dataset = asString(payload?.dataset, asString(base?.dataset, "Employee Dataset"));
  if (!dataset) {
    throw new Error("invalid_export_dataset");
  }

  const format = asString(payload?.format, asString(base?.format, "CSV")).toUpperCase();
  const requestedBy = normalizeEmail(payload?.requestedBy || base?.requestedBy || actorEmail);
  const scope = asString(payload?.scope, asString(base?.scope, "full"));
  const status = asString(payload?.status, asString(base?.status, "Pending"));
  const estimateVolume = asString(payload?.estimateVolume, asString(base?.estimateVolume, "0"));
  const justification = asString(payload?.justification, asString(base?.justification));

  return {
    dataset,
    format,
    requestedBy,
    scope,
    estimateVolume,
    justification,
    status,
    reviewer: asString(payload?.reviewer, asString(base?.reviewer, "")),
    reviewNote: asString(payload?.reviewNote, asString(base?.reviewNote, "")),
    reviewedAt: asString(payload?.reviewedAt, asString(base?.reviewedAt, "")),
    exportedAt: asString(payload?.exportedAt, asString(base?.exportedAt, "")),
    exportedBy: asString(payload?.exportedBy, asString(base?.exportedBy, "")),
    alert: asString(payload?.alert, asString(base?.alert, "")),
    createdAt: asString(base?.createdAt, timestamp),
    createdBy: asString(base?.createdBy, actorEmail),
    updatedAt: timestamp,
    updatedBy: actorEmail,
    history: appendTrail(base?.history, {
      at: timestamp,
      by: actorEmail,
      action: base ? "update" : "create",
      status,
    }),
  };
}

export async function listExportRequestsBackend({ ownerEmail } = {}) {
  return await listCollectionRecords(getCollectionName("exports"), {
    filterField: ownerEmail ? "requestedBy" : undefined,
    filterValue: ownerEmail ? normalizeEmail(ownerEmail) : undefined,
  });
}

export async function getExportRequestBackend(recordId) {
  return await getCollectionRecordById(getCollectionName("exports"), recordId);
}

export async function createExportRequestBackend(payload, actorEmail) {
  const normalized = normalizeExportRequestPayload(payload, actorEmail);
  return await createCollectionRecord(getCollectionName("exports"), normalized);
}

export async function updateExportRequestBackend(recordId, payload, actorEmail) {
  const current = await getExportRequestBackend(recordId);
  if (!current) {
    return null;
  }
  const normalized = normalizeExportRequestPayload(payload, actorEmail, { base: current });
  return await updateCollectionRecord(getCollectionName("exports"), recordId, normalized);
}

export async function approveExportRequestBackend(recordId, actorEmail, { approved, note } = {}) {
  const status = approved ? "Approved" : "Rejected";
  return await updateExportRequestBackend(
    recordId,
    {
      status,
      reviewer: actorEmail,
      reviewNote: asString(note, ""),
      reviewedAt: nowIso(),
    },
    actorEmail,
  );
}

export async function markExportAsCompletedBackend(recordId, actorEmail) {
  return await updateExportRequestBackend(
    recordId,
    {
      status: "Exported",
      exportedBy: actorEmail,
      exportedAt: nowIso(),
    },
    actorEmail,
  );
}

function normalizeIncidentSeverity(value, fallback = "Low") {
  const normalized = asString(value, fallback).toLowerCase();
  if (normalized === "critical") {
    return "High";
  }
  if (normalized === "medium") {
    return "Low";
  }
  const matched = INCIDENT_SEVERITY_LEVELS.find((entry) => entry.toLowerCase() === normalized);
  return matched || "Low";
}

function normalizeIncidentStatus(value, fallback = "Open") {
  const normalized = asString(value, fallback).toLowerCase();
  const matched = INCIDENT_STATUS_VALUES.find((entry) => entry.toLowerCase() === normalized);
  return matched || "Open";
}

function normalizeIncidentContainmentStatus(value, fallback = "Not Started") {
  const normalized = asString(value, fallback).toLowerCase();
  const matched = INCIDENT_CONTAINMENT_STATUS_VALUES.find((entry) => entry.toLowerCase() === normalized);
  return matched || "Not Started";
}

function normalizeIncidentImpactStatus(value, fallback = "Pending") {
  const normalized = asString(value, fallback).toLowerCase();
  const matched = INCIDENT_IMPACT_STATUS_VALUES.find((entry) => entry.toLowerCase() === normalized);
  return matched || "Pending";
}

function normalizeIncidentType(value, fallback = "Other") {
  const normalized = asString(value, fallback).toLowerCase();
  const matched = INCIDENT_TYPE_VALUES.find((entry) => entry.toLowerCase() === normalized);
  return matched || "Other";
}

function buildIncidentCode(isoValue = nowIso()) {
  const date = new Date(isoValue || nowIso());
  if (Number.isNaN(date.getTime())) {
    return `INC-${Date.now().toString().slice(-10)}`;
  }
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const random = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `INC-${yyyy}${mm}${dd}-${hh}${mi}${random}`;
}

function extractEvidenceExtension(value) {
  const normalized = asString(value).toLowerCase();
  if (!normalized) {
    return "";
  }
  const clean = normalized.split("?")[0].split("#")[0];
  const token = clean.split(".").pop() || "";
  if (!/^[a-z0-9]{2,10}$/.test(token)) {
    return "";
  }
  return token;
}

function sanitizeIncidentEvidenceDocuments(value, actorEmail, fallbackNowIso) {
  const timestamp = asString(fallbackNowIso, nowIso());
  const config = getIncidentEvidenceValidationConfig();
  return asArray(value)
    .map((entry, index) => {
      const source = asObject(entry, {});
      const uploadedAt = toIsoOrEmpty(source.uploadedAt || timestamp) || timestamp;
      const uploadedBy = normalizeEmail(source.uploadedBy || actorEmail);
      const name = asString(source.name, `Incident Evidence ${index + 1}`);
      const type = asString(source.type, "Incident Evidence");
      const ref = asString(source.ref);
      const storagePath = asString(source.storagePath);
      const fileExtension = extractEvidenceExtension(source.fileExtension || name || storagePath || ref);
      const contentType = normalizeText(source.contentType);
      const sizeBytes = Number.isFinite(Number(source.sizeBytes)) ? Number(source.sizeBytes) : 0;
      const id = asString(source.id || source.recordId || storagePath || `${index + 1}`);
      if (!name && !ref && !storagePath) {
        return null;
      }
      if (fileExtension && !config.allowedExtensions.has(fileExtension)) {
        throw new Error("invalid_incident_evidence_extension");
      }
      if (contentType && !config.allowedMimeTypes.has(contentType)) {
        throw new Error("invalid_incident_evidence_content_type");
      }
      if (sizeBytes > config.maxBytes) {
        throw new Error("invalid_incident_evidence_size");
      }
      return {
        id,
        name: name || "Incident Evidence",
        type: type || "Incident Evidence",
        ref,
        storagePath,
        fileExtension,
        contentType,
        sizeBytes,
        scanStatus: asString(source.scanStatus),
        scanReference: asString(source.scanReference),
        scannedAt: toIsoOrEmpty(source.scannedAt || ""),
        uploadedAt,
        uploadedBy: uploadedBy || actorEmail,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_INCIDENT_EVIDENCE_ITEMS);
}

function sanitizeIncidentAlertOccurrences(value) {
  return asArray(value)
    .map((entry) => {
      const source = asObject(entry, {});
      const at = toIsoOrEmpty(source.at || source.occurredAt || "");
      if (!at) {
        return null;
      }
      return {
        at,
        activityName: asString(source.activityName || source.action || "Activity"),
        module: asString(source.module || "System"),
        sourceEventId: asString(source.sourceEventId || source.eventId || ""),
        sourceIp: asString(source.sourceIp || ""),
        requestPath: asString(source.requestPath || ""),
        requestMethod: asString(source.requestMethod || ""),
        actorEmail: normalizeEmail(source.actorEmail || source.performedBy || ""),
        targetEmployeeEmail: normalizeEmail(source.targetEmployeeEmail || source.employeeEmail || ""),
      };
    })
    .filter(Boolean)
    .slice(-40);
}

function resolveIncidentEscalationLevel({ severity, restrictedPiiInvolved, executiveNotificationRequired }) {
  if (severity === "High" || executiveNotificationRequired) {
    return "Executive";
  }
  if (restrictedPiiInvolved) {
    return "GRC";
  }
  return "Operational";
}

function resolveIncidentRegulatoryStatus({
  regulatoryNotificationRequired,
  regulatoryNotifiedAt,
  regulatoryDueAt,
  nowIsoValue = nowIso(),
}) {
  if (!regulatoryNotificationRequired) {
    return "Not Required";
  }
  if (toTimeMs(regulatoryNotifiedAt)) {
    return "Notified";
  }
  const dueAtMs = toTimeMs(regulatoryDueAt);
  const nowMs = toTimeMs(nowIsoValue) || Date.now();
  if (Number.isFinite(dueAtMs) && dueAtMs < nowMs) {
    return "Overdue";
  }
  return "Pending";
}

function incidentSeverityRank(value) {
  const severity = normalizeIncidentSeverity(value);
  switch (severity) {
    case "High":
      return 1;
    default:
      return 0;
  }
}

function isIncidentAccessEvent(row) {
  const method = normalizeText(row?.requestMethod);
  const activity = normalizeText(row?.activityName);
  return method === "get" || activity.includes("viewed") || activity.includes("listed") || activity.includes("access");
}

function isIncidentExportEvent(row) {
  const moduleName = normalizeText(row?.module);
  const path = normalizeText(row?.requestPath);
  const activity = normalizeText(row?.activityName);
  return moduleName.includes("export") || path.includes("/api/hris/exports") || activity.includes("export");
}

function isIncidentDeletionEvent(row) {
  const method = normalizeText(row?.requestMethod);
  const activity = normalizeText(row?.activityName);
  return (
    method === "delete" ||
    activity.includes("delete") ||
    activity.includes("purge") ||
    activity.includes("removed") ||
    activity.includes("archive")
  );
}

function isIncidentAdministrativeEvent(row) {
  const moduleName = normalizeText(row?.module);
  const method = normalizeText(row?.requestMethod);
  const activity = normalizeText(row?.activityName);
  return (
    moduleName.includes("authorization") ||
    moduleName.includes("user management") ||
    moduleName.includes("access management") ||
    method === "patch" ||
    method === "post" ||
    activity.includes("approve") ||
    activity.includes("revok") ||
    activity.includes("invite") ||
    activity.includes("role")
  );
}

function normalizeIncidentForensicSample(row) {
  const metadata = asObject(row?.metadata, {});
  return {
    id: asString(row?.id),
    activityName: asString(row?.activityName),
    module: asString(row?.module),
    status: asString(row?.status),
    occurredAt: asString(row?.occurredAt),
    performedBy: asString(row?.performedBy),
    requestMethod: asString(row?.requestMethod),
    requestPath: asString(row?.requestPath),
    sourceIp: asString(row?.sourceIp || metadata?.sourceIp),
    userAgent: asString(row?.userAgent || metadata?.userAgent),
    device: asString(metadata?.device || ""),
    recordRef: asString(metadata?.recordRef || metadata?.recordId),
    resourceLabel: asString(metadata?.resourceLabel),
    employeeEmail: asString(metadata?.employeeEmail),
    targetEmployeeEmail: asString(metadata?.targetEmployeeEmail || metadata?.affectedEmployeeEmail),
    viewedFields: asArray(metadata?.viewedFields, []),
    viewedFieldCount: Number(metadata?.viewedFieldCount || 0),
    accessedDocuments: asArray(metadata?.accessedDocuments, []),
    accessedDocumentCount: Number(metadata?.accessedDocumentCount || 0),
    updatedFields: asArray(metadata?.updatedFields, []),
    changedFields: asArray(metadata?.changedFields, []),
  };
}

function incidentMatchesSubject(row, subjectEmail) {
  const subject = normalizeEmail(subjectEmail);
  if (!subject) {
    return true;
  }

  const metadata = asObject(row?.metadata, {});
  const candidates = [
    row?.performedBy,
    row?.performedByEmail,
    metadata.employeeEmail,
    metadata.ownerEmail,
    metadata.requestedBy,
    metadata.targetEmployeeEmail,
    metadata.affectedEmployeeEmail,
  ];
  return candidates.some((value) => normalizeEmail(value) === subject);
}

async function buildIncidentForensicSnapshot(record, { limit } = {}) {
  const nowIsoValue = nowIso();
  const windowStart = toIsoOrEmpty(record?.forensicWindowStart || record?.detectedAt) || nowIsoValue;
  const windowEnd = toIsoOrEmpty(record?.forensicWindowEnd || nowIsoValue) || nowIsoValue;
  const windowStartMs = toTimeMs(windowStart) || 0;
  const windowEndMs = toTimeMs(windowEnd) || Date.now();
  const subjectEmail = normalizeEmail(record?.affectedEmployeeEmail || record?.employeeEmail || "");
  const safeLimit = Number.isFinite(Number(limit)) ? Number(limit) : 1800;

  let rows = [];
  try {
    rows = await listAuditEvents({ limit: Math.max(100, Math.min(5000, safeLimit)) });
  } catch {
    rows = [];
  }

  const scopedRows = rows.filter((row) => {
    const occurredAtMs = toTimeMs(row?.occurredAt || row?.loggedAt);
    if (!Number.isFinite(occurredAtMs)) {
      return false;
    }
    if (occurredAtMs < windowStartMs || occurredAtMs > windowEndMs) {
      return false;
    }
    return incidentMatchesSubject(row, subjectEmail);
  });

  const buckets = {
    accessLogs: [],
    exportLogs: [],
    administrativeActions: [],
    deletionActivities: [],
  };

  scopedRows.forEach((row) => {
    const sample = normalizeIncidentForensicSample(row);
    if (isIncidentDeletionEvent(row)) {
      buckets.deletionActivities.push(sample);
      return;
    }
    if (isIncidentExportEvent(row)) {
      buckets.exportLogs.push(sample);
      return;
    }
    if (isIncidentAdministrativeEvent(row)) {
      buckets.administrativeActions.push(sample);
      return;
    }
    if (isIncidentAccessEvent(row)) {
      buckets.accessLogs.push(sample);
    }
  });

  return {
    generatedAt: nowIsoValue,
    windowStart,
    windowEnd,
    scopedSubjectEmail: subjectEmail || "",
    totalScopedLogs: scopedRows.length,
    accessLogsCount: buckets.accessLogs.length,
    exportLogsCount: buckets.exportLogs.length,
    administrativeActionsCount: buckets.administrativeActions.length,
    deletionActivitiesCount: buckets.deletionActivities.length,
    accessLogs: buckets.accessLogs.slice(0, MAX_INCIDENT_FORENSIC_SAMPLES),
    exportLogs: buckets.exportLogs.slice(0, MAX_INCIDENT_FORENSIC_SAMPLES),
    administrativeActions: buckets.administrativeActions.slice(0, MAX_INCIDENT_FORENSIC_SAMPLES),
    deletionActivities: buckets.deletionActivities.slice(0, MAX_INCIDENT_FORENSIC_SAMPLES),
  };
}

function normalizeIncidentWritePayload(payload, actorEmail, { base } = {}) {
  const timestamp = nowIso();
  const title = asString(payload?.title, asString(base?.title));
  if (!title) {
    throw new Error("invalid_incident_title");
  }

  const detectedAt = toIsoOrEmpty(payload?.detectedAt || base?.detectedAt || timestamp) || timestamp;
  const severity = normalizeIncidentSeverity(payload?.severity, asString(base?.severity, "Low"));
  const incidentType = normalizeIncidentType(payload?.incidentType, asString(base?.incidentType, "Other"));
  const restrictedPiiInvolved = asBoolean(payload?.restrictedPiiInvolved, asBoolean(base?.restrictedPiiInvolved, false));
  const executiveNotificationRequired = asBoolean(
    payload?.executiveNotificationRequired,
    severity === "High" || asBoolean(base?.executiveNotificationRequired, false),
  );
  const escalationRequired = asBoolean(
    payload?.escalationRequired,
    executiveNotificationRequired ||
      restrictedPiiInvolved ||
      incidentSeverityRank(severity) >= incidentSeverityRank("High") ||
      asBoolean(base?.escalationRequired, false),
  );
  const escalationLevel = resolveIncidentEscalationLevel({
    severity,
    restrictedPiiInvolved,
    executiveNotificationRequired,
  });

  const status = normalizeIncidentStatus(payload?.status, asString(base?.status, "Open"));
  const containmentStatus = normalizeIncidentContainmentStatus(
    payload?.containmentStatus,
    asString(base?.containmentStatus, "Not Started"),
  );
  const impactAssessmentStatus = normalizeIncidentImpactStatus(
    payload?.impactAssessmentStatus,
    asString(base?.impactAssessmentStatus, "Pending"),
  );

  const regulatoryNotificationRequired = asBoolean(
    payload?.regulatoryNotificationRequired,
    restrictedPiiInvolved || asBoolean(base?.regulatoryNotificationRequired, false),
  );
  const regulatoryDueAt = regulatoryNotificationRequired
    ? asString(base?.regulatoryDueAt, addHoursToIso(detectedAt, 72))
    : "";
  const regulatoryNotifiedAt = toIsoOrEmpty(payload?.regulatoryNotifiedAt || base?.regulatoryNotifiedAt || "");
  const affectedIndividualsNotifiedAt = toIsoOrEmpty(
    payload?.affectedIndividualsNotifiedAt || base?.affectedIndividualsNotifiedAt || "",
  );
  const regulatoryStatus = resolveIncidentRegulatoryStatus({
    regulatoryNotificationRequired,
    regulatoryNotifiedAt,
    regulatoryDueAt,
    nowIsoValue: timestamp,
  });

  const documentationRetained = asBoolean(payload?.documentationRetained, asBoolean(base?.documentationRetained, false));
  const documentationRetainedAt = documentationRetained
    ? toIsoOrEmpty(payload?.documentationRetainedAt || base?.documentationRetainedAt || timestamp) || timestamp
    : "";
  const executiveNotifiedAt = toIsoOrEmpty(payload?.executiveNotifiedAt || base?.executiveNotifiedAt || "");
  const grcAlertedAt = escalationRequired
    ? toIsoOrEmpty(payload?.grcAlertedAt || base?.grcAlertedAt || timestamp) || timestamp
    : "";
  const breachConfirmed = asBoolean(payload?.breachConfirmed, asBoolean(base?.breachConfirmed, false));
  const breachConfirmedAt = breachConfirmed
    ? toIsoOrEmpty(payload?.breachConfirmedAt || base?.breachConfirmedAt || timestamp) || timestamp
    : "";
  const breachConfirmedBy = breachConfirmed
    ? normalizeEmail(payload?.breachConfirmedBy || base?.breachConfirmedBy || actorEmail)
    : "";

  const containmentStartedAt =
    containmentStatus === "In Progress" || containmentStatus === "Contained"
      ? toIsoOrEmpty(payload?.containmentStartedAt || base?.containmentStartedAt || timestamp) || timestamp
      : toIsoOrEmpty(payload?.containmentStartedAt || base?.containmentStartedAt || "");
  const containmentCompletedAt =
    containmentStatus === "Contained"
      ? toIsoOrEmpty(payload?.containmentCompletedAt || base?.containmentCompletedAt || timestamp) || timestamp
      : toIsoOrEmpty(payload?.containmentCompletedAt || base?.containmentCompletedAt || "");
  const impactAssessmentCompletedAt =
    impactAssessmentStatus === "Completed"
      ? toIsoOrEmpty(payload?.impactAssessmentCompletedAt || base?.impactAssessmentCompletedAt || timestamp) || timestamp
      : toIsoOrEmpty(payload?.impactAssessmentCompletedAt || base?.impactAssessmentCompletedAt || "");

  const forensicWindowStart = toIsoOrEmpty(payload?.forensicWindowStart || base?.forensicWindowStart || detectedAt) || detectedAt;
  const forensicWindowEnd = toIsoOrEmpty(payload?.forensicWindowEnd || base?.forensicWindowEnd || timestamp) || timestamp;
  const evidenceDocuments = sanitizeIncidentEvidenceDocuments(
    Object.prototype.hasOwnProperty.call(asObject(payload, {}), "evidenceDocuments")
      ? payload?.evidenceDocuments
      : base?.evidenceDocuments,
    actorEmail,
    timestamp,
  );
  const detectionWindowStart = toIsoOrEmpty(payload?.detectionWindowStart || base?.detectionWindowStart || "");
  const detectionWindowEnd = toIsoOrEmpty(payload?.detectionWindowEnd || base?.detectionWindowEnd || "");
  const detectionCorrelationKey = asString(payload?.detectionCorrelationKey, asString(base?.detectionCorrelationKey));
  const alertDescription = asString(payload?.alertDescription, asString(base?.alertDescription));
  const alertOccurrences = sanitizeIncidentAlertOccurrences(payload?.alertOccurrences || base?.alertOccurrences);
  const alertFirstObservedAt = toIsoOrEmpty(
    payload?.alertFirstObservedAt || base?.alertFirstObservedAt || detectedAt || "",
  );
  const alertLastObservedAt = toIsoOrEmpty(
    payload?.alertLastObservedAt || base?.alertLastObservedAt || detectedAt || "",
  );
  const defaultOccurrenceCount = alertOccurrences.length > 0 ? alertOccurrences.length : 1;
  const alertOccurrenceCount = Math.max(
    1,
    Number.parseInt(
      String(
        payload?.alertOccurrenceCount ??
          base?.alertOccurrenceCount ??
          defaultOccurrenceCount,
      ),
      10,
    ) || defaultOccurrenceCount,
  );
  const alertRecipients = asArray(payload?.alertRecipients || base?.alertRecipients)
    .map((value) => normalizeEmail(value))
    .filter(Boolean)
    .slice(0, 40);
  const involvedEmployees = asArray(payload?.involvedEmployees || base?.involvedEmployees)
    .map((value) => normalizeEmail(value))
    .filter(Boolean)
    .slice(0, 40);

  return {
    incidentCode: asString(base?.incidentCode, buildIncidentCode(detectedAt)),
    title,
    summary: asString(payload?.summary, asString(base?.summary)),
    incidentType,
    severity,
    status,
    restrictedPiiInvolved,
    affectedEmployeeEmail: normalizeEmail(payload?.affectedEmployeeEmail || base?.affectedEmployeeEmail),
    ownerEmail: normalizeEmail(payload?.ownerEmail || base?.ownerEmail || actorEmail),
    department: asString(payload?.department, asString(base?.department)),
    involvedEmployees,
    escalationRequired,
    escalationLevel,
    executiveNotificationRequired,
    executiveNotifiedAt,
    grcAlertedAt,
    containmentStatus,
    containmentSummary: asString(payload?.containmentSummary, asString(base?.containmentSummary)),
    containmentStartedAt,
    containmentCompletedAt,
    impactAssessmentStatus,
    impactSummary: asString(payload?.impactSummary, asString(base?.impactSummary)),
    impactAssessmentCompletedAt,
    regulatoryNotificationRequired,
    regulatoryDueAt,
    regulatoryNotifiedAt,
    affectedIndividualsNotifiedAt,
    regulatoryStatus,
    documentationRetained,
    documentationRetainedAt,
    documentationLocation: asString(payload?.documentationLocation, asString(base?.documentationLocation)),
    breachConfirmed,
    breachConfirmedAt,
    breachConfirmedBy,
    correctiveActions: asString(payload?.correctiveActions, asString(base?.correctiveActions)),
    disciplinaryActions: asString(payload?.disciplinaryActions, asString(base?.disciplinaryActions)),
    resolutionNotes: asString(payload?.resolutionNotes, asString(base?.resolutionNotes)),
    closureApprovalStatus: asString(payload?.closureApprovalStatus, asString(base?.closureApprovalStatus, "Pending Approval")),
    closureApprovedBy: asString(payload?.closureApprovedBy, asString(base?.closureApprovedBy)),
    closureApprovedAt: toIsoOrEmpty(payload?.closureApprovedAt || base?.closureApprovedAt || ""),
    forensicWindowStart,
    forensicWindowEnd,
    evidenceDocuments,
    evidenceDocumentsCount: evidenceDocuments.length,
    notes: asString(payload?.notes, asString(base?.notes)),
    classificationStandard: asString(payload?.classificationStandard, asString(base?.classificationStandard, "CLIO-IR-SEVERITY-V1")),
    autoGenerated: asBoolean(payload?.autoGenerated, asBoolean(base?.autoGenerated, false)),
    detectionRuleId: asString(payload?.detectionRuleId, asString(base?.detectionRuleId)),
    detectionFingerprint: asString(payload?.detectionFingerprint, asString(base?.detectionFingerprint)),
    detectionCorrelationKey,
    detectionWindowStart,
    detectionWindowEnd,
    alertDescription,
    alertOccurrenceCount,
    alertFirstObservedAt,
    alertLastObservedAt,
    alertOccurrences,
    sourceSystem: asString(payload?.sourceSystem, asString(base?.sourceSystem)),
    sourceEventId: asString(payload?.sourceEventId, asString(base?.sourceEventId)),
    sourceEventModule: asString(payload?.sourceEventModule, asString(base?.sourceEventModule)),
    sourceEventPath: asString(payload?.sourceEventPath, asString(base?.sourceEventPath)),
    sourceIp: asString(payload?.sourceIp, asString(base?.sourceIp)),
    alertRecipients,
    alertDispatchSummary: asObject(payload?.alertDispatchSummary, asObject(base?.alertDispatchSummary, {})),
    externalIntegrations: asObject(payload?.externalIntegrations, asObject(base?.externalIntegrations, {})),
    lastAlertDispatchAt: toIsoOrEmpty(payload?.lastAlertDispatchAt || base?.lastAlertDispatchAt || ""),
    detectedAt,
    resolvedAt: toIsoOrEmpty(payload?.resolvedAt || base?.resolvedAt || (status === "Resolved" ? timestamp : "")),
    closedAt: toIsoOrEmpty(payload?.closedAt || base?.closedAt || (status === "Closed" ? timestamp : "")),
    createdAt: asString(base?.createdAt, timestamp),
    createdBy: asString(base?.createdBy, actorEmail),
    updatedAt: timestamp,
    updatedBy: actorEmail,
    traceability: appendTrail(base?.traceability, {
      at: timestamp,
      by: actorEmail,
      action: base ? "update" : "create",
      status,
      severity,
      escalationLevel,
      regulatoryStatus,
    }),
  };
}

function withIncidentForensic(record, forensicSnapshot, actorEmail) {
  const snapshot = asObject(forensicSnapshot, {});
  return {
    ...record,
    forensicSnapshot: snapshot,
    forensicSummary: {
      accessLogsCount: Number(snapshot.accessLogsCount || 0),
      exportLogsCount: Number(snapshot.exportLogsCount || 0),
      administrativeActionsCount: Number(snapshot.administrativeActionsCount || 0),
      deletionActivitiesCount: Number(snapshot.deletionActivitiesCount || 0),
      totalScopedLogs: Number(snapshot.totalScopedLogs || 0),
      generatedAt: asString(snapshot.generatedAt),
      windowStart: asString(snapshot.windowStart),
      windowEnd: asString(snapshot.windowEnd),
    },
    forensicLastUpdatedAt: asString(snapshot.generatedAt, nowIso()),
    forensicLastUpdatedBy: actorEmail,
  };
}

export async function listIncidentRecordsBackend() {
  return await listCollectionRecords(getCollectionName("incidents"));
}

export async function getIncidentRecordBackend(recordId) {
  return await getCollectionRecordById(getCollectionName("incidents"), recordId);
}

export async function createIncidentRecordBackend(payload, actorEmail) {
  const normalized = normalizeIncidentWritePayload(payload, actorEmail);
  const forensicSnapshot = await buildIncidentForensicSnapshot(normalized, {
    limit: Number.parseInt(env("CLIO_INCIDENT_FORENSIC_LOG_LIMIT", "1800"), 10),
  });
  const withForensic = withIncidentForensic(normalized, forensicSnapshot, actorEmail);
  return await createCollectionRecord(getCollectionName("incidents"), withForensic);
}

export async function updateIncidentRecordBackend(recordId, payload, actorEmail) {
  const current = await getIncidentRecordBackend(recordId);
  if (!current) {
    return null;
  }
  const normalized = normalizeIncidentWritePayload(payload, actorEmail, { base: current });
  const shouldRefreshForensic =
    asBoolean(payload?.refreshForensicSnapshot, false) ||
    Object.prototype.hasOwnProperty.call(asObject(payload, {}), "forensicWindowStart") ||
    Object.prototype.hasOwnProperty.call(asObject(payload, {}), "forensicWindowEnd") ||
    Object.prototype.hasOwnProperty.call(asObject(payload, {}), "affectedEmployeeEmail") ||
    Object.prototype.hasOwnProperty.call(asObject(payload, {}), "detectedAt");

  const forensicSnapshot = shouldRefreshForensic
    ? await buildIncidentForensicSnapshot(normalized, {
        limit: Number.parseInt(env("CLIO_INCIDENT_FORENSIC_LOG_LIMIT", "1800"), 10),
      })
    : asObject(current.forensicSnapshot, {});
  const withForensic = withIncidentForensic(normalized, forensicSnapshot, actorEmail);
  return await updateCollectionRecord(getCollectionName("incidents"), recordId, withForensic);
}

async function purgeCollectionByRetention(collectionName, cutoff) {
  const db = getDbOrThrow();
  const snapshot = await getDocs(
    query(collection(db, collectionName), where("retentionDeleteAt", "<=", cutoff)),
  );
  let deleted = 0;
  for (const recordSnapshot of snapshot.docs) {
    await deleteDoc(doc(db, collectionName, recordSnapshot.id));
    deleted += 1;
  }
  return deleted;
}

async function purgeEmployeeCollectionByRetention(cutoff) {
  const db = getDbOrThrow();
  const employeesCollection = getCollectionName("employees");
  const snapshot = await getDocs(
    query(collection(db, employeesCollection), where("retentionDeleteAt", "<=", cutoff)),
  );

  let deleted = 0;
  for (const recordSnapshot of snapshot.docs) {
    await deleteEmployeeDocumentSubcollectionById(recordSnapshot.id, { db });
    await deleteDoc(doc(db, employeesCollection, recordSnapshot.id));
    deleted += 1;
  }
  return deleted;
}

export async function purgeArchivedEmployeeDataBackend({ now } = {}) {
  const cutoff = asString(now, nowIso());
  const deletedByCollection = {
    employees: await purgeEmployeeCollectionByRetention(cutoff),
    lifecycle: await purgeCollectionByRetention(getCollectionName("lifecycle"), cutoff),
    attendance: await purgeCollectionByRetention(getCollectionName("attendance"), cutoff),
    leave: await purgeCollectionByRetention(getCollectionName("leave"), cutoff),
    performance: await purgeCollectionByRetention(getCollectionName("performance"), cutoff),
    exports: await purgeCollectionByRetention(getCollectionName("exports"), cutoff),
  };

  const deletedUsers = await purgeDueArchivedUserAccounts({ now: cutoff });
  return {
    cutoff,
    deletedByCollection,
    deletedUsers,
  };
}

function toTimeMs(value) {
  const timestamp = new Date(value || "").getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function toIsoOrEmpty(value) {
  const timestamp = toTimeMs(value);
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  return new Date(timestamp).toISOString();
}

function clampInt(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function deriveRetentionState(retentionDeleteAt, nowMs, dueWithinMs) {
  const retentionMs = toTimeMs(retentionDeleteAt);
  if (!Number.isFinite(retentionMs)) {
    return {
      state: "no_retention",
      daysToDeletion: null,
    };
  }

  const daysToDeletion = Math.ceil((retentionMs - nowMs) / (24 * 60 * 60 * 1000));
  if (retentionMs <= nowMs) {
    return {
      state: "due",
      daysToDeletion,
    };
  }

  if (retentionMs <= nowMs + dueWithinMs) {
    return {
      state: "due_soon",
      daysToDeletion,
    };
  }

  return {
    state: "scheduled",
    daysToDeletion,
  };
}

function getRetentionRecordLabel(moduleId, row, moduleLabel) {
  const recordId = asString(row?.recordId, asString(row?.id));
  if (moduleId === "employees") {
    return asString(row?.name, asString(row?.employeeId, asString(row?.email, recordId || `${moduleLabel} Record`)));
  }
  if (moduleId === "lifecycle") {
    const employee = asString(row?.employee, asString(row?.employeeEmail));
    const category = asString(row?.category);
    return [employee || "Employee", category].filter(Boolean).join(" - ");
  }
  if (moduleId === "attendance") {
    return [asString(row?.employee, "Employee"), asString(row?.date)].filter(Boolean).join(" - ");
  }
  if (moduleId === "leave") {
    return [asString(row?.employee, "Employee"), asString(row?.leaveType, "Leave")].filter(Boolean).join(" - ");
  }
  if (moduleId === "performance") {
    return [asString(row?.employee, "Employee"), asString(row?.period, "Performance")].filter(Boolean).join(" - ");
  }
  if (moduleId === "exports") {
    return [asString(row?.dataset, "Export Request"), asString(row?.format)].filter(Boolean).join(" - ");
  }
  if (moduleId === "user_accounts") {
    return asString(row?.email, recordId || "User Account");
  }

  return asString(
    row?.name,
    asString(row?.employee, asString(row?.dataset, asString(row?.email, recordId || `${moduleLabel} Record`))),
  );
}

function toRetentionArchiveRecord({ moduleId, moduleLabel, row, nowMs, dueWithinMs }) {
  const archivedAt = toIsoOrEmpty(row?.archivedAt);
  const retentionDeleteAt = toIsoOrEmpty(row?.retentionDeleteAt);
  const normalizedStatus = normalizeText(row?.status);
  const normalizedArchiveStatus = normalizeText(row?.archiveStatus);
  const isArchived = Boolean(
    row?.isArchived ||
      archivedAt ||
      retentionDeleteAt ||
      normalizedStatus === "archived" ||
      normalizedArchiveStatus === "archived",
  );
  if (!isArchived) {
    return null;
  }

  const recordId = asString(row?.recordId, asString(row?.id));
  const retention = deriveRetentionState(retentionDeleteAt, nowMs, dueWithinMs);
  const label = getRetentionRecordLabel(moduleId, row, moduleLabel);
  const ownerEmail = normalizeEmail(row?.employeeEmail || row?.email || row?.requestedBy || row?.ownerEmail);
  const subtitleParts = [
    asString(row?.employeeId),
    ownerEmail,
    asString(row?.department),
    asString(row?.category),
  ].filter(Boolean);

  return {
    id: `${moduleId}:${recordId || Math.random().toString(36).slice(2, 10)}`,
    moduleId,
    moduleLabel,
    recordId: recordId || "",
    title: label,
    subtitle: subtitleParts.join(" | "),
    ownerEmail: ownerEmail || "",
    status: asString(row?.status, asString(row?.archiveStatus, "Archived")),
    archiveReason: asString(row?.archiveReason, asString(row?.reason, asString(row?.reviewNote, ""))),
    archivedAt,
    retentionDeleteAt,
    daysToDeletion: retention.daysToDeletion,
    deletionState: retention.state,
    updatedAt: toIsoOrEmpty(row?.updatedAt),
  };
}

function summarizeRetentionRecords(records, { moduleCatalog, nowMs, dueWithinDays }) {
  const dueCounts = {
    due: 0,
    dueSoon: 0,
    scheduled: 0,
    noRetention: 0,
  };

  const moduleCounts = moduleCatalog.map((module) => ({
    id: module.id,
    label: module.label,
    count: 0,
  }));
  const moduleCountById = new Map(moduleCounts.map((item) => [item.id, item]));

  let nextDeletionAt = "";
  let oldestArchivedAt = "";

  records.forEach((record) => {
    if (record.deletionState === "due") {
      dueCounts.due += 1;
    } else if (record.deletionState === "due_soon") {
      dueCounts.dueSoon += 1;
    } else if (record.deletionState === "scheduled") {
      dueCounts.scheduled += 1;
    } else {
      dueCounts.noRetention += 1;
    }

    const moduleCount = moduleCountById.get(record.moduleId);
    if (moduleCount) {
      moduleCount.count += 1;
    }

    if (record.retentionDeleteAt) {
      if (!nextDeletionAt || toTimeMs(record.retentionDeleteAt) < toTimeMs(nextDeletionAt)) {
        nextDeletionAt = record.retentionDeleteAt;
      }
    }

    if (record.archivedAt) {
      if (!oldestArchivedAt || toTimeMs(record.archivedAt) < toTimeMs(oldestArchivedAt)) {
        oldestArchivedAt = record.archivedAt;
      }
    }
  });

  return {
    generatedAt: new Date(nowMs).toISOString(),
    totalArchived: records.length,
    dueNow: dueCounts.due,
    dueWithinWindow: dueCounts.due + dueCounts.dueSoon,
    scheduledFuture: dueCounts.scheduled,
    missingRetentionDate: dueCounts.noRetention,
    nextDeletionAt: nextDeletionAt || null,
    oldestArchivedAt: oldestArchivedAt || null,
    dueWithinDays,
    moduleBreakdown: moduleCounts.sort((left, right) => right.count - left.count),
  };
}

function sortRetentionRecords(records) {
  const stateRank = {
    due: 0,
    due_soon: 1,
    scheduled: 2,
    no_retention: 3,
  };

  return [...records].sort((left, right) => {
    const leftRank = stateRank[left.deletionState] ?? 9;
    const rightRank = stateRank[right.deletionState] ?? 9;
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

export async function listRetentionArchiveSnapshotBackend({
  moduleId = "all",
  status = "all",
  queryText = "",
  dueWithinDays = 30,
  now,
} = {}) {
  const normalizedModuleId = normalizeText(moduleId) || "all";
  const normalizedStatus = normalizeText(status) || "all";
  const normalizedQuery = normalizeText(queryText);
  const retentionYears = getArchiveRetentionYears();
  const safeDueWithinDays = clampInt(dueWithinDays, 30, { min: 1, max: 365 });
  const nowIsoValue = toIsoOrEmpty(now) || nowIso();
  const nowMs = toTimeMs(nowIsoValue) || Date.now();
  const dueWithinMs = safeDueWithinDays * 24 * 60 * 60 * 1000;

  const moduleCatalog = [
    { id: "employees", label: "Employee Records", loader: () => listEmployeeRecordsBackend() },
    { id: "lifecycle", label: "Employment Lifecycle", loader: () => listLifecycleRecordsBackend() },
    { id: "attendance", label: "Attendance", loader: () => listAttendanceLogsBackend() },
    { id: "leave", label: "Leave Requests", loader: () => listLeaveRequestsBackend() },
    { id: "performance", label: "Performance", loader: () => listPerformanceRecordsBackend() },
    { id: "exports", label: "Reports & Exports", loader: () => listExportRequestsBackend() },
    { id: "user_accounts", label: "User Accounts", loader: () => listUserAccounts() },
  ];

  const moduleIds = new Set(moduleCatalog.map((item) => item.id));
  if (normalizedModuleId !== "all" && !moduleIds.has(normalizedModuleId)) {
    throw new Error("invalid_retention_module");
  }

  const supportedStatusFilters = new Set(["all", "due", "due_soon", "scheduled", "no_retention"]);
  const effectiveStatus = supportedStatusFilters.has(normalizedStatus) ? normalizedStatus : "all";

  const loaded = await Promise.all(
    moduleCatalog.map(async (module) => {
      const rows = await module.loader();
      return {
        ...module,
        rows: Array.isArray(rows) ? rows : [],
      };
    }),
  );

  const archivedRecords = loaded.flatMap((module) =>
    module.rows
      .map((row) =>
        toRetentionArchiveRecord({
          moduleId: module.id,
          moduleLabel: module.label,
          row,
          nowMs,
          dueWithinMs,
        }),
      )
      .filter(Boolean),
  );

  const moduleScopedRecords =
    normalizedModuleId === "all"
      ? archivedRecords
      : archivedRecords.filter((record) => record.moduleId === normalizedModuleId);

  const filteredRecords = moduleScopedRecords.filter((record) => {
    const byStatus = effectiveStatus === "all" ? true : record.deletionState === effectiveStatus;
    const textBlob = normalizeText(
      [
        record.moduleLabel,
        record.recordId,
        record.title,
        record.subtitle,
        record.ownerEmail,
        record.archiveReason,
      ].join(" "),
    );
    const byQuery = normalizedQuery ? textBlob.includes(normalizedQuery) : true;
    return byStatus && byQuery;
  });

  return {
    policy: {
      retentionYears,
      dueWithinDays: safeDueWithinDays,
      generatedAt: nowIsoValue,
      moduleCatalog: moduleCatalog.map((module) => ({
        id: module.id,
        label: module.label,
      })),
    },
    summary: summarizeRetentionRecords(moduleScopedRecords, {
      moduleCatalog,
      nowMs,
      dueWithinDays: safeDueWithinDays,
    }),
    records: sortRetentionRecords(filteredRecords),
  };
}
