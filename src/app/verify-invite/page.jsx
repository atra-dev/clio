"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function InviteVerificationContent() {
  const searchParams = useSearchParams();
  const token = useMemo(() => String(searchParams.get("token") || "").trim(), [searchParams]);
  const [invite, setInvite] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasAutoAttempted, setHasAutoAttempted] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isVerified, setIsVerified] = useState(false);

  const loadInvite = useCallback(async () => {
    if (!token) {
      setErrorMessage("Invite link is invalid or unavailable.");
      setInvite(null);
      setIsVerified(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await fetch(`/api/invite/verify?token=${encodeURIComponent(token)}`, {
        method: "GET",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setInvite(payload?.invite || null);
        setErrorMessage(payload?.message || "Unable to validate invite link.");
        const alreadyVerified = payload?.alreadyVerified === true || payload?.invite?.status === "verified";
        setIsVerified(alreadyVerified);
        if (alreadyVerified) {
          setSuccessMessage(payload?.message || "Invite verification already completed. You can now sign in.");
        }
        return;
      }

      setInvite(payload?.invite || null);
      const alreadyVerified = payload?.alreadyVerified === true || payload?.invite?.status === "verified";
      setIsVerified(alreadyVerified);
      if (alreadyVerified) {
        setSuccessMessage(payload?.message || "Invite verification already completed. You can now sign in.");
      }
    } catch {
      setErrorMessage("Unable to validate invite link.");
      setInvite(null);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadInvite();
  }, [loadInvite]);

  const handleVerifyEmail = useCallback(async () => {
    if (!token || isSubmitting || isVerified) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await fetch("/api/invite/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          action: "verify_email",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setErrorMessage(payload?.message || "Unable to verify invite email.");
        return;
      }

      setInvite(payload?.invite || invite);
      setIsVerified(true);
      setSuccessMessage(payload?.message || "Email verification completed. You can now sign in with Google.");
    } catch {
      setErrorMessage("Unable to verify invite email.");
    } finally {
      setIsSubmitting(false);
    }
  }, [invite, isSubmitting, isVerified, token]);

  useEffect(() => {
    if (isLoading || isVerified || !invite || !token || hasAutoAttempted) {
      return;
    }

    const status = String(invite?.status || "").toLowerCase();
    if (status === "expired" || status === "revoked") {
      return;
    }

    setHasAutoAttempted(true);
    handleVerifyEmail();
  }, [handleVerifyEmail, hasAutoAttempted, invite, isLoading, isVerified, token]);

  const canSubmit = !isLoading && !isSubmitting && !isVerified && Boolean(token);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,#dbeafe_0%,#f8fafc_45%,#fff7ed_100%)] px-4 py-10 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-slate-950/10" />
      <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-2xl items-center justify-center">
        <section className="w-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_32px_90px_-42px_rgba(15,23,42,0.55)]">
          <div className="border-b border-slate-100 bg-[linear-gradient(120deg,#f8fafc_0%,#eff6ff_100%)] px-6 py-5 sm:px-7">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#0f6bcf]">CLIO HRIS Access</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Verify Invite Email
            </h1>
            <p className="mt-1.5 text-sm text-slate-600">
              Confirm this invitation to open your Clio account and continue to secure sign-in.
            </p>
          </div>

          <div className="space-y-4 px-6 py-6 sm:px-7">
            {errorMessage ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
                {errorMessage}
              </p>
            ) : null}

            {successMessage ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">
                {successMessage}
              </p>
            ) : null}

            <div className={`rounded-2xl border bg-white p-4 sm:p-5 ${isVerified ? "border-emerald-200" : "border-slate-200"}`}>
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  This invite link verifies your email and activates your onboarding account.
                </p>
                <button
                  type="button"
                  onClick={handleVerifyEmail}
                  disabled={!canSubmit}
                  className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#0f6bcf] px-4 text-sm font-semibold text-white transition hover:bg-[#0c57aa] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Verifying..." : isVerified ? "Invite Verified" : "Verify Invite and Continue"}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-600">
              <p>
                Invite Status: <span className="font-semibold text-slate-700">{invite?.status || (isLoading ? "Checking..." : "-")}</span>
              </p>
              <p>
                Role: <span className="font-semibold text-slate-700">{invite?.role || "-"}</span>
              </p>
              <p>
                Expires: <span className="font-semibold text-slate-700">{formatDate(invite?.expiresAt)}</span>
              </p>
            </div>

            <Link
              href="/login"
              className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Go to Login
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

function InviteVerificationFallback() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_0%_0%,#dbeafe_0%,#f8fafc_38%,#fff7ed_100%)] px-4 py-10 sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-2xl rounded-3xl border border-[#d7e5f5] bg-white p-8 shadow-[0_32px_70px_-48px_rgba(15,23,42,0.6)] sm:p-10">
        <div className="space-y-3">
          <div className="h-4 w-52 rounded-md bg-slate-200" />
          <div className="h-8 w-full max-w-lg rounded-md bg-slate-200" />
          <div className="h-4 w-full max-w-xl rounded-md bg-slate-200" />
        </div>
      </section>
    </main>
  );
}

export default function InviteVerificationPage() {
  return (
    <Suspense fallback={<InviteVerificationFallback />}>
      <InviteVerificationContent />
    </Suspense>
  );
}
