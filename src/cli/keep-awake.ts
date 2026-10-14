/**
 * Cegah OS masuk sleep selama server kcgcode berjalan — kalau mesin tidur,
 * jaringan putus dan tunnel (kcg/lhr) ikut disconnect.
 *
 * Per platform:
 * - **linux**: `systemd-inhibit --what=sleep:idle … cat`. Child `cat` membaca
 *   stdin pipe dari proses ini, jadi bila kcgcode mati (termasuk SIGKILL)
 *   pipe tertutup, `cat` keluar, dan inhibitor otomatis dilepas.
 * - **darwin**: `caffeinate -i -s -w <pid>` — berhenti sendiri saat pid mati.
 * - **win32**: `SetThreadExecutionState` via `bun:ffi`; state dilepas OS
 *   saat proses berakhir.
 *
 * Hanya mencegah sleep otomatis (idle). Layar tetap boleh mati, dan sleep
 * karena tutup lid laptop tetap mengikuti setelan OS.
 */
import type { Subprocess } from "bun";

export interface KeepAwakeStatus {
  active: boolean;
  /** Mekanisme yang dipakai, mis. "systemd-inhibit". */
  method: string | null;
  error: string | null;
}

export interface KeepAwake {
  status(): KeepAwakeStatus;
  stop(): void;
}

const WHY = "kcgcode is serving remote sessions (keeps the tunnel online)";

/** Perintah inhibitor untuk platform child-process; null bila tak didukung. */
export function inhibitCommand(platform: NodeJS.Platform, pid: number): string[] | null {
  if (platform === "linux") {
    return [
      "systemd-inhibit",
      "--what=sleep:idle",
      "--who=kcgcode",
      `--why=${WHY}`,
      "--mode=block",
      "cat",
    ];
  }
  if (platform === "darwin") {
    return ["caffeinate", "-i", "-s", "-w", String(pid)];
  }
  return null;
}

export function disabledKeepAwake(): KeepAwake {
  return {
    status: () => ({ active: false, method: null, error: "disabled (--allow-sleep)" }),
    stop() {},
  };
}

export async function startKeepAwake(
  platform: NodeJS.Platform = process.platform,
): Promise<KeepAwake> {
  if (platform === "win32") return startWindows();

  const cmd = inhibitCommand(platform, process.pid);
  if (!cmd) {
    return {
      status: () => ({ active: false, method: null, error: `unsupported on ${platform}` }),
      stop() {},
    };
  }

  const method = cmd[0] as string;
  let state: KeepAwakeStatus = { active: true, method, error: null };
  let proc: Subprocess<"pipe", "ignore", "pipe">;
  try {
    proc = Bun.spawn(cmd, { stdin: "pipe", stdout: "ignore", stderr: "pipe", windowsHide: true });
  } catch (err) {
    const reason = (err as Error).message.includes("ENOENT")
      ? `${method} not found`
      : (err as Error).message;
    return {
      status: () => ({ active: false, method, error: reason }),
      stop() {},
    };
  }

  let stopping = false;
  void proc.exited.then(async (code) => {
    if (stopping) return;
    const stderr = (await new Response(proc.stderr).text()).trim();
    const firstLine = stderr.split("\n")[0];
    state = {
      active: false,
      method,
      error: firstLine || `${method} exited (code ${code})`,
    };
  });

  return {
    status: () => state,
    stop() {
      if (stopping) return;
      stopping = true;
      state = { active: false, method, error: null };
      try {
        proc.stdin.end();
      } catch {
        // sudah tertutup
      }
      proc.kill();
    },
  };
}

const ES_CONTINUOUS = 0x80000000;
const ES_SYSTEM_REQUIRED = 0x00000001;

async function startWindows(): Promise<KeepAwake> {
  const method = "SetThreadExecutionState";
  try {
    const { dlopen, FFIType } = await import("bun:ffi");
    const lib = dlopen("kernel32.dll", {
      SetThreadExecutionState: { args: [FFIType.u32], returns: FFIType.u32 },
    });
    const set = lib.symbols.SetThreadExecutionState;
    if (set(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) === 0) {
      lib.close();
      return {
        status: () => ({ active: false, method, error: `${method} failed` }),
        stop() {},
      };
    }
    let active = true;
    return {
      status: () => ({ active, method, error: null }),
      stop() {
        if (!active) return;
        active = false;
        set(ES_CONTINUOUS);
        lib.close();
      },
    };
  } catch (err) {
    const error = (err as Error).message;
    return {
      status: () => ({ active: false, method, error }),
      stop() {},
    };
  }
}
