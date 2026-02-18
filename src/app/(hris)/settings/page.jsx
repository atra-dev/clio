import SurfaceCard from "@/components/hris/SurfaceCard";

export const metadata = {
  title: "Settings | Clio HRIS",
};

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-600">
          Manage workspace preferences, security controls, and document defaults.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-2">
        <SurfaceCard title="Account Security" subtitle="Protection controls for HRIS access">
          <div className="space-y-4">
            <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <span>Require two-step verification for all admins</span>
              <input type="checkbox" defaultChecked className="h-4 w-4 accent-sky-600" />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <span>Auto sign-out after 30 minutes of inactivity</span>
              <input type="checkbox" defaultChecked className="h-4 w-4 accent-sky-600" />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <span>Restrict login to corporate email domain</span>
              <input type="checkbox" defaultChecked className="h-4 w-4 accent-sky-600" />
            </label>
          </div>
        </SurfaceCard>

        <SurfaceCard title="Documents and Exports" subtitle="Defaults for sheets and PDF generation">
          <div className="space-y-4">
            <label className="space-y-1 text-sm text-slate-700">
              <span className="font-medium">Default export format</span>
              <select className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none">
                <option>Sheets</option>
                <option>CSV</option>
                <option>PDF</option>
              </select>
            </label>
            <label className="space-y-1 text-sm text-slate-700">
              <span className="font-medium">PDF branding</span>
              <select className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none">
                <option>North Star logo (default)</option>
                <option>Header only</option>
                <option>Footer only</option>
              </select>
            </label>
            <button className="inline-flex h-10 items-center justify-center rounded-lg bg-sky-600 px-4 text-sm font-medium text-white transition hover:bg-sky-700">
              Save settings
            </button>
          </div>
        </SurfaceCard>
      </section>
    </div>
  );
}
