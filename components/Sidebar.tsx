"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ScanLine,
  UserCheck,
  Users,
  ClipboardList,
  CalendarDays,
  UserCog,
  QrCode,
  Settings,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cx } from "@/lib/utils";
import type { Role } from "@/lib/types";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  roles: Role[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["GURU", "ADMIN"] },
  { href: "/scan", label: "Scan QR", icon: ScanLine, roles: ["GURU", "ADMIN"] },
  { href: "/manual-attendance", label: "Absensi Manual", icon: UserCheck, roles: ["GURU", "ADMIN"] },
  { href: "/attendance", label: "Laporan Absensi", icon: ClipboardList, roles: ["GURU", "ADMIN"] },
  { href: "/schedule", label: "Jadwal", icon: CalendarDays, roles: ["ADMIN"] },
  { href: "/students", label: "Siswa", icon: Users, roles: ["ADMIN"] },
  { href: "/teachers", label: "Guru", icon: UserCog, roles: ["ADMIN"] },
  { href: "/qr", label: "QR Cetak", icon: QrCode, roles: ["ADMIN"] },
  { href: "/settings", label: "Pengaturan", icon: Settings, roles: ["ADMIN"] },
];

export function Sidebar({ mobile, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const role: Role = user?.role ?? "GURU";
  const items = NAV_ITEMS.filter((item) => item.roles.includes(role));

  const roleLabel = role === "ADMIN"
    ? "Administrator"
    : (user?.kelas ? `Wali Kelas ${user.kelas}` : "Wali Kelas");

  return (
    <nav
      className={cx(
        "flex h-full flex-col justify-between bg-white",
        mobile ? "w-full" : "w-64 shrink-0 border-r border-gray-200"
      )}
      aria-label="Navigasi utama"
    >
      <div>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white p-1 ring-1 ring-gray-200">
            <Image
              src="/logo.png"
              alt="Logo SMP IT Dinamika Umat"
              width={36}
              height={36}
              className="h-full w-full object-contain"
            />
          </div>
          <div className="min-w-0">
            <span className="block truncate text-sm font-bold leading-tight text-foreground">
              SMP IT Dinamika Umat
            </span>
            <span className="block text-xs font-semibold text-primary">Sistem Absensi Harian</span>
          </div>
        </div>
        <ul className="flex flex-col gap-1 px-3 mt-3">
          {items.map((item) => {
            const active = pathname?.startsWith(item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                    active ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-gray-100"
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="border-t border-gray-200 p-4">
        <div className="mb-3 px-2">
          <p className="truncate text-sm font-semibold">{user?.namaGuru}</p>
          <p className="text-xs font-medium text-primary">{roleLabel}</p>
        </div>
        <button
          onClick={logout}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-danger hover:bg-danger/10"
        >
          <LogOut className="h-5 w-5" aria-hidden />
          Keluar
        </button>
      </div>
    </nav>
  );
}
