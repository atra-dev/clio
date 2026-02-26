import SurfaceCard from "@/components/hris/SurfaceCard";
import {
  CORE_FUNCTIONAL_FEATURES,
  ROLE_DASHBOARD_CONTENT,
  ROLE_PRIVILEGE_MATRIX,
} from "@/features/hris/mock-data";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Dashboard | Clio HRIS",
};

function normalizeRoleForMatrix(role) {
  if (String(role).startsWith("EMPLOYEE_")) {
    return "EMPLOYEE (L1/L2/L3)";
  }
  return role;
}

export default async function DashboardPage() {
  const session = await requireModuleAccess("dashboard");
  const role = session.role;
  const isEmployeeRole = String(role).startsWith("EMPLOYEE_");
  const showRoleCoreVisualization = ["GRC", "HR", "EA"].includes(role);
  const dashboard = ROLE_DASHBOARD_CONTENT[role] ?? ROLE_DASHBOARD_CONTENT.HR;
  const matrixRoleKey = normalizeRoleForMatrix(role);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{dashboard.title}</h1>
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

      {showRoleCoreVisualization ? (
        <SurfaceCard title="Core Functional Features">
          <div className="grid gap-4 lg:grid-cols-2">
            {CORE_FUNCTIONAL_FEATURES.map((feature) => (
              <article key={feature.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Main Tab</p>
                <h3 className="mt-1 text-base font-semibold text-slate-900">{feature.mainTab}</h3>
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Sub Tabs</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {feature.subTabs.map((subTab) => (
                    <span key={subTab} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">
                      {subTab}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </SurfaceCard>
      ) : null}

      {!isEmployeeRole ? (
        <SurfaceCard title="Role Privilege Matrix">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.12em] text-slate-500">
                  <th className="px-2 py-3 font-medium">Role</th>
                  <th className="px-2 py-3 font-medium">Employee Records</th>
                  <th className="px-2 py-3 font-medium">Lifecycle</th>
                  <th className="px-2 py-3 font-medium">Attendance</th>
                  <th className="px-2 py-3 font-medium">Performance</th>
                  <th className="px-2 py-3 font-medium">Templates</th>
                  <th className="px-2 py-3 font-medium">Exports</th>
                  <th className="px-2 py-3 font-medium">Audit</th>
                </tr>
              </thead>
              <tbody>
                {ROLE_PRIVILEGE_MATRIX.map((row) => {
                  const isCurrentRole = row.role === matrixRoleKey;
                  return (
                    <tr
                      key={row.role}
                      className={`border-b border-slate-100 text-slate-700 last:border-b-0 ${isCurrentRole ? "bg-sky-50/60" : ""}`}
                    >
                      <td className="px-2 py-3 font-semibold text-slate-900">{row.role}</td>
                      <td className="px-2 py-3">{row.employeeRecords}</td>
                      <td className="px-2 py-3">{row.lifecycle}</td>
                      <td className="px-2 py-3">{row.attendance}</td>
                      <td className="px-2 py-3">{row.performance}</td>
                      <td className="px-2 py-3">{row.templates}</td>
                      <td className="px-2 py-3">{row.exports}</td>
                      <td className="px-2 py-3">{row.audit}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SurfaceCard>
      ) : null}

      {!isEmployeeRole ? (
        <SurfaceCard
          title={dashboard.table.title}
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
      ) : null}
    </div>
  );
}
