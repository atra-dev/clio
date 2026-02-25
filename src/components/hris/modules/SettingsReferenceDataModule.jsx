"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SurfaceCard from "@/components/hris/SurfaceCard";
import ModuleTabs from "@/components/hris/shared/ModuleTabs";
import EmptyState from "@/components/hris/shared/EmptyState";
import { useToast } from "@/components/ui/ToastProvider";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { hrisApi } from "@/services/hris-api-client";

const SECTION_TABS = [
  { id: "roles", label: "Role Catalog" },
  { id: "departments", label: "Department Catalog" },
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeLabel(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function valueOrDash(value) {
  const normalized = String(value || "").trim();
  return normalized || "-";
}

export default function SettingsReferenceDataModule() {
  const toast = useToast();
  const confirmAction = useConfirm();
  const [section, setSection] = useState("roles");
  const [catalogs, setCatalogs] = useState({
    roles: [],
    departments: [],
  });
  const [draftBySection, setDraftBySection] = useState({
    roles: "",
    departments: "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadCatalogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const payload = await hrisApi.settings.referenceData.list();
      setCatalogs({
        roles: asArray(payload?.catalogs?.roles),
        departments: asArray(payload?.catalogs?.departments),
      });
    } catch (error) {
      toast.error(error.message || "Unable to load reference catalog.");
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadCatalogs();
  }, [loadCatalogs]);

  const activeRows = useMemo(() => {
    if (section === "departments") {
      return asArray(catalogs.departments);
    }
    return asArray(catalogs.roles);
  }, [catalogs.departments, catalogs.roles, section]);

  const activeKind = section === "departments" ? "department" : "role";

  const handleDraftChange = (event) => {
    const nextValue = event.target.value;
    setDraftBySection((current) => ({
      ...current,
      [section]: nextValue,
    }));
  };

  const handleAdd = async (event) => {
    event.preventDefault();
    const label = normalizeLabel(draftBySection[section]);
    if (!label) {
      toast.error(`Enter a ${activeKind} value first.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = await hrisApi.settings.referenceData.create({
        kind: activeKind,
        label,
      });
      setCatalogs({
        roles: asArray(payload?.catalogs?.roles),
        departments: asArray(payload?.catalogs?.departments),
      });
      setDraftBySection((current) => ({
        ...current,
        [section]: "",
      }));
      toast.success(`${section === "roles" ? "Role" : "Department"} added to catalog.`);
    } catch (error) {
      toast.error(error.message || "Unable to add reference value.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemove = async (entry) => {
    if (!entry || entry.isSystem) {
      return;
    }

    const valueLabel = valueOrDash(entry.label || entry.value);
    const confirmed = await confirmAction({
      title: `Remove ${section === "roles" ? "Role" : "Department"}`,
      message: `Remove "${valueLabel}" from ${section === "roles" ? "role" : "department"} catalog?`,
      confirmText: "Remove",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = await hrisApi.settings.referenceData.remove({
        kind: activeKind,
        recordId: String(entry.id || "").trim(),
      });
      setCatalogs({
        roles: asArray(payload?.catalogs?.roles),
        departments: asArray(payload?.catalogs?.departments),
      });
      toast.success("Reference value removed.");
    } catch (error) {
      toast.error(error.message || "Unable to remove reference value.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SurfaceCard
      title="Reference Data Catalog"
      subtitle="Centralized role and department options used across employee and lifecycle modules"
    >
      <div className="space-y-3">
        <ModuleTabs tabs={SECTION_TABS} value={section} onChange={setSection} />

        <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={handleAdd}>
          <input
            value={draftBySection[section]}
            onChange={handleDraftChange}
            placeholder={section === "roles" ? "Add role option" : "Add department option"}
            className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
          >
            Add {section === "roles" ? "Role" : "Department"}
          </button>
        </form>

        {isLoading ? (
          <div className="flex min-h-[120px] items-center justify-center">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
          </div>
        ) : activeRows.length === 0 ? (
          <EmptyState
            title={`No ${section} configured`}
            subtitle={`Add ${section === "roles" ? "roles" : "departments"} to populate select options in modules.`}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500">
                  <th className="px-3 py-2 font-medium">Value</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((entry) => (
                  <tr key={`${section}-${entry.id}-${entry.key || entry.value}`} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-3 py-2 text-slate-900">{valueOrDash(entry.label || entry.value)}</td>
                    <td className="px-3 py-2 text-slate-600">{section === "roles" ? "Role" : "Department"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          entry.isSystem
                            ? "border border-slate-200 bg-slate-100 text-slate-700"
                            : "border border-sky-200 bg-sky-50 text-sky-700"
                        }`}
                      >
                        {entry.isSystem ? "System default" : "Custom"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {entry.isSystem ? (
                        <span className="text-xs text-slate-400">Locked</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleRemove(entry)}
                          disabled={isSubmitting}
                          className="inline-flex h-7 items-center rounded-md border border-rose-200 bg-rose-50 px-2.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-70"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SurfaceCard>
  );
}

