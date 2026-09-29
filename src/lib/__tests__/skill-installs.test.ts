/**
 * Unit test store instalasi skill (src/lib/skill-installs.ts) — bagian murni.
 */
import { describe, expect, test } from "bun:test";
import type { InstallJob } from "@/server/services/skill-install-jobs";
import {
  findRunningInstall,
  hydrationEntries,
  type InstallEntry,
  mergeLog,
} from "../skill-installs";

function job(over: Partial<InstallJob> = {}): InstallJob {
  return {
    id: "j1",
    projectId: "p1",
    projectName: "Proj",
    source: "a/b",
    skillId: "c",
    status: "running",
    error: null,
    refreshed: null,
    installedPath: null,
    startedAt: 1,
    finishedAt: null,
    lastOutputAt: 1,
    lineCount: 0,
    ...over,
  };
}

function entry(over: Partial<InstallEntry> = {}): InstallEntry {
  return {
    job: job(),
    lines: [],
    next: 0,
    truncated: false,
    dismissed: false,
    expanded: true,
    pollError: null,
    cancelling: false,
    ...over,
  };
}

describe("mergeLog", () => {
  test("menambah baris baru dan memajukan kursor", () => {
    const e = mergeLog(entry(), {
      job: job({ lineCount: 2 }),
      from: 0,
      lines: ["a", "b"],
      truncated: false,
    });
    expect(e.lines).toEqual(["a", "b"]);
    expect(e.next).toBe(2);
    const e2 = mergeLog(e, { job: job({ lineCount: 3 }), from: 2, lines: ["c"], truncated: false });
    expect(e2.lines).toEqual(["a", "b", "c"]);
    expect(e2.next).toBe(3);
  });

  test("respon tumpang tindih tidak menggandakan baris", () => {
    const e = entry({ lines: ["a", "b"], next: 2 });
    const merged = mergeLog(e, { job: job(), from: 1, lines: ["b", "c"], truncated: false });
    expect(merged.lines).toEqual(["a", "b", "c"]);
    expect(merged.next).toBe(3);
  });

  test("status job diperbarui & pollError dibersihkan; truncated diteruskan", () => {
    const e = entry({ pollError: "x" });
    const merged = mergeLog(e, {
      job: job({ status: "succeeded" }),
      from: 5,
      lines: ["z"],
      truncated: true,
    });
    expect(merged.job.status).toBe("succeeded");
    expect(merged.pollError).toBeNull();
    expect(merged.truncated).toBe(true);
    expect(merged.next).toBe(6);
  });
});

describe("findRunningInstall", () => {
  test("cocokkan project + source + skill yang masih berjalan", () => {
    const list = [
      entry({ job: job({ id: "done", status: "succeeded" }) }),
      entry({ job: job({ id: "run" }) }),
    ];
    expect(findRunningInstall(list, "p1", "a/b", "c")?.job.id).toBe("run");
    expect(findRunningInstall(list, "p2", "a/b", "c")).toBeUndefined();
    expect(findRunningInstall(list, "p1", "a/b", "d")).toBeUndefined();
  });
});

describe("hydrationEntries (pulih setelah refresh)", () => {
  const running = job({ id: "run" });
  const done = job({ id: "done", status: "succeeded", finishedAt: 5 });
  const failed = job({
    id: "fail",
    status: "failed",
    error: "SKILL_INSTALL_FAILED",
    finishedAt: 6,
  });

  test("job berjalan & selesai yang belum ditutup dipulihkan, status tampilan ikut", () => {
    const out = hydrationEntries(
      [running, done, failed],
      { dismissed: [], expanded: ["done"] },
      new Set(),
    );
    expect(out.map((e) => e.job.id)).toEqual(["run", "done", "fail"]);
    expect(out.find((e) => e.job.id === "done")?.expanded).toBe(true);
    expect(out.find((e) => e.job.id === "run")?.expanded).toBe(false);
    expect(out.every((e) => e.lines.length === 0 && e.next === 0)).toBe(true);
  });

  test("job selesai yang ditutup tidak kembali; job berjalan yang disembunyikan tetap tersembunyi", () => {
    const out = hydrationEntries(
      [running, done],
      { dismissed: ["run", "done"], expanded: [] },
      new Set(),
    );
    expect(out.map((e) => [e.job.id, e.dismissed])).toEqual([["run", true]]);
  });

  test("entry yang sudah ada di store dilewati", () => {
    const out = hydrationEntries(
      [running, done],
      { dismissed: [], expanded: [] },
      new Set(["run"]),
    );
    expect(out.map((e) => e.job.id)).toEqual(["done"]);
  });
});
