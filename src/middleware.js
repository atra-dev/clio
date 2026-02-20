import { NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "clio_session";
const PROTECTED_PATHS = [
  "/dashboard",
  "/employees",
  "/activity-log",
  "/exports",
  "/documents",
  "/settings",
  "/user-management",
];

function isProtectedPath(pathname) {
  return PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function middleware(request) {
  const url = request.nextUrl.clone();

  if (url.searchParams.has("role")) {
    url.searchParams.delete("role");
    return NextResponse.redirect(url);
  }

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (isProtectedPath(url.pathname) && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/dashboard/:path*",
    "/employees/:path*",
    "/activity-log/:path*",
    "/exports/:path*",
    "/documents/:path*",
    "/settings/:path*",
    "/user-management/:path*",
  ],
};
