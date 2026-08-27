"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardState } from "@/lib/ui-types";

export function useRadianceState(patientId?: string) {
  const [data, setData] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/state${patientId ? `?patientId=${encodeURIComponent(patientId)}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Live state unavailable");
      const next = await response.json() as DashboardState;
      if (active.current) { setData(next); setError(null); }
    } catch (err) { if (active.current) setError(err instanceof Error ? err.message : "Unable to load"); }
  }, [patientId]);
  useEffect(() => {
    active.current = true;
    const initial = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 900);
    return () => { active.current = false; window.clearTimeout(initial); window.clearInterval(timer); };
  }, [refresh]);
  return { data, error, refresh };
}
