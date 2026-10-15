/**
 * Spawn proses CLI `skills` (I/O): pembacaan stdout/stderr per baris dan
 * pembunuhan seluruh pohon proses saat timeout/pembatalan.
 */
import { installEnv } from "./cli";
import type { SpawnFn } from "./types";

/** Baca stream teks, panggil `onLine` per baris utuh; kembalikan seluruh teks. */
async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine?: (line: string) => void,
): Promise<string> {
  const decoder = new TextDecoder();
  let all = "";
  let buf = "";
  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true });
    all += text;
    if (!onLine) continue;
    buf += text;
    // `\r` (spinner/progress yang menimpa baris) diperlakukan sebagai akhir baris.
    const parts = buf.split(/\r\n|\n|\r/);
    buf = parts.pop() ?? "";
    for (const part of parts) onLine(part);
  }
  const tail = decoder.decode();
  all += tail;
  buf += tail;
  if (onLine && buf !== "") onLine(buf);
  return all;
}

/**
 * Spawn default: `Bun.spawn` tanpa shell, di process group sendiri
 * (`detached`). Timeout & pembatalan membunuh SELURUH group — `bunx` ->
 * `node` -> `git` — karena membunuh anak langsung saja membuat cucu tetap
 * hidup memegang pipe stdout/stderr sehingga proses tak pernah "selesai".
 *
 * Windows: tanpa `detached` (DETACHED_PROCESS membuat anak tanpa console
 * sehingga cucu `node` memunculkan jendela console baru); pohon proses
 * dibunuh lewat `taskkill /T`.
 */
export const defaultSpawn: SpawnFn = async (args, cwd, timeoutMs, onLine, signal) => {
  const isWindows = process.platform === "win32";
  const proc = Bun.spawn(args, {
    windowsHide: true,
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: installEnv(process.env),
    detached: !isWindows,
  });
  let killed = false;
  const killGroup = () => {
    if (killed) return;
    killed = true;
    try {
      if (isWindows) {
        Bun.spawnSync(["taskkill", "/PID", String(proc.pid), "/T", "/F"], {
          stdout: "ignore",
          stderr: "ignore",
          windowsHide: true,
        });
        proc.kill("SIGKILL");
        return;
      }
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      // Group sudah tidak ada — cukup bunuh proses langsung (idempoten).
      proc.kill("SIGKILL");
    }
  };
  const timer = setTimeout(killGroup, timeoutMs);
  const onAbort = () => killGroup();
  if (signal?.aborted) killGroup();
  else signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readLines(proc.stdout),
      readLines(proc.stderr, onLine),
      proc.exited,
    ]);
    return { exitCode: killed ? null : exitCode, stdout, stderr };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
};
