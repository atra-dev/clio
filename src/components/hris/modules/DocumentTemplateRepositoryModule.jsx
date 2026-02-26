"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SurfaceCard from "@/components/hris/SurfaceCard";
import EmptyState from "@/components/hris/shared/EmptyState";
import ModuleTabs from "@/components/hris/shared/ModuleTabs";
import StatusBadge from "@/components/hris/shared/StatusBadge";
import { formatEmployeeName, formatNameFromEmail } from "@/lib/name-utils";
import { hrisApi } from "@/services/hris-api-client";

const SECTION_TABS = [
  { id: "library", label: "Templates Library" },
  { id: "employee-docs", label: "Employee Documents" },
  { id: "contracts", label: "Contracts & Agreements" },
  { id: "versions", label: "Version History" },
  { id: "upload-audit", label: "Upload Audit Logs" },
];
const EMPLOYEE_SECTION_TABS = [{ id: "employee-docs", label: "Documents" }];

const initialTemplateForm = {
  templateName: "",
  category: "HR Template",
  documentType: "Template",
  classification: "Restricted PII",
  version: "v1.0",
  status: "Active",
  tags: "",
  contentRef: "",
  changeNote: "",
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

function normalizeTags(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatActorName(nameValue, fallbackValue) {
  const explicitName = String(nameValue || "").trim();
  if (explicitName) {
    return explicitName;
  }

  const fallback = String(fallbackValue || "").trim();
  if (!fallback.includes("@")) {
    return fallback || "-";
  }

  return formatNameFromEmail(fallback, { fallbackLabel: "-" });
}

function formatActorEmail(emailValue) {
  const email = String(emailValue || "").trim();
  return email.includes("@") ? email.toLowerCase() : "";
}

export default function DocumentTemplateRepositoryModule({ session }) {
  const actorRole = session?.role || "EMPLOYEE_L1";
  const employeeRole = isEmployeeRole(actorRole);
  const canManageTemplates = !employeeRole;

  const [section, setSection] = useState(employeeRole ? "employee-docs" : "library");
  const [templates, setTemplates] = useState([]);
  const [employeeRecords, setEmployeeRecords] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateForm, setTemplateForm] = useState(initialTemplateForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const visibleSectionTabs = useMemo(
    () => (employeeRole ? EMPLOYEE_SECTION_TABS : SECTION_TABS),
    [employeeRole],
  );

  useEffect(() => {
    if (visibleSectionTabs.some((tab) => tab.id === section)) {
      return;
    }
    setSection(visibleSectionTabs[0]?.id || "employee-docs");
  }, [section, visibleSectionTabs]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const [templatePayload, employeePayload] = await Promise.all([
        hrisApi.templates.list(),
        hrisApi.employees.list({ page: 1, pageSize: 200, includeDocuments: true }),
      ]);
      const templateRows = Array.isArray(templatePayload.records) ? templatePayload.records : [];
      setTemplates(templateRows);
      setEmployeeRecords(Array.isArray(employeePayload.records) ? employeePayload.records : []);
      if (!selectedTemplateId && templateRows[0]?.id) {
        setSelectedTemplateId(templateRows[0].id);
      }
    } catch (error) {
      setErrorMessage(error.message || "Unable to load template repository.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedTemplateId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === selectedTemplateId) || null,
    [templates, selectedTemplateId],
  );

  const employeeDocuments = useMemo(() => {
    const rows = [];
    employeeRecords.forEach((record) => {
      (record.documents || []).forEach((document, index) => {
        rows.push({
          id: `${record.id}-${index}`,
          employeeRecordId: record.id,
          documentId: String(document.id || document.recordId || index),
          employee: formatEmployeeName({
            firstName: record.firstName,
            middleName: record.middleName,
            lastName: record.lastName,
            suffix: record.suffix,
            fallback: record.name,
            fallbackEmail: record.email,
            fallbackLabel: "Employee",
          }),
          employeeEmail: record.email,
          name: document.name || "Document",
          type: document.type || "General",
          ref: document.ref || "",
          storagePath: document.storagePath || "",
          uploadedAt: document.uploadedAt || record.updatedAt || record.createdAt,
          uploadedBy: document.uploadedBy || record.updatedBy || "-",
          uploadedByName: document.uploadedByName || record.updatedByName || "",
          uploadedByEmail: document.uploadedByEmail || record.updatedByEmail || document.uploadedBy || record.updatedBy || "",
        });
      });
    });
    return rows;
  }, [employeeRecords]);

  const contractRows = useMemo(
    () =>
      templates.filter((template) => {
        const text = `${template.category || ""} ${template.documentType || ""}`.toLowerCase();
        return text.includes("contract") || text.includes("agreement") || text.includes("nda");
      }),
    [templates],
  );

  const handleTemplateField = (field) => (event) => {
    setTemplateForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const createTemplate = async (event) => {
    event.preventDefault();
    if (!canManageTemplates) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await hrisApi.templates.create({
        templateName: templateForm.templateName,
        category: templateForm.category,
        documentType: templateForm.documentType,
        classification: templateForm.classification,
        version: templateForm.version,
        status: templateForm.status,
        tags: normalizeTags(templateForm.tags),
        contentRef: templateForm.contentRef,
        changeNote: templateForm.changeNote,
      });
      setTemplateForm(initialTemplateForm);
      setSuccessMessage("Template uploaded and versioned.");
      await loadData();
    } catch (error) {
      setErrorMessage(error.message || "Unable to create template.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateTemplate = async (payload, successText) => {
    if (!selectedTemplateId || !canManageTemplates) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await hrisApi.templates.update(selectedTemplateId, payload);
      setSuccessMessage(successText);
      await loadData();
    } catch (error) {
      setErrorMessage(error.message || "Unable to update template.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const archiveTemplate = async (recordId) => {
    if (!recordId || !canManageTemplates) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await hrisApi.templates.archive(recordId);
      setSuccessMessage("Template archived.");
      if (recordId === selectedTemplateId) {
        setSelectedTemplateId("");
      }
      await loadData();
    } catch (error) {
      setErrorMessage(error.message || "Unable to archive template.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEmployeeDocument = async (row) => {
    const targetRecordId = String(row?.employeeRecordId || "").trim();
    if (!targetRecordId) {
      setErrorMessage("Unable to open document. Missing employee record reference.");
      return;
    }

    try {
      const payload = await hrisApi.employees.logDocumentAccess(targetRecordId, {
        documentId: String(row?.documentId || "").trim(),
        documentName: String(row?.name || "").trim(),
        documentType: String(row?.type || "").trim(),
        documentRef: String(row?.ref || "").trim(),
        documentStoragePath: String(row?.storagePath || "").trim(),
      });
      const accessUrl = String(payload?.accessUrl || "").trim();
      if (!accessUrl) {
        throw new Error("Document access URL is unavailable.");
      }
      window.open(accessUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setErrorMessage(error?.message || "Document access is blocked by security policy.");
    }
  };

  return (
    <div className="space-y-4">
      <ModuleTabs tabs={visibleSectionTabs} value={section} onChange={setSection} />

      {errorMessage ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{errorMessage}</p>
      ) : null}
      {successMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{successMessage}</p>
      ) : null}

      {canManageTemplates ? (
        <SurfaceCard title="Upload / Manage Template" subtitle="Version-controlled templates with tagging and restricted classifications">
          <form className="grid gap-2 md:grid-cols-3" onSubmit={createTemplate}>
            <input
              required
              value={templateForm.templateName}
              onChange={handleTemplateField("templateName")}
              placeholder="Template name"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              value={templateForm.category}
              onChange={handleTemplateField("category")}
              placeholder="Category"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              value={templateForm.documentType}
              onChange={handleTemplateField("documentType")}
              placeholder="Type"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              value={templateForm.version}
              onChange={handleTemplateField("version")}
              placeholder="Version"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              value={templateForm.tags}
              onChange={handleTemplateField("tags")}
              placeholder="Tags (comma separated)"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              value={templateForm.contentRef}
              onChange={handleTemplateField("contentRef")}
              placeholder="File URL / reference"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              value={templateForm.changeNote}
              onChange={handleTemplateField("changeNote")}
              placeholder="Change note"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <div className="md:col-span-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
              >
                {isSubmitting ? "Saving..." : "Upload Template"}
              </button>
            </div>
          </form>
        </SurfaceCard>
      ) : null}

      <SurfaceCard
        title={
          section === "employee-docs"
            ? employeeRole
              ? "Documents"
              : "Employee Documents"
            : section === "contracts"
              ? "Contracts & Agreements"
              : section === "versions"
                ? "Version History"
                : section === "upload-audit"
                  ? "Upload Audit Logs"
                  : "Templates Library"
        }
        subtitle={
          employeeRole
            ? "Attached files from your employee record."
            : "Permission-based template and document access"
        }
      >
        {isLoading ? (
          <p className="text-sm text-slate-600">Loading template repository...</p>
        ) : section === "employee-docs" ? (
          employeeDocuments.length === 0 ? (
            <EmptyState
              title={employeeRole ? "No files yet" : "No employee documents yet"}
              subtitle={
                employeeRole
                  ? "Files attached to your profile will appear here."
                  : "Uploaded employee documents will appear here."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                    {!employeeRole ? <th className="px-2 py-3 font-medium">Employee</th> : null}
                    <th className="px-2 py-3 font-medium">Document</th>
                    <th className="px-2 py-3 font-medium">Type</th>
                    <th className="px-2 py-3 font-medium">Uploaded</th>
                    {!employeeRole ? <th className="px-2 py-3 font-medium">Uploaded By</th> : null}
                    <th className="px-2 py-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {employeeDocuments.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                      {!employeeRole ? (
                        <td className="px-2 py-3">
                          <p className="font-medium text-slate-900">{row.employee}</p>
                          <p className="text-xs text-slate-500">{row.employeeEmail}</p>
                        </td>
                      ) : null}
                      <td className="px-2 py-3">{row.name}</td>
                      <td className="px-2 py-3">{row.type}</td>
                      <td className="px-2 py-3">{formatDate(row.uploadedAt)}</td>
                      {!employeeRole ? (
                        <td className="px-2 py-3 text-xs text-slate-600">
                          <p className="font-medium text-slate-800">{formatActorName(row.uploadedByName, row.uploadedBy)}</p>
                          {formatActorEmail(row.uploadedByEmail || row.uploadedBy) ? (
                            <p className="truncate text-[11px] text-slate-500">{formatActorEmail(row.uploadedByEmail || row.uploadedBy)}</p>
                          ) : null}
                        </td>
                      ) : null}
                      <td className="px-2 py-3 text-right">
                        {String(row.ref || row.storagePath || "").trim() ? (
                          <button
                            type="button"
                            onClick={() => openEmployeeDocument(row)}
                            className="inline-flex h-7 items-center rounded-md border border-sky-200 bg-sky-50 px-2.5 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100"
                          >
                            Open
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">No file link</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : section === "contracts" ? (
          contractRows.length === 0 ? (
            <EmptyState title="No contracts or agreements found" subtitle="Contract-type templates will appear in this section." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                    <th className="px-2 py-3 font-medium">Template</th>
                    <th className="px-2 py-3 font-medium">Category</th>
                    <th className="px-2 py-3 font-medium">Version</th>
                    <th className="px-2 py-3 font-medium">Status</th>
                    <th className="px-2 py-3 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {contractRows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                      <td className="px-2 py-3 font-medium text-slate-900">{row.templateName || "-"}</td>
                      <td className="px-2 py-3">{row.category || "-"}</td>
                      <td className="px-2 py-3">{row.version || "-"}</td>
                      <td className="px-2 py-3">
                        <StatusBadge value={row.status || "-"} />
                      </td>
                      <td className="px-2 py-3">{formatDate(row.updatedAt || row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : section === "versions" ? (
          !selectedTemplate ? (
            <EmptyState title="No template selected" subtitle="Select a template from the library to inspect version history." />
          ) : (selectedTemplate.versionHistory || []).length === 0 ? (
            <EmptyState title="No historical versions yet" subtitle="Version changes will be recorded after updates." />
          ) : (
            <div className="space-y-2">
              {(selectedTemplate.versionHistory || []).map((item, index) => (
                <div key={`${item.changedAt}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  <p>
                    <span className="font-semibold text-slate-900">{item.version || "v1.0"}</span> changed by{" "}
                    <span className="font-medium">{formatActorName(item.changedByName, item.changedBy)}</span>
                    {formatActorEmail(item.changedByEmail || item.changedBy) ? (
                      <span className="text-slate-500"> ({formatActorEmail(item.changedByEmail || item.changedBy)})</span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-slate-500">{formatDate(item.changedAt)}</p>
                  <p className="mt-1">{item.note || "-"}</p>
                </div>
              ))}
            </div>
          )
        ) : section === "upload-audit" ? (
          !selectedTemplate ? (
            <EmptyState title="No template selected" subtitle="Select a template from the library to inspect upload logs." />
          ) : (selectedTemplate.modificationLog || []).length === 0 ? (
            <EmptyState title="No upload logs yet" subtitle="Template upload and update logs will appear here." />
          ) : (
            <div className="space-y-2">
              {(selectedTemplate.modificationLog || []).map((item, index) => (
                <div key={`${item.at}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  <p>
                    <span className="font-semibold text-slate-900">{item.action || "update"}</span> by{" "}
                    <span className="font-medium">{formatActorName(item.byName, item.by)}</span>
                    {formatActorEmail(item.byEmail || item.by) ? (
                      <span className="text-slate-500"> ({formatActorEmail(item.byEmail || item.by)})</span>
                    ) : null}{" "}
                    | version {item.version || "-"}
                  </p>
                  <p className="mt-1 text-slate-500">{formatDate(item.at)}</p>
                </div>
              ))}
            </div>
          )
        ) : templates.length === 0 ? (
          <EmptyState title="No templates yet" subtitle="Upload template files and metadata to populate the repository." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                  <th className="px-2 py-3 font-medium">Template</th>
                  <th className="px-2 py-3 font-medium">Category</th>
                  <th className="px-2 py-3 font-medium">Version</th>
                  <th className="px-2 py-3 font-medium">Classification</th>
                  <th className="px-2 py-3 font-medium">Tags</th>
                  <th className="px-2 py-3 font-medium">Status</th>
                  <th className="px-2 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-b border-slate-100 text-slate-700 last:border-b-0 ${
                      row.id === selectedTemplateId ? "bg-sky-50/50" : ""
                    }`}
                  >
                    <td className="px-2 py-3 font-medium text-slate-900">{row.templateName || "-"}</td>
                    <td className="px-2 py-3">{row.category || "-"}</td>
                    <td className="px-2 py-3">{row.version || "-"}</td>
                    <td className="px-2 py-3">{row.classification || "-"}</td>
                    <td className="px-2 py-3 text-xs text-slate-600">{(row.tags || []).join(", ") || "-"}</td>
                    <td className="px-2 py-3">
                      <StatusBadge value={row.status || "-"} />
                    </td>
                    <td className="px-2 py-3 text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedTemplateId(row.id)}
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          Select
                        </button>
                        {canManageTemplates ? (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                updateTemplate(
                                  {
                                    version: row.version === "v1.0" ? "v1.1" : row.version,
                                    changeNote: "Template metadata update",
                                  },
                                  "Template version updated.",
                                )
                              }
                              disabled={isSubmitting}
                              className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100 disabled:opacity-60"
                            >
                              New Version
                            </button>
                            <button
                              type="button"
                              onClick={() => archiveTemplate(row.id)}
                              disabled={isSubmitting}
                              className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                            >
                              Archive
                            </button>
                          </>
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
    </div>
  );
}
