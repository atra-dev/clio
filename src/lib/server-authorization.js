import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-session";
import { normalizeRole } from "@/lib/hris";
import { canAccessModule } from "@/lib/rbac";
import { recordAuditEvent } from "@/lib/audit-log";

export async function requireAuthenticatedSession() {
  const session = await getServerSession();
  if (!session) {
    redirect("/login");
  }
  return {
    ...session,
    role: normalizeRole(session.role),
  };
}

export async function requireModuleAccess(moduleId) {
  const session = await requireAuthenticatedSession();

  if (!canAccessModule(session.role, moduleId)) {
    await recordAuditEvent({
      activityName: `Blocked module access: ${moduleId}`,
      status: "Rejected",
      module: "Authorization",
      performedBy: session.email,
      sensitivity: "Sensitive",
      metadata: {
        attemptedModule: moduleId,
        role: session.role,
        reason: "module_permission_denied",
      },
    });

    redirect("/unauthorized");
  }

  return session;
}
