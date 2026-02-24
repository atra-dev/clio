import { createSign } from "node:crypto";

const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIREBASE_IDENTITY_TOOLKIT_BASE_URL = "https://identitytoolkit.googleapis.com/v1";
const CLAIMS_CHAR_LIMIT = 1000;
const TOKEN_SCOPE = "https://www.googleapis.com/auth/identitytoolkit";

let cachedAccessToken = {
  token: "",
  expiresAtMs: 0,
  cacheKey: "",
};

function env(name) {
  return String(process.env[name] || "").trim();
}

function parseBooleanEnv(name, fallbackValue = false) {
  const raw = env(name).toLowerCase();
  if (!raw) {
    return fallbackValue;
  }
  return raw === "true" || raw === "1" || raw === "yes";
}

function isClaimsSyncRequired() {
  const defaultRequired = process.env.NODE_ENV === "production";
  return parseBooleanEnv("CLIO_REQUIRE_FIREBASE_CUSTOM_CLAIMS", defaultRequired);
}

function normalizePrivateKey(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function getServiceAccountConfig() {
  const projectId = env("FIREBASE_ADMIN_PROJECT_ID") || env("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  const clientEmail = env("FIREBASE_ADMIN_CLIENT_EMAIL");
  const privateKey = normalizePrivateKey(env("FIREBASE_ADMIN_PRIVATE_KEY"));

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

function base64UrlEncodeJson(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signJwtAssertion({ clientEmail, privateKey }) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  const body = {
    iss: clientEmail,
    scope: TOKEN_SCOPE,
    aud: GOOGLE_OAUTH_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  };

  const encodedHeader = base64UrlEncodeJson(header);
  const encodedBody = base64UrlEncodeJson(body);
  const unsignedToken = `${encodedHeader}.${encodedBody}`;

  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(privateKey, "base64url");

  return `${unsignedToken}.${signature}`;
}

async function getAccessToken(config) {
  const cacheKey = `${config.projectId}:${config.clientEmail}`;
  const now = Date.now();

  if (
    cachedAccessToken.token &&
    cachedAccessToken.cacheKey === cacheKey &&
    now < cachedAccessToken.expiresAtMs - 60_000
  ) {
    return cachedAccessToken.token;
  }

  const assertion = signJwtAssertion(config);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new Error("firebase_admin_access_token_failed");
  }

  const expiresInSeconds = Number.parseInt(String(payload.expires_in || "3600"), 10) || 3600;
  cachedAccessToken = {
    token: String(payload.access_token),
    expiresAtMs: now + expiresInSeconds * 1000,
    cacheKey,
  };

  return cachedAccessToken.token;
}

function mapIdentityToolkitErrorCode(code) {
  const normalized = String(code || "").trim();
  if (!normalized) {
    return "firebase_identity_toolkit_request_failed";
  }
  if (normalized === "EMAIL_NOT_FOUND" || normalized === "USER_NOT_FOUND") {
    return "firebase_user_not_found";
  }
  if (normalized === "INVALID_CUSTOM_ATTRIBUTES") {
    return "invalid_custom_claims_payload";
  }
  if (normalized === "INSUFFICIENT_PERMISSION") {
    return "firebase_admin_permission_denied";
  }
  if (normalized === "PROJECT_NOT_FOUND") {
    return "firebase_project_not_found";
  }
  return "firebase_identity_toolkit_request_failed";
}

async function callIdentityToolkit(config, accessToken, methodName, payload) {
  const response = await fetch(
    `${FIREBASE_IDENTITY_TOOLKIT_BASE_URL}/projects/${encodeURIComponent(config.projectId)}/${methodName}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload || {}),
      cache: "no-store",
    },
  );

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = mapIdentityToolkitErrorCode(result?.error?.message);
    throw new Error(reason);
  }

  return result;
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeRole(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeSessionVersion(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

function parseCustomAttributes(rawValue) {
  if (!rawValue) {
    return {};
  }
  try {
    const parsed = JSON.parse(String(rawValue || ""));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return {};
  }
  return {};
}

async function lookupFirebaseUser({ config, accessToken, uid, email }) {
  const normalizedUid = String(uid || "").trim();
  const normalizedEmail = normalizeEmail(email);

  if (normalizedUid) {
    const byUid = await callIdentityToolkit(config, accessToken, "accounts:lookup", {
      localId: [normalizedUid],
    });
    const user = Array.isArray(byUid?.users) ? byUid.users[0] : null;
    if (user) {
      return user;
    }
  }

  if (normalizedEmail) {
    try {
      const byEmail = await callIdentityToolkit(config, accessToken, "accounts:lookup", {
        email: [normalizedEmail],
      });
      const user = Array.isArray(byEmail?.users) ? byEmail.users[0] : null;
      if (user) {
        return user;
      }
    } catch (error) {
      if (String(error?.message || "") === "firebase_user_not_found") {
        return null;
      }
      throw error;
    }
  }

  return null;
}

function buildClioClaims({ role, email, status, sessionVersion }) {
  const claims = {
    role: normalizeRole(role) || "EMPLOYEE_L1",
    clioRole: normalizeRole(role) || "EMPLOYEE_L1",
    clioEmail: normalizeEmail(email) || "",
    clioStatus: normalizeStatus(status) || "pending",
    clioSessionVersion: normalizeSessionVersion(sessionVersion),
  };

  const serialized = JSON.stringify(claims);
  if (serialized.length > CLAIMS_CHAR_LIMIT) {
    throw new Error("invalid_custom_claims_payload");
  }

  return claims;
}

export function isFirebaseCustomClaimsSyncConfigured() {
  return Boolean(getServiceAccountConfig());
}

export async function syncFirebaseCustomClaimsForUser({
  uid,
  email,
  role,
  status,
  sessionVersion,
  allowMissingUser = true,
  strict,
} = {}) {
  const config = getServiceAccountConfig();
  const requireSync = typeof strict === "boolean" ? strict : isClaimsSyncRequired();

  if (!config) {
    if (requireSync) {
      throw new Error("firebase_custom_claims_not_configured");
    }
    return {
      ok: false,
      reason: "firebase_custom_claims_not_configured",
      uid: "",
      email: normalizeEmail(email),
    };
  }

  const accessToken = await getAccessToken(config);
  const user = await lookupFirebaseUser({
    config,
    accessToken,
    uid,
    email,
  });

  if (!user) {
    if (allowMissingUser) {
      return {
        ok: false,
        reason: "firebase_user_not_found",
        uid: String(uid || "").trim(),
        email: normalizeEmail(email),
      };
    }
    throw new Error("firebase_user_not_found");
  }

  const resolvedUid = String(user.localId || "").trim();
  const resolvedEmail = normalizeEmail(email) || normalizeEmail(user.email);
  if (!resolvedUid || !resolvedEmail) {
    throw new Error("firebase_user_not_found");
  }

  const nextClaims = {
    ...parseCustomAttributes(user.customAttributes),
    ...buildClioClaims({
      role,
      email: resolvedEmail,
      status,
      sessionVersion,
    }),
  };

  const serializedClaims = JSON.stringify(nextClaims);
  if (serializedClaims.length > CLAIMS_CHAR_LIMIT) {
    throw new Error("invalid_custom_claims_payload");
  }

  await callIdentityToolkit(config, accessToken, "accounts:update", {
    localId: resolvedUid,
    customAttributes: serializedClaims,
  });

  return {
    ok: true,
    reason: "synced",
    uid: resolvedUid,
    email: resolvedEmail,
    claims: nextClaims,
  };
}
