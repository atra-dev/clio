import Link from "next/link";
import SurfaceCard from "@/components/hris/SurfaceCard";
import {
  CORE_FUNCTIONAL_FEATURES,
  EMPLOYEE_ACCESSIBLE_MODULES,
  EMPLOYEE_PANEL_LINKS,
  EMPLOYEE_RESTRICTED_MODULES,
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

      {showRoleCoreVisualization ? (
        <SurfaceCard
          title="Core Functional Features"
          subtitle="Simple visualization for GRC, HR, and EA role workspaces"
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {CORE_FUNCTIONAL_FEATURES.map((feature) => (
              <article key={feature.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Main Tab</p>
                <h3 className="mt-1 text-base font-semibold text-slate-900">{feature.mainTab}</h3>
                <p className="mt-1 text-xs text-slate-600">{feature.summary}</p>
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

      {isEmployeeRole ? (
        <section className="space-y-4">
          <SurfaceCard title="Dashboard Tabs" subtitle="Employee role (L1/L2/L3) self-service only">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {EMPLOYEE_PANEL_LINKS.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 transition hover:border-sky-200 hover:bg-sky-50/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                    <span className="rounded-md bg-sky-100 px-2 py-1 text-[11px] font-medium text-sky-700">{item.label}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{item.description}</p>
                </Link>
              ))}
            </div>
          </SurfaceCard>

          <section className="grid gap-4 lg:grid-cols-2">
            <SurfaceCard title="Accessible Modules" subtitle="Least-privilege permissions for employee self-service">
              <ul className="space-y-2">
                {EMPLOYEE_ACCESSIBLE_MODULES.map((item) => (
                  <li key={item} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    {`Allowed: ${item}`}
                  </li>
                ))}
              </ul>
            </SurfaceCard>

            <SurfaceCard title="No Access" subtitle="Restricted by RBAC and resource ownership validation">
              <ul className="space-y-2">
                {EMPLOYEE_RESTRICTED_MODULES.map((item) => (
                  <li key={item} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {`Blocked: ${item}`}
                  </li>
                ))}
              </ul>
            </SurfaceCard>
          </section>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
            Access is enforced on the server for every route and API request.
          </div>
        </section>
      ) : null}

      {!isEmployeeRole ? (
        <SurfaceCard title="Role Privilege Matrix" subtitle="Least-privilege access model aligned to CLIO policy">
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
