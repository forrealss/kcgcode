/**
 * Unit test `pty-process.ts` (task 9.2).
 * Verifikasi `write`/`resize` diteruskan ke terminal mock, `onData` dipanggil
 * saat data masuk, dan `onExit` membedakan `expected` true/false.
 * Requirement 1.2.
 */
import { expect, test } from "bun:test";
import type { ProcessLike, TerminalLike } from "./pty-process";
import { createPtyHandle } from "./pty-process";

interface MockBundle {
  terminal: TerminalLike;
  proc: ProcessLike;
  writes: string[];
  resizes: [number, number][];
  kills: string[];
  emitData: (chunk: string) => void;
  emitExit: (code: number | null) => void;
}

function makeMocks(): MockBundle {
  const writes: string[] = [];
  const resizes: [number, number][] = [];
  const kills: string[] = [];
  let onDataCb: ((chunk: string) => void) | null = null;
  let onExitCb: ((code: number | null) => void) | null = null;

  const terminal: TerminalLike = {
    write: (data) => {
      writes.push(data);
    },
    resize: (cols, rows) => {
      resizes.push([cols, rows]);
    },
    onData: (cb) => {
      onDataCb = cb;
    },
  };

  const proc: ProcessLike = {
    kill: (signal) => {
      kills.push(signal ?? "SIGTERM");
    },
    onExit: (cb) => {
      onExitCb = cb;
    },
  };

  return {
    terminal,
    proc,
    writes,
    resizes,
    kills,
    emitData: (chunk) => onDataCb?.(chunk),
    emitExit: (code) => onExitCb?.(code),
  };
}

test("9.2: write diteruskan ke terminal", () => {
  const m = makeMocks();
  const handle = createPtyHandle("s1", m.terminal, m.proc);
  handle.write("hello\n");
  expect(m.writes).toEqual(["hello\n"]);
});

test("9.2: resize diteruskan ke terminal", () => {
  const m = makeMocks();
  const handle = createPtyHandle("s1", m.terminal, m.proc);
  handle.resize(100, 30);
  expect(m.resizes).toEqual([[100, 30]]);
});

test("9.2: onData dipanggil saat data masuk", () => {
  const m = makeMocks();
  const handle = createPtyHandle("s1", m.terminal, m.proc);
  const received: string[] = [];
  handle.onData((chunk) => received.push(chunk));
  m.emitData("chunk-1");
  m.emitData("chunk-2");
  expect(received).toEqual(["chunk-1", "chunk-2"]);
});

test("9.2: kill mengirim sinyal ke proses dan menandai exit expected", () => {
  const m = makeMocks();
  const handle = createPtyHandle("s1", m.terminal, m.proc);
  const exits: [number | null, boolean][] = [];
  handle.onExit((code, expected) => exits.push([code, expected]));

  handle.kill("SIGTERM");
  expect(m.kills).toEqual(["SIGTERM"]);
  m.emitExit(0);
  expect(exits).toEqual([[0, true]]);
});

test("9.2: exit tak terduga menghasilkan expected=false", () => {
  const m = makeMocks();
  const handle = createPtyHandle("s1", m.terminal, m.proc);
  const exits: [number | null, boolean][] = [];
  handle.onExit((code, expected) => exits.push([code, expected]));

  // Tanpa kill terlebih dahulu -> exit tidak diharapkan
  m.emitExit(1);
  expect(exits).toEqual([[1, false]]);
});

test("9.2: onExit default ke SIGTERM bila sinyal tidak diberikan", () => {
  const m = makeMocks();
  const handle = createPtyHandle("s1", m.terminal, m.proc);
  handle.kill();
  expect(m.kills).toEqual(["SIGTERM"]);
});
