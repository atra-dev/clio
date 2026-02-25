"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SurfaceCard from "@/components/hris/SurfaceCard";
import EmptyState from "@/components/hris/shared/EmptyState";
import ModuleTabs from "@/components/hris/shared/ModuleTabs";
import PaginationControls from "@/components/hris/shared/PaginationControls";
import StatusBadge from "@/components/hris/shared/StatusBadge";
import { useToast } from "@/components/ui/ToastProvider";
import { formatEmployeeName, formatNameFromEmail } from "@/lib/name-utils";
import {
  removeStorageObjectByPath,
  uploadEmployeeDocumentToStorage,
} from "@/services/firebase-storage-client";
import { hrisApi } from "@/services/hris-api-client";
import { toSubTabAnchor } from "@/lib/subtab-anchor";

const DETAIL_TABS = [
  { id: "profile", label: "Employee Profile" },
  { id: "compliance", label: "Government & Compliance IDs" },
  { id: "payroll", label: "Payroll Information" },
  { id: "documents", label: "Employee Attached Documents" },
  { id: "activity", label: "Recent Activity" },
];

const EMPLOYMENT_STATUS_OPTIONS = ["Active Employee", "Probation", "On Leave", "Resigned", "Terminated"];
const RECORD_STATUS_OPTIONS = ["Active", "Probation", "Inactive", "Archived"];
const DEFAULT_ROLE_OPTIONS = [
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
const GOVERNMENT_ID_FIELDS = [
  { key: "primaryId", label: "Primary Government ID" },
  { key: "sss", label: "SSS" },
  { key: "tin", label: "TIN" },
  { key: "philhealth", label: "PhilHealth" },
  { key: "pagibig", label: "Pag-IBIG" },
  { key: "passport", label: "Passport" },
];
const PAYROLL_FIELDS = [
  { key: "compensationType", label: "Compensation Type", placeholder: "Monthly" },
  { key: "baseSalary", label: "Base Salary", placeholder: "e.g. 45000" },
  { key: "bankName", label: "Bank Name", placeholder: "e.g. BPI" },
  { key: "accountName", label: "Account Name", placeholder: "Employee Name" },
  { key: "accountNumber", label: "Account Number", placeholder: "XXXX-XXXX" },
  { key: "taxCode", label: "Tax Code", placeholder: "S/ME1" },
];

const initialCreateForm = {
  employeeId: "",
  name: "",
  email: "",
  role: "EMPLOYEE_L1",
  department: "",
  jobTitle: "",
  hireDate: "",
  employmentStatus: "Active Employee",
  status: "Active",
  contact: "",
  address: "",
  emergencyContact: "",
  managerEmail: "",
  payrollGroup: "",
  govId: "",
};

const initialMasterDraft = {
  employeeId: "",
  lastName: "",
  firstName: "",
  middleName: "",
  suffix: "",
  email: "",
  department: "",
  jobTitle: "",
  hireDate: "",
};

const initialEmploymentDraft = {
  employmentStatus: "Active Employee",
  status: "Active",
  managerEmail: "",
};

const initialContactDraft = {
  contact: "",
  address: "",
  emergencyContact: "",
};

const initialGovernmentDraft = {
  primaryId: "",
  sss: "",
  tin: "",
  philhealth: "",
  pagibig: "",
  passport: "",
};

const initialPayrollDraft = {
  payrollGroup: "",
  compensationType: "",
  baseSalary: "",
  bankName: "",
  accountName: "",
  accountNumber: "",
  taxCode: "",
};

const initialAccessDraft = {
  role: "EMPLOYEE_L1",
  status: "Active",
  managerEmail: "",
};

const initialSelfRecordForm = {
  firstName: "",
  middleName: "",
  lastName: "",
  suffix: "",
  contact: "",
  address: "",
  emergencyContact: "",
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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRecordId(value) {
  return String(value || "").trim();
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return {};
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
    const key = `${option.value}::${option.label}`.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(option);
  });

  return merged;
}

function valueOrDash(value) {
  const normalized = String(value ?? "").trim();
  return normalized || "-";
}

function asInputValue(value) {
  const normalized = String(value ?? "").trim();
  return normalized === "-" ? "" : normalized;
}

function formatActorName(nameValue, emailValue) {
  const explicitName = String(nameValue || "").trim();
  if (explicitName) {
    return explicitName;
  }

  const email = String(emailValue || "").trim().toLowerCase();
  if (!email.includes("@")) {
    return valueOrDash(emailValue);
  }

  return formatNameFromEmail(email, { fallbackLabel: "User" });
}

function formatActorEmail(emailValue, fallbackValue) {
  const explicitEmail = String(emailValue || "").trim();
  if (explicitEmail.includes("@")) {
    return explicitEmail.toLowerCase();
  }

  const fallback = String(fallbackValue || "").trim();
  if (fallback.includes("@")) {
    return fallback.toLowerCase();
  }

  return "";
}

function getActorAvatarUrl(avatarValue) {
  const avatar = String(avatarValue || "").trim();
  return avatar || "/avatars/default-user.svg";
}

function toLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "-";
  }
  const normalizedUpper = normalized.toUpperCase();
  const roleLabelMap = {
    EMPLOYEE: "Employee (L1)",
    EMPLOYEE_L1: "Employee (L1)",
    EMPLOYEE_L2: "Employee (L2)",
    EMPLOYEE_L3: "Employee (L3)",
  };
  if (roleLabelMap[normalizedUpper]) {
    return roleLabelMap[normalizedUpper];
  }
  if (!normalized.includes("_")) {
    return normalized;
  }
  return normalized
    .split("_")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function splitLegacyName(rawName) {
  const name = String(rawName || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!name) {
    return {
      lastName: "",
      firstName: "",
      middleName: "",
      suffix: "",
    };
  }

  const suffixes = new Set(["JR", "JR.", "SR", "SR.", "I", "II", "III", "IV", "V"]);

  if (name.includes(",")) {
    const [left, right] = name.split(",", 2);
    const tokens = String(right || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    let suffix = "";
    if (tokens.length > 0 && suffixes.has(tokens[tokens.length - 1].toUpperCase())) {
      suffix = tokens.pop() || "";
    }
    const firstName = tokens.shift() || "";
    const middleName = tokens.join(" ");
    return {
      lastName: String(left || "").trim(),
      firstName,
      middleName,
      suffix,
    };
  }

  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    return {
      lastName: "",
      firstName: tokens[0],
      middleName: "",
      suffix: "",
    };
  }

  let suffix = "";
  if (suffixes.has(tokens[tokens.length - 1].toUpperCase())) {
    suffix = tokens.pop() || "";
  }

  if (tokens.length === 2) {
    return {
      lastName: tokens[1],
      firstName: tokens[0],
      middleName: "",
      suffix,
    };
  }

  return {
    lastName: tokens[tokens.length - 1] || "",
    firstName: tokens[0] || "",
    middleName: tokens.slice(1, -1).join(" "),
    suffix,
  };
}

function composeRecordDisplayName(record) {
  return formatEmployeeName({
    lastName: record?.lastName,
    firstName: record?.firstName,
    middleName: record?.middleName,
    suffix: record?.suffix,
    fallback: record?.name,
    fallbackEmail: record?.email,
    fallbackLabel: "Employee",
  });
}

function buildMasterDraft(record) {
  if (!record) {
    return initialMasterDraft;
  }
  const legacy = splitLegacyName(record.name);
  return {
    employeeId: String(record.employeeId || ""),
    lastName: String(record.lastName || legacy.lastName || ""),
    firstName: String(record.firstName || legacy.firstName || ""),
    middleName: String(record.middleName || legacy.middleName || ""),
    suffix: String(record.suffix || legacy.suffix || ""),
    email: String(record.email || ""),
    department: String(record.department || ""),
    jobTitle: String(record.jobTitle || ""),
    hireDate: String(record.hireDate || ""),
  };
}

function buildEmploymentDraft(record) {
  if (!record) {
    return initialEmploymentDraft;
  }
  return {
    employmentStatus: String(record.employmentStatus || "Active Employee"),
    status: String(record.status || "Active"),
    managerEmail: String(record.managerEmail || ""),
  };
}

function buildContactDraft(record) {
  if (!record) {
    return initialContactDraft;
  }
  const contactInfo = ensureObject(record.contactInformation);
  return {
    contact: String(record.contact || contactInfo.primaryPhone || ""),
    address: String(record.address || contactInfo.address || ""),
    emergencyContact: String(record.emergencyContact || contactInfo.emergencyContact || ""),
  };
}

function buildGovernmentDraft(record) {
  if (!record) {
    return initialGovernmentDraft;
  }
  const governmentIds = ensureObject(record.governmentIds);
  return {
    primaryId: String(record.govId || governmentIds.primaryId || ""),
    sss: String(governmentIds.sss || ""),
    tin: String(governmentIds.tin || ""),
    philhealth: String(governmentIds.philhealth || ""),
    pagibig: String(governmentIds.pagibig || ""),
    passport: String(governmentIds.passport || ""),
  };
}

function buildPayrollDraft(record) {
  if (!record) {
    return initialPayrollDraft;
  }
  const payroll = ensureObject(record.payrollInformation);
  return {
    payrollGroup: String(record.payrollGroup || ""),
    compensationType: String(payroll.compensationType || ""),
    baseSalary: String(payroll.baseSalary || ""),
    bankName: String(payroll.bankName || ""),
    accountName: String(payroll.accountName || ""),
    accountNumber: String(payroll.accountNumber || ""),
    taxCode: String(payroll.taxCode || ""),
  };
}

function buildAccessDraft(record) {
  if (!record) {
    return initialAccessDraft;
  }
  return {
    role: String(record.role || "EMPLOYEE_L1"),
    status: String(record.status || "Active"),
    managerEmail: String(record.managerEmail || ""),
  };
}

function buildGovernmentIdsPayload(draft, existingGovernmentIds) {
  const next = {
    ...ensureObject(existingGovernmentIds),
  };
  GOVERNMENT_ID_FIELDS.forEach(({ key }) => {
    const value = String(draft?.[key] || "").trim();
    if (value) {
      next[key] = value;
    } else {
      delete next[key];
    }
  });
  return next;
}

function buildPayrollPayload(draft, existingPayroll) {
  const next = {
    ...ensureObject(existingPayroll),
  };
  PAYROLL_FIELDS.forEach(({ key }) => {
    const value = String(draft?.[key] || "").trim();
    if (value) {
      next[key] = value;
    } else {
      delete next[key];
    }
  });
  return next;
}

function detailsRow(label, value, rowKey) {
  return (
    <div key={rowKey} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm text-slate-800">{valueOrDash(value)}</p>
    </div>
  );
}

function requestActionConfirmation(message) {
  if (typeof window === "undefined") {
    return true;
  }
  return window.confirm(message);
}

function inferDocumentType(file) {
  const mimeType = String(file?.type || "").trim().toLowerCase();
  if (mimeType.includes("pdf")) {
    return "PDF";
  }
  if (mimeType.includes("image")) {
    return "Image";
  }
  if (mimeType.includes("sheet") || mimeType.includes("excel") || mimeType.includes("csv")) {
    return "Spreadsheet";
  }
  if (mimeType.includes("word") || mimeType.includes("document")) {
    return "Document";
  }
  const fileName = String(file?.name || "").trim();
  const extension = fileName.includes(".") ? fileName.split(".").pop() : "";
  return extension ? extension.toUpperCase() : "General";
}

function formatFileSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) {
    return "-";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function EmployeeRecordsModule({ session }) {
  const toast = useToast();
  const actorRole = session?.role || "EMPLOYEE_L1";
  const actorEmail = session?.email || "";
  const employeeRole = isEmployeeRole(actorRole);
  const canManageRecords = !employeeRole;
  const [referenceCatalog, setReferenceCatalog] = useState({
    roles: DEFAULT_ROLE_OPTIONS,
    departments: DEFAULT_DEPARTMENT_OPTIONS,
  });

  const [detailTab, setDetailTab] = useState("profile");
  const [records, setRecords] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [createForm, setCreateForm] = useState(initialCreateForm);
  const [masterDraft, setMasterDraft] = useState(initialMasterDraft);
  const [employmentDraft, setEmploymentDraft] = useState(initialEmploymentDraft);
  const [contactDraft, setContactDraft] = useState(initialContactDraft);
  const [governmentDraft, setGovernmentDraft] = useState(initialGovernmentDraft);
  const [payrollDraft, setPayrollDraft] = useState(initialPayrollDraft);
  const [accessDraft, setAccessDraft] = useState(initialAccessDraft);
  const [selfRecordForm, setSelfRecordForm] = useState(initialSelfRecordForm);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showDetailsPanel, setShowDetailsPanel] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const detailsPanelRef = useRef(null);
  const documentInputRef = useRef(null);
  const detailTabs = useMemo(
    () => (employeeRole ? DETAIL_TABS.filter((tab) => tab.id === "profile" || tab.id === "documents") : DETAIL_TABS),
    [employeeRole],
  );
  const roleCatalogOptions = useMemo(
    () => mergeCatalogOptions(referenceCatalog.roles, DEFAULT_ROLE_OPTIONS),
    [referenceCatalog.roles],
  );
  const departmentCatalogOptions = useMemo(
    () => mergeCatalogOptions(referenceCatalog.departments, DEFAULT_DEPARTMENT_OPTIONS),
    [referenceCatalog.departments],
  );

  const openRecord = useCallback((row) => {
    const recordId = normalizeRecordId(row?.id || row?.recordId);
    if (!recordId) {
      toast.error("Unable to open employee details. Missing record identifier.");
      return;
    }

    setSelectedId(recordId);
    setDetailTab("profile");
    setShowDetailsPanel(true);

    if (typeof window !== "undefined" && window.innerWidth < 1280) {
      window.requestAnimationFrame(() => {
        detailsPanelRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  }, [toast]);

  useEffect(() => {
    if (!showCreateForm || typeof window === "undefined") {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setShowCreateForm(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showCreateForm]);

  useEffect(() => {
    if (employeeRole) {
      setReferenceCatalog({
        roles: DEFAULT_ROLE_OPTIONS,
        departments: DEFAULT_DEPARTMENT_OPTIONS,
      });
      return;
    }

    let isMounted = true;
    (async () => {
      try {
        const payload = await hrisApi.settings.referenceData.list();
        if (!isMounted) {
          return;
        }
        setReferenceCatalog({
          roles: mergeCatalogOptions(payload?.catalogs?.roles, DEFAULT_ROLE_OPTIONS),
          departments: mergeCatalogOptions(payload?.catalogs?.departments, DEFAULT_DEPARTMENT_OPTIONS),
        });
      } catch {
        if (!isMounted) {
          return;
        }
        setReferenceCatalog({
          roles: DEFAULT_ROLE_OPTIONS,
          departments: DEFAULT_DEPARTMENT_OPTIONS,
        });
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [employeeRole]);

  const loadDirectory = useCallback(async () => {
    setIsLoading(true);
    try {
      const payload = await hrisApi.employees.list({
        q: query,
        status: statusFilter,
        role: roleFilter,
        page,
        pageSize: 10,
      });
      const rows = ensureArray(payload.records)
        .map((record) => ({
          ...record,
          id: normalizeRecordId(record?.id || record?.recordId),
          name: composeRecordDisplayName(record),
        }))
        .filter((record) => Boolean(record.id));
      setRecords(rows);
      setPagination(payload.pagination || null);
      if (employeeRole) {
        const ownRecordId = rows[0]?.id || "";
        if (selectedId !== ownRecordId) {
          setSelectedId(ownRecordId);
        }
        setShowDetailsPanel(Boolean(ownRecordId));
        return;
      }
      if (!selectedId && rows[0]?.id) {
        setSelectedId(rows[0].id);
      }
      if (selectedId && !rows.some((item) => item.id === selectedId)) {
        setSelectedId(rows[0]?.id || "");
      }
    } catch (error) {
      toast.error(error.message || "Unable to load employee directory.");
    } finally {
      setIsLoading(false);
    }
  }, [employeeRole, page, query, roleFilter, selectedId, statusFilter, toast]);

  const loadSelectedRecord = useCallback(async () => {
    const targetRecordId = normalizeRecordId(selectedId);
    if (!targetRecordId) {
      setSelectedRecord(null);
      return;
    }

    try {
      const payload = await hrisApi.employees.get(targetRecordId);
      const record = payload.record ? { ...payload.record, name: composeRecordDisplayName(payload.record) } : null;
      setSelectedRecord(record);
    } catch (error) {
      if (String(error?.message || "").toLowerCase().includes("invalid record identifier")) {
        setSelectedId("");
        setShowDetailsPanel(false);
      }
      setSelectedRecord(null);
      toast.error(error.message || "Unable to load employee profile.");
    }
  }, [selectedId, toast]);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  useEffect(() => {
    loadSelectedRecord();
  }, [loadSelectedRecord]);

  useEffect(() => {
    const allowedTabs = new Set(detailTabs.map((tab) => tab.id));
    if (allowedTabs.has(detailTab)) {
      return;
    }
    setDetailTab(detailTabs[0]?.id || "profile");
  }, [detailTab, detailTabs]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const allowedTabs = new Set(detailTabs.map((tab) => tab.id));
    const syncDetailTabFromHash = (rawHash = window.location.hash) => {
      const hash = String(rawHash || "")
        .replace(/^#/, "")
        .trim()
        .toLowerCase();
      if (!hash) {
        return;
      }

      const matched = DETAIL_TABS.find((tab) => toSubTabAnchor(tab.id) === hash);
      if (matched && allowedTabs.has(matched.id)) {
        setDetailTab(matched.id);
        if (selectedId) {
          setShowDetailsPanel(true);
        }
      }
    };

    const onSubTabAnchor = (event) => {
      if (event?.detail?.moduleId && event.detail.moduleId !== "employees") {
        return;
      }
      const nextAnchor = event?.detail?.anchor;
      if (!nextAnchor) {
        syncDetailTabFromHash();
        return;
      }
      syncDetailTabFromHash(`#${nextAnchor}`);
    };

    syncDetailTabFromHash();
    window.addEventListener("hashchange", syncDetailTabFromHash);
    window.addEventListener("popstate", syncDetailTabFromHash);
    window.addEventListener("clio:subtab-anchor", onSubTabAnchor);
    return () => {
      window.removeEventListener("hashchange", syncDetailTabFromHash);
      window.removeEventListener("popstate", syncDetailTabFromHash);
      window.removeEventListener("clio:subtab-anchor", onSubTabAnchor);
    };
  }, [detailTabs, selectedId]);

  const selectedRow = useMemo(() => {
    const selectedDirectoryRow = records.find((item) => item.id === selectedId) || null;
    const selectedDetailId = normalizeRecordId(selectedRecord?.id || selectedRecord?.recordId);

    if (selectedDirectoryRow && selectedRecord && selectedDetailId === selectedDirectoryRow.id) {
      const merged = {
        ...selectedDirectoryRow,
        ...selectedRecord,
        id: selectedDirectoryRow.id,
      };
      return {
        ...merged,
        name: composeRecordDisplayName(merged),
      };
    }

    if (selectedDirectoryRow) {
      return selectedDirectoryRow;
    }

    if (selectedRecord) {
      const normalizedId = normalizeRecordId(selectedRecord.id || selectedRecord.recordId);
      return {
        ...selectedRecord,
        id: normalizedId,
        name: composeRecordDisplayName(selectedRecord),
      };
    }

    return null;
  }, [records, selectedId, selectedRecord]);

  const roleOptions = useMemo(() => {
    const options = [...roleCatalogOptions];
    const currentRole = String(selectedRow?.role || "").trim();
    if (currentRole && !options.some((option) => option.value === currentRole)) {
      options.push({ value: currentRole, label: toLabel(currentRole) });
    }
    return options;
  }, [roleCatalogOptions, selectedRow?.role]);

  useEffect(() => {
    if (roleCatalogOptions.length === 0) {
      return;
    }
    setCreateForm((current) => {
      const currentRole = String(current.role || "").trim();
      if (currentRole && roleCatalogOptions.some((option) => option.value === currentRole)) {
        return current;
      }
      const preferredRole =
        roleCatalogOptions.find((option) => option.value === "EMPLOYEE_L1")?.value ||
        roleCatalogOptions.find((option) => option.value === "Employee")?.value ||
        roleCatalogOptions[0].value;
      return {
        ...current,
        role: preferredRole,
      };
    });
  }, [roleCatalogOptions]);

  useEffect(() => {
    if (!selectedRow) {
      setMasterDraft(initialMasterDraft);
      setEmploymentDraft(initialEmploymentDraft);
      setContactDraft(initialContactDraft);
      setGovernmentDraft(initialGovernmentDraft);
      setPayrollDraft(initialPayrollDraft);
      setAccessDraft(initialAccessDraft);
      return;
    }

    setMasterDraft(buildMasterDraft(selectedRow));
    setEmploymentDraft(buildEmploymentDraft(selectedRow));
    setContactDraft(buildContactDraft(selectedRow));
    setGovernmentDraft(buildGovernmentDraft(selectedRow));
    setPayrollDraft(buildPayrollDraft(selectedRow));
    setAccessDraft(buildAccessDraft(selectedRow));
  }, [selectedRow]);

  const handleCreateField = (field) => (event) => {
    setCreateForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!canManageRecords) {
      return;
    }
    const targetName = String(createForm.name || "").trim() || "this employee";
    if (!requestActionConfirmation(`Create employee record for ${targetName}?`)) {
      return;
    }
    setIsSubmitting(true);
    try {
      await hrisApi.employees.create({
        ...createForm,
        email: normalizeEmail(createForm.email),
      });
      setCreateForm(initialCreateForm);
      setShowCreateForm(false);
      toast.success("Employee record created.");
      await loadDirectory();
    } catch (error) {
      toast.error(error.message || "Unable to create employee record.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelfRecordField = (field) => (event) => {
    setSelfRecordForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const handleCreateSelfRecord = async (event) => {
    event.preventDefault();
    if (!employeeRole) {
      return;
    }

    const firstName = String(selfRecordForm.firstName || "").trim();
    const lastName = String(selfRecordForm.lastName || "").trim();
    if (!firstName || !lastName) {
      toast.error("First name and last name are required.");
      return;
    }

    if (!requestActionConfirmation("Submit your employee record details?")) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await hrisApi.employees.create({
        firstName,
        middleName: String(selfRecordForm.middleName || "").trim(),
        lastName,
        suffix: String(selfRecordForm.suffix || "").trim(),
        contact: String(selfRecordForm.contact || "").trim(),
        address: String(selfRecordForm.address || "").trim(),
        emergencyContact: String(selfRecordForm.emergencyContact || "").trim(),
      });

      setSelfRecordForm(initialSelfRecordForm);
      toast.success("Your employee record has been created.");
      await loadDirectory();

      const createdRecordId = normalizeRecordId(response?.record?.id || response?.record?.recordId);
      if (createdRecordId) {
        setSelectedId(createdRecordId);
        setDetailTab("profile");
        setShowDetailsPanel(true);
      }
    } catch (error) {
      toast.error(error.message || "Unable to create your employee record.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateRecord = async (
    payload,
    successText,
    confirmationText = "Save changes to this employee record?",
  ) => {
    const targetRecordId = normalizeRecordId(selectedId) || normalizeRecordId(selectedRow?.id);
    if (!targetRecordId) {
      toast.error("Employee record reference is missing. Please reopen the employee details.");
      return false;
    }
    if (!requestActionConfirmation(confirmationText)) {
      return false;
    }
    setIsSubmitting(true);
    try {
      await hrisApi.employees.update(targetRecordId, payload);
      toast.success(successText);
      await Promise.all([loadDirectory(), loadSelectedRecord()]);
      return true;
    } catch (error) {
      if (String(error?.message || "").toLowerCase().includes("invalid record identifier")) {
        setSelectedId("");
        setShowDetailsPanel(false);
      }
      toast.error(error.message || "Unable to update employee profile.");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async (recordId) => {
    if (!recordId || !canManageRecords) {
      return;
    }
    const targetRow = records.find((row) => row.id === recordId);
    const targetLabel = valueOrDash(targetRow?.name || targetRow?.employeeId || recordId);
    if (!requestActionConfirmation(`Archive employee record: ${targetLabel}?`)) {
      return;
    }
    setIsSubmitting(true);
    try {
      await hrisApi.employees.archive(recordId);
      if (recordId === selectedId) {
        setSelectedId("");
      }
      toast.success("Employee record archived.");
      await loadDirectory();
    } catch (error) {
      toast.error(error.message || "Unable to archive employee record.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDocumentFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const targetRecordId = normalizeRecordId(selectedId) || normalizeRecordId(selectedRow?.id);
    if (!targetRecordId || !selectedRow?.id || !canManageRecords) {
      event.target.value = "";
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("Document upload is limited to 10MB per file.");
      event.target.value = "";
      return;
    }

    const confirmationText = `Upload document "${file.name}" to this employee record?`;
    if (!requestActionConfirmation(confirmationText)) {
      event.target.value = "";
      return;
    }

    setIsSubmitting(true);
    try {
      const uploaded = await uploadEmployeeDocumentToStorage({
        file,
        employeeRecordId: targetRecordId,
        employeeEmail: selectedRow.email,
      });
      const currentDocs = ensureArray(selectedRow.documents);
      const nextDoc = {
        name: String(file.name || "").trim() || "Employee Document",
        type: inferDocumentType(file),
        ref: uploaded.downloadUrl,
        storagePath: uploaded.storagePath,
        contentType: uploaded.contentType || null,
        sizeBytes: uploaded.sizeBytes,
        uploadedAt: new Date().toISOString(),
        uploadedBy: actorEmail,
      };
      await hrisApi.employees.update(targetRecordId, {
        documents: [...currentDocs, nextDoc],
      });
      toast.success("Employee document uploaded to secure storage.");
      await Promise.all([loadDirectory(), loadSelectedRecord()]);
    } catch (error) {
      toast.error(error.message || "Unable to upload employee document.");
    } finally {
      setIsSubmitting(false);
      event.target.value = "";
    }
  };

  const removeDocument = async (index) => {
    if (!selectedRow?.id || !canManageRecords) {
      return;
    }
    const targetRecordId = normalizeRecordId(selectedId) || normalizeRecordId(selectedRow?.id);
    if (!targetRecordId) {
      toast.error("Employee record reference is missing. Please reopen the employee details.");
      return;
    }
    const currentDocs = ensureArray(selectedRow.documents);
    const targetDocument = currentDocs[index];
    if (!targetDocument) {
      return;
    }
    const documentName = String(targetDocument?.name || "").trim() || "this document";
    if (!requestActionConfirmation(`Remove document "${documentName}" from this employee record?`)) {
      return;
    }

    setIsSubmitting(true);
    try {
      await hrisApi.employees.update(targetRecordId, {
        documents: currentDocs.filter((_, currentIndex) => currentIndex !== index),
      });
      const storagePath = String(targetDocument?.storagePath || "").trim();
      if (storagePath) {
        removeStorageObjectByPath(storagePath).catch(() => null);
      }
      toast.success("Employee document removed.");
      await Promise.all([loadDirectory(), loadSelectedRecord()]);
    } catch (error) {
      toast.error(error.message || "Unable to remove employee document.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openDocument = (document, index) => {
    const targetRecordId = normalizeRecordId(selectedId) || normalizeRecordId(selectedRow?.id);
    const documentUrl = String(document?.ref || "").trim();
    if (!documentUrl) {
      return;
    }

    if (targetRecordId) {
      hrisApi.employees
        .logDocumentAccess(targetRecordId, {
          documentId: String(document?.id || document?.recordId || index).trim(),
          documentName: String(document?.name || "").trim(),
          documentType: String(document?.type || "").trim(),
          documentRef: documentUrl,
        })
        .catch(() => null);
    }

    window.open(documentUrl, "_blank", "noopener,noreferrer");
  };

  const saveMasterData = async () => {
    if (!selectedRow?.id || !canManageRecords) {
      return;
    }
    const composedName = formatEmployeeName({
      lastName: masterDraft.lastName,
      firstName: masterDraft.firstName,
      middleName: masterDraft.middleName,
      suffix: masterDraft.suffix,
      fallback: selectedRow?.name || masterDraft.email,
      fallbackEmail: masterDraft.email,
      fallbackLabel: "Employee",
    });
    await updateRecord(
      {
        employeeId: String(masterDraft.employeeId || "").trim(),
        name: composedName,
        lastName: String(masterDraft.lastName || "").trim(),
        firstName: String(masterDraft.firstName || "").trim(),
        middleName: String(masterDraft.middleName || "").trim(),
        suffix: String(masterDraft.suffix || "").trim(),
        email: normalizeEmail(masterDraft.email),
        department: String(masterDraft.department || "").trim(),
        jobTitle: String(masterDraft.jobTitle || "").trim(),
        hireDate: String(masterDraft.hireDate || "").trim(),
      },
      "Employee master data updated.",
      "Save employee master data changes?",
    );
  };

  const saveEmployment = async () => {
    if (!selectedRow?.id || !canManageRecords) {
      return;
    }
    await updateRecord(
      {
        employmentStatus: String(employmentDraft.employmentStatus || "").trim(),
        status: String(employmentDraft.status || "").trim(),
        managerEmail: normalizeEmail(employmentDraft.managerEmail),
      },
      "Employment tracking updated.",
      "Save employment status and manager changes?",
    );
  };

  const saveContacts = async () => {
    if (!selectedRow?.id) {
      return;
    }
    const payload = {
      contact: String(contactDraft.contact || "").trim(),
      address: String(contactDraft.address || "").trim(),
    };
    if (canManageRecords) {
      payload.emergencyContact = String(contactDraft.emergencyContact || "").trim();
    }
    await updateRecord(
      payload,
      "Contact information updated.",
      canManageRecords ? "Save contact information changes?" : "Save your contact information changes?",
    );
  };

  const saveFullProfile = async () => {
    if (!selectedRow?.id) {
      return;
    }

    if (!canManageRecords) {
      await saveContacts();
      return;
    }
    const composedName = formatEmployeeName({
      lastName: masterDraft.lastName,
      firstName: masterDraft.firstName,
      middleName: masterDraft.middleName,
      suffix: masterDraft.suffix,
      fallback: selectedRow?.name || masterDraft.email,
      fallbackEmail: masterDraft.email,
      fallbackLabel: "Employee",
    });

    await updateRecord(
      {
        employeeId: String(masterDraft.employeeId || "").trim(),
        name: composedName,
        lastName: String(masterDraft.lastName || "").trim(),
        firstName: String(masterDraft.firstName || "").trim(),
        middleName: String(masterDraft.middleName || "").trim(),
        suffix: String(masterDraft.suffix || "").trim(),
        email: normalizeEmail(masterDraft.email),
        department: String(masterDraft.department || "").trim(),
        jobTitle: String(masterDraft.jobTitle || "").trim(),
        hireDate: String(masterDraft.hireDate || "").trim(),
        employmentStatus: String(employmentDraft.employmentStatus || "").trim(),
        status: String(employmentDraft.status || "").trim(),
        managerEmail: normalizeEmail(employmentDraft.managerEmail),
        contact: String(contactDraft.contact || "").trim(),
        address: String(contactDraft.address || "").trim(),
        emergencyContact: String(contactDraft.emergencyContact || "").trim(),
      },
      "Full profile information updated.",
      "Save all profile updates for this employee?",
    );
  };

  const saveCompliance = async () => {
    if (!selectedRow?.id || !canManageRecords) {
      return;
    }
    await updateRecord(
      {
        govId: String(governmentDraft.primaryId || "").trim(),
        governmentIds: buildGovernmentIdsPayload(governmentDraft, selectedRow.governmentIds),
      },
      "Government and compliance IDs updated.",
      "Save government and compliance ID changes?",
    );
  };

  const savePayroll = async () => {
    if (!selectedRow?.id || !canManageRecords) {
      return;
    }
    await updateRecord(
      {
        payrollGroup: String(payrollDraft.payrollGroup || "").trim(),
        payrollInformation: buildPayrollPayload(payrollDraft, selectedRow.payrollInformation),
      },
      "Payroll information updated.",
      "Save payroll information changes?",
    );
  };

  const saveAccess = async () => {
    if (!selectedRow?.id || !canManageRecords) {
      return;
    }
    await updateRecord(
      {
        role: String(accessDraft.role || "").trim(),
        status: String(accessDraft.status || "").trim(),
        managerEmail: normalizeEmail(accessDraft.managerEmail),
      },
      "Access role assignment updated.",
      "Save access role assignment changes?",
    );
  };

  const renderDirectory = () => (
    <SurfaceCard
      title={employeeRole ? "My Employee Record" : "Employee Directory"}
      subtitle={
        employeeRole
          ? "Provide and maintain your personal employee profile details."
          : "Centralized employee master data with search, filters, and profile routing"
      }
      action={
        employeeRole ? (
          <span className="inline-flex h-9 items-center rounded-lg border border-sky-200 bg-sky-50 px-3 text-xs font-medium text-sky-700">
            Own profile access only
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(event) => {
                setPage(1);
                setQuery(event.target.value);
              }}
              placeholder="Search by name, ID, email"
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:border-sky-400 focus:outline-none"
            />
            <select
              value={statusFilter}
              onChange={(event) => {
                setPage(1);
                setStatusFilter(event.target.value);
              }}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:border-sky-400 focus:outline-none"
            >
              <option value="">All Status</option>
              {RECORD_STATUS_OPTIONS.map((statusOption) => (
                <option key={statusOption.toLowerCase()} value={statusOption.toLowerCase()}>
                  {statusOption}
                </option>
              ))}
            </select>
            <select
              value={roleFilter}
              onChange={(event) => {
                setPage(1);
                setRoleFilter(event.target.value);
              }}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:border-sky-400 focus:outline-none"
            >
              <option value="">All Roles</option>
              {roleCatalogOptions.map((roleOption) => (
                <option key={roleOption.value} value={roleOption.value.toLowerCase()}>
                  {roleOption.label}
                </option>
              ))}
            </select>
            {canManageRecords ? (
              <button
                type="button"
                onClick={() => setShowCreateForm(true)}
                className="h-9 rounded-lg border border-sky-200 bg-sky-50 px-3 text-xs font-semibold text-sky-700 transition hover:bg-sky-100"
              >
                Add Employee
              </button>
            ) : null}
          </div>
        )
      }
    >
      {isLoading ? (
        <div className="flex min-h-[160px] items-center justify-center">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 animate-spin text-sky-600"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M12 3a9 9 0 1 0 9 9" />
            </svg>
          </span>
          <span className="sr-only">Loading employee directory...</span>
        </div>
      ) : records.length === 0 ? (
        employeeRole ? (
          <div className="mx-auto w-full max-w-4xl rounded-2xl border border-sky-100 bg-gradient-to-b from-sky-50/80 to-white p-5">
            <div className="mb-4">
              <p className="text-base font-semibold text-slate-900">Complete My Employee Record</p>
              <p className="mt-1 text-sm text-slate-600">
                This form is for your own employee profile only. Fill in your details to continue.
              </p>
            </div>
            <form onSubmit={handleCreateSelfRecord} className="grid gap-3 md:grid-cols-2">
              <input
                value={selfRecordForm.lastName}
                onChange={handleSelfRecordField("lastName")}
                placeholder="Last name"
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
              />
              <input
                value={selfRecordForm.firstName}
                onChange={handleSelfRecordField("firstName")}
                placeholder="First name"
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
              />
              <input
                value={selfRecordForm.middleName}
                onChange={handleSelfRecordField("middleName")}
                placeholder="Middle name"
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
              />
              <input
                value={selfRecordForm.suffix}
                onChange={handleSelfRecordField("suffix")}
                placeholder="Suffix (optional)"
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
              />
              <input
                value={actorEmail}
                disabled
                className="h-10 rounded-lg border border-slate-300 bg-slate-100 px-3 text-sm text-slate-700 md:col-span-2"
              />
              <input
                value={selfRecordForm.contact}
                onChange={handleSelfRecordField("contact")}
                placeholder="Contact number"
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
              />
              <input
                value={selfRecordForm.address}
                onChange={handleSelfRecordField("address")}
                placeholder="Address"
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
              />
              <input
                value={selfRecordForm.emergencyContact}
                onChange={handleSelfRecordField("emergencyContact")}
                placeholder="Emergency contact"
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none md:col-span-2"
              />
              <div className="md:col-span-2 mt-1 flex justify-end">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex h-10 items-center rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
                >
                  {isSubmitting ? "Saving..." : "Submit My Record"}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <EmptyState
            title="No employee records yet"
            subtitle="Add a record to initialize the employee directory."
          />
        )
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                  <th className="px-2 py-3 font-medium">Employee ID</th>
                  <th className="px-2 py-3 font-medium">Name</th>
                  <th className="px-2 py-3 font-medium">Email</th>
                  <th className="px-2 py-3 font-medium">Department</th>
                  <th className="px-2 py-3 font-medium">Role</th>
                  <th className="px-2 py-3 font-medium">Status</th>
                  <th className="px-2 py-3 font-medium">Employment</th>
                  <th className="px-2 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-b border-slate-100 text-slate-700 last:border-b-0 ${
                      row.id === selectedId ? "bg-sky-50/50" : ""
                    }`}
                  >
                    <td className="px-2 py-3 font-mono text-xs">{row.employeeId || "-"}</td>
                    <td className="px-2 py-3 font-medium text-slate-900">{row.name || "-"}</td>
                    <td className="px-2 py-3">{row.email || "-"}</td>
                    <td className="px-2 py-3">{valueOrDash(row.department)}</td>
                    <td className="px-2 py-3">{toLabel(row.role)}</td>
                    <td className="px-2 py-3">
                      <StatusBadge value={row.status || "-"} />
                    </td>
                    <td className="px-2 py-3">{row.employmentStatus || "-"}</td>
                    <td className="px-2 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openRecord(row)}
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          Open
                        </button>
                        {canManageRecords ? (
                          <button
                            type="button"
                            onClick={() => handleArchive(row.id)}
                            disabled={isSubmitting}
                            className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                          >
                            Archive
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationControls pagination={pagination} onPageChange={setPage} />
        </div>
      )}
    </SurfaceCard>
  );

  const renderCreateForm = canManageRecords && showCreateForm ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add Employee"
      onClick={() => setShowCreateForm(false)}
    >
      <div
        className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Add Employee</h2>
            <p className="text-sm text-slate-600">
              Provision employee master data with employment, contact, and restricted PII references
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateForm(false)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
            aria-label="Close add employee modal"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-4 w-4" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <form className="grid gap-3 md:grid-cols-3" onSubmit={handleCreate}>
        <input
          value={createForm.employeeId}
          onChange={handleCreateField("employeeId")}
          placeholder="Employee ID"
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
        />
        <input
          required
          value={createForm.name}
          onChange={handleCreateField("name")}
          placeholder="Full name"
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
        />
        <input
          required
          type="email"
          value={createForm.email}
          onChange={handleCreateField("email")}
          placeholder="work.email@gmail.com"
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
        />
        <select
          value={createForm.department}
          onChange={handleCreateField("department")}
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
        >
          <option value="">Department</option>
          {departmentCatalogOptions.map((departmentOption) => (
            <option key={`create-department-${departmentOption.value}`} value={departmentOption.value}>
              {departmentOption.label}
            </option>
          ))}
        </select>
        <input
          value={createForm.jobTitle}
          onChange={handleCreateField("jobTitle")}
          placeholder="Job title"
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
        />
        <input
          type="date"
          value={createForm.hireDate}
          onChange={handleCreateField("hireDate")}
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
        />
        <select
          value={createForm.role}
          onChange={handleCreateField("role")}
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
        >
          {roleCatalogOptions.map((roleOption) => (
            <option key={roleOption.value} value={roleOption.value}>
              {roleOption.label}
            </option>
          ))}
        </select>
        <select
          value={createForm.employmentStatus}
          onChange={handleCreateField("employmentStatus")}
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
        >
          {EMPLOYMENT_STATUS_OPTIONS.map((statusOption) => (
            <option key={statusOption} value={statusOption}>
              {statusOption}
            </option>
          ))}
        </select>
        <select
          value={createForm.status}
          onChange={handleCreateField("status")}
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
        >
          {RECORD_STATUS_OPTIONS.map((statusOption) => (
            <option key={statusOption} value={statusOption}>
              {statusOption}
            </option>
          ))}
        </select>
        <input
          value={createForm.managerEmail}
          onChange={handleCreateField("managerEmail")}
          placeholder="Manager email"
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
        />
        <input
          value={createForm.contact}
          onChange={handleCreateField("contact")}
          placeholder="Primary contact"
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
        />
        <input
          value={createForm.address}
          onChange={handleCreateField("address")}
          placeholder="Address"
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
        />
        <input
          value={createForm.emergencyContact}
          onChange={handleCreateField("emergencyContact")}
          placeholder="Emergency contact"
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
        />
        <input
          value={createForm.payrollGroup}
          onChange={handleCreateField("payrollGroup")}
          placeholder="Payroll group"
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
        />
        <input
          value={createForm.govId}
          onChange={handleCreateField("govId")}
          placeholder="Primary government ID"
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
        />
        <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">Data classification: Restricted PII</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
            >
              {isSubmitting ? "Saving..." : "Create Employee"}
            </button>
          </div>
        </div>
      </form>
      </div>
    </div>
  ) : null;

  const renderProfile = () => (
    <SurfaceCard
      title={employeeRole ? "My Profile" : "Employee Profile"}
      subtitle={
        employeeRole
          ? "View your employment snapshot and update personal contact details."
          : "Full employee information in one consolidated view"
      }
    >
      {!selectedRow ? (
        <EmptyState
          title="No employee selected"
          subtitle="Select a record from the directory to manage employee profile data."
        />
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-base font-semibold text-slate-900">
                  {valueOrDash(
                    formatEmployeeName({
                      lastName: selectedRow.lastName,
                      firstName: selectedRow.firstName,
                      middleName: selectedRow.middleName,
                      suffix: selectedRow.suffix,
                      fallback: selectedRow.name,
                      fallbackEmail: selectedRow.email,
                      fallbackLabel: "Employee",
                    }),
                  )}
                </p>
                <p className="text-xs text-slate-600">
                  {valueOrDash(selectedRow.employeeId)} | {valueOrDash(selectedRow.email)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge value={selectedRow.status || "-"} />
                <span className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600">
                  Restricted PII
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            {canManageRecords ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <input
                    value={masterDraft.employeeId}
                    onChange={(event) => setMasterDraft((current) => ({ ...current, employeeId: event.target.value }))}
                    placeholder="Employee ID"
                    disabled={!canManageRecords}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100"
                  />
                  <input
                    value={masterDraft.lastName}
                    onChange={(event) => setMasterDraft((current) => ({ ...current, lastName: event.target.value }))}
                    placeholder="Last name"
                    disabled={!canManageRecords}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100"
                  />
                  <input
                    value={masterDraft.firstName}
                    onChange={(event) => setMasterDraft((current) => ({ ...current, firstName: event.target.value }))}
                    placeholder="First name"
                    disabled={!canManageRecords}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100"
                  />
                  <input
                    value={masterDraft.middleName}
                    onChange={(event) => setMasterDraft((current) => ({ ...current, middleName: event.target.value }))}
                    placeholder="Middle name"
                    disabled={!canManageRecords}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100"
                  />
                  <input
                    value={masterDraft.suffix}
                    onChange={(event) => setMasterDraft((current) => ({ ...current, suffix: event.target.value }))}
                    placeholder="Suffix (e.g. Jr.)"
                    disabled={!canManageRecords}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100"
                  />
                  <input
                    value={masterDraft.email}
                    onChange={(event) => setMasterDraft((current) => ({ ...current, email: event.target.value }))}
                    placeholder="Email"
                    disabled={!canManageRecords}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100"
                  />
                  <select
                    value={masterDraft.department}
                    onChange={(event) => setMasterDraft((current) => ({ ...current, department: event.target.value }))}
                    disabled={!canManageRecords}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100"
                  >
                    <option value="">Department</option>
                    {departmentCatalogOptions.map((departmentOption) => (
                      <option key={`profile-department-${departmentOption.value}`} value={departmentOption.value}>
                        {departmentOption.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={masterDraft.jobTitle}
                    onChange={(event) => setMasterDraft((current) => ({ ...current, jobTitle: event.target.value }))}
                    placeholder="Job title"
                    disabled={!canManageRecords}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100"
                  />
                  <input
                    type="date"
                    value={masterDraft.hireDate}
                    onChange={(event) => setMasterDraft((current) => ({ ...current, hireDate: event.target.value }))}
                    disabled={!canManageRecords}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100"
                  />
                  <select
                    value={employmentDraft.employmentStatus}
                    onChange={(event) =>
                      setEmploymentDraft((current) => ({ ...current, employmentStatus: event.target.value }))
                    }
                    disabled={!canManageRecords}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100"
                  >
                    {EMPLOYMENT_STATUS_OPTIONS.map((statusOption) => (
                      <option key={statusOption} value={statusOption}>
                        {statusOption}
                      </option>
                    ))}
                  </select>
                  <select
                    value={employmentDraft.status}
                    onChange={(event) => setEmploymentDraft((current) => ({ ...current, status: event.target.value }))}
                    disabled={!canManageRecords}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100"
                  >
                    {RECORD_STATUS_OPTIONS.map((statusOption) => (
                      <option key={statusOption} value={statusOption}>
                        {statusOption}
                      </option>
                    ))}
                  </select>
                  <input
                    value={employmentDraft.managerEmail}
                    onChange={(event) =>
                      setEmploymentDraft((current) => ({ ...current, managerEmail: event.target.value }))
                    }
                    placeholder="Manager email"
                    disabled={!canManageRecords}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100"
                  />
                  <input
                    value={contactDraft.contact}
                    placeholder="Contact"
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                    onChange={(event) => setContactDraft((current) => ({ ...current, contact: event.target.value }))}
                  />
                  <input
                    value={contactDraft.address}
                    placeholder="Address"
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                    onChange={(event) => setContactDraft((current) => ({ ...current, address: event.target.value }))}
                  />
                  <input
                    value={contactDraft.emergencyContact}
                    placeholder="Emergency contact"
                    disabled={!canManageRecords}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none disabled:bg-slate-100"
                    onChange={(event) =>
                      setContactDraft((current) => ({ ...current, emergencyContact: event.target.value }))
                    }
                  />
                </div>

                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-slate-500">You can update full profile info in one action.</p>
                  <button
                    type="button"
                    onClick={saveFullProfile}
                    disabled={isSubmitting}
                    className="inline-flex h-9 items-center rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
                  >
                    Save Full Profile
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500">
                        <th className="w-[38%] px-3 py-2 font-medium">Profile Field</th>
                        <th className="px-3 py-2 font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["Employee ID", valueOrDash(masterDraft.employeeId)],
                        ["Last Name", valueOrDash(masterDraft.lastName)],
                        ["First Name", valueOrDash(masterDraft.firstName)],
                        ["Middle Name", valueOrDash(masterDraft.middleName)],
                        ["Suffix", valueOrDash(masterDraft.suffix)],
                        ["Email", valueOrDash(masterDraft.email)],
                        ["Department", valueOrDash(masterDraft.department)],
                        ["Role", toLabel(selectedRow.role || "EMPLOYEE_L1")],
                        ["Job Title", valueOrDash(masterDraft.jobTitle)],
                        ["Employment Status", valueOrDash(employmentDraft.employmentStatus)],
                        ["Record Status", valueOrDash(employmentDraft.status)],
                        ["Start Date", valueOrDash(masterDraft.hireDate)],
                        ["Emergency Contact", valueOrDash(contactDraft.emergencyContact)],
                      ].map(([label, value]) => (
                        <tr key={label} className="border-b border-slate-100 last:border-b-0">
                          <td className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
                            {label}
                          </td>
                          <td className="px-3 py-2 text-slate-800">{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Editable Contact Details</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-[11px] font-medium text-slate-600">Contact Number</span>
                      <input
                        value={asInputValue(contactDraft.contact)}
                        placeholder="Enter contact number"
                        className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                        onChange={(event) => setContactDraft((current) => ({ ...current, contact: event.target.value }))}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] font-medium text-slate-600">Address</span>
                      <input
                        value={asInputValue(contactDraft.address)}
                        placeholder="Enter address"
                        className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                        onChange={(event) => setContactDraft((current) => ({ ...current, address: event.target.value }))}
                      />
                    </label>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-slate-500">
                    All employment details are shown above. You can update contact details here.
                  </p>
                  <button
                    type="button"
                    onClick={saveFullProfile}
                    disabled={isSubmitting}
                    className="inline-flex h-9 items-center rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
                  >
                    Save My Profile
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </SurfaceCard>
  );

  const renderAttachedDocuments = () => (
    <SurfaceCard
      title="Employee Attached Documents"
      subtitle="All documents currently attached to this employee record"
    >
      {!selectedRow ? (
        <EmptyState
          title="No employee selected"
          subtitle="Select a record to view attached employee documents."
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Attached Files</p>
              <p className="mt-1 text-xs text-slate-600">
                {ensureArray(selectedRow.documents).length} document(s) linked to this employee.
              </p>
            </div>
            {canManageRecords ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => documentInputRef.current?.click()}
                  disabled={isSubmitting}
                  className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-70"
                >
                  Upload File
                </button>
                <input
                  ref={documentInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleDocumentFileChange}
                />
              </div>
            ) : null}
          </div>

          {ensureArray(selectedRow.documents).length === 0 ? (
            <EmptyState
              title="No attached documents yet"
              subtitle="Upload employee files to build this document list."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500">
                    <th className="px-3 py-2 font-medium">Document</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Size</th>
                    <th className="px-3 py-2 font-medium">Uploaded At</th>
                    <th className="px-3 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ensureArray(selectedRow.documents).map((document, index) => (
                    <tr key={`${document.name || "document"}-${index}`} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-3 py-2 text-slate-800">{valueOrDash(document.name)}</td>
                      <td className="px-3 py-2 text-slate-700">{valueOrDash(document.type)}</td>
                      <td className="px-3 py-2 text-slate-700">{formatFileSize(document.sizeBytes)}</td>
                      <td className="px-3 py-2 text-slate-700">{formatDate(document.uploadedAt)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          {String(document.ref || "").trim() ? (
                            <button
                              type="button"
                              onClick={() => openDocument(document, index)}
                              className="inline-flex h-7 items-center rounded-md border border-sky-200 bg-sky-50 px-2.5 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100"
                            >
                              Open
                            </button>
                          ) : null}
                          {canManageRecords ? (
                            <button
                              type="button"
                              onClick={() => removeDocument(index)}
                              disabled={isSubmitting}
                              className="inline-flex h-7 items-center rounded-md border border-rose-200 bg-rose-50 px-2.5 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-70"
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </SurfaceCard>
  );

  const renderRecentActivitySection = () => (
    <SurfaceCard
      title="Recent Activity"
      subtitle="Latest change history for the selected employee record"
    >
      {!selectedRow ? (
        <EmptyState
          title="No employee selected"
          subtitle="Open an employee record to review recent activity."
        />
      ) : ensureArray(selectedRow.activityHistory).length === 0 ? (
        <p className="text-xs text-slate-500">No change history yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500">
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Performed By</th>
                <th className="px-3 py-2 font-medium">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {ensureArray(selectedRow.activityHistory)
                .slice(-20)
                .reverse()
                .map((item, index) => (
                  <tr key={`${item.at || "activity"}-${index}`} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-3 py-2 text-slate-800">{toLabel(item.action || "update")}</td>
                    <td className="px-3 py-2 text-slate-700">
                      <div className="flex items-center gap-2">
                        <Image
                          src={getActorAvatarUrl(item.byAvatar)}
                          alt={`${formatActorName(item.byName, item.byEmail || item.by)} profile`}
                          width={28}
                          height={28}
                          className="h-7 w-7 rounded-full border border-slate-200 bg-white object-cover"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-slate-800">
                            {formatActorName(item.byName, item.byEmail || item.by)}
                          </p>
                          {formatActorEmail(item.byEmail, item.by) ? (
                            <p className="truncate text-[11px] text-slate-500">{formatActorEmail(item.byEmail, item.by)}</p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{formatDate(item.at)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </SurfaceCard>
  );

  const renderCompliance = () => (
    <SurfaceCard
      title="Government & Compliance IDs"
      subtitle="Restricted PII identifiers with controlled update workflow"
    >
      {!selectedRow ? (
        <EmptyState title="No employee selected" subtitle="Select a profile to review compliance identifiers." />
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            {detailsRow("Data Classification", selectedRow.classification || "Restricted PII")}
            {GOVERNMENT_ID_FIELDS.map((field) => detailsRow(field.label, governmentDraft[field.key], field.key))}
          </div>
          {canManageRecords ? (
            <>
              <div className="grid gap-2 md:grid-cols-3">
                {GOVERNMENT_ID_FIELDS.map((field) => (
                  <input
                    key={field.key}
                    value={governmentDraft[field.key]}
                    onChange={(event) =>
                      setGovernmentDraft((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                    placeholder={field.label}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                  />
                ))}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500">Government identifiers remain classified as Restricted PII.</p>
                <button
                  type="button"
                  onClick={saveCompliance}
                  disabled={isSubmitting}
                  className="inline-flex h-9 items-center rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
                >
                  Save Compliance IDs
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">
              Sensitive identifiers are role-masked. Contact GRC/HR for compliance updates.
            </p>
          )}
        </div>
      )}
    </SurfaceCard>
  );

  const renderPayroll = () => (
    <SurfaceCard title="Payroll Information" subtitle="Payroll grouping and compensation profile under restricted access">
      {!selectedRow ? (
        <EmptyState title="No employee selected" subtitle="Select a profile to view payroll information." />
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            {detailsRow("Payroll Group", payrollDraft.payrollGroup)}
            {PAYROLL_FIELDS.map((field) => detailsRow(field.label, payrollDraft[field.key], field.key))}
            {detailsRow("Updated At", formatDate(selectedRow.updatedAt))}
          </div>
          {canManageRecords ? (
            <>
              <div className="grid gap-2 md:grid-cols-3">
                <input
                  value={payrollDraft.payrollGroup}
                  onChange={(event) => setPayrollDraft((current) => ({ ...current, payrollGroup: event.target.value }))}
                  placeholder="Payroll group"
                  className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                />
                {PAYROLL_FIELDS.map((field) => (
                  <input
                    key={field.key}
                    value={payrollDraft[field.key]}
                    onChange={(event) =>
                      setPayrollDraft((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                    placeholder={field.placeholder}
                    className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                  />
                ))}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500">Payroll information is Restricted PII.</p>
                <button
                  type="button"
                  onClick={savePayroll}
                  disabled={isSubmitting}
                  className="inline-flex h-9 items-center rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
                >
                  Save Payroll Information
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">Payroll values are restricted by role-based masking policy.</p>
          )}
        </div>
      )}
    </SurfaceCard>
  );

  const renderAccess = () => (
    <SurfaceCard title="Access & Role Assignment" subtitle="Role, manager, and account access controls">
      {!selectedRow ? (
        <EmptyState title="No employee selected" subtitle="Select a profile to manage access assignments." />
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            {detailsRow("Role Assignment", toLabel(selectedRow.role || "EMPLOYEE_L1"))}
            {detailsRow("Manager", selectedRow.managerEmail || "-")}
            {detailsRow("Record Status", selectedRow.status || "-")}
            {detailsRow("Last Updated", formatDate(selectedRow.updatedAt))}
          </div>
          {canManageRecords ? (
            <div className="grid gap-2 md:grid-cols-3">
              <select
                value={accessDraft.role}
                className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                onChange={(event) => setAccessDraft((current) => ({ ...current, role: event.target.value }))}
              >
                {roleOptions.map((roleOption) => (
                  <option key={roleOption.value} value={roleOption.value}>
                    {roleOption.label}
                  </option>
                ))}
              </select>
              <input
                value={accessDraft.managerEmail}
                placeholder="Manager email"
                className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                onChange={(event) => setAccessDraft((current) => ({ ...current, managerEmail: event.target.value }))}
              />
              <select
                value={accessDraft.status}
                className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                onChange={(event) => setAccessDraft((current) => ({ ...current, status: event.target.value }))}
              >
                {RECORD_STATUS_OPTIONS.map((statusOption) => (
                  <option key={statusOption} value={statusOption}>
                    {statusOption}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Access and role assignment can only be changed by GRC, HR, EA, or Super Admin.
            </p>
          )}
          {canManageRecords ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={saveAccess}
                disabled={isSubmitting}
                className="inline-flex h-9 items-center rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
              >
                Save Access Assignment
              </button>
            </div>
          ) : (
            null
          )}
        </div>
      )}
    </SurfaceCard>
  );

  const renderDetailsSection = () =>
    !selectedRow ? (
      <EmptyState
        title="No employee selected"
        subtitle="Open an employee from the directory to view profile, compliance, and payroll details."
      />
    ) : (
      <>
        {!employeeRole ? (
          <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <ModuleTabs
              tabs={detailTabs}
              value={detailTab}
              onChange={setDetailTab}
              className="min-w-0 flex-1"
            />
            <button
              type="button"
              onClick={() => setShowDetailsPanel(false)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M15.5 18 9.5 12l6-6" />
              </svg>
              Back
            </button>
          </div>
        ) : null}
        {detailTab === "profile" ? renderProfile() : null}
        {!employeeRole && detailTab === "compliance" ? renderCompliance() : null}
        {!employeeRole && detailTab === "payroll" ? renderPayroll() : null}
        {detailTab === "documents" ? renderAttachedDocuments() : null}
        {!employeeRole && detailTab === "activity" ? renderRecentActivitySection() : null}
      </>
    );

  return (
    <div className="space-y-4">
      {showDetailsPanel ? (
        <div id="employee-details" ref={detailsPanelRef} className="min-w-0">
          <div className="space-y-2 xl:max-h-[calc(100dvh-12rem)] xl:overflow-y-auto xl:pr-1">
            {renderDetailsSection()}
          </div>
        </div>
      ) : (
        <div id="employee-directory" className="min-w-0">
          {renderDirectory()}
        </div>
      )}
      {renderCreateForm}
    </div>
  );
}
