"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SurfaceCard from "@/components/hris/SurfaceCard";
import EmptyState from "@/components/hris/shared/EmptyState";
import ModuleTabs from "@/components/hris/shared/ModuleTabs";
import StatusBadge from "@/components/hris/shared/StatusBadge";
import { useToast } from "@/components/ui/ToastProvider";
import { toSubTabAnchor } from "@/lib/subtab-anchor";
import { hrisApi } from "@/services/hris-api-client";
import {
  removeStorageObjectByPath,
  uploadIncidentEvidenceToStorage,
} from "@/services/firebase-storage-client";

const SECTION_TABS = [
  { id: "escalation-plan", label: "Escalation Plan" },
  { id: "regulatory-72-hour-notification", label: "72-Hour Notification" },
  { id: "forensic-logging", label: "Forensic Logging" },
];

const SEVERITY_OPTIONS = ["Low", "Medium", "High", "Critical"];
const STATUS_OPTIONS = ["Open", "Containment", "Investigating", "Escalated", "Regulatory Review", "Resolved", "Closed"];
const CONTAINMENT_OPTIONS = ["Not Started", "In Progress", "Contained"];
const IMPACT_OPTIONS = ["Pending", "In Progress", "Completed"];
const INCIDENT_TYPE_OPTIONS = [
  "Unauthorized Access",
  "Data Exposure",
  "Credential Compromise",
  "Insider Misuse",
  "Malware / Ransomware",
  "Policy Violation",
  "System Misconfiguration",
  "Other",
];
const REGULATORY_STATUS_OPTIONS = ["Not Required", "Pending", "Notified", "Overdue"];

const initialFilters = {
  q: "",
  status: "all",
  severity: "all",
  incidentType: "all",
  regulatoryStatus: "all",
  restrictedPii: "all",
  breachConfirmed: "all",
  page: 1,
  pageSize: 12,
};

const initialCreateForm = {
  title: "",
  summary: "",
  incidentType: "Unauthorized Access",
  severity: "Medium",
  detectedAt: "",
  ownerEmail: "",
  affectedEmployeeEmail: "",
  restrictedPiiInvolved: false,
  executiveNotificationRequired: false,
  regulatoryNotificationRequired: false,
  documentationLocation: "",
  notes: "",
  classificationStandard: "CLIO-IR-SEVERITY-V1",
};

function formatDateTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "-";
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
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toIsoFromLocalDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

function getRecordLabel(record) {
  return String(record?.title || "").trim() || String(record?.incidentCode || "").trim() || "Incident";
}

function mapDraft(record) {
  return {
    title: String(record?.title || ""),
    summary: String(record?.summary || ""),
    incidentType: String(record?.incidentType || "Other"),
    severity: String(record?.severity || "Medium"),
    status: String(record?.status || "Open"),
    containmentStatus: String(record?.containmentStatus || "Not Started"),
    containmentSummary: String(record?.containmentSummary || ""),
    impactAssessmentStatus: String(record?.impactAssessmentStatus || "Pending"),
    impactSummary: String(record?.impactSummary || ""),
    ownerEmail: String(record?.ownerEmail || ""),
    affectedEmployeeEmail: String(record?.affectedEmployeeEmail || ""),
    restrictedPiiInvolved: Boolean(record?.restrictedPiiInvolved),
    executiveNotificationRequired: Boolean(record?.executiveNotificationRequired),
    regulatoryNotificationRequired: Boolean(record?.regulatoryNotificationRequired),
    documentationRetained: Boolean(record?.documentationRetained),
    documentationLocation: String(record?.documentationLocation || ""),
    notes: String(record?.notes || ""),
    classificationStandard: String(record?.classificationStandard || "CLIO-IR-SEVERITY-V1"),
    forensicWindowStart: toLocalDateTimeInput(record?.forensicWindowStart),
    forensicWindowEnd: toLocalDateTimeInput(record?.forensicWindowEnd),
    breachConfirmed: Boolean(record?.breachConfirmed),
    breachConfirmedAt: String(record?.breachConfirmedAt || ""),
    breachConfirmedBy: String(record?.breachConfirmedBy || ""),
  };
}

function requestActionConfirmation(message) {
  if (typeof window === "undefined") return true;
  return window.confirm(message);
}

export default function IncidentManagementModule({ session }) {
  const toast = useToast();
  const actorRole = String(session?.role || "").trim().toUpperCase();
  const canEdit = actorRole === "GRC" || actorRole === "SUPER_ADMIN";

  const [section, setSection] = useState("escalation-plan");
  const [filters, setFilters] = useState(initialFilters);
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState({
    total: 0,
    openCases: 0,
    criticalOpen: 0,
    containmentPending: 0,
    dueWithin72Hours: 0,
    overdue72HourNotifications: 0,
  });
  const [pagination, setPagination] = useState({ page: 1, pageSize: 12, total: 0, totalPages: 1 });
  const [isLoading, setIsLoading] = useState(true);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    ...initialCreateForm,
    ownerEmail: String(session?.email || "").trim().toLowerCase(),
  });

  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [recordDraft, setRecordDraft] = useState(null);
  const [isLoadingRecord, setIsLoadingRecord] = useState(false);
  const [isSavingRecord, setIsSavingRecord] = useState(false);
  const [isUploadingEvidence, setIsUploadingEvidence] = useState(false);
  const evidenceInputRef = useRef(null);

  const loadRecords = useCallback(async () => {
    setIsLoading(true);
    try {
      const payload = await hrisApi.incidents.list(filters);
      const rows = Array.isArray(payload?.records) ? payload.records : [];
      rows.sort(
        (a, b) =>
          new Date(b?.updatedAt || b?.createdAt || 0).getTime() -
          new Date(a?.updatedAt || a?.createdAt || 0).getTime(),
      );
      setRecords(rows);
      setSummary(payload?.summary || {});
      setPagination(payload?.pagination || { page: 1, pageSize: 12, total: 0, totalPages: 1 });
    } catch (error) {
      setRecords([]);
      toast.error(error.message || "Unable to load incident records.");
    } finally {
      setIsLoading(false);
    }
  }, [filters, toast]);

  const loadSelectedRecord = useCallback(
    async (recordId) => {
      const id = String(recordId || "").trim();
      if (!id) return;
      setIsLoadingRecord(true);
      try {
        const payload = await hrisApi.incidents.get(id);
        const record = payload?.record || null;
        setSelectedRecord(record);
        setRecordDraft(record ? mapDraft(record) : null);
      } catch (error) {
        toast.error(error.message || "Unable to load incident details.");
      } finally {
        setIsLoadingRecord(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (selectedRecordId) {
      loadSelectedRecord(selectedRecordId);
    }
  }, [selectedRecordId, loadSelectedRecord]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncFromHash = (rawHash = window.location.hash) => {
      const hash = String(rawHash || "").replace(/^#/, "").trim().toLowerCase();
      if (!hash) return;
      const matched = SECTION_TABS.find((tab) => toSubTabAnchor(tab.id) === hash);
      if (matched) setSection(matched.id);
    };
    const onAnchor = (event) => {
      if (event?.detail?.moduleId && event.detail.moduleId !== "incident-management") return;
      const nextAnchor = event?.detail?.anchor;
      if (nextAnchor) syncFromHash(`#${nextAnchor}`);
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    window.addEventListener("popstate", syncFromHash);
    window.addEventListener("clio:subtab-anchor", onAnchor);
    return () => {
      window.removeEventListener("hashchange", syncFromHash);
      window.removeEventListener("popstate", syncFromHash);
      window.removeEventListener("clio:subtab-anchor", onAnchor);
    };
  }, []);

  const handleSectionChange = (nextSection) => {
    setSection(nextSection);
    if (typeof window !== "undefined") {
      const anchor = toSubTabAnchor(nextSection);
      window.history.pushState(null, "", `${window.location.pathname}#${anchor}`);
      window.dispatchEvent(new CustomEvent("clio:subtab-anchor", { detail: { moduleId: "incident-management", anchor } }));
    }
  };

  const setFilter = (field, value) => {
    setFilters((current) => ({ ...current, [field]: value, page: 1 }));
  };

  const openCreateModal = () => {
    setCreateForm({
      ...initialCreateForm,
      ownerEmail: String(session?.email || "").trim().toLowerCase(),
      detectedAt: toLocalDateTimeInput(nowIso()),
    });
    setIsCreateModalOpen(true);
  };

  const patchSelected = useCallback(
    async (payload, successMessage) => {
      if (!canEdit || !selectedRecordId) return;
      setIsSavingRecord(true);
      try {
        await hrisApi.incidents.update(selectedRecordId, payload);
        await loadSelectedRecord(selectedRecordId);
        await loadRecords();
        if (successMessage) toast.success(successMessage);
      } catch (error) {
        toast.error(error.message || "Unable to update incident.");
      } finally {
        setIsSavingRecord(false);
      }
    },
    [canEdit, selectedRecordId, loadSelectedRecord, loadRecords, toast],
  );

  const submitCreateIncident = async (event) => {
    event.preventDefault();
    if (!canEdit) return;
    if (!String(createForm.title || "").trim()) {
      toast.error("Incident title is required.");
      return;
    }
    setIsSubmittingCreate(true);
    try {
      const payload = {
        ...createForm,
        detectedAt: toIsoFromLocalDateTime(createForm.detectedAt) || nowIso(),
        ownerEmail: String(createForm.ownerEmail || "").trim().toLowerCase(),
        affectedEmployeeEmail: String(createForm.affectedEmployeeEmail || "").trim().toLowerCase(),
      };
      const response = await hrisApi.incidents.create(payload);
      toast.success("Incident record created.");
      setIsCreateModalOpen(false);
      await loadRecords();
      if (response?.record?.id) {
        setSelectedRecordId(response.record.id);
      }
    } catch (error) {
      toast.error(error.message || "Unable to create incident.");
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  const saveRecordDraft = async () => {
    if (!canEdit || !recordDraft) return;
    await patchSelected(
      {
        ...recordDraft,
        ownerEmail: String(recordDraft.ownerEmail || "").trim().toLowerCase(),
        affectedEmployeeEmail: String(recordDraft.affectedEmployeeEmail || "").trim().toLowerCase(),
        forensicWindowStart: toIsoFromLocalDateTime(recordDraft.forensicWindowStart),
        forensicWindowEnd: toIsoFromLocalDateTime(recordDraft.forensicWindowEnd),
      },
      "Incident workflow updated.",
    );
  };

  const markTimestampAction = async (field, successMessage, extraPayload = {}) => {
    await patchSelected({ [field]: nowIso(), ...extraPayload }, successMessage);
  };

  const handleBreachConfirmation = async (shouldConfirm) => {
    if (!canEdit || !selectedRecordId) return;
    if (shouldConfirm) {
      const ok = requestActionConfirmation("Mark this incident as a confirmed breach?");
      if (!ok) return;
    }
    await patchSelected(
      {
        breachConfirmed: shouldConfirm,
        breachConfirmedAt: shouldConfirm ? nowIso() : "",
        breachConfirmedBy: shouldConfirm ? String(session?.email || "").trim().toLowerCase() : "",
      },
      shouldConfirm ? "Breach confirmation recorded." : "Breach confirmation cleared.",
    );
  };

  const handleEvidenceUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedRecord || !canEdit) return;
    setIsUploadingEvidence(true);
    try {
      const uploaded = await uploadIncidentEvidenceToStorage({
        file,
        incidentRecordId: selectedRecord.id,
        affectedEmployeeEmail: selectedRecord.affectedEmployeeEmail,
      });
      const nextDocs = [
        ...(Array.isArray(selectedRecord.evidenceDocuments) ? selectedRecord.evidenceDocuments : []),
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name || "Incident Evidence",
          type: "Incident Evidence",
          ref: uploaded.downloadUrl,
          storagePath: uploaded.storagePath,
          contentType: uploaded.contentType || file.type || "",
          fileExtension: String(file.name || "").split(".").pop() || "",
          sizeBytes: uploaded.sizeBytes,
          uploadedAt: nowIso(),
          uploadedBy: String(session?.email || "").trim().toLowerCase(),
        },
      ];
      await patchSelected({ evidenceDocuments: nextDocs, documentationRetained: true }, "Incident evidence uploaded.");
    } catch (error) {
      toast.error(error.message || "Unable to upload evidence.");
    } finally {
      setIsUploadingEvidence(false);
    }
  };

  const removeEvidence = async (entry) => {
    if (!selectedRecord || !canEdit) return;
    if (!requestActionConfirmation(`Remove evidence "${String(entry?.name || "file")}"?`)) return;
    const current = Array.isArray(selectedRecord.evidenceDocuments) ? selectedRecord.evidenceDocuments : [];
    const next = current.filter((item) => String(item?.id || "").trim() !== String(entry?.id || "").trim());
    await patchSelected({ evidenceDocuments: next }, "Evidence removed.");
    if (entry?.storagePath) {
      await removeStorageObjectByPath(entry.storagePath);
    }
  };

  const filteredBySection = useMemo(() => {
    if (section === "regulatory-72-hour-notification") {
      return records.filter((row) => Boolean(row?.regulatoryNotificationRequired) || Boolean(row?.restrictedPiiInvolved));
    }
    if (section === "forensic-logging") {
      return records.filter((row) => Number(row?.forensicSummary?.totalScopedLogs || 0) > 0 || Boolean(row?.forensicSnapshot));
    }
    return records;
  }, [records, section]);

  const filteredByBreach = useMemo(() => {
    if (filters.breachConfirmed === "yes") {
      return filteredBySection.filter((row) => Boolean(row?.breachConfirmed));
    }
    if (filters.breachConfirmed === "no") {
      return filteredBySection.filter((row) => !row?.breachConfirmed);
    }
    return filteredBySection;
  }, [filteredBySection, filters.breachConfirmed]);

  const summaryCards = useMemo(() => {
    if (section === "regulatory-72-hour-notification") {
      return [
        { key: "total", label: "Total Incidents", value: summary.total || 0 },
        { key: "due", label: "Due Within 72h", value: summary.dueWithin72Hours || 0 },
        { key: "overdue", label: "Overdue Notifications", value: summary.overdue72HourNotifications || 0 },
      ];
    }
    if (section === "forensic-logging") {
      return [
        { key: "total", label: "Total Incidents", value: summary.total || 0 },
        { key: "logs", label: "Selected Scoped Logs", value: Number(selectedRecord?.forensicSummary?.totalScopedLogs || 0) },
        { key: "deletions", label: "Selected Deletion Logs", value: Number(selectedRecord?.forensicSummary?.deletionActivitiesCount || 0) },
      ];
    }
    return [
      { key: "total", label: "Total Incidents", value: summary.total || 0 },
      { key: "open", label: "Open Cases", value: summary.openCases || 0 },
      { key: "critical", label: "Critical Open", value: summary.criticalOpen || 0 },
      { key: "containment", label: "Containment Pending", value: summary.containmentPending || 0 },
    ];
  }, [section, summary, selectedRecord]);

  const pageStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const pageEnd = Math.min(pagination.total || 0, pagination.page * pagination.pageSize);

  const evidenceRows = Array.isArray(selectedRecord?.evidenceDocuments) ? selectedRecord.evidenceDocuments : [];

  const forensicBuckets = [
    { key: "accessLogs", label: "Access Logs" },
    { key: "exportLogs", label: "Export Logs" },
    { key: "administrativeActions", label: "Administrative Actions" },
    { key: "deletionActivities", label: "Deletion Activities" },
  ];

  return (
    <div className="space-y-4">
      <ModuleTabs tabs={SECTION_TABS} value={section} onChange={handleSectionChange} />

      <SurfaceCard
        title={section === "escalation-plan" ? "Defined Escalation Plan" : section === "regulatory-72-hour-notification" ? "72-Hour Regulatory Notification" : "Forensic Logging"}
        subtitle={section === "escalation-plan" ? "Severity-based escalation and containment prioritization." : section === "regulatory-72-hour-notification" ? "PII breach notification window and compliance timeline." : "Access/export/admin/deletion traces for incident investigation."}
      >
        <div className={`grid gap-3 ${summaryCards.length > 3 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"}`}>
          {summaryCards.map((card) => (
            <div key={card.key} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{card.label}</p>
              <p className="mt-0.5 text-lg font-semibold text-slate-900">{card.value}</p>
            </div>
          ))}
        </div>
      </SurfaceCard>

      <SurfaceCard
        title="Incident Records"
        subtitle="Response workflow, escalation actions, and forensic-ready incident traceability."
        action={
          <div className="flex items-center gap-2">
            {canEdit ? (
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex h-9 items-center rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white transition hover:bg-sky-700"
              >
                Create Incident
              </button>
            ) : null}
            <button
              type="button"
              onClick={loadRecords}
              disabled={isLoading}
              className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              Refresh
            </button>
          </div>
        }
      >
        <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-6">
          <input value={filters.q} onChange={(event) => setFilter("q", event.target.value)} placeholder="Search incident" className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none md:col-span-2" />
          <select value={filters.status} onChange={(event) => setFilter("status", event.target.value)} className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none">
            <option value="all">All Status</option>
            {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select value={filters.severity} onChange={(event) => setFilter("severity", event.target.value)} className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none">
            <option value="all">All Severity</option>
            {SEVERITY_OPTIONS.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
          </select>
          <select value={filters.incidentType} onChange={(event) => setFilter("incidentType", event.target.value)} className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none">
            <option value="all">All Types</option>
            {INCIDENT_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <select value={filters.regulatoryStatus} onChange={(event) => setFilter("regulatoryStatus", event.target.value)} className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none">
            <option value="all">All Regulatory</option>
            {REGULATORY_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select value={filters.restrictedPii} onChange={(event) => setFilter("restrictedPii", event.target.value)} className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none">
            <option value="all">PII: All</option>
            <option value="yes">PII: Yes</option>
            <option value="no">PII: No</option>
          </select>
          <select value={filters.breachConfirmed} onChange={(event) => setFilter("breachConfirmed", event.target.value)} className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none">
            <option value="all">Breach: All</option>
            <option value="yes">Breach: Confirmed</option>
            <option value="no">Breach: Not Confirmed</option>
          </select>
        </div>

        <div className="mt-4">
          {isLoading ? (
            <div className="flex justify-center py-6">
              <span className="inline-flex h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" aria-hidden="true" />
            </div>
          ) : filteredByBreach.length === 0 ? (
            <EmptyState title="No incident records found" subtitle="Create incidents or adjust filters to continue." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                    <th className="px-2 py-3 font-medium">Incident</th>
                    <th className="px-2 py-3 font-medium">Severity</th>
                    <th className="px-2 py-3 font-medium">Status</th>
                    <th className="px-2 py-3 font-medium">Escalation</th>
                    <th className="px-2 py-3 font-medium">Regulatory</th>
                    <th className="px-2 py-3 font-medium">Updated</th>
                    <th className="px-2 py-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredByBreach.map((record) => (
                    <tr key={record.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                      <td className="px-2 py-3">
                        <p className="font-medium text-slate-900">{getRecordLabel(record)}</p>
                        <p className="text-xs text-slate-500">{String(record?.incidentCode || "N/A")}</p>
                      </td>
                      <td className="px-2 py-3"><StatusBadge value={record?.severity || "Medium"} /></td>
                      <td className="px-2 py-3"><StatusBadge value={record?.status || "Open"} /></td>
                      <td className="px-2 py-3 text-xs">
                        <p className="font-medium text-slate-800">{String(record?.escalationLevel || "-")}</p>
                        <p className="text-slate-500">GRC: {record?.grcAlertedAt ? "Yes" : "No"}</p>
                      </td>
                      <td className="px-2 py-3 text-xs">
                        <p className="font-medium text-slate-800">{String(record?.regulatoryStatus || "Not Required")}</p>
                        <p className="text-slate-500">Due: {formatDateTime(record?.regulatoryDueAt)}</p>
                      </td>
                      <td className="px-2 py-3 text-xs text-slate-600">{formatDateTime(record?.updatedAt || record?.createdAt)}</td>
                      <td className="px-2 py-3 text-right">
                        <button type="button" onClick={() => setSelectedRecordId(record.id)} className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50">
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <p>Showing {pageStart}-{pageEnd} of {pagination.total || 0} records</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setFilters((current) => ({ ...current, page: Math.max(1, current.page - 1) }))} disabled={(pagination.page || 1) <= 1 || isLoading} className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60">Previous</button>
            <span>Page {pagination.page || 1} of {Math.max(1, pagination.totalPages || 1)}</span>
            <button type="button" onClick={() => setFilters((current) => ({ ...current, page: Math.min(Math.max(1, pagination.totalPages || 1), current.page + 1) }))} disabled={(pagination.page || 1) >= (pagination.totalPages || 1) || isLoading} className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60">Next</button>
          </div>
        </div>
      </SurfaceCard>

      {isCreateModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Create Incident"
          onClick={() => !isSubmittingCreate && setIsCreateModalOpen(false)}
        >
          <div
            className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Create Incident</h2>
                <p className="mt-0.5 text-sm text-slate-600">Capture incident details and initialize compliance workflow.</p>
              </div>
              <button
                type="button"
                onClick={() => !isSubmittingCreate && setIsCreateModalOpen(false)}
                disabled={isSubmittingCreate}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                aria-label="Close create incident"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-4 w-4" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            <form className="space-y-3" onSubmit={submitCreateIncident}>
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  required
                  value={createForm.title}
                  onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Incident title"
                  className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none md:col-span-2"
                />
                <select
                  value={createForm.severity}
                  onChange={(event) => setCreateForm((current) => ({ ...current, severity: event.target.value }))}
                  className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                >
                  {SEVERITY_OPTIONS.map((severity) => (
                    <option key={`create-severity-${severity}`} value={severity}>
                      {severity}
                    </option>
                  ))}
                </select>
                <select
                  value={createForm.incidentType}
                  onChange={(event) => setCreateForm((current) => ({ ...current, incidentType: event.target.value }))}
                  className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                >
                  {INCIDENT_TYPE_OPTIONS.map((type) => (
                    <option key={`create-type-${type}`} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  value={createForm.detectedAt}
                  onChange={(event) => setCreateForm((current) => ({ ...current, detectedAt: event.target.value }))}
                  className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                />
                <input
                  value={createForm.ownerEmail}
                  onChange={(event) => setCreateForm((current) => ({ ...current, ownerEmail: event.target.value }))}
                  placeholder="Owner email"
                  className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                />
                <input
                  value={createForm.affectedEmployeeEmail}
                  onChange={(event) => setCreateForm((current) => ({ ...current, affectedEmployeeEmail: event.target.value }))}
                  placeholder="Affected employee email"
                  className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none md:col-span-2"
                />
                <textarea
                  rows={3}
                  value={createForm.summary}
                  onChange={(event) => setCreateForm((current) => ({ ...current, summary: event.target.value }))}
                  placeholder="Incident summary"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-sky-400 focus:outline-none md:col-span-2"
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={createForm.restrictedPiiInvolved}
                    onChange={(event) => setCreateForm((current) => ({ ...current, restrictedPiiInvolved: event.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span className="text-xs text-slate-700">Restricted PII</span>
                </label>
                <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={createForm.executiveNotificationRequired}
                    onChange={(event) => setCreateForm((current) => ({ ...current, executiveNotificationRequired: event.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span className="text-xs text-slate-700">Executive Notice</span>
                </label>
                <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={createForm.regulatoryNotificationRequired}
                    onChange={(event) => setCreateForm((current) => ({ ...current, regulatoryNotificationRequired: event.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span className="text-xs text-slate-700">Regulatory Notice</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  disabled={isSubmittingCreate}
                  className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-70"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCreate}
                  className="inline-flex h-9 items-center rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
                >
                  {isSubmittingCreate ? "Creating..." : "Create Incident"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {selectedRecordId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Incident Workbench"
          onClick={() => !isSavingRecord && !isUploadingEvidence && setSelectedRecordId("")}
        >
          <div
            className="w-full max-w-6xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Incident Workbench</h2>
                <p className="mt-0.5 text-sm text-slate-600">Escalation, 72-hour actions, and forensic evidence.</p>
              </div>
              <button
                type="button"
                onClick={() => !isSavingRecord && !isUploadingEvidence && setSelectedRecordId("")}
                disabled={isSavingRecord || isUploadingEvidence}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                aria-label="Close incident workbench"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-4 w-4" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            {isLoadingRecord || !selectedRecord || !recordDraft ? (
              <div className="flex justify-center py-8">
                <span className="inline-flex h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" aria-hidden="true" />
              </div>
            ) : (
              <div className="max-h-[72vh] space-y-3 overflow-y-auto pr-1">
                <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Incident</p>
                    <p className="text-sm font-semibold text-slate-900">{getRecordLabel(selectedRecord)}</p>
                    <p className="text-xs text-slate-500">{String(selectedRecord?.incidentCode || "N/A")}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Detected</p>
                    <p className="text-xs text-slate-700">{formatDateTime(selectedRecord?.detectedAt)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Regulatory Due</p>
                    <p className="text-xs text-slate-700">{formatDateTime(selectedRecord?.regulatoryDueAt)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Regulatory Status</p>
                    <StatusBadge value={selectedRecord?.regulatoryStatus || "Not Required"} />
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <SurfaceCard title="Workflow Control" subtitle="Severity, containment, impact, and status updates">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <select value={recordDraft.severity} onChange={(event) => setRecordDraft((current) => ({ ...current, severity: event.target.value }))} disabled={!canEdit || isSavingRecord} className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100">
                        {SEVERITY_OPTIONS.map((severity) => <option key={`d-sev-${severity}`} value={severity}>{severity}</option>)}
                      </select>
                      <select value={recordDraft.status} onChange={(event) => setRecordDraft((current) => ({ ...current, status: event.target.value }))} disabled={!canEdit || isSavingRecord} className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100">
                        {STATUS_OPTIONS.map((status) => <option key={`d-status-${status}`} value={status}>{status}</option>)}
                      </select>
                      <select value={recordDraft.containmentStatus} onChange={(event) => setRecordDraft((current) => ({ ...current, containmentStatus: event.target.value }))} disabled={!canEdit || isSavingRecord} className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100">
                        {CONTAINMENT_OPTIONS.map((status) => <option key={`d-cont-${status}`} value={status}>{status}</option>)}
                      </select>
                      <select value={recordDraft.impactAssessmentStatus} onChange={(event) => setRecordDraft((current) => ({ ...current, impactAssessmentStatus: event.target.value }))} disabled={!canEdit || isSavingRecord} className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100">
                        {IMPACT_OPTIONS.map((status) => <option key={`d-impact-${status}`} value={status}>{status}</option>)}
                      </select>
                    </div>
                    <textarea value={recordDraft.summary} onChange={(event) => setRecordDraft((current) => ({ ...current, summary: event.target.value }))} rows={2} placeholder="Incident summary" disabled={!canEdit || isSavingRecord} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100" />
                    <textarea value={recordDraft.containmentSummary} onChange={(event) => setRecordDraft((current) => ({ ...current, containmentSummary: event.target.value }))} rows={2} placeholder="Containment summary" disabled={!canEdit || isSavingRecord} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100" />
                    <textarea value={recordDraft.impactSummary} onChange={(event) => setRecordDraft((current) => ({ ...current, impactSummary: event.target.value }))} rows={2} placeholder="Impact summary" disabled={!canEdit || isSavingRecord} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100" />
                  </SurfaceCard>

                  <SurfaceCard title="72-Hour Controls" subtitle="Regulatory, executive, and affected-individual notifications">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <input type="checkbox" checked={recordDraft.regulatoryNotificationRequired} onChange={(event) => setRecordDraft((current) => ({ ...current, regulatoryNotificationRequired: event.target.checked }))} disabled={!canEdit || isSavingRecord} className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                        <span className="text-xs text-slate-700">Regulatory required</span>
                      </label>
                      <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <input type="checkbox" checked={recordDraft.documentationRetained} onChange={(event) => setRecordDraft((current) => ({ ...current, documentationRetained: event.target.checked }))} disabled={!canEdit || isSavingRecord} className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                        <span className="text-xs text-slate-700">Documentation retained</span>
                      </label>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <input value={recordDraft.documentationLocation} onChange={(event) => setRecordDraft((current) => ({ ...current, documentationLocation: event.target.value }))} placeholder="Documentation location" disabled={!canEdit || isSavingRecord} className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100" />
                      <input value={recordDraft.classificationStandard} onChange={(event) => setRecordDraft((current) => ({ ...current, classificationStandard: event.target.value }))} placeholder="Classification standard" disabled={!canEdit || isSavingRecord} className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100" />
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      <button type="button" onClick={() => markTimestampAction("grcAlertedAt", "GRC alerted.", { escalationRequired: true })} disabled={!canEdit || isSavingRecord} className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">Mark GRC Alerted</button>
                      <button type="button" onClick={() => markTimestampAction("executiveNotifiedAt", "Executive notification recorded.", { executiveNotificationRequired: true })} disabled={!canEdit || isSavingRecord} className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">Mark Executive Notified</button>
                      <button type="button" onClick={() => markTimestampAction("regulatoryNotifiedAt", "Regulatory notification recorded.", { regulatoryNotificationRequired: true, status: "Regulatory Review" })} disabled={!canEdit || isSavingRecord} className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">Mark Regulator Notified</button>
                      <button type="button" onClick={() => markTimestampAction("affectedIndividualsNotifiedAt", "Affected individuals notification recorded.")} disabled={!canEdit || isSavingRecord} className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">Mark Affected Individuals</button>
                      <button type="button" onClick={() => patchSelected({ refreshForensicSnapshot: true }, "Forensic snapshot refreshed.")} disabled={!canEdit || isSavingRecord} className="inline-flex h-8 items-center justify-center rounded-md border border-sky-200 bg-sky-50 px-3 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100 disabled:opacity-60">Refresh Forensic</button>
                    </div>
                  </SurfaceCard>

                  <SurfaceCard title="Breach Confirmation" subtitle="Manual confirmation required for declared breaches">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Status</p>
                        <p className="text-sm font-semibold text-slate-900">
                          {recordDraft?.breachConfirmed ? "Confirmed breach" : "Not confirmed"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {recordDraft?.breachConfirmedAt ? `At ${formatDateTime(recordDraft.breachConfirmedAt)}` : "Awaiting confirmation"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Confirmed By</p>
                        <p className="text-sm font-semibold text-slate-900">
                          {recordDraft?.breachConfirmedBy ? recordDraft.breachConfirmedBy : "-"}
                        </p>
                        <p className="text-xs text-slate-500">Requires GRC approval</p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {recordDraft?.breachConfirmed ? (
                        <button
                          type="button"
                          onClick={() => handleBreachConfirmation(false)}
                          disabled={!canEdit || isSavingRecord}
                          className="inline-flex h-8 items-center justify-center rounded-md border border-rose-200 bg-rose-50 px-3 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                        >
                          Revoke Confirmation
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleBreachConfirmation(true)}
                          disabled={!canEdit || isSavingRecord}
                          className="inline-flex h-8 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                        >
                          Mark Breach Confirmed
                        </button>
                      )}
                      {!canEdit ? (
                        <p className="text-xs text-slate-500">View-only. GRC can confirm breaches.</p>
                      ) : null}
                    </div>
                  </SurfaceCard>
                </div>

                <SurfaceCard title="Incident Evidence" subtitle="Retained case documents and attachments">
                  <input ref={evidenceInputRef} type="file" className="hidden" onChange={handleEvidenceUpload} />
                  <div className="mb-2 flex justify-end">
                    {canEdit ? (
                      <button type="button" onClick={() => evidenceInputRef.current?.click()} disabled={isUploadingEvidence || isSavingRecord} className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
                        {isUploadingEvidence ? "Uploading..." : "Upload Evidence"}
                      </button>
                    ) : null}
                  </div>

                  {evidenceRows.length === 0 ? (
                    <EmptyState title="No evidence files attached" subtitle="Upload incident files to retain case evidence." />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                            <th className="px-2 py-3 font-medium">Document</th>
                            <th className="px-2 py-3 font-medium">Uploaded At</th>
                            <th className="px-2 py-3 font-medium">Uploaded By</th>
                            <th className="px-2 py-3 font-medium text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evidenceRows.map((entry, index) => (
                            <tr key={`${entry?.id || "evidence"}-${index}`} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                              <td className="px-2 py-3">
                                <p className="font-medium text-slate-900">{String(entry?.name || "Incident Evidence")}</p>
                                <p className="text-xs text-slate-500">{String(entry?.type || "Incident Evidence")}</p>
                              </td>
                              <td className="px-2 py-3 text-xs text-slate-600">{formatDateTime(entry?.uploadedAt)}</td>
                              <td className="px-2 py-3 text-xs text-slate-600">{String(entry?.uploadedBy || "-")}</td>
                              <td className="px-2 py-3 text-right">
                                <div className="inline-flex items-center gap-2">
                                  {entry?.ref ? (
                                    <a href={entry.ref} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-lg border border-sky-200 bg-sky-50 px-3 text-xs font-semibold text-sky-700 transition hover:bg-sky-100">Open</a>
                                  ) : null}
                                  {canEdit ? (
                                    <button type="button" onClick={() => removeEvidence(entry)} disabled={isSavingRecord || isUploadingEvidence} className="inline-flex h-8 items-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60">Remove</button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </SurfaceCard>

                <SurfaceCard title="Forensic Logging" subtitle="Scoped logs for access, export, administrative, and deletion events">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Scoped Logs</p><p className="text-sm font-semibold text-slate-900">{Number(selectedRecord?.forensicSummary?.totalScopedLogs || 0)}</p></div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Access</p><p className="text-sm font-semibold text-slate-900">{Number(selectedRecord?.forensicSummary?.accessLogsCount || 0)}</p></div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Exports</p><p className="text-sm font-semibold text-slate-900">{Number(selectedRecord?.forensicSummary?.exportLogsCount || 0)}</p></div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Administrative</p><p className="text-sm font-semibold text-slate-900">{Number(selectedRecord?.forensicSummary?.administrativeActionsCount || 0)}</p></div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Deletion</p><p className="text-sm font-semibold text-slate-900">{Number(selectedRecord?.forensicSummary?.deletionActivitiesCount || 0)}</p></div>
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {forensicBuckets.map((bucket) => {
                      const rows = Array.isArray(selectedRecord?.forensicSnapshot?.[bucket.key])
                        ? selectedRecord.forensicSnapshot[bucket.key].slice(0, 20)
                        : [];
                      return (
                        <div key={bucket.key} className="rounded-lg border border-slate-200 bg-white">
                          <div className="border-b border-slate-200 px-3 py-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{bucket.label}</p>
                          </div>
                          {rows.length === 0 ? (
                            <p className="px-3 py-3 text-xs text-slate-500">No entries.</p>
                          ) : (
                            <div className="max-h-52 overflow-auto">
                              <table className="min-w-full text-left text-xs">
                                <thead>
                                  <tr className="border-b border-slate-200 text-[11px] uppercase tracking-[0.08em] text-slate-500">
                                    <th className="px-3 py-2 font-medium">Action</th>
                                    <th className="px-3 py-2 font-medium">Module</th>
                                    <th className="px-3 py-2 font-medium">When</th>
                                    <th className="px-3 py-2 font-medium">By</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {rows.map((row, index) => (
                                    <tr key={`${bucket.key}-${row.id || row.occurredAt || "row"}-${index}`} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                                      <td className="px-3 py-2">{String(row?.activityName || "-")}</td>
                                      <td className="px-3 py-2">{String(row?.module || "-")}</td>
                                      <td className="px-3 py-2">{formatDateTime(row?.occurredAt)}</td>
                                      <td className="px-3 py-2">{String(row?.performedBy || "-")}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </SurfaceCard>

                <SurfaceCard title="Notes" subtitle="Additional incident context">
                  <textarea
                    value={recordDraft.notes}
                    onChange={(event) => setRecordDraft((current) => ({ ...current, notes: event.target.value }))}
                    rows={3}
                    disabled={!canEdit || isSavingRecord}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100"
                  />
                </SurfaceCard>

                {canEdit ? (
                  <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-slate-200 bg-white pt-3">
                    <button
                      type="button"
                      onClick={saveRecordDraft}
                      disabled={isSavingRecord || isUploadingEvidence}
                      className="inline-flex h-9 items-center rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
                    >
                      {isSavingRecord ? "Saving..." : "Save Incident Updates"}
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
