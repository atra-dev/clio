"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SurfaceCard from "@/components/hris/SurfaceCard";
import EmptyState from "@/components/hris/shared/EmptyState";
import ModuleTabs from "@/components/hris/shared/ModuleTabs";
import StatusBadge from "@/components/hris/shared/StatusBadge";
import { formatEmployeeName, formatPersonName } from "@/lib/name-utils";
import { hrisApi } from "@/services/hris-api-client";

const SECTION_TABS = [
  { id: "all", label: "Workflow Status Tracking" },
  { id: "onboarding", label: "Onboarding Workflow" },
  { id: "role-change", label: "Role Changes & Promotions" },
  { id: "disciplinary", label: "Disciplinary Records" },
  { id: "offboarding", label: "Offboarding" },
  { id: "exit-clearance", label: "Exit Clearance" },
  { id: "access-revocation", label: "Access Revocation Logs" },
];

const CATEGORY_BY_SECTION = {
  onboarding: "Onboarding",
  "role-change": "Role Change",
  disciplinary: "Disciplinary",
  offboarding: "Offboarding",
  "exit-clearance": "Exit Clearance",
  "access-revocation": "Access Revoked",
};

const ROLE_ASSIGNMENT_OPTIONS = [
  { value: "SUPER_ADMIN", label: "Super Admin" },
  { value: "GRC", label: "GRC" },
  { value: "HR", label: "HR" },
  { value: "EA", label: "EA" },
  { value: "EMPLOYEE_L1", label: "Employee" },
  { value: "EMPLOYEE_L2", label: "Employee L2" },
  { value: "EMPLOYEE_L3", label: "Employee L3" },
];

const ROLE_LABEL_BY_ID = new Map(ROLE_ASSIGNMENT_OPTIONS.map((entry) => [entry.value, entry.label]));

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
  approver: "",
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

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
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
  return normalized === "role change" || normalized === "promotion";
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
    details.approver = String(form.approver || "").trim();
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
  };
}

export default function EmploymentLifecycleModule({ session }) {
  const actorRole = session?.role || "EMPLOYEE_L1";
  const employeeRole = isEmployeeRole(actorRole);
  const canManage = !employeeRole;
  const workflowOwner = resolveWorkflowOwner(session);

  const [section, setSection] = useState("all");
  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [selectedStatus, setSelectedStatus] = useState("");
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [isLoadingEmployeeOptions, setIsLoadingEmployeeOptions] = useState(false);
  const [employeeOptionsError, setEmployeeOptionsError] = useState("");

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
      };
    });
  }, [canManage, employeeOptions]);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const bySection =
        section === "all"
          ? true
          : section === "access-revocation"
            ? normalizeText(record.status).includes("revoked")
            : normalizeText(record.category).includes(normalizeText(CATEGORY_BY_SECTION[section]));
      const byStatus = selectedStatus ? normalizeText(record.status).includes(normalizeText(selectedStatus)) : true;
      return bySection && byStatus;
    });
  }, [records, section, selectedStatus]);

  const handleFormField = (field) => (event) => {
    setForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const handleEmployeeNameSelection = (event) => {
    const selectedId = event.target.value;
    const option = employeeOptions.find((entry) => entry.id === selectedId);

    setForm((current) => ({
      ...current,
      employeeRecordId: selectedId,
      employee: option?.name || "",
      employeeEmail: option?.email || "",
    }));
  };

  const handleEmployeeEmailSelection = (event) => {
    const selectedId = event.target.value;
    const option = employeeOptions.find((entry) => entry.id === selectedId);

    setForm((current) => ({
      ...current,
      employeeRecordId: selectedId,
      employee: option?.name || "",
      employeeEmail: option?.email || "",
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
        setErrorMessage("Current role and new role are required for role change or promotion.");
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
      const effectSummary = summarizeLifecycleEffects(response?.effects);
      setSuccessMessage(effectSummary ? `Lifecycle workflow created. ${effectSummary}` : "Lifecycle workflow created.");
      await loadRecords();
    } catch (error) {
      setErrorMessage(error.message || "Unable to create lifecycle workflow.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateStatus = async (record, status) => {
    if (!record?.id || !canManage) {
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

  const triggerOffboarding = async (record) => {
    if (!record?.id || !canManage) {
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

  return (
    <div className="space-y-4">
      <ModuleTabs tabs={SECTION_TABS} value={section} onChange={setSection} />

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

      {canManage ? (
        <SurfaceCard title="Create Lifecycle Workflow" subtitle="Onboarding, movement, disciplinary, and offboarding actions">
          <form className="grid gap-2 md:grid-cols-3" onSubmit={createRecord}>
            <select
              required
              value={form.employeeRecordId}
              onChange={handleEmployeeNameSelection}
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
            <select
              required
              value={form.employeeRecordId}
              onChange={handleEmployeeEmailSelection}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            >
              <option value="">
                {isLoadingEmployeeOptions ? "Loading employee emails..." : "Select employee email"}
              </option>
              {employeeOptions.map((option) => (
                <option key={`email-${option.id}`} value={option.id}>
                  {option.email}
                </option>
              ))}
            </select>
            <select
              value={form.category}
              onChange={handleFormField("category")}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            >
              <option>Onboarding</option>
              <option>Role Change</option>
              <option>Promotion</option>
              <option>Disciplinary</option>
              <option>Offboarding</option>
              <option>Exit Clearance</option>
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
              <option>Approved</option>
              <option>Completed</option>
            </select>
            {isRoleMovementCategory(form.category) ? (
              <>
                <select
                  required
                  value={form.roleFrom}
                  onChange={handleFormField("roleFrom")}
                  className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                >
                  <option value="">Current role</option>
                  {ROLE_ASSIGNMENT_OPTIONS.map((roleOption) => (
                    <option key={`role-from-${roleOption.value}`} value={roleOption.value}>
                      {roleOption.label}
                    </option>
                  ))}
                </select>
                <select
                  required
                  value={form.roleTo}
                  onChange={handleFormField("roleTo")}
                  className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                >
                  <option value="">New role</option>
                  {ROLE_ASSIGNMENT_OPTIONS.map((roleOption) => (
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
                  value={form.departmentFrom}
                  onChange={handleFormField("departmentFrom")}
                  placeholder="Current department"
                  className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                />
                <input
                  value={form.departmentTo}
                  onChange={handleFormField("departmentTo")}
                  placeholder="New department"
                  className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                />
                <input
                  value={form.approver}
                  onChange={handleFormField("approver")}
                  placeholder="Approver (name/email)"
                  className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                />
                <input
                  value={form.justification}
                  onChange={handleFormField("justification")}
                  placeholder="Promotion / role-change justification"
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
            <div className="md:col-span-3">
              <button
                type="submit"
                disabled={isSubmitting || isLoadingEmployeeOptions || employeeOptions.length === 0 || !form.employeeRecordId}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
              >
                {isSubmitting ? "Saving..." : "Create Workflow"}
              </button>
            </div>
          </form>
        </SurfaceCard>
      ) : null}

      <SurfaceCard
        title="Lifecycle Records"
        subtitle="Approval processes, status transitions, and access revocation tracking"
        action={
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
            <option value="revoked">Access Revoked</option>
          </select>
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
                  <th className="px-2 py-3 font-medium">Category</th>
                  <th className="px-2 py-3 font-medium">Owner</th>
                  <th className="px-2 py-3 font-medium">Status</th>
                  <th className="px-2 py-3 font-medium">Updated</th>
                  <th className="px-2 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => {
                  const roleMovementSummary = getRoleMovementSummary(record);
                  const automationSummary = getAutomationSummary(record);
                  return (
                    <tr key={record.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                      <td className="px-2 py-3">
                        <p className="font-medium text-slate-900">{record.employee || "-"}</p>
                        <p className="text-xs text-slate-500">{record.employeeEmail || "-"}</p>
                        {roleMovementSummary ? <p className="mt-1 text-xs text-slate-500">{roleMovementSummary}</p> : null}
                        {automationSummary ? (
                          <p className="mt-1 text-xs text-emerald-700">Automation: {automationSummary}</p>
                        ) : null}
                      </td>
                      <td className="px-2 py-3">{record.category || "-"}</td>
                      <td className="px-2 py-3">{record.owner || "-"}</td>
                      <td className="px-2 py-3">
                        <StatusBadge value={record.status || "-"} />
                      </td>
                      <td className="px-2 py-3 text-xs text-slate-600">{formatDate(record.updatedAt || record.createdAt)}</td>
                      <td className="px-2 py-3 text-right">
                        {canManage ? (
                          <div className="inline-flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => updateStatus(record, "Approved")}
                              disabled={isSubmitting}
                              className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => updateStatus(record, "In Progress")}
                              disabled={isSubmitting}
                              className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100 disabled:opacity-60"
                            >
                              Set In Progress
                            </button>
                            <button
                              type="button"
                              onClick={() => triggerOffboarding(record)}
                              disabled={isSubmitting}
                              className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                            >
                              Offboard + Revoke
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">View only</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}
