/**
 * Elemen halaman Preview yang dipilih dari overlay (draf tersinkron) — chip
 * di dalam kotak composer. Saat dikirim, konteks tiap elemen (selector,
 * teks, komponen, dll.) ditambahkan ke akhir pesan.
 *
 * Halaman ikut tampil di chip: elemen yang sama dari halaman berbeda sudah
 * digabung overlay jadi satu entri ("N pages"), elemen kembar lain tetap
 * bisa dibedakan.
 */
import { CodeXmlIcon, XIcon } from "lucide-react";
import type { DraftElement } from "@/types";

export function DraftElementChips({
  elements,
  onRemove,
}: {
  elements: DraftElement[];
  onRemove: (index: number) => void;
}) {
  return (
    <ul
      aria-label={`${elements.length} selected ${elements.length === 1 ? "element" : "elements"}`}
      className="flex flex-wrap gap-1.5 px-1 pt-1 pb-2"
    >
      {elements.map((el, i) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: label bisa sama; urutan stabil
          key={i}
          title={el.pages.length > 1 ? `${el.pages.join("\n")}\n\n${el.context}` : el.context}
          className="flex h-7 max-w-full items-center gap-1.5 rounded-full border bg-muted/60 ps-2.5 pe-1 text-xs"
        >
          <CodeXmlIcon aria-hidden className="size-3.5 shrink-0 text-primary" />
          <span className="truncate font-mono text-[11.5px]">{el.label}</span>
          {el.pages.length > 0 && (
            <span className="max-w-28 shrink-0 truncate text-[11px] text-muted-foreground">
              {el.pages.length > 1 ? `${el.pages.length} pages` : el.pages[0]}
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemove(i)}
            aria-label={`Remove ${el.label}`}
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <XIcon className="size-3" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
