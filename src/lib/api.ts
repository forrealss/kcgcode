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
  // Kode dari lapisan agent membawa detail, mis. "AGENT_LIST_MODELS_FAILED: …"
  // -> cocokkan berdasarkan prefiks.
  if (code.startsWith("OPENCODE_UPGRADE_REQUIRED")) {
    const version = code.split(":")[1]?.trim() || "1.x";
    return `KCG Code needs opencode 2.x, but opencode ${version} is installed. Upgrade opencode (opencode upgrade) and try again.`;
  }
  if (code === "OPENCODE_NOT_FOUND") {
    return "opencode is not installed or not on PATH. Install opencode 2.x and try again.";
  }
  if (code.startsWith("AGENT_LIST_MODELS_FAILED") || code.startsWith("CC_MODELS_FAILED")) {
    return "Failed to load the model list from the agent.";
  }
  if (code.startsWith("AGENT_CREATE_SESSION_FAILED")) {
    return "Failed to create the session on the agent.";
  }
  if (code.startsWith("AGENT_DELETE_SESSION_FAILED") || code.startsWith("CC_DELETE_FAILED")) {
    return "Failed to delete the session on the agent.";
  }
  if (code.startsWith("SKILLS_SEARCH_FAILED") || code.startsWith("SKILLS_AUDIT_FAILED")) {
    return "Couldn't reach skills.sh. Check your connection and try again.";
  }
  // Aksi MCP: pesan agent (mis. "Executable not found in $PATH") paling berguna.
  if (code.startsWith("CC_MCP_FAILED") || code.startsWith("AGENT_MCP_FAILED")) {
    const detail = code.slice(code.indexOf(":") + 1).trim();
    return detail && detail !== code ? detail : "The agent couldn't update the MCP server.";
  }
  if (code.startsWith("CC_RELOAD_FAILED") || code.startsWith("AGENT_RELOAD_FAILED")) {
    return "The agent couldn't reload its skills.";
  }
  if (code.startsWith("AGENT_PERMISSION_MODE_FAILED")) {
    return "The agent could not switch to that permission mode.";
  }
  if (code.startsWith("SERVER_START_FAILED")) {
    return "Failed to connect to the opencode service.";
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
    case "INVALID_PERMISSION_MODE":
      return "That permission mode is not available for this agent.";
    case "AGENT_PERMISSION_MODE_UNSUPPORTED":
      return "This agent does not support permission modes.";
    case "SESSION_NOT_FOUND":
      return "Session not found.";
    case "SESSION_NOT_RUNNING":
      return "The session is not running.";
    case "SESSION_ALREADY_RUNNING":
      return "The session is already running.";
    case "MODEL_NOT_FOUND":
      return "The model is not available for this project's agent.";
    case "INVALID_INSTRUCTIONS":
      return "Instructions must be text.";
    case "INSTRUCTIONS_TOO_LONG":
      return "Instructions are too long (max 20,000 characters).";
    case "INVALID_SKILL_QUERY":
      return "Type at least 2 characters to search.";
    case "INVALID_SKILL_ID":
      return "That skill identifier is not valid.";
    case "INVALID_MCP_SERVER":
      return "That MCP server name is not valid.";
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
    case "WORKSPACE_PATH_REQUIRED":
      return "Enter a folder path.";
    case "WORKSPACE_PATH_INVALID":
      return "That path isn't valid.";
    case "WORKSPACE_PATH_NOT_ABSOLUTE":
      return "Use a full path, like ~/code or /srv/projects.";
    case "WORKSPACE_NOT_FOUND":
      return 'That folder doesn\'t exist. Tick "Create the folder" to make it.';
    case "WORKSPACE_PARENT_NOT_FOUND":
      return "The folder above it doesn't exist. Only the last folder can be created.";
    case "WORKSPACE_NOT_DIRECTORY":
      return "That path is a file, not a folder.";
    case "WORKSPACE_TOO_BROAD":
      return "That folder is too broad. Pick a dedicated folder, not your home or a system folder.";
    case "WORKSPACE_CONTAINS_APP_DATA":
      return "That folder overlaps KCG Code's own data. Pick a different folder.";
    case "WORKSPACE_NOT_WRITABLE":
      return "KCG Code can't write to that folder. Check its permissions.";
    case "WORKSPACE_PROJECTS_OUTSIDE":
      return "Some projects are outside the new folder. Remove them or pick a folder that contains them:";
    case "WORKSPACE_CREATE_FAILED":
      return "Couldn't create the folder.";
    case "WORKSPACE_CONFIG_UNREADABLE":
    case "WORKSPACE_CONFIG_WRITE_FAILED":
      return "Couldn't save the config file. Check its permissions.";
    case "PASSKEY_INVALID":
      return "That passkey wasn't accepted. Try again or use your PIN or password.";
    case "PASSKEY_NONE":
      return "No passkey is set up for this address yet.";
    case "PASSKEY_UNSUPPORTED_ORIGIN":
      return "Passkeys need a secure address (https or localhost).";
    case "PASSKEY_CHALLENGE_INVALID":
      return "The passkey request expired. Try again.";
    case "PASSKEY_VERIFY_FAILED":
      return "Couldn't verify the passkey. Try again.";
    case "PASSKEY_ALREADY_REGISTERED":
      return "This passkey is already added.";
    case "PUSH_ENDPOINT_INVALID":
    case "PUSH_KEYS_INVALID":
      return "This browser returned an invalid push subscription.";
    case "PUSH_LIMIT":
      return "Too many devices receive notifications. Remove one first.";
    case "PUSH_DEVICE_NOT_FOUND":
      return "That device no longer receives notifications.";
    case "PUSH_DEVICE_GONE":
      return "The browser on that device has turned notifications off. Turn them on again there.";
    case "PUSH_SEND_FAILED":
      return "The push service didn't accept the notification. Try again later.";
    case "PASSKEY_LIMIT":
      return "You've reached the maximum of 20 passkeys. Remove one first.";
    case "PASSKEY_LOCK_REQUIRED":
      return "Set up a PIN or password before adding a passkey.";
    case "PASSKEY_NAME_INVALID":
      return "Passkey names must be 1–60 characters.";
    case "PASSKEY_NOT_FOUND":
      return "That passkey no longer exists.";
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
    case "FILE_TOO_LARGE":
      return "The file exceeds the 20 MiB limit.";
    case "EMPTY_UPLOAD":
      return "The file is empty.";
    case "ATTACHMENT_NOT_FOUND":
      return "The attachment was not found (it may have been deleted).";
    case "TUNNEL_LOCK_REQUIRED":
      return "Set an app lock before turning on remote access.";
    case "TUNNEL_NOT_CONFIGURED":
      return "Remote access isn't configured. Set KCG_TUNNEL_API_URL and restart kcgcode.";
    case "TUNNEL_SIGNED_OUT":
      return "Connect this machine first.";
    case "TUNNEL_PAIRING_EXPIRED":
      return "The code expired before it was approved. Connect again.";
    case "TUNNEL_PAIRING_DENIED":
      return "The request was denied on the sign-in page.";
    case "TUNNEL_DEVICE_REVOKED":
      return "This machine was disconnected from your account. Connect again.";
    case "TUNNEL_RATE_LIMITED":
      return "Too many attempts. Wait a few minutes and try again.";
    case "TUNNEL_API_UNREACHABLE":
      return "Couldn't reach the remote access service. Check your connection.";
    case "TUNNEL_AUTH_FAILED":
      return "The tunnel server rejected this device. Try rotating the secret.";
    case "TUNNEL_PROXY_FAILED":
      return "The tunnel server couldn't publish your address. See the log for details.";
    case "FRPC_UNSUPPORTED_PLATFORM":
      return "Remote access isn't supported on this OS or CPU yet.";
    case "LHR_SSH_MISSING":
      return "localhost.run needs the ssh command, which wasn't found on this computer.";
    case "LHR_START_FAILED":
      return "Couldn't start the connection to localhost.run.";
    case "LHR_DENIED":
      return "localhost.run refused the connection. Try again in a moment.";
    case "INVALID_PROVIDER":
      return "Unknown remote access option.";
    case "FRPC_DOWNLOAD_FAILED":
    case "FRPC_NOT_FOUND":
      return "Couldn't install the tunnel client (frpc). See the log for details.";
    case "FRPC_CHECKSUM_MISMATCH":
      return "The downloaded tunnel client failed verification and was discarded.";
    case "FRPC_START_FAILED":
      return "Couldn't start the tunnel client. See the log for details.";
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
