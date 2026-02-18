import ActivityLogTable from "@/components/hris/ActivityLogTable";
import { listAuditEvents } from "@/lib/audit-log";

export const metadata = {
  title: "Activity Log | Clio HRIS",
};

export default async function ActivityLogPage() {
  const rows = await listAuditEvents({ limit: 600 });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Activity Log</h1>
        <p className="mt-1 text-sm text-slate-600">
          End-to-end audit trail for employee data and document actions.
        </p>
      </header>

      <ActivityLogTable rows={rows} />
    </div>
  );
}
