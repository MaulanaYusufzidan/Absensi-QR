"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  UserCheck,
  CalendarDays,
  ScanLine,
  Save,
  CheckCheck,
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { Select } from "@/components/Select";
import { Input } from "@/components/Input";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/Skeleton";
import { ErrorNote } from "@/components/ErrorNote";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/Toast";
import { callApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { formatDateID, todayISO } from "@/lib/utils";
import type { AttendanceSession, AttendanceStatus, Schedule, SessionStudentItem } from "@/lib/types";

export default function ManualAttendancePage() {
  return (
    <AppShell title="Absensi Manual">
      <Suspense fallback={<div className="p-8 text-center text-sm text-muted">Memuat halaman absensi manual...</div>}>
        <ManualAttendanceContent />
      </Suspense>
    </AppShell>
  );
}

interface StudentFormRow {
  student: SessionStudentItem["student"];
  existingAttendance: SessionStudentItem["attendance"];
  status: AttendanceStatus | "BELUM_ABSEN";
  keterangan: string;
  isModified: boolean;
}

function ManualAttendanceContent() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const paramJadwal = searchParams.get("idJadwal") ?? "";
  const [selectedJadwalId, setSelectedJadwalId] = useState<string>(paramJadwal);
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [formRows, setFormRows] = useState<StudentFormRow[]>([]);
  const [loadingSession, setLoadingSession] = useState(false);
  const [savingBulk, setSavingBulk] = useState(false);
  const [search, setSearch] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Schedules for today
  const schedRes = useApi<Schedule[]>("getTodaySchedule", {});
  const todaySchedules = useMemo(() => schedRes.data ?? [], [schedRes.data]);

  const activeSchedule = useMemo(() => {
    return todaySchedules.find((s) => s.idJadwal === selectedJadwalId) ?? null;
  }, [todaySchedules, selectedJadwalId]);

  // Sync parameter if URL has idJadwal
  useEffect(() => {
    if (paramJadwal && paramJadwal !== selectedJadwalId) {
      setSelectedJadwalId(paramJadwal);
    }
  }, [paramJadwal, selectedJadwalId]);

  // Load or start session for the selected schedule and load student list
  const loadClassAttendance = useCallback(
    async (idJadwal: string) => {
      if (!user || !idJadwal) return;
      setLoadingSession(true);
      setErrorMsg(null);

      try {
        // Start or retrieve active session for this schedule
        const startRes = await callApi<AttendanceSession>(
          "startAttendanceSession",
          { idJadwal },
          user.token
        );

        if (!startRes.success) {
          setErrorMsg(startRes.message || "Gagal membuka sesi absensi untuk jadwal ini.");
          setLoadingSession(false);
          return;
        }

        const activeSes = startRes.data;
        setSession(activeSes);

        // Fetch students & attendance for this session
        const detailsRes = await callApi<{ session: AttendanceSession; items: SessionStudentItem[] }>(
          "getSessionAttendance",
          { idSesi: activeSes.idSesi },
          user.token
        );

        if (!detailsRes.success) {
          setErrorMsg(detailsRes.message || "Gagal memuat data siswa kelas ini.");
          setLoadingSession(false);
          return;
        }

        // Initialize form rows with existing attendance or default to HADIR / BELUM_ABSEN
        const rows: StudentFormRow[] = detailsRes.data.items.map((item) => ({
          student: item.student,
          existingAttendance: item.attendance,
          status: item.attendance ? item.attendance.status : "HADIR",
          keterangan: item.attendance?.keterangan || "",
          isModified: false,
        }));

        setFormRows(rows);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Terjadi kesalahan saat memuat data.";
        setErrorMsg(msg);
      } finally {
        setLoadingSession(false);
      }
    },
    [user]
  );

  useEffect(() => {
    if (selectedJadwalId) {
      loadClassAttendance(selectedJadwalId);
    } else {
      setSession(null);
      setFormRows([]);
    }
  }, [selectedJadwalId, loadClassAttendance]);

  function handleScheduleChange(id: string) {
    setSelectedJadwalId(id);
    if (id) {
      router.replace(`/manual-attendance?idJadwal=${encodeURIComponent(id)}`);
    } else {
      router.replace("/manual-attendance");
    }
  }

  function handleStatusChange(nis: string, status: AttendanceStatus) {
    setFormRows((prev) =>
      prev.map((r) => {
        if (r.student.nis === nis) {
          return { ...r, status, isModified: true };
        }
        return r;
      })
    );
  }

  function handleKeteranganChange(nis: string, keterangan: string) {
    setFormRows((prev) =>
      prev.map((r) => {
        if (r.student.nis === nis) {
          return { ...r, keterangan, isModified: true };
        }
        return r;
      })
    );
  }

  // Quick action: set all students to HADIR
  function markAllHadir() {
    setFormRows((prev) =>
      prev.map((r) => ({
        ...r,
        status: "HADIR",
        isModified: true,
      }))
    );
    toast("info", "Semua siswa ditandai Hadir. Klik 'Simpan Semua' untuk menyimpan.");
  }

  // Bulk save all attendance rows
  async function handleSaveBulk() {
    if (!user || !selectedJadwalId || formRows.length === 0) return;
    setSavingBulk(true);

    try {
      const today = todayISO();
      let successCount = 0;
      let failCount = 0;

      // Save each student's attendance
      for (const row of formRows) {
        const statusToSave = row.status === "BELUM_ABSEN" ? "HADIR" : row.status;
        const res = await callApi(
          "updateAttendanceStatus",
          {
            idAbsensi: row.existingAttendance?.idAbsensi,
            idJadwal: selectedJadwalId,
            nis: row.student.nis,
            status: statusToSave,
            keterangan: row.keterangan,
            tanggal: today,
          },
          user.token
        );

        if (res.success) {
          successCount++;
        } else {
          failCount++;
        }
      }

      if (failCount === 0) {
        toast("success", `Berhasil menyimpan absensi ${successCount} siswa.`);
      } else {
        toast("info", `Tersimpan ${successCount} siswa, gagal ${failCount} siswa.`);
      }

      // Reload fresh data from backend
      await loadClassAttendance(selectedJadwalId);
    } catch {
      toast("error", "Terjadi kesalahan saat menyimpan absensi bulk.");
    } finally {
      setSavingBulk(false);
    }
  }

  // Filtered rows
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return formRows;
    return formRows.filter(
      (r) =>
        r.student.nama.toLowerCase().includes(q) ||
        r.student.nis.toLowerCase().includes(q)
    );
  }, [formRows, search]);

  // Stats calculation
  const stats = useMemo(() => {
    let hadir = 0;
    let izin = 0;
    let sakit = 0;
    let alpha = 0;
    let terlambat = 0;
    let belumAbsen = 0;

    formRows.forEach((r) => {
      if (r.status === "HADIR") hadir++;
      else if (r.status === "TERLAMBAT") terlambat++;
      else if (r.status === "IZIN") izin++;
      else if (r.status === "SAKIT") sakit++;
      else if (r.status === "ALPHA") alpha++;
      else belumAbsen++;
    });

    return { total: formRows.length, hadir, izin, sakit, alpha, terlambat, belumAbsen };
  }, [formRows]);

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header Card */}
      <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UserCheck className="h-5 w-5" />
            </span>
            <h2 className="text-lg font-bold text-foreground">Input Absensi Manual Siswa</h2>
          </div>
          <p className="mt-1 text-xs text-muted">
            {formatDateID()} · Pilih jadwal kelas untuk menandai kehadiran siswa secara langsung.
          </p>
        </div>

        {selectedJadwalId && (
          <div className="flex items-center gap-2">
            <Link
              href={`/scan?idJadwal=${selectedJadwalId}`}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-foreground hover:bg-gray-100 transition-colors"
            >
              <ScanLine className="h-3.5 w-3.5 text-primary" />
              Mode Scan QR
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadClassAttendance(selectedJadwalId)}
              disabled={loadingSession}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingSession ? "animate-spin" : ""}`} />
              Muat Ulang
            </Button>
          </div>
        )}
      </div>

      {/* Schedule Selector Card */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <label htmlFor="select-jadwal" className="mb-2 block text-sm font-semibold text-foreground">
          Pilih Jadwal Mengajar Hari Ini
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Select
              id="select-jadwal"
              value={selectedJadwalId}
              onChange={(e) => handleScheduleChange(e.target.value)}
              disabled={schedRes.loading}
            >
              <option value="">-- Pilih Jadwal --</option>
              {todaySchedules.map((s) => (
                <option key={s.idJadwal} value={s.idJadwal}>
                  Kelas {s.kelas} — {s.mataPelajaran} ({s.jamMulai}–{s.jamSelesai})
                  {s.namaGuru ? ` [${s.namaGuru}]` : ""}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Link
              href="/schedule"
              className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-4 text-xs font-semibold text-muted hover:text-foreground hover:bg-gray-100"
            >
              <CalendarDays className="h-4 w-4" />
              Kelola Semua Jadwal
            </Link>
          </div>
        </div>

        {activeSchedule && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-primary/5 border border-primary/20 p-3 text-xs">
            <span className="font-bold text-primary">Kelas {activeSchedule.kelas}</span>
            <span className="text-muted">·</span>
            <span className="font-semibold text-foreground">{activeSchedule.mataPelajaran}</span>
            <span className="text-muted">·</span>
            <span className="text-muted flex items-center gap-1">
              <Clock className="h-3 w-3" /> {activeSchedule.jamMulai}–{activeSchedule.jamSelesai} WIB
            </span>
            {activeSchedule.namaGuru && (
              <>
                <span className="text-muted">·</span>
                <span className="text-muted">Guru: {activeSchedule.namaGuru}</span>
              </>
            )}
            {session && (
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 font-semibold text-success">
                <CheckCircle2 className="h-3 w-3" /> Sesi Absensi Aktif
              </span>
            )}
          </div>
        )}
      </div>

      {errorMsg && <ErrorNote message={errorMsg} onRetry={() => selectedJadwalId && loadClassAttendance(selectedJadwalId)} />}

      {!selectedJadwalId ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-muted">
            <CalendarDays className="h-6 w-6" />
          </div>
          <h3 className="mt-3 text-base font-bold text-foreground">Silakan Pilih Jadwal Terlebih Dahulu</h3>
          <p className="mt-1 max-w-sm text-xs text-muted">
            Pilih salah satu jadwal mengajar hari ini pada menu di atas untuk menampilkan daftar siswa dan menginput absensi.
          </p>
        </div>
      ) : loadingSession ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-muted">
            <RefreshCw className="h-4 w-4 animate-spin text-primary" />
            <span>Memuat data siswa kelas...</span>
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : formRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 bg-white p-12 text-center">
          <AlertCircle className="h-8 w-8 text-warning" />
          <h3 className="mt-3 font-bold text-foreground">Tidak Ada Siswa Ditemukan</h3>
          <p className="mt-1 max-w-sm text-xs text-muted">
            Tidak ditemukan siswa aktif di kelas {activeSchedule?.kelas}. Pastikan data siswa pada sheet SISWA sudah diisi.
          </p>
        </div>
      ) : (
        <>
          {/* Summary Stats Cards */}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Statistik Kehadiran">
            <div className="rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm">
              <p className="text-xs font-medium text-muted">Total Siswa</p>
              <p className="mt-1 text-2xl font-bold">{stats.total}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm">
              <p className="text-xs font-medium text-muted">Hadir</p>
              <p className="mt-1 text-2xl font-bold text-success">{stats.hadir}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm">
              <p className="text-xs font-medium text-muted">Izin</p>
              <p className="mt-1 text-2xl font-bold text-secondary">{stats.izin}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm">
              <p className="text-xs font-medium text-muted">Sakit</p>
              <p className="mt-1 text-2xl font-bold text-purple-600">{stats.sakit}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm">
              <p className="text-xs font-medium text-muted">Alpa</p>
              <p className="mt-1 text-2xl font-bold text-danger">{stats.alpha}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm">
              <p className="text-xs font-medium text-muted">Sudah Tercatat</p>
              <p className="mt-1 text-2xl font-bold text-primary">
                {stats.total - stats.belumAbsen} / {stats.total}
              </p>
            </div>
          </section>

          {/* Action Bar */}
          <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted" />
              <input
                type="text"
                placeholder="Cari nama atau NIS siswa..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={markAllHadir} disabled={savingBulk}>
                <CheckCheck className="h-4 w-4 text-success" />
                Tandai Semua Hadir
              </Button>
              <Button size="sm" onClick={handleSaveBulk} loading={savingBulk}>
                <Save className="h-4 w-4" />
                Simpan Semua Absensi
              </Button>
            </div>
          </div>

          {/* Student Attendance List Table */}
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-gray-200 bg-gray-50/75 text-muted">
                  <tr>
                    <th className="py-3 pl-4 pr-2 font-semibold">No</th>
                    <th className="py-3 px-3 font-semibold">NIS</th>
                    <th className="py-3 px-3 font-semibold">Nama Siswa</th>
                    <th className="py-3 px-3 font-semibold">Status Saat Ini</th>
                    <th className="py-3 px-3 font-semibold min-w-[200px]">Pilih Kehadiran</th>
                    <th className="py-3 px-3 pr-4 font-semibold min-w-[220px]">Keterangan (Opsional)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredRows.map((row, idx) => {
                    const isRecorded = !!row.existingAttendance;
                    return (
                      <tr
                        key={row.student.nis}
                        className={`transition-colors hover:bg-gray-50/50 ${
                          row.isModified ? "bg-primary/5" : ""
                        }`}
                      >
                        <td className="py-3.5 pl-4 pr-2 text-muted">{idx + 1}</td>
                        <td className="py-3.5 px-3 font-medium text-foreground">{row.student.nis}</td>
                        <td className="py-3.5 px-3">
                          <p className="font-bold text-foreground">{row.student.nama}</p>
                          <p className="text-[11px] text-muted">Kelas {row.student.kelas}</p>
                        </td>
                        <td className="py-3.5 px-3">
                          {isRecorded ? (
                            <div className="flex items-center gap-1.5">
                              <StatusBadge status={row.existingAttendance!.status} />
                              {row.existingAttendance?.jam && (
                                <span className="text-[10px] text-muted">({row.existingAttendance.jam})</span>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-muted">
                              Belum Absen
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {(["HADIR", "IZIN", "SAKIT", "ALPHA"] as AttendanceStatus[]).map((st) => {
                              const active = row.status === st;
                              let colorClass = "bg-gray-100 text-gray-700 hover:bg-gray-200";
                              if (active) {
                                if (st === "HADIR") colorClass = "bg-success text-white shadow-sm";
                                else if (st === "IZIN") colorClass = "bg-blue-600 text-white shadow-sm";
                                else if (st === "SAKIT") colorClass = "bg-purple-600 text-white shadow-sm";
                                else if (st === "ALPHA") colorClass = "bg-danger text-white shadow-sm";
                              }
                              return (
                                <button
                                  key={st}
                                  type="button"
                                  onClick={() => handleStatusChange(row.student.nis, st)}
                                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all ${colorClass}`}
                                >
                                  {st === "ALPHA" ? "ALPA" : st}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                        <td className="py-3.5 px-3 pr-4">
                          <input
                            type="text"
                            placeholder="Catatan..."
                            value={row.keterangan}
                            onChange={(e) => handleKeteranganChange(row.student.nis, e.target.value)}
                            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs focus:border-primary focus:outline-none"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Bottom Floating/Fixed Save Bar */}
            <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50/75 p-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-muted">
                Menampilkan {filteredRows.length} dari {formRows.length} siswa.
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleSaveBulk} loading={savingBulk}>
                  <Save className="h-4 w-4" />
                  Simpan Semua Absensi
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
