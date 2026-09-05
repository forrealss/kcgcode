/**
 * Helper fetch API KCG Bridge (task 24).
 *
 * - Menambahkan header `Authorization: Bearer <token>` bila token tersimpan
 *   di `localStorage["kcg-auth-token"]` (Requirement 9.2).
 * - Kesalahan HTTP dilempar sebagai `ApiError` dengan `status` dan `code`
 *   (dari body `{ error }`) agar komponen menampilkan pesan yang tepat.
 * - Token yang sama dipakai untuk upgrade WebSocket via `?token=`
 *   (Requirement 9.3, lihat `useWebSocket.ts`).
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
    return "Failed to load the model list from the opencode server.";
  }
  if (code.startsWith("OC_CREATE_SESSION_FAILED")) {
    return "Failed to create the session on the opencode server.";
  }
  if (code.startsWith("OC_DELETE_SESSION_FAILED")) {
    return "Failed to delete the session on the opencode server.";
  }
  if (code.startsWith("SERVER_START_FAILED")) {
    return "Failed to start the opencode server for this project.";
  }

  switch (code) {
    case "NAME_REQUIRED":
      return "Project name is required.";
    case "NAME_TAKEN":
      return "That project name is already in use.";
    case "PATH_TAKEN":
      return "That path is already used by another project.";
    case "PATH_OUTSIDE_SANDBOX":
      return "The path is outside the Sandbox root.";
    case "INVALID_PATH_CHARS":
      return "The path contains invalid characters.";
    case "PROJECT_NOT_FOUND":
      return "Project not found.";
    case "PROJECT_DIR_NOT_FOUND":
      return "The project directory was not found on the server.";
    case "PROJECT_HAS_SESSIONS":
      return "The project still has sessions. Delete them first.";
    case "UNSUPPORTED_AGENT_TYPE":
      return "This CLI_Agent type is not supported.";
    case "SESSION_NOT_FOUND":
      return "Session not found.";
    case "SESSION_NOT_RUNNING":
      return "The session is not running.";
    case "SESSION_ALREADY_RUNNING":
      return "The session is already running.";
    case "MODEL_NOT_FOUND":
      return "The model is not available on this project's opencode server.";
    case "INVALID_JSON":
      return "The request JSON format is invalid.";
    case "UNSUPPORTED_IMAGE_MIME":
      return "Unsupported image format. Use PNG, JPEG, GIF, or WebP.";
    case "IMAGE_TOO_LARGE":
      return "The image exceeds the 20 MiB limit.";
    case "ATTACHMENT_NOT_FOUND":
      return "The image attachment was not found (it may have been deleted).";
    case "AUTH_FAILED":
      return "Authentication failed. Check your token.";
    case "HTTP_401":
      return "Authentication required (401).";
    default:
      return `Something went wrong (${code}).`;
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
    throw new ApiError(res.status, "INVALID_UPLOAD_RESPONSE", "Invalid upload response.");
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
