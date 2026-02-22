import ActivityLogModule from "@/components/hris/modules/ActivityLogModule";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Audit Logs | Clio HRIS",
};

export default async function ActivityLogPage() {
  await requireModuleAccess("activity-log");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Audit Logs</h1>
        <p className="mt-1 text-sm text-slate-600">
          Investigation-ready logs for user actions, data changes, login history, exports, and document access.
        </p>
      </header>

      <ActivityLogModule />
    </div>
  );
}
