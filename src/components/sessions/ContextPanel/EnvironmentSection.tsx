import { FileDiffIcon, GitBranchIcon, UploadIcon } from "lucide-react";
import type { SessionContext } from "@/types";
import { Box, Row, Section } from "./primitives";

export function EnvironmentSection({ context }: { context: SessionContext | null }) {
  const changed = context?.changes ?? [];
  const added = changed.reduce((n, c) => n + c.added, 0);
  const removed = changed.reduce((n, c) => n + c.removed, 0);
  const git = context?.git;

  return (
    <Section title="Environment">
      <Box>
        <Row
          icon={<FileDiffIcon />}
          label={
            changed.length === 0
              ? "No changes"
              : `${changed.length} ${changed.length === 1 ? "file" : "files"} changed`
          }
          value={changed.length > 0 ? <DiffStat added={added} removed={removed} /> : undefined}
        />
        <Row
          icon={<GitBranchIcon />}
          label={git?.branch ?? "Not a git repository"}
          muted={!git?.branch}
          mono={Boolean(git?.branch)}
        />
        {git?.branch && (
          <Row
            icon={<UploadIcon />}
            label={syncLabel(git.ahead, git.behind, git.hasRemote)}
            muted
          />
        )}
      </Box>
    </Section>
  );
}

/** Teks sinkronisasi cabang terhadap upstream. */
function syncLabel(ahead: number | null, behind: number | null, hasRemote: boolean): string {
  if (!hasRemote) return "No remote";
  if (ahead === null) return "Not pushed yet";
  const pull = behind ?? 0;
  if (ahead === 0 && pull === 0) return "Up to date";
  const parts: string[] = [];
  if (ahead > 0) parts.push(`${ahead} to push`);
  if (pull > 0) parts.push(`${pull} to pull`);
  return parts.join(" · ");
}

/** +tambah / -hapus berwarna. */
function DiffStat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[11.5px] tabular-nums">
      <span className="text-emerald-600 dark:text-emerald-400">+{added}</span>
      <span className="text-destructive">-{removed}</span>
    </span>
  );
}
