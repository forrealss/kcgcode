/**
 * Komunikasi dengan kcgcode: state awal, event realtime (SSE), kirim pesan,
 * screenshot, dan unggah gambar. Semua lewat origin preview (cookie preview).
 */
import { API } from "./config";
import { notify, state } from "./state";
import type { OverlayEvent, ServerInfo, SessionInfo } from "./types";

export async function loadState(): Promise<void> {
  try {
    // Viewport perangkat ikut dilaporkan (dipakai snapshot otomatis).
    const q = `vw=${innerWidth}&vh=${innerHeight}&dpr=${devicePixelRatio || 1}`;
    const res = await fetch(`${API}state?${q}`, { credentials: "same-origin" });
    if (!res.ok) return;
    const data = (await res.json()) as {
      session: SessionInfo | null;
      chatUrl: string | null;
      server: ServerInfo | null;
      screenshots?: boolean;
    };
    state.screenshots = data.screenshots === true;
    state.session = data.session;
    state.chatUrl = data.chatUrl;
    state.server = data.server;
    state.turnActive = data.session?.turnActive ?? false;
    notify();
  } catch {
    // kcgcode tak terjangkau — overlay tetap bisa reload/ganti tampilan
  }
}

function apply(e: OverlayEvent): void {
  switch (e.type) {
    case "turn": {
      const finished = state.turnActive && !e.active;
      state.turnActive = e.active;
      if (e.active) state.agentError = null;
      // Perubahan yang tidak tertangkap HMR: muat ulang setelah agent selesai.
      if (finished && state.autoReload) {
        location.reload();
        return;
      }
      break;
    }
    case "status":
      if (state.session) state.session.status = e.status;
      break;
    case "reply":
      state.reply = e.text;
      break;
    case "attention":
      state.attention = e.pending;
      break;
    case "agent_error":
      state.agentError = e.message;
      break;
    case "server":
      state.server = e.server;
      break;
  }
  notify();
}

export function listen(): void {
  if (typeof EventSource === "undefined") return;
  const es = new EventSource(`${API}events`);
  es.onmessage = (ev) => {
    try {
      apply(JSON.parse(ev.data) as OverlayEvent);
    } catch {
      // event rusak — abaikan
    }
  };
}

/** Kirim pesan (+ gambar terlampir) ke Session. `true` bila terkirim. */
export async function send(text: string): Promise<boolean> {
  state.sending = true;
  state.sendError = null;
  notify();
  try {
    const res = await fetch(`${API}prompt`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, images: state.images.map((i) => i.id) }),
    });
    if (!res.ok) {
      const code = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      state.sendError =
        code === "SESSION_NOT_ACTIVE"
          ? "The session isn't running. Start it from the chat."
          : "Couldn't send the message.";
      return false;
    }
    state.turnActive = true;
    state.reply = null;
    for (const i of state.images) URL.revokeObjectURL(i.url);
    state.images = [];
    return true;
  } catch {
    state.sendError = "Couldn't reach KCG Code.";
    return false;
  } finally {
    state.sending = false;
    notify();
  }
}

/** Screenshot halaman ini oleh Chrome headless di mesin kcgcode. */
export async function captureScreenshot(): Promise<Blob> {
  const res = await fetch(`${API}screenshot`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path: location.pathname + location.search,
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio || 1,
    }),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.blob();
}

/** Unggah gambar (JPEG) untuk pesan berikutnya; mengembalikan id-nya. */
export async function uploadImage(blob: Blob): Promise<string> {
  const res = await fetch(`${API}upload`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "image/jpeg" },
    body: blob,
  });
  if (!res.ok) throw new Error(String(res.status));
  return ((await res.json()) as { id: string }).id;
}
