/**
 * Folder_Browser (Requirement 10.2, 10.3).
 *
 * Menjelajah direktori di dalam Sandbox_Root via `GET /api/fs?path=...`:
 * breadcrumb path saat ini, daftar sub-direktori, dan tombol "Pilih" untuk
 * menetapkan path Project baru (Requirement 10.4). Path di luar sandbox
 * ditolak server dan ditampilkan sebagai error.
 */

import { CheckIcon, ChevronRightIcon, FolderIcon, Undo2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface FolderBrowserProps {
  /** Path relatif yang sedang dipilih ("" = Sandbox_Root). */
  selectedPath: string;
  /** Dipanggil saat tombol "Pilih" ditekan. */
  onPick: (path: string) => void;
}

function joinDir(base: string, name: string): string {
  return base === "" ? name : `${base}/${name}`;
}

export function FolderBrowser({ selectedPath, onPick }: FolderBrowserProps) {
  const [cwd, setCwd] = useState("");
  const [entries, setEntries] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/fs?path=${encodeURIComponent(path)}`);
      const body = (await res.json()) as { entries: string[] };
      setEntries(body.entries);
    } catch (e) {
      setEntries([]);
      setError(e instanceof ApiError ? e.message : "Gagal memuat direktori");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(cwd);
  }, [cwd, load]);

  // Saat path terpilih di-reset eksternal (mis. usai Project dibuat),
  // kembalikan tampilan browser ke posisi yang sesuai (root).
  useEffect(() => {
    if (selectedPath === "" && cwd !== "") setCwd("");
  }, [selectedPath]);

  const segments = cwd === "" ? [] : cwd.split("/");
  const isSelected = cwd === selectedPath;

  return (
    <div className="flex flex-col gap-2">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-7 px-2 font-medium", cwd === "" && "text-foreground")}
          onClick={() => setCwd("")}
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
                onClick={() => setCwd(target)}
              >
                {seg}
              </Button>
            </span>
          );
        })}
      </div>

      {/* Daftar sub-direktori */}
      <div className="flex flex-col gap-1 rounded-lg border bg-card p-2">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Memuat direktori…
          </div>
        ) : error ? (
          <p className="px-2 py-4 text-sm text-destructive">{error}</p>
        ) : entries.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">Tidak ada sub-direktori.</p>
        ) : (
          <>
            {cwd !== "" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 justify-start gap-2 px-2 text-muted-foreground"
                onClick={() => setCwd(segments.slice(0, -1).join("/"))}
              >
                <Undo2Icon data-icon="inline-start" />
                Kembali
              </Button>
            )}
            {entries.map((name) => (
              <Button
                key={name}
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 justify-start gap-2 px-2"
                onClick={() => setCwd(joinDir(cwd, name))}
              >
                <FolderIcon data-icon="inline-start" />
                <span className="truncate">{name}</span>
              </Button>
            ))}
          </>
        )}
      </div>

      {/* Path terpilih + tombol Pilih */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className="truncate font-mono text-muted-foreground">{cwd === "" ? "/" : cwd}</span>
          {isSelected && (
            <Badge variant="secondary" className="shrink-0">
              <CheckIcon /> terpilih
            </Badge>
          )}
        </span>
        <Button type="button" size="sm" onClick={() => onPick(cwd)} disabled={loading}>
          Pilih
        </Button>
      </div>
    </div>
  );
}
