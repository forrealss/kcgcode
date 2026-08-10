/**
 * Helper fetch API KCG Bridge (task 24).
 *
 * - Menambahkan header `Authorization: Bearer <token>` bila token tersimpan
 *   di `localStorage["kcg-auth-token"]` (Requirement 9.2).
 * - Kesalahan HTTP dilempar sebagai `ApiError` dengan `status` dan `code`
 *   (dari body `{ error }`) agar komponen menampilkan pesan yang tepat.
 * - Token yang sama dipakai untuk upgrade WebSocket via `?token=`
 *   (Requirement 9.3, lihat `use-websocket.ts`).
 */
export const AUTH_TOKEN_KEY = "kcg-auth-token";

export function getAuthToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  if (typeof localStorage === "undefined") return;
  if (token.trim() === "") localStorage.removeItem(AUTH_TOKEN_KEY);
  else localStorage.setItem(AUTH_TOKEN_KEY, token.trim());
}

/** Error hasil permintaan API dengan status HTTP dan kode domain. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Pemetaan kode error domain -> pesan ramah pengguna (design.md — Error Handling). */
export function apiErrorMessage(code: string): string {
  switch (code) {
    case "NAME_REQUIRED":
      return "Nama Project wajib diisi.";
    case "NAME_TAKEN":
      return "Nama Project sudah digunakan.";
    case "PATH_TAKEN":
      return "Path tersebut sudah digunakan oleh Project lain.";
    case "PATH_OUTSIDE_SANDBOX":
      return "Path berada di luar Sandbox_Root.";
    case "INVALID_PATH_CHARS":
      return "Path mengandung karakter yang tidak valid.";
    case "PROJECT_NOT_FOUND":
      return "Project tidak ditemukan.";
    case "PROJECT_DIR_NOT_FOUND":
      return "Direktori Project tidak ditemukan di server.";
    case "UNSUPPORTED_AGENT_TYPE":
      return "Tipe CLI_Agent tidak didukung.";
    case "SESSION_NOT_FOUND":
      return "Session tidak ditemukan.";
    case "SESSION_NOT_RUNNING":
      return "Session tidak sedang berjalan.";
    case "INVALID_JSON":
      return "Format JSON permintaan tidak valid.";
    case "AUTH_FAILED":
      return "Otentikasi gagal. Periksa token.";
    case "HTTP_401":
      return "Otentikasi diperlukan (401).";
    default:
      return `Terjadi kesalahan (${code}).`;
  }
}

/**
 * `fetch` dengan header otentikasi & penanganan error terstruktur.
 * Melempar `ApiError` untuk status selain 2xx.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const token = getAuthToken();
  if (token) headers.set("authorization", `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === "string" && body.error !== "") code = body.error;
    } catch {
      // body bukan JSON — pakai kode HTTP default.
    }
    throw new ApiError(res.status, code, apiErrorMessage(code));
  }
  return res;
}
