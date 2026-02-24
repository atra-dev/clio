"use client";

import Image from "next/image";
import { useState } from "react";
import { formatNameFromEmail } from "@/lib/name-utils";
import { cn } from "@/lib/utils";

const statusClasses = {
  Completed: "bg-sky-100 text-sky-700",
  Approved: "bg-emerald-100 text-emerald-700",
  Pending: "bg-amber-100 text-amber-700",
  Failed: "bg-rose-100 text-rose-700",
  Rejected: "bg-rose-100 text-rose-700",
};

const statusDotClasses = {
  Completed: "bg-sky-500",
  Approved: "bg-emerald-500",
  Pending: "bg-amber-500",
  Failed: "bg-rose-500",
  Rejected: "bg-rose-500",
};

function getRecordReference(entry) {
  const explicitRef = typeof entry?.recordRef === "string" ? entry.recordRef.trim() : "";
  if (explicitRef) {
    return explicitRef;
  }

  const activityName = typeof entry?.activityName === "string" ? entry.activityName : "";
  if (!activityName) {
    return "N/A";
  }

  const wrappedMatch = activityName.match(/\(([^)]+)\)/);
  if (wrappedMatch?.[1]) {
    return wrappedMatch[1];
  }

  const inlineMatch = activityName.match(/CL-\d+/);
  return inlineMatch?.[0] || "N/A";
}

function formatPerformerName(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return "Unknown User";
  }

  if (!raw.includes("@")) {
    return raw;
  }

  return formatNameFromEmail(raw, { fallbackLabel: "Unknown User", maxTokens: 2 });
}

function getPerformerDisplayName(entry) {
  const fromRecord = typeof entry?.performedByName === "string" ? entry.performedByName.trim() : "";
  if (fromRecord) {
    return fromRecord;
  }
  return formatPerformerName(entry?.performedBy);
}

function getPerformerAvatar(entry) {
  const fromRecord = typeof entry?.performedByAvatar === "string" ? entry.performedByAvatar.trim() : "";
  return fromRecord || "/avatars/default-user.svg";
}

function getPerformerEmail(entry) {
  const fromRecord = typeof entry?.performedByEmail === "string" ? entry.performedByEmail.trim() : "";
  if (fromRecord) {
    return fromRecord;
  }
  if (typeof entry?.performedBy === "string") {
    return entry.performedBy;
  }
  return "-";
}

function toTextList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function toDocumentList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const name = String(item.name || "").trim();
      const type = String(item.type || "").trim();
      const id = String(item.id || "").trim();
      if (!name && !type && !id) {
        return null;
      }
      return {
        name: name || "Employee Document",
        type: type || "General",
        id,
      };
    })
    .filter(Boolean);
}

function ExpandIcon({ expanded }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={cn(
        "h-3.5 w-3.5 text-slate-500 transition-transform duration-300 ease-out",
        expanded ? "rotate-90" : "rotate-0",
      )}
      aria-hidden="true"
    >
      <path d="M7 4.5 13 10l-6 5.5" />
    </svg>
  );
}

export default function ActivityLogTable({ rows }) {
  const [expandedId, setExpandedId] = useState(null);
  const [selectedType, setSelectedType] = useState("All");
  const [selectedSensitivity, setSelectedSensitivity] = useState("All");
  const [fromDateTime, setFromDateTime] = useState("");
  const [toDateTime, setToDateTime] = useState("");

  const toggleRow = (rowId) => {
    setExpandedId((current) => (current === rowId ? null : rowId));
  };

  const typeOptions = ["All", ...new Set(rows.map((item) => item.module))];
  const sensitivityOptions = ["All", "Sensitive", "Non-sensitive"];

  const toTimestamp = (value) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  };

  const filteredRows = rows.filter((entry) => {
    if (selectedType !== "All" && entry.module !== selectedType) {
      return false;
    }

    if (selectedSensitivity !== "All" && entry.sensitivity !== selectedSensitivity) {
      return false;
    }

    const entryTime = toTimestamp(entry.occurredAt || entry.loggedAt);
    const fromTime = toTimestamp(fromDateTime);
    const toTime = toTimestamp(toDateTime);

    if (fromTime && entryTime && entryTime < fromTime) {
      return false;
    }

    if (toTime && entryTime && entryTime > toTime) {
      return false;
    }

    return true;
  });

  const resetFilters = () => {
    setSelectedType("All");
    setSelectedSensitivity("All");
    setFromDateTime("");
    setToDateTime("");
  };

  return (
    <section className="overflow-hidden rounded-xl border border-slate-300 bg-white">
      <div className="border-b border-slate-200 bg-slate-50/80 px-3 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Filter Type
            <select
              value={selectedType}
              onChange={(event) => setSelectedType(event.target.value)}
              className="h-9 min-w-[12rem] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-sky-400 focus:outline-none"
            >
              {typeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Action Class
            <select
              value={selectedSensitivity}
              onChange={(event) => setSelectedSensitivity(event.target.value)}
              className="h-9 min-w-[10rem] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-sky-400 focus:outline-none"
            >
              {sensitivityOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Date & Time (From)
            <input
              type="datetime-local"
              value={fromDateTime}
              onChange={(event) => setFromDateTime(event.target.value)}
              className="h-9 min-w-[14rem] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-sky-400 focus:outline-none"
            />
          </label>

          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Date & Time (To)
            <input
              type="datetime-local"
              value={toDateTime}
              onChange={(event) => setToDateTime(event.target.value)}
              className="h-9 min-w-[14rem] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-sky-400 focus:outline-none"
            />
          </label>

          <button
            type="button"
            onClick={resetFilters}
            className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Reset
          </button>

          <p className="ml-auto text-xs text-slate-500">
            Showing <span className="font-semibold text-slate-700">{filteredRows.length}</span> of{" "}
            <span className="font-semibold text-slate-700">{rows.length}</span> activities
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full text-left text-sm">
          <thead className="bg-slate-100">
            <tr className="border-b border-slate-300 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700">
              <th className="w-[35%] px-3 py-2.5">HRIS Activity</th>
              <th className="w-[10%] px-3 py-2.5">Result</th>
              <th className="w-[10%] px-3 py-2.5">When</th>
              <th className="w-[16%] px-3 py-2.5">Logged At</th>
              <th className="w-[14%] px-3 py-2.5">Module</th>
              <th className="w-[15%] px-3 py-2.5">Performed By</th>
            </tr>
          </thead>

          <tbody>
            {filteredRows.map((entry) => {
              const isFailed = entry.status === "Failed" || entry.status === "Rejected";
              const isExpanded = expandedId === entry.id;
              const changedFields = toTextList(entry.changedFields);
              const viewedFields = toTextList(entry.viewedFields);
              const accessedDocuments = toDocumentList(entry.accessedDocuments);

              return (
                <tr key={entry.id} className="border-b border-slate-200 bg-white text-[13px] text-slate-700">
                  <td colSpan={6} className="p-0">
                    <div className="w-full">
                      <div className="grid grid-cols-[35%_10%_10%_16%_14%_15%]">
                        <div className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => toggleRow(entry.id)}
                            className="inline-flex items-center gap-2"
                            aria-expanded={isExpanded}
                            aria-controls={`activity-details-${entry.id}`}
                          >
                            <ExpandIcon expanded={isExpanded} />
                            <span
                              className={cn(
                                "inline-flex h-3 w-3 rounded-full",
                                statusDotClasses[entry.status] || (isFailed ? "bg-rose-500" : "bg-sky-500"),
                              )}
                              aria-hidden="true"
                            />
                            <span className="font-medium text-slate-800">{entry.activityName}</span>
                          </button>
                        </div>

                        <div className="px-3 py-2.5">
                          <span
                            className={cn(
                              "inline-flex rounded-md px-2 py-1 text-xs font-semibold",
                              statusClasses[entry.status] || (isFailed ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"),
                            )}
                          >
                            {entry.status}
                          </span>
                        </div>

                        <div className="px-3 py-2.5 text-slate-600">{entry.relativeTime}</div>
                        <div className="px-3 py-2.5 text-slate-600">{entry.loggedAt}</div>
                        <div className="px-3 py-2.5">
                          <span className="text-sky-700 hover:underline">{entry.module}</span>
                        </div>
                        <div className="px-3 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Image
                              src={getPerformerAvatar(entry)}
                              alt={`${getPerformerDisplayName(entry)} profile picture`}
                              width={32}
                              height={32}
                              className="h-8 w-8 rounded-full border border-slate-300 bg-white"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold text-slate-800">
                                {getPerformerDisplayName(entry)}
                              </p>
                              <p className="truncate text-xs text-slate-500">{getPerformerEmail(entry)}</p>
                            </div>
                          </div>
                        </div>
                      </div>

                        <div
                          id={`activity-details-${entry.id}`}
                          className={cn(
                            "overflow-hidden transition-all duration-300 ease-out",
                            isExpanded ? "max-h-[56rem] opacity-100" : "max-h-0 opacity-0",
                          )}
                        >
                        <div className="border-t border-slate-200 bg-slate-50/80 px-3 py-3">
                          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Activity ID</p>
                              <p className="mt-1 text-xs font-semibold text-slate-800">{entry.id}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Record Ref</p>
                              <p className="mt-1 text-xs font-semibold text-slate-800">{getRecordReference(entry)}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Audit Note</p>
                              <p className="mt-1 text-xs text-slate-700">{entry.auditNote || "No audit note."}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Next Action</p>
                              <p className="mt-1 text-xs text-slate-700">{entry.nextAction || "No further action required."}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Action Class</p>
                              <p className="mt-1 text-xs font-semibold text-slate-800">{entry.sensitivity || "Non-sensitive"}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Request Path</p>
                              <p className="mt-1 text-xs text-slate-700">{entry.requestPath || "N/A"}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Request Method</p>
                              <p className="mt-1 text-xs text-slate-700">{entry.requestMethod || "N/A"}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Source IP</p>
                              <p className="mt-1 text-xs text-slate-700">{entry.sourceIp || "N/A"}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Browser</p>
                              <p className="mt-1 text-xs text-slate-700">{entry.browser || "Unknown Browser"}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Operating System</p>
                              <p className="mt-1 text-xs text-slate-700">{entry.operatingSystem || "Unknown OS"}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Device</p>
                              <p className="mt-1 text-xs text-slate-700">{entry.deviceSummary || "Unknown device"}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Changed Fields</p>
                              {changedFields.length > 0 ? (
                                <p className="mt-1 text-xs text-slate-700">{changedFields.join(", ")}</p>
                              ) : (
                                <p className="mt-1 text-xs text-slate-400">No field updates recorded.</p>
                              )}
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Viewed Fields</p>
                              {viewedFields.length > 0 ? (
                                <p className="mt-1 text-xs text-slate-700">{viewedFields.join(", ")}</p>
                              ) : (
                                <p className="mt-1 text-xs text-slate-400">No field view details.</p>
                              )}
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 sm:col-span-2 xl:col-span-2">
                              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Document Access</p>
                              {accessedDocuments.length > 0 ? (
                                <div className="mt-1 space-y-1">
                                  {accessedDocuments.slice(0, 6).map((document, index) => (
                                    <p key={`${document.id || document.name}-${index}`} className="text-xs text-slate-700">
                                      {document.name}
                                      <span className="text-slate-500"> ({document.type})</span>
                                      {document.id ? <span className="text-slate-400"> #{document.id}</span> : null}
                                    </p>
                                  ))}
                                </div>
                              ) : (
                                <p className="mt-1 text-xs text-slate-400">No document access details.</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}

            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">
                  No activity logs match the selected filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

