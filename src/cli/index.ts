/**
 * Router CLI kcgcode — dipanggil dari `bin/kcgcode.ts`.
 */
import { cachedUpdate } from "../server/services/update-check";
import { type CliArgs, helpText, parseArgs } from "./args";
import { runInit, runResetLock, runStart } from "./commands";
import { runLogs, runStatus, runStop } from "./daemon";
import { c, readPackageVersion, symbols } from "./theme";
import { updateNotice } from "./update-notice";

export async function runCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  switch (args.command) {
    case "help":
      console.log(helpText());
      return;
    case "version": {
      const v = await readPackageVersion();
      console.log(`kcgcode ${v}`);
      // Dari cache cek terakhir (tanpa jaringan); stderr agar `$(kcgcode -v)` tetap bersih.
      const update = process.stderr.isTTY ? await cachedUpdate() : null;
      if (update) console.error(updateNotice(update));
      return;
    }
    case "invalid":
      console.error(`${c.redBright(symbols.cross)} ${args.error}`);
      console.error(`\n${c.dim("Run")} ${c.cyan("kcgcode --help")} ${c.dim("for usage.")}`);
      process.exit(1);
      return;
    case "init":
      runInit(args);
      return;
    case "reset-lock":
      runResetLock();
      return;
    case "start":
      await runStart(args);
      return;
    case "stop":
      await runStop();
      return;
    case "status":
      await runStatus();
      return;
    case "logs":
      await runLogs(args);
      return;
  }
}

export type { CliArgs };
