"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ActivityLogTable from "@/components/hris/ActivityLogTable";
import SurfaceCard from "@/components/hris/SurfaceCard";
import ModuleTabs from "@/components/hris/shared/ModuleTabs";
import PaginationControls from "@/components/hris/shared/PaginationControls";
import { hrisApi } from "@/services/hris-api-client";

const SECTION_TABS = [
  { id: "user_activity_logs", label: "User Activity Logs" },
  { id: "data_change_logs", label: "Data Change Logs" },
  { id: "login_history", label: "Login History" },
  { id: "export_events", label: "Export Events" },
  { id: "document_access_logs", label: "Document Access Logs" },
];

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

export default function ActivityLogModule() {
  const [category, setCategory] = useState("user_activity_logs");
  const [searchText, setSearchText] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [debouncedFrom, setDebouncedFrom] = useState("");
  const [debouncedTo, setDebouncedTo] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const cacheRef = useRef(new Map());

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchText);
      setDebouncedFrom(fromDate);
      setDebouncedTo(toDate);
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [fromDate, searchText, toDate]);

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const cacheKey = JSON.stringify({
        category,
        q: debouncedSearch,
        from: debouncedFrom,
        to: debouncedTo,
        page,
        pageSize: 120,
      });
      const cached = cacheRef.current.get(cacheKey);
      if (cached && Date.now() - cached.at < 60000) {
        setRows(cached.rows);
        setPagination(cached.pagination || null);
        setIsLoading(false);
        return;
      }
      const payload = await hrisApi.activityLogs.list({
        category,
        q: debouncedSearch,
        from: debouncedFrom,
        to: debouncedTo,
        page,
        pageSize: 120,
      });
      const nextRows = Array.isArray(payload.records) ? payload.records : [];
      setRows(nextRows);
      setPagination(payload.pagination || null);
      cacheRef.current.set(cacheKey, {
        rows: nextRows,
        pagination: payload.pagination || null,
        at: Date.now(),
      });
    } catch (error) {
      setErrorMessage(error.message || "Unable to load activity logs.");
    } finally {
      setIsLoading(false);
    }
  }, [category, debouncedFrom, debouncedSearch, debouncedTo, page]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const exportLogs = async () => {
    setIsExporting(true);
    setErrorMessage("");
    try {
      const csv = await hrisApi.activityLogs.exportCsv({
        category,
        q: searchText,
        from: fromDate,
        to: toDate,
      });
      downloadCsv(`clio-activity-logs-${category}.csv`, csv);
    } catch (error) {
      setErrorMessage(error.message || "Unable to export activity logs.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <ModuleTabs
        tabs={SECTION_TABS}
        value={category}
        onChange={(next) => {
          setPage(1);
          setCategory(next);
        }}
      />

      <SurfaceCard
        title="Investigation Workbench"
        subtitle="Advanced filtering, date-range search, and export-ready audit evidence"
        action={
          <div className="flex items-center gap-2">
            <input
              value={searchText}
              onChange={(event) => {
                setPage(1);
                setSearchText(event.target.value);
              }}
              placeholder="Search activity"
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:border-sky-400 focus:outline-none"
            />
            <input
              type="datetime-local"
              value={fromDate}
              onChange={(event) => {
                setPage(1);
                setFromDate(event.target.value);
              }}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:border-sky-400 focus:outline-none"
            />
            <input
              type="datetime-local"
              value={toDate}
              onChange={(event) => {
                setPage(1);
                setToDate(event.target.value);
              }}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:border-sky-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={exportLogs}
              disabled={isExporting}
              className="h-9 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
            >
              {isExporting ? "Exporting..." : "Export Logs"}
            </button>
          </div>
        }
      >
        {errorMessage ? (
          <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{errorMessage}</p>
        ) : null}
        {isLoading ? (
          <p className="text-sm text-slate-600">Loading activity logs...</p>
        ) : (
          <div className="space-y-3">
            <ActivityLogTable rows={rows} />
            <PaginationControls pagination={pagination} onPageChange={setPage} />
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}

