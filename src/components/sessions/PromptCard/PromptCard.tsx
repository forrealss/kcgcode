/**
 * Kartu Interactive_Prompt (Requirement 8.4, 8.5).
 *
 * - Tipe `"confirmation"`: tombol aksi cepat Approve, Always allow, Deny, dan
 *   Cancel. "Always allow" mengirim `always` — opencode mengingat pola yang
 *   disetujui sehingga request identik berikutnya tidak menampilkan kartu
 *   lagi. "Cancel" memperlakukan sebagai respon Deny yang sama (Requirement
 *   8.5 — meneruskan mengikuti mekanisme penyelesaian Requirement 6).
 * - Tipe `"menu"` (question): baris opsi ala TUI opencode — label beserta
 *   keterangan (`description` dari skema tool `question`). Single choice
 *   langsung menyelesaikan kartu saat baris diklik (`{ option }`); multi-
 *   select (`multiple: true`) memakai checkbox + footer Dismiss/Submit dan
 *   mengirim seluruh label terpilih sebagai `{ options: string[] }`. Jawaban
 *   bebas (`custom`) tetap tersedia di kedua mode.
 * - Multi-question (`questions` berisi >1 pertanyaan): SEMUA pertanyaan
 *   dirender sebagai bagian dalam satu kartu; jawaban dikumpulkan per
 *   pertanyaan lalu dikirim SEKALIGUS sebagai `{ answers: string[][] }` —
 *   satu array label per pertanyaan, urut sesuai daftar. Submit baru aktif
 *   setelah tiap pertanyaan punya minimal satu jawaban (opsi dan/atau teks
 *   kustom); Dismiss menolak seluruh request.
 * - Beberapa request permission yang identik (opencode memancarkan satu
 *   request per tool call) digroup jadi SATU kartu: `prompts` berisi seluruh
 *   anggota grup, satu set tombol, dan jawaban diteruskan ke SEMUA id —
 *   server meneruskan reply ke tiap request (fan-out).
 *
 * Feedback klik: tombol/baris yang diklik menampilkan spinner dan seluruh
 * aksi terkunci sampai `prompt_resolved` menghapus kartu. Kegagalan (WS
 * putus, server menolak) ditampilkan DI kartu via `errorSignal` — klik yang
 * gagal tidak lagi diam saja sehingga tombol terasa mati.
 *
 * Desain: panel floating di ATAS composer (ala dialog izin Claude/opencode)
 * dengan animasi masuk/keluar (Motion, di `PromptPanel`). Logika pemetaan
 * aksi, pengelompokan prompt, dan bentuk jawaban dipisah ke `lib/prompts.ts`
 * (fungsi murni, diuji tanpa DOM — unit test 24.6).
 *
 * File ini hanya memilih kartu; bagian-bagiannya ada di folder ini:
 * `PermissionCard` (izin tool), `QuestionCard` (+ `useQuestionAnswers`,
 * `QuestionHeader`, `QuestionWizard`, `QuestionFooter`, `OptionList`), dan
 * status kirim bersama di `usePromptSubmission`.
 */
import type { InteractivePrompt, PromptResponse } from "@/types";
import { PermissionCard } from "./PermissionCard";
import { QuestionCard } from "./QuestionCard";
import { usePromptSubmission } from "./usePromptSubmission";

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
   * `true` = kartu docked di dasar MENGGANTIKAN composer (question pending):
   * mengisi sisa tinggi kolom dan hanya area jawaban yang scroll — header
   * pertanyaan dan footer aksi (Dismiss/Submit) selalu terlihat. `false` =
   * kartu mengambang di atas composer (ukuran alami, tanpa scroll internal).
   */
  docked?: boolean;
}

export function PromptCard({
  prompts,
  onResolve,
  errorSignal,
  onConsumeError,
  docked = false,
}: PromptCardProps) {
  const submission = usePromptSubmission({ prompts, onResolve, errorSignal, onConsumeError });
  const prompt = prompts[0];
  if (!prompt) return null;

  // Izin tool punya kartu sendiri: penjelasan ramah + aksi yang jelas
  // konsekuensinya. Permission identik yang menumpuk di server — kartu
  // memberi tahu bahwa satu klik menjawab semuanya (`twinCount`).
  if (prompt.kind === "permission") {
    return (
      <PermissionCard
        prompt={prompt}
        twinCount={prompts.length}
        submittingKey={submission.submittingKey}
        error={submission.error}
        onResolve={submission.submit}
      />
    );
  }
  return <QuestionCard prompt={prompt} submission={submission} docked={docked} />;
}
