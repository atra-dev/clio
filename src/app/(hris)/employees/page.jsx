import SurfaceCard from "@/components/hris/SurfaceCard";
import { EMPLOYEE_ROWS, SELF_SERVICE_EDITABLE_FIELDS } from "@/features/hris/mock-data";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Employee Records | Clio HRIS",
};

export default async function EmployeesPage() {
  const session = await requireModuleAccess("employees");
  const role = session.role;
  const isEmployeeRole = role.startsWith("EMPLOYEE_");
  const ownRecord =
    EMPLOYEE_ROWS.find((employee) => employee.email === session.email) ??
    ({
      employeeId: "UNASSIGNED",
      name: session.email,
      email: session.email,
      role: "Employee",
      type: "Regular",
      status: "Active",
      employmentStatus: "Active Employee",
      contact: "-",
      govId: "Masked",
      payrollGroup: "-",
    });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Employee Records</h1>
        <p className="mt-1 text-sm text-slate-600">
          Centralized employee master data with restricted PII controls, audit logging, and role-bound access.
        </p>
      </header>

      <SurfaceCard title="Data Classification" subtitle="Restricted PII">
        <p className="text-sm text-slate-700">
          Government IDs, payroll data, and personal contacts are classified as restricted. All views and updates
          are logged with actor, timestamp, and source context.
        </p>
      </SurfaceCard>

      {isEmployeeRole ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <SurfaceCard title="My Employee Record" subtitle="Self-service view only">
            <dl className="grid grid-cols-1 gap-2 text-sm text-slate-700 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <dt className="text-xs uppercase tracking-[0.08em] text-slate-500">Employee ID</dt>
                <dd className="mt-1 font-mono text-slate-900">{ownRecord.employeeId}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <dt className="text-xs uppercase tracking-[0.08em] text-slate-500">Name</dt>
                <dd className="mt-1 font-medium text-slate-900">{ownRecord.name}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <dt className="text-xs uppercase tracking-[0.08em] text-slate-500">Employment Status</dt>
                <dd className="mt-1">{ownRecord.employmentStatus}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <dt className="text-xs uppercase tracking-[0.08em] text-slate-500">Payroll Group</dt>
                <dd className="mt-1">{ownRecord.payrollGroup}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <dt className="text-xs uppercase tracking-[0.08em] text-slate-500">Contact</dt>
                <dd className="mt-1">{ownRecord.contact}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <dt className="text-xs uppercase tracking-[0.08em] text-slate-500">Government ID</dt>
                <dd className="mt-1">{ownRecord.govId}</dd>
              </div>
            </dl>
          </SurfaceCard>

          <SurfaceCard title="Editable Fields" subtitle="Limited personal information updates only">
            <ul className="space-y-2">
              {SELF_SERVICE_EDITABLE_FIELDS.map((field) => (
                <li key={field} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {field}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-slate-500">
              Access to other employee records is blocked by server-side authorization and ownership validation.
            </p>
          </SurfaceCard>
        </section>
      ) : (
        <SurfaceCard
          title="Employee Master List"
          subtitle="Full operational view for authorized GRC, HR, and EA roles"
          action={
            <div className="flex items-center gap-2">
              <input
                type="search"
                placeholder="Search employee"
                className="h-9 w-44 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
              />
              <button className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-700">
                Add Record
              </button>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.12em] text-slate-500">
                  <th className="px-2 py-3 font-medium">Employee ID</th>
                  <th className="px-2 py-3 font-medium">Name</th>
                  <th className="px-2 py-3 font-medium">Role</th>
                  <th className="px-2 py-3 font-medium">Employment Type</th>
                  <th className="px-2 py-3 font-medium">Gov ID</th>
                  <th className="px-2 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {EMPLOYEE_ROWS.map((employee) => (
                  <tr key={employee.employeeId} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                    <td className="px-2 py-3 font-mono text-xs text-slate-700">{employee.employeeId}</td>
                    <td className="px-2 py-3 font-medium text-slate-900">{employee.name}</td>
                    <td className="px-2 py-3">{employee.role}</td>
                    <td className="px-2 py-3">{employee.type}</td>
                    <td className="px-2 py-3 font-mono text-xs text-slate-600">{employee.govId}</td>
                    <td className="px-2 py-3">
                      <span className="rounded-md bg-sky-100 px-2 py-1 text-xs font-medium text-sky-700">
                        {employee.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
