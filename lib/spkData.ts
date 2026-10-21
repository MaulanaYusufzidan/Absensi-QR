// lib/spkData.ts
// Mengubah catatan absensi menjadi rekap per siswa untuk SPK

import type { Attendance } from "./types";
import type { RekapSiswa } from "./spk";

export function buatRekap(absensi: Attendance[]): RekapSiswa[] {
  const peta = new Map<string, RekapSiswa>();

  for (const a of absensi) {
    let r = peta.get(a.nis);
    if (!r) {
      r = {
        nis: a.nis,
        nama: a.nama,
        kelas: a.kelas,
        hadir: 0,
        terlambat: 0,
        izin: 0,
        sakit: 0,
        alpa: 0,
        totalSesi: 0,
      };
      peta.set(a.nis, r);
    }
    switch (a.status) {
      case "HADIR":
        r.hadir += 1;
        break;
      case "TERLAMBAT":
        r.terlambat += 1;
        break;
      case "IZIN":
        r.izin += 1;
        break;
      case "SAKIT":
        r.sakit += 1;
        break;
      case "ALPHA":
        r.alpa += 1;
        break;
    }
    r.totalSesi += 1;
  }

  return [...peta.values()];
}