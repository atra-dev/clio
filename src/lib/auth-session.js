import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { normalizeRole } from "@/lib/hris";

export const SESSION_COOKIE_NAME = "clio_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

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

export function createSession(email, role) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_MAX_AGE_SECONDS;
  const session = {
    email: email.trim().toLowerCase(),
    role: normalizeRole(role),
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
