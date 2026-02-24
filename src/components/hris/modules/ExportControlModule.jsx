"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SurfaceCard from "@/components/hris/SurfaceCard";
import EmptyState from "@/components/hris/shared/EmptyState";
import ModuleTabs from "@/components/hris/shared/ModuleTabs";
import StatusBadge from "@/components/hris/shared/StatusBadge";
import { hrisApi } from "@/services/hris-api-client";

const SECTION_TABS = [
  { id: "requests", label: "Export Requests" },
  { id: "approval", label: "Approval Workflow" },
  { id: "history", label: "Export History" },
  { id: "alerts", label: "Mass Export Alerts" },
];

const initialRequestForm = {
  dataset: "Employee Master Data",
  format: "CSV",
  estimateVolume: "",
  justification: "",
  scope: "full",
};

function isEmployeeRole(role) {
  return String(role || "")
    .trim()
    .toUpperCase()
    .startsWith("EMPLOYEE_");
}

function formatDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function ExportControlModule({ session }) {
  const actorRole = session?.role || "EMPLOYEE_L1";
  const actorEmail = session?.email || "";
  const employeeRole = isEmployeeRole(actorRole);
  const canApprove = !employeeRole;

  const [section, setSection] = useState("requests");
  const [records, setRecords] = useState([]);
  const [requestForm, setRequestForm] = useState(initialRequestForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadRecords = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const payload = await hrisApi.exports.list(employeeRole ? { ownerEmail: actorEmail } : {});
      setRecords(Array.isArray(payload.records) ? payload.records : []);
    } catch (error) {
      setErrorMessage(error.message || "Unable to load export control records.");
    } finally {
      setIsLoading(false);
    }
  }, [actorEmail, employeeRole]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const pendingApprovals = useMemo(
    () => records.filter((record) => String(record.status || "").trim().toLowerCase() === "pending"),
    [records],
  );
  const historyRows = useMemo(
    () =>
      records.filter((record) =>
        ["approved", "rejected", "exported"].includes(String(record.status || "").trim().toLowerCase()),
      ),
    [records],
  );
  const massAlerts = useMemo(
    () => records.filter((record) => String(record.alert || "").trim().toLowerCase() === "mass_export_threshold"),
    [records],
  );

  const handleRequestField = (field) => (event) => {
    setRequestForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const submitExportRequest = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await hrisApi.exports.create({
        ...requestForm,
        requestedBy: actorEmail,
      });
      setRequestForm(initialRequestForm);
      setSuccessMessage("Export request submitted with justification.");
      await loadRecords();
    } catch (error) {
      setErrorMessage(error.message || "Unable to submit export request.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApproval = async (recordId, approved) => {
    if (!recordId || !canApprove) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await hrisApi.exports.approve(recordId, {
        approved,
        note: approved ? "Approved by export control reviewer." : "Rejected by export control reviewer.",
      });
      setSuccessMessage(approved ? "Export request approved." : "Export request rejected.");
      await loadRecords();
    } catch (error) {
      setErrorMessage(error.message || "Unable to process export approval.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const executeExport = async (record) => {
    if (!record?.id) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const csv = await hrisApi.exports.execute(record.id);
      downloadCsv(`clio-export-${record.id}.csv`, csv);
      setSuccessMessage("Export generated and downloaded.");
      await loadRecords();
    } catch (error) {
      setErrorMessage(error.message || "Unable to execute export.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <ModuleTabs tabs={SECTION_TABS} value={section} onChange={setSection} />

      {errorMessage ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{errorMessage}</p>
      ) : null}
      {successMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{successMessage}</p>
      ) : null}

      {section === "requests" ? (
        <SurfaceCard title="Export Request Form" subtitle="Every request requires business justification and is fully audited">
          <form className="grid gap-2 md:grid-cols-4" onSubmit={submitExportRequest}>
            <input
              value={requestForm.dataset}
              onChange={handleRequestField("dataset")}
              placeholder="Dataset"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <select
              value={requestForm.format}
              onChange={handleRequestField("format")}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            >
              <option>CSV</option>
              <option>PDF</option>
              <option>Sheets</option>
            </select>
            <input
              value={requestForm.estimateVolume}
              onChange={handleRequestField("estimateVolume")}
              placeholder="Estimated volume (rows/pages)"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <select
              value={requestForm.scope}
              onChange={handleRequestField("scope")}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            >
              <option value="full">Full dataset</option>
              <option value="department">Department only</option>
              <option value="self">Own data only</option>
            </select>
            <textarea
              required
              value={requestForm.justification}
              onChange={handleRequestField("justification")}
              placeholder="Justification for export"
              className="md:col-span-4 min-h-[84px] rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <div className="md:col-span-4">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
              >
                {isSubmitting ? "Submitting..." : "Submit Export Request"}
              </button>
            </div>
          </form>
        </SurfaceCard>
      ) : null}

      <SurfaceCard
        title={
          section === "approval"
            ? "Approval Workflow"
            : section === "history"
              ? "Export History Tracking"
              : section === "alerts"
                ? "Mass Export Alerts"
                : "Export Requests"
        }
        subtitle="All export events are monitored for governance and DLP compliance"
      >
        {isLoading ? (
          <p className="text-sm text-slate-600">Loading export control data...</p>
        ) : (
          <>
            {section === "approval" ? (
              pendingApprovals.length === 0 ? (
                <EmptyState title="No pending approvals" subtitle="Pending export requests will appear here." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                        <th className="px-2 py-3 font-medium">Dataset</th>
                        <th className="px-2 py-3 font-medium">Requested By</th>
                        <th className="px-2 py-3 font-medium">Format</th>
                        <th className="px-2 py-3 font-medium">Volume</th>
                        <th className="px-2 py-3 font-medium">Justification</th>
                        <th className="px-2 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingApprovals.map((row) => (
                        <tr key={row.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                          <td className="px-2 py-3 font-medium text-slate-900">{row.dataset || "-"}</td>
                          <td className="px-2 py-3">{row.requestedBy || "-"}</td>
                          <td className="px-2 py-3">{row.format || "-"}</td>
                          <td className="px-2 py-3">{row.estimateVolume || "-"}</td>
                          <td className="px-2 py-3 text-xs text-slate-600">{row.justification || "-"}</td>
                          <td className="px-2 py-3 text-right">
                            {canApprove ? (
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleApproval(row.id, true)}
                                  disabled={isSubmitting}
                                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleApproval(row.id, false)}
                                  disabled={isSubmitting}
                                  className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                                >
                                  Reject
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500">Awaiting reviewer</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : section === "history" ? (
              historyRows.length === 0 ? (
                <EmptyState title="No export history yet" subtitle="Approved and executed exports will be tracked here." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                        <th className="px-2 py-3 font-medium">Dataset</th>
                        <th className="px-2 py-3 font-medium">Requested By</th>
                        <th className="px-2 py-3 font-medium">Status</th>
                        <th className="px-2 py-3 font-medium">Reviewed By</th>
                        <th className="px-2 py-3 font-medium">Exported At</th>
                        <th className="px-2 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyRows.map((row) => (
                        <tr key={row.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                          <td className="px-2 py-3 font-medium text-slate-900">{row.dataset || "-"}</td>
                          <td className="px-2 py-3">{row.requestedBy || "-"}</td>
                          <td className="px-2 py-3">
                            <StatusBadge value={row.status || "-"} />
                          </td>
                          <td className="px-2 py-3">{row.reviewer || "-"}</td>
                          <td className="px-2 py-3">{formatDate(row.exportedAt || row.reviewedAt)}</td>
                          <td className="px-2 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => executeExport(row)}
                              disabled={isSubmitting || String(row.status || "").trim().toLowerCase() === "rejected"}
                              className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100 disabled:opacity-60"
                            >
                              Export
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : section === "alerts" ? (
              massAlerts.length === 0 ? (
                <EmptyState title="No mass export alerts" subtitle="Large-volume exports will trigger alerts automatically." />
              ) : (
                <div className="space-y-2">
                  {massAlerts.map((row) => (
                    <div key={row.id} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <p>
                        <span className="font-semibold">{row.dataset || "Dataset"}</span> requested by{" "}
                        <span className="font-medium">{row.requestedBy || "-"}</span>
                      </p>
                      <p className="mt-1">Estimated volume: {row.estimateVolume || "-"}</p>
                      <p className="mt-1">Action: Review justification and validate business need before release.</p>
                    </div>
                  ))}
                </div>
              )
            ) : records.length === 0 ? (
              <EmptyState title="No export requests yet" subtitle="Create an export request to populate this section." />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                      <th className="px-2 py-3 font-medium">Dataset</th>
                      <th className="px-2 py-3 font-medium">Requested By</th>
                      <th className="px-2 py-3 font-medium">Format</th>
                      <th className="px-2 py-3 font-medium">Scope</th>
                      <th className="px-2 py-3 font-medium">Status</th>
                      <th className="px-2 py-3 font-medium">Submitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                        <td className="px-2 py-3 font-medium text-slate-900">{row.dataset || "-"}</td>
                        <td className="px-2 py-3">{row.requestedBy || "-"}</td>
                        <td className="px-2 py-3">{row.format || "-"}</td>
                        <td className="px-2 py-3">{row.scope || "-"}</td>
                        <td className="px-2 py-3">
                          <StatusBadge value={row.status || "-"} />
                        </td>
                        <td className="px-2 py-3">{formatDate(row.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </SurfaceCard>
    </div>
  );
}

