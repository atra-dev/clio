import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore/lite";

function envValue(name) {
  return String(process.env[name] || "").trim();
}

function getFirebaseConfig() {
  return {
    apiKey: envValue("NEXT_PUBLIC_FIREBASE_API_KEY"),
    authDomain: envValue("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
    projectId: envValue("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
    storageBucket: envValue("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: envValue("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"),
    appId: envValue("NEXT_PUBLIC_FIREBASE_APP_ID"),
    measurementId: envValue("NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID"),
  };
}

function hasRequiredFirebaseConfig(config) {
  return Boolean(
    config.apiKey &&
      config.authDomain &&
      config.projectId &&
      config.appId,
  );
}

function getFirestoreDatabaseId() {
  const configuredId = envValue("CLIO_FIRESTORE_DATABASE_ID");
  if (!configuredId) {
    return "cliohris";
  }

  const normalized = configuredId.toLowerCase();
  if (normalized === "default" || normalized === "(default)") {
    return "cliohris";
  }

  return configuredId;
}

export function isFirestoreEnabled() {
  if (String(process.env.CLIO_USE_FIRESTORE || "").trim().toLowerCase() === "false") {
    return false;
  }

  return hasRequiredFirebaseConfig(getFirebaseConfig());
}

export function getFirebaseApp() {
  if (!isFirestoreEnabled()) {
    return null;
  }

  const config = getFirebaseConfig();
  if (getApps().length > 0) {
    return getApp();
  }

  return initializeApp(config);
}

export function getFirestoreDb() {
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
  const databaseId = getFirestoreDatabaseId();
  return getFirestore(app, databaseId);
}
