import SurfaceCard from "@/components/hris/SurfaceCard";
import { EMPLOYEE_ROWS, PERFORMANCE_ROWS } from "@/features/hris/mock-data";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Performance | Clio HRIS",
};

function getOwnPerformanceRows(sessionEmail) {
  const account = EMPLOYEE_ROWS.find((item) => item.email === sessionEmail);
  if (!account) {
    return PERFORMANCE_ROWS.slice(0, 1);
  }

  const filtered = PERFORMANCE_ROWS.filter((row) => row.employee === account.name);
  return filtered.length > 0 ? filtered : PERFORMANCE_ROWS.slice(0, 1);
}

export default async function PerformancePage() {
  const session = await requireModuleAccess("performance");
  const role = session.role;
  const isEmployeeRole = role.startsWith("EMPLOYEE_");
  const rows = isEmployeeRole ? getOwnPerformanceRows(session.email) : PERFORMANCE_ROWS;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Performance Management</h1>
        <p className="mt-1 text-sm text-slate-600">
          KPI documentation, evaluation forms, review history, and promotion justification tracking.
        </p>
      </header>

      <SurfaceCard
        title={isEmployeeRole ? "My Performance Records" : "Performance Review Board"}
        subtitle={isEmployeeRole ? "Own KPI and evaluation history" : "Cross-team performance oversight"}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.12em] text-slate-500">
                <th className="px-2 py-3 font-medium">Employee</th>
                <th className="px-2 py-3 font-medium">Period</th>
                <th className="px-2 py-3 font-medium">KPI Score</th>
                <th className="px-2 py-3 font-medium">Rating</th>
                <th className="px-2 py-3 font-medium">Promotion Case</th>
                <th className="px-2 py-3 font-medium">Reviewer</th>
                <th className="px-2 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.employee}-${row.period}`} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                  <td className="px-2 py-3 font-medium text-slate-900">{row.employee}</td>
                  <td className="px-2 py-3">{row.period}</td>
                  <td className="px-2 py-3">{row.kpiScore}</td>
                  <td className="px-2 py-3">{row.rating}</td>
                  <td className="px-2 py-3">{row.promotionCase}</td>
                  <td className="px-2 py-3">{row.reviewer}</td>
                  <td className="px-2 py-3">
                    <span className="rounded-md bg-sky-100 px-2 py-1 text-xs font-medium text-sky-700">{row.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SurfaceCard>

      <SurfaceCard title="Promotion Justification Requirement" subtitle="Evidence-backed decisioning">
        <p className="text-sm text-slate-700">
          Promotion tracks require KPI evidence, manager evaluation, and documented business justification before
          approval routing can be completed.
        </p>
      </SurfaceCard>
    </div>
  );
}
