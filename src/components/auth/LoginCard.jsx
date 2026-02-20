"use client";

import { useEffect, useRef, useState } from "react";
import {
  GoogleAuthProvider,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
  TotpMultiFactorGenerator,
  getMultiFactorResolver,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import BrandMark from "@/components/ui/BrandMark";
import { LOGIN_HIGHLIGHTS } from "@/features/hris/constants";
import { getFirebaseClientAuth } from "@/lib/firebase-client-auth";

export default function LoginCard() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const recaptchaVerifierRef = useRef(null);

  useEffect(() => {
    return () => {
      recaptchaVerifierRef.current?.clear?.();
      recaptchaVerifierRef.current = null;
    };
  }, []);

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
      await signOut(auth).catch(() => {});
      throw new Error(payload.message || "Unable to log in.");
    }
  };

  const ensureRecaptchaVerifier = async (auth) => {
    if (!recaptchaVerifierRef.current) {
      recaptchaVerifierRef.current = new RecaptchaVerifier(auth, "clio-mfa-recaptcha", {
        size: "invisible",
      });
    }

    await recaptchaVerifierRef.current.render();
    return recaptchaVerifierRef.current;
  };

  const resolveSecondFactorSignIn = async (auth, mfaError) => {
    const resolver = getMultiFactorResolver(auth, mfaError);
    const hints = Array.isArray(resolver.hints) ? resolver.hints : [];
    if (hints.length === 0) {
      throw new Error("No second-factor method is enrolled for this account.");
    }

    let selectedHint = hints[0];
    if (hints.length > 1) {
      const options = hints
        .map((hint, index) => {
          if (hint.factorId === TotpMultiFactorGenerator.FACTOR_ID) {
            const label = hint.displayName || "Authenticator app";
            return `${index + 1}. ${label} (Authenticator)`;
          }
          if (hint.factorId === PhoneMultiFactorGenerator.FACTOR_ID) {
            const phoneNumber = typeof hint.phoneNumber === "string" ? hint.phoneNumber : "Phone";
            return `${index + 1}. ${phoneNumber} (SMS)`;
          }
          return `${index + 1}. ${hint.displayName || "Second factor"} (${hint.factorId})`;
        })
        .join("\n");

      const selectedInput = window.prompt(
        `Select your second-factor method:\n${options}\nEnter the number of your method:`,
        "1",
      );
      const selectedIndex = Number.parseInt(String(selectedInput || "1"), 10) - 1;
      if (Number.isFinite(selectedIndex) && selectedIndex >= 0 && selectedIndex < hints.length) {
        selectedHint = hints[selectedIndex];
      }
    }

    if (selectedHint.factorId === TotpMultiFactorGenerator.FACTOR_ID) {
      const otp = window.prompt("Enter the code from your authenticator app:");
      const normalizedOtp = String(otp || "").trim();
      if (!normalizedOtp) {
        throw new Error("Second-factor verification was cancelled.");
      }

      const assertion = TotpMultiFactorGenerator.assertionForSignIn(selectedHint.uid, normalizedOtp);
      return await resolver.resolveSignIn(assertion);
    }

    if (selectedHint.factorId === PhoneMultiFactorGenerator.FACTOR_ID) {
      const appVerifier = await ensureRecaptchaVerifier(auth);

      const phoneAuthProvider = new PhoneAuthProvider(auth);
      const verificationId = await phoneAuthProvider.verifyPhoneNumber(
        {
          multiFactorUid: selectedHint.uid,
          session: resolver.session,
        },
        appVerifier,
      );

      const targetPhone =
        typeof selectedHint.phoneNumber === "string" && selectedHint.phoneNumber.trim().length > 0
          ? selectedHint.phoneNumber
          : "your phone";
      const code = window.prompt(`Enter the verification code sent to ${targetPhone}:`);
      const normalizedCode = String(code || "").trim();
      if (!normalizedCode) {
        throw new Error("Second-factor verification was cancelled.");
      }

      const credential = PhoneAuthProvider.credential(verificationId, normalizedCode);
      const assertion = PhoneMultiFactorGenerator.assertion(credential);
      return await resolver.resolveSignIn(assertion);
    }

    throw new Error("Unsupported second-factor type for this account.");
  };

  const handleGoogleLogin = async () => {
    setIsSubmitting(true);
    setErrorMessage("");

    let auth = null;

    try {
      auth = getFirebaseClientAuth();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: "select_account",
      });

      const result = await signInWithPopup(auth, provider);
      await completeWorkspaceLogin(auth, result.user);

      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      const rawCode = String(error?.code || "").trim();
      const rawMessage = String(error?.message || "").trim();

      if (rawCode === "auth/multi-factor-auth-required") {
        try {
          const mfaResult = await resolveSecondFactorSignIn(auth, error);
          await completeWorkspaceLogin(auth, mfaResult.user);
          router.replace("/dashboard");
          router.refresh();
          return;
        } catch (mfaError) {
          recaptchaVerifierRef.current?.clear?.();
          recaptchaVerifierRef.current = null;

          const mfaCode = String(mfaError?.code || "").trim();
          const mfaMessage = String(mfaError?.message || "").trim();
          const message =
            mfaCode === "auth/invalid-verification-code"
              ? "Invalid second-factor code. Please try again."
            : mfaCode === "auth/code-expired"
                ? "Second-factor code has expired. Start sign-in again."
              : mfaCode === "auth/quota-exceeded"
                  ? "Too many verification attempts. Please wait and try again."
                : mfaCode === "auth/missing-verification-code"
                    ? "Second-factor code is required."
                  : mfaCode === "auth/invalid-app-credential"
                    ? "Invalid app credential for SMS MFA. Check Firebase Authorized domains and Phone provider setup, then retry."
                  : mfaMessage || "Unable to complete second-factor verification.";

          setErrorMessage(message);
          return;
        }
      }

      const message =
        rawCode === "auth/popup-closed-by-user"
          ? "Google sign-in was cancelled."
          : rawCode === "auth/popup-blocked"
            ? "Popup was blocked by your browser. Allow popups and try again."
            : rawCode === "auth/unauthorized-domain"
              ? "Current domain is not authorized in Firebase Authentication settings."
              : rawCode === "auth/invalid-api-key"
                ? "Firebase API key is invalid. Check NEXT_PUBLIC_FIREBASE_API_KEY in .env.local."
                : rawMessage.startsWith("firebase_client_not_configured")
                  ? "Firebase client is not configured. Set NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID, and NEXT_PUBLIC_FIREBASE_APP_ID, then restart npm run dev."
                  : rawCode === "auth/multi-factor-auth-required"
                    ? "Second-factor verification is required for this account."
                    : rawCode === "auth/invalid-app-credential"
                      ? "SMS MFA failed due to invalid app credential. Ensure localhost is in Firebase Authorized domains and Phone provider is enabled, then retry."
                    : error?.message || "Unable to log in.";

      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="grid w-full gap-6 lg:grid-cols-[1.1fr_1fr]">
      <div className="relative overflow-hidden rounded-3xl border border-[#d7e5f5] bg-white p-8 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.55)] sm:p-10">
        <div className="pointer-events-none absolute -top-12 -right-12 h-48 w-48 rounded-full bg-[#dbeafe]" />
        <div className="pointer-events-none absolute -bottom-14 -left-14 h-44 w-44 rounded-full bg-[#ecfeff]" />
        <div className="relative space-y-8">
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

          <ul className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
            {LOGIN_HIGHLIGHTS.map((item) => (
              <li key={item} className="rounded-xl border border-[#d7e5f5] bg-[#f8fbff] px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-3xl border border-[#d7e5f5] bg-white p-8 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.55)] sm:p-10">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Log in to Clio</h2>
        <p className="mt-2 text-sm text-slate-600">
          Sign in with your invited and verified work account through Google.
        </p>

        <div className="mt-8 space-y-5">
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isSubmitting}
            className="inline-flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-[#c9d8ea] bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-xs font-bold text-slate-700">
              G
            </span>
            {isSubmitting ? "Signing in..." : "Continue with Google"}
          </button>

          {errorMessage ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {errorMessage}
            </p>
          ) : null}

          <p className="text-xs text-slate-500">
            Complete your invite email verification first, then use the same invited email for Google sign-in.
          </p>
        </div>
      </div>

      <div
        id="clio-mfa-recaptcha"
        aria-hidden="true"
        className="pointer-events-none fixed bottom-0 left-0 h-px w-px overflow-hidden opacity-0"
      />
    </section>
  );
}
