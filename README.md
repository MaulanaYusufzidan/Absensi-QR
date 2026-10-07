# Absensi Siswa QR

Aplikasi absensi siswa berbasis QR. Frontend Next.js (App Router, TypeScript, Tailwind v4),
backend satu file Google Apps Script (`apps-script/Code.gs`) di atas Google Sheets.

## Arsitektur

- Frontend -> `POST` JSON (`text/plain`) ke `NEXT_PUBLIC_APPS_SCRIPT_URL` (Apps Script Web App).
- Backend = `apps-script/Code.gs`; database = Google Spreadsheet (sheet SISWA, ABSENSI, GURU, JADWAL, QR_CETAK, PENGATURAN).
- Tidak ada migrasi/seed: data memakai spreadsheet yang sudah ada. Tidak ada baris yang pernah dihapus oleh kode.
- Waktu server (Asia/Jakarta) adalah sumber kebenaran; frontend hanya mengirim identifier (ID_QR).

## Perintah

```bash
npm install
cp .env.example .env.local      # isi NEXT_PUBLIC_APPS_SCRIPT_URL
npm run dev                     # http://localhost:3000
npm run typecheck
npm run lint
npm run build && npm run start  # produksi
npm run test:backend            # menjalankan Code.gs asli dengan Google Services palsu
```

## Uji lokal tanpa Google (stub)

```bash
node stub-server.js             # http://localhost:8787/exec (menjalankan Code.gs asli, data di memori)
echo 'NEXT_PUBLIC_APPS_SCRIPT_URL=http://localhost:8787/exec' > .env.local
npm run dev
```

Akun uji stub (hanya di memori): `guru1` / `test-guru-1`, `admin` / `test-admin`.

E2E browser (butuh Chromium Playwright + ffmpeg untuk video kamera palsu):

```bash
NEXT_PUBLIC_APPS_SCRIPT_URL=http://localhost:8787/exec npm run build
node run-e2e.js
```

## Deploy

1. Apps Script: tempel `apps-script/Code.gs`, Deploy > New deployment > Web app (Execute as: Me, Access: Anyone). Salin URL `/exec`.
2. Netlify: set env `NEXT_PUBLIC_APPS_SCRIPT_URL`, deploy (`netlify.toml` sudah ada).
3. Login memakai SHA-256 dari password dan dibandingkan dengan kolom `PASSWORD_HASH` di sheet GURU.
   Buat akun baru lewat halaman Data Guru (admin); password di-hash di server.
