/**
 * Tipe domain bersama KCG Bridge — satu file per domain (pola `src/types/`
 * kcgrouter) dengan barrel agar `@/types` tetap menjadi satu pintu import.
 *
 * Khusus server (bukan domain FE): `Result<T>` / `SimpleResult` hidup di
 * `src/server/result.ts` — jangan diimpor dari sini.
 */
export * from "./message";
export * from "./project";
export * from "./prompt";
export * from "./session";
