"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SurfaceCard from "@/components/hris/SurfaceCard";
import EmptyState from "@/components/hris/shared/EmptyState";
import StatusBadge from "@/components/hris/shared/StatusBadge";
import { formatEmployeeName, formatPersonName } from "@/lib/name-utils";
import { hrisApi } from "@/services/hris-api-client";
import { toSubTabAnchor } from "@/lib/subtab-anchor";
import {
  removeStorageObjectByPath,
  uploadLifecycleEvidenceToStorage,
} from "@/services/firebase-storage-client";

const SECTION_TABS = [
  { id: "workflow-status-tracking", label: "Workflow Status Tracking" },
  { id: "onboarding", label: "Onboarding" },
  { id: "role-changes", label: "Role Changes" },
  { id: "disciplinary-records", label: "Disciplinary Records" },
  { id: "offboarding-access-revocation", label: "Offboarding + Access Revocation" },
];

const CATEGORY_BY_SECTION = {
  onboarding: "Onboarding",
  "role-changes": "Role Change",
  "disciplinary-records": "Disciplinary",
  "offboarding-access-revocation": "Offboarding",
};

const SECTION_DESCRIPTIONS = {
  "workflow-status-tracking": "Unified tracking view across onboarding, role changes, disciplinary actions, and offboarding.",
  onboarding: "Employee onboarding workflows with activation and completion tracking.",
  "role-changes": "Role/department movement workflows with approval and effectivity details.",
  "disciplinary-records": "Disciplinary case workflows with controlled updates and timeline visibility.",
  "offboarding-access-revocation": "Offboarding workflows with access revocation and account disablement trail.",
};

const WORKFLOW_PLAYBOOK = {
  onboarding: {
    stages: ["Initiated", "Document Verification", "Access Provisioning", "Activation"],
    tasks: [
      "Collect employee profile and contacts",
      "Validate contract and onboarding requirements",
      "Activate employee account",
    ],
  },
  "role-change": {
    stages: ["Initiated", "Approval Review", "Role Sync", "Completed"],
    tasks: [
      "Attach role-change justification",
      "Validate effective date and scope",
      "Apply role and permission sync",
    ],
  },
  disciplinary: {
    stages: ["Case Opened", "Investigation", "Decision", "Closed"],
    tasks: [
      "Record incident report",
      "Attach and review case evidence",
      "Finalize disciplinary decision",
    ],
  },
  offboarding: {
    stages: ["Initiated", "Clearance", "Access Revocation", "Archived"],
    tasks: [
      "Start employee clearance checklist",
      "Disable account and revoke access",
      "Archive employee records",
    ],
  },
};

const DEFAULT_ROLE_ASSIGNMENT_OPTIONS = [
  { value: "SUPER_ADMIN", label: "Super Admin" },
  { value: "GRC", label: "GRC" },
  { value: "HR", label: "HR" },
  { value: "EA", label: "EA" },
  { value: "EMPLOYEE_L1", label: "Employee (L1)" },
  { value: "EMPLOYEE_L2", label: "Employee (L2)" },
  { value: "EMPLOYEE_L3", label: "Employee (L3)" },
];

const DEFAULT_DEPARTMENT_OPTIONS = [
  {
    value: "Governance, Risk, and Compliance (GRC)",
    label: "Governance, Risk, and Compliance (GRC)",
  },
  {
    value: "Research and Development (R&D)",
    label: "Research and Development (R&D)",
  },
  {
    value: "Cyber Security Operations Center (CSOC)",
    label: "Cyber Security Operations Center (CSOC)",
  },
  {
    value: "Threat Intelligence (TI)",
    label: "Threat Intelligence (TI)",
  },
];

const ROLE_LABEL_BY_ID = new Map([
  ["SUPER_ADMIN", "Super Admin"],
  ["GRC", "GRC"],
  ["HR", "HR"],
  ["EA", "EA"],
  ["EMPLOYEE", "Employee (L1)"],
  ["EMPLOYEE_L1", "Employee (L1)"],
  ["EMPLOYEE_L2", "Employee (L2)"],
  ["EMPLOYEE_L3", "Employee (L3)"],
]);
const SUPPORTED_LIFECYCLE_ROLE_KEYS = new Set([
  "SUPER_ADMIN",
  "GRC",
  "HR",
  "EA",
  "EMPLOYEE",
  "EMPLOYEE_L1",
  "EMPLOYEE_L2",
  "EMPLOYEE_L3",
]);

const initialForm = {
  employeeRecordId: "",
  employeeEmail: "",
  employee: "",
  category: "Onboarding",
  owner: "",
  status: "In Progress",
  roleFrom: "",
  roleTo: "",
  departmentFrom: "",
  departmentTo: "",
  effectiveDate: "",
  justification: "",
  details: "",
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

function formatDateShort(value) {
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

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function valueOrDash(value) {
  const normalized = String(value || "").trim();
  return normalized || "-";
}

function requestActionConfirmation(message) {
  if (typeof window === "undefined") {
    return true;
  }
  return window.confirm(message);
}

function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeRoleValue(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toRoleLabel(value) {
  const normalized = normalizeRoleValue(value);
  if (!normalized) {
    return "-";
  }
  return ROLE_LABEL_BY_ID.get(normalized) || value;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function toCatalogOption(entry) {
  const value = String(entry?.value || "").trim();
  const label = String(entry?.label || value).trim();
  if (!value) {
    return null;
  }
  return {
    value,
    label: label || value,
  };
}

function mergeCatalogOptions(primary, fallback) {
  const merged = [];
  const seen = new Set();

  [...ensureArray(primary), ...ensureArray(fallback)].forEach((entry) => {
    const option = toCatalogOption(entry);
    if (!option) {
      return;
    }
    const key = normalizeText(`${option.value}::${option.label}`);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(option);
  });

  return merged;
}

function isEmployeeLifecycleRoleValue(value) {
  const normalized = normalizeRoleValue(value);
  return normalized === "EMPLOYEE" || normalized.startsWith("EMPLOYEE_");
}

function resolveWorkflowOwner(session) {
  const email = String(session?.email || "").trim().toLowerCase();
  const fullName = formatPersonName({
    firstName: session?.firstName,
    middleName: session?.middleName,
    lastName: session?.lastName,
    fallbackEmail: email,
    fallbackLabel: "System",
  });
  if (!email || fullName.toLowerCase() === email) {
    return fullName;
  }
  return `${fullName} (${email})`;
}

function isRoleMovementCategory(category) {
  const normalized = normalizeText(category);
  return normalized === "role change";
}

function resolveWorkflowTypeFromCategory(category) {
  const normalized = normalizeText(category);
  if (normalized.includes("role") || normalized.includes("promotion")) {
    return "role-change";
  }
  if (normalized.includes("disciplin")) {
    return "disciplinary";
  }
  if (normalized.includes("offboard") || normalized.includes("resign") || normalized.includes("terminate")) {
    return "offboarding";
  }
  return "onboarding";
}

function buildLifecycleDetailsPayload(form) {
  const details = {
    note: String(form.details || "").trim(),
  };

  if (isRoleMovementCategory(form.category)) {
    details.roleFrom = String(form.roleFrom || "").trim();
    details.roleTo = String(form.roleTo || "").trim();
    details.departmentFrom = String(form.departmentFrom || "").trim();
    details.departmentTo = String(form.departmentTo || "").trim();
    details.effectiveDate = String(form.effectiveDate || "").trim();
    details.justification = String(form.justification || "").trim();
  }

  return details;
}

function getRoleMovementSummary(record) {
  const details = record?.details && typeof record.details === "object" ? record.details : null;
  if (!details) {
    return "";
  }

  const roleFrom = String(details.roleFrom || "").trim();
  const roleTo = String(details.roleTo || "").trim();
  const departmentFrom = String(details.departmentFrom || "").trim();
  const departmentTo = String(details.departmentTo || "").trim();
  const effectiveDate = String(details.effectiveDate || "").trim();

  if (!roleFrom && !roleTo && !departmentFrom && !departmentTo && !effectiveDate) {
    return "";
  }

  const parts = [];
  if (roleFrom || roleTo) {
    parts.push(`Role: ${toRoleLabel(roleFrom)} -> ${toRoleLabel(roleTo)}`);
  }
  if (departmentFrom || departmentTo) {
    parts.push(`Department: ${departmentFrom || "-"} -> ${departmentTo || "-"}`);
  }
  if (effectiveDate) {
    parts.push(`Effective: ${effectiveDate}`);
  }

  return parts.join(" | ");
}

function summarizeLifecycleEffects(effects) {
  const rows = Array.isArray(effects) ? effects : [];
  const messages = rows
    .map((effect) => {
      if (typeof effect === "string") {
        return effect.trim();
      }
      return String(effect?.message || "").trim();
    })
    .filter(Boolean);

  return messages.join(" ");
}

function getAutomationSummary(record) {
  const summary = summarizeLifecycleEffects(record?.lastAutomationEffects);
  return summary;
}

function getChecklistProgress(record) {
  const checklist = Array.isArray(record?.workflow?.checklist) ? record.workflow.checklist : [];
  const required = checklist.filter((task) => task?.required !== false);
  const completed = required.filter((task) => normalizeText(task?.status) === "completed").length;
  return {
    completed,
    total: required.length,
  };
}

function getApprovalProgress(record) {
  const chain = Array.isArray(record?.workflow?.approvalChain) ? record.workflow.approvalChain : [];
  const approved = chain.filter((step) => normalizeText(step?.status) === "approved").length;
  return {
    approved,
    total: chain.length,
  };
}

function isOffboardingRecord(record) {
  const category = normalizeText(record?.category);
  return category.includes("offboard") || category.includes("resign") || category.includes("terminate");
}

function composeEmployeeName(record) {
  return formatEmployeeName({
    firstName: record?.firstName,
    middleName: record?.middleName,
    lastName: record?.lastName,
    suffix: record?.suffix,
    fallback: record?.name,
    fallbackEmail: record?.email,
    fallbackLabel: "Unnamed Employee",
  });
}

function toEmployeeOption(record) {
  const id = String(record?.id || "").trim();
  const email = String(record?.email || "").trim().toLowerCase();
  if (!id || !email) {
    return null;
  }

  return {
    id,
    email,
    name: composeEmployeeName(record),
    currentRole: String(record?.role || "").trim(),
    currentDepartment: String(record?.department || "").trim(),
  };
}

export default function EmploymentLifecycleModule({ session }) {
  const actorRole = session?.role || "EMPLOYEE_L1";
  const actorRoleId = normalizeRoleValue(actorRole);
  const employeeRole = isEmployeeRole(actorRole);
  const canManage = !employeeRole;
  const workflowOwner = resolveWorkflowOwner(session);

  const [section, setSection] = useState("workflow-status-tracking");
  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isWorkflowConsoleOpen, setIsWorkflowConsoleOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [isLoadingEmployeeOptions, setIsLoadingEmployeeOptions] = useState(false);
  const [employeeOptionsError, setEmployeeOptionsError] = useState("");
  const [referenceCatalog, setReferenceCatalog] = useState({
    roles: DEFAULT_ROLE_ASSIGNMENT_OPTIONS,
    departments: DEFAULT_DEPARTMENT_OPTIONS,
  });
  const [isLoadingReferenceCatalog, setIsLoadingReferenceCatalog] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [approvalNote, setApprovalNote] = useState("");

  const evidenceInputRef = useRef(null);

  const activeSectionTab = useMemo(
    () => SECTION_TABS.find((tab) => tab.id === section) || SECTION_TABS[0],
    [section],
  );
  const activeSectionCategory = CATEGORY_BY_SECTION[section] || "";
  const activeSectionDescription = SECTION_DESCRIPTIONS[section] || SECTION_DESCRIPTIONS["workflow-status-tracking"];
  const roleCatalogOptions = useMemo(
    () => mergeCatalogOptions(referenceCatalog.roles, DEFAULT_ROLE_ASSIGNMENT_OPTIONS),
    [referenceCatalog.roles],
  );
  const departmentCatalogOptions = useMemo(
    () => mergeCatalogOptions(referenceCatalog.departments, DEFAULT_DEPARTMENT_OPTIONS),
    [referenceCatalog.departments],
  );
  const availableRoleTargets = useMemo(
    () =>
      roleCatalogOptions.filter((option) => {
        const normalized = normalizeRoleValue(option.value);
        if (!normalized || !SUPPORTED_LIFECYCLE_ROLE_KEYS.has(normalized)) {
          return false;
        }
        if (actorRoleId === "SUPER_ADMIN") {
          return true;
        }
        return isEmployeeLifecycleRoleValue(option.value);
      }),
    [actorRoleId, roleCatalogOptions],
  );

  const loadRecords = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const payload = await hrisApi.lifecycle.list();
      setRecords(Array.isArray(payload.records) ? payload.records : []);
    } catch (error) {
      setErrorMessage(error.message || "Unable to load lifecycle records.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const loadReferenceCatalog = useCallback(async () => {
    if (!canManage) {
      setReferenceCatalog({
        roles: DEFAULT_ROLE_ASSIGNMENT_OPTIONS,
        departments: DEFAULT_DEPARTMENT_OPTIONS,
      });
      return;
    }

    setIsLoadingReferenceCatalog(true);
    try {
      const payload = await hrisApi.settings.referenceData.list();
      setReferenceCatalog({
        roles: mergeCatalogOptions(payload?.catalogs?.roles, DEFAULT_ROLE_ASSIGNMENT_OPTIONS),
        departments: mergeCatalogOptions(payload?.catalogs?.departments, DEFAULT_DEPARTMENT_OPTIONS),
      });
    } catch {
      setReferenceCatalog({
        roles: DEFAULT_ROLE_ASSIGNMENT_OPTIONS,
        departments: DEFAULT_DEPARTMENT_OPTIONS,
      });
    } finally {
      setIsLoadingReferenceCatalog(false);
    }
  }, [canManage]);

  useEffect(() => {
    loadReferenceCatalog();
  }, [loadReferenceCatalog]);

  const loadEmployeeOptions = useCallback(async () => {
    if (!canManage) {
      return;
    }

    setIsLoadingEmployeeOptions(true);
    setEmployeeOptionsError("");
    try {
      const payload = await hrisApi.employees.list({
        page: 1,
        pageSize: 200,
      });

      const rows = Array.isArray(payload?.records) ? payload.records : [];
      const uniqueOptions = [];
      const seenIds = new Set();

      rows.forEach((row) => {
        const option = toEmployeeOption(row);
        if (!option || seenIds.has(option.id)) {
          return;
        }
        seenIds.add(option.id);
        uniqueOptions.push(option);
      });

      setEmployeeOptions(uniqueOptions);
    } catch (error) {
      setEmployeeOptions([]);
      setEmployeeOptionsError(error.message || "Unable to load employee directory options.");
    } finally {
      setIsLoadingEmployeeOptions(false);
    }
  }, [canManage]);

  useEffect(() => {
    loadEmployeeOptions();
  }, [loadEmployeeOptions]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      owner: workflowOwner,
    }));
  }, [workflowOwner]);

  useEffect(() => {
    if (!canManage || employeeOptions.length === 0) {
      return;
    }

    setForm((current) => {
      if (current.employeeRecordId && employeeOptions.some((option) => option.id === current.employeeRecordId)) {
        return current;
      }

      const firstOption = employeeOptions[0];
      return {
        ...current,
        employeeRecordId: firstOption.id,
        employee: firstOption.name,
        employeeEmail: firstOption.email,
        roleFrom: firstOption.currentRole || "",
        departmentFrom: firstOption.currentDepartment || "",
      };
    });
  }, [canManage, employeeOptions]);

  useEffect(() => {
    if (!isCreateModalOpen || typeof window === "undefined") {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !isSubmitting) {
        setIsCreateModalOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isCreateModalOpen, isSubmitting]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const allowed = new Set(SECTION_TABS.map((tab) => tab.id));
    const syncSectionFromHash = (rawHash = window.location.hash) => {
      const hash = String(rawHash || "")
        .replace(/^#/, "")
        .trim()
        .toLowerCase();
      if (!hash) {
        setSection("workflow-status-tracking");
        return;
      }

      const matched = SECTION_TABS.find((tab) => toSubTabAnchor(tab.id) === hash);
      if (matched && allowed.has(matched.id)) {
        setSection(matched.id);
      }
    };

    const onSubTabAnchor = (event) => {
      const nextAnchor = event?.detail?.anchor;
      if (!nextAnchor) {
        syncSectionFromHash();
        return;
      }
      syncSectionFromHash(nextAnchor);
    };

    syncSectionFromHash();
    window.addEventListener("hashchange", syncSectionFromHash);
    window.addEventListener("popstate", syncSectionFromHash);
    window.addEventListener("clio:subtab-anchor", onSubTabAnchor);
    return () => {
      window.removeEventListener("hashchange", syncSectionFromHash);
      window.removeEventListener("popstate", syncSectionFromHash);
      window.removeEventListener("clio:subtab-anchor", onSubTabAnchor);
    };
  }, []);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const bySection =
        section === "workflow-status-tracking"
          ? true
          : normalizeText(record.category).includes(normalizeText(CATEGORY_BY_SECTION[section]));
      const byStatus = selectedStatus ? normalizeText(record.status).includes(normalizeText(selectedStatus)) : true;
      const byQuery = searchQuery
        ? [record.employee, record.employeeEmail, record.category, record.owner, record.status]
            .map((item) => normalizeText(item))
            .some((item) => item.includes(normalizeText(searchQuery)))
        : true;
      return bySection && byStatus && byQuery;
    });
  }, [records, section, selectedStatus, searchQuery]);

  useEffect(() => {
    if (filteredRecords.length === 0) {
      setSelectedRecordId("");
      setIsWorkflowConsoleOpen(false);
      return;
    }
    if (selectedRecordId && !filteredRecords.some((record) => record.id === selectedRecordId)) {
      setSelectedRecordId("");
      setIsWorkflowConsoleOpen(false);
    }
  }, [filteredRecords, selectedRecordId]);

  useEffect(() => {
    if (!isWorkflowConsoleOpen || typeof window === "undefined") {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !isSubmitting) {
        setIsWorkflowConsoleOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isWorkflowConsoleOpen, isSubmitting]);

  const activeRecord = useMemo(
    () => records.find((record) => record.id === selectedRecordId) || null,
    [records, selectedRecordId],
  );
  const activeChecklist = Array.isArray(activeRecord?.workflow?.checklist) ? activeRecord.workflow.checklist : [];
  const activeApprovalChain = Array.isArray(activeRecord?.workflow?.approvalChain)
    ? activeRecord.workflow.approvalChain
    : [];
  const activeStages = Array.isArray(activeRecord?.workflow?.stages) ? activeRecord.workflow.stages : [];
  const activeStageIndex = Number.isFinite(Number(activeRecord?.workflow?.stageIndex))
    ? Number(activeRecord.workflow.stageIndex)
    : 0;
  const activeEvidence = Array.isArray(activeRecord?.evidence) ? activeRecord.evidence : [];
  const pendingApprovalStep = activeApprovalChain.find((step) => normalizeText(step?.status) === "pending") || null;
  const canActorApproveStep =
    canManage && pendingApprovalStep && normalizeRoleValue(pendingApprovalStep.role) === actorRoleId;

  const summaryMetrics = useMemo(() => {
    const pending = filteredRecords.filter((record) => normalizeText(record.status).includes("pending")).length;
    const approved = filteredRecords.filter((record) => normalizeText(record.status).includes("approved")).length;
    const breached = filteredRecords.filter((record) => Boolean(record?.workflow?.slaBreached)).length;
    const revoked = filteredRecords.filter((record) => normalizeText(record.status).includes("revoked")).length;
    return {
      total: filteredRecords.length,
      pending,
      approved,
      breached,
      revoked,
    };
  }, [filteredRecords]);

  const sectionWorkflowType =
    section === "workflow-status-tracking" ? "onboarding" : resolveWorkflowTypeFromCategory(activeSectionCategory);
  const sectionPlaybook = WORKFLOW_PLAYBOOK[sectionWorkflowType] || WORKFLOW_PLAYBOOK.onboarding;

  const handleFormField = (field) => (event) => {
    setForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const handleEmployeeSelection = (event) => {
    const selectedId = event.target.value;
    const option = employeeOptions.find((entry) => entry.id === selectedId);

    setForm((current) => ({
      ...current,
      employeeRecordId: selectedId,
      employee: option?.name || "",
      employeeEmail: option?.email || "",
      roleFrom: option?.currentRole || "",
      departmentFrom: option?.currentDepartment || "",
    }));
  };

  const createRecord = async (event) => {
    event.preventDefault();
    if (!canManage) {
      return;
    }

    if (isRoleMovementCategory(form.category)) {
      const roleFrom = String(form.roleFrom || "").trim();
      const roleTo = String(form.roleTo || "").trim();
      if (!roleFrom || !roleTo) {
        setErrorMessage("Current role is missing on employee record. Set employee role first, then select new role.");
        return;
      }
      const departmentFrom = String(form.departmentFrom || "").trim();
      if (!departmentFrom) {
        setErrorMessage("Current department is missing on employee record. Set employee department first.");
        return;
      }
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const response = await hrisApi.lifecycle.create({
        employeeEmail: form.employeeEmail,
        employee: form.employee,
        category: form.category,
        owner: workflowOwner,
        status: form.status,
        details: buildLifecycleDetailsPayload(form),
      });
      setForm(initialForm);
      setIsCreateModalOpen(false);
      const effectSummary = summarizeLifecycleEffects(response?.effects);
      setSuccessMessage(effectSummary ? `Lifecycle workflow created. ${effectSummary}` : "Lifecycle workflow created.");
      await loadRecords();
    } catch (error) {
      setErrorMessage(error.message || "Unable to create lifecycle workflow.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateStatus = async (record, status, confirmationText) => {
    if (!record?.id || !canManage) {
      return;
    }
    if (confirmationText && !requestActionConfirmation(confirmationText)) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const response = await hrisApi.lifecycle.update(record.id, {
        status,
      });
      const effectSummary = summarizeLifecycleEffects(response?.effects);
      setSuccessMessage(
        effectSummary
          ? `Workflow status updated to ${status}. ${effectSummary}`
          : `Workflow status updated to ${status}.`,
      );
      await loadRecords();
    } catch (error) {
      setErrorMessage(error.message || "Unable to update lifecycle status.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleChecklistTask = async (record, task, completed) => {
    if (!record?.id || !task?.id || !canManage) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await hrisApi.lifecycle.update(record.id, {
        workflowAction: {
          type: "toggle-task",
          taskId: task.id,
          completed,
        },
      });
      setSuccessMessage(completed ? "Checklist task marked as completed." : "Checklist task reverted to pending.");
      await loadRecords();
    } catch (error) {
      setErrorMessage(error.message || "Unable to update checklist task.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const setWorkflowStage = async (record, stageIndex) => {
    if (!record?.id || !canManage) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await hrisApi.lifecycle.update(record.id, {
        workflowAction: {
          type: "set-stage",
          stageIndex,
        },
      });
      setSuccessMessage("Workflow stage updated.");
      await loadRecords();
    } catch (error) {
      setErrorMessage(error.message || "Unable to update workflow stage.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const processApproval = async (record, decision) => {
    if (!record?.id || !canManage) {
      return;
    }

    const label = normalizeText(decision) === "approve" ? "approve" : "reject";
    if (!requestActionConfirmation(`Confirm ${label} current approval step?`)) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const response = await hrisApi.lifecycle.approve(record.id, {
        decision,
        note: approvalNote,
      });
      const effectSummary = summarizeLifecycleEffects(response?.effects);
      setSuccessMessage(effectSummary ? `Approval step processed. ${effectSummary}` : "Approval step processed.");
      setApprovalNote("");
      await loadRecords();
    } catch (error) {
      setErrorMessage(error.message || "Unable to process approval step.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const triggerOffboarding = async (record) => {
    if (!record?.id || !canManage) {
      return;
    }
    if (!requestActionConfirmation("Trigger immediate offboarding and access revocation for this employee?")) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const response = await hrisApi.lifecycle.offboard(record.id, {
        reason: "Resignation",
      });
      const effectSummary = summarizeLifecycleEffects(response?.effects);
      setSuccessMessage(
        effectSummary
          ? `Offboarding completed. ${effectSummary}`
          : "Offboarding completed. Access revocation has been triggered.",
      );
      await loadRecords();
    } catch (error) {
      setErrorMessage(error.message || "Unable to complete offboarding.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEvidenceFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !activeRecord || !canManage) {
      event.target.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage("Evidence upload is limited to 10MB per file.");
      event.target.value = "";
      return;
    }
    if (!requestActionConfirmation(`Upload evidence file \"${file.name}\" to this workflow?`)) {
      event.target.value = "";
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const uploaded = await uploadLifecycleEvidenceToStorage({
        file,
        lifecycleRecordId: activeRecord.id,
        employeeEmail: activeRecord.employeeEmail,
      });

      await hrisApi.lifecycle.update(activeRecord.id, {
        workflowAction: {
          type: "add-evidence",
          evidence: {
            id: `evidence-${Date.now()}`,
            name: String(file.name || "").trim() || "Evidence File",
            ref: uploaded.downloadUrl,
            storagePath: uploaded.storagePath,
            contentType: uploaded.contentType,
            sizeBytes: uploaded.sizeBytes,
            uploadedAt: new Date().toISOString(),
            uploadedBy: session?.email || "system@gmail.com",
          },
        },
      });

      setSuccessMessage("Evidence file uploaded.");
      await loadRecords();
    } catch (error) {
      setErrorMessage(error.message || "Unable to upload evidence file.");
    } finally {
      setIsSubmitting(false);
      event.target.value = "";
    }
  };

  const removeEvidence = async (record, evidence) => {
    if (!record?.id || !evidence?.id || !canManage) {
      return;
    }
    const label = String(evidence?.name || "evidence file").trim();
    if (!requestActionConfirmation(`Remove evidence \"${label}\" from this workflow?`)) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await hrisApi.lifecycle.update(record.id, {
        workflowAction: {
          type: "remove-evidence",
          evidenceId: evidence.id,
        },
      });
      const storagePath = String(evidence?.storagePath || "").trim();
      if (storagePath) {
        removeStorageObjectByPath(storagePath).catch(() => null);
      }
      setSuccessMessage("Evidence file removed.");
      await loadRecords();
    } catch (error) {
      setErrorMessage(error.message || "Unable to remove evidence file.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeCreateModal = () => {
    if (isSubmitting) {
      return;
    }
    setIsCreateModalOpen(false);
  };

  const openCreateModal = () => {
    const nextCategory = activeSectionCategory || "Onboarding";
    setForm((current) => ({
      ...current,
      category: nextCategory,
      owner: workflowOwner,
      status: nextCategory === "Offboarding" ? "Pending Approval" : "In Progress",
    }));
    setIsCreateModalOpen(true);
  };

  const openWorkflowConsole = (recordId) => {
    if (!recordId) {
      return;
    }
    setSelectedRecordId(recordId);
    setIsWorkflowConsoleOpen(true);
  };

  const closeWorkflowConsole = () => {
    if (isSubmitting) {
      return;
    }
    setIsWorkflowConsoleOpen(false);
  };

  return (
    <div className="space-y-4">
      {errorMessage ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{errorMessage}</p>
      ) : null}
      {employeeOptionsError ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {employeeOptionsError}
        </p>
      ) : null}
      {successMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{successMessage}</p>
      ) : null}

      {canManage && isCreateModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Create Lifecycle Workflow"
          onClick={closeCreateModal}
        >
          <div
            className="w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Create Lifecycle Workflow</h2>
                <p className="mt-0.5 text-sm text-slate-600">
                  Onboarding, role change, disciplinary, and offboarding actions
                </p>
              </div>
              <button
                type="button"
                onClick={closeCreateModal}
                disabled={isSubmitting}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-70"
                aria-label="Close create workflow modal"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-4 w-4" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            <form className="mt-4 grid gap-2 md:grid-cols-3" onSubmit={createRecord}>
              <select
                required
                value={form.employeeRecordId}
                onChange={handleEmployeeSelection}
                className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
              >
                <option value="">
                  {isLoadingEmployeeOptions ? "Loading employee names..." : "Select employee name"}
                </option>
                {employeeOptions.map((option) => (
                  <option key={`name-${option.id}`} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              <input
                value={form.employeeEmail}
                readOnly
                aria-readonly="true"
                className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700"
              />
              <select
                value={form.category}
                onChange={handleFormField("category")}
                className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
              >
                <option>Onboarding</option>
                <option>Role Change</option>
                <option>Disciplinary</option>
                <option>Offboarding</option>
              </select>
              <input
                value={workflowOwner}
                readOnly
                aria-readonly="true"
                title="Auto-generated from current logged-in account"
                className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700"
              />
              <select
                value={form.status}
                onChange={handleFormField("status")}
                className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
              >
                <option>In Progress</option>
                <option>Pending Approval</option>
              </select>
                {isRoleMovementCategory(form.category) ? (
                  <>
                    <input
                      value={valueOrDash(toRoleLabel(form.roleFrom))}
                      readOnly
                      aria-readonly="true"
                      title="Auto-fetched from selected employee record"
                      className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700"
                    />
                    <select
                      required
                      value={form.roleTo}
                      onChange={handleFormField("roleTo")}
                      className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                  >
                    <option value="">New role</option>
                    {availableRoleTargets.map((roleOption) => (
                      <option key={`role-to-${roleOption.value}`} value={roleOption.value}>
                        {roleOption.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={form.effectiveDate}
                    onChange={handleFormField("effectiveDate")}
                    type="date"
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                  />
                    <input
                      value={valueOrDash(form.departmentFrom)}
                      readOnly
                      aria-readonly="true"
                      title="Auto-fetched from selected employee record"
                      className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700"
                    />
                  <select
                    value={form.departmentTo}
                    onChange={handleFormField("departmentTo")}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                  >
                    <option value="">New department</option>
                    {departmentCatalogOptions.map((departmentOption) => (
                      <option
                        key={`department-to-${departmentOption.value}`}
                        value={departmentOption.value}
                      >
                        {departmentOption.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={form.justification}
                    onChange={handleFormField("justification")}
                    placeholder="Role-change justification"
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none md:col-span-3"
                  />
                </>
              ) : null}
              <input
                value={form.details}
                onChange={handleFormField("details")}
                placeholder="Details / notes"
                className={`h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none ${isRoleMovementCategory(form.category) ? "md:col-span-3" : ""}`}
              />
              <div className="mt-1 flex items-center justify-end gap-2 md:col-span-3">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  disabled={isSubmitting}
                  className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-70"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    isSubmitting ||
                    isLoadingEmployeeOptions ||
                    isLoadingReferenceCatalog ||
                    employeeOptions.length === 0 ||
                    !form.employeeRecordId
                  }
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
                >
                  {isSubmitting ? "Saving..." : "Create Workflow"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <SurfaceCard
        title={activeSectionTab.label}
        subtitle={activeSectionDescription}
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Total</p>
            <p className="mt-0.5 text-lg font-semibold text-slate-900">{summaryMetrics.total}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Pending</p>
            <p className="mt-0.5 text-lg font-semibold text-slate-900">{summaryMetrics.pending}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Approved</p>
            <p className="mt-0.5 text-lg font-semibold text-slate-900">{summaryMetrics.approved}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">SLA Breach</p>
            <p className="mt-0.5 text-lg font-semibold text-slate-900">{summaryMetrics.breached}</p>
          </div>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Stages</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {sectionPlaybook.stages.map((stage) => (
                <span key={stage} className="inline-flex rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700">
                  {stage}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Required Tasks</p>
            <ul className="mt-2 space-y-1 text-xs text-slate-700">
              {sectionPlaybook.tasks.map((task) => (
                <li key={task} className="flex items-start gap-2">
                  <span className="mt-[5px] inline-block h-1.5 w-1.5 rounded-full bg-sky-500" />
                  <span>{task}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SurfaceCard>

      <div>
        <SurfaceCard
          title="Lifecycle Records"
          subtitle="Dedicated workflow records by lifecycle module with strict audit traceability"
          action={
            <div className="flex flex-wrap items-center gap-2">
              {canManage ? (
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white transition hover:bg-sky-700"
                >
                  Create Lifecycle Workflow
                </button>
              ) : null}
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search workflow"
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:border-sky-400 focus:outline-none"
              />
              <select
                value={selectedStatus}
                onChange={(event) => setSelectedStatus(event.target.value)}
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:border-sky-400 focus:outline-none"
              >
                <option value="">All Status</option>
                <option value="in progress">In Progress</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="completed">Completed</option>
                <option value="rejected">Rejected</option>
                <option value="revoked">Access Revoked</option>
              </select>
            </div>
          }
        >
          {isLoading ? (
            <p className="text-sm text-slate-600">Loading lifecycle records...</p>
          ) : filteredRecords.length === 0 ? (
            <EmptyState
              title="No lifecycle workflows found"
              subtitle="Create a workflow or change filters to view results."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                    <th className="px-2 py-3 font-medium">Employee</th>
                    {section === "workflow-status-tracking" ? <th className="px-2 py-3 font-medium">Category</th> : null}
                    <th className="px-2 py-3 font-medium">Stage</th>
                    <th className="px-2 py-3 font-medium">Checklist</th>
                    <th className="px-2 py-3 font-medium">Approvals</th>
                    <th className="px-2 py-3 font-medium">Status</th>
                    <th className="px-2 py-3 font-medium">Updated</th>
                    <th className="px-2 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((record) => {
                    const roleMovementSummary = getRoleMovementSummary(record);
                    const automationSummary = getAutomationSummary(record);
                    const checklistProgress = getChecklistProgress(record);
                    const approvalProgress = getApprovalProgress(record);
                    const rowSelected = isWorkflowConsoleOpen && selectedRecordId === record.id;
                    return (
                      <tr key={record.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                        <td className="px-2 py-3">
                          <p className="font-medium text-slate-900">{valueOrDash(record.employee)}</p>
                          <p className="text-xs text-slate-500">{valueOrDash(record.employeeEmail)}</p>
                          {roleMovementSummary ? <p className="mt-1 text-xs text-slate-500">{roleMovementSummary}</p> : null}
                          {automationSummary ? (
                            <p className="mt-1 text-xs text-emerald-700">Automation: {automationSummary}</p>
                          ) : null}
                        </td>
                        {section === "workflow-status-tracking" ? <td className="px-2 py-3">{valueOrDash(record.category)}</td> : null}
                        <td className="px-2 py-3">{valueOrDash(record?.workflow?.stage)}</td>
                        <td className="px-2 py-3 text-xs">
                          {checklistProgress.completed}/{checklistProgress.total}
                        </td>
                        <td className="px-2 py-3 text-xs">
                          {approvalProgress.approved}/{approvalProgress.total}
                        </td>
                        <td className="px-2 py-3">
                          <StatusBadge value={record.status || "-"} />
                        </td>
                        <td className="px-2 py-3 text-xs text-slate-600">{formatDate(record.updatedAt || record.createdAt)}</td>
                        <td className="px-2 py-3 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openWorkflowConsole(record.id)}
                              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                                rowSelected
                                  ? "border-sky-300 bg-sky-50 text-sky-700"
                                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {rowSelected ? "Opened" : "Open Workflow"}
                            </button>
                            {canManage ? (
                              <button
                                type="button"
                                onClick={() =>
                                  updateStatus(
                                    record,
                                    "Pending Approval",
                                    "Submit this workflow for approval review?",
                                  )
                                }
                                disabled={isSubmitting}
                                className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100 disabled:opacity-60"
                              >
                                Submit
                              </button>
                            ) : null}
                            {canManage && isOffboardingRecord(record) ? (
                              <button
                                type="button"
                                onClick={() => triggerOffboarding(record)}
                                disabled={isSubmitting}
                                className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                              >
                                Offboard
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SurfaceCard>

        {isWorkflowConsoleOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Workflow Console"
            onClick={closeWorkflowConsole}
          >
            <div
              className="w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-5"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Workflow Console</h2>
                  <p className="mt-0.5 text-sm text-slate-600">
                    Checklist automation, approver chain enforcement, and lifecycle evidence management
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeWorkflowConsole}
                  disabled={isSubmitting}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                  aria-label="Close workflow console"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-4 w-4" aria-hidden="true">
                    <path d="m6 6 12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>

              <SurfaceCard>
                {!activeRecord ? (
                  <EmptyState
                    title="No workflow selected"
                    subtitle="Open a lifecycle record from the table to continue."
                  />
                ) : (
                  <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <p className="text-sm font-semibold text-slate-900">{valueOrDash(activeRecord.employee)}</p>
                <p className="text-xs text-slate-600">{valueOrDash(activeRecord.employeeEmail)}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-600">
                  <span className="rounded-md border border-slate-200 bg-white px-2 py-1">
                    Stage: {valueOrDash(activeRecord?.workflow?.stage)}
                  </span>
                  <span className="rounded-md border border-slate-200 bg-white px-2 py-1">
                    Approval: {valueOrDash(activeRecord?.workflow?.approvalState)}
                  </span>
                  <span className="rounded-md border border-slate-200 bg-white px-2 py-1">
                    SLA Due: {formatDateShort(activeRecord?.workflow?.slaDueAt)}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Stage Control</p>
                  {canManage ? (
                    <select
                      value={activeStageIndex}
                      onChange={(event) => setWorkflowStage(activeRecord, Number.parseInt(event.target.value, 10) || 0)}
                      disabled={isSubmitting}
                      className="h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-700 focus:border-sky-400 focus:outline-none"
                    >
                      {activeStages.map((stage, index) => (
                        <option key={`${stage}-${index}`} value={index}>
                          {stage}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Checklist Automation</p>
                <div className="mt-2 space-y-2">
                  {activeChecklist.length === 0 ? (
                    <p className="text-xs text-slate-500">No checklist tasks generated yet.</p>
                  ) : (
                    activeChecklist.map((task) => {
                      const completed = normalizeText(task?.status) === "completed";
                      return (
                        <div key={task.id} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-xs font-medium text-slate-800">{valueOrDash(task.label)}</p>
                              <p className="text-[11px] text-slate-500">
                                Due: {formatDate(task.dueAt)} | Status: {valueOrDash(task.status)}
                              </p>
                            </div>
                            {canManage ? (
                              <button
                                type="button"
                                onClick={() => toggleChecklistTask(activeRecord, task, !completed)}
                                disabled={isSubmitting}
                                className={`inline-flex h-7 items-center rounded-md border px-2.5 text-[11px] font-semibold transition disabled:opacity-60 ${
                                  completed
                                    ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                                    : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                }`}
                              >
                                {completed ? "Set Pending" : "Mark Complete"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Approver Chain</p>
                <div className="mt-2 space-y-2">
                  {activeApprovalChain.length === 0 ? (
                    <p className="text-xs text-slate-500">No approver chain configured.</p>
                  ) : (
                    activeApprovalChain.map((step) => (
                      <div key={`${step.role}-${step.order}`} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-medium text-slate-800">
                              Step {step.order}: {valueOrDash(step.role)}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              Status: {valueOrDash(step.status)}
                              {step.decidedAt ? ` | Decided: ${formatDate(step.decidedAt)}` : ""}
                            </p>
                            {step.note ? <p className="text-[11px] text-slate-500">Note: {step.note}</p> : null}
                          </div>
                          <StatusBadge value={step.status || "Pending"} />
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {canActorApproveStep ? (
                  <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 p-2.5">
                    <p className="text-xs font-semibold text-sky-700">
                      Approval action required for role: {valueOrDash(pendingApprovalStep?.role)}
                    </p>
                    <textarea
                      value={approvalNote}
                      onChange={(event) => setApprovalNote(event.target.value)}
                      placeholder="Approval note"
                      className="mt-2 min-h-[70px] w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-800 focus:border-sky-400 focus:outline-none"
                    />
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => processApproval(activeRecord, "reject")}
                        disabled={isSubmitting}
                        className="inline-flex h-8 items-center rounded-md border border-rose-200 bg-rose-50 px-2.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                      >
                        Reject Step
                      </button>
                      <button
                        type="button"
                        onClick={() => processApproval(activeRecord, "approve")}
                        disabled={isSubmitting}
                        className="inline-flex h-8 items-center rounded-md border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                      >
                        Approve Step
                      </button>
                    </div>
                  </div>
                ) : canManage ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Approval can only be processed by the current pending role in the approval chain.
                  </p>
                ) : null}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Evidence Attachments</p>
                  {canManage ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => evidenceInputRef.current?.click()}
                        disabled={isSubmitting}
                        className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-3 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                      >
                        Upload Evidence
                      </button>
                      <input
                        ref={evidenceInputRef}
                        type="file"
                        className="hidden"
                        onChange={handleEvidenceFileChange}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="mt-2 space-y-2">
                  {activeEvidence.length === 0 ? (
                    <p className="text-xs text-slate-500">No evidence files attached.</p>
                  ) : (
                    activeEvidence.map((evidence) => (
                      <div key={evidence.id} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-medium text-slate-800">{valueOrDash(evidence.name)}</p>
                            <p className="text-[11px] text-slate-500">
                              {formatFileSize(evidence.sizeBytes)} | {formatDate(evidence.uploadedAt)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {String(evidence.ref || "").trim() ? (
                              <a
                                href={String(evidence.ref)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-7 items-center rounded-md border border-sky-200 bg-sky-50 px-2.5 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100"
                              >
                                Open
                              </a>
                            ) : null}
                            {canManage ? (
                              <button
                                type="button"
                                onClick={() => removeEvidence(activeRecord, evidence)}
                                disabled={isSubmitting}
                                className="inline-flex h-7 items-center rounded-md border border-rose-200 bg-rose-50 px-2.5 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                              >
                                Remove
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
                  </div>
                )}
              </SurfaceCard>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
