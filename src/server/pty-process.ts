/**
 * PTY_Process wrapper — `Bun.Terminal` + `Bun.spawn`.
 * Sesuai `design.md` — `pty-process.ts`.
 *
 * `spawnPty(cmd, cwd, sessionId)` membuat pseudo-terminal native Bun dan
 * memakainya sebagai `terminal` pada `Bun.spawn`. `kill()` mengirim `SIGTERM`
 * lebih dulu; `Session_Manager` menjadwalkan `SIGKILL` setelah 5 detik bila
 * proses belum keluar (Requirement 1.6). Flag `expected` pada `onExit`
 * membedakan exit yang diminta (`stopped`) dari exit tak terduga (`crashed`,
 * Requirement 1.8).
 */

/** Minimal kontrak terminal yang dipakai wrapper (agar dapat di-mock). */
export interface TerminalLike {
  write(data: string): number | undefined;
  resize(cols: number, rows: number): void;
  onData(cb: (chunk: string) => void): void;
}

/** Minimal kontrak proses yang dipakai wrapper (agar dapat di-mock). */
export interface ProcessLike {
  kill(signal?: string): void;
  onExit(cb: (code: number | null) => void): void;
}

export interface PtyHandle {
  sessionId: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: "SIGTERM" | "SIGKILL"): void;
  onData(cb: (chunk: string) => void): void;
  onExit(cb: (code: number | null, expected: boolean) => void): void;
}

/**
 * Membangun `PtyHandle` di atas abstraksi `TerminalLike` + `ProcessLike`.
 * Dipisah dari `spawnPty` agar logika wrapper dapat diuji unit dengan mock
 * (task 9.2).
 */
export function createPtyHandle(
  sessionId: string,
  terminal: TerminalLike,
  proc: ProcessLike,
): PtyHandle {
  let dataCb: ((chunk: string) => void) | null = null;
  let exitCb: ((code: number | null, expected: boolean) => void) | null = null;
  let killRequested = false;

  terminal.onData((chunk) => {
    dataCb?.(chunk);
  });
  proc.onExit((code) => {
    exitCb?.(code, killRequested);
  });

  return {
    sessionId,
    write(data: string) {
      terminal.write(data);
    },
    resize(cols: number, rows: number) {
      terminal.resize(cols, rows);
    },
    kill(signal: "SIGTERM" | "SIGKILL" = "SIGTERM") {
      killRequested = true;
      proc.kill(signal);
    },
    onData(cb) {
      dataCb = cb;
    },
    onExit(cb) {
      exitCb = cb;
    },
  };
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * Menjalankan `cmd` di dalam pseudo-terminal pada `cwd`.
 * Membutuhkan Bun >= 1.3.5 (`Bun.Terminal`).
 */
export function spawnPty(cmd: string[], cwd: string, sessionId: string): PtyHandle {
  const decoder = new TextDecoder();
  let terminalDataCb: ((chunk: string) => void) | null = null;

  const terminal = new Bun.Terminal({
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    data: (_term, data) => {
      terminalDataCb?.(decoder.decode(data));
    },
  });

  // Buffer kode exit: `onExit` milik Bun.spawn dapat terpanggil SEBELUM
  // `Bun.spawn` mengembalikan handle (dokumentasi Bun). Tanpa buffer, event
  // exit yang terjadi sebelum listener terpasang akan hilang dan status
  // Session tidak pernah berubah menjadi `crashed` (Requirement 1.8).
  let exited: number | null | undefined;
  let procExitCb: ((code: number | null) => void) | null = null;
  const proc = Bun.spawn(cmd, {
    cwd,
    terminal,
    onExit: (_sub, code) => {
      exited = code;
      procExitCb?.(code);
    },
  });

  const terminalLike: TerminalLike = {
    write: (data) => terminal.write(data),
    resize: (cols, rows) => terminal.resize(cols, rows),
    onData: (cb) => {
      terminalDataCb = cb;
    },
  };

  const processLike: ProcessLike = {
    kill: (signal) => proc.kill(signal as NodeJS.Signals),
    onExit: (cb) => {
      // Bila proses sudah keluar sebelum listener terpasang, kirim kode yang
      // di-buffer agar event tidak hilang.
      if (exited !== undefined) cb(exited);
      procExitCb = cb;
    },
  };

  const handle = createPtyHandle(sessionId, terminalLike, processLike);
  proc.unref();
  return handle;
}
