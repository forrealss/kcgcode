/**
 * Unit test helper slash command composer (src/lib/slash-commands.ts).
 */
import { describe, expect, test } from "bun:test";
import type { SlashCommandInfo } from "@/types";
import {
  activeSlashCommand,
  applySlashCommand,
  commandNames,
  filterCommands,
  leadingCommand,
} from "../slash-commands";

const cmd = (name: string, extra: Partial<SlashCommandInfo> = {}): SlashCommandInfo => ({
  name,
  description: null,
  argumentHint: null,
  ...extra,
});

const COMMANDS = [
  cmd("usage", { aliases: ["cost", "stats"], description: "Show session cost" }),
  cmd("compact", { description: "Free up context by summarizing" }),
  cmd("code-review", { aliases: ["review"] }),
  cmd("context", { description: "Show current context usage" }),
  cmd("remotion:remotion-docs", { description: "Search Remotion documentation" }),
  cmd("review-pr"),
];

describe("activeSlashCommand", () => {
  test("aktif hanya di token pertama yang diawali `/`", () => {
    expect(activeSlashCommand("/", 1)).toEqual({ query: "", end: 1 });
    expect(activeSlashCommand("/rev", 4)).toEqual({ query: "rev", end: 4 });
    expect(activeSlashCommand("/review 12", 3)).toEqual({ query: "re", end: 7 });
    // Kursor sudah melewati spasi (sedang mengetik argumen).
    expect(activeSlashCommand("/review 12", 9)).toBeNull();
    expect(activeSlashCommand("halo /review", 12)).toBeNull();
    expect(activeSlashCommand("// komentar", 2)).toBeNull();
    expect(activeSlashCommand("/x", 0)).toBeNull();
  });
});

describe("applySlashCommand", () => {
  test("ganti token pertama + satu spasi; argumen yang ada dipertahankan", () => {
    expect(applySlashCommand("/rev", "review")).toBe("/review ");
    expect(applySlashCommand("/re 12 fokus", "review")).toBe("/review 12 fokus");
    expect(applySlashCommand("/re\nbaris", "review")).toBe("/review\nbaris");
  });
});

describe("filterCommands", () => {
  const names = (q: string) => filterCommands(COMMANDS, q).map((c) => c.name);

  test("query kosong: semua, urut abjad", () => {
    expect(names("")).toEqual([
      "code-review",
      "compact",
      "context",
      "remotion:remotion-docs",
      "review-pr",
      "usage",
    ]);
  });

  test("awalan nama > awalan alias > tanpa namespace > potongan > deskripsi", () => {
    expect(names("co")).toEqual(["code-review", "compact", "context", "usage"]);
    expect(names("review")).toEqual(["review-pr", "code-review"]);
    expect(names("remotion-d")).toEqual(["remotion:remotion-docs"]);
    expect(names("summar")).toEqual(["compact"]);
    expect(names("COST")).toEqual(["usage"]);
    expect(names("zzz")).toEqual([]);
  });

  test("deskripsi hanya dicari untuk query >= 2 huruf", () => {
    expect(names("x")).toEqual(["context"]);
  });
});

describe("leadingCommand", () => {
  const known = commandNames(COMMANDS);

  test("token pertama dikenal (nama atau alias) -> disorot", () => {
    expect(leadingCommand("/review 12", known)).toBe("/review");
    expect(leadingCommand("/compact", known)).toBe("/compact");
    expect(leadingCommand("/usr/bin ada", known)).toBeNull();
    expect(leadingCommand("tanya /compact", known)).toBeNull();
  });
});
