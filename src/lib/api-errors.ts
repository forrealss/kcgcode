/**
 * Pemetaan kode error domain -> pesan ramah pengguna (design.md — Error
 * Handling). Tabelnya hidup di registri bersama `@/types/errors` (juga
 * sumber status HTTP server); `api.ts` me-reekspornya agar impor lama
 * (`@/lib/api`) tetap jalan.
 */
import { resolveError } from "@/types/errors";

/** Kode berdetail (mis. "AGENT_LIST_MODELS_FAILED: …") dicocokkan lewat kode dasarnya. */
export function apiErrorMessage(code: string): string {
  return resolveError(code).message ?? `Something went wrong (${code}).`;
}
