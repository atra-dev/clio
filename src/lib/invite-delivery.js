function normalizeEmailProvider(rawValue) {
  const raw = String(rawValue || "")
    .trim()
    .toLowerCase();
  if (!raw) {
    return "firebase";
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
  return normalizeEmailProvider(process.env.CLIO_EMAIL_PROVIDER);
}

function isConsoleEmailAllowed() {
  return String(process.env.CLIO_ALLOW_CONSOLE_EMAIL || "")
    .trim()
    .toLowerCase() === "true";
}

function getAppBaseUrl() {
  const configured = String(process.env.CLIO_APP_BASE_URL || "").trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return "http://localhost:3000";
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

function buildLoginUrl() {
  const baseUrl = getAppBaseUrl();
  return `${baseUrl}${getLoginPath()}`;
}

function buildInviteVerificationUrl(inviteToken) {
  const baseUrl = getAppBaseUrl();
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

  const subject = "You are invited to CLIO HRIS";
  const text = [
    "You were invited to access CLIO HRIS.",
    `Assigned role: ${role}`,
    `Invited by: ${invitedBy}`,
    `Verify your email: ${verifyUrl}`,
    `Sign-in page: ${loginUrl}`,
    `Invitation expires: ${readableExpiration}`,
    "",
    "Step 1: Open the verification link and complete email verification.",
    "Step 2: After verification, sign in using Google with the same invited work email.",
    "Only invited accounts can access the workspace.",
  ].join("\n");

  return {
    subject,
    text,
    html: [
      "<p>You were invited to access <strong>CLIO HRIS</strong>.</p>",
      `<p><strong>Assigned role:</strong> ${role}<br/>`,
      `<strong>Invited by:</strong> ${invitedBy}<br/>`,
      `<strong>Invitation expires:</strong> ${readableExpiration}</p>`,
      `<p><a href="${verifyUrl}">Verify your email</a></p>`,
      `<p><a href="${loginUrl}">Open CLIO sign-in</a></p>`,
      "<p>After verification, sign in using Google with the same invited work email.</p>",
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

export async function deliverInviteEmail({ toEmail, role, invitedBy, expiresAt, inviteToken }) {
  const verifyUrl = buildInviteVerificationUrl(inviteToken);
  const loginUrl = buildLoginUrl();
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
