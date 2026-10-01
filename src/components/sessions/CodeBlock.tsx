/**
 * Blok kode Markdown dengan syntax highlighting (Shiki) + tombol salin.
 *
 * - Teks polos dirender LANGSUNG (tanpa menunggu), lalu diganti token
 *   berwarna begitu grammar siap — tidak ada kedipan kosong / layout shift.
 * - Saat streaming, isi blok berubah tiap token baru. Highlight di-debounce
 *   singkat; selama itu token lama tetap tampil untuk bagian yang sudah
 *   ada dan sisanya teks polos.
 * - Token dirender sebagai `<span>` React (bukan innerHTML), warna lewat CSS
 *   variable `--shiki-light` / `--shiki-dark` (lihat `.shiki-code` di
 *   `styles/globals.css`).
 */
import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { type CodeToken, highlightCode, resolveLang } from "@/lib/highlight";
import { cn } from "@/lib/utils";

export interface CodeBlockProps {
  code: string;
  /** Info-string fence (`ts`, `language-tsx`, …). */
  language: string | null;
}

/** Jeda highlight ulang saat isi berubah (streaming). */
const DEBOUNCE_MS = 120;

export function CodeBlock({ code, language }: CodeBlockProps) {
  const lang = resolveLang(language);
  const [tokens, setTokens] = useState<{ code: string; lines: CodeToken[][] } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!lang) return;
    let cancelled = false;
    const id = setTimeout(() => {
      void highlightCode(code, lang).then((lines) => {
        if (!cancelled && lines) setTokens({ code, lines });
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [code, lang]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* Clipboard butuh konteks aman; abaikan diam-diam. */
    }
  };

  // Token masih cocok dengan awal kode (streaming menambah di akhir):
  // tampilkan token + sisa teks polos. Isi berubah di tengah -> teks polos.
  const fresh = tokens && code.startsWith(tokens.code) ? tokens : null;
  const tail = fresh ? code.slice(fresh.code.length) : code;
  const label = language?.replace(/^language-/, "") || "text";

  return (
    // Tanpa border: blok dibedakan dari teks hanya lewat latar & sudut besar
    // (ala Gemini). Header tanpa garis pemisah, menyatu dengan isi.
    <div className="my-3 max-w-full overflow-hidden rounded-2xl bg-muted/70 first:mt-0 last:mb-0 dark:bg-muted/50">
      <div className="flex items-center justify-between gap-2 pt-4 pr-4 pl-6 sm:pl-7">
        <span className="text-[13px] font-medium text-foreground/80 uppercase">{label}</span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={copied ? "Copied" : "Copy code"}
          title={copied ? "Copied" : "Copy code"}
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          {copied ? (
            <CheckIcon className="size-4" aria-hidden />
          ) : (
            <CopyIcon className="size-4" aria-hidden />
          )}
        </button>
      </div>
      <pre
        className={cn(
          // Padding lega, line-height rapat (1.45) agar kode padat terbaca.
          "overflow-x-auto px-6 pt-3 pb-6 font-mono sm:px-7 text-[14px] leading-[1.45]",
          fresh && "shiki-code",
        )}
      >
        <code>
          {fresh?.lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: baris = posisi dalam kode
            <span key={i}>
              {line.map((t, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: token = posisi dalam baris
                <span key={j} style={t.style}>
                  {t.content}
                </span>
              ))}
              {i < fresh.lines.length - 1 ? "\n" : ""}
            </span>
          ))}
          {tail}
        </code>
      </pre>
    </div>
  );
}
