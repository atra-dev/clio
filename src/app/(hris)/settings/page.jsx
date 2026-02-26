import SettingsMfaModule from "@/components/hris/modules/SettingsMfaModule";
import SettingsReferenceDataModule from "@/components/hris/modules/SettingsReferenceDataModule";
import SettingsRecentActivityPanel from "@/components/hris/modules/SettingsRecentActivityPanel";
import { requireModuleAccess } from "@/lib/server-authorization";
import { normalizeRole } from "@/lib/hris";
import { getLoginAccount } from "@/lib/user-accounts";

export const metadata = {
  title: "Settings | Clio HRIS",
};

export default async function SettingsPage() {
  const session = await requireModuleAccess("settings");
  const account = await getLoginAccount(session?.email).catch(() => null);
  const isSmsMfaEnabled = Boolean(account?.smsMfaEnabled);
  const role = normalizeRole(session?.role);
  const isSuperAdmin = role === "SUPER_ADMIN";
  const isGrc = role === "GRC";
  const isHr = role === "HR";
  const canManageReferenceData = isSuperAdmin || isGrc || isHr;
  const roleLabel =
    role === "SUPER_ADMIN"
      ? "Super Admin"
      : role === "GRC"
        ? "GRC"
        : role === "HR"
          ? "HR"
          : role === "EA"
            ? "EA"
            : "Employee";

  return (
    <div className="space-y-6">
      <header className="relative overflow-hidden rounded-2xl border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_56%,#eff6ff_100%)] p-6 shadow-[0_20px_40px_-32px_rgba(15,23,42,0.45)]">
        <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-sky-100/60 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-12 -left-8 h-32 w-32 rounded-full bg-emerald-100/60 blur-2xl" />
        <div className="relative space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-700">
              Security Center
            </span>
            <span className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
              Role: {roleLabel}
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Settings</h1>
            <p className="mt-1 text-sm text-slate-600">
              Manage account protection and workspace reference data from a single control panel.
            </p>
          </div>
        </div>
      </header>

      {!isSmsMfaEnabled ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Security warning: SMS MFA is currently disabled.</p>
          <p className="mt-1 text-amber-800">
            This account can be at higher risk of unauthorized access. Enable MFA in Account Security.
          </p>
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <SettingsMfaModule />

          {canManageReferenceData ? (
            <SettingsReferenceDataModule />
          ) : null}
        </div>

        <div className="space-y-6">
          <SettingsRecentActivityPanel />
        </div>
      </section>
    </div>
  );
}
