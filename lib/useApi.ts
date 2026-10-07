"use client";

import { useCallback, useEffect, useState } from "react";
import { callApi, type ApiAction } from "./api";
import { useAuth } from "./auth";
import type { ApiResponse } from "./types";

/**
 * Shared fetch hook for all authenticated pages.
 *
 * Loading is DERIVED (request key !== settled key) instead of toggled with
 * setState inside the effect, so state is only set asynchronously after the
 * response arrives. Pass `payload = null` to skip the request.
 */
export function useApi<T>(action: ApiAction, payload: Record<string, unknown> | null) {
  const { user } = useAuth();
  const token = user?.token ?? null;
  const [version, setVersion] = useState(0);
  const [settled, setSettled] = useState<{ key: string; res: ApiResponse<T> } | null>(null);

  const payloadKey = payload === null ? null : JSON.stringify(payload);
  const key = token && payloadKey !== null ? `${action}|${payloadKey}|${version}` : null;

  useEffect(() => {
    if (!key || !token || payloadKey === null) return;
    let cancelled = false;
    callApi<T>(action, JSON.parse(payloadKey) as Record<string, unknown>, token).then((res) => {
      if (!cancelled) setSettled({ key, res });
    });
    return () => {
      cancelled = true;
    };
  }, [key, token, action, payloadKey]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  const current = key !== null && settled?.key === key ? settled.res : null;
  return {
    loading: key !== null && current === null,
    data: current && current.success ? current.data : null,
    error: current && !current.success ? current.message : null,
    reload,
  };
}
