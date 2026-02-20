import SurfaceCard from "@/components/hris/SurfaceCard";
import { EMPLOYMENT_LIFECYCLE_ROWS } from "@/features/hris/mock-data";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Employment Lifecycle | Clio HRIS",
};

export default async function EmploymentLifecyclePage() {
  await requireModuleAccess("employment-lifecycle");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Employment Lifecycle Management</h1>
        <p className="mt-1 text-sm text-slate-600">
          Onboarding, role movements, disciplinary records, offboarding, and immediate access revocation workflows.
        </p>
      </header>

      <SurfaceCard title="Lifecycle Cases" subtitle="Traceable lifecycle events across the organization">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.12em] text-slate-500">
                <th className="px-2 py-3 font-medium">Case ID</th>
                <th className="px-2 py-3 font-medium">Employee</th>
                <th className="px-2 py-3 font-medium">Category</th>
                <th className="px-2 py-3 font-medium">Owner</th>
                <th className="px-2 py-3 font-medium">Updated At</th>
                <th className="px-2 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {EMPLOYMENT_LIFECYCLE_ROWS.map((row) => (
                <tr key={row.caseId} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                  <td className="px-2 py-3 font-mono text-xs text-slate-700">{row.caseId}</td>
                  <td className="px-2 py-3 font-medium text-slate-900">{row.employee}</td>
                  <td className="px-2 py-3">{row.category}</td>
                  <td className="px-2 py-3">{row.owner}</td>
                  <td className="px-2 py-3 text-xs text-slate-600">{row.updatedAt}</td>
                  <td className="px-2 py-3">
                    <span className="rounded-md bg-sky-100 px-2 py-1 text-xs font-medium text-sky-700">{row.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SurfaceCard>

      <SurfaceCard title="Offboarding Security Rule" subtitle="Immediate account lock and access revocation">
        <p className="text-sm text-slate-700">
          Once resignation or termination is confirmed, account status changes to revoked state immediately. All
          attempts after revocation are rejected and fully logged for forensic review.
        </p>
      </SurfaceCard>
    </div>
  );
}
