import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SelfUpdateStatus } from "@/types";
import { SelfUpdateView, type SelfUpdateViewProps } from "../SelfUpdatePanel";

const UPDATE = { current: "0.9.0", latest: "0.10.0", command: "bun i -g kcg-code@latest" };

function status(over: Partial<SelfUpdateStatus> = {}): SelfUpdateStatus {
  return {
    phase: "idle",
    step: null,
    progress: 0,
    target: null,
    error: null,
    logOffset: 0,
    unsupported: null,
    restart: "auto",
    runningSessions: [],
    ...over,
  };
}

function render(over: Partial<SelfUpdateViewProps> = {}): string {
  return renderToStaticMarkup(
    <SelfUpdateView
      update={UPDATE}
      status={status()}
      logs={[]}
      starting={false}
      waiting={null}
      onUpdate={() => {}}
      {...over}
    />,
  );
}

describe("SelfUpdateView", () => {
  test("tidak bisa dipasang dari app / belum dimuat -> perintah manual", () => {
    for (const s of [null, status({ unsupported: "NOT_BUN_GLOBAL" })]) {
      const out = render({ status: s });
      expect(out).toContain("Update available: v0.10.0");
      expect(out).toContain("bun i -g kcg-code@latest");
      expect(out).not.toContain("Update now");
    }
  });

  test("idle -> tombol Update now; teks restart otomatis vs manual", () => {
    const auto = render();
    expect(auto).toContain("Update now");
    expect(auto).toContain("restarts by itself");
    expect(auto).not.toContain("still running");

    const manual = render({ status: status({ restart: "manual" }) });
    expect(manual).toContain("then restart kcgcode");
  });

  test("ada Session berjalan -> peringatan akan terhenti & harus distart lagi", () => {
    const out = render({
      status: status({
        runningSessions: [
          { id: "a", title: "Fix login" },
          { id: "b", title: null },
        ],
      }),
    });
    expect(out).toContain("2 sessions are still running");
    expect(out).toContain("Restarting KCG Code stops them");
    expect(out).toContain("start them again");
  });

  test("installing -> label tahap + persentase + progressbar", () => {
    const out = render({
      status: status({ phase: "installing", step: "downloading", progress: 20, target: "0.10.0" }),
      logs: ["$ bun add -g kcg-code@0.10.0"],
    });
    expect(out).toContain("Downloading v0.10.0…");
    expect(out).toContain("20%");
    expect(out).toContain('aria-valuenow="20"');
    expect(out).toContain("$ bun add -g kcg-code@0.10.0");
    expect(out).not.toContain("Update now");
  });

  test("restarting / menunggu server -> pesan reload otomatis; lambat -> petunjuk", () => {
    const out = render({
      status: status({ phase: "restarting", target: "0.10.0", progress: 100 }),
    });
    expect(out).toContain("Restarting KCG Code…");
    expect(out).toContain("reloads by itself");
    expect(out).not.toContain("kcgcode status");

    const slow = render({ status: status({ phase: "installing" }), waiting: { slow: true } });
    expect(slow).toContain("kcgcode status");
  });

  test("installed (manual) -> minta restart kcgcode + peringatan Session", () => {
    const out = render({
      status: status({
        phase: "installed",
        target: "0.10.0",
        restart: "manual",
        runningSessions: [{ id: "a", title: "x" }],
      }),
    });
    expect(out).toContain("v0.10.0 is");
    expect(out).toContain("installed");
    expect(out).toContain("1 session is still running");
  });

  test("failed -> pesan error + Try again", () => {
    const out = render({ status: status({ phase: "failed", error: "UPDATE_INSTALL_FAILED" }) });
    expect(out).toContain("Couldn&#x27;t install the update");
    expect(out).toContain("Try again");
  });
});
