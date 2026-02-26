"use client";

import { useCallback, useEffect, useState } from "react";
import SurfaceCard from "@/components/hris/SurfaceCard";
import { useToast } from "@/components/ui/ToastProvider";

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
  const toast = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [profile, setProfile] = useState(() => normalizeProfile({}));
  const [draftEnabled, setDraftEnabled] = useState(false);

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
      setDraftEnabled(Boolean(normalized.smsMfaEnabled));
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
  const hasChanges = draftEnabled !== Boolean(profile.smsMfaEnabled);
  const canToggle = isPhoneVerified || draftEnabled;
  const statusLabel = draftEnabled ? "Enabled" : "Disabled";

  const handleSave = async () => {
    if (isSaving || !hasChanges) {
      return;
    }
    if (draftEnabled && !isPhoneVerified) {
      toast.error("Verify a mobile number first before enabling SMS MFA.");
      return;
    }

    setIsSaving(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          firstName: profile.firstName,
          middleName: profile.middleName,
          lastName: profile.lastName,
          profilePhotoDataUrl: profile.profilePhotoDataUrl || null,
          profilePhotoStoragePath: profile.profilePhotoStoragePath || null,
          smsMfaEnabled: draftEnabled,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || "Unable to save account security settings.");
      }

      const nextProfile = normalizeProfile(payload?.profile || profile);
      setProfile(nextProfile);
      setDraftEnabled(Boolean(nextProfile.smsMfaEnabled));
      toast.success("MFA preference updated.");
    } catch (error) {
      setErrorMessage(error?.message || "Unable to save account security settings.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggle = () => {
    if (isSaving || !canToggle) {
      return;
    }
    setDraftEnabled((current) => !current);
  };

  return (
    <SurfaceCard
      title="Account Security"
      subtitle="Enable SMS MFA for your account sign-in"
    >
      {isLoading ? (
        <div className="flex justify-center py-4">
          <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" aria-hidden="true" />
        </div>
      ) : (
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
                    draftEnabled
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {draftEnabled ? "Protected" : "Standard"}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-600">
                {draftEnabled
                  ? "A code will be required on every sign-in."
                  : "Sign-in uses standard workspace verification."}
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
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">Enable SMS MFA for every sign-in</p>
                <p className="text-xs text-slate-600">
                  Add an OTP checkpoint each time this account signs in.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draftEnabled}
                onClick={handleToggle}
                disabled={isSaving || !canToggle}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
                  draftEnabled ? "bg-sky-600" : "bg-slate-300"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                    draftEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            {!isPhoneVerified ? (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Mobile verification is required before enabling MFA.
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {hasChanges ? "Unsaved security changes." : "No pending changes."}
            </p>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-70"
            >
              {isSaving ? "Saving..." : "Save MFA Setting"}
            </button>
          </div>
        </div>
      )}
    </SurfaceCard>
  );
}
