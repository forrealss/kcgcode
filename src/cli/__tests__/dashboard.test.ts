import { describe, expect, test } from "bun:test";
import { type DashboardInfo, renderDashboard } from "../dashboard";

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
  test("logo KCG + card SERVER dan ACTIVITY", () => {
    const frame = renderDashboard(makeInfo(), "0.1.0");
    expect(frame).toContain("kcgcode");
    expect(frame).toContain("v0.1.0");
    expect(frame).toContain("██╗");
    expect(frame).toContain("SERVER");
    expect(frame).toContain("ACTIVITY");
    expect(frame).toContain("active job");
    expect(frame).not.toContain("CONFIG");
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
    expect(before).toContain("sessions");

    sessions = [{ id: "s9", status: "running", title: "fresh" }];
    const after = renderDashboard(info, "0.1.0");
    expect(after).toContain("fresh");
    expect(after).toContain("TUNNEL");
    expect(after).toContain("https://demo.example.com");
    expect(after).not.toBe(before);
  });
});
