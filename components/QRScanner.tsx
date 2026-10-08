"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { RefreshCw, CameraOff, Camera, Upload, AlertCircle } from "lucide-react";
import type { Html5Qrcode } from "html5-qrcode";

interface QRScannerProps {
  /** The camera runs only while true. The scan page sets it false while a lookup is in flight (= pause). */
  active: boolean;
  onScan: (text: string) => void;
}

interface CameraInfo {
  id: string;
  label: string;
}

const SCAN_CONFIG = {
  fps: 10,
  qrbox: { width: 250, height: 250 },
  aspectRatio: 1.0,
};

const CONTAINER_ID = "qr-reader-region";
const FILE_DECODER_CONTAINER_ID = "qr-file-decoder-temp";

export function QRScanner({ active, onScan }: QRScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileScannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firedRef = useRef(false);
  const onScanRef = useRef(onScan);

  const [error, setError] = useState<string | null>(null);
  const [isInsecureHttp, setIsInsecureHttp] = useState(false);
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [cameraIndex, setCameraIndex] = useState(0);
  const [starting, setStarting] = useState(false);
  const [scanningFile, setScanningFile] = useState(false);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const handleDecoded = useCallback((text: string) => {
    if (firedRef.current) return;
    firedRef.current = true;
    onScanRef.current(text);
  }, []);

  const stopScannerSafely = useCallback(async () => {
    const scanner = scannerRef.current;
    if (scanner) {
      try {
        if (scanner.isScanning) {
          await scanner.stop();
        }
        await scanner.clear();
      } catch {
        // ignore stop error
      }
      scannerRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    setStarting(true);
    firedRef.current = false;

    // Detect insecure context (e.g. accessing http://192.168.x.x:3000 from mobile phone)
    if (
      typeof window !== "undefined" &&
      !window.isSecureContext &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      setIsInsecureHttp(true);
    }

    try {
      await stopScannerSafely();

      const { Html5Qrcode } = await import("html5-qrcode");

      // Verify DOM element exists
      const el = document.getElementById(CONTAINER_ID);
      if (!el) {
        setStarting(false);
        return;
      }
      el.innerHTML = "";

      const scanner = new Html5Qrcode(CONTAINER_ID, { verbose: false });
      scannerRef.current = scanner;

      let started = false;

      // Strategy 1: Try rear camera { facingMode: "environment" } (standard for mobile)
      try {
        await scanner.start(
          { facingMode: "environment" },
          SCAN_CONFIG,
          handleDecoded,
          () => {}
        );
        started = true;
      } catch {
        // Strategy 2: Try front camera / desktop webcam { facingMode: "user" }
        try {
          await scanner.start(
            { facingMode: "user" },
            SCAN_CONFIG,
            handleDecoded,
            () => {}
          );
          started = true;
        } catch {
          // Strategy 3: Try specific device ID if enumerated
          try {
            const devices = await Html5Qrcode.getCameras();
            if (devices && devices.length > 0) {
              await scanner.start(
                devices[0].id,
                SCAN_CONFIG,
                handleDecoded,
                () => {}
              );
              started = true;
            }
          } catch {
            // all strategies failed
          }
        }
      }

      if (!started) {
        throw new Error("Gagal mengaktifkan kamera.");
      }

      // Populate camera list for switching if multiple cameras are available
      try {
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length > 0) {
          setCameras(devices.map((d, i) => ({ id: d.id, label: d.label || `Kamera ${i + 1}` })));
        }
      } catch {
        // non-fatal
      }
    } catch (err: unknown) {
      let msg = "Izin kamera diperlukan untuk melakukan absensi.";
      if (
        typeof window !== "undefined" &&
        !window.isSecureContext &&
        window.location.hostname !== "localhost" &&
        window.location.hostname !== "127.0.0.1"
      ) {
        msg =
          "Browser HP membatasi kamera langsung di jaringan HTTP (bukan HTTPS). Gunakan tombol 'Ambil Foto QR' di bawah untuk scan!";
      } else if (err instanceof Error) {
        if (err.name === "NotAllowedError" || err.message.toLowerCase().includes("permission")) {
          msg = "Izin kamera ditolak. Silakan izinkan akses kamera pada ikon gembok di bilah alamat browser Anda.";
        } else if (err.name === "NotFoundError" || err.message.toLowerCase().includes("found")) {
          msg = "Kamera tidak ditemukan pada perangkat ini. Pastikan webcam terpasang atau gunakan opsi Ambil Foto.";
        } else if (err.name === "NotReadableError" || err.message.toLowerCase().includes("readable")) {
          msg = "Kamera sedang digunakan oleh aplikasi lain. Tutup aplikasi yang menggunakan webcam lalu coba lagi.";
        }
      }
      setError(msg);
    } finally {
      setStarting(false);
    }
  }, [handleDecoded, stopScannerSafely]);

  // Handle active prop changes
  useEffect(() => {
    if (!active) {
      stopScannerSafely();
      return;
    }

    startCamera();

    return () => {
      stopScannerSafely();
    };
  }, [active, startCamera, stopScannerSafely]);

  // Switch camera between front and rear
  async function switchCamera() {
    const scanner = scannerRef.current;
    if (cameras.length < 2 || !scanner) return;
    const next = (cameraIndex + 1) % cameras.length;
    try {
      if (scanner.isScanning) {
        await scanner.stop();
      }
      await scanner.start(
        cameras[next].id,
        SCAN_CONFIG,
        handleDecoded,
        () => {}
      );
      setCameraIndex(next);
    } catch {
      setError("Tidak dapat mengganti kamera.");
    }
  }

  // Fallback: Scan QR from image file or native phone camera snapshot
  async function handleFileScan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanningFile(true);
    setError(null);

    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (!fileScannerRef.current) {
        fileScannerRef.current = new Html5Qrcode(FILE_DECODER_CONTAINER_ID, { verbose: false });
      }
      const decoded = await fileScannerRef.current.scanFile(file, true);
      if (decoded) {
        handleDecoded(decoded);
      }
    } catch {
      setError("QR Code tidak terdeteksi pada gambar/foto. Pastikan QR Code terlihat jelas dan tegak.");
    } finally {
      setScanningFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 w-full max-w-sm">
      {/* Hidden container for file decoder */}
      <div id={FILE_DECODER_CONTAINER_ID} className="hidden" />

      {/* Hidden file input with native mobile camera trigger */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileScan}
        className="hidden"
      />

      {error ? (
        <div
          role="alert"
          className="flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-2xl bg-gray-900 p-6 text-center text-white shadow-md"
        >
          <CameraOff className="h-10 w-10 text-red-400" aria-hidden />
          <p className="text-xs leading-relaxed text-gray-200">{error}</p>

          <div className="flex flex-col gap-2 w-full mt-2">
            <button
              type="button"
              onClick={startCamera}
              disabled={starting}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-dark transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${starting ? "animate-spin" : ""}`} />
              Coba Buka Kamera Lagi
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={scanningFile}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/20 border border-white/30 px-4 py-2 text-xs font-semibold text-white hover:bg-white/30 transition-colors"
            >
              <Camera className="h-3.5 w-3.5" />
              {scanningFile ? "Memindai Foto..." : "Ambil Foto QR / Upload Gambar"}
            </button>
          </div>
        </div>
      ) : (
        <div className="relative mx-auto w-full overflow-hidden rounded-2xl bg-black shadow-md border border-gray-800">
          <div
            id={CONTAINER_ID}
            className="aspect-square w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover"
          />

          {starting && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white gap-2 text-xs">
              <RefreshCw className="h-6 w-6 animate-spin text-primary" />
              <span>Menyiapkan kamera...</span>
            </div>
          )}

          {cameras.length > 1 && !starting && (
            <button
              type="button"
              onClick={switchCamera}
              aria-label="Ganti kamera"
              className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 backdrop-blur-xs transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* Alternative Snapshot Button for Mobile/Desktop */}
      <div className="w-full flex items-center justify-center">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={scanningFile}
          className="inline-flex items-center gap-2 text-xs font-semibold text-primary hover:text-primary-dark py-1.5 px-3 rounded-lg hover:bg-primary/5 transition-colors"
        >
          <Upload className="h-3.5 w-3.5" />
          {scanningFile ? "Memproses QR..." : "Ambil Foto QR / Pilih dari Galeri"}
        </button>
      </div>

      {isInsecureHttp && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 p-2.5 text-[11px] text-amber-800">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
          <p>
            <strong>Tips HP:</strong> Kamera video langsung dibatasi pada koneksi HTTP. Gunakan tombol{" "}
            <strong>Ambil Foto QR</strong> di atas untuk memindai langsung menggunakan kamera bawaan HP!
          </p>
        </div>
      )}
    </div>
  );
}
