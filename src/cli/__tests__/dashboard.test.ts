import { describe, expect, test } from "bun:test";
import {
  activeProvider,
  bestUrl,
  type DashboardInfo,
  menuItems,
  renderDashboard,
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
    expect(frame).toContain("URL");
    expect(frame).toContain("PID");
    expect(frame).toContain("Memory");
    expect(frame).toContain("Uptime");
    expect(frame).toContain("Tunnel");
    expect(frame).toContain("Open in browser");
    expect(frame).toContain("↑/↓ navigate");
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
    expect(menuItems({}).map((m) => m.id)).toEqual(["open", "copy", "qr", "detail", "quit"]);

    const frame = renderDashboard(info, "0.1.0", { showQr: true, showDetail: true, menuIndex: 2 });
    expect(frame).toContain("Running");
    expect(frame).toContain("TUNNEL DETAIL");
    expect(frame).toContain("OPEN ON PHONE");
    expect(frame).toContain("lhr");
    expect(frame).toContain("https://abc.lhr.life");
    expect(frame).toContain("Hide phone QR");
  });
});
