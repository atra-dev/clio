import { consumeRateLimit, getRequestSourceIp } from "@/lib/api-rate-limit";
import { createInAppNotificationsBulk, resolveGrcRecipients } from "@/lib/security-notifications";

const OTP_FAILURE_REASONS = new Set([
  "invalid_otp",
  "otp_expired",
  "otp_attempts_exceeded",
  "otp_not_requested",
  "otp_cooldown",
  "firebase_phone_not_verified",
]);

function asString(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return asString(value).toLowerCase();
}

function normalizeReason(value) {
  return asString(value).toLowerCase();
}

function resolveAlertActor(actorEmail, sourceIp) {
  const email = normalizeEmail(actorEmail);
  if (email) {
    return email;
  }
  const ip = asString(sourceIp);
  return ip || "unknown";
}

async function notifyGrc(payloadFactory) {
  const recipients = await resolveGrcRecipients();
  if (recipients.length === 0) {
    return;
  }

  const payloads = recipients.map((recipientEmail) => payloadFactory(recipientEmail));
  await createInAppNotificationsBulk(payloads);
}

export async function alertRepeatedOtpFailures({
  request,
  actorEmail,
  reason,
  context = "login_sms_verification",
} = {}) {
  const normalizedReason = normalizeReason(reason);
  if (!OTP_FAILURE_REASONS.has(normalizedReason)) {
    return;
  }

  const sourceIp = getRequestSourceIp(request);
  const actorKey = resolveAlertActor(actorEmail, sourceIp);
  const threshold = 5;
  const windowMs = 10 * 60 * 1000;
  const rate = consumeRateLimit({
    scope: `auth-otp-failure-alert:${context}`,
    identifier: actorKey,
    limit: threshold,
    windowMs,
  });

  if (!rate.allowed || rate.remaining > 0) {
    return;
  }

  await notifyGrc((recipientEmail) => ({
    title: "Repeated OTP verification failures detected",
    message: `Detected ${threshold} OTP failure events for ${actorKey} within 10 minutes.`,
    severity: "high",
    type: "auth-otp-failure-spike",
    module: "Authentication",
    actionUrl: "/incident-management",
    recipientEmail,
    metadata: {
      actorEmail: normalizeEmail(actorEmail),
      sourceIp,
      reason: normalizedReason,
      context,
      threshold,
      windowMinutes: 10,
    },
    createdBy: normalizeEmail(actorEmail) || "system@gmail.com",
  }));
}

export async function alertRepeatedNewDeviceSignIns({
  actorEmail,
  sourceIp,
  deviceLabel,
} = {}) {
  const normalizedEmail = normalizeEmail(actorEmail);
  if (!normalizedEmail) {
    return;
  }

  const threshold = 3;
  const windowMs = 30 * 60 * 1000;
  const rate = consumeRateLimit({
    scope: "auth-new-device-alert",
    identifier: normalizedEmail,
    limit: threshold,
    windowMs,
  });

  if (!rate.allowed || rate.remaining > 0) {
    return;
  }

  await notifyGrc((recipientEmail) => ({
    title: "Unusual new-device sign-in pattern detected",
    message: `User ${normalizedEmail} triggered ${threshold} new-device sign-ins within 30 minutes.`,
    severity: "medium",
    type: "auth-new-device-anomaly",
    module: "Authentication",
    actionUrl: "/incident-management",
    recipientEmail,
    metadata: {
      actorEmail: normalizedEmail,
      sourceIp: asString(sourceIp),
      deviceLabel: asString(deviceLabel),
      threshold,
      windowMinutes: 30,
    },
    createdBy: normalizedEmail,
  }));
}
