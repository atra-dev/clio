function envValue(name) {
  return String(process.env[name] || "").trim();
}

function getFirebaseApiKey() {
  return envValue("NEXT_PUBLIC_FIREBASE_API_KEY");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function parseLookupError(payload) {
  const code = String(payload?.error?.message || "").trim();
  if (code === "INVALID_ID_TOKEN" || code === "TOKEN_EXPIRED") {
    return "invalid_id_token";
  }
  if (code === "USER_NOT_FOUND") {
    return "firebase_user_not_found";
  }
  return "identity_lookup_failed";
}

export async function verifyFirebaseIdToken(idToken) {
  const normalizedToken = String(idToken || "").trim();
  if (!normalizedToken) {
    throw new Error("missing_id_token");
  }

  const apiKey = getFirebaseApiKey();
  if (!apiKey) {
    throw new Error("firebase_api_key_not_configured");
  }

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idToken: normalizedToken,
    }),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(parseLookupError(payload));
  }

  const user = Array.isArray(payload?.users) ? payload.users[0] : null;
  if (!user) {
    throw new Error("firebase_user_not_found");
  }

  const email = normalizeEmail(user.email);
  if (!email) {
    throw new Error("firebase_user_missing_email");
  }

  const providerIds = Array.isArray(user.providerUserInfo)
    ? user.providerUserInfo
        .map((item) => String(item?.providerId || "").trim())
        .filter(Boolean)
    : [];

  const phoneNumber = String(user.phoneNumber || "").trim();
  const mfaFactors = Array.isArray(user.mfaInfo)
    ? user.mfaInfo
        .map((factor) => {
          const phone = String(factor?.phoneInfo || "").trim();
          const normalizedFactorId = String(factor?.factorId || "").trim();
          const factorId = normalizedFactorId || (phone ? "phone" : "");
          const factorUid = String(factor?.mfaEnrollmentId || "").trim();
          return {
            factorId,
            factorUid,
            phoneNumber: phone,
          };
        })
        .filter((factor) => Boolean(factor.factorId) || Boolean(factor.phoneNumber))
    : [];
  const hasMfaEnrollment = mfaFactors.length > 0;
  const hasSmsMfaEnrollment = mfaFactors.some(
    (factor) => (factor.factorId === "phone" || !factor.factorId) && Boolean(factor.phoneNumber),
  );

  return {
    uid: String(user.localId || "").trim(),
    email,
    emailVerified: user.emailVerified === true,
    providerIds,
    phoneNumber,
    mfaFactors,
    hasMfaEnrollment,
    hasSmsMfaEnrollment,
  };
}
