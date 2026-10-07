"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Skeleton } from "@/components/Skeleton";
import { ErrorNote } from "@/components/ErrorNote";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/Toast";
import { callApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { Settings } from "@/lib/types";

const DEFAULTS: Settings = {
  NAMA_SEKOLAH: "",
  BATAS_KETERLAMBATAN: "15",
  ZONA_WAKTU: "Asia/Jakarta",
  DURASI_SESSION: "120",
  VALIDASI_JAM: "true",
};

export default function SettingsPage() {
  const { data, loading, error, reload } = useApi<Settings>("getSettings", {});

  return (
    <AppShell title="Pengaturan" requireRole="ADMIN">
      {loading && (
        <div className="flex max-w-lg flex-col gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      )}
      {error && <ErrorNote message={error} onRetry={reload} />}
      {data && <SettingsForm initial={{ ...DEFAULTS, ...data }} />}
    </AppShell>
  );
}

function SettingsForm({ initial }: { initial: Settings }) {
  const { user } = useAuth();
  const toast = useToast();
  const [settings, setSettings] = useState<Settings>(initial);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!user) return;
    setSaving(true);
    const res = await callApi("updateSettings", { settings }, user.token);
    setSaving(false);
    if (!res.success) {
      toast("error", res.message);
      return;
    }
    toast("success", "Pengaturan disimpan.");
  }

  return (
    <div className="flex max-w-lg flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6">
      <Input
        label="Nama Sekolah"
        value={settings.NAMA_SEKOLAH}
        onChange={(e) => setSettings((s) => ({ ...s, NAMA_SEKOLAH: e.target.value }))}
      />
      <Input
        label="Batas Keterlambatan (menit)"
        type="number"
        min={0}
        value={settings.BATAS_KETERLAMBATAN}
        onChange={(e) => setSettings((s) => ({ ...s, BATAS_KETERLAMBATAN: e.target.value }))}
      />
      <div>
        <Input label="Zona Waktu" value={settings.ZONA_WAKTU} disabled readOnly />
        <p className="mt-1 text-xs text-muted">
          Terkunci ke Asia/Jakarta (ditetapkan di Code.gs). Waktu absensi selalu berasal dari server.
        </p>
      </div>
      <Input
        label="Durasi Sesi Login (menit)"
        type="number"
        min={1}
        value={settings.DURASI_SESSION}
        onChange={(e) => setSettings((s) => ({ ...s, DURASI_SESSION: e.target.value }))}
      />
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={settings.VALIDASI_JAM !== "false"}
          onChange={(e) => setSettings((s) => ({ ...s, VALIDASI_JAM: e.target.checked ? "true" : "false" }))}
        />
        Validasi jam jadwal (tolak scan di luar jadwal)
      </label>
      <Button onClick={save} loading={saving} className="mt-2">
        Simpan Pengaturan
      </Button>
    </div>
  );
}
