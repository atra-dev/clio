"use client";

import { useEffect, useRef, useState } from "react";
import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  getRedirectResult,
  linkWithPhoneNumber,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import BrandMark from "@/components/ui/BrandMark";
import { getFirebaseClientAuth } from "@/lib/firebase-client-auth";

export default function LoginCard() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isVerifyingAccess, setIsVerifyingAccess] = useState(false);
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
  const REDIRECT_PENDING_KEY = "clio_google_redirect_pending";
  const REDIRECT_USER_WAIT_TIMEOUT_MS = 15000;

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
    if (rawMessage.startsWith("firebase_client_not_configured")) {
      return "Firebase client is not configured. Set NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID, and NEXT_PUBLIC_FIREBASE_APP_ID, then restart npm run dev.";
    }
    return error?.message || "Unable to complete Google sign-in.";
  };

  const disposeRecaptchaVerifier = () => {
    if (recaptchaVerifierRef.current) {
      try {
        recaptchaVerifierRef.current.clear();
      } catch {}
      recaptchaVerifierRef.current = null;
    }

    if (typeof document !== "undefined") {
      const container = document.getElementById("clio-login-sms-recaptcha");
      if (container) {
        container.innerHTML = "";
      }
    }
  };

  const getOrCreateRecaptchaVerifier = async (auth) => {
    if (recaptchaVerifierRef.current) {
      return recaptchaVerifierRef.current;
    }

    if (typeof window === "undefined") {
      throw new Error("captcha_not_ready");
    }

    const container = document.getElementById("clio-login-sms-recaptcha");
    if (!container) {
      throw new Error("captcha_not_ready");
    }

    const verifier = new RecaptchaVerifier(auth, "clio-login-sms-recaptcha", {
      size: "invisible",
    });
    await verifier.render();
    recaptchaVerifierRef.current = verifier;
    return verifier;
  };

  const resetMfaState = () => {
    setMfaState({
      challengeToken: "",
      challengeExpiresAt: "",
      phoneNumber: "",
      otpCode: "",
      otpRequestedAt: "",
    });
    setPendingFirebaseUser(null);
    setInfoMessage("");
    confirmationResultRef.current = null;
    disposeRecaptchaVerifier();
  };

  const completeWorkspaceLogin = async (auth, firebaseUser) => {
    const idToken = await firebaseUser.getIdToken(true);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idToken,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      if (payload?.reason === "sms_mfa_required") {
        const smsError = new Error(payload.message || "SMS authentication is required before login.");
        smsError.code = "sms_mfa_required";
        smsError.challengeToken = String(payload?.challengeToken || "");
        smsError.challengeExpiresAt = String(payload?.challengeExpiresAt || "");
        smsError.firebaseUser = firebaseUser;
        throw smsError;
      }

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
    setInfoMessage("Register your mobile number and verify OTP to continue login.");
    confirmationResultRef.current = null;
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

  const handleSendOtp = async () => {
    if (!pendingFirebaseUser || !mfaState.challengeToken || !mfaState.phoneNumber || isSendingOtp) {
      return;
    }

    setIsSendingOtp(true);
    setIsVerifyingAccess(true);
    setErrorMessage("");
    setInfoMessage("");

    try {
      const auth = getFirebaseClientAuth();
      const activeUser = auth.currentUser || pendingFirebaseUser;
      if (!activeUser) {
        throw new Error("Firebase session expired. Retry Google sign-in.");
      }

      const alreadyLinked = activeUser.providerData.some((provider) => provider?.providerId === "phone");
      if (alreadyLinked && activeUser.phoneNumber) {
        await completeFirebaseSmsEnrollment(activeUser, activeUser.phoneNumber);
        await completeWorkspaceLogin(auth, activeUser);
        resetMfaState();
        router.replace("/dashboard");
        router.refresh();
        return;
      }

      const verifier = await getOrCreateRecaptchaVerifier(auth);
      const confirmationResult = await linkWithPhoneNumber(activeUser, mfaState.phoneNumber, verifier);
      confirmationResultRef.current = confirmationResult;
      setMfaState((current) => ({
        ...current,
        otpRequestedAt: new Date().toISOString(),
      }));
      setInfoMessage("OTP sent via Firebase. Enter the code to continue.");
    } catch (error) {
      const mapped = mapLoginError(error);
      setErrorMessage(mapped);
      disposeRecaptchaVerifier();
      confirmationResultRef.current = null;
    } finally {
      setIsSendingOtp(false);
      setIsVerifyingAccess(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!pendingFirebaseUser || !mfaState.challengeToken || !mfaState.otpCode || isVerifyingOtp) {
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

      const credentialResult = await confirmationResult.confirm(mfaState.otpCode.trim());
      const verifiedUser = credentialResult?.user || auth.currentUser || pendingFirebaseUser;
      if (!verifiedUser) {
        throw new Error("Firebase session expired. Retry Google sign-in.");
      }

      await completeFirebaseSmsEnrollment(verifiedUser, verifiedUser.phoneNumber || mfaState.phoneNumber);
      await completeWorkspaceLogin(auth, verifiedUser);
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
      setIsVerifyingAccess(false);
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

  const showVerifyingOverlay =
    isVerifyingAccess || isSendingOtp || isVerifyingOtp || finalizingLoginRef.current;
  const hasPhoneNumber = mfaState.phoneNumber.trim().length > 0;
  const hasMfaChallenge = Boolean(mfaState.challengeToken);

  return (
    <section className="w-full">
      <div className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-3xl border border-[#e6dcc7] bg-[#fffdf7] p-8 shadow-[0_28px_60px_-44px_rgba(15,23,42,0.55)] sm:p-10">
        <div className="pointer-events-none absolute left-0 right-0 top-0 h-1.5 bg-[linear-gradient(90deg,#0f766e_0%,#0284c7_45%,#f97316_100%)]" />
        <div className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full bg-[#f1f5f9]" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-[#ffe8c7]" />
        <div className={`relative space-y-7 transition-opacity ${hasMfaChallenge ? "opacity-70" : "opacity-100"}`}>
          <BrandMark compact />
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#0f766e]">
              Clio Workspace
            </p>
            <h1 className="max-w-xl text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              Secure access to your workspace.
            </h1>
            <p className="max-w-lg text-base text-slate-600">
              Sign in with your verified work account to continue.
            </p>
          </div>

          <div className="pt-1" />

          <div className="space-y-5 pt-2">
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
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/45 p-4 backdrop-blur-sm sm:items-center sm:p-6">
          <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_35px_90px_-35px_rgba(15,23,42,0.55)]">
            <div className="border-b border-slate-100 bg-[linear-gradient(120deg,#f8fafc_0%,#f1f5f9_100%)] px-5 py-4 sm:px-6">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#0f766e]">Clio HRIS Access</p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-900 sm:text-xl">SMS Verification Required</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Complete mobile OTP verification to continue to your secured workspace.
                  </p>
                </div>
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 2a4 4 0 0 0-4 4v3H7a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-7a3 3 0 0 0-3-3h-1V6a4 4 0 0 0-4-4zm-2 7V6a2 2 0 1 1 4 0v3h-4z"
                    />
                  </svg>
                </span>
              </div>
            </div>

            <div className="space-y-4 px-5 py-5 sm:px-6">
              <div id="clio-login-sms-recaptcha" className="sr-only" />

              <div className="rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,#fcfdff_0%,#f8fafc_100%)] p-4 shadow-[0_18px_38px_-32px_rgba(15,23,42,0.45)] sm:p-5">
                <div className="space-y-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Mobile Number</p>
                    <label className="mt-2 block space-y-1">
                      <span className="text-xs font-medium text-slate-700">Work Mobile</span>
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
                        className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                        disabled={isSendingOtp || isVerifyingOtp}
                      />
                    </label>
                    <p className={`mt-2 text-[11px] ${hasPhoneNumber ? "text-slate-500" : "font-medium text-amber-700"}`}>
                      {hasPhoneNumber
                        ? "Use international format with country code."
                        : "Add your mobile number first before requesting OTP."}
                    </p>
                    <button
                      type="button"
                      onClick={handleSendOtp}
                      disabled={isSendingOtp || !hasPhoneNumber}
                      className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl border border-sky-300 bg-white px-4 text-sm font-semibold text-sky-700 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSendingOtp ? "Sending OTP..." : "Send OTP"}
                    </button>
                  </div>

                  <div className="h-px w-full bg-slate-200" />

                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">OTP Code</p>
                    <label className="mt-2 block space-y-1">
                      <span className="text-xs font-medium text-slate-700">Verification Code</span>
                      <input
                        type="text"
                        value={mfaState.otpCode}
                        onChange={(event) =>
                          setMfaState((current) => ({
                            ...current,
                            otpCode: event.target.value,
                          }))
                        }
                        placeholder="6-digit code"
                        className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                        disabled={isSendingOtp || isVerifyingOtp}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleVerifyOtp}
                      disabled={isVerifyingOtp || mfaState.otpCode.trim().length !== 6}
                      className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#0f6bcf] px-4 text-sm font-semibold text-white transition hover:bg-[#0c57aa] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isVerifyingOtp ? "Verifying OTP..." : "Verify OTP and Continue"}
                    </button>
                  </div>
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
