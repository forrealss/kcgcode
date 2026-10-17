/**
 * Screenshot halaman dev server dengan Chrome/Chromium headless yang sudah
 * ada di mesin, dikendalikan langsung lewat Chrome DevTools Protocol
 * (WebSocket) — tanpa dependensi Playwright/Puppeteer.
 *
 * Dipakai untuk: screenshot dari overlay preview (lalu dianotasi), snapshot
 * otomatis setelah turn agent selesai, dan snapshot di sheet Preview (juga
 * jalan keluar saat remote access lewat localhost.run, yang tidak bisa
 * membuka preview langsung).
 *
 * Browser dinyalakan saat pertama dibutuhkan dan ditutup setelah idle.
 * Capture diserialkan (satu tab sekaligus) agar mesin pengguna tidak berat.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { Result } from "../../result";

export interface Viewport {
  width: number;
  height: number;
  /** devicePixelRatio. */
  dpr: number;
  mobile: boolean;
}

/** Viewport HP default (iPhone 14-ish). */
export const MOBILE_VIEWPORT: Viewport = { width: 390, height: 844, dpr: 2, mobile: true };

/** Batasi viewport dari klien agar tidak membuat gambar raksasa. */
export function clampViewport(v: Partial<Viewport>): Viewport {
  const n = (x: unknown, min: number, max: number, def: number) =>
    typeof x === "number" && Number.isFinite(x) ? Math.min(Math.max(Math.round(x), min), max) : def;
  const width = n(v.width, 240, 1920, MOBILE_VIEWPORT.width);
  return {
    width,
    height: n(v.height, 320, 2400, MOBILE_VIEWPORT.height),
    dpr: Math.min(Math.max(typeof v.dpr === "number" ? v.dpr : 2, 1), 3),
    mobile: typeof v.mobile === "boolean" ? v.mobile : width < 768,
  };
}

export interface Screenshotter {
  /** Browser ditemukan di mesin ini. */
  available(): boolean;
  /** JPEG halaman `url` pada viewport tertentu. */
  capture(url: string, viewport?: Partial<Viewport>): Promise<Result<Uint8Array<ArrayBuffer>>>;
  close(): Promise<void>;
}

/** Cari Chrome/Chromium: `KCG_CHROME_PATH`, PATH, cache Playwright, lokasi umum OS. */
export function findChrome(env = process.env): string | null {
  const explicit = env.KCG_CHROME_PATH?.trim();
  if (explicit) return existsSync(explicit) ? explicit : null;
  for (const name of [
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
    "microsoft-edge",
    "brave-browser",
  ]) {
    const found = Bun.which(name);
    if (found) return found;
  }
  // Browser unduhan Playwright (sering sudah ada di mesin developer).
  const pwRoot =
    env.PLAYWRIGHT_BROWSERS_PATH ||
    (process.platform === "darwin"
      ? path.join(homedir(), "Library", "Caches", "ms-playwright")
      : process.platform === "win32"
        ? path.join(env.LOCALAPPDATA ?? "", "ms-playwright")
        : path.join(homedir(), ".cache", "ms-playwright"));
  try {
    const dirs = readdirSync(pwRoot)
      .filter((d) => d.startsWith("chromium"))
      .sort()
      .reverse();
    for (const d of dirs) {
      for (const rel of [
        "chrome-linux/headless_shell",
        "chrome-linux/chrome",
        "chrome-headless-shell-linux64/chrome-headless-shell",
        "chrome-linux64/chrome",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-win/chrome.exe",
      ]) {
        const p = path.join(pwRoot, d, rel);
        if (existsSync(p)) return p;
      }
    }
  } catch {
    // tidak ada cache Playwright
  }
  const fixed =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
      : process.platform === "win32"
        ? [
            `${env.PROGRAMFILES ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`,
            `${env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\Microsoft\\Edge\\Application\\msedge.exe`,
          ]
        : [];
  return fixed.find((p) => existsSync(p)) ?? null;
}

interface Browser {
  proc: ReturnType<typeof Bun.spawn>;
  ws: WebSocket;
  dataDir: string;
  nextId: number;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  listeners: Set<(msg: { method?: string; sessionId?: string; params?: unknown }) => void>;
}

async function readDevtoolsUrl(
  stream: ReadableStream<Uint8Array>,
  timeoutMs: number,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        Bun.sleep(Math.max(deadline - Date.now(), 0)).then(() => null),
      ]);
      if (!chunk || chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m?.[1]) return m[1];
    }
  } finally {
    // Sisa stderr dibuang agar pipe tidak penuh.
    void (async () => {
      try {
        while (!(await reader.read()).done) {}
      } catch {
        // proses selesai
      }
    })();
  }
  throw new Error(`browser didn't start: ${buf.slice(-300)}`);
}

export function createScreenshotter(
  opts: {
    chromePath?: string | null;
    idleCloseMs?: number;
    timeoutMs?: number;
    settleMs?: number;
  } = {},
): Screenshotter {
  const chromePath = opts.chromePath === undefined ? findChrome() : opts.chromePath;
  const idleCloseMs = opts.idleCloseMs ?? 60_000;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const settleMs = opts.settleMs ?? 600;
  let browser: Promise<Browser> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  function send(
    b: Browser,
    method: string,
    params: unknown = {},
    sessionId?: string,
  ): Promise<unknown> {
    const id = b.nextId++;
    return new Promise((resolve, reject) => {
      b.pending.set(id, { resolve, reject });
      b.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async function launch(): Promise<Browser> {
    if (!chromePath) throw new Error("no browser");
    const dataDir = mkdtempSync(path.join(tmpdir(), "kcg-shot-"));
    const proc = Bun.spawn(
      [
        chromePath,
        "--headless=new",
        "--remote-debugging-port=0",
        `--user-data-dir=${dataDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--hide-scrollbars",
        "--mute-audio",
        "about:blank",
      ],
      { stdin: "ignore", stdout: "ignore", stderr: "pipe", windowsHide: true },
    );
    const wsUrl = await readDevtoolsUrl(proc.stderr, 15_000).catch((err) => {
      proc.kill();
      rmSync(dataDir, { recursive: true, force: true });
      throw err;
    });
    const ws = new WebSocket(wsUrl);
    const b: Browser = { proc, ws, dataDir, nextId: 1, pending: new Map(), listeners: new Set() };
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("devtools connection failed"));
    });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
        method?: string;
        sessionId?: string;
        params?: unknown;
      };
      if (msg.id !== undefined) {
        const p = b.pending.get(msg.id);
        b.pending.delete(msg.id);
        if (msg.error) p?.reject(new Error(msg.error.message));
        else p?.resolve(msg.result);
      } else for (const l of b.listeners) l(msg);
    };
    ws.onclose = () => {
      for (const p of b.pending.values()) p.reject(new Error("browser closed"));
      b.pending.clear();
      if (browser) browser = null;
    };
    void proc.exited.then(() => {
      browser = null;
      rmSync(dataDir, { recursive: true, force: true });
    });
    return b;
  }

  async function shutdownBrowser(): Promise<void> {
    const cur = browser;
    browser = null;
    if (!cur) return;
    try {
      const b = await cur;
      b.ws.close();
      b.proc.kill();
      await Promise.race([b.proc.exited, Bun.sleep(2000)]);
      rmSync(b.dataDir, { recursive: true, force: true });
    } catch {
      // gagal start — tidak ada yang ditutup
    }
  }

  async function captureOnce(url: string, vp: Viewport): Promise<Uint8Array<ArrayBuffer>> {
    browser ??= launch();
    let b: Browser;
    try {
      b = await browser;
    } catch (err) {
      browser = null;
      throw err;
    }
    const { targetId } = (await send(b, "Target.createTarget", { url: "about:blank" })) as {
      targetId: string;
    };
    try {
      const { sessionId } = (await send(b, "Target.attachToTarget", {
        targetId,
        flatten: true,
      })) as {
        sessionId: string;
      };
      const loaded = new Promise<void>((resolve) => {
        const l = (m: { method?: string; sessionId?: string }) => {
          if (m.sessionId === sessionId && m.method === "Page.loadEventFired") {
            b.listeners.delete(l);
            resolve();
          }
        };
        b.listeners.add(l);
      });
      await send(b, "Page.enable", {}, sessionId);
      await send(
        b,
        "Emulation.setDeviceMetricsOverride",
        { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile },
        sessionId,
      );
      await send(b, "Page.navigate", { url }, sessionId);
      await Promise.race([loaded, Bun.sleep(timeoutMs * 0.6)]);
      // Beri waktu render client-side (React/Vue mount, font).
      await Bun.sleep(settleMs);
      const { data } = (await send(
        b,
        "Page.captureScreenshot",
        { format: "jpeg", quality: 80, captureBeyondViewport: false },
        sessionId,
      )) as { data: string };
      return Uint8Array.from(Buffer.from(data, "base64"));
    } finally {
      void send(b, "Target.closeTarget", { targetId }).catch(() => {});
    }
  }

  return {
    available: () => chromePath !== null,
    capture(url, viewport) {
      const vp = clampViewport(viewport ?? MOBILE_VIEWPORT);
      const run = async (): Promise<Result<Uint8Array<ArrayBuffer>>> => {
        if (!chromePath) return { ok: false, error: "PREVIEW_NO_BROWSER" };
        if (idleTimer) clearTimeout(idleTimer);
        try {
          const bytes = await Promise.race([
            captureOnce(url, vp),
            Bun.sleep(timeoutMs).then(() => {
              throw new Error("timeout");
            }),
          ]);
          return { ok: true, data: bytes };
        } catch (err) {
          console.warn("[kcg-code] screenshot preview gagal:", String(err).slice(0, 200));
          // Browser bermasalah: mulai bersih di capture berikutnya.
          await shutdownBrowser();
          return { ok: false, error: "PREVIEW_SCREENSHOT_FAILED" };
        } finally {
          idleTimer = setTimeout(() => void shutdownBrowser(), idleCloseMs);
          (idleTimer as { unref?: () => void }).unref?.();
        }
      };
      const next = queue.then(run, run);
      queue = next.catch(() => {});
      return next;
    },
    async close() {
      if (idleTimer) clearTimeout(idleTimer);
      await shutdownBrowser();
    },
  };
}
