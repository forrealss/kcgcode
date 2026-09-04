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
  // Kode dari server headless opencode membawa detail status, mis.
  // "OC_LIST_MODELS_FAILED(500)" -> cocokkan berdasarkan prefiks.
  if (code.startsWith("OC_LIST_MODELS_FAILED")) {
    return "Gagal memuat daftar model dari server opencode.";
  }
  if (code.startsWith("OC_CREATE_SESSION_FAILED")) {
    return "Gagal membuat session di server opencode.";
  }
  if (code.startsWith("OC_DELETE_SESSION_FAILED")) {
    return "Gagal menghapus session di server opencode.";
  }
  if (code.startsWith("SERVER_START_FAILED")) {
    return "Gagal menjalankan server opencode untuk Project ini.";
  }

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
    case "SESSION_ALREADY_RUNNING":
      return "Session sudah berjalan.";
    case "MODEL_NOT_FOUND":
      return "Model tidak tersedia pada server opencode Project ini.";
    case "INVALID_JSON":
      return "Format JSON permintaan tidak valid.";
    case "UNSUPPORTED_IMAGE_MIME":
      return "Format gambar tidak didukung. Gunakan PNG, JPEG, GIF, atau WebP.";
    case "IMAGE_TOO_LARGE":
      return "Ukuran gambar melebihi batas 20 MiB.";
    case "ATTACHMENT_NOT_FOUND":
      return "Lampiran gambar tidak ditemukan (mungkin sudah dihapus).";
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

/**
 * Upload satu file (gambar) ke endpoint lampiran Session.
 * `fetch` multipart mengelola boundary-nya sendiri, jadi content-type TIDAK
 * di-set manual (header `Authorization` tetap ditambahkan).
 */
export async function apiUploadImage(
  path: string,
  file: File,
): Promise<{ id: string; filename: string; mime: string; size: number }> {
  const token = getAuthToken();
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(path, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    body,
  });
  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    try {
      const parsed = (await res.json()) as { error?: string };
      if (typeof parsed.error === "string" && parsed.error !== "") code = parsed.error;
    } catch {
      // body bukan JSON — pakai kode HTTP default.
    }
    throw new ApiError(res.status, code, apiErrorMessage(code));
  }
  const parsed = (await res.json()) as {
    upload?: { id: string; filename: string; mime: string; size: number };
  };
  if (typeof parsed.upload?.id !== "string") {
    throw new ApiError(res.status, "INVALID_UPLOAD_RESPONSE", "Respons upload tidak valid.");
  }
  return parsed.upload;
}

/**
 * URL HTTP untuk memuat gambar lampiran di `<img>`.
 * Saat otentikasi aktif, token dikirim via query (`?token=`) karena `<img>`
 * tidak dapat menyertakan header Authorization (pola sama dengan WS).
 */
export function attachmentUrl(sessionId: string, attachmentId: string): string {
  const base = `/api/uploads/${encodeURIComponent(sessionId)}/${encodeURIComponent(attachmentId)}`;
  const token = getAuthToken();
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}
