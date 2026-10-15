/**
 * Textarea prompt composer + lapisan sorot di belakangnya untuk slash
 * command (`/nama` di awal pesan) & mention `@file` yang dikenali.
 *
 * Mention @file yang dikenali -> latar tipis transparan (tanpa bingkai /
 * garis bawah — garis bawah mirip penanda autocorrect keyboard HP) lewat
 * lapisan di BELAKANG textarea (teks & metrik identik, warna teks
 * transparan; hanya latarnya yang terlihat). Sengaja bukan warna teks:
 * textarea harus tetap menggambar teksnya sendiri agar teks komposisi IME
 * tetap terlihat. Textarea tetap input aslinya: kursor, seleksi, undo, IME,
 * dan autocomplete tidak berubah. Scroll disinkronkan.
 */
import { type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type Ref, useRef } from "react";
import { splitComposerMentions } from "@/lib/composer";
import { cn } from "@/lib/utils";

export interface ComposerTextareaProps {
  /** Ref elemen textarea — milik composer (fokus ulang & tinggi otomatis). */
  textareaRef: Ref<HTMLTextAreaElement>;
  value: string;
  /** Tata letak stacked: textarea selebar kotak; inline: mengisi sisa baris. */
  stacked: boolean;
  /** Path yang pernah disarankan autocomplete (mention dikenali). */
  knownPaths: ReadonlySet<string>;
  /** Nama + alias slash command yang dikenal. */
  knownCommands: ReadonlySet<string>;
  placeholder: string;
  disabled: boolean;
  /** Dikte suara berjalan — isi milik pengenal suara, tidak bisa diketik. */
  readOnly?: boolean;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  onBlur: () => void;
}

export function ComposerTextarea({
  textareaRef,
  value,
  stacked,
  knownPaths,
  knownCommands,
  placeholder,
  disabled,
  readOnly = false,
  onChange,
  onKeyDown,
  onPaste,
  onBlur,
}: ComposerTextareaProps) {
  /** Lapisan sorot @file di belakang textarea (scroll disinkronkan). */
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const segments = splitComposerMentions(value, knownPaths, knownCommands);
  const hasMention = segments.some((seg) => seg.kind !== "text");

  return (
    <div className={cn("relative min-w-0", stacked ? "w-full" : "flex-1 self-center")}>
      {hasMention && (
        <div
          ref={highlightRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden px-2 py-1.5 text-base leading-6 break-words whitespace-pre-wrap text-transparent"
        >
          {segments.map((seg, i) =>
            seg.kind !== "text" ? (
              <mark
                // biome-ignore lint/suspicious/noArrayIndexKey: urutan potongan = urutan teks
                key={i}
                className="rounded-[3px] bg-primary/10 text-transparent dark:bg-primary/15"
              >
                {seg.text}
              </mark>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: urutan potongan = urutan teks
              <span key={i}>{seg.text}</span>
            ),
          )}
          {/* Baris kosong di akhir tetap punya tinggi (sama seperti textarea). */}
          {"​"}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onScroll={(e) => {
          if (highlightRef.current) {
            highlightRef.current.scrollTop = e.currentTarget.scrollTop;
          }
        }}
        onBlur={onBlur}
        placeholder={placeholder}
        aria-label="Free-form input"
        disabled={disabled}
        readOnly={readOnly}
        rows={1}
        // `relative` = di atas lapisan sorot; latar transparan agar
        // sorotan di belakangnya terlihat.
        // Placeholder selalu satu baris (dipotong "…"), tidak pernah wrap:
        // textarea kosong tidak boleh tumbuh / jadi scrollable hanya
        // karena teks petunjuk (mis. saat lampiran mempersempit ruang).
        className="relative block max-h-40 min-h-9 w-full min-w-0 resize-none border-0 bg-transparent px-2 py-1.5 text-base leading-6 break-words shadow-none outline-none placeholder:truncate placeholder:text-muted-foreground focus-visible:ring-0 disabled:cursor-not-allowed placeholder-shown:overflow-hidden"
      />
    </div>
  );
}
