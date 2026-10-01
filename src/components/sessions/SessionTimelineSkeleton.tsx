/**
 * Kerangka loading percakapan Session.
 *
 * Dipakai di dua fase berurutan dengan tampilan IDENTIK agar tidak ada
 * kedipan saat fase berganti:
 * 1. `SessionPage` — data Session dimuat (`GET /api/sessions`).
 * 2. `SessionView` — Session sudah ada, menunggu riwayat (`history`) dari
 *    WebSocket. Tanpa ini, `messages` kosong sesaat tampil sebagai
 *    empty-state "No conversation yet" padahal percakapannya ada.
 *
 * Bentuk meniru timeline asli (gelembung user di kanan, paragraf assistant
 * di kiri) dengan lebar kolom yang sama (`TIMELINE_MAX_W`), lalu memudar
 * masuk setelah jeda singkat — koneksi cepat tidak sempat melihat kilatan
 * kerangka sama sekali.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { CONVERSATION_MAX_W, TIMELINE_MAX_W } from "@/lib/layout";
import { cn } from "@/lib/utils";

/** Satu turn: gelembung user + beberapa baris jawaban. */
const TURNS: { user: string; lines: string[] }[] = [
  { user: "w-[46%]", lines: ["w-[92%]", "w-[84%]", "w-[58%]"] },
  { user: "w-[32%]", lines: ["w-[88%]", "w-[70%]"] },
];

export function SessionTimelineSkeleton({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading conversation"
      className={cn(
        "min-h-0 flex-1 overflow-hidden",
        // Muncul setelah 150ms: muatan cepat tidak berkedip.
        "animate-in fade-in fill-mode-both delay-150 duration-300 motion-reduce:animate-none",
        className,
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full flex-col gap-6 px-3 py-4 sm:gap-8 sm:px-4",
          TIMELINE_MAX_W,
        )}
      >
        {TURNS.map((t, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: kerangka statis
          <div key={i} className="flex flex-col gap-4">
            <Skeleton className={cn("ml-auto h-11 rounded-2xl rounded-br-md", t.user)} />
            <div className="flex flex-col gap-2.5 px-1">
              {t.lines.map((w, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: kerangka statis
                <Skeleton key={j} className={cn("h-3.5 rounded-full", w)} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Loading conversation…</span>
    </div>
  );
}

/**
 * Kerangka composer. Struktur & ukuran MENIRU `SessionComposer` (footer +
 * kotak `rounded-xl border p-2` + satu baris setinggi `size-9`) sehingga
 * tingginya identik (54px) dan tidak ada lompatan saat composer asli muncul.
 */
export function SessionComposerSkeleton() {
  return (
    <div className="shrink-0 scrollbar-gutter-stable overflow-y-hidden px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4">
      <div
        className={cn(
          "mx-auto flex w-full items-center gap-2 rounded-xl border bg-card/80 p-2 shadow-sm",
          CONVERSATION_MAX_W,
        )}
      >
        <Skeleton className="size-9 shrink-0 rounded-md" />
        <Skeleton className="h-3.5 flex-1 rounded-full" />
        <Skeleton className="size-9 shrink-0 rounded-md" />
      </div>
    </div>
  );
}
