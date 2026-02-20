import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/api-authorization";
import { recordAuditEvent } from "@/lib/audit-log";
import { canAccessModule, getModuleIdFromPathname } from "@/lib/rbac";

const PAGE_LABELS = {
  "/dashboard": "Viewed Dashboard",
  "/employees": "Viewed Employee Records",
  "/activity-log": "Viewed Activity Log",
  "/exports": "Viewed Export Control",
  "/documents": "Viewed Sheets and PDF",
  "/settings": "Viewed Settings",
  "/user-management": "Viewed User Management",
};

function getPageLabel(pathname) {
  if (PAGE_LABELS[pathname]) {
    return PAGE_LABELS[pathname];
  }
  return `Viewed ${pathname || "workspace page"}`;
}

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
      await recordAuditEvent({
        activityName: `Page view blocked: ${pathname}`,
        status: "Rejected",
        module: "Authorization",
        performedBy: session.email,
        sensitivity: "Sensitive",
        metadata: {
          pathname,
          role: session.role,
          attemptedModule: moduleId,
          reason: "module_permission_denied",
        },
        request,
      });

      return NextResponse.json({ message: "Forbidden." }, { status: 403 });
    }

    await recordAuditEvent({
      activityName: getPageLabel(pathname),
      status: "Completed",
      module: "Navigation",
      performedBy: session.email,
      sensitivity: "Non-sensitive",
      metadata: {
        pathname,
      },
      request,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ message: "Unable to log page view." }, { status: 400 });
  }
}
