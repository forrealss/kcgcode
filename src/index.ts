/**
 * KCG Code — entry server utama (task 20).
 *
 * Wiring `Bun.serve` diimplementasikan di `src/server/app.ts`
 * (`createKcgServer`) agar dapat diuji secara e2e (task 20.2). File ini:
 * - mendaftarkan rute halaman yang menyajikan shell SPA (`index.html`)
 *   secara eksplisit — `spaPaths` di bawah, pola yang sama dengan daftar
 *   rute SPA di entry kcgcode; path lain di luar daftar mengembalikan 404
 *   (bukan catch-all seperti sebelumnya),
 * - memulai server,
 * - mendaftarkan handler shutdown SIGINT/SIGTERM yang menyimpan status
 *   Session `running` dalam anggaran 5 detik sebelum berhenti (Req 2.3).
 */
import index from "./index.html";
import { createKcgServer } from "./server/app";

if (import.meta.main) {
  const app = createKcgServer({
    spa: index,
    // Rute halaman SPA: `/`, `/projects/:projectId`, dan Session view
    // (`/projects/:projectId/sessions/:sessionId` — tercakup wildcard).
    spaPaths: ["/", "/projects", "/projects/*"],
  });
  console.log(`🚀 KCG Code berjalan di ${app.server.url}`);

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} diterima — menyimpan status Session lalu menghentikan server...`);
    try {
      await app.close();
    } catch (err) {
      console.error("Error saat shutdown:", err);
    }
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
