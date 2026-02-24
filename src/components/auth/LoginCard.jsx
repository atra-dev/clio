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

    if (rawCode === "auth/unauthorized-domain") {
      return "Current domain is not authorized in Firebase Authentication settings.";
    }
    if (rawCode === "auth/invalid-api-key") {
      return "Firebase API key is invalid. Check NEXT_PUBLIC_FIREBASE_API_KEY in .env.local.";
    }
    if (rawCode === "auth/internal-error") {
      return "Firebase sign-in failed due to browser/CSP restrictions. Allow popups and cookies for the current domain, then retry.";
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
      throw new Error(payload.message || "Unable to log in.");
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
    }
  };

  const handleVerifyOtp = async () => {
    if (!pendingFirebaseUser || !mfaState.challengeToken || !mfaState.otpCode || isVerifyingOtp) {
      return;
    }

    setIsVerifyingOtp(true);
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
    }
  };

  const handleCancelMfa = async () => {
    try {
      const auth = getFirebaseClientAuth();
      await signOut(auth).catch(() => {});
    } finally {
      resetMfaState();
      setErrorMessage("");
      setInfoMessage("");
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

        const redirectUser = redirectResult?.user || null;
        if (redirectUser) {
          setIsSubmitting(true);
          setErrorMessage("");
          clearRedirectPending();
          await completeWorkspaceLogin(auth, redirectUser);
          router.replace("/dashboard");
          router.refresh();
          return;
        }

        if (!redirectWasPending) {
          return;
        }

        setIsSubmitting(true);
        const fallbackUser = await waitForSignedInUser(auth, 5000);
        if (!fallbackUser) {
          clearRedirectPending();
          setErrorMessage("Google sign-in did not complete. Please try again.");
          return;
        }

        setErrorMessage("");
        clearRedirectPending();
        await completeWorkspaceLogin(auth, fallbackUser);
        router.replace("/dashboard");
        router.refresh();
      } catch (error) {
        if (!active) {
          return;
        }
        clearRedirectPending();
        if (!activateSmsEnrollment(error)) {
          setErrorMessage(mapLoginError(error));
        }
      } finally {
        if (active) {
          setIsSubmitting(false);
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
        await completeWorkspaceLogin(auth, popupResult.user);
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
      setIsSubmitting(false);
    }
  };

  return (
    <section className="w-full">
      <div className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-3xl border border-[#d7e5f5] bg-white p-8 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.55)] sm:p-10">
        <div className="pointer-events-none absolute -top-12 -right-12 h-48 w-48 rounded-full bg-[#dbeafe]" />
        <div className="pointer-events-none absolute -bottom-14 -left-14 h-44 w-44 rounded-full bg-[#ecfeff]" />
        <div className="relative space-y-7">
          <BrandMark compact />
          <div className="space-y-3">
            <p className="text-sm font-semibold uppercase tracking-[0.15em] text-[#0f6bcf]">
              Clio Human Resource Information System
            </p>
            <h1 className="max-w-xl text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              Attendance and employee data, secured and easy to access.
            </h1>
            <p className="max-w-lg text-base text-slate-600">
              Built for GRC, HR, and EA teams with centralized records, activity logs, export control,
              and document workflows.
            </p>
          </div>

          <div className="space-y-2 pt-1">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
              {mfaState.challengeToken ? "Set Up SMS Authentication" : "Log in to Clio"}
            </h2>
            <p className="text-sm text-slate-600">
              {mfaState.challengeToken
                ? "Register your phone number and complete OTP verification to continue."
                : "Sign in with your invited and verified work account through Google."}
            </p>
          </div>

          <div className="space-y-5 pt-2">
            {!mfaState.challengeToken ? (
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isSubmitting}
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
            ) : (
              <div className="space-y-3 rounded-2xl border border-[#d7e5f5] bg-[#f8fbff] p-4">
                <div id="clio-login-sms-recaptcha" className="sr-only" />

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">Mobile Number</span>
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
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
                    disabled={isSendingOtp || isVerifyingOtp}
                  />
                </label>

                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={isSendingOtp || !mfaState.phoneNumber}
                  className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-[#0f6bcf] bg-white px-4 text-sm font-semibold text-[#0f6bcf] transition hover:bg-[#eff6ff] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSendingOtp ? "Sending OTP..." : "Send OTP"}
                </button>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">OTP Code</span>
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
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
                    disabled={isSendingOtp || isVerifyingOtp}
                  />
                </label>

                <button
                  type="button"
                  onClick={handleVerifyOtp}
                  disabled={isVerifyingOtp || mfaState.otpCode.trim().length !== 6}
                  className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#0f6bcf] px-4 text-sm font-semibold text-white transition hover:bg-[#0c57aa] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isVerifyingOtp ? "Verifying OTP..." : "Verify OTP and Continue"}
                </button>

                <button
                  type="button"
                  onClick={handleCancelMfa}
                  className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            )}

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

            <p className="text-xs text-slate-500">
              {mfaState.challengeToken
                ? "SMS OTP is handled by Firebase Phone Authentication. After verification, login continues automatically."
                : "Complete your invite verification first, then use the same invited email for Google sign-in."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
