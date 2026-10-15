/**
 * Pemetaan error domain Session_Manager ke pesan protokol `error`: kode
 * protokol (`toErrorCode`) dan teks ramah untuk kegagalan jawaban prompt
 * (`friendlyPromptError`).
 */
import { ErrorCodes } from "../../../ws-protocol";

/** Pemetaan error domain Session_Manager ke kode protokol `error`. */
export function toErrorCode(error: string): string {
  if (error === ErrorCodes.SESSION_NOT_FOUND) return ErrorCodes.SESSION_NOT_FOUND;
  if (error === "SESSION_NOT_RUNNING" || error === "SESSION_NOT_ACTIVE") {
    return ErrorCodes.SESSION_NOT_RUNNING;
  }
  if (error === "TEXT_EMPTY" || error === "TEXT_TOO_LONG") return ErrorCodes.INVALID_TEXT;
  if (error === "ATTACHMENT_NOT_FOUND") return ErrorCodes.ATTACHMENT_NOT_FOUND;
  if (error === ErrorCodes.PROMPT_NOT_FOUND) return ErrorCodes.PROMPT_NOT_FOUND;
  if (error === ErrorCodes.PROMPT_ALREADY_RESOLVED) return ErrorCodes.PROMPT_ALREADY_RESOLVED;
  if (error === "INVALID_PROMPT_OPTION" || error === "INVALID_PROMPT_RESPONSE") {
    return ErrorCodes.INVALID_RESPONSE;
  }
  return "ERROR";
}

/**
 * Pesan ramah untuk kegagalan reply prompt (kartu tetap bisa dicoba lagi):
 * error mentah dari lapisan agent berupa kode seperti
 * `AGENT_FORM_REPLY_FAILED: …` — kurang berguna bagi user.
 */
export function friendlyPromptError(raw: string): string {
  if (raw === "PROMPT_EXPIRED") {
    return "The agent stopped waiting for that answer, so it was dismissed. Send a new message to continue.";
  }
  if (
    raw === ErrorCodes.PROMPT_NOT_FOUND ||
    raw.startsWith("AGENT_FORM_") ||
    raw.startsWith("AGENT_PERMISSION_")
  ) {
    return "The agent is no longer waiting for this answer (it may have moved on). Try again or send a new message.";
  }
  if (raw === "SESSION_NOT_ACTIVE" || raw === "SESSION_NOT_RUNNING") {
    return "The session is not running. Start it again to answer.";
  }
  if (raw === ErrorCodes.PROMPT_ALREADY_RESOLVED) {
    return "This prompt was already answered.";
  }
  return `Failed to send the answer (${raw.split("(")[0] ?? raw}). Try again.`;
}
