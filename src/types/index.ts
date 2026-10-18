/**
 * Tipe domain bersama KCG Code — satu file per domain (pola `src/types/`
 * kcgcode) dengan barrel agar `@/types` tetap menjadi satu pintu import.
 *
 * Khusus server (bukan domain FE): `Result<T>` / `SimpleResult` hidup di
 * `src/server/result.ts` — jangan diimpor dari sini.
 */
export * from "./agent";
export * from "./changes";
export * from "./context";
export * from "./draft";
export * from "./message";
export * from "./notification";
export * from "./preview";
export * from "./project";
export * from "./prompt";
export * from "./session";
export * from "./turns";
