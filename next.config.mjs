const isProduction = process.env.NODE_ENV === "production";
const distDir = process.env.CLIO_NEXT_DIST_DIR || ".next";

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

function normalizeProvider(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("resend")) return "resend";
  if (normalized.includes("firebase")) return "firebase";
  if (normalized.includes("twilio")) return "twilio";
  if (normalized.includes("console")) return "console";
  if (normalized === "none" || normalized === "off") return "none";
  return normalized;
}

function assertProductionAlertProviders() {
  if (!isProduction) {
    return;
  }

  const emailProvider = normalizeProvider(env("CLIO_ALERT_EMAIL_PROVIDER")) || "none";
  if (emailProvider === "console") {
    throw new Error(
      "[CLIO Security] CLIO_ALERT_EMAIL_PROVIDER=console is not allowed in production.",
    );
  }
  if (emailProvider === "resend" && (!env("RESEND_API_KEY") || !env("CLIO_EMAIL_FROM"))) {
    throw new Error(
      "[CLIO Security] RESEND_API_KEY and CLIO_EMAIL_FROM are required when CLIO_ALERT_EMAIL_PROVIDER=resend.",
    );
  }
  if (!["none", "resend", "firebase"].includes(emailProvider)) {
    throw new Error(
      "[CLIO Security] Unsupported CLIO_ALERT_EMAIL_PROVIDER. Allowed values: none, firebase, resend.",
    );
  }

  const smsProvider = normalizeProvider(env("CLIO_ALERT_SMS_PROVIDER")) || "none";
  if (smsProvider === "console") {
    throw new Error(
      "[CLIO Security] CLIO_ALERT_SMS_PROVIDER=console is not allowed in production.",
    );
  }
  if (smsProvider === "twilio") {
    if (!env("TWILIO_ACCOUNT_SID") || !env("TWILIO_AUTH_TOKEN") || !env("TWILIO_FROM_NUMBER")) {
      throw new Error(
        "[CLIO Security] TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER are required when CLIO_ALERT_SMS_PROVIDER=twilio.",
      );
    }
  }
}

function assertProductionAuthHardening() {
  if (!isProduction) {
    return;
  }

  const sessionSecret = env("CLIO_SESSION_SECRET");
  if (!sessionSecret || sessionSecret.length < 48 || sessionSecret.includes("temp-dev-secret")) {
    throw new Error(
      "[CLIO Security] CLIO_SESSION_SECRET must be a strong production secret (min 48 chars, non-temporary).",
    );
  }

  const claimsStrict = parseBooleanEnv("CLIO_REQUIRE_FIREBASE_CUSTOM_CLAIMS", true);
  if (!claimsStrict) {
    throw new Error(
      "[CLIO Security] CLIO_REQUIRE_FIREBASE_CUSTOM_CLAIMS=false is not allowed in production.",
    );
  }

  const adminProjectId = env("FIREBASE_ADMIN_PROJECT_ID");
  const adminClientEmail = env("FIREBASE_ADMIN_CLIENT_EMAIL");
  const adminPrivateKey = env("FIREBASE_ADMIN_PRIVATE_KEY");
  if (!adminProjectId || !adminClientEmail || !adminPrivateKey) {
    throw new Error(
      "[CLIO Security] FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY are required in production.",
    );
  }
}

assertProductionAlertProviders();
assertProductionAuthHardening();

const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  "https://accounts.google.com",
  "https://apis.google.com",
  "https://www.gstatic.com",
  "https://www.googleapis.com",
];

if (!isProduction) {
  scriptSrc.push("'unsafe-eval'");
}

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "form-action 'self' https://accounts.google.com",
      `script-src ${scriptSrc.join(" ")}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://lh3.googleusercontent.com https://firebasestorage.googleapis.com https://*.googleusercontent.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://apis.google.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://firebasestorage.googleapis.com https://www.googleapis.com https://*.googleapis.com https://*.firebaseio.com ws: wss:",
      "frame-src 'self' https://accounts.google.com https://apis.google.com https://*.firebaseapp.com",
      "worker-src 'self' blob:",
    ].join("; "),
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "off",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin-allow-popups",
  },
  {
    key: "Cross-Origin-Resource-Policy",
    value: "same-site",
  },
];

if (isProduction) {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
  reactCompiler: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
