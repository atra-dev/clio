import SurfaceCard from "@/components/hris/SurfaceCard";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Incident Management | Clio HRIS",
};

const INCIDENT_WORKFLOW = [
  "Immediate alert to GRC",
  "Incident classification and severity tagging",
  "Containment and impact assessment",
  "Executive notification and escalation",
  "72-hour regulatory workflow (when required)",
];

export default async function IncidentManagementPage() {
  await requireModuleAccess("incident-management");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Incident Management</h1>
        <p className="mt-1 text-sm text-slate-600">
          Restricted PII incident readiness, escalation playbooks, and forensic audit support.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        <SurfaceCard title="Response Model" subtitle="Breach and incident handling">
          <ul className="space-y-2 text-sm text-slate-700">
            {INCIDENT_WORKFLOW.map((step) => (
              <li key={step} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                {step}
              </li>
            ))}
          </ul>
        </SurfaceCard>

        <SurfaceCard title="Forensic Logging" subtitle="Evidence quality controls">
          <ul className="space-y-2 text-sm text-slate-700">
            <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">Access activity history retained</li>
            <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">Export events preserved for investigations</li>
            <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">Administrative actions tracked with actor context</li>
          </ul>
        </SurfaceCard>

        <SurfaceCard title="Notification Readiness" subtitle="Regulatory timeline awareness">
          <div className="space-y-3 text-sm text-slate-700">
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">Regulatory response target: 72 hours</p>
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">Affected user communication: policy-driven</p>
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">Post-incident report: mandatory and auditable</p>
          </div>
        </SurfaceCard>
      </section>
    </div>
  );
}
