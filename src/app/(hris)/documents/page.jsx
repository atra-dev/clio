import Image from "next/image";
import SurfaceCard from "@/components/hris/SurfaceCard";
import { PDF_OUTPUTS, SHEET_LIBRARY } from "@/features/hris/mock-data";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Sheets and PDF | Clio HRIS",
};

export default async function DocumentsPage() {
  await requireModuleAccess("documents");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sheets and PDF</h1>
        <p className="mt-1 text-sm text-slate-600">
          Generate reporting sheets and branded PDF outputs.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-2">
        <SurfaceCard title="Sheets Library" subtitle="Template-driven operations">
          <ul className="space-y-3">
            {SHEET_LIBRARY.map((sheet) => (
              <li
                key={sheet.name}
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
              >
                <p className="font-medium text-slate-900">{sheet.name}</p>
                <p className="mt-1 text-xs text-slate-600">{sheet.purpose}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Owner: {sheet.owner} | Updated: {sheet.updated}
                </p>
              </li>
            ))}
          </ul>
        </SurfaceCard>

        <SurfaceCard
          title="PDF Generator"
          subtitle="North Star branded outputs"
          action={
            <button className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-700">
              Create PDF
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
    </div>
  );
}
