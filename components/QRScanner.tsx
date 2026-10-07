"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, CameraOff } from "lucide-react";
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

const SCAN_CONFIG = { fps: 10, qrbox: { width: 240, height: 240 } };
const CONTAINER_ID = "qr-reader-region";

/**
 * Thin wrapper around html5-qrcode. The library is imported dynamically so nothing
 * browser-only runs during SSR/build. The camera starts only when `active` is true.
 */
export function QRScanner({ active, onScan }: QRScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const firedRef = useRef(false);
  const onScanRef = useRef(onScan);
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [cameraIndex, setCameraIndex] = useState(0);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    firedRef.current = false;

    const handleDecoded = (text: string) => {
      // Ignore repeated frames of the same QR: only the first detection counts.
      if (firedRef.current) return;
      firedRef.current = true;
      onScanRef.current(text);
    };

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        const devices = await Html5Qrcode.getCameras();
        if (cancelled) return;
        if (!devices.length) {
          setError("Kamera tidak ditemukan pada perangkat ini.");
          return;
        }
        setCameras(devices.map((d) => ({ id: d.id, label: d.label })));

        // Prefer the rear camera on phones.
        const rear = devices.findIndex((d) => /back|rear|environment|belakang/i.test(d.label));
        const startIndex = rear >= 0 ? rear : devices.length > 1 ? devices.length - 1 : 0;
        setCameraIndex(startIndex);

        const scanner = new Html5Qrcode(CONTAINER_ID, { verbose: false });
        scannerRef.current = scanner;
        await scanner.start(devices[startIndex].id, SCAN_CONFIG, handleDecoded, () => {
          /* per-frame decode misses are expected */
        });
        if (cancelled) {
          await scanner.stop().catch(() => {});
        }
      } catch {
        if (!cancelled) setError("Izin kamera diperlukan untuk melakukan absensi.");
      }
    })();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner) {
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {});
      }
    };
  }, [active]);

  async function switchCamera() {
    const scanner = scannerRef.current;
    if (cameras.length < 2 || !scanner) return;
    const next = (cameraIndex + 1) % cameras.length;
    try {
      await scanner.stop();
      await scanner.start(
        cameras[next].id,
        SCAN_CONFIG,
        (text) => {
          if (firedRef.current) return;
          firedRef.current = true;
          onScanRef.current(text);
        },
        () => {}
      );
      setCameraIndex(next);
    } catch {
      setError("Tidak dapat mengganti kamera.");
    }
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex aspect-square w-full max-w-sm flex-col items-center justify-center gap-3 rounded-2xl bg-gray-900 p-6 text-center text-white"
      >
        <CameraOff className="h-10 w-10" aria-hidden />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-2xl bg-black">
      <div id={CONTAINER_ID} className="aspect-square w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
      {cameras.length > 1 && (
        <button
          onClick={switchCamera}
          aria-label="Ganti kamera"
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
        >
          <RefreshCw className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
