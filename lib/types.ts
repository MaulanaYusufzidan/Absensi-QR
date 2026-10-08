// Core domain types for the QR Attendance app.
// These mirror the Google Sheets structure used as the source of truth.

export type Role = "GURU" | "ADMIN";
export type TeacherStatus = "AKTIF" | "NONAKTIF";
export type StudentStatus = "AKTIF" | "NONAKTIF";
export type ScheduleStatus = "AKTIF" | "NONAKTIF";
export type AttendanceStatus = "HADIR" | "TERLAMBAT" | "IZIN" | "SAKIT" | "ALPHA";

export interface Student {
  no: number;
  nama: string;
  nis: string;
  nisn: string;
  ttl: string;
  alamat: string;
  idQr: string;
  kelas: string;
  status: StudentStatus;
}

export interface Teacher {
  idGuru: string;
  nip: string;
  namaGuru: string;
  username: string;
  status: TeacherStatus;
  role: Role;
}

export interface Schedule {
  idJadwal: string;
  hari: string;
  jamMulai: string;
  jamSelesai: string;
  kelas: string;
  mataPelajaran: string;
  idGuru: string;
  namaGuru?: string;
  status: ScheduleStatus;
  tglDibuat?: string;
}

export interface Attendance {
  idAbsensi: string;
  idJadwal: string;
  idQr: string;
  nis: string;
  nama: string;
  kelas: string;
  tanggal: string;
  jam: string;
  mataPelajaran: string;
  idGuru: string;
  namaGuru: string;
  status: AttendanceStatus;
  keterangan: string;
}

export interface Settings {
  NAMA_SEKOLAH: string;
  BATAS_KETERLAMBATAN: string;
  ZONA_WAKTU: string;
  DURASI_SESSION: string;
  VALIDASI_JAM: string;
}

export interface DashboardStats {
  totalSiswa: number;
  hadir: number;
  terlambat: number;
  izin: number;
  sakit: number;
  alpha: number;
  tanpaKeterangan: number;
}

export interface ClassSummary {
  kelas: string;
  total: number;
  hadir: number;
  terlambat: number;
  belumHadir: number;
}

export interface AuthUser {
  idGuru: string;
  namaGuru: string;
  username: string;
  role: Role;
  token: string;
  expiresAt: number;
}

export interface ScanResult {
  student: Student;
  schedule: Schedule;
  status: AttendanceStatus;
  jam: string;
  alreadyRecorded?: {
    jam: string;
    status: AttendanceStatus;
  };
}

export type SessionStatus = "ACTIVE" | "CLOSED";

export interface AttendanceSession {
  idSesi: string;
  idGuru: string;
  idJadwal: string;
  kelas: string;
  mataPelajaran: string;
  tanggal: string;
  jamMulai: string;
  status: SessionStatus;
  createdAt?: string;
}

export interface SessionStudentItem {
  student: Student;
  attendance: Attendance | null;
  status: AttendanceStatus | "BELUM_ABSEN";
  jam: string;
}

export interface SessionAttendanceData {
  session: AttendanceSession;
  items: SessionStudentItem[];
}

export interface RecapSummaryItem {
  guru: string;
  periode: string;
  kelas: string;
  mataPelajaran: string;
  totalSiswa: number;
  hadir: number;
  terlambat: number;
  izin: number;
  sakit: number;
  alpha: number;
  persentaseKehadiran: string;
}

export interface AttendanceRecapData {
  detail: Attendance[];
  summary: RecapSummaryItem[];
}

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; code: string; message: string };

