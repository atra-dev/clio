import {
  addDoc,
  collection,
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
  purgeDueArchivedUserAccounts,
  updateUserAccountRole,
  updateUserAccountStatus,
} from "@/lib/user-accounts";
import { formatEmployeeName } from "@/lib/name-utils";

const MAX_AUDIT_TRAIL_ITEMS = 80;
const DEFAULT_ARCHIVE_RETENTION_YEARS = 5;
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

function env(name, fallback) {
  const value = String(process.env[name] || "").trim();
  return value || fallback;
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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return fallback;
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
  };
  return map[key] || key;
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

  return {
    employeeId: asString(payload?.employeeId, asString(base?.employeeId, `CL-${Date.now().toString().slice(-6)}`)),
    name: composedName,
    firstName,
    middleName,
    lastName,
    suffix,
    email: employeeEmail,
    role: asString(payload?.role, asString(base?.role, "Employee")),
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
    documents: asArray(payload?.documents ?? base?.documents),
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

export async function listEmployeeRecordsBackend({ ownerEmail } = {}) {
  return await listCollectionRecords(getCollectionName("employees"), {
    filterField: ownerEmail ? "email" : undefined,
    filterValue: ownerEmail ? normalizeEmail(ownerEmail) : undefined,
  });
}

export async function getEmployeeRecordBackend(recordId) {
  return await getCollectionRecordById(getCollectionName("employees"), recordId);
}

export async function createEmployeeRecordBackend(payload, actorEmail) {
  const normalized = normalizeEmployeeWritePayload(payload, actorEmail);
  return await createCollectionRecord(getCollectionName("employees"), normalized);
}

export async function updateEmployeeRecordBackend(recordId, payload, actorEmail) {
  const current = await getEmployeeRecordBackend(recordId);
  if (!current) {
    return null;
  }
  const normalized = normalizeEmployeeWritePayload(payload, actorEmail, { base: current });
  return await updateCollectionRecord(getCollectionName("employees"), recordId, normalized);
}

export async function deleteEmployeeRecordBackend(recordId) {
  return await deleteCollectionRecord(getCollectionName("employees"), recordId);
}

function normalizeLifecyclePayload(payload, actorEmail, { base } = {}) {
  const timestamp = nowIso();
  const category = asString(payload?.category, asString(base?.category, "Onboarding"));
  const status = asString(payload?.status, asString(base?.status, "In Progress"));
  const employeeEmail = normalizeEmail(payload?.employeeEmail || base?.employeeEmail);

  return {
    employeeEmail,
    employee: asString(payload?.employee, asString(base?.employee, employeeEmail || "Unknown Employee")),
    category,
    owner: asString(payload?.owner, asString(base?.owner, "HR Operations")),
    details: payload?.details ?? base?.details ?? {},
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
  const isOnboarding = category.includes("onboarding");
  const isFinalized = status.includes("approved") || status.includes("completed");
  return isOnboarding && isFinalized;
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

async function syncUserRoleByLifecycle(record) {
  const normalizedEmail = normalizeEmail(record?.employeeEmail);
  if (!normalizedEmail) {
    throw new Error("invalid_employee_email");
  }

  const targetRole = resolveLifecycleRoleTarget(record);
  if (!targetRole) {
    throw new Error("invalid_target_role");
  }

  const updated = await updateUserAccountRole({
    userId: normalizedEmail,
    role: targetRole,
  });
  if (!updated) {
    throw new Error("role_sync_failed");
  }

  return updated;
}

async function syncEmployeeRecordRoleByLifecycle(record, actorEmail) {
  const normalizedEmail = normalizeEmail(record?.employeeEmail);
  if (!normalizedEmail) {
    throw new Error("invalid_employee_email");
  }

  const targetRole = resolveLifecycleRoleTarget(record);
  if (!targetRole) {
    throw new Error("invalid_target_role");
  }

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

async function activateEmployeeRecordByEmail(email, actorEmail) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("invalid_employee_email");
  }

  const updatedAt = nowIso();
  return await updateCollectionRecordsByField(getCollectionName("employees"), "email", normalizedEmail, (current) => ({
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
  }));
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

export async function listLifecycleRecordsBackend() {
  return await listCollectionRecords(getCollectionName("lifecycle"));
}

export async function getLifecycleRecordBackend(recordId) {
  return await getCollectionRecordById(getCollectionName("lifecycle"), recordId);
}

export async function createLifecycleRecordBackend(payload, actorEmail) {
  const normalized = normalizeLifecyclePayload(payload, actorEmail);
  const effects = [];
  if (shouldApplyOnboardingActivation(normalized)) {
    const activatedAccount = await activateUserAccessByEmail(normalized.employeeEmail);
    const activatedEmployeeRecords = await activateEmployeeRecordByEmail(normalized.employeeEmail, actorEmail);
    effects.push({
      type: "onboarding-activation",
      message: "User account and employee profile activated.",
      accountStatus: activatedAccount?.status || "active",
      employeeRecordsUpdated: activatedEmployeeRecords,
    });
  }
  if (shouldApplyLifecycleRoleSync(normalized)) {
    const employeeRecordsUpdated = await syncEmployeeRecordRoleByLifecycle(normalized, actorEmail);
    const account = await syncUserRoleByLifecycle(normalized);
    effects.push({
      type: "role-sync",
      message: `Role synchronized to ${account?.role || "target role"}.`,
      role: account?.role || null,
      employeeRecordsUpdated,
    });
  }
  if (shouldTriggerAccessRevocation(normalized)) {
    const account = await revokeUserAccessByEmail(normalized.employeeEmail);
    effects.push({
      type: "access-revocation",
      message: "User account access revoked.",
      accountStatus: account?.status || "disabled",
    });
  }
  if (shouldApplyLifecycleArchivePolicy(normalized)) {
    const archiveResult = await archiveEmployeeDataByEmail(normalized, actorEmail);
    effects.push({
      type: "archive-policy",
      message: `Employee data archived until ${archiveResult.retentionDeleteAt}.`,
      retentionDeleteAt: archiveResult.retentionDeleteAt,
      archivedAt: archiveResult.archivedAt,
      counts: archiveResult.counts,
    });
  }

  const created = await createCollectionRecord(getCollectionName("lifecycle"), {
    ...normalized,
    lastAutomationEffects: effects,
    lastAutomationAt: nowIso(),
    lastAutomationBy: actorEmail,
  });
  return {
    record: created,
    effects,
  };
}

export async function updateLifecycleRecordBackend(recordId, payload, actorEmail) {
  const current = await getLifecycleRecordBackend(recordId);
  if (!current) {
    return null;
  }
  const normalized = normalizeLifecyclePayload(payload, actorEmail, { base: current });
  const effects = [];
  if (shouldApplyOnboardingActivation(normalized)) {
    const activatedAccount = await activateUserAccessByEmail(normalized.employeeEmail);
    const activatedEmployeeRecords = await activateEmployeeRecordByEmail(normalized.employeeEmail, actorEmail);
    effects.push({
      type: "onboarding-activation",
      message: "User account and employee profile activated.",
      accountStatus: activatedAccount?.status || "active",
      employeeRecordsUpdated: activatedEmployeeRecords,
    });
  }
  if (shouldApplyLifecycleRoleSync(normalized)) {
    const employeeRecordsUpdated = await syncEmployeeRecordRoleByLifecycle(normalized, actorEmail);
    const account = await syncUserRoleByLifecycle(normalized);
    effects.push({
      type: "role-sync",
      message: `Role synchronized to ${account?.role || "target role"}.`,
      role: account?.role || null,
      employeeRecordsUpdated,
    });
  }
  if (shouldTriggerAccessRevocation(normalized)) {
    const account = await revokeUserAccessByEmail(normalized.employeeEmail);
    effects.push({
      type: "access-revocation",
      message: "User account access revoked.",
      accountStatus: account?.status || "disabled",
    });
  }
  if (shouldApplyLifecycleArchivePolicy(normalized)) {
    const archiveResult = await archiveEmployeeDataByEmail(normalized, actorEmail);
    effects.push({
      type: "archive-policy",
      message: `Employee data archived until ${archiveResult.retentionDeleteAt}.`,
      retentionDeleteAt: archiveResult.retentionDeleteAt,
      archivedAt: archiveResult.archivedAt,
      counts: archiveResult.counts,
    });
  }

  const updated = await updateCollectionRecord(getCollectionName("lifecycle"), recordId, {
    ...normalized,
    lastAutomationEffects: effects,
    lastAutomationAt: nowIso(),
    lastAutomationBy: actorEmail,
  });
  return {
    record: updated,
    effects,
  };
}

export async function forceOffboardLifecycleRecordBackend(recordId, actorEmail, reason) {
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
  );
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

export async function purgeArchivedEmployeeDataBackend({ now } = {}) {
  const cutoff = asString(now, nowIso());
  const deletedByCollection = {
    employees: await purgeCollectionByRetention(getCollectionName("employees"), cutoff),
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
