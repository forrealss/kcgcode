/**
 * Deklarasi minimal `react-reconciler` — hanya dipakai test
 * (`src/hooks/__tests__/useSmoothText.react.test.ts`) untuk menjalankan hook
 * di React sungguhan tanpa DOM. Paket tidak menyertakan tipe untuk versi ini.
 *
 * Tanpa import/export level atas agar tetap berupa deklarasi ambient (global)
 * walau tsconfig memakai `moduleDetection: "force"`; tipe React dirujuk lewat
 * `import()` di dalam blok.
 */
declare module "react-reconciler" {
  interface ReconcilerInstance {
    createContainer(...args: unknown[]): unknown;
    updateContainer(
      element: import("react").ReactNode,
      container: unknown,
      parentComponent: unknown,
      callback: unknown,
    ): void;
  }

  export default function Reconciler(hostConfig: unknown): ReconcilerInstance;
}
