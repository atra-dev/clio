import { NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "clio_session";
const PROTECTED_PATHS = [
  "/dashboard",
  "/employees",
  "/employment-lifecycle",
  "/attendance",
  "/performance",
  "/activity-log",
  "/exports",
  "/documents",
  "/access-management",
  "/retention-archive",
  "/incident-management",
  "/requests",
  "/settings",
  "/user-management",
];

function isProtectedPath(pathname) {
  return PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let value = "";
  for (const byte of bytes) {
    value += String.fromCharCode(byte);
  }
  return btoa(value);
}

function buildCspHeader({ nonce, isDevelopment, pathname }) {
  const isInviteVerificationPath = pathname === "/verify-invite" || pathname.startsWith("/verify-invite/");
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "https://accounts.google.com",
    "https://apis.google.com",
    "https://www.google.com",
    "https://www.recaptcha.net",
    "https://www.gstatic.com",
    "https://www.googleapis.com",
  ];
  // Firebase email-link landing on /verify-invite can inject inline bootstrap scripts.
  // Keep CSP strict elsewhere and allow inline only for this route to avoid hydration deadlock.
  if (isInviteVerificationPath) {
    scriptSrc.push("'unsafe-inline'");
  }

  const connectSrc = [
    "'self'",
    "https://apis.google.com",
    "https://identitytoolkit.googleapis.com",
    "https://securetoken.googleapis.com",
    "https://firestore.googleapis.com",
    "https://firebasestorage.googleapis.com",
    "https://www.googleapis.com",
    "https://*.googleapis.com",
    "https://*.firebaseio.com",
    "https://www.google.com",
    "https://www.recaptcha.net",
    "https://www.gstatic.com",
  ];

  if (isDevelopment) {
    scriptSrc.push("'unsafe-eval'");
    connectSrc.push("ws://localhost:*", "ws://127.0.0.1:*", "wss://localhost:*", "wss://127.0.0.1:*");
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self' https://accounts.google.com",
    `script-src ${scriptSrc.join(" ")}`,
    `style-src 'self' 'unsafe-inline' 'nonce-${nonce}'`,
    "img-src 'self' data: blob: https://lh3.googleusercontent.com https://firebasestorage.googleapis.com https://*.googleusercontent.com https://www.gstatic.com https://www.google.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src ${connectSrc.join(" ")}`,
    "frame-src 'self' https://accounts.google.com https://apis.google.com https://*.firebaseapp.com https://www.google.com https://www.recaptcha.net",
    "worker-src 'self' blob:",
  ].join("; ");
}

function applyCsp(response, nonce, cspHeader) {
  response.headers.set("Content-Security-Policy", cspHeader);
  response.headers.set("x-nonce", nonce);
  return response;
}

export function proxy(request) {
  const nonce = generateNonce();
  const url = request.nextUrl.clone();
  const cspHeader = buildCspHeader({
    nonce,
    isDevelopment: process.env.NODE_ENV !== "production",
    pathname: url.pathname,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-csp-nonce", nonce);

  if (url.searchParams.has("role")) {
    url.searchParams.delete("role");
    return applyCsp(NextResponse.redirect(url), nonce, cspHeader);
  }

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (isProtectedPath(url.pathname) && !hasSession) {
    return applyCsp(NextResponse.redirect(new URL("/login", request.url)), nonce, cspHeader);
  }

  return applyCsp(NextResponse.next({ request: { headers: requestHeaders } }), nonce, cspHeader);
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/unauthorized",
    "/dashboard/:path*",
    "/employees/:path*",
    "/employment-lifecycle/:path*",
    "/attendance/:path*",
    "/performance/:path*",
    "/activity-log/:path*",
    "/exports/:path*",
    "/documents/:path*",
    "/access-management/:path*",
    "/retention-archive/:path*",
    "/incident-management/:path*",
    "/requests/:path*",
    "/settings/:path*",
    "/user-management/:path*",
    "/unauthorized/:path*",
    "/verify-invite/:path*",
  ],
};
