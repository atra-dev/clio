function asString(value) {
  return String(value || "").trim();
}

function parseCsv(value) {
  return asString(value)
    .split(",")
    .map((entry) => asString(entry).toLowerCase())
    .filter(Boolean);
}

function decodeUrlComponentSafely(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function normalizeStoragePath(value) {
  const normalized = asString(value).replace(/^\/+/, "");
  if (!normalized) {
    return "";
  }
  if (normalized.includes("..") || normalized.includes("\\")) {
    return "";
  }
  return normalized;
}

function resolveAllowedDocumentHosts() {
  const configured = parseCsv(process.env.CLIO_DOCUMENT_ALLOWED_HOSTS);
  if (configured.length > 0) {
    return configured;
  }

  return [
    "firebasestorage.googleapis.com",
    "storage.googleapis.com",
    "firebasestorage.app",
  ];
}

function resolveAllowedDocumentPathPrefixes() {
  const configured = parseCsv(process.env.CLIO_DOCUMENT_ALLOWED_PATH_PREFIXES);
  if (configured.length > 0) {
    return configured.map((prefix) => prefix.replace(/^\/+/, ""));
  }
  return ["clio/employee-documents/"];
}

function isAllowedHost(hostname, allowedHosts) {
  const host = asString(hostname).toLowerCase();
  if (!host) {
    return false;
  }

  return allowedHosts.some((rule) => {
    const candidate = asString(rule).toLowerCase();
    if (!candidate) {
      return false;
    }
    if (candidate.startsWith("*.")) {
      const suffix = candidate.slice(1);
      return host.endsWith(suffix);
    }
    return host === candidate;
  });
}

function isAllowedPath(path, allowedPrefixes) {
  const normalizedPath = normalizeStoragePath(path).toLowerCase();
  if (!normalizedPath) {
    return false;
  }
  return allowedPrefixes.some((prefix) => normalizedPath.startsWith(String(prefix || "").toLowerCase()));
}

function extractStoragePathFromFirebaseDownloadUrl(parsedUrl) {
  const pathname = asString(parsedUrl.pathname);
  const host = asString(parsedUrl.hostname).toLowerCase();
  if (!pathname || !host) {
    return "";
  }

  if (host === "firebasestorage.googleapis.com") {
    const marker = "/o/";
    const index = pathname.indexOf(marker);
    if (index < 0) {
      return "";
    }
    const encodedObjectPath = pathname.slice(index + marker.length);
    return normalizeStoragePath(decodeUrlComponentSafely(encodedObjectPath));
  }

  if (host === "storage.googleapis.com") {
    if (pathname.startsWith("/download/storage/v1/b/")) {
      const marker = "/o/";
      const index = pathname.indexOf(marker);
      if (index >= 0) {
        return normalizeStoragePath(decodeUrlComponentSafely(pathname.slice(index + marker.length)));
      }
      return "";
    }

    const segments = pathname
      .split("/")
      .map((segment) => asString(segment))
      .filter(Boolean);
    if (segments.length < 2) {
      return "";
    }
    return normalizeStoragePath(decodeUrlComponentSafely(segments.slice(1).join("/")));
  }

  return "";
}

function hasSignedAccessToken(parsedUrl) {
  const token = asString(parsedUrl.searchParams.get("token"));
  const googleSignature = asString(parsedUrl.searchParams.get("X-Goog-Signature"));
  const googleAlgorithm = asString(parsedUrl.searchParams.get("X-Goog-Algorithm"));
  const legacyGoogleAccessId = asString(parsedUrl.searchParams.get("GoogleAccessId"));
  const legacyExpires = asString(parsedUrl.searchParams.get("Expires"));
  return Boolean(token || (googleSignature && googleAlgorithm) || (legacyGoogleAccessId && legacyExpires));
}

export function resolveSecureEmployeeDocumentUrl({ storagePath, ref }) {
  const allowedHosts = resolveAllowedDocumentHosts();
  const allowedPrefixes = resolveAllowedDocumentPathPrefixes();

  const normalizedStoragePath = normalizeStoragePath(storagePath);
  if (normalizedStoragePath && !isAllowedPath(normalizedStoragePath, allowedPrefixes)) {
    throw new Error("document_storage_path_not_allowed");
  }

  const rawRef = asString(ref);
  if (!rawRef) {
    throw new Error("document_reference_missing");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawRef);
  } catch {
    throw new Error("document_reference_invalid");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("document_reference_invalid");
  }

  if (!isAllowedHost(parsedUrl.hostname, allowedHosts)) {
    throw new Error("document_reference_host_not_allowed");
  }

  const extractedPath = extractStoragePathFromFirebaseDownloadUrl(parsedUrl);
  const effectiveStoragePath = normalizeStoragePath(normalizedStoragePath || extractedPath);
  if (!effectiveStoragePath || !isAllowedPath(effectiveStoragePath, allowedPrefixes)) {
    throw new Error("document_storage_path_not_allowed");
  }

  if (normalizedStoragePath && extractedPath && normalizedStoragePath !== extractedPath) {
    throw new Error("document_reference_path_mismatch");
  }

  if (!hasSignedAccessToken(parsedUrl)) {
    throw new Error("document_reference_unsigned");
  }

  return parsedUrl.toString();
}
