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
    const res = await callApi("saveSchedule", { schedule: { ...s, status: next } }, user.token);
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
    ...(isAdmin
      ? [
          {
            key: "actions",
            header: "",
            render: (s: Schedule) => (
              <div className="flex gap-3">
                <button
                  className="text-sm font-semibold text-primary hover:underline"
                  onClick={() => {
                    setEditing(s);
                    setModalOpen(true);
                  }}
                >
                  Edit
                </button>
                <button className="text-sm font-semibold text-muted hover:underline" onClick={() => toggleStatus(s)}>
                  {s.status === "AKTIF" ? "Nonaktifkan" : "Aktifkan"}
                </button>
              </div>
            ),
          } as Column<Schedule>,
        ]
      : []),
  ];

  return (
    <AppShell title="Jadwal">
      <div className="flex flex-col gap-4">
        {isAdmin && (
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden /> Tambah Jadwal
            </Button>
          </div>
        )}
        {schedRes.error && <ErrorNote message={schedRes.error} onRetry={schedRes.reload} />}
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(s) => s.idJadwal}
          loading={schedRes.loading}
          emptyTitle="Belum ada jadwal"
        />
      </div>

      {isAdmin && modalOpen && (
        <ScheduleModal
          schedule={editing}
          teachers={teachers}
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
  onClose,
  onSaved,
}: {
  schedule: Schedule | null;
  teachers: Teacher[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState<Partial<Schedule>>(() => schedule ?? { hari: "SENIN", status: "AKTIF" });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!user) return;
    if (!form.hari || !form.jamMulai || !form.jamSelesai || !form.kelas || !form.mataPelajaran || !form.idGuru) {
      toast("error", "Semua field wajib diisi.");
      return;
    }
    setSaving(true);
    const res = await callApi("saveSchedule", { schedule: form }, user.token);
    setSaving(false);
    if (!res.success) {
      toast("error", res.message);
      return;
    }
    toast("success", "Jadwal disimpan.");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={schedule ? "Edit Jadwal" : "Tambah Jadwal"}>
      <div className="flex flex-col gap-3">
        <Select label="Hari" value={form.hari ?? "SENIN"} onChange={(e) => setForm((f) => ({ ...f, hari: e.target.value }))}>
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <Input type="time" label="Jam Mulai" value={form.jamMulai ?? ""} onChange={(e) => setForm((f) => ({ ...f, jamMulai: e.target.value }))} />
          <Input type="time" label="Jam Selesai" value={form.jamSelesai ?? ""} onChange={(e) => setForm((f) => ({ ...f, jamSelesai: e.target.value }))} />
        </div>
        <Input label="Kelas" value={form.kelas ?? ""} onChange={(e) => setForm((f) => ({ ...f, kelas: e.target.value }))} />
        <Input label="Mata Pelajaran" value={form.mataPelajaran ?? ""} onChange={(e) => setForm((f) => ({ ...f, mataPelajaran: e.target.value }))} />
        <Select label="Guru" value={form.idGuru ?? ""} onChange={(e) => setForm((f) => ({ ...f, idGuru: e.target.value }))}>
          <option value="">Pilih guru</option>
          {teachers.map((t) => (
            <option key={t.idGuru} value={t.idGuru}>
              {t.namaGuru}
            </option>
          ))}
        </Select>
        <Button onClick={save} loading={saving} className="mt-2">
          Simpan
        </Button>
      </div>
    </Modal>
  );
}
