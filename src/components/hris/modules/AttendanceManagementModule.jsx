"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import SurfaceCard from "@/components/hris/SurfaceCard";
import EmptyState from "@/components/hris/shared/EmptyState";
import StatusBadge from "@/components/hris/shared/StatusBadge";
import { formatNameFromEmail, formatPersonName } from "@/lib/name-utils";
import { toSubTabAnchor } from "@/lib/subtab-anchor";
import { hrisApi } from "@/services/hris-api-client";

const MANAGEMENT_SECTION_TABS = [
  { id: "monitoring-dashboard", label: "Attendance Monitoring Dashboard" },
  { id: "records", label: "Records" },
  { id: "audit-logs", label: "Attendance Audit Logs" },
];

const SHIFT_WINDOWS = [
  {
    id: "morning",
    sourceShift: "6:00 AM - 2:00 PM",
    assignedShift: "8:00 AM - 4:00 PM",
    onTimeLabel: "7:30 AM - 8:00 AM",
    earlyLabel: "Before 7:30 AM",
    lateLabel: "After 8:00 AM",
    startMinute: 6 * 60,
    endMinute: 14 * 60,
    onTimeStartMinute: 7 * 60 + 30,
    onTimeEndMinute: 8 * 60,
  },
  {
    id: "afternoon",
    sourceShift: "2:00 PM - 10:00 PM",
    assignedShift: "4:00 PM - 12:00 AM",
    onTimeLabel: "3:30 PM - 4:00 PM",
    earlyLabel: "Before 3:30 PM",
    lateLabel: "After 4:00 PM",
    startMinute: 14 * 60,
    endMinute: 22 * 60,
    onTimeStartMinute: 15 * 60 + 30,
    onTimeEndMinute: 16 * 60,
  },
  {
    id: "graveyard",
    sourceShift: "10:00 PM - 6:00 AM",
    assignedShift: "12:00 AM - 8:00 AM",
    onTimeLabel: "11:30 PM - 12:00 AM",
    earlyLabel: "Before 11:30 PM",
    lateLabel: "After 12:00 AM",
    startMinute: 22 * 60,
    endMinute: 6 * 60,
    onTimeStartMinute: 23 * 60 + 30,
    onTimeEndMinute: 0,
    wrapsMidnight: true,
  },
];

function isEmployeeRole(role) {
  return String(role || "")
    .trim()
    .toUpperCase()
    .startsWith("EMPLOYEE_");
}

function hasValue(value) {
  const normalized = String(value || "").trim();
  return normalized.length > 0 && normalized !== "-";
}

function toDateKey(date) {
  const source = date instanceof Date ? date : new Date(date || "");
  if (Number.isNaN(source.getTime())) {
    return "";
  }
  const year = source.getFullYear();
  const month = `${source.getMonth() + 1}`.padStart(2, "0");
  const day = `${source.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDateKey(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const exactMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (exactMatch?.[1]) {
    return exactMatch[1];
  }
  return toDateKey(raw);
}

function parseTimeToMinutes(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "-") {
    return null;
  }

  const meridiemMatch = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (meridiemMatch) {
    const hours = Number.parseInt(meridiemMatch[1], 10);
    const minutes = Number.parseInt(meridiemMatch[2], 10);
    const meridiem = meridiemMatch[3].toUpperCase();
    if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes < 0 || minutes > 59 || hours < 1 || hours > 12) {
      return null;
    }
    const normalizedHours = (hours % 12) + (meridiem === "PM" ? 12 : 0);
    return normalizedHours * 60 + minutes;
  }

  const twentyFourMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!twentyFourMatch) {
    return null;
  }
  const hours = Number.parseInt(twentyFourMatch[1], 10);
  const minutes = Number.parseInt(twentyFourMatch[2], 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function formatTimeDisplay(value) {
  const date = value instanceof Date ? value : new Date(value || "");
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatLongDate(value) {
  const date = value instanceof Date ? value : new Date(value || "");
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
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
  }).format(date);
}

function isWithinShiftWindow(minutes, shift) {
  if (shift.wrapsMidnight) {
    return minutes >= shift.startMinute || minutes < shift.endMinute;
  }
  return minutes >= shift.startMinute && minutes < shift.endMinute;
}

function resolveShiftForMinutes(minutes) {
  if (!Number.isFinite(minutes)) {
    return SHIFT_WINDOWS[0];
  }
  const matched = SHIFT_WINDOWS.find((shift) => isWithinShiftWindow(minutes, shift));
  return matched || SHIFT_WINDOWS[0];
}

function getShiftArrivalStatus(minutes, shift) {
  if (!Number.isFinite(minutes)) {
    return "Recorded";
  }

  if (shift.wrapsMidnight) {
    if (minutes >= shift.startMinute && minutes < shift.onTimeStartMinute) {
      return "Early";
    }
    if ((minutes >= shift.onTimeStartMinute && minutes < 24 * 60) || minutes === shift.onTimeEndMinute) {
      return "On Time";
    }
    return "Late";
  }

  if (minutes < shift.onTimeStartMinute) {
    return "Early";
  }
  if (minutes <= shift.onTimeEndMinute) {
    return "On Time";
  }
  return "Late";
}

function getInitialsFromName(value) {
  const initials = String(value || "")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((token) => token.charAt(0).toUpperCase())
    .join("");
  return initials || "EM";
}

function getSortableAttendanceTime(row) {
  const dateKey = normalizeDateKey(row.date || row.createdAt);
  if (!dateKey) {
    return new Date(row.updatedAt || row.createdAt || 0).getTime();
  }
  const timeMinutes = parseTimeToMinutes(row.checkIn);
  const [year, month, day] = dateKey.split("-").map((item) => Number.parseInt(item, 10));
  const hour = Number.isFinite(timeMinutes) ? Math.floor(timeMinutes / 60) : 0;
  const minute = Number.isFinite(timeMinutes) ? timeMinutes % 60 : 0;
  return new Date(year, (month || 1) - 1, day || 1, hour, minute).getTime();
}

function formatAttendanceDateForRow(row) {
  const dateValue = row.date || row.createdAt;
  return formatDate(dateValue);
}

function getShiftLabelForRecord(row) {
  const minutes = parseTimeToMinutes(row.checkIn);
  if (!Number.isFinite(minutes)) {
    return "-";
  }
  const shift = resolveShiftForMinutes(minutes);
  return shift.assignedShift;
}

function getSummaryForRecord(row) {
  const reason = String(row.reason || "").trim();
  if (reason) {
    return reason;
  }
  if (hasValue(row.checkOut)) {
    return "Attendance completed and logged.";
  }
  if (hasValue(row.checkIn)) {
    return "Clock-in recorded.";
  }
  return "No summary available.";
}

function appendClockOutSummary(existingSummary, clockOutTime) {
  const base = String(existingSummary || "").trim();
  const suffix = `Clock-out: ${clockOutTime}`;
  if (!base) {
    return suffix;
  }
  if (base.toLowerCase().includes("clock-out")) {
    return base;
  }
  return `${base} | ${suffix}`;
}

function computeWorkedMinutes(checkInValue, checkOutValue) {
  const checkIn = parseTimeToMinutes(checkInValue);
  const checkOut = parseTimeToMinutes(checkOutValue);
  if (!Number.isFinite(checkIn) || !Number.isFinite(checkOut)) {
    return null;
  }
  let diff = checkOut - checkIn;
  if (diff < 0) {
    diff += 24 * 60;
  }
  return diff >= 0 ? diff : null;
}

function formatWorkedHours(minutes) {
  if (!Number.isFinite(minutes)) {
    return "-";
  }
  const hours = minutes / 60;
  return `${hours.toFixed(2)} h`;
}

function getDepartmentLabel(row) {
  const direct = String(row?.department || "").trim();
  if (direct) {
    return direct;
  }
  return "Unassigned";
}

function getStatusBadgeClass(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "early") {
    return "bg-cyan-100 text-cyan-700";
  }
  if (normalized === "on time") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (normalized === "late") {
    return "bg-amber-100 text-amber-700";
  }
  if (normalized === "completed") {
    return "bg-emerald-100 text-emerald-700";
  }
  return "";
}

function getActorDisplayName(nameValue, emailValue, fallback = "System") {
  const explicitName = String(nameValue || "").trim();
  if (explicitName) {
    return explicitName;
  }

  const raw = String(emailValue || "").trim();
  if (!raw) {
    return fallback;
  }

  if (!raw.includes("@")) {
    return raw;
  }

  return formatNameFromEmail(raw, { fallbackLabel: fallback });
}

function getActorEmail(emailValue) {
  const raw = String(emailValue || "").trim();
  if (!raw || !raw.includes("@")) {
    return "";
  }
  return raw.toLowerCase();
}

function getActorAvatar(avatarValue) {
  const raw = String(avatarValue || "").trim();
  return raw || "/avatars/default-user.svg";
}

export default function AttendanceManagementModule({ session }) {
  const actorEmail = session?.email || "";
  const actorFirstName = session?.firstName || "";
  const actorMiddleName = session?.middleName || "";
  const actorLastName = session?.lastName || "";
  const actorRole = session?.role || "EMPLOYEE_L1";
  const employeeRole = isEmployeeRole(actorRole);
  const employeeDisplayName = useMemo(
    () =>
      formatPersonName({
        firstName: actorFirstName,
        middleName: actorMiddleName,
        lastName: actorLastName,
        fallbackEmail: actorEmail,
        fallbackLabel: "Employee",
      }),
    [actorEmail, actorFirstName, actorLastName, actorMiddleName],
  );
  const employeeInitials = useMemo(() => getInitialsFromName(employeeDisplayName), [employeeDisplayName]);

  const [section, setSection] = useState("monitoring-dashboard");
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isClockInfoOpen, setIsClockInfoOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [recordsFilter, setRecordsFilter] = useState("all");

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const attendancePayload = await hrisApi.attendance.list(employeeRole ? { employeeEmail: actorEmail } : {});
      setAttendanceRows(Array.isArray(attendancePayload.records) ? attendancePayload.records : []);
    } catch (error) {
      setErrorMessage(error.message || "Unable to load attendance records.");
    } finally {
      setIsLoading(false);
    }
  }, [actorEmail, employeeRole]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const allowed = new Set(MANAGEMENT_SECTION_TABS.map((tab) => tab.id));
    const syncSectionFromHash = (rawHash = window.location.hash) => {
      const hash = String(rawHash || "")
        .trim()
        .replace(/^#/, "");
      if (!hash) {
        setSection("monitoring-dashboard");
        return;
      }
      const matched = MANAGEMENT_SECTION_TABS.find((tab) => toSubTabAnchor(tab.id) === hash);
      if (matched && allowed.has(matched.id)) {
        setSection(matched.id);
      }
    };

    const onSubTabAnchor = (event) => {
      const anchor = String(event?.detail?.anchor || "")
        .trim()
        .replace(/^#/, "");
      if (!anchor) {
        return;
      }
      const matched = MANAGEMENT_SECTION_TABS.find((tab) => toSubTabAnchor(tab.id) === anchor);
      if (matched && allowed.has(matched.id)) {
        setSection(matched.id);
      }
    };

    const onHashChange = () => syncSectionFromHash();

    syncSectionFromHash();
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("clio:subtab-anchor", onSubTabAnchor);

    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("clio:subtab-anchor", onSubTabAnchor);
    };
  }, []);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const currentShift = useMemo(() => resolveShiftForMinutes(currentMinutes), [currentMinutes]);
  const currentAttendanceStatus = useMemo(
    () => getShiftArrivalStatus(currentMinutes, currentShift),
    [currentMinutes, currentShift],
  );
  const todayKey = useMemo(() => toDateKey(now), [now]);

  const todayRecords = useMemo(
    () =>
      attendanceRows
        .filter((row) => normalizeDateKey(row.date || row.createdAt) === todayKey)
        .sort((a, b) => getSortableAttendanceTime(b) - getSortableAttendanceTime(a)),
    [attendanceRows, todayKey],
  );

  const openTodayRecord = useMemo(
    () => todayRecords.find((row) => hasValue(row.checkIn) && !hasValue(row.checkOut)) || null,
    [todayRecords],
  );

  const completedTodayRecord = useMemo(
    () => todayRecords.find((row) => hasValue(row.checkIn) && hasValue(row.checkOut)) || null,
    [todayRecords],
  );

  const recentAttendanceRows = useMemo(
    () => [...attendanceRows].sort((a, b) => getSortableAttendanceTime(b) - getSortableAttendanceTime(a)).slice(0, 12),
    [attendanceRows],
  );

  const computedAttendanceRows = useMemo(
    () =>
      attendanceRows.map((row) => {
        const workedMinutes = computeWorkedMinutes(row.checkIn, row.checkOut);
        const isLate = String(row.status || "")
          .trim()
          .toLowerCase()
          .includes("late");
        const isUndertime = Number.isFinite(workedMinutes) && workedMinutes < 8 * 60;
        const overtimeMinutes = Number.isFinite(workedMinutes) ? Math.max(0, workedMinutes - 8 * 60) : 0;

        return {
          ...row,
          workedMinutes,
          workedHours: formatWorkedHours(workedMinutes),
          isLate,
          isUndertime,
          overtimeMinutes,
          overtimeHours: formatWorkedHours(overtimeMinutes),
          departmentLabel: getDepartmentLabel(row),
        };
      }),
    [attendanceRows],
  );

  const todaySummary = useMemo(() => {
    const rows = computedAttendanceRows.filter((row) => normalizeDateKey(row.date || row.createdAt) === todayKey);
    const total = rows.length;
    const absent = rows.filter((row) => !hasValue(row.checkIn)).length;
    const late = rows.filter((row) => row.isLate).length;
    const completed = rows.filter((row) => hasValue(row.checkIn) && hasValue(row.checkOut)).length;
    return { total, absent, late, completed };
  }, [computedAttendanceRows, todayKey]);

  const overtimeRows = useMemo(
    () => computedAttendanceRows.filter((row) => Number.isFinite(row.overtimeMinutes) && row.overtimeMinutes > 0),
    [computedAttendanceRows],
  );

  const departmentOverview = useMemo(() => {
    const map = new Map();
    computedAttendanceRows.forEach((row) => {
      const key = row.departmentLabel;
      const current = map.get(key) || { department: key, total: 0, late: 0, absent: 0, completed: 0 };
      current.total += 1;
      if (row.isLate) {
        current.late += 1;
      }
      if (!hasValue(row.checkIn)) {
        current.absent += 1;
      }
      if (hasValue(row.checkIn) && hasValue(row.checkOut)) {
        current.completed += 1;
      }
      map.set(key, current);
    });
    return [...map.values()].sort((left, right) => right.total - left.total);
  }, [computedAttendanceRows]);

  const dailyTrend = useMemo(() => {
    const map = new Map();
    computedAttendanceRows.forEach((row) => {
      const key = normalizeDateKey(row.date || row.createdAt);
      if (!key) {
        return;
      }
      const current = map.get(key) || { dateKey: key, total: 0, late: 0, absent: 0 };
      current.total += 1;
      if (row.isLate) {
        current.late += 1;
      }
      if (!hasValue(row.checkIn)) {
        current.absent += 1;
      }
      map.set(key, current);
    });
    return [...map.values()].sort((a, b) => String(b.dateKey).localeCompare(String(a.dateKey))).slice(0, 7);
  }, [computedAttendanceRows]);

  const filteredRecords = useMemo(() => {
    if (recordsFilter === "late") {
      return computedAttendanceRows.filter((row) => row.isLate);
    }
    if (recordsFilter === "undertime") {
      return computedAttendanceRows.filter((row) => row.isUndertime);
    }
    if (recordsFilter === "overtime") {
      return computedAttendanceRows.filter((row) => Number.isFinite(row.overtimeMinutes) && row.overtimeMinutes > 0);
    }
    if (recordsFilter === "completed") {
      return computedAttendanceRows.filter((row) => hasValue(row.checkIn) && hasValue(row.checkOut));
    }
    if (recordsFilter === "active") {
      return computedAttendanceRows.filter((row) => hasValue(row.checkIn) && !hasValue(row.checkOut));
    }
    if (recordsFilter === "absent") {
      return computedAttendanceRows.filter((row) => !hasValue(row.checkIn));
    }
    return computedAttendanceRows;
  }, [computedAttendanceRows, recordsFilter]);

  const handleClockIn = async () => {
    if (!employeeRole) {
      return;
    }

    if (!actorEmail) {
      setErrorMessage("Signed-in employee email is required.");
      return;
    }

    if (openTodayRecord) {
      setErrorMessage("You already have an active clock-in record for today.");
      setSuccessMessage("");
      return;
    }

    if (completedTodayRecord) {
      setErrorMessage("Today's attendance is already completed.");
      setSuccessMessage("");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const timestamp = new Date();
      const date = toDateKey(timestamp);
      const minutes = timestamp.getHours() * 60 + timestamp.getMinutes();
      const shift = resolveShiftForMinutes(minutes);
      const status = getShiftArrivalStatus(minutes, shift);
      const checkIn = formatTimeDisplay(timestamp);
      const reason = `Shift assigned: ${shift.assignedShift}. Arrival: ${status}.`;

      const draftRecord = todayRecords.find((row) => !hasValue(row.checkIn));
      const payload = {
        employeeEmail: actorEmail,
        employee: employeeDisplayName || actorEmail,
        date,
        checkIn,
        checkOut: "",
        status,
        reason,
      };

      if (draftRecord?.id) {
        await hrisApi.attendance.update(draftRecord.id, payload);
      } else {
        await hrisApi.attendance.create(payload);
      }

      setSuccessMessage(`Clock-in recorded at ${checkIn}.`);
      await loadData();
    } catch (error) {
      setErrorMessage(error.message || "Unable to clock in.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClockOut = async () => {
    if (!employeeRole) {
      return;
    }

    if (!openTodayRecord?.id) {
      setErrorMessage("No active clock-in record found for today.");
      setSuccessMessage("");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const timestamp = new Date();
      const checkOut = formatTimeDisplay(timestamp);
      await hrisApi.attendance.update(openTodayRecord.id, {
        checkOut,
        status: "Completed",
        reason: appendClockOutSummary(openTodayRecord.reason, checkOut),
      });
      setSuccessMessage(`Clock-out recorded at ${checkOut}.`);
      await loadData();
    } catch (error) {
      setErrorMessage(error.message || "Unable to clock out.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (employeeRole) {
    const canClockIn = !isSubmitting && !openTodayRecord && !completedTodayRecord;
    const canClockOut = !isSubmitting && Boolean(openTodayRecord);

    return (
      <div className="space-y-4">
        {errorMessage ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{errorMessage}</p>
        ) : null}
        {successMessage ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {successMessage}
          </p>
        ) : null}

        {section === "monitoring-dashboard" ? (
          <>
            <div className="relative">
          <div className="rounded-2xl border border-sky-200 bg-white px-4 py-3 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.55)]">
            <div className="flex items-center justify-between gap-3">
              <p className="text-base font-semibold text-slate-900">Clock-in Information</p>
              <button
                type="button"
                onClick={() => setIsClockInfoOpen((current) => !current)}
                aria-label={isClockInfoOpen ? "Hide clock-in information details" : "Show clock-in information details"}
                aria-expanded={isClockInfoOpen}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-sky-300 bg-sky-50 text-sm font-semibold text-sky-700 transition hover:bg-sky-100"
              >
                ?
              </button>
            </div>
          </div>

          {isClockInfoOpen ? (
            <div className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-20 flex justify-end">
              <div className="w-full max-w-[820px] rounded-2xl border border-sky-200 bg-white p-4 shadow-[0_24px_50px_-30px_rgba(14,116,214,0.55)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-slate-900">Clock-in Information</p>
                    <p className="text-xs text-slate-500">Everything you need to know before clocking in</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsClockInfoOpen(false)}
                    aria-label="Close clock-in information details"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
                      <path d="M6 6l12 12M18 6l-12 12" />
                    </svg>
                  </button>
                </div>

                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <p>
                    Date: <span className="font-semibold text-slate-900">{formatLongDate(now)}</span>
                  </p>
                  <p>
                    Current Time: <span className="font-semibold text-slate-900">{formatTimeDisplay(now)}</span>
                  </p>
                  <p>
                    If you clock in now, your shift will be:{" "}
                    <span className="font-semibold text-sky-700">{currentShift.assignedShift}</span>
                  </p>
                  <p>
                    Attendance Status: <span className="font-semibold text-sky-700">{currentAttendanceStatus}</span>
                  </p>
                </div>

                <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/50 p-3">
                  <p className="text-sm font-medium text-slate-700">
                    <span className="mr-2 inline-block h-2 w-2 rounded-full bg-sky-500 align-middle" />
                    Clock in anytime. The system will automatically assign your shift.
                  </p>
                  <div className="mt-3 grid gap-3 lg:grid-cols-3">
                    {SHIFT_WINDOWS.map((shift) => {
                      const isActive = shift.id === currentShift.id;
                      return (
                        <article
                          key={shift.id}
                          className={`rounded-xl border p-3 ${
                            isActive ? "border-sky-300 bg-white" : "border-slate-200 bg-white/80"
                          }`}
                        >
                          <p className="text-sm font-semibold text-slate-900">
                            {shift.sourceShift} {"->"} {shift.assignedShift}
                          </p>
                          <p className="mt-2 text-xs text-slate-600">
                            On Time: <span className="font-medium text-slate-900">{shift.onTimeLabel}</span>
                          </p>
                          <p className="mt-1 text-xs text-slate-600">
                            Early: <span className="font-medium text-slate-900">{shift.earlyLabel}</span>
                          </p>
                          <p className="mt-1 text-xs text-slate-600">
                            Late: <span className="font-medium text-slate-900">{shift.lateLabel}</span>
                          </p>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
            </div>

            <SurfaceCard title="Your Profile" subtitle="Clock-in and clock-out controls">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-5">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-slate-900 text-xl font-semibold text-white">
                {employeeInitials}
              </span>
              <div>
                <p className="text-lg font-semibold text-slate-900">{employeeDisplayName}</p>
                <p className="text-xs text-slate-500">{actorEmail}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={handleClockIn}
                  disabled={!canClockIn}
                  className="inline-flex h-9 items-center rounded-full bg-emerald-600 px-4 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Processing..." : `Clock In (${currentShift.assignedShift} - ${currentAttendanceStatus})`}
                </button>
                <button
                  type="button"
                  onClick={handleClockOut}
                  disabled={!canClockOut}
                  className="inline-flex h-9 items-center rounded-full bg-rose-600 px-4 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Clock Out
                </button>
              </div>
              <p className="text-xs text-slate-500">
                You can clock in anytime. The system automatically determines your attendance status.
              </p>
              {openTodayRecord ? (
                <p className="text-xs font-medium text-emerald-700">Active record started at {openTodayRecord.checkIn || "-"}</p>
              ) : null}
              {completedTodayRecord ? (
                <p className="text-xs font-medium text-slate-600">Today&apos;s attendance is already completed.</p>
              ) : null}
            </div>
          </div>
            </SurfaceCard>
          </>
        ) : null}

        {section === "records" ? (
          <SurfaceCard title="Attendance Records" subtitle="Latest attendance logs from your account">
          {isLoading ? (
            <p className="text-sm text-slate-600">Loading attendance data...</p>
          ) : recentAttendanceRows.length === 0 ? (
            <EmptyState title="No attendance records yet" subtitle="Your clock-in and clock-out activity will appear here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                    <th className="px-2 py-3 font-medium">Date</th>
                    <th className="px-2 py-3 font-medium">Clock In</th>
                    <th className="px-2 py-3 font-medium">Clock Out</th>
                    <th className="px-2 py-3 font-medium">Shift</th>
                    <th className="px-2 py-3 font-medium">Status</th>
                    <th className="px-2 py-3 font-medium">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {recentAttendanceRows.map((row) => {
                    const rowStatus = hasValue(row.checkOut) ? "Completed" : row.status || "Recorded";
                    return (
                      <tr key={row.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                        <td className="px-2 py-3 font-medium text-slate-900">{formatAttendanceDateForRow(row)}</td>
                        <td className="px-2 py-3">{row.checkIn || "-"}</td>
                        <td className="px-2 py-3">{row.checkOut || "-"}</td>
                        <td className="px-2 py-3">{getShiftLabelForRecord(row)}</td>
                        <td className="px-2 py-3">
                          <StatusBadge value={rowStatus} className={getStatusBadgeClass(rowStatus)} />
                        </td>
                        <td className="max-w-[460px] px-2 py-3 text-xs text-slate-600">{getSummaryForRecord(row)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          </SurfaceCard>
        ) : null}

        {section === "audit-logs" ? (
          <SurfaceCard title="Attendance Audit Logs" subtitle="Modification trail for your attendance records">
            {isLoading ? (
              <p className="text-sm text-slate-600">Loading attendance data...</p>
            ) : attendanceRows.length === 0 ? (
              <EmptyState title="No attendance audit logs yet" subtitle="Modification trails will appear after updates." />
            ) : (
              <div className="space-y-2">
                {attendanceRows.map((row) => (
                  <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-sm font-semibold text-slate-900">
                      {row.employee || "-"} | {row.date || "-"}
                    </p>
                    <div className="mt-2 space-y-1">
                      {(row.modificationTrail || []).length === 0 ? (
                        <p className="text-xs text-slate-500">No trail entries yet.</p>
                      ) : (
                        row.modificationTrail.map((event, index) => {
                          const actorName = getActorDisplayName(event.byName, event.byEmail || event.by, "-");
                          const actorEmail = getActorEmail(event.byEmail || event.by);
                          return (
                            <div
                              key={`${row.id}-${index}`}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5"
                            >
                              <div className="flex min-w-[200px] items-center gap-2">
                                <Image
                                  src={getActorAvatar(event.byAvatar)}
                                  alt={`${actorName} profile`}
                                  width={24}
                                  height={24}
                                  className="h-6 w-6 rounded-full border border-slate-200 bg-white object-cover"
                                />
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-medium text-slate-800">{actorName}</p>
                                  {actorEmail ? <p className="truncate text-[11px] text-slate-500">{actorEmail}</p> : null}
                                </div>
                              </div>
                              <p className="text-xs text-slate-700">
                                [{formatDate(event.at)}] {event.action || "update"} | status: {event.status || "-"}
                              </p>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SurfaceCard>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {errorMessage ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{errorMessage}</p>
      ) : null}
      {successMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{successMessage}</p>
      ) : null}

      <SurfaceCard
        title={
          section === "monitoring-dashboard"
            ? "Attendance Monitoring Dashboard"
            : section === "records"
              ? "Attendance Records"
              : "Attendance Audit Logs"
        }
        subtitle="Daily attendance summary, monitoring, and traceability"
      >
        {isLoading ? (
          <p className="text-sm text-slate-600">Loading attendance data...</p>
        ) : (
          <>
            {section === "monitoring-dashboard" ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-xs uppercase tracking-[0.09em] text-slate-500">Daily Attendance Summary</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{todaySummary.total}</p>
                  </div>
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3">
                    <p className="text-xs uppercase tracking-[0.09em] text-rose-600">Absent Employees</p>
                    <p className="mt-2 text-2xl font-semibold text-rose-700">{todaySummary.absent}</p>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                    <p className="text-xs uppercase tracking-[0.09em] text-amber-700">Late Employees</p>
                    <p className="mt-2 text-2xl font-semibold text-amber-700">{todaySummary.late}</p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
                    <p className="text-xs uppercase tracking-[0.09em] text-emerald-700">Overtime Reports</p>
                    <p className="mt-2 text-2xl font-semibold text-emerald-700">{overtimeRows.length}</p>
                  </div>
                </div>

                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-sm font-semibold text-slate-900">Department Attendance Overview</p>
                    {departmentOverview.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">No department attendance data yet.</p>
                    ) : (
                      <div className="mt-2 overflow-x-auto">
                        <table className="min-w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 uppercase tracking-[0.08em] text-slate-500">
                              <th className="px-2 py-2 font-medium">Department</th>
                              <th className="px-2 py-2 font-medium">Total</th>
                              <th className="px-2 py-2 font-medium">Late</th>
                              <th className="px-2 py-2 font-medium">Absent</th>
                            </tr>
                          </thead>
                          <tbody>
                            {departmentOverview.map((item) => (
                              <tr key={item.department} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                                <td className="px-2 py-2">{item.department}</td>
                                <td className="px-2 py-2">{item.total}</td>
                                <td className="px-2 py-2">{item.late}</td>
                                <td className="px-2 py-2">{item.absent}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-sm font-semibold text-slate-900">Trends and Analytics (Last 7 days)</p>
                    {dailyTrend.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">No trend data yet.</p>
                    ) : (
                      <div className="mt-2 overflow-x-auto">
                        <table className="min-w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 uppercase tracking-[0.08em] text-slate-500">
                              <th className="px-2 py-2 font-medium">Date</th>
                              <th className="px-2 py-2 font-medium">Total</th>
                              <th className="px-2 py-2 font-medium">Late</th>
                              <th className="px-2 py-2 font-medium">Absent</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dailyTrend.map((item) => (
                              <tr key={item.dateKey} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                                <td className="px-2 py-2">{formatDate(item.dateKey)}</td>
                                <td className="px-2 py-2">{item.total}</td>
                                <td className="px-2 py-2">{item.late}</td>
                                <td className="px-2 py-2">{item.absent}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : section === "audit-logs" ? (
              attendanceRows.length === 0 ? (
                <EmptyState title="No attendance audit logs yet" subtitle="Modification trails will appear after updates." />
              ) : (
                <div className="space-y-2">
                  {attendanceRows.map((row) => (
                    <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                      <p className="text-sm font-semibold text-slate-900">
                        {row.employee || "-"} | {row.date || "-"}
                      </p>
                      <div className="mt-2 space-y-1">
                        {(row.modificationTrail || []).length === 0 ? (
                          <p className="text-xs text-slate-500">No trail entries yet.</p>
                        ) : (
                          row.modificationTrail.map((event, index) => {
                            const actorName = getActorDisplayName(event.byName, event.byEmail || event.by, "-");
                            const actorEmail = getActorEmail(event.byEmail || event.by);
                            return (
                              <div
                                key={`${row.id}-${index}`}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5"
                              >
                                <div className="flex min-w-[200px] items-center gap-2">
                                  <Image
                                    src={getActorAvatar(event.byAvatar)}
                                    alt={`${actorName} profile`}
                                    width={24}
                                    height={24}
                                    className="h-6 w-6 rounded-full border border-slate-200 bg-white object-cover"
                                  />
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-medium text-slate-800">{actorName}</p>
                                    {actorEmail ? <p className="truncate text-[11px] text-slate-500">{actorEmail}</p> : null}
                                  </div>
                                </div>
                                <p className="text-xs text-slate-700">
                                  [{formatDate(event.at)}] {event.action || "update"} | status: {event.status || "-"}
                                </p>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : section === "records" ? (
              <>
                <div className="mb-3 flex flex-wrap items-end gap-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.09em] text-slate-500" htmlFor="attendance-records-filter">
                    Records Filter
                  </label>
                  <select
                    id="attendance-records-filter"
                    value={recordsFilter}
                    onChange={(event) => setRecordsFilter(event.target.value)}
                    className="h-9 min-w-[220px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
                  >
                    <option value="all">All records</option>
                    <option value="late">Late only</option>
                    <option value="undertime">Undertime only</option>
                    <option value="overtime">Overtime only</option>
                    <option value="completed">Completed only</option>
                    <option value="active">Active (no clock-out)</option>
                    <option value="absent">Absent (no clock-in)</option>
                  </select>
                </div>

                {filteredRecords.length === 0 ? (
                  <EmptyState title="No matching attendance records" subtitle="Change filter to view other attendance records." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                          <th className="px-2 py-3 font-medium">Employee</th>
                          <th className="px-2 py-3 font-medium">Date</th>
                          <th className="px-2 py-3 font-medium">Clock In</th>
                          <th className="px-2 py-3 font-medium">Clock Out</th>
                          <th className="px-2 py-3 font-medium">Worked</th>
                          <th className="px-2 py-3 font-medium">Overtime</th>
                          <th className="px-2 py-3 font-medium">Flags</th>
                          <th className="px-2 py-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRecords.map((row) => (
                          <tr key={row.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                            <td className="px-2 py-3">
                              <p className="font-medium text-slate-900">{row.employee || "-"}</p>
                              <p className="text-xs text-slate-500">{row.employeeEmail || "-"}</p>
                            </td>
                            <td className="px-2 py-3">{row.date || "-"}</td>
                            <td className="px-2 py-3">{row.checkIn || "-"}</td>
                            <td className="px-2 py-3">{row.checkOut || "-"}</td>
                            <td className="px-2 py-3">{row.workedHours}</td>
                            <td className="px-2 py-3">{row.overtimeHours}</td>
                            <td className="px-2 py-3">
                              <div className="flex flex-wrap gap-1.5">
                                {row.isLate ? <StatusBadge value="Late" className="bg-amber-100 text-amber-700" /> : null}
                                {row.isUndertime ? <StatusBadge value="Undertime" className="bg-rose-100 text-rose-700" /> : null}
                                {!row.isLate && !row.isUndertime ? <span className="text-xs text-slate-500">-</span> : null}
                              </div>
                            </td>
                            <td className="px-2 py-3">
                              <StatusBadge value={row.status || "-"} className={getStatusBadgeClass(row.status)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <>
                {attendanceRows.length === 0 ? (
                  <EmptyState title="No attendance records yet" subtitle="Clock-in and clock-out entries will appear here." />
                ) : (
                  <div className="space-y-3">
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                            <th className="px-2 py-3 font-medium">Employee</th>
                            <th className="px-2 py-3 font-medium">Date</th>
                            <th className="px-2 py-3 font-medium">Clock In</th>
                            <th className="px-2 py-3 font-medium">Clock Out</th>
                            <th className="px-2 py-3 font-medium">Status</th>
                            <th className="px-2 py-3 font-medium">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {attendanceRows.map((row) => (
                            <tr key={row.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                              <td className="px-2 py-3">
                                <p className="font-medium text-slate-900">{row.employee || "-"}</p>
                                <p className="text-xs text-slate-500">{row.employeeEmail || "-"}</p>
                              </td>
                              <td className="px-2 py-3">{row.date || "-"}</td>
                              <td className="px-2 py-3">{row.checkIn || "-"}</td>
                              <td className="px-2 py-3">{row.checkOut || "-"}</td>
                              <td className="px-2 py-3">
                                <StatusBadge value={row.status || "-"} />
                              </td>
                              <td className="px-2 py-3 text-xs text-slate-600">{row.reason || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </SurfaceCard>
    </div>
  );
}
