import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-session";
import { normalizeRole } from "@/lib/hris";
import { canAccessModule } from "@/lib/rbac";
import { recordAuditEvent } from "@/lib/audit-log";
import { formatPersonName } from "@/lib/name-utils";
import { getLoginAccount } from "@/lib/user-accounts";

export async function requireAuthenticatedSession() {
  const session = await getServerSession();
  if (!session) {
    redirect("/login");
  }

  const normalizedSession = {
    ...session,
    role: normalizeRole(session.role),
  };

  const account = await getLoginAccount(normalizedSession.email).catch(() => null);
  const accountRole = normalizeRole(account?.role);
  const accountSessionVersion = Number.parseInt(String(account?.sessionVersion ?? ""), 10) || 1;
  const allowsRoleContextSwitch = accountRole === "SUPER_ADMIN";
  const roleMismatch = normalizedSession.role !== accountRole;
  const staleSessionVersion = normalizedSession.sessionVersion !== accountSessionVersion;
  const isSessionValid = Boolean(
    account &&
      account.status === "active" &&
      !staleSessionVersion &&
      (!roleMismatch || allowsRoleContextSwitch),
  );

  if (!isSessionValid) {
    await recordAuditEvent({
      activityName: "Server session rejected",
      status: "Rejected",
      module: "Authorization",
      performedBy: normalizedSession.email || "anonymous@gmail.com",
      sensitivity: "Sensitive",
      metadata: {
        reason: !account
          ? "account_not_found"
          : account.status !== "active"
            ? "account_not_active"
            : staleSessionVersion
              ? "session_version_mismatch"
              : "session_role_mismatch",
        accountStatus: account?.status || null,
        tokenRole: normalizedSession.role,
        accountRole: accountRole || null,
        tokenSessionVersion: normalizedSession.sessionVersion,
        accountSessionVersion: accountSessionVersion || null,
      },
    }).catch(() => null);

    redirect("/login");
  }

  const firstName = String(account?.firstName || "").trim();
  const middleName = String(account?.middleName || "").trim();
  const lastName = String(account?.lastName || "").trim();

  return {
    ...normalizedSession,
    firstName,
    middleName,
    lastName,
    displayName: formatPersonName({
      firstName,
      middleName,
      lastName,
      fallbackEmail: normalizedSession.email,
      fallbackLabel: "Clio User",
    }),
    profilePhotoDataUrl: typeof account?.profilePhotoDataUrl === "string" ? account.profilePhotoDataUrl : "",
    profilePhotoStoragePath: typeof account?.profilePhotoStoragePath === "string" ? account.profilePhotoStoragePath : "",
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
