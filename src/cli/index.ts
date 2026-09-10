/**
 * Router CLI kcgcode — dipanggil dari `bin/kcgcode.ts`.
 */
import { type CliArgs, helpText, parseArgs } from "./args";
import { runInit, runStart } from "./commands";
import { c, readPackageVersion, symbols } from "./theme";

export async function runCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  switch (args.command) {
    case "help":
      console.log(helpText());
      return;
    case "version": {
      const v = await readPackageVersion();
      console.log(`kcgcode ${v}`);
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
    case "start":
      await runStart(args);
      return;
  }
}

export type { CliArgs };
