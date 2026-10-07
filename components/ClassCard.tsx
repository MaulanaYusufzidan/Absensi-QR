import Link from "next/link";
import { ArrowUpRight, UserCheck, UserX } from "lucide-react";
import type { ClassSummary } from "@/lib/types";

/** One card per class found in SISWA. All numbers come from the API. */
export function ClassCard({ cls }: { cls: ClassSummary }) {
  return (
    <div className="flex w-full flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">Kelas {cls.kelas}</h3>
        <Link
          href={`/attendance?kelas=${encodeURIComponent(cls.kelas)}`}
          aria-label={`Lihat absensi kelas ${cls.kelas}`}
          className="flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-white"
        >
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> {cls.total} siswa
        </Link>
      </div>
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center gap-2 rounded-lg border border-warning/50 px-3 py-2 text-foreground/80">
          <UserCheck className="h-4 w-4 shrink-0 text-success" aria-hidden />
          Hadir: <span className="font-semibold">{cls.hadir}</span> · Terlambat:{" "}
          <span className="font-semibold">{cls.terlambat}</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-warning/50 px-3 py-2 text-foreground/80">
          <UserX className="h-4 w-4 shrink-0 text-danger" aria-hidden />
          Belum hadir: <span className="font-semibold">{cls.belumHadir}</span>
        </div>
      </div>
    </div>
  );
}
