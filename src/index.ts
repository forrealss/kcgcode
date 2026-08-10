/**
 * KCG Bridge — entry server utama (task 20).
 *
 * Wiring `Bun.serve` diimplementasikan di `src/server/app.ts`
 * (`createKcgServer`) agar dapat diuji secara e2e (task 20.2). File ini:
 * - menyuntikkan shell SPA (`index.html`) ke rute tak dikenal,
 * - memulai server,
 * - mendaftarkan handler shutdown SIGINT/SIGTERM yang menyimpan status
 *   Session `running` dalam anggaran 5 detik sebelum berhenti (Req 2.3).
 */
import index from "./index.html";
import { createKcgServer } from "./server/app";

if (import.meta.main) {
  const app = createKcgServer({ spa: index });
  console.log(`🚀 KCG Bridge berjalan di ${app.server.url}`);

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
