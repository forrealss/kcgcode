import { describe, expect, test } from "bun:test";
import type { SessionMessage } from "@/types";
import { baseName, collectReferences, toProjectPath } from "../references";

function msg(parts: SessionMessage["parts"]): SessionMessage {
  return { id: "m1", sessionId: "s1", role: "assistant", parts, createdAt: 0 };
}

function tool(name: string, filePath: string) {
  return { type: "tool", tool: name, state: { input: { filePath } } };
}

describe("toProjectPath", () => {
  const cwd = "/home/u/proj";

  test("relatif diterima apa adanya (./ dibuang)", () => {
    expect(toProjectPath("src/App.tsx", cwd)).toBe("src/App.tsx");
    expect(toProjectPath("./src/App.tsx", cwd)).toBe("src/App.tsx");
  });

  test("absolut di dalam project -> relatif; di luar project -> null", () => {
    expect(toProjectPath("/home/u/proj/src/a.ts", cwd)).toBe("src/a.ts");
    expect(toProjectPath("/tmp/x.ts", cwd)).toBeNull();
    // Prefix mirip tapi project lain.
    expect(toProjectPath("/home/u/proj-lain/a.ts", cwd)).toBeNull();
    // Tanpa cwd, path absolut tak bisa dipastikan milik project.
    expect(toProjectPath("/home/u/proj/src/a.ts", null)).toBeNull();
  });

  test("direktori, glob, keluar project, dan kosong -> null", () => {
    expect(toProjectPath("src/", cwd)).toBeNull();
    expect(toProjectPath("src/**/*.ts", cwd)).toBeNull();
    expect(toProjectPath("../rahasia.ts", cwd)).toBeNull();
    expect(toProjectPath("   ", cwd)).toBeNull();
  });
});

describe("collectReferences", () => {
  test("hanya file yang DIBACA; write/edit/patch tidak dihitung", () => {
    const refs = collectReferences([
      msg([
        tool("read", "src/a.ts"),
        tool("write", "src/baru.ts"),
        tool("edit", "src/diubah.ts"),
        tool("patch", "src/patched.ts"),
        tool("multiedit", "src/multi.ts"),
      ]),
    ]);
    expect(refs.map((r) => r.path)).toEqual(["src/a.ts"]);
  });

  test("file yang dibaca lalu diubah tetap muncul (karena dibaca)", () => {
    const refs = collectReferences([
      msg([tool("read", "a.ts"), tool("edit", "a.ts")]),
      msg([tool("write", "hanya-ditulis.ts")]),
    ]);
    expect(refs.map((r) => r.path)).toEqual(["a.ts"]);
  });

  test("bash/grep/glob diabaikan", () => {
    const refs = collectReferences([
      msg([
        tool("read", "src/a.ts"),
        { type: "tool", tool: "bash", state: { input: { command: "ls -la" } } },
        { type: "tool", tool: "grep", state: { input: { pattern: "foo" } } },
        { type: "tool", tool: "glob", state: { input: { pattern: "src/**" } } },
      ]),
    ]);
    expect(refs.map((r) => r.path)).toEqual(["src/a.ts"]);
  });

  test("terbaru di atas & tanpa duplikat", () => {
    const refs = collectReferences([
      msg([tool("read", "a.ts"), tool("read", "b.ts"), tool("read", "c.ts")]),
    ]);
    expect(refs.map((r) => r.path)).toEqual(["c.ts", "b.ts", "a.ts"]);
  });

  test("file yang dibaca lagi naik kembali ke atas", () => {
    const refs = collectReferences([
      msg([tool("read", "a.ts"), tool("read", "b.ts")]),
      msg([tool("read", "a.ts")]),
    ]);
    expect(refs.map((r) => r.path)).toEqual(["a.ts", "b.ts"]);
  });

  test("urutan terbaru berlaku lintas pesan", () => {
    const refs = collectReferences([
      msg([tool("read", "lama.ts")]),
      msg([tool("read", "tengah.ts")]),
      msg([tool("read", "baru.ts")]),
    ]);
    expect(refs[0]?.path).toBe("baru.ts");
  });

  test("echo @file ikut (dibaca); lampiran upload tidak", () => {
    const refs = collectReferences([
      msg([
        { type: "file", filename: "docs/spec.md" },
        { type: "file", filename: "foto.png", attachmentId: "abc", mime: "image/png" },
      ]),
    ]);
    expect(refs).toEqual([{ path: "docs/spec.md" }]);
  });

  test("path absolut tool dinormalkan dengan cwd", () => {
    const refs = collectReferences([msg([tool("read", "/home/u/proj/src/a.ts")])], "/home/u/proj");
    expect(refs).toEqual([{ path: "src/a.ts" }]);
  });

  test("tanpa pesan / tanpa pembacaan file -> kosong", () => {
    expect(collectReferences([])).toEqual([]);
    expect(collectReferences([msg([{ type: "text", text: "halo" }])])).toEqual([]);
    expect(collectReferences([msg([tool("write", "x.ts")])])).toEqual([]);
  });
});

test("baseName mengambil nama file terakhir", () => {
  expect(baseName("src/components/App.tsx")).toBe("App.tsx");
  expect(baseName("README.md")).toBe("README.md");
});
