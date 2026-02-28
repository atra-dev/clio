"use client";

import { useEffect, useRef, useState } from "react";

function clearTimer(timerRef) {
  if (timerRef.current) {
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

export function useSkeletonLoading(isLoading, minimumMs = 300) {
  const [showSkeleton, setShowSkeleton] = useState(Boolean(isLoading));
  const loadingStartedAtRef = useRef(Boolean(isLoading) ? Date.now() : 0);
  const hideTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      clearTimer(hideTimerRef);
    };
  }, []);

  useEffect(() => {
    const safeMinimum = Number.isFinite(minimumMs) ? Math.max(0, Math.trunc(minimumMs)) : 300;

    if (isLoading) {
      clearTimer(hideTimerRef);
      loadingStartedAtRef.current = Date.now();
      if (!showSkeleton) {
        setShowSkeleton(true);
      }
      return;
    }

    if (!showSkeleton) {
      return;
    }

    const elapsed = Math.max(0, Date.now() - loadingStartedAtRef.current);
    const remaining = Math.max(0, safeMinimum - elapsed);
    clearTimer(hideTimerRef);
    hideTimerRef.current = window.setTimeout(() => {
      setShowSkeleton(false);
      hideTimerRef.current = null;
    }, remaining);

    return () => {
      clearTimer(hideTimerRef);
    };
  }, [isLoading, minimumMs, showSkeleton]);

  return showSkeleton;
}

