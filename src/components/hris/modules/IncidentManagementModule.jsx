"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SurfaceCard from "@/components/hris/SurfaceCard";
import EmptyState from "@/components/hris/shared/EmptyState";
import { FormSkeleton, LoadingTransition, TableSkeleton } from "@/components/hris/shared/Skeletons";
import StatusBadge from "@/components/hris/shared/StatusBadge";
import { useToast } from "@/components/ui/ToastProvider";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { toSubTabAnchor } from "@/lib/subtab-anchor";
import { hrisApi } from "@/services/hris-api-client";
import {
  removeStorageObjectByPath,
  uploadIncidentEvidenceToStorage,
} from "@/services/firebase-storage-client";

const SEVERITY_OPTIONS = ["Low", "High"];
const STATUS_OPTIONS = ["Open", "Containment", "Investigating", "Escalated", "Regulatory Review", "Resolved", "Closed"];
const CONTAINMENT_OPTIONS = ["Not Started", "In Progress", "Contained"];
const IMPACT_OPTIONS = ["Pending", "In Progress", "Completed"];
const INCIDENT_TYPE_OPTIONS = [
  "Security",
  "Compliance",
  "HR",
  "IT Operations",
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
const CLOSURE_STATUS_OPTIONS = ["Pending Approval", "Approved", "Rejected"];

const initialFilters = {
  q: "",
  status: "all",
  severity: "all",
  incidentType: "all",
  regulatoryStatus: "all",
  restrictedPii: "all",
  breachConfirmed: "all",
  department: "all",
  dateFrom: "",
  dateTo: "",
  page: 1,
  pageSize: 12,
};

const initialCreateForm = {
  title: "",
  summary: "",
  incidentType: "Unauthorized Access",
  severity: "Low",
  detectedAt: "",
  ownerEmail: "",
  affectedEmployeeEmail: "",
  department: "",
  involvedEmployees: "",
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

function normalizeSeverityValue(value, fallback = "Low") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "high" || normalized === "critical") return "High";
  if (normalized === "low" || normalized === "medium") return "Low";
  return fallback;
}

function getRecordLabel(record) {
  return String(record?.title || "").trim() || String(record?.incidentCode || "").trim() || "Incident";
}

function mapDraft(record) {
  return {
    title: String(record?.title || ""),
    summary: String(record?.summary || ""),
    incidentType: String(record?.incidentType || "Other"),
    severity: normalizeSeverityValue(record?.severity, "Low"),
    status: String(record?.status || "Open"),
    containmentStatus: String(record?.containmentStatus || "Not Started"),
    containmentSummary: String(record?.containmentSummary || ""),
    impactAssessmentStatus: String(record?.impactAssessmentStatus || "Pending"),
    impactSummary: String(record?.impactSummary || ""),
    ownerEmail: String(record?.ownerEmail || ""),
    affectedEmployeeEmail: String(record?.affectedEmployeeEmail || ""),
    department: String(record?.department || ""),
    involvedEmployees: Array.isArray(record?.involvedEmployees) ? record.involvedEmployees.join(", ") : String(record?.involvedEmployees || ""),
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
    correctiveActions: String(record?.correctiveActions || ""),
    disciplinaryActions: String(record?.disciplinaryActions || ""),
    resolutionNotes: String(record?.resolutionNotes || ""),
    closureApprovalStatus: String(record?.closureApprovalStatus || "Pending Approval"),
    closureApprovedAt: String(record?.closureApprovedAt || ""),
    closureApprovedBy: String(record?.closureApprovedBy || ""),
  };
}

export default function IncidentManagementModule({ session }) {
  const toast = useToast();
  const confirmAction = useConfirm();
  const actorRole = String(session?.role || "").trim().toUpperCase();
  const canEdit = actorRole === "GRC" || actorRole === "SUPER_ADMIN";
  const [section, setSection] = useState("incident-dashboard");

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
  const [createAttachments, setCreateAttachments] = useState([]);
  const evidenceInputRef = useRef(null);
  const createEvidenceInputRef = useRef(null);

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
    if (typeof window === "undefined") {
      return;
    }
    const syncFromHash = (rawHash = window.location.hash) => {
      const hash = String(rawHash || "").replace(/^#/, "").trim().toLowerCase();
      if (!hash) {
        return;
      }
      const match = [
        "incident-dashboard",
        "report-incident",
        "incident-list",
        "reports-analytics",
      ].find((tab) => toSubTabAnchor(tab) === hash);
      if (match) {
        setSection(match);
      }
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

  const setFilter = (field, value) => {
    setFilters((current) => ({ ...current, [field]: value, page: 1 }));
  };

  const openCreateModal = () => {
    setCreateForm({
      ...initialCreateForm,
      ownerEmail: String(session?.email || "").trim().toLowerCase(),
      detectedAt: toLocalDateTimeInput(nowIso()),
    });
    setCreateAttachments([]);
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
        department: String(createForm.department || "").trim(),
        involvedEmployees: String(createForm.involvedEmployees || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      };
      const response = await hrisApi.incidents.create(payload);
      toast.success("Incident record created.");
      setIsCreateModalOpen(false);
      await loadRecords();
      if (response?.record?.id) {
        setSelectedRecordId(response.record.id);
      }

      if (response?.record?.id && createAttachments.length > 0) {
        const recordId = response.record.id;
        const affectedEmail = String(payload.affectedEmployeeEmail || "").trim().toLowerCase();
        const uploadedDocs = [];
        for (const file of createAttachments) {
          const uploaded = await uploadIncidentEvidenceToStorage({
            file,
            incidentRecordId: recordId,
            affectedEmployeeEmail: affectedEmail,
          });
          uploadedDocs.push({
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
          });
        }
        if (uploadedDocs.length > 0) {
          await hrisApi.incidents.update(recordId, {
            evidenceDocuments: uploadedDocs,
            documentationRetained: true,
          });
        }
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
        involvedEmployees: String(recordDraft.involvedEmployees || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
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
      const ok = await confirmAction({
        title: "Confirm Breach",
        message: "Mark this incident as a confirmed breach?",
        confirmText: "Confirm Breach",
        tone: "danger",
      });
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
    if (
      !(await confirmAction({
        title: "Remove Evidence",
        message: `Remove evidence "${String(entry?.name || "file")}"?`,
        confirmText: "Remove",
        tone: "danger",
      }))
    )
      return;
    const current = Array.isArray(selectedRecord.evidenceDocuments) ? selectedRecord.evidenceDocuments : [];
    const next = current.filter((item) => String(item?.id || "").trim() !== String(entry?.id || "").trim());
    await patchSelected({ evidenceDocuments: next }, "Evidence removed.");
    if (entry?.storagePath) {
      await removeStorageObjectByPath(entry.storagePath);
    }
  };

  const filteredBySection = useMemo(() => records, [records]);

  const filteredByBreach = useMemo(() => {
    if (filters.breachConfirmed === "yes") {
      return filteredBySection.filter((row) => Boolean(row?.breachConfirmed));
    }
    if (filters.breachConfirmed === "no") {
      return filteredBySection.filter((row) => !row?.breachConfirmed);
    }
    return filteredBySection;
  }, [filteredBySection, filters.breachConfirmed]);

  const filteredByAdvanced = useMemo(() => {
    let scoped = filteredByBreach;
    const departmentFilter = String(filters.department || "").trim().toLowerCase();
    if (departmentFilter && departmentFilter !== "all") {
      scoped = scoped.filter((row) => String(row?.department || "").trim().toLowerCase() === departmentFilter);
    }
    const from = filters.dateFrom ? new Date(filters.dateFrom) : null;
    const to = filters.dateTo ? new Date(filters.dateTo) : null;
    if (from && !Number.isNaN(from.getTime())) {
      scoped = scoped.filter((row) => new Date(row?.detectedAt || row?.createdAt || "").getTime() >= from.getTime());
    }
    if (to && !Number.isNaN(to.getTime())) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      scoped = scoped.filter((row) => new Date(row?.detectedAt || row?.createdAt || "").getTime() <= end.getTime());
    }
    return scoped;
  }, [filteredByBreach, filters.department, filters.dateFrom, filters.dateTo]);

  const summaryCards = useMemo(
    () => [
      { key: "total", label: "Total Incidents", value: summary.total || 0 },
      { key: "open", label: "Open Cases", value: summary.openCases || 0 },
      { key: "critical", label: "Critical Open", value: summary.criticalOpen || 0 },
      { key: "containment", label: "Containment Pending", value: summary.containmentPending || 0 },
    ],
    [summary],
  );

  const pageStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const pageEnd = Math.min(pagination.total || 0, pagination.page * pagination.pageSize);

  const evidenceRows = Array.isArray(selectedRecord?.evidenceDocuments) ? selectedRecord.evidenceDocuments : [];

  const forensicBuckets = [
    { key: "accessLogs", label: "Access Logs" },
    { key: "exportLogs", label: "Export Logs" },
    { key: "administrativeActions", label: "Administrative Actions" },
    { key: "deletionActivities", label: "Deletion Activities" },
  ];

  const primaryForensicSample = useMemo(() => {
    if (!selectedRecord?.forensicSnapshot) {
      return null;
    }
    const snapshot = selectedRecord.forensicSnapshot;
    const buckets = [
      snapshot.accessLogs,
      snapshot.exportLogs,
      snapshot.administrativeActions,
      snapshot.deletionActivities,
    ];
    for (const bucket of buckets) {
      if (Array.isArray(bucket) && bucket.length > 0) {
        return bucket[0];
      }
    }
    return null;
  }, [selectedRecord]);
  const forensicContextRows = useMemo(() => {
    const sample = primaryForensicSample || {};
    const requestLine =
      sample.requestMethod && sample.requestPath
        ? `${sample.requestMethod} ${sample.requestPath}`
        : sample.requestPath || "";
    const employeeEmail =
      sample.employeeEmail || sample.targetEmployeeEmail || selectedRecord?.affectedEmployeeEmail || "";
    const recordLabel = sample.resourceLabel || sample.recordRef || "";
    const viewedFields = Array.isArray(sample.viewedFields) ? sample.viewedFields : [];
    const viewedFieldsSummary =
      viewedFields.length > 0 ? `${viewedFields.slice(0, 8).join(", ")}${viewedFields.length > 8 ? "…" : ""}` : "";
    const accessedDocuments = Array.isArray(sample.accessedDocuments) ? sample.accessedDocuments : [];
    const accessedDocsSummary =
      accessedDocuments.length > 0
        ? accessedDocuments
            .map((doc) => String(doc?.name || doc?.ref || doc?.id || "").trim())
            .filter(Boolean)
            .slice(0, 6)
            .join(", ")
        : "";
    return [
      { label: "Alert Description", value: selectedRecord?.alertDescription || selectedRecord?.summary || "-" },
      { label: "Occurrences", value: Number(selectedRecord?.alertOccurrenceCount || 1) },
      { label: "Performed By", value: sample.performedBy || selectedRecord?.ownerEmail || "-" },
      { label: "Activity", value: sample.activityName || selectedRecord?.incidentType || "-" },
      { label: "Module", value: sample.module || "-" },
      { label: "Request", value: requestLine || "-" },
      { label: "Employee Email", value: employeeEmail || "-" },
      { label: "Employee Record", value: recordLabel || "-" },
      {
        label: "Viewed Fields",
        value: viewedFieldsSummary || (sample.viewedFieldCount ? `${sample.viewedFieldCount} fields` : "-"),
      },
      {
        label: "Documents Accessed",
        value:
          accessedDocsSummary || (sample.accessedDocumentCount ? `${sample.accessedDocumentCount} document(s)` : "-"),
      },
      { label: "Source IP", value: sample.sourceIp || "-" },
      { label: "Device", value: sample.device || "-" },
      { label: "User Agent", value: sample.userAgent || "-" },
      { label: "Occurred At", value: formatDateTime(sample.occurredAt) },
    ];
  }, [primaryForensicSample, selectedRecord]);

  const statusSummary = useMemo(() => {
    const summaryMap = { Open: 0, "In Progress": 0, Resolved: 0, Closed: 0 };
    records.forEach((record) => {
      const status = String(record?.status || "").trim();
      if (status === "Containment" || status === "Investigating" || status === "Escalated" || status === "Regulatory Review") {
        summaryMap["In Progress"] += 1;
        return;
      }
      if (status === "Resolved") {
        summaryMap.Resolved += 1;
        return;
      }
      if (status === "Closed") {
        summaryMap.Closed += 1;
        return;
      }
      summaryMap.Open += 1;
    });
    return summaryMap;
  }, [records]);

  const severityDistribution = useMemo(() => {
    const buckets = { Low: 0, High: 0 };
    records.forEach((record) => {
      const severity = normalizeSeverityValue(record?.severity, "Low");
      buckets[severity] += 1;
    });
    return buckets;
  }, [records]);

  const recentIncidents = useMemo(() => {
    return [...records]
      .sort((a, b) => new Date(b?.updatedAt || b?.createdAt || 0).getTime() - new Date(a?.updatedAt || a?.createdAt || 0).getTime())
      .slice(0, 6);
  }, [records]);

  const typeDistribution = useMemo(() => {
    const tally = {};
    records.forEach((record) => {
      const type = String(record?.incidentType || "Other").trim() || "Other";
      tally[type] = (tally[type] || 0) + 1;
    });
    return Object.entries(tally).sort((a, b) => b[1] - a[1]);
  }, [records]);

  const incidentTrendsPie = useMemo(() => {
    const total = typeDistribution.reduce((sum, [, count]) => sum + Number(count || 0), 0);
    const palette = ["#0ea5e9", "#14b8a6", "#f97316", "#6366f1", "#ef4444", "#a855f7", "#22c55e", "#06b6d4"];

    let cursor = 0;
    const segments = typeDistribution.map(([type, count], index) => {
      const numericCount = Number(count || 0);
      const ratio = total > 0 ? numericCount / total : 0;
      const start = cursor;
      cursor += ratio;
      return {
        label: type,
        value: numericCount,
        percentage: total > 0 ? Math.round(ratio * 100) : 0,
        color: palette[index % palette.length],
        fromDeg: (start * 360).toFixed(2),
        toDeg: (cursor * 360).toFixed(2),
      };
    });

    const gradient = segments.length
      ? `conic-gradient(${segments.map((segment) => `${segment.color} ${segment.fromDeg}deg ${segment.toDeg}deg`).join(", ")})`
      : "";

    return {
      total,
      segments,
      gradient,
      dominant: segments[0] || null,
    };
  }, [typeDistribution]);

  const recurringSeverityBars = useMemo(() => {
    const low = Number(severityDistribution.Low || 0);
    const high = Number(severityDistribution.High || 0);
    const maxValue = Math.max(low, high, 1);
    return [
      { label: "Low", meta: "Lower impact incidents", value: low, color: "bg-sky-500" },
      { label: "High", meta: "High-impact incidents", value: high, color: "bg-rose-500" },
    ].map((item) => ({
      ...item,
      width: `${Math.round((item.value / maxValue) * 100)}%`,
    }));
  }, [severityDistribution]);

  const alertDispatchInsights = useMemo(() => {
    let incidentsWithDispatch = 0;
    let emailIncidents = 0;
    let smsIncidents = 0;
    let webhookIncidents = 0;

    records.forEach((record) => {
      const dispatch = record?.alertDispatchSummary;
      if (!dispatch || typeof dispatch !== "object") {
        return;
      }
      incidentsWithDispatch += 1;

      const email = dispatch?.email && typeof dispatch.email === "object" ? dispatch.email : {};
      const emailRecipients = Math.max(0, Number(email?.recipientCount || 0));
      if (emailRecipients > 0 || String(email?.status || "").trim()) {
        emailIncidents += 1;
      }

      const sms = dispatch?.sms && typeof dispatch.sms === "object" ? dispatch.sms : {};
      const smsDelivered = Math.max(0, Number(sms?.deliveredCount || 0));
      const smsRecipients = Math.max(0, Number(sms?.recipientCount || 0));
      if (smsRecipients > 0 || smsDelivered > 0 || String(sms?.status || "").trim()) {
        smsIncidents += 1;
      }

      const webhooks = dispatch?.webhooks && typeof dispatch.webhooks === "object" ? dispatch.webhooks : {};
      const webhookTargets = Array.isArray(webhooks?.targets) ? webhooks.targets.length : 0;
      if (webhookTargets > 0 || Number(webhooks?.successCount || 0) > 0 || String(webhooks?.status || "").trim()) {
        webhookIncidents += 1;
      }
    });

    const totalIncidents = records.length;
    const incidentsWithoutDispatch = Math.max(0, totalIncidents - incidentsWithDispatch);
    const coverageMax = Math.max(incidentsWithDispatch, incidentsWithoutDispatch, 1);
    const channelMax = Math.max(emailIncidents, smsIncidents, webhookIncidents, 1);

    return {
      totalIncidents,
      incidentsWithDispatch,
      incidentsWithoutDispatch,
      coverageBars: [
        { label: "With Dispatch", value: incidentsWithDispatch, color: "bg-emerald-500", width: `${Math.round((incidentsWithDispatch / coverageMax) * 100)}%` },
        { label: "Without Dispatch", value: incidentsWithoutDispatch, color: "bg-slate-400", width: `${Math.round((incidentsWithoutDispatch / coverageMax) * 100)}%` },
      ],
      channelBars: [
        { label: "Email", value: emailIncidents, color: "bg-sky-500", width: `${Math.round((emailIncidents / channelMax) * 100)}%` },
        { label: "SMS", value: smsIncidents, color: "bg-indigo-500", width: `${Math.round((smsIncidents / channelMax) * 100)}%` },
        { label: "Webhook", value: webhookIncidents, color: "bg-violet-500", width: `${Math.round((webhookIncidents / channelMax) * 100)}%` },
      ],
    };
  }, [records]);

  return (
    <div className="space-y-4">
      {section === "incident-dashboard" ? (
        <SurfaceCard title="Incident Dashboard" subtitle="Overview of active and historical incidents">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.key} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{card.label}</p>
              <p className="mt-0.5 text-lg font-semibold text-slate-900">{card.value}</p>
            </div>
          ))}
        </div>
        </SurfaceCard>
      ) : null}

      {section === "incident-dashboard" ? (
        <div className="grid gap-3 lg:grid-cols-2">
        <SurfaceCard title="Status Summary" subtitle="Open, in progress, resolved, and closed">
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(statusSummary).map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
                <p className="text-sm font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>
        </SurfaceCard>
        <SurfaceCard title="Severity Distribution" subtitle="Incident mix by severity (High / Low)">
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { label: "Low", value: severityDistribution.Low, tone: "border-sky-200 bg-sky-50/50 text-sky-700" },
              { label: "High", value: severityDistribution.High, tone: "border-rose-200 bg-rose-50/50 text-rose-700" },
            ].map((item) => (
              <div key={item.label} className={`rounded-lg border px-3 py-2 ${item.tone}`}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em]">{item.label}</p>
                <p className="text-sm font-semibold text-slate-900">{item.value}</p>
              </div>
            ))}
          </div>
        </SurfaceCard>
        </div>
      ) : null}

      {section === "incident-dashboard" ? (
        <SurfaceCard title="Recent Activity" subtitle="Latest incident updates">
        {recentIncidents.length === 0 ? (
          <EmptyState title="No incidents yet" subtitle="Once incidents are logged, they will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                  <th className="px-2 py-3 font-medium">Incident</th>
                  <th className="px-2 py-3 font-medium">Status</th>
                  <th className="px-2 py-3 font-medium">Severity</th>
                  <th className="px-2 py-3 font-medium">Updated</th>
                  <th className="px-2 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {recentIncidents.map((record) => (
                  <tr key={record.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                    <td className="px-2 py-3">
                      <p className="font-medium text-slate-900">{getRecordLabel(record)}</p>
                      <p className="text-xs text-slate-500">{String(record?.incidentCode || "N/A")}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {String(record?.alertDescription || record?.summary || "No description provided.")}
                      </p>
                      <p className="mt-1 text-xs font-medium text-sky-700">
                        Occurrences: {Number(record?.alertOccurrenceCount || 1)}
                      </p>
                    </td>
                    <td className="px-2 py-3"><StatusBadge value={record?.status || "Open"} /></td>
                    <td className="px-2 py-3"><StatusBadge value={normalizeSeverityValue(record?.severity, "Low")} /></td>
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
        </SurfaceCard>
      ) : null}

      {section === "report-incident" ? (
        <SurfaceCard
        title="Report Incident / Create Case"
        subtitle="Log a new incident, assign severity, and attach evidence."
        action={
          canEdit ? (
            <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex h-9 items-center rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white transition hover:bg-sky-700"
              >
                Open Full Form
              </button>
            ) : null
          }
        >
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
                value={createForm.incidentType}
                onChange={(event) => setCreateForm((current) => ({ ...current, incidentType: event.target.value }))}
                className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
              >
                {INCIDENT_TYPE_OPTIONS.map((type) => (
                  <option key={`inline-type-${type}`} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <select
                value={createForm.severity}
                onChange={(event) => setCreateForm((current) => ({ ...current, severity: event.target.value }))}
                className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
              >
                {SEVERITY_OPTIONS.map((severity) => (
                  <option key={`inline-sev-${severity}`} value={severity}>
                    {severity}
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
                value={createForm.department}
                onChange={(event) => setCreateForm((current) => ({ ...current, department: event.target.value }))}
                placeholder="Department (optional)"
                className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
              />
              <input
                value={createForm.affectedEmployeeEmail}
                onChange={(event) => setCreateForm((current) => ({ ...current, affectedEmployeeEmail: event.target.value }))}
                placeholder="Involved employee email"
                className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
              />
              <input
                value={createForm.involvedEmployees}
                onChange={(event) => setCreateForm((current) => ({ ...current, involvedEmployees: event.target.value }))}
                placeholder="Additional involved employees (comma separated)"
                className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none md:col-span-2"
              />
              <textarea
                value={createForm.summary}
                onChange={(event) => setCreateForm((current) => ({ ...current, summary: event.target.value }))}
                placeholder="Incident description"
                rows={3}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-sky-400 focus:outline-none md:col-span-2"
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <input type="checkbox" checked={createForm.restrictedPiiInvolved} onChange={(event) => setCreateForm((current) => ({ ...current, restrictedPiiInvolved: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                <span className="text-xs text-slate-700">Restricted PII involved</span>
              </label>
              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <input type="checkbox" checked={createForm.regulatoryNotificationRequired} onChange={(event) => setCreateForm((current) => ({ ...current, regulatoryNotificationRequired: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                <span className="text-xs text-slate-700">Regulatory notification required</span>
              </label>
            </div>

            <div className="rounded-lg border border-dashed border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-slate-900">Attachments</p>
                  <p className="text-[11px] text-slate-500">Upload initial evidence (optional).</p>
                </div>
                <button
                  type="button"
                  onClick={() => createEvidenceInputRef.current?.click()}
                  className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Add Files
                </button>
              </div>
              <input ref={createEvidenceInputRef} type="file" className="hidden" multiple onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = "";
                if (files.length === 0) return;
                setCreateAttachments((current) => [...current, ...files]);
              }} />
              {createAttachments.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  {createAttachments.map((file, index) => (
                    <li key={`${file.name}-${index}`} className="flex items-center justify-between">
                      <span>{file.name}</span>
                      <button type="button" onClick={() => setCreateAttachments((current) => current.filter((_, idx) => idx !== index))} className="text-rose-500">Remove</button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-slate-500">No files attached.</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <button type="submit" disabled={!canEdit || isSubmittingCreate} className="inline-flex h-9 items-center rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60">
                {isSubmittingCreate ? "Submitting..." : "Submit Incident"}
              </button>
            </div>
          </form>
        </SurfaceCard>
      ) : null}

      {section === "incident-list" ? (
        <SurfaceCard
        title="Incident List / Case Management"
        subtitle="Track cases, assign handling, and monitor status updates."
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
            <input value={filters.department} onChange={(event) => setFilter("department", event.target.value)} placeholder="Department" className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none" />
            <input type="date" value={filters.dateFrom} onChange={(event) => setFilter("dateFrom", event.target.value)} className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none" />
            <input type="date" value={filters.dateTo} onChange={(event) => setFilter("dateTo", event.target.value)} className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none" />
          </div>

          <div className="mt-4">
            <LoadingTransition isLoading={isLoading} skeleton={<TableSkeleton rows={8} columns={7} />}>
              {filteredByAdvanced.length === 0 ? (
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
                      {filteredByAdvanced.map((record) => (
                        <tr key={record.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                          <td className="px-2 py-3">
                            <p className="font-medium text-slate-900">{getRecordLabel(record)}</p>
                            <p className="text-xs text-slate-500">{String(record?.incidentCode || "N/A")}</p>
                            <p className="mt-1 max-w-[32rem] text-xs text-slate-600">
                              {String(record?.alertDescription || record?.summary || "No description provided.")}
                            </p>
                            <p className="mt-1 text-xs font-medium text-sky-700">
                              Occurrences: {Number(record?.alertOccurrenceCount || 1)}
                            </p>
                          </td>
                          <td className="px-2 py-3"><StatusBadge value={normalizeSeverityValue(record?.severity, "Low")} /></td>
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
            </LoadingTransition>
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
      ) : null}


      {section === "reports-analytics" ? (
        <SurfaceCard title="Reports & Analytics" subtitle="Incident trends and recurring issue severity">
          <div className="grid gap-3 lg:grid-cols-2">
            <SurfaceCard title="Incident Trends" subtitle="Pie chart by incident type">
              {incidentTrendsPie.total <= 0 ? (
                <EmptyState title="No data yet" subtitle="Incident trends will appear after cases are logged." />
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                    <div
                      className="h-44 w-44 shrink-0 rounded-full border border-slate-200 shadow-[0_14px_34px_-28px_rgba(15,23,42,0.5)]"
                      style={{ backgroundImage: incidentTrendsPie.gradient }}
                      aria-label="Incident trends pie chart"
                    />
                    <ul className="w-full space-y-2 text-xs text-slate-600">
                      {incidentTrendsPie.segments.map((segment) => (
                        <li key={segment.label} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <span className="inline-flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                            <span>{segment.label}</span>
                          </span>
                          <span className="font-semibold text-slate-900">{segment.value} ({segment.percentage}%)</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {incidentTrendsPie.dominant ? (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      Top incident type: <span className="font-semibold text-slate-900">{incidentTrendsPie.dominant.label}</span>
                    </p>
                  ) : null}
                </div>
              )}
            </SurfaceCard>

            <SurfaceCard title="Recurring Issues" subtitle="High vs low incident volume">
              <div className="space-y-3">
                {recurringSeverityBars.map((item) => (
                  <div key={item.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span className="font-semibold text-slate-800">{item.label}</span>
                      <span>{item.value}</span>
                    </div>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${item.color}`} style={{ width: item.width }} />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">{item.meta}</p>
                  </div>
                ))}
              </div>
            </SurfaceCard>
          </div>

          <SurfaceCard title="Alert Dispatch Coverage" subtitle="Dispatch readiness and channel usage">
            {alertDispatchInsights.totalIncidents <= 0 ? (
              <EmptyState title="No alert dispatch data" subtitle="Coverage and channel charts appear after incidents are logged." />
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Coverage</p>
                    <div className="mt-2 space-y-2">
                      {alertDispatchInsights.coverageBars.map((item) => (
                        <div key={item.label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="flex items-center justify-between text-xs text-slate-700">
                            <span className="font-semibold">{item.label}</span>
                            <span>{item.value}</span>
                          </div>
                          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                            <div className={`h-full rounded-full ${item.color}`} style={{ width: item.width }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Channel Mix</p>
                    <div className="mt-2 space-y-2">
                      {alertDispatchInsights.channelBars.map((item) => (
                        <div key={item.label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="flex items-center justify-between text-xs text-slate-700">
                            <span className="font-semibold">{item.label}</span>
                            <span>{item.value}</span>
                          </div>
                          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                            <div className={`h-full rounded-full ${item.color}`} style={{ width: item.width }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </SurfaceCard>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
              Export PDF
            </button>
            <button type="button" className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
              Export Excel
            </button>
          </div>
        </SurfaceCard>
      ) : null}

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
                <input
                  value={createForm.department}
                  onChange={(event) => setCreateForm((current) => ({ ...current, department: event.target.value }))}
                  placeholder="Department (optional)"
                  className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                />
                <input
                  value={createForm.involvedEmployees}
                  onChange={(event) => setCreateForm((current) => ({ ...current, involvedEmployees: event.target.value }))}
                  placeholder="Additional involved employees (comma separated)"
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

              <div className="rounded-lg border border-dashed border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-900">Attachments</p>
                    <p className="text-[11px] text-slate-500">Upload initial evidence (optional).</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => createEvidenceInputRef.current?.click()}
                    className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Add Files
                  </button>
                </div>
                <input ref={createEvidenceInputRef} type="file" className="hidden" multiple onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  event.target.value = "";
                  if (files.length === 0) return;
                  setCreateAttachments((current) => [...current, ...files]);
                }} />
                {createAttachments.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {createAttachments.map((file, index) => (
                      <li key={`${file.name}-${index}`} className="flex items-center justify-between">
                        <span>{file.name}</span>
                        <button type="button" onClick={() => setCreateAttachments((current) => current.filter((_, idx) => idx !== index))} className="text-rose-500">Remove</button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">No files attached.</p>
                )}
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

            <LoadingTransition
              isLoading={isLoadingRecord || !selectedRecord || !recordDraft}
              skeleton={<FormSkeleton fields={8} showActions={false} className="max-h-[72vh] overflow-hidden" />}
            >
              <div className="max-h-[72vh] space-y-3 overflow-y-auto pr-1">
                <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 sm:grid-cols-2 lg:grid-cols-6">
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
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Occurrences</p>
                    <p className="text-xs font-semibold text-slate-900">{Number(selectedRecord?.alertOccurrenceCount || 1)}</p>
                    <p className="text-xs text-slate-500">Last: {formatDateTime(selectedRecord?.alertLastObservedAt)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Alert Rule</p>
                    <p className="text-xs font-semibold text-slate-900">{String(selectedRecord?.detectionRuleId || "-")}</p>
                    <p className="text-xs text-slate-500">{String(selectedRecord?.incidentType || "-")}</p>
                  </div>
                </div>

                <SurfaceCard
                  title="Alert Occurrence History"
                  subtitle="Consolidated alert hits for this incident (newest first)"
                >
                  {Array.isArray(selectedRecord?.alertOccurrences) &&
                  selectedRecord.alertOccurrences.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-xs text-slate-700">
                        <thead>
                          <tr className="border-b border-slate-200 text-[11px] uppercase tracking-[0.08em] text-slate-500">
                            <th className="px-2 py-2 font-semibold">#</th>
                            <th className="px-2 py-2 font-semibold">When</th>
                            <th className="px-2 py-2 font-semibold">Activity</th>
                            <th className="px-2 py-2 font-semibold">Module</th>
                            <th className="px-2 py-2 font-semibold">Actor</th>
                            <th className="px-2 py-2 font-semibold">Source IP</th>
                            <th className="px-2 py-2 font-semibold">Path</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...selectedRecord.alertOccurrences]
                            .reverse()
                            .map((entry, index) => {
                              const entryId = String(
                                entry?.id || entry?.occurredAt || `${entry?.activityName || "entry"}-${index}`,
                              );
                              return (
                                <tr key={`occ-${entryId}-${index}`} className="border-b border-slate-100 align-top">
                                  <td className="px-2 py-2 text-slate-500">
                                    {Number(selectedRecord?.alertOccurrenceCount || selectedRecord.alertOccurrences.length) - index}
                                  </td>
                                  <td className="px-2 py-2">{formatDateTime(entry?.occurredAt)}</td>
                                  <td className="px-2 py-2">{String(entry?.activityName || "-")}</td>
                                  <td className="px-2 py-2">{String(entry?.module || "-")}</td>
                                  <td className="px-2 py-2">{String(entry?.actorEmail || "-")}</td>
                                  <td className="px-2 py-2">{String(entry?.sourceIp || "-")}</td>
                                  <td className="px-2 py-2">{String(entry?.requestPath || "-")}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">No occurrence history recorded yet.</p>
                  )}
                </SurfaceCard>

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

                <SurfaceCard title="Audit Trail / Activity Logs" subtitle="Change history, actions, and compliance traceability">
                  {Array.isArray(selectedRecord?.traceability) && selectedRecord.traceability.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                            <th className="px-2 py-3 font-medium">When</th>
                            <th className="px-2 py-3 font-medium">By</th>
                            <th className="px-2 py-3 font-medium">Action</th>
                            <th className="px-2 py-3 font-medium">Status</th>
                            <th className="px-2 py-3 font-medium">Severity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedRecord.traceability.map((entry, index) => (
                            <tr key={`${entry?.at || "audit"}-${index}`} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                              <td className="px-2 py-3 text-xs text-slate-600">{formatDateTime(entry?.at)}</td>
                              <td className="px-2 py-3 text-xs">{String(entry?.by || "-")}</td>
                              <td className="px-2 py-3 text-xs">{String(entry?.action || "-")}</td>
                              <td className="px-2 py-3 text-xs">{String(entry?.status || "-")}</td>
                              <td className="px-2 py-3 text-xs">{String(entry?.severity || "-")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <EmptyState title="No audit trail entries" subtitle="Updates will appear here as actions occur." />
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

                <SurfaceCard title="Notes" subtitle="Additional incident context and forensic details">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    <textarea
                      value={recordDraft.notes}
                      onChange={(event) => setRecordDraft((current) => ({ ...current, notes: event.target.value }))}
                      rows={8}
                      disabled={!canEdit || isSavingRecord}
                      className="min-h-[180px] w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100"
                    />
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                        Investigation Context
                      </p>
                      <div className="mt-2 space-y-2 text-xs text-slate-700">
                        {forensicContextRows.map((row) => (
                          <div key={row.label} className="flex flex-col gap-0.5">
                            <span className="text-[11px] uppercase tracking-[0.08em] text-slate-500">{row.label}</span>
                            <span className="font-medium text-slate-900">{row.value || "-"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
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
            </LoadingTransition>
          </div>
        </div>
      ) : null}
    </div>
  );
}
