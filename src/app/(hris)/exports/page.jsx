import ExportControlModule from "@/components/hris/modules/ExportControlModule";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Export Control | Clio HRIS",
};

export default async function ExportsPage() {
  const session = await requireModuleAccess("exports");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Export Control</h1>
        <p className="mt-1 text-sm text-slate-600">
          Export requests, reviewer approvals, history tracking, and mass-export alerting with full audit logging.
        </p>
      </header>

      <ExportControlModule session={session} />
    </div>
  );
}
