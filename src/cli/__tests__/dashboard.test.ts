import { describe, expect, test } from "bun:test";
import {
  activeProvider,
  bestUrl,
  type DashboardInfo,
  menuItems,
  portInputError,
  renderDashboard,
  renderSnapshot,
  takeSnapshot,
} from "../dashboard";

function makeInfo(overrides: Partial<DashboardInfo> = {}): DashboardInfo {
  return {
    server: {
      store: {
        listProjects: () => [{ id: "p1" }],
        listSessions: () => [
          { id: "s1", status: "running", title: "active job" },
          { id: "s2", status: "idle", title: null },
        ],
      },
      tunnel: { status: () => ({ phase: "signed_out", account: null, error: null }) },
    } as unknown as DashboardInfo["server"],
    port: 3000,
    hostname: "127.0.0.1",
    ...overrides,
  };
}

describe("renderDashboard", () => {
  test("logo KCG + status simpel Running", () => {
    const frame = renderDashboard(makeInfo(), "0.1.0");
    expect(frame).toContain("kcgcode");
    expect(frame).toContain("v0.1.0");
    expect(frame).toContain("██╗");
    expect(frame).toContain("Running");
    expect(frame).toContain("Local");
    expect(frame).toContain("PID");
    expect(frame).toContain("up 0s");
    expect(frame).toContain("Tunnel");
    expect(frame).toContain("Open in browser");
    expect(frame).toContain("↑↓ move");
    expect(frame).not.toContain("CONFIG");
  });

  test("baris Awake menampilkan status keep-awake", () => {
    const on = renderDashboard(
      makeInfo({
        keepAwake: { status: () => ({ active: true, method: "systemd-inhibit", error: null }) },
      }),
      "0.1.0",
    );
    expect(on).toContain("Awake");
    expect(on).toContain("sleep blocked");

    const off = renderDashboard(
      makeInfo({
        keepAwake: {
          status: () => ({ active: false, method: null, error: "disabled (--allow-sleep)" }),
        },
      }),
      "0.1.0",
    );
    expect(off).toContain("off · disabled");
    expect(renderDashboard(makeInfo(), "0.1.0")).not.toContain("Awake");
  });

  test("stats berubah saat data store berubah (refresh in-place)", () => {
    let sessions: { id: string; status: string; title: string | null }[] = [];
    const info = makeInfo({
      server: {
        store: {
          listProjects: () => [],
          listSessions: () => sessions,
        },
        tunnel: {
          status: () => ({
            phase: "online",
            account: { url: "https://demo.example.com" },
            error: null,
          }),
        },
      } as unknown as DashboardInfo["server"],
    });

    const before = renderDashboard(info, "0.1.0");
    expect(before).toContain("Sessions");

    sessions = [{ id: "s9", status: "running", title: "fresh" }];
    const after = renderDashboard(info, "0.1.0");
    expect(after).toContain("1 running");
    expect(after).toContain("Tunnel");
    expect(after).toContain("https://demo.example.com");
    expect(after).not.toBe(before);
  });

  test("menu simpel + info provider kcg/lhr", () => {
    const info = makeInfo({
      server: {
        store: {
          listProjects: () => [],
          listSessions: () => [],
          getTunnelSettings: () => ({ provider: "lhr" }),
        },
        tunnel: {
          status: () => ({ phase: "stopped", account: null, error: null, pairing: null }),
        },
        lhr: {
          status: () => ({ phase: "online", url: "https://abc.lhr.life", error: null }),
        },
        tunnelProvider: () => "lhr" as const,
      } as unknown as DashboardInfo["server"],
    });

    expect(activeProvider(info)).toBe("lhr");
    expect(bestUrl(info)).toEqual({ label: "public (lhr)", url: "https://abc.lhr.life" });
    expect(menuItems({}).map((m) => m.id)).toEqual([
      "open",
      "copy",
      "qr",
      "detail",
      "port",
      "background",
      "quit",
    ]);

    const frame = renderDashboard(info, "0.1.0", { showQr: true, showDetail: true, menuIndex: 2 });
    expect(frame).toContain("Running");
    expect(frame).toContain("TUNNEL DETAIL");
    expect(frame).toContain("OPEN ON PHONE");
    expect(frame).toContain("lhr");
    expect(frame).toContain("https://abc.lhr.life");
    expect(frame).toContain("Hide phone QR");
  });

  test("URL publik punya baris sendiri", () => {
    const info = makeInfo({
      server: {
        store: { listProjects: () => [], listSessions: () => [] },
        tunnel: {
          status: () => ({
            phase: "online",
            account: { url: "https://me.example.com" },
            error: null,
          }),
        },
      } as unknown as DashboardInfo["server"],
    });
    const frame = renderDashboard(info, "0.1.0");
    expect(frame).toMatch(/Public\s+https:\/\/me\.example\.com/);
    expect(frame).toContain("kcg · online");
  });

  test("konfirmasi quit saat ada session running", () => {
    const frame = renderDashboard(makeInfo(), "0.1.0", { confirm: "quit" });
    expect(frame).toContain("press q again");
    expect(renderDashboard(makeInfo(), "0.1.0")).not.toContain("press q again");
  });

  test("form ganti port + catatan port fallback", () => {
    const info = makeInfo({ portNote: "3000 in use", port: 3001 });
    const frame = renderDashboard(info, "0.1.0", {
      portInput: "40",
      portError: "Enter a port number",
    });
    expect(frame).toContain("CHANGE PORT");
    expect(frame).toContain("current 3001");
    expect(frame).toContain("› 40");
    expect(frame).toContain("Enter a port number");
    expect(frame).toContain("(3000 in use)");
    expect(frame).toContain("esc cancel");
    expect(renderDashboard(makeInfo(), "0.1.0")).not.toContain("CHANGE PORT");
  });

  test("status Restarting saat ganti port", () => {
    expect(renderDashboard(makeInfo({ restarting: true }), "0.1.0")).toContain("Restarting");
  });
});

describe("portInputError", () => {
  test("validasi input port", () => {
    expect(portInputError("")).not.toBeNull();
    expect(portInputError("0")).not.toBeNull();
    expect(portInputError("70000")).not.toBeNull();
    expect(portInputError("80")).toContain("1024");
    expect(portInputError("4000")).toBeNull();
  });
});

describe("mode background (dashboard untuk daemon)", () => {
  test("menu Stop / Run in foreground / Close dashboard", () => {
    expect(menuItems({}, "background").map((m) => m.id)).toEqual([
      "open",
      "copy",
      "qr",
      "detail",
      "port",
      "foreground",
      "stop",
      "quit",
    ]);
  });

  test("render snapshot daemon", () => {
    const snap = { ...takeSnapshot(makeInfo()), mode: "background" as const, pid: 4242 };
    const frame = renderSnapshot(snap, "0.1.0");
    expect(frame).toContain("Running in background");
    expect(frame).toContain("PID 4242");
    expect(frame).toContain("Stop server");
    expect(frame).toContain("Close dashboard");
    expect(frame).toContain("server keeps running");
    expect(frame).toContain("q close");
    expect(frame).not.toContain("Run in background");

    const busy = renderSnapshot({ ...snap, restarting: true, busyLabel: "Stopping…" }, "0.1.0");
    expect(busy).toContain("Stopping…");
  });

  test("snapshot bisa diserialisasi ke daemon.json", () => {
    const snap = takeSnapshot(makeInfo(), "background");
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });
});

describe("notifikasi update", () => {
  const update = { current: "0.3.0", latest: "0.4.0", command: "bun i -g kcg-code@latest" };

  function infoWithUpdate(available: typeof update | null): DashboardInfo {
    const info = makeInfo();
    (info.server as unknown as { updates: unknown }).updates = { available: () => available };
    return info;
  }

  test("baris Update + perintah install saat versi baru tersedia", () => {
    const snap = takeSnapshot(infoWithUpdate(update));
    expect(snap.update).toEqual(update);
    const frame = renderSnapshot(snap, "0.3.0");
    expect(frame).toContain("Update");
    expect(frame).toContain("v0.4.0");
    expect(frame).toContain("bun i -g kcg-code@latest");
  });

  test("tanpa update / server tanpa pengecek -> tidak ada baris Update", () => {
    expect(renderSnapshot(takeSnapshot(infoWithUpdate(null)), "0.3.0")).not.toContain("Update");
    expect(takeSnapshot(makeInfo()).update).toBeNull();
  });

  test("daemon versi lama, paket sudah diperbarui -> ajakan restart", () => {
    const snap = { ...takeSnapshot(infoWithUpdate(update)), mode: "background" as const };
    const frame = renderSnapshot(snap, "0.4.0");
    expect(frame).toContain("restart to apply");
    expect(frame).not.toContain("bun i -g");
  });
});
