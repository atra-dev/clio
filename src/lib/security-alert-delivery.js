const RESEND_API_BASE = "https://api.resend.com";
const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

function asString(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseBooleanEnv(name, fallbackValue = false) {
  const raw = asString(process.env[name]).toLowerCase();
  if (!raw) {
    return fallbackValue;
  }
  return raw === "true" || raw === "1" || raw === "yes";
}

function normalizeEmail(value) {
  return asString(value).toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/[^\d+]/g, "").trim();
}

function parseCsvList(value) {
  return asString(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupe(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeEmailProvider(value) {
  const normalized = asString(value).toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized.includes("resend")) return "resend";
  if (normalized.includes("firebase")) return "firebase";
  if (normalized.includes("console") || normalized === "dev") return "console";
  if (normalized === "none" || normalized === "off") return "none";
  return normalized;
}

function normalizeSmsProvider(value) {
  const normalized = asString(value).toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized.includes("twilio")) return "twilio";
  if (normalized.includes("console") || normalized === "dev") return "console";
  if (normalized === "none" || normalized === "off") return "none";
  return normalized;
}

function resolveAlertEmailProvider() {
  const configured = normalizeEmailProvider(process.env.CLIO_ALERT_EMAIL_PROVIDER);
  if (configured) {
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    return "none";
  }
  const hasResend = asString(process.env.RESEND_API_KEY).startsWith("re_") && asString(process.env.CLIO_EMAIL_FROM);
  return hasResend ? "resend" : "console";
}

function resolveAlertSmsProvider() {
  const configured = normalizeSmsProvider(process.env.CLIO_ALERT_SMS_PROVIDER);
  if (configured) {
    return configured;
  }
  return "none";
}

function resolveSecurityAlertRecipients(explicitRecipients = []) {
  const fromEnv = [
    ...parseCsvList(process.env.CLIO_SECURITY_ALERT_RECIPIENTS),
    ...parseCsvList(process.env.GRC_EMAILS),
    ...parseCsvList(process.env.SUPER_ADMIN_EMAILS),
  ];
  return dedupe(
    [...fromEnv, ...asArray(explicitRecipients)]
      .map((value) => normalizeEmail(value))
      .filter(Boolean),
  );
}

function resolveSmsRecipients(explicitRecipients = []) {
  const fromEnv = parseCsvList(process.env.CLIO_SMS_ALERT_RECIPIENTS);
  return dedupe([...fromEnv, ...asArray(explicitRecipients)].map((value) => normalizePhone(value)).filter(Boolean));
}

function buildIncidentAlertSubject({ incident, detection }) {
  const severity = asString(incident?.severity || detection?.severity || "Medium").toUpperCase();
  const incidentCode = asString(incident?.incidentCode, "INCIDENT");
  const title = asString(incident?.title, "Security anomaly detected");
  return `[CLIO][${severity}] ${incidentCode} - ${title}`;
}

function buildIncidentAlertText({ incident, detection, sourceEvent }) {
  const ruleId = asString(detection?.ruleId, "N/A");
  const sourceIp = asString(sourceEvent?.metadata?.sourceIp || sourceEvent?.sourceIp, "unknown");
  const actor = asString(sourceEvent?.performedBy, "unknown");
  const requestPath = asString(sourceEvent?.metadata?.requestPath || sourceEvent?.requestPath, "unknown");
  const observedCount = Number(detection?.observedCount || 0);
  const detectedAt = asString(incident?.detectedAt || sourceEvent?.occurredAt, new Date().toISOString());
  return [
    "CLIO security anomaly alert",
    `Incident: ${asString(incident?.incidentCode, "-")} | ${asString(incident?.title, "-")}`,
    `Severity: ${asString(incident?.severity, "-")}`,
    `Rule: ${ruleId}`,
    `Detected At: ${detectedAt}`,
    `Actor: ${actor}`,
    `Source IP: ${sourceIp}`,
    `Request Path: ${requestPath}`,
    `Observed Count: ${observedCount > 0 ? observedCount : "-"}`,
    `Summary: ${asString(incident?.summary || detection?.summary, "-")}`,
    `Action URL: ${asString(incident?.actionUrl, "/incident-management")}`,
  ].join("\n");
}

function buildIncidentAlertHtml(text) {
  const escaped = String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<pre style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space:pre-wrap;">${escaped}</pre>`;
}

async function sendEmailViaResend({ recipients, subject, text, html }) {
  const apiKey = asString(process.env.RESEND_API_KEY);
  const fromAddress = asString(process.env.CLIO_EMAIL_FROM);
  if (!apiKey || !fromAddress || !apiKey.startsWith("re_")) {
    throw new Error("email_provider_not_configured");
  }

  const response = await fetch(`${RESEND_API_BASE}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: fromAddress,
      to: recipients,
      subject,
      text,
      html,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      asString(payload?.message) ||
      asString(payload?.error?.message) ||
      "email_delivery_failed";
    throw new Error(`email_delivery_failed:${message}`);
  }

  return {
    provider: "resend",
    status: "sent",
    messageId: asString(payload?.id, `resend-${Date.now()}`),
    recipientCount: recipients.length,
  };
}

function sendEmailViaConsole({ recipients, subject, text }) {
  if (parseBooleanEnv("CLIO_ALLOW_CONSOLE_EMAIL", true) || process.env.NODE_ENV !== "production") {
    console.info("[CLIO:SecurityAlert:Email]", {
      recipients,
      subject,
      text,
    });
  }
  return {
    provider: "console",
    status: "simulated",
    recipientCount: recipients.length,
  };
}

async function dispatchEmailAlerts({ recipients, subject, text, html }) {
  const safeRecipients = dedupe(asArray(recipients).map(normalizeEmail).filter(Boolean));
  if (safeRecipients.length === 0) {
    return {
      provider: "none",
      status: "skipped",
      reason: "no_recipients",
      recipientCount: 0,
    };
  }

  const provider = resolveAlertEmailProvider();
  if (provider === "none") {
    return {
      provider,
      status: "skipped",
      reason: "provider_disabled",
      recipientCount: 0,
    };
  }
  if (provider === "firebase") {
    return {
      provider,
      status: "skipped",
      reason: "firebase_not_supported_for_custom_alert_email",
      recipientCount: 0,
    };
  }
  if (provider === "console") {
    return sendEmailViaConsole({
      recipients: safeRecipients,
      subject,
      text,
    });
  }
  if (provider === "resend") {
    return await sendEmailViaResend({
      recipients: safeRecipients,
      subject,
      text,
      html,
    });
  }

  return {
    provider,
    status: "skipped",
    reason: "unsupported_provider",
    recipientCount: 0,
  };
}

async function sendSmsViaTwilio({ recipients, body }) {
  const accountSid = asString(process.env.TWILIO_ACCOUNT_SID);
  const authToken = asString(process.env.TWILIO_AUTH_TOKEN);
  const fromNumber = asString(process.env.TWILIO_FROM_NUMBER);
  if (!accountSid || !authToken || !fromNumber) {
    throw new Error("twilio_not_configured");
  }

  const authHeader = Buffer.from(`${accountSid}:${authToken}`, "utf8").toString("base64");
  const requests = recipients.map(async (to) => {
    const form = new URLSearchParams();
    form.set("To", to);
    form.set("From", fromNumber);
    form.set("Body", body);
    const response = await fetch(`${TWILIO_API_BASE}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = asString(payload?.message, "sms_delivery_failed");
      throw new Error(`twilio_delivery_failed:${message}`);
    }
    return {
      to,
      sid: asString(payload?.sid),
    };
  });

  const settled = await Promise.allSettled(requests);
  const delivered = settled
    .filter((item) => item.status === "fulfilled")
    .map((item) => item.value);
  const failed = settled
    .filter((item) => item.status === "rejected")
    .map((item) => asString(item.reason?.message || "sms_delivery_failed"));

  return {
    provider: "twilio",
    status: failed.length > 0 ? (delivered.length > 0 ? "partial" : "failed") : "sent",
    deliveredCount: delivered.length,
    recipientCount: recipients.length,
    delivered,
    failed,
  };
}

function sendSmsViaConsole({ recipients, body }) {
  if (process.env.NODE_ENV !== "production") {
    console.info("[CLIO:SecurityAlert:SMS]", {
      recipients,
      body,
    });
  }
  return {
    provider: "console",
    status: "simulated",
    deliveredCount: recipients.length,
    recipientCount: recipients.length,
    delivered: recipients.map((to) => ({ to, sid: `console-${Date.now()}` })),
    failed: [],
  };
}

async function dispatchSmsAlerts({ recipients, body }) {
  const safeRecipients = dedupe(asArray(recipients).map(normalizePhone).filter(Boolean));
  if (safeRecipients.length === 0) {
    return {
      provider: "none",
      status: "skipped",
      reason: "no_recipients",
      deliveredCount: 0,
      recipientCount: 0,
      failed: [],
    };
  }

  const provider = resolveAlertSmsProvider();
  if (provider === "none") {
    return {
      provider,
      status: "skipped",
      reason: "provider_disabled",
      deliveredCount: 0,
      recipientCount: safeRecipients.length,
      failed: [],
    };
  }
  if (provider === "console") {
    return sendSmsViaConsole({
      recipients: safeRecipients,
      body,
    });
  }
  if (provider === "twilio") {
    return await sendSmsViaTwilio({
      recipients: safeRecipients,
      body,
    });
  }

  return {
    provider,
    status: "skipped",
    reason: "unsupported_provider",
    deliveredCount: 0,
    recipientCount: safeRecipients.length,
    failed: [],
  };
}

function getConfiguredWebhookTargets() {
  const generic = parseCsvList(process.env.CLIO_SECURITY_WEBHOOK_URLS).map((url) => ({
    label: "security-webhook",
    url,
    token: asString(process.env.CLIO_SECURITY_WEBHOOK_TOKEN),
  }));
  const siemUrl = asString(process.env.CLIO_SIEM_WEBHOOK_URL);
  const edrUrl = asString(process.env.CLIO_EDR_WEBHOOK_URL);
  const targets = [...generic];
  if (siemUrl) {
    targets.push({
      label: "siem",
      url: siemUrl,
      token: asString(process.env.CLIO_SIEM_WEBHOOK_TOKEN),
    });
  }
  if (edrUrl) {
    targets.push({
      label: "edr",
      url: edrUrl,
      token: asString(process.env.CLIO_EDR_WEBHOOK_TOKEN),
    });
  }
  return targets.filter((target) => asString(target.url));
}

async function postWebhook({ url, label, token, payload, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      "Content-Type": "application/json",
      "X-CLIO-Source": "security-detection",
      "X-CLIO-Target": label,
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.text().catch(() => "");
    return {
      label,
      url,
      ok: response.ok,
      status: response.status,
      body: asString(body),
    };
  } catch (error) {
    return {
      label,
      url,
      ok: false,
      status: 0,
      body: asString(error?.message, "webhook_delivery_failed"),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchWebhooks(payload) {
  const targets = getConfiguredWebhookTargets();
  if (targets.length === 0) {
    return {
      status: "skipped",
      targets: [],
      successCount: 0,
    };
  }

  const timeoutMs = Number.parseInt(asString(process.env.CLIO_SECURITY_WEBHOOK_TIMEOUT_MS, "5000"), 10) || 5000;
  const results = await Promise.all(
    targets.map((target) =>
      postWebhook({
        ...target,
        payload,
        timeoutMs: Math.max(1000, Math.min(20000, timeoutMs)),
      }),
    ),
  );
  const successCount = results.filter((item) => item.ok).length;
  return {
    status: successCount === results.length ? "sent" : successCount > 0 ? "partial" : "failed",
    targets: results,
    successCount,
  };
}

export async function dispatchSecurityIncidentAlerts({
  incident,
  detection,
  sourceEvent,
  emailRecipients = [],
  smsRecipients = [],
} = {}) {
  const recipients = resolveSecurityAlertRecipients(emailRecipients);
  const smsTargets = resolveSmsRecipients(smsRecipients);
  const subject = buildIncidentAlertSubject({ incident, detection });
  const text = buildIncidentAlertText({ incident, detection, sourceEvent });
  const html = buildIncidentAlertHtml(text);

  const [emailResult, smsResult, webhookResult] = await Promise.all([
    dispatchEmailAlerts({
      recipients,
      subject,
      text,
      html,
    }).catch((error) => ({
      provider: resolveAlertEmailProvider(),
      status: "failed",
      reason: asString(error?.message, "email_delivery_failed"),
      recipientCount: recipients.length,
    })),
    dispatchSmsAlerts({
      recipients: smsTargets,
      body: `${subject}\n${text}`.slice(0, 1200),
    }).catch((error) => ({
      provider: resolveAlertSmsProvider(),
      status: "failed",
      reason: asString(error?.message, "sms_delivery_failed"),
      deliveredCount: 0,
      recipientCount: smsTargets.length,
      failed: [asString(error?.message, "sms_delivery_failed")],
    })),
    dispatchWebhooks({
      eventType: "clio.security.incident",
      generatedAt: new Date().toISOString(),
      incident,
      detection,
      sourceEvent: {
        id: asString(sourceEvent?.id),
        module: asString(sourceEvent?.module),
        activityName: asString(sourceEvent?.activityName),
        status: asString(sourceEvent?.status),
        occurredAt: asString(sourceEvent?.occurredAt),
        sourceIp: asString(sourceEvent?.metadata?.sourceIp || sourceEvent?.sourceIp),
        requestPath: asString(sourceEvent?.metadata?.requestPath || sourceEvent?.requestPath),
      },
    }),
  ]);

  return {
    subject,
    email: emailResult,
    sms: smsResult,
    webhooks: webhookResult,
    recipients,
    smsRecipients: smsTargets,
  };
}

export function resolveSecurityAlertEmailRecipients(explicitRecipients = []) {
  return resolveSecurityAlertRecipients(explicitRecipients);
}

export async function dispatchDirectSms({ recipients = [], body = "" } = {}) {
  return await dispatchSmsAlerts({
    recipients,
    body: asString(body, ""),
  });
}
