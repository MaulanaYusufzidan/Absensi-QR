"use client";

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RotateCcw,
  Users,
  Edit2,
  Search,
  Check,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { QRScanner } from "@/components/QRScanner";
import { Button } from "@/components/Button";
import { StatusBadge } from "@/components/StatusBadge";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { Input } from "@/components/Input";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/Toast";
import { callApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { todayISO } from "@/lib/utils";
import type {
  AttendanceStatus,
  ClassAttendanceData,
  ScanResult,
  SessionStudentItem,
} from "@/lib/types";

type ViewState =
  | { kind: "scanning" }
  | { kind: "loading" }
  | { kind: "preview"; result: ScanResult }
  | { kind: "duplicate"; studentName: string; jam?: string; message?: string }
  | { kind: "success"; studentName: string; kelas: string; jam: string; status: AttendanceStatus }
  | { kind: "error"; message: string };

const QR_FORMAT = /^[A-Za-z0-9_-]{3,32}$/;

export default function ScanPage() {
  return (
    <AppShell title="Scan QR Absensi">
      <Suspense fallback={<div className="p-8 text-center text-sm text-muted">Memuat scanner...</div>}>
        <ScanContent />
      </Suspense>
    </AppShell>
  );
}

function ScanContent() {
  const { user } = useAuth();
  const toast = useToast();

  const targetClass = user?.role === "ADMIN" ? "" : (user?.kelas || "");
  const classLabel = user?.role === "ADMIN" ? "Semua Kelas" : (user?.kelas ? `Kelas ${user.kelas}` : "Kelas");

  // Load daily attendance list for the homeroom class
  const classAttendanceRes = useApi<ClassAttendanceData>("getClassAttendance", {
    tanggal: todayISO(),
    kelas: targetClass,
  });
  const classStudents = useMemo(() => classAttendanceRes.data?.items ?? [], [classAttendanceRes.data]);
  const loadingList = classAttendanceRes.loading;
  const loadClassAttendance = classAttendanceRes.reload;

  const [search, setSearch] = useState("");
  const [manualInput, setManualInput] = useState("");
  const [view, setView] = useState<ViewState>({ kind: "scanning" });
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Edit status modal state
  const [editingItem, setEditingItem] = useState<SessionStudentItem | null>(null);
  const [editStatus, setEditStatus] = useState<AttendanceStatus>("HADIR");
  const [editKeterangan, setEditKeterangan] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);

  const busyRef = useRef(false);

  // Execute direct attendance recording
  const executeScanAttendance = useCallback(
    async (idQr: string) => {
      if (!user) return;
      setView({ kind: "loading" });
      setSubmitting(true);

      const res = await callApi<ScanResult>(
        "scanAttendance",
        { idQr },
        user.token
      );
      setSubmitting(false);

      if (!res.success) {
        if (res.code === "DUPLICATE_ATTENDANCE") {
          setView({ kind: "duplicate", studentName: idQr, message: res.message });
        } else {
          setView({ kind: "error", message: res.message });
        }
        return;
      }

      setView({
        kind: "success",
        studentName: res.data.student.nama,
        kelas: res.data.student.kelas,
        jam: res.data.jam,
        status: res.data.status,
      });

      toast("success", `Absensi ${res.data.student.nama} berhasil dicatat.`);
      loadClassAttendance();
    },
    [user, toast, loadClassAttendance]
  );

  // QR Scan callback from camera or manual submission
  const handleScan = useCallback(
    async (raw: string) => {
      if (busyRef.current || !user) return;
      busyRef.current = true;

      const scannedText = raw.trim();
      if (!QR_FORMAT.test(scannedText)) {
        setView({ kind: "error", message: "Format QR Code tidak valid. Gunakan kartu QR resmi siswa." });
        return;
      }

      // If auto-confirm is active, record attendance immediately
      if (autoConfirm) {
        await executeScanAttendance(scannedText);
        return;
      }

      // Check student & duplicate status first, show confirmation preview
      setView({ kind: "loading" });
      const res = await callApi<ScanResult>("getStudentByQR", { idQr: scannedText }, user.token);
      if (!res.success) {
        setView({ kind: "error", message: res.message });
        return;
      }

      if (res.data.alreadyRecorded) {
        setView({
          kind: "duplicate",
          studentName: res.data.student.nama,
          jam: res.data.alreadyRecorded.jam,
          message: `Siswa sudah absen hari ini pukul ${res.data.alreadyRecorded.jam}.`,
        });
      } else {
        setView({ kind: "preview", result: res.data });
      }
    },
    [user, autoConfirm, executeScanAttendance]
  );

  function reset() {
    busyRef.current = false;
    setView({ kind: "scanning" });
  }

  // Confirm attendance from preview screen
  async function handleConfirmAttendance() {
    if (view.kind !== "preview") return;
    const idQr = view.result.student.idQr;
    await executeScanAttendance(idQr);
  }

  // Handle manual status correction
  async function handleSaveStatus() {
    if (!user || !editingItem) return;
    setSavingStatus(true);
    const res = await callApi(
      "updateAttendanceStatus",
      {
        idAbsensi: editingItem.attendance?.idAbsensi,
        nis: editingItem.student.nis,
        status: editStatus,
        keterangan: editKeterangan,
        tanggal: todayISO(),
      },
      user.token
    );
    setSavingStatus(false);
    if (!res.success) {
      toast("error", res.message);
      return;
    }
    toast("success", `Status ${editingItem.student.nama} berhasil diperbarui.`);
    setEditingItem(null);
    loadClassAttendance();
  }

  // Quick summary counts
  const summary = useMemo(() => {
    let hadir = 0;
    let belum = 0;
    classStudents.forEach((item) => {
      if (item.status === "BELUM_ABSEN") belum++;
      else hadir++;
    });
    return { total: classStudents.length, hadir, belum };
  }, [classStudents]);

  // Filtered student list
  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return classStudents;
    return classStudents.filter(
      (s) => s.student.nama.toLowerCase().includes(q) || s.student.nis.includes(q)
    );
  }, [classStudents, search]);

  return (
    <div className="flex flex-col gap-6">
      {/* Top Class Banner */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold text-foreground">
                Absensi QR Harian — {classLabel}
              </span>
              <span className="rounded-full bg-primary/10 px-3 py-0.5 text-xs font-bold text-primary">
                Wali Kelas: {user?.namaGuru}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Posisikan QR siswa di depan kamera. Satu siswa hanya dapat absen satu kali per hari.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="rounded-lg bg-gray-100 px-2.5 py-1 font-semibold text-muted">
                Total: {summary.total}
              </span>
              <span className="rounded-lg bg-success/10 px-2.5 py-1 font-semibold text-success">
                Sudah Absen: {summary.hadir}
              </span>
              <span className="rounded-lg bg-gray-100 px-2.5 py-1 font-semibold text-muted">
                Belum: {summary.belum}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Main Grid: Scanner Left/Top, Student List Right/Bottom */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Scanner Column (col-span-5) */}
        <div className="flex flex-col items-center gap-5 lg:col-span-5">
          {(view.kind === "scanning" || view.kind === "loading") && (
            <>
              <div className="flex w-full items-center justify-between px-1">
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Kamera Pemindai</h2>
                <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoConfirm}
                    onChange={(e) => setAutoConfirm(e.target.checked)}
                    className="rounded text-primary focus:ring-primary"
                  />
                  <span>Scan Langsung (Tanpa Konfirmasi)</span>
                </label>
              </div>

              <QRScanner active={view.kind === "scanning"} onScan={handleScan} />

              <p className="text-center text-xs text-muted" aria-live="polite">
                {view.kind === "loading"
                  ? "Memverifikasi data siswa..."
                  : "Arahkan kamera ke QR kartu siswa untuk mencatat absensi."}
              </p>

              {/* Manual Input Fallback */}
              <div className="w-full max-w-sm pt-3 border-t border-gray-200">
                <p className="mb-2 text-center text-xs font-medium text-muted">
                  Input manual NIS / ID QR (jika kamera bermasalah):
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (manualInput.trim()) {
                      handleScan(manualInput.trim());
                      setManualInput("");
                    }
                  }}
                  className="flex gap-2"
                >
                  <Input
                    placeholder="Contoh: DU26001 atau 101"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    disabled={view.kind === "loading"}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!manualInput.trim() || view.kind === "loading"}
                  >
                    Kirim
                  </Button>
                </form>
              </div>
            </>
          )}

          {/* Preview Screen */}
          {view.kind === "preview" && (
            <div className="w-full rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-center text-lg font-bold">Konfirmasi Absensi</h2>
              <dl className="flex flex-col gap-3 text-sm">
                <Row label="Nama" value={view.result.student.nama} />
                <Row label="NIS" value={view.result.student.nis} />
                <Row label="Kelas" value={`Kelas ${view.result.student.kelas}`} />
                <Row label="Waktu" value={view.result.jam} />
                <div className="flex items-center justify-between pt-1">
                  <dt className="font-medium text-muted">Status</dt>
                  <dd>
                    <StatusBadge status={view.result.status} />
                  </dd>
                </div>
              </dl>
              <div className="mt-6 flex flex-col gap-2">
                <Button size="lg" onClick={handleConfirmAttendance} loading={submitting} className="w-full">
                  <Check className="h-4 w-4" /> Konfirmasi Absensi
                </Button>
                <Button size="lg" variant="outline" onClick={reset} disabled={submitting} className="w-full">
                  Batal
                </Button>
              </div>
            </div>
          )}

          {/* Success Screen */}
          {view.kind === "success" && (
            <div className="flex w-full flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
              <CheckCircle2 className="h-14 w-14 text-success" aria-hidden />
              <h2 className="text-lg font-bold">ABSENSI BERHASIL</h2>
              <div>
                <p className="text-base font-semibold">{view.studentName}</p>
                <p className="text-sm text-muted">Kelas {view.kelas}</p>
                <p className="mt-1 text-sm text-muted">Pukul {view.jam}</p>
              </div>
              <StatusBadge status={view.status} />
              <Button size="lg" onClick={reset} className="mt-2 w-full">
                Scan Siswa Berikutnya
              </Button>
            </div>
          )}

          {/* Duplicate Screen */}
          {view.kind === "duplicate" && (
            <div className="flex w-full flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
              <AlertTriangle className="h-14 w-14 text-warning" aria-hidden />
              <h2 className="text-lg font-bold">SUDAH ABSEN</h2>
              <p className="text-base font-semibold">{view.studentName}</p>
              <p className="text-sm text-muted">
                {view.message ?? (view.jam ? `Sudah absen pukul ${view.jam}` : "Siswa sudah tercatat absen hari ini.")}
              </p>
              <Button size="lg" variant="outline" onClick={reset} className="mt-2 w-full">
                Kembali Scan
              </Button>
            </div>
          )}

          {/* Error Screen */}
          {view.kind === "error" && (
            <div
              role="alert"
              className="flex w-full flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm"
            >
              <XCircle className="h-14 w-14 text-danger" aria-hidden />
              <h2 className="text-base font-bold text-danger">Gagal Mencatat Absensi</h2>
              <p className="text-sm text-muted">{view.message}</p>
              <Button size="lg" variant="outline" onClick={reset} className="w-full">
                <RotateCcw className="h-4 w-4" aria-hidden /> Coba Lagi
              </Button>
            </div>
          )}
        </div>

        {/* Student Attendance List Column (col-span-7) */}
        <div className="flex flex-col gap-4 lg:col-span-7">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="flex items-center gap-2 font-bold text-base">
                  <Users className="h-5 w-5 text-primary" />
                  Status Kehadiran Siswa {classLabel}
                </h3>
                <p className="text-xs text-muted">
                  Daftar siswa dan status absensi tanggal hari ini.
                </p>
              </div>
              <div className="w-full sm:w-64">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
                  <Input
                    placeholder="Cari nama atau NIS..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 text-xs"
                  />
                </div>
              </div>
            </div>

            {loadingList ? (
              <div className="py-8 text-center text-sm text-muted">Memuat daftar siswa...</div>
            ) : filteredStudents.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted">
                {classStudents.length === 0
                  ? "Tidak ada siswa aktif terdaftar di kelas ini."
                  : "Tidak ditemukan siswa yang cocok dengan pencarian."}
              </div>
            ) : (
              <div className="max-w-full overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-[500px] text-left text-sm">
                  <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold text-muted">
                    <tr>
                      <th className="px-3 py-2.5">No</th>
                      <th className="px-3 py-2.5">NIS</th>
                      <th className="px-3 py-2.5">Nama Siswa</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5">Waktu</th>
                      <th className="px-3 py-2.5 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredStudents.map((item, idx) => (
                      <tr key={item.student.nis} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-3 py-2.5 text-xs text-muted">{idx + 1}</td>
                        <td className="px-3 py-2.5 font-mono text-xs">{item.student.nis}</td>
                        <td className="px-3 py-2.5 font-semibold text-foreground">{item.student.nama}</td>
                        <td className="px-3 py-2.5">
                          {item.status === "BELUM_ABSEN" ? (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-muted">
                              Belum Absen
                            </span>
                          ) : (
                            <StatusBadge status={item.status as AttendanceStatus} />
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted">{item.jam || "—"}</td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            onClick={() => {
                              setEditingItem(item);
                              setEditStatus(item.status === "BELUM_ABSEN" ? "HADIR" : (item.status as AttendanceStatus));
                              setEditKeterangan(item.attendance?.keterangan || "");
                            }}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                          >
                            <Edit2 className="h-3 w-3" /> Ubah
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Attendance Status Modal */}
      {editingItem && (
        <Modal
          open
          onClose={() => setEditingItem(null)}
          title={`Ubah Status Absensi — ${editingItem.student.nama}`}
        >
          <div className="flex flex-col gap-4">
            <div className="rounded-xl bg-gray-50 p-3 text-xs">
              <p>
                <span className="font-semibold">NIS:</span> {editingItem.student.nis}
              </p>
              <p>
                <span className="font-semibold">Kelas:</span> Kelas {editingItem.student.kelas}
              </p>
              <p>
                <span className="font-semibold">Status Saat Ini:</span>{" "}
                {editingItem.status === "BELUM_ABSEN" ? "Belum Absen" : editingItem.status}
              </p>
            </div>

            <Select
              label="Status Baru"
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
              placeholder="Contoh: Sakit demam, surat terlampir"
              value={editKeterangan}
              onChange={(e) => setEditKeterangan(e.target.value)}
            />

            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingItem(null)} disabled={savingStatus}>
                Batal
              </Button>
              <Button onClick={handleSaveStatus} loading={savingStatus}>
                Simpan Perubahan
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
