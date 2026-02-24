"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SurfaceCard from "@/components/hris/SurfaceCard";
import EmptyState from "@/components/hris/shared/EmptyState";
import ModuleTabs from "@/components/hris/shared/ModuleTabs";
import StatusBadge from "@/components/hris/shared/StatusBadge";
import { hrisApi } from "@/services/hris-api-client";

const SECTION_TABS = [
  { id: "kpi", label: "KPI Management" },
  { id: "evaluation", label: "Evaluation Forms" },
  { id: "reviews", label: "Performance Reviews" },
  { id: "history", label: "Performance History" },
  { id: "promotion", label: "Promotion Justification" },
];

const initialForm = {
  employeeEmail: "",
  employee: "",
  period: "",
  kpiScore: "",
  rating: "",
  reviewer: "",
  status: "Draft",
  selfEvaluation: "",
  managerEvaluation: "",
  promotionJustification: "",
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
  }).format(date);
}

export default function PerformanceManagementModule({ session }) {
  const actorRole = session?.role || "EMPLOYEE_L1";
  const actorEmail = session?.email || "";
  const employeeRole = isEmployeeRole(actorRole);
  const canManage = !employeeRole;

  const [section, setSection] = useState("kpi");
  const [records, setRecords] = useState([]);
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [form, setForm] = useState(initialForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadRecords = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const payload = await hrisApi.performance.list(employeeRole ? { employeeEmail: actorEmail } : {});
      const rows = Array.isArray(payload.records) ? payload.records : [];
      setRecords(rows);
      if (!selectedRecordId && rows[0]?.id) {
        setSelectedRecordId(rows[0].id);
      }
    } catch (error) {
      setErrorMessage(error.message || "Unable to load performance records.");
    } finally {
      setIsLoading(false);
    }
  }, [actorEmail, employeeRole, selectedRecordId]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const selectedRecord = useMemo(
    () => records.find((item) => item.id === selectedRecordId) || null,
    [records, selectedRecordId],
  );

  const handleFormField = (field) => (event) => {
    setForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const createRecord = async (event) => {
    event.preventDefault();
    if (!canManage) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await hrisApi.performance.create({
        employeeEmail: form.employeeEmail,
        employee: form.employee,
        period: form.period,
        kpiScore: form.kpiScore,
        rating: form.rating,
        reviewer: form.reviewer,
        status: form.status,
        evaluationForm: {
          self: form.selfEvaluation,
          manager: form.managerEvaluation,
        },
        promotionJustification: form.promotionJustification,
      });
      setForm(initialForm);
      setSuccessMessage("Performance record created.");
      await loadRecords();
    } catch (error) {
      setErrorMessage(error.message || "Unable to create performance record.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateRecord = async (payload, successText) => {
    if (!selectedRecordId) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await hrisApi.performance.update(selectedRecordId, payload);
      setSuccessMessage(successText);
      await loadRecords();
    } catch (error) {
      setErrorMessage(error.message || "Unable to update performance record.");
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

      {canManage ? (
        <SurfaceCard title="Assign KPI / Create Evaluation" subtitle="Manager-side KPI assignment and formal review setup">
          <form className="grid gap-2 md:grid-cols-3" onSubmit={createRecord}>
            <input
              required
              value={form.employeeEmail}
              onChange={handleFormField("employeeEmail")}
              placeholder="Employee email"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              required
              value={form.employee}
              onChange={handleFormField("employee")}
              placeholder="Employee name"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              value={form.period}
              onChange={handleFormField("period")}
              placeholder="Period (e.g., Q1 2026)"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              value={form.kpiScore}
              onChange={handleFormField("kpiScore")}
              placeholder="KPI score"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              value={form.rating}
              onChange={handleFormField("rating")}
              placeholder="Rating"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              value={form.reviewer}
              onChange={handleFormField("reviewer")}
              placeholder="Reviewer"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              value={form.selfEvaluation}
              onChange={handleFormField("selfEvaluation")}
              placeholder="Self evaluation notes"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              value={form.managerEvaluation}
              onChange={handleFormField("managerEvaluation")}
              placeholder="Manager evaluation notes"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              value={form.promotionJustification}
              onChange={handleFormField("promotionJustification")}
              placeholder="Promotion justification"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <div className="md:col-span-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
              >
                {isSubmitting ? "Saving..." : "Create Performance Record"}
              </button>
            </div>
          </form>
        </SurfaceCard>
      ) : null}

      <SurfaceCard title="Performance Records" subtitle="Ratings, review history, and promotion evidence">
        {isLoading ? (
          <p className="text-sm text-slate-600">Loading performance records...</p>
        ) : records.length === 0 ? (
          <EmptyState title="No performance records yet" subtitle="KPI assignment and reviews will appear here." />
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                    <th className="px-2 py-3 font-medium">Employee</th>
                    <th className="px-2 py-3 font-medium">Period</th>
                    <th className="px-2 py-3 font-medium">KPI</th>
                    <th className="px-2 py-3 font-medium">Rating</th>
                    <th className="px-2 py-3 font-medium">Reviewer</th>
                    <th className="px-2 py-3 font-medium">Status</th>
                    <th className="px-2 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((row) => (
                    <tr
                      key={row.id}
                      className={`border-b border-slate-100 text-slate-700 last:border-b-0 ${
                        row.id === selectedRecordId ? "bg-sky-50/50" : ""
                      }`}
                    >
                      <td className="px-2 py-3">
                        <p className="font-medium text-slate-900">{row.employee || "-"}</p>
                        <p className="text-xs text-slate-500">{row.employeeEmail || "-"}</p>
                      </td>
                      <td className="px-2 py-3">{row.period || "-"}</td>
                      <td className="px-2 py-3">{row.kpiScore || "-"}</td>
                      <td className="px-2 py-3">{row.rating || "-"}</td>
                      <td className="px-2 py-3">{row.reviewer || "-"}</td>
                      <td className="px-2 py-3">
                        <StatusBadge value={row.status || "-"} />
                      </td>
                      <td className="px-2 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedRecordId(row.id)}
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          Select
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedRecord ? (
              <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Evaluation Form</p>
                  <p className="text-xs text-slate-700">
                    <span className="font-semibold">Self:</span> {selectedRecord.evaluationForm?.self || "-"}
                  </p>
                  <p className="text-xs text-slate-700">
                    <span className="font-semibold">Manager:</span> {selectedRecord.evaluationForm?.manager || "-"}
                  </p>
                  <p className="text-xs text-slate-700">
                    <span className="font-semibold">Promotion Justification:</span>{" "}
                    {selectedRecord.promotionJustification || "-"}
                  </p>
                  <p className="text-xs text-slate-500">Updated {formatDate(selectedRecord.updatedAt || selectedRecord.createdAt)}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Actions</p>
                  {!employeeRole ? (
                    <>
                      <button
                        type="button"
                        onClick={() => updateRecord({ status: "Under Review" }, "Record set to Under Review.")}
                        disabled={isSubmitting}
                        className="w-full rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-700 transition hover:bg-sky-100 disabled:opacity-60"
                      >
                        Set Under Review
                      </button>
                      <button
                        type="button"
                        onClick={() => updateRecord({ status: "Approved" }, "Performance record approved.")}
                        disabled={isSubmitting}
                        className="w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                      >
                        Approve
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        updateRecord(
                          {
                            evaluationForm: {
                              ...(selectedRecord.evaluationForm || {}),
                              self: "Employee self-evaluation submitted",
                            },
                          },
                          "Self-evaluation submitted.",
                        )
                      }
                      disabled={isSubmitting}
                      className="w-full rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-700 transition hover:bg-sky-100 disabled:opacity-60"
                    >
                      Submit Self Evaluation
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}

