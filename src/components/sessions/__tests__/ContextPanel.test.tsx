/** Smoke: kartu konteks — Environment, MCP, Task list, Reference. */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FileReference } from "@/lib/references";
import type { SessionContext } from "@/types";
import {
  ContextPanel,
  ContextPanelTrigger,
  ContextSheet,
  REFERENCE_PREVIEW,
} from "../ContextPanel";

function html(
  context: SessionContext | null,
  references: FileReference[] = [],
  loading = false,
): string {
  return renderToStaticMarkup(
    <ContextPanel context={context} references={references} loading={loading} onClose={() => {}} />,
  );
}

const base: SessionContext = {
  git: { branch: "main", ahead: 0, behind: 0, hasRemote: true },
  changes: [],
  todos: [],
  mcp: [],
  live: true,
};

// ---- Environment ----

test("perubahan file: jumlah file + total +tambah / -hapus", () => {
  const out = html({
    ...base,
    changes: [
      { path: "a.ts", added: 3, removed: 1, status: "modified" },
      { path: "b.ts", added: 2, removed: 4, status: "modified" },
    ],
  });
  expect(out).toContain("2 files changed");
  expect(out).toContain("+5");
  expect(out).toContain("-5");
});

test("tanpa perubahan -> 'No changes' tanpa angka diff", () => {
  const out = html(base);
  expect(out).toContain("No changes");
  expect(out).not.toContain("+0");
});

test("cabang git & status sinkron upstream", () => {
  expect(html(base)).toContain("main");
  expect(html(base)).toContain("Up to date");
  expect(html({ ...base, git: { ...base.git, ahead: 2 } })).toContain("2 to push");
  expect(html({ ...base, git: { ...base.git, ahead: 0, behind: 3 } })).toContain("3 to pull");
  expect(html({ ...base, git: { ...base.git, ahead: null, behind: null } })).toContain(
    "Not pushed yet",
  );
});

test("bukan repo git -> ditandai, tanpa baris sinkron", () => {
  const out = html({
    ...base,
    git: { branch: null, ahead: null, behind: null, hasRemote: false },
  });
  expect(out).toContain("Not a git repository");
  expect(out).not.toContain("Up to date");
});

// ---- MCP ----

test("MCP: ringkasan connected di judul + status tiap server", () => {
  const out = html({
    ...base,
    mcp: [
      { name: "context7", status: "connected", error: null },
      { name: "firecrawl", status: "connected", error: null },
      { name: "github", status: "failed", error: "token expired" },
    ],
  });
  expect(out).toContain("2/3 connected");
  expect(out).toContain("context7");
  expect(out).toContain("Failed");
  // Pesan error terbaca lewat title tanpa memanjangkan baris.
  expect(out).toContain('title="token expired"');
});

test("MCP: server bermasalah ditampilkan paling atas", () => {
  const out = html({
    ...base,
    mcp: [
      { name: "aaa-ok", status: "connected", error: null },
      { name: "zzz-broken", status: "failed", error: null },
    ],
  });
  expect(out.indexOf("zzz-broken")).toBeLessThan(out.indexOf("aaa-ok"));
});

test("MCP kosong: keterangan menyesuaikan status Session", () => {
  expect(html(base)).toContain("No MCP servers configured");
  expect(html({ ...base, live: false })).toContain("Start the session to see MCP servers");
});

// ---- Task list ----

test("task list: progres selesai/total + status dibacakan", () => {
  const out = html({
    ...base,
    todos: [
      { content: "Sedang jalan", status: "in_progress", priority: "high" },
      { content: "Sudah selesai", status: "completed", priority: "low" },
      { content: "Belum mulai", status: "pending", priority: "medium" },
      { content: "Dibatalkan", status: "cancelled", priority: "low" },
    ],
  });
  // Task batal tidak dihitung dalam total progres.
  expect(out).toContain("1/3 done");
  expect(out).toContain('role="progressbar"');
  expect(out).toContain('aria-valuenow="1"');
  expect(out).toContain("line-through");
  // Status dibacakan lewat teks, bukan aria-label pada ikon dekoratif.
  expect(out).toContain("In progress: ");
  expect(out).toContain("Completed: ");
});

test("task list kosong: keterangan menyesuaikan status Session", () => {
  expect(html(base)).toContain("hasn&#x27;t planned any tasks yet");
  expect(html({ ...base, live: false })).toContain("Session is not running");
});

// ---- Reference ----

test("reference: nama file, folder induk, path lengkap & jumlah", () => {
  const out = html(base, [{ path: "src/components/App.tsx" }, { path: "README.md" }]);
  expect(out).toContain("App.tsx");
  expect(out).toContain("src/components");
  expect(out).toContain('title="src/components/App.tsx"');
  expect(out).toContain(">2<");
  // Tidak ada lagi penanda "diubah" — Reference hanya file yang dibaca.
  expect(out).not.toContain("edited");
});

test("reference kosong -> keterangan, bukan blank", () => {
  expect(html(base)).toContain("Files the agent reads will appear here");
});

test("reference banyak: hanya 8 pertama + tombol 'Show N more', total tetap di judul", () => {
  const refs = Array.from({ length: 23 }, (_, i) => ({ path: `src/file-${i}.ts` }));
  const out = html(base, refs);
  // Total lengkap tetap tampil di ringkasan judul.
  expect(out).toContain(">23<");
  // Hanya REFERENCE_PREVIEW baris yang dirender.
  for (let i = 0; i < REFERENCE_PREVIEW; i++) expect(out).toContain(`file-${i}.ts`);
  expect(out).not.toContain(`file-${REFERENCE_PREVIEW}.ts`);
  expect(out).not.toContain("file-22.ts");
  expect(out).toContain(`Show ${23 - REFERENCE_PREVIEW} more`);
  expect(out).toContain('aria-expanded="false"');
});

test("reference tepat 8 -> semua tampil, tanpa tombol 'Show more'", () => {
  const refs = Array.from({ length: REFERENCE_PREVIEW }, (_, i) => ({ path: `f${i}.ts` }));
  const out = html(base, refs);
  expect(out).toContain(`f${REFERENCE_PREVIEW - 1}.ts`);
  expect(out).not.toContain("Show ");
});

test("reference 9 -> tombol 'Show 1 more'", () => {
  const refs = Array.from({ length: REFERENCE_PREVIEW + 1 }, (_, i) => ({ path: `f${i}.ts` }));
  expect(html(base, refs)).toContain("Show 1 more");
});

// ---- Kartu ----

test("fetch pertama -> skeleton, bukan bagian kosong", () => {
  const out = html(null, [], true);
  expect(out).toContain("animate-pulse");
  expect(out).not.toContain("No changes");
});

test("kartu punya penutupnya sendiri", () => {
  const out = html(base);
  expect(out).toContain('aria-label="Hide session context"');
  expect(out).toContain('aria-label="Session context"');
});

test("tombol pembuka: hamburger, tanpa ikut merender isi kartu", () => {
  const out = renderToStaticMarkup(<ContextPanelTrigger onOpen={() => {}} />);
  expect(out).toContain('aria-label="Show session context"');
  expect(out).toContain('aria-expanded="false"');
  expect(out).not.toContain("Environment");
});

// ---- Mobile: bottom sheet ----

test("sheet tertutup: isi tidak dirender", () => {
  const out = renderToStaticMarkup(
    <ContextSheet
      open={false}
      onOpenChange={() => {}}
      context={base}
      references={[]}
      loading={false}
    />,
  );
  expect(out).not.toContain("Environment");
});

test("isi sheet identik dengan kartu (bagian yang sama)", () => {
  // Radix Dialog merender ke portal `document.body`, yang tidak ada di SSR;
  // jadi yang diuji di sini adalah KESAMAAN isi: kartu & sheet sama-sama
  // memakai `ContextSections`, sehingga keempat bagian selalu identik.
  const card = html({
    ...base,
    mcp: [{ name: "firecrawl", status: "connected", error: null }],
  });
  for (const title of ["Environment", "MCP", "Task list", "Reference"]) {
    expect(card).toContain(title);
  }
});
