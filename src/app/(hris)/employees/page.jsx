import EmployeeRecordsModule from "@/components/hris/modules/EmployeeRecordsModule";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Employee Records | Clio HRIS",
};

export default async function EmployeesPage() {
  const session = await requireModuleAccess("employees");
  const employeeRole = String(session?.role || "").toUpperCase().startsWith("EMPLOYEE_");
  const heading = employeeRole ? "My Employee Record" : "Employee Records";
  const subtitle = employeeRole
    ? "Review and update your personal employee profile and contact information."
    : "Directory, profile, compliance IDs, payroll, and audit history.";

  return (
    <div className="space-y-3">
      <header>
        <h1
          className={
            employeeRole
              ? "text-xl font-semibold tracking-tight text-slate-900"
              : "text-2xl font-semibold tracking-tight text-slate-900"
          }
        >
          {heading}
        </h1>
        <p className={employeeRole ? "mt-0.5 text-xs text-slate-600" : "mt-0.5 text-xs text-slate-600"}>
          {subtitle}
        </p>
      </header>

      <EmployeeRecordsModule session={session} />
    </div>
  );
}
