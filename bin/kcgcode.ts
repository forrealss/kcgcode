#!/usr/bin/env bun
/**
 * Entry global CLI `kcgcode` (`bun i -g kcgcode`).
 *
 * Menandai mode runtime `cli` lebih dulu agar config/db/uploads
 * resolve ke `~/.kcgcode`, bukan path lokal cwd.
 */
import { setRunMode } from "../src/runtime";

setRunMode("cli");

const { runCli } = await import("../src/cli/index");
await runCli(process.argv.slice(2));
