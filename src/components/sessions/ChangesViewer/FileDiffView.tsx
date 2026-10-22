/** Diff satu file: unified diff ber-warna, dengan tombol buka isi file. */
import { FileCodeIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/api";
import { getFileDiff } from "@/lib/changes-api";
import { cn } from "@/lib/utils";
import type { TurnDiff, TurnFileChange } from "@/types";
import { Counts } from "./shared";

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

export function FileDiffView({
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
