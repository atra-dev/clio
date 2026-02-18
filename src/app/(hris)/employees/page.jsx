import SurfaceCard from "@/components/hris/SurfaceCard";
import { EMPLOYEE_ROWS } from "@/features/hris/mock-data";

export const metadata = {
  title: "Employee Records | Clio HRIS",
};

export default function EmployeesPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Employee Records</h1>
        <p className="mt-1 text-sm text-slate-600">
          Centralized employee profile data for GRC, HR, and EA teams.
        </p>
      </header>

      <SurfaceCard
        title="Employee Master List"
        subtitle="Record maintenance and quick status visibility"
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
    </div>
  );
}
