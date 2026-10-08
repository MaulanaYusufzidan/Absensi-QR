"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Edit2, FileSpreadsheet, Printer } from "lucide-react";
import * as XLSX from "xlsx";
import { AppShell } from "@/components/AppShell";
import { DataTable, Column } from "@/components/DataTable";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import { Button } from "@/components/Button";
import { StatusBadge } from "@/components/StatusBadge";
import { Modal } from "@/components/Modal";
import { ErrorNote } from "@/components/ErrorNote";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/Toast";
import { callApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { formatDateID, todayISO } from "@/lib/utils";
import type { Attendance, AttendanceRecapData, AttendanceStatus, Teacher } from "@/lib/types";

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function formatISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getRangeForPreset(preset: "harian" | "mingguan" | "bulanan"): [string, string] {
  const now = new Date();
  if (preset === "harian") {
    const today = formatISODate(now);
    return [today, today];
  }
  if (preset === "mingguan") {
    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return [formatISODate(monday), formatISODate(sunday)];
  }
  if (preset === "bulanan") {
    const y = now.getFullYear();
    const m = now.getMonth();
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    return [formatISODate(first), formatISODate(last)];
  }
  const today = formatISODate(now);
  return [today, today];
}

export default function AttendancePage() {
  return (
    <AppShell title="Laporan & Rekap Absensi">
      <Suspense fallback={<div className="p-8 text-center text-sm text-muted">Memuat data laporan...</div>}>
        <AttendanceContent />
      </Suspense>
    </AppShell>
  );
}

function AttendanceContent() {
  const { user } = useAuth();
  const toast = useToast();
  const params = useSearchParams();

  const [activePreset, setActivePreset] = useState<"harian" | "mingguan" | "bulanan" | "kustom">("harian");
  const [tanggalMulai, setTanggalMulai] = useState(todayISO());
  const [tanggalAkhir, setTanggalAkhir] = useState(todayISO());
  const [kelas, setKelas] = useState(params.get("kelas") ?? "");
  const [mapel, setMapel] = useState("");
  const [status, setStatus] = useState("");
  const [guruFilter, setGuruFilter] = useState("");
  const [search, setSearch] = useState("");

  const [exporting, setExporting] = useState(false);
  const [editingAttendance, setEditingAttendance] = useState<Attendance | null>(null);
  const [editStatus, setEditStatus] = useState<AttendanceStatus>("HADIR");
  const [editKeterangan, setEditKeterangan] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Fetch teachers for Admin filter
  const teachersRes = useApi<Teacher[]>(user?.role === "ADMIN" ? "getTeachers" : "getDashboard", {});
  const teacherList = useMemo(() => {
    if (user?.role === "ADMIN" && Array.isArray(teachersRes.data)) {
      return teachersRes.data;
    }
    return [];
  }, [user, teachersRes.data]);

  // Fetch recap data (strictly authorized on backend per user)
  const recapRes = useApi<AttendanceRecapData>("getAttendanceRecap", {
    tanggalMulai,
    tanggalAkhir,
    kelas: kelas || undefined,
    mataPelajaran: mapel || undefined,
    status: status || undefined,
    idGuru: user?.role === "ADMIN" && guruFilter ? guruFilter : undefined,
  });

  const detailRows = useMemo(() => recapRes.data?.detail ?? [], [recapRes.data]);
  const summaryRows = useMemo(() => recapRes.data?.summary ?? [], [recapRes.data]);

  const kelasOptions = useMemo(() => uniqueSorted(detailRows.map((r) => r.kelas)), [detailRows]);
  const mapelOptions = useMemo(() => uniqueSorted(detailRows.map((r) => r.mataPelajaran)), [detailRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return detailRows;
    return detailRows.filter(
      (r) => r.nama.toLowerCase().includes(q) || r.nis.includes(q)
    );
  }, [detailRows, search]);

  // Aggregate numbers for recap cards
  const stats = useMemo(() => {
    let hadir = 0;
    let izin = 0;
    let sakit = 0;
    let alpha = 0;
    filtered.forEach((r) => {
      if (r.status === "HADIR" || r.status === "TERLAMBAT") hadir++;
      else if (r.status === "IZIN") izin++;
      else if (r.status === "SAKIT") sakit++;
      else if (r.status === "ALPHA") alpha++;
    });
    const total = filtered.length;
    const pct = total > 0 ? Math.round((hadir / total) * 100) : 0;
    return { total, hadir, izin, sakit, alpha, pct };
  }, [filtered]);

  function applyPreset(preset: "harian" | "mingguan" | "bulanan") {
    setActivePreset(preset);
    const [start, end] = getRangeForPreset(preset);
    setTanggalMulai(start);
    setTanggalAkhir(end);
  }

  // Handle Edit Attendance
  async function handleSaveEdit() {
    if (!user || !editingAttendance) return;
    setSavingEdit(true);
    const res = await callApi(
      "updateAttendanceStatus",
      {
        idAbsensi: editingAttendance.idAbsensi,
        idJadwal: editingAttendance.idJadwal,
        nis: editingAttendance.nis,
        status: editStatus,
        keterangan: editKeterangan,
        tanggal: editingAttendance.tanggal,
      },
      user.token
    );
    setSavingEdit(false);
    if (!res.success) {
      toast("error", res.message);
      return;
    }
    toast("success", "Data absensi berhasil diperbarui.");
    setEditingAttendance(null);
    recapRes.reload();
  }

  // Handle Export Excel (.xlsx)
  function handleExportExcel() {
    if (filtered.length === 0) {
      toast("error", "Tidak ada data absensi untuk diekspor.");
      return;
    }
    setExporting(true);

    try {
      // Sheet 1 — Detail Absensi
      const detailSheetData = filtered.map((r, idx) => ({
        No: idx + 1,
        Tanggal: r.tanggal,
        Jam: r.jam,
        NIS: r.nis,
        "Nama Siswa": r.nama,
        Kelas: r.kelas,
        "Mata Pelajaran": r.mataPelajaran,
        Guru: r.namaGuru,
        Status: r.status,
        Keterangan: r.keterangan || "-",
      }));

      // Sheet 2 — Rekap
      const periodeLabel =
        tanggalMulai === tanggalAkhir ? tanggalMulai : `${tanggalMulai} s/d ${tanggalAkhir}`;

      const rekapSheetData = (summaryRows.length > 0 ? summaryRows : [
        {
          guru: user?.namaGuru ?? "Guru",
          periode: periodeLabel,
          kelas: kelas || "Semua",
          mataPelajaran: mapel || "Semua",
          totalSiswa: stats.total,
          hadir: stats.hadir,
          izin: stats.izin,
          sakit: stats.sakit,
          alpha: stats.alpha,
          persentaseKehadiran: `${stats.pct}%`,
        },
      ]).map((g) => ({
        Guru: g.guru,
        Periode: g.periode,
        Kelas: g.kelas,
        "Mata Pelajaran": g.mataPelajaran,
        "Total Siswa": g.totalSiswa,
        Hadir: g.hadir,
        Izin: g.izin,
        Sakit: g.sakit,
        Alpa: g.alpha,
        "Persentase Kehadiran": g.persentaseKehadiran,
      }));

      const wb = XLSX.utils.book_new();
      const wsDetail = XLSX.utils.json_to_sheet(detailSheetData);
      const wsRekap = XLSX.utils.json_to_sheet(rekapSheetData);

      XLSX.utils.book_append_sheet(wb, wsDetail, "Detail Absensi");
      XLSX.utils.book_append_sheet(wb, wsRekap, "Rekap");

      const cleanName = (user?.namaGuru || "Guru").replace(/\s+/g, "_");
      const cleanKelas = kelas ? `_Kelas_${kelas}` : "";
      const cleanMapel = mapel ? `_${mapel}` : "";
      const filename = `Absensi_SMPITDU_${cleanName}${cleanKelas}${cleanMapel}_${tanggalMulai}${
        tanggalAkhir !== tanggalMulai ? `_${tanggalAkhir}` : ""
      }.xlsx`;

      XLSX.writeFile(wb, filename);
      toast("success", "File Excel berhasil diunduh.");
    } catch {
      toast("error", "Gagal mengekspor data ke Excel.");
    } finally {
      setExporting(false);
    }
  }

  // Handle Export PDF via client-side printing
  function handleExportPDF() {
    if (filtered.length === 0) {
      toast("error", "Tidak ada data absensi untuk dicetak.");
      return;
    }
    window.print();
  }

  const columns: Column<Attendance>[] = [
    { key: "no", header: "No", render: (r) => filtered.indexOf(r) + 1, className: "w-12 text-muted" },
    { key: "tanggal", header: "Tanggal", render: (r) => r.tanggal },
    { key: "jam", header: "Jam", render: (r) => r.jam },
    { key: "nis", header: "NIS", render: (r) => r.nis },
    { key: "nama", header: "Nama Siswa", render: (r) => r.nama },
    { key: "kelas", header: "Kelas", render: (r) => r.kelas },
    { key: "mapel", header: "Mata Pelajaran", render: (r) => r.mataPelajaran },
    { key: "guru", header: "Guru", render: (r) => r.namaGuru },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "ket", header: "Keterangan", render: (r) => r.keterangan || "-" },
    {
      key: "actions",
      header: "Aksi",
      className: "text-right no-print",
      render: (r) => (
        <button
          onClick={() => {
            setEditingAttendance(r);
            setEditStatus(r.status);
            setEditKeterangan(r.keterangan || "");
          }}
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          <Edit2 className="h-3 w-3" /> Edit
        </button>
      ),
    },
  ];

  const periodeLabel =
    tanggalMulai === tanggalAkhir ? tanggalMulai : `${tanggalMulai} s/d ${tanggalAkhir}`;

  return (
    <div className="flex flex-col gap-6">
      {/* Screen View (hidden on print) */}
      <div className="flex flex-col gap-6 print:hidden">
        {/* Filter Section */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-bold text-foreground">Filter Laporan & Rekap Absensi</h3>
              <p className="text-xs text-muted">
                Pilih rentang periode dan filter data kehadiran siswa SMP IT Dinamika Umat.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleExportPDF} variant="outline" size="sm">
                <Printer className="h-4 w-4" /> Export PDF
              </Button>
              <Button onClick={handleExportExcel} loading={exporting} size="sm">
                <Download className="h-4 w-4" /> Export Excel (.xlsx)
              </Button>
            </div>
          </div>

          {/* Preset Buttons */}
          <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-gray-100 pb-3">
            <span className="text-xs font-semibold text-muted mr-1">Preset Periode:</span>
            {(
              [
                { id: "harian", label: "Hari Ini" },
                { id: "mingguan", label: "Minggu Ini" },
                { id: "bulanan", label: "Bulan Ini" },
              ] as const
            ).map((p) => {
              const active = activePreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                    active
                      ? "bg-primary text-white shadow-xs"
                      : "bg-gray-100 text-foreground/80 hover:bg-gray-200"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
            {activePreset === "kustom" && (
              <span className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                Kustom
              </span>
            )}
          </div>

          {/* Form Inputs Grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
            <Input
              type="date"
              label="Tanggal Mulai"
              value={tanggalMulai}
              onChange={(e) => {
                if (e.target.value) {
                  setTanggalMulai(e.target.value);
                  setActivePreset("kustom");
                }
              }}
            />
            <Input
              type="date"
              label="Tanggal Akhir"
              value={tanggalAkhir}
              onChange={(e) => {
                if (e.target.value) {
                  setTanggalAkhir(e.target.value);
                  setActivePreset("kustom");
                }
              }}
            />
            <Select
              label="Guru"
              value={user?.role === "GURU" ? (user?.idGuru || "") : guruFilter}
              onChange={(e) => setGuruFilter(e.target.value)}
              disabled={user?.role === "GURU"}
            >
              {user?.role === "GURU" ? (
                <option value={user?.idGuru}>{user?.namaGuru}</option>
              ) : (
                <>
                  <option value="">Semua Guru</option>
                  {teacherList.map((t) => (
                    <option key={t.idGuru} value={t.idGuru}>
                      {t.namaGuru}
                    </option>
                  ))}
                </>
              )}
            </Select>
            <Select label="Kelas" value={kelas} onChange={(e) => setKelas(e.target.value)}>
              <option value="">Semua Kelas</option>
              {kelasOptions.map((k) => (
                <option key={k} value={k}>
                  Kelas {k}
                </option>
              ))}
            </Select>
            <Select label="Mata Pelajaran" value={mapel} onChange={(e) => setMapel(e.target.value)}>
              <option value="">Semua Mapel</option>
              {mapelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
            <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Semua Status</option>
              <option value="HADIR">Hadir</option>
              <option value="TERLAMBAT">Terlambat</option>
              <option value="IZIN">Izin</option>
              <option value="SAKIT">Sakit</option>
              <option value="ALPHA">Alpa</option>
            </Select>
            <Input
              label="Cari Siswa"
              placeholder="Nama atau NIS"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Recap Stats Cards */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Statistik Rekap">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-muted">Total Data</p>
            <p className="mt-1 text-2xl font-bold">{stats.total}</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-muted">Hadir</p>
            <p className="mt-1 text-2xl font-bold text-success">{stats.hadir}</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-muted">Izin</p>
            <p className="mt-1 text-2xl font-bold text-secondary">{stats.izin}</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-muted">Sakit</p>
            <p className="mt-1 text-2xl font-bold text-purple-600">{stats.sakit}</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-muted">Alpa</p>
            <p className="mt-1 text-2xl font-bold text-danger">{stats.alpha}</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-muted">% Kehadiran</p>
            <p className="mt-1 text-2xl font-bold text-primary">{stats.pct}%</p>
          </div>
        </section>

        {recapRes.error && <ErrorNote message={recapRes.error} onRetry={recapRes.reload} />}

        {/* Detail Table */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-bold">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Detail Absensi Siswa
            </h3>
            <span className="text-xs text-muted">Menampilkan {filtered.length} data</span>
          </div>

          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.idAbsensi}
            loading={recapRes.loading}
            emptyTitle="Belum ada data absensi"
            emptyDescription="Tidak ada catatan absensi yang sesuai dengan filter yang dipilih."
          />
        </div>
      </div>

      {/* Printable Report View (Visible only during window.print) */}
      <div className="hidden print:block font-sans text-black p-4">
        <div className="flex items-center justify-between border-b-2 border-black pb-4 mb-5">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Logo SMP IT Dinamika Umat" className="h-16 w-16 object-contain" />
            <div>
              <h1 className="text-xl font-bold tracking-wide">SMP IT DINAMIKA UMAT</h1>
              <p className="text-sm font-semibold">LAPORAN REKAPITULASI KEHADIRAN SISWA</p>
              <p className="text-xs text-gray-600">Sistem Absensi Terpadu Berbasis QR Code & Manual</p>
            </div>
          </div>
          <div className="text-right text-xs space-y-1">
            <p><span className="font-semibold">Tanggal Cetak:</span> {formatDateID()}</p>
            <p><span className="font-semibold">Periode:</span> {periodeLabel}</p>
            {kelas && <p><span className="font-semibold">Kelas:</span> {kelas}</p>}
            {mapel && <p><span className="font-semibold">Mata Pelajaran:</span> {mapel}</p>}
            {user?.namaGuru && <p><span className="font-semibold">Guru:</span> {user.namaGuru}</p>}
          </div>
        </div>

        {/* Print Summary Table */}
        <div className="mb-5 grid grid-cols-6 border border-black text-center text-xs divide-x divide-black bg-gray-50">
          <div className="p-2">
            <p className="font-semibold">Total Siswa</p>
            <p className="text-sm font-bold">{stats.total}</p>
          </div>
          <div className="p-2">
            <p className="font-semibold">Hadir</p>
            <p className="text-sm font-bold">{stats.hadir}</p>
          </div>
          <div className="p-2">
            <p className="font-semibold">Izin</p>
            <p className="text-sm font-bold">{stats.izin}</p>
          </div>
          <div className="p-2">
            <p className="font-semibold">Sakit</p>
            <p className="text-sm font-bold">{stats.sakit}</p>
          </div>
          <div className="p-2">
            <p className="font-semibold">Alpa</p>
            <p className="text-sm font-bold">{stats.alpha}</p>
          </div>
          <div className="p-2">
            <p className="font-semibold">% Kehadiran</p>
            <p className="text-sm font-bold">{stats.pct}%</p>
          </div>
        </div>

        {/* Print Data Table */}
        <table className="w-full border-collapse border border-black text-[11px]">
          <thead>
            <tr className="bg-gray-100 border-b border-black text-center font-bold">
              <th className="border border-black p-1.5 w-8">No</th>
              <th className="border border-black p-1.5 w-20">Tanggal</th>
              <th className="border border-black p-1.5 w-14">Jam</th>
              <th className="border border-black p-1.5 w-20">NIS</th>
              <th className="border border-black p-1.5 text-left pl-2">Nama Siswa</th>
              <th className="border border-black p-1.5 w-16">Kelas</th>
              <th className="border border-black p-1.5 text-left pl-2">Mata Pelajaran</th>
              <th className="border border-black p-1.5 w-20">Status</th>
              <th className="border border-black p-1.5 text-left pl-2">Keterangan</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="border border-black p-3 text-center text-gray-500">
                  Tidak ada catatan absensi pada periode ini.
                </td>
              </tr>
            ) : (
              filtered.map((r, idx) => (
                <tr key={r.idAbsensi} className="border-b border-gray-300">
                  <td className="border border-black p-1 text-center">{idx + 1}</td>
                  <td className="border border-black p-1 text-center">{r.tanggal}</td>
                  <td className="border border-black p-1 text-center">{r.jam}</td>
                  <td className="border border-black p-1 text-center">{r.nis}</td>
                  <td className="border border-black p-1 pl-2 font-medium">{r.nama}</td>
                  <td className="border border-black p-1 text-center">{r.kelas}</td>
                  <td className="border border-black p-1 pl-2">{r.mataPelajaran}</td>
                  <td className="border border-black p-1 text-center font-bold">{r.status}</td>
                  <td className="border border-black p-1 pl-2">{r.keterangan || "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Official Signatures */}
        <div className="mt-10 flex justify-between px-12 text-xs break-inside-avoid">
          <div className="text-center">
            <p>Mengetahui,</p>
            <p className="font-semibold">Kepala Sekolah SMP IT Dinamika Umat</p>
            <div className="h-20" />
            <p className="border-t border-black font-bold pt-1 min-w-[180px]">( ........................................ )</p>
          </div>
          <div className="text-center">
            <p>Bogor, {formatDateID()}</p>
            <p className="font-semibold">Guru Pengampu</p>
            <div className="h-20" />
            <p className="border-t border-black font-bold pt-1 min-w-[180px]">{user?.namaGuru || "( ........................................ )"}</p>
          </div>
        </div>
      </div>

      {/* Edit Status Modal */}
      {editingAttendance && (
        <Modal
          open
          onClose={() => setEditingAttendance(null)}
          title={`Ubah Status Absensi — ${editingAttendance.nama}`}
        >
          <div className="flex flex-col gap-4">
            <div className="rounded-xl bg-gray-50 p-3 text-xs">
              <p>
                <span className="font-semibold">NIS:</span> {editingAttendance.nis} ·{" "}
                <span className="font-semibold">Kelas:</span> {editingAttendance.kelas}
              </p>
              <p className="mt-1">
                <span className="font-semibold">Mata Pelajaran:</span> {editingAttendance.mataPelajaran}
              </p>
              <p className="mt-1">
                <span className="font-semibold">Tanggal & Jam:</span> {editingAttendance.tanggal} {editingAttendance.jam}
              </p>
            </div>

            <Select
              label="Status Absensi"
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value as AttendanceStatus)}
            >
              <option value="HADIR">Hadir</option>
              <option value="TERLAMBAT">Terlambat</option>
              <option value="IZIN">Izin</option>
              <option value="SAKIT">Sakit</option>
              <option value="ALPHA">Alpa</option>
            </Select>

            <Input
              label="Keterangan (Opsional)"
              placeholder="Contoh: Izin acara keluarga"
              value={editKeterangan}
              onChange={(e) => setEditKeterangan(e.target.value)}
            />

            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingAttendance(null)} disabled={savingEdit}>
                Batal
              </Button>
              <Button onClick={handleSaveEdit} loading={savingEdit}>
                Simpan Perubahan
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
