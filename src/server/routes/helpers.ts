/**
 * Helper HTTP bersama untuk handler rute API (pola kcgcode: helper rute
 * dipisah dari composition root). Dulu menumpuk di `app.ts`; kini dipakai
 * semua tabel rute di `routes/*.routes.ts`.
 */
import type { SessionModel } from "../../types";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function serverError(err: unknown): Response {
  console.error("[kcg-code] error tidak terduga:", err);
  return json({ error: "INTERNAL_ERROR" }, 500);
}

/**
 * Pemetaan error domain ke status HTTP (design.md — Error Handling):
 * 400 validasi, 404 tidak ditemukan, 409 konflik, sisanya 500.
 */
export function errorStatus(code: string): number {
  switch (code) {
    case "NAME_REQUIRED":
    case "PATH_OUTSIDE_SANDBOX":
    case "INVALID_PATH_CHARS":
    case "UNSUPPORTED_AGENT_TYPE":
    case "INVALID_SIZE":
    case "MODEL_NOT_FOUND":
    case "INVALID_INSTRUCTIONS":
    case "INSTRUCTIONS_TOO_LONG":
    case "INVALID_SKILL_QUERY":
    case "INVALID_SKILL_ID":
    case "PIN_DIGITS_ONLY":
    case "PIN_LENGTH":
    case "PIN_TOO_SIMPLE":
    case "PASSWORD_TOO_SHORT":
    case "PASSWORD_TOO_LONG":
    case "LOCK_KIND_INVALID":
    case "NICKNAME_TOO_LONG":
    case "NICKNAME_INVALID":
    case "AUTO_LOCK_INVALID":
    case "AVATAR_PRESET_INVALID":
    case "AUTH_NOT_CONFIGURED":
      return 400;
    // Tunnel: prasyarat belum terpenuhi.
    case "TUNNEL_LOCK_REQUIRED":
    case "TUNNEL_SIGNED_OUT":
      return 409;
    case "TUNNEL_DEVICE_REVOKED":
      // Bukan 401: itu sinyal lock screen kcgcode di klien.
      return 403;
    case "TUNNEL_RATE_LIMITED":
      return 429;
    case "FRPC_UNSUPPORTED_PLATFORM":
    case "TUNNEL_NOT_CONFIGURED":
      return 501;
    case "TUNNEL_API_UNREACHABLE":
    case "FRPC_DOWNLOAD_FAILED":
    case "FRPC_CHECKSUM_MISMATCH":
    case "FRPC_NOT_FOUND":
    case "FRPC_START_FAILED":
      return 502;
    case "AUTH_INVALID":
    case "CURRENT_SECRET_INVALID":
    case "AUTH_REQUIRED":
      return 401;
    case "ORIGIN_FORBIDDEN":
      return 403;
    case "AVATAR_NOT_FOUND":
      return 404;
    case "AVATAR_TOO_LARGE":
      return 413;
    case "PROJECT_NOT_FOUND":
    case "PROJECT_DIR_NOT_FOUND":
    case "SESSION_NOT_FOUND":
    case "PATH_NOT_FOUND":
      return 404;
    case "NAME_TAKEN":
    case "PATH_TAKEN":
    case "SESSION_NOT_RUNNING":
    case "SESSION_NOT_ACTIVE":
    case "SESSION_ALREADY_RUNNING":
    case "PROJECT_HAS_SESSIONS":
    case "SKILL_INSTALL_IN_PROGRESS":
    case "INSTALL_JOB_NOT_RUNNING":
      return 409;
    case "SKILLS_RATE_LIMITED":
      return 429;
    case "SKILL_INSTALL_FAILED":
      return 502;
    // Server headless menolak operasi (mis. hapus session remote gagal).
    case "OC_DELETE_SESSION_FAILED":
      return 502;
    case "UNSUPPORTED_IMAGE_MIME":
    case "EMPTY_UPLOAD":
      return 400;
    case "IMAGE_TOO_LARGE":
      return 413;
    case "ATTACHMENT_NOT_FOUND":
    case "INSTALL_JOB_NOT_FOUND":
      return 404;
    default:
      // Kegagalan layanan skills.sh (hulu) -> 502.
      if (code.startsWith("SKILLS_SEARCH_FAILED") || code.startsWith("SKILLS_AUDIT_FAILED")) {
        return 502;
      }
      return 500;
  }
}

/**
 * Membaca body JSON; body tidak valid -> `{ ok: false }` sehingga handler
 * dapat membalas 400 (bukan 500 dari `serverError`).
 */
export async function readJson(req: Request): Promise<{ ok: true; data: unknown } | { ok: false }> {
  try {
    return { ok: true, data: await req.json() };
  } catch {
    return { ok: false };
  }
}

/**
 * Body `model` pada POST/PUT Session: `{ providerID, modelID }` atau `null`
 * (artinya pakai model default opencode). Bentuk lain dianggap null.
 */
export function parseModelBody(raw: unknown): SessionModel | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { providerID, modelID } = raw as { providerID?: unknown; modelID?: unknown };
  if (typeof providerID !== "string" || providerID === "") return null;
  if (typeof modelID !== "string" || modelID === "") return null;
  return { providerID, modelID };
}
