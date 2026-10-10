/**
 * Settings -> Workspace — render statis.
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceView } from "../WorkspaceGroup";

const ready = {
  phase: "ready" as const,
  workspace: {
    root: "/home/me/code",
    display: "~/code",
    projectCount: 3,
    configPath: "/home/me/.kcgcode/config.json",
  },
};

test("menampilkan folder aktif (dengan ~), jumlah project, dan lokasi config", () => {
  const out = renderToStaticMarkup(<WorkspaceView state={ready} onChange={() => {}} />);
  expect(out).toContain("Workspace folder");
  expect(out).toContain("~/code");
  expect(out).toContain('title="/home/me/code"');
  expect(out).toContain("3 projects");
  expect(out).toContain("Change folder");
  expect(out).toContain("/home/me/.kcgcode/config.json");
  expect(out).toContain("can&#x27;t open anything outside it");
});

test("satu project -> bentuk tunggal; tombol salin berlabel", () => {
  const out = renderToStaticMarkup(
    <WorkspaceView
      state={{ ...ready, workspace: { ...ready.workspace, projectCount: 1 } }}
      onChange={() => {}}
    />,
  );
  expect(out).toContain(">1 project<");
  expect(out).toContain('aria-label="Copy full path"');
});

test("loading & error", () => {
  expect(
    renderToStaticMarkup(<WorkspaceView state={{ phase: "loading" }} onChange={() => {}} />),
  ).toContain('role="status"');
  expect(
    renderToStaticMarkup(
      <WorkspaceView state={{ phase: "error", message: "Nope" }} onChange={() => {}} />,
    ),
  ).toContain('role="alert"');
});
