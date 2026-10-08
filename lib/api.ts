import type { ApiResponse } from "./types";

const APPS_SCRIPT_URL = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL ?? "";

export const AUTH_EXPIRED_EVENT = "auth:expired";

export type ApiAction =
  | "login"
  | "getDashboard"
  | "getStudents"
  | "getStudentByQR"
  | "getTodaySchedule"
  | "scanAttendance"
  | "getAttendance"
  | "getClasses"
  | "getSettings"
  | "getTeachers"
  | "getSchedules"
  | "saveStudent"
  | "saveTeacher"
  | "saveSchedule"
  | "createSchedule"
  | "saveTeacherSchedule"
  | "startAttendanceSession"
  | "closeAttendanceSession"
  | "getActiveSession"
  | "getSessionAttendance"
  | "scanSessionAttendance"
  | "updateAttendanceStatus"
  | "getAttendanceRecap"
  | "updateSettings";

/**
 * All communication with the backend goes through a single POST endpoint
 * (Google Apps Script Web App). We use `text/plain` as the content type to
 * avoid a CORS preflight request, which Apps Script web apps do not handle.
 */
export async function callApi<T>(
  action: ApiAction,
  payload: Record<string, unknown> = {},
  token?: string | null
): Promise<ApiResponse<T>> {
  if (!APPS_SCRIPT_URL) {
    return {
      success: false,
      code: "CONFIG_MISSING",
      message: "NEXT_PUBLIC_APPS_SCRIPT_URL belum diatur.",
    };
  }

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, token: token ?? undefined, ...payload }),
    });

    if (!res.ok) {
      let detail = "";
      try {
        const text = await res.text();
        if (text.includes("accounts.google.com") || text.includes("ServiceLogin")) {
          detail = " — Akses ditolak Google. Pastikan Deployment disetel 'Who has access: Anyone / Siapa saja'";
        } else if (text && text.length < 120) {
          detail = ` — ${text.trim()}`;
        }
      } catch {
        // ignore text parsing
      }
      return {
        success: false,
        code: "SERVER_ERROR",
        message: `Server absensi tidak dapat dihubungi (HTTP ${res.status}${detail}).`,
      };
    }

    const json = (await res.json()) as ApiResponse<T>;
    // HTTP 200 does not mean the business operation succeeded: callers must check `success`.
    if (!json.success && json.code === "UNAUTHENTICATED" && token) {
      // Server rejected our session: let AuthProvider clear it and redirect to /login.
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    return json;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      code: "NETWORK_ERROR",
      message: `Gagal terhubung ke server absensi (${errMsg}). Periksa koneksi internet atau pengaturan Deployment Apps Script.`,
    };
  }
}
