"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Download, Printer, Search } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Skeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { ErrorNote } from "@/components/ErrorNote";
import { useApi } from "@/lib/useApi";
import type { Student } from "@/lib/types";

export default function QrPrintPage() {
  const { data, loading, error, reload } = useApi<Student[]>("getStudents", {});
  const [search, setSearch] = useState("");

  const students = useMemo(() => data ?? [], [data]);
  const filtered = students.filter(
    (s) =>
      !search ||
      s.nama.toLowerCase().includes(search.toLowerCase()) ||
      s.idQr.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppShell title="Cetak QR Siswa" requireRole="ADMIN">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              placeholder="Cari nama atau ID QR..."
              className="pl-9"
              aria-label="Cari siswa"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button onClick={() => window.print()} variant="outline">
            <Printer className="h-4 w-4" aria-hidden /> Cetak Semua
          </Button>
        </div>

        {error && <ErrorNote message={error} onRetry={reload} />}

        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-56" />
            ))}
          </div>
        ) : filtered.length === 0 && !error ? (
          <EmptyState title="Tidak ada siswa" description="Coba kata kunci lain." />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3">
            {filtered.map((s) => (
              <QrCard key={s.idQr} student={s} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

/** The QR encodes ONLY the permanent ID_QR (e.g. DU26001), never personal data. */
function QrCard({ student }: { student: Student }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(student.idQr, { margin: 1, width: 240 }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [student.idQr]);

  function download() {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${student.idQr}-${student.nama}.png`;
    a.click();
  }

  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-center shadow-sm print:break-inside-avoid">
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- data: URL, nothing for next/image to optimise
        <img src={dataUrl} alt={`QR ${student.nama}`} className="h-32 w-32" />
      ) : (
        <Skeleton className="h-32 w-32" />
      )}
      <p className="font-semibold leading-tight">{student.nama}</p>
      <p className="text-xs text-muted">Kelas {student.kelas}</p>
      <p className="font-mono text-xs text-muted">{student.idQr}</p>
      <Button size="sm" variant="ghost" onClick={download} disabled={!dataUrl} className="print:hidden">
        <Download className="h-4 w-4" aria-hidden /> Unduh
      </Button>
    </div>
  );
}
