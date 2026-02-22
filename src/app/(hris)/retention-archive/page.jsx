import RetentionArchiveModule from "@/components/hris/modules/RetentionArchiveModule";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Retention & Archive | Clio HRIS",
};

export default async function RetentionArchivePage() {
  const session = await requireModuleAccess("retention-archive");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Retention & Archive</h1>
        <p className="mt-1 text-sm text-slate-600">
          Retention policy enforcement, archive governance, and secure deletion readiness for employee records.
        </p>
      </header>
      <RetentionArchiveModule session={session} />
    </div>
  );
}
