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
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,#dbeafe_0%,#f8fafc_45%,#fff7ed_100%)] px-4 py-10 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-slate-950/10" />
      <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-2xl items-center justify-center">
        <section className="w-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_32px_90px_-42px_rgba(15,23,42,0.55)]">
          <div className="border-b border-slate-100 bg-[linear-gradient(120deg,#f8fafc_0%,#eff6ff_100%)] px-6 py-5 sm:px-7">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#0f6bcf]">CLIO HRIS Access</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              SMS Verification Required
            </h1>
            <p className="mt-1.5 text-sm text-slate-600">
              Add your mobile number and confirm OTP to activate secure account access.
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

            <div className={`rounded-2xl border bg-white p-4 sm:p-5 ${hasOtpSession || isVerified ? "border-sky-200" : "border-slate-200"}`}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Mobile Number</span>
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
                    className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl border border-[#0f6bcf] bg-white px-4 text-sm font-semibold text-[#0f6bcf] transition hover:bg-[#eff6ff] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? "Processing..." : hasOtpSession ? "Resend OTP" : "Send OTP"}
                  </button>
                  {phoneMasked ? (
                    <p className="mt-2 text-xs text-slate-500">
                      OTP sent to: <span className="font-semibold text-slate-700">{phoneMasked}</span>
                    </p>
                  ) : null}
                </div>

                <div className="sm:col-span-2 h-px bg-slate-200" />

                <div className="sm:col-span-2">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">OTP Code</span>
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
                    className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#0f6bcf] px-4 text-sm font-semibold text-white transition hover:bg-[#0c57aa] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? "Verifying..." : isVerified ? "SMS Verified" : "Verify OTP and Continue"}
                  </button>
                </div>
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
              {otpExpiresAt ? <p>OTP Expires: {formatDate(otpExpiresAt)}</p> : null}
              {resendAvailableAt ? <p>Resend Available: {formatDate(resendAvailableAt)}</p> : null}
              {devOtpCode ? <p className="font-semibold text-amber-700">Dev OTP: {devOtpCode}</p> : null}
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
