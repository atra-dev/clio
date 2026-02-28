"use client";

import { useEffect, useRef, useState } from "react";
import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  getRedirectResult,
  linkWithPhoneNumber,
  onAuthStateChanged,
  reauthenticateWithPhoneNumber,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import { getFirebaseClientAuth } from "@/lib/firebase-client-auth";

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

export default function LoginCard() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isVerifyingAccess, setIsVerifyingAccess] = useState(false);
  const [useVisibleRecaptcha, setUseVisibleRecaptcha] = useState(false);
  const [otpCooldownSecondsLeft, setOtpCooldownSecondsLeft] = useState(0);
  const finalizingLoginRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [mfaState, setMfaState] = useState({
    challengeToken: "",
    challengeExpiresAt: "",
    phoneNumber: "",
    otpCode: "",
    otpRequestedAt: "",
  });
  const [pendingFirebaseUser, setPendingFirebaseUser] = useState(null);
  const confirmationResultRef = useRef(null);
  const recaptchaVerifierRef = useRef(null);
  const recaptchaCreationPromiseRef = useRef(null);
  const sendOtpInFlightRef = useRef(false);
  const recaptchaContainerIdRef = useRef(`clio-login-sms-recaptcha-${Math.random().toString(36).slice(2, 10)}`);
  const lastAutoSendChallengeRef = useRef("");
  const lastAutoVerifyCodeRef = useRef("");
  const otpInputRefs = useRef([]);
  const REDIRECT_PENDING_KEY = "clio_google_redirect_pending";
  const REDIRECT_USER_WAIT_TIMEOUT_MS = 15000;
  const OTP_AUTO_SEND_GUARD_WINDOW_MS = 120000;

  const startOtpCooldown = (seconds = 90) => {
    const next = Number.isFinite(seconds) ? Math.max(1, Math.trunc(seconds)) : 90;
    setOtpCooldownSecondsLeft(next);
  };

  const setRedirectPending = () => {
    if (typeof window === "undefined") {
      return;
    }
    window.sessionStorage.setItem(REDIRECT_PENDING_KEY, "1");
  };

  const clearRedirectPending = () => {
    if (typeof window === "undefined") {
      return;
    }
    window.sessionStorage.removeItem(REDIRECT_PENDING_KEY);
  };

  const hasRedirectPending = () => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.sessionStorage.getItem(REDIRECT_PENDING_KEY) === "1";
  };

  const buildOtpAutoSendGuardKey = (challengeToken, userId = "") => {
    const normalizedUserId = String(userId || "").trim();
    if (normalizedUserId) {
      return `clio_sms_otp_autosend_guard:user:${normalizedUserId}`;
    }
    return `clio_sms_otp_autosend_guard:challenge:${String(challengeToken || "").trim()}`;
  };

  const markOtpAutoSendGuard = (challengeToken, userId = "") => {
    if (typeof window === "undefined") {
      return;
    }
    const normalized = String(challengeToken || "").trim();
    if (!normalized) {
      return;
    }
    window.sessionStorage.setItem(buildOtpAutoSendGuardKey(normalized, userId), String(Date.now()));
  };

  const shouldSkipOtpAutoSend = (challengeToken, userId = "") => {
    if (typeof window === "undefined") {
      return false;
    }
    const normalized = String(challengeToken || "").trim();
    if (!normalized) {
      return false;
    }
    const key = buildOtpAutoSendGuardKey(normalized, userId);
    const raw = window.sessionStorage.getItem(key);
    const sentAt = Number(raw);
    if (!Number.isFinite(sentAt) || sentAt <= 0) {
      if (raw) {
        window.sessionStorage.removeItem(key);
      }
      return false;
    }
    const elapsed = Date.now() - sentAt;
    if (elapsed >= OTP_AUTO_SEND_GUARD_WINDOW_MS) {
      window.sessionStorage.removeItem(key);
      return false;
    }
    return true;
  };

  const waitForSignedInUser = async (auth, timeoutMs = 5000) => {
    if (auth.currentUser) {
      return auth.currentUser;
    }

    return await new Promise((resolve) => {
      let settled = false;
      let unsubscribe = () => {};

      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        unsubscribe();
        resolve(value || null);
      };

      const timeout = window.setTimeout(() => {
        finish(null);
      }, timeoutMs);

      unsubscribe = onAuthStateChanged(auth, (user) => {
        if (!user) {
          return;
        }
        window.clearTimeout(timeout);
        finish(user);
      });
    });
  };

  const buildGoogleProvider = () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: "select_account",
    });
    return provider;
  };

  const mapLoginError = (error) => {
    if (error?.code === "sms_mfa_required") {
      return "SMS authentication is required before login.";
    }

    const rawCode = String(error?.code || "").trim();
    const rawMessage = String(error?.message || "").trim();

    if (rawCode === "email_not_verified") {
      return "Google account email must be verified.";
    }
    if (rawCode === "provider_not_allowed") {
      return "Only Google sign-in is allowed for this workspace.";
    }
    if (rawCode === "role_not_provisioned") {
      return "Account is not provisioned for this workspace.";
    }
    if (rawCode === "account_disabled") {
      return "Account is disabled. Please contact Super Admin.";
    }
    if (rawCode === "invite_email_verification_required") {
      return "Complete invite verification first before login.";
    }
    if (rawCode === "account_inactive") {
      return "Account is not active yet. Please contact Super Admin.";
    }
    if (rawCode === "sms_mfa_setup_unavailable") {
      return "SMS authentication setup is temporarily unavailable. Please retry sign-in.";
    }
    if (rawCode === "firebase_phone_not_verified") {
      return "Phone verification is not complete. Finish OTP verification first.";
    }

    if (rawCode === "auth/unauthorized-domain") {
      return "Current domain is not authorized in Firebase Authentication settings.";
    }
    if (rawCode === "auth/invalid-api-key") {
      return "Firebase API key is invalid. Check NEXT_PUBLIC_FIREBASE_API_KEY in .env.local.";
    }
    if (rawCode === "auth/internal-error") {
      return "Authentication flow was interrupted. Click Continue with Google again.";
    }
    if (rawCode === "auth/invalid-app-credential") {
      return "SMS authentication setup failed. Check Firebase Phone provider setup and Authorized domains.";
    }
    if (rawCode === "auth/operation-not-allowed") {
      return "Firebase Phone authentication is disabled. Enable it in Firebase Authentication > Sign-in method.";
    }
    if (rawCode === "auth/invalid-phone-number") {
      return "Phone number is invalid. Use international format (e.g. +639171234567).";
    }
    if (rawCode === "auth/too-many-requests") {
      return "Too many OTP attempts. Please wait before retrying.";
    }
    if (rawCode === "auth/code-expired") {
      return "OTP has expired. Request a new code.";
    }
    if (rawCode === "auth/invalid-verification-code") {
      return "OTP is invalid. Check the code and try again.";
    }
    if (rawCode === "auth/provider-already-linked") {
      return "Phone number is already linked. Continue verification.";
    }
    if (rawCode === "auth/captcha-check-failed") {
      return "Captcha validation failed. Retry and complete captcha challenge.";
    }
    if (rawMessage.toLowerCase().includes("recaptcha has already been rendered")) {
      return "Security challenge is refreshing. Please retry OTP in a few seconds.";
    }
    if (rawMessage.startsWith("firebase_client_not_configured")) {
      return "Firebase client is not configured. Set NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID, and NEXT_PUBLIC_FIREBASE_APP_ID, then restart npm run dev.";
    }
    return error?.message || "Unable to complete Google sign-in.";
  };

  const disposeRecaptchaVerifier = () => {
    recaptchaCreationPromiseRef.current = null;
    if (recaptchaVerifierRef.current) {
      try {
        recaptchaVerifierRef.current.clear();
      } catch {}
      recaptchaVerifierRef.current = null;
    }

    if (typeof document !== "undefined") {
      const container = document.getElementById(recaptchaContainerIdRef.current);
      if (container) {
        container.innerHTML = "";
      }
    }
  };

  const getOrCreateRecaptchaVerifier = async (auth) => {
    if (recaptchaVerifierRef.current) {
      return recaptchaVerifierRef.current;
    }

    if (recaptchaCreationPromiseRef.current) {
      return await recaptchaCreationPromiseRef.current;
    }

    if (typeof window === "undefined") {
      throw new Error("captcha_not_ready");
    }

    const container = document.getElementById(recaptchaContainerIdRef.current);
    if (!container) {
      throw new Error("captcha_not_ready");
    }

    recaptchaCreationPromiseRef.current = (async () => {
      // Ensure the host element is clean before creating a new verifier instance.
      container.innerHTML = "";
      const verifier = new RecaptchaVerifier(auth, recaptchaContainerIdRef.current, {
        size: useVisibleRecaptcha ? "normal" : "invisible",
      });
      await verifier.render();
      recaptchaVerifierRef.current = verifier;
      return verifier;
    })();

    try {
      return await recaptchaCreationPromiseRef.current;
    } catch (error) {
      try {
        container.innerHTML = "";
      } catch {}
      recaptchaVerifierRef.current = null;
      throw error;
    } finally {
      recaptchaCreationPromiseRef.current = null;
    }
  };

  const resetMfaState = () => {
    setMfaState({
      challengeToken: "",
      challengeExpiresAt: "",
      phoneNumber: "",
      otpCode: "",
      otpRequestedAt: "",
    });
    sendOtpInFlightRef.current = false;
    setUseVisibleRecaptcha(false);
    setPendingFirebaseUser(null);
    setInfoMessage("");
    confirmationResultRef.current = null;
    lastAutoSendChallengeRef.current = "";
    lastAutoVerifyCodeRef.current = "";
    disposeRecaptchaVerifier();
  };

  useEffect(() => {
    if (otpCooldownSecondsLeft <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setOtpCooldownSecondsLeft((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [otpCooldownSecondsLeft]);

  const completeWorkspaceLogin = async (auth, firebaseUser) => {
    const idToken = await firebaseUser.getIdToken(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 20000);

    let response;
    try {
      response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idToken,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("Login verification timed out. Please retry sign-in.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }

    const payload = await response.json().catch(() => ({}));
    if (payload?.reason === "sms_mfa_required") {
      const smsError = new Error(payload.message || "SMS authentication is required before login.");
      smsError.code = "sms_mfa_required";
      smsError.challengeToken = String(payload?.challengeToken || "");
      smsError.challengeExpiresAt = String(payload?.challengeExpiresAt || "");
      smsError.firebaseUser = firebaseUser;
      throw smsError;
    }

    if (!response.ok) {
      await signOut(auth).catch(() => {});
      const loginError = new Error(payload.message || "Unable to log in.");
      loginError.code = String(payload?.reason || `http_${response.status}` || "").trim();
      throw loginError;
    }
  };

  const activateSmsEnrollment = (error, fallbackUser = null) => {
    if (error?.code !== "sms_mfa_required") {
      return false;
    }

    const challengeToken = String(error?.challengeToken || "").trim();
    if (!challengeToken) {
      return false;
    }

    const authUser = error?.firebaseUser || fallbackUser || null;
    if (!authUser) {
      return false;
    }

    setPendingFirebaseUser(authUser);
    setMfaState({
      challengeToken,
      challengeExpiresAt: String(error?.challengeExpiresAt || ""),
      phoneNumber: authUser.phoneNumber || "",
      otpCode: "",
      otpRequestedAt: "",
    });
    setErrorMessage("");
    setInfoMessage("");
    sendOtpInFlightRef.current = false;
    setUseVisibleRecaptcha(false);
    confirmationResultRef.current = null;
    lastAutoSendChallengeRef.current = "";
    lastAutoVerifyCodeRef.current = "";
    disposeRecaptchaVerifier();
    return true;
  };

  const completeFirebaseSmsEnrollment = async (firebaseUser, phoneNumberOverride = "") => {
    const idToken = await firebaseUser.getIdToken(true);
    const response = await fetch("/api/auth/mfa/sms/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idToken,
        challengeToken: mfaState.challengeToken,
        phoneNumber: String(phoneNumberOverride || mfaState.phoneNumber || "").trim(),
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || "Unable to complete SMS verification.");
    }
  };

  useEffect(() => {
    const hasLinkedPhone =
      Boolean(pendingFirebaseUser?.phoneNumber) ||
      pendingFirebaseUser?.providerData?.some((provider) => provider?.providerId === "phone");

    if (!mfaState.challengeToken || !hasLinkedPhone || !pendingFirebaseUser) {
      return;
    }

    if (isSendingOtp || isVerifyingOtp || otpCooldownSecondsLeft > 0) {
      return;
    }

    if (confirmationResultRef.current || mfaState.otpRequestedAt) {
      return;
    }

    if (lastAutoSendChallengeRef.current === mfaState.challengeToken) {
      return;
    }

    if (shouldSkipOtpAutoSend(mfaState.challengeToken, pendingFirebaseUser?.uid)) {
      setInfoMessage("OTP was recently sent. Enter the current code or tap Send OTP below if needed.");
      return;
    }

    lastAutoSendChallengeRef.current = mfaState.challengeToken;
    setInfoMessage("Sending OTP to your registered mobile number...");
    handleSendOtp().catch(() => null);
  }, [
    isSendingOtp,
    isVerifyingOtp,
    otpCooldownSecondsLeft,
    mfaState.challengeToken,
    mfaState.otpRequestedAt,
    pendingFirebaseUser,
  ]);

  const handleSendOtp = async () => {
    if (!pendingFirebaseUser || !mfaState.challengeToken || isSendingOtp || sendOtpInFlightRef.current) {
      return;
    }

    sendOtpInFlightRef.current = true;
    setIsSendingOtp(true);
    setErrorMessage("");
    setInfoMessage("");

    try {
      const auth = getFirebaseClientAuth();
      const activeUser = auth.currentUser || pendingFirebaseUser;
      if (!activeUser) {
        throw new Error("Firebase session expired. Retry Google sign-in.");
      }

      const alreadyLinked = activeUser.providerData.some((provider) => provider?.providerId === "phone");
      const fallbackPhoneNumber = String(mfaState.phoneNumber || "").trim();
      const targetPhoneNumber = String(activeUser.phoneNumber || fallbackPhoneNumber).trim();
      if (!targetPhoneNumber) {
        throw new Error("auth/invalid-phone-number");
      }

      const requestOtp = async () => {
        const verifier = await getOrCreateRecaptchaVerifier(auth);
        return alreadyLinked
          ? await reauthenticateWithPhoneNumber(activeUser, targetPhoneNumber, verifier)
          : await linkWithPhoneNumber(activeUser, targetPhoneNumber, verifier);
      };

      let confirmationResult;
      try {
        confirmationResult = await requestOtp();
      } catch (firstError) {
        const firstMessage = String(firstError?.message || "").toLowerCase();
        if (firstMessage.includes("recaptcha has already been rendered")) {
          disposeRecaptchaVerifier();
          confirmationResult = await requestOtp();
        } else {
          throw firstError;
        }
      }

      confirmationResultRef.current = confirmationResult;
      setMfaState((current) => ({
        ...current,
        phoneNumber: targetPhoneNumber,
        otpCode: "",
        otpRequestedAt: new Date().toISOString(),
      }));
      markOtpAutoSendGuard(mfaState.challengeToken, activeUser.uid);
      setUseVisibleRecaptcha(false);
      setOtpCooldownSecondsLeft(0);
      lastAutoVerifyCodeRef.current = "";
      setInfoMessage("OTP sent via SMS. Enter the code to continue.");
    } catch (error) {
      const errorCode = String(error?.code || "").trim();
      const errorMessage = String(error?.message || "").toLowerCase();
      const isCaptchaProblem =
        errorCode === "auth/captcha-check-failed" ||
        errorCode === "auth/invalid-app-credential" ||
        errorMessage.includes("recaptcha has already been rendered") ||
        errorMessage.includes("recaptcha");
      if (isCaptchaProblem && !useVisibleRecaptcha) {
        setUseVisibleRecaptcha(true);
      }
      if (String(error?.code || "").trim() === "auth/too-many-requests") {
        startOtpCooldown(90);
      }
      const mapped = mapLoginError(error);
      setErrorMessage(mapped);
      disposeRecaptchaVerifier();
      confirmationResultRef.current = null;
    } finally {
      sendOtpInFlightRef.current = false;
      setIsSendingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    const enteredOtpCode = String(mfaState.otpCode || "")
      .replace(/\D/g, "")
      .slice(0, 6);
    if (!pendingFirebaseUser || !mfaState.challengeToken || enteredOtpCode.length !== 6 || isVerifyingOtp) {
      return;
    }

    setIsVerifyingOtp(true);
    setIsVerifyingAccess(true);
    setErrorMessage("");
    setInfoMessage("");

    try {
      const auth = getFirebaseClientAuth();
      const confirmationResult = confirmationResultRef.current;
      if (!confirmationResult) {
        throw new Error("Request OTP first before entering a verification code.");
      }

      const credentialResult = await withTimeout(
        confirmationResult.confirm(enteredOtpCode),
        20000,
        "OTP verification timed out. Please request a new code and retry.",
      );
      const verifiedUser = credentialResult?.user || auth.currentUser || pendingFirebaseUser;
      if (!verifiedUser) {
        throw new Error("Firebase session expired. Retry Google sign-in.");
      }

      await completeFirebaseSmsEnrollment(verifiedUser, verifiedUser.phoneNumber || mfaState.phoneNumber);
      await completeWorkspaceLogin(auth, verifiedUser);
      finalizingLoginRef.current = true;
      resetMfaState();
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      if (activateSmsEnrollment(error, pendingFirebaseUser)) {
        setInfoMessage("SMS challenge refreshed. Request OTP again.");
      } else {
        setErrorMessage(mapLoginError(error));
      }
    } finally {
      setIsVerifyingOtp(false);
      if (!finalizingLoginRef.current) {
        setIsVerifyingAccess(false);
      }
    }
  };

  useEffect(() => {
    let active = true;
    const processRedirectResult = async () => {
      try {
        const auth = getFirebaseClientAuth();
        const redirectWasPending = hasRedirectPending();
        const redirectResult = await getRedirectResult(auth);
        if (!active) {
          return;
        }

        // Firebase can restore currentUser even when getRedirectResult() is null.
        // Use both sources so redirect callbacks are resilient across browsers.
        const redirectUser =
          redirectResult?.user ||
          auth.currentUser ||
          (redirectWasPending ? await waitForSignedInUser(auth, REDIRECT_USER_WAIT_TIMEOUT_MS) : null);

        if (redirectUser) {
          setIsSubmitting(true);
          setIsVerifyingAccess(true);
          setErrorMessage("");
          clearRedirectPending();
          await completeWorkspaceLogin(auth, redirectUser);
          finalizingLoginRef.current = true;
          router.replace("/dashboard");
          router.refresh();
          return;
        }

        if (!redirectWasPending) {
          return;
        }

        clearRedirectPending();
        setInfoMessage("Sign-in session was not completed. Click Continue with Google to retry.");
      } catch (error) {
        if (!active) {
          return;
        }
        clearRedirectPending();
        if (!activateSmsEnrollment(error)) {
          setErrorMessage(mapLoginError(error));
        }
      } finally {
        if (active && !finalizingLoginRef.current) {
          setIsSubmitting(false);
          setIsVerifyingAccess(false);
        }
      }
    };

    processRedirectResult();
    return () => {
      active = false;
      disposeRecaptchaVerifier();
      confirmationResultRef.current = null;
    };
  }, [router]);

  const handleGoogleLogin = async () => {
    setIsSubmitting(true);
    setErrorMessage("");
    setInfoMessage("");

    let auth;
    let provider;

    try {
      auth = getFirebaseClientAuth();
      provider = buildGoogleProvider();

      const popupResult = await signInWithPopup(auth, provider);
      if (popupResult?.user) {
        clearRedirectPending();
        setIsVerifyingAccess(true);
        await completeWorkspaceLogin(auth, popupResult.user);
        finalizingLoginRef.current = true;
        router.replace("/dashboard");
        router.refresh();
        return;
      }

      setRedirectPending();
      await signInWithRedirect(auth, provider);
      return;
    } catch (error) {
      const rawCode = String(error?.code || "").trim();
      const canFallbackToRedirect =
        rawCode === "auth/popup-blocked" ||
        rawCode === "auth/popup-closed-by-user" ||
        rawCode === "auth/cancelled-popup-request" ||
        rawCode === "auth/internal-error";

      if (canFallbackToRedirect && auth && provider) {
        try {
          setRedirectPending();
          await signInWithRedirect(auth, provider);
          return;
        } catch (redirectError) {
          clearRedirectPending();
          if (!activateSmsEnrollment(redirectError)) {
            setErrorMessage(mapLoginError(redirectError));
          }
          return;
        }
      }

      clearRedirectPending();
      if (!activateSmsEnrollment(error)) {
        setErrorMessage(mapLoginError(error));
      }
    } finally {
      if (!finalizingLoginRef.current) {
        setIsSubmitting(false);
        setIsVerifyingAccess(false);
      }
    }
  };

  const showVerifyingOverlay = isVerifyingAccess || isVerifyingOtp || finalizingLoginRef.current;
  const hasPhoneProviderLinked =
    Boolean(pendingFirebaseUser?.phoneNumber) ||
    pendingFirebaseUser?.providerData?.some((provider) => provider?.providerId === "phone");
  const hasMfaChallenge = Boolean(mfaState.challengeToken);
  const isPhoneRegistrationRequired = hasMfaChallenge && !hasPhoneProviderLinked;
  const hasPhoneNumber = mfaState.phoneNumber.trim().length > 0;
  const hasOtpRequest = Boolean(mfaState.otpRequestedAt) || Boolean(confirmationResultRef.current);
  const isOtpCooldownActive = otpCooldownSecondsLeft > 0;
  const isSmsSendingStep = isPhoneRegistrationRequired && isSendingOtp && !hasOtpRequest;
  const showRegistrationStep = isPhoneRegistrationRequired && !hasOtpRequest && !isSmsSendingStep;
  const showOtpStep = hasOtpRequest || !isPhoneRegistrationRequired;
  const modalTitle = showRegistrationStep
    ? "Register Phone Number"
    : isSmsSendingStep
      ? "Sending OTP Code"
      : "OTP Verification";
  const modalDescription = showRegistrationStep
    ? "Register your mobile number first before you can continue."
    : isSmsSendingStep
      ? "Please wait while we send a one-time code to your mobile number."
      : "Enter the 6-digit code sent to your mobile number.";
  const otpCodeValue = String(mfaState.otpCode || "")
    .replace(/\D/g, "")
    .slice(0, 6);
  const otpDigitValues = Array.from({ length: 6 }, (_, index) => otpCodeValue[index] || "");

  const updateOtpCode = (nextCode) => {
    const normalized = String(nextCode || "")
      .replace(/\D/g, "")
      .slice(0, 6);
    setMfaState((current) => ({
      ...current,
      otpCode: normalized,
    }));
  };

  const handleOtpInputChange = (index, rawValue) => {
    const digits = String(rawValue || "").replace(/\D/g, "");
    const currentDigits = otpDigitValues.slice();

    if (!digits) {
      if (index >= otpCodeValue.length) {
        return;
      }
      updateOtpCode(otpCodeValue.slice(0, index));
      return;
    }

    for (let offset = 0; offset < digits.length && index + offset < 6; offset += 1) {
      currentDigits[index + offset] = digits[offset];
    }

    updateOtpCode(currentDigits.join(""));
    const nextIndex = Math.min(index + digits.length, 5);
    window.requestAnimationFrame(() => {
      otpInputRefs.current[nextIndex]?.focus();
      otpInputRefs.current[nextIndex]?.select?.();
    });
  };

  const handleOtpInputKeyDown = (index, event) => {
    if (event.key === "Backspace" && !otpDigitValues[index] && index > 0) {
      event.preventDefault();
      updateOtpCode(otpCodeValue.slice(0, index - 1));
      window.requestAnimationFrame(() => {
        otpInputRefs.current[index - 1]?.focus();
      });
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      otpInputRefs.current[index - 1]?.focus();
      return;
    }

    if (event.key === "ArrowRight" && index < 5) {
      event.preventDefault();
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpPaste = (event) => {
    const pasted = event.clipboardData?.getData("text") || "";
    const digits = pasted.replace(/\D/g, "").slice(0, 6);
    if (!digits) {
      return;
    }
    event.preventDefault();
    updateOtpCode(digits);
    const focusIndex = Math.min(digits.length, 6) - 1;
    window.requestAnimationFrame(() => {
      otpInputRefs.current[focusIndex]?.focus();
      otpInputRefs.current[focusIndex]?.select?.();
    });
  };

  useEffect(() => {
    if (!hasMfaChallenge) {
      return;
    }

    if (otpCodeValue.length < 6) {
      lastAutoVerifyCodeRef.current = "";
      return;
    }

    if (!hasOtpRequest || isVerifyingOtp || isSendingOtp) {
      return;
    }

    const submissionKey = `${mfaState.challengeToken}:${otpCodeValue}`;
    if (lastAutoVerifyCodeRef.current === submissionKey) {
      return;
    }

    lastAutoVerifyCodeRef.current = submissionKey;
    handleVerifyOtp().catch(() => null);
  }, [
    hasMfaChallenge,
    hasOtpRequest,
    isSendingOtp,
    isVerifyingOtp,
    mfaState.challengeToken,
    otpCodeValue,
  ]);

  useEffect(() => {
    if (!hasMfaChallenge || !hasOtpRequest || isVerifyingOtp) {
      return;
    }

    const firstEmptyIndex = otpDigitValues.findIndex((digit) => !digit);
    const targetIndex = firstEmptyIndex === -1 ? 5 : firstEmptyIndex;
    window.requestAnimationFrame(() => {
      otpInputRefs.current[targetIndex]?.focus();
    });
  }, [hasMfaChallenge, hasOtpRequest, isVerifyingOtp, otpCodeValue]);

  return (
    <section className="w-full">
      <div className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-3xl border border-[#e6dcc7] bg-[#fffdf7] p-6 shadow-[0_28px_60px_-44px_rgba(15,23,42,0.55)] sm:p-7">
        <div className="pointer-events-none absolute left-0 right-0 top-0 h-1.5 bg-[linear-gradient(90deg,#0f766e_0%,#0284c7_45%,#f97316_100%)]" />
        <div className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full bg-[#f1f5f9]" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-[#ffe8c7]" />
        <div className={`relative space-y-5 transition-opacity ${hasMfaChallenge ? "opacity-70" : "opacity-100"}`}>
          <div className="flex w-full justify-center">
            <img
              src="/logo/atralogo.png"
              alt="ATR & Associates"
              className="h-auto w-full max-w-[560px] rounded-2xl border border-slate-200 object-contain"
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#0f766e]">
              Clio Workspace
            </p>
            <h1 className="max-w-xl text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Secure access to your workspace.
            </h1>
            <p className="max-w-lg text-[15px] text-slate-600">
              Sign in with your verified work account to continue.
            </p>
          </div>

          <div className="pt-0.5" />

          <div className="space-y-4 pt-1">
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isSubmitting || hasMfaChallenge}
              className="relative inline-flex h-12 w-full items-center justify-center rounded-2xl border border-[#d2d6dc] bg-white px-5 text-[15px] font-semibold text-[#1f1f1f] shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition-all duration-200 hover:border-[#c4c8ce] hover:bg-[#f8f9fa] active:scale-[0.997] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/35 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-65"
            >
              <svg viewBox="0 0 18 18" className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M17.64 9.2045c0-.638-.0573-1.2518-.1636-1.8409H9v3.4818h4.8436c-.2086 1.125-.8427 2.0782-1.7977 2.7155v2.2582h2.9082c1.7018-1.5664 2.6859-3.8741 2.6859-6.6146z"
                />
                <path
                  fill="#34A853"
                  d="M9 18c2.43 0 4.4673-.8064 5.9564-2.1805l-2.9082-2.2582c-.8064.5409-1.8377.8605-3.0482.8605-2.3468 0-4.3341-1.5859-5.0432-3.7168H.9577v2.3332C2.4382 15.98 5.4818 18 9 18z"
                />
                <path
                  fill="#FBBC05"
                  d="M3.9568 10.705c-.1809-.5409-.2841-1.1182-.2841-1.705 0-.5868.1032-1.1641.2841-1.705V4.9618H.9577C.3477 6.1732 0 7.5491 0 9c0 1.4509.3477 2.8268.9577 4.0382l2.9991-2.3332z"
                />
                <path
                  fill="#EA4335"
                  d="M9 3.5795c1.3214 0 2.5077.4545 3.4405 1.3455l2.5805-2.5805C13.4632.891 11.4259 0 9 0 5.4818 0 2.4382 2.02.9577 4.9618l2.9991 2.3332C4.6659 5.1641 6.6532 3.5795 9 3.5795z"
                />
              </svg>
              <span>{isSubmitting ? "Signing in..." : "Continue with Google"}</span>
            </button>

            {!hasMfaChallenge && errorMessage ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {errorMessage}
              </p>
            ) : null}

            {!hasMfaChallenge && infoMessage ? (
              <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">{infoMessage}</p>
            ) : null}

            <p className="text-xs text-slate-500">
              Complete your invite verification first, then use the same invited email for Google sign-in.
            </p>
          </div>
        </div>
      </div>

      {hasMfaChallenge ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/45 p-3 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_30px_70px_-30px_rgba(15,23,42,0.55)]">
            <div className="border-b border-slate-100 bg-[linear-gradient(120deg,#f8fafc_0%,#f1f5f9_100%)] px-4 py-3 sm:px-5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#0f766e]">CLIO</p>
                  <h2 className="mt-1 text-base font-semibold text-slate-900 sm:text-lg">{modalTitle}</h2>
                  <p className="mt-1 text-sm text-slate-600">{modalDescription}</p>
                </div>
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 2a4 4 0 0 0-4 4v3H7a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-7a3 3 0 0 0-3-3h-1V6a4 4 0 0 0-4-4zm-2 7V6a2 2 0 1 1 4 0v3h-4z"
                    />
                  </svg>
                </span>
              </div>
            </div>

            <div className="space-y-3 px-4 py-4 sm:px-5 sm:py-5">
              <div className={useVisibleRecaptcha ? "rounded-xl border border-slate-200 bg-white p-2" : "sr-only"}>
                <p className={useVisibleRecaptcha ? "mb-2 text-[11px] font-medium text-slate-600" : "hidden"}>
                  Complete the captcha challenge, then tap Register again.
                </p>
                <div id={recaptchaContainerIdRef.current} />
              </div>

              <div className="rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,#fcfdff_0%,#f8fafc_100%)] p-3 shadow-[0_18px_38px_-32px_rgba(15,23,42,0.45)] sm:p-4">
                <div className="space-y-4">
                  {showRegistrationStep ? (
                    <div>
                      <label className="mt-2 block space-y-1">
                        <span className="text-xs font-medium text-slate-700">Mobile Number</span>
                        <input
                          type="tel"
                          value={mfaState.phoneNumber}
                          onChange={(event) =>
                            setMfaState((current) => ({
                              ...current,
                              phoneNumber: event.target.value,
                            }))
                          }
                          placeholder="+639171234567"
                          className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                          disabled={isSendingOtp || isVerifyingOtp}
                        />
                      </label>
                      <p className={`mt-2 text-[11px] ${hasPhoneNumber ? "text-slate-500" : "font-medium text-amber-700"}`}>
                        {hasPhoneNumber
                          ? "Use international format with country code to register this account."
                          : "Add your mobile number first before requesting OTP."}
                      </p>
                      <button
                        type="button"
                        onClick={handleSendOtp}
                        disabled={isSendingOtp || isOtpCooldownActive || !hasPhoneNumber}
                        className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-xl border border-sky-300 bg-white px-4 text-sm font-semibold text-sky-700 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSendingOtp ? "Sending OTP..." : isOtpCooldownActive ? `Retry in ${otpCooldownSecondsLeft}s` : "Register"}
                      </button>
                      {isOtpCooldownActive ? (
                        <p className="mt-2 text-[11px] font-medium text-amber-700">
                          OTP is temporarily rate-limited. Please wait before retrying.
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {isSmsSendingStep ? (
                    <div className="rounded-xl border border-sky-100 bg-sky-50/70 px-4 py-6">
                      <div className="flex flex-col items-center justify-center gap-3 text-center">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-sky-600 shadow-sm">
                          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                            <path
                              fill="currentColor"
                              d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 3.2l-8 5-8-5V6l8 5 8-5v1.2z"
                            />
                          </svg>
                        </span>
                        <p className="text-sm font-semibold text-slate-800">Sending OTP to your mobile number...</p>
                        <span className="inline-flex w-8 justify-start">
                          <span className="inline-flex h-1.5 w-1.5 animate-bounce rounded-full bg-sky-500 [animation-delay:-0.2s]" />
                          <span className="ml-1 inline-flex h-1.5 w-1.5 animate-bounce rounded-full bg-sky-500 [animation-delay:-0.1s]" />
                          <span className="ml-1 inline-flex h-1.5 w-1.5 animate-bounce rounded-full bg-sky-500" />
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {showOtpStep ? (
                    <div>
                      {!isPhoneRegistrationRequired ? (
                        <div className="mb-2 space-y-2">
                          <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
                            OTP is sent automatically to your registered mobile number.
                          </p>
                        </div>
                      ) : null}
                      <label className="mt-2 block space-y-2">
                        <span className="text-xs font-medium text-slate-700">Verification Code</span>
                        <div className="mx-auto flex max-w-[360px] items-center justify-center gap-2 sm:gap-3" onPaste={handleOtpPaste}>
                          {otpDigitValues.map((digit, index) => (
                            <input
                              key={`otp-${index}`}
                              ref={(element) => {
                                otpInputRefs.current[index] = element;
                              }}
                              type="text"
                              inputMode="numeric"
                              autoComplete={index === 0 ? "one-time-code" : "off"}
                              maxLength={1}
                              value={digit}
                              onChange={(event) => handleOtpInputChange(index, event.target.value)}
                              onKeyDown={(event) => handleOtpInputKeyDown(index, event)}
                              className="h-12 w-12 rounded-2xl border border-sky-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] text-center text-lg font-semibold text-slate-900 shadow-[0_2px_10px_-8px_rgba(2,132,199,0.45)] transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100 disabled:opacity-60"
                              disabled={isSendingOtp || isVerifyingOtp || !hasOtpRequest}
                            />
                          ))}
                        </div>
                      </label>
                      <p className="mt-2 text-[11px] text-slate-500">
                        {isSendingOtp ? (
                          "Sending OTP..."
                        ) : isOtpCooldownActive ? (
                          `Resend available in ${otpCooldownSecondsLeft}s.`
                        ) : (
                          <>
                            Didn&apos;t receive a code?{" "}
                            <button
                              type="button"
                              onClick={handleSendOtp}
                              disabled={isVerifyingOtp || !hasPhoneNumber}
                              className="font-semibold text-sky-700 underline decoration-transparent underline-offset-2 transition hover:decoration-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {hasOtpRequest ? "Resend OTP" : "Send OTP"}
                            </button>
                            .
                          </>
                        )}
                      </p>
                      {!hasOtpRequest ? (
                        <p className="mt-2 text-[11px] text-slate-500">Waiting for OTP challenge. Please hold for a moment.</p>
                      ) : otpCodeValue.length < 6 ? (
                        <p className="mt-2 text-[11px] text-slate-500">Enter the 6-digit code. Verification is automatic.</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              {errorMessage ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {errorMessage}
                </p>
              ) : null}

              {infoMessage ? (
                <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">{infoMessage}</p>
              ) : null}

              {mfaState.otpRequestedAt ? (
                <p className="text-xs text-slate-500">
                  OTP requested: {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(mfaState.otpRequestedAt))}
                </p>
              ) : null}

              {mfaState.challengeExpiresAt ? (
                <p className="text-[11px] text-slate-500">
                  Session expires: {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(mfaState.challengeExpiresAt))}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {showVerifyingOverlay ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/75 backdrop-blur-[2px]">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 px-5 py-3 text-sm font-semibold text-slate-700 shadow-[0_12px_30px_-20px_rgba(15,23,42,0.45)]">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-sky-50 text-sky-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M12 3a5 5 0 0 0-5 5v2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1V8a5 5 0 0 0-5-5zm-3 7V8a3 3 0 1 1 6 0v2H9z"
                />
              </svg>
            </span>
            <span className="flex flex-col text-left">
              <span className="text-[13px] font-semibold text-slate-900">Verifying access</span>
              <span className="text-[11px] font-medium text-slate-500">Securing your session</span>
            </span>
            <span className="inline-flex w-6 justify-start">
              <span className="inline-flex h-1.5 w-1.5 animate-bounce rounded-full bg-sky-500 [animation-delay:-0.2s]" />
              <span className="ml-1 inline-flex h-1.5 w-1.5 animate-bounce rounded-full bg-sky-500 [animation-delay:-0.1s]" />
              <span className="ml-1 inline-flex h-1.5 w-1.5 animate-bounce rounded-full bg-sky-500" />
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
