import SurfaceCard from "@/components/hris/SurfaceCard";
import { ATTENDANCE_ROWS, EMPLOYEE_ROWS } from "@/features/hris/mock-data";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Attendance | Clio HRIS",
};

function getOwnAttendanceRows(sessionEmail) {
  const account = EMPLOYEE_ROWS.find((item) => item.email === sessionEmail);
  if (!account) {
    return ATTENDANCE_ROWS.slice(0, 1);
  }

  const filtered = ATTENDANCE_ROWS.filter((row) => row.employee === account.name);
  return filtered.length > 0 ? filtered : ATTENDANCE_ROWS.slice(0, 1);
}

export default async function AttendancePage() {
  const session = await requireModuleAccess("attendance");
  const role = session.role;
  const isEmployeeRole = role.startsWith("EMPLOYEE_");
  const rows = isEmployeeRole ? getOwnAttendanceRows(session.email) : ATTENDANCE_ROWS;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Attendance Management</h1>
        <p className="mt-1 text-sm text-slate-600">
          Time records, leave approvals, and modification traceability with complete audit context.
        </p>
      </header>

      <SurfaceCard
        title={isEmployeeRole ? "My Attendance Records" : "Attendance Operations Board"}
        subtitle={isEmployeeRole ? "Own attendance and leave history" : "Cross-team attendance and leave monitoring"}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.12em] text-slate-500">
                <th className="px-2 py-3 font-medium">Employee</th>
                <th className="px-2 py-3 font-medium">Date</th>
                <th className="px-2 py-3 font-medium">Check In</th>
                <th className="px-2 py-3 font-medium">Check Out</th>
                <th className="px-2 py-3 font-medium">Leave</th>
                <th className="px-2 py-3 font-medium">Status</th>
                {!isEmployeeRole ? <th className="px-2 py-3 font-medium">Modified By</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={`${row.employee}-${row.date}-${index}`}
                  className="border-b border-slate-100 text-slate-700 last:border-b-0"
                >
                  <td className="px-2 py-3 font-medium text-slate-900">{row.employee}</td>
                  <td className="px-2 py-3">{row.date}</td>
                  <td className="px-2 py-3">{row.checkIn}</td>
                  <td className="px-2 py-3">{row.checkOut}</td>
                  <td className="px-2 py-3">{row.leaveType}</td>
                  <td className="px-2 py-3">
                    <span className="rounded-md bg-sky-100 px-2 py-1 text-xs font-medium text-sky-700">{row.status}</span>
                  </td>
                  {!isEmployeeRole ? <td className="px-2 py-3 text-xs text-slate-600">{row.modifiedBy}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SurfaceCard>

      <SurfaceCard title="Traceability Rule" subtitle="Every edit is non-repudiable">
        <p className="text-sm text-slate-700">
          Attendance updates include actor identity, timestamp, prior value, and reason code. Unauthorized or
          anomalous edits are flagged to GRC for governance review.
        </p>
      </SurfaceCard>
    </div>
  );
}
