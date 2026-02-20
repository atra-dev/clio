import SurfaceCard from "@/components/hris/SurfaceCard";
import { ROLE_DASHBOARD_CONTENT } from "@/features/hris/mock-data";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Dashboard | Clio HRIS",
};

export default async function DashboardPage() {
  const session = await requireModuleAccess("dashboard");
  const role = session.role;
  const dashboard = ROLE_DASHBOARD_CONTENT[role] ?? ROLE_DASHBOARD_CONTENT.HR;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{dashboard.title}</h1>
        <p className="mt-1 text-sm text-slate-600">{dashboard.subtitle}</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboard.metrics.map((metric) => (
          <SurfaceCard key={metric.id}>
            <p className="text-sm text-slate-600">{metric.label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{metric.value}</p>
            <p className="mt-3 text-xs font-medium text-sky-700">{metric.trend}</p>
          </SurfaceCard>
        ))}
      </section>

      <SurfaceCard title="Role Priorities" subtitle="Focused actions for this workspace role">
        <ul className="space-y-2">
          {dashboard.priorities.map((item) => (
            <li key={item} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {item}
            </li>
          ))}
        </ul>
      </SurfaceCard>

      <SurfaceCard
        title={dashboard.table.title}
        subtitle={dashboard.table.subtitle}
        action={
          <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100">
            {dashboard.table.actionLabel}
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.12em] text-slate-500">
                {dashboard.table.columns.map((column) => (
                  <th key={column} className="px-2 py-3 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dashboard.table.rows.map((row) => (
                <tr key={`${dashboard.title}-${row[0]}`} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                  {row.map((cell, index) => (
                    <td key={`${row[0]}-${index}`} className="px-2 py-3">
                      {index === row.length - 1 ? (
                        <span className="rounded-md bg-sky-100 px-2 py-1 text-xs font-medium text-sky-700">
                          {cell}
                        </span>
                      ) : (
                        <span className={index === 0 ? "font-medium text-slate-900" : ""}>{cell}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SurfaceCard>
    </div>
  );
}
