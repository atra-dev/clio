import DocumentTemplateRepositoryModule from "@/components/hris/modules/DocumentTemplateRepositoryModule";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Document Repository | Clio HRIS",
};

export default async function DocumentsPage() {
  const session = await requireModuleAccess("documents");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Document Repository</h1>
        <p className="mt-1 text-sm text-slate-600">
          Templates library, employee document mapping, contract sets, version tracking, and upload audit history.
        </p>
      </header>

      <DocumentTemplateRepositoryModule session={session} />
    </div>
  );
}
