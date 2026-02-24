import { readdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = process.cwd();
const STATIC_TARGETS = [".next", ".next-check", ".next-clio"];
const DYNAMIC_PREFIXES = [".next-clio-run-"];

async function isDirectory(pathname) {
  try {
    const details = await stat(pathname);
    return details.isDirectory();
  } catch {
    return false;
  }
}

async function resolveDynamicTargets() {
  try {
    const entries = await readdir(ROOT, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => DYNAMIC_PREFIXES.some((prefix) => name.startsWith(prefix)));
  } catch {
    return [];
  }
}

async function removeTarget(name) {
  const targetPath = resolve(ROOT, name);
  const exists = await isDirectory(targetPath);
  if (!exists) {
    return { name, removed: false, skipped: true, reason: "not_found" };
  }

  try {
    await rm(targetPath, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 250,
    });
    return { name, removed: true, skipped: false };
  } catch (error) {
    return {
      name,
      removed: false,
      skipped: false,
      reason: error?.code || "remove_failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const dynamicTargets = await resolveDynamicTargets();
  const targets = Array.from(new Set([...STATIC_TARGETS, ...dynamicTargets]));

  const results = [];
  for (const target of targets) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await removeTarget(target));
  }

  const removed = results.filter((item) => item.removed).map((item) => item.name);
  const failed = results.filter((item) => !item.removed && !item.skipped);

  if (removed.length > 0) {
    console.log(`[clean] Removed: ${removed.join(", ")}`);
  } else {
    console.log("[clean] No build artifact directories found.");
  }

  if (failed.length > 0) {
    for (const entry of failed) {
      console.error(`[clean] Failed to remove "${entry.name}": ${entry.reason} ${entry.message || ""}`.trim());
    }
    console.error(
      "[clean] If running on Windows and files are locked, close dev servers/processes first. " +
        "If ACL denies delete, run PowerShell as Admin and execute: icacls . /remove:d Everyone",
    );
    process.exitCode = 1;
  }
}

main();
