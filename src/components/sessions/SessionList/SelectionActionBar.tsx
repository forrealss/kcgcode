/**
 * Action bar selection mode daftar Session (GtkActionBar): melayang di dasar
 * area scroll — jumlah terpilih, Cancel, Delete (destruktif).
 */
import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pluralSessions } from "@/lib/session-selection";

export function SelectionActionBar({
  count,
  busy,
  onCancel,
  onDelete,
}: {
  /** Jumlah Session terpilih. */
  count: number;
  /** Hapus massal sedang berjalan. */
  busy: boolean;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="sticky bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 mt-4 flex items-center gap-2 rounded-2xl border bg-popover py-2 pr-2 pl-4 shadow-lg">
      <span className="min-w-0 truncate text-sm font-medium" aria-live="polite">
        {count === 0 ? "None selected" : `${pluralSessions(count)} selected`}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto"
        onClick={onCancel}
        disabled={busy}
      >
        Cancel
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="rounded-full px-3.5"
        onClick={onDelete}
        disabled={count === 0 || busy}
      >
        <Trash2Icon data-icon="inline-start" />
        Delete
      </Button>
    </div>
  );
}
