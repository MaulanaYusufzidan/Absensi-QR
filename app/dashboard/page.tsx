"use client";

import { useState } from "react";
import Link from "next/link";
import { ScanLine, CalendarDays, UserCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { StatCard } from "@/components/StatCard";
import { ClassCard } from "@/components/ClassCard";
import { AttendanceHistory } from "@/components/AttendanceHistory";
import { Skeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { ErrorNote } from "@/components/ErrorNote";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { formatDateID, todayISO } from "@/lib/utils";
import type { Attendance, AttendanceSession, ClassSummary, DashboardStats, Schedule } from "@/lib/types";

export default function DashboardPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(todayISO());

  // Every number on this page comes from these API calls (Google Sheets via Apps Script).
  const stats = useApi<DashboardStats>("getDashboard", { tanggal: date });
  const classesRes = useApi<ClassSummary[]>("getClasses", { tanggal: date });
  const historyRes = useApi<Attendance[]>("getAttendance", { tanggal: date, limit: 10 });
  const scheduleRes = useApi<Schedule[]>("getTodaySchedule", {});
  const activeSessionRes = useApi<AttendanceSession | null>("getActiveSession", {});

  const classes = classesRes.data ?? [];
  const history = historyRes.data ?? [];
  const todaySchedule = scheduleRes.data ?? [];
  const activeSession = activeSessionRes.data ?? null;
  const belumHadir = classesRes.data ? classesRes.data.reduce((sum, c) => sum + c.belumHadir, 0) : null;
  const firstError = stats.error ?? classesRes.error ?? historyRes.error ?? scheduleRes.error;

  function reloadAll() {
    stats.reload();
    classesRes.reload();
    historyRes.reload();
    scheduleRes.reload();
    activeSessionRes.reload();
  }

  return (
    <AppShell title="Dashboard">
      <div className="flex flex-col gap-6">
        <section className="rounded-2xl bg-primary p-6 text-white shadow-sm sm:p-8">
          <p className="text-sm opacity-90">{formatDateID()}</p>
          <h2 className="mt-1 text-2xl font-bold sm:text-3xl">Absensi Siswa</h2>
          <p className="mt-2 max-w-md text-sm opacity-90">
            Kelola kehadiran siswa dengan cepat melalui Scan QR atau Absensi Manual.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              href="/scan"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-primary shadow-sm hover:bg-white/90"
            >
              <ScanLine className="h-4 w-4" aria-hidden /> Scan QR Absensi
            </Link>
            <Link
              href="/manual-attendance"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/20 border border-white/30 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-white/30 backdrop-blur-sm"
            >
              <UserCheck className="h-4 w-4" aria-hidden /> Absensi Manual
            </Link>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-label="Jadwal hari ini">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-bold">
              <CalendarDays className="h-5 w-5 text-primary" aria-hidden />
              Jadwal Hari Ini{user ? ` — ${user.namaGuru}` : ""}
            </h3>
            <Link href="/schedule" className="text-xs font-semibold text-primary hover:underline">
              Kelola Jadwal
            </Link>
          </div>
          {scheduleRes.loading || activeSessionRes.loading ? (
            <Skeleton className="h-12 w-full" />
          ) : todaySchedule.length === 0 ? (
            <p className="text-sm text-muted">Tidak ada jadwal mengajar hari ini.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {todaySchedule.map((s) => {
                const isActive = activeSession?.idJadwal === s.idJadwal && activeSession?.status === "ACTIVE";
                return (
                  <li
                    key={s.idJadwal}
                    className="flex flex-col gap-3 rounded-xl bg-gray-50 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-foreground">
                          {s.jamMulai}–{s.jamSelesai}
                        </span>
                        <span className="rounded-md bg-white px-2 py-0.5 text-xs font-semibold text-muted border border-gray-200">
                          Kelas {s.kelas}
                        </span>
                        <span className="font-semibold text-primary">{s.mataPelajaran}</span>
                        {isActive ? (
                          <span className="inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
                            Sesi Aktif
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-muted">
                            Belum Dimulai
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        ID: {s.idJadwal} {s.namaGuru ? `· ${s.namaGuru}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Link
                        href={`/scan?idJadwal=${s.idJadwal}`}
                        className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold shadow-sm transition-all ${
                          isActive
                            ? "bg-success text-white hover:brightness-110"
                            : "bg-primary text-white hover:bg-primary-dark"
                        }`}
                      >
                        <ScanLine className="h-3.5 w-3.5" aria-hidden />
                        {isActive ? "Lanjut Scan" : "Scan QR"}
                      </Link>
                      <Link
                        href={`/manual-attendance?idJadwal=${s.idJadwal}`}
                        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3.5 text-xs font-semibold text-foreground shadow-sm hover:bg-gray-100 transition-all"
                      >
                        <UserCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
                        Manual
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {firstError && <ErrorNote message={firstError} onRetry={reloadAll} />}

        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-7" aria-label="Ringkasan absensi">
          {stats.loading || classesRes.loading ? (
            Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-28" />)
          ) : (
            <>
              <StatCard label="Total Siswa" value={stats.data?.totalSiswa ?? "–"} tone="neutral" />
              <StatCard label="Hadir" value={stats.data?.hadir ?? "–"} tone="success" />
              <StatCard label="Terlambat" value={stats.data?.terlambat ?? "–"} tone="warning" />
              <StatCard label="Izin" value={stats.data?.izin ?? "–"} tone="secondary" />
              <StatCard label="Sakit" value={stats.data?.sakit ?? "–"} tone="secondary" />
              <StatCard label="Alpha" value={stats.data?.alpha ?? "–"} tone="danger" />
              <StatCard label="Belum Hadir" value={belumHadir ?? "–"} tone="neutral" />
            </>
          )}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-label="Riwayat absensi">
          <h3 className="mb-4 font-bold">Riwayat Absensi Siswa</h3>
          <AttendanceHistory selected={date} onSelect={setDate} />
          <div className="mt-5">
            {historyRes.loading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : history.length === 0 ? (
              <EmptyState title="Belum ada absensi" description="Belum ada data absensi pada tanggal ini." />
            ) : (
              <ul className="divide-y divide-gray-100">
                {history.map((a) => (
                  <li key={a.idAbsensi} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{a.nama}</p>
                      <p className="text-muted">
                        Kelas {a.kelas} · {a.mataPelajaran} · {a.jam}
                      </p>
                    </div>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section aria-label="Absensi kelas">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-bold">Absensi Kelas</h3>
            <Link href="/attendance" className="text-sm font-semibold text-primary">
              Lihat Selengkapnya
            </Link>
          </div>
          {classesRes.loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-40" />
              ))}
            </div>
          ) : classes.length === 0 ? (
            <EmptyState title="Belum ada kelas" description="Data kelas diambil dari sheet SISWA." />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {classes.map((c) => (
                <ClassCard key={c.kelas} cls={c} />
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
