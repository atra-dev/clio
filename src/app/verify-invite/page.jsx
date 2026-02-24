"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import BrandMark from "@/components/ui/BrandMark";

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

export default function InviteVerificationPage() {
  const searchParams = useSearchParams();
  const token = useMemo(() => String(searchParams.get("token") || "").trim(), [searchParams]);
  const [invite, setInvite] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isVerified, setIsVerified] = useState(false);

  const loadInvite = useCallback(async () => {
    if (!token) {
      setErrorMessage("Invite link is invalid or unavailable.");
      setInvite(null);
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
        setIsVerified(payload?.invite?.status === "verified");
        return;
      }

      setInvite(payload?.invite || null);
      const alreadyVerified = payload?.alreadyVerified === true || payload?.invite?.status === "verified";
      setIsVerified(alreadyVerified);
      if (alreadyVerified) {
        setSuccessMessage(payload?.message || "Invite email is already verified. You can now sign in.");
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

  const handleVerify = async () => {
    if (!token || isSubmitting) {
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
        body: JSON.stringify({ token }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setErrorMessage(payload?.message || "Unable to complete email verification.");
        return;
      }

      setInvite(payload?.invite || invite);
      setIsVerified(true);
      setSuccessMessage(payload?.message || "Email verification completed. You can now sign in with Google.");
    } catch {
      setErrorMessage("Unable to complete email verification.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit = !isLoading && !isSubmitting && !isVerified && Boolean(token);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
      <section className="w-full rounded-3xl border border-[#d7e5f5] bg-white p-8 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.55)] sm:p-10">
        <BrandMark compact />

        <div className="mt-6 space-y-2">
          <p className="text-sm font-semibold uppercase tracking-[0.15em] text-[#0f6bcf]">Invitation Verification</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Verify your CLIO account email</h1>
          <p className="text-sm text-slate-600">
            Complete this verification step first. After this, Google sign-in will be enabled for your invited account.
          </p>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <dl className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-[0.08em] text-slate-500">Invite Status</dt>
              <dd className="mt-1 font-medium text-slate-900">{invite?.status || (isLoading ? "Checking..." : "-")}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.08em] text-slate-500">Role</dt>
              <dd className="mt-1 font-medium text-slate-900">{invite?.role || "-"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.08em] text-slate-500">Invited</dt>
              <dd className="mt-1 font-medium text-slate-900">{formatDate(invite?.invitedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.08em] text-slate-500">Expires</dt>
              <dd className="mt-1 font-medium text-slate-900">{formatDate(invite?.expiresAt)}</dd>
            </div>
          </dl>
        </div>

        {errorMessage ? (
          <p className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p>
        ) : null}

        {successMessage ? (
          <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {successMessage}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleVerify}
            disabled={!canSubmit}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-[#0f6bcf] px-5 text-sm font-semibold text-white transition hover:bg-[#0c57aa] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Verifying..." : isVerified ? "Email Verified" : "Verify Email"}
          </button>

          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Go to Login
          </Link>
        </div>
      </section>
    </main>
  );
}
