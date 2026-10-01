/**
 * Render Markdown balasan model — `react-markdown` + `remark-gfm`.
 *
 * Balasan opencode berformat Markdown, jadi sebelumnya tampil sebagai teks
 * mentah (`**tebal**`, pipa tabel, fence kode). Komponen ini merendernya jadi
 * elemen HTML bergaya sistem desain aplikasi.
 *
 * Keputusan penting:
 * - **Tanpa `rehype-raw`.** HTML mentah di dalam Markdown TIDAK dirender
 *   sebagai DOM (di-escape jadi teks). Balasan model adalah konten tak
 *   terpercaya — ia bisa memuat markup dari file/web yang dibacanya —
 *   sehingga mengizinkan HTML mentah membuka pintu XSS. `disallowedElements`
 *   juga membuang tag pemuat sumber eksternal agar sintaks `![]()` tidak
 *   memicu request keluar.
 * - **Tabel dibungkus scroll horizontal.** Tabel lebar tidak boleh memaksa
 *   seluruh bubble melebar (dan merusak layout HP); wrapper `overflow-x-auto`
 *   membuat hanya tabelnya yang bergeser. Blok kode diperlakukan sama.
 * - **Link buka tab baru** dengan `rel="noopener noreferrer nofollow"`.
 * - **Blok kode di-highlight** lewat `CodeBlock` (Shiki, grammar dimuat
 *   lazy per bahasa). Kode inline tetap teks monospace biasa.
 * - Parser remark bersifat recoverable, jadi Markdown setengah jadi saat
 *   streaming tetap dirender tanpa error (fence yang belum ditutup tampil
 *   sebagai kode berjalan, lalu rapi begitu token penutup tiba).
 */

import { Children, type ComponentProps, isValidElement, type JSX, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "@/components/sessions/CodeBlock";
import { cn } from "@/lib/utils";

/**
 * Elemen yang tidak pernah dirender: pemuat sumber eksternal & elemen
 * berpotensi eksekusi.
 */
const DISALLOWED = ["img", "iframe", "script", "style", "video", "audio", "embed", "object"];

/**
 * Props yang diterima komponen kustom react-markdown. Selain atribut HTML,
 * react-markdown menyertakan `node` (AST hast) — prop internal yang HARUS
 * dibuang sebelum di-spread ke elemen DOM, kalau tidak ia bocor jadi atribut
 * `node="[object Object]"` di HTML hasil render.
 */
type MarkdownProps<T extends keyof JSX.IntrinsicElements> = ComponentProps<T> & {
  node?: unknown;
};

/**
 * Bangun komponen bergaya untuk satu tag HTML: `node` dibuang, `className`
 * dari markdown (mis. `language-ts` pada blok kode) tetap digabung.
 */
function styled<T extends keyof JSX.IntrinsicElements>(tag: T, classes: string) {
  return function StyledTag({ node: _node, className, ...props }: MarkdownProps<T>) {
    const Tag = tag as string;
    return <Tag {...props} className={cn(classes, className)} />;
  };
}

/** Tautan aman: selalu tab baru, tanpa membocorkan referrer. */
function MarkdownLink({ node: _node, className, ...props }: MarkdownProps<"a">) {
  return (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cn(
        "font-medium text-primary underline underline-offset-2 hover:no-underline",
        className,
      )}
    />
  );
}

/**
 * `code` melayani dua konteks: di dalam `pre` (blok) dan inline. Di dalam
 * `pre`, gaya latar/padding dilepas agar tidak dobel dengan wrapper `pre`;
 * react-markdown menandai blok lewat kelas `language-*`.
 */
function MarkdownCode({ node: _node, className, ...props }: MarkdownProps<"code">) {
  const isBlock = typeof className === "string" && className.includes("language-");
  return (
    <code
      {...props}
      className={cn(
        "font-mono",
        isBlock
          ? "bg-transparent p-0 text-base"
          : "rounded bg-muted px-1 py-0.5 text-[0.9em] wrap-anywhere",
        className,
      )}
    />
  );
}

/** Gabungkan anak `code` jadi string (react-markdown memberi teks mentah). */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/**
 * Blok kode: `pre > code.language-*`. Isi & bahasa diambil dari `code`
 * anak lalu dirender `CodeBlock` (highlight + tombol salin). Fence tanpa
 * bahasa tetap lewat `CodeBlock` (teks polos, tetap ada tombol salin).
 */
function MarkdownPre({ node: _node, children }: MarkdownProps<"pre">) {
  const child = Children.toArray(children)[0];
  if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    const cls = child.props.className ?? "";
    const lang = /(?:^|\s)language-(\S+)/.exec(cls)?.[1] ?? null;
    // Fence selalu diakhiri newline oleh parser — buang agar tidak ada
    // baris kosong ekstra di bawah blok.
    const code = textOf(child.props.children).replace(/\n$/, "");
    return <CodeBlock code={code} language={lang} />;
  }
  return <pre className="my-2 overflow-x-auto rounded-lg border bg-muted/60 p-3">{children}</pre>;
}

/**
 * Tabel + wrapper scroll horizontal. Wrapper `div` diperlukan karena elemen
 * `table` sendiri tidak dapat menjadi kontainer scroll.
 */
function MarkdownTable({ node: _node, className, ...props }: MarkdownProps<"table">) {
  return (
    <div className="my-2 max-w-full overflow-x-auto rounded-lg border first:mt-0 last:mb-0">
      <table {...props} className={cn("w-full border-collapse text-left text-base", className)} />
    </div>
  );
}

/**
 * Peta komponen: gaya memakai token sistem desain (bukan warna hardcoded)
 * supaya tema terang/gelap ikut menyesuaikan.
 */
const COMPONENTS = {
  a: MarkdownLink,
  code: MarkdownCode,
  table: MarkdownTable,
  // Blok kode: highlight + scroll horizontal sendiri (lihat `CodeBlock`).
  pre: MarkdownPre,
  p: styled("p", "my-2 first:mt-0 last:mb-0"),
  h1: styled("h1", "mt-4 mb-2 text-lg font-semibold first:mt-0"),
  h2: styled("h2", "mt-4 mb-2 text-lg font-semibold first:mt-0"),
  h3: styled("h3", "mt-3 mb-1.5 text-base font-semibold first:mt-0"),
  h4: styled("h4", "mt-3 mb-1.5 text-base font-semibold first:mt-0"),
  h5: styled("h5", "mt-3 mb-1 text-base font-semibold first:mt-0"),
  h6: styled("h6", "mt-3 mb-1 text-base font-semibold first:mt-0"),
  ul: styled("ul", "my-2 list-disc space-y-1 ps-5 first:mt-0 last:mb-0"),
  ol: styled("ol", "my-2 list-decimal space-y-1 ps-5 first:mt-0 last:mb-0"),
  li: styled("li", "marker:text-muted-foreground"),
  blockquote: styled(
    "blockquote",
    "my-2 border-s-2 border-border ps-3 text-muted-foreground italic first:mt-0 last:mb-0",
  ),
  hr: styled("hr", "my-3 border-border"),
  thead: styled("thead", "bg-muted/60"),
  th: styled("th", "border-b px-3 py-2 font-semibold whitespace-nowrap"),
  td: styled("td", "border-b px-3 py-2 align-top"),
  strong: styled("strong", "font-semibold"),
  em: styled("em", "italic"),
  del: styled("del", "text-muted-foreground line-through"),
};

export interface MarkdownContentProps {
  /** Sumber Markdown (teks balasan model). */
  children: string;
  className?: string;
}

export function MarkdownContent({ children, className }: MarkdownContentProps) {
  return (
    // react-markdown v10 tidak lagi menerima prop `className` — kelas dipasang
    // pada elemen pembungkus di sini.
    <div className={cn("min-w-0", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={DISALLOWED}
        unwrapDisallowed
        components={COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
