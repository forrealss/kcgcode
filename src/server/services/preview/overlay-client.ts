/**
 * Overlay Preview (berjalan di halaman app yang di-preview, BUKAN di app
 * KCG Code). Dibundel `overlay-api.ts` menjadi satu IIFE dan disuntik di
 * awal `<head>` setiap dokumen HTML preview.
 *
 * - Tombol melayang kecil (bisa digeser, menempel ke tepi kiri/kanan,
 *   posisinya diingat) dengan titik status agent & jumlah error console.
 * - Tap -> sheet: reload, screenshot, tampilan desktop/HP, kembali ke chat,
 *   sembunyikan; status agent + balasan terakhir; error console (tambahkan ke
 *   pesan); composer untuk mengirim pesan + gambar ke Session tanpa
 *   meninggalkan preview.
 * - Screenshot (Chrome headless di mesin kcgcode) atau foto dari perangkat
 *   bisa dicoret-coret dulu sebelum dilampirkan.
 *
 * Semua UI di shadow root tertutup agar CSS app dan overlay tidak saling
 * memengaruhi. Tanpa framework — script ini ikut dimuat di setiap halaman.
 */

type SessionStatus = "running" | "stopped" | "crashed";

interface SessionInfo {
  id: string;
  title: string | null;
  status: SessionStatus;
  turnActive: boolean;
}

interface ServerInfo {
  phase: "stopped" | "starting" | "running" | "exited" | "crashed";
  port: number | null;
}

type OverlayEvent =
  | { type: "turn"; active: boolean }
  | { type: "status"; status: SessionStatus }
  | { type: "reply"; text: string }
  | { type: "attention"; pending: boolean }
  | { type: "agent_error"; message: string }
  | { type: "server"; server: ServerInfo | null };

interface CapturedError {
  message: string;
  detail: string;
  count: number;
}

const API = "/__kcg/preview/api/";
const PILL_KEY = "__kcg_preview_pill";
const VIEW_KEY = "__kcg_preview_viewport";
const RELOAD_KEY = "__kcg_preview_autoreload";
const MAX_ERRORS = 20;
const MAX_IMAGES = 4;
const DEFAULT_IMAGE_TEXT = "Here's what I see in the preview.";

(() => {
  const w = window as Window & { __kcgPreview?: boolean };
  // Hanya dokumen teratas, sekali saja (iframe app tidak diberi overlay).
  if (w.top !== w || w.__kcgPreview) return;
  w.__kcgPreview = true;

  const store = {
    get(area: Storage | undefined, key: string): string | null {
      try {
        return area?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(area: Storage | undefined, key: string, value: string): void {
      try {
        area?.setItem(key, value);
      } catch {
        // storage diblokir — fitur kenyamanan saja
      }
    },
  };
  const local = (() => {
    try {
      return window.localStorage;
    } catch {
      return undefined;
    }
  })();
  const sessionArea = (() => {
    try {
      return window.sessionStorage;
    } catch {
      return undefined;
    }
  })();

  // ---------------------------------------------------------------------
  // 1. Tangkap error console sedini mungkin (sebelum script app berjalan).
  // ---------------------------------------------------------------------
  const errors: CapturedError[] = [];
  let render = () => {};

  function stringify(v: unknown): string {
    if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`;
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  function record(message: string, detail = ""): void {
    const msg = message.trim().slice(0, 2000) || "Unknown error";
    const existing = errors.find((e) => e.message === msg);
    if (existing) existing.count++;
    else {
      errors.push({ message: msg, detail: detail.slice(0, 4000), count: 1 });
      if (errors.length > MAX_ERRORS) errors.shift();
    }
    render();
  }

  const origError = console.error;
  console.error = function (this: unknown, ...args: unknown[]) {
    try {
      const [first, ...rest] = args;
      const detail = args.find((a) => a instanceof Error) as Error | undefined;
      record([first, ...rest].map(stringify).join(" ").split("\n")[0] ?? "", detail?.stack ?? "");
    } catch {
      // jangan pernah merusak console.error asli
    }
    return origError.apply(this, args);
  };
  window.addEventListener(
    "error",
    (e) => {
      const target = e.target as (HTMLElement & { src?: string; href?: string }) | null;
      if (target && target !== (window as unknown) && "tagName" in target) {
        record(
          `Failed to load ${target.tagName.toLowerCase()}: ${target.src ?? target.href ?? ""}`,
        );
        return;
      }
      const err = (e as ErrorEvent).error;
      record(
        (e as ErrorEvent).message || stringify(err),
        err instanceof Error
          ? (err.stack ?? "")
          : `${(e as ErrorEvent).filename}:${(e as ErrorEvent).lineno}`,
      );
    },
    true,
  );
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    record(`Unhandled rejection: ${r instanceof Error ? r.message : stringify(r)}`, r?.stack ?? "");
  });

  // ---------------------------------------------------------------------
  // 2. Tampilan desktop (viewport lebar) — berlaku sampai tab ditutup.
  // ---------------------------------------------------------------------
  let desktop = store.get(sessionArea, VIEW_KEY) === "desktop";
  function applyViewport(): void {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) {
      if (!desktop) return;
      meta = document.createElement("meta");
      meta.name = "viewport";
      document.head?.appendChild(meta);
    }
    if (!meta.dataset.kcgOriginal) {
      meta.dataset.kcgOriginal = meta.content || "width=device-width, initial-scale=1";
    }
    meta.content = desktop ? "width=1280" : meta.dataset.kcgOriginal;
  }

  // ---------------------------------------------------------------------
  // 3. State dari kcgcode (Session, agent, dev server).
  // ---------------------------------------------------------------------
  const state = {
    session: null as SessionInfo | null,
    chatUrl: null as string | null,
    server: null as ServerInfo | null,
    turnActive: false,
    attention: false,
    reply: null as string | null,
    agentError: null as string | null,
    open: false,
    hidden: false,
    sending: false,
    sendError: null as string | null,
    autoReload: store.get(local, RELOAD_KEY) === "1",
    /** Chrome headless tersedia di mesin kcgcode. */
    screenshots: false,
    shooting: false,
    annotating: false,
    /** Gambar terunggah yang ikut pesan berikutnya. */
    images: [] as Array<{ id: string; url: string }>,
  };

  async function loadState(): Promise<void> {
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
      render();
    } catch {
      // kcgcode tak terjangkau — overlay tetap bisa reload/ganti tampilan
    }
  }

  function listen(): void {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource(`${API}events`);
    es.onmessage = (ev) => {
      let e: OverlayEvent;
      try {
        e = JSON.parse(ev.data) as OverlayEvent;
      } catch {
        return;
      }
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
      render();
    };
  }

  async function send(text: string): Promise<boolean> {
    state.sending = true;
    state.sendError = null;
    render();
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
      render();
    }
  }

  // ---------------------------------------------------------------------
  // 4. UI (shadow DOM).
  // ---------------------------------------------------------------------
  function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Record<string, string> = {},
    ...children: Array<Node | string>
  ): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") el.className = v;
      else el.setAttribute(k, v);
    }
    for (const c of children) el.append(c);
    return el;
  }

  const ICON = {
    logo: `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M14 74V44c0-8 2-15 6-21L31 9l8 15c3.5-1.2 7.2-2 11-2s7.5.8 11 2l8-15 11 14c4 6 6 13 6 21v18c0 14-10 24-24 24H38c-11 0-19-5-22-12" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><circle cx="34" cy="52" r="6" fill="currentColor"/><circle cx="66" cy="52" r="6" fill="currentColor"/></svg>`,
    reload: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg>`,
    desktop: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
    phone: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>`,
    chat: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z"/></svg>`,
    hide: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 22 12a14 14 0 0 1-3 3.9M6.6 6.6A14 14 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`,
    close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
    send: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`,
    camera: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/></svg>`,
    image: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>`,
    undo: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>`,
  };

  const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.root{--bg:#fff;--fg:#0a0a0a;--muted:#6b6b6b;--line:rgba(0,0,0,.1);--soft:rgba(0,0,0,.05);--accent:#6d5cfb;--warn:#d97706;--danger:#dc2626;--ok:#10b981;color:var(--fg);font-size:14px;line-height:1.45}
@media (prefers-color-scheme:dark){.root{--bg:#171717;--fg:#fafafa;--muted:#a3a3a3;--line:rgba(255,255,255,.12);--soft:rgba(255,255,255,.07)}}
svg{width:20px;height:20px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;flex:none}
button,a{font:inherit;color:inherit;-webkit-tap-highlight-color:transparent}
.pill{position:fixed;z-index:2147483647;display:flex;align-items:center;gap:6px;height:44px;min-width:44px;padding:0 12px;border-radius:22px;border:1px solid var(--line);background:var(--bg);color:var(--fg);box-shadow:0 4px 16px rgba(0,0,0,.18);cursor:pointer;touch-action:none;user-select:none;transition:opacity .2s}
.pill.dragging{transition:none;opacity:.85}
.pill .logo{color:var(--accent);display:flex}
.pill .logo svg{width:22px;height:22px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--warn);animation:pulse 1.2s ease-in-out infinite}
.dot.attn{background:var(--danger);animation:none}
.badge{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--danger);color:#fff;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center}
@keyframes pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.dot{animation:none}}
.scrim{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.35)}
.sheet{position:fixed;z-index:2147483647;left:0;right:0;bottom:0;margin:0 auto;max-width:480px;max-height:82vh;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;background:var(--bg);border:1px solid var(--line);border-bottom:0;border-radius:16px 16px 0 0;padding:8px 16px calc(16px + env(safe-area-inset-bottom));box-shadow:0 -8px 32px rgba(0,0,0,.25)}
.grab{width:36px;height:4px;border-radius:2px;background:var(--line);margin:0 auto 8px}
.head{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.head .t{flex:1;min-width:0}
.head .t b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.head .t span{font-size:12px;color:var(--muted)}
.icon-btn{width:40px;height:40px;border-radius:20px;border:0;background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer}
.icon-btn:hover,.act:hover{background:var(--soft)}
.acts{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;margin-bottom:12px}
.act{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 2px;border-radius:12px;border:0;background:transparent;font-size:11px;color:var(--muted);cursor:pointer;text-decoration:none;text-align:center}
.act svg{color:var(--fg)}
.box{border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:10px}
.attn-box{border-color:var(--danger);color:var(--danger)}
.attn-box a{font-weight:600}
.row{display:flex;align-items:center;gap:8px;font-size:13px}
.muted{color:var(--muted)}
.reply{margin-top:6px;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;cursor:pointer}
.reply.full{display:block}
.sec{display:flex;align-items:center;justify-content:space-between;margin:14px 0 6px;font-size:12px;font-weight:600;color:var(--muted)}
.link{border:0;background:none;color:var(--accent);font-size:12px;font-weight:600;cursor:pointer;padding:4px}
.err{border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin-bottom:6px}
.err code{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font:12px/1.4 ui-monospace,Menlo,monospace;color:var(--danger);overflow-wrap:anywhere;white-space:pre-wrap}
.err .row{justify-content:space-between;margin-top:4px}
.composer{display:flex;align-items:flex-end;gap:8px;margin-top:14px;border:1px solid var(--line);border-radius:22px;padding:6px 6px 6px 14px}
textarea{flex:1;min-width:0;border:0;outline:0;resize:none;background:transparent;color:var(--fg);font-size:16px;line-height:1.4;max-height:120px;padding:6px 0}
.send{width:36px;height:36px;border-radius:18px;border:0;background:var(--fg);color:var(--bg);display:flex;align-items:center;justify-content:center;cursor:pointer}
.send:disabled{opacity:.4;cursor:default}
.opt{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;color:var(--muted)}
.opt input{width:18px;height:18px;accent-color:var(--accent)}
.note{font-size:13px;color:var(--danger);margin-top:6px}
.act:disabled{opacity:.4;cursor:default}
.thumbs{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.thumb{position:relative;width:56px;height:56px;border-radius:10px;overflow:hidden;border:1px solid var(--line)}
.thumb img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
.thumb button{position:absolute;top:2px;right:2px;width:20px;height:20px;border-radius:10px;border:0;background:rgba(0,0,0,.6);color:#fff;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer}
.thumb button svg{width:12px;height:12px}
.attach{width:36px;height:36px;border-radius:18px;border:0;background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--muted);flex:none;margin-left:-8px}
.annot{position:fixed;inset:0;z-index:2147483647;background:#0a0a0a;display:flex;flex-direction:column;color:#fafafa}
.annot .bar{display:flex;align-items:center;gap:8px;padding:calc(8px + env(safe-area-inset-top)) 12px 8px}
.annot .bar b{flex:1;font-size:15px;font-weight:600}
.annot .bar button{height:40px;padding:0 14px;border-radius:20px;border:0;background:rgba(255,255,255,.12);color:#fafafa;font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px}
.annot .bar button.primary{background:#fafafa;color:#0a0a0a}
.annot .bar button:disabled{opacity:.4}
.annot .stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:8px 8px calc(8px + env(safe-area-inset-bottom))}
.annot canvas{max-width:100%;max-height:100%;touch-action:none;border-radius:8px;background:#fff}
.annot .hint{text-align:center;font-size:12px;color:#a3a3a3;padding-bottom:calc(10px + env(safe-area-inset-bottom))}
.spin{width:14px;height:14px;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
`;

  function mount(): void {
    applyViewport();
    const host = document.createElement("kcg-preview-overlay");
    // Hindari mewarisi gaya app (mis. `* { display:flex }`).
    host.setAttribute("style", "all:initial;position:static");
    const shadow = host.attachShadow({ mode: "closed" });
    const root = h("div", { class: "root" });
    shadow.append(h("style", {}, CSS), root);
    document.documentElement.append(host);

    // ---- Tombol melayang ----
    const pill = h("button", { class: "pill", type: "button", "aria-label": "KCG Code preview" });
    const logo = h("span", { class: "logo" });
    logo.innerHTML = ICON.logo;
    const dot = h("span", { class: "dot" });
    const badge = h("span", { class: "badge" });
    pill.append(logo, dot, badge);
    root.append(pill);

    let pos = { side: "right", top: Math.round(window.innerHeight * 0.7) };
    try {
      const saved = JSON.parse(store.get(local, PILL_KEY) ?? "null") as typeof pos | null;
      if (
        saved &&
        (saved.side === "left" || saved.side === "right") &&
        Number.isFinite(saved.top)
      ) {
        pos = saved;
      }
    } catch {
      // posisi default
    }
    function place(): void {
      const top = Math.min(Math.max(pos.top, 8), window.innerHeight - 52);
      pill.style.top = `${top}px`;
      pill.style.left = pos.side === "left" ? "8px" : "";
      pill.style.right = pos.side === "right" ? "8px" : "";
    }
    place();
    window.addEventListener("resize", place);

    let drag: { x: number; y: number; moved: boolean; id: number } | null = null;
    pill.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
      pill.setPointerCapture(e.pointerId);
    });
    pill.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
      drag.moved = true;
      pill.classList.add("dragging");
      pill.style.right = "";
      pill.style.left = `${e.clientX - 22}px`;
      pill.style.top = `${e.clientY - 22}px`;
    });
    pill.addEventListener("pointerup", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved;
      drag = null;
      pill.classList.remove("dragging");
      if (moved) {
        // Menempel ke tepi terdekat; posisi diingat untuk halaman berikutnya.
        pos = { side: e.clientX < window.innerWidth / 2 ? "left" : "right", top: e.clientY - 22 };
        store.set(local, PILL_KEY, JSON.stringify(pos));
        place();
        return;
      }
      state.open = true;
      render();
      setTimeout(() => textarea.focus({ preventScroll: true }), 50);
    });
    pill.addEventListener("pointercancel", () => {
      drag = null;
      pill.classList.remove("dragging");
      place();
    });

    // ---- Sheet ----
    const scrim = h("div", { class: "scrim" });
    scrim.addEventListener("click", () => {
      state.open = false;
      render();
    });
    const sheet = h("div", { class: "sheet", role: "dialog", "aria-label": "KCG Code preview" });

    const title = h("b");
    const subtitle = h("span");
    const closeBtn = h("button", { class: "icon-btn", type: "button", "aria-label": "Close" });
    closeBtn.innerHTML = ICON.close;
    closeBtn.addEventListener("click", () => {
      state.open = false;
      render();
    });
    const head = h("div", { class: "head" }, h("div", { class: "t" }, title, subtitle), closeBtn);

    function action(icon: string, label: string, onClick: () => void): HTMLButtonElement {
      const b = h("button", { class: "act", type: "button" });
      b.innerHTML = icon;
      b.append(label);
      b.addEventListener("click", onClick);
      return b;
    }
    const reloadBtn = action(ICON.reload, "Reload", () => location.reload());
    const viewBtn = action(
      desktop ? ICON.phone : ICON.desktop,
      desktop ? "Phone" : "Desktop",
      () => {
        desktop = !desktop;
        store.set(sessionArea, VIEW_KEY, desktop ? "desktop" : "device");
        applyViewport();
        viewBtn.innerHTML = desktop ? ICON.phone : ICON.desktop;
        viewBtn.append(desktop ? "Phone" : "Desktop");
      },
    );
    const chatLink = h("a", { class: "act", target: "_top" });
    chatLink.innerHTML = ICON.chat;
    chatLink.append("Chat");
    const shotBtn = action(ICON.camera, "Screenshot", () => void takeScreenshot());
    const hideBtn = action(ICON.hide, "Hide", () => {
      state.hidden = true;
      state.open = false;
      render();
    });
    const acts = h("div", { class: "acts" }, reloadBtn, shotBtn, viewBtn, chatLink, hideBtn);

    const attnBox = h("div", { class: "box attn-box" });
    const statusBox = h("div", { class: "box" });
    const errHead = h("div", { class: "sec" });
    const errList = h("div");

    const textarea = h("textarea", {
      rows: "1",
      placeholder: "Tell the agent what to change…",
      "aria-label": "Message to the agent",
    });
    const sendBtn = h("button", { class: "send", type: "button", "aria-label": "Send" });
    sendBtn.innerHTML = ICON.send;
    // Foto dari perangkat (mis. screenshot OS yang persis seperti di layar).
    const fileInput = h("input", { type: "file", accept: "image/*", style: "display:none" });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (file) openAnnotator(file);
    });
    const attachBtn = h("button", { class: "attach", type: "button", "aria-label": "Add a photo" });
    attachBtn.innerHTML = ICON.image;
    attachBtn.addEventListener("click", () => fileInput.click());
    const thumbs = h("div", { class: "thumbs" });
    const composer = h("div", { class: "composer" }, attachBtn, textarea, sendBtn, fileInput);
    const note = h("div", { class: "note" });
    const reloadOpt = h("input", { type: "checkbox" });
    reloadOpt.checked = state.autoReload;
    reloadOpt.addEventListener("change", () => {
      state.autoReload = reloadOpt.checked;
      store.set(local, RELOAD_KEY, state.autoReload ? "1" : "0");
    });
    const opt = h("label", { class: "opt" }, reloadOpt, "Reload when the agent finishes");
    const noSession = h("div", { class: "muted", style: "font-size:13px;margin-top:12px" });
    noSession.textContent = "Open the preview from a chat to message the agent here.";

    function grow(): void {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
      sendBtn.disabled =
        state.sending || (textarea.value.trim() === "" && state.images.length === 0);
    }
    textarea.addEventListener("input", grow);
    async function submit(): Promise<void> {
      const text = textarea.value.trim() || (state.images.length > 0 ? DEFAULT_IMAGE_TEXT : "");
      if (!text || state.sending) return;
      if (await send(text)) {
        textarea.value = "";
        grow();
      }
    }
    sendBtn.addEventListener("click", () => void submit());
    textarea.addEventListener("keydown", (e) => {
      // Enter mengirim di keyboard fisik; di HP Enter tetap baris baru.
      if (
        e.key === "Enter" &&
        !e.shiftKey &&
        !e.isComposing &&
        matchMedia("(pointer:fine)").matches
      ) {
        e.preventDefault();
        void submit();
      }
    });

    sheet.append(
      h("div", { class: "grab" }),
      head,
      acts,
      attnBox,
      statusBox,
      errHead,
      errList,
      thumbs,
      composer,
      note,
      opt,
      noSession,
    );

    // ---- Screenshot & anotasi ----
    async function takeScreenshot(): Promise<void> {
      if (state.shooting) return;
      if (!state.screenshots) {
        state.sendError =
          "Screenshots need Chrome on the computer running KCG Code. Add a photo instead.";
        render();
        return;
      }
      state.shooting = true;
      state.sendError = null;
      render();
      try {
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
        openAnnotator(await res.blob());
      } catch {
        state.sendError = "Couldn't take a screenshot. Add a photo instead.";
      } finally {
        state.shooting = false;
        render();
      }
    }

    function openAnnotator(src: Blob): void {
      const url = URL.createObjectURL(src);
      const img = new Image();
      img.onload = () => {
        // Batasi resolusi agar unggahan tetap kecil.
        const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = h("canvas");
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const strokes: Array<Array<[number, number]>> = [];
        const lineWidth = Math.max(4, Math.round(canvas.width / 120));
        function draw(): void {
          if (!ctx) return;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = lineWidth;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          for (const s of strokes) {
            ctx.beginPath();
            for (const [i, [x, y]] of s.entries()) {
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            if (s.length === 1 && s[0]) ctx.lineTo(s[0][0] + 0.1, s[0][1]);
            ctx.stroke();
          }
          undoBtn.disabled = strokes.length === 0;
        }
        const pointAt = (e: PointerEvent): [number, number] => {
          const r = canvas.getBoundingClientRect();
          return [
            ((e.clientX - r.left) / r.width) * canvas.width,
            ((e.clientY - r.top) / r.height) * canvas.height,
          ];
        };
        let drawing = false;
        canvas.addEventListener("pointerdown", (e) => {
          drawing = true;
          canvas.setPointerCapture(e.pointerId);
          strokes.push([pointAt(e)]);
          draw();
        });
        canvas.addEventListener("pointermove", (e) => {
          if (!drawing) return;
          strokes[strokes.length - 1]?.push(pointAt(e));
          draw();
        });
        const end = () => {
          drawing = false;
        };
        canvas.addEventListener("pointerup", end);
        canvas.addEventListener("pointercancel", end);

        const close = () => {
          URL.revokeObjectURL(url);
          panel.remove();
          state.annotating = false;
          state.open = true;
          render();
        };
        const cancelBtn = h("button", { type: "button" }, "Cancel");
        cancelBtn.addEventListener("click", close);
        const undoBtn = h("button", { type: "button", "aria-label": "Undo" });
        undoBtn.innerHTML = ICON.undo;
        undoBtn.addEventListener("click", () => {
          strokes.pop();
          draw();
        });
        const attachDone = h("button", { type: "button", class: "primary" }, "Attach");
        attachDone.addEventListener("click", () => {
          attachDone.disabled = true;
          attachDone.textContent = "Attaching…";
          canvas.toBlob(
            async (blob) => {
              if (!blob) return close();
              try {
                const res = await fetch(`${API}upload`, {
                  method: "POST",
                  credentials: "same-origin",
                  headers: { "content-type": "image/jpeg" },
                  body: blob,
                });
                if (!res.ok) throw new Error(String(res.status));
                const { id } = (await res.json()) as { id: string };
                state.images.push({ id, url: URL.createObjectURL(blob) });
                state.sendError = null;
              } catch {
                state.sendError = "Couldn't attach the image.";
              }
              close();
              setTimeout(() => textarea.focus({ preventScroll: true }), 50);
            },
            "image/jpeg",
            0.85,
          );
        });
        const panel = h(
          "div",
          { class: "annot", role: "dialog", "aria-label": "Mark up the screenshot" },
          h("div", { class: "bar" }, cancelBtn, h("b", {}, "Mark it up"), undoBtn, attachDone),
          h("div", { class: "stage" }, canvas),
          h("div", { class: "hint" }, "Draw on the image to point at what to change."),
        );
        root.append(panel);
        state.annotating = true;
        state.open = false;
        render();
        draw();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        state.sendError = "That image couldn't be opened.";
        render();
      };
      img.src = url;
    }

    function addErrorToMessage(err: CapturedError): void {
      const where = location.pathname + location.search;
      const lines = [err.message, ...err.detail.split("\n").slice(0, 12)].filter(Boolean);
      const block = `Error in the preview (${where}):\n\`\`\`\n${lines.join("\n")}\n\`\`\``;
      textarea.value = textarea.value.trim() ? `${textarea.value.trim()}\n\n${block}` : block;
      grow();
      textarea.focus({ preventScroll: true });
    }

    render = () => {
      // Tombol melayang
      pill.style.display = state.hidden || state.open || state.annotating ? "none" : "flex";
      dot.style.display = state.attention || state.turnActive ? "" : "none";
      dot.className = state.attention ? "dot attn" : "dot";
      const errCount = errors.reduce((n, e) => n + e.count, 0);
      badge.style.display = errCount > 0 ? "" : "none";
      badge.textContent = errCount > 99 ? "99+" : String(errCount);

      if (!state.open) {
        scrim.remove();
        sheet.remove();
        return;
      }
      if (!sheet.isConnected) root.append(scrim, sheet);

      title.textContent = state.session?.title || "KCG Code";
      subtitle.textContent =
        state.server && state.server.phase !== "running"
          ? `Dev server ${state.server.phase}`
          : `Preview${state.server?.port ? ` · :${state.server.port}` : ""}`;

      if (state.chatUrl) {
        chatLink.setAttribute("href", state.chatUrl);
        chatLink.style.display = "";
      } else chatLink.style.display = "none";

      attnBox.style.display = state.attention ? "" : "none";
      attnBox.replaceChildren("The agent is waiting for your answer. ");
      if (state.chatUrl) {
        const a = h("a", { href: state.chatUrl, target: "_top" }, "Open chat");
        attnBox.append(a);
      }

      // Status agent + balasan terakhir
      const hasSession = state.session !== null;
      statusBox.style.display = hasSession ? "" : "none";
      if (hasSession) {
        const row = h("div", { class: "row" });
        if (state.session?.status !== "running") {
          row.append(h("span", { class: "muted" }, "Session isn't running"));
        } else if (state.turnActive) {
          row.append(h("span", { class: "spin" }), "Agent is working…");
        } else {
          row.append(h("span", { class: "muted" }, "Agent is idle"));
        }
        statusBox.replaceChildren(row);
        if (state.agentError) statusBox.append(h("div", { class: "note" }, state.agentError));
        if (state.reply) {
          const reply = h("div", { class: "reply" }, state.reply);
          reply.addEventListener("click", () => reply.classList.toggle("full"));
          statusBox.append(reply);
        }
      }

      // Error console
      errHead.style.display = errors.length > 0 ? "" : "none";
      errList.replaceChildren();
      if (errors.length > 0) {
        const clear = h("button", { class: "link", type: "button" }, "Clear");
        clear.addEventListener("click", () => {
          errors.length = 0;
          render();
        });
        errHead.replaceChildren(h("span", {}, `Console errors (${errors.length})`), clear);
        for (const err of [...errors].reverse()) {
          const add = h("button", { class: "link", type: "button" }, "Add to message");
          add.addEventListener("click", () => addErrorToMessage(err));
          errList.append(
            h(
              "div",
              { class: "err" },
              h("code", {}, err.message),
              h(
                "div",
                { class: "row" },
                h("span", { class: "muted" }, err.count > 1 ? `×${err.count}` : ""),
                hasSession ? add : "",
              ),
            ),
          );
        }
      }

      composer.style.display = hasSession ? "" : "none";
      shotBtn.style.display = hasSession ? "" : "none";
      shotBtn.disabled = state.shooting;
      thumbs.style.display = state.images.length > 0 ? "" : "none";
      attachBtn.style.display = state.images.length >= MAX_IMAGES ? "none" : "";
      thumbs.replaceChildren(
        ...state.images.map((img) => {
          const remove = h("button", { type: "button", "aria-label": "Remove image" });
          remove.innerHTML = ICON.close;
          remove.addEventListener("click", () => {
            URL.revokeObjectURL(img.url);
            state.images = state.images.filter((i) => i !== img);
            render();
          });
          return h("div", { class: "thumb" }, h("img", { src: img.url, alt: "" }), remove);
        }),
      );
      opt.style.display = hasSession ? "" : "none";
      noSession.style.display = hasSession ? "none" : "";
      note.style.display = state.sendError ? "" : "none";
      note.textContent = state.sendError ?? "";
      grow();
    };

    render();
    void loadState();
    listen();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else mount();
})();
