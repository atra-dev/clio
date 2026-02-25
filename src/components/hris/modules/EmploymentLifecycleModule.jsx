"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SurfaceCard from "@/components/hris/SurfaceCard";
import EmptyState from "@/components/hris/shared/EmptyState";
import PaginationControls from "@/components/hris/shared/PaginationControls";
import StatusBadge from "@/components/hris/shared/StatusBadge";
import { useToast } from "@/components/ui/ToastProvider";
import { useConfirm } from "@/components/ui/ConfirmProvider";
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
  "role-changes": "Role/department movement workflows with effectivity details.",
  "disciplinary-records": "Disciplinary case workflows with controlled updates and timeline visibility.",
  "offboarding-access-revocation": "Offboarding workflows with access revocation and account disablement trail.",
};

const REQUIRED_EVIDENCE_BY_WORKFLOW = {
  disciplinary: [
    { id: "incident-report", label: "Incident Report", keywords: ["incident", "report"] },
    {
      id: "notice-to-explain",
      label: "Notice to Explain / Written Explanation",
      keywords: ["notice", "explain", "written explanation", "explanation"],
    },
    { id: "decision-memo", label: "Decision Memo", keywords: ["decision", "memo"] },
  ],
  offboarding: [
    {
      id: "resignation-termination",
      label: "Resignation / Termination Document",
      keywords: ["resignation", "termination", "termination notice"],
    },
    { id: "clearance-form", label: "Clearance Form", keywords: ["clearance"] },
    { id: "handover-exit", label: "Handover / Exit Checklist", keywords: ["handover", "exit checklist", "exit interview"] },
  ],
};

const DEFAULT_ROLE_ASSIGNMENT_OPTIONS = [
  { value: "SUPER_ADMIN", label: "Super Admin" },
  { value: "GRC", label: "Governance, Risk, and Compliance (GRC)" },
  { value: "HR", label: "Human Resources (HR)" },
  { value: "EA", label: "Executive Assistant (EA)" },
  { value: "EMPLOYEE_L1", label: "Employee (L1)" },
  { value: "EMPLOYEE_L2", label: "Employee (L2)" },
  { value: "EMPLOYEE_L3", label: "Employee (L3)" },
];

const ROLE_COMPLETE_LABEL_BY_ID = new Map([
  ["GRC", "Governance, Risk, and Compliance (GRC)"],
  ["HR", "Human Resources (HR)"],
  ["EA", "Executive Assistant (EA)"],
]);

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

const ONBOARDING_WORK_SETUP_OPTIONS = ["On-site", "Hybrid", "Remote"];

const ROLE_LABEL_BY_ID = new Map([
  ["SUPER_ADMIN", "Super Admin"],
  ["GRC", "Governance, Risk, and Compliance (GRC)"],
  ["HR", "Human Resources (HR)"],
  ["EA", "Executive Assistant (EA)"],
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
const GRC_ASSIGNABLE_LIFECYCLE_ROLE_KEYS = new Set(["GRC", "HR", "EA", "EMPLOYEE_L1", "EMPLOYEE_L2", "EMPLOYEE_L3"]);

const initialForm = {
  employeeRecordId: "",
  employeeEmail: "",
  employee: "",
  category: "Onboarding",
  owner: "",
  status: "In Progress",
  onboardingEmployeeId: "",
  onboardingFirstName: "",
  onboardingMiddleName: "",
  onboardingLastName: "",
  onboardingSuffix: "",
  onboardingRole: "",
  onboardingDepartment: "",
  onboardingStartDate: "",
  workSetup: "On-site",
  activateEmploymentNow: true,
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

function normalizeLifecycleWorkflowType(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "onboarding";
  }
  if (normalized.includes("disciplin")) {
    return "disciplinary";
  }
  if (normalized.includes("offboard") || normalized.includes("resign") || normalized.includes("terminate")) {
    return "offboarding";
  }
  if (normalized.includes("role") || normalized.includes("promotion")) {
    return "role-change";
  }
  return "onboarding";
}

function valueOrDash(value) {
  const normalized = String(value || "").trim();
  return normalized || "-";
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

function isOnboardingCategory(category) {
  return normalizeText(category) === "onboarding";
}

function buildLifecycleDetailsPayload(form) {
  const details = {
    note: String(form.details || "").trim(),
  };

  if (isOnboardingCategory(form.category)) {
    const onboardingStartDate = String(form.onboardingStartDate || "").trim();
    const onboardingEmployeeId = String(form.onboardingEmployeeId || "").trim();
    const firstName = String(form.onboardingFirstName || "").trim();
    const middleName = String(form.onboardingMiddleName || "").trim();
    const lastName = String(form.onboardingLastName || "").trim();
    const suffix = String(form.onboardingSuffix || "").trim();
    const onboardingRole = String(form.onboardingRole || "").trim();
    const onboardingDepartment = String(form.onboardingDepartment || "").trim();
    details.startDate = onboardingStartDate;
    details.employeeId = onboardingEmployeeId;
    details.firstName = firstName;
    details.middleName = middleName;
    details.lastName = lastName;
    details.suffix = suffix;
    details.role = onboardingRole;
    details.roleTo = onboardingRole;
    details.department = onboardingDepartment;
    details.departmentTo = onboardingDepartment;
    details.workSetup = String(form.workSetup || "").trim();
    details.accountEmail = String(form.employeeEmail || "").trim().toLowerCase();
    details.activateEmploymentNow = Boolean(form.activateEmploymentNow);
  }

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

function getLifecycleDetails(record) {
  if (record?.details && typeof record.details === "object") {
    return record.details;
  }
  return {};
}

function getLifecycleEffectiveDate(record) {
  const details = getLifecycleDetails(record);
  const value = String(details?.effectiveDate || details?.startDate || "").trim();
  return value || "";
}

function getLifecycleEmployeeNumber(record) {
  const details = getLifecycleDetails(record);
  const value = String(details?.employeeId || details?.employeeNumber || "").trim();
  return value || "";
}

function getLifecycleRoleTransition(record) {
  const details = getLifecycleDetails(record);
  const roleFrom = String(details?.roleFrom || "").trim();
  const roleTo = String(details?.roleTo || details?.role || "").trim();
  if (!roleFrom && !roleTo) {
    return "";
  }
  return `${toRoleLabel(roleFrom || "-")} -> ${toRoleLabel(roleTo || "-")}`;
}

function getLifecycleDepartmentTransition(record) {
  const details = getLifecycleDetails(record);
  const departmentFrom = String(details?.departmentFrom || "").trim();
  const departmentTo = String(details?.departmentTo || details?.department || "").trim();
  if (!departmentFrom && !departmentTo) {
    return "";
  }
  return `${departmentFrom || "-"} -> ${departmentTo || "-"}`;
}

function getLifecycleDecisionTimestamp(record) {
  const traceability = Array.isArray(record?.traceability) ? record.traceability : [];
  for (let index = traceability.length - 1; index >= 0; index -= 1) {
    const entry = traceability[index];
    const status = normalizeText(entry?.status);
    if (status.includes("approved") || status.includes("completed") || status.includes("rejected")) {
      const atValue = String(entry?.at || "").trim();
      if (atValue) {
        return atValue;
      }
    }
  }

  const status = normalizeText(record?.status);
  if (status.includes("approved") || status.includes("completed") || status.includes("rejected")) {
    return String(record?.updatedAt || record?.createdAt || "").trim();
  }
  return "";
}

function getLifecycleAccessRevokedAt(record) {
  const effects = Array.isArray(record?.lastAutomationEffects) ? record.lastAutomationEffects : [];
  const hasRevocationEffect = effects.some((effect) => normalizeText(effect?.type) === "access-revocation");
  if (hasRevocationEffect) {
    return String(record?.lastAutomationAt || record?.updatedAt || "").trim();
  }

  const status = normalizeText(record?.status);
  if (status.includes("revoked") || status.includes("terminated") || status.includes("disabled")) {
    return String(record?.updatedAt || "").trim();
  }
  return "";
}

function getLifecycleArchiveUntil(record) {
  const effects = Array.isArray(record?.lastAutomationEffects) ? record.lastAutomationEffects : [];
  const archiveEffect = effects.find((effect) => normalizeText(effect?.type) === "archive-policy");
  const retention = String(archiveEffect?.retentionDeleteAt || record?.retentionDeleteAt || "").trim();
  return retention || "";
}

function composeOnboardingEmployeeName(form) {
  return formatEmployeeName({
    firstName: form?.onboardingFirstName,
    middleName: form?.onboardingMiddleName,
    lastName: form?.onboardingLastName,
    suffix: form?.onboardingSuffix,
    fallback: form?.employee,
    fallbackEmail: form?.employeeEmail,
    fallbackLabel: "Employee",
  });
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

function getChecklistProgress(record) {
  const checklist = Array.isArray(record?.workflow?.checklist) ? record.workflow.checklist : [];
  const required = checklist.filter((task) => task?.required !== false);
  const completed = required.filter((task) => normalizeText(task?.status) === "completed").length;
  return {
    completed,
    total: required.length,
  };
}

function isOffboardingRecord(record) {
  const category = normalizeText(record?.category);
  return category.includes("offboard") || category.includes("resign") || category.includes("terminate");
}

function getRequiredEvidenceSummary(record) {
  const workflowType = normalizeLifecycleWorkflowType(record?.workflowType || record?.category);
  const rules = REQUIRED_EVIDENCE_BY_WORKFLOW[workflowType] || [];
  if (rules.length === 0) {
    return { required: [], matched: [], missing: [], complete: true };
  }

  const evidence = Array.isArray(record?.evidence) ? record.evidence : [];
  const normalizedEvidence = evidence.map((entry) =>
    normalizeText([entry?.name, entry?.type, entry?.note].filter(Boolean).join(" ")),
  );

  const matched = [];
  const missing = [];
  rules.forEach((rule) => {
    const keywords = Array.isArray(rule.keywords) ? rule.keywords.map((item) => normalizeText(item)).filter(Boolean) : [];
    const hasMatch = normalizedEvidence.some((text) => keywords.some((keyword) => text.includes(keyword)));
    const detail = { id: rule.id, label: rule.label };
    if (hasMatch) {
      matched.push(detail);
    } else {
      missing.push(detail);
    }
  });

  return {
    required: rules.map((rule) => ({ id: rule.id, label: rule.label })),
    matched,
    missing,
    complete: missing.length === 0,
  };
}

function getRequiredEvidenceRulesForCategory(category) {
  const workflowType = normalizeLifecycleWorkflowType(category);
  return REQUIRED_EVIDENCE_BY_WORKFLOW[workflowType] || [];
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
  const toast = useToast();
  const confirmAction = useConfirm();
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
  const [recordsPage, setRecordsPage] = useState(1);
  const recordsPageSize = 10;
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [isLoadingEmployeeOptions, setIsLoadingEmployeeOptions] = useState(false);
  const [employeeOptionsError, setEmployeeOptionsError] = useState("");
  const [referenceCatalog, setReferenceCatalog] = useState({
    roles: DEFAULT_ROLE_ASSIGNMENT_OPTIONS,
    departments: DEFAULT_DEPARTMENT_OPTIONS,
  });
  const [isLoadingReferenceCatalog, setIsLoadingReferenceCatalog] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [onboardingDocuments, setOnboardingDocuments] = useState([]);
  const [disciplinaryDocuments, setDisciplinaryDocuments] = useState([]);
  const [offboardingDocuments, setOffboardingDocuments] = useState([]);

  const evidenceInputRef = useRef(null);

  const activeSectionTab = useMemo(
    () => SECTION_TABS.find((tab) => tab.id === section) || SECTION_TABS[0],
    [section],
  );
  const activeSectionCategory = CATEGORY_BY_SECTION[section] || "";
  const activeSectionDescription = SECTION_DESCRIPTIONS[section] || SECTION_DESCRIPTIONS["workflow-status-tracking"];
  const roleCatalogOptions = useMemo(() => {
    const merged = mergeCatalogOptions(referenceCatalog.roles, DEFAULT_ROLE_ASSIGNMENT_OPTIONS);
    const byRoleKey = new Map();

    merged.forEach((option) => {
      const normalized = normalizeRoleValue(option?.value);
      if (!normalized) {
        return;
      }
      const completeLabel = ROLE_COMPLETE_LABEL_BY_ID.get(normalized);
      const normalizedOption = {
        value: String(option.value || "").trim(),
        label: completeLabel || String(option.label || option.value || "").trim(),
      };
      if (!byRoleKey.has(normalized)) {
        byRoleKey.set(normalized, normalizedOption);
      }
    });

    ROLE_COMPLETE_LABEL_BY_ID.forEach((label, key) => {
      if (!byRoleKey.has(key)) {
        byRoleKey.set(key, {
          value: key,
          label,
        });
      }
    });

    return Array.from(byRoleKey.values());
  }, [referenceCatalog.roles]);
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
        if (actorRoleId === "GRC") {
          return GRC_ASSIGNABLE_LIFECYCLE_ROLE_KEYS.has(normalized);
        }
        if (actorRoleId === "HR" || actorRoleId === "EA") {
          return isEmployeeLifecycleRoleValue(option.value);
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
      if (isOnboardingCategory(current.category)) {
        return current;
      }
      if (current.employeeRecordId && employeeOptions.some((option) => option.id === current.employeeRecordId)) {
        return current;
      }

      const firstOption = employeeOptions[0];
      return {
        ...current,
        employeeRecordId: firstOption.id,
        employee: firstOption.name,
        employeeEmail: firstOption.email,
        onboardingRole: firstOption.currentRole || "",
        onboardingDepartment: firstOption.currentDepartment || "",
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

  const recordsPagination = useMemo(() => {
    const total = filteredRecords.length;
    const totalPages = Math.max(1, Math.ceil(total / recordsPageSize));
    const page = Math.min(Math.max(1, recordsPage), totalPages);
    return {
      page,
      pageSize: recordsPageSize,
      total,
      totalPages,
    };
  }, [filteredRecords.length, recordsPage]);

  const pagedRecords = useMemo(() => {
    const start = (recordsPagination.page - 1) * recordsPagination.pageSize;
    return filteredRecords.slice(start, start + recordsPagination.pageSize);
  }, [filteredRecords, recordsPagination.page, recordsPagination.pageSize]);

  useEffect(() => {
    setRecordsPage(1);
  }, [section, searchQuery, selectedStatus]);

  useEffect(() => {
    if (recordsPage > recordsPagination.totalPages) {
      setRecordsPage(recordsPagination.totalPages);
    }
  }, [recordsPage, recordsPagination.totalPages]);

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
  const activeStages = Array.isArray(activeRecord?.workflow?.stages) ? activeRecord.workflow.stages : [];
  const activeStageIndex = Number.isFinite(Number(activeRecord?.workflow?.stageIndex))
    ? Number(activeRecord.workflow.stageIndex)
    : 0;
  const activeEvidence = Array.isArray(activeRecord?.evidence) ? activeRecord.evidence : [];
  const activeRequiredEvidence = useMemo(() => getRequiredEvidenceSummary(activeRecord), [activeRecord]);
  const createRequiredEvidenceRules = useMemo(() => getRequiredEvidenceRulesForCategory(form.category), [form.category]);
  const createCategoryType = useMemo(() => normalizeLifecycleWorkflowType(form.category), [form.category]);
  const createWorkflowDocuments = useMemo(() => {
    if (createCategoryType === "disciplinary") {
      return disciplinaryDocuments;
    }
    if (createCategoryType === "offboarding") {
      return offboardingDocuments;
    }
    return onboardingDocuments;
  }, [createCategoryType, disciplinaryDocuments, offboardingDocuments, onboardingDocuments]);

  const summaryMetrics = useMemo(() => {
    const inProgress = filteredRecords.filter((record) => {
      const normalizedStatus = normalizeText(record.status);
      return normalizedStatus.includes("in progress") || normalizedStatus.includes("pending");
    }).length;
    const completed = filteredRecords.filter((record) => {
      const normalizedStatus = normalizeText(record.status);
      return normalizedStatus.includes("approved") || normalizedStatus.includes("completed");
    }).length;
    return {
      total: filteredRecords.length,
      inProgress,
      completed,
    };
  }, [filteredRecords]);

  const summaryCards = useMemo(() => {
    return [
      { key: "total", label: "Total", value: summaryMetrics.total },
      { key: "in-progress", label: "In Progress", value: summaryMetrics.inProgress },
      { key: "completed", label: "Completed", value: summaryMetrics.completed },
    ];
  }, [summaryMetrics]);

  const handleFormField = (field) => (event) => {
    setForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const handleFormToggle = (field) => (event) => {
    setForm((current) => ({
      ...current,
      [field]: Boolean(event.target.checked),
    }));
  };

  const handleOnboardingDocumentsChange = (event) => {
    const files = Array.from(event.target.files || []);
    setOnboardingDocuments(files.slice(0, 10));
  };

  const removeOnboardingDocument = (indexToRemove) => {
    setOnboardingDocuments((current) => current.filter((_, index) => index !== indexToRemove));
  };

  const handleCategoryDocumentsChange = (categoryType) => (event) => {
    const files = Array.from(event.target.files || []).slice(0, 10);
    if (categoryType === "disciplinary") {
      setDisciplinaryDocuments(files);
      return;
    }
    if (categoryType === "offboarding") {
      setOffboardingDocuments(files);
    }
  };

  const removeCategoryDocument = (categoryType, indexToRemove) => {
    if (categoryType === "disciplinary") {
      setDisciplinaryDocuments((current) => current.filter((_, index) => index !== indexToRemove));
      return;
    }
    if (categoryType === "offboarding") {
      setOffboardingDocuments((current) => current.filter((_, index) => index !== indexToRemove));
    }
  };

  const handleCategoryChange = (event) => {
    const nextCategory = event.target.value;
    const nextCategoryType = normalizeLifecycleWorkflowType(nextCategory);
    const onboardingMode = isOnboardingCategory(nextCategory);
    if (nextCategoryType !== "onboarding") {
      setOnboardingDocuments([]);
    }
    if (nextCategoryType !== "disciplinary") {
      setDisciplinaryDocuments([]);
    }
    if (nextCategoryType !== "offboarding") {
      setOffboardingDocuments([]);
    }
    setForm((current) => {
      if (onboardingMode) {
        return {
          ...current,
          category: nextCategory,
          employeeRecordId: "",
          employee: composeOnboardingEmployeeName(current),
          employeeEmail: "",
          onboardingEmployeeId: "",
          onboardingFirstName: "",
          onboardingMiddleName: "",
          onboardingLastName: "",
          onboardingSuffix: "",
          onboardingRole: "",
          onboardingDepartment: "",
          onboardingStartDate: "",
          workSetup: "On-site",
          activateEmploymentNow: true,
          roleFrom: "",
          departmentFrom: "",
        };
      }

      const selectedOption =
        employeeOptions.find((option) => option.id === current.employeeRecordId) || employeeOptions[0] || null;
      return {
        ...current,
        category: nextCategory,
        employeeRecordId: selectedOption?.id || current.employeeRecordId || "",
        employee: selectedOption?.name || current.employee || "",
        employeeEmail: selectedOption?.email || current.employeeEmail || "",
        onboardingRole: selectedOption?.currentRole || current.onboardingRole || "",
        onboardingDepartment: selectedOption?.currentDepartment || current.onboardingDepartment || "",
        roleFrom: selectedOption?.currentRole || current.roleFrom || "",
        departmentFrom: selectedOption?.currentDepartment || current.departmentFrom || "",
      };
    });
  };

  const handleEmployeeSelection = (event) => {
    const selectedId = event.target.value;
    const option = employeeOptions.find((entry) => entry.id === selectedId);

    setForm((current) => ({
      ...current,
      employeeRecordId: selectedId,
      employee: option?.name || "",
      employeeEmail: option?.email || "",
      onboardingRole: option?.currentRole || "",
      onboardingDepartment: option?.currentDepartment || "",
      roleFrom: option?.currentRole || "",
      departmentFrom: option?.currentDepartment || "",
    }));
  };

  const createRecord = async (event) => {
    event.preventDefault();
    if (!canManage) {
      return;
    }

    if (isOnboardingCategory(form.category)) {
      if (!String(form.onboardingEmployeeId || "").trim()) {
        setErrorMessage("Employee number is required for onboarding.");
        return;
      }
      if (!String(form.onboardingLastName || "").trim()) {
        setErrorMessage("Last name is required for onboarding.");
        return;
      }
      if (!String(form.onboardingFirstName || "").trim()) {
        setErrorMessage("First name is required for onboarding.");
        return;
      }
      if (!String(form.employeeEmail || "").trim()) {
        setErrorMessage("Google account email is required for onboarding.");
        return;
      }
      if (!String(form.onboardingRole || "").trim()) {
        setErrorMessage("Assigned role is required for onboarding.");
        return;
      }
      if (!String(form.onboardingDepartment || "").trim()) {
        setErrorMessage("Assigned department is required for onboarding.");
        return;
      }
      if (!String(form.onboardingStartDate || "").trim()) {
        setErrorMessage("Employment start date is required for onboarding.");
        return;
      }
      const oversizedFile = onboardingDocuments.find((file) => file.size > 10 * 1024 * 1024);
      if (oversizedFile) {
        setErrorMessage("Each onboarding document must be 10MB or below.");
        toast.error("Each onboarding document must be 10MB or below.");
        return;
      }
    }
    if (createCategoryType === "disciplinary" || createCategoryType === "offboarding") {
      const oversizedFile = createWorkflowDocuments.find((file) => file.size > 10 * 1024 * 1024);
      if (oversizedFile) {
        const label = createCategoryType === "disciplinary" ? "disciplinary" : "offboarding";
        setErrorMessage(`Each ${label} document must be 10MB or below.`);
        toast.error(`Each ${label} document must be 10MB or below.`);
        return;
      }
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

    if (
      !(await confirmAction({
        title: "Create Lifecycle Workflow",
        message: `Create ${form.category} workflow for ${valueOrDash(form.employeeEmail || form.employee)}?`,
        confirmText: "Create",
      }))
    ) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const onboardingMode = isOnboardingCategory(form.category);
      const onboardingEmployeeName = onboardingMode ? composeOnboardingEmployeeName(form) : form.employee;
      const status = onboardingMode
        ? form.activateEmploymentNow
          ? "Approved"
          : "In Progress"
        : form.status;
      const response = await hrisApi.lifecycle.create({
        employeeEmail: form.employeeEmail,
        employee: onboardingEmployeeName,
        category: form.category,
        owner: workflowOwner,
        status,
        details: buildLifecycleDetailsPayload(form),
      });
      const createdRecordId = String(response?.record?.id || "").trim();
      const evidenceTypeLabel =
        createCategoryType === "onboarding"
          ? "Onboarding"
          : createCategoryType === "disciplinary"
            ? "Disciplinary"
            : createCategoryType === "offboarding"
              ? "Offboarding"
              : "Evidence";

      if (createdRecordId && createWorkflowDocuments.length > 0) {
        for (const file of createWorkflowDocuments) {
          const uploaded = await uploadLifecycleEvidenceToStorage({
            file,
            lifecycleRecordId: createdRecordId,
            employeeEmail: form.employeeEmail,
          });

          await hrisApi.lifecycle.update(createdRecordId, {
            workflowAction: {
              type: "add-evidence",
                evidence: {
                  id: `evidence-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  name: String(file.name || "").trim() || "Onboarding Document",
                  type: evidenceTypeLabel,
                  ref: uploaded.downloadUrl,
                  storagePath: uploaded.storagePath,
                  contentType: uploaded.contentType,
                sizeBytes: uploaded.sizeBytes,
                uploadedAt: new Date().toISOString(),
                uploadedBy: session?.email || "system@gmail.com",
              },
            },
          });
        }
      }

      setForm(initialForm);
      setOnboardingDocuments([]);
      setDisciplinaryDocuments([]);
      setOffboardingDocuments([]);
      setIsCreateModalOpen(false);
      const effectSummary = summarizeLifecycleEffects(response?.effects);
      const documentSummary =
        createWorkflowDocuments.length > 0
          ? `${createWorkflowDocuments.length} ${evidenceTypeLabel.toLowerCase()} document${createWorkflowDocuments.length > 1 ? "s" : ""} uploaded. `
          : "";
      const successText =
        effectSummary
          ? `${documentSummary}Lifecycle workflow created. ${effectSummary}`
          : `${documentSummary}Lifecycle workflow created.`;
      setSuccessMessage(successText);
      toast.success(successText);
      await loadRecords();
    } catch (error) {
      const message = error.message || "Unable to create lifecycle workflow.";
      setErrorMessage(message);
      toast.error(message);
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
      const message = completed ? "Checklist task marked as completed." : "Checklist task reverted to pending.";
      setSuccessMessage(message);
      toast.success(message);
      await loadRecords();
    } catch (error) {
      const message = error.message || "Unable to update checklist task.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const setWorkflowStage = async (record, stageIndex) => {
    if (!record?.id || !canManage) {
      return;
    }

    if (
      !(await confirmAction({
        title: "Update Workflow Stage",
        message: "Update workflow stage for this case?",
        confirmText: "Update",
      }))
    ) {
      return;
    }
    if (
      !(await confirmAction({
        title: "Update Checklist Task",
        message: completed ? `Mark "${valueOrDash(task.label)}" as completed?` : `Set "${valueOrDash(task.label)}" back to pending?`,
        confirmText: completed ? "Mark Complete" : "Set Pending",
      }))
    ) {
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
      toast.success("Workflow stage updated.");
      await loadRecords();
    } catch (error) {
      const message = error.message || "Unable to update workflow stage.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const triggerOffboarding = async (record) => {
    if (!record?.id || !canManage) {
      return;
    }
    const requiredEvidence = getRequiredEvidenceSummary(record);
    if (!requiredEvidence.complete) {
      const message = `Required offboarding documents are missing: ${requiredEvidence.missing.map((item) => item.label).join(", ")}.`;
      setErrorMessage(
        `Required offboarding documents are missing: ${requiredEvidence.missing.map((item) => item.label).join(", ")}.`,
      );
      toast.error(message);
      setSuccessMessage("");
      return;
    }
    if (
      !(await confirmAction({
        title: "Trigger Offboarding",
        message: "Trigger immediate offboarding and access revocation for this employee?",
        confirmText: "Offboard",
        tone: "danger",
      }))
    ) {
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
      toast.success("Offboarding completed.");
      await loadRecords();
    } catch (error) {
      const message = error.message || "Unable to complete offboarding.";
      setErrorMessage(message);
      toast.error(message);
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
      toast.error("Evidence upload is limited to 10MB per file.");
      event.target.value = "";
      return;
    }
    if (
      !(await confirmAction({
        title: "Upload Evidence",
        message: `Upload evidence file \"${file.name}\" to this workflow?`,
        confirmText: "Upload",
      }))
    ) {
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
      toast.success("Evidence file uploaded.");
      await loadRecords();
    } catch (error) {
      const message = error.message || "Unable to upload evidence file.";
      setErrorMessage(message);
      toast.error(message);
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
    if (
      !(await confirmAction({
        title: "Remove Evidence",
        message: `Remove evidence \"${label}\" from this workflow?`,
        confirmText: "Remove",
        tone: "danger",
      }))
    ) {
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
      toast.success("Evidence file removed.");
      await loadRecords();
    } catch (error) {
      const message = error.message || "Unable to remove evidence file.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeCreateModal = () => {
    if (isSubmitting) {
      return;
    }
    setOnboardingDocuments([]);
    setDisciplinaryDocuments([]);
    setOffboardingDocuments([]);
    setIsCreateModalOpen(false);
  };

  const openCreateModal = () => {
    const nextCategory = activeSectionCategory || "Onboarding";
    const onboardingMode = isOnboardingCategory(nextCategory);
    const selectedOption =
      !onboardingMode
        ? employeeOptions.find((option) => option.id === form.employeeRecordId) ||
          employeeOptions[0] ||
          null
        : null;
    setForm((current) => ({
      ...initialForm,
      employeeRecordId: onboardingMode ? "" : selectedOption?.id || current.employeeRecordId || "",
      employee: onboardingMode ? "" : selectedOption?.name || current.employee || "",
      employeeEmail: onboardingMode ? "" : selectedOption?.email || current.employeeEmail || "",
      onboardingRole: onboardingMode ? "" : selectedOption?.currentRole || current.onboardingRole || "",
      onboardingDepartment: onboardingMode ? "" : selectedOption?.currentDepartment || current.onboardingDepartment || "",
      roleFrom: onboardingMode ? "" : selectedOption?.currentRole || current.roleFrom || "",
      departmentFrom: onboardingMode ? "" : selectedOption?.currentDepartment || current.departmentFrom || "",
      category: nextCategory,
      owner: workflowOwner,
      status: "In Progress",
    }));
    setOnboardingDocuments([]);
    setDisciplinaryDocuments([]);
    setOffboardingDocuments([]);
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

  const renderLifecycleHeaderCells = () => {
    if (section === "onboarding") {
      return (
        <>
          <th className="px-2 py-3 font-medium">Employee</th>
          <th className="px-2 py-3 font-medium">Employee Number</th>
          <th className="px-2 py-3 font-medium">Effective Date</th>
          <th className="px-2 py-3 font-medium">Initiated By</th>
          <th className="px-2 py-3 font-medium">Status</th>
          <th className="px-2 py-3 font-medium">Decision At</th>
          <th className="px-2 py-3 font-medium">Updated</th>
          <th className="px-2 py-3 font-medium text-right">Actions</th>
        </>
      );
    }

    if (section === "role-changes") {
      return (
        <>
          <th className="px-2 py-3 font-medium">Employee</th>
          <th className="px-2 py-3 font-medium">Role From -&gt; Role To</th>
          <th className="px-2 py-3 font-medium">Department From -&gt; Department To</th>
          <th className="px-2 py-3 font-medium">Effective Date</th>
          <th className="px-2 py-3 font-medium">Initiated By</th>
          <th className="px-2 py-3 font-medium">Status</th>
          <th className="px-2 py-3 font-medium">Decision At</th>
          <th className="px-2 py-3 font-medium">Updated</th>
          <th className="px-2 py-3 font-medium text-right">Actions</th>
        </>
      );
    }

    if (section === "disciplinary-records") {
      return (
        <>
          <th className="px-2 py-3 font-medium">Employee</th>
          <th className="px-2 py-3 font-medium">Stage</th>
          <th className="px-2 py-3 font-medium">Checklist</th>
          <th className="px-2 py-3 font-medium">Effective Date</th>
          <th className="px-2 py-3 font-medium">Initiated By</th>
          <th className="px-2 py-3 font-medium">Status</th>
          <th className="px-2 py-3 font-medium">Decision At</th>
          <th className="px-2 py-3 font-medium">Updated</th>
          <th className="px-2 py-3 font-medium text-right">Actions</th>
        </>
      );
    }

    if (section === "offboarding-access-revocation") {
      return (
        <>
          <th className="px-2 py-3 font-medium">Employee</th>
          <th className="px-2 py-3 font-medium">Stage</th>
          <th className="px-2 py-3 font-medium">Initiated By</th>
          <th className="px-2 py-3 font-medium">Status</th>
          <th className="px-2 py-3 font-medium">Access Revoked At</th>
          <th className="px-2 py-3 font-medium">Archive Until</th>
          <th className="px-2 py-3 font-medium">Updated</th>
          <th className="px-2 py-3 font-medium text-right">Actions</th>
        </>
      );
    }

  return (
    <>
      <th className="px-2 py-3 font-medium">Employee</th>
      <th className="px-2 py-3 font-medium">Category</th>
      <th className="px-2 py-3 font-medium">Stage</th>
      <th className="px-2 py-3 font-medium">Effective Date</th>
        <th className="px-2 py-3 font-medium">Initiated By</th>
        <th className="px-2 py-3 font-medium">Status</th>
        <th className="px-2 py-3 font-medium">Decision At</th>
        <th className="px-2 py-3 font-medium">Updated</th>
        <th className="px-2 py-3 font-medium text-right">Actions</th>
      </>
    );
  };

  const renderLifecycleEmployeeCell = (record) => (
    <>
      <p className="font-medium text-slate-900">{valueOrDash(record.employee)}</p>
      <p className="text-xs text-slate-500">{valueOrDash(record.employeeEmail)}</p>
    </>
  );

  const renderLifecycleActionCell = (record, rowSelected) => (
    <td className="px-2 py-3 text-right">
      {(() => {
        const requiredEvidence = getRequiredEvidenceSummary(record);
        const offboardBlocked = isOffboardingRecord(record) && !requiredEvidence.complete;
        return (
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
        {canManage && isOffboardingRecord(record) ? (
          <button
            type="button"
            onClick={() => triggerOffboarding(record)}
            disabled={isSubmitting || offboardBlocked}
            title={offboardBlocked ? "Attach required offboarding evidence first." : undefined}
            className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
          >
            Offboard
          </button>
        ) : null}
      </div>
        );
      })()}
    </td>
  );

  const renderLifecycleDataCells = (record, { checklistProgress, rowSelected }) => {
    const effectiveDate = getLifecycleEffectiveDate(record);
    const owner = String(record?.owner || "").trim();
    const decisionAt = getLifecycleDecisionTimestamp(record);
    const roleTransition = getLifecycleRoleTransition(record);
    const departmentTransition = getLifecycleDepartmentTransition(record);
    const employeeNumber = getLifecycleEmployeeNumber(record);
    const accessRevokedAt = getLifecycleAccessRevokedAt(record);
    const archiveUntil = getLifecycleArchiveUntil(record);

    if (section === "onboarding") {
      return (
        <>
          <td className="px-2 py-3">{renderLifecycleEmployeeCell(record)}</td>
          <td className="px-2 py-3 text-xs">{valueOrDash(employeeNumber)}</td>
          <td className="px-2 py-3 text-xs">{formatDateShort(effectiveDate)}</td>
          <td className="px-2 py-3 text-xs">{valueOrDash(owner)}</td>
          <td className="px-2 py-3">
            <StatusBadge value={record.status || "-"} />
          </td>
          <td className="px-2 py-3 text-xs">{decisionAt ? formatDate(decisionAt) : "-"}</td>
          <td className="px-2 py-3 text-xs text-slate-600">{formatDate(record.updatedAt || record.createdAt)}</td>
          {renderLifecycleActionCell(record, rowSelected)}
        </>
      );
    }

    if (section === "role-changes") {
      return (
        <>
          <td className="px-2 py-3">{renderLifecycleEmployeeCell(record)}</td>
          <td className="px-2 py-3 text-xs">{valueOrDash(roleTransition)}</td>
          <td className="px-2 py-3 text-xs">{valueOrDash(departmentTransition)}</td>
          <td className="px-2 py-3 text-xs">{formatDateShort(effectiveDate)}</td>
          <td className="px-2 py-3 text-xs">{valueOrDash(owner)}</td>
          <td className="px-2 py-3">
            <StatusBadge value={record.status || "-"} />
          </td>
          <td className="px-2 py-3 text-xs">{decisionAt ? formatDate(decisionAt) : "-"}</td>
          <td className="px-2 py-3 text-xs text-slate-600">{formatDate(record.updatedAt || record.createdAt)}</td>
          {renderLifecycleActionCell(record, rowSelected)}
        </>
      );
    }

    if (section === "disciplinary-records") {
      return (
        <>
          <td className="px-2 py-3">{renderLifecycleEmployeeCell(record)}</td>
          <td className="px-2 py-3">{valueOrDash(record?.workflow?.stage)}</td>
          <td className="px-2 py-3 text-xs">
            {checklistProgress.completed}/{checklistProgress.total}
          </td>
          <td className="px-2 py-3 text-xs">{formatDateShort(effectiveDate)}</td>
          <td className="px-2 py-3 text-xs">{valueOrDash(owner)}</td>
          <td className="px-2 py-3">
            <StatusBadge value={record.status || "-"} />
          </td>
          <td className="px-2 py-3 text-xs">{decisionAt ? formatDate(decisionAt) : "-"}</td>
          <td className="px-2 py-3 text-xs text-slate-600">{formatDate(record.updatedAt || record.createdAt)}</td>
          {renderLifecycleActionCell(record, rowSelected)}
        </>
      );
    }

    if (section === "offboarding-access-revocation") {
      return (
        <>
          <td className="px-2 py-3">{renderLifecycleEmployeeCell(record)}</td>
          <td className="px-2 py-3">{valueOrDash(record?.workflow?.stage)}</td>
          <td className="px-2 py-3 text-xs">{valueOrDash(owner)}</td>
          <td className="px-2 py-3">
            <StatusBadge value={record.status || "-"} />
          </td>
          <td className="px-2 py-3 text-xs">{accessRevokedAt ? formatDate(accessRevokedAt) : "-"}</td>
          <td className="px-2 py-3 text-xs">{archiveUntil ? formatDate(archiveUntil) : "-"}</td>
          <td className="px-2 py-3 text-xs text-slate-600">{formatDate(record.updatedAt || record.createdAt)}</td>
          {renderLifecycleActionCell(record, rowSelected)}
        </>
      );
    }

  return (
    <>
      <td className="px-2 py-3">{renderLifecycleEmployeeCell(record)}</td>
      <td className="px-2 py-3">{valueOrDash(record.category)}</td>
      <td className="px-2 py-3">{valueOrDash(record?.workflow?.stage)}</td>
        <td className="px-2 py-3 text-xs">{formatDateShort(effectiveDate)}</td>
        <td className="px-2 py-3 text-xs">{valueOrDash(owner)}</td>
        <td className="px-2 py-3">
          <StatusBadge value={record.status || "-"} />
        </td>
        <td className="px-2 py-3 text-xs">{decisionAt ? formatDate(decisionAt) : "-"}</td>
        <td className="px-2 py-3 text-xs text-slate-600">{formatDate(record.updatedAt || record.createdAt)}</td>
        {renderLifecycleActionCell(record, rowSelected)}
      </>
    );
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
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/45 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Create Lifecycle Workflow"
          onClick={closeCreateModal}
        >
          <div
            className="my-4 flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
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

            <form className="mt-4 grid flex-1 gap-3 overflow-y-auto pr-1 md:grid-cols-3" onSubmit={createRecord}>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                  Lifecycle Category
                </label>
                <select
                  value={form.category}
                  onChange={handleCategoryChange}
                  className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                >
                  <option>Onboarding</option>
                  <option>Role Change</option>
                  <option>Disciplinary</option>
                  <option>Offboarding</option>
                </select>
              </div>
              {isOnboardingCategory(form.category) ? (
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Workflow Status
                  </label>
                  <input
                    value={form.activateEmploymentNow ? "Approved (auto on create)" : "In Progress"}
                    readOnly
                    aria-readonly="true"
                    className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700"
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Workflow Status
                  </label>
                  <select
                    value={form.status}
                    onChange={handleFormField("status")}
                    className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                  >
                    <option>In Progress</option>
                    <option>Completed</option>
                    <option>Approved</option>
                    <option>Rejected</option>
                  </select>
                </div>
              )}
              {createRequiredEvidenceRules.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 md:col-span-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-700">
                    Required Documents For Final Status
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {createRequiredEvidenceRules.map((rule) => (
                      <span
                        key={rule.id}
                        className="inline-flex rounded-md border border-amber-200 bg-white px-2 py-1 text-[11px] font-medium text-amber-700"
                      >
                        {rule.label}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-amber-700">
                    You cannot set this workflow to Approved/Completed/Access Revoked until all required documents are attached.
                  </p>
                </div>
              ) : null}
              {isOnboardingCategory(form.category) ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 md:col-span-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Workflow Steps
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span className="inline-flex rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700">
                      1. Encode Employee Details
                    </span>
                    <span className="inline-flex rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700">
                      2. Upload Documents
                    </span>
                    <span className="inline-flex rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700">
                      3. Create Account
                    </span>
                    <span className="inline-flex rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700">
                      4. Activate Employment
                    </span>
                  </div>
                </div>
              ) : null}

              {isOnboardingCategory(form.category) ? (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Employee Number</label>
                    <input
                      required
                      value={form.onboardingEmployeeId}
                      onChange={handleFormField("onboardingEmployeeId")}
                      placeholder="Employee number"
                      className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Last Name</label>
                    <input
                      required
                      value={form.onboardingLastName}
                      onChange={handleFormField("onboardingLastName")}
                      placeholder="Last name"
                      className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">First Name</label>
                    <input
                      required
                      value={form.onboardingFirstName}
                      onChange={handleFormField("onboardingFirstName")}
                      placeholder="First name"
                      className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Middle Name</label>
                    <input
                      value={form.onboardingMiddleName}
                      onChange={handleFormField("onboardingMiddleName")}
                      placeholder="Middle name"
                      className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Suffix</label>
                    <input
                      value={form.onboardingSuffix}
                      onChange={handleFormField("onboardingSuffix")}
                      placeholder="Suffix (optional)"
                      className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                      Account Email (Google Sign-In)
                    </label>
                    <input
                      required
                      value={form.employeeEmail}
                      onChange={handleFormField("employeeEmail")}
                      type="email"
                      placeholder="employee@gmail.com"
                      className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Assigned Role</label>
                    <select
                      required
                      value={form.onboardingRole}
                      onChange={handleFormField("onboardingRole")}
                      className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                    >
                      <option value="">Select role</option>
                      {availableRoleTargets.map((roleOption) => (
                        <option key={`onboarding-role-${roleOption.value}`} value={roleOption.value}>
                          {roleOption.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Assigned Department</label>
                    <select
                      required
                      value={form.onboardingDepartment}
                      onChange={handleFormField("onboardingDepartment")}
                      className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                    >
                      <option value="">Select department</option>
                      {departmentCatalogOptions.map((departmentOption) => (
                        <option
                          key={`onboarding-department-${departmentOption.value}`}
                          value={departmentOption.value}
                        >
                          {departmentOption.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Work Setup</label>
                    <select
                      value={form.workSetup}
                      onChange={handleFormField("workSetup")}
                      className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                    >
                      {ONBOARDING_WORK_SETUP_OPTIONS.map((workSetup) => (
                        <option key={`work-setup-${workSetup}`} value={workSetup}>
                          {workSetup}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                      Employment Start Date
                    </label>
                    <input
                      type="date"
                      required
                      value={form.onboardingStartDate}
                      onChange={handleFormField("onboardingStartDate")}
                      className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                      Generated Employee Display Name
                    </label>
                    <input
                      value={composeOnboardingEmployeeName(form)}
                      readOnly
                      aria-readonly="true"
                      className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700"
                    />
                  </div>
                  <div className="space-y-1 md:col-span-3">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                      Upload Onboarding Documents
                    </label>
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                      onChange={handleOnboardingDocumentsChange}
                      className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-2.5 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
                    />
                    <p className="text-[11px] text-slate-500">
                      Add contracts, IDs, NDA, and other onboarding files (max 10 files, 10 MB each).
                    </p>
                    {onboardingDocuments.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {onboardingDocuments.map((file, index) => (
                          <span
                            key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700"
                          >
                            <span className="max-w-[210px] truncate">{file.name}</span>
                            <span className="text-slate-500">({formatFileSize(file.size)})</span>
                            <button
                              type="button"
                              onClick={() => removeOnboardingDocument(index)}
                              className="rounded px-1 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
                              aria-label={`Remove ${file.name}`}
                            >
                              x
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-500">No files selected.</p>
                    )}
                  </div>
                  <div className="space-y-1 md:col-span-3">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                      Activate Employment
                    </label>
                    <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={Boolean(form.activateEmploymentNow)}
                        onChange={handleFormToggle("activateEmploymentNow")}
                        className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      Activate employment immediately after onboarding is created.
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Employee Name</label>
                    <select
                      required
                      value={form.employeeRecordId}
                      onChange={handleEmployeeSelection}
                      className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
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
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Employee Email</label>
                    <input
                      value={form.employeeEmail}
                      readOnly
                      aria-readonly="true"
                      className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700"
                    />
                  </div>
                </>
              )}
              {isRoleMovementCategory(form.category) ? (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Current Role</label>
                    <input
                      value={valueOrDash(toRoleLabel(form.roleFrom))}
                      readOnly
                      aria-readonly="true"
                      title="Auto-fetched from selected employee record"
                      className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">New Role</label>
                    <select
                      required
                      value={form.roleTo}
                      onChange={handleFormField("roleTo")}
                      className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                    >
                      <option value="">Select role</option>
                      {availableRoleTargets.map((roleOption) => (
                        <option key={`role-to-${roleOption.value}`} value={roleOption.value}>
                          {roleOption.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Effective Date</label>
                    <input
                      value={form.effectiveDate}
                      onChange={handleFormField("effectiveDate")}
                      type="date"
                      className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Current Department</label>
                    <input
                      value={valueOrDash(form.departmentFrom)}
                      readOnly
                      aria-readonly="true"
                      title="Auto-fetched from selected employee record"
                      className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">New Department</label>
                    <select
                      value={form.departmentTo}
                      onChange={handleFormField("departmentTo")}
                      className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                    >
                      <option value="">Select department</option>
                      {departmentCatalogOptions.map((departmentOption) => (
                        <option
                          key={`department-to-${departmentOption.value}`}
                          value={departmentOption.value}
                        >
                          {departmentOption.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1 md:col-span-3">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                      Role Change Justification
                    </label>
                    <input
                      value={form.justification}
                      onChange={handleFormField("justification")}
                      placeholder="Enter justification"
                      className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                    />
                  </div>
                </>
              ) : null}
              {createCategoryType === "disciplinary" || createCategoryType === "offboarding" ? (
                <div className="space-y-1 md:col-span-3">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Upload {createCategoryType === "disciplinary" ? "Disciplinary" : "Offboarding"} Documents
                  </label>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.csv,.txt"
                    onChange={handleCategoryDocumentsChange(createCategoryType)}
                    className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-2.5 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
                  />
                  <p className="text-[11px] text-slate-500">
                    Attach supporting files now (max 10 files, 10 MB each).
                  </p>
                  {createWorkflowDocuments.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {createWorkflowDocuments.map((file, index) => (
                        <span
                          key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700"
                        >
                          <span className="max-w-[210px] truncate">{file.name}</span>
                          <span className="text-slate-500">({formatFileSize(file.size)})</span>
                          <button
                            type="button"
                            onClick={() => removeCategoryDocument(createCategoryType, index)}
                            className="rounded px-1 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
                            aria-label={`Remove ${file.name}`}
                          >
                            x
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">No files selected.</p>
                  )}
                </div>
              ) : null}
              <div
                className={`space-y-1 ${isRoleMovementCategory(form.category) || isOnboardingCategory(form.category) ? "md:col-span-3" : ""}`}
              >
                <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Notes</label>
                <input
                  value={form.details}
                  onChange={handleFormField("details")}
                  placeholder={isOnboardingCategory(form.category) ? "Onboarding notes" : "Details / notes"}
                  className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                />
              </div>
              <div className="sticky bottom-0 z-10 mt-1 flex items-center justify-end gap-2 border-t border-slate-200 bg-white pt-3 md:col-span-3">
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
                    (isOnboardingCategory(form.category)
                      ? !String(form.onboardingEmployeeId || "").trim() ||
                        !String(form.onboardingLastName || "").trim() ||
                        !String(form.onboardingFirstName || "").trim() ||
                        !String(form.employeeEmail || "").trim() ||
                        !String(form.onboardingRole || "").trim() ||
                        !String(form.onboardingDepartment || "").trim() ||
                        !String(form.onboardingStartDate || "").trim()
                      : employeeOptions.length === 0 || !form.employeeRecordId)
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
        <div className="grid gap-3 sm:grid-cols-3">
          {summaryCards.map((card) => (
            <div key={card.key} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{card.label}</p>
              <p className="mt-0.5 text-lg font-semibold text-slate-900">{card.value}</p>
            </div>
          ))}
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
            <>
              <div className="overflow-x-auto">
                <table className="min-w-[1180px] w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                      {renderLifecycleHeaderCells()}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRecords.map((record) => {
                      const checklistProgress = getChecklistProgress(record);
                      const rowSelected = isWorkflowConsoleOpen && selectedRecordId === record.id;
                      return (
                        <tr key={record.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                          {renderLifecycleDataCells(record, { checklistProgress, rowSelected })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <PaginationControls pagination={recordsPagination} onPageChange={setRecordsPage} />
            </>
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
                    Checklist automation, stage control, and lifecycle evidence management
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{valueOrDash(activeRecord.employee)}</p>
                    <p className="text-xs text-slate-600">{valueOrDash(activeRecord.employeeEmail)}</p>
                  </div>
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
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-600">
                  <span className="rounded-md border border-slate-200 bg-white px-2 py-1">
                    Stage: {valueOrDash(activeRecord?.workflow?.stage)}
                  </span>
                  <span className="rounded-md border border-slate-200 bg-white px-2 py-1">
                    SLA Due: {formatDateShort(activeRecord?.workflow?.slaDueAt)}
                  </span>
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

                {activeRequiredEvidence.required.length > 0 ? (
                  <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Required Documents</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {activeRequiredEvidence.required.map((item) => {
                        const completed = activeRequiredEvidence.matched.some((entry) => entry.id === item.id);
                        return (
                          <span
                            key={item.id}
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${
                              completed
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-amber-200 bg-amber-50 text-amber-700"
                            }`}
                          >
                            {item.label}
                          </span>
                        );
                      })}
                    </div>
                    {!activeRequiredEvidence.complete ? (
                      <p className="mt-1.5 text-[11px] text-amber-700">
                        Final status is blocked until all required documents are attached.
                      </p>
                    ) : (
                      <p className="mt-1.5 text-[11px] text-emerald-700">Required evidence complete.</p>
                    )}
                  </div>
                ) : null}

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
