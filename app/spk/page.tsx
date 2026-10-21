"use client";

import { useMemo, useState } from "react";
import { Download, Trophy } from "lucide-react";
import * as XLSX from "xlsx";
import { AppShell } from "@/components/AppShell";
import { DataTable, Column } from "@/components/DataTable";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import { Button } from "@/components/Button";
import { ErrorNote } from "@/components/ErrorNote";
import { useToast } from "@/components/Toast";
import { useApi } from "@/lib/useApi";
import { todayISO } from "@/lib/utils";
import type { AttendanceRecapData } from "@/lib/types";
import {
  BOBOT_DEFAULT,
  hitungSpk,
  type Bobot,
  type HasilSpk,
  type Kategori,
} from "@/lib/spk";
import { buatRekap } from "@/lib/spkData";

const WARNA: Record<Kategori, string> = {
  "Sangat Disiplin": "bg-green-100 text-green-900",
  Disiplin: "bg-blue-100 text-blue-900",
  "Perlu Perhatian": "bg-amber-100 text-amber-900",
  "Perlu Pembinaan": "bg-red-100 text-red-900",
};

const DAFTAR_BOBOT: { key: keyof Bobot; label: string }[] = [
  { key: "kehadiran", label: "Persentase kehadiran" },
  { key: "alpa", label: "Jumlah Alpa" },
  { key: "terlambat", label: "Jumlah Terlambat" },
  { key: "sakit", label: "Jumlah Sakit" },
  { key: "izin", label: "Jumlah Izin" },
];

function awalBulanISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function SpkPage() {
  return (
    <AppShell title="SPK Kedisiplinan Siswa">
      <SpkContent />
    </AppShell>
  );
}

function SpkContent() {
  const toast = useToast();
  const [tanggalMulai, setTanggalMulai] = useState(awalBulanISO());
  const [tanggalAkhir, setTanggalAkhir] = useState(todayISO());
  const [kelas, setKelas] = useState("");
  const [bobot, setBobot] = useState<Bobot>(BOBOT_DEFAULT);

  const recapRes = useApi<AttendanceRecapData>("getAttendanceRecap", {
    tanggalMulai,
    tanggalAkhir,
  });

  const detail = useMemo(() => recapRes.data?.detail ?? [], [recapRes.data]);

  const kelasOptions = useMemo(
    () => Array.from(new Set(detail.map((r) => r.kelas).filter(Boolean))).sort(),
    [detail]
  );

  const hasil = useMemo(() => {
    const dipilih = kelas ? detail.filter((r) => r.kelas === kelas) : detail;
    return hitungSpk(buatRekap(dipilih), bobot);
  }, [detail, kelas, bobot]);

  const ringkasan = (Object.keys(WARNA) as Kategori[]).map((k) => ({
    kategori: k,
    jumlah: hasil.filter((h) => h.kategori === k).length,
  }));

  const peringatan = hasil.filter((h) => h.alpa >= 3);
  const totalBobot = Object.values(bobot).reduce((a, b) => a + b, 0);

  function eksporExcel() {
    if (hasil.length === 0) {
      toast("error", "Belum ada data untuk diekspor.");
      return;
    }
    const baris = hasil.map((h) => ({
      Peringkat: h.peringkat,
      NIS: h.nis,
      "Nama Siswa": h.nama,
      Kelas: h.kelas,
      "Total Sesi": h.totalSesi,
      "% Hadir": h.persenHadir,
      Terlambat: h.terlambat,
      Izin: h.izin,
      Sakit: h.sakit,
      Alpa: h.alpa,
      "Skor SAW": h.skor,
      Kategori: h.kategori,
      "Tindak Lanjut": h.tindakLanjut,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(baris), "SPK Kedisiplinan");
    XLSX.writeFile(wb, `SPK_Kedisiplinan_${tanggalMulai}_${tanggalAkhir}.xlsx`);
    toast("success", "File Excel berhasil diunduh.");
  }

  const columns: Column<HasilSpk>[] = [
    { key: "rank", header: "#", render: (r) => r.peringkat, className: "w-12 text-muted" },
    { key: "nama", header: "Nama Siswa", render: (r) => r.nama },
    { key: "kelas", header: "Kelas", render: (r) => r.kelas },
    { key: "hadir", header: "Hadir", render: (r) => `${r.persenHadir}%` },
    { key: "alpa", header: "Alpa", render: (r) => r.alpa },
    { key: "telat", header: "Terlambat", render: (r) => r.terlambat },
    { key: "skor", header: "Skor", render: (r) => <b>{r.skor.toFixed(2)}</b> },
    {
      key: "kategori",
      header: "Kategori",
      render: (r) => (
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${WARNA[r.kategori]}`}>
          {r.kategori}
        </span>
      ),
    },
    { key: "tindak", header: "Tindak Lanjut", render: (r) => r.tindakLanjut },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Filter */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 font-bold text-foreground">
              <Trophy className="h-5 w-5 text-primary" />
              Ranking Kedisiplinan (Metode SAW)
            </h3>
            <p className="text-xs text-muted">
              Skor dihitung dari catatan absensi pada periode yang dipilih.
            </p>
          </div>
          <Button onClick={eksporExcel} size="sm">
            <Download className="h-4 w-4" /> Export Excel (.xlsx)
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            type="date"
            label="Tanggal Mulai"
            value={tanggalMulai}
            onChange={(e) => e.target.value && setTanggalMulai(e.target.value)}
          />
          <Input
            type="date"
            label="Tanggal Akhir"
            value={tanggalAkhir}
            onChange={(e) => e.target.value && setTanggalAkhir(e.target.value)}
          />
          <Select label="Kelas" value={kelas} onChange={(e) => setKelas(e.target.value)}>
            <option value="">Semua Kelas</option>
            {kelasOptions.map((k) => (
              <option key={k} value={k}>
                Kelas {k}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* Kartu kategori */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Ringkasan kategori">
        {ringkasan.map((r) => (
          <div key={r.kategori} className={`rounded-2xl p-4 ${WARNA[r.kategori]}`}>
            <p className="text-3xl font-bold">{r.jumlah}</p>
            <p className="text-sm font-semibold">{r.kategori}</p>
          </div>
        ))}
      </section>

      {recapRes.error && <ErrorNote message={recapRes.error} onRetry={recapRes.reload} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* Tabel ranking */}
        <DataTable
          columns={columns}
          rows={hasil}
          rowKey={(r) => r.nis}
          loading={recapRes.loading}
          emptyTitle="Belum ada data untuk diranking"
          emptyDescription="Belum ada catatan absensi pada periode dan kelas yang dipilih."
        />

        <div className="flex flex-col gap-6">
          {/* Bobot */}
          <section className="h-fit rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="font-bold text-foreground">Bobot Kriteria</h3>
            <p className="mb-4 text-xs text-muted">
              Total saat ini {totalBobot.toFixed(2)}. Jika bukan 1,00, bobot
              disesuaikan otomatis.
            </p>
            <div className="flex flex-col gap-3">
              {DAFTAR_BOBOT.map(({ key, label }) => (
                <label key={key} className="flex items-center justify-between gap-3 text-sm">
                  <span>{label}</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={bobot[key]}
                    onChange={(e) =>
                      setBobot({ ...bobot, [key]: Math.max(0, Number(e.target.value) || 0) })
                    }
                    className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-right"
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setBobot(BOBOT_DEFAULT)}
              className="mt-4 min-h-11 w-full rounded-lg border border-gray-300 px-3 text-sm font-semibold hover:bg-gray-50"
            >
              Kembalikan ke default
            </button>
          </section>

          {/* Peringatan dini */}
          <section className="h-fit rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <h3 className="font-bold text-amber-900">Peringatan Dini</h3>
            <p className="mb-3 text-xs text-amber-900/80">
              Siswa dengan Alpa 3 kali atau lebih pada periode ini.
            </p>
            {peringatan.length === 0 ? (
              <p className="text-sm text-amber-900">Tidak ada siswa yang perlu diperhatikan.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm text-amber-900">
                {peringatan.map((p) => (
                  <li key={p.nis}>
                    <b>{p.nama}</b> · Kelas {p.kelas} · Alpa {p.alpa}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}