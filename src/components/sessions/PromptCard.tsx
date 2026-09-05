/**
 * Kartu Interactive_Prompt (Requirement 8.4, 8.5).
 *
 * - Tipe `"confirmation"`: tombol aksi cepat Approve, Always allow, Deny, dan
 *   Cancel. "Always allow" mengirim `always` — opencode mengingat pola yang
 *   disetujui sehingga request identik berikutnya tidak menampilkan kartu
 *   lagi. "Cancel" memperlakukan sebagai respon Deny yang sama (Requirement
 *   8.5 — meneruskan mengikuti mekanisme penyelesaian Requirement 6).
 * - Tipe `"menu"`: satu tombol per opsi yang terdaftar; respon berupa
 *   `{ option }` (Requirement 6.3).
 * - Beberapa request permission yang identik (opencode memancarkan satu
 *   request per tool call) digroup jadi SATU kartu: `prompts` berisi seluruh
 *   anggota grup, satu set tombol, dan jawaban diteruskan ke SEMUA id —
 *   server meneruskan reply ke tiap request (fan-out).
 *
 * Feedback klik: tombol yang diklik menampilkan spinner dan seluruh tombol
 * terkunci sampai `prompt_resolved` menghapus kartu. Kegagalan (WS putus,
 * server menolak) ditampilkan DI kartu via `errorSignal` — klik yang gagal
 * tidak lagi diam saja sehingga tombol terasa mati.
 *
 * Desain: panel floating di ATAS composer (ala dialog izin Claude/opencode)
 * dengan animasi masuk slide-up + fade + zoom kecil (`animate-in` dari
 * tw-animate-css). Logika pemetaan aksi diekstrak ke `getPromptActions`
 * (fungsi murni) agar dapat diuji tanpa DOM (unit test 24.6).
 */
import {
  CornerDownLeftIcon,
  HelpCircleIcon,
  ListChecksIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { InteractivePrompt, PromptResponse } from "@/types";

export type PromptActionVariant = "default" | "destructive" | "outline";

/**
 * Kelompokkan prompt pending yang identik (kind + title sama) menjadi satu
 * kartu. Kunci sama dengan sisi server (`permissionGroupKey`) agar kartu yang
 * dijawab user persis grup yang di-fan-out server. Urutan kemunculan
 * anggota pertama dipertahankan.
 */
export function groupPrompts(prompts: readonly InteractivePrompt[]): InteractivePrompt[][] {
  const groups = new Map<string, InteractivePrompt[]>();
  for (const p of prompts) {
    const key = `${p.kind}\u0000${p.title ?? ""}`;
    const g = groups.get(key);
    if (g) g.push(p);
    else groups.set(key, [p]);
  }
  return [...groups.values()];
}

export interface PromptAction {
  key: string;
  label: string;
  response: PromptResponse;
  variant: PromptActionVariant;
  /** Ikon khusus (mis. Always allow). */
  icon?: typeof ShieldCheckIcon;
}

/**
 * Aksi yang dirender untuk sebuah Interactive_Prompt (murni — diuji di 24.6).
 * Untuk `confirmation`: Approve, Always allow, Deny, dan Cancel; Cancel
 * memakai respon yang sama dengan Deny (Requirement 8.5).
 */
export function getPromptActions(prompt: InteractivePrompt): PromptAction[] {
  if (prompt.type === "menu") {
    return (prompt.options ?? []).map((option) => ({
      key: `option-${option}`,
      label: option,
      response: { option },
      variant: "outline",
    }));
  }
  return [
    { key: "approve", label: "Approve", response: "approve", variant: "default" },
    {
      key: "always",
      label: "Always allow",
      response: "always",
      variant: "outline",
      icon: ShieldCheckIcon,
    },
    { key: "deny", label: "Deny", response: "deny", variant: "destructive" },
    // Requirement 8.5: Cancel diperlakukan sebagai respon Deny yang sama.
    { key: "cancel", label: "Cancel", response: "deny", variant: "outline" },
  ];
}

export interface PromptCardProps {
  /**
   * Grup prompt yang tampil sebagai satu kartu — minimal satu elemen.
   * Anggota identik (kind + title sama): permission bertumpuk dari opencode.
   */
  prompts: InteractivePrompt[];
  /** Dipanggil dengan respon pengguna untuk tiap id anggota (Req 6.3, 6.7). */
  onResolve: (promptId: string, response: PromptResponse) => void;
  /**
   * Error resolusi terbaru dari server (WS `error` berkode PROMPT_*).
   * `null` = tidak ada. Non-null -> tampil sebagai error kartu, lalu
   * dikonsumsi via `onConsumeError` agar tidak muncul lagi di render lain.
   */
  errorSignal?: string | null;
  /** Reset `errorSignal` di pemilik state setelah kartu menampilkannya. */
  onConsumeError?: () => void;
  /**
   * `true` = jawaban sudah diterima server — kartu memainkan animasi keluar
   * (slide-down + fade) sebelum dihapus dari daftar oleh pemilik state.
   */
  exiting?: boolean;
}

export function PromptCard({
  prompts,
  onResolve,
  errorSignal,
  onConsumeError,
  exiting = false,
}: PromptCardProps) {
  const prompt = prompts[0];
  /** Key aksi yang diklik — spinner pada tombol itu, tombol lain terkunci. */
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  /** Pesan error klik TERAKHIR — tampil di kartu, bukan di atas chat. */
  const [error, setError] = useState<string | null>(null);
  /** Isi input jawaban bebas (question dengan flag `custom`). */
  const [customValue, setCustomValue] = useState("");

  // Error server (PROMPT_NOT_FOUND / PROMPT_ALREADY_RESOLVED) -> tampil di
  // kartu, lalu sinyal dikonsumsi supaya tidak muncul di kartu lain.
  useEffect(() => {
    if (errorSignal) {
      setSubmittingKey(null);
      setError(errorSignal);
      onConsumeError?.();
    }
  }, [errorSignal, onConsumeError]);

  if (!prompt) return null;
  const actions = getPromptActions(prompt);
  const isMenu = prompt.type === "menu";
  const isPermission = prompt.kind === "permission";
  // Permission identik yang menumpuk di server — beri tahu user bahwa satu
  // klik menjawab semuanya.
  const twinCount = prompts.length;

  const resolveResponse = (key: string, response: PromptResponse) => {
    if (submittingKey !== null) return;
    setError(null);
    setSubmittingKey(key);
    try {
      for (const p of prompts) onResolve(p.id, response);
    } catch (e) {
      // Gagal kirim (WS putus dsb.) — pesan error di kartu, tombol aktif lagi.
      setSubmittingKey(null);
      setError(e instanceof Error ? e.message : "Failed to send the response.");
    }
  };

  const resolveAll = (action: PromptAction) => resolveResponse(action.key, action.response);

  /** Kirim jawaban bebas dari input kustom (bentuk respon sama dengan opsi). */
  const submitCustom = () => {
    const text = customValue.trim();
    if (text.length === 0) return;
    setCustomValue("");
    resolveResponse("custom", { option: text });
  };

  return (
    <Card
      className={cn(
        // Animasi masuk: naik dari bawah + fade + sedikit membesar (ala
        // dialog izin) — tw-animate-css sudah dimuat di globals.css.
        "animate-in fade-in-0 slide-in-from-bottom-6 zoom-in-95 duration-400",
        // Animasi keluar: turun ke bawah + fade (jawaban diterima server).
        exiting && "animate-out fade-out-0 slide-out-to-bottom-4 zoom-out-95 duration-200",
        "gap-3 rounded-xl border-border/70 bg-card/95 py-3.5 shadow-lg shadow-black/20 ring-1 ring-foreground/5 backdrop-blur-md",
      )}
    >
      <CardHeader className="flex flex-row items-center gap-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full",
            isPermission ? "bg-amber-500/15 text-amber-500" : "bg-primary/15 text-primary",
          )}
        >
          {isPermission ? (
            <ShieldAlertIcon className="size-4.5" />
          ) : isMenu ? (
            <ListChecksIcon className="size-4.5" />
          ) : (
            <HelpCircleIcon className="size-4.5" />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <CardTitle className="flex items-center gap-2 text-sm">
            {isPermission ? "Tool permission" : isMenu ? "Question" : "Interactive Prompt"}
            {twinCount > 1 && <Badge variant="secondary">×{twinCount}</Badge>}
            {submittingKey !== null && (
              <Badge variant="secondary">
                <Spinner className="size-3" />
                working…
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="truncate text-xs">
            {isMenu ? "Pick one of the options" : "Approve or deny the CLI_Agent request"}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-4">
        {/* wrap-anywhere: path file panjang tanpa spasi tidak boleh meluapkan
            kartu di layar sempit (bug mobile). */}
        {prompt.title && (
          <div className="wrap-anywhere rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-xs text-foreground/90">
            {prompt.title}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => {
            const busy = submittingKey === action.key;
            const Icon = action.icon;
            return (
              <Button
                key={action.key}
                type="button"
                size="sm"
                variant={action.variant}
                disabled={submittingKey !== null}
                aria-busy={busy}
                onClick={() => resolveAll(action)}
              >
                {busy ? (
                  <Spinner className="size-3.5" data-icon="inline-start" />
                ) : (
                  Icon && <Icon className="size-3.5" data-icon="inline-start" />
                )}
                {action.label}
              </Button>
            );
          })}
        </div>
        {isMenu && prompt.custom === true && (
          <div className="flex items-center gap-1.5">
            <Input
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitCustom();
                }
              }}
              placeholder="Or type your own answer…"
              disabled={submittingKey !== null}
              aria-label="Custom answer"
              className="h-8 flex-1 bg-background/60 text-xs"
            />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={submittingKey !== null || customValue.trim().length === 0}
              aria-busy={submittingKey === "custom"}
              aria-label="Send custom answer"
              onClick={submitCustom}
            >
              {submittingKey === "custom" ? (
                <Spinner className="size-3.5" />
              ) : (
                <CornerDownLeftIcon className="size-3.5" />
              )}
            </Button>
          </div>
        )}
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
