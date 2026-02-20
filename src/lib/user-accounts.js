import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  addDoc,
  collection,
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
const DEFAULT_OTP_TTL_SECONDS = 300;
const DEFAULT_OTP_MAX_ATTEMPTS = 5;
const DEFAULT_OTP_RESEND_COOLDOWN_SECONDS = 60;

let storeInitPromise;

function nowIso() {
  return new Date().toISOString();
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

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
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
      emails: parseEmailList(process.env.SUPER_ADMIN_EMAILS, ["superadmin@clio.local"]),
    },
    {
      role: "HR",
      emails: parseEmailList(process.env.HR_EMAILS, ["hr@clio.local"]),
    },
    {
      role: "GRC",
      emails: parseEmailList(process.env.GRC_EMAILS, ["grc@clio.local"]),
    },
    {
      role: "EA",
      emails: parseEmailList(process.env.EA_EMAILS, ["ea@clio.local"]),
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

  return {
    id: typeof user?.id === "string" && user.id.trim().length > 0 ? user.id : email,
    email,
    role: ALLOWED_ROLE_IDS.has(role) ? role : "HR",
    status,
    invitedBy: normalizeEmail(user?.invitedBy) || "system@clio.local",
    invitedAt,
    activatedAt: typeof user?.activatedAt === "string" ? user.activatedAt : null,
    emailVerifiedAt: typeof user?.emailVerifiedAt === "string" ? user.emailVerifiedAt : null,
    lastLoginAt: typeof user?.lastLoginAt === "string" ? user.lastLoginAt : null,
    phoneVerifiedAt: typeof user?.phoneVerifiedAt === "string" ? user.phoneVerifiedAt : null,
    phoneLast4: typeof user?.phoneLast4 === "string" ? user.phoneLast4 : null,
    phoneHash: typeof user?.phoneHash === "string" ? user.phoneHash : null,
    verificationMethod: ["sms", "email"].includes(user?.verificationMethod) ? user.verificationMethod : null,
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
    invitedBy: normalizeEmail(invite?.invitedBy) || "system@clio.local",
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
      invitedBy: "system@clio.local",
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
    invitedBy: user.invitedBy,
    invitedAt: user.invitedAt,
    activatedAt: user.activatedAt,
    emailVerifiedAt: user.emailVerifiedAt,
    lastLoginAt: user.lastLoginAt,
    phoneVerifiedAt: user.phoneVerifiedAt,
    phoneLast4: user.phoneLast4,
    verificationMethod: user.verificationMethod,
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
      invitedBy: "system@clio.local",
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

async function listUserAccountsFromFirestore(db) {
  await ensureFirestoreBootstrapAccounts(db);

  const snapshot = await getDocs(collection(db, getUsersCollectionName()));
  const users = snapshot.docs
    .map((item) => normalizeFirestoreUser(item.id, item.data()))
    .filter(Boolean)
    .map(toPublicUser);

  return sortUsersByDate(users);
}

async function getLoginAccountFromFirestore(db, email) {
  await ensureFirestoreBootstrapAccounts(db);

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

  const sender = normalizeEmail(invitedBy) || "superadmin@clio.local";
  const timestamp = nowIso();
  const userRef = doc(db, getUsersCollectionName(), normalizedEmail);
  const existing = await getDoc(userRef);

  const basePayload = existing.exists() ? existing.data() : {};
  const nextUser = normalizeUserRecord({
    ...basePayload,
    id: normalizedEmail,
    email: normalizedEmail,
    role: requestedRole,
    status: "pending",
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

  const timestamp = nowIso();
  const nextPayload = {
    status: normalizedStatus,
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
      const { store } = withBootstrapAccounts(normalized);
      await writeStore(store);
    })();
  }

  return storeInitPromise;
}

async function loadStore() {
  await ensureStore();
  const raw = await readStoreFile();
  const normalized = normalizeStore(raw);
  const { store, changed } = withBootstrapAccounts(normalized);

  if (changed) {
    await writeStore(store);
  }

  return store;
}

async function listUserAccountsFromFile() {
  const store = await loadStore();
  return sortUsersByDate(store.users).map(toPublicUser);
}

async function getLoginAccountFromFile(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
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
  const sender = normalizeEmail(invitedBy) || "superadmin@clio.local";

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
    user.role = requestedRole;
    user.status = "pending";
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
  user.status = normalizedStatus;
  user.updatedAt = timestamp;
  if (normalizedStatus === "active" && !user.activatedAt) {
    user.activatedAt = timestamp;
  }

  await writeStore(store);
  return toPublicUser(user);
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
