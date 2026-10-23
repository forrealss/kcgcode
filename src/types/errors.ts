/**
 * Registri kode error domain bersama server & klien (design.md — Error
 * Handling): satu tabel `kode -> { status HTTP, pesan ramah }`.
 *
 * - Server memetakan status lewat `errorStatus` / `errorResponse`
 *   (`server/routes/helpers.ts`).
 * - Klien menampilkan pesan lewat `apiErrorMessage` (`lib/api-errors.ts`).
 * - Kode protokol WebSocket (`ErrorCodes` di `ws-protocol.ts`) wajib
 *   terdaftar di sini juga.
 *
 * Kode dari lapisan agent / layanan hulu bisa membawa detail —
 * `KODE: detail`, `KODE:detail`, atau `KODE(503)` — dan dicocokkan lewat
 * kode dasarnya (`parseErrorCode`). Kode tak terdaftar jatuh ke
 * `PREFIX_RULES`, lalu 500.
 */

export interface ErrorDef {
  /** Status HTTP saat kode ini dibalas rute API. */
  status: number;
  /** Pesan ramah pengguna; fungsi bila pesan memakai detail kode. */
  message: string | ((detail: string | null) => string);
}

export const ERRORS = {
  // ---- Umum ----
  INTERNAL_ERROR: { status: 500, message: "Something went wrong on the server. Try again." },
  INVALID_JSON: { status: 400, message: "The request JSON format is invalid." },
  ORIGIN_FORBIDDEN: { status: 403, message: "Request blocked: it didn't come from this app." },

  // ---- Project & Folder_Browser ----
  NAME_REQUIRED: { status: 400, message: "Project name is required." },
  NAME_TAKEN: { status: 409, message: "That project name is already in use." },
  PATH_TAKEN: { status: 409, message: "That path is already used by another project." },
  PATH_OUTSIDE_SANDBOX: { status: 400, message: "The path is outside the Sandbox root." },
  INVALID_PATH_CHARS: { status: 400, message: "The path contains invalid characters." },
  PATH_NOT_FOUND: { status: 404, message: "That folder doesn't exist." },
  PROJECT_NOT_FOUND: { status: 404, message: "Project not found." },
  PROJECT_DIR_NOT_FOUND: {
    status: 404,
    message: "The project directory was not found on the server.",
  },
  PROJECT_HAS_SESSIONS: {
    status: 409,
    message: "The project still has sessions. Delete them first.",
  },
  INVALID_INSTRUCTIONS: { status: 400, message: "Instructions must be text." },
  INSTRUCTIONS_TOO_LONG: {
    status: 400,
    message: "Instructions are too long (max 20,000 characters).",
  },

  // ---- Session ----
  UNSUPPORTED_AGENT_TYPE: { status: 400, message: "This CLI_Agent type is not supported." },
  INVALID_PERMISSION_MODE: {
    status: 400,
    message: "That permission mode is not available for this agent.",
  },
  INVALID_EFFORT: {
    status: 400,
    message: "That thinking effort isn't available for this model.",
  },
  MODEL_NOT_FOUND: {
    status: 400,
    message: "The model is not available for this project's agent.",
  },
  SESSION_NOT_FOUND: { status: 404, message: "Session not found." },
  SESSION_NOT_RUNNING: { status: 409, message: "The session is not running." },
  SESSION_NOT_ACTIVE: { status: 409, message: "The session is not running." },
  SESSION_ALREADY_RUNNING: { status: 409, message: "The session is already running." },
  EXTERNAL_SESSION_OPEN: {
    status: 409,
    message:
      "This conversation is still busy in another app (open in Claude Desktop or the claude CLI, or replying in OpenCode). Close it or wait, or import a copy.",
  },
  EXTERNAL_SESSIONS_UNSUPPORTED: {
    status: 400,
    message: "This agent can't import sessions from outside KCG Code.",
  },

  // ---- Protokol WebSocket (pesan `error`) ----
  PROMPT_NOT_FOUND: {
    status: 404,
    message: "The agent is no longer waiting for this answer. Send a new message to continue.",
  },
  PROMPT_ALREADY_RESOLVED: { status: 409, message: "This prompt was already answered." },
  PROMPT_FAILED: { status: 502, message: "Failed to send the answer. Try again." },
  PROMPT_EXPIRED: {
    status: 410,
    message: "The agent stopped waiting for that answer, so it was dismissed.",
  },
  INVALID_RESPONSE: { status: 400, message: "That answer isn't valid for this prompt." },
  INVALID_TEXT: { status: 400, message: "The message is empty or too long." },

  // ---- Lampiran ----
  UNSUPPORTED_IMAGE_MIME: {
    status: 400,
    message: "Unsupported image format. Use PNG, JPEG, GIF, or WebP.",
  },
  EMPTY_UPLOAD: { status: 400, message: "The file is empty." },
  INVALID_UPLOAD: { status: 400, message: "Couldn't read the uploaded file." },
  IMAGE_TOO_LARGE: { status: 413, message: "The image exceeds the 20 MiB limit." },
  FILE_TOO_LARGE: { status: 413, message: "The file exceeds the 20 MiB limit." },
  ATTACHMENT_NOT_FOUND: {
    status: 404,
    message: "The attachment was not found (it may have been deleted).",
  },

  // ---- Agent (opencode / Claude Code) ----
  OPENCODE_NOT_FOUND: {
    status: 503,
    message: "opencode is not installed or not on PATH. Install opencode 2.x and try again.",
  },
  OPENCODE_UPGRADE_REQUIRED: {
    status: 503,
    message: (version) =>
      `KCG Code needs opencode 2.x, but opencode ${version || "1.x"} is installed. Upgrade opencode (opencode upgrade) and try again.`,
  },
  SERVER_START_FAILED: { status: 502, message: "Failed to connect to the opencode service." },
  AGENT_PERMISSION_MODE_UNSUPPORTED: {
    status: 400,
    message: "This agent does not support permission modes.",
  },
  AGENT_PERMISSION_MODE_FAILED: {
    status: 502,
    message: "The agent could not switch to that permission mode.",
  },
  AGENT_LIST_MODELS_FAILED: {
    status: 502,
    message: "Failed to load the model list from the agent.",
  },
  AGENT_CREATE_SESSION_FAILED: {
    status: 502,
    message: "Failed to create the session on the agent.",
  },
  AGENT_DELETE_SESSION_FAILED: {
    status: 502,
    message: "Failed to delete the session on the agent.",
  },
  // Pesan agent (mis. "Executable not found in $PATH") paling berguna.
  AGENT_MCP_FAILED: {
    status: 502,
    message: (detail) => detail || "The agent couldn't update the MCP server.",
  },
  AGENT_RELOAD_FAILED: { status: 502, message: "The agent couldn't reload its skills." },
  AGENT_EXTERNAL_LIST_FAILED: { status: 502, message: "Couldn't list the agent's sessions." },
  AGENT_EXTERNAL_HISTORY_FAILED: {
    status: 502,
    message: "Couldn't read the agent's session history.",
  },
  AGENT_FORK_FAILED: { status: 502, message: "Couldn't copy the agent's session." },
  // `session.get` agent (opencode / Claude Code): id Session agent tak dikenal.
  AGENT_SESSION_NOT_FOUND: { status: 404, message: "The agent no longer has that session." },

  // ---- Katalog & instalasi skill (skills.sh) ----
  INVALID_SKILL_QUERY: { status: 400, message: "Type at least 2 characters to search." },
  INVALID_SKILL_ID: { status: 400, message: "That skill identifier is not valid." },
  INVALID_MCP_SERVER: { status: 400, message: "That MCP server name is not valid." },
  SKILLS_SEARCH_FAILED: {
    status: 502,
    message: "Couldn't reach skills.sh. Check your connection and try again.",
  },
  SKILLS_AUDIT_FAILED: {
    status: 502,
    message: "Couldn't reach skills.sh. Check your connection and try again.",
  },
  SKILLS_RATE_LIMITED: {
    status: 429,
    message: "skills.sh is rate limiting requests. Wait a moment and try again.",
  },
  SKILL_INSTALL_IN_PROGRESS: {
    status: 409,
    message: "Another skill is being installed in this project. Try again when it finishes.",
  },
  SKILL_INSTALL_FAILED: {
    status: 502,
    message: "Failed to install the skill. See the output for details.",
  },
  // Status akhir job (bukan balasan HTTP).
  SKILL_INSTALL_CANCELLED: { status: 500, message: "Installation was cancelled." },
  SKILL_INSTALL_TIMEOUT: { status: 500, message: "Installation timed out and was stopped." },
  INSTALL_JOB_LOST: {
    status: 500,
    message: "The server restarted before the installation finished.",
  },
  INSTALL_JOB_NOT_RUNNING: { status: 409, message: "That installation has already finished." },

  // ---- Update KCG Code dari app (Settings -> About) ----
  UPDATE_UNSUPPORTED: {
    status: 409,
    message:
      "This copy of KCG Code can't update itself. Run the update command on the computer running it.",
  },
  UPDATE_IN_PROGRESS: { status: 409, message: "An update is already being installed." },
  UPDATE_NOT_AVAILABLE: {
    status: 409,
    message: "That version isn't available anymore. Reload the page and try again.",
  },
  // Status akhir job (bukan balasan HTTP).
  UPDATE_INSTALL_FAILED: {
    status: 500,
    message: "Couldn't install the update. See the output for details.",
  },
  UPDATE_TIMEOUT: { status: 500, message: "The update took too long and was stopped." },
  UPDATE_VERIFY_FAILED: {
    status: 500,
    message:
      "The update was installed in a different place, so this copy didn't change. Run the update command manually.",
  },
  INSTALL_JOB_NOT_FOUND: { status: 404, message: "That installation is no longer available." },

  // ---- Kunci aplikasi & profil ----
  AUTH_REQUIRED: { status: 401, message: "Your session is locked. Unlock to continue." },
  AUTH_INVALID: { status: 401, message: "Incorrect PIN or password." },
  CURRENT_SECRET_INVALID: { status: 401, message: "Your current PIN or password is incorrect." },
  // Dari service: `AUTH_RATE_LIMITED:<detik>` -> header retry-after.
  AUTH_RATE_LIMITED: { status: 429, message: "Too many attempts. Wait a moment and try again." },
  AUTH_NOT_CONFIGURED: { status: 400, message: "No lock has been set up yet." },
  LOCK_KIND_INVALID: { status: 400, message: "Choose a PIN or a password." },
  AUTO_LOCK_INVALID: { status: 400, message: "Choose a valid auto-lock time." },
  PIN_DIGITS_ONLY: { status: 400, message: "PIN can only contain numbers." },
  PIN_LENGTH: { status: 400, message: "PIN must be 6–12 digits." },
  PIN_TOO_SIMPLE: {
    status: 400,
    message: "That PIN is too easy to guess. Avoid repeated or sequential digits.",
  },
  PASSWORD_TOO_SHORT: { status: 400, message: "Password must be at least 8 characters." },
  PASSWORD_TOO_LONG: { status: 400, message: "Password must be at most 128 characters." },
  NICKNAME_TOO_LONG: { status: 400, message: "Nickname must be at most 40 characters." },
  NICKNAME_INVALID: { status: 400, message: "Nickname contains invalid characters." },
  AVATAR_PRESET_INVALID: { status: 400, message: "That avatar isn't available." },
  AVATAR_NOT_FOUND: { status: 404, message: "No profile photo is set." },
  AVATAR_TOO_LARGE: { status: 413, message: "The photo exceeds the 2 MB limit." },

  // ---- Passkey ----
  PASSKEY_INVALID: {
    status: 401,
    message: "That passkey wasn't accepted. Try again or use your PIN or password.",
  },
  PASSKEY_NONE: { status: 409, message: "No passkey is set up for this address yet." },
  PASSKEY_UNSUPPORTED_ORIGIN: {
    status: 400,
    message: "Passkeys need a secure address (https or localhost).",
  },
  PASSKEY_CHALLENGE_INVALID: { status: 400, message: "The passkey request expired. Try again." },
  PASSKEY_VERIFY_FAILED: { status: 400, message: "Couldn't verify the passkey. Try again." },
  PASSKEY_ALREADY_REGISTERED: { status: 409, message: "This passkey is already added." },
  PASSKEY_LIMIT: {
    status: 409,
    message: "You've reached the maximum of 20 passkeys. Remove one first.",
  },
  PASSKEY_LOCK_REQUIRED: {
    status: 409,
    message: "Set up a PIN or password before adding a passkey.",
  },
  PASSKEY_NAME_INVALID: { status: 400, message: "Passkey names must be 1–60 characters." },
  PASSKEY_NOT_FOUND: { status: 404, message: "That passkey no longer exists." },

  // ---- Web Push ----
  PUSH_ENDPOINT_INVALID: {
    status: 400,
    message: "This browser returned an invalid push subscription.",
  },
  PUSH_KEYS_INVALID: {
    status: 400,
    message: "This browser returned an invalid push subscription.",
  },
  PUSH_LIMIT: {
    status: 409,
    message: "Too many devices receive notifications. Remove one first.",
  },
  PUSH_DEVICE_NOT_FOUND: { status: 404, message: "That device no longer receives notifications." },
  // Layanan push (FCM/Apple/Mozilla) menolak atau tak terjangkau.
  PUSH_DEVICE_GONE: {
    status: 502,
    message: "The browser on that device has turned notifications off. Turn them on again there.",
  },
  PUSH_SEND_FAILED: {
    status: 502,
    message: "The push service didn't accept the notification. Try again later.",
  },

  // ---- Workspace (Sandbox_Root) ----
  WORKSPACE_PATH_REQUIRED: { status: 400, message: "Enter a folder path." },
  WORKSPACE_PATH_INVALID: { status: 400, message: "That path isn't valid." },
  WORKSPACE_PATH_NOT_ABSOLUTE: {
    status: 400,
    message: "Use a full path, like ~/code or /srv/projects.",
  },
  WORKSPACE_NOT_FOUND: {
    status: 404,
    message: 'That folder doesn\'t exist. Tick "Create the folder" to make it.',
  },
  WORKSPACE_PARENT_NOT_FOUND: {
    status: 404,
    message: "The folder above it doesn't exist. Only the last folder can be created.",
  },
  WORKSPACE_NOT_DIRECTORY: { status: 400, message: "That path is a file, not a folder." },
  WORKSPACE_TOO_BROAD: {
    status: 400,
    message: "That folder is too broad. Pick a dedicated folder, not your home or a system folder.",
  },
  WORKSPACE_CONTAINS_APP_DATA: {
    status: 400,
    message: "That folder overlaps KCG Code's own data. Pick a different folder.",
  },
  WORKSPACE_NOT_WRITABLE: {
    status: 400,
    message: "KCG Code can't write to that folder. Check its permissions.",
  },
  WORKSPACE_PROJECTS_OUTSIDE: {
    status: 409,
    message:
      "Some projects are outside the new folder. Remove them or pick a folder that contains them:",
  },
  WORKSPACE_CREATE_FAILED: { status: 500, message: "Couldn't create the folder." },
  WORKSPACE_CONFIG_UNREADABLE: {
    status: 500,
    message: "Couldn't save the config file. Check its permissions.",
  },
  WORKSPACE_CONFIG_WRITE_FAILED: {
    status: 500,
    message: "Couldn't save the config file. Check its permissions.",
  },

  // ---- Preview & viewer perubahan ----
  PREVIEW_NO_CONFIG: {
    status: 404,
    message: "No dev server found. Add a dev script to package.json or a .claude/launch.json.",
  },
  PREVIEW_TUNNEL_UNSUPPORTED: {
    status: 400,
    message:
      "Live preview isn't available over localhost.run. Take a snapshot instead, or use KCG remote access.",
  },
  PREVIEW_NOT_RUNNING: { status: 409, message: "Start the dev server first." },
  PREVIEW_SPAWN_FAILED: {
    status: 500,
    message: (detail) =>
      detail ? `Couldn't start the dev server: ${detail}` : "Couldn't start the dev server.",
  },
  PREVIEW_NO_BROWSER: {
    status: 501,
    message: "Snapshots need Chrome or Chromium on this computer (or set KCG_CHROME_PATH).",
  },
  PREVIEW_SCREENSHOT_FAILED: {
    status: 502,
    message: "Couldn't take a snapshot. Check that the page loads.",
  },
  DIFF_NOT_FOUND: { status: 404, message: "That change isn't available anymore." },
  DIFF_UNAVAILABLE: { status: 410, message: "Couldn't read this change from git." },
  FILE_NOT_FOUND: { status: 404, message: "File not found. It may have been moved or deleted." },
  PATH_OUTSIDE_PROJECT: { status: 403, message: "That file is outside the project." },
  UNSUPPORTED_TYPE: { status: 415, message: "This file type can't be shown." },

  // ---- Remote access (tunnel KCG / localhost.run) ----
  INVALID_PROVIDER: { status: 400, message: "Unknown remote access option." },
  TUNNEL_LOCK_REQUIRED: {
    status: 409,
    message: "Set an app lock before turning on remote access.",
  },
  TUNNEL_NOT_CONFIGURED: {
    status: 501,
    message: "Remote access isn't configured. Set KCG_TUNNEL_API_URL and restart kcgcode.",
  },
  TUNNEL_SIGNED_OUT: { status: 409, message: "Connect this machine first." },
  // Bukan 401: itu sinyal lock screen kcgcode di klien.
  TUNNEL_DEVICE_REVOKED: {
    status: 403,
    message: "This machine was disconnected from your account. Connect again.",
  },
  TUNNEL_RATE_LIMITED: {
    status: 429,
    message: "Too many attempts. Wait a few minutes and try again.",
  },
  TUNNEL_API_UNREACHABLE: {
    status: 502,
    message: "Couldn't reach the remote access service. Check your connection.",
  },
  // Status tunnel (bukan balasan HTTP).
  TUNNEL_PAIRING_EXPIRED: {
    status: 500,
    message: "The code expired before it was approved. Connect again.",
  },
  TUNNEL_PAIRING_DENIED: { status: 500, message: "The request was denied on the sign-in page." },
  TUNNEL_AUTH_FAILED: {
    status: 500,
    message: "The tunnel server rejected this device. Try rotating the secret.",
  },
  TUNNEL_ADDRESS_IN_USE: {
    status: 500,
    message:
      "Your address is already used by another KCG Code on this account. Turn remote access off there first.",
  },
  TUNNEL_PROXY_FAILED: {
    status: 500,
    message: "The tunnel server couldn't publish your address. See the log for details.",
  },
  FRPC_UNSUPPORTED_PLATFORM: {
    status: 501,
    message: "Remote access isn't supported on this OS or CPU yet.",
  },
  FRPC_DOWNLOAD_FAILED: {
    status: 502,
    message: "Couldn't install the tunnel client (frpc). See the log for details.",
  },
  FRPC_NOT_FOUND: {
    status: 502,
    message: "Couldn't install the tunnel client (frpc). See the log for details.",
  },
  FRPC_CHECKSUM_MISMATCH: {
    status: 502,
    message: "The downloaded tunnel client failed verification and was discarded.",
  },
  FRPC_START_FAILED: {
    status: 502,
    message: "Couldn't start the tunnel client. See the log for details.",
  },
  LHR_SSH_MISSING: {
    status: 501,
    message: "localhost.run needs the ssh command, which wasn't found on this computer.",
  },
  LHR_START_FAILED: { status: 502, message: "Couldn't start the connection to localhost.run." },
  LHR_DENIED: {
    status: 502,
    message: "localhost.run refused the connection. Try again in a moment.",
  },
} as const satisfies Record<string, ErrorDef>;

/** Kode error domain yang terdaftar. */
export type ErrorCode = keyof typeof ERRORS;

/**
 * Status untuk kode tak terdaftar berdasarkan prefiks: agent menolak / gagal
 * menjalankan operasi (mis. hapus session remote) -> 502.
 */
const PREFIX_RULES: readonly { prefix: string; status: number }[] = [
  { prefix: "AGENT_", status: 502 },
];

/**
 * Pisahkan kode dasar dari detailnya: `KODE: detail`, `KODE:detail`,
 * `KODE(503)`. String yang bukan kode berdetail dikembalikan utuh.
 */
export function parseErrorCode(raw: string): { code: string; detail: string | null } {
  const code = /^[A-Z][A-Z0-9_]*/.exec(raw)?.[0];
  if (!code) return { code: raw, detail: null };
  const rest = raw.slice(code.length);
  let detail: string;
  if (rest === "") return { code, detail: null };
  if (rest.startsWith(":")) detail = rest.slice(1);
  else if (rest.startsWith("(") && rest.endsWith(")")) detail = rest.slice(1, -1);
  else return { code: raw, detail: null };
  detail = detail.trim();
  return { code, detail: detail === "" ? null : detail };
}

export interface ResolvedError {
  /** Kode dasar (tanpa detail). */
  code: string;
  detail: string | null;
  status: number;
  /** Pesan ramah; `null` bila kode tidak terdaftar. */
  message: string | null;
}

/** Cari kode (boleh berdetail) di registri; kode tak dikenal -> prefiks / 500. */
export function resolveError(raw: string): ResolvedError {
  const { code, detail } = parseErrorCode(raw);
  if (Object.hasOwn(ERRORS, code)) {
    const def: ErrorDef = ERRORS[code as ErrorCode];
    const message = typeof def.message === "function" ? def.message(detail) : def.message;
    return { code, detail, status: def.status, message };
  }
  const rule = PREFIX_RULES.find((r) => code.startsWith(r.prefix));
  return { code, detail, status: rule?.status ?? 500, message: null };
}
