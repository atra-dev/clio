#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function escapePrivateKey(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\n/g, "\\n");
}

function upsertEnvLine(content, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }
  const suffix = content.endsWith("\n") ? "" : "\n";
  return `${content}${suffix}${line}\n`;
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    fail("Usage: node scripts/apply-firebase-admin-env.js <path-to-service-account.json>");
  }

  const absoluteInput = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(absoluteInput)) {
    fail(`File not found: ${absoluteInput}`);
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(absoluteInput, "utf8"));
  } catch (error) {
    fail(`Invalid JSON: ${error.message}`);
  }

  const projectId = String(payload.project_id || "").trim();
  const clientEmail = String(payload.client_email || "").trim();
  const privateKey = String(payload.private_key || "");

  if (!projectId || !clientEmail || !privateKey) {
    fail("JSON must include project_id, client_email, and private_key.");
  }

  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    fail(`Missing .env.local at: ${envPath}`);
  }

  let envContent = fs.readFileSync(envPath, "utf8");
  envContent = upsertEnvLine(envContent, "FIREBASE_ADMIN_PROJECT_ID", projectId);
  envContent = upsertEnvLine(envContent, "FIREBASE_ADMIN_CLIENT_EMAIL", clientEmail);
  envContent = upsertEnvLine(envContent, "FIREBASE_ADMIN_PRIVATE_KEY", escapePrivateKey(privateKey));
  envContent = upsertEnvLine(envContent, "CLIO_REQUIRE_FIREBASE_CUSTOM_CLAIMS", "true");

  fs.writeFileSync(envPath, envContent, "utf8");
  console.log("Updated .env.local with FIREBASE_ADMIN_* and CLIO_REQUIRE_FIREBASE_CUSTOM_CLAIMS=true");
}

main();
