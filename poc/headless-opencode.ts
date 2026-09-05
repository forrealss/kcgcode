#!/usr/bin/env bun
/**
 * PoC — opencode headless server mode (`opencode serve`).
 *
 * Membandingkan dengan pendekatan PTY (mode TUI) yang dipakai KCG Code:
 * - Tanpa ANSI escape / parsing terminal.
 * - Prompt & balasan sebagai JSON terstruktur (bukan byte mentah TUI).
 * - Permission request datang sebagai event terstruktur dan bisa dijawab
 *   via `POST /permission/{requestID}/reply` (bukan nulis `y\n` ke PTY).
 *
 * Alur:
 *   1. spawn `opencode serve --port <port>` di `--cwd`
 *   2. tunggu server siap (poll `GET /global/health`)
 *   3. (opsional `--sse`) subscribe `GET /event` — tampilkan event bertipe
 *   4. `POST /session` -> buat session
 *   5. `POST /session/{id}/message` -> kirim prompt, dapat balasan terstruktur
 *   6. tampilkan balasan + cleanup (kill proses server)
 *
 * Usage:
 *   bun poc/headless-opencode.ts [--port 4601] [--cwd <dir>] [--sse]
 *       [--permissions once|reject|none] ["prompt..."]
 */

const args = process.argv.slice(2);

/** Flag yang memakan nilai arg berikutnya — agar positional tidak salah ambil. */
const VALUE_FLAGS = new Set(["--port", "--cwd", "--prompt"]);
function value(name: string, def?: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}
const has = (name: string): boolean => args.includes(name);

// Positional prompt = arg non-flag yang bukan nilai dari flag ber-nilai.
const consumed = new Set<number>();
args.forEach((a, i) => {
  if (VALUE_FLAGS.has(a)) {
    consumed.add(i);
    consumed.add(i + 1);
  }
  if (a.startsWith("-")) consumed.add(i);
});
const positional = args.filter((_a, i) => !consumed.has(i));

const PORT = Number(value("--port", "4601"));
const CWD = value("--cwd") ?? process.cwd();
const BASE = `http://127.0.0.1:${PORT}`;
const PROMPT =
  value("--prompt") ??
  positional[0] ??
  "List nama file/direktori di root project ini (cukup nama saja, tanpa markdown).";
const WITH_SSE = has("--sse");
/** Kebijakan permission otomatis: once | reject | none (abaikan). */
const PERM_MODE = value("--permissions", "once") ?? "once";

// ── util ────────────────────────────────────────────────────────────────────
const c = {
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};
function section(title: string): void {
  console.log(
    `\n${c.bold}${c.cyan}── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}${c.reset}`,
  );
}
async function api(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* response kosong */
  }
  return { status: res.status, json };
}

// ── 1. spawn server ─────────────────────────────────────────────────────────
section("1. Spawn `opencode serve`");
console.log(`${c.dim}port=${PORT}  cwd=${CWD}${c.reset}`);
const server = Bun.spawn(["opencode", "serve", "--port", String(PORT), "--hostname", "127.0.0.1"], {
  cwd: CWD,
  stdout: "pipe",
  stderr: "pipe",
});
// Drain stdout/stderr agar buffer pipe tidak penuh.
let serverLog = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.pipeTo(
    new WritableStream({
      write(chunk) {
        serverLog += chunk;
      },
    }),
  );
}

// ── 2. tunggu server siap ───────────────────────────────────────────────────
async function waitReady(timeoutMs = 90000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Timeout tiap probe: server bisa saja sudah listen tapi event loop-nya
      // masih sibuk (inisialisasi provider), sehingga fetch perlu timeout sendiri.
      const res = await fetch(`${BASE}/global/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
    } catch {
      /* belum siap */
    }
    await Bun.sleep(300);
  }
  throw new Error(`opencode serve tidak siap dalam ${timeoutMs}ms.\nLog server:\n${serverLog}`);
}

// ── 3. SSE listener (opsional) ──────────────────────────────────────────────
async function watchEvents(abort: AbortController): Promise<void> {
  const res = await fetch(`${BASE}/event`, { signal: abort.signal });
  if (!res.ok || !res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      const evLine = frame.split("\n").find((l) => l.startsWith("event:"));
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const type = evLine?.slice(6).trim() ?? "(message)";
      // Filter noise: hanya event percakapan/permission yang relevan.
      if (!/^(session|message|permission|question|server)/.test(type)) continue;
      const payload = dataLine.slice(5).trim();

      // Permission request = event terstruktur (bukan regex `(y/n)` dari TUI).
      // Nama event asli (terverifikasi live): `permission.asked` — payload
      // { id, sessionID, permission, patterns } dengan id `per_...`.
      // Di PoC ini dijawab otomatis; di KCG Code nanti jadi kartu interaktif.
      if (type === "permission.asked") {
        try {
          const ev = JSON.parse(payload) as {
            id?: string;
            requestID?: string;
            permission?: unknown;
          };
          // Event asli memakai field `id` (bukan `requestID`) untuk request id.
          const reqID = ev.id ?? ev.requestID;
          if (reqID && PERM_MODE !== "none") {
            const reply = PERM_MODE === "reject" ? "reject" : "once";
            const r = await api("POST", `/permission/${reqID}/reply`, { reply });
            console.log(
              `  ${c.yellow}🛡 permission.request${c.reset} ${c.dim}${JSON.stringify(ev.permission)?.slice(0, 120)}${c.reset} → auto-${reply} (${r.status})`,
            );
            continue;
          }
        } catch {
          /* payload tidak ter-parse */
        }
      }

      let brief = payload.slice(0, 160);
      if (brief.length < payload.length) brief += "…";
      console.log(
        `  ${c.magenta}⚡ event${c.reset} ${c.bold}${type}${c.reset} ${c.dim}${brief}${c.reset}`,
      );
    }
  }
}

// ── main ────────────────────────────────────────────────────────────────────
const sseAbort = new AbortController();
try {
  await waitReady();
  section("2. Server siap");
  const { json: health } = await api("GET", "/global/health");
  console.log(`${c.dim}${JSON.stringify(health)}${c.reset}`);

  if (WITH_SSE) {
    section("3. SSE /event");
    const watcher = watchEvents(sseAbort);
    void watcher.catch(() => {});
    await Bun.sleep(1200); // tangkap event awal (session.created, dll)
    // Lanjut: session + message diproses sambil SSE tetap mengalir.
    console.log(
      `${c.dim}SSE aktif — event di bawah ini mengalir selama percakapan. ` +
        `permissions=${PERM_MODE}${c.reset}`,
    );
  }

  section("4. Buat session");
  const { status: s1, json: session } = await api("POST", "/session", {
    title: "KCG Code PoC",
  });
  if (s1 !== 200) throw new Error(`POST /session gagal (${s1}): ${JSON.stringify(session)}`);
  const sess = session as {
    id: string;
    title?: string;
    directory?: string;
    model?: unknown;
    agent?: string;
  };
  console.log(`${c.green}✓ session${c.reset}  id=${c.bold}${sess.id}${c.reset}`);
  console.log(
    `${c.dim}  directory=${sess.directory}  model=${JSON.stringify(sess.model)}  agent=${sess.agent}${c.reset}`,
  );

  section("5. Kirim prompt");
  console.log(`${c.yellow}» ${PROMPT}${c.reset}`);

  const { status: s2, json: reply } = await api(
    "POST",
    `/session/${sess.id}/message`,
    { parts: [{ type: "text", text: PROMPT }] },
    AbortSignal.timeout(120_000),
  );
  if (s2 !== 200) {
    throw new Error(`POST /session/{id}/message gagal (${s2}): ${JSON.stringify(reply)}`);
  }

  const replyObj = reply as {
    info?: { id?: string; role?: string; time?: { create?: number } };
    parts?: Array<{ type: string; text?: string; [k: string]: unknown }>;
  };
  section("6. Balasan (JSON terstruktur)");
  const info = replyObj.info ?? {};
  console.log(
    `${c.dim}message id=${info.id}  role=${info.role}  jumlah parts=${replyObj.parts?.length}${c.reset}`,
  );
  const textParts = (replyObj.parts ?? [])
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .filter(Boolean);
  const toolParts = (replyObj.parts ?? []).filter((p) => p.type !== "text");
  for (const t of textParts) {
    console.log(`\n${c.green}${t}${c.reset}`);
  }
  if (toolParts.length > 0) {
    console.log(`\n${c.yellow}${toolParts.length} part non-teks (tool/step):${c.reset}`);
    for (const p of toolParts.slice(0, 3)) {
      console.log(`${c.dim}  - ${p.type}: ${JSON.stringify(p).slice(0, 200)}${c.reset}`);
    }
  }
} catch (err) {
  console.error(`\n${c.red}✗ ${(err as Error).message}${c.reset}`);
  console.error(`${c.dim}Log server:\n${serverLog.slice(0, 1500)}${c.reset}`);
  process.exitCode = 1;
} finally {
  section("7. Cleanup");
  sseAbort.abort();
  try {
    await api("POST", "/global/dispose");
  } catch {
    /* best effort */
  }
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([server.exited, Bun.sleep(3000)]);
  }
  if (server.exitCode === null) server.kill("SIGKILL");
  console.log(`${c.green}✓ server dihentikan${c.reset}`);
  // Pastikan proses keluar walau ada handle (mis. SSE reader) yang masih terbuka.
  process.exit(process.exitCode ?? 0);
}
