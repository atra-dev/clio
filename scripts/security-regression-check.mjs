import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

function filePath(relativePath) {
  return path.join(ROOT, relativePath);
}

async function read(relativePath) {
  return await fs.readFile(filePath(relativePath), "utf8");
}

function expectContains(source, text, message, failures) {
  if (!source.includes(text)) {
    failures.push(message);
  }
}

function expectNotContains(source, text, message, failures) {
  if (source.includes(text)) {
    failures.push(message);
  }
}

function expectRegex(source, regex, message, failures) {
  if (!regex.test(source)) {
    failures.push(message);
  }
}

function extractSetBlock(source, setName) {
  const regex = new RegExp(`const\\s+${setName}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\);`, "m");
  const match = source.match(regex);
  return match ? match[1] : "";
}

async function main() {
  const failures = [];

  const userAccounts = await read("src/lib/user-accounts.js");
  expectContains(
    userAccounts,
    "throwFirestoreOperationFailed",
    "user-accounts should fail closed on Firestore operation failures.",
    failures,
  );
  expectNotContains(
    userAccounts,
    "return await listUserAccountsFromFile();\n    } catch",
    "user-accounts should not fall back to file store inside Firestore catch blocks.",
    failures,
  );

  const attendanceRoute = await read("src/app/api/hris/attendance/route.js");
  const attendanceRecordRoute = await read("src/app/api/hris/attendance/[recordId]/route.js");
  const attendanceFieldsList = extractSetBlock(attendanceRoute, "SELF_EDITABLE_ATTENDANCE_FIELDS");
  const attendanceFieldsRecord = extractSetBlock(attendanceRecordRoute, "SELF_EDITABLE_ATTENDANCE_FIELDS");
  expectNotContains(
    attendanceFieldsList,
    '"status",',
    "attendance self-editable fields should not include status in list route.",
    failures,
  );
  expectNotContains(
    attendanceFieldsRecord,
    '"status",',
    "attendance self-editable fields should not include status in record route.",
    failures,
  );

  const firestoreRules = await read("firestore.rules");
  expectContains(
    firestoreRules,
    "attendanceEditableSelfFieldsOnly",
    "firestore.rules must enforce attendance self-update field allowlist.",
    failures,
  );
  expectContains(
    firestoreRules,
    "notificationDecisionImmutable",
    "firestore.rules must enforce immutable device verification decisions.",
    failures,
  );

  const documentAccessRoute = await read("src/app/api/hris/employees/[recordId]/documents/access/route.js");
  expectContains(
    documentAccessRoute,
    "resolveSecureEmployeeDocumentUrl",
    "employee document access endpoint must validate and resolve secure URLs.",
    failures,
  );

  const employeeRecordsModule = await read("src/components/hris/modules/EmployeeRecordsModule.jsx");
  const templateRepositoryModule = await read("src/components/hris/modules/DocumentTemplateRepositoryModule.jsx");
  expectRegex(
    employeeRecordsModule,
    /hrisApi\.employees\s*\.logDocumentAccess[\s\S]*window\.open\(/,
    "employee records UI should request server-authorized document access before opening links.",
    failures,
  );
  expectRegex(
    templateRepositoryModule,
    /hrisApi\.employees\s*\.logDocumentAccess[\s\S]*window\.open\(/,
    "document repository UI should request server-authorized document access before opening links.",
    failures,
  );

  const proxyFile = await read("src/proxy.js");
  const nextConfig = await read("next.config.mjs");
  expectContains(proxyFile, "buildCspHeader", "proxy must build CSP with nonce.", failures);
  expectContains(proxyFile, "x-nonce", "proxy must propagate CSP nonce header.", failures);
  expectNotContains(
    nextConfig,
    'key: "Content-Security-Policy"',
    "CSP should be generated in proxy (nonce-based), not static in next.config.",
    failures,
  );

  if (failures.length > 0) {
    console.error("Security regression checks failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Security regression checks passed.");
}

main().catch((error) => {
  console.error("Security regression checks failed to run.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
