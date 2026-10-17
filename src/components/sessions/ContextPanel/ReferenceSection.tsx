import { ChevronDownIcon, FileTextIcon } from "lucide-react";
import { useState } from "react";
import { openFileViewer } from "@/lib/changes-events";
import { baseName, type FileReference } from "@/lib/references";
import { cn } from "@/lib/utils";
import { Box, Empty, ROW, RowContent, Section } from "./primitives";

/**
 * Jumlah file yang langsung tampil. Sisanya di balik "Show N more" supaya
 * Reference tidak mendorong bagian lain (Task list, MCP) keluar pandangan
 * saat agent membaca puluhan file. Daftar sudah terbaru-di-atas, jadi yang
 * tersembunyi adalah file yang paling lama tidak disentuh.
 */
export const REFERENCE_PREVIEW = 8;

export function ReferenceSection({ references }: { references: FileReference[] }) {
  const [showAll, setShowAll] = useState(false);
  const hidden = Math.max(0, references.length - REFERENCE_PREVIEW);
  const visible = showAll ? references : references.slice(0, REFERENCE_PREVIEW);

  return (
    <Section
      title="Reference"
      summary={references.length > 0 ? String(references.length) : undefined}
    >
      {references.length === 0 ? (
        <Empty>Files the agent reads will appear here</Empty>
      ) : (
        <>
          <Box>
            {visible.map((ref) => (
              // Tap -> viewer file (host di halaman Session).
              <li key={ref.path} title={ref.path}>
                <button
                  type="button"
                  onClick={() => openFileViewer(ref.path)}
                  className={cn(
                    ROW,
                    "w-full rounded-md text-left outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  )}
                >
                  <RowContent
                    icon={<FileTextIcon />}
                    label={baseName(ref.path)}
                    // Folder induk sebagai konteks; path lengkap di `title`.
                    hint={parentDir(ref.path)}
                  />
                </button>
              </li>
            ))}
          </Box>
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[12px] text-muted-foreground outline-none transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              {showAll ? "Show less" : `Show ${hidden} more`}
              <ChevronDownIcon
                aria-hidden
                className={cn("size-3 transition-transform duration-200", showAll && "rotate-180")}
              />
            </button>
          )}
        </>
      )}
    </Section>
  );
}

/** Folder induk dari path relatif ("src/lib/a.ts" -> "src/lib"). */
function parentDir(p: string): string | undefined {
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) : undefined;
}
