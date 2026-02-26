"use client";

import { useEffect, useState } from "react";
import SurfaceCard from "@/components/hris/SurfaceCard";

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
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

function getStatusTone(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "failed" || normalized === "rejected") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (normalized === "pending") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export default function SettingsRecentActivityPanel() {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [recentActivity, setRecentActivity] = useState([]);

  useEffect(() => {
    let isMounted = true;
    const loadActivity = async () => {
      setIsLoading(true);
      setErrorMessage("");
      try {
        const response = await fetch("/api/auth/profile/activity", { method: "GET", cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.message || "Unable to load recent account activity.");
        }
        if (!isMounted) {
          return;
        }
        setRecentActivity(Array.isArray(payload?.recentActivity) ? payload.recentActivity : []);
      } catch (error) {
        if (isMounted) {
          setErrorMessage(error?.message || "Unable to load recent account activity.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadActivity();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <SurfaceCard
      title="Recent Account Activity"
      subtitle="Latest security and session events for this account"
    >
      {isLoading ? (
        <div className="flex justify-center py-4">
          <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" aria-hidden="true" />
        </div>
      ) : errorMessage ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {errorMessage}
        </p>
      ) : recentActivity.length === 0 ? (
        <p className="text-xs text-slate-500">No recent account activity.</p>
      ) : (
        <ul className="space-y-2.5">
          {recentActivity.map((item) => (
            <li
              key={item?.id || `${item?.activityName}-${item?.loggedAt}`}
              className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-900">{String(item?.activityName || "Activity")}</p>
                  <p className="text-[11px] text-slate-600">
                    {String(item?.module || "System")} | {item?.relativeTime || formatDateTime(item?.loggedAt)}
                  </p>
                </div>
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${getStatusTone(
                    item?.status,
                  )}`}
                >
                  {String(item?.status || "Completed")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SurfaceCard>
  );
}
