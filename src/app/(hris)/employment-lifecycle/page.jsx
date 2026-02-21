import EmploymentLifecycleModule from "@/components/hris/modules/EmploymentLifecycleModule";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Employment Lifecycle | Clio HRIS",
};

export default async function EmploymentLifecyclePage() {
  const session = await requireModuleAccess("employment-lifecycle");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Employment Lifecycle Management</h1>
        <p className="mt-1 text-sm text-slate-600">
          Onboarding, role movements, disciplinary records, offboarding, and immediate access revocation workflows.
        </p>
      </header>

      <EmploymentLifecycleModule session={session} />
    </div>
  );
}
