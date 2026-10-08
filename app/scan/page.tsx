"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RotateCcw,
  CalendarDays,
  Lock,
  Play,
  Edit2,
  Users,
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
import type {
  AttendanceSession,
  AttendanceStatus,
  ScanResult,
  Schedule,
  SessionStudentItem,
} from "@/lib/types";

type ViewState =
  | { kind: "scanning" }
  | { kind: "loading" }
  | { kind: "preview"; result: ScanResult }
  | { kind: "duplicate"; studentName: string; jam?: string; message?: string }
  | { kind: "success"; studentName: string; kelas: string; mapel: string; jam: string; status: AttendanceStatus }
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
  const searchParams = useSearchParams();
  const toast = useToast();

  const queryJadwal = searchParams.get("idJadwal") ?? "";
  const querySesi = searchParams.get("idSesi") ?? "";

  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [sessionStudents, setSessionStudents] = useState<SessionStudentItem[]>([]);
  const [selectedJadwalId, setSelectedJadwalId] = useState<string>(queryJadwal);
  const [startingSession, setStartingSession] = useState(false);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [markAlphaChecked, setMarkAlphaChecked] = useState(false);
  const [closingSession, setClosingSession] = useState(false);
  const [editingItem, setEditingItem] = useState<SessionStudentItem | null>(null);
  const [editStatus, setEditStatus] = useState<AttendanceStatus>("HADIR");
  const [editKeterangan, setEditKeterangan] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);
  const [manualInput, setManualInput] = useState("");

  const [view, setView] = useState<ViewState>({ kind: "scanning" });
  const busyRef = useRef(false);

  // Fetch today's schedule for current teacher
  const schedRes = useApi<Schedule[]>("getTodaySchedule", {});
  const schedules = useMemo(() => schedRes.data ?? [], [schedRes.data]);

  // Load session attendance list
  const loadSessionDetails = useCallback(async (sesId: string) => {
    if (!user) return;
    const res = await callApi<{ session: AttendanceSession; items: SessionStudentItem[] }>(
      "getSessionAttendance",
      { idSesi: sesId },
      user.token
    );
    if (res.success) {
      setSession(res.data.session);
      setSessionStudents(res.data.items);
    }
  }, [user]);

  // Init session check
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function initSession() {
      // 1. If querySesi provided, fetch it
      if (querySesi) {
        const res = await callApi<AttendanceSession>("getActiveSession", { idSesi: querySesi }, user?.token);
        if (!cancelled && res.success && res.data) {
          setSession(res.data);
          loadSessionDetails(res.data.idSesi);
          return;
        }
      }

      // 2. If queryJadwal provided, check active session for that schedule
      if (queryJadwal) {
        const res = await callApi<AttendanceSession>("getActiveSession", { idJadwal: queryJadwal }, user?.token);
        if (!cancelled && res.success && res.data) {
          setSession(res.data);
          loadSessionDetails(res.data.idSesi);
          return;
        }
      }

      // 3. Otherwise find any active session for teacher today
      const res = await callApi<AttendanceSession>("getActiveSession", {}, user?.token);
      if (!cancelled && res.success && res.data) {
        setSession(res.data);
        loadSessionDetails(res.data.idSesi);
      }
    }

    initSession();
    return () => {
      cancelled = true;
    };
  }, [user, querySesi, queryJadwal, loadSessionDetails]);

  // Handle starting an attendance session
  async function handleStartSession(idJadwal: string) {
    if (!user || !idJadwal) return;
    setStartingSession(true);
    const res = await callApi<AttendanceSession>("startAttendanceSession", { idJadwal }, user.token);
    setStartingSession(false);
    if (!res.success) {
      toast("error", res.message);
      return;
    }
    toast("success", "Sesi absensi dimulai.");
    setSession(res.data);
    loadSessionDetails(res.data.idSesi);
    reset();
  }

  // Handle closing an attendance session
  async function handleCloseSession() {
    if (!user || !session) return;
    setClosingSession(true);
    const res = await callApi<{ closed: boolean; session: AttendanceSession }>(
      "closeAttendanceSession",
      { idSesi: session.idSesi, markAlphaForUnrecorded: markAlphaChecked },
      user.token
    );
    setClosingSession(false);
    setCloseModalOpen(false);
    if (!res.success) {
      toast("error", res.message);
      return;
    }
    toast("success", "Sesi absensi berhasil ditutup.");
    setSession(res.data.session);
    loadSessionDetails(session.idSesi);
  }

  // Handle manual edit attendance status
  async function handleSaveStatus() {
    if (!user || !editingItem || !session) return;
    setSavingStatus(true);
    const res = await callApi(
      "updateAttendanceStatus",
      {
        idAbsensi: editingItem.attendance?.idAbsensi,
        idJadwal: session.idJadwal,
        nis: editingItem.student.nis,
        status: editStatus,
        keterangan: editKeterangan,
        tanggal: session.tanggal,
      },
      user.token
    );
    setSavingStatus(false);
    if (!res.success) {
      toast("error", res.message);
      return;
    }
    toast("success", `Status ${editingItem.student.nama} diperbarui.`);
    setEditingItem(null);
    loadSessionDetails(session.idSesi);
  }

  // QR Scan callback
  const handleScan = useCallback(
    async (raw: string) => {
      if (busyRef.current || !user) return;
      busyRef.current = true;

      const scannedText = raw.trim();
      if (!QR_FORMAT.test(scannedText)) {
        setView({ kind: "error", message: "QR Code tidak valid. Gunakan kartu QR siswa." });
        return;
      }

      // If active session exists, use session scan flow
      if (session && session.status === "ACTIVE") {
        setView({ kind: "loading" });
        const res = await callApi<{
          student: { nama: string; kelas: string };
          status: AttendanceStatus;
          jam: string;
        }>("scanSessionAttendance", { idSesi: session.idSesi, idQr: scannedText }, user.token);

        if (!res.success) {
          if (res.code === "DUPLICATE_ATTENDANCE") {
            setView({ kind: "duplicate", studentName: scannedText, message: res.message });
          } else {
            setView({ kind: "error", message: res.message });
          }
          return;
        }

        setView({
          kind: "success",
          studentName: res.data.student.nama,
          kelas: res.data.student.kelas,
          mapel: session.mataPelajaran,
          jam: res.data.jam,
          status: res.data.status,
        });

        // Refresh class attendance list immediately
        loadSessionDetails(session.idSesi);
        return;
      }

      // Fallback: standalone scan check
      setView({ kind: "loading" });
      const res = await callApi<ScanResult>("getStudentByQR", { idQr: scannedText }, user.token);
      if (!res.success) {
        setView({ kind: "error", message: res.message });
        return;
      }
      setView(
        res.data.alreadyRecorded
          ? { kind: "duplicate", studentName: res.data.student.nama, jam: res.data.alreadyRecorded.jam }
          : { kind: "preview", result: res.data }
      );
    },
    [user, session, loadSessionDetails]
  );

  function reset() {
    busyRef.current = false;
    setView({ kind: "scanning" });
  }

  const isSessionActive = session && session.status === "ACTIVE";

  return (
    <div className="flex flex-col gap-6">
      {/* Session Management Banner */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        {session ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold">
                  Sesi: Kelas {session.kelas} · {session.mataPelajaran}
                </span>
                {isSessionActive ? (
                  <span className="rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success">
                    SESI AKTIF
                  </span>
                ) : (
                  <span className="rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-semibold text-muted">
                    SESI DITUTUP
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">
                Tanggal: {session.tanggal} · Mulai: {session.jamMulai} · ID Sesi: {session.idSesi}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isSessionActive ? (
                <Button variant="danger" size="sm" onClick={() => setCloseModalOpen(true)}>
                  <Lock className="h-4 w-4" /> Tutup Sesi
                </Button>
              ) : (
                <Button size="sm" onClick={() => handleStartSession(session.idJadwal)} loading={startingSession}>
                  <Play className="h-4 w-4" /> Mulai Sesi Baru
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-bold">Mulai Sesi Absensi</h3>
              <p className="text-xs text-muted">Pilih jadwal pelajaran hari ini untuk mengaktifkan scanner.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={selectedJadwalId}
                onChange={(e) => setSelectedJadwalId(e.target.value)}
                className="w-full sm:w-64"
              >
                <option value="">Pilih Jadwal Mengajar</option>
                {schedules.map((s) => (
                  <option key={s.idJadwal} value={s.idJadwal}>
                    {s.jamMulai}–{s.jamSelesai} | Kls {s.kelas} - {s.mataPelajaran}
                  </option>
                ))}
              </Select>
              <Button
                onClick={() => handleStartSession(selectedJadwalId)}
                disabled={!selectedJadwalId}
                loading={startingSession}
              >
                <Play className="h-4 w-4" /> Mulai Absensi
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Main Grid: Scanner Left/Top, Student List Right/Bottom */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Scanner Column */}
        <div className="flex flex-col items-center gap-5 lg:col-span-5">
          {session && !isSessionActive && (
            <div
              role="alert"
              className="w-full rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm shadow-sm"
            >
              <Lock className="mx-auto mb-2 h-8 w-8 text-muted" />
              <p className="font-bold text-foreground">Sesi absensi sudah ditutup</p>
              <p className="mt-1 text-xs text-muted">
                Scanner tidak dapat mencatat absensi baru untuk sesi ini.
              </p>
              <Button
                size="sm"
                className="mt-4"
                onClick={() => handleStartSession(session.idJadwal)}
                loading={startingSession}
              >
                Mulai Sesi Baru
              </Button>
            </div>
          )}

          {(!session || isSessionActive) && (
            <>
              {(view.kind === "scanning" || view.kind === "loading") && (
                <>
                  <h2 className="text-center text-lg font-bold">SCAN QR SISWA</h2>
                  <QRScanner active={view.kind === "scanning"} onScan={handleScan} />
                  <p className="text-center text-xs text-muted" aria-live="polite">
                    {view.kind === "loading"
                      ? "Memeriksa data siswa..."
                      : "Posisikan QR siswa di dalam frame atau ambil foto QR"}
                  </p>

                  <div className="w-full max-w-sm pt-3 border-t border-gray-200">
                    <p className="mb-2 text-center text-xs font-medium text-muted">
                      Atau input manual jika kamera bermasalah:
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
                        placeholder="Ketik NIS atau ID QR siswa..."
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

              {view.kind === "preview" && (
                <div className="w-full rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                  <h2 className="mb-4 text-center text-lg font-bold">Konfirmasi Absensi</h2>
                  <dl className="flex flex-col gap-3 text-sm">
                    <Row label="Nama" value={view.result.student.nama} />
                    <Row label="NIS" value={view.result.student.nis} />
                    <Row label="Kelas" value={view.result.student.kelas} />
                    <Row label="Mata Pelajaran" value={view.result.schedule.mataPelajaran} />
                    <Row label="Jadwal" value={`${view.result.schedule.jamMulai}–${view.result.schedule.jamSelesai}`} />
                    <div className="flex items-center justify-between pt-1">
                      <dt className="font-medium text-muted">Status</dt>
                      <dd>
                        <StatusBadge status={view.result.status} />
                      </dd>
                    </div>
                  </dl>
                  <Button size="lg" onClick={reset} className="mt-6 w-full">
                    Selesai
                  </Button>
                </div>
              )}

              {view.kind === "success" && (
                <div className="flex w-full flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
                  <CheckCircle2 className="h-14 w-14 text-success" aria-hidden />
                  <h2 className="text-lg font-bold">ABSENSI BERHASIL</h2>
                  <div>
                    <p className="text-base font-semibold">{view.studentName}</p>
                    <p className="text-sm text-muted">
                      Kelas {view.kelas} · {view.mapel}
                    </p>
                    <p className="mt-1 text-sm text-muted">Pukul {view.jam}</p>
                  </div>
                  <StatusBadge status={view.status} />
                  <Button size="lg" onClick={reset} className="mt-2 w-full">
                    Scan Siswa Berikutnya
                  </Button>
                </div>
              )}

              {view.kind === "duplicate" && (
                <div className="flex w-full flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
                  <AlertTriangle className="h-14 w-14 text-warning" aria-hidden />
                  <h2 className="text-lg font-bold">SUDAH ABSEN</h2>
                  <p className="text-sm font-semibold">{view.studentName}</p>
                  <p className="text-sm text-muted">
                    {view.message ?? (view.jam ? `Sudah absen pukul ${view.jam}` : "Siswa sudah melakukan absensi")}
                  </p>
                  <Button size="lg" variant="outline" onClick={reset} className="mt-2 w-full">
                    Kembali Scan
                  </Button>
                </div>
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
            </>
          )}
        </div>

        {/* Attendance List Column */}
        <div className="flex flex-col gap-4 lg:col-span-7">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-bold">
                <Users className="h-5 w-5 text-primary" />
                Daftar Siswa {session ? `Kelas ${session.kelas}` : ""}
              </h3>
              <span className="text-xs text-muted">
                Total: {sessionStudents.length} siswa
              </span>
            </div>

            {sessionStudents.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted">
                {session
                  ? "Tidak ada data siswa untuk kelas ini."
                  : "Mulai sesi absensi untuk menampilkan daftar siswa."}
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
                      <th className="px-3 py-2.5">Jam</th>
                      <th className="px-3 py-2.5 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sessionStudents.map((item, idx) => (
                      <tr key={item.student.nis} className="hover:bg-gray-50">
                        <td className="px-3 py-2.5 text-muted">{idx + 1}</td>
                        <td className="px-3 py-2.5 font-mono text-xs">{item.student.nis}</td>
                        <td className="px-3 py-2.5 font-medium">{item.student.nama}</td>
                        <td className="px-3 py-2.5">
                          {item.status === "BELUM_ABSEN" ? (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-muted">
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
                <span className="font-semibold">Kelas:</span> {editingItem.student.kelas}
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

      {/* Close Session Confirmation Modal */}
      {closeModalOpen && (
        <Modal open onClose={() => setCloseModalOpen(false)} title="Konfirmasi Tutup Sesi">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-foreground">
              Apakah Anda yakin ingin menutup sesi absensi untuk{" "}
              <span className="font-bold">Kelas {session?.kelas} - {session?.mataPelajaran}</span>?
            </p>
            <p className="text-xs text-muted">
              Setelah sesi ditutup, QR Scanner tidak dapat mencatat absensi baru pada sesi ini.
            </p>

            <label className="flex items-start gap-2.5 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={markAlphaChecked}
                onChange={(e) => setMarkAlphaChecked(e.target.checked)}
                className="mt-0.5 rounded text-primary focus:ring-primary"
              />
              <div>
                <span className="font-semibold text-foreground">
                  Tandai siswa yang belum hadir sebagai Alpa
                </span>
                <p className="text-muted mt-0.5">
                  Siswa di kelas ini yang belum melakukan absensi akan otomatis dicatat sebagai Alpa.
                </p>
              </div>
            </label>

            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCloseModalOpen(false)} disabled={closingSession}>
                Batal
              </Button>
              <Button variant="danger" onClick={handleCloseSession} loading={closingSession}>
                Tutup Sesi
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
    <div className="flex items-center justify-between gap-4">
      <dt className="font-medium text-muted">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
}
