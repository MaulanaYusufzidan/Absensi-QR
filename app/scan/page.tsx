"use client";

import { useCallback, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, RotateCcw } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { QRScanner } from "@/components/QRScanner";
import { Button } from "@/components/Button";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/lib/auth";
import { callApi } from "@/lib/api";
import type { ScanResult } from "@/lib/types";

// SCAN -> (camera paused) LOOKUP -> CONFIRM -> SAVE -> RESULT -> RESET
type ViewState =
  | { kind: "scanning" }
  | { kind: "loading" }
  | { kind: "preview"; result: ScanResult }
  | { kind: "duplicate"; result: ScanResult }
  | { kind: "success"; result: ScanResult }
  | { kind: "error"; message: string };

// ID_QR looks like DU26001. Light client check only; the server does the real validation.
const QR_FORMAT = /^[A-Za-z0-9_-]{3,32}$/;

export default function ScanPage() {
  const { user } = useAuth();
  const [view, setView] = useState<ViewState>({ kind: "scanning" });
  const [confirming, setConfirming] = useState(false);
  const busyRef = useRef(false);

  const handleScan = useCallback(
    async (raw: string) => {
      if (busyRef.current || !user) return;
      busyRef.current = true;

      const idQr = raw.trim();
      if (!QR_FORMAT.test(idQr)) {
        setView({ kind: "error", message: "QR Code tidak valid. Gunakan kartu QR siswa." });
        return;
      }

      setView({ kind: "loading" });
      const res = await callApi<ScanResult>("getStudentByQR", { idQr }, user.token);
      if (!res.success) {
        setView({ kind: "error", message: res.message });
        return;
      }
      setView(res.data.alreadyRecorded ? { kind: "duplicate", result: res.data } : { kind: "preview", result: res.data });
    },
    [user]
  );

  async function confirmAttendance() {
    if (view.kind !== "preview" || !user) return;
    setConfirming(true);
    // Only the identifiers are sent. Name, class, subject, teacher, time and status are resolved by the server.
    const res = await callApi<ScanResult>(
      "scanAttendance",
      { idQr: view.result.student.idQr, idJadwal: view.result.schedule.idJadwal },
      user.token
    );
    setConfirming(false);

    if (!res.success) {
      if (res.code === "DUPLICATE_ATTENDANCE") {
        setView({ kind: "duplicate", result: view.result });
      } else {
        setView({ kind: "error", message: res.message });
      }
      return;
    }
    // "Berhasil" is shown only after the server confirmed the row was written.
    setView({ kind: "success", result: res.data });
  }

  function reset() {
    busyRef.current = false;
    setView({ kind: "scanning" });
  }

  return (
    <AppShell title="Scan QR Absensi">
      <div className="mx-auto flex max-w-sm flex-col items-center gap-5">
        {(view.kind === "scanning" || view.kind === "loading") && (
          <>
            <h2 className="text-center text-lg font-bold">SCAN QR SISWA</h2>
            <QRScanner active={view.kind === "scanning"} onScan={handleScan} />
            <p className="text-center text-sm text-muted" aria-live="polite">
              {view.kind === "loading" ? "Memeriksa data siswa..." : "Posisikan QR siswa di dalam frame"}
            </p>
          </>
        )}

        {view.kind === "preview" && (
          <div className="w-full rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-center text-lg font-bold">Konfirmasi Absensi</h2>
            <dl className="flex flex-col gap-3 text-sm">
              <Row label="Nama" value={view.result.student.nama} />
              <Row label="NIS" value={view.result.student.nis} />
              <Row label="Kelas" value={view.result.student.kelas} />
              <Row label="ID QR" value={view.result.student.idQr} />
              <Row label="Mata Pelajaran" value={view.result.schedule.mataPelajaran} />
              <Row label="Guru" value={view.result.schedule.namaGuru ?? "-"} />
              <Row label="Jadwal" value={`${view.result.schedule.jamMulai}–${view.result.schedule.jamSelesai}`} />
              <div className="flex items-center justify-between pt-1">
                <dt className="font-medium text-muted">Status</dt>
                <dd>
                  <StatusBadge status={view.result.status} />
                </dd>
              </div>
            </dl>
            <div className="mt-6 flex flex-col gap-2">
              <Button size="lg" onClick={confirmAttendance} loading={confirming}>
                Konfirmasi Absensi
              </Button>
              <Button size="lg" variant="outline" onClick={reset} disabled={confirming}>
                Batal
              </Button>
            </div>
          </div>
        )}

        {view.kind === "success" && (
          <ResultScreen
            icon={<CheckCircle2 className="h-14 w-14 text-success" aria-hidden />}
            title="ABSENSI BERHASIL"
            result={view.result}
            onReset={reset}
            resetLabel="Scan Siswa Berikutnya"
          />
        )}

        {view.kind === "duplicate" && (
          <ResultScreen
            icon={<AlertTriangle className="h-14 w-14 text-warning" aria-hidden />}
            title="SUDAH ABSEN"
            result={view.result}
            extra={
              view.result.alreadyRecorded && (
                <p className="text-center text-sm text-muted">
                  Sudah absen pukul <span className="font-semibold">{view.result.alreadyRecorded.jam}</span>
                </p>
              )
            }
            onReset={reset}
            resetLabel="Kembali Scan"
          />
        )}

        {view.kind === "error" && (
          <div
            role="alert"
            className="flex w-full flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm"
          >
            <XCircle className="h-14 w-14 text-danger" aria-hidden />
            <p className="font-semibold text-danger">{view.message}</p>
            <Button size="lg" variant="outline" onClick={reset} className="w-full">
              <RotateCcw className="h-4 w-4" aria-hidden /> Coba Lagi
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="font-medium text-muted">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
}

function ResultScreen({
  icon,
  title,
  result,
  extra,
  onReset,
  resetLabel,
}: {
  icon: React.ReactNode;
  title: string;
  result: ScanResult;
  extra?: React.ReactNode;
  onReset: () => void;
  resetLabel: string;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
      {icon}
      <h2 className="text-lg font-bold">{title}</h2>
      <div>
        <p className="text-base font-semibold">{result.student.nama}</p>
        <p className="text-sm text-muted">
          Kelas {result.student.kelas} · {result.schedule.mataPelajaran}
        </p>
        <p className="mt-1 text-sm text-muted">{result.alreadyRecorded?.jam ?? result.jam}</p>
      </div>
      <StatusBadge status={result.alreadyRecorded?.status ?? result.status} />
      {extra}
      <Button size="lg" onClick={onReset} className="mt-2 w-full">
        {resetLabel}
      </Button>
    </div>
  );
}
