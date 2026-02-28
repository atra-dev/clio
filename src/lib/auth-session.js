import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { normalizeRole } from "@/lib/hris";

export const SESSION_COOKIE_NAME = "clio_session";
export const MFA_LOGIN_PROOF_COOKIE_NAME = "clio_mfa_login_proof";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const MFA_LOGIN_PROOF_MAX_AGE_SECONDS = 60 * 5;

function normalizeSessionVersion(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

function getSessionSecret() {
  const configuredSecret = process.env.CLIO_SESSION_SECRET;
  if (process.env.NODE_ENV === "production" && !configuredSecret) {
    throw new Error("CLIO_SESSION_SECRET must be set in production.");
  }
  return configuredSecret || "clio-dev-secret-change-this-before-prod";
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(encoded) {
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function signPayload(encodedPayload) {
  return createHmac("sha256", getSessionSecret()).update(encodedPayload).digest("base64url");
}

function isMatchingSignature(expected, received) {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(received || "", "utf8");
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function createSession(email, role, { sessionVersion } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_MAX_AGE_SECONDS;
  const session = {
    email: email.trim().toLowerCase(),
    role: normalizeRole(role),
    sv: normalizeSessionVersion(sessionVersion),
    iat: now,
    exp: expiresAt,
  };

  const payload = encodePayload(session);
  const signature = signPayload(payload);
  return {
    token: `${payload}.${signature}`,
    expiresAt,
    session,
  };
}

export function createMfaLoginProof(email, { ttlSeconds = MFA_LOGIN_PROOF_MAX_AGE_SECONDS } = {}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("invalid_mfa_login_proof_email");
  }

  const now = Math.floor(Date.now() / 1000);
  const safeTtl = Number.isFinite(ttlSeconds) ? Math.max(30, Math.trunc(ttlSeconds)) : MFA_LOGIN_PROOF_MAX_AGE_SECONDS;
  const expiresAt = now + safeTtl;
  const payload = encodePayload({
    type: "mfa_login_proof",
    email: normalizedEmail,
    iat: now,
    exp: expiresAt,
  });
  const signature = signPayload(payload);
  return {
    token: `${payload}.${signature}`,
    expiresAt,
  };
}

export function verifyMfaLoginProof(token, { email } = {}) {
  const verified = verifySessionToken(token);
  if (!verified) {
    return null;
  }

  const [encodedPayload] = String(token || "").split(".");
  const decoded = decodePayload(encodedPayload);
  if (!decoded || decoded.type !== "mfa_login_proof") {
    return null;
  }

  const proofEmail = String(decoded.email || "").trim().toLowerCase();
  if (!proofEmail) {
    return null;
  }

  const expectedEmail = String(email || "").trim().toLowerCase();
  if (expectedEmail && proofEmail !== expectedEmail) {
    return null;
  }

  return {
    email: proofEmail,
    exp: verified.exp,
    iat: verified.iat,
  };
}

export function verifySessionToken(token) {
  if (typeof token !== "string" || !token.includes(".")) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);
  if (!isMatchingSignature(expectedSignature, signature)) {
    return null;
  }

  const payload = decodePayload(encodedPayload);
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    return null;
  }

  if (typeof payload.email !== "string" || payload.email.trim().length === 0) {
    return null;
  }

  return {
    email: payload.email,
    role: normalizeRole(payload.role),
    sessionVersion: normalizeSessionVersion(payload.sv),
    iat: payload.iat,
    exp: payload.exp,
  };
}

export async function getServerSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

export function getSessionCookieOptions(expiresAt) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt * 1000),
  };
}

export function getMfaLoginProofCookieOptions(expiresAt) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt * 1000),
  };
}

export function getExpiredCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  };
}
