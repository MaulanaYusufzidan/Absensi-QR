"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { RefreshCw, CameraOff, Camera } from "lucide-react";
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

const CONTAINER_ID = "qr-reader-region";
const FILE_DECODER_CONTAINER_ID = "qr-file-decoder-temp";

/**
 * Detect whether the client is a mobile device (smartphone/tablet)
 * so we can choose rear camera for smartphones and webcam for laptop/PC.
 */
function isMobileDevice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;
  const isTouchDevice = (navigator.maxTouchPoints > 1 || "ontouchstart" in window) && window.innerWidth <= 1024;
  return mobileRegex.test(ua) || isTouchDevice;
}

export function QRScanner({ active, onScan }: QRScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileScannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isStartingRef = useRef(false);
  const firedRef = useRef(false);
  const onScanRef = useRef(onScan);

  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<"permission" | "not_found" | "in_use" | "insecure" | "unknown" | null>(null);
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [cameraIndex, setCameraIndex] = useState(0);
  const [activeCameraLabel, setActiveCameraLabel] = useState<string>("");
  const [starting, setStarting] = useState(false);
  const [scanningFile, setScanningFile] = useState(false);
  const [isMobile] = useState<boolean>(() => isMobileDevice());

  const handleDecoded = useCallback((text: string) => {
    if (firedRef.current) return;
    firedRef.current = true;
    onScanRef.current(text);
  }, []);

  /**
   * Safely stops the scanner and releases all camera tracks,
   * guaranteeing no orphan streams or memory leaks occur.
   */
  const stopScannerSafely = useCallback(async () => {
    const scanner = scannerRef.current;
    if (scanner) {
      try {
        if (scanner.isScanning) {
          await scanner.stop();
        }
        await scanner.clear();
      } catch {
        // ignore stop errors
      }
      scannerRef.current = null;
    }

    // Explicitly release any media tracks on the video element
    if (typeof document !== "undefined") {
      const video = document.querySelector<HTMLVideoElement>(`#${CONTAINER_ID} video`);
      if (video && video.srcObject) {
        try {
          const stream = video.srcObject as MediaStream;
          stream.getTracks().forEach((track) => {
            track.stop();
          });
          video.srcObject = null;
        } catch {
          // ignore stream release errors
        }
      }
    }
  }, []);

  /**
   * Intelligently selects and launches the real camera:
   * - Smartphone: Prioritizes rear/environment-facing camera.
   * - Laptop/PC: Uses built-in or external webcam (avoids environment error).
   * - Auto-adapts to orientations and viewport sizes.
   */
  const startCamera = useCallback(async () => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    setError(null);
    setErrorType(null);
    setStarting(true);
    firedRef.current = false;

    // Check Secure Context for mobile devices over HTTP
    const isInsecure =
      typeof window !== "undefined" &&
      !window.isSecureContext &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1";

    if (isInsecure && isMobileDevice()) {
      setErrorType("insecure");
      setError(
        "Browser HP membatasi streaming video langsung pada koneksi HTTP (bukan HTTPS). Silakan gunakan tombol 'Ambil Foto QR' di bawah untuk scan menggunakan kamera HP!"
      );
      setStarting(false);
      isStartingRef.current = false;
      return;
    }

    try {
      await stopScannerSafely();

      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");

      // Verify DOM container element exists
      const containerEl = document.getElementById(CONTAINER_ID);
      if (!containerEl) {
        setStarting(false);
        isStartingRef.current = false;
        return;
      }
      containerEl.innerHTML = "";

      const scanner = new Html5Qrcode(CONTAINER_ID, {
        verbose: false,
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      });
      scannerRef.current = scanner;

      // 1. Enumerate available cameras if permitted
      let deviceList: Array<{ id: string; label: string }> = [];
      try {
        deviceList = await Html5Qrcode.getCameras();
        if (deviceList && deviceList.length > 0) {
          setCameras(
            deviceList.map((d, i) => ({
              id: d.id,
              label: d.label || `Kamera ${i + 1}`,
            }))
          );
        }
      } catch {
        // EnumerateDevices may throw before permission is granted on certain browsers
      }

      // Responsive scan box calculation: adapts cleanly to mobile and laptop screens
      const scanConfig = {
        fps: 12,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const boxSize = Math.max(160, Math.min(Math.floor(minEdge * 0.72), 260));
          return { width: boxSize, height: boxSize };
        },
        aspectRatio: 1.0,
      };

      const mobile = isMobileDevice();
      let primaryTarget: string | MediaTrackConstraints;
      let fallbackTarget: string | MediaTrackConstraints;

      if (mobile) {
        // ----------------------------------------------------
        // SMARTPHONE (Android & iPhone): Prioritize REAR camera
        // ----------------------------------------------------
        const rearCamera = deviceList.find((d) =>
          /back|rear|environment|belakang|main|camera2 0/i.test(d.label)
        );

        if (rearCamera) {
          primaryTarget = rearCamera.id;
          fallbackTarget = { facingMode: "environment" };
        } else {
          primaryTarget = { facingMode: "environment" };
          // If no rear camera, fallback to user/front camera
          fallbackTarget = { facingMode: "user" };
        }
      } else {
        // ----------------------------------------------------
        // LAPTOP / PC: Use WEBCAM (built-in or USB external)
        // Never ask for "environment" on PC to prevent OverconstrainedError
        // ----------------------------------------------------
        if (deviceList.length > 0) {
          primaryTarget = deviceList[0].id;
          fallbackTarget = { facingMode: "user" };
        } else {
          primaryTarget = { facingMode: "user" };
          fallbackTarget = { facingMode: "environment" };
        }
      }

      let started = false;

      // Attempt 1: Preferred camera constraint
      try {
        await scanner.start(primaryTarget, scanConfig, handleDecoded, () => {});
        started = true;
      } catch {
        // Attempt 2: Fallback constraint
        try {
          await scanner.start(fallbackTarget, scanConfig, handleDecoded, () => {});
          started = true;
        } catch {
          // Attempt 3: Try remaining specific device IDs if available
          if (deviceList.length > 0) {
            for (const dev of deviceList) {
              if (dev.id !== primaryTarget && dev.id !== fallbackTarget) {
                try {
                  await scanner.start(dev.id, scanConfig, handleDecoded, () => {});
                  started = true;
                  break;
                } catch {
                  // try next device
                }
              }
            }
          }
        }
      }

      if (!started) {
        throw new Error("Gagal memulai kamera.");
      }

      // Update camera label for user display
      try {
        const refreshed = await Html5Qrcode.getCameras();
        if (refreshed && refreshed.length > 0) {
          setCameras(
            refreshed.map((d, i) => ({
              id: d.id,
              label: d.label || `Kamera ${i + 1}`,
            }))
          );
        }
      } catch {
        // non-fatal
      }

      // Read active camera track label
      try {
        const video = document.querySelector<HTMLVideoElement>(`#${CONTAINER_ID} video`);
        if (video && video.srcObject) {
          const stream = video.srcObject as MediaStream;
          const track = stream.getVideoTracks()[0];
          if (track && track.label) {
            setActiveCameraLabel(track.label);
          }
        }
      } catch {
        // non-fatal
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        const errName = err.name || "";
        const errMsg = err.message || "";

        if (
          errName === "NotAllowedError" ||
          errName === "PermissionDeniedError" ||
          errMsg.toLowerCase().includes("permission")
        ) {
          setErrorType("permission");
          setError("Izin akses kamera ditolak oleh browser.");
        } else if (
          errName === "NotFoundError" ||
          errName === "DevicesNotFoundError" ||
          errMsg.toLowerCase().includes("not found")
        ) {
          setErrorType("not_found");
          setError("Kamera tidak ditemukan. Pastikan webcam terpasang dan aktif.");
        } else if (
          errName === "NotReadableError" ||
          errName === "TrackStartError" ||
          errMsg.toLowerCase().includes("readable") ||
          errMsg.toLowerCase().includes("in use")
        ) {
          setErrorType("in_use");
          setError("Kamera sedang digunakan aplikasi lain (misal: Zoom, Google Meet). Tutup aplikasi tersebut dan coba lagi.");
        } else {
          setErrorType("unknown");
          setError("Gagal mengakses kamera perangkat: " + errMsg);
        }
      } else {
        setErrorType("unknown");
        setError("Gagal mengakses kamera perangkat.");
      }
    } finally {
      setStarting(false);
      isStartingRef.current = false;
    }
  }, [handleDecoded, stopScannerSafely]);

  // Lifecycle: Starts when active=true, stops cleanly on unmount or active=false
  useEffect(() => {
    if (!active) {
      stopScannerSafely();
      return;
    }

    const timer = setTimeout(() => {
      startCamera();
    }, 0);

    // Listen to orientation change on mobile devices to preserve scanner layout
    const handleOrientationOrResize = () => {
      // Html5Qrcode adjusts its video container dynamically
    };

    window.addEventListener("orientationchange", handleOrientationOrResize);
    window.addEventListener("resize", handleOrientationOrResize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("orientationchange", handleOrientationOrResize);
      window.removeEventListener("resize", handleOrientationOrResize);
      stopScannerSafely();
    };
  }, [active, startCamera, stopScannerSafely]);

  /**
   * Switch between available cameras (e.g. rear and front, or multiple webcams).
   */
  async function switchCamera() {
    const scanner = scannerRef.current;
    if (cameras.length < 2 || !scanner) return;
    const nextIdx = (cameraIndex + 1) % cameras.length;
    try {
      if (scanner.isScanning) {
        await scanner.stop();
      }
      const scanConfig = {
        fps: 12,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const boxSize = Math.max(160, Math.min(Math.floor(minEdge * 0.72), 260));
          return { width: boxSize, height: boxSize };
        },
        aspectRatio: 1.0,
      };
      await scanner.start(cameras[nextIdx].id, scanConfig, handleDecoded, () => {});
      setCameraIndex(nextIdx);
      setActiveCameraLabel(cameras[nextIdx].label);
    } catch {
      setError("Tidak dapat mengganti kamera.");
    }
  }

  /**
   * Fallback: Native photo snapshot or image file scan.
   * Works on any phone/PC without getUserMedia restrictions.
   */
  async function handleFileScan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanningFile(true);
    setError(null);
    setErrorType(null);

    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
      if (!fileScannerRef.current) {
        fileScannerRef.current = new Html5Qrcode(FILE_DECODER_CONTAINER_ID, {
          verbose: false,
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        });
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
    <div className="flex flex-col items-center gap-3 w-full max-w-sm sm:max-w-md mx-auto">
      {/* Hidden temporary container for file decoder */}
      <div id={FILE_DECODER_CONTAINER_ID} className="hidden" />

      {/* Hidden file input with native camera capture attribute */}
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
          className="flex min-h-[300px] w-full flex-col items-center justify-center gap-3 rounded-2xl bg-gray-900 p-6 text-center text-white shadow-md border border-gray-800"
        >
          <CameraOff className="h-12 w-12 text-red-400" aria-hidden />
          <p className="font-bold text-sm text-red-300">Kamera Tidak Dapat Dibuka</p>
          <p className="text-xs leading-relaxed text-gray-300">{error}</p>

          {/* Detailed instruction box depending on error type */}
          {errorType === "permission" && (
            <div className="w-full text-left rounded-xl bg-white/10 p-3 text-[11px] text-gray-200 space-y-1">
              <p className="font-semibold text-white">Cara mengizinkan kamera:</p>
              <p>• <strong>Chrome / Edge</strong>: Klik ikon gembok 🔒 di sebelah kiri URL &gt; Izin &gt; Kamera &gt; Izinkan.</p>
              <p>• <strong>Safari (iPhone)</strong>: Tekan tombol &quot;aA&quot; di URL bar &gt; Pengaturan Situs Web &gt; Kamera &gt; Izinkan.</p>
              <p>• <strong>Firefox</strong>: Klik ikon izin di sebelah kiri URL &gt; Hapus blokir kamera.</p>
            </div>
          )}

          <div className="flex flex-col gap-2 w-full mt-2">
            <button
              type="button"
              onClick={startCamera}
              disabled={starting}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-white hover:bg-primary-dark transition-colors shadow-sm"
            >
              <RefreshCw className={`h-4 w-4 ${starting ? "animate-spin" : ""}`} />
              Coba Buka Kamera Lagi
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={scanningFile}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/15 border border-white/20 px-4 py-2.5 text-xs font-semibold text-white hover:bg-white/25 transition-colors"
            >
              <Camera className="h-4 w-4" />
              {scanningFile ? "Memindai Foto..." : "Ambil Foto QR / Upload Gambar"}
            </button>
          </div>
        </div>
      ) : (
        <div className="relative mx-auto w-full aspect-square overflow-hidden rounded-2xl bg-black shadow-lg border border-gray-800">
          {/* Live Video Preview element created and maintained by Html5Qrcode */}
          <div
            id={CONTAINER_ID}
            className="aspect-square w-full h-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover [&_video]:rounded-2xl"
          />

          {/* Decorative viewfinder scanner frame overlay */}
          {!starting && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative w-48 h-48 sm:w-56 sm:h-56 border-2 border-primary/60 rounded-2xl">
                {/* Viewfinder corners */}
                <div className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-primary rounded-tl" />
                <div className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 border-primary rounded-tr" />
                <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 border-primary rounded-bl" />
                <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-primary rounded-br" />
                {/* Laser animation */}
                <div className="absolute inset-x-2 top-0 h-0.5 bg-primary shadow-[0_0_8px_rgba(58,125,92,0.8)] animate-pulse" />
              </div>
            </div>
          )}

          {/* Loading preview state */}
          {starting && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 text-white gap-2.5 text-xs">
              <RefreshCw className="h-7 w-7 animate-spin text-primary" />
              <span className="font-medium">
                {isMobile ? "Mengaktifkan kamera belakang HP..." : "Mengaktifkan webcam laptop..."}
              </span>
            </div>
          )}

          {/* Switch camera button (if device has multiple cameras) */}
          {cameras.length > 1 && !starting && (
            <button
              type="button"
              onClick={switchCamera}
              aria-label="Ganti kamera"
              title="Ganti kamera"
              className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 backdrop-blur-xs transition-colors shadow-md ring-1 ring-white/20"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}

          {/* Current camera badge */}
          {activeCameraLabel && !starting && (
            <div className="absolute bottom-2 left-2 right-2 flex justify-center pointer-events-none">
              <span className="rounded-full bg-black/60 backdrop-blur-xs px-2.5 py-0.5 text-[10px] text-gray-300 truncate max-w-[85%] border border-white/10">
                {activeCameraLabel}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Snapshot / Native camera button for mobile phones and laptops */}
      <div className="w-full flex items-center justify-center mt-1">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={scanningFile}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary-dark py-1.5 px-3 rounded-lg hover:bg-primary/5 transition-colors"
        >
          <Camera className="h-3.5 w-3.5" />
          {scanningFile ? "Memproses QR..." : "Opsi: Ambil Foto QR / Upload Gambar"}
        </button>
      </div>
    </div>
  );
}
