/**
 * Unit test Skills_Registry (skills.sh + CLI `skills`) — fetch & spawn di-mock,
 * tanpa jaringan maupun proses nyata.
 */
import { describe, expect, test } from "bun:test";
import {
  buildInstallArgs,
  cleanOutputLine,
  createSkillsRegistry,
  defaultSpawn,
  installEnv,
  isValidSkillId,
  isValidSource,
  normalizeQuery,
  parseAuditResponse,
  parseInstallOutput,
  parseSearchResponse,
  SKILLS_CLI_VERSION,
  type SpawnFn,
} from "../skills-registry";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Fetch mock yang mencatat URL dan membalas lewat `handler`. */
function mockFetch(handler: (url: string) => Response) {
  const urls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { fn, urls };
}

describe("validasi", () => {
  test("source GitHub owner/repo & domain well-known diterima", () => {
    expect(isValidSource("vercel-labs/agent-skills")).toBe(true);
    expect(isValidSource("anthropics/skills")).toBe(true);
    expect(isValidSource("mintlify.com")).toBe(true);
  });

  test("source berbahaya / tak valid ditolak", () => {
    for (const bad of [
      "",
      "owner",
      "owner/repo/extra",
      "../etc/passwd",
      "owner/..",
      "-rf/repo",
      "owner/repo;rm -rf /",
      "owner/repo --global",
      "https://github.com/a/b",
      "owner/re po",
    ]) {
      expect(isValidSource(bad)).toBe(false);
    }
  });

  test("skillId aman diterima; opsi CLI / traversal ditolak", () => {
    expect(isValidSkillId("find-skills")).toBe(true);
    expect(isValidSkillId("vercel_react.v2")).toBe(true);
    for (const bad of ["", "-g", "--global", ".hidden", "a/b", "a..b", "a b", "*"]) {
      expect(isValidSkillId(bad)).toBe(false);
    }
  });

  test("normalizeQuery: trim, rapatkan spasi, batas 2-100 karakter", () => {
    expect(normalizeQuery("  react   native ")).toBe("react native");
    expect(normalizeQuery("a")).toBeNull();
    expect(normalizeQuery("   ")).toBeNull();
    expect(normalizeQuery("x".repeat(101))).toBeNull();
  });
});

describe("parsing", () => {
  test("parseSearchResponse: map, buang tak valid & duplikat, urut installs", () => {
    const out = parseSearchResponse({
      skills: [
        { id: "a/b/low", source: "a/b", skillId: "low", name: "Low", installs: 5 },
        { id: "a/b/high", source: "a/b", skillId: "high", name: "High", installs: 900 },
        { id: "a/b/high", source: "a/b", skillId: "high", name: "High", installs: 900 },
        { source: "bad source", skillId: "x", installs: 1 },
        { source: "a/b", skillId: "--global", installs: 1 },
        { source: "a/b", skillId: "noname", installs: -3 },
        "junk",
      ],
    });
    expect(out.map((s) => s.skillId)).toEqual(["high", "low", "noname"]);
    expect(out[0]).toEqual({
      id: "a/b/high",
      name: "High",
      source: "a/b",
      skillId: "high",
      installs: 900,
      url: "https://skills.sh/a/b/high",
    });
    expect(out[2]?.name).toBe("noname");
    expect(out[2]?.installs).toBe(0);
    expect(parseSearchResponse(null)).toEqual([]);
    expect(parseSearchResponse({ skills: "nope" })).toEqual([]);
  });

  test("parseAuditResponse: overall = status terburuk; status asing -> warn", () => {
    const res = parseAuditResponse({
      audits: [
        { provider: "Socket", status: "pass", summary: "No alerts" },
        { provider: "Snyk", status: "warn", summary: "Med", riskLevel: "MEDIUM" },
        { provider: "Odd", status: "weird" },
        { status: "fail" },
      ],
    });
    expect(res.overall).toBe("warn");
    expect(res.audits?.map((a) => [a.provider, a.status])).toEqual([
      ["Socket", "pass"],
      ["Snyk", "warn"],
      ["Odd", "warn"],
    ]);
    expect(
      parseAuditResponse({
        audits: [
          { provider: "X", status: "fail" },
          { provider: "Y", status: "pass" },
        ],
      }).overall,
    ).toBe("fail");
    expect(parseAuditResponse({ audits: [] })).toEqual({ audits: null, overall: null });
  });

  test("buildInstallArgs: array argumen dengan versi CLI terpin", () => {
    expect(buildInstallArgs("a/b", "c")).toEqual([
      "bunx",
      `skills@${SKILLS_CLI_VERSION}`,
      "add",
      "a/b",
      "--skill",
      "c",
      "--agent",
      "opencode",
      "-y",
      "--json",
    ]);
  });

  test("parseInstallOutput: JSON setelah teks lain; status harus installed/updated", () => {
    const ok = parseInstallOutput(
      'log line\n[{"name":"c","status":"installed","path":"/p/.agents/skills/c"}]',
      "c",
    );
    expect(ok).toEqual({ ok: true, data: { name: "c", path: "/p/.agents/skills/c" } });
    expect(parseInstallOutput("no json", "c").ok).toBe(false);
    expect(parseInstallOutput("[not json", "c").ok).toBe(false);
    expect(parseInstallOutput('[{"name":"c","status":"failed"}]', "c").ok).toBe(false);
    expect(parseInstallOutput("[]", "c").ok).toBe(false);
  });
});

describe("cleanOutputLine", () => {
  test("buang ANSI, OSC, dan karakter kontrol; trim kanan", () => {
    expect(cleanOutputLine("\u001b[1;32mok\u001b[0m  ")).toBe("ok");
    expect(cleanOutputLine("\u001b]8;;https://x\u0007link\u001b]8;;\u0007")).toBe("link");
    expect(cleanOutputLine("a\u0008b\tc")).toBe("ab\tc");
    expect(cleanOutputLine("\u001b[?25l◇  Done")).toBe("◇  Done");
  });
});

describe("createSkillsRegistry", () => {
  test("search memanggil /api/search, hasil di-cache 60 detik", async () => {
    let t = 0;
    const f = mockFetch(() =>
      jsonResponse({ skills: [{ source: "a/b", skillId: "c", name: "c", installs: 1 }] }),
    );
    const reg = createSkillsRegistry({ fetch: f.fn, now: () => t });

    const r1 = await reg.search(" React ");
    expect(r1.ok && r1.data[0]?.id).toBe("a/b/c");
    expect(f.urls[0]).toBe("https://skills.sh/api/search?q=React&limit=50");

    await reg.search("react");
    expect(f.urls).toHaveLength(1);

    t = 61_000;
    await reg.search("react");
    expect(f.urls).toHaveLength(2);
  });

  test("search: query pendek ditolak tanpa fetch; 429 & error dipetakan", async () => {
    const f = mockFetch(() => jsonResponse({ error: "x" }, 429));
    const reg = createSkillsRegistry({ fetch: f.fn });
    expect(await reg.search("a")).toEqual({ ok: false, error: "INVALID_SKILL_QUERY" });
    expect(f.urls).toHaveLength(0);
    expect(await reg.search("react")).toEqual({ ok: false, error: "SKILLS_RATE_LIMITED" });

    const broken = createSkillsRegistry({
      fetch: (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    });
    const res = await broken.search("react");
    expect(!res.ok && res.error.startsWith("SKILLS_SEARCH_FAILED")).toBe(true);
  });

  test("audit: URL v1, 404 -> tanpa audit, id tak valid ditolak", async () => {
    const f = mockFetch((url) =>
      url.endsWith("/none")
        ? jsonResponse({ error: "not_found" }, 404)
        : jsonResponse({ audits: [{ provider: "Socket", status: "pass", summary: "ok" }] }),
    );
    const reg = createSkillsRegistry({ fetch: f.fn });

    const ok = await reg.audit("a/b", "c");
    expect(ok.ok && ok.data.overall).toBe("pass");
    expect(f.urls[0]).toBe("https://skills.sh/api/v1/skills/audit/a/b/c");

    const none = await reg.audit("a/b", "none");
    expect(none).toEqual({ ok: true, data: { audits: null, overall: null } });

    expect(await reg.audit("../x", "c")).toEqual({ ok: false, error: "INVALID_SKILL_ID" });
    expect(f.urls).toHaveLength(2);
  });

  test("install: spawn di direktori Project dengan argumen tervalidasi", async () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const spawn: SpawnFn = async (args, cwd) => {
      calls.push({ args, cwd });
      return {
        exitCode: 0,
        stdout: '[{"name":"c","status":"installed","path":"/proj/.agents/skills/c"}]',
        stderr: "",
      };
    };
    const reg = createSkillsRegistry({ spawn });
    const res = await reg.install("/proj", "a/b", "c");
    expect(res).toEqual({ ok: true, data: { name: "c", path: "/proj/.agents/skills/c" } });
    expect(calls).toEqual([{ args: buildInstallArgs("a/b", "c"), cwd: "/proj" }]);

    expect(await reg.install("/proj", "a/b", "--global")).toEqual({
      ok: false,
      error: "INVALID_SKILL_ID",
    });
    expect(calls).toHaveLength(1);
  });

  test("install: onLine menerima perintah + output CLI yang sudah dibersihkan", async () => {
    const spawn: SpawnFn = async (_args, _cwd, _t, onLine) => {
      onLine?.("\u001b[32m◇  Installed\u001b[0m");
      onLine?.("");
      onLine?.("");
      onLine?.("done");
      return { exitCode: 0, stdout: '[{"name":"c","status":"installed"}]', stderr: "" };
    };
    const lines: string[] = [];
    const reg = createSkillsRegistry({ spawn });
    await reg.install("/proj", "a/b", "c", (l) => lines.push(l));
    expect(lines).toEqual([
      `$ ${buildInstallArgs("a/b", "c").join(" ")}`,
      "◇  Installed",
      "",
      "done",
    ]);
  });

  test("install: exit != 0 -> gagal; instalasi paralel di Project sama ditolak", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let exitCode = 0;
    const spawn: SpawnFn = async () => {
      await gate;
      return { exitCode, stdout: '[{"name":"c","status":"installed"}]', stderr: "boom" };
    };
    const reg = createSkillsRegistry({ spawn });

    const first = reg.install("/proj", "a/b", "c");
    expect(await reg.install("/proj", "a/b", "d")).toEqual({
      ok: false,
      error: "SKILL_INSTALL_IN_PROGRESS",
    });
    release();
    expect((await first).ok).toBe(true);

    exitCode = 1;
    expect(await reg.install("/proj", "a/b", "c")).toEqual({
      ok: false,
      error: "SKILL_INSTALL_FAILED",
    });
  });

  test("install: signal dibatalkan -> SKILL_INSTALL_CANCELLED; exit null -> TIMEOUT", async () => {
    const lines: string[] = [];
    const ctrl = new AbortController();
    const spawnAbort: SpawnFn = async (_a, _c, _t, _l, signal) => {
      ctrl.abort();
      expect(signal?.aborted).toBe(true);
      return { exitCode: null, stdout: "", stderr: "" };
    };
    const reg = createSkillsRegistry({ spawn: spawnAbort });
    expect(await reg.install("/p", "a/b", "c", (l) => lines.push(l), ctrl.signal)).toEqual({
      ok: false,
      error: "SKILL_INSTALL_CANCELLED",
    });
    expect(lines.at(-1)).toBe("Cancelled.");

    const spawnTimeout: SpawnFn = async () => ({ exitCode: null, stdout: "", stderr: "" });
    const reg2 = createSkillsRegistry({ spawn: spawnTimeout });
    expect(await reg2.install("/p", "a/b", "c")).toEqual({
      ok: false,
      error: "SKILL_INSTALL_TIMEOUT",
    });
  });
});

describe("installEnv", () => {
  test("mematikan telemetry & prompt git; env lain dipertahankan", () => {
    const env = installEnv({ PATH: "/bin", HOME: "/h", DROP: undefined });
    expect(env.PATH).toBe("/bin");
    expect(env.HOME).toBe("/h");
    expect("DROP" in env).toBe(false);
    expect(env.DISABLE_TELEMETRY).toBe("1");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_HTTP_LOW_SPEED_TIME).toBe("30");
  });
});

describe("defaultSpawn (proses nyata)", () => {
  // Regresi: proses cucu (git) yang memegang pipe membuat instalasi menggantung
  // walau proses langsung sudah dibunuh. Kill process group harus mengakhirinya.
  const hang = ["sh", "-c", "sh -c 'sleep 30' & echo started >&2; wait"];

  test("pembatalan membunuh seluruh process group, termasuk cucu", async () => {
    const ctrl = new AbortController();
    const lines: string[] = [];
    const t0 = Date.now();
    setTimeout(() => ctrl.abort(), 200);
    const res = await defaultSpawn(hang, "/tmp", 60_000, (l) => lines.push(l), ctrl.signal);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(res.exitCode).toBeNull();
    expect(lines).toContain("started");
  });

  test("timeout membunuh seluruh process group", async () => {
    const t0 = Date.now();
    const res = await defaultSpawn(hang, "/tmp", 300);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(res.exitCode).toBeNull();
  });

  test("proses normal: exit code & stdout diteruskan", async () => {
    const res = await defaultSpawn(["sh", "-c", "echo out; echo err >&2; exit 3"], "/tmp", 5_000);
    expect(res.exitCode).toBe(3);
    expect(res.stdout).toBe("out\n");
    expect(res.stderr).toBe("err\n");
  });
});
