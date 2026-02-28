"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SurfaceCard from "@/components/hris/SurfaceCard";
import EmptyState from "@/components/hris/shared/EmptyState";
import ModuleTabs from "@/components/hris/shared/ModuleTabs";
import { LoadingTransition, TableSkeleton } from "@/components/hris/shared/Skeletons";
import StatusBadge from "@/components/hris/shared/StatusBadge";
import { formatPersonName } from "@/lib/name-utils";
import { hrisApi } from "@/services/hris-api-client";

const REQUEST_TABS = [
  { id: "leave", label: "Leave Request" },
  { id: "attendance", label: "Attendance Adjustment" },
  { id: "document", label: "Document Request" },
];

const initialLeaveForm = {
  leaveType: "Vacation Leave",
  startDate: "",
  endDate: "",
  reason: "",
};

const initialAttendanceForm = {
  date: "",
  checkIn: "",
  checkOut: "",
  reason: "",
};

const initialDocumentForm = {
  dataset: "Own Employee Record",
  format: "PDF",
  justification: "",
};

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

export default function EmployeeRequestsModule({ session }) {
  const actorEmail = session?.email || "";
  const actorDisplayName = useMemo(
    () =>
      formatPersonName({
        firstName: session?.firstName,
        middleName: session?.middleName,
        lastName: session?.lastName,
        fallbackEmail: actorEmail,
        fallbackLabel: "Employee",
      }),
    [actorEmail, session?.firstName, session?.lastName, session?.middleName],
  );

  const [tab, setTab] = useState("leave");
  const [leaveForm, setLeaveForm] = useState(initialLeaveForm);
  const [attendanceForm, setAttendanceForm] = useState(initialAttendanceForm);
  const [documentForm, setDocumentForm] = useState(initialDocumentForm);
  const [leaveRows, setLeaveRows] = useState([]);
  const [exportRows, setExportRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const [leavePayload, exportPayload] = await Promise.all([
        hrisApi.leave.list({ employeeEmail: actorEmail }),
        hrisApi.exports.list({ ownerEmail: actorEmail }),
      ]);
      setLeaveRows(Array.isArray(leavePayload.records) ? leavePayload.records : []);
      setExportRows(Array.isArray(exportPayload.records) ? exportPayload.records : []);
    } catch (error) {
      setErrorMessage(error.message || "Unable to load requests.");
    } finally {
      setIsLoading(false);
    }
  }, [actorEmail]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const requestHistory = useMemo(() => {
    const leaveItems = leaveRows.map((row) => ({
      id: row.id,
      type: "Leave Request",
      submittedAt: row.createdAt,
      targetDate: `${row.startDate || "-"} - ${row.endDate || "-"}`,
      status: row.status || "-",
    }));
    const exportItems = exportRows.map((row) => ({
      id: row.id,
      type: "Document Export Request",
      submittedAt: row.createdAt,
      targetDate: row.dataset || "-",
      status: row.status || "-",
    }));
    return [...leaveItems, ...exportItems].sort(
      (a, b) => new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime(),
    );
  }, [exportRows, leaveRows]);

  const submitLeave = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await hrisApi.leave.create({
        employeeEmail: actorEmail,
        employee: actorDisplayName,
        ...leaveForm,
      });
      setLeaveForm(initialLeaveForm);
      setSuccessMessage("Leave request submitted.");
      await loadRows();
    } catch (error) {
      setErrorMessage(error.message || "Unable to submit leave request.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitAttendanceAdjustment = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await hrisApi.attendance.create({
        employeeEmail: actorEmail,
        employee: actorDisplayName,
        date: attendanceForm.date,
        checkIn: attendanceForm.checkIn,
        checkOut: attendanceForm.checkOut,
        status: "Adjustment Request",
        reason: attendanceForm.reason,
      });
      setAttendanceForm(initialAttendanceForm);
      setSuccessMessage("Attendance adjustment request submitted.");
      await loadRows();
    } catch (error) {
      setErrorMessage(error.message || "Unable to submit attendance adjustment.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitDocumentRequest = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await hrisApi.exports.create({
        dataset: documentForm.dataset,
        format: documentForm.format,
        scope: "self",
        estimateVolume: "1",
        justification: documentForm.justification,
        requestedBy: actorEmail,
      });
      setDocumentForm(initialDocumentForm);
      setSuccessMessage("Document request submitted.");
      await loadRows();
    } catch (error) {
      setErrorMessage(error.message || "Unable to submit document request.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <ModuleTabs tabs={REQUEST_TABS} value={tab} onChange={setTab} />

      {errorMessage ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{errorMessage}</p>
      ) : null}
      {successMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{successMessage}</p>
      ) : null}

      {tab === "leave" ? (
        <SurfaceCard title="Leave Request" subtitle="Submit leave request for manager approval">
          <form className="grid gap-2 md:grid-cols-4" onSubmit={submitLeave}>
            <select
              value={leaveForm.leaveType}
              onChange={(event) => setLeaveForm((current) => ({ ...current, leaveType: event.target.value }))}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            >
              <option>Vacation Leave</option>
              <option>Sick Leave</option>
              <option>Emergency Leave</option>
            </select>
            <input
              type="date"
              required
              value={leaveForm.startDate}
              onChange={(event) => setLeaveForm((current) => ({ ...current, startDate: event.target.value }))}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              type="date"
              required
              value={leaveForm.endDate}
              onChange={(event) => setLeaveForm((current) => ({ ...current, endDate: event.target.value }))}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              required
              value={leaveForm.reason}
              onChange={(event) => setLeaveForm((current) => ({ ...current, reason: event.target.value }))}
              placeholder="Reason"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <div className="md:col-span-4">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
              >
                Submit Leave
              </button>
            </div>
          </form>
        </SurfaceCard>
      ) : null}

      {tab === "attendance" ? (
        <SurfaceCard title="Attendance Adjustment Request" subtitle="Submit correction requests for attendance logs">
          <form className="grid gap-2 md:grid-cols-4" onSubmit={submitAttendanceAdjustment}>
            <input
              type="date"
              required
              value={attendanceForm.date}
              onChange={(event) => setAttendanceForm((current) => ({ ...current, date: event.target.value }))}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              type="time"
              value={attendanceForm.checkIn}
              onChange={(event) => setAttendanceForm((current) => ({ ...current, checkIn: event.target.value }))}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              type="time"
              value={attendanceForm.checkOut}
              onChange={(event) => setAttendanceForm((current) => ({ ...current, checkOut: event.target.value }))}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              required
              value={attendanceForm.reason}
              onChange={(event) => setAttendanceForm((current) => ({ ...current, reason: event.target.value }))}
              placeholder="Reason"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <div className="md:col-span-4">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
              >
                Submit Adjustment
              </button>
            </div>
          </form>
        </SurfaceCard>
      ) : null}

      {tab === "document" ? (
        <SurfaceCard title="Document / Export Request" subtitle="Request copy of your own records and generated documents">
          <form className="grid gap-2 md:grid-cols-3" onSubmit={submitDocumentRequest}>
            <input
              value={documentForm.dataset}
              onChange={(event) => setDocumentForm((current) => ({ ...current, dataset: event.target.value }))}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <select
              value={documentForm.format}
              onChange={(event) => setDocumentForm((current) => ({ ...current, format: event.target.value }))}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            >
              <option>PDF</option>
              <option>CSV</option>
              <option>Sheets</option>
            </select>
            <input
              required
              value={documentForm.justification}
              onChange={(event) => setDocumentForm((current) => ({ ...current, justification: event.target.value }))}
              placeholder="Request justification"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <div className="md:col-span-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
              >
                Submit Document Request
              </button>
            </div>
          </form>
        </SurfaceCard>
      ) : null}

      <SurfaceCard title="My Request History" subtitle="Leave and document/export request tracking">
        <LoadingTransition isLoading={isLoading} skeleton={<TableSkeleton rows={6} columns={5} />}>
          {requestHistory.length === 0 ? (
            <EmptyState title="No requests yet" subtitle="Submitted requests will appear here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                    <th className="px-2 py-3 font-medium">Request ID</th>
                    <th className="px-2 py-3 font-medium">Type</th>
                    <th className="px-2 py-3 font-medium">Submitted</th>
                    <th className="px-2 py-3 font-medium">Target</th>
                    <th className="px-2 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {requestHistory.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                      <td className="px-2 py-3 font-mono text-xs">{row.id}</td>
                      <td className="px-2 py-3 font-medium text-slate-900">{row.type}</td>
                      <td className="px-2 py-3 text-xs text-slate-600">{formatDate(row.submittedAt)}</td>
                      <td className="px-2 py-3">{row.targetDate}</td>
                      <td className="px-2 py-3">
                        <StatusBadge value={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </LoadingTransition>
      </SurfaceCard>
    </div>
  );
}
