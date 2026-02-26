function normalizeEmailProvider(rawValue) {
  const raw = String(rawValue || "")
    .trim()
    .toLowerCase();
  if (!raw) {
    return "";
  }

  if (raw === "firebase" || raw.includes("firebase")) {
    return "firebase";
  }

  if (raw === "resend" || raw.includes("resend")) {
    return "resend";
  }

  if (raw === "console" || raw === "dev" || raw.includes("console")) {
    return "console";
  }

  return raw;
}

function getEmailProvider() {
  const configured = normalizeEmailProvider(process.env.CLIO_EMAIL_PROVIDER);
  if (configured) {
    return configured;
  }

  const hasResendConfig =
    String(process.env.RESEND_API_KEY || "").trim().startsWith("re_") &&
    String(process.env.CLIO_EMAIL_FROM || "").trim().length > 0;
  if (hasResendConfig) {
    return "resend";
  }

  return "firebase";
}

function isConsoleEmailAllowed() {
  return String(process.env.CLIO_ALLOW_CONSOLE_EMAIL || "")
    .trim()
    .toLowerCase() === "true";
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw.replace(/\/+$/, "");
  }

  return `https://${raw.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function assertSafeProductionBaseUrl(baseUrl) {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("app_base_url_not_configured");
  }

  const hostname = String(parsed.hostname || "").trim().toLowerCase();
  const isLocalHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local");

  if (isLocalHost) {
    throw new Error("unsafe_app_base_url_for_production");
  }
}

function getAppBaseUrl({ requestOrigin } = {}) {
  const requestOriginUrl = normalizeBaseUrl(requestOrigin);
  const firebaseAuthDomain = normalizeBaseUrl(
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
  );
  const vercelUrl = normalizeBaseUrl(
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL,
  );
  const configured = normalizeBaseUrl(process.env.CLIO_APP_BASE_URL);
  const publicSiteUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL);

  const candidates =
    process.env.NODE_ENV === "production"
      ? [requestOriginUrl, configured, publicSiteUrl, vercelUrl, firebaseAuthDomain]
      : [requestOriginUrl, configured, publicSiteUrl, firebaseAuthDomain, vercelUrl];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    assertSafeProductionBaseUrl(candidate);
    return candidate;
  }

  throw new Error("app_base_url_not_configured");
}

function getLoginPath() {
  const configured = String(process.env.CLIO_LOGIN_PATH || "").trim();
  if (!configured) {
    return "/login";
  }
  return configured.startsWith("/") ? configured : `/${configured}`;
}

function getInviteVerifyPath() {
  const configured = String(process.env.CLIO_INVITE_VERIFY_PATH || "").trim();
  if (!configured) {
    return "/verify-invite";
  }
  return configured.startsWith("/") ? configured : `/${configured}`;
}

function buildLoginUrl(baseUrl) {
  return `${baseUrl}${getLoginPath()}`;
}

function buildInviteVerificationUrl(inviteToken, baseUrl) {
  const path = getInviteVerifyPath();
  const token = String(inviteToken || "").trim();
  if (!token) {
    throw new Error("invalid_invite_token");
  }
  return `${baseUrl}${path}?token=${encodeURIComponent(token)}`;
}

function isDevelopmentPreviewEnabled() {
  return process.env.NODE_ENV !== "production";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildEmailContent({ role, invitedBy, verifyUrl, loginUrl, expiresAt }) {
  const expirationDate = new Date(expiresAt);
  const readableExpiration = Number.isNaN(expirationDate.getTime())
    ? expiresAt
    : expirationDate.toLocaleString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

  const roleText = String(role || "Employee").trim() || "Employee";
  const invitedByText = String(invitedBy || "CLIO Administrator").trim() || "CLIO Administrator";
  const brandDomain = String(process.env.CLIO_EMAIL_BRAND_DOMAIN || "cisoasaservice.io").trim() || "cisoasaservice.io";
  const safeRole = escapeHtml(roleText);
  const safeInvitedBy = escapeHtml(invitedByText);
  const safeVerifyUrl = escapeHtml(verifyUrl);
  const safeLoginUrl = escapeHtml(loginUrl);
  const safeReadableExpiration = escapeHtml(readableExpiration);
  const safeBrandDomain = escapeHtml(brandDomain);

  const subject = "You're invited to verify your email and open your Clio account";
  const text = [
    "You have been invited to Clio Secured HRIS.",
    "",
    "To open your account, please verify your email first.",
    `Verify your Clio account: ${verifyUrl}`,
    `Sign in after verification: ${loginUrl}`,
    "",
    `Assigned role: ${roleText}`,
    `Invited by: ${invitedByText}`,
    `Invitation expires: ${readableExpiration}`,
    "",
    "For security, complete SMS OTP after email verification.",
    "Use the same invited work email when signing in.",
    "",
    `Domain: ${brandDomain}`,
  ].join("\n");

  return {
    subject,
    text,
    html: [
      "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:620px\">",
      "<p style=\"margin:0 0 12px 0\">Hello,</p>",
      "<p style=\"margin:0 0 12px 0\">You have been invited to <strong>Clio Secured HRIS</strong>.</p>",
      "<p style=\"margin:0 0 16px 0\">To open your account, please verify your email and complete secure onboarding.</p>",
      `<p style="margin:0 0 16px 0"><a href="${safeVerifyUrl}" style="display:inline-block;background:#0f6bcf;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600">Verify Clio Account</a></p>`,
      `<p style="margin:0 0 12px 0"><strong>Assigned role:</strong> ${safeRole}<br/>`,
      `<strong>Invited by:</strong> ${safeInvitedBy}<br/>`,
      `<strong>Invitation expires:</strong> ${safeReadableExpiration}</p>`,
      `<p style="margin:0 0 12px 0">After verification, sign in here: <a href="${safeLoginUrl}">${safeLoginUrl}</a></p>`,
      `<p style="margin:0 0 12px 0">For security, complete SMS OTP after email verification and use the same invited work email.</p>`,
      `<p style="margin:0;color:#475569;font-size:12px">This invitation is intended for authorized recipients of ${safeBrandDomain}.</p>`,
      "</div>",
    ].join(""),
  };
}

function parseFirebaseAuthError(payload) {
  const code = String(payload?.error?.message || "").trim();
  if (!code) {
    return "email_delivery_failed";
  }
  if (code === "OPERATION_NOT_ALLOWED") {
    return "firebase_email_provider_not_enabled";
  }
  if (code === "MISSING_CONTINUE_URI" || code === "INVALID_CONTINUE_URI") {
    return "firebase_continue_url_invalid";
  }
  if (code === "INVALID_EMAIL") {
    return "invalid_email";
  }
  if (code === "PROJECT_NOT_FOUND" || code === "API_KEY_INVALID") {
    return "firebase_api_key_not_configured";
  }
  return "email_delivery_failed";
}

async function sendViaFirebaseAuth({ toEmail, verifyUrl }) {
  const apiKey = String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("firebase_api_key_not_configured");
  }

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requestType: "EMAIL_SIGNIN",
      email: toEmail,
      continueUrl: verifyUrl,
      canHandleCodeInApp: true,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(parseFirebaseAuthError(payload));
  }

  return {
    provider: "firebase",
    status: "sent",
    messageId: `firebase-${Date.now()}`,
  };
}

async function sendViaResend({ toEmail, subject, html, text }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const fromAddress = String(process.env.CLIO_EMAIL_FROM || "").trim();
  if (!apiKey || !fromAddress || !apiKey.startsWith("re_")) {
    throw new Error("email_provider_not_configured");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [toEmail],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const providerMessage =
      typeof payload?.message === "string"
        ? payload.message
        : typeof payload?.error?.message === "string"
          ? payload.error.message
          : "";
    throw new Error(
      providerMessage ? `email_delivery_failed:${providerMessage}` : "email_delivery_failed",
    );
  }

  const payload = await response.json().catch(() => ({}));
  return {
    provider: "resend",
    status: "sent",
    messageId: typeof payload?.id === "string" ? payload.id : `resend-${Date.now()}`,
  };
}

function sendViaConsole({ toEmail, subject, verifyUrl, loginUrl }) {
  const messageId = `console-${Date.now()}`;
  if (isDevelopmentPreviewEnabled()) {
    console.info("[CLIO:InviteEmail]", {
      toEmail,
      subject,
      verifyUrl,
      loginUrl,
      messageId,
    });
  }

  return {
    provider: "console",
    status: "simulated",
    messageId,
    previewUrl: verifyUrl,
    loginUrl,
  };
}

export async function deliverInviteEmail({
  toEmail,
  role,
  invitedBy,
  expiresAt,
  inviteToken,
  requestOrigin = "",
}) {
  const baseUrl = getAppBaseUrl({ requestOrigin });
  const verifyUrl = buildInviteVerificationUrl(inviteToken, baseUrl);
  const loginUrl = buildLoginUrl(baseUrl);
  const content = buildEmailContent({
    role,
    invitedBy,
    verifyUrl,
    loginUrl,
    expiresAt,
  });
  const provider = getEmailProvider();

  if (provider === "firebase") {
    return await sendViaFirebaseAuth({
      toEmail,
      verifyUrl,
    });
  }

  if (provider === "resend") {
    return await sendViaResend({
      toEmail,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
  }

  if (provider === "console") {
    if (!isConsoleEmailAllowed()) {
      throw new Error("email_provider_not_configured");
    }

    return sendViaConsole({
      toEmail,
      subject: content.subject,
      verifyUrl,
      loginUrl,
    });
  }

  throw new Error("unsupported_email_provider");
}
