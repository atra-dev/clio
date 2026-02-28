import Link from "next/link";
import SurfaceCard from "@/components/hris/SurfaceCard";
import { getModulesForRole, getRoleDetails } from "@/lib/hris";
import { hasPermission } from "@/lib/rbac";
import { listAuditEvents } from "@/lib/audit-log";
import { listInAppNotifications } from "@/lib/security-notifications";
import {
  listAttendanceLogsBackend,
  listDocumentTemplatesBackend,
  listEmployeeRecordsBackend,
  listExportRequestsBackend,
  listIncidentRecordsBackend,
  listLifecycleRecordsBackend,
  listPerformanceRecordsBackend,
  listRetentionArchiveSnapshotBackend,
} from "@/lib/hris-backend";
import { listUserAccounts } from "@/lib/user-accounts";
import { requireModuleAccess } from "@/lib/server-authorization";

export const metadata = {
  title: "Dashboard | Clio HRIS",
};

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function toSafeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toTimeMs(value) {
  const date = new Date(value || "");
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function startOfDayMs(value) {
  const timestamp = toTimeMs(value);
  if (!timestamp) {
    return 0;
  }
  const day = new Date(timestamp);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function formatDateTime(value) {
  const ms = toTimeMs(value);
  if (!ms) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

function formatDayLabel(value) {
  const ms = toTimeMs(value);
  if (!ms) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(ms));
}

function formatPercent(value) {
  const safe = Math.max(0, Math.min(100, Math.round(toSafeNumber(value))));
  return `${safe}%`;
}

function resolveStatusTone(status) {
  const normalized = normalizeText(status);
  if (normalized.includes("failed") || normalized.includes("rejected") || normalized.includes("critical")) {
    return "rose";
  }
  if (normalized.includes("pending") || normalized.includes("review")) {
    return "amber";
  }
  if (normalized.includes("resolved") || normalized.includes("approved") || normalized.includes("completed") || normalized.includes("active")) {
    return "emerald";
  }
  return "slate";
}

function statusBadgeClass(tone) {
  if (tone === "rose") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (tone === "amber") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (tone === "emerald") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function barColorClass(tone) {
  if (tone === "rose") {
    return "bg-rose-500";
  }
  if (tone === "amber") {
    return "bg-amber-500";
  }
  if (tone === "emerald") {
    return "bg-emerald-500";
  }
  if (tone === "sky") {
    return "bg-sky-500";
  }
  return "bg-slate-500";
}

function buildBarItems(items = []) {
  const normalized = items
    .map((item, index) => ({
      id: String(item?.id || `row-${index}`),
      label: String(item?.label || "-"),
      value: Math.max(0, toSafeNumber(item?.value)),
      tone: item?.tone || "sky",
    }))
    .filter((item) => item.label !== "-");

  const max = Math.max(1, ...normalized.map((item) => item.value));
  return normalized.map((item) => ({
    ...item,
    widthPercent: Math.max(item.value > 0 ? 10 : 0, Math.round((item.value / max) * 100)),
  }));
}

function countRowsByLabel(rows, valueAccessor, fallbackLabel = "Uncategorized") {
  return toSafeArray(rows).reduce((acc, row) => {
    const label = String(valueAccessor(row) || "").trim() || fallbackLabel;
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
}

function mapCountsToItems(counts, { prefix, limit = 8, toneResolver } = {}) {
  return Object.entries(counts || {})
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([label, value], index) => ({
      id: `${prefix || "item"}-${normalizeKey(label)}-${index}`,
      label,
      value,
      tone: toneResolver ? toneResolver(label, value, index) : resolveStatusTone(label),
    }));
}

function buildDailySeries(rows, dateAccessor, days = 7) {
  const safeDays = Math.max(3, Math.min(30, Number.parseInt(String(days), 10) || 7));
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const keys = [];
  const bucket = new Map();
  for (let index = safeDays - 1; index >= 0; index -= 1) {
    const ms = now.getTime() - index * 24 * 60 * 60 * 1000;
    keys.push(ms);
    bucket.set(ms, 0);
  }

  toSafeArray(rows).forEach((row) => {
    const dayMs = startOfDayMs(dateAccessor(row));
    if (bucket.has(dayMs)) {
      bucket.set(dayMs, (bucket.get(dayMs) || 0) + 1);
    }
  });

  return keys.map((ms) => ({
    id: `day-${ms}`,
    label: formatDayLabel(ms),
    value: bucket.get(ms) || 0,
  }));
}

function AnalyticsBars({ title, subtitle, items }) {
  const rows = buildBarItems(items);
  return (
    <SurfaceCard title={title} subtitle={subtitle}>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">No analytics available yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <p className="font-medium text-slate-800">{row.label}</p>
                <p className="font-semibold text-slate-900">{row.value}</p>
              </div>
              <div className="h-2 rounded-full bg-slate-100">
                <div className={`h-2 rounded-full ${barColorClass(row.tone)}`} style={{ width: `${row.widthPercent}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}

function TrendBars({ title, subtitle, points, tone = "sky" }) {
  const rows = toSafeArray(points).map((item, index) => ({
    id: String(item?.id || `trend-${index}`),
    label: String(item?.label || "").trim() || "-",
    value: Math.max(0, toSafeNumber(item?.value)),
  }));
  const max = Math.max(1, ...rows.map((item) => item.value));

  return (
    <SurfaceCard title={title} subtitle={subtitle}>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">No trend data yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="flex min-w-[560px] items-end gap-3 pb-1">
            {rows.map((row) => {
              const height = row.value === 0 ? 8 : Math.max(12, Math.round((row.value / max) * 120));
              return (
                <div key={row.id} className="flex min-w-[36px] flex-1 flex-col items-center gap-2">
                  <p className="text-[11px] font-semibold text-slate-700">{row.value}</p>
                  <div className="flex h-32 w-full items-end rounded-md bg-slate-100 px-1">
                    <div className={`w-full rounded-sm ${barColorClass(tone)}`} style={{ height: `${height}px` }} />
                  </div>
                  <p className="text-[10px] text-slate-500">{row.label}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </SurfaceCard>
  );
}

function KpiCard({ label, value, note, tone = "slate" }) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "rose"
        ? "border-rose-200 bg-rose-50"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50"
          : "border-slate-200 bg-white";

  return (
    <article className={`rounded-xl border px-4 py-3 ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      <p className="mt-2 text-xs text-slate-600">{note}</p>
    </article>
  );
}

function isEmployeeRole(role) {
  return String(role || "").trim().toUpperCase().startsWith("EMPLOYEE_");
}

function isLifecycleOpen(status) {
  const normalized = normalizeText(status);
  if (!normalized) {
    return true;
  }
  return !(
    normalized.includes("approved") ||
    normalized.includes("completed") ||
    normalized.includes("rejected") ||
    normalized.includes("revoked") ||
    normalized.includes("closed")
  );
}

function isIncidentOpen(status) {
  const normalized = normalizeText(status);
  return !(normalized.includes("resolved") || normalized.includes("closed"));
}

function isHighSeverity(value) {
  const normalized = normalizeText(value);
  return normalized.includes("high") || normalized.includes("critical");
}

function isPendingExportStatus(status) {
  const normalized = normalizeText(status);
  return normalized.includes("pending") || normalized.includes("review") || normalized.includes("in progress");
}

export default async function DashboardPage() {
  const session = await requireModuleAccess("dashboard");
  const role = session.role;
  const email = String(session.email || "").trim().toLowerCase();
  const employeeRole = isEmployeeRole(role);
  const roleDetails = getRoleDetails(role);
  const allowedModules = getModulesForRole(role);
  const generatedAt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

  const [notificationsPayload, auditEvents] = await Promise.all([
    listInAppNotifications({ recipientEmail: email, status: "all", limit: 80 }).catch(() => ({
      records: [],
      unreadCount: 0,
      totalScoped: 0,
    })),
    listAuditEvents({ limit: 500 }).catch(() => []),
  ]);

  const notificationRows = toSafeArray(notificationsPayload?.records);
  const unreadAlerts = toSafeNumber(notificationsPayload?.unreadCount);
  const totalNotifications = toSafeNumber(notificationsPayload?.totalScoped);
  const notificationSeverityCounts = countRowsByLabel(
    notificationRows,
    (row) => {
      const raw = normalizeText(row?.severity);
      if (raw === "critical" || raw === "high" || raw === "medium" || raw === "low") {
        return raw[0].toUpperCase() + raw.slice(1);
      }
      return "Medium";
    },
    "Medium",
  );

  if (employeeRole) {
    const [employeeRows, attendanceRows, performanceRows] = await Promise.all([
      listEmployeeRecordsBackend({ ownerEmail: email, includeDocuments: true }).catch(() => []),
      listAttendanceLogsBackend({ ownerEmail: email }).catch(() => []),
      listPerformanceRecordsBackend({ ownerEmail: email }).catch(() => []),
    ]);

    const ownRecord = toSafeArray(employeeRows)[0] || null;
    const ownDocuments = ownRecord ? toSafeArray(ownRecord.documents) : [];

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const attendanceThisMonth = toSafeArray(attendanceRows).filter((row) => toTimeMs(row?.date || row?.createdAt) >= monthStart);
    const attendanceStatusItems = mapCountsToItems(
      countRowsByLabel(attendanceThisMonth, (row) => row?.status, "Recorded"),
      {
        prefix: "attendance",
        limit: 6,
        toneResolver: (label) => resolveStatusTone(label),
      },
    );
    const personalActivityTrend = buildDailySeries(
      toSafeArray(attendanceRows),
      (row) => row?.date || row?.createdAt || row?.updatedAt,
      7,
    );
    const employeeCards = [
      {
        id: "attendance-month",
        label: "Attendance Entries",
        value: String(attendanceThisMonth.length),
        note: "Month-to-date logs",
        tone: "slate",
      },
      {
        id: "my-documents",
        label: "Documents on File",
        value: String(ownDocuments.length || toSafeNumber(ownRecord?.documentsCount)),
        note: "Accessible personal documents",
        tone: "slate",
      },
      {
        id: "alerts",
        label: "Unread Alerts",
        value: String(unreadAlerts),
        note: `${totalNotifications} total notifications`,
        tone: unreadAlerts > 0 ? "amber" : "emerald",
      },
      {
        id: "performance-records",
        label: "Performance Records",
        value: String(toSafeArray(performanceRows).length),
        note: "Visible KPI history entries",
        tone: "slate",
      },
    ];

    return (
      <div className="space-y-6">
        <header className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-700">Clio Workspace</p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard Overview</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="rounded-full border border-slate-200 bg-white px-2 py-1">{roleDetails.label}</span>
            <span>Generated {generatedAt}</span>
          </div>
        </header>

        <SurfaceCard title="Personal Analytics" subtitle="Current activity and profile readiness">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {employeeCards.map((card) => (
              <KpiCard key={card.id} label={card.label} value={card.value} note={card.note} tone={card.tone} />
            ))}
          </div>
        </SurfaceCard>

        <TrendBars title="7-Day Activity Trend" subtitle="Attendance activity trend" points={personalActivityTrend} tone="sky" />

        <section className="grid gap-4 xl:grid-cols-2">
          <AnalyticsBars
            title="Attendance Mix"
            subtitle="Month-to-date status profile"
            items={attendanceStatusItems}
          />
          <AnalyticsBars
            title="Security Alerts"
            subtitle="Notification severity profile"
            items={mapCountsToItems(notificationSeverityCounts, {
              prefix: "severity",
              limit: 4,
              toneResolver: (label) => resolveStatusTone(label),
            })}
          />
        </section>
      </div>
    );
  }

  const canViewUsers = hasPermission(role, "user_management:view");
  const canViewIncidents = hasPermission(role, "incident_management:view");
  const canViewRetention = hasPermission(role, "retention_archive:view");

  const [
    employeeRows,
    lifecycleRows,
    attendanceRows,
    performanceRows,
    templateRows,
    exportRows,
    incidentRows,
    retentionSnapshot,
    userAccounts,
  ] = await Promise.all([
    listEmployeeRecordsBackend().catch(() => []),
    listLifecycleRecordsBackend().catch(() => []),
    listAttendanceLogsBackend().catch(() => []),
    listPerformanceRecordsBackend().catch(() => []),
    listDocumentTemplatesBackend().catch(() => []),
    listExportRequestsBackend().catch(() => []),
    canViewIncidents ? listIncidentRecordsBackend().catch(() => []) : Promise.resolve([]),
    canViewRetention ? listRetentionArchiveSnapshotBackend({ dueWithinDays: 30 }).catch(() => null) : Promise.resolve(null),
    canViewUsers ? listUserAccounts().catch(() => []) : Promise.resolve([]),
  ]);

  const totalEmployees = toSafeArray(employeeRows).length;
  const activeEmployees = toSafeArray(employeeRows).filter((row) => normalizeText(row?.status).includes("active")).length;
  const openLifecycle = toSafeArray(lifecycleRows).filter((row) => isLifecycleOpen(row?.status)).length;
  const pendingExports = toSafeArray(exportRows).filter((row) => isPendingExportStatus(row?.status)).length;
  const openIncidents = toSafeArray(incidentRows).filter((row) => isIncidentOpen(row?.status)).length;
  const highIncidents = toSafeArray(incidentRows).filter((row) => isIncidentOpen(row?.status) && isHighSeverity(row?.severity)).length;
  const nowMs = toTimeMs(new Date().toISOString());
  const oneDayAgoMs = nowMs - 24 * 60 * 60 * 1000;
  const auditLast24h = toSafeArray(auditEvents).filter((entry) => toTimeMs(entry?.occurredAt) >= oneDayAgoMs).length;
  const retentionSummary = retentionSnapshot?.summary || null;
  const dueRetentionNow = toSafeNumber(retentionSummary?.dueNow);
  const dueRetentionWindow = toSafeNumber(retentionSummary?.dueWithinWindow);

  const allAccounts = toSafeArray(userAccounts);
  const activeAccounts = allAccounts.filter((row) => normalizeText(row?.status) === "active").length;
  const disabledAccounts = allAccounts.filter((row) => normalizeText(row?.status) === "disabled").length;
  const phoneVerifiedAccounts = allAccounts.filter((row) => Boolean(row?.phoneVerifiedAt)).length;
  const mfaEnabledAccounts = allAccounts.filter((row) => Boolean(row?.smsMfaEnabled)).length;

  const operationalScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(100 - highIncidents * 10 - dueRetentionNow * 6 - pendingExports * 4 - unreadAlerts * 2 - Math.max(0, openLifecycle - 5) * 2),
    ),
  );

  const privilegedCards = [
    {
      id: "ops-score",
      label: "Operational Health",
      value: formatPercent(operationalScore),
      note: "Risk-adjusted control posture",
      tone: operationalScore >= 80 ? "emerald" : operationalScore >= 60 ? "amber" : "rose",
    },
    {
      id: "employees",
      label: "Active Workforce",
      value: `${activeEmployees}/${totalEmployees}`,
      note: "Employee records with active status",
      tone: "slate",
    },
    {
      id: "lifecycle-open",
      label: "Open Workflows",
      value: String(openLifecycle),
      note: "Lifecycle records requiring action",
      tone: openLifecycle > 0 ? "amber" : "emerald",
    },
    {
      id: "incident-open",
      label: "High-Risk Incidents",
      value: String(highIncidents),
      note: `${openIncidents} total open incidents`,
      tone: highIncidents > 0 ? "rose" : "emerald",
    },
    {
      id: "pending-exports",
      label: "Pending Exports",
      value: String(pendingExports),
      note: "Reports awaiting completion",
      tone: pendingExports > 0 ? "amber" : "emerald",
    },
    {
      id: "audit-24h",
      label: "Audit Events (24h)",
      value: String(auditLast24h),
      note: `Snapshot ${generatedAt}`,
      tone: "slate",
    },
    {
      id: "alerts-unread",
      label: "Unread Alerts",
      value: String(unreadAlerts),
      note: `${totalNotifications} scoped notifications`,
      tone: unreadAlerts > 0 ? "amber" : "emerald",
    },
    {
      id: "retention-due",
      label: "Retention Due (30d)",
      value: String(dueRetentionWindow),
      note: `${dueRetentionNow} due now`,
      tone: dueRetentionNow > 0 ? "rose" : "slate",
    },
  ];

  const operationsMix = [
    { id: "mix-employees", label: "Employee Records", value: totalEmployees, tone: "sky" },
    { id: "mix-lifecycle", label: "Lifecycle", value: toSafeArray(lifecycleRows).length, tone: "emerald" },
    { id: "mix-attendance", label: "Attendance", value: toSafeArray(attendanceRows).length, tone: "amber" },
    { id: "mix-performance", label: "Performance", value: toSafeArray(performanceRows).length, tone: "slate" },
    { id: "mix-documents", label: "Templates", value: toSafeArray(templateRows).length, tone: "sky" },
    { id: "mix-exports", label: "Exports", value: toSafeArray(exportRows).length, tone: "rose" },
  ];

  const lifecycleStatusItems = mapCountsToItems(countRowsByLabel(lifecycleRows, (row) => row?.status, "Open"), {
    prefix: "lifecycle",
    limit: 6,
    toneResolver: (label) => resolveStatusTone(label),
  });
  const incidentSeverityItems = mapCountsToItems(countRowsByLabel(incidentRows, (row) => row?.severity, "Low"), {
    prefix: "severity",
    limit: 4,
    toneResolver: (label) => (isHighSeverity(label) ? "rose" : "sky"),
  });
  const departmentItems = mapCountsToItems(countRowsByLabel(employeeRows, (row) => row?.department, "Unassigned"), {
    prefix: "department",
    limit: 6,
    toneResolver: (_, __, index) => (index % 2 === 0 ? "sky" : "emerald"),
  });
  const activityTrend = buildDailySeries(auditEvents, (row) => row?.occurredAt, 14);

  const latestAudit = toSafeArray(auditEvents).slice(0, 10);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-700">Clio Governance Workspace</p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard Overview</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="rounded-full border border-slate-200 bg-white px-2 py-1">{roleDetails.label}</span>
          <span>Generated {generatedAt}</span>
        </div>
      </header>

      <SurfaceCard title="Executive Snapshot" subtitle="Core operating and security indicators">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {privilegedCards.map((card) => (
            <KpiCard key={card.id} label={card.label} value={card.value} note={card.note} tone={card.tone} />
          ))}
        </div>
      </SurfaceCard>

      <section className="grid gap-4 xl:grid-cols-3">
        <TrendBars title="14-Day Audit Trend" subtitle="Recorded system activities" points={activityTrend} tone="sky" />
        <AnalyticsBars title="Lifecycle Pipeline" subtitle="Workflow status distribution" items={lifecycleStatusItems} />
        <AnalyticsBars title="Workforce by Department" subtitle="Top departmental distribution" items={departmentItems} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <AnalyticsBars title="Incident Severity" subtitle="Open case severity profile" items={incidentSeverityItems} />
        <AnalyticsBars title="Cross-Module Volume" subtitle="Current dataset size by module" items={operationsMix} />
      </section>

      {canViewUsers || canViewRetention ? (
        <SurfaceCard title="Control Posture" subtitle="Identity and retention controls">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {canViewUsers ? (
              <>
                <KpiCard label="Active Accounts" value={String(activeAccounts)} note="Enabled user accounts" tone="emerald" />
                <KpiCard label="Disabled Accounts" value={String(disabledAccounts)} note="Revoked/disabled access" tone={disabledAccounts > 0 ? "amber" : "slate"} />
                <KpiCard
                  label="Phone Verified"
                  value={allAccounts.length ? formatPercent((phoneVerifiedAccounts / allAccounts.length) * 100) : "0%"}
                  note={`${phoneVerifiedAccounts}/${allAccounts.length} accounts`}
                  tone="slate"
                />
                <KpiCard
                  label="MFA Enabled"
                  value={allAccounts.length ? formatPercent((mfaEnabledAccounts / allAccounts.length) * 100) : "0%"}
                  note={`${mfaEnabledAccounts}/${allAccounts.length} accounts`}
                  tone={mfaEnabledAccounts === allAccounts.length && allAccounts.length > 0 ? "emerald" : "amber"}
                />
              </>
            ) : null}

            {canViewRetention ? (
              <>
                <KpiCard
                  label="Archived Records"
                  value={String(toSafeNumber(retentionSummary?.totalArchived))}
                  note="Retention archive population"
                  tone="slate"
                />
                <KpiCard
                  label="Due Now"
                  value={String(dueRetentionNow)}
                  note="Immediate retention actions"
                  tone={dueRetentionNow > 0 ? "rose" : "emerald"}
                />
                <KpiCard
                  label="Due in Window"
                  value={String(dueRetentionWindow)}
                  note="Within configured review period"
                  tone={dueRetentionWindow > 0 ? "amber" : "emerald"}
                />
                <KpiCard
                  label="Missing Retention"
                  value={String(toSafeNumber(retentionSummary?.missingRetentionDate))}
                  note="Records without delete schedule"
                  tone={toSafeNumber(retentionSummary?.missingRetentionDate) > 0 ? "rose" : "emerald"}
                />
              </>
            ) : null}
          </div>
        </SurfaceCard>
      ) : null}

      <SurfaceCard title="Recent Audit Stream" subtitle="Latest recorded actions across authorized modules">
        {latestAudit.length === 0 ? (
          <p className="text-sm text-slate-600">No recent audit activity found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                  <th className="px-2 py-3 font-medium">Activity</th>
                  <th className="px-2 py-3 font-medium">Module</th>
                  <th className="px-2 py-3 font-medium">Actor</th>
                  <th className="px-2 py-3 font-medium">Status</th>
                  <th className="px-2 py-3 font-medium">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {latestAudit.map((entry) => {
                  const tone = resolveStatusTone(entry?.status);
                  return (
                    <tr key={entry.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                      <td className="px-2 py-3 font-medium text-slate-900">{entry.activityName || "-"}</td>
                      <td className="px-2 py-3">{entry.module || "-"}</td>
                      <td className="px-2 py-3 text-xs">{entry.performedBy || "-"}</td>
                      <td className="px-2 py-3">
                        <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${statusBadgeClass(tone)}`}>
                          {entry.status || "Completed"}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-xs text-slate-600">{formatDateTime(entry.occurredAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      <SurfaceCard title="Quick Access" subtitle="Authorized modules for this role">
        {allowedModules.length === 0 ? (
          <p className="text-sm text-slate-600">No modules available for this role.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {allowedModules.map((module) => (
              <article key={module.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{module.id}</p>
                <h2 className="mt-1 text-base font-semibold text-slate-900">{module.label}</h2>
                <Link
                  href={module.href}
                  className="mt-3 inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Open
                </Link>
              </article>
            ))}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}
