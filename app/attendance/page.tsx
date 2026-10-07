"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { DataTable, Column } from "@/components/DataTable";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import { StatusBadge } from "@/components/StatusBadge";
import { ErrorNote } from "@/components/ErrorNote";
import { useApi } from "@/lib/useApi";
import { todayISO } from "@/lib/utils";
import type { Attendance } from "@/lib/types";

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export default function AttendancePage() {
  return (
    <AppShell title="Absensi">
      <Suspense fallback={null}>
        <AttendanceContent />
      </Suspense>
    </AppShell>
  );
}

function AttendanceContent() {
  const params = useSearchParams();
  const [tanggal, setTanggal] = useState(todayISO());
  const [kelas, setKelas] = useState(params.get("kelas") ?? "");
  const [mapel, setMapel] = useState("");
  const [guru, setGuru] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const { data, loading, error, reload } = useApi<Attendance[]>("getAttendance", { tanggal });
  const rows = useMemo(() => data ?? [], [data]);

  const kelasOptions = useMemo(() => uniqueSorted(rows.map((r) => r.kelas)), [rows]);
  const mapelOptions = useMemo(() => uniqueSorted(rows.map((r) => r.mataPelajaran)), [rows]);
  const guruOptions = useMemo(() => uniqueSorted(rows.map((r) => r.namaGuru)), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!kelas || r.kelas === kelas) &&
        (!mapel || r.mataPelajaran === mapel) &&
        (!guru || r.namaGuru === guru) &&
        (!status || r.status === status) &&
        (!q || r.nama.toLowerCase().includes(q) || r.nis.includes(q))
    );
  }, [rows, kelas, mapel, guru, status, search]);

  const columns: Column<Attendance>[] = [
    { key: "tanggal", header: "Tanggal", render: (r) => r.tanggal },
    { key: "jam", header: "Jam", render: (r) => r.jam },
    { key: "nama", header: "Nama", render: (r) => r.nama },
    { key: "nis", header: "NIS", render: (r) => r.nis },
    { key: "kelas", header: "Kelas", render: (r) => r.kelas },
    { key: "mapel", header: "Mata Pelajaran", render: (r) => r.mataPelajaran },
    { key: "guru", header: "Guru", render: (r) => r.namaGuru },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "ket", header: "Keterangan", render: (r) => r.keterangan || "-" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Input type="date" label="Tanggal" value={tanggal} onChange={(e) => e.target.value && setTanggal(e.target.value)} />
        <Select label="Kelas" value={kelas} onChange={(e) => setKelas(e.target.value)}>
          <option value="">Semua</option>
          {kelasOptions.map((k) => (
            <option key={k} value={k}>
              Kelas {k}
            </option>
          ))}
        </Select>
        <Select label="Mata Pelajaran" value={mapel} onChange={(e) => setMapel(e.target.value)}>
          <option value="">Semua</option>
          {mapelOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        <Select label="Guru" value={guru} onChange={(e) => setGuru(e.target.value)}>
          <option value="">Semua</option>
          {guruOptions.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Semua</option>
          <option value="HADIR">Hadir</option>
          <option value="TERLAMBAT">Terlambat</option>
          <option value="IZIN">Izin</option>
          <option value="SAKIT">Sakit</option>
          <option value="ALPHA">Alpha</option>
        </Select>
        <Input
          label="Cari"
          placeholder="Nama atau NIS"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <ErrorNote message={error} onRetry={reload} />}

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.idAbsensi}
        loading={loading}
        emptyTitle="Belum ada absensi"
        emptyDescription="Tidak ada data absensi sesuai filter yang dipilih."
      />
    </div>
  );
}
