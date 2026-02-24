import { listUserAccounts } from "@/lib/user-accounts";
import { formatPersonName, formatNameFromEmail } from "@/lib/name-utils";

const ACTOR_DIRECTORY_CACHE_TTL_MS = 30 * 1000;
let cachedUserAccounts = [];
let cachedUserAccountsAt = 0;

function normalizeActorEmail(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    return "";
  }
  return normalized;
}

function buildAccountDisplayName(account, fallbackEmail) {
  return formatPersonName({
    firstName: account?.firstName,
    middleName: account?.middleName,
    lastName: account?.lastName,
    fallbackEmail,
    fallbackLabel: "User",
  });
}

async function getCachedUserAccounts() {
  const now = Date.now();
  if (now - cachedUserAccountsAt < ACTOR_DIRECTORY_CACHE_TTL_MS && Array.isArray(cachedUserAccounts)) {
    return cachedUserAccounts;
  }

  const users = await listUserAccounts();
  cachedUserAccounts = Array.isArray(users) ? users : [];
  cachedUserAccountsAt = now;
  return cachedUserAccounts;
}

export function collectActorEmailSet(values = []) {
  const set = new Set();

  values.forEach((value) => {
    const normalizedEmail = normalizeActorEmail(value);
    if (normalizedEmail) {
      set.add(normalizedEmail);
    }
  });

  return set;
}

export async function createActorDirectory(values = []) {
  const emailSet = collectActorEmailSet(values);
  const includeAll = emailSet.size === 0;
  const directory = new Map();

  try {
    const users = await getCachedUserAccounts();

    users.forEach((user) => {
      const email = normalizeActorEmail(user?.email);
      if (!email) {
        return;
      }
      if (!includeAll && !emailSet.has(email)) {
        return;
      }

      directory.set(email, {
        email,
        name: buildAccountDisplayName(user, email),
        avatarUrl: typeof user?.profilePhotoDataUrl === "string" ? user.profilePhotoDataUrl : null,
      });
    });
  } catch {
    // Fallback to deterministic email-derived names if account lookup fails.
  }

  emailSet.forEach((email) => {
    if (!directory.has(email)) {
      directory.set(email, {
        email,
        name: formatNameFromEmail(email),
        avatarUrl: null,
      });
    }
  });

  return directory;
}

export function resolveActor(directory, actorValue) {
  const email = normalizeActorEmail(actorValue);
  if (email && directory instanceof Map) {
    const actor = directory.get(email);
    if (actor) {
      return actor;
    }
  }

  if (email) {
    return {
      email,
      name: formatNameFromEmail(email),
      avatarUrl: null,
    };
  }

  const raw = String(actorValue || "").trim();
  if (!raw) {
    return {
      email: "",
      name: "System",
      avatarUrl: null,
    };
  }

  return {
    email: raw,
    name: raw,
    avatarUrl: null,
  };
}

export function enrichTrailActors(events, directory, { actorKey = "by" } = {}) {
  if (!Array.isArray(events)) {
    return [];
  }

  return events.map((event) => {
    const actor = resolveActor(directory, event?.[actorKey]);
    return {
      ...event,
      [`${actorKey}Name`]: actor.name,
      [`${actorKey}Email`]: actor.email || String(event?.[actorKey] || ""),
      [`${actorKey}Avatar`]: actor.avatarUrl,
    };
  });
}

export function collectEmailsFromTrail(events, actorKey = "by") {
  if (!Array.isArray(events)) {
    return [];
  }

  return events.map((event) => event?.[actorKey]).filter(Boolean);
}

export function collectEmployeeActorValues(record) {
  if (!record || typeof record !== "object") {
    return [];
  }

  const values = [record.createdBy, record.updatedBy];
  if (Array.isArray(record.activityHistory)) {
    record.activityHistory.forEach((item) => {
      values.push(item?.by);
    });
  }
  if (Array.isArray(record.documents)) {
    record.documents.forEach((item) => {
      values.push(item?.uploadedBy);
    });
  }

  return values.filter(Boolean);
}

export function enrichEmployeeRecordActors(record, directory) {
  if (!record || typeof record !== "object") {
    return record;
  }

  const createdActor = resolveActor(directory, record.createdBy);
  const updatedActor = resolveActor(directory, record.updatedBy);

  const activityHistory = Array.isArray(record.activityHistory)
    ? record.activityHistory.map((item) => {
        const actor = resolveActor(directory, item?.by);
        return {
          ...item,
          byName: actor.name,
          byEmail: actor.email || String(item?.by || ""),
          byAvatar: actor.avatarUrl,
        };
      })
    : [];

  const documents = Array.isArray(record.documents)
    ? record.documents.map((item) => {
        const actor = resolveActor(directory, item?.uploadedBy);
        return {
          ...item,
          uploadedByName: actor.name,
          uploadedByEmail: actor.email || String(item?.uploadedBy || ""),
          uploadedByAvatar: actor.avatarUrl,
        };
      })
    : [];

  return {
    ...record,
    createdByName: createdActor.name,
    createdByEmail: createdActor.email || String(record.createdBy || ""),
    createdByAvatar: createdActor.avatarUrl,
    updatedByName: updatedActor.name,
    updatedByEmail: updatedActor.email || String(record.updatedBy || ""),
    updatedByAvatar: updatedActor.avatarUrl,
    activityHistory,
    documents,
  };
}

export function collectTemplateActorValues(record) {
  if (!record || typeof record !== "object") {
    return [];
  }

  const values = [record.createdBy, record.updatedBy];

  if (Array.isArray(record.versionHistory)) {
    record.versionHistory.forEach((item) => {
      values.push(item?.changedBy);
    });
  }
  if (Array.isArray(record.modificationLog)) {
    record.modificationLog.forEach((item) => {
      values.push(item?.by);
    });
  }
  if (Array.isArray(record.usageLogs)) {
    record.usageLogs.forEach((item) => {
      values.push(item?.by, item?.uploadedBy, item?.performedBy);
    });
  }

  return values.filter(Boolean);
}

export function enrichTemplateRecordActors(record, directory) {
  if (!record || typeof record !== "object") {
    return record;
  }

  const createdActor = resolveActor(directory, record.createdBy);
  const updatedActor = resolveActor(directory, record.updatedBy);

  const versionHistory = Array.isArray(record.versionHistory)
    ? record.versionHistory.map((item) => {
        const actor = resolveActor(directory, item?.changedBy);
        return {
          ...item,
          changedByName: actor.name,
          changedByEmail: actor.email || String(item?.changedBy || ""),
          changedByAvatar: actor.avatarUrl,
        };
      })
    : [];

  const modificationLog = Array.isArray(record.modificationLog)
    ? record.modificationLog.map((item) => {
        const actor = resolveActor(directory, item?.by);
        return {
          ...item,
          byName: actor.name,
          byEmail: actor.email || String(item?.by || ""),
          byAvatar: actor.avatarUrl,
        };
      })
    : [];

  return {
    ...record,
    createdByName: createdActor.name,
    createdByEmail: createdActor.email || String(record.createdBy || ""),
    createdByAvatar: createdActor.avatarUrl,
    updatedByName: updatedActor.name,
    updatedByEmail: updatedActor.email || String(record.updatedBy || ""),
    updatedByAvatar: updatedActor.avatarUrl,
    versionHistory,
    modificationLog,
  };
}
