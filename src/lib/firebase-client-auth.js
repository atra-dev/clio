"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

function resolveStorageBucketForConfig() {
  const storageBucketUrl = String(
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET_URL || "",
  ).trim();
  if (storageBucketUrl) {
    return storageBucketUrl
      .replace(/^gs:\/\//, "")
      .replace(/^\/+|\/+$/g, "");
  }

  return String(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "").trim();
}

function getFirebaseConfig() {
  return {
    apiKey: String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "").trim(),
    authDomain: String(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "").trim(),
    projectId: String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim(),
    storageBucket: resolveStorageBucketForConfig(),
    messagingSenderId: String(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "").trim(),
    appId: String(process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "").trim(),
  };
}

function getMissingConfigKeys(config) {
  const required = [
    "apiKey",
    "authDomain",
    "projectId",
    "appId",
  ];

  return required.filter((key) => !String(config[key] || "").trim());
}

export function getFirebaseClientAuth() {
  const app = getFirebaseClientApp();
  return getAuth(app);
}

export function getFirebaseClientApp() {
  const config = getFirebaseConfig();
  const missing = getMissingConfigKeys(config);
  if (missing.length > 0) {
    throw new Error(`firebase_client_not_configured:${missing.join(",")}`);
  }

  return getApps().length > 0 ? getApp() : initializeApp(config);
}
