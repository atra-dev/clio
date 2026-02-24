function normalizeNamePart(value) {
  return String(value ?? "").trim();
}

function capitalizeWord(word) {
  const value = normalizeNamePart(word).toLowerCase();
  if (!value) {
    return "";
  }
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

export function formatNameFromEmail(email, { fallbackLabel = "User", maxTokens = 3 } = {}) {
  const normalizedEmail = normalizeNamePart(email).toLowerCase();
  const safeFallback = normalizeNamePart(fallbackLabel) || "User";
  if (!normalizedEmail.includes("@")) {
    return safeFallback;
  }

  const localPart = normalizedEmail.split("@")[0] || "";
  const tokens = localPart
    .split(/[._-]+/g)
    .map((item) => capitalizeWord(item))
    .filter(Boolean)
    .slice(0, Math.max(1, Number.isFinite(maxTokens) ? maxTokens : 3));

  if (tokens.length === 0) {
    return safeFallback;
  }

  return tokens.join(" ");
}

function formatNameBody({ firstName, middleName, lastName, order }) {
  const normalizedFirstName = normalizeNamePart(firstName);
  const normalizedMiddleName = normalizeNamePart(middleName);
  const normalizedLastName = normalizeNamePart(lastName);

  if (order === "last-first") {
    const firstBlock = [normalizedFirstName, normalizedMiddleName].filter(Boolean).join(" ");
    if (normalizedLastName) {
      return `${normalizedLastName}${firstBlock ? `, ${firstBlock}` : ""}`;
    }
    return firstBlock;
  }

  return [normalizedFirstName, normalizedMiddleName, normalizedLastName].filter(Boolean).join(" ");
}

function resolveFallbackName({ fallback, fallbackEmail, fallbackLabel }) {
  const directFallback = normalizeNamePart(fallback);
  if (directFallback) {
    return directFallback;
  }

  const email = normalizeNamePart(fallbackEmail);
  if (email) {
    return formatNameFromEmail(email, { fallbackLabel });
  }

  return normalizeNamePart(fallbackLabel) || "User";
}

export function formatPersonName({
  firstName,
  middleName,
  lastName,
  suffix,
  fallback = "",
  fallbackEmail = "",
  fallbackLabel = "User",
} = {}) {
  const body = formatNameBody({
    firstName,
    middleName,
    lastName,
    order: "first-last",
  });
  const normalizedSuffix = normalizeNamePart(suffix);
  const fullName = [body, normalizedSuffix].filter(Boolean).join(" ").trim();
  if (fullName) {
    return fullName;
  }

  return resolveFallbackName({
    fallback,
    fallbackEmail,
    fallbackLabel,
  });
}

export function formatEmployeeName({
  firstName,
  middleName,
  lastName,
  suffix,
  fallback = "",
  fallbackEmail = "",
  fallbackLabel = "Employee",
} = {}) {
  const body = formatNameBody({
    firstName,
    middleName,
    lastName,
    order: "last-first",
  });
  const normalizedSuffix = normalizeNamePart(suffix);
  const fullName = [body, normalizedSuffix].filter(Boolean).join(" ").trim();
  if (fullName) {
    return fullName;
  }

  return resolveFallbackName({
    fallback,
    fallbackEmail,
    fallbackLabel,
  });
}
