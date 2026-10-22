/** Isi satu file: kode ber-highlight, Markdown ter-render, atau gambar. */
import { FileTextIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { CodeBlock } from "@/components/sessions/CodeBlock";
import { MarkdownContent } from "@/components/sessions/MarkdownContent";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/api";
import { getProjectFile, languageForPath, projectImageUrl } from "@/lib/changes-api";
import type { ProjectFileContent } from "@/types";

export function FileView({ projectId, path }: { projectId: string; path: string }) {
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
