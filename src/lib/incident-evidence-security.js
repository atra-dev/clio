const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_ALLOWED_EXTENSIONS = new Set(["pdf", "png", "jpg", "jpeg", "webp", "doc", "docx", "xls", "xlsx", "csv", "txt"]);
const DEFAULT_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
]);

function asString(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value, fallback = null) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return fallback;
}

function normalizeText(value) {
  return asString(value).toLowerCase();
}

function parseBooleanEnv(name, fallbackValue = false) {
  const normalized = normalizeText(process.env[name]);
  if (!normalized) {
    return fallbackValue;
  }
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function parseIntegerEnv(name, fallbackValue, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(asString(process.env[name]), 10);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }
  return Math.min(max, Math.max(min, parsed));
}

function parseCsvSetEnv(name, fallbackSet) {
  const raw = asString(process.env[name]);
  if (!raw) {
    return new Set([...fallbackSet]);
  }
  const values = raw
    .split(",")
    .map((item) => normalizeText(item))
    .filter(Boolean);
  return values.length > 0 ? new Set(values) : new Set([...fallbackSet]);
}

function normalizeEmail(value) {
  return asString(value).toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function getFileExtensionFromText(value) {
  const input = asString(value).toLowerCase();
  if (!input) {
    return "";
  }
  const clean = input.split("?")[0].split("#")[0];
  const token = clean.split(".").pop() || "";
  if (!/^[a-z0-9]{2,10}$/.test(token)) {
    return "";
  }
  return token;
}

function inferMimeTypeFromExtension(extension) {
  const ext = normalizeText(extension);
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "doc") return "application/msword";
  if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "xls") return "application/vnd.ms-excel";
  if (ext === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === "csv") return "text/csv";
  if (ext === "txt") return "text/plain";
  return "";
}

function normalizeEvidenceType(value) {
  const normalized = asString(value, "Incident Evidence");
  return normalized.slice(0, 80);
}

function getValidationConfig() {
  return {
    maxBytes: parseIntegerEnv("CLIO_INCIDENT_EVIDENCE_MAX_BYTES", DEFAULT_MAX_BYTES, {
      min: 128 * 1024,
      max: 50 * 1024 * 1024,
    }),
    allowedExtensions: parseCsvSetEnv("CLIO_INCIDENT_EVIDENCE_ALLOWED_EXTENSIONS", DEFAULT_ALLOWED_EXTENSIONS),
    allowedMimeTypes: parseCsvSetEnv("CLIO_INCIDENT_EVIDENCE_ALLOWED_MIME_TYPES", DEFAULT_ALLOWED_MIME_TYPES),
    requireMimeType: parseBooleanEnv("CLIO_INCIDENT_EVIDENCE_REQUIRE_MIME_TYPE", true),
    avHookUrl: asString(process.env.CLIO_INCIDENT_EVIDENCE_AV_HOOK_URL),
    avHookToken: asString(process.env.CLIO_INCIDENT_EVIDENCE_AV_HOOK_TOKEN),
    avRequired: parseBooleanEnv("CLIO_INCIDENT_EVIDENCE_AV_REQUIRED", false),
    avFailOpen: parseBooleanEnv("CLIO_INCIDENT_EVIDENCE_AV_FAIL_OPEN", false),
    avTimeoutMs: parseIntegerEnv("CLIO_INCIDENT_EVIDENCE_AV_TIMEOUT_MS", 5000, {
      min: 1000,
      max: 20000,
    }),
  };
}

function normalizeEvidenceRecord(entry, index, actorEmail, config) {
  const source = asObject(entry);
  if (!source) {
    throw new Error("invalid_incident_evidence_payload");
  }

  const name = asString(source.name);
  if (!name) {
    throw new Error("invalid_incident_evidence_name");
  }

  const ref = asString(source.ref);
  const storagePath = asString(source.storagePath);
  if (!ref && !storagePath) {
    throw new Error("invalid_incident_evidence_reference");
  }

  const fileExtension =
    getFileExtensionFromText(source.fileExtension) ||
    getFileExtensionFromText(name) ||
    getFileExtensionFromText(storagePath) ||
    getFileExtensionFromText(ref);
  if (!fileExtension || !config.allowedExtensions.has(fileExtension)) {
    throw new Error("invalid_incident_evidence_extension");
  }

  const normalizedContentType = normalizeText(source.contentType) || inferMimeTypeFromExtension(fileExtension);
  if (!normalizedContentType || !config.allowedMimeTypes.has(normalizedContentType)) {
    throw new Error("invalid_incident_evidence_content_type");
  }

  if (config.requireMimeType && !asString(source.contentType)) {
    throw new Error("invalid_incident_evidence_content_type");
  }

  const rawSize = Number(source.sizeBytes);
  if (!Number.isFinite(rawSize) || rawSize <= 0 || rawSize > config.maxBytes) {
    throw new Error("invalid_incident_evidence_size");
  }

  const uploadedAt = asString(source.uploadedAt, nowIso());
  const uploadedBy = normalizeEmail(source.uploadedBy || actorEmail);
  const id = asString(source.id || source.recordId, `incident-evidence-${Date.now()}-${index + 1}`);

  return {
    id,
    name: name.slice(0, 180),
    type: normalizeEvidenceType(source.type),
    ref,
    storagePath,
    fileExtension,
    contentType: normalizedContentType,
    sizeBytes: Math.round(rawSize),
    uploadedAt,
    uploadedBy: uploadedBy || normalizeEmail(actorEmail) || "system@gmail.com",
    scanStatus: asString(source.scanStatus),
    scanReference: asString(source.scanReference),
  };
}

async function runEvidenceAvHook(records, actorEmail, config) {
  if (!config.avHookUrl) {
    if (config.avRequired) {
      throw new Error("incident_evidence_av_not_configured");
    }
    return {
      status: "skipped",
      provider: "none",
      blockedIds: [],
      reference: "",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.avTimeoutMs);
  try {
    const headers = {
      "Content-Type": "application/json",
      "X-CLIO-Source": "incident-evidence-validation",
    };
    if (config.avHookToken) {
      headers.Authorization = `Bearer ${config.avHookToken}`;
    }

    const response = await fetch(config.avHookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        generatedAt: nowIso(),
        actorEmail: normalizeEmail(actorEmail),
        records: records.map((record) => ({
          id: record.id,
          name: record.name,
          storagePath: record.storagePath,
          ref: record.ref,
          contentType: record.contentType,
          fileExtension: record.fileExtension,
          sizeBytes: record.sizeBytes,
        })),
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(asString(payload?.message, "incident_evidence_av_hook_failed"));
    }

    const blockedIds = asArray(payload?.blockedIds)
      .map((item) => asString(item))
      .filter(Boolean);
    const blocked = payload?.allowed === false || payload?.blocked === true || blockedIds.length > 0;
    if (blocked) {
      throw new Error("incident_evidence_av_blocked");
    }

    return {
      status: "passed",
      provider: "hook",
      blockedIds: [],
      reference: asString(payload?.scanId || payload?.reference || ""),
    };
  } catch (error) {
    if (config.avFailOpen && !config.avRequired) {
      return {
        status: "failed-open",
        provider: "hook",
        blockedIds: [],
        reference: "",
      };
    }
    const reason = error instanceof Error ? asString(error.message) : "";
    if (reason === "incident_evidence_av_blocked") {
      throw error;
    }
    throw new Error("incident_evidence_av_hook_failed");
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateIncidentEvidenceDocumentsStrict(records, { actorEmail } = {}) {
  if (!Array.isArray(records)) {
    throw new Error("invalid_incident_evidence_payload");
  }

  const config = getValidationConfig();
  const normalizedRecords = records.map((entry, index) =>
    normalizeEvidenceRecord(entry, index, actorEmail, config),
  );

  const avResult = await runEvidenceAvHook(normalizedRecords, actorEmail, config);
  const scannedAt = nowIso();
  return normalizedRecords.map((record) => ({
    ...record,
    scanStatus: record.scanStatus || avResult.status,
    scanReference: record.scanReference || avResult.reference,
    scannedAt,
  }));
}
