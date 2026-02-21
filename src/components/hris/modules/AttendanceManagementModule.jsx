"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import SurfaceCard from "@/components/hris/SurfaceCard";
import EmptyState from "@/components/hris/shared/EmptyState";
import ModuleTabs from "@/components/hris/shared/ModuleTabs";
import StatusBadge from "@/components/hris/shared/StatusBadge";
import { formatNameFromEmail, formatPersonName } from "@/lib/name-utils";
import { hrisApi } from "@/services/hris-api-client";

const SECTION_TABS = [
  { id: "time-logs", label: "Time Logs" },
  { id: "leave-requests", label: "Leave Requests" },
  { id: "leave-approvals", label: "Leave Approvals" },
  { id: "leave-balances", label: "Leave Balances" },
  { id: "adjustments", label: "Attendance Adjustments" },
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

const initialAttendanceForm = {
  employeeEmail: "",
  employee: "",
  date: "",
  checkIn: "",
  checkOut: "",
  status: "Recorded",
  reason: "",
};

const initialLeaveForm = {
  employeeEmail: "",
  employee: "",
  leaveType: "Vacation Leave",
  startDate: "",
  endDate: "",
  reason: "",
};

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

function getLeaveDays(startDate, endDate) {
  const start = new Date(startDate || "");
  const end = new Date(endDate || "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return 0;
  }
  const diff = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return diff + 1;
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
  const canManage = !employeeRole;
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

  const [section, setSection] = useState("time-logs");
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [leaveRows, setLeaveRows] = useState([]);
  const [attendanceForm, setAttendanceForm] = useState(initialAttendanceForm);
  const [leaveForm, setLeaveForm] = useState(initialLeaveForm);
  const [selectedAttendanceId, setSelectedAttendanceId] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isClockInfoOpen, setIsClockInfoOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

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

      if (employeeRole) {
        setLeaveRows([]);
      } else {
        const leavePayload = await hrisApi.leave.list({});
        setLeaveRows(Array.isArray(leavePayload.records) ? leavePayload.records : []);
      }
    } catch (error) {
      setErrorMessage(error.message || "Unable to load attendance records.");
    } finally {
      setIsLoading(false);
    }
  }, [actorEmail, employeeRole]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const leaveBalanceRows = useMemo(() => {
    const grouped = new Map();
    leaveRows.forEach((row) => {
      const email = String(row.employeeEmail || "").trim().toLowerCase();
      if (!email) {
        return;
      }
      const current = grouped.get(email) || {
        employeeEmail: row.employeeEmail,
        employee: row.employee || row.employeeEmail,
        usedDays: 0,
        approvedCount: 0,
      };
      if (String(row.status || "").trim().toLowerCase() === "approved") {
        current.approvedCount += 1;
        current.usedDays += getLeaveDays(row.startDate, row.endDate);
      }
      grouped.set(email, current);
    });

    return Array.from(grouped.values()).map((item) => {
      const allocated = 15;
      const remaining = Math.max(0, allocated - item.usedDays);
      return {
        ...item,
        allocated,
        remaining,
      };
    });
  }, [leaveRows]);

  const selectedAttendanceRecord = useMemo(
    () => attendanceRows.find((row) => row.id === selectedAttendanceId) || null,
    [attendanceRows, selectedAttendanceId],
  );

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

  const handleAttendanceField = (field) => (event) => {
    setAttendanceForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const handleLeaveField = (field) => (event) => {
    setLeaveForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const submitAttendance = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const payload = {
        ...attendanceForm,
        employeeEmail: employeeRole ? actorEmail : attendanceForm.employeeEmail,
        employee: employeeRole ? actorEmail : attendanceForm.employee,
      };
      await hrisApi.attendance.create(payload);
      setAttendanceForm(initialAttendanceForm);
      setSuccessMessage("Attendance entry saved.");
      await loadData();
    } catch (error) {
      setErrorMessage(error.message || "Unable to save attendance entry.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitLeave = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const payload = {
        ...leaveForm,
        employeeEmail: employeeRole ? actorEmail : leaveForm.employeeEmail,
        employee: employeeRole ? actorEmail : leaveForm.employee,
      };
      await hrisApi.leave.create(payload);
      setLeaveForm(initialLeaveForm);
      setSuccessMessage("Leave request submitted.");
      await loadData();
    } catch (error) {
      setErrorMessage(error.message || "Unable to submit leave request.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLeaveApproval = async (recordId, approved) => {
    if (!recordId || !canManage) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await hrisApi.leave.approve(recordId, {
        approved,
        approvalNote: approved ? "Approved by workflow owner" : "Rejected by workflow owner",
      });
      setSuccessMessage(approved ? "Leave request approved." : "Leave request rejected.");
      await loadData();
    } catch (error) {
      setErrorMessage(error.message || "Unable to process leave approval.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitAdjustment = async () => {
    if (!selectedAttendanceRecord?.id) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await hrisApi.attendance.update(selectedAttendanceRecord.id, {
        reason: adjustmentReason,
        status: "Adjusted",
      });
      setAdjustmentReason("");
      setSuccessMessage("Attendance adjustment logged.");
      await loadData();
    } catch (error) {
      setErrorMessage(error.message || "Unable to submit adjustment.");
    } finally {
      setIsSubmitting(false);
    }
  };

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

        <SurfaceCard title="Recent Attendance" subtitle="Latest attendance logs from your account">
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
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ModuleTabs tabs={SECTION_TABS} value={section} onChange={setSection} />

      {errorMessage ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{errorMessage}</p>
      ) : null}
      {successMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{successMessage}</p>
      ) : null}

      {(section === "time-logs" || section === "adjustments") && (
        <SurfaceCard title="Manual Attendance Entry" subtitle="Clock-in and clock-out with traceability">
          <form className="grid gap-2 md:grid-cols-4" onSubmit={submitAttendance}>
            {!employeeRole ? (
              <>
                <input
                  required
                  value={attendanceForm.employeeEmail}
                  onChange={handleAttendanceField("employeeEmail")}
                  placeholder="Employee email"
                  className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                />
                <input
                  value={attendanceForm.employee}
                  onChange={handleAttendanceField("employee")}
                  placeholder="Employee name"
                  className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                />
              </>
            ) : null}
            <input
              type="date"
              required
              value={attendanceForm.date}
              onChange={handleAttendanceField("date")}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              type="time"
              value={attendanceForm.checkIn}
              onChange={handleAttendanceField("checkIn")}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              type="time"
              value={attendanceForm.checkOut}
              onChange={handleAttendanceField("checkOut")}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              value={attendanceForm.reason}
              onChange={handleAttendanceField("reason")}
              placeholder="Reason / notes"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <div className="md:col-span-4">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
              >
                {isSubmitting ? "Saving..." : "Save Attendance"}
              </button>
            </div>
          </form>
        </SurfaceCard>
      )}

      {(section === "leave-requests" || section === "leave-approvals") && (
        <SurfaceCard title="Leave Request Workflow" subtitle="Requests, approvals, and leave balance impact">
          <form className="grid gap-2 md:grid-cols-4" onSubmit={submitLeave}>
            {!employeeRole ? (
              <>
                <input
                  required
                  value={leaveForm.employeeEmail}
                  onChange={handleLeaveField("employeeEmail")}
                  placeholder="Employee email"
                  className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                />
                <input
                  value={leaveForm.employee}
                  onChange={handleLeaveField("employee")}
                  placeholder="Employee name"
                  className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                />
              </>
            ) : null}
            <select
              value={leaveForm.leaveType}
              onChange={handleLeaveField("leaveType")}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            >
              <option>Vacation Leave</option>
              <option>Sick Leave</option>
              <option>Emergency Leave</option>
            </select>
            <input
              type="date"
              required
              value={leaveForm.startDate}
              onChange={handleLeaveField("startDate")}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              type="date"
              required
              value={leaveForm.endDate}
              onChange={handleLeaveField("endDate")}
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <input
              value={leaveForm.reason}
              onChange={handleLeaveField("reason")}
              placeholder="Reason"
              className="h-9 rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
            />
            <div className="md:col-span-4">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
              >
                {isSubmitting ? "Submitting..." : "Submit Leave Request"}
              </button>
            </div>
          </form>
        </SurfaceCard>
      )}

      <SurfaceCard
        title={
          section === "leave-balances"
            ? "Leave Balances"
            : section === "audit-logs"
              ? "Attendance Audit Logs"
              : "Attendance Records"
        }
        subtitle="Time logs, leave workflow, and modification traceability"
      >
        {isLoading ? (
          <p className="text-sm text-slate-600">Loading attendance data...</p>
        ) : (
          <>
            {section === "leave-balances" ? (
              leaveBalanceRows.length === 0 ? (
                <EmptyState title="No leave balance data yet" subtitle="Approved leave requests will update balances automatically." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                        <th className="px-2 py-3 font-medium">Employee</th>
                        <th className="px-2 py-3 font-medium">Allocated</th>
                        <th className="px-2 py-3 font-medium">Used</th>
                        <th className="px-2 py-3 font-medium">Remaining</th>
                        <th className="px-2 py-3 font-medium">Approved Requests</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaveBalanceRows.map((row) => (
                        <tr key={row.employeeEmail} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                          <td className="px-2 py-3 font-medium text-slate-900">{row.employee}</td>
                          <td className="px-2 py-3">{row.allocated}</td>
                          <td className="px-2 py-3">{row.usedDays}</td>
                          <td className="px-2 py-3">{row.remaining}</td>
                          <td className="px-2 py-3">{row.approvedCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : section === "leave-requests" || section === "leave-approvals" ? (
              leaveRows.length === 0 ? (
                <EmptyState title="No leave requests yet" subtitle="Submitted leave requests will appear in this table." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                        <th className="px-2 py-3 font-medium">Employee</th>
                        <th className="px-2 py-3 font-medium">Leave Type</th>
                        <th className="px-2 py-3 font-medium">Date Range</th>
                        <th className="px-2 py-3 font-medium">Status</th>
                        <th className="px-2 py-3 font-medium">Approver</th>
                        <th className="px-2 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaveRows.map((row) => (
                        <tr key={row.id} className="border-b border-slate-100 text-slate-700 last:border-b-0">
                          <td className="px-2 py-3">
                            <p className="font-medium text-slate-900">{row.employee || "-"}</p>
                            <p className="text-xs text-slate-500">{row.employeeEmail || "-"}</p>
                          </td>
                          <td className="px-2 py-3">{row.leaveType || "-"}</td>
                          <td className="px-2 py-3">
                            {formatDate(row.startDate)} - {formatDate(row.endDate)}
                          </td>
                          <td className="px-2 py-3">
                            <StatusBadge value={row.status || "-"} />
                          </td>
                          <td className="px-2 py-3">
                            {row.approver || row.approverName ? (
                              <div className="flex items-center gap-2">
                                <Image
                                  src={getActorAvatar(row.approverAvatar)}
                                  alt={`${getActorDisplayName(row.approverName, row.approverEmail || row.approver, "Approver")} profile`}
                                  width={28}
                                  height={28}
                                  className="h-7 w-7 rounded-full border border-slate-200 bg-white object-cover"
                                />
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-medium text-slate-800">
                                    {getActorDisplayName(row.approverName, row.approverEmail || row.approver, "-")}
                                  </p>
                                  {getActorEmail(row.approverEmail || row.approver) ? (
                                    <p className="truncate text-[11px] text-slate-500">
                                      {getActorEmail(row.approverEmail || row.approver)}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="px-2 py-3 text-right">
                            {canManage ? (
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleLeaveApproval(row.id, true)}
                                  disabled={isSubmitting}
                                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleLeaveApproval(row.id, false)}
                                  disabled={isSubmitting}
                                  className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                                >
                                  Reject
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500">View only</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
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
                            <th className="px-2 py-3 font-medium text-right">Select</th>
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
                              <td className="px-2 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => setSelectedAttendanceId(row.id)}
                                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                                >
                                  Select
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {section === "adjustments" ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                          Attendance Adjustments
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          Selected record: {selectedAttendanceRecord ? `${selectedAttendanceRecord.employee} (${selectedAttendanceRecord.date})` : "None"}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <input
                            value={adjustmentReason}
                            onChange={(event) => setAdjustmentReason(event.target.value)}
                            placeholder="Adjustment reason"
                            className="h-9 min-w-[220px] rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-sky-400 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={submitAdjustment}
                            disabled={!selectedAttendanceRecord || isSubmitting}
                            className="h-9 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
                          >
                            Save Adjustment
                          </button>
                        </div>
                      </div>
                    ) : null}
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
