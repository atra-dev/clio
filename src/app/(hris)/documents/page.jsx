import Image from "next/image";
import SurfaceCard from "@/components/hris/SurfaceCard";
import { PDF_OUTPUTS, TEMPLATE_REPOSITORY_ROWS } from "@/features/hris/mock-data";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Template Repository | Clio HRIS",
};

export default async function DocumentsPage() {
  const session = await requireModuleAccess("documents");
  const isEmployeeRole = session.role.startsWith("EMPLOYEE_");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Document Template Repository</h1>
        <p className="mt-1 text-sm text-slate-600">
          Standardized contracts, NDAs, acknowledgments, and version-controlled HR templates.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-2">
        <SurfaceCard
          title="Template Library"
          subtitle={isEmployeeRole ? "Employee-assigned templates" : "Version-controlled repository"}
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.12em] text-slate-500">
                  <th className="px-2 py-3 font-medium">Template</th>
                  <th className="px-2 py-3 font-medium">Category</th>
                  <th className="px-2 py-3 font-medium">Version</th>
                  <th className="px-2 py-3 font-medium">Classification</th>
                  <th className="px-2 py-3 font-medium">Last Updated</th>
                  {!isEmployeeRole ? <th className="px-2 py-3 font-medium">Modified By</th> : null}
                </tr>
              </thead>
              <tbody>
                {TEMPLATE_REPOSITORY_ROWS.map((row) => (
                  <tr key={`${row.template}-${row.version}`} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                    <td className="px-2 py-3 font-medium text-slate-900">{row.template}</td>
                    <td className="px-2 py-3">{row.category}</td>
                    <td className="px-2 py-3">{row.version}</td>
                    <td className="px-2 py-3">
                      <span className="rounded-md bg-rose-100 px-2 py-1 text-xs font-medium text-rose-700">
                        {row.classification}
                      </span>
                    </td>
                    <td className="px-2 py-3">{row.updatedAt}</td>
                    {!isEmployeeRole ? <td className="px-2 py-3 text-xs text-slate-600">{row.modifiedBy}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SurfaceCard>

        <SurfaceCard
          title="Controlled PDF Output"
          subtitle="North Star branded, audit-traceable documents"
          action={
            <button className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-700">
              Generate PDF
            </button>
          }
        >
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-4 flex items-center gap-3">
              <Image
                src="/north-star-logo.svg"
                alt="North Star logo"
                width={40}
                height={40}
                className="h-10 w-10"
              />
              <div>
                <p className="text-sm font-semibold text-slate-900">North Star Branding Active</p>
                <p className="text-xs text-slate-500">Automatic logo stamp on all PDF templates</p>
              </div>
            </div>

            <ul className="space-y-2">
              {PDF_OUTPUTS.map((pdf) => (
                <li key={pdf.name} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="text-sm font-medium text-slate-900">{pdf.name}</p>
                  <p className="text-xs text-slate-600">{pdf.audience}</p>
                  <p className="text-xs text-slate-500">{pdf.stamp}</p>
                </li>
              ))}
            </ul>
          </div>
        </SurfaceCard>
      </section>

      <SurfaceCard title="Audit Requirement" subtitle="Uploads and modifications are traceable">
        <p className="text-sm text-slate-700">
          Every template upload, edit, and publication event is logged with actor identity, timestamp, and change
          context for audit defensibility.
        </p>
      </SurfaceCard>
    </div>
  );
}
