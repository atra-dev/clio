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

function normalizeUploadError(error, fallback) {
  const message = String(error?.message || "").trim();
  if (message.includes("firebase_storage_bucket_not_configured")) {
    return "Storage bucket is not configured. Set NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET_URL to your CLIO bucket.";
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
    const storage = getFirebaseClientStorage();
    const storagePath = buildProfilePath({ userEmail, userUid, file });
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file, {
      contentType: file.type || "application/octet-stream",
      cacheControl: "public,max-age=86400",
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
    const storage = getFirebaseClientStorage();
    const storagePath = buildEmployeeDocumentPath({ employeeRecordId, employeeEmail, file });
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file, {
      contentType: file.type || "application/octet-stream",
      cacheControl: "private,max-age=0",
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
