/** Empty state daftar Session (pola AdwStatusPage). */
import { MessagesSquareIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Empty state saat Project belum punya Session — pola AdwStatusPage: ikon
 * simbolik besar redup, judul, deskripsi, satu tombol pil aksi utama.
 */
export function EmptySessions({
  projectName,
  onStart,
}: {
  projectName: string;
  onStart: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-6 px-6 py-12 text-center sm:py-20">
      <MessagesSquareIcon
        className="size-16 text-muted-foreground/50"
        strokeWidth={1.5}
        aria-hidden
      />

      <div className="flex max-w-sm flex-col gap-2">
        <h2 className="text-2xl font-bold tracking-tight">No Sessions Yet</h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          A session is a conversation with the agent inside{" "}
          <span className="font-medium text-foreground">{projectName}</span>. It can read and edit
          files here for you.
        </p>
      </div>

      <Button type="button" onClick={onStart} className="h-10 rounded-full px-6">
        <PlusIcon data-icon="inline-start" />
        New session
      </Button>
    </div>
  );
}
