import SurfaceCard from "@/components/hris/SurfaceCard";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Access Management | Clio HRIS",
};

const ACCESS_MATRIX_ROWS = [
  { role: "GRC", scope: "All employee records", privileges: "Governance oversight and audit visibility" },
  { role: "HR", scope: "All employee records", privileges: "Operational HR management authority" },
  { role: "EA", scope: "All employee records (authorized)", privileges: "Executive office delegated access" },
  { role: "Employee", scope: "Own record only", privileges: "Limited self-service profile updates" },
];

export default async function AccessManagementPage() {
  await requireModuleAccess("access-management");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Access Management</h1>
        <p className="mt-1 text-sm text-slate-600">
          Role governance, least-privilege controls, ownership checks, and quarterly access review readiness.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        <SurfaceCard title="Privilege Governance" subtitle="Baseline controls">
          <ul className="space-y-2 text-sm text-slate-700">
            <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">No shared accounts permitted</li>
            <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">RBAC enforced on every protected route</li>
            <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">Resource ownership validation enabled</li>
          </ul>
        </SurfaceCard>

        <SurfaceCard title="Review Cadence" subtitle="Periodic access governance">
          <ul className="space-y-2 text-sm text-slate-700">
            <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">Quarterly privilege review</li>
            <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">Segregation-of-duties verification</li>
            <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">Exception approvals with evidence trail</li>
          </ul>
        </SurfaceCard>

        <SurfaceCard title="Control Outcomes" subtitle="Security posture checkpoints">
          <div className="space-y-3 text-sm text-slate-700">
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">Least privilege: Enforced</p>
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2">IDOR prevention: Active</p>
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">Unauthorized module access: Blocked</p>
          </div>
        </SurfaceCard>
      </section>

      <SurfaceCard title="Access Rights Matrix" subtitle="Documented role access boundaries">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Role</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Record Scope</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Privilege Profile</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ACCESS_MATRIX_ROWS.map((row) => (
                <tr key={row.role}>
                  <td className="px-3 py-2 font-medium text-slate-900">{row.role}</td>
                  <td className="px-3 py-2 text-slate-700">{row.scope}</td>
                  <td className="px-3 py-2 text-slate-700">{row.privileges}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SurfaceCard>
    </div>
  );
}
