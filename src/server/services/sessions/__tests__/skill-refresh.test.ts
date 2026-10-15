/**
 * Unit test refresh skill (`sessions/skill-refresh.ts`): agent yang tidak
 * bisa memuat ulang skill di tengah turn ditunda sampai seluruh turn Project
 * selesai, lalu dijalankan otomatis.
 *
 * Mocking boundary: `AgentBackend` + `AgentClient` di-mock seluruhnya
 * (`fake-agent.ts`); `bun:sqlite` asli. Harness bersama ada di `harness.ts`.
 */
import { expect, spyOn, test } from "bun:test";
import {
  clientOf,
  createSession,
  ev,
  flush,
  freshHarness,
  freshHarnessWithHooks,
  modeHarness,
} from "./harness";

test("refreshSkills: server belum hidup -> tanpa dispose; Project tak dikenal -> error", async () => {
  const h = freshHarness();
  try {
    const res = await h.sm.refreshSkills("p1");
    expect(res.ok && res.data.refreshed).toBe(true);
    expect(h.fake.clients.get("p1")).toBeUndefined();
    expect((await h.sm.refreshSkills("nope")).ok).toBe(false);
  } finally {
    h.close();
  }
});

test("refreshSkills: server idle -> dispose; ada turn aktif -> dilewati", async () => {
  const h = freshHarness();
  try {
    const sid = await createSession(h);
    const idle = await h.sm.refreshSkills("p1");
    expect(idle.ok && idle.data.refreshed).toBe(true);
    expect(clientOf(h).calls).toContain("location.reload");

    // Mulai turn (belum ada session.idle) -> refresh ditunda.
    await h.sm.sendFreeTextInput(sid, "halo");
    const before = clientOf(h).calls.filter((c) => c === "location.reload").length;
    const busy = await h.sm.refreshSkills("p1");
    expect(busy.ok && busy.data.refreshed).toBe(false);
    expect(clientOf(h).calls.filter((c) => c === "location.reload")).toHaveLength(before);
  } finally {
    h.close();
  }
});

/**
 * Harness dengan timer manual: refresh skill tertunda dijadwalkan lewat
 * `setTimeoutFn`, jadi test dapat memicu jedanya secara deterministik.
 */
function refreshHarness() {
  const timers: { cb: () => void; ms: number; cleared: boolean }[] = [];
  const refreshed: string[] = [];
  const h = freshHarnessWithHooks(
    {},
    {},
    {
      setTimeoutFn: (cb, ms) => {
        const t = { cb, ms, cleared: false };
        timers.push(t);
        return t;
      },
      clearTimeoutFn: (t) => {
        (t as { cleared: boolean }).cleared = true;
      },
      skillRefreshDelayMs: 1500,
      onSkillsRefreshed: (projectId) => refreshed.push(projectId),
    },
  );
  /** Jalankan timer refresh (jeda 1500 ms) yang masih aktif. */
  const fireRefreshTimers = async () => {
    for (const t of timers.filter((x) => x.ms === 1500 && !x.cleared)) {
      t.cleared = true;
      t.cb();
    }
    await flush();
  };
  const disposeCount = () => clientOf(h).calls.filter((c) => c === "location.reload").length;
  return { h, timers, refreshed, fireRefreshTimers, disposeCount };
}

test("refresh skill tertunda: dijalankan otomatis setelah turn selesai", async () => {
  const { h, refreshed, fireRefreshTimers, disposeCount } = refreshHarness();
  try {
    const sid = await createSession(h);
    await h.sm.sendFreeTextInput(sid, "halo");
    await flush();

    const res = await h.sm.refreshSkills("p1");
    expect(res.ok && res.data.refreshed).toBe(false);
    expect(h.sm.hasPendingSkillRefresh("p1")).toBe(true);
    expect(disposeCount()).toBe(0);

    // Turn selesai -> timer dijadwalkan, belum dispose sebelum jeda lewat.
    clientOf(h).emit(ev.idle("ses_remote1"));
    await flush();
    expect(disposeCount()).toBe(0);

    await fireRefreshTimers();
    expect(disposeCount()).toBe(1);
    expect(h.sm.hasPendingSkillRefresh("p1")).toBe(false);
    expect(refreshed).toEqual(["p1"]);

    // Turn berikutnya tidak memicu dispose lagi.
    await h.sm.sendFreeTextInput(sid, "lagi");
    await flush();
    clientOf(h).emit(ev.idle("ses_remote1"));
    await flush();
    await fireRefreshTimers();
    expect(disposeCount()).toBe(1);
  } finally {
    h.close();
  }
});

test("refresh skill tertunda: turn baru dalam jeda membatalkan timer, ditunda lagi", async () => {
  const { h, refreshed, fireRefreshTimers, disposeCount, timers } = refreshHarness();
  try {
    const sid = await createSession(h);
    await h.sm.sendFreeTextInput(sid, "satu");
    await flush();
    await h.sm.refreshSkills("p1");

    clientOf(h).emit(ev.idle("ses_remote1"));
    await flush();
    const scheduled = timers.filter((t) => t.ms === 1500);
    expect(scheduled).toHaveLength(1);

    // User langsung kirim pesan lagi sebelum jeda habis -> timer dibatalkan.
    await h.sm.sendFreeTextInput(sid, "dua");
    await flush();
    expect(scheduled[0]?.cleared).toBe(true);
    await fireRefreshTimers();
    expect(disposeCount()).toBe(0);
    expect(h.sm.hasPendingSkillRefresh("p1")).toBe(true);

    // Turn kedua selesai -> baru dispose.
    clientOf(h).emit(ev.idle("ses_remote1"));
    await flush();
    await fireRefreshTimers();
    expect(disposeCount()).toBe(1);
    expect(refreshed).toEqual(["p1"]);
  } finally {
    h.close();
  }
});

test("refresh skill tertunda: menunggu SEMUA Session di Project selesai", async () => {
  const { h, fireRefreshTimers, disposeCount } = refreshHarness();
  try {
    const a = await createSession(h);
    clientOf(h).createSessionResult = { ok: true, id: "ses_remote2" };
    const b = await createSession(h);
    await h.sm.sendFreeTextInput(a, "a");
    await h.sm.sendFreeTextInput(b, "b");
    await flush();
    await h.sm.refreshSkills("p1");

    // Session A selesai, B masih berjalan -> tidak ada dispose.
    clientOf(h).emit(ev.idle("ses_remote1"));
    await flush();
    await fireRefreshTimers();
    expect(disposeCount()).toBe(0);

    // B selesai -> dispose.
    clientOf(h).emit(ev.idle("ses_remote2"));
    await flush();
    await fireRefreshTimers();
    expect(disposeCount()).toBe(1);
  } finally {
    h.close();
  }
});

test("refresh skill tertunda: dispose gagal -> tetap tertunda, dicoba lagi turn berikutnya", async () => {
  const { h, refreshed, fireRefreshTimers, disposeCount } = refreshHarness();
  // Reload gagal dicatat sebagai peringatan (bukan error fatal).
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const sid = await createSession(h);
    await h.sm.sendFreeTextInput(sid, "x");
    await flush();
    await h.sm.refreshSkills("p1");

    const client = clientOf(h);
    const original = client.location.reload.bind(client.location);
    let fail = true;
    client.location.reload = async () => {
      client.calls.push("location.reload");
      return fail
        ? { ok: false, error: "OC_DISPOSE_FAILED(500)" }
        : original().then(() => ({ ok: true }));
    };

    client.emit(ev.idle("ses_remote1"));
    await flush();
    await fireRefreshTimers();
    expect(disposeCount()).toBe(1);
    expect(h.sm.hasPendingSkillRefresh("p1")).toBe(true);
    expect(refreshed).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "[kcg-code] refresh skill tertunda Project p1 gagal:",
      "OC_DISPOSE_FAILED(500)",
    );

    fail = false;
    await h.sm.sendFreeTextInput(sid, "y");
    await flush();
    client.emit(ev.idle("ses_remote1"));
    await flush();
    await fireRefreshTimers();
    expect(h.sm.hasPendingSkillRefresh("p1")).toBe(false);
    expect(refreshed).toEqual(["p1"]);
  } finally {
    warn.mockRestore();
    h.close();
  }
});

test("refresh skill tertunda: shutdown membersihkan timer & status tertunda", async () => {
  const { h, fireRefreshTimers } = refreshHarness();
  try {
    const sid = await createSession(h);
    await h.sm.sendFreeTextInput(sid, "x");
    await flush();
    await h.sm.refreshSkills("p1");
    // Referensi client disimpan: shutdown menghentikan server (client dilepas).
    const client = clientOf(h);
    client.emit(ev.idle("ses_remote1"));
    await flush();

    await h.sm.shutdown();
    expect(h.sm.hasPendingSkillRefresh("p1")).toBe(false);
    await fireRefreshTimers();
    expect(client.calls.filter((c) => c === "location.reload")).toHaveLength(0);
  } finally {
    h.close();
  }
});

test("refreshSkills agent tanpa penundaan (Claude Code): reload langsung walau ada turn", async () => {
  const { h, client } = modeHarness();
  try {
    const sid = await createSession(h, "claude-code");
    await h.sm.sendFreeTextInput(sid, "halo");
    const res = await h.sm.refreshSkills("p1", "claude-code");
    expect(res.ok && res.data.refreshed).toBe(true);
    expect(client().calls).toContain("location.reload");
    expect(h.sm.hasPendingSkillRefresh("p1")).toBe(false);
  } finally {
    h.close();
  }
});
