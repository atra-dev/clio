"use client";

import { getStorage } from "firebase/storage";
import { getFirebaseClientApp } from "@/lib/firebase-client-auth";

function normalizeBucketUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith("gs://")) {
    return normalized;
  }
  return `gs://${normalized.replace(/^\/+|\/+$/g, "")}`;
}

export function getFirebaseClientStorage() {
  const app = getFirebaseClientApp();
  const configuredBucket = normalizeBucketUrl(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET_URL);
  if (!configuredBucket) {
    throw new Error("firebase_storage_bucket_not_configured");
  }

  return getStorage(app, configuredBucket);
}
