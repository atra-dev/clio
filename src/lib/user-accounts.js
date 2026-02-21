import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as queryLimit,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore/lite";
import { ROLES } from "@/features/hris/constants";
import { normalizeRole } from "@/lib/hris";
import { getFirestoreDb, isFirestoreEnabled } from "@/lib/firebase";

const DATA_DIR = path.join(process.cwd(), "data");
const USER_STORE_FILE = path.join(DATA_DIR, "user-accounts.json");
const ALLOWED_STATUSES = new Set(["pending", "active", "disabled"]);
const ALLOWED_INVITE_STATUSES = new Set(["sent", "otp_sent", "verified", "revoked", "expired"]);
const ALLOWED_ROLE_IDS = new Set(ROLES.map((role) => role.id));
const DEFAULT_INVITE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_ARCHIVE_RETENTION_YEARS = 5;
const DEFAULT_OTP_TTL_SECONDS = 300;
const DEFAULT_OTP_MAX_ATTEMPTS = 5;
const DEFAULT_OTP_RESEND_COOLDOWN_SECONDS = 60;
const LEGACY_LOCAL_ACCOUNT_EMAILS = new Set([
  "superadmin@clio.local",
  "temp.admin@clio.local",
  "hr@clio.local",
  "grc@clio.local",
  "ea@clio.local",
]);

let storeInitPromise;

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

function normalizeIsoTimestamp(value) {
  if (typeof value !== "string") {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString();
}

function getArchiveRetentionYears() {
  const raw = Number.parseInt(String(process.env.CLIO_RETENTION_YEARS || "").trim(), 10);
  if (!Number.isFinite(raw) || raw < 1) {
    return DEFAULT_ARCHIVE_RETENTION_YEARS;
  }
  return Math.min(raw, 25);
}

function resolveRetentionDeleteAt({ archivedAt, retentionDeleteAt }) {
  const normalizedRetention = normalizeIsoTimestamp(retentionDeleteAt);
  if (normalizedRetention) {
    return normalizedRetention;
  }
  return addYearsToIso(archivedAt, getArchiveRetentionYears());
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function createInviteToken() {
  return randomBytes(20).toString("hex");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSessionVersion(value, fallback = 1) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function isLegacyLocalAccountEmail(value) {
  return LEGACY_LOCAL_ACCOUNT_EMAILS.has(normalizeEmail(value));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function normalizeNameField(value, { allowEmpty = true } = {}) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized) {
    return allowEmpty ? "" : null;
  }
  if (normalized.length > 80) {
    throw new Error("invalid_name");
  }
  return normalized;
}

function normalizeProfilePhotoDataUrl(value) {
  if (value == null || value === "") {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  const isDataImage = /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(normalized);
  if (isDataImage) {
    if (normalized.length > 1_500_000) {
      throw new Error("invalid_profile_photo");
    }
    return normalized;
  }

  const isWebUrl = /^https?:\/\/[^\s]+$/i.test(normalized);
  if (!isWebUrl || normalized.length > 2_048) {
    throw new Error("invalid_profile_photo");
  }

  return normalized;
}

function normalizeStoragePath(value) {
  if (value == null || value === "") {
    return null;
  }

  const normalized = String(value).trim().replace(/^\/+/, "");
  if (!normalized) {
    return null;
  }
  if (normalized.length > 512 || normalized.includes("..") || normalized.includes("\\")) {
    throw new Error("invalid_storage_path");
  }
  if (!/^clio\/[a-z0-9/_\-.\s]+$/i.test(normalized)) {
    throw new Error("invalid_storage_path");
  }
  return normalized;
}

function envInt(name, fallback, { min, max } = {}) {
  const raw = String(process.env[name] || "").trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (Number.isFinite(min) && parsed < min) {
    return min;
  }

  if (Number.isFinite(max) && parsed > max) {
    return max;
  }

  return parsed;
}

function getOtpSecret() {
  const configuredSecret = String(process.env.CLIO_SMS_OTP_SECRET || "").trim();
  if (configuredSecret) {
    return configuredSecret;
  }

  const sessionSecret = String(process.env.CLIO_SESSION_SECRET || "").trim();
  if (sessionSecret) {
    return sessionSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("sms_otp_secret_required");
  }

  return "clio-dev-sms-otp-secret";
}

function getOtpTtlSeconds() {
  return envInt("CLIO_SMS_OTP_TTL_SECONDS", DEFAULT_OTP_TTL_SECONDS, {
    min: 60,
    max: 900,
  });
}

function getOtpMaxAttempts() {
  return envInt("CLIO_SMS_OTP_MAX_ATTEMPTS", DEFAULT_OTP_MAX_ATTEMPTS, {
    min: 1,
    max: 10,
  });
}

function getOtpResendCooldownSeconds() {
  return envInt("CLIO_SMS_OTP_RESEND_COOLDOWN_SECONDS", DEFAULT_OTP_RESEND_COOLDOWN_SECONDS, {
    min: 15,
    max: 300,
  });
}

function normalizePhoneNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const withoutSpaces = raw.replace(/[()\s-]/g, "");
  let candidate = withoutSpaces;

  if (candidate.startsWith("00")) {
    candidate = `+${candidate.slice(2)}`;
  }

  if (!candidate.startsWith("+")) {
    const defaultCountryCode = String(process.env.CLIO_SMS_DEFAULT_COUNTRY_CODE || "+63")
      .trim()
      .replace(/[^\d+]/g, "");
    const normalizedCountryCode = defaultCountryCode.startsWith("+")
      ? defaultCountryCode
      : `+${defaultCountryCode}`;
    const digitsOnly = candidate.replace(/\D/g, "");
    candidate = `${normalizedCountryCode}${digitsOnly}`;
  } else {
    candidate = `+${candidate.slice(1).replace(/\D/g, "")}`;
  }

  if (!/^\+\d{10,15}$/.test(candidate)) {
    return "";
  }

  return candidate;
}

function maskPhoneNumber(value) {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) {
    return "";
  }

  const last4 = normalized.slice(-4);
  return `***-***-${last4}`;
}

function getPhoneLast4(value) {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) {
    return "";
  }
  return normalized.slice(-4);
}

function hashValue(namespace, value) {
  return createHmac("sha256", getOtpSecret()).update(`${namespace}:${value}`).digest("hex");
}

function hashOtpCode({ token, code }) {
  return hashValue("otp", `${token}:${String(code || "").trim()}`);
}

function hashPhoneNumber(value) {
  return hashValue("phone", normalizePhoneNumber(value));
}

function isValidOtpCode(value) {
  return /^\d{6}$/.test(String(value || "").trim());
}

function generateOtpCode() {
  return String(randomInt(0, 1000000)).padStart(6, "0");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeInviteToken(value) {
  const token = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{24,128}$/.test(token)) {
    return "";
  }
  return token;
}

function maskEmail(value) {
  const normalized = normalizeEmail(value);
  const [username, domain] = normalized.split("@");
  if (!username || !domain) {
    return "";
  }

  if (username.length <= 2) {
    return `**@${domain}`;
  }

  return `${username.slice(0, 2)}***@${domain}`;
}

function parseEmailList(rawValue, fallback = []) {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return fallback.map(normalizeEmail).filter(Boolean);
  }

  return rawValue
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
}

function getBootstrapAccounts() {
  const groups = [
    {
      role: "SUPER_ADMIN",
      emails: parseEmailList(process.env.SUPER_ADMIN_EMAILS, []),
    },
    {
      role: "HR",
      emails: parseEmailList(process.env.HR_EMAILS, []),
    },
    {
      role: "GRC",
      emails: parseEmailList(process.env.GRC_EMAILS, []),
    },
    {
      role: "EA",
      emails: parseEmailList(process.env.EA_EMAILS, []),
    },
    {
      role: "EMPLOYEE_L1",
      emails: parseEmailList(process.env.EMPLOYEE_L1_EMAILS, []),
    },
    {
      role: "EMPLOYEE_L2",
      emails: parseEmailList(process.env.EMPLOYEE_L2_EMAILS, []),
    },
    {
      role: "EMPLOYEE_L3",
      emails: parseEmailList(process.env.EMPLOYEE_L3_EMAILS, []),
    },
  ];

  return groups.flatMap((group) =>
    group.emails.map((email) => ({
      email,
      role: group.role,
    })),
  );
}

function normalizeUserRecord(user) {
  const email = normalizeEmail(user?.email);
  if (!isValidEmail(email)) {
    return null;
  }

  const role = normalizeRole(user?.role);
  const status = ALLOWED_STATUSES.has(user?.status) ? user.status : "pending";
  const invitedAt = typeof user?.invitedAt === "string" ? user.invitedAt : nowIso();
  const updatedAt = typeof user?.updatedAt === "string" ? user.updatedAt : invitedAt;
  const archivedAt = normalizeIsoTimestamp(user?.archivedAt);
  const retentionDeleteAt = resolveRetentionDeleteAt({
    archivedAt: archivedAt || invitedAt,
    retentionDeleteAt: user?.retentionDeleteAt,
  });
  const archivedBy = normalizeEmail(user?.archivedBy) || null;
  const archiveReason = typeof user?.archiveReason === "string" ? user.archiveReason : null;
  let firstName = "";
  let middleName = "";
  let lastName = "";
  let profilePhotoDataUrl = null;
  let profilePhotoStoragePath = null;
  try {
    firstName = normalizeNameField(user?.firstName);
    middleName = normalizeNameField(user?.middleName);
    lastName = normalizeNameField(user?.lastName);
  } catch {
    firstName = "";
    middleName = "";
    lastName = "";
  }
  try {
    profilePhotoDataUrl = normalizeProfilePhotoDataUrl(user?.profilePhotoDataUrl);
  } catch {
    profilePhotoDataUrl = null;
  }
  try {
    profilePhotoStoragePath = normalizeStoragePath(user?.profilePhotoStoragePath);
  } catch {
    profilePhotoStoragePath = null;
  }

  return {
    id: typeof user?.id === "string" && user.id.trim().length > 0 ? user.id : email,
    email,
    role: ALLOWED_ROLE_IDS.has(role) ? role : "HR",
    status,
    sessionVersion: normalizeSessionVersion(user?.sessionVersion, 1),
    invitedBy: normalizeEmail(user?.invitedBy) || "system.clio@gmail.com",
    invitedAt,
    activatedAt: typeof user?.activatedAt === "string" ? user.activatedAt : null,
    emailVerifiedAt: typeof user?.emailVerifiedAt === "string" ? user.emailVerifiedAt : null,
    lastLoginAt: typeof user?.lastLoginAt === "string" ? user.lastLoginAt : null,
    phoneVerifiedAt: typeof user?.phoneVerifiedAt === "string" ? user.phoneVerifiedAt : null,
    phoneLast4: typeof user?.phoneLast4 === "string" ? user.phoneLast4 : null,
    phoneHash: typeof user?.phoneHash === "string" ? user.phoneHash : null,
    verificationMethod: ["sms", "email"].includes(user?.verificationMethod) ? user.verificationMethod : null,
    archivedAt: archivedAt || null,
    archivedBy,
    archiveReason,
    isArchived: Boolean(user?.isArchived || archivedAt),
    retentionDeleteAt: archivedAt ? retentionDeleteAt : normalizeIsoTimestamp(user?.retentionDeleteAt) || null,
    firstName,
    middleName,
    lastName,
    profilePhotoDataUrl,
    profilePhotoStoragePath,
    profileUpdatedAt: typeof user?.profileUpdatedAt === "string" ? user.profileUpdatedAt : null,
    updatedAt,
    source: user?.source === "bootstrap" ? "bootstrap" : "invite",
  };
}

function normalizeInviteRecord(invite) {
  const email = normalizeEmail(invite?.email);
  if (!isValidEmail(email)) {
    return null;
  }

  const role = normalizeRole(invite?.role);
  const invitedAt = typeof invite?.invitedAt === "string" ? invite.invitedAt : nowIso();
  const expiresAt =
    typeof invite?.expiresAt === "string"
      ? invite.expiresAt
      : new Date(Date.now() + DEFAULT_INVITE_EXPIRATION_MS).toISOString();
  const status = ALLOWED_INVITE_STATUSES.has(invite?.status) ? invite.status : "sent";
  const phoneMasked =
    typeof invite?.verification?.phoneMasked === "string" ? invite.verification.phoneMasked : null;
  const phoneLast4 =
    typeof invite?.verification?.phoneLast4 === "string" ? invite.verification.phoneLast4 : null;
  const otpHash = typeof invite?.verification?.otpHash === "string" ? invite.verification.otpHash : null;
  const otpExpiresAt =
    typeof invite?.verification?.otpExpiresAt === "string" ? invite.verification.otpExpiresAt : null;
  const otpRequestedAt =
    typeof invite?.verification?.otpRequestedAt === "string" ? invite.verification.otpRequestedAt : null;
  const otpAttemptCount = Number.isFinite(invite?.verification?.otpAttemptCount)
    ? Math.max(0, invite.verification.otpAttemptCount)
    : 0;
  const otpMaxAttempts = Number.isFinite(invite?.verification?.otpMaxAttempts)
    ? Math.max(1, invite.verification.otpMaxAttempts)
    : getOtpMaxAttempts();
  const resendAvailableAt =
    typeof invite?.verification?.resendAvailableAt === "string" ? invite.verification.resendAvailableAt : null;
  const verifiedAt =
    typeof invite?.verification?.verifiedAt === "string" ? invite.verification.verifiedAt : null;
  const phoneHash = typeof invite?.verification?.phoneHash === "string" ? invite.verification.phoneHash : null;
  const createdAt = typeof invite?.createdAt === "string" ? invite.createdAt : invitedAt;
  const updatedAt = typeof invite?.updatedAt === "string" ? invite.updatedAt : invitedAt;

  return {
    id: typeof invite?.id === "string" && invite.id.trim().length > 0 ? invite.id : createId("INV"),
    email,
    role: ALLOWED_ROLE_IDS.has(role) ? role : "HR",
    invitedBy: normalizeEmail(invite?.invitedBy) || "system.clio@gmail.com",
    invitedAt,
    expiresAt,
    token: typeof invite?.token === "string" && invite.token.trim().length > 0 ? invite.token : createInviteToken(),
    status,
    createdAt,
    updatedAt,
    verification: {
      phoneMasked,
      phoneLast4,
      phoneHash,
      otpHash,
      otpExpiresAt,
      otpRequestedAt,
      otpAttemptCount,
      otpMaxAttempts,
      resendAvailableAt,
      verifiedAt,
    },
  };
}

function normalizeStore(rawStore) {
  const rawUsers = Array.isArray(rawStore?.users) ? rawStore.users : [];
  const rawInvites = Array.isArray(rawStore?.invites) ? rawStore.invites : [];

  const userByEmail = new Map();
  rawUsers
    .map(normalizeUserRecord)
    .filter(Boolean)
    .forEach((record) => {
      if (!userByEmail.has(record.email)) {
        userByEmail.set(record.email, record);
      }
    });

  return {
    users: Array.from(userByEmail.values()),
    invites: rawInvites.map(normalizeInviteRecord).filter(Boolean),
  };
}

function withBootstrapAccounts(store) {
  const nextStore = {
    users: [...store.users],
    invites: [...store.invites],
  };

  const existingEmails = new Set(nextStore.users.map((item) => item.email));
  const timestamp = nowIso();
  let changed = false;

  for (const bootstrap of getBootstrapAccounts()) {
    if (existingEmails.has(bootstrap.email)) {
      continue;
    }

    nextStore.users.push({
      id: bootstrap.email,
      email: bootstrap.email,
      role: bootstrap.role,
      status: "active",
      sessionVersion: 1,
      invitedBy: "system.clio@gmail.com",
      invitedAt: timestamp,
      activatedAt: timestamp,
      emailVerifiedAt: timestamp,
      lastLoginAt: null,
      phoneVerifiedAt: timestamp,
      phoneLast4: null,
      phoneHash: null,
      verificationMethod: "email",
      updatedAt: timestamp,
      source: "bootstrap",
    });
    existingEmails.add(bootstrap.email);
    changed = true;
  }

  return { store: nextStore, changed };
}

function pruneLegacyLocalAccountsFromStore(store) {
  const nextUsers = store.users.filter((user) => !isLegacyLocalAccountEmail(user?.email));
  const nextInvites = store.invites.filter((invite) => !isLegacyLocalAccountEmail(invite?.email));
  const changed = nextUsers.length !== store.users.length || nextInvites.length !== store.invites.length;

  return {
    store: {
      users: nextUsers,
      invites: nextInvites,
    },
    changed,
  };
}

function sortUsersByDate(users) {
  return [...users].sort((a, b) => {
    const left = new Date(a.updatedAt || a.invitedAt).getTime();
    const right = new Date(b.updatedAt || b.invitedAt).getTime();
    return right - left;
  });
}

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    sessionVersion: normalizeSessionVersion(user?.sessionVersion, 1),
    invitedBy: user.invitedBy,
    invitedAt: user.invitedAt,
    activatedAt: user.activatedAt,
    emailVerifiedAt: user.emailVerifiedAt,
    lastLoginAt: user.lastLoginAt,
    phoneVerifiedAt: user.phoneVerifiedAt,
    phoneLast4: user.phoneLast4,
    verificationMethod: user.verificationMethod,
    archivedAt: user.archivedAt || null,
    archivedBy: user.archivedBy || null,
    archiveReason: user.archiveReason || null,
    isArchived: Boolean(user.isArchived || user.archivedAt),
    retentionDeleteAt: user.retentionDeleteAt || null,
    firstName: user.firstName || "",
    middleName: user.middleName || "",
    lastName: user.lastName || "",
    profilePhotoDataUrl: user.profilePhotoDataUrl || null,
    profilePhotoStoragePath: user.profilePhotoStoragePath || null,
    profileUpdatedAt: user.profileUpdatedAt || null,
    updatedAt: user.updatedAt,
    source: user.source,
  };
}

function getUsersCollectionName() {
  return String(process.env.CLIO_FIRESTORE_USERS_COLLECTION || "clio_users").trim() || "clio_users";
}

function getInvitesCollectionName() {
  return String(process.env.CLIO_FIRESTORE_INVITES_COLLECTION || "clio_user_invites").trim() || "clio_user_invites";
}

async function getFirestoreStore() {
  if (!isFirestoreEnabled()) {
    return null;
  }

  return getFirestoreDb();
}

function normalizeFirestoreUser(docId, payload) {
  return normalizeUserRecord({
    id: docId,
    ...payload,
  });
}

async function ensureFirestoreBootstrapAccounts(db) {
  const collectionName = getUsersCollectionName();
  const timestamp = nowIso();

  for (const bootstrap of getBootstrapAccounts()) {
    const normalizedEmail = normalizeEmail(bootstrap.email);
    if (!normalizedEmail) {
      continue;
    }

    const userRef = doc(db, collectionName, normalizedEmail);
    const existing = await getDoc(userRef);
    if (existing.exists()) {
      continue;
    }

    await setDoc(userRef, {
      id: normalizedEmail,
      email: normalizedEmail,
      role: bootstrap.role,
      status: "active",
      sessionVersion: 1,
      invitedBy: "system.clio@gmail.com",
      invitedAt: timestamp,
      activatedAt: timestamp,
      emailVerifiedAt: timestamp,
      lastLoginAt: null,
      phoneVerifiedAt: timestamp,
      phoneLast4: null,
      phoneHash: null,
      verificationMethod: "email",
      updatedAt: timestamp,
      source: "bootstrap",
    });
  }
}

async function pruneLegacyLocalAccountsFromFirestore(db) {
  const usersCollection = getUsersCollectionName();
  const invitesCollection = getInvitesCollectionName();
  const legacyEmails = Array.from(LEGACY_LOCAL_ACCOUNT_EMAILS);

  for (const email of legacyEmails) {
    try {
      const userRef = doc(db, usersCollection, email);
      const userSnapshot = await getDoc(userRef);
      if (userSnapshot.exists()) {
        await deleteDoc(userRef);
      }
    } catch {
      // Ignore cleanup failures so user listing/login flow is never blocked.
    }
  }

  try {
    const inviteQuery = query(
      collection(db, invitesCollection),
      where("email", "in", legacyEmails),
      queryLimit(20),
    );
    const inviteSnapshot = await getDocs(inviteQuery);
    for (const inviteDoc of inviteSnapshot.docs) {
      const payload = inviteDoc.data() || {};
      const email = normalizeEmail(payload.email);
      if (!LEGACY_LOCAL_ACCOUNT_EMAILS.has(email)) {
        continue;
      }
      await deleteDoc(doc(db, invitesCollection, inviteDoc.id));
    }
  } catch {
    // Ignore cleanup failures so user listing/login flow is never blocked.
  }
}

async function ensureUserDirectoryPreparedInFirestore(db) {
  await pruneLegacyLocalAccountsFromFirestore(db);
  await ensureFirestoreBootstrapAccounts(db);
}

async function listUserAccountsFromFirestore(db) {
  await ensureUserDirectoryPreparedInFirestore(db);

  const snapshot = await getDocs(collection(db, getUsersCollectionName()));
  const users = snapshot.docs
    .map((item) => normalizeFirestoreUser(item.id, item.data()))
    .filter(Boolean)
    .filter((user) => !isLegacyLocalAccountEmail(user.email))
    .map(toPublicUser);

  return sortUsersByDate(users);
}

async function getLoginAccountFromFirestore(db, email) {
  if (isLegacyLocalAccountEmail(email)) {
    return null;
  }

  await ensureUserDirectoryPreparedInFirestore(db);

  const userRef = doc(db, getUsersCollectionName(), email);
  const snapshot = await getDoc(userRef);
  if (!snapshot.exists()) {
    return null;
  }

  const normalized = normalizeFirestoreUser(snapshot.id, snapshot.data());
  return normalized ? toPublicUser(normalized) : null;
}

async function markUserLoginInFirestore(db, email) {
  const userRef = doc(db, getUsersCollectionName(), email);
  const snapshot = await getDoc(userRef);
  if (!snapshot.exists()) {
    return null;
  }

  const timestamp = nowIso();
  await updateDoc(userRef, {
    lastLoginAt: timestamp,
    updatedAt: timestamp,
  });

  const updated = normalizeFirestoreUser(snapshot.id, {
    ...snapshot.data(),
    lastLoginAt: timestamp,
    updatedAt: timestamp,
  });

  return updated ? toPublicUser(updated) : null;
}

async function inviteUserAccountInFirestore(db, { email, role, invitedBy }) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw new Error("invalid_email");
  }

  const requestedRole = String(role || "")
    .trim()
    .toUpperCase();
  if (!ALLOWED_ROLE_IDS.has(requestedRole)) {
    throw new Error("invalid_role");
  }

  const sender = normalizeEmail(invitedBy) || "superadmin.clio@gmail.com";
  const timestamp = nowIso();
  const userRef = doc(db, getUsersCollectionName(), normalizedEmail);
  const existing = await getDoc(userRef);

  const basePayload = existing.exists() ? existing.data() : {};
  const nextSessionVersion = existing.exists()
    ? normalizeSessionVersion(basePayload?.sessionVersion, 1) + 1
    : 1;
  const nextUser = normalizeUserRecord({
    ...basePayload,
    id: normalizedEmail,
    email: normalizedEmail,
    role: requestedRole,
    status: "pending",
    sessionVersion: nextSessionVersion,
    invitedBy: sender,
    invitedAt: timestamp,
    emailVerifiedAt: null,
    phoneVerifiedAt: null,
    phoneLast4: null,
    phoneHash: null,
    verificationMethod: null,
    updatedAt: timestamp,
    source: basePayload?.source === "bootstrap" ? "bootstrap" : "invite",
  });

  await setDoc(userRef, nextUser);

  const priorInvites = await getDocs(
    query(collection(db, getInvitesCollectionName()), where("email", "==", normalizedEmail)),
  );
  for (const inviteSnapshot of priorInvites.docs) {
    const payload = inviteSnapshot.data() || {};
    if (!["sent", "otp_sent", "expired"].includes(payload?.status)) {
      continue;
    }

    await updateDoc(doc(db, getInvitesCollectionName(), inviteSnapshot.id), {
      status: "revoked",
      updatedAt: timestamp,
    });
  }

  const expiresAt = new Date(Date.now() + DEFAULT_INVITE_EXPIRATION_MS).toISOString();
  const invite = {
    email: normalizedEmail,
    role: requestedRole,
    invitedBy: sender,
    invitedAt: timestamp,
    expiresAt,
    token: createInviteToken(),
    status: "sent",
    createdAt: timestamp,
    updatedAt: timestamp,
    verification: {
      phoneMasked: null,
      phoneLast4: null,
      phoneHash: null,
      otpHash: null,
      otpExpiresAt: null,
      otpRequestedAt: null,
      otpAttemptCount: 0,
      otpMaxAttempts: getOtpMaxAttempts(),
      resendAvailableAt: null,
      verifiedAt: null,
    },
  };

  const inviteRef = await addDoc(collection(db, getInvitesCollectionName()), invite);

  return {
    user: toPublicUser(nextUser),
    invite: {
      id: inviteRef.id,
      email: invite.email,
      role: invite.role,
      invitedBy: invite.invitedBy,
      invitedAt: invite.invitedAt,
      expiresAt: invite.expiresAt,
      status: invite.status,
      token: invite.token,
    },
  };
}

async function updateUserAccountStatusInFirestore(db, { userId, status }) {
  const normalizedStatus = String(status || "")
    .trim()
    .toLowerCase();
  if (!ALLOWED_STATUSES.has(normalizedStatus)) {
    throw new Error("invalid_status");
  }

  const normalizedUserId = String(userId || "").trim().toLowerCase();
  if (!normalizedUserId) {
    throw new Error("invalid_user");
  }

  const userRef = doc(db, getUsersCollectionName(), normalizedUserId);
  const snapshot = await getDoc(userRef);
  if (!snapshot.exists()) {
    return null;
  }

  const currentData = snapshot.data() || {};
  const currentStatus = String(currentData?.status || "").trim().toLowerCase();
  const currentSessionVersion = normalizeSessionVersion(currentData?.sessionVersion, 1);

  const timestamp = nowIso();
  const nextPayload = {
    status: normalizedStatus,
    sessionVersion: normalizedStatus !== currentStatus ? currentSessionVersion + 1 : currentSessionVersion,
    updatedAt: timestamp,
  };

  if (normalizedStatus === "active" && !currentData?.activatedAt) {
    nextPayload.activatedAt = timestamp;
  }

  await updateDoc(userRef, nextPayload);

  const updated = normalizeFirestoreUser(snapshot.id, {
    ...currentData,
    ...nextPayload,
  });

  return updated ? toPublicUser(updated) : null;
}

async function updateUserAccountRoleInFirestore(db, { userId, role }) {
  const normalizedRole = String(role || "")
    .trim()
    .toUpperCase();
  if (!ALLOWED_ROLE_IDS.has(normalizedRole)) {
    throw new Error("invalid_role");
  }

  const normalizedUserId = String(userId || "").trim().toLowerCase();
  if (!normalizedUserId) {
    throw new Error("invalid_user");
  }

  const userRef = doc(db, getUsersCollectionName(), normalizedUserId);
  const snapshot = await getDoc(userRef);
  if (!snapshot.exists()) {
    return null;
  }

  const currentData = snapshot.data() || {};
  const currentRole = String(currentData?.role || "").trim().toUpperCase();
  const currentSessionVersion = normalizeSessionVersion(currentData?.sessionVersion, 1);
  const timestamp = nowIso();
  const nextPayload = {
    role: normalizedRole,
    sessionVersion: normalizedRole !== currentRole ? currentSessionVersion + 1 : currentSessionVersion,
    updatedAt: timestamp,
  };

  await updateDoc(userRef, nextPayload);

  const updated = normalizeFirestoreUser(snapshot.id, {
    ...currentData,
    ...nextPayload,
  });

  return updated ? toPublicUser(updated) : null;
}

async function archiveUserAccountInFirestore(
  db,
  {
    userId,
    archivedBy,
    reason,
    retentionDeleteAt,
  },
) {
  const normalizedUserId = String(userId || "").trim().toLowerCase();
  if (!normalizedUserId) {
    throw new Error("invalid_user");
  }

  const userRef = doc(db, getUsersCollectionName(), normalizedUserId);
  const snapshot = await getDoc(userRef);
  if (!snapshot.exists()) {
    return null;
  }

  const currentData = snapshot.data() || {};
  const currentStatus = String(currentData?.status || "").trim().toLowerCase();
  const currentSessionVersion = normalizeSessionVersion(currentData?.sessionVersion, 1);
  const timestamp = nowIso();
  const nextPayload = {
    status: "disabled",
    archivedAt: timestamp,
    archivedBy: normalizeEmail(archivedBy) || "system.clio@gmail.com",
    archiveReason: String(reason || "").trim() || "Resigned",
    isArchived: true,
    retentionDeleteAt: resolveRetentionDeleteAt({
      archivedAt: timestamp,
      retentionDeleteAt,
    }),
    sessionVersion: currentStatus !== "disabled" ? currentSessionVersion + 1 : currentSessionVersion,
    updatedAt: timestamp,
  };

  await updateDoc(userRef, nextPayload);

  const updated = normalizeFirestoreUser(snapshot.id, {
    ...currentData,
    ...nextPayload,
  });

  return updated ? toPublicUser(updated) : null;
}

async function updateUserAccountProfileInFirestore(
  db,
  { userId, firstName, middleName, lastName, profilePhotoDataUrl, profilePhotoStoragePath },
) {
  const normalizedUserId = String(userId || "").trim().toLowerCase();
  if (!normalizedUserId) {
    throw new Error("invalid_user");
  }

  const userRef = doc(db, getUsersCollectionName(), normalizedUserId);
  const snapshot = await getDoc(userRef);
  if (!snapshot.exists()) {
    return null;
  }

  const timestamp = nowIso();
  const nextPayload = {
    firstName: normalizeNameField(firstName),
    middleName: normalizeNameField(middleName),
    lastName: normalizeNameField(lastName),
    profilePhotoDataUrl: normalizeProfilePhotoDataUrl(profilePhotoDataUrl),
    profilePhotoStoragePath: normalizeStoragePath(profilePhotoStoragePath),
    profileUpdatedAt: timestamp,
    updatedAt: timestamp,
  };

  await updateDoc(userRef, nextPayload);

  const updated = normalizeFirestoreUser(snapshot.id, {
    ...snapshot.data(),
    ...nextPayload,
  });

  return updated ? toPublicUser(updated) : null;
}

async function writeStore(store) {
  await fs.writeFile(USER_STORE_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function readStoreFile() {
  const rawContent = await fs.readFile(USER_STORE_FILE, "utf8").catch(() => "");
  if (!rawContent.trim()) {
    return { users: [], invites: [] };
  }

  try {
    return JSON.parse(rawContent);
  } catch {
    return { users: [], invites: [] };
  }
}

async function ensureStore() {
  if (!storeInitPromise) {
    storeInitPromise = (async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const raw = await readStoreFile();
      const normalized = normalizeStore(raw);
      const { store: prunedStore } = pruneLegacyLocalAccountsFromStore(normalized);
      const { store } = withBootstrapAccounts(prunedStore);
      await writeStore(store);
    })();
  }

  return storeInitPromise;
}

async function loadStore() {
  await ensureStore();
  const raw = await readStoreFile();
  const normalized = normalizeStore(raw);
  const { store: prunedStore, changed: pruneChanged } = pruneLegacyLocalAccountsFromStore(normalized);
  const { store, changed: bootstrapChanged } = withBootstrapAccounts(prunedStore);
  const changed = pruneChanged || bootstrapChanged;

  if (changed) {
    await writeStore(store);
  }

  return store;
}

async function listUserAccountsFromFile() {
  const store = await loadStore();
  return sortUsersByDate(store.users)
    .filter((user) => !isLegacyLocalAccountEmail(user.email))
    .map(toPublicUser);
}

async function getLoginAccountFromFile(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }
  if (isLegacyLocalAccountEmail(normalizedEmail)) {
    return null;
  }

  const store = await loadStore();
  const user = store.users.find((item) => item.email === normalizedEmail);
  return user ? toPublicUser(user) : null;
}

async function markUserLoginInFile(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  const store = await loadStore();
  const target = store.users.find((item) => item.email === normalizedEmail);
  if (!target) {
    return null;
  }

  const timestamp = nowIso();
  target.lastLoginAt = timestamp;
  target.updatedAt = timestamp;
  await writeStore(store);
  return toPublicUser(target);
}

async function inviteUserAccountInFile({ email, role, invitedBy }) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw new Error("invalid_email");
  }

  const requestedRole = String(role || "")
    .trim()
    .toUpperCase();
  if (!ALLOWED_ROLE_IDS.has(requestedRole)) {
    throw new Error("invalid_role");
  }

  const store = await loadStore();
  const timestamp = nowIso();
  const sender = normalizeEmail(invitedBy) || "superadmin.clio@gmail.com";

  for (const existingInvite of store.invites) {
    if (existingInvite.email !== normalizedEmail) {
      continue;
    }
    if (!["sent", "otp_sent", "expired"].includes(existingInvite.status)) {
      continue;
    }

    existingInvite.status = "revoked";
    existingInvite.updatedAt = timestamp;
  }

  let user = store.users.find((item) => item.email === normalizedEmail);
  if (!user) {
    user = {
      id: normalizedEmail,
      email: normalizedEmail,
      role: requestedRole,
      status: "pending",
      sessionVersion: 1,
      invitedBy: sender,
      invitedAt: timestamp,
      activatedAt: null,
      emailVerifiedAt: null,
      lastLoginAt: null,
      phoneVerifiedAt: null,
      phoneLast4: null,
      phoneHash: null,
      verificationMethod: null,
      updatedAt: timestamp,
      source: "invite",
    };
    store.users.push(user);
  } else {
    const currentSessionVersion = normalizeSessionVersion(user.sessionVersion, 1);
    user.role = requestedRole;
    user.status = "pending";
    user.sessionVersion = currentSessionVersion + 1;
    user.invitedBy = sender;
    user.invitedAt = timestamp;
    user.emailVerifiedAt = null;
    user.phoneVerifiedAt = null;
    user.phoneLast4 = null;
    user.phoneHash = null;
    user.verificationMethod = null;
    user.updatedAt = timestamp;
    if (user.source !== "bootstrap") {
      user.source = "invite";
    }
  }

  const expiresAt = new Date(Date.now() + DEFAULT_INVITE_EXPIRATION_MS).toISOString();
  const invite = {
    id: createId("INV"),
    email: normalizedEmail,
    role: requestedRole,
    invitedBy: sender,
    invitedAt: timestamp,
    expiresAt,
    token: createInviteToken(),
    status: "sent",
    createdAt: timestamp,
    updatedAt: timestamp,
    verification: {
      phoneMasked: null,
      phoneLast4: null,
      phoneHash: null,
      otpHash: null,
      otpExpiresAt: null,
      otpRequestedAt: null,
      otpAttemptCount: 0,
      otpMaxAttempts: getOtpMaxAttempts(),
      resendAvailableAt: null,
      verifiedAt: null,
    },
  };

  store.invites.unshift(invite);
  if (store.invites.length > 500) {
    store.invites.length = 500;
  }

  await writeStore(store);

  return {
    user: toPublicUser(user),
    invite: {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      invitedBy: invite.invitedBy,
      invitedAt: invite.invitedAt,
      expiresAt: invite.expiresAt,
      status: invite.status,
      token: invite.token,
    },
  };
}

async function updateUserAccountStatusInFile({ userId, status }) {
  const normalizedStatus = String(status || "")
    .trim()
    .toLowerCase();
  if (!ALLOWED_STATUSES.has(normalizedStatus)) {
    throw new Error("invalid_status");
  }

  const normalizedUserId = String(userId || "").trim().toLowerCase();
  if (!normalizedUserId) {
    throw new Error("invalid_user");
  }

  const store = await loadStore();
  const user = store.users.find((item) => item.id === normalizedUserId || item.email === normalizedUserId);
  if (!user) {
    return null;
  }

  const timestamp = nowIso();
  const currentStatus = String(user.status || "").trim().toLowerCase();
  const currentSessionVersion = normalizeSessionVersion(user.sessionVersion, 1);
  user.status = normalizedStatus;
  user.sessionVersion = normalizedStatus !== currentStatus ? currentSessionVersion + 1 : currentSessionVersion;
  user.updatedAt = timestamp;
  if (normalizedStatus === "active" && !user.activatedAt) {
    user.activatedAt = timestamp;
  }

  await writeStore(store);
  return toPublicUser(user);
}

async function updateUserAccountRoleInFile({ userId, role }) {
  const normalizedRole = String(role || "")
    .trim()
    .toUpperCase();
  if (!ALLOWED_ROLE_IDS.has(normalizedRole)) {
    throw new Error("invalid_role");
  }

  const normalizedUserId = String(userId || "").trim().toLowerCase();
  if (!normalizedUserId) {
    throw new Error("invalid_user");
  }

  const store = await loadStore();
  const user = store.users.find((item) => item.id === normalizedUserId || item.email === normalizedUserId);
  if (!user) {
    return null;
  }

  const currentRole = String(user.role || "").trim().toUpperCase();
  const currentSessionVersion = normalizeSessionVersion(user.sessionVersion, 1);
  user.role = normalizedRole;
  user.sessionVersion = normalizedRole !== currentRole ? currentSessionVersion + 1 : currentSessionVersion;
  user.updatedAt = nowIso();

  await writeStore(store);
  return toPublicUser(user);
}

async function archiveUserAccountInFile({
  userId,
  archivedBy,
  reason,
  retentionDeleteAt,
}) {
  const normalizedUserId = String(userId || "").trim().toLowerCase();
  if (!normalizedUserId) {
    throw new Error("invalid_user");
  }

  const store = await loadStore();
  const user = store.users.find((item) => item.id === normalizedUserId || item.email === normalizedUserId);
  if (!user) {
    return null;
  }

  const timestamp = nowIso();
  const currentStatus = String(user.status || "").trim().toLowerCase();
  const currentSessionVersion = normalizeSessionVersion(user.sessionVersion, 1);
  user.status = "disabled";
  user.archivedAt = timestamp;
  user.archivedBy = normalizeEmail(archivedBy) || "system.clio@gmail.com";
  user.archiveReason = String(reason || "").trim() || "Resigned";
  user.isArchived = true;
  user.retentionDeleteAt = resolveRetentionDeleteAt({
    archivedAt: timestamp,
    retentionDeleteAt,
  });
  user.sessionVersion = currentStatus !== "disabled" ? currentSessionVersion + 1 : currentSessionVersion;
  user.updatedAt = timestamp;

  await writeStore(store);
  return toPublicUser(user);
}

async function updateUserAccountProfileInFile({
  userId,
  firstName,
  middleName,
  lastName,
  profilePhotoDataUrl,
  profilePhotoStoragePath,
}) {
  const normalizedUserId = String(userId || "").trim().toLowerCase();
  if (!normalizedUserId) {
    throw new Error("invalid_user");
  }

  const store = await loadStore();
  const user = store.users.find((item) => item.id === normalizedUserId || item.email === normalizedUserId);
  if (!user) {
    return null;
  }

  user.firstName = normalizeNameField(firstName);
  user.middleName = normalizeNameField(middleName);
  user.lastName = normalizeNameField(lastName);
  user.profilePhotoDataUrl = normalizeProfilePhotoDataUrl(profilePhotoDataUrl);
  user.profilePhotoStoragePath = normalizeStoragePath(profilePhotoStoragePath);
  user.profileUpdatedAt = nowIso();
  user.updatedAt = user.profileUpdatedAt;

  await writeStore(store);
  return toPublicUser(user);
}

async function purgeDueArchivedUserAccountsInFirestore(db, { now }) {
  const cutoff = normalizeIsoTimestamp(now) || nowIso();
  const usersRef = collection(db, getUsersCollectionName());
  const usersSnapshot = await getDocs(query(usersRef, where("retentionDeleteAt", "<=", cutoff)));
  let deletedUsers = 0;
  let deletedInvites = 0;
  const deletedEmails = [];

  for (const userSnapshot of usersSnapshot.docs) {
    const payload = userSnapshot.data() || {};
    const archivedAt = normalizeIsoTimestamp(payload.archivedAt);
    if (!archivedAt) {
      continue;
    }

    const email = normalizeEmail(payload.email || userSnapshot.id);
    await deleteDoc(doc(db, getUsersCollectionName(), userSnapshot.id));
    deletedUsers += 1;
    if (email) {
      deletedEmails.push(email);
      const inviteRef = collection(db, getInvitesCollectionName());
      const inviteSnapshot = await getDocs(query(inviteRef, where("email", "==", email)));
      for (const inviteDoc of inviteSnapshot.docs) {
        await deleteDoc(doc(db, getInvitesCollectionName(), inviteDoc.id));
        deletedInvites += 1;
      }
    }
  }

  return {
    cutoff,
    deletedUsers,
    deletedInvites,
    deletedEmails,
  };
}

async function purgeDueArchivedUserAccountsInFile({ now }) {
  const cutoff = normalizeIsoTimestamp(now) || nowIso();
  const store = await loadStore();
  const dueEmails = new Set();

  store.users.forEach((user) => {
    const archivedAt = normalizeIsoTimestamp(user.archivedAt);
    if (!archivedAt) {
      return;
    }
    const retentionDeleteAt = resolveRetentionDeleteAt({
      archivedAt,
      retentionDeleteAt: user.retentionDeleteAt,
    });
    if (retentionDeleteAt <= cutoff) {
      dueEmails.add(user.email);
    }
  });

  if (dueEmails.size === 0) {
    return {
      cutoff,
      deletedUsers: 0,
      deletedInvites: 0,
      deletedEmails: [],
    };
  }

  const initialUserCount = store.users.length;
  const initialInviteCount = store.invites.length;
  store.users = store.users.filter((user) => !dueEmails.has(user.email));
  store.invites = store.invites.filter((invite) => !dueEmails.has(invite.email));
  await writeStore(store);

  return {
    cutoff,
    deletedUsers: initialUserCount - store.users.length,
    deletedInvites: initialInviteCount - store.invites.length,
    deletedEmails: Array.from(dueEmails.values()),
  };
}

async function revokeInviteByIdInFirestore(db, inviteId) {
  const normalizedInviteId = String(inviteId || "").trim();
  if (!normalizedInviteId) {
    throw new Error("invalid_invite");
  }

  const inviteRef = doc(db, getInvitesCollectionName(), normalizedInviteId);
  const snapshot = await getDoc(inviteRef);
  if (!snapshot.exists()) {
    return null;
  }

  const timestamp = nowIso();
  await updateDoc(inviteRef, {
    status: "revoked",
    updatedAt: timestamp,
  });

  const normalized = normalizeInviteRecord({
    id: snapshot.id,
    ...snapshot.data(),
    status: "revoked",
    updatedAt: timestamp,
  });
  return normalized ? toPublicInvite(normalized) : null;
}

async function revokeInviteByIdInFile(inviteId) {
  const normalizedInviteId = String(inviteId || "").trim();
  if (!normalizedInviteId) {
    throw new Error("invalid_invite");
  }

  const store = await loadStore();
  const invite = store.invites.find((item) => item.id === normalizedInviteId);
  if (!invite) {
    return null;
  }

  invite.status = "revoked";
  invite.updatedAt = nowIso();
  await writeStore(store);
  return toPublicInvite(invite);
}

function isInviteExpired(invite) {
  const expiresMs = new Date(invite?.expiresAt).getTime();
  if (!Number.isFinite(expiresMs)) {
    return false;
  }
  return expiresMs <= Date.now();
}

function resolveInviteStatus(invite) {
  if (!invite) {
    return "revoked";
  }

  if (invite.status === "verified" || invite.status === "revoked" || invite.status === "expired") {
    return invite.status;
  }

  return isInviteExpired(invite) ? "expired" : invite.status;
}

function toPublicInvite(invite) {
  const status = resolveInviteStatus(invite);
  return {
    id: invite.id,
    role: invite.role,
    status,
    invitedAt: invite.invitedAt,
    expiresAt: invite.expiresAt,
    emailMasked: maskEmail(invite.email),
    phoneMasked: invite.verification?.phoneMasked || null,
    verifiedAt: invite.verification?.verifiedAt || null,
    otpRequestedAt: invite.verification?.otpRequestedAt || null,
    otpExpiresAt: invite.verification?.otpExpiresAt || null,
    resendAvailableAt: invite.verification?.resendAvailableAt || null,
  };
}

async function findInviteDocumentByTokenInFirestore(db, token) {
  const normalizedToken = normalizeInviteToken(token);
  if (!normalizedToken) {
    return null;
  }

  const snapshot = await getDocs(
    query(collection(db, getInvitesCollectionName()), where("token", "==", normalizedToken), queryLimit(1)),
  );
  if (snapshot.empty) {
    return null;
  }

  const inviteDoc = snapshot.docs[0];
  const normalizedInvite = normalizeInviteRecord({
    id: inviteDoc.id,
    ...inviteDoc.data(),
  });

  if (!normalizedInvite) {
    return null;
  }

  return {
    ref: doc(db, getInvitesCollectionName(), inviteDoc.id),
    invite: normalizedInvite,
  };
}

async function findInviteByTokenInFile(token) {
  const normalizedToken = normalizeInviteToken(token);
  if (!normalizedToken) {
    return null;
  }

  const store = await loadStore();
  const inviteIndex = store.invites.findIndex((item) => item.token === normalizedToken);
  if (inviteIndex === -1) {
    return null;
  }

  return {
    store,
    inviteIndex,
    invite: store.invites[inviteIndex],
  };
}

async function getInviteForAccountOpeningFromFirestore(db, token) {
  const found = await findInviteDocumentByTokenInFirestore(db, token);
  if (!found) {
    return null;
  }

  const currentStatus = resolveInviteStatus(found.invite);
  if (currentStatus === "expired" && found.invite.status !== "expired") {
    const timestamp = nowIso();
    await updateDoc(found.ref, {
      status: "expired",
      updatedAt: timestamp,
    });
    found.invite.status = "expired";
    found.invite.updatedAt = timestamp;
  }

  return toPublicInvite(found.invite);
}

async function getInviteForAccountOpeningFromFile(token) {
  const found = await findInviteByTokenInFile(token);
  if (!found) {
    return null;
  }

  const currentStatus = resolveInviteStatus(found.invite);
  if (currentStatus === "expired" && found.invite.status !== "expired") {
    found.invite.status = "expired";
    found.invite.updatedAt = nowIso();
    await writeStore(found.store);
  }

  return toPublicInvite(found.invite);
}

async function startInviteSmsVerificationInFirestore(db, { token, phoneNumber }) {
  const normalizedToken = normalizeInviteToken(token);
  if (!normalizedToken) {
    throw new Error("invalid_invite_token");
  }

  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  if (!normalizedPhone) {
    throw new Error("invalid_phone_number");
  }

  const found = await findInviteDocumentByTokenInFirestore(db, normalizedToken);
  if (!found) {
    throw new Error("invite_not_found");
  }

  const currentStatus = resolveInviteStatus(found.invite);
  if (currentStatus === "expired") {
    const timestamp = nowIso();
    await updateDoc(found.ref, {
      status: "expired",
      updatedAt: timestamp,
    });
    throw new Error("invite_expired");
  }

  if (currentStatus === "revoked") {
    throw new Error("invite_revoked");
  }

  if (currentStatus === "verified") {
    throw new Error("invite_already_verified");
  }

  const resendAvailableAt = found.invite.verification?.resendAvailableAt;
  if (resendAvailableAt && new Date(resendAvailableAt).getTime() > Date.now()) {
    throw new Error("otp_cooldown");
  }

  const timestamp = nowIso();
  const otpCode = generateOtpCode();
  const otpExpiresAt = new Date(Date.now() + getOtpTtlSeconds() * 1000).toISOString();
  const nextVerification = {
    phoneMasked: maskPhoneNumber(normalizedPhone),
    phoneLast4: getPhoneLast4(normalizedPhone),
    phoneHash: hashPhoneNumber(normalizedPhone),
    otpHash: hashOtpCode({ token: normalizedToken, code: otpCode }),
    otpExpiresAt,
    otpRequestedAt: timestamp,
    otpAttemptCount: 0,
    otpMaxAttempts: getOtpMaxAttempts(),
    resendAvailableAt: new Date(Date.now() + getOtpResendCooldownSeconds() * 1000).toISOString(),
    verifiedAt: null,
  };

  await updateDoc(found.ref, {
    status: "otp_sent",
    updatedAt: timestamp,
    verification: nextVerification,
  });

  return {
    invite: toPublicInvite({
      ...found.invite,
      status: "otp_sent",
      updatedAt: timestamp,
      verification: nextVerification,
    }),
    otpCode,
    phoneNumber: normalizedPhone,
    otpExpiresAt,
    phoneMasked: nextVerification.phoneMasked,
    resendAvailableAt: nextVerification.resendAvailableAt,
  };
}

async function startInviteSmsVerificationInFile({ token, phoneNumber }) {
  const normalizedToken = normalizeInviteToken(token);
  if (!normalizedToken) {
    throw new Error("invalid_invite_token");
  }

  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  if (!normalizedPhone) {
    throw new Error("invalid_phone_number");
  }

  const found = await findInviteByTokenInFile(normalizedToken);
  if (!found) {
    throw new Error("invite_not_found");
  }

  const currentStatus = resolveInviteStatus(found.invite);
  if (currentStatus === "expired") {
    found.invite.status = "expired";
    found.invite.updatedAt = nowIso();
    await writeStore(found.store);
    throw new Error("invite_expired");
  }

  if (currentStatus === "revoked") {
    throw new Error("invite_revoked");
  }

  if (currentStatus === "verified") {
    throw new Error("invite_already_verified");
  }

  const resendAvailableAt = found.invite.verification?.resendAvailableAt;
  if (resendAvailableAt && new Date(resendAvailableAt).getTime() > Date.now()) {
    throw new Error("otp_cooldown");
  }

  const timestamp = nowIso();
  const otpCode = generateOtpCode();
  const otpExpiresAt = new Date(Date.now() + getOtpTtlSeconds() * 1000).toISOString();
  const nextVerification = {
    phoneMasked: maskPhoneNumber(normalizedPhone),
    phoneLast4: getPhoneLast4(normalizedPhone),
    phoneHash: hashPhoneNumber(normalizedPhone),
    otpHash: hashOtpCode({ token: normalizedToken, code: otpCode }),
    otpExpiresAt,
    otpRequestedAt: timestamp,
    otpAttemptCount: 0,
    otpMaxAttempts: getOtpMaxAttempts(),
    resendAvailableAt: new Date(Date.now() + getOtpResendCooldownSeconds() * 1000).toISOString(),
    verifiedAt: null,
  };

  found.invite.status = "otp_sent";
  found.invite.updatedAt = timestamp;
  found.invite.verification = nextVerification;
  await writeStore(found.store);

  return {
    invite: toPublicInvite(found.invite),
    otpCode,
    phoneNumber: normalizedPhone,
    otpExpiresAt,
    phoneMasked: nextVerification.phoneMasked,
    resendAvailableAt: nextVerification.resendAvailableAt,
  };
}

async function completeInviteSmsVerificationInFirestore(db, { token, otpCode }) {
  const normalizedToken = normalizeInviteToken(token);
  if (!normalizedToken) {
    throw new Error("invalid_invite_token");
  }

  if (!isValidOtpCode(otpCode)) {
    throw new Error("invalid_otp");
  }

  const found = await findInviteDocumentByTokenInFirestore(db, normalizedToken);
  if (!found) {
    throw new Error("invite_not_found");
  }

  const currentStatus = resolveInviteStatus(found.invite);
  if (currentStatus === "expired") {
    await updateDoc(found.ref, {
      status: "expired",
      updatedAt: nowIso(),
    });
    throw new Error("invite_expired");
  }

  if (currentStatus === "revoked") {
    throw new Error("invite_revoked");
  }

  if (currentStatus === "verified") {
    throw new Error("invite_already_verified");
  }

  const verification = found.invite.verification || {};
  if (!verification.otpHash || !verification.otpExpiresAt) {
    throw new Error("otp_not_requested");
  }

  if (new Date(verification.otpExpiresAt).getTime() <= Date.now()) {
    await updateDoc(found.ref, {
      updatedAt: nowIso(),
      verification: {
        ...verification,
        otpHash: null,
        otpExpiresAt: null,
      },
    });
    throw new Error("otp_expired");
  }

  const maxAttempts = Number.isFinite(verification.otpMaxAttempts)
    ? Math.max(1, verification.otpMaxAttempts)
    : getOtpMaxAttempts();
  const currentAttempts = Number.isFinite(verification.otpAttemptCount)
    ? Math.max(0, verification.otpAttemptCount)
    : 0;

  if (currentAttempts >= maxAttempts) {
    throw new Error("otp_attempts_exceeded");
  }

  const expectedHash = hashOtpCode({
    token: normalizedToken,
    code: String(otpCode).trim(),
  });

  if (!safeEqual(expectedHash, verification.otpHash)) {
    const nextAttemptCount = currentAttempts + 1;
    const timestamp = nowIso();
    const isLocked = nextAttemptCount >= maxAttempts;
    await updateDoc(found.ref, {
      status: isLocked ? "revoked" : found.invite.status,
      updatedAt: timestamp,
      verification: {
        ...verification,
        otpAttemptCount: nextAttemptCount,
      },
    });

    if (isLocked) {
      throw new Error("otp_attempts_exceeded");
    }

    throw new Error("invalid_otp");
  }

  const userRef = doc(db, getUsersCollectionName(), found.invite.email);
  const userSnapshot = await getDoc(userRef);
  if (!userSnapshot.exists()) {
    throw new Error("invite_user_not_found");
  }

  const currentUser = normalizeFirestoreUser(userSnapshot.id, userSnapshot.data());
  if (!currentUser) {
    throw new Error("invite_user_not_found");
  }

  if (currentUser.status === "disabled") {
    throw new Error("account_disabled");
  }

  const timestamp = nowIso();
  const nextUser = normalizeUserRecord({
    ...currentUser,
    status: "active",
    activatedAt: currentUser.activatedAt || timestamp,
    updatedAt: timestamp,
    phoneVerifiedAt: timestamp,
    phoneLast4: verification.phoneLast4 || null,
    phoneHash: verification.phoneHash || null,
    verificationMethod: "sms",
  });
  await setDoc(userRef, nextUser);

  const nextVerification = {
    ...verification,
    otpHash: null,
    otpExpiresAt: null,
    otpAttemptCount: 0,
    verifiedAt: timestamp,
  };
  await updateDoc(found.ref, {
    status: "verified",
    updatedAt: timestamp,
    verification: nextVerification,
  });

  return {
    user: toPublicUser(nextUser),
    invite: toPublicInvite({
      ...found.invite,
      status: "verified",
      updatedAt: timestamp,
      verification: nextVerification,
    }),
  };
}

async function completeInviteSmsVerificationInFile({ token, otpCode }) {
  const normalizedToken = normalizeInviteToken(token);
  if (!normalizedToken) {
    throw new Error("invalid_invite_token");
  }

  if (!isValidOtpCode(otpCode)) {
    throw new Error("invalid_otp");
  }

  const found = await findInviteByTokenInFile(normalizedToken);
  if (!found) {
    throw new Error("invite_not_found");
  }

  const currentStatus = resolveInviteStatus(found.invite);
  if (currentStatus === "expired") {
    found.invite.status = "expired";
    found.invite.updatedAt = nowIso();
    await writeStore(found.store);
    throw new Error("invite_expired");
  }

  if (currentStatus === "revoked") {
    throw new Error("invite_revoked");
  }

  if (currentStatus === "verified") {
    throw new Error("invite_already_verified");
  }

  const verification = found.invite.verification || {};
  if (!verification.otpHash || !verification.otpExpiresAt) {
    throw new Error("otp_not_requested");
  }

  if (new Date(verification.otpExpiresAt).getTime() <= Date.now()) {
    found.invite.updatedAt = nowIso();
    found.invite.verification = {
      ...verification,
      otpHash: null,
      otpExpiresAt: null,
    };
    await writeStore(found.store);
    throw new Error("otp_expired");
  }

  const maxAttempts = Number.isFinite(verification.otpMaxAttempts)
    ? Math.max(1, verification.otpMaxAttempts)
    : getOtpMaxAttempts();
  const currentAttempts = Number.isFinite(verification.otpAttemptCount)
    ? Math.max(0, verification.otpAttemptCount)
    : 0;
  if (currentAttempts >= maxAttempts) {
    throw new Error("otp_attempts_exceeded");
  }

  const expectedHash = hashOtpCode({
    token: normalizedToken,
    code: String(otpCode).trim(),
  });
  if (!safeEqual(expectedHash, verification.otpHash)) {
    const timestamp = nowIso();
    const nextAttemptCount = currentAttempts + 1;
    const isLocked = nextAttemptCount >= maxAttempts;
    found.invite.status = isLocked ? "revoked" : found.invite.status;
    found.invite.updatedAt = timestamp;
    found.invite.verification = {
      ...verification,
      otpAttemptCount: nextAttemptCount,
    };
    await writeStore(found.store);

    if (isLocked) {
      throw new Error("otp_attempts_exceeded");
    }
    throw new Error("invalid_otp");
  }

  const user = found.store.users.find((item) => item.email === found.invite.email);
  if (!user) {
    throw new Error("invite_user_not_found");
  }

  if (user.status === "disabled") {
    throw new Error("account_disabled");
  }

  const timestamp = nowIso();
  user.status = "active";
  user.activatedAt = user.activatedAt || timestamp;
  user.phoneVerifiedAt = timestamp;
  user.phoneLast4 = verification.phoneLast4 || null;
  user.phoneHash = verification.phoneHash || null;
  user.verificationMethod = "sms";
  user.updatedAt = timestamp;

  found.invite.status = "verified";
  found.invite.updatedAt = timestamp;
  found.invite.verification = {
    ...verification,
    otpHash: null,
    otpExpiresAt: null,
    otpAttemptCount: 0,
    verifiedAt: timestamp,
  };
  await writeStore(found.store);

  return {
    user: toPublicUser(user),
    invite: toPublicInvite(found.invite),
  };
}

async function completeInviteEmailVerificationInFirestore(db, { token }) {
  const normalizedToken = normalizeInviteToken(token);
  if (!normalizedToken) {
    throw new Error("invalid_invite_token");
  }

  const found = await findInviteDocumentByTokenInFirestore(db, normalizedToken);
  if (!found) {
    throw new Error("invite_not_found");
  }

  const currentStatus = resolveInviteStatus(found.invite);
  if (currentStatus === "expired") {
    await updateDoc(found.ref, {
      status: "expired",
      updatedAt: nowIso(),
    });
    throw new Error("invite_expired");
  }

  if (currentStatus === "revoked") {
    throw new Error("invite_revoked");
  }

  if (currentStatus === "verified") {
    throw new Error("invite_already_verified");
  }

  const userRef = doc(db, getUsersCollectionName(), found.invite.email);
  const userSnapshot = await getDoc(userRef);
  if (!userSnapshot.exists()) {
    throw new Error("invite_user_not_found");
  }

  const currentUser = normalizeFirestoreUser(userSnapshot.id, userSnapshot.data());
  if (!currentUser) {
    throw new Error("invite_user_not_found");
  }

  if (currentUser.status === "disabled") {
    throw new Error("account_disabled");
  }

  const timestamp = nowIso();
  const nextUser = normalizeUserRecord({
    ...currentUser,
    status: "active",
    activatedAt: currentUser.activatedAt || timestamp,
    emailVerifiedAt: timestamp,
    verificationMethod: "email",
    updatedAt: timestamp,
  });
  await setDoc(userRef, nextUser);

  const nextVerification = {
    ...(found.invite.verification || {}),
    otpHash: null,
    otpExpiresAt: null,
    otpAttemptCount: 0,
    verifiedAt: timestamp,
  };
  await updateDoc(found.ref, {
    status: "verified",
    updatedAt: timestamp,
    verification: nextVerification,
  });

  return {
    user: toPublicUser(nextUser),
    invite: toPublicInvite({
      ...found.invite,
      status: "verified",
      updatedAt: timestamp,
      verification: nextVerification,
    }),
  };
}

async function completeInviteEmailVerificationInFile({ token }) {
  const normalizedToken = normalizeInviteToken(token);
  if (!normalizedToken) {
    throw new Error("invalid_invite_token");
  }

  const found = await findInviteByTokenInFile(normalizedToken);
  if (!found) {
    throw new Error("invite_not_found");
  }

  const currentStatus = resolveInviteStatus(found.invite);
  if (currentStatus === "expired") {
    found.invite.status = "expired";
    found.invite.updatedAt = nowIso();
    await writeStore(found.store);
    throw new Error("invite_expired");
  }

  if (currentStatus === "revoked") {
    throw new Error("invite_revoked");
  }

  if (currentStatus === "verified") {
    throw new Error("invite_already_verified");
  }

  const user = found.store.users.find((item) => item.email === found.invite.email);
  if (!user) {
    throw new Error("invite_user_not_found");
  }

  if (user.status === "disabled") {
    throw new Error("account_disabled");
  }

  const timestamp = nowIso();
  user.status = "active";
  user.activatedAt = user.activatedAt || timestamp;
  user.emailVerifiedAt = timestamp;
  user.verificationMethod = "email";
  user.updatedAt = timestamp;

  found.invite.status = "verified";
  found.invite.updatedAt = timestamp;
  found.invite.verification = {
    ...(found.invite.verification || {}),
    otpHash: null,
    otpExpiresAt: null,
    otpAttemptCount: 0,
    verifiedAt: timestamp,
  };
  await writeStore(found.store);

  return {
    user: toPublicUser(user),
    invite: toPublicInvite(found.invite),
  };
}

export async function getInviteForEmailVerification(token) {
  const inviteBusinessErrors = new Set([
    "invalid_invite_token",
    "invite_not_found",
    "invite_expired",
    "invite_revoked",
    "invite_already_verified",
    "invite_user_not_found",
    "account_disabled",
  ]);
  const db = await getFirestoreStore();
  if (db) {
    try {
      return await getInviteForAccountOpeningFromFirestore(db, token);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (inviteBusinessErrors.has(reason)) {
        throw error;
      }
      return await getInviteForAccountOpeningFromFile(token);
    }
  }

  return await getInviteForAccountOpeningFromFile(token);
}

export async function verifyInviteEmail({ token }) {
  const inviteBusinessErrors = new Set([
    "invalid_invite_token",
    "invite_not_found",
    "invite_expired",
    "invite_revoked",
    "invite_already_verified",
    "invite_user_not_found",
    "account_disabled",
  ]);
  const db = await getFirestoreStore();
  if (db) {
    try {
      return await completeInviteEmailVerificationInFirestore(db, { token });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (inviteBusinessErrors.has(reason)) {
        throw error;
      }
      return await completeInviteEmailVerificationInFile({ token });
    }
  }

  return await completeInviteEmailVerificationInFile({ token });
}

export async function revokeInviteById(inviteId) {
  const db = await getFirestoreStore();
  if (db) {
    try {
      return await revokeInviteByIdInFirestore(db, inviteId);
    } catch {
      return await revokeInviteByIdInFile(inviteId);
    }
  }

  return await revokeInviteByIdInFile(inviteId);
}

export async function listUserAccounts() {
  const db = await getFirestoreStore();
  if (db) {
    try {
      return await listUserAccountsFromFirestore(db);
    } catch {
      return await listUserAccountsFromFile();
    }
  }

  return await listUserAccountsFromFile();
}

export async function getLoginAccount(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  const db = await getFirestoreStore();
  if (db) {
    try {
      return await getLoginAccountFromFirestore(db, normalizedEmail);
    } catch {
      return await getLoginAccountFromFile(normalizedEmail);
    }
  }

  return await getLoginAccountFromFile(normalizedEmail);
}

export async function markUserLogin(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  const db = await getFirestoreStore();
  if (db) {
    try {
      return await markUserLoginInFirestore(db, normalizedEmail);
    } catch {
      return await markUserLoginInFile(normalizedEmail);
    }
  }

  return await markUserLoginInFile(normalizedEmail);
}

export async function inviteUserAccount({ email, role, invitedBy }) {
  const db = await getFirestoreStore();
  if (db) {
    try {
      return await inviteUserAccountInFirestore(db, { email, role, invitedBy });
    } catch {
      return await inviteUserAccountInFile({ email, role, invitedBy });
    }
  }

  return await inviteUserAccountInFile({ email, role, invitedBy });
}

export async function updateUserAccountStatus({ userId, status }) {
  const db = await getFirestoreStore();
  if (db) {
    try {
      return await updateUserAccountStatusInFirestore(db, { userId, status });
    } catch {
      return await updateUserAccountStatusInFile({ userId, status });
    }
  }

  return await updateUserAccountStatusInFile({ userId, status });
}

export async function archiveUserAccount({
  userId,
  archivedBy,
  reason,
  retentionDeleteAt,
}) {
  const db = await getFirestoreStore();
  if (db) {
    try {
      return await archiveUserAccountInFirestore(db, {
        userId,
        archivedBy,
        reason,
        retentionDeleteAt,
      });
    } catch {
      return await archiveUserAccountInFile({
        userId,
        archivedBy,
        reason,
        retentionDeleteAt,
      });
    }
  }

  return await archiveUserAccountInFile({
    userId,
    archivedBy,
    reason,
    retentionDeleteAt,
  });
}

export async function updateUserAccountRole({ userId, role }) {
  const db = await getFirestoreStore();
  if (db) {
    try {
      return await updateUserAccountRoleInFirestore(db, { userId, role });
    } catch {
      return await updateUserAccountRoleInFile({ userId, role });
    }
  }

  return await updateUserAccountRoleInFile({ userId, role });
}

export async function purgeDueArchivedUserAccounts({ now } = {}) {
  const db = await getFirestoreStore();
  if (db) {
    try {
      return await purgeDueArchivedUserAccountsInFirestore(db, { now });
    } catch {
      return await purgeDueArchivedUserAccountsInFile({ now });
    }
  }

  return await purgeDueArchivedUserAccountsInFile({ now });
}

export async function updateUserAccountProfile({
  userId,
  firstName,
  middleName,
  lastName,
  profilePhotoDataUrl,
  profilePhotoStoragePath,
}) {
  const db = await getFirestoreStore();
  if (db) {
    try {
      return await updateUserAccountProfileInFirestore(db, {
        userId,
        firstName,
        middleName,
        lastName,
        profilePhotoDataUrl,
        profilePhotoStoragePath,
      });
    } catch {
      return await updateUserAccountProfileInFile({
        userId,
        firstName,
        middleName,
        lastName,
        profilePhotoDataUrl,
        profilePhotoStoragePath,
      });
    }
  }

  return await updateUserAccountProfileInFile({
    userId,
    firstName,
    middleName,
    lastName,
    profilePhotoDataUrl,
    profilePhotoStoragePath,
  });
}
