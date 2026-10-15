/**
 * Kartu izin tool.
 *
 * - Judul = KALIMAT apa yang diminta ("Access a folder outside the
 *   project"), nama permission internal jadi label kecil.
 * - Target (path/perintah) tampil sebagai daftar monospace yang terbaca.
 * - Aksi menurut konsekuensi: "Allow once" (utama) & "Deny"; "Always allow"
 *   terpisah karena efeknya permanen untuk sesi ini. "Cancel" dihapus —
 *   identik dengan Deny (Req 8.5).
 * - Pintasan keyboard: Enter = izinkan sekali, Esc = tolak.
 *
 * Responsif:
 * - Desktop: satu baris aksi ringkas, tombol kecil + petunjuk pintasan.
 * - HP: teks lebih besar & tombol setinggi target sentuh (44px+), disusun
 *   vertikal selebar kartu dengan aksi utama di ATAS (paling dekat ibu jari
 *   saat kartu di atas composer).
 */
import { ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";
import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { type PermissionRisk, parsePermissionTitle } from "@/lib/permission-info";
import { cn } from "@/lib/utils";
import type { InteractivePrompt, PromptResponse } from "@/types";
import { isTextEntryTarget } from "./keyboard";

/**
 * Tingkat risiko hanya diwakili ikon + label teks (bukan garis/warna
 * dekoratif) — tetap sederhana ala libadwaita, dan tidak bergantung pada
 * warna saja.
 */
const RISK_STYLE: Record<PermissionRisk, { icon: string; label: string }> = {
  high: { icon: "bg-amber-500/15 text-amber-600 dark:text-amber-400", label: "Review carefully" },
  medium: { icon: "bg-muted text-foreground/80", label: "" },
  low: { icon: "bg-muted text-muted-foreground", label: "Read-only" },
};

export function PermissionCard({
  prompt,
  twinCount,
  submittingKey,
  error,
  onResolve,
}: {
  prompt: InteractivePrompt;
  /** Jumlah request identik yang dijawab sekaligus oleh kartu ini. */
  twinCount: number;
  submittingKey: string | null;
  error: string | null;
  onResolve: (key: string, response: PromptResponse) => void;
}) {
  const info = parsePermissionTitle(prompt.title);
  const style = RISK_STYLE[info.risk];
  const busy = submittingKey !== null;

  // Enter = allow once, Esc = deny — hanya saat fokus TIDAK di kolom isian
  // (composer / input lain), agar mengetik tidak menyetujui izin tanpa sengaja.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy || e.defaultPrevented || e.isComposing) return;
      if (isTextEntryTarget(e.target)) return;
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onResolve("approve", "approve");
      } else if (e.key === "Escape") {
        e.preventDefault();
        onResolve("deny", "deny");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onResolve]);

  const spin = (key: string) =>
    submittingKey === key ? <Spinner className="size-4" data-icon="inline-start" /> : null;

  /** Tombol: tinggi sentuh di HP, ringkas di desktop. */
  const btn = "h-11 w-full text-[15px] sm:h-8 sm:w-auto sm:text-sm";

  return (
    <Card
      role="alertdialog"
      aria-labelledby={`perm-${prompt.id}-title`}
      aria-describedby={`perm-${prompt.id}-targets`}
      className="gap-4 rounded-2xl border bg-card py-4 shadow-lg sm:gap-3 sm:rounded-xl sm:py-3.5"
    >
      <CardHeader className="flex flex-row items-start gap-3 px-4">
        <span
          aria-hidden
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full sm:size-8",
            style.icon,
          )}
        >
          <ShieldAlertIcon className="size-5 sm:size-4.5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:gap-0.5">
          <CardTitle
            id={`perm-${prompt.id}-title`}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base leading-6 sm:text-sm sm:leading-5"
          >
            <span>{info.label}</span>
            {twinCount > 1 && (
              <Badge variant="secondary" title={`${twinCount} identical requests`}>
                ×{twinCount}
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-x-1.5 text-[13px] sm:text-xs">
            <span>The agent is asking for permission</span>
            {info.permission && (
              <>
                <span aria-hidden>·</span>
                <code className="font-mono text-[12px] sm:text-[11px]">{info.permission}</code>
              </>
            )}
            {style.label && (
              <>
                <span aria-hidden>·</span>
                <span
                  className={cn(
                    info.risk === "high" && "font-medium text-amber-700 dark:text-amber-400",
                  )}
                >
                  {style.label}
                </span>
              </>
            )}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 px-4 sm:gap-3">
        {info.targets.length > 0 && (
          <ul
            id={`perm-${prompt.id}-targets`}
            className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-xl bg-muted/60 px-3 py-2.5 [scrollbar-width:thin] sm:max-h-32 sm:rounded-lg sm:py-2"
          >
            {info.targets.map((t) => (
              // wrap-anywhere: path panjang tanpa spasi tidak meluapkan kartu.
              <li
                key={t}
                className="wrap-anywhere font-mono text-[13px] leading-relaxed text-foreground/90 sm:text-xs"
              >
                {t}
              </li>
            ))}
          </ul>
        )}

        {/* HP: tombol penuh lebar bertumpuk, aksi utama di atas. Desktop:
            satu baris — "Always allow" di kiri, Deny & Allow once di kanan. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            type="button"
            size="sm"
            disabled={busy}
            aria-busy={submittingKey === "approve"}
            onClick={() => onResolve("approve", "approve")}
            aria-keyshortcuts="Enter"
            className={cn(btn, "sm:order-3")}
          >
            {spin("approve")}
            Allow once
            <Kbd>↵</Kbd>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            aria-busy={submittingKey === "deny"}
            onClick={() => onResolve("deny", "deny")}
            aria-keyshortcuts="Escape"
            className={cn(btn, "sm:order-2 sm:ms-auto")}
          >
            {spin("deny")}
            Deny
            <Kbd>Esc</Kbd>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            aria-busy={submittingKey === "always"}
            onClick={() => onResolve("always", "always")}
            title="Don't ask again for matching requests in this session"
            className={cn(btn, "text-muted-foreground hover:text-foreground sm:order-1")}
          >
            {spin("always") ?? <ShieldCheckIcon className="size-4" data-icon="inline-start" />}
            Always allow
          </Button>
        </div>

        {error && (
          <p className="text-[13px] text-destructive sm:text-xs" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Petunjuk pintasan kecil di dalam tombol (disembunyikan di layar sentuh). */
function Kbd({ children }: { children: string }) {
  return (
    <kbd
      aria-hidden
      className="ms-0.5 hidden rounded border border-current/20 px-1 font-sans text-[10px] leading-4 opacity-60 sm:inline"
    >
      {children}
    </kbd>
  );
}
