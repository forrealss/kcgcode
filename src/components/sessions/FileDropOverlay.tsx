/**
 * Overlay drag & drop file untuk layar Session (ala "Add anything").
 *
 * - Aktif hanya saat yang di-drag berisi file dari luar halaman (bukan teks
 *   / gambar yang di-drag di dalam aplikasi).
 * - Seluruh layar diredupkan (termasuk sidebar) lewat portal `fixed` ke
 *   `document.body`; kartu naik dari bawah dan berhenti tepat di tengah
 *   viewport: ilustrasi tumpukan file, judul, dan keterangan. Tidak bisa
 *   menerima (Session mati / model sedang merespon) -> kartu memberi tahu
 *   alasannya, drop diabaikan.
 * - Saat file dilepas, `onDropFiles` menerima file + posisi kartu. Kartu
 *   langsung menghilang tanpa animasi keluar karena "plate" di composer
 *   (`DropPlate`) mengambil alih dari posisi yang sama lalu mengecil ke
 *   deretan lampiran.
 *
 * Listener dipasang di `window` (drop di mana pun selama layar Session
 * terbuka) dan `preventDefault` selalu dipanggil untuk drag file agar
 * browser tidak membuka file di tab ini.
 */
import { FileTextIcon, ImageIcon, SquareTerminalIcon } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

function hasFiles(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes("Files") ?? false;
}

export interface FileDropOverlayProps {
  /** Composer bisa menerima lampiran sekarang. */
  accepting: boolean;
  /** Keterangan saat tidak bisa menerima (mis. "Session is not active"). */
  blockedReason?: string;
  onDropFiles: (files: File[], from: DOMRect | null) => void;
}

type Phase = "idle" | "dragging" | "dropped";

export function FileDropOverlay({ accepting, blockedReason, onDropFiles }: FileDropOverlayProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const cardRef = useRef<HTMLDivElement | null>(null);
  // Nilai terbaru untuk listener window (dipasang sekali).
  const latest = useRef({ accepting, onDropFiles });
  latest.current = { accepting, onDropFiles };

  useEffect(() => {
    /** dragenter/dragleave berpasangan per elemen — hitung kedalaman. */
    let depth = 0;
    /** Drag dimulai di dalam halaman (bukan file dari luar) -> abaikan. */
    let internal = false;

    const onDragStart = () => {
      internal = true;
    };
    const onDragEnd = () => {
      internal = false;
    };
    const onEnter = (e: DragEvent) => {
      if (internal || !hasFiles(e)) return;
      depth++;
      setPhase("dragging");
    };
    const onOver = (e: DragEvent) => {
      if (internal || !hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = latest.current.accepting ? "copy" : "none";
    };
    const onLeave = (e: DragEvent) => {
      if (internal || !hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setPhase("idle");
    };
    const onDrop = (e: DragEvent) => {
      if (internal || !hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      const files = e.dataTransfer ? [...e.dataTransfer.files] : [];
      if (files.length === 0 || !latest.current.accepting) {
        setPhase("idle");
        return;
      }
      const rect = cardRef.current?.getBoundingClientRect() ?? null;
      setPhase("dropped");
      latest.current.onDropFiles(files, rect);
    };
    // Jendela kehilangan fokus / Esc membatalkan drag -> tutup overlay.
    const reset = () => {
      depth = 0;
      internal = false;
      setPhase("idle");
    };

    window.addEventListener("dragstart", onDragStart);
    window.addEventListener("dragend", onDragEnd);
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("dragend", onDragEnd);
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("blur", reset);
    };
  }, []);

  // "dropped" hanya perlu satu frame agar kartu keluar tanpa animasi.
  useEffect(() => {
    if (phase !== "dropped") return;
    const id = requestAnimationFrame(() => setPhase("idle"));
    return () => cancelAnimationFrame(id);
  }, [phase]);

  const dropped = phase === "dropped";

  return createPortal(
    <AnimatePresence custom={dropped}>
      {phase === "dragging" && (
        <m.div
          key="file-drop-overlay"
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          transition={{ duration: 0.15 }}
          // Tidak menangkap pointer: dragenter/leave tetap dari elemen asli
          // sehingga hitungan kedalaman tidak kacau oleh overlay sendiri.
          // `fixed` + portal: menutupi seluruh viewport (sidebar ikut redup)
          // dan kartu terpusat di tengah layar, bukan di tengah area chat.
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/70 p-6 backdrop-blur-[2px]"
        >
          <m.div
            ref={cardRef}
            custom={dropped}
            // Naik dari bawah layar lalu mengendap di tengah.
            initial={{ opacity: 0, y: 120, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            variants={{
              // Dilepas: plate mengambil alih di posisi sama -> hilang instan.
              // Batal (drag keluar jendela): turun kembali ke bawah.
              exit: (wasDropped: boolean) =>
                wasDropped
                  ? { opacity: 0, transition: { duration: 0 } }
                  : {
                      opacity: 0,
                      y: 72,
                      scale: 0.97,
                      transition: { duration: 0.18, ease: "easeIn" },
                    },
            }}
            exit="exit"
            transition={{
              type: "spring",
              stiffness: 340,
              damping: 30,
              mass: 0.9,
              opacity: { duration: 0.18 },
            }}
            className={cn(
              "flex aspect-[5/4] w-full max-w-md flex-col items-center justify-center gap-5 rounded-[28px] border bg-popover px-8 text-center shadow-2xl",
              !accepting && "opacity-90",
            )}
          >
            <FileStack muted={!accepting} />
            <div className="flex flex-col gap-1.5">
              <p className="text-xl font-semibold tracking-tight">
                {accepting ? "Add anything" : "Can't add files right now"}
              </p>
              <p className="text-[14px] text-muted-foreground">
                {accepting
                  ? "Drop any file here to add it to the conversation"
                  : (blockedReason ?? "Try again when the session is ready.")}
              </p>
            </div>
            {accepting && (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-[12px] text-muted-foreground">
                Up to 20 MB per file
              </span>
            )}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Ilustrasi tiga kartu file (terminal, dokumen, gambar) yang bertumpuk. */
function FileStack({ muted }: { muted: boolean }) {
  const spring = { type: "spring", stiffness: 380, damping: 22 } as const;
  const tile =
    "absolute flex size-14 items-center justify-center rounded-2xl shadow-lg ring-1 ring-black/5";
  return (
    <div className={cn("relative h-20 w-36", muted && "grayscale")}>
      <m.span
        initial={{ opacity: 0, x: 18, rotate: 0 }}
        animate={{ opacity: 1, x: 0, rotate: -14 }}
        transition={{ ...spring, delay: 0.05 }}
        className={cn(tile, "top-2 left-3 bg-indigo-200 text-indigo-900")}
      >
        <SquareTerminalIcon className="size-7" strokeWidth={2.25} />
      </m.span>
      <m.span
        initial={{ opacity: 0, x: -18, rotate: 0 }}
        animate={{ opacity: 1, x: 0, rotate: 12 }}
        transition={{ ...spring, delay: 0.08 }}
        className={cn(tile, "top-0 right-3 bg-indigo-400 text-white")}
      >
        <FileTextIcon className="size-7" strokeWidth={2.25} />
      </m.span>
      <m.span
        initial={{ opacity: 0, y: 14, scale: 0.9 }}
        animate={{ opacity: 1, y: [0, -4, 0], scale: 1 }}
        transition={{
          opacity: { duration: 0.15 },
          scale: spring,
          // Melayang pelan selama drag berlangsung.
          y: { duration: 2.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut", delay: 0.3 },
        }}
        className={cn(tile, "top-5 left-1/2 -ml-7 size-16 bg-indigo-600 text-white")}
      >
        <ImageIcon className="size-8" strokeWidth={2.25} />
      </m.span>
    </div>
  );
}
