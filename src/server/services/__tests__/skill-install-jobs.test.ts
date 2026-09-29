/**
 * Unit test Skill_Install_Jobs — registry & refresh di-mock.
 */
import { describe, expect, test } from "bun:test";
import type { Result } from "../../result";
import { createSkillInstallJobs, FINISHED_TTL_MS, MAX_LOG_LINES } from "../skill-install-jobs";
import type { InstallResult, SkillsRegistry } from "../skills-registry";

interface Harness {
  jobs: ReturnType<typeof createSkillInstallJobs>;
  setTime: (t: number) => void;
  release: (res: Result<InstallResult>) => void;
  emit: (line: string) => void;
  refreshCalls: string[];
}

/**
 * Registry palsu: instalasi "menggantung" sampai `release` dipanggil — atau
 * sampai signal dibatalkan (meniru proses CLI yang dibunuh).
 */
function harness(refreshed = true): Harness {
  let t = 1000;
  let emitFn: (line: string) => void = () => {};
  let releaseFn: (res: Result<InstallResult>) => void = () => {};
  const refreshCalls: string[] = [];
  const registry: SkillsRegistry = {
    search: async () => ({ ok: true, data: [] }),
    audit: async () => ({ ok: true, data: { audits: null, overall: null } }),
    install: (_path, _source, _skill, onLine, signal) =>
      new Promise((resolve) => {
        emitFn = (l) => onLine?.(l);
        releaseFn = resolve;
        signal?.addEventListener("abort", () =>
          resolve({ ok: false, error: "SKILL_INSTALL_CANCELLED" }),
        );
      }),
  };
  const jobs = createSkillInstallJobs({
    registry,
    refreshSkills: async (projectId) => {
      refreshCalls.push(projectId);
      return { ok: true, data: { refreshed } };
    },
    validate: (source, skill) => source === "a/b" && !skill.startsWith("-"),
    now: () => t,
  });
  return {
    jobs,
    setTime: (v) => {
      t = v;
    },
    release: (r) => releaseFn(r),
    emit: (l) => emitFn(l),
    refreshCalls,
  };
}

const input = {
  projectId: "p1",
  projectName: "Proj",
  projectPath: "/proj",
  source: "a/b",
  skillId: "c",
};

describe("createSkillInstallJobs", () => {
  test("job berjalan, log bertahap via from, sukses + refresh", async () => {
    const h = harness();
    const started = h.jobs.start(input);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const id = started.data.id;
    expect(started.data.status).toBe("running");

    h.emit("line 1");
    h.emit("line 2");
    const first = h.jobs.get(id, 0);
    expect(first?.lines).toEqual(["line 1", "line 2"]);
    expect(first?.job.lineCount).toBe(2);

    h.emit("line 3");
    const next = h.jobs.get(id, 2);
    expect(next?.from).toBe(2);
    expect(next?.lines).toEqual(["line 3"]);

    h.release({ ok: true, data: { name: "c", path: "/proj/.agents/skills/c" } });
    await h.jobs.settled(id);
    const done = h.jobs.get(id, 3);
    expect(done?.job.status).toBe("succeeded");
    expect(done?.job.refreshed).toBe(true);
    expect(done?.job.installedPath).toBe("/proj/.agents/skills/c");
    expect(done?.job.finishedAt).not.toBeNull();
    expect(done?.lines.at(-1)).toBe("✓ Installed c.");
    expect(h.refreshCalls).toEqual(["p1"]);
  });

  test("gagal -> status failed + kode error, tanpa refresh", async () => {
    const h = harness();
    const started = h.jobs.start(input);
    if (!started.ok) throw new Error("start gagal");
    h.release({ ok: false, error: "SKILL_INSTALL_FAILED" });
    await h.jobs.settled(started.data.id);
    const log = h.jobs.get(started.data.id);
    expect(log?.job.status).toBe("failed");
    expect(log?.job.error).toBe("SKILL_INSTALL_FAILED");
    expect(log?.lines.at(-1)).toBe("✗ Installation failed.");
    expect(h.refreshCalls).toHaveLength(0);
  });

  test("refresh dilewati (chat aktif) -> refreshed false + pesan", async () => {
    const h = harness(false);
    const started = h.jobs.start(input);
    if (!started.ok) throw new Error("start gagal");
    h.release({ ok: true, data: { name: "c", path: null } });
    await h.jobs.settled(started.data.id);
    const log = h.jobs.get(started.data.id);
    expect(log?.job.refreshed).toBe(false);
    expect(log?.lines.at(-1)).toContain("reloads skills automatically when it finishes");
  });

  test("markRefreshed: job sukses tertunda di Project itu jadi aktif + dicatat", async () => {
    const h = harness(false);
    const started = h.jobs.start(input);
    if (!started.ok) throw new Error("start gagal");
    h.release({ ok: true, data: { name: "c", path: null } });
    await h.jobs.settled(started.data.id);

    h.jobs.markRefreshed("p-lain");
    expect(h.jobs.get(started.data.id)?.job.refreshed).toBe(false);

    h.jobs.markRefreshed("p1");
    const log = h.jobs.get(started.data.id);
    expect(log?.job.refreshed).toBe(true);
    expect(log?.lines.at(-1)).toBe("✓ Chat finished — c is now active.");
    // Idempoten: tidak menambah baris lagi.
    h.jobs.markRefreshed("p1");
    expect(h.jobs.get(started.data.id)?.job.lineCount).toBe(log?.job.lineCount);
  });

  test("validasi & satu job berjalan per Project", async () => {
    const h = harness();
    expect(h.jobs.start({ ...input, skillId: "--global" })).toEqual({
      ok: false,
      error: "INVALID_SKILL_ID",
    });
    const first = h.jobs.start(input);
    expect(first.ok).toBe(true);
    expect(h.jobs.start({ ...input, skillId: "d" })).toEqual({
      ok: false,
      error: "SKILL_INSTALL_IN_PROGRESS",
    });
    // Project lain tetap boleh.
    expect(h.jobs.start({ ...input, projectId: "p2" }).ok).toBe(true);
    expect(
      h.jobs
        .list()
        .map((j) => j.projectId)
        .sort(),
    ).toEqual(["p1", "p2"]);
  });

  test("log dibatasi MAX_LOG_LINES; from lama -> truncated", () => {
    const h = harness();
    const started = h.jobs.start(input);
    if (!started.ok) throw new Error("start gagal");
    for (let i = 0; i < MAX_LOG_LINES + 10; i++) h.emit(`l${i}`);
    const log = h.jobs.get(started.data.id, 0);
    expect(log?.truncated).toBe(true);
    expect(log?.from).toBe(10);
    expect(log?.lines).toHaveLength(MAX_LOG_LINES);
    expect(log?.lines[0]).toBe("l10");
    expect(log?.job.lineCount).toBe(MAX_LOG_LINES + 10);
  });

  test("job selesai dibuang setelah TTL; id tak dikenal -> null", async () => {
    const h = harness();
    const started = h.jobs.start(input);
    if (!started.ok) throw new Error("start gagal");
    h.release({ ok: true, data: { name: "c", path: null } });
    await h.jobs.settled(started.data.id);
    expect(h.jobs.list()).toHaveLength(1);
    h.setTime(1000 + FINISHED_TTL_MS + 1);
    expect(h.jobs.list()).toHaveLength(0);
    expect(h.jobs.get(started.data.id)).toBeNull();
    expect(h.jobs.get("nope")).toBeNull();
  });

  test("cancel: job berjalan -> cancelled, tanpa refresh; kedua kali -> false", async () => {
    const h = harness();
    const started = h.jobs.start(input);
    if (!started.ok) throw new Error("start gagal");
    const id = started.data.id;
    expect(h.jobs.cancel(id)).toBe(true);
    expect(h.jobs.cancel(id)).toBe(false);
    await h.jobs.settled(id);
    const log = h.jobs.get(id);
    expect(log?.job.status).toBe("cancelled");
    expect(log?.job.error).toBe("SKILL_INSTALL_CANCELLED");
    expect(log?.lines).toContain("Cancelling…");
    expect(log?.lines.at(-1)).toBe("✗ Installation cancelled.");
    expect(h.refreshCalls).toHaveLength(0);
    // Project bebas lagi setelah dibatalkan.
    expect(h.jobs.start(input).ok).toBe(true);
    expect(h.jobs.cancel("nope")).toBe(false);
  });

  test("cancelAll: membatalkan semua job berjalan dan menunggu selesai", async () => {
    const h = harness();
    const a = h.jobs.start(input);
    const b = h.jobs.start({ ...input, projectId: "p2" });
    if (!a.ok || !b.ok) throw new Error("start gagal");
    await h.jobs.cancelAll();
    expect(h.jobs.get(a.data.id)?.job.status).toBe("cancelled");
    expect(h.jobs.get(b.data.id)?.job.status).toBe("cancelled");
  });

  test("lastOutputAt diperbarui tiap baris", () => {
    const h = harness();
    const started = h.jobs.start(input);
    if (!started.ok) throw new Error("start gagal");
    expect(started.data.lastOutputAt).toBe(1000);
    h.setTime(5000);
    h.emit("x");
    expect(h.jobs.get(started.data.id)?.job.lastOutputAt).toBe(5000);
  });
});
