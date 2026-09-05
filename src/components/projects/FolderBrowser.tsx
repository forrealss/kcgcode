/**
 * Folder_Browser (Requirement 10.2, 10.3).
 *
 * Menjelajah direktori di dalam Sandbox_Root via `GET /api/fs?path=...`:
 * breadcrumb path saat ini dan daftar sub-direktori. Fully controlled —
 * direktori yang sedang dijelajahi (`path`) adalah direktori yang otomatis
 * aktif/terpilih (Requirement 10.4); tidak ada tombol "Pilih" terpisah.
 */

import { ChevronRightIcon, FolderIcon, Undo2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface FolderBrowserProps {
  /** Path relatif yang sedang aktif/dijelajahi ("" = Sandbox_Root). */
  path: string;
  /** Dipanggil setiap kali pengguna berpindah direktori. */
  onNavigate: (path: string) => void;
}

function joinDir(base: string, name: string): string {
  return base === "" ? name : `${base}/${name}`;
}

export function FolderBrowser({ path, onNavigate }: FolderBrowserProps) {
  const [entries, setEntries] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/fs?path=${encodeURIComponent(p)}`);
      const body = (await res.json()) as { entries: string[] };
      setEntries(body.entries);
    } catch (e) {
      setEntries([]);
      setError(e instanceof ApiError ? e.message : "Failed to load directory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(path);
  }, [path, load]);

  const segments = path === "" ? [] : path.split("/");

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Breadcrumb */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 text-sm">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-7 px-2 font-medium", path === "" && "text-foreground")}
          onClick={() => onNavigate("")}
        >
          Sandbox
        </Button>
        {segments.map((seg, i) => {
          const target = segments.slice(0, i + 1).join("/");
          return (
            <span key={target} className="flex items-center gap-1">
              <ChevronRightIcon
                className="size-3.5 text-muted-foreground"
                data-icon="inline-start"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 px-2 font-medium",
                  i === segments.length - 1 && "text-foreground",
                )}
                onClick={() => onNavigate(target)}
              >
                {seg}
              </Button>
            </span>
          );
        })}
      </div>

      {/* Daftar sub-direktori */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card p-2">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading directories…
          </div>
        ) : error ? (
          <p className="px-2 py-4 text-sm text-destructive">{error}</p>
        ) : entries.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">No subdirectories.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {path !== "" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 justify-start gap-2 px-2 text-muted-foreground"
                onClick={() => onNavigate(segments.slice(0, -1).join("/"))}
              >
                <Undo2Icon data-icon="inline-start" />
                Back
              </Button>
            )}
            {entries.map((name) => (
              <Button
                key={name}
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 justify-start gap-2 px-2"
                onClick={() => onNavigate(joinDir(path, name))}
              >
                <FolderIcon data-icon="inline-start" />
                <span className="truncate">{name}</span>
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Path aktif saat ini — selalu nempel di bawah, tidak ikut naik saat
          daftar sub-direktori pendek. */}
      <div className="flex min-w-0 shrink-0 items-center gap-1.5 text-sm">
        <span className="shrink-0 text-muted-foreground">Current directory:</span>
        <span className="min-w-0 flex-1 truncate font-mono">{path === "" ? "/" : path}</span>
      </div>
    </div>
  );
}
