/**
 * Event SSE server headless opencode — parsing & langganan.
 *
 * Dipisah dari `opencode-client.ts`:
 * - `parseSseFrame` mengambil baris `data:` dari satu frame SSE.
 * - `normalizeEvent` meratakan payload `{ id, type, properties }` menjadi
 *   `{ type, id, ...properties }` agar konsumen mudah membaca `requestID`,
 *   `sessionID`, `permission`, `questions`, dst.
 * - `subscribeOpenCodeEvents` menjalankan loop baca `GET /event` dengan
 *   reconnect otomatis; mengembalikan fungsi untuk berhenti.
 */
import type { OpenCodeEvent } from "./opencode-client";

/** Parsing satu frame SSE: baris `data:` (dan `event:` bila ada). */
export function parseSseFrame(frame: string): string | null {
  const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
  if (!dataLine) return null;
  return dataLine.slice(5).trim();
}

/** Normalisasi payload event SSE `{ id, type, properties }` -> event datar. */
export function normalizeEvent(payload: unknown): OpenCodeEvent | null {
  if (typeof payload !== "object" || payload === null) return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.type !== "string") return null;
  const props =
    typeof raw.properties === "object" && raw.properties !== null
      ? (raw.properties as Record<string, unknown>)
      : {};
  return { type: raw.type, ...(raw.id !== undefined ? { id: String(raw.id) } : {}), ...props };
}

/**
 * Buka langganan event SSE (`GET /event`) dan panggil `cb` untuk setiap
 * event. Bila koneksi putus/error, coba lagi setelah jeda 1 detik. Fungsi
 * yang dikembalikan menghentikan langganan (membatalkan reader aktif).
 */
export function subscribeOpenCodeEvents(
  baseUrl: string,
  cb: (ev: OpenCodeEvent) => void,
): () => void {
  let cancelled = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  void (async () => {
    while (!cancelled) {
      try {
        const res = await fetch(`${baseUrl}/event`);
        if (!res.ok || !res.body) {
          await Bun.sleep(1000);
          continue;
        }
        reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done || cancelled) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const frame of frames) {
            const data = parseSseFrame(frame);
            if (data === null) continue;
            try {
              const ev = normalizeEvent(JSON.parse(data));
              if (ev) cb(ev);
            } catch {
              /* frame tidak valid — abaikan */
            }
          }
        }
      } catch {
        /* koneksi SSE terputus — coba lagi setelah jeda */
      }
      if (!cancelled) await Bun.sleep(1000);
    }
  })();
  return () => {
    cancelled = true;
    reader?.cancel().catch(() => {});
  };
}
