const GLOBAL_BUCKET_KEY = "__clio_rate_limit_buckets__";
const MAX_BUCKETS = 5000;

function getBuckets() {
  if (!globalThis[GLOBAL_BUCKET_KEY]) {
    globalThis[GLOBAL_BUCKET_KEY] = new Map();
  }
  return globalThis[GLOBAL_BUCKET_KEY];
}

function nowMs() {
  return Date.now();
}

function cleanupExpiredBuckets(buckets, currentMs) {
  if (buckets.size <= MAX_BUCKETS) {
    return;
  }

  for (const [key, value] of buckets.entries()) {
    if (!value || currentMs >= value.resetAt) {
      buckets.delete(key);
    }
  }

  if (buckets.size <= MAX_BUCKETS) {
    return;
  }

  let removeCount = buckets.size - MAX_BUCKETS;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    removeCount -= 1;
    if (removeCount <= 0) {
      break;
    }
  }
}

function normalizeIdentifier(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function getRequestSourceIp(request) {
  if (!request || !request.headers) {
    return "unknown";
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const candidates = ["x-real-ip", "cf-connecting-ip", "x-vercel-forwarded-for"];
  for (const headerName of candidates) {
    const value = String(request.headers.get(headerName) || "").trim();
    if (value) {
      return value;
    }
  }

  return "unknown";
}

export function consumeRateLimit({
  scope,
  identifier,
  limit = 20,
  windowMs = 5 * 60 * 1000,
}) {
  const safeScope = String(scope || "default")
    .trim()
    .toLowerCase();
  const safeIdentifier = normalizeIdentifier(identifier) || "unknown";
  const safeLimit = Math.max(1, Number.parseInt(String(limit), 10) || 1);
  const safeWindowMs = Math.max(1000, Number.parseInt(String(windowMs), 10) || 1000);

  const buckets = getBuckets();
  const currentMs = nowMs();
  cleanupExpiredBuckets(buckets, currentMs);

  const key = `${safeScope}:${safeIdentifier}`;
  const existing = buckets.get(key);

  let bucket = existing;
  if (!bucket || currentMs >= bucket.resetAt) {
    bucket = {
      count: 0,
      resetAt: currentMs + safeWindowMs,
    };
  }

  bucket.count += 1;
  buckets.set(key, bucket);

  const remaining = Math.max(0, safeLimit - bucket.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - currentMs) / 1000));
  const allowed = bucket.count <= safeLimit;

  return {
    allowed,
    key,
    remaining,
    retryAfterSeconds,
    resetAt: bucket.resetAt,
    headers: {
      "Retry-After": String(retryAfterSeconds),
      "X-RateLimit-Limit": String(safeLimit),
      "X-RateLimit-Remaining": String(remaining),
      "X-RateLimit-Reset": String(Math.floor(bucket.resetAt / 1000)),
    },
  };
}

export function enforceRateLimitByRequest({
  request,
  scope,
  identifier,
  limit,
  windowMs,
}) {
  const resolvedIdentifier = normalizeIdentifier(identifier) || getRequestSourceIp(request);
  return consumeRateLimit({
    scope,
    identifier: resolvedIdentifier,
    limit,
    windowMs,
  });
}
