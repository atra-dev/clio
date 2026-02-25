import AttendanceManagementModule from "@/components/hris/modules/AttendanceManagementModule";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Attendance | Clio HRIS",
};

export default async function AttendancePage() {
  const session = await requireModuleAccess("attendance");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Attendance Management</h1>
        <p className="mt-1 text-sm text-slate-600">Time logs and attendance audit traceability.</p>
      </header>

      <AttendanceManagementModule session={session} />
    </div>
  );
}
