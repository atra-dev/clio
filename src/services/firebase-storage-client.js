"use client";

import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getFirebaseClientAuth } from "@/lib/firebase-client-auth";
import { getFirebaseClientStorage } from "@/lib/firebase-client-storage";

function nowStamp() {
  return Date.now();
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

function sanitizeSegment(value, fallback = "item") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function inferExtension(fileName, mimeType) {
  const fromName = String(fileName || "").trim().toLowerCase();
  const nameToken = fromName.split(".").pop() || "";
  if (/^[a-z0-9]{2,8}$/.test(nameToken)) {
    return nameToken;
  }

  const mime = String(mimeType || "").trim().toLowerCase();
  if (mime.includes("png")) {
    return "png";
  }
  if (mime.includes("jpeg") || mime.includes("jpg")) {
    return "jpg";
  }
  if (mime.includes("webp")) {
    return "webp";
  }
  if (mime.includes("pdf")) {
    return "pdf";
  }
  if (mime.includes("spreadsheet") || mime.includes("excel")) {
    return "xlsx";
  }
  if (mime.includes("word")) {
    return "docx";
  }
  if (mime.includes("csv")) {
    return "csv";
  }
  return "bin";
}

const INCIDENT_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
const INCIDENT_EVIDENCE_ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "txt",
]);

function validateIncidentEvidenceFile(file) {
  const extension = inferExtension(file?.name, file?.type);
  if (!INCIDENT_EVIDENCE_ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error("Invalid incident evidence file type.");
  }
  const sizeBytes = Number(file?.size) || 0;
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > INCIDENT_EVIDENCE_MAX_BYTES) {
    throw new Error("Incident evidence file must be greater than 0 bytes and up to 10 MB.");
  }
}

function buildProfilePath({ userEmail, userUid, file }) {
  const actor = sanitizeSegment(userUid || String(userEmail || "").split("@")[0], "user");
  const extension = inferExtension(file?.name, file?.type);
  return `clio/profiles/${actor}/avatar-${nowStamp()}-${randomSuffix()}.${extension}`;
}

function buildEmployeeDocumentPath({ employeeRecordId, employeeEmail, file }) {
  const employeeScope = sanitizeSegment(employeeRecordId || employeeEmail || "employee", "employee");
  const fileBase = sanitizeSegment(String(file?.name || "").replace(/\.[^.]+$/, ""), "document");
  const extension = inferExtension(file?.name, file?.type);
  return `clio/employee-documents/${employeeScope}/${nowStamp()}-${fileBase}-${randomSuffix()}.${extension}`;
}

function buildLifecycleEvidencePath({ lifecycleRecordId, employeeEmail, file }) {
  const workflowScope = sanitizeSegment(lifecycleRecordId || employeeEmail || "lifecycle", "lifecycle");
  const fileBase = sanitizeSegment(String(file?.name || "").replace(/\.[^.]+$/, ""), "evidence");
  const extension = inferExtension(file?.name, file?.type);
  return `clio/lifecycle-evidence/${workflowScope}/${nowStamp()}-${fileBase}-${randomSuffix()}.${extension}`;
}

function buildIncidentEvidencePath({ incidentRecordId, affectedEmployeeEmail, file }) {
  const incidentScope = sanitizeSegment(incidentRecordId || affectedEmployeeEmail || "incident", "incident");
  const fileBase = sanitizeSegment(String(file?.name || "").replace(/\.[^.]+$/, ""), "evidence");
  const extension = inferExtension(file?.name, file?.type);
  return `clio/incident-evidence/${incidentScope}/${nowStamp()}-${fileBase}-${randomSuffix()}.${extension}`;
}

function normalizeUploadError(error, fallback) {
  const message = String(error?.message || "").trim();
  if (message.includes("firebase_storage_bucket_not_configured")) {
    return "Storage bucket is not configured. Set NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET_URL to your CLIO bucket.";
  }
  if (message.includes("employee_document_owner_email_required")) {
    return "Employee email is required before uploading employee documents.";
  }
  if (message) {
    return message;
  }
  return fallback;
}

export async function uploadProfilePhotoToStorage({ file, userEmail }) {
  if (!file) {
    throw new Error("Profile image file is required.");
  }

  try {
    const auth = getFirebaseClientAuth();
    const userUid = String(auth.currentUser?.uid || "").trim();
    const actorEmail = normalizeEmail(auth.currentUser?.email || userEmail);
    const storage = getFirebaseClientStorage();
    const storagePath = buildProfilePath({ userEmail, userUid, file });
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file, {
      contentType: file.type || "application/octet-stream",
      cacheControl: "public,max-age=86400",
      customMetadata: {
        ownerUid: userUid || "unknown",
        ownerEmail: actorEmail || "unknown",
      },
    });
    const downloadUrl = await getDownloadURL(storageRef);
    return {
      storagePath,
      downloadUrl,
      contentType: file.type || "",
      sizeBytes: Number(file.size) || 0,
    };
  } catch (error) {
    throw new Error(normalizeUploadError(error, "Unable to upload profile photo."));
  }
}

export async function uploadEmployeeDocumentToStorage({ file, employeeRecordId, employeeEmail }) {
  if (!file) {
    throw new Error("Document file is required.");
  }

  try {
    const auth = getFirebaseClientAuth();
    const actorEmail = normalizeEmail(auth.currentUser?.email);
    const ownerEmail = normalizeEmail(employeeEmail) || actorEmail;
    if (!ownerEmail) {
      throw new Error("employee_document_owner_email_required");
    }

    const storage = getFirebaseClientStorage();
    const storagePath = buildEmployeeDocumentPath({ employeeRecordId, employeeEmail, file });
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file, {
      contentType: file.type || "application/octet-stream",
      cacheControl: "private,max-age=0",
      customMetadata: {
        ownerEmail,
        uploaderEmail: actorEmail || ownerEmail,
        employeeRecordId: String(employeeRecordId || "").trim(),
      },
    });
    const downloadUrl = await getDownloadURL(storageRef);
    return {
      storagePath,
      downloadUrl,
      contentType: file.type || "",
      sizeBytes: Number(file.size) || 0,
    };
  } catch (error) {
    throw new Error(normalizeUploadError(error, "Unable to upload document file."));
  }
}

export async function uploadLifecycleEvidenceToStorage({ file, lifecycleRecordId, employeeEmail }) {
  if (!file) {
    throw new Error("Evidence file is required.");
  }

  try {
    const auth = getFirebaseClientAuth();
    const actorEmail = normalizeEmail(auth.currentUser?.email);
    const storage = getFirebaseClientStorage();
    const storagePath = buildLifecycleEvidencePath({ lifecycleRecordId, employeeEmail, file });
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file, {
      contentType: file.type || "application/octet-stream",
      cacheControl: "private,max-age=0",
      customMetadata: {
        uploaderEmail: actorEmail || "unknown",
        employeeEmail: normalizeEmail(employeeEmail),
      },
    });
    const downloadUrl = await getDownloadURL(storageRef);
    return {
      storagePath,
      downloadUrl,
      contentType: file.type || "",
      sizeBytes: Number(file.size) || 0,
    };
  } catch (error) {
    throw new Error(normalizeUploadError(error, "Unable to upload lifecycle evidence."));
  }
}

export async function uploadIncidentEvidenceToStorage({ file, incidentRecordId, affectedEmployeeEmail }) {
  if (!file) {
    throw new Error("Evidence file is required.");
  }
  validateIncidentEvidenceFile(file);

  try {
    const auth = getFirebaseClientAuth();
    const actorEmail = normalizeEmail(auth.currentUser?.email);
    const storage = getFirebaseClientStorage();
    const storagePath = buildIncidentEvidencePath({ incidentRecordId, affectedEmployeeEmail, file });
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file, {
      contentType: file.type || "application/octet-stream",
      cacheControl: "private,max-age=0",
      customMetadata: {
        uploaderEmail: actorEmail || "unknown",
        affectedEmployeeEmail: normalizeEmail(affectedEmployeeEmail),
        incidentRecordId: String(incidentRecordId || "").trim(),
      },
    });
    const downloadUrl = await getDownloadURL(storageRef);
    return {
      storagePath,
      downloadUrl,
      contentType: file.type || "",
      sizeBytes: Number(file.size) || 0,
    };
  } catch (error) {
    throw new Error(normalizeUploadError(error, "Unable to upload incident evidence."));
  }
}

export async function removeStorageObjectByPath(storagePath) {
  const normalizedPath = String(storagePath || "").trim();
  if (!normalizedPath) {
    return;
  }

  try {
    const storage = getFirebaseClientStorage();
    await deleteObject(ref(storage, normalizedPath));
  } catch {
    // Best-effort cleanup only.
  }
}
