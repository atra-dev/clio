import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { canAccessModule, getModuleIdFromPathname } from "@/lib/rbac";

export async function POST(request) {
  const auth = await authorizeApiRequest(request, {
    requiredPermissions: ["audit:write:nonsensitive"],
    auditModule: "Navigation",
    auditAction: "Page view log request",
  });
  if (auth.error) {
    return auth.error;
  }

  const { session } = auth;

  try {
    const body = await request.json();
    const pathname = typeof body?.pathname === "string" ? body.pathname : "/dashboard";
    const moduleId = getModuleIdFromPathname(pathname);

    if (moduleId && !canAccessModule(session.role, moduleId)) {
      return NextResponse.json({ message: "Forbidden." }, { status: 403 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ message: "Unable to log page view." }, { status: 400 });
  }
}
