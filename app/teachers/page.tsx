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
import type { Teacher } from "@/lib/types";

export default function TeachersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const teachersRes = useApi<Teacher[]>("getTeachers", {});
  const rows = useMemo(() => teachersRes.data ?? [], [teachersRes.data]);
  const [editing, setEditing] = useState<Teacher | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function toggleStatus(t: Teacher) {
    if (!user) return;
    const next = t.status === "AKTIF" ? "NONAKTIF" : "AKTIF";
    // No password field is sent, so the stored hash is kept unchanged by the server.
    const res = await callApi("saveTeacher", { teacher: { ...t, status: next } }, user.token);
    if (res.success) {
      toast("success", "Status guru diperbarui.");
      teachersRes.reload();
    } else {
      toast("error", res.message);
    }
  }

  const columns: Column<Teacher>[] = [
    { key: "idGuru", header: "ID Guru", render: (t) => t.idGuru },
    { key: "nip", header: "NIP", render: (t) => t.nip },
    { key: "nama", header: "Nama", render: (t) => t.namaGuru },
    { key: "username", header: "Username", render: (t) => t.username },
    { key: "role", header: "Role", render: (t) => t.role },
    {
      key: "status",
      header: "Status",
      render: (t) => (
        <span
          className={
            t.status === "AKTIF"
              ? "rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success"
              : "rounded-full bg-gray-200 px-2.5 py-1 text-xs font-semibold text-muted"
          }
        >
          {t.status}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (t) => (
        <div className="flex gap-3">
          <button
            className="text-sm font-semibold text-primary hover:underline"
            onClick={() => {
              setEditing(t);
              setModalOpen(true);
            }}
          >
            Edit
          </button>
          <button className="text-sm font-semibold text-muted hover:underline" onClick={() => toggleStatus(t)}>
            {t.status === "AKTIF" ? "Nonaktifkan" : "Aktifkan"}
          </button>
        </div>
      ),
    },
  ];

  return (
    <AppShell title="Data Guru" requireRole="ADMIN">
      <div className="flex flex-col gap-4">
        <div className="flex justify-end">
          <Button
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden /> Tambah Guru
          </Button>
        </div>
        {teachersRes.error && <ErrorNote message={teachersRes.error} onRetry={teachersRes.reload} />}
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(t) => t.idGuru}
          loading={teachersRes.loading}
          emptyTitle="Belum ada guru"
        />
      </div>

      {modalOpen && (
        <TeacherModal
          teacher={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            teachersRes.reload();
          }}
        />
      )}
    </AppShell>
  );
}

function TeacherModal({
  teacher,
  onClose,
  onSaved,
}: {
  teacher: Teacher | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState<Partial<Teacher> & { password?: string }>(
    () => teacher ?? { status: "AKTIF", role: "GURU" }
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!user) return;
    if (!form.namaGuru || !form.username || (!teacher && !form.password)) {
      toast("error", "Nama, username, dan password (untuk guru baru) wajib diisi.");
      return;
    }
    setSaving(true);
    const res = await callApi("saveTeacher", { teacher: form }, user.token);
    setSaving(false);
    if (!res.success) {
      toast("error", res.message);
      return;
    }
    toast("success", "Data guru disimpan.");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={teacher ? "Edit Guru" : "Tambah Guru"}>
      <div className="flex flex-col gap-3">
        <Input label="Nama" value={form.namaGuru ?? ""} onChange={(e) => setForm((f) => ({ ...f, namaGuru: e.target.value }))} />
        <Input label="NIP" value={form.nip ?? ""} onChange={(e) => setForm((f) => ({ ...f, nip: e.target.value }))} />
        <Input
          label="Username"
          autoCapitalize="none"
          value={form.username ?? ""}
          onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
        />
        <Input
          label={teacher ? "Password baru (kosongkan jika tidak diubah)" : "Password"}
          type="password"
          autoComplete="new-password"
          value={form.password ?? ""}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
        />
        <Select label="Role" value={form.role ?? "GURU"} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Teacher["role"] }))}>
          <option value="GURU">Guru</option>
          <option value="ADMIN">Admin</option>
        </Select>
        <Select label="Status" value={form.status ?? "AKTIF"} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Teacher["status"] }))}>
          <option value="AKTIF">Aktif</option>
          <option value="NONAKTIF">Nonaktif</option>
        </Select>
        <Button onClick={save} loading={saving} className="mt-2">
          Simpan
        </Button>
      </div>
    </Modal>
  );
}
