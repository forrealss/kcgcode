/**
 * Helper fetch API KCG Code (task 24).
 *
 * - Kesalahan HTTP dilempar sebagai `ApiError` dengan `status` dan `code`
 *   (dari body `{ error }`) agar komponen menampilkan pesan yang tepat.
 */

import { apiErrorMessage } from "./api-errors";

/** Error hasil permintaan API dengan status HTTP dan kode domain. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Body JSON respons error (detail tambahan, mis. daftar item penghalang). */
  readonly body: Record<string, unknown> | null;

  constructor(
    status: number,
    code: string,
    message: string,
    body?: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body ?? null;
  }
}

/** Pesan `ApiError` untuk ditampilkan; error lain memakai `fallback`. */
export function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/**
 * Dipanggil saat server membalas 401 `AUTH_REQUIRED` (sesi habis / terkunci
 * otomatis / dicabut) — lock screen dipasang oleh `lib/auth.ts`.
 */
let onAuthRequired: (() => void) | null = null;
export function setAuthRequiredHandler(fn: (() => void) | null): void {
  onAuthRequired = fn;
}

/** Pemetaan kode error domain -> pesan ramah pengguna (lihat `api-errors.ts`). */
export { apiErrorMessage };

/**
 * `fetch` dengan header otentikasi & penanganan error terstruktur.
 * Melempar `ApiError` untuk status selain 2xx.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  // FormData/Blob: browser yang menetapkan content-type (+ boundary multipart).
  const browserTyped =
    init.body instanceof FormData ||
    init.body instanceof Blob ||
    init.body instanceof URLSearchParams;
  if (init.body != null && !browserTyped && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    let body: Record<string, unknown> | null = null;
    try {
      const parsed = (await res.json()) as unknown;
      if (parsed && typeof parsed === "object") {
        body = parsed as Record<string, unknown>;
        if (typeof body.error === "string" && body.error !== "") code = body.error;
      }
    } catch {
      // body bukan JSON — pakai kode HTTP default.
    }
    if (res.status === 401 && code === "AUTH_REQUIRED") onAuthRequired?.();
    throw new ApiError(res.status, code, apiErrorMessage(code), body);
  }
  return res;
}

/**
 * Upload satu file (jenis apa pun) ke endpoint lampiran Session.
 * `fetch` multipart mengelola boundary-nya sendiri, jadi content-type TIDAK
 * di-set manual.
 */
export async function apiUploadFile(
  path: string,
  file: File,
): Promise<{ id: string; filename: string; mime: string; size: number }> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(path, { method: "POST", body });
  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    try {
      const parsed = (await res.json()) as { error?: string };
      if (typeof parsed.error === "string" && parsed.error !== "") code = parsed.error;
    } catch {
      // body bukan JSON — pakai kode HTTP default.
    }
    if (res.status === 401 && code === "AUTH_REQUIRED") onAuthRequired?.();
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

/** URL HTTP untuk memuat gambar lampiran di `<img>`. */
export function attachmentUrl(sessionId: string, attachmentId: string): string {
  return `/api/uploads/${encodeURIComponent(sessionId)}/${encodeURIComponent(attachmentId)}`;
}
