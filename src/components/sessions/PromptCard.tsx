/**
 * Kartu Interactive_Prompt (Requirement 8.4, 8.5).
 *
 * - Tipe `"confirmation"`: tombol aksi cepat Approve, Deny, dan Cancel.
 *   Klik "Cancel" memperlakukan sebagai respon Deny yang sama (Requirement
 *   8.5 — meneruskan mengikuti mekanisme penyelesaian Requirement 6).
 * - Tipe `"menu"`: satu tombol per opsi yang terdaftar; respon berupa
 *   `{ option }` (Requirement 6.3).
 *
 * Logika pemetaan aksi diekstrak ke `getPromptActions` (fungsi murni) agar
 * dapat diuji tanpa DOM (unit test 24.6).
 */
import { AlertTriangleIcon, HelpCircleIcon, ListChecksIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { InteractivePrompt, PromptResponse } from "@/types";

export type PromptActionVariant = "default" | "destructive" | "outline";

export interface PromptAction {
  key: string;
  label: string;
  response: PromptResponse;
  variant: PromptActionVariant;
}

/**
 * Aksi yang dirender untuk sebuah Interactive_Prompt (murni — diuji di 24.6).
 * Untuk `confirmation`: Approve, Deny, dan Cancel; Cancel memakai respon yang
 * sama dengan Deny (Requirement 8.5).
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
    { key: "deny", label: "Deny", response: "deny", variant: "destructive" },
    // Requirement 8.5: Cancel diperlakukan sebagai respon Deny yang sama.
    { key: "cancel", label: "Cancel", response: "deny", variant: "outline" },
  ];
}

export interface PromptCardProps {
  prompt: InteractivePrompt;
  /** Dipanggil dengan respon pengguna (Requirement 6.3, 6.7). */
  onResolve: (response: PromptResponse) => void;
}

export function PromptCard({ prompt, onResolve }: PromptCardProps) {
  const actions = getPromptActions(prompt);
  const isMenu = prompt.type === "menu";
  const isPermission = prompt.kind === "permission";

  return (
    <Card className="gap-3 border-primary/30 py-4">
      <CardHeader className="gap-1.5 px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          {isMenu ? (
            <ListChecksIcon className="size-4" data-icon="inline-start" />
          ) : isPermission ? (
            <AlertTriangleIcon className="size-4 text-muted-foreground" data-icon="inline-start" />
          ) : (
            <HelpCircleIcon className="size-4 text-muted-foreground" data-icon="inline-start" />
          )}
          {isPermission ? "Izin tool" : isMenu ? "Pertanyaan" : "Interactive Prompt"}
        </CardTitle>
        <CardDescription className="flex flex-col items-start gap-1.5 text-xs">
          <span className="flex items-center gap-2">
            <Badge variant={isMenu ? "secondary" : "outline"}>{prompt.type}</Badge>
            <Badge variant="ghost">{prompt.kind}</Badge>
          </span>
          {/* wrap-anywhere: path file panjang tanpa spasi tidak boleh
              meluapkan kartu di layar sempit (bug mobile). */}
          {prompt.title && <span className="wrap-anywhere font-mono">{prompt.title}</span>}
          {isMenu ? "Pilih salah satu opsi" : "Setujui atau tolak permintaan CLI_Agent"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2 px-4">
        {actions.map((action) => (
          <Button
            key={action.key}
            type="button"
            size="sm"
            variant={action.variant}
            onClick={() => onResolve(action.response)}
          >
            {action.label}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}
