import { describe, expect, test } from "bun:test";
import { highlightCode, resolveLang } from "../highlight";

describe("resolveLang", () => {
  test("nama kanonis, alias, prefix language-, huruf besar", () => {
    expect(resolveLang("typescript")).toBe("typescript");
    expect(resolveLang("ts")).toBe("typescript");
    expect(resolveLang("language-tsx")).toBe("tsx");
    expect(resolveLang("Bash")).toBe("shellscript");
    expect(resolveLang("yml")).toBe("yaml");
    expect(resolveLang("Dockerfile")).toBe("docker");
  });

  test("tak dikenal / kosong -> null (teks polos)", () => {
    expect(resolveLang("brainfuck")).toBeNull();
    expect(resolveLang("")).toBeNull();
    expect(resolveLang(null)).toBeNull();
  });
});

describe("highlightCode", () => {
  test("token menyatu kembali persis jadi kode asli", async () => {
    for (const code of ["const a = 1;\nlet b = 2", "x\n", "a\n\n  b\t c\n", ""]) {
      const lines = await highlightCode(code, "typescript");
      expect(lines).not.toBeNull();
      const joined = (lines ?? []).map((l) => l.map((t) => t.content).join("")).join("\n");
      expect(joined).toBe(code);
    }
  });

  test("token membawa warna light & dark sebagai CSS variable", async () => {
    const lines = await highlightCode("const x = 1", "typescript");
    const kw = lines?.[0]?.find((t) => t.content === "const");
    expect(kw?.style["--shiki-light"]).toMatch(/^#[0-9a-f]{6,8}$/i);
    expect(kw?.style["--shiki-dark"]).toMatch(/^#[0-9a-f]{6,8}$/i);
  });

  test("bahasa lain dimuat lazy (python, bash)", async () => {
    expect(await highlightCode("def f():\n  return 1", "python")).not.toBeNull();
    expect(await highlightCode("echo $HOME | wc -l", "shellscript")).not.toBeNull();
  });
});
