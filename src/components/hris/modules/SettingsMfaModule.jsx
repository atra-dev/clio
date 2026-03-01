"use client";

import { useCallback, useEffect, useState } from "react";
import SurfaceCard from "@/components/hris/SurfaceCard";
import { FormSkeleton, LoadingTransition, ProfileSkeleton } from "@/components/hris/shared/Skeletons";

function formatDateTime(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function normalizeProfile(payload) {
  return {
    firstName: String(payload?.firstName || ""),
    middleName: String(payload?.middleName || ""),
    lastName: String(payload?.lastName || ""),
    profilePhotoDataUrl: String(payload?.profilePhotoDataUrl || ""),
    profilePhotoStoragePath: String(payload?.profilePhotoStoragePath || ""),
    phoneVerifiedAt: String(payload?.phoneVerifiedAt || ""),
    phoneLast4: String(payload?.phoneLast4 || ""),
    smsMfaEnabled: Boolean(payload?.smsMfaEnabled),
  };
}

export default function SettingsMfaModule() {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [profile, setProfile] = useState(() => normalizeProfile({}));

  const loadProfile = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/auth/profile", { method: "GET", cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || "Unable to load account security settings.");
      }
      const normalized = normalizeProfile(payload);
      setProfile(normalized);
    } catch (error) {
      setErrorMessage(error?.message || "Unable to load account security settings.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const isPhoneVerified = Boolean(profile.phoneVerifiedAt);
  const statusLabel = isPhoneVerified ? "Enabled" : "Pending setup";

  return (
    <SurfaceCard
      title="Account Security"
      subtitle="Enable SMS MFA for your account sign-in"
    >
      <LoadingTransition
        isLoading={isLoading}
        skeleton={
          <div className="space-y-3">
            <ProfileSkeleton />
            <FormSkeleton fields={4} />
          </div>
        }
      >
        <div className="space-y-4">
          {errorMessage ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {errorMessage}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <article className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <p className="text-xs uppercase tracking-[0.08em] text-slate-500">MFA Status</p>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">{statusLabel}</p>
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                    isPhoneVerified
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {isPhoneVerified ? "Protected" : "Pending"}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-600">
                {isPhoneVerified
                  ? "Firebase SMS multi-factor is configured for this account."
                  : "Complete one sign-in phone setup to enable Firebase MFA."}
              </p>
            </article>

            <article className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Mobile Verification</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                {isPhoneVerified
                  ? `Verified mobile ending in ${profile.phoneLast4 || "****"}`
                  : "No verified mobile number yet"}
              </p>
              <p className="mt-2 text-xs text-slate-600">
                {isPhoneVerified
                  ? `Verified at ${formatDateTime(profile.phoneVerifiedAt)}`
                  : "Complete one login SMS verification first, then enable MFA."}
              </p>
            </article>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-slate-900">Firebase MFA is required</p>
            <p className="mt-1 text-xs text-slate-600">
              MFA controls are managed by Firebase Authentication. CLIO automatically checks your enrolled MFA factor during sign-in.
            </p>
            <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              {isPhoneVerified
                ? "No action needed. Firebase MFA is already configured for this account."
                : "No Firebase MFA factor yet. On next sign-in, CLIO will ask for mobile number and OTP to enroll Firebase MFA."}
            </p>
          </div>
        </div>
      </LoadingTransition>
    </SurfaceCard>
  );
}
