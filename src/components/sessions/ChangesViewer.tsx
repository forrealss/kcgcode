/**
 * Review hasil kerja agent dari HP: kartu "N files changed" di akhir turn,
 * lalu sheet dengan tiga tampilan bertumpuk — daftar file, diff satu file,
 * dan isi file (kode ber-highlight, Markdown ter-render, gambar).
 *
 * Viewer file juga bisa dibuka dari bagian lain (mis. daftar Reference) lewat
 * `openFileViewer(path)`; host-nya dipasang sekali per halaman Session.
 */
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  FileCodeIcon,
  FileDiffIcon,
  FileTextIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { CodeBlock } from "@/components/sessions/CodeBlock";
import { MarkdownContent } from "@/components/sessions/MarkdownContent";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { MOBILE_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { errorText } from "@/lib/api";
import { getFileDiff, getProjectFile, languageForPath, projectImageUrl } from "@/lib/changes-api";
import { onOpenFileViewer } from "@/lib/changes-events";
import { formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ProjectFileContent, TurnDiff, TurnFileChange } from "@/types";

const STATUS_STYLE: Record<TurnFileChange["status"], { letter: string; className: string }> = {
  added: { letter: "A", className: "text-emerald-600 dark:text-emerald-400" },
  modified: { letter: "M", className: "text-amber-600 dark:text-amber-400" },
  deleted: { letter: "D", className: "text-destructive" },
  renamed: { letter: "R", className: "text-sky-600 dark:text-sky-400" },
};

function totals(diff: TurnDiff): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const f of diff.files) {
    add += f.additions ?? 0;
    del += f.deletions ?? 0;
  }
  return { add, del };
}

function splitPath(p: string): { name: string; dir: string } {
  const i = p.lastIndexOf("/");
  return i === -1 ? { name: p, dir: "" } : { name: p.slice(i + 1), dir: p.slice(0, i) };
}

function Counts({ add, del }: { add: number | null; del: number | null }) {
  if (add === null && del === null)
    return <span className="text-xs text-muted-foreground">bin</span>;
  return (
    <span className="shrink-0 font-mono text-xs tabular-nums">
      <span className="text-emerald-600 dark:text-emerald-400">+{add ?? 0}</span>{" "}
      <span className="text-destructive">−{del ?? 0}</span>
    </span>
  );
}

/** Kartu di bawah turn assistant: ringkasan file yang diubah. */
export function TurnChangesCard({ diff, onOpen }: { diff: TurnDiff; onOpen: () => void }) {
  const { add, del } = totals(diff);
  const n = diff.files.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full max-w-md items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <FileDiffIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {n} {n === 1 ? "file" : "files"} changed
      </span>
      <Counts add={add} del={del} />
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

type View =
  | { kind: "list"; diff: TurnDiff }
  | { kind: "diff"; diff: TurnDiff; file: TurnFileChange }
  | { kind: "file"; path: string; back: View | null };

/**
 * Host sheet perubahan + viewer file untuk satu Session. `openDiff` dipakai
 * kartu di timeline; viewer file juga merespons `openFileViewer(path)`.
 */
export function useChangesViewer(projectId: string, sessionId: string) {
  const [view, setView] = useState<View | null>(null);
  useEffect(() => onOpenFileViewer((path) => setView({ kind: "file", path, back: null })), []);
  return {
    openDiff: (diff: TurnDiff) => setView({ kind: "list", diff }),
    element: (
      <ChangesSheet projectId={projectId} sessionId={sessionId} view={view} onView={setView} />
    ),
  };
}

function ChangesSheet({
  projectId,
  sessionId,
  view,
  onView,
}: {
  projectId: string;
  sessionId: string;
  view: View | null;
  onView: (v: View | null) => void;
}) {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const back =
    view?.kind === "diff"
      ? ({ kind: "list", diff: view.diff } as View)
      : view?.kind === "file"
        ? view.back
        : null;

  const title =
    view?.kind === "list"
      ? `${view.diff.files.length} ${view.diff.files.length === 1 ? "file" : "files"} changed`
      : view?.kind === "diff"
        ? splitPath(view.file.path).name
        : view?.kind === "file"
          ? splitPath(view.path).name
          : "";
  const description =
    view?.kind === "list"
      ? `In the turn at ${formatTime(view.diff.createdAt)}`
      : view?.kind === "diff"
        ? view.file.oldPath
          ? `${view.file.oldPath} → ${view.file.path}`
          : splitPath(view.file.path).dir
        : view?.kind === "file"
          ? splitPath(view.path).dir
          : "";

  return (
    <Sheet open={view !== null} onOpenChange={(o) => !o && onView(null)}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        className={cn(
          "gap-0",
          mobile ? "h-[92dvh] pb-[max(0.5rem,env(safe-area-inset-bottom))]" : "w-full sm:max-w-2xl",
        )}
      >
        <SheetHeader className="flex-row items-center gap-2 pb-2">
          {back && (
            <Button
              variant="ghost"
              size="icon"
              className="-ml-2 size-9 shrink-0"
              onClick={() => onView(back)}
              aria-label="Back"
            >
              <ArrowLeftIcon />
            </Button>
          )}
          <div className="flex min-w-0 flex-col gap-0.5">
            <SheetTitle className="truncate">{title}</SheetTitle>
            {description && (
              <SheetDescription
                className={cn("truncate text-xs", view?.kind !== "list" && "font-mono")}
              >
                {description}
              </SheetDescription>
            )}
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          {view?.kind === "list" && (
            <FileList
              diff={view.diff}
              onPick={(file) => onView({ kind: "diff", diff: view.diff, file })}
            />
          )}
          {view?.kind === "diff" && (
            <FileDiffView
              sessionId={sessionId}
              diff={view.diff}
              file={view.file}
              onViewFile={() => onView({ kind: "file", path: view.file.path, back: view })}
            />
          )}
          {view?.kind === "file" && <FileView projectId={projectId} path={view.path} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FileList({ diff, onPick }: { diff: TurnDiff; onPick: (f: TurnFileChange) => void }) {
  return (
    <ul className="flex flex-col divide-y rounded-xl border">
      {diff.files.map((f) => {
        const { name, dir } = splitPath(f.path);
        const st = STATUS_STYLE[f.status];
        return (
          <li key={f.path}>
            <button
              type="button"
              onClick={() => onPick(f)}
              className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
            >
              <span className={cn("w-3 shrink-0 font-mono text-xs font-semibold", st.className)}>
                {st.letter}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{name}</span>
                {dir && <span className="truncate text-xs text-muted-foreground">{dir}</span>}
              </span>
              <Counts add={f.additions} del={f.deletions} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Baris unified diff dengan warna tambah/hapus; header git disembunyikan. */
function DiffLines({ text }: { text: string }) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("@@"));
  const body = start === -1 ? [] : lines.slice(start);
  if (body.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">No text changes to show.</p>
    );
  }
  return (
    <pre className="overflow-hidden rounded-xl border font-mono text-[12px] leading-5">
      {body.map((line, i) => {
        const cls = line.startsWith("@@")
          ? "bg-sky-500/10 text-sky-700 dark:text-sky-300"
          : line.startsWith("+")
            ? "bg-emerald-500/12 text-emerald-900 dark:text-emerald-200"
            : line.startsWith("-")
              ? "bg-red-500/12 text-red-900 dark:text-red-200"
              : "text-foreground/80";
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: baris diff statis, urutan tetap
          <div key={i} className={cn("px-3 whitespace-pre-wrap break-all", cls)}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

function FileDiffView({
  sessionId,
  diff,
  file,
  onViewFile,
}: {
  sessionId: string;
  diff: TurnDiff;
  file: TurnFileChange;
  onViewFile: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    void getFileDiff(sessionId, diff.id, file.path).then(
      (t) => !cancelled && setText(t),
      (e) => !cancelled && setError(errorText(e, "Couldn't load the diff")),
    );
    return () => {
      cancelled = true;
    };
  }, [sessionId, diff.id, file.path]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Counts add={file.additions} del={file.deletions} />
        <span className="flex-1" />
        {file.status !== "deleted" && (
          <Button variant="outline" size="sm" onClick={onViewFile}>
            <FileCodeIcon data-icon="inline-start" />
            View file
          </Button>
        )}
      </div>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : text === null ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <DiffLines text={text} />
      )}
    </div>
  );
}

function FileView({ projectId, path }: { projectId: string; path: string }) {
  const [file, setFile] = useState<ProjectFileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFile(null);
    setError(null);
    setSource(false);
    void getProjectFile(projectId, path).then(
      (f) => !cancelled && setFile(f),
      (e) => !cancelled && setError(errorText(e, "Couldn't open the file")),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, path]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!file) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  if (file.kind === "image") {
    return (
      <img
        src={projectImageUrl(projectId, path)}
        alt={path}
        className="mx-auto max-h-[70dvh] rounded-xl border object-contain"
      />
    );
  }
  if (file.kind === "binary" || file.content === null) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <FileTextIcon className="size-4" aria-hidden />
        This file isn't text, so it can't be shown here.
      </p>
    );
  }
  const lang = languageForPath(path);
  const markdown = lang === "markdown";
  return (
    <div className="flex flex-col gap-3">
      {markdown && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setSource((s) => !s)}>
            {source ? "Preview" : "Source"}
          </Button>
        </div>
      )}
      {markdown && !source ? (
        <MarkdownContent className="text-sm">{file.content}</MarkdownContent>
      ) : (
        <CodeBlock code={file.content} language={lang} />
      )}
      {file.truncated && (
        <p className="text-xs text-muted-foreground">Only the first 512 KB is shown.</p>
      )}
    </div>
  );
}
