/**
 * Preview: status dev server Project yang dipegang kcgcode (dikirim lewat
 * REST `/api/projects/:id/preview` dan broadcast WS `preview_status`).
 */

export type DevServerPhase = "stopped" | "starting" | "running" | "exited" | "crashed";

export interface DevServerStatus {
  phase: DevServerPhase;
  /** Perintah yang dijalankan (tampilan). */
  command: string;
  /** Port dev server yang siap menerima koneksi (null selama starting). */
  port: number | null;
  startedAt: number;
  exitCode: number | null;
  /** Nomor urut baris log terakhir (klien minta `?from=`). */
  logOffset: number;
  /**
   * Server dijalankan agent (bukan kcgcode) lalu diadopsi untuk preview:
   * kcgcode tidak memegang prosesnya, jadi Stop hanya melepasnya.
   */
  external?: boolean;
}

/**
 * Snapshot preview otomatis setelah turn agent selesai (gambar disimpan
 * sebagai lampiran Session, disajikan lewat `/api/uploads/:sessionId/:id`).
 */
export interface PreviewSnapshot {
  attachmentId: string;
  /** Path halaman yang di-capture (mis. `/pricing`). */
  path: string;
  takenAt: number;
}
