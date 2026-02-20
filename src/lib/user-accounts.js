import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ROLES } from "@/features/hris/constants";
import { normalizeRole } from "@/lib/hris";

const DATA_DIR = path.join(process.cwd(), "data");
const USER_STORE_FILE = path.join(DATA_DIR, "user-accounts.json");
const ALLOWED_STATUSES = new Set(["pending", "active", "disabled"]);
const ALLOWED_ROLE_IDS = new Set(ROLES.map((role) => role.id));

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
    id: typeof user?.id === "string" && user.id.trim().length > 0 ? user.id : createId("USR"),
    email,
    role: ALLOWED_ROLE_IDS.has(role) ? role : "HR",
    status,
    invitedBy: normalizeEmail(user?.invitedBy) || "system@clio.local",
    invitedAt,
    activatedAt: typeof user?.activatedAt === "string" ? user.activatedAt : null,
    lastLoginAt: typeof user?.lastLoginAt === "string" ? user.lastLoginAt : null,
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
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  return {
    id: typeof invite?.id === "string" && invite.id.trim().length > 0 ? invite.id : createId("INV"),
    email,
    role: ALLOWED_ROLE_IDS.has(role) ? role : "HR",
    invitedBy: normalizeEmail(invite?.invitedBy) || "system@clio.local",
    invitedAt,
    expiresAt,
    token: typeof invite?.token === "string" && invite.token.trim().length > 0 ? invite.token : createInviteToken(),
    status: invite?.status === "revoked" ? "revoked" : "sent",
  };
}

function normalizeStore(rawStore) {
  const rawUsers = Array.isArray(rawStore?.users) ? rawStore.users : [];
  const rawInvites = Array.isArray(rawStore?.invites) ? rawStore.invites : [];

  const userByEmail = new Map();
  rawUsers.map(normalizeUserRecord).filter(Boolean).forEach((record) => {
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
      id: createId("USR"),
      email: bootstrap.email,
      role: bootstrap.role,
      status: "active",
      invitedBy: "system@clio.local",
      invitedAt: timestamp,
      activatedAt: timestamp,
      lastLoginAt: null,
      updatedAt: timestamp,
      source: "bootstrap",
    });
    existingEmails.add(bootstrap.email);
    changed = true;
  }

  return { store: nextStore, changed };
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
    lastLoginAt: user.lastLoginAt,
    updatedAt: user.updatedAt,
    source: user.source,
  };
}

export async function listUserAccounts() {
  const store = await loadStore();
  return sortUsersByDate(store.users).map(toPublicUser);
}

export async function getLoginAccount(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  const store = await loadStore();
  const user = store.users.find((item) => item.email === normalizedEmail);
  return user ? toPublicUser(user) : null;
}

export async function markUserLogin(email) {
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

export async function inviteUserAccount({ email, role, invitedBy }) {
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
  const normalizedRole = requestedRole;

  const store = await loadStore();
  const timestamp = nowIso();
  const sender = normalizeEmail(invitedBy) || "superadmin@clio.local";

  let user = store.users.find((item) => item.email === normalizedEmail);
  if (!user) {
    user = {
      id: createId("USR"),
      email: normalizedEmail,
      role: normalizedRole,
      status: "pending",
      invitedBy: sender,
      invitedAt: timestamp,
      activatedAt: null,
      lastLoginAt: null,
      updatedAt: timestamp,
      source: "invite",
    };
    store.users.push(user);
  } else {
    user.role = normalizedRole;
    user.status = "pending";
    user.invitedBy = sender;
    user.invitedAt = timestamp;
    user.updatedAt = timestamp;
    if (user.source !== "bootstrap") {
      user.source = "invite";
    }
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const invite = {
    id: createId("INV"),
    email: normalizedEmail,
    role: normalizedRole,
    invitedBy: sender,
    invitedAt: timestamp,
    expiresAt,
    token: createInviteToken(),
    status: "sent",
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
      invitationToken: invite.token,
      invitationUrl: `/invite/${invite.token}`,
    },
  };
}

export async function updateUserAccountStatus({ userId, status }) {
  const normalizedStatus = String(status || "")
    .trim()
    .toLowerCase();
  if (!ALLOWED_STATUSES.has(normalizedStatus)) {
    throw new Error("invalid_status");
  }

  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    throw new Error("invalid_user");
  }

  const store = await loadStore();
  const user = store.users.find((item) => item.id === normalizedUserId);
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
