import type { AttendanceStatus } from "./types";

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  HADIR: "Hadir",
  TERLAMBAT: "Terlambat",
  IZIN: "Izin",
  SAKIT: "Sakit",
  ALPHA: "Alpha",
};

export const STATUS_STYLES: Record<AttendanceStatus, string> = {
  HADIR: "bg-success/10 text-success border-success/30",
  TERLAMBAT: "bg-warning/10 text-yellow-700 border-warning/30",
  IZIN: "bg-secondary/10 text-secondary border-secondary/30",
  SAKIT: "bg-purple-100 text-purple-700 border-purple-300",
  ALPHA: "bg-danger/10 text-danger border-danger/30",
};

export function formatDateID(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/**
 * Today's date as YYYY-MM-DD in Asia/Jakarta, matching the server's timezone.
 * Used only to pick which day the dashboard shows; stored timestamps always
 * come from the server.
 */
export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
