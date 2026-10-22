/**
 * Review hasil kerja agent dari HP: sheet dengan tiga tampilan bertumpuk —
 * daftar file, diff satu file, dan isi file (kode ber-highlight, Markdown
 * ter-render, gambar).
 *
 * Viewer file juga bisa dibuka dari bagian lain (mis. daftar Reference) lewat
 * `openFileViewer(path)`; host-nya dipasang sekali per halaman Session.
 */
import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MOBILE_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { onOpenFileViewer } from "@/lib/changes-events";
import { formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { TurnDiff, TurnFileChange } from "@/types";
import { FileDiffView } from "./FileDiffView";
import { FileList } from "./FileList";
import { FileView } from "./FileView";
import { splitPath } from "./shared";

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
