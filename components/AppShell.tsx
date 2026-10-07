"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { useRequireAuth } from "@/lib/auth";
import type { Role } from "@/lib/types";

/**
 * Authenticated page frame (sidebar + header). `requireRole` is a UX guard only:
 * the Apps Script backend enforces roles on every request.
 */
export function AppShell({
  title,
  children,
  requireRole,
}: {
  title: string;
  children: React.ReactNode;
  requireRole?: Role;
}) {
  const { user, loading } = useRequireAuth();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && user && requireRole && user.role !== requireRole) {
      router.replace("/dashboard");
    }
  }, [loading, user, requireRole, router]);

  if (loading || !user || (requireRole && user.role !== requireRole)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-72 shadow-xl">
            <Sidebar mobile onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-200 bg-white/80 px-4 py-3 backdrop-blur sm:px-6">
          <button
            className="rounded-lg p-2 hover:bg-gray-100 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Buka menu"
          >
            <Menu className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-bold sm:text-xl">{title}</h1>
        </header>
        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
