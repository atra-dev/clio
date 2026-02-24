import { NextResponse } from "next/server";
import { enforceRateLimitByRequest } from "@/lib/api-rate-limit";
import { recordAuditEvent } from "@/lib/audit-log";

function applyRateLimitHeaders(response, rateLimitResult) {
  if (!rateLimitResult?.headers || typeof rateLimitResult.headers !== "object") {
    return response;
  }
  for (const [headerKey, headerValue] of Object.entries(rateLimitResult.headers)) {
    response.headers.set(headerKey, String(headerValue));
  }
  return response;
}

function jsonResponse(payload, { status = 200, rateLimit } = {}) {
  const response = NextResponse.json(payload, { status });
  return applyRateLimitHeaders(response, rateLimit);
}

export async function POST(request) {
  const rateLimit = enforceRateLimitByRequest({
    request,
    scope: "auth-mfa-sms-start-ip",
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return jsonResponse(
      { message: "Too many requests. Please wait before retrying." },
      { status: 429, rateLimit },
    );
  }

  await recordAuditEvent({
    activityName: "Legacy SMS OTP endpoint blocked",
    status: "Rejected",
    module: "Authentication",
    performedBy: "anonymous@gmail.com",
    sensitivity: "Sensitive",
    metadata: {
      reason: "legacy_direct_sms_flow_disabled",
      recommendedFlow: "firebase_phone_auth_client_verification",
    },
    request,
  });

  return jsonResponse(
    {
      reason: "legacy_direct_sms_flow_disabled",
      message: "Direct server-side SMS OTP is disabled. Use Firebase phone verification on login.",
    },
    { status: 410, rateLimit },
  );
}
