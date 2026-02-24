import EmployeeRequestsModule from "@/components/hris/modules/EmployeeRequestsModule";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Requests | Clio HRIS",
};

export default async function RequestsPage() {
  const session = await requireModuleAccess("requests");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Requests</h1>
        <p className="mt-1 text-sm text-slate-600">
          Submit and track your own leave, attendance correction, and document requests.
        </p>
      </header>

      <EmployeeRequestsModule session={session} />
    </div>
  );
}
