"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SurfaceCard from "@/components/hris/SurfaceCard";
import EmptyState from "@/components/hris/shared/EmptyState";
import ModuleTabs from "@/components/hris/shared/ModuleTabs";
import StatusBadge from "@/components/hris/shared/StatusBadge";
import { hrisApi } from "@/services/hris-api-client";

const SECTION_TABS = [
  { id: "overview", label: "Retention Overview" },
  { id: "records", label: "Archived Records" },
  { id: "purge", label: "Purge Console" },
];

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All States" },
  { value: "due", label: "Due Now" },
  { value: "due_soon", label: "Due Soon" },
  { value: "scheduled", label: "Scheduled" },
  { value: "no_retention", label: "Missing Retention Date" },
];

const DELETION_STATE_LABEL = {
  due: "Due",
  due_soon: "Due Soon",
  scheduled: "Scheduled",
  no_retention: "No Retention Date",
};

const PURGE_CONFIRMATION_PHRASE = "PURGE ARCHIVED DATA";

const initialSummary = {
  generatedAt: "",
  totalArchived: 0,
  dueNow: 0,
  dueWithinWindow: 0,
  scheduledFuture: 0,
  missingRetentionDate: 0,
  nextDeletionAt: null,
  oldestArchivedAt: null,
  dueWithinDays: 30,
  moduleBreakdown: [],
};

const initialPolicy = {
  retentionYears: 5,
  dueWithinDays: 30,
  generatedAt: "",
  moduleCatalog: [],
};

const initialFilters = {
  q: "",
  module: "all",
  status: "all",
  dueWithinDays: 30,
  page: 1,
  pageSize: 20,
};

function formatDateTime(value) {
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

function toLocalDateTimeInput(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toIsoFromLocalDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString();
}

function formatCountdown(daysToDeletion) {
  if (!Number.isFinite(daysToDeletion)) {
    return "-";
  }
  if (daysToDeletion < 0) {
    return `${Math.abs(daysToDeletion)} day(s) overdue`;
  }
  if (daysToDeletion === 0) {
    return "Due today";
  }
  return `${daysToDeletion} day(s) left`;
}

function asNumber(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

export default function RetentionArchiveModule({ session }) {
  const actorRole = String(session?.role || "").trim().toUpperCase();
  const canManagePurge = actorRole === "SUPER_ADMIN" || actorRole === "GRC";

  const [section, setSection] = useState("overview");
  const [filters, setFilters] = useState(initialFilters);
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState(initialSummary);
  const [policy, setPolicy] = useState(initialPolicy);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isPurging, setIsPurging] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [purgeResult, setPurgeResult] = useState(null);
  const [purgeForm, setPurgeForm] = useState({
    cutoff: toLocalDateTimeInput(new Date().toISOString()),
    confirmation: "",
  });

  const loadRetentionSnapshot = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const payload = await hrisApi.retention.list({
        q: filters.q,
        module: filters.module,
        status: filters.status,
        dueWithinDays: filters.dueWithinDays,
        page: filters.page,
        pageSize: filters.pageSize,
      });

      setRecords(Array.isArray(payload.records) ? payload.records : []);
      setSummary(payload.summary && typeof payload.summary === "object" ? payload.summary : initialSummary);
      setPolicy(payload.policy && typeof payload.policy === "object" ? payload.policy : initialPolicy);
      setPagination(
        payload.pagination && typeof payload.pagination === "object"
          ? payload.pagination
          : {
              page: 1,
              pageSize: filters.pageSize,
              total: 0,
              totalPages: 1,
            },
      );
    } catch (error) {
      setRecords([]);
      setSummary(initialSummary);
      setPolicy(initialPolicy);
      setPagination({
        page: 1,
        pageSize: filters.pageSize,
        total: 0,
        totalPages: 1,
      });
      setErrorMessage(error.message || "Unable to load retention archive data.");
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadRetentionSnapshot();
  }, [loadRetentionSnapshot]);

  const moduleFilterOptions = useMemo(() => {
    const catalog = Array.isArray(policy.moduleCatalog) ? policy.moduleCatalog : [];
    return [
      { id: "all", label: "All Modules" },
      ...catalog.map((item) => ({
        id: String(item.id || ""),
        label: String(item.label || item.id || "Module"),
      })),
    ];
  }, [policy.moduleCatalog]);

  const nextDueCount = Math.max(0, Number(summary.dueWithinWindow || 0) - Number(summary.dueNow || 0));
  const pageStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const pageEnd = Math.min(pagination.total, pagination.page * pagination.pageSize);

  const setFilter = (field, value) => {
    setFilters((current) => ({
      ...current,
      [field]: value,
      page: 1,
    }));
  };

  const changePage = (delta) => {
    setFilters((current) => {
      const nextPage = Math.max(1, Math.min(current.page + delta, Math.max(1, pagination.totalPages)));
      return {
        ...current,
        page: nextPage,
      };
    });
  };

  const handlePurgeSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    if (!canManagePurge) {
      setErrorMessage("You do not have permission to run retention purge.");
      return;
    }

    if (String(purgeForm.confirmation || "").trim().toUpperCase() !== PURGE_CONFIRMATION_PHRASE) {
      setErrorMessage(`Type "${PURGE_CONFIRMATION_PHRASE}" to confirm purge.`);
      return;
    }

    setIsPurging(true);
    try {
      const payload = await hrisApi.retention.purge({
        cutoff: toIsoFromLocalDateTime(purgeForm.cutoff),
        confirmation: purgeForm.confirmation,
      });
      setPurgeResult(payload?.result || null);
      setSuccessMessage("Retention purge completed.");
      setPurgeForm((current) => ({
        ...current,
        confirmation: "",
      }));
      await loadRetentionSnapshot();
    } catch (error) {
      setErrorMessage(error.message || "Unable to run retention purge.");
    } finally {
      setIsPurging(false);
    }
  };

  return (
    <div className="space-y-4">
      <ModuleTabs tabs={SECTION_TABS} value={section} onChange={setSection} />

      {errorMessage ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{errorMessage}</p>
      ) : null}
      {successMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {successMessage}
        </p>
      ) : null}

      {section === "overview" ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SurfaceCard title="Total Archived" subtitle="Records currently under retention policy">
              <p className="text-2xl font-semibold text-slate-900">{summary.totalArchived}</p>
            </SurfaceCard>
            <SurfaceCard title="Due Now" subtitle="Records eligible for immediate secure deletion">
              <p className="text-2xl font-semibold text-rose-700">{summary.dueNow}</p>
            </SurfaceCard>
            <SurfaceCard title={`Due in ${summary.dueWithinDays || policy.dueWithinDays} Days`} subtitle="Upcoming retention deadlines">
              <p className="text-2xl font-semibold text-amber-700">{nextDueCount}</p>
            </SurfaceCard>
            <SurfaceCard title="Missing Retention Date" subtitle="Archived records needing retention schedule">
              <p className="text-2xl font-semibold text-slate-900">{summary.missingRetentionDate}</p>
            </SurfaceCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <SurfaceCard title="Policy Window" subtitle="Retention policy currently enforced">
              <dl className="space-y-2 text-sm text-slate-700">
                <div className="flex items-center justify-between gap-3">
                  <dt>Retention Period</dt>
                  <dd className="font-semibold text-slate-900">{policy.retentionYears} years</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt>Next Deletion Window</dt>
                  <dd className="font-semibold text-slate-900">{formatDateTime(summary.nextDeletionAt)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt>Oldest Archived Record</dt>
                  <dd className="font-semibold text-slate-900">{formatDateTime(summary.oldestArchivedAt)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt>Snapshot Generated</dt>
                  <dd className="font-semibold text-slate-900">{formatDateTime(summary.generatedAt)}</dd>
                </div>
              </dl>
            </SurfaceCard>

            <SurfaceCard title="Lifecycle Stage" subtitle="Retention and deletion governance flow">
              <ul className="space-y-2 text-sm text-slate-700">
                <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  Active employment records remain editable by authorized roles.
                </li>
                <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  Separated records shift to archive-only with restricted access.
                </li>
                <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  Post-retention records are securely purged with deletion evidence.
                </li>
              </ul>
            </SurfaceCard>

            <SurfaceCard title="Archive Controls" subtitle="Security and audit safeguards">
              <ul className="space-y-2 text-sm text-slate-700">
                <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  Archived datasets are read-only and traceable.
                </li>
                <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  Purge execution requires explicit confirmation phrase.
                </li>
                <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  Every purge result is recorded in audit logs.
                </li>
              </ul>
            </SurfaceCard>
          </div>

          <SurfaceCard title="Module Breakdown" subtitle="Archived records by module">
            {Array.isArray(summary.moduleBreakdown) && summary.moduleBreakdown.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                      <th className="px-2 py-3 font-medium">Module</th>
                      <th className="px-2 py-3 font-medium">Archived Records</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.moduleBreakdown.map((item) => (
                      <tr key={`retention-breakdown-${item.id}`} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-2 py-3 text-slate-800">{item.label}</td>
                        <td className="px-2 py-3 font-semibold text-slate-900">{item.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No archived records yet" subtitle="Archive counts will appear once retention records exist." />
            )}
          </SurfaceCard>
        </div>
      ) : null}

      {section === "records" ? (
        <SurfaceCard title="Archived Records" subtitle="Filter archive inventory and retention deletion state">
          <div className="grid gap-2 md:grid-cols-5">
            <input
              value={filters.q}
              onChange={(event) => setFilter("q", event.target.value)}
              placeholder="Search record, email, reason"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none md:col-span-2"
            />
            <select
              value={filters.module}
              onChange={(event) => setFilter("module", event.target.value)}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            >
              {moduleFilterOptions.map((option) => (
                <option key={`retention-module-${option.id}`} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={filters.status}
              onChange={(event) => setFilter("status", event.target.value)}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={`retention-status-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={365}
              value={filters.dueWithinDays}
              onChange={(event) => setFilter("dueWithinDays", asNumber(event.target.value, 30))}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
              aria-label="Due within days"
            />
          </div>

          <div className="mt-4">
            {isLoading ? (
              <p className="text-sm text-slate-600">Loading retention archive records...</p>
            ) : records.length === 0 ? (
              <EmptyState title="No archived records found" subtitle="Adjust filters or archive records from lifecycle/offboarding flows." />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                      <th className="px-2 py-3 font-medium">Module</th>
                      <th className="px-2 py-3 font-medium">Record</th>
                      <th className="px-2 py-3 font-medium">Archived At</th>
                      <th className="px-2 py-3 font-medium">Retention Delete At</th>
                      <th className="px-2 py-3 font-medium">Deletion State</th>
                      <th className="px-2 py-3 font-medium">Countdown</th>
                      <th className="px-2 py-3 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                        <td className="px-2 py-3 text-slate-900">{row.moduleLabel}</td>
                        <td className="px-2 py-3">
                          <p className="font-medium text-slate-900">{row.title || row.recordId || "-"}</p>
                          <p className="text-xs text-slate-500">{row.subtitle || row.ownerEmail || "-"}</p>
                        </td>
                        <td className="px-2 py-3 text-xs text-slate-600">{formatDateTime(row.archivedAt)}</td>
                        <td className="px-2 py-3 text-xs text-slate-600">{formatDateTime(row.retentionDeleteAt)}</td>
                        <td className="px-2 py-3">
                          <StatusBadge value={DELETION_STATE_LABEL[row.deletionState] || row.deletionState || "Unknown"} />
                        </td>
                        <td className="px-2 py-3 text-xs text-slate-600">{formatCountdown(row.daysToDeletion)}</td>
                        <td className="px-2 py-3 text-xs text-slate-600">{row.archiveReason || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <p>
              Showing {pageStart}-{pageEnd} of {pagination.total} records
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => changePage(-1)}
                disabled={pagination.page <= 1 || isLoading}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
              >
                Previous
              </button>
              <span className="text-slate-700">
                Page {pagination.page} of {Math.max(1, pagination.totalPages)}
              </span>
              <button
                type="button"
                onClick={() => changePage(1)}
                disabled={pagination.page >= pagination.totalPages || isLoading}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
              >
                Next
              </button>
            </div>
          </div>
        </SurfaceCard>
      ) : null}

      {section === "purge" ? (
        <div className="space-y-4">
          <SurfaceCard title="Purge Readiness" subtitle="Deletion scope based on current retention state">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Due Now</p>
                <p className="mt-1 text-lg font-semibold text-rose-700">{summary.dueNow}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Due Window</p>
                <p className="mt-1 text-lg font-semibold text-amber-700">{summary.dueWithinWindow}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Scheduled Future</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{summary.scheduledFuture}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Missing Retention Date</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{summary.missingRetentionDate}</p>
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard title="Run Retention Purge" subtitle="Purge removes records with retentionDeleteAt less than or equal to cutoff">
            <form className="grid gap-3 md:grid-cols-3" onSubmit={handlePurgeSubmit}>
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-[0.08em] text-slate-600">Cutoff Date & Time</span>
                <input
                  type="datetime-local"
                  value={purgeForm.cutoff}
                  onChange={(event) =>
                    setPurgeForm((current) => ({
                      ...current,
                      cutoff: event.target.value,
                    }))
                  }
                  className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                />
              </label>
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-medium uppercase tracking-[0.08em] text-slate-600">Confirmation Phrase</span>
                <input
                  value={purgeForm.confirmation}
                  onChange={(event) =>
                    setPurgeForm((current) => ({
                      ...current,
                      confirmation: event.target.value,
                    }))
                  }
                  placeholder={PURGE_CONFIRMATION_PHRASE}
                  className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
                />
              </label>

              <div className="md:col-span-3 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-600">
                  Required phrase: <span className="font-semibold text-slate-900">{PURGE_CONFIRMATION_PHRASE}</span>
                </p>
                <button
                  type="submit"
                  disabled={isPurging || !canManagePurge}
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-rose-600 px-4 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPurging ? "Purging..." : "Run Purge"}
                </button>
              </div>
            </form>
            {!canManagePurge ? (
              <p className="mt-3 text-xs text-amber-700">
                Current role does not have retention purge permission.
              </p>
            ) : null}
          </SurfaceCard>

          <SurfaceCard title="Latest Purge Result" subtitle="Most recent deletion outcome from this console">
            {!purgeResult ? (
              <EmptyState title="No purge executed yet" subtitle="Run retention purge to view deletion metrics." />
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-600">Cutoff: {formatDateTime(purgeResult.cutoff)}</p>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                        <th className="px-2 py-3 font-medium">Collection</th>
                        <th className="px-2 py-3 font-medium">Deleted Records</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(purgeResult.deletedByCollection || {}).map(([collectionKey, count]) => (
                        <tr key={`purge-result-${collectionKey}`} className="border-b border-slate-100 last:border-b-0">
                          <td className="px-2 py-3 text-slate-800">{collectionKey}</td>
                          <td className="px-2 py-3 font-semibold text-slate-900">{count}</td>
                        </tr>
                      ))}
                      <tr className="border-b border-slate-100 last:border-b-0">
                        <td className="px-2 py-3 text-slate-800">user_accounts</td>
                        <td className="px-2 py-3 font-semibold text-slate-900">
                          {purgeResult?.deletedUsers?.deletedUsers || 0}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-2 py-3 text-slate-800">user_invites</td>
                        <td className="px-2 py-3 font-semibold text-slate-900">
                          {purgeResult?.deletedUsers?.deletedInvites || 0}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </SurfaceCard>
        </div>
      ) : null}
    </div>
  );
}
