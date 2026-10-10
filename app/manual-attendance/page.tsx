"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ScanLine,
  Save,
  CheckCheck,
  Search,
  RefreshCw,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { Select } from "@/components/Select";
import { Input } from "@/components/Input";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/Skeleton";
import { ErrorNote } from "@/components/ErrorNote";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/Toast";
import { callApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { todayISO } from "@/lib/utils";
import type { AttendanceStatus, ClassAttendanceData, ClassSummary, SessionStudentItem } from "@/lib/types";

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
  const toast = useToast();

  const isRoleAdmin = user?.role === "ADMIN";
  const defaultClass = isRoleAdmin ? "" : (user?.kelas || "");
  const [selectedClass, setSelectedClass] = useState<string>("");

  const [formRows, setFormRows] = useState<StudentFormRow[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [savingBulk, setSavingBulk] = useState(false);
  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "unrecorded" | "recorded">("all");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fetch classes for admin dropdown
  const classesRes = useApi<ClassSummary[]>(isRoleAdmin ? "getClasses" : "getDashboard", { tanggal: todayISO() });
  const availableClasses = useMemo(() => {
    if (isRoleAdmin && Array.isArray(classesRes.data)) {
      return classesRes.data.map((c) => c.kelas);
    }
    return defaultClass ? [defaultClass] : [];
  }, [isRoleAdmin, classesRes.data, defaultClass]);

  const targetClass = isRoleAdmin ? (selectedClass || availableClasses[0] || "") : defaultClass;
  const classLabel = targetClass ? `Kelas ${targetClass}` : "Semua Kelas";

  // Load students and their daily attendance
  const loadClassStudents = useCallback(async (kelasToLoad: string) => {
    if (!user || !kelasToLoad) return;
    setLoadingStudents(true);
    setErrorMsg(null);

    const res = await callApi<ClassAttendanceData>(
      "getClassAttendance",
      { tanggal: todayISO(), kelas: kelasToLoad },
      user.token
    );

    setLoadingStudents(false);
    if (!res.success) {
      setErrorMsg(res.message || "Gagal memuat data absensi siswa.");
      return;
    }

    if (res.data) {
      const rows: StudentFormRow[] = res.data.items.map((item) => ({
        student: item.student,
        existingAttendance: item.attendance,
        status: item.attendance ? item.attendance.status : "BELUM_ABSEN",
        keterangan: item.attendance?.keterangan || "",
        isModified: false,
      }));
      setFormRows(rows);
    }
  }, [user]);

  useEffect(() => {
    let ignore = false;
    if (!user || !targetClass) {
      return;
    }

    callApi<ClassAttendanceData>(
      "getClassAttendance",
      { tanggal: todayISO(), kelas: targetClass },
      user.token
    ).then((res) => {
      if (ignore) return;
      setLoadingStudents(false);
      if (!res.success) {
        setErrorMsg(res.message || "Gagal memuat data absensi siswa.");
        return;
      }

      if (res.data) {
        const rows: StudentFormRow[] = res.data.items.map((item) => ({
          student: item.student,
          existingAttendance: item.attendance,
          status: item.attendance ? item.attendance.status : "BELUM_ABSEN",
          keterangan: item.attendance?.keterangan || "",
          isModified: false,
        }));
        setFormRows(rows);
      }
    });

    return () => {
      ignore = true;
    };
  }, [targetClass, user]);

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

  // Quick action: set all unrecorded students to HADIR
  function markAllUnrecordedHadir() {
    setFormRows((prev) =>
      prev.map((r) => {
        if (r.status === "BELUM_ABSEN") {
          return { ...r, status: "HADIR", isModified: true };
        }
        return r;
      })
    );
    toast("info", "Siswa yang belum absen telah ditandai Hadir. Klik 'Simpan Perubahan' untuk menyimpan.");
  }

  // Save changes (only modified rows)
  async function handleSaveBulk() {
    if (!user || formRows.length === 0) return;
    const modifiedRows = formRows.filter((r) => r.isModified && r.status !== "BELUM_ABSEN");

    if (modifiedRows.length === 0) {
      toast("info", "Tidak ada perubahan status absensi untuk disimpan.");
      return;
    }

    setSavingBulk(true);
    const today = todayISO();
    let successCount = 0;
    let failCount = 0;

    for (const row of modifiedRows) {
      const res = await callApi(
        "updateAttendanceStatus",
        {
          idAbsensi: row.existingAttendance?.idAbsensi,
          nis: row.student.nis,
          status: row.status as AttendanceStatus,
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

    setSavingBulk(false);

    if (failCount === 0) {
      toast("success", `Berhasil menyimpan absensi ${successCount} siswa.`);
    } else {
      toast("info", `Tersimpan ${successCount} siswa, gagal ${failCount} siswa.`);
    }

    if (targetClass) {
      loadClassStudents(targetClass);
    }
  }

  // Statistics
  const stats = useMemo(() => {
    let sudah = 0;
    let belum = 0;
    let hadir = 0;
    let terlambat = 0;
    let izin = 0;
    let sakit = 0;
    let alpha = 0;

    formRows.forEach((r) => {
      if (r.existingAttendance) {
        sudah++;
        if (r.existingAttendance.status === "HADIR") hadir++;
        else if (r.existingAttendance.status === "TERLAMBAT") terlambat++;
        else if (r.existingAttendance.status === "IZIN") izin++;
        else if (r.existingAttendance.status === "SAKIT") sakit++;
        else if (r.existingAttendance.status === "ALPHA") alpha++;
      } else {
        belum++;
      }
    });

    return { total: formRows.length, sudah, belum, hadir, terlambat, izin, sakit, alpha };
  }, [formRows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    let rows = formRows;
    if (filterTab === "unrecorded") {
      rows = rows.filter((r) => !r.existingAttendance);
    } else if (filterTab === "recorded") {
      rows = rows.filter((r) => !!r.existingAttendance);
    }

    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.student.nama.toLowerCase().includes(q) || r.student.nis.includes(q)
    );
  }, [formRows, filterTab, search]);

  const hasModifications = formRows.some((r) => r.isModified);

  return (
    <div className="flex flex-col gap-6">
      {/* Top Banner */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold text-foreground">
                Absensi Manual Harian — {classLabel}
              </span>
              <span className="rounded-full bg-primary/10 px-3 py-0.5 text-xs font-bold text-primary">
                Wali Kelas: {user?.namaGuru}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Catat absensi untuk siswa yang belum scan QR atau lakukan koreksi status siswa.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isRoleAdmin && (
              <Select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="w-40 text-xs"
              >
                {availableClasses.map((k) => (
                  <option key={k} value={k}>
                    Kelas {k}
                  </option>
                ))}
              </Select>
            )}
            <Link
              href="/scan"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 text-xs font-semibold text-foreground shadow-sm hover:bg-gray-50 transition-all"
            >
              <ScanLine className="h-4 w-4 text-primary" /> Buka Scanner QR
            </Link>
            <Button
              size="sm"
              variant="outline"
              onClick={() => targetClass && loadClassStudents(targetClass)}
              disabled={loadingStudents}
            >
              <RefreshCw className={`h-4 w-4 ${loadingStudents ? "animate-spin" : ""}`} /> Muat Ulang
            </Button>
          </div>
        </div>

        {/* Quick summary stats */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7 pt-4 border-t border-gray-100 text-xs">
          <div className="rounded-xl bg-gray-50 p-2.5">
            <span className="text-muted block">Total Siswa</span>
            <span className="text-base font-bold text-foreground">{stats.total}</span>
          </div>
          <div className="rounded-xl bg-success/10 p-2.5">
            <span className="text-success block font-medium">Sudah Absen</span>
            <span className="text-base font-bold text-success">{stats.sudah}</span>
          </div>
          <div className="rounded-xl bg-amber-50 p-2.5">
            <span className="text-amber-700 block font-medium">Belum Absen</span>
            <span className="text-base font-bold text-amber-700">{stats.belum}</span>
          </div>
          <div className="rounded-xl bg-gray-50 p-2.5">
            <span className="text-muted block">Hadir</span>
            <span className="text-base font-bold text-foreground">{stats.hadir}</span>
          </div>
          <div className="rounded-xl bg-gray-50 p-2.5">
            <span className="text-muted block">Terlambat</span>
            <span className="text-base font-bold text-foreground">{stats.terlambat}</span>
          </div>
          <div className="rounded-xl bg-gray-50 p-2.5">
            <span className="text-muted block">Izin / Sakit</span>
            <span className="text-base font-bold text-foreground">{stats.izin + stats.sakit}</span>
          </div>
          <div className="rounded-xl bg-gray-50 p-2.5">
            <span className="text-muted block">Alpa</span>
            <span className="text-base font-bold text-foreground">{stats.alpha}</span>
          </div>
        </div>
      </section>

      {errorMsg && <ErrorNote message={errorMsg} onRetry={() => targetClass && loadClassStudents(targetClass)} />}

      {/* Main Table Card */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        {/* Controls Bar */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Tabs */}
          <div className="flex items-center gap-1.5 rounded-xl bg-gray-100 p-1 text-xs font-semibold">
            <button
              onClick={() => setFilterTab("all")}
              className={`rounded-lg px-3 py-1.5 transition-all ${
                filterTab === "all" ? "bg-white text-primary shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              Semua Siswa ({formRows.length})
            </button>
            <button
              onClick={() => setFilterTab("unrecorded")}
              className={`rounded-lg px-3 py-1.5 transition-all ${
                filterTab === "unrecorded" ? "bg-white text-primary shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              Belum Absen ({stats.belum})
            </button>
            <button
              onClick={() => setFilterTab("recorded")}
              className={`rounded-lg px-3 py-1.5 transition-all ${
                filterTab === "recorded" ? "bg-white text-primary shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              Sudah Absen ({stats.sudah})
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-full sm:w-56">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
                <Input
                  placeholder="Cari siswa / NIS..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 text-xs"
                />
              </div>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={markAllUnrecordedHadir}
              disabled={loadingStudents || stats.belum === 0}
            >
              <CheckCheck className="h-4 w-4" /> Tandai Belum Absen Hadir
            </Button>

            <Button
              size="sm"
              onClick={handleSaveBulk}
              loading={savingBulk}
              disabled={!hasModifications}
            >
              <Save className="h-4 w-4" /> Simpan Perubahan
            </Button>
          </div>
        </div>

        {loadingStudents ? (
          <div className="flex flex-col gap-2 py-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <EmptyState
            title="Tidak ada data siswa"
            description={
              formRows.length === 0
                ? "Tidak ada siswa aktif terdaftar pada kelas ini."
                : "Tidak ada siswa yang sesuai dengan filter saat ini."
            }
          />
        ) : (
          <div className="max-w-full overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold text-muted">
                <tr>
                  <th className="px-3 py-3 w-12">No</th>
                  <th className="px-3 py-3 w-28">NIS</th>
                  <th className="px-3 py-3">Nama Siswa</th>
                  <th className="px-3 py-3 w-36">Status Tercatat</th>
                  <th className="px-3 py-3 w-44">Ubah Status</th>
                  <th className="px-3 py-3">Keterangan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRows.map((row, idx) => (
                  <tr
                    key={row.student.nis}
                    className={`transition-colors ${row.isModified ? "bg-amber-50/40" : "hover:bg-gray-50/50"}`}
                  >
                    <td className="px-3 py-3 text-xs text-muted">{idx + 1}</td>
                    <td className="px-3 py-3 font-mono text-xs">{row.student.nis}</td>
                    <td className="px-3 py-3 font-semibold text-foreground">
                      {row.student.nama}
                      {row.isModified && (
                        <span className="ml-2 inline-block h-2 w-2 rounded-full bg-amber-500" title="Diubah" />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {row.existingAttendance ? (
                        <div className="flex flex-col gap-0.5">
                          <StatusBadge status={row.existingAttendance.status} />
                          <span className="text-[10px] text-muted">{row.existingAttendance.jam || "—"}</span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-muted">
                          Belum Absen
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Select
                        value={row.status === "BELUM_ABSEN" ? "" : row.status}
                        onChange={(e) =>
                          handleStatusChange(row.student.nis, e.target.value as AttendanceStatus)
                        }
                        className="text-xs py-1"
                      >
                        <option value="" disabled>Pilih Status</option>
                        <option value="HADIR">Hadir</option>
                        <option value="TERLAMBAT">Terlambat</option>
                        <option value="IZIN">Izin</option>
                        <option value="SAKIT">Sakit</option>
                        <option value="ALPHA">Alpa</option>
                      </Select>
                    </td>
                    <td className="px-3 py-3">
                      <Input
                        placeholder="Keterangan..."
                        value={row.keterangan}
                        onChange={(e) => handleKeteranganChange(row.student.nis, e.target.value)}
                        className="text-xs py-1"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
