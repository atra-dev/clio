import PerformanceManagementModule from "@/components/hris/modules/PerformanceManagementModule";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Performance | Clio HRIS",
};

export default async function PerformancePage() {
  const session = await requireModuleAccess("performance");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Performance Management</h1>
        <p className="mt-1 text-sm text-slate-600">
          KPI assignment, evaluation workflows, manager/self reviews, rating outcomes, and promotion justifications.
        </p>
      </header>

      <PerformanceManagementModule session={session} />
    </div>
  );
}
