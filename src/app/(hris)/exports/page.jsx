import SurfaceCard from "@/components/hris/SurfaceCard";
import { EXPORT_CONTROL_ROWS } from "@/features/hris/mock-data";

export const metadata = {
  title: "Export Control | Clio HRIS",
};

export default function ExportsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Export Control</h1>
        <p className="mt-1 text-sm text-slate-600">
          Govern who exports data, in what format, and when.
        </p>
      </header>

      <SurfaceCard
        title="Controlled Exports"
        subtitle="Sheets, CSV, and PDF exports for cross-team reporting"
        action={
          <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100">
            Configure policy
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
                <th className="px-2 py-3 font-medium">Status</th>
                <th className="px-2 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {EXPORT_CONTROL_ROWS.map((item) => (
                <tr key={item.name} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                  <td className="px-2 py-3 font-medium text-slate-900">{item.name}</td>
                  <td className="px-2 py-3">{item.format}</td>
                  <td className="px-2 py-3">{item.owner}</td>
                  <td className="px-2 py-3">{item.lastExport}</td>
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
    </div>
  );
}
