/**
 * Theme terminal untuk dashboard kcgcode.
 * Palet selaras dark mode app — cyan/violet accent.
 */
import pc from "picocolors";

const useColor = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
const paint = (fn: (s: string) => string) => (useColor ? fn : (s: string) => s);

export const c = {
  bold: paint(pc.bold),
  dim: paint(pc.dim),
  cyan: paint(pc.cyan),
  cyanBright: paint((s) => pc.bold(pc.cyan(s))),
  violet: paint(pc.magenta),
  violetBright: paint((s) => pc.bold(pc.magenta(s))),
  green: paint(pc.green),
  greenBright: paint((s) => pc.bold(pc.green(s))),
  yellow: paint(pc.yellow),
  yellowBright: paint((s) => pc.bold(pc.yellow(s))),
  red: paint(pc.red),
  redBright: paint((s) => pc.bold(pc.red(s))),
  white: paint(pc.white),
  gray: paint(pc.gray),
  underline: paint(pc.underline),
};

export const symbols = {
  bullet: "●",
  idle: "○",
  arrow: "→",
  check: "✓",
  cross: "✗",
  warn: "!",
  boxH: "─",
  boxV: "│",
  boxTL: "┌",
  boxTR: "┐",
  boxBL: "└",
  boxBR: "┘",
} as const;

/** Versi paket dari package.json. */
export async function readPackageVersion(): Promise<string> {
  try {
    const file = Bun.file(new URL("../../package.json", import.meta.url));
    if (!(await file.exists())) return "0.1.0";
    const json = (await file.json()) as { version?: string };
    return json.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

/** Banner ASCII "KCG". */
export function logoLines(): string[] {
  return [
    "██╗  ██╗ ██████╗ ",
    "██║ ██╔╝██╔════╝ ",
    "█████╔╝ ██║      ",
    "██╔═██╗ ██║      ",
    "██║  ██╗╚██████╗ ",
    "╚═╝  ╚═╝ ╚═════╝ ",
  ];
}

export function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI SGR
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Render panel berborder. Lebar menyesuaikan isi. */
export function panel(title: string | null, lines: string[], minWidth = 48): string {
  const contentW = Math.max(
    title ? title.length + 2 : 0,
    ...lines.map((l) => stripAnsi(l).length),
    minWidth - 4,
  );
  const inner = Math.max(20, contentW + 2);
  const out: string[] = [];
  const titleText = title ? ` ${title} ` : "";
  const pad = Math.max(0, inner - titleText.length);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  out.push(
    `${c.cyan(symbols.boxTL)}${c.cyan(symbols.boxH.repeat(left) + titleText + symbols.boxH.repeat(right))}${c.cyan(symbols.boxTR)}`,
  );
  for (const line of lines) {
    const visible = stripAnsi(line).length;
    const spaces = Math.max(0, inner - visible - 2);
    out.push(`${c.cyan(symbols.boxV)} ${line}${" ".repeat(spaces)} ${c.cyan(symbols.boxV)}`);
  }
  out.push(`${c.cyan(symbols.boxBL)}${c.cyan(symbols.boxH.repeat(inner))}${c.cyan(symbols.boxBR)}`);
  return out.join("\n");
}

/** Baris label + value. */
export function row(label: string, value: string, labelWidth = 12): string {
  return `${c.dim(label.padEnd(labelWidth))}${value}`;
}
