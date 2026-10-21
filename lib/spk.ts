// lib/spk.ts
// SPK Kedisiplinan Siswa dengan metode SAW (Simple Additive Weighting)

export type RekapSiswa = {
  nis: string;
  nama: string;
  kelas: string;
  hadir: number;
  terlambat: number;
  izin: number;
  sakit: number;
  alpa: number;
  totalSesi: number; // jumlah hari sekolah pada periode yang dipilih
};

export type Bobot = {
  kehadiran: number;
  alpa: number;
  terlambat: number;
  sakit: number;
  izin: number;
};

export const BOBOT_DEFAULT: Bobot = {
  kehadiran: 0.35,
  alpa: 0.25,
  terlambat: 0.2,
  sakit: 0.1,
  izin: 0.1,
};

export type Kategori =
  | "Sangat Disiplin"
  | "Disiplin"
  | "Perlu Perhatian"
  | "Perlu Pembinaan";

export type HasilSpk = RekapSiswa & {
  persenHadir: number;
  skor: number;
  peringkat: number;
  kategori: Kategori;
  tindakLanjut: string;
};

// Jika total bobot bukan 1, bobot disesuaikan otomatis agar totalnya 1
function normalisasiBobot(b: Bobot): Bobot {
  const total = b.kehadiran + b.alpa + b.terlambat + b.sakit + b.izin;
  if (total <= 0) return BOBOT_DEFAULT;
  return {
    kehadiran: b.kehadiran / total,
    alpa: b.alpa / total,
    terlambat: b.terlambat / total,
    sakit: b.sakit / total,
    izin: b.izin / total,
  };
}

function tentukanKategori(skor: number): Kategori {
  if (skor >= 0.85) return "Sangat Disiplin";
  if (skor >= 0.7) return "Disiplin";
  if (skor >= 0.5) return "Perlu Perhatian";
  return "Perlu Pembinaan";
}

function tentukanTindakLanjut(s: RekapSiswa, kategori: Kategori): string {
  if (s.alpa >= 3) return "Konseling BK dan panggil orang tua";
  if (kategori === "Perlu Pembinaan") return "Konseling BK";
  if (kategori === "Perlu Perhatian") return "Hubungi wali murid";
  if (kategori === "Disiplin") return "Pantau rutin";
  return "Beri apresiasi";
}

// Kriteria cost (makin kecil makin baik): r = 1 - (nilai / nilai_max)
// Jika semua siswa bernilai 0, semua mendapat r = 1
function costScore(nilai: number, max: number): number {
  return max === 0 ? 1 : 1 - nilai / max;
}

export function hitungSpk(
  data: RekapSiswa[],
  bobotInput: Bobot = BOBOT_DEFAULT
): HasilSpk[] {
  if (data.length === 0) return [];
  const w = normalisasiBobot(bobotInput);

  // Persentase hadir: terlambat tetap dihitung hadir, izin dan sakit tidak
  const dengan = data.map((s) => ({
    ...s,
    persenHadir:
      s.totalSesi > 0
        ? Math.round(((s.hadir + s.terlambat) / s.totalSesi) * 1000) / 10
        : 0,
  }));

  const max = {
    persen: Math.max(...dengan.map((s) => s.persenHadir)),
    alpa: Math.max(...dengan.map((s) => s.alpa)),
    terlambat: Math.max(...dengan.map((s) => s.terlambat)),
    sakit: Math.max(...dengan.map((s) => s.sakit)),
    izin: Math.max(...dengan.map((s) => s.izin)),
  };

  const hasil: HasilSpk[] = dengan.map((s) => {
    // Kriteria benefit (makin besar makin baik): r = nilai / nilai_max
    const rHadir = max.persen === 0 ? 0 : s.persenHadir / max.persen;

    const skor =
      w.kehadiran * rHadir +
      w.alpa * costScore(s.alpa, max.alpa) +
      w.terlambat * costScore(s.terlambat, max.terlambat) +
      w.sakit * costScore(s.sakit, max.sakit) +
      w.izin * costScore(s.izin, max.izin);

    const skorBulat = Math.round(skor * 100) / 100;
    const kategori = tentukanKategori(skorBulat);

    return {
      ...s,
      skor: skorBulat,
      kategori,
      tindakLanjut: tentukanTindakLanjut(s, kategori),
      peringkat: 0,
    };
  });

  // Urutkan dari skor tertinggi; jika sama, yang Alpa-nya lebih sedikit di atas
  hasil.sort((a, b) => b.skor - a.skor || a.alpa - b.alpa);
  hasil.forEach((h, i) => (h.peringkat = i + 1));
  return hasil;
}