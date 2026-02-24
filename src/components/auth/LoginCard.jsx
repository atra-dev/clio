"use client";

import { useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  getRedirectResult,
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
  const [errorMessage, setErrorMessage] = useState("");

  const buildGoogleProvider = () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: "select_account",
    });
    return provider;
  };

  const mapLoginError = (error) => {
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
    if (rawCode === "auth/multi-factor-auth-required") {
      return "MFA is currently disabled in this app. Remove this user's enrolled MFA factors in Firebase Authentication, then sign in again.";
    }
    if (rawCode === "auth/invalid-app-credential") {
      return "MFA is disabled in this app. If this user still has SMS MFA enrolled in Firebase, unenroll it first.";
    }
    if (rawMessage.startsWith("firebase_client_not_configured")) {
      return "Firebase client is not configured. Set NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID, and NEXT_PUBLIC_FIREBASE_APP_ID, then restart npm run dev.";
    }
    return error?.message || "Unable to complete Google sign-in.";
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
      await signOut(auth).catch(() => {});
      throw new Error(payload.message || "Unable to log in.");
    }
  };

  useEffect(() => {
    let active = true;
    const processRedirectResult = async () => {
      try {
        const auth = getFirebaseClientAuth();
        const redirectResult = await getRedirectResult(auth);
        if (!active || !redirectResult?.user) {
          return;
        }
        setIsSubmitting(true);
        setErrorMessage("");
        await completeWorkspaceLogin(auth, redirectResult.user);
        router.replace("/dashboard");
        router.refresh();
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorMessage(mapLoginError(error));
      } finally {
        if (active) {
          setIsSubmitting(false);
        }
      }
    };

    processRedirectResult();
    return () => {
      active = false;
    };
  }, [router]);

  const handleGoogleLogin = async () => {
    setIsSubmitting(true);
    setErrorMessage("");

    let auth;
    let provider;

    try {
      auth = getFirebaseClientAuth();
      provider = buildGoogleProvider();

      const isLocalHost =
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
      const shouldPreferRedirect = !isLocalHost;

      if (shouldPreferRedirect) {
        await signInWithRedirect(auth, provider);
        return;
      }

      const popupResult = await signInWithPopup(auth, provider);
      if (popupResult?.user) {
        await completeWorkspaceLogin(auth, popupResult.user);
        router.replace("/dashboard");
        router.refresh();
        return;
      }

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
          await signInWithRedirect(auth, provider);
          return;
        } catch (redirectError) {
          setErrorMessage(mapLoginError(redirectError));
          return;
        }
      }

      setErrorMessage(mapLoginError(error));
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
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Log in to Clio</h2>
            <p className="text-sm text-slate-600">
              Sign in with your invited and verified work account through Google.
            </p>
          </div>

          <div className="space-y-5 pt-2">
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
      </div>
    </section>
  );
}
