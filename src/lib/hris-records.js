import { collection, getDocs } from "firebase/firestore/lite";
import { getFirestoreDb, isFirestoreEnabled } from "@/lib/firebase";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function asDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === "function") {
    const converted = value.toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
  }

  if (Number.isFinite(value?.seconds)) {
    const fromSeconds = new Date(value.seconds * 1000);
    return Number.isNaN(fromSeconds.getTime()) ? null : fromSeconds;
  }

  const fromString = new Date(value);
  return Number.isNaN(fromString.getTime()) ? null : fromString;
}

function formatDate(value) {
  const date = asDate(value);
  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatTime(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "-";
  }

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) {
    return raw.slice(0, 5);
  }

  const date = asDate(raw);
  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function getEmployeesCollectionName() {
  return String(process.env.CLIO_FIRESTORE_EMPLOYEES_COLLECTION || "employees").trim() || "employees";
}

function getAttendanceCollectionName() {
  return String(process.env.CLIO_FIRESTORE_ATTENDANCE_COLLECTION || "attendance").trim() || "attendance";
}

async function getFirestoreStore() {
  if (!isFirestoreEnabled()) {
    return null;
  }
  return getFirestoreDb();
}

function normalizeEmployeeRecord(docId, payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const email = normalizeEmail(payload.email || payload.workEmail || payload.userEmail);
  if (!email) {
    return null;
  }

  return {
    employeeId: String(payload.employeeId || payload.employeeCode || payload.code || docId || "UNASSIGNED"),
    name: String(payload.name || payload.fullName || payload.employeeName || email),
    email,
    role: String(payload.role || payload.jobTitle || "Employee"),
    type: String(payload.type || payload.employmentType || "Regular"),
    status: String(payload.status || "Active"),
    employmentStatus: String(payload.employmentStatus || payload.status || "Active Employee"),
    contact: String(payload.contact || payload.mobileNumber || payload.phone || "-"),
    govId: String(payload.govId || payload.governmentId || payload.tin || "Masked"),
    payrollGroup: String(payload.payrollGroup || payload.payroll || "-"),
  };
}

function normalizeAttendanceRecord(docId, payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const checkIn = formatTime(payload.checkIn || payload.clockIn || payload.timeIn);
  const checkOut = formatTime(payload.checkOut || payload.clockOut || payload.timeOut);
  const explicitStatus = String(payload.status || "").trim();
  const status =
    explicitStatus ||
    (checkIn !== "-" && checkOut !== "-" ? "Recorded" : checkIn !== "-" ? "In Progress" : "No Record");

  return {
    id: String(payload.id || docId),
    employee: String(payload.employee || payload.employeeName || payload.name || "Unknown Employee"),
    employeeEmail: normalizeEmail(payload.employeeEmail || payload.email || payload.userEmail || ""),
    date: formatDate(payload.date || payload.attendanceDate || payload.workDate || payload.recordedAt || payload.createdAt),
    checkIn,
    checkOut,
    status,
    modifiedBy: String(payload.modifiedBy || payload.updatedBy || payload.actor || "-"),
  };
}

export async function listEmployeeRecordsFromFirestore() {
  const db = await getFirestoreStore();
  if (!db) {
    return [];
  }

  try {
    const snapshot = await getDocs(collection(db, getEmployeesCollectionName()));
    return snapshot.docs
      .map((item) => normalizeEmployeeRecord(item.id, item.data()))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function listAttendanceRecordsFromFirestore() {
  const db = await getFirestoreStore();
  if (!db) {
    return [];
  }

  try {
    const snapshot = await getDocs(collection(db, getAttendanceCollectionName()));
    return snapshot.docs
      .map((item) => normalizeAttendanceRecord(item.id, item.data()))
      .filter(Boolean)
      .sort((a, b) => `${b.date}-${b.checkIn}`.localeCompare(`${a.date}-${a.checkIn}`));
  } catch {
    return [];
  }
}
