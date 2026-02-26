import SurfaceCard from "@/components/hris/SurfaceCard";
import SettingsMfaModule from "@/components/hris/modules/SettingsMfaModule";
import SettingsReferenceDataModule from "@/components/hris/modules/SettingsReferenceDataModule";
import SettingsRecentActivityPanel from "@/components/hris/modules/SettingsRecentActivityPanel";
import { requireModuleAccess } from "@/lib/server-authorization";
import { normalizeRole } from "@/lib/hris";

export const metadata = {
  title: "Settings | Clio HRIS",
};

export default async function SettingsPage() {
  const session = await requireModuleAccess("settings");
  const role = normalizeRole(session?.role);
  const isSuperAdmin = role === "SUPER_ADMIN";
  const isGrc = role === "GRC";
  const isHr = role === "HR";
  const isEa = role === "EA";
  const isEmployee = role.startsWith("EMPLOYEE");
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

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <SettingsMfaModule />

          {canManageReferenceData ? (
            <SettingsReferenceDataModule />
          ) : (
            <SurfaceCard title="Reference Data" subtitle="Roles and departments are managed by GRC/HR">
              <p className="text-sm text-slate-600">
                You have view-only access for governance catalog values. Contact GRC or HR for updates.
              </p>
            </SurfaceCard>
          )}
        </div>

        <div className="space-y-6">
          <SettingsRecentActivityPanel />

          <SurfaceCard title="Security Notes" subtitle="Operational reminders">
            <div className="space-y-2 text-sm text-slate-700">
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                Enable MFA only after your mobile number is verified during sign-in.
              </p>
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                Changes to reference data affect role and department selections across HR modules.
              </p>
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                Review account activity regularly to detect unexpected login behavior.
              </p>
            </div>
          </SurfaceCard>

          {isEmployee || isEa ? (
            <SurfaceCard title="Account Preferences" subtitle="Personal access scope">
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                You can manage your own MFA preference. Governance-wide security policies remain managed by HR/GRC.
              </p>
            </SurfaceCard>
          ) : null}
        </div>
      </section>
    </div>
  );
}
