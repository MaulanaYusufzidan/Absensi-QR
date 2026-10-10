"use client";

import { useState } from "react";
import Link from "next/link";
import { ScanLine, UserCheck, Users } from "lucide-react";
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
import type { Attendance, AttendanceStatus, ClassSummary, DashboardStats } from "@/lib/types";

export default function DashboardPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(todayISO());

  // Data diambil langsung dari Google Sheets via backend Apps Script
  const statsRes = useApi<DashboardStats>("getDashboard", { tanggal: date });
  const classesRes = useApi<ClassSummary[]>("getClasses", { tanggal: date });
  const historyRes = useApi<Attendance[]>("getAttendance", { tanggal: date, limit: 10 });

  const stats = statsRes.data;
  const classes = classesRes.data ?? [];
  const history = historyRes.data ?? [];
  const studentList = stats?.daftarSiswa ?? [];

  const targetClass = user?.role === "ADMIN" ? (stats?.kelas || "Semua Kelas") : (user?.kelas ? `Kelas ${user.kelas}` : "Kelas");
  const belumAbsenCount = stats?.belumAbsen ?? (stats ? Math.max(0, stats.totalSiswa - (stats.hadir + stats.terlambat + stats.izin + stats.sakit + stats.alpha)) : 0);
  const sudahAbsenCount = stats?.sudahAbsen ?? (stats ? (stats.hadir + stats.terlambat + stats.izin + stats.sakit + stats.alpha) : 0);

  const firstError = statsRes.error ?? classesRes.error ?? historyRes.error;

  function reloadAll() {
    statsRes.reload();
    classesRes.reload();
    historyRes.reload();
  }

  return (
    <AppShell title="Dashboard">
      <div className="flex flex-col gap-6">
        {/* Hero Section */}
        <section className="rounded-2xl bg-primary p-6 text-white shadow-sm sm:p-8">
          <p className="text-sm opacity-90">{formatDateID()}</p>
          <h2 className="mt-1 text-2xl font-bold sm:text-3xl">
            Absensi Harian {user?.role === "ADMIN" ? "Sekolah" : targetClass}
          </h2>
          <p className="mt-2 max-w-lg text-sm opacity-90">
            {user?.role === "ADMIN"
              ? `Selamat datang, ${user?.namaGuru}. Pantau dan kelola kehadiran harian seluruh siswa sekolah.`
              : `Selamat datang, ${user?.namaGuru}. Kelola absensi harian untuk siswa ${targetClass} melalui Scan QR atau Absensi Manual.`}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              href="/scan"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-primary shadow-sm hover:bg-white/90 transition-all"
            >
              <ScanLine className="h-4 w-4" aria-hidden /> Scan QR Absensi
            </Link>
            <Link
              href="/manual-attendance"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/20 border border-white/30 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-white/30 backdrop-blur-sm transition-all"
            >
              <UserCheck className="h-4 w-4" aria-hidden /> Absensi Manual
            </Link>
          </div>
        </section>

        {firstError && <ErrorNote message={firstError} onRetry={reloadAll} />}

        {/* Statistik Absensi Harian */}
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8" aria-label="Ringkasan absensi">
          {statsRes.loading ? (
            Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)
          ) : (
            <>
              <StatCard label="Total Siswa" value={stats?.totalSiswa ?? "–"} tone="neutral" />
              <StatCard label="Sudah Absen" value={sudahAbsenCount ?? "–"} tone="primary" />
              <StatCard label="Belum Absen" value={belumAbsenCount ?? "–"} tone="neutral" />
              <StatCard label="Hadir" value={stats?.hadir ?? "–"} tone="success" />
              <StatCard label="Terlambat" value={stats?.terlambat ?? "–"} tone="warning" />
              <StatCard label="Izin" value={stats?.izin ?? "–"} tone="secondary" />
              <StatCard label="Sakit" value={stats?.sakit ?? "–"} tone="secondary" />
              <StatCard label="Alpa" value={stats?.alpha ?? "–"} tone="danger" />
            </>
          )}
        </section>

        {/* Daftar Siswa dan Status Kehadiran Hari Ini */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" aria-label="Status siswa hari ini">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 font-bold text-base">
                <Users className="h-5 w-5 text-primary" aria-hidden />
                Daftar Siswa {targetClass} Hari Ini
              </h3>
              <p className="text-xs text-muted">
                Status kehadiran siswa per tanggal berjalan berdasarkan data Google Sheets.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-gray-100 px-3 py-1 text-xs font-semibold text-muted">
                Kehadiran: {stats?.persentaseKehadiran ?? "0%"}
              </span>
            </div>
          </div>

          {statsRes.loading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : studentList.length === 0 ? (
            <EmptyState
              title="Belum ada data siswa"
              description={`Tidak ditemukan data siswa aktif untuk ${targetClass}.`}
            />
          ) : (
            <div className="max-w-full overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[500px] text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold text-muted">
                  <tr>
                    <th className="px-4 py-3">No</th>
                    <th className="px-4 py-3">NIS</th>
                    <th className="px-4 py-3">Nama Siswa</th>
                    <th className="px-4 py-3">Kelas</th>
                    <th className="px-4 py-3">Status Hari Ini</th>
                    <th className="px-4 py-3">Waktu</th>
                    <th className="px-4 py-3">Keterangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {studentList.map((item, idx) => (
                    <tr key={item.student.nis} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 text-xs text-muted">{idx + 1}</td>
                      <td className="px-4 py-3 font-mono text-xs">{item.student.nis}</td>
                      <td className="px-4 py-3 font-semibold text-foreground">{item.student.nama}</td>
                      <td className="px-4 py-3 text-xs text-muted">Kelas {item.student.kelas}</td>
                      <td className="px-4 py-3">
                        {item.status === "BELUM_ABSEN" ? (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-muted">
                            Belum Absen
                          </span>
                        ) : (
                          <StatusBadge status={item.status as AttendanceStatus} />
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">{item.jam || "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted">{item.keterangan || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Riwayat Absensi */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" aria-label="Riwayat absensi">
          <h3 className="mb-4 font-bold text-base">Riwayat Absensi Siswa</h3>
          <AttendanceHistory selected={date} onSelect={setDate} />
          <div className="mt-5">
            {historyRes.loading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : history.length === 0 ? (
              <EmptyState title="Belum ada absensi" description="Belum ada catatan absensi pada tanggal ini." />
            ) : (
              <ul className="divide-y divide-gray-100">
                {history.map((a) => (
                  <li key={a.idAbsensi} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{a.nama}</p>
                      <p className="text-muted text-xs">
                        Kelas {a.kelas} · {a.jam} {a.keterangan ? `· (${a.keterangan})` : ""}
                      </p>
                    </div>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Kelas Overview (khusus Admin atau multikelas) */}
        {user?.role === "ADMIN" && (
          <section aria-label="Absensi seluruh kelas">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold text-base">Ringkasan Seluruh Kelas</h3>
              <Link href="/attendance" className="text-sm font-semibold text-primary hover:underline">
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
        )}
      </div>
    </AppShell>
  );
}
