import IncidentManagementModule from "@/components/hris/modules/IncidentManagementModule";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Incident Management | Clio HRIS",
};

export default async function IncidentManagementPage() {
  const session = await requireModuleAccess("incident-management");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Incident Management</h1>
        <p className="mt-1 text-sm text-slate-600">
          Breach response controls, 72-hour notification readiness, and forensic investigation workflows.
        </p>
      </header>

      <IncidentManagementModule session={session} />
    </div>
  );
}
