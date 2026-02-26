"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
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

function InviteVerificationContent() {
  const searchParams = useSearchParams();
  const token = useMemo(() => String(searchParams.get("token") || "").trim(), [searchParams]);
  const [invite, setInvite] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isVerified, setIsVerified] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpExpiresAt, setOtpExpiresAt] = useState("");
  const [resendAvailableAt, setResendAvailableAt] = useState("");
  const [devOtpCode, setDevOtpCode] = useState("");
  const [phoneMasked, setPhoneMasked] = useState("");

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
        setIsVerified(payload?.alreadyVerified === true);
        return;
      }

      setInvite(payload?.invite || null);
      setPhoneMasked(String(payload?.invite?.verification?.phoneMasked || ""));
      const alreadyVerified = payload?.alreadyVerified === true;
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

  const handleRequestOtp = async () => {
    if (!token || isSubmitting || isVerified) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    setDevOtpCode("");
    try {
      const response = await fetch("/api/invite/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          action: "start_sms",
          phoneNumber,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setErrorMessage(payload?.message || "Unable to send OTP.");
        return;
      }

      setInvite(payload?.invite || invite);
      setOtpExpiresAt(String(payload?.otpExpiresAt || ""));
      setResendAvailableAt(String(payload?.resendAvailableAt || ""));
      setDevOtpCode(String(payload?.devOtpCode || ""));
      setPhoneMasked(String(payload?.phoneMasked || payload?.invite?.verification?.phoneMasked || ""));
      if (payload?.alreadyVerified) {
        setIsVerified(true);
      }
      setSuccessMessage(payload?.message || "OTP sent. Enter the code to complete verification.");
    } catch {
      setErrorMessage("Unable to send OTP.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyOtp = async () => {
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
          action: "complete_sms",
          otpCode,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setErrorMessage(payload?.message || "Unable to verify OTP.");
        return;
      }
      setInvite(payload?.invite || invite);
      setIsVerified(true);
      setSuccessMessage(payload?.message || "SMS verification completed. You can now sign in.");
    } catch {
      setErrorMessage("Unable to verify OTP.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit = !isLoading && !isSubmitting && !isVerified && Boolean(token);
  const canRequestOtp = canSubmit && phoneNumber.trim().length > 0;
  const canVerifyOtp = canSubmit && otpCode.trim().length === 6;
  const hasOtpSession = Boolean(otpExpiresAt || resendAvailableAt || phoneMasked);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_0%_0%,#dbeafe_0%,#f8fafc_38%,#fff7ed_100%)] px-4 py-10 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute -left-20 top-24 h-52 w-52 rounded-full bg-sky-100/70 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 bottom-20 h-48 w-48 rounded-full bg-amber-100/70 blur-3xl" />

      <section className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-[#d7e5f5] bg-white shadow-[0_32px_70px_-48px_rgba(15,23,42,0.6)]">
        <div className="pointer-events-none absolute left-0 right-0 top-0 h-1.5 bg-[linear-gradient(90deg,#0284c7_0%,#0f6bcf_45%,#f97316_100%)]" />

        <div className="grid gap-0 lg:grid-cols-[1.15fr_1fr]">
          <aside className="border-b border-slate-200/70 bg-[linear-gradient(160deg,#f0f7ff_0%,#ffffff_72%)] p-7 sm:p-9 lg:border-b-0 lg:border-r">
            <BrandMark compact />

            <div className="mt-7 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#0f6bcf]">Invite Verification</p>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Secure your CLIO account with SMS OTP</h1>
              <p className="text-sm text-slate-600">
                Complete phone verification once to unlock Google sign-in for this invited workspace account.
              </p>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white/85 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Verification Checklist</p>
              <ol className="mt-3 space-y-2.5 text-sm text-slate-700">
                <li className="flex items-start gap-2.5">
                  <span className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${hasOtpSession || isVerified ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>1</span>
                  <span>Enter your mobile number and request an OTP.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${isVerified ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>2</span>
                  <span>Submit the 6-digit code to complete SMS verification.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${isVerified ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>3</span>
                  <span>Sign in with Google using your invited work email.</span>
                </li>
              </ol>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-white/80 p-4">
              <dl className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Invite Status</dt>
                  <dd className="mt-1 font-medium text-slate-900">{invite?.status || (isLoading ? "Checking..." : "-")}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Role</dt>
                  <dd className="mt-1 font-medium text-slate-900">{invite?.role || "-"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Invited</dt>
                  <dd className="mt-1 font-medium text-slate-900">{formatDate(invite?.invitedAt)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Expires</dt>
                  <dd className="mt-1 font-medium text-slate-900">{formatDate(invite?.expiresAt)}</dd>
                </div>
              </dl>
            </div>
          </aside>

          <div className="p-7 sm:p-9">
            {errorMessage ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{errorMessage}</p>
            ) : null}

            {successMessage ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">
                {successMessage}
              </p>
            ) : null}

            <div className={`${errorMessage || successMessage ? "mt-4" : ""} space-y-4`}>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Step 1</p>
                <h2 className="mt-1 text-base font-semibold text-slate-900">Add mobile number</h2>
                <p className="mt-1 text-xs text-slate-600">Use an active number with country code to receive the OTP.</p>

                <label className="mt-4 block space-y-1.5">
                  <span className="text-xs uppercase tracking-[0.08em] text-slate-500">Mobile Number</span>
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(event) => setPhoneNumber(event.target.value)}
                    placeholder="+639171234567"
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
                    disabled={isSubmitting || isVerified}
                  />
                </label>

                <button
                  type="button"
                  onClick={handleRequestOtp}
                  disabled={!canRequestOtp}
                  className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl border border-[#0f6bcf] bg-white px-5 text-sm font-semibold text-[#0f6bcf] transition hover:bg-[#eff6ff] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Processing..." : hasOtpSession ? "Resend OTP" : "Send OTP"}
                </button>

                {phoneMasked ? (
                  <p className="mt-3 text-xs text-slate-500">Latest OTP target: <span className="font-semibold text-slate-700">{phoneMasked}</span></p>
                ) : null}
              </div>

              <div className={`rounded-2xl border bg-white p-4 ${hasOtpSession || isVerified ? "border-sky-200" : "border-slate-200 opacity-70"}`}>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Step 2</p>
                <h2 className="mt-1 text-base font-semibold text-slate-900">Confirm OTP code</h2>
                <p className="mt-1 text-xs text-slate-600">Enter the 6-digit code sent to your mobile number.</p>

                <label className="mt-4 block space-y-1.5">
                  <span className="text-xs uppercase tracking-[0.08em] text-slate-500">OTP Code</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpCode}
                    onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="6-digit code"
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm tracking-[0.16em] text-slate-900 placeholder:tracking-normal placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
                    disabled={isSubmitting || isVerified}
                  />
                </label>

                <button
                  type="button"
                  onClick={handleVerifyOtp}
                  disabled={!canVerifyOtp}
                  className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#0f6bcf] px-5 text-sm font-semibold text-white transition hover:bg-[#0c57aa] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Verifying..." : isVerified ? "SMS Verified" : "Verify OTP"}
                </button>
              </div>

              <div className="flex flex-col gap-2.5 sm:flex-row">
                <Link
                  href="/login"
                  className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Go to Login
                </Link>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-600">
              {otpExpiresAt ? <p>OTP Expires: {formatDate(otpExpiresAt)}</p> : null}
              {resendAvailableAt ? <p>Resend Available: {formatDate(resendAvailableAt)}</p> : null}
              {devOtpCode ? <p className="font-semibold text-amber-700">Dev OTP: {devOtpCode}</p> : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function InviteVerificationFallback() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_0%_0%,#dbeafe_0%,#f8fafc_38%,#fff7ed_100%)] px-4 py-10 sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-5xl rounded-3xl border border-[#d7e5f5] bg-white p-8 shadow-[0_32px_70px_-48px_rgba(15,23,42,0.6)] sm:p-10">
        <BrandMark compact />
        <div className="mt-6 space-y-3">
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
