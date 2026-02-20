import SurfaceCard from "@/components/hris/SurfaceCard";
import { EXPORT_CONTROL_ROWS } from "@/features/hris/mock-data";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Export Control | Clio HRIS",
};

export default async function ExportsPage() {
  const session = await requireModuleAccess("exports");
  const role = session.role;
  const isEmployeeRole = role.startsWith("EMPLOYEE_");
  const rows = isEmployeeRole ? EXPORT_CONTROL_ROWS.slice(0, 1) : EXPORT_CONTROL_ROWS;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Export Control</h1>
        <p className="mt-1 text-sm text-slate-600">
          Govern who exports data, what data volume is included, and why the export is justified.
        </p>
      </header>

      <SurfaceCard
        title={isEmployeeRole ? "My Allowed Exports" : "Controlled Exports"}
        subtitle={
          isEmployeeRole
            ? "Employees can export own records only."
            : "GRC, HR, and EA exports are logged with justification and volume."
        }
        action={
          <button
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              isEmployeeRole
                ? "border border-slate-300 text-slate-700 hover:bg-slate-100"
                : "bg-sky-600 text-white hover:bg-sky-700"
            }`}
          >
            {isEmployeeRole ? "Export my record" : "Configure policy"}
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.12em] text-slate-500">
                <th className="px-2 py-3 font-medium">Template</th>
                <th className="px-2 py-3 font-medium">Format</th>
                <th className="px-2 py-3 font-medium">Owner</th>
                <th className="px-2 py-3 font-medium">Last Export</th>
                <th className="px-2 py-3 font-medium">Volume</th>
                <th className="px-2 py-3 font-medium">Justification</th>
                <th className="px-2 py-3 font-medium">Status</th>
                <th className="px-2 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.name} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                  <td className="px-2 py-3 font-medium text-slate-900">{item.name}</td>
                  <td className="px-2 py-3">{item.format}</td>
                  <td className="px-2 py-3">{item.owner}</td>
                  <td className="px-2 py-3">{item.lastExport}</td>
                  <td className="px-2 py-3">{item.volume}</td>
                  <td className="px-2 py-3 text-xs text-slate-600">{item.justification}</td>
                  <td className="px-2 py-3">
                    <span className="rounded-md bg-sky-100 px-2 py-1 text-xs font-medium text-sky-700">
                      {item.status}
                    </span>
                  </td>
                  <td className="px-2 py-3 text-right">
                    <button className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-700">
                      Export now
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SurfaceCard>

      <section className="grid gap-4 lg:grid-cols-2">
        <SurfaceCard title="Printing Controls" subtitle="Restricted hardcopy handling">
          <ul className="space-y-2 text-sm text-slate-700">
            <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">Printing is restricted to authorized roles.</li>
            <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">All print events are logged with user, timestamp, and device context.</li>
            <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              Watermark: username, timestamp, and Confidential - Project CLIO.
            </li>
          </ul>
        </SurfaceCard>

        <SurfaceCard title="DLP Threshold Alerts" subtitle="Mass export detection and governance review">
          <p className="text-sm text-slate-700">
            Exports that exceed policy thresholds trigger alerts and are escalated to GRC for incident triage and
            justification validation.
          </p>
        </SurfaceCard>
      </section>
    </div>
  );
}
