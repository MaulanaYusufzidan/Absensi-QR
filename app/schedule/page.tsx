"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { DataTable, Column } from "@/components/DataTable";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import { Modal } from "@/components/Modal";
import { ErrorNote } from "@/components/ErrorNote";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/Toast";
import { callApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { Schedule, Teacher } from "@/lib/types";

const DAYS = ["SENIN", "SELASA", "RABU", "KAMIS", "JUMAT", "SABTU"];

import Link from "next/link";
import { ScanLine } from "lucide-react";

export default function SchedulePage() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === "ADMIN";
  const schedRes = useApi<Schedule[]>("getSchedules", {});
  // The teacher list is only requested (and only allowed by the server) for admins.
  const teachersRes = useApi<Teacher[]>("getTeachers", isAdmin ? {} : null);
  const rows = useMemo(() => schedRes.data ?? [], [schedRes.data]);
  const teachers = useMemo(() => teachersRes.data ?? [], [teachersRes.data]);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function toggleStatus(s: Schedule) {
    if (!user) return;
    const next = s.status === "AKTIF" ? "NONAKTIF" : "AKTIF";
    const action = isAdmin ? "saveSchedule" : "createSchedule";
    const res = await callApi(action, { schedule: { ...s, status: next } }, user.token);
    if (res.success) {
      toast("success", "Status jadwal diperbarui.");
      schedRes.reload();
    } else {
      toast("error", res.message);
    }
  }

  const columns: Column<Schedule>[] = [
    { key: "hari", header: "Hari", render: (s) => s.hari },
    { key: "jam", header: "Jam", render: (s) => `${s.jamMulai}–${s.jamSelesai}` },
    { key: "kelas", header: "Kelas", render: (s) => s.kelas },
    { key: "mapel", header: "Mata Pelajaran", render: (s) => s.mataPelajaran },
    { key: "guru", header: "Guru", render: (s) => s.namaGuru ?? s.idGuru },
    {
      key: "status",
      header: "Status",
      render: (s) => (
        <span
          className={
            s.status === "AKTIF"
              ? "rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success"
              : "rounded-full bg-gray-200 px-2.5 py-1 text-xs font-semibold text-muted"
          }
        >
          {s.status}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (s: Schedule) => {
        const canManage = isAdmin || (user && s.idGuru === user.idGuru);
        if (!canManage) return null;
        return (
          <div className="flex items-center gap-3">
            {s.status === "AKTIF" && (
              <Link
                href={`/scan?idJadwal=${s.idJadwal}`}
                className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
              >
                <ScanLine className="h-3.5 w-3.5" /> Absensi
              </Link>
            )}
            <button
              className="text-xs font-semibold text-primary hover:underline"
              onClick={() => {
                setEditing(s);
                setModalOpen(true);
              }}
            >
              Edit
            </button>
            <button
              className="text-xs font-semibold text-muted hover:underline"
              onClick={() => toggleStatus(s)}
            >
              {s.status === "AKTIF" ? "Nonaktifkan" : "Aktifkan"}
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <AppShell title="Jadwal">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">
            {isAdmin ? "Semua jadwal pelajaran aktif di sekolah." : "Daftar jadwal pelajaran Anda."}
          </p>
          <Button
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden /> Tambah Jadwal
          </Button>
        </div>
        {schedRes.error && <ErrorNote message={schedRes.error} onRetry={schedRes.reload} />}
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(s) => s.idJadwal}
          loading={schedRes.loading}
          emptyTitle="Belum ada jadwal"
        />
      </div>

      {modalOpen && (
        <ScheduleModal
          schedule={editing}
          teachers={teachers}
          isAdmin={isAdmin}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            schedRes.reload();
          }}
        />
      )}
    </AppShell>
  );
}

function ScheduleModal({
  schedule,
  teachers,
  isAdmin,
  onClose,
  onSaved,
}: {
  schedule: Schedule | null;
  teachers: Teacher[];
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
  }) {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState<Partial<Schedule & { tanggal?: string }>>(() => {
    if (schedule) return { ...schedule };
    return {
      hari: "SENIN",
      status: "AKTIF",
      idGuru: user?.role === "GURU" ? user?.idGuru : "",
    };
  });
  const [saving, setSaving] = useState(false);

  function onDateChange(val: string) {
    if (!val) return;
    const dayNames = ["MINGGU", "SENIN", "SELASA", "RABU", "KAMIS", "JUMAT", "SABTU"];
    const d = new Date(val + "T00:00:00+07:00");
    const h = dayNames[d.getDay()] || "SENIN";
    setForm((f) => ({ ...f, tanggal: val, hari: h }));
  }

  async function save() {
    if (!user) return;
    const targetGuru = isAdmin ? form.idGuru : user.idGuru;
    if (!form.hari || !form.jamMulai || !form.jamSelesai || !form.kelas || !form.mataPelajaran || !targetGuru) {
      toast("error", "Semua field jadwal wajib diisi.");
      return;
    }
    setSaving(true);
    const action = isAdmin ? "saveSchedule" : "createSchedule";
    const res = await callApi(
      action,
      { schedule: { ...form, idGuru: targetGuru } },
      user.token
    );
    setSaving(false);
    if (!res.success) {
      toast("error", res.message);
      return;
    }
    toast("success", "Jadwal berhasil disimpan.");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={schedule ? "Edit Jadwal" : "Tambah Jadwal"}>
      <div className="flex flex-col gap-3">
        <div>
          <Input
            type="date"
            label="Tanggal (Opsional: otomatis menentukan hari)"
            value={form.tanggal ?? ""}
            onChange={(e) => onDateChange(e.target.value)}
          />
        </div>
        <Select
          label="Hari"
          value={form.hari ?? "SENIN"}
          onChange={(e) => setForm((f) => ({ ...f, hari: e.target.value }))}
        >
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <Input
            type="time"
            label="Jam Mulai"
            value={form.jamMulai ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, jamMulai: e.target.value }))}
          />
          <Input
            type="time"
            label="Jam Selesai"
            value={form.jamSelesai ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, jamSelesai: e.target.value }))}
          />
        </div>
        <Input
          label="Kelas"
          placeholder="Contoh: 7"
          value={form.kelas ?? ""}
          onChange={(e) => setForm((f) => ({ ...f, kelas: e.target.value }))}
        />
        <Input
          label="Mata Pelajaran"
          placeholder="Contoh: IPA"
          value={form.mataPelajaran ?? ""}
          onChange={(e) => setForm((f) => ({ ...f, mataPelajaran: e.target.value }))}
        />
        {isAdmin ? (
          <Select
            label="Guru"
            value={form.idGuru ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, idGuru: e.target.value }))}
          >
            <option value="">Pilih guru</option>
            {teachers.map((t) => (
              <option key={t.idGuru} value={t.idGuru}>
                {t.namaGuru} ({t.idGuru})
              </option>
            ))}
          </Select>
        ) : (
          <Input
            label="Guru Pengajar"
            value={`${user?.namaGuru} (${user?.idGuru})`}
            disabled
          />
        )}
        <Button onClick={save} loading={saving} className="mt-2">
          Simpan
        </Button>
      </div>
    </Modal>
  );
}
