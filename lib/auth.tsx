"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import { AUTH_EXPIRED_EVENT, callApi } from "./api";
import type { AuthUser } from "./types";

const STORAGE_KEY = "qr_attendance_auth";

/* ---- localStorage-backed external store (no setState-in-effect needed) ---- */

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** Returns the raw stored session, or null when missing/expired/unreadable. */
function getSnapshot(): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    if (!parsed.token || !parsed.expiresAt || parsed.expiresAt < Date.now()) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

const getServerSnapshot = (): string | null => null;
const noopSubscribe = () => () => {};

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; message?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // false during SSR/hydration, true on the client afterwards.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );

  const user = useMemo<AuthUser | null>(() => (raw ? (JSON.parse(raw) as AuthUser) : null), [raw]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await callApi<AuthUser>("login", { username, password });
    if (res.success) {
      // The server response never contains the password or its hash; only the session token.
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(res.data));
      } catch {
        return { ok: false, message: "Browser menolak menyimpan sesi login." };
      }
      emit();
      return { ok: true };
    }
    return { ok: false, message: res.message };
  }, []);

  const logout = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    emit();
  }, []);

  // The server is the security boundary: when it rejects our token, drop the session.
  useEffect(() => {
    window.addEventListener(AUTH_EXPIRED_EVENT, logout);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, logout);
  }, [logout]);

  const value = useMemo(
    () => ({ user, loading: !hydrated, login, logout }),
    [user, hydrated, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Redirect to /login if there is no active session. Client-side UX only; the server enforces access. */
export function useRequireAuth() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  return { user, loading };
}
