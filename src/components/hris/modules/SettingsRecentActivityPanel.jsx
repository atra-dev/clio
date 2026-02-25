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
      subtitle="Your latest account events and access history"
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
        <ul className="space-y-2">
          {recentActivity.map((item) => (
            <li
              key={item?.id || `${item?.activityName}-${item?.loggedAt}`}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <p className="text-xs font-semibold text-slate-900">{String(item?.activityName || "Activity")}</p>
              <p className="mt-1 text-[11px] text-slate-600">
                {String(item?.module || "System")} | {String(item?.status || "Completed")} |{" "}
                {item?.relativeTime || formatDateTime(item?.loggedAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </SurfaceCard>
  );
}
