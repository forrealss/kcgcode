/**
 * Menyediakan binary `frpc` (frp v0.71.0) untuk tunnel.
 *
 * Urutan: `KCG_FRPC_PATH` -> `~/.kcgcode/bin/frpc` -> `frpc` di PATH ->
 * unduh rilis resmi GitHub sesuai OS/arch, verifikasi SHA-256 (checksum
 * di-pin di sini, bukan diambil saat runtime), ekstrak, simpan ke
 * `~/.kcgcode/bin`. Arsip diekstrak dengan `tar` (array argumen, tanpa shell).
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { USER_BIN_DIR } from "../../paths";
import type { Result } from "../result";

export const FRP_VERSION = "0.71.0";

/** SHA-256 resmi dari `frp_sha256_checksums.txt` rilis v0.71.0. */
const FRP_ASSETS: Record<string, { file: string; sha256: string }> = {
  "linux-x64": {
    file: "frp_0.71.0_linux_amd64.tar.gz",
    sha256: "84f27e39f11169f7adcef8e8b70c9329de17747b1f14dad9fb95eef5682ea716",
  },
  "linux-arm64": {
    file: "frp_0.71.0_linux_arm64.tar.gz",
    sha256: "f33c293c275d8fc68c654b6fba8f10b2551d6463d09a9fc9cffb7227eae82266",
  },
  "linux-arm": {
    file: "frp_0.71.0_linux_arm.tar.gz",
    sha256: "f40a984f83e8d34a9241b0be4a9d5fbcfe513a4a5c022b84a02637ff6d36833b",
  },
  "linux-riscv64": {
    file: "frp_0.71.0_linux_riscv64.tar.gz",
    sha256: "92b48d5e4d44d2f1415fde24489d3dfff5badbd52ddf7e816467cdcaa973aa5c",
  },
  "darwin-x64": {
    file: "frp_0.71.0_darwin_amd64.tar.gz",
    sha256: "1b1b4e2f1836e21e8733f1dddaacd4ed9ae67d7dbee39046b9d7b7eda6253637",
  },
  "darwin-arm64": {
    file: "frp_0.71.0_darwin_arm64.tar.gz",
    sha256: "45be02b186860d375ed49a8941ae9569628a54bf14e67fc36b29c98c99dabcc6",
  },
  "freebsd-x64": {
    file: "frp_0.71.0_freebsd_amd64.tar.gz",
    sha256: "207c85353dd66e9ef1125a8ee60e4fd4a562f364bc584c4a5ff55e7ac7355bb8",
  },
  "win32-x64": {
    file: "frp_0.71.0_windows_amd64.zip",
    sha256: "9e5062e3e5cf07e67144a3a4acf175ef6a2486f3605dd6cf288bae34ab39819f",
  },
  "win32-arm64": {
    file: "frp_0.71.0_windows_arm64.zip",
    sha256: "b56a5c2a1a2a55d11bc27aeef6edabd39f3d194360ea66660cc27281b502cb1c",
  },
};

export function frpAssetFor(
  platform: string,
  arch: string,
): { file: string; sha256: string; url: string } | null {
  const asset = FRP_ASSETS[`${platform}-${arch}`];
  if (!asset) return null;
  return {
    ...asset,
    url: `https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${asset.file}`,
  };
}

export interface FrpcInstallerOptions {
  binDir?: string;
  fetch?: typeof fetch;
  platform?: string;
  arch?: string;
  /** Cari binary di PATH (injectable untuk test). */
  which?: (bin: string) => string | null;
  /** Test saja: ganti checksum terpin agar arsip palsu bisa dipasang. */
  sha256Override?: string;
}

export interface FrpcInstaller {
  /** Path frpc siap pakai (mengunduh bila perlu). `onLog` untuk progres. */
  ensure(onLog?: (line: string) => void): Promise<Result<string>>;
}

export function createFrpcInstaller(opts: FrpcInstallerOptions = {}): FrpcInstaller {
  const binDir = opts.binDir ?? USER_BIN_DIR;
  const doFetch = opts.fetch ?? fetch;
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const which = opts.which ?? ((b: string) => Bun.which(b));
  const exe = platform === "win32" ? "frpc.exe" : "frpc";
  let inflight: Promise<Result<string>> | null = null;

  async function download(onLog: (line: string) => void): Promise<Result<string>> {
    const asset = frpAssetFor(platform, arch);
    if (!asset) return { ok: false, error: "FRPC_UNSUPPORTED_PLATFORM" };

    onLog(`Downloading frp v${FRP_VERSION} (${asset.file})…`);
    let bytes: Uint8Array;
    try {
      const res = await doFetch(asset.url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) return { ok: false, error: "FRPC_DOWNLOAD_FAILED" };
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch {
      return { ok: false, error: "FRPC_DOWNLOAD_FAILED" };
    }

    const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    if (digest !== (opts.sha256Override ?? asset.sha256)) {
      onLog("Checksum mismatch — download discarded.");
      return { ok: false, error: "FRPC_CHECKSUM_MISMATCH" };
    }
    onLog("Checksum verified.");

    const work = mkdtempSync(path.join(tmpdir(), "kcg-frp-"));
    try {
      const archive = path.join(work, asset.file);
      await Bun.write(archive, bytes);
      const proc = Bun.spawn(["tar", "-xf", archive, "-C", work], {
        stdout: "ignore",
        stderr: "pipe",
      });
      if ((await proc.exited) !== 0) {
        onLog(`Extract failed: ${(await new Response(proc.stderr).text()).trim()}`);
        return { ok: false, error: "FRPC_DOWNLOAD_FAILED" };
      }
      const dirName = asset.file.replace(/\.(tar\.gz|zip)$/, "");
      const extracted = path.join(work, dirName, exe);
      if (!existsSync(extracted)) return { ok: false, error: "FRPC_DOWNLOAD_FAILED" };

      mkdirSync(binDir, { recursive: true });
      const target = path.join(binDir, exe);
      // /tmp is often a different filesystem (tmpfs) from ~/.kcgcode, and
      // rename() can't cross devices (EXDEV). Copy next to the target first,
      // then rename within binDir so the swap stays atomic.
      const staging = path.join(binDir, `.${exe}.${process.pid}.tmp`);
      try {
        copyFileSync(extracted, staging);
        if (platform !== "win32") chmodSync(staging, 0o755);
        renameSync(staging, target);
      } finally {
        rmSync(staging, { force: true });
      }
      onLog(`Installed frpc to ${target}`);
      return { ok: true, data: target };
    } catch (e) {
      onLog(`Install failed: ${(e as Error).message}`);
      return { ok: false, error: "FRPC_DOWNLOAD_FAILED" };
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  return {
    ensure(onLog = () => {}) {
      const override = process.env.KCG_FRPC_PATH?.trim();
      if (override) {
        return Promise.resolve(
          existsSync(override)
            ? { ok: true, data: override }
            : { ok: false, error: "FRPC_NOT_FOUND" },
        );
      }
      const local = path.join(binDir, exe);
      if (existsSync(local)) return Promise.resolve({ ok: true, data: local });
      const onPath = which("frpc");
      if (onPath) return Promise.resolve({ ok: true, data: onPath });

      inflight ??= download(onLog).finally(() => {
        inflight = null;
      });
      return inflight;
    },
  };
}
