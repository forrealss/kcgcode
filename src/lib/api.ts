/**
 * Helper fetch API KCG Code (task 24).
 *
 * - Kesalahan HTTP dilempar sebagai `ApiError` dengan `status` dan `code`
 *   (dari body `{ error }`) agar komponen menampilkan pesan yang tepat.
 */

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

/**
 * Dipanggil saat server membalas 401 `AUTH_REQUIRED` (sesi habis / terkunci
 * otomatis / dicabut) — lock screen dipasang oleh `lib/auth.ts`.
 */
let onAuthRequired: (() => void) | null = null;
export function setAuthRequiredHandler(fn: (() => void) | null): void {
  onAuthRequired = fn;
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
  if (code.startsWith("SKILLS_SEARCH_FAILED") || code.startsWith("SKILLS_AUDIT_FAILED")) {
    return "Couldn't reach skills.sh. Check your connection and try again.";
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
    case "INVALID_INSTRUCTIONS":
      return "Instructions must be text.";
    case "INSTRUCTIONS_TOO_LONG":
      return "Instructions are too long (max 20,000 characters).";
    case "INVALID_SKILL_QUERY":
      return "Type at least 2 characters to search.";
    case "INVALID_SKILL_ID":
      return "That skill identifier is not valid.";
    case "SKILLS_RATE_LIMITED":
      return "skills.sh is rate limiting requests. Wait a moment and try again.";
    case "SKILL_INSTALL_IN_PROGRESS":
      return "Another skill is being installed in this project. Try again when it finishes.";
    case "SKILL_INSTALL_FAILED":
      return "Failed to install the skill. See the output for details.";
    case "SKILL_INSTALL_CANCELLED":
      return "Installation was cancelled.";
    case "SKILL_INSTALL_TIMEOUT":
      return "Installation timed out and was stopped.";
    case "INSTALL_JOB_NOT_RUNNING":
      return "That installation has already finished.";
    case "INSTALL_JOB_LOST":
      return "The server restarted before the installation finished.";
    case "INSTALL_JOB_NOT_FOUND":
      return "That installation is no longer available.";
    case "AUTH_REQUIRED":
      return "Your session is locked. Unlock to continue.";
    case "AUTH_INVALID":
      return "Incorrect PIN or password.";
    case "CURRENT_SECRET_INVALID":
      return "Your current PIN or password is incorrect.";
    case "AUTH_RATE_LIMITED":
      return "Too many attempts. Wait a moment and try again.";
    case "AUTH_NOT_CONFIGURED":
      return "No lock has been set up yet.";
    case "PIN_DIGITS_ONLY":
      return "PIN can only contain numbers.";
    case "PIN_LENGTH":
      return "PIN must be 6–12 digits.";
    case "PIN_TOO_SIMPLE":
      return "That PIN is too easy to guess. Avoid repeated or sequential digits.";
    case "PASSWORD_TOO_SHORT":
      return "Password must be at least 8 characters.";
    case "PASSWORD_TOO_LONG":
      return "Password must be at most 128 characters.";
    case "NICKNAME_TOO_LONG":
      return "Nickname must be at most 40 characters.";
    case "NICKNAME_INVALID":
      return "Nickname contains invalid characters.";
    case "AVATAR_PRESET_INVALID":
      return "That avatar isn't available.";
    case "AVATAR_TOO_LARGE":
      return "The photo exceeds the 2 MB limit.";
    case "ORIGIN_FORBIDDEN":
      return "Request blocked: it didn't come from this app.";
    case "INVALID_JSON":
      return "The request JSON format is invalid.";
    case "UNSUPPORTED_IMAGE_MIME":
      return "Unsupported image format. Use PNG, JPEG, GIF, or WebP.";
    case "IMAGE_TOO_LARGE":
      return "The image exceeds the 20 MiB limit.";
    case "ATTACHMENT_NOT_FOUND":
      return "The image attachment was not found (it may have been deleted).";
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
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === "string" && body.error !== "") code = body.error;
    } catch {
      // body bukan JSON — pakai kode HTTP default.
    }
    if (res.status === 401 && code === "AUTH_REQUIRED") onAuthRequired?.();
    throw new ApiError(res.status, code, apiErrorMessage(code));
  }
  return res;
}

/**
 * Upload satu file (gambar) ke endpoint lampiran Session.
 * `fetch` multipart mengelola boundary-nya sendiri, jadi content-type TIDAK
 * di-set manual.
 */
export async function apiUploadImage(
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
