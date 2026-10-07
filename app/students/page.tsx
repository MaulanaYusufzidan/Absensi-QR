"use client";

import { useMemo, useState } from "react";
import { Search, Plus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { DataTable, Column } from "@/components/DataTable";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { ErrorNote } from "@/components/ErrorNote";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/Toast";
import { callApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { Student } from "@/lib/types";

const PAGE_SIZE = 10;

export default function StudentsPage() {
  const studentsRes = useApi<Student[]>("getStudents", {});
  const students = useMemo(() => studentsRes.data ?? [], [studentsRes.data]);
  const [search, setSearch] = useState("");
  const [kelasFilter, setKelasFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Student | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const kelasOptions = useMemo(() => Array.from(new Set(students.map((s) => s.kelas))).sort(), [students]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter(
      (s) =>
        (!q || s.nama.toLowerCase().includes(q) || s.nis.includes(q)) &&
        (!kelasFilter || s.kelas === kelasFilter) &&
        (!statusFilter || s.status === statusFilter)
    );
  }, [students, search, kelasFilter, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const columns: Column<Student>[] = [
    { key: "no", header: "No", render: (s) => s.no },
    { key: "nama", header: "Nama", render: (s) => s.nama },
    { key: "nis", header: "NIS", render: (s) => s.nis },
    { key: "nisn", header: "NISN", render: (s) => s.nisn },
    { key: "kelas", header: "Kelas", render: (s) => s.kelas },
    { key: "idQr", header: "ID QR", render: (s) => <span className="font-mono">{s.idQr}</span> },
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
      render: (s) => (
        <button
          onClick={() => {
            setEditing(s);
            setModalOpen(true);
          }}
          className="text-sm font-semibold text-primary hover:underline"
        >
          Edit
        </button>
      ),
    },
  ];

  return (
    <AppShell title="Data Siswa" requireRole="ADMIN">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              placeholder="Cari nama atau NIS..."
              className="pl-9"
              aria-label="Cari siswa"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Select
              value={kelasFilter}
              aria-label="Filter kelas"
              onChange={(e) => {
                setKelasFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Semua Kelas</option>
              {kelasOptions.map((k) => (
                <option key={k} value={k}>
                  Kelas {k}
                </option>
              ))}
            </Select>
            <Select
              value={statusFilter}
              aria-label="Filter status"
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Semua Status</option>
              <option value="AKTIF">Aktif</option>
              <option value="NONAKTIF">Nonaktif</option>
            </Select>
            <Button
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden /> Tambah
            </Button>
          </div>
        </div>

        {studentsRes.error && <ErrorNote message={studentsRes.error} onRetry={studentsRes.reload} />}

        <DataTable
          columns={columns}
          rows={pageRows}
          rowKey={(s) => s.idQr}
          loading={studentsRes.loading}
          emptyTitle="Tidak ada siswa"
          emptyDescription="Coba ubah kata kunci pencarian atau filter."
        />

        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">
              Halaman {currentPage} dari {pageCount}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
                Sebelumnya
              </Button>
              <Button size="sm" variant="outline" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>
                Berikutnya
              </Button>
            </div>
          </div>
        )}
      </div>

      {modalOpen && (
        <StudentModal
          student={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            studentsRes.reload();
          }}
        />
      )}
    </AppShell>
  );
}

function StudentModal({
  student,
  onClose,
  onSaved,
}: {
  student: Student | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState<Partial<Student>>(() => student ?? { status: "AKTIF" });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!user) return;
    if (!form.nama || !form.nis || !form.kelas) {
      toast("error", "Nama, NIS, dan Kelas wajib diisi.");
      return;
    }
    setSaving(true);
    const res = await callApi("saveStudent", { student: form }, user.token);
    setSaving(false);
    if (!res.success) {
      toast("error", res.message);
      return;
    }
    toast("success", "Data siswa disimpan.");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={student ? "Edit Siswa" : "Tambah Siswa"}>
      <div className="flex flex-col gap-3">
        <Input label="Nama" value={form.nama ?? ""} onChange={(e) => setForm((f) => ({ ...f, nama: e.target.value }))} />
        <Input
          label="NIS"
          value={form.nis ?? ""}
          disabled={!!student}
          onChange={(e) => setForm((f) => ({ ...f, nis: e.target.value }))}
        />
        <Input label="NISN" value={form.nisn ?? ""} onChange={(e) => setForm((f) => ({ ...f, nisn: e.target.value }))} />
        <Input label="Kelas" value={form.kelas ?? ""} onChange={(e) => setForm((f) => ({ ...f, kelas: e.target.value }))} />
        <Input label="TTL" value={form.ttl ?? ""} onChange={(e) => setForm((f) => ({ ...f, ttl: e.target.value }))} />
        <Input label="Alamat" value={form.alamat ?? ""} onChange={(e) => setForm((f) => ({ ...f, alamat: e.target.value }))} />
        {student && (
          <Input
            label="ID QR (permanen)"
            value={form.idQr ?? ""}
            disabled
            readOnly
            title="ID QR tidak dapat diubah agar kartu QR yang sudah dicetak tetap berlaku."
          />
        )}
        <Select
          label="Status"
          value={form.status ?? "AKTIF"}
          onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Student["status"] }))}
        >
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
